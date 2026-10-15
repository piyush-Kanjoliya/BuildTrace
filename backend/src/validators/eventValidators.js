'use strict';

const { z, objectId, paginationQuery, dateRangeQuery, eventTypeList } = require('./common');
const { EVENT_SOURCES, DEPLOYMENT_STATUSES } = require('../utils/constants');

/**
 * Generic event ingestion input. Higher-level `payload` fields are interpreted
 * by the event service based on `eventType` (see eventService.processEvent).
 */
const ingestEventSchema = z.object({
  projectId: objectId,
  eventType: z.enum([
    'deployment',
    'deployment_status',
    'rollback',
    'commit',
    'incident',
    'incident_update',
    'comment',
    'investigation',
    'config_change',
    'other',
  ]),
  source: z.enum(EVENT_SOURCES).optional(),
  externalId: z.string().trim().min(1).max(200).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(200).optional().nullable(),
  occurredAt: z.coerce.date().optional().nullable(),
  service: z.string().trim().max(120).optional().nullable(),
  payload: z.record(z.string(), z.any()).optional().default({}),
  deployment: z
    .object({
      version: z.string().trim().max(120).optional(),
      commitSha: z.string().trim().regex(/^[0-9a-fA-F]{7,64}$/, 'commitSha must be hex').toLowerCase().optional().nullable(),
      environment: z.string().trim().max(60).optional(),
      status: z.enum(DEPLOYMENT_STATUSES).optional(),
      actorName: z.string().trim().max(140).optional().nullable(),
      commitMessage: z.string().trim().max(2000).optional().nullable(),
      changedFiles: z.array(z.string().trim().max(400)).max(500).optional(),
      url: z.string().trim().max(500).optional().nullable(),
    })
    .optional(),
  incident: z
    .object({
      title: z.string().trim().min(4).max(240).optional(),
      description: z.string().trim().max(8000).optional(),
      severity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).optional(),
      environment: z.string().trim().max(60).optional().nullable(),
      affectedService: z.string().trim().max(120).optional().nullable(),
    })
    .optional(),
});

const listEventsQuerySchema = z.object({
  ...paginationQuery,
  ...dateRangeQuery,
  types: eventTypeList,
  source: z.enum(EVENT_SOURCES).optional(),
  processingStatus: z.enum(['pending', 'processed', 'failed', 'ignored']).optional(),
  // asc = oldest-first (investigation reading order), desc = default
  order: z.enum(['asc', 'desc']).optional(),
  sort: z.string().max(60).optional(),
});

module.exports = { ingestEventSchema, listEventsQuerySchema };
