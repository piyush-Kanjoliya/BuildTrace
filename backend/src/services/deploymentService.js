'use strict';

const Deployment = require('../models/Deployment');
const Incident = require('../models/Incident');
const Project = require('../models/Project');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const auditService = require('./auditService');
const projectService = require('./projectService');
const eventService = require('./eventService');
const { assertProjectRole } = require('../middleware/rbac');
const { getPagination, getSort } = require('../utils/pagination');
const { ROLES, DEPLOYMENT_STATUS, INCIDENT_STATUS } = require('../utils/constants');
const { emitToProject } = require('../sockets');

const SORTABLE = ['occurredAt', 'receivedAt', 'createdAt', 'status', 'environment', 'version'];

function actorFromUser(user) {
  return { userId: user ? user._id : null, name: user ? user.name : null, type: user ? 'user' : 'automation' };
}

/**
 * Manual deployment entry (POST /projects/:id/deployments).
 * The environment must already be part of the project's environment list.
 */
async function createDeployment(user, project, input) {
  assertProjectRole(user, project, ROLES.DEVELOPER);

  if (!project.environments.includes(input.environment)) {
    throw ApiError.validation(
      `Environment "${input.environment}" is not defined on this project. Add it in project settings first.`,
      [{ path: 'environment', message: `Allowed: ${project.environments.join(', ')}` }]
    );
  }

  const now = new Date();
  const occurredAt = input.occurredAt || now;
  const deployment = await Deployment.create({
    projectId: project._id,
    version: input.version || 'unknown',
    commitSha: input.commitSha || null,
    environment: input.environment,
    status: input.status || DEPLOYMENT_STATUS.SUCCESS,
    actor: actorFromUser(user),
    occurredAt,
    receivedAt: now,
    occurredAtTrusted: true,
    source: 'manual',
    service: input.service || null,
    commitMessage: input.commitMessage || null,
    changedFiles: input.changedFiles || [],
    filesChangedCount: (input.changedFiles || []).length,
    url: input.url || null,
  });

  await afterDeploymentCreated({ project, deployment, actorId: user._id, recordEvent: true });

  return deployment.toJSON();
}

/**
 * Deployment created/updated from an ingested/integrated event (webhook, CI, event API).
 *
 * Deployment identity: `data.identity` (e.g. "gh-deployment:42") keeps status
 * updates for the same deployment on one row; when absent the event's externalId
 * is used, otherwise a standalone row is created (no dedup identity).
 *
 * Out-of-order safety: when an update's occurrence time is older than
 * `lastStatusAt`, the stale status is NOT applied (the raw event is still kept).
 *
 * No internal timeline event is recorded here - the triggering ingest event
 * already exists in the timeline.
 */
async function createFromIntegration({ project, event, data, source, actorName }) {
  const now = new Date();
  const environment = data.environment || project.environments[0];
  let adoptedEnvironment = false;

  if (!project.environments.includes(environment)) {
    await project.updateOne({ $addToSet: { environments: environment } });
    project.environments.push(environment);
    adoptedEnvironment = true;
  }

  const identity = data.identity || event.externalId || null;
  const late = event.receivedAt.getTime() - event.occurredAt.getTime() > env.events.lateThresholdMinutes * 60000;

  // ---- Existing deployment for this identity: apply only non-stale updates ----
  if (identity) {
    const existing = await Deployment.findOne({ projectId: project._id, source, externalId: identity });
    if (existing) {
      const newestKnown = existing.lastStatusAt || existing.occurredAt;
      if (event.occurredAt < newestKnown) {
        return { deployment: existing, created: false, updated: false, stale: true, adoptedEnvironment };
      }
      const changedFiles = Array.isArray(data.changedFiles) && data.changedFiles.length
        ? data.changedFiles.slice(0, 500)
        : existing.changedFiles;
      if (data.status) existing.status = data.status;
      if (data.version && data.version !== 'unknown') existing.version = data.version;
      if (data.commitSha) existing.commitSha = data.commitSha;
      if (data.commitMessage) existing.commitMessage = data.commitMessage;
      if (data.url) existing.url = data.url;
      if (data.service) existing.service = data.service;
      existing.changedFiles = changedFiles;
      existing.filesChangedCount = changedFiles.length;
      existing.lastStatusAt = event.occurredAt;
      existing.receivedAt = now;
      await existing.save();

      await auditService.record({
        projectId: project._id,
        actorId: event.actor?.userId || null,
        action: 'deployment.updated_from_event',
        after: { id: String(existing._id), status: existing.status, version: existing.version, eventId: String(event._id) },
      });

      emitToProject(project._id, 'deployment:updated', {
        deploymentId: String(existing._id),
        projectId: String(project._id),
        status: existing.status,
        candidateRefresh: late,
      });

      return { deployment: existing, created: false, updated: true, adoptedEnvironment };
    }
  }

  const changedFiles = Array.isArray(data.changedFiles) ? data.changedFiles.slice(0, 500) : [];
  const deployment = await Deployment.create({
    projectId: project._id,
    version: data.version || 'unknown',
    commitSha: data.commitSha || null,
    environment,
    status: data.status || DEPLOYMENT_STATUS.SUCCESS,
    actor: {
      userId: event.actor?.userId || null,
      name: actorName || event.actor?.name || null,
      type: actorName ? 'automation' : 'user',
    },
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    lastStatusAt: event.occurredAt,
    occurredAtTrusted: event.occurredAtSource === 'payload',
    source,
    externalId: identity,
    service: data.service || event.payload?.service || null,
    commitMessage: data.commitMessage || null,
    changedFiles,
    filesChangedCount: changedFiles.length,
    url: data.url || null,
    metadata: { eventId: event._id },
  });

  await afterDeploymentCreated({
    project,
    deployment,
    actorId: event.actor?.userId || null,
    recordEvent: false,
    adoptedEnvironment,
    late,
  });

  return { deployment, created: true, updated: false, adoptedEnvironment };
}

/**
 * Side effects after a deployment is stored: audit + real-time notification.
 * Late-arriving deployments explicitly announce that correlation results may
 * have changed so open investigation screens refresh candidates.
 */
async function afterDeploymentCreated({ project, deployment, actorId, recordEvent, adoptedEnvironment = false, late = false }) {
  if (recordEvent) {
    await eventService.recordInternalEvent({
      projectId: project._id,
      eventType: 'deployment',
      source: 'manual',
      occurredAt: deployment.occurredAt,
      actor: { userId: actorId, name: deployment.actor?.name || null },
      payload: {
        version: deployment.version,
        commitSha: deployment.commitSha,
        environment: deployment.environment,
        status: deployment.status,
      },
      deploymentId: deployment._id,
    });
  }

  await auditService.record({
    projectId: project._id,
    actorId,
    action: 'deployment.created',
    after: {
      id: String(deployment._id),
      version: deployment.version,
      environment: deployment.environment,
      status: deployment.status,
      commitSha: deployment.commitSha,
      ...(adoptedEnvironment ? { adoptedEnvironment: deployment.environment } : {}),
    },
  });

  emitToProject(project._id, 'deployment:created', {
    deploymentId: String(deployment._id),
    projectId: String(project._id),
    version: deployment.version,
    environment: deployment.environment,
    status: deployment.status,
    occurredAt: deployment.occurredAt,
    candidateRefresh: late || !deployment.occurredAtTrusted,
  });
}

async function listDeployments(user, project, query) {
  assertProjectRole(user, project, ROLES.VIEWER);
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query.sort, SORTABLE, { occurredAt: -1 });

  const filter = { projectId: project._id };
  if (query.environment) filter.environment = query.environment;
  if (query.status?.length) filter.status = { $in: query.status };
  if (query.source) filter.source = query.source;
  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = query.from;
    if (query.to) filter.occurredAt.$lte = query.to;
  }
  if (query.author) {
    const escaped = query.author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter['actor.name'] = new RegExp(escaped, 'i');
  }

  const [items, total] = await Promise.all([
    Deployment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Deployment.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

/**
 * Global deployment list - scoped server-side to the user's projects,
 * optionally narrowed to one project the user belongs to.
 */
async function listDeploymentsGlobal(user, query) {
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query.sort, SORTABLE, { occurredAt: -1 });

  const filter = {};
  if (query.projectId) {
    const project = await projectService.getProjectOr404(query.projectId);
    assertProjectRole(user, project, ROLES.VIEWER);
    filter.projectId = project._id;
  } else if (user.role !== ROLES.ADMIN) {
    const memberships = await Project.find({ 'members.user': user._id }).select('_id').lean();
    filter.projectId = { $in: memberships.map((m) => m._id) };
  }
  if (query.environment) filter.environment = query.environment;
  if (query.status?.length) filter.status = { $in: query.status };
  if (query.source) filter.source = query.source;
  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = query.from;
    if (query.to) filter.occurredAt.$lte = query.to;
  }
  if (query.author) {
    const escaped = query.author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter['actor.name'] = new RegExp(escaped, 'i');
  }

  const [items, total] = await Promise.all([
    Deployment.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('projectId', 'name slug')
      .lean(),
    Deployment.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

async function getDeploymentOr404(deploymentId) {
  const deployment = await Deployment.findById(deploymentId);
  if (!deployment) throw ApiError.notFound('Deployment not found');
  return deployment;
}

/**
 * Deployment details plus related incidents:
 *  - associated: incidents where an investigator explicitly linked this deployment
 *  - potential:  incidents whose investigation window contains this deployment
 *                (temporal overlap only - clearly labelled as unconfirmed)
 */
async function getDeploymentForUser(user, deploymentId) {
  const deployment = await getDeploymentOr404(deploymentId);
  const project = await projectService.getProjectOr404(deployment.projectId);
  assertProjectRole(user, project, ROLES.VIEWER);

  const windowMs = env.correlation.windowMinutes * 60 * 1000;
  const associated = await Incident.find({ projectId: deployment.projectId, deploymentIds: deployment._id })
    .select('title severity status environment createdAt resolvedAt')
    .lean();

  const associatedIds = associated.map((i) => i._id);
  const potential = await Incident.find({
    projectId: deployment.projectId,
    _id: { $nin: associatedIds },
    createdAt: { $gte: deployment.occurredAt, $lte: new Date(deployment.occurredAt.getTime() + windowMs) },
    $or: [{ environment: deployment.environment }, { environment: null }],
    status: { $ne: INCIDENT_STATUS.RESOLVED },
  })
    .select('title severity status environment createdAt')
    .limit(10)
    .lean();

  return {
    deployment: deployment.toJSON(),
    project: { id: String(project._id), name: project.name, environments: project.environments },
    relatedIncidents: {
      associated: associated.map((i) => ({ ...i, relation: 'associated' })),
      potential: potential.map((i) => ({ ...i, relation: 'potential' })),
    },
  };
}

async function updateDeployment(user, deploymentId, patch) {
  const deployment = await getDeploymentOr404(deploymentId);
  const project = await projectService.getProjectOr404(deployment.projectId);
  assertProjectRole(user, project, ROLES.DEVELOPER);

  const before = {
    status: deployment.status,
    version: deployment.version,
    service: deployment.service,
  };

  if (patch.status !== undefined) deployment.status = patch.status;
  if (patch.version !== undefined) deployment.version = patch.version;
  if (patch.commitMessage !== undefined) deployment.commitMessage = patch.commitMessage;
  if (patch.changedFiles !== undefined) {
    deployment.changedFiles = patch.changedFiles;
    deployment.filesChangedCount = patch.changedFiles.length;
  }
  if (patch.url !== undefined) deployment.url = patch.url;
  if (patch.service !== undefined) deployment.service = patch.service;
  await deployment.save();

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'deployment.updated',
    before,
    after: { status: deployment.status, version: deployment.version, service: deployment.service },
  });

  emitToProject(project._id, 'deployment:updated', {
    deploymentId: String(deployment._id),
    projectId: String(project._id),
    status: deployment.status,
  });

  return deployment.toJSON();
}

module.exports = {
  createDeployment,
  createFromIntegration,
  listDeployments,
  listDeploymentsGlobal,
  getDeploymentOr404,
  getDeploymentForUser,
  updateDeployment,
};
