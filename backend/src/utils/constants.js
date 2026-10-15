'use strict';

/**
 * Single source of truth for allowed enum values.
 * Every write path validates against these lists.
 */
const DEPLOYMENT_STATUS = Object.freeze({
  SUCCESS: 'success',
  FAILED: 'failed',
  IN_PROGRESS: 'in_progress',
  ROLLED_BACK: 'rolled_back',
  CANCELLED: 'cancelled',
});

const DEPLOYMENT_STATUSES = Object.freeze(Object.values(DEPLOYMENT_STATUS));

const SEVERITY = Object.freeze({
  SEV1: 'SEV1',
  SEV2: 'SEV2',
  SEV3: 'SEV3',
  SEV4: 'SEV4',
});

const SEVERITIES = Object.freeze(Object.values(SEVERITY));

const SEVERITY_LABELS = Object.freeze({
  SEV1: 'Critical',
  SEV2: 'High',
  SEV3: 'Medium',
  SEV4: 'Low',
});

const INCIDENT_STATUS = Object.freeze({
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  MONITORING: 'monitoring',
  RESOLVED: 'resolved',
});

const INCIDENT_STATUSES = Object.freeze(Object.values(INCIDENT_STATUS));

/**
 * Allowed incident status transitions.
 * Resolving requires a resolution text (enforced in incidentService).
 */
const INCIDENT_TRANSITIONS = Object.freeze({
  open: ['investigating', 'monitoring', 'resolved'],
  investigating: ['monitoring', 'resolved', 'open'],
  monitoring: ['resolved', 'investigating', 'open'],
  resolved: ['open'],
});

const ROLES = Object.freeze({
  ADMIN: 'admin',
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
});

const ROLES_LIST = Object.freeze(Object.values(ROLES));

// Role hierarchy: a role satisfies any level at or below it
const ROLE_LEVEL = Object.freeze({ viewer: 1, developer: 2, admin: 3 });

const EVENT_TYPES = Object.freeze([
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
]);

const EVENT_SOURCES = Object.freeze(['manual', 'api', 'github', 'system', 'seed']);

const DEFAULT_ENVIRONMENTS = Object.freeze(['production', 'staging', 'development']);

module.exports = {
  DEPLOYMENT_STATUS,
  DEPLOYMENT_STATUSES,
  SEVERITY,
  SEVERITIES,
  SEVERITY_LABELS,
  INCIDENT_STATUS,
  INCIDENT_STATUSES,
  INCIDENT_TRANSITIONS,
  ROLES,
  ROLES_LIST,
  ROLE_LEVEL,
  EVENT_TYPES,
  EVENT_SOURCES,
  DEFAULT_ENVIRONMENTS,
};
