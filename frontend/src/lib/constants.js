/** Client-side mirrors of backend enums + presentation metadata. */

export const ROLES = { ADMIN: 'admin', DEVELOPER: 'developer', VIEWER: 'viewer' };

export const ROLE_META = {
  admin: { label: 'Admin', tone: 'primary' },
  developer: { label: 'Developer', tone: 'accent' },
  viewer: { label: 'Viewer', tone: 'neutral' },
};

/** Incident lifecycle (mirrors backend INCIDENT_TRANSITIONS). */
export const INCIDENT_STATUS_META = {
  open: { label: 'Open', tone: 'danger' },
  investigating: { label: 'Investigating', tone: 'warning' },
  monitoring: { label: 'Monitoring', tone: 'accent' },
  resolved: { label: 'Resolved', tone: 'success' },
};

export const INCIDENT_TRANSITIONS = {
  open: ['investigating', 'monitoring', 'resolved'],
  investigating: ['monitoring', 'resolved', 'open'],
  monitoring: ['resolved', 'investigating', 'open'],
  resolved: ['open'],
};

export const SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

export const SEVERITY_META = {
  SEV1: { label: 'SEV1', description: 'Critical', tone: 'sev1' },
  SEV2: { label: 'SEV2', description: 'High', tone: 'sev2' },
  SEV3: { label: 'SEV3', description: 'Medium', tone: 'sev3' },
  SEV4: { label: 'SEV4', description: 'Low', tone: 'sev4' },
};

export const DEPLOYMENT_STATUS_META = {
  success: { label: 'Success', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'accent' },
  rolled_back: { label: 'Rolled back', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const DEPLOYMENT_STATUSES = Object.keys(DEPLOYMENT_STATUS_META);

export const EVENT_TYPE_LABEL = {
  deployment: 'Deployment',
  deployment_status: 'Deployment status',
  rollback: 'Rollback',
  commit: 'Commit',
  incident: 'Incident',
  incident_update: 'Incident update',
  comment: 'Comment',
  investigation: 'Investigation',
  config_change: 'Config change',
  other: 'Event',
};

/** Available chart palette (accessible on the dark canvas). */
export const CHART_COLORS = {
  primary: '#8b5cf6',
  accent: '#22d3ee',
  success: '#34d399',
  danger: '#f87171',
  warning: '#fbbf24',
};
