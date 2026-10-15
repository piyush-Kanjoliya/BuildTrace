'use strict';

const { z, objectId, paginationQuery, dateRangeQuery } = require('./common');
const { DEPLOYMENT_STATUSES } = require('../utils/constants');

const createDeploymentSchema = z.object({
  version: z.string().trim().max(120).optional(),
  commitSha: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{7,64}$/, 'commitSha must be a 7-64 character hex string')
    .toLowerCase()
    .optional()
    .nullable(),
  environment: z.string().trim().min(1, 'Environment is required').max(60),
  status: z.enum(DEPLOYMENT_STATUSES).optional(),
  occurredAt: z.coerce.date().optional(),
  service: z.string().trim().max(120).optional().nullable(),
  commitMessage: z.string().trim().max(2000).optional().nullable(),
  changedFiles: z.array(z.string().trim().max(400)).max(500).optional(),
  url: z.string().trim().max(500).optional().nullable(),
});

const updateDeploymentSchema = z
  .object({
    status: z.enum(DEPLOYMENT_STATUSES).optional(),
    version: z.string().trim().max(120).optional(),
    commitMessage: z.string().trim().max(2000).optional().nullable(),
    changedFiles: z.array(z.string().trim().max(400)).max(500).optional(),
    url: z.string().trim().max(500).optional().nullable(),
    service: z.string().trim().max(120).optional().nullable(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'No updatable fields were provided',
  });

const listDeploymentsQuerySchema = z.object({
  ...paginationQuery,
  ...dateRangeQuery,
  projectId: objectId.optional(),
  status: z.union([z.enum(DEPLOYMENT_STATUSES), z.array(z.enum(DEPLOYMENT_STATUSES))]).optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  environment: z.string().trim().max(60).optional(),
  author: z.string().trim().max(140).optional(),
  source: z.string().trim().max(30).optional(),
  sort: z.string().max(60).optional(),
});

module.exports = { createDeploymentSchema, updateDeploymentSchema, listDeploymentsQuerySchema };
