'use strict';

const Event = require('../models/Event');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');
const auditService = require('./auditService');
const projectService = require('./projectService');
const { resolveOccurredAt, isLateArrival } = require('../utils/eventTime');
const { getPagination, getSort } = require('../utils/pagination');
const { assertProjectRole } = require('../middleware/rbac');
const { emitToProject } = require('../sockets');
const { ROLES } = require('../utils/constants');

const SORTABLE = ['occurredAt', 'receivedAt', 'createdAt', 'eventType', 'processingStatus'];

/**
 * Deduplication key: scoped to the source, stable across repeated deliveries.
 *  - GitHub (and any integration that provides an id): externalId
 *  - Manual/automation clients: a client-supplied idempotencyKey
 * Events with neither get dedupKey = null and are intentionally exempt from
 * the unique index - legitimate repeated internal events must never merge.
 */
function buildDedupKey(source, externalId, idempotencyKey) {
  if (externalId) return `ext:${source}:${externalId}`;
  if (idempotencyKey) return `idem:${source}:${idempotencyKey}`;
  return null;
}

/**
 * Derive a deployment status for deployment-ish events.
 * A push/commit event never maps to a successful deployment - only explicit
 * deployment status signals do.
 */
function deriveDeploymentStatus(eventType, data) {
  if (data.status) return data.status;
  if (eventType === 'rollback') return 'rolled_back';
  const state = String(data.state || '').toLowerCase();
  if (state === 'success') return 'success';
  if (state === 'failure' || state === 'error') return 'failed';
  if (state === 'inactive' || eventType === 'deployment_status' && state === 'pending') return 'in_progress';
  if (eventType === 'deployment_status') return 'in_progress';
  if (eventType === 'deployment') return 'in_progress';
  return 'success';
}

/**
 * Process a persisted event according to its type. Returns linkage ids.
 * Deployment/incident services are required lazily to keep module loading
 * acyclic (they depend on this module for their timeline entries).
 */
async function processEvent(event, project, data) {
  const payload = { ...(data.payload || {}) };

  switch (event.eventType) {
    case 'deployment':
    case 'deployment_status':
    case 'rollback': {
      const deploymentData = { ...(payload.deployment || {}), ...(data.deployment || {}) };
      // Allow flat payload fields as a convenience for simple clients
      for (const key of ['version', 'commitSha', 'environment', 'commitMessage', 'changedFiles', 'url', 'service', 'identity', 'actorName', 'state']) {
        if (deploymentData[key] === undefined && payload[key] !== undefined) deploymentData[key] = payload[key];
      }
      deploymentData.status = deriveDeploymentStatus(event.eventType, deploymentData);

      // eslint-disable-next-line global-require
      const deploymentService = require('./deploymentService');
      const result = await deploymentService.createFromIntegration({
        project,
        event,
        data: deploymentData,
        source: event.source,
        actorName: deploymentData.actorName || null,
      });

      return {
        deploymentId: result.deployment._id,
        deploymentCreated: result.created,
        deploymentUpdated: Boolean(result.updated),
        staleStatusIgnored: Boolean(result.stale),
        adoptedEnvironment: result.adoptedEnvironment,
      };
    }

    case 'incident': {
      const incidentData = { ...(payload.incident || {}), ...(data.incident || {}) };
      for (const key of ['title', 'description', 'severity', 'environment', 'affectedService']) {
        if (incidentData[key] === undefined && payload[key] !== undefined) incidentData[key] = payload[key];
      }
      if (!incidentData.title) return { ignored: true, reason: 'incident event without a title' };

      // eslint-disable-next-line global-require
      const incidentService = require('./incidentService');
      const incident = await incidentService.createIncidentFromEvent({ project, event, data: incidentData });
      return { incidentId: incident._id };
    }

    // A push is NOT a deployment: record the event, create no deployment row.
    default:
      return {};
  }
}

/**
 * Record an internally generated event (timeline backbone for actions that
 * happen through the API itself). No dedup key: these are always distinct.
 */
async function recordInternalEvent({
  projectId,
  eventType,
  source = 'system',
  occurredAt = new Date(),
  actor = null,
  payload = {},
  deploymentId = null,
  incidentId = null,
}) {
  const now = new Date();
  const occurred = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  return Event.create({
    projectId,
    eventType,
    source,
    dedupKey: null,
    occurredAt: occurred,
    receivedAt: now,
    occurredAtSource: 'payload',
    timestampUncertain: false,
    payload,
    actor: actor || {},
    deploymentId,
    incidentId,
    processingStatus: 'processed',
    processedAt: now,
  });
}

/**
 * Ingest an external event.
 *
 * Ordering/dedup guarantees:
 *  1. The event row is created first (status "pending") so the unique dedupKey
 *     index atomically rejects concurrent duplicates.
 *  2. A duplicate delivery returns the ORIGINAL event with duplicate=true -
 *     repeated delivery is safe and produces a stable outcome.
 *  3. Occurrence vs receipt time are always both preserved; an old occurredAt
 *     never causes rejection ("late" is a flag, not an error).
 *  4. Processing failures are persisted on the event (status "failed") and can
 *     be retried - the acceptance of the HTTP request is not tied to it.
 */
async function ingestEvent({ project, input, actor = null, source = null }) {
  const now = new Date();
  const eventSource = source || input.source || 'api';
  const { occurredAt, occurredAtSource } = resolveOccurredAt(input, now);
  const dedupKey = buildDedupKey(eventSource, input.externalId, input.idempotencyKey);

  let event;
  try {
    event = await Event.create({
      projectId: project._id,
      eventType: input.eventType,
      source: eventSource,
      externalId: input.externalId || null,
      idempotencyKey: input.idempotencyKey || null,
      dedupKey,
      occurredAt,
      receivedAt: now,
      occurredAtSource,
      timestampUncertain: occurredAtSource === 'receipt',
      payload: input.payload || {},
      actor: actor ? { userId: actor._id, name: actor.name } : { userId: null, name: null },
      processingStatus: 'pending',
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.dedupKey) {
      const existing = await Event.findOne({ dedupKey });
      if (!existing) {
        // Extremely unlikely race: the duplicate was deleted between attempts.
        throw err;
      }
      // Recovery path: a redelivery of a previously FAILED event re-attempts
      // processing instead of blindly returning the failure. This is what
      // makes integration retries (e.g. GitHub redelivery) fully recoverable.
      if (existing.processingStatus === 'failed') {
        existing.retryCount += 1;
        existing.processingStatus = 'pending';
        await existing.save();
        const recovered = await finalizeEventProcessing({ event: existing, project, input });
        return { ...recovered, duplicate: true, reprocessed: true };
      }
      return {
        duplicate: true,
        event: existing,
        deploymentId: existing.deploymentId || null,
        incidentId: existing.incidentId || null,
      };
    }
    throw err;
  }

  return finalizeEventProcessing({ event, project, input });
}

/**
 * Run processing for a persisted event and persist the outcome.
 * Shared by initial ingestion and retries.
 */
async function finalizeEventProcessing({ event, project, input }) {
  try {
    const result = await processEvent(event, project, input);
    event.processingStatus = result.ignored ? 'ignored' : 'processed';
    event.processedAt = new Date();
    if (result.deploymentId) event.deploymentId = result.deploymentId;
    if (result.incidentId) event.incidentId = result.incidentId;
    event.error = { message: null, at: null };
    await event.save();

    emitToProject(project._id, 'event:processed', {
      eventId: String(event._id),
      projectId: String(project._id),
      eventType: event.eventType,
      processingStatus: event.processingStatus,
      lateArrival: isLateArrival(event.occurredAt, event.receivedAt),
      deploymentId: event.deploymentId ? String(event.deploymentId) : null,
      incidentId: event.incidentId ? String(event.incidentId) : null,
    });

    return { duplicate: false, event, ...result };
  } catch (err) {
    event.processingStatus = 'failed';
    event.error = { message: err.message, at: new Date() };
    await event.save();
    logger.error({ err, eventId: String(event._id), eventType: event.eventType }, 'Event processing failed');
    emitToProject(project._id, 'event:processed', {
      eventId: String(event._id),
      projectId: String(project._id),
      eventType: event.eventType,
      processingStatus: 'failed',
    });
    return { duplicate: false, event, failed: true, error: err.message };
  }
}

/**
 * Retry a failed event (project admin). Re-processes the stored payload.
 */
async function retryEvent(user, eventId) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');
  const project = await projectService.getProjectOr404(event.projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  if (event.processingStatus !== 'failed') {
    throw ApiError.conflict(`Only failed events can be retried (current status: ${event.processingStatus})`);
  }

  event.retryCount += 1;
  event.processingStatus = 'pending';
  await event.save();

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'event.retry',
    after: { eventId: String(event._id), retryCount: event.retryCount },
  });

  const input = {
    eventType: event.eventType,
    externalId: event.externalId,
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };
  return finalizeEventProcessing({ event, project, input });
}

/**
 * List events for the timeline / event explorer.
 * Ordered by occurrence time with _id as the stable secondary key, so events
 * with identical timestamps never reshuffle between queries.
 */
async function listEvents(user, project, query) {
  assertProjectRole(user, project, ROLES.VIEWER);
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query.sort, SORTABLE, { occurredAt: -1, _id: -1 });

  const filter = { projectId: project._id };
  if (query.types?.length) filter.eventType = { $in: query.types };
  if (query.source) filter.source = query.source;
  if (query.processingStatus) filter.processingStatus = query.processingStatus;
  if (query.from || query.to) {
    filter.occurredAt = {};
    if (query.from) filter.occurredAt.$gte = query.from;
    if (query.to) filter.occurredAt.$lte = query.to;
  }

  const [items, total] = await Promise.all([
    Event.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('actor.userId', 'name email')
      .lean(),
    Event.countDocuments(filter),
  ]);

  const enriched = items.map((e) => ({
    ...e,
    lateArrival: isLateArrival(new Date(e.occurredAt), new Date(e.receivedAt)),
    timestampUncertain: e.occurredAtSource !== 'payload',
    receiptDelayMinutes: Math.round(((new Date(e.receivedAt) - new Date(e.occurredAt)) / 60000) * 10) / 10,
  }));

  return { items: enriched, page, limit, total };
}

module.exports = {
  ingestEvent,
  recordInternalEvent,
  retryEvent,
  listEvents,
  buildDedupKey,
  deriveDeploymentStatus,
};
