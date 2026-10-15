'use strict';

const Deployment = require('../models/Deployment');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const { minutesBetween } = require('../utils/eventTime');
const { keywords } = require('../utils/text');
const { DEPLOYMENT_STATUS, ROLES } = require('../utils/constants');
const { assertProjectRole } = require('../middleware/rbac');

/**
 * Deployment-to-Incident correlation.
 *
 * Method (transparent, rule-based, fully documented in docs/architecture.md):
 *
 *  1. Consider only deployments of the same project that occurred BEFORE the
 *     incident's detection time and within the investigation window
 *     (CORRELATION_WINDOW_MINUTES, default 60).
 *  2. Only successful or rolled-back deployments are candidates - a failed
 *     build never served production traffic.
 *  3. Score each candidate as a weighted sum of four explainable factors:
 *
 *       proximity      = 1 - (deployment age / window)          weight 0.45
 *       environment    = 1 when environments match              weight 0.20
 *       service        = 1 match / 0.5 unknown / 0 mismatch     weight 0.20
 *       change signals = keyword overlap + changed-file volume  weight 0.15
 *
 *     All weights are configurable via environment variables.
 *
 *  4. Results are SUGGESTIONS with explanations - never a claim of causation
 *     and never presented as statistical confidence.
 *  5. Deployments an investigator dismissed are excluded; associated ones are
 *     marked. Because candidates are computed from live data, late-arriving
 *     deployments automatically appear once they are persisted.
 */

const WEIGHTS = env.correlation.weights;

function computeChangeSignal(deployment, incidentKeywordSet) {
  const commitMessage = deployment.commitMessage || '';
  const commitKeywords = keywords(commitMessage);
  const overlap = commitKeywords.filter((k) => incidentKeywordSet.has(k));

  const fileSignal = Math.min((deployment.filesChangedCount || 0) / 20, 1);
  const keywordSignal = overlap.length > 0 ? Math.min(overlap.length / 3, 1) : 0;

  // 70% of the change signal comes from concrete textual overlap,
  // 30% from the size of the change set.
  const score = Math.min(keywordSignal * 0.7 + fileSignal * 0.3, 1);
  return { score, overlap, filesChanged: deployment.filesChangedCount || 0 };
}

function computeServiceSignal(deployment, incident) {
  if (!incident.affectedService) return { score: 0.5, reason: 'incident has no affected service recorded' };
  if (!deployment.service) return { score: 0.5, reason: 'deployment has no service recorded' };
  if (deployment.service === incident.affectedService) {
    return { score: 1, reason: `same service (${deployment.service})` };
  }
  return { score: 0, reason: `different service (${deployment.service})` };
}

async function computeCandidates({ project, incident }) {
  const windowMinutes = env.correlation.windowMinutes;
  const end = incident.createdAt;
  const start = new Date(end.getTime() - windowMinutes * 60 * 1000);

  const dismissed = new Set((incident.dismissedDeploymentIds || []).map(String));
  const associated = new Set((incident.deploymentIds || []).map(String));

  const deployments = await Deployment.find({
    projectId: project._id,
    occurredAt: { $gte: start, $lte: end },
    status: { $in: [DEPLOYMENT_STATUS.SUCCESS, DEPLOYMENT_STATUS.ROLLED_BACK] },
    _id: { $nin: [...dismissed] },
  })
    .populate('actor.userId', 'name email')
    .lean();

  const incidentKeywordSet = new Set(
    keywords(`${incident.title} ${incident.description || ''}`)
  );

  const candidates = deployments.map((deployment) => {
    const ageMinutes = minutesBetween(deployment.occurredAt, end);
    const proximityScore = Math.max(0, Math.min(1, 1 - ageMinutes / windowMinutes));

    const environmentScore = incident.environment
      ? deployment.environment === incident.environment ? 1 : 0
      : 0.5;
    const serviceSignal = computeServiceSignal(deployment, incident);
    const changeSignal = computeChangeSignal(deployment, incidentKeywordSet);

    const score =
      WEIGHTS.proximity * proximityScore +
      WEIGHTS.environment * environmentScore +
      WEIGHTS.service * serviceSignal.score +
      WEIGHTS.changeSignals * changeSignal.score;

    const factors = [
      {
        factor: 'proximity',
        weight: WEIGHTS.proximity,
        value: Math.round(proximityScore * 100) / 100,
        explanation: `deployed ${ageMinutes} min before the incident was reported`,
      },
      {
        factor: 'environment',
        weight: WEIGHTS.environment,
        value: environmentScore,
        explanation: incident.environment
          ? environmentScore === 1
            ? `same environment (${deployment.environment})`
            : `environment mismatch (${deployment.environment} vs ${incident.environment})`
          : 'incident has no environment recorded - environment not scored',
      },
      { factor: 'service', weight: WEIGHTS.service, value: serviceSignal.score, explanation: serviceSignal.reason },
      {
        factor: 'change_signals',
        weight: WEIGHTS.changeSignals,
        value: Math.round(changeSignal.score * 100) / 100,
        explanation:
          changeSignal.overlap.length > 0
            ? `commit message shares keywords with the incident: ${changeSignal.overlap.slice(0, 5).join(', ')}`
            : changeSignal.filesChanged > 0
              ? `${changeSignal.filesChanged} changed files (no direct keyword overlap)`
              : 'no commit message or changed-file data available',
      },
    ];

    return {
      deployment,
      score: Math.round(score * 1000) / 1000,
      timeDeltaMinutes: ageMinutes,
      factors,
      associatedByInvestigator: associated.has(String(deployment._id)),
      lateArrival: deployment.receivedAt - deployment.occurredAt > env.events.lateThresholdMinutes * 60000,
    };
  });

  candidates.sort((a, b) => b.score - a.score || b.timeDeltaMinutes - a.timeDeltaMinutes);

  return {
    incidentId: String(incident._id),
    projectId: String(project._id),
    window: {
      minutes: windowMinutes,
      from: start,
      to: end,
      description: `successful or rolled-back deployments in the ${windowMinutes} minutes before the incident was reported`,
    },
    weights: WEIGHTS,
    methodology:
      'Rule-based weighted scoring over four explainable factors (proximity, environment, service, change signals). ' +
      'This is a suggestion engine, not a causal or statistical claim - always verify with the linked evidence.',
    candidates: candidates.slice(0, 10),
    noneFound: candidates.length === 0,
    noneFoundMessage:
      candidates.length === 0
        ? `No successful deployment found in the ${windowMinutes} minutes before this incident was reported. Late events will appear here automatically once ingested.`
        : null,
  };
}

/** Authorization wrapper used by the API layer. */
async function getCandidatesForIncident(user, incident, project) {
  assertProjectRole(user, project, ROLES.VIEWER);
  return computeCandidates({ project, incident });
}

async function getCandidateForIncidentOrThrow(incident, project, deploymentId) {
  const result = await computeCandidates({ project, incident });
  const match = result.candidates.find((c) => String(c.deployment._id) === String(deploymentId));
  if (!match) {
    throw ApiError.badRequest(
      'This deployment is not within the current investigation window and cannot be associated'
    );
  }
  return match;
}

module.exports = { computeCandidates, getCandidatesForIncident, getCandidateForIncidentOrThrow, WEIGHTS };
