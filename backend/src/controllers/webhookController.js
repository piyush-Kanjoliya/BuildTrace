'use strict';

const Project = require('../models/Project');
const eventService = require('../services/eventService');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { verifyGithubSignature } = require('../utils/security');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GitHub webhook receiver.
 *
 * Hardening:
 *  - The route is mounted with express.raw() so the HMAC-SHA256 signature is
 *    verified against the EXACT raw request body.
 *  - Signature comparison is constant-time (crypto.timingSafeEqual).
 *  - Invalid signatures are rejected with 401 and never reveal the secret.
 *  - Deduplication uses GitHub's X-GitHub-Delivery identifier as the
 *    source-scoped idempotency key; a redelivery of a previously FAILED event
 *    is reprocessed (recovery), otherwise it is a safe no-op.
 *  - A `push` event is recorded as a commit event - it is NEVER treated as a
 *    successful production deployment. Only `deployment` / `deployment_status`
 *    events produce deployments.
 *  - Processing failures respond 500 so GitHub retries the delivery, and the
 *    failure itself is persisted on the event record either way.
 */

/** Find the project whose repositoryUrl refers to this GitHub repository. */
async function findProjectForRepo(repo, explicitProjectId) {
  if (explicitProjectId) {
    const project = await Project.findById(explicitProjectId);
    return project || null;
  }
  const fullName = repo?.full_name;
  if (!fullName) return null;

  // repositoryUrl is stored as a normalized URL; match by suffix on full_name
  const projects = await Project.find({ repositoryUrl: { $regex: fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
  if (projects.length > 0) return projects[0];

  // Fallback: compare normalized repositoryUrls in memory (small N)
  const all = await Project.find({ repositoryUrl: { $ne: '' } });
  return (
    all.find((p) => {
      const url = p.repositoryUrl.toLowerCase().replace(/\.git$/, '');
      return url.endsWith(fullName.toLowerCase()) || url.endsWith(`/${fullName.toLowerCase()}`);
    }) || null
  );
}

/** Map a GitHub payload onto the internal event shape. */
function normalizeGithubEvent(eventName, payload, repoFullName) {
  const sender = payload.sender?.login || null;
  const sha = payload.deployment?.sha || payload.head_commit?.id || payload.after || null;

  switch (eventName) {
    case 'push':
      return {
        eventType: 'commit',
        occurredAt: payload.head_commit?.timestamp || payload.commits?.[0]?.timestamp || undefined,
        payload: {
          ref: payload.ref,
          branch: payload.ref ? payload.ref.replace('refs/heads/', '') : null,
          repository: repoFullName,
          commitCount: (payload.commits || []).length,
          headCommit: payload.head_commit
            ? {
                id: payload.head_commit.id,
                message: payload.head_commit.message,
                author: payload.head_commit.author?.name || null,
                added: (payload.head_commit.added || []).length,
                removed: (payload.head_commit.removed || []).length,
                modified: (payload.head_commit.modified || []).length,
              }
            : null,
        },
      };

    case 'deployment':
      return {
        eventType: 'deployment',
        occurredAt: payload.deployment?.created_at,
        deployment: {
          identity: payload.deployment?.id ? `gh-deployment:${payload.deployment.id}` : null,
          environment: payload.deployment?.environment,
          commitSha: sha,
          // A "deployment" event means the deployment STARTED - not success.
          status: 'in_progress',
          version: sha ? sha.slice(0, 8) : undefined,
          actorName: payload.deployment?.creator?.login || sender,
          url: payload.deployment?.url,
        },
      };

    case 'deployment_status': {
      const state = payload.deployment_status?.state;
      const status = state === 'success' ? 'success' : state === 'failure' || state === 'error' ? 'failed' : 'in_progress';
      return {
        eventType: 'deployment_status',
        occurredAt: payload.deployment_status?.created_at || payload.deployment?.updated_at,
        deployment: {
          identity: payload.deployment?.id ? `gh-deployment:${payload.deployment.id}` : null,
          environment: payload.deployment?.environment,
          commitSha: sha,
          status,
          state,
          version: sha ? sha.slice(0, 8) : undefined,
          actorName: payload.deployment_status?.creator?.login || sender,
          url: payload.deployment_status?.target_url || payload.deployment?.url,
        },
      };
    }

    default:
      return {
        eventType: 'other',
        occurredAt: payload.created_at || undefined,
        payload: { githubEvent: eventName, repository: repoFullName, action: payload.action || null },
      };
  }
}

const handleGithubWebhook = asyncHandler(async (req, res) => {
  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

  const signature = req.headers['x-hub-signature-256'];
  const deliveryId = req.headers['x-github-delivery'];
  const eventName = req.headers['x-github-event'];

  if (!deliveryId) throw ApiError.badRequest('Missing X-GitHub-Delivery header');
  if (!eventName) throw ApiError.badRequest('Missing X-GitHub-Event header');

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw ApiError.badRequest('Webhook body is not valid JSON');
  }

  const repoFullName = payload.repository?.full_name || null;
  const project = await findProjectForRepo(payload.repository, req.query.projectId);
  if (!project) {
    logger.warn({ repoFullName, deliveryId }, 'GitHub webhook for unknown repository');
    throw ApiError.notFound(
      `No BuildTrace project is configured for repository "${repoFullName || 'unknown'}". Set the repository URL in project settings.`
    );
  }

  // The secret itself is never logged or returned.
  const withSecret = await Project.findById(project._id).select('+githubWebhookSecret');
  if (!withSecret.githubWebhookSecret) {
    throw ApiError.conflict('GitHub webhooks are not configured for this project. Generate a webhook secret in project settings first.');
  }

  if (!verifyGithubSignature(raw, signature, withSecret.githubWebhookSecret)) {
    logger.warn({ deliveryId, projectId: String(project._id), repoFullName }, 'Rejected GitHub webhook: invalid signature');
    throw ApiError.unauthorized('Invalid webhook signature');
  }

  // Ping events only verify connectivity - nothing to process.
  if (eventName === 'ping') {
    return res.status(200).json({ success: true, data: { pong: true, deliveryId } });
  }

  const normalized = normalizeGithubEvent(eventName, payload, repoFullName);
  const result = await eventService.ingestEvent({
    project,
    input: {
      eventType: normalized.eventType,
      externalId: deliveryId, // GitHub's delivery id - the deduplication key
      occurredAt: normalized.occurredAt || null,
      payload: normalized.payload || {},
      deployment: normalized.deployment,
    },
    actor: null,
    source: 'github',
  });

  if (result.failed) {
    // Persisted as failed; 500 lets GitHub redeliver, and our dedup path
    // reprocesses failed events on redelivery.
    return res.status(500).json({
      success: false,
      error: {
        code: 'PROCESSING_FAILED',
        message: `Event ${result.event?._id} was persisted but processing failed: ${result.error}`,
      },
    });
  }

  return res.status(202).json({
    success: true,
    data: {
      deliveryId,
      duplicate: Boolean(result.duplicate),
      reprocessed: Boolean(result.reprocessed),
      eventId: result.event ? String(result.event._id) : null,
      eventType: normalized.eventType,
      processingStatus: result.event?.processingStatus || null,
      deploymentId: result.deploymentId ? String(result.deploymentId) : null,
    },
  });
});

module.exports = { handleGithubWebhook, normalizeGithubEvent, findProjectForRepo };
