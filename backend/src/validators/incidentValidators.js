'use strict';

const { z, objectId, paginationQuery, dateRangeQuery } = require('./common');
const { SEVERITIES, INCIDENT_STATUSES } = require('../utils/constants');

const createIncidentSchema = z.object({
  title: z.string().trim().min(4, 'Title must be at least 4 characters').max(240),
  description: z.string().trim().max(8000).optional().default(''),
  severity: z.enum(SEVERITIES).optional(),
  environment: z.string().trim().max(60).optional().nullable(),
  affectedService: z.string().trim().max(120).optional().nullable(),
  assigneeId: z.union([objectId, z.null()]).optional(),
});

/**
 * Full incident update. `version` is required and must match the stored
 * version - otherwise the API responds 409 (optimistic concurrency control).
 */
const updateIncidentSchema = z
  .object({
    version: z.coerce.number().int().min(0, 'version must be a non-negative integer'),
    title: z.string().trim().min(4).max(240).optional(),
    description: z.string().trim().max(8000).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    assigneeId: z.union([objectId, z.null()]).optional(),
    environment: z.string().trim().max(60).optional().nullable(),
    affectedService: z.string().trim().max(120).optional().nullable(),
    rootCause: z.string().trim().max(4000).optional().nullable(),
    resolution: z.string().trim().max(4000).optional().nullable(),
  })
  .refine((obj) => Object.keys(obj).some((k) => k !== 'version'), {
    message: 'No updatable fields were provided',
  });

const listIncidentsQuerySchema = z.object({
  ...paginationQuery,
  ...dateRangeQuery,
  q: z.string().trim().max(120).optional(),
  status: z.union([z.enum(INCIDENT_STATUSES), z.array(z.enum(INCIDENT_STATUSES))]).optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  severity: z.union([z.enum(SEVERITIES), z.array(z.enum(SEVERITIES))]).optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  assigneeId: objectId.optional(),
  environment: z.string().trim().max(60).optional(),
  sort: z.string().max(60).optional(),
});

const createCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comment content is required').max(8000),
  kind: z.enum(['comment', 'note']).optional().default('comment'),
});

const associateDeploymentSchema = z.object({
  deploymentId: objectId,
});

module.exports = {
  createIncidentSchema,
  updateIncidentSchema,
  listIncidentsQuerySchema,
  createCommentSchema,
  associateDeploymentSchema,
};
