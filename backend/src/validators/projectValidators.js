'use strict';

const { z } = require('./common');
const { ROLES_LIST } = require('../utils/constants');

const environmentName = z.string().trim().min(1).max(60);

const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(140),
  description: z.string().trim().max(2000).optional().default(''),
  repositoryUrl: z.union([z.url('repositoryUrl must be a valid URL'), z.literal('')]).optional().default(''),
  environments: z.array(environmentName).min(1, 'At least one environment is required').max(20).optional(),
  members: z
    .array(
      z.object({
        email: z.email('Member email must be valid').toLowerCase(),
        role: z.enum(ROLES_LIST).optional().default('developer'),
      })
    )
    .max(50)
    .optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(140).optional(),
    description: z.string().trim().max(2000).optional(),
    repositoryUrl: z.union([z.url('repositoryUrl must be a valid URL'), z.literal('')]).optional(),
    environments: z.array(environmentName).min(1).max(20).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'No updatable fields were provided',
  });

const listProjectsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().max(60).optional(),
});

const addMemberSchema = z.object({
  email: z.email('Member email must be valid').toLowerCase(),
  role: z.enum(ROLES_LIST).default('developer'),
});

const updateMemberSchema = z.object({
  role: z.enum(ROLES_LIST),
});

module.exports = {
  createProjectSchema,
  updateProjectSchema,
  listProjectsQuerySchema,
  addMemberSchema,
  updateMemberSchema,
  environmentName,
};
