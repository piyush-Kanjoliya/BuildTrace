'use strict';

const Incident = require('../models/Incident');
const Deployment = require('../models/Deployment');
const Event = require('../models/Event');
const Project = require('../models/Project');
const ApiError = require('../utils/ApiError');
const { assertProjectRole } = require('../middleware/rbac');
const { ROLES, INCIDENT_STATUS, SEVERITY } = require('../utils/constants');

const TREND_DAYS = 14;
const DEPLOYMENT_WINDOW_DAYS = 30;

/**
 * Dashboard metrics. Every number is computed from live database queries -
 * nothing is fabricated or hardcoded.
 *
 * Scope: a single project when `project` is provided, otherwise every project
 * the user is a member of (global admins: all projects).
 */

async function resolveScope(user, project) {
  if (project) {
    assertProjectRole(user, project, ROLES.VIEWER);
    return { projectIds: [project._id], scope: 'project', projectName: project.name };
  }
  let ids;
  if (user.role === ROLES.ADMIN) {
    ids = (await Project.find({}, { _id: 1 }).lean()).map((p) => p._id);
  } else {
    ids = (await Project.find({ 'members.user': user._id }, { _id: 1 }).lean()).map((p) => p._id);
  }
  return { projectIds: ids, scope: 'user', projectName: null };
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/** Fill missing days so trend charts render a continuous series. */
function fillDailySeries(rows, days = TREND_DAYS) {
  const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const key = dayKey(d);
    out.push({ date: key, count: map[key] || 0 });
  }
  return out;
}

async function getDashboard(user, project = null) {
  const { projectIds, scope, projectName } = await resolveScope(user, project);
  const match = { projectId: { $in: projectIds } };

  const trendStart = new Date(Date.now() - TREND_DAYS * 24 * 3600 * 1000);
  const deployStart = new Date(Date.now() - DEPLOYMENT_WINDOW_DAYS * 24 * 3600 * 1000);
  trendStart.setHours(0, 0, 0, 0);

  const [
    incidentStatusCounts,
    incidentSeverityCounts,
    deploymentStatusCounts,
    incidentTrendRows,
    deploymentTrendRows,
    recentIncidents,
    recentDeployments,
    recentActivity,
    recurringRows,
    totalProjects,
    criticalOpen,
  ] = await Promise.all([
    Incident.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Incident.aggregate([{ $match: match }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
    Deployment.aggregate([
      { $match: { ...match, occurredAt: { $gte: deployStart } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: { ...match, createdAt: { $gte: trendStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Deployment.aggregate([
      { $match: { ...match, occurredAt: { $gte: trendStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Incident.find(match)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('assigneeId', 'name email')
      .populate('projectId', 'name slug')
      .lean(),
    Deployment.find(match)
      .sort({ occurredAt: -1 })
      .limit(5)
      .populate('actor.userId', 'name email')
      .lean(),
    Event.find(match)
      .sort({ occurredAt: -1, _id: -1 })
      .limit(10)
      .populate('actor.userId', 'name email')
      .lean(),
    /**
     * Recurring issues rule (transparent, deterministic):
     * incidents sharing the same normalized title signature within the same
     * project. Signatures replace digits with "#" and strip punctuation.
     * Only groups with 2+ incidents are reported, and the rule is disclosed.
     */
    Incident.aggregate([
      { $match: { ...match, signature: { $ne: null } } },
      {
        $group: {
          _id: { projectId: '$projectId', signature: '$signature' },
          count: { $sum: 1 },
          latest: { $max: '$createdAt' },
          maxSeverity: { $min: '$severity' },
          openCount: {
            $sum: { $cond: [{ $ne: ['$status', INCIDENT_STATUS.RESOLVED] }, 1, 0] },
          },
          sampleTitle: { $first: '$title' },
          incidentIds: { $push: '$_id' },
        },
      },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1, latest: -1 } },
      { $limit: 5 },
    ]),
    Project.countDocuments(
      user.role === ROLES.ADMIN ? {} : { 'members.user': user._id }
    ),
    Incident.countDocuments({
      ...match,
      severity: SEVERITY.SEV1,
      status: { $ne: INCIDENT_STATUS.RESOLVED },
    }),
  ]);

  const statusMap = Object.fromEntries(incidentStatusCounts.map((r) => [r._id, r.count]));
  const severityMap = Object.fromEntries(incidentSeverityCounts.map((r) => [r._id, r.count]));
  const deployMap = Object.fromEntries(deploymentStatusCounts.map((r) => [r._id, r.count]));

  const openIncidents =
    (statusMap[INCIDENT_STATUS.OPEN] || 0) +
    (statusMap[INCIDENT_STATUS.INVESTIGATING] || 0) +
    (statusMap[INCIDENT_STATUS.MONITORING] || 0);

  const recurring = await Promise.all(
    recurringRows.map(async (row) => {
      const project = await Project.findById(row._id.projectId, 'name slug').lean();
      return {
        signature: row._id.signature,
        projectId: String(row._id.projectId),
        projectName: project ? project.name : 'Unknown project',
        count: row.count,
        openCount: row.openCount,
        highestSeverity: row.maxSeverity,
        lastOccurredAt: row.latest,
        sampleTitle: row.sampleTitle,
        incidentIds: row.incidentIds.map(String),
      };
    })
  );

  return {
    scope,
    projectName,
    totals: {
      projects: totalProjects,
      openIncidents,
      criticalIncidents: severityMap[SEVERITY.SEV1] || 0, // all-time SEV1 count
      criticalOpen, // SEV1 incidents that are not yet resolved
      resolvedIncidents: statusMap[INCIDENT_STATUS.RESOLVED] || 0,
    },
    incidents: {
      byStatus: {
        open: statusMap[INCIDENT_STATUS.OPEN] || 0,
        investigating: statusMap[INCIDENT_STATUS.INVESTIGATING] || 0,
        monitoring: statusMap[INCIDENT_STATUS.MONITORING] || 0,
        resolved: statusMap[INCIDENT_STATUS.RESOLVED] || 0,
      },
      bySeverity: {
        SEV1: severityMap.SEV1 || 0,
        SEV2: severityMap.SEV2 || 0,
        SEV3: severityMap.SEV3 || 0,
        SEV4: severityMap.SEV4 || 0,
      },
    },
    deployments: {
      windowDays: DEPLOYMENT_WINDOW_DAYS,
      byStatus: {
        success: deployMap.success || 0,
        failed: deployMap.failed || 0,
        in_progress: deployMap.in_progress || 0,
        rolled_back: deployMap.rolled_back || 0,
        cancelled: deployMap.cancelled || 0,
      },
    },
    trends: {
      days: TREND_DAYS,
      incidents: fillDailySeries(incidentTrendRows),
      deployments: fillDailySeries(deploymentTrendRows),
    },
    recentIncidents,
    recentDeployments,
    recentActivity: recentActivity.map((e) => ({
      ...e,
      timestampUncertain: e.occurredAtSource !== 'payload',
    })),
    recurringIssues: {
      rule:
        'Incidents sharing the same normalized title signature (digits replaced with "#", punctuation removed) within a project are treated as recurring. This is a deterministic text rule, not statistical clustering.',
      minOccurrences: 2,
      groups: recurring,
    },
  };
}

// Compute open-critical count within the same scope (single pass over scope resolution)
module.exports = { getDashboard };
