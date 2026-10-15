'use strict';

const Incident = require('../models/Incident');
const IncidentUpdate = require('../models/IncidentUpdate');
const Deployment = require('../models/Deployment');
const Project = require('../models/Project');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const eventService = require('./eventService');
const projectService = require('./projectService');
const { assertProjectRole, projectRoleOf } = require('../middleware/rbac');
const { getPagination, getSort } = require('../utils/pagination');
const { normalizeSignature } = require('../utils/text');
const { emitToProject } = require('../sockets');
const {
  ROLES,
  INCIDENT_STATUS,
  INCIDENT_STATUSES,
  INCIDENT_TRANSITIONS,
} = require('../utils/constants');

const SORTABLE = ['createdAt', 'updatedAt', 'severity', 'status', 'title', 'resolvedAt'];

const POPULATE = [
  { path: 'assigneeId', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

/** Attach project summary used by the global incidents list. */
async function listIncidents(user, { project } = {}, query) {
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query.sort, SORTABLE, { createdAt: -1 });

  const filter = {};
  if (project) {
    assertProjectRole(user, project, ROLES.VIEWER);
    filter.projectId = project._id;
  } else {
    // Global view: only incidents from projects the user belongs to
    if (user.role !== ROLES.ADMIN) {
      const memberships = await Project.find({ 'members.user': user._id }).select('_id').lean();
      filter.projectId = { $in: memberships.map((m) => m._id) };
    }
  }
  if (query.status?.length) filter.status = { $in: query.status };
  if (query.severity?.length) filter.severity = { $in: query.severity };
  if (query.assigneeId) filter.assigneeId = query.assigneeId;
  if (query.environment) filter.environment = query.environment;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = query.from;
    if (query.to) filter.createdAt.$lte = query.to;
  }
  if (query.q) {
    const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ title: rx }, { description: rx }, { affectedService: rx }];
  }

  const [items, total] = await Promise.all([
    Incident.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate(POPULATE)
      .populate('projectId', 'name slug')
      .lean(),
    Incident.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

async function getIncidentOr404(incidentId) {
  const incident = await Incident.findById(incidentId).populate(POPULATE);
  if (!incident) throw ApiError.notFound('Incident not found');
  return incident;
}

async function getProjectFor(incident) {
  return projectService.getProjectOr404(incident.projectId);
}

/**
 * Create an incident. `createdBy` is the authenticated user; a normalized
 * signature of the title is stored for recurring-issue detection.
 */
async function createIncident(user, project, input) {
  assertProjectRole(user, project, ROLES.DEVELOPER);

  if (input.environment && !project.environments.includes(input.environment)) {
    throw ApiError.validation(
      `Environment "${input.environment}" is not defined on this project`,
      [{ path: 'environment', message: `Allowed: ${project.environments.join(', ')}` }]
    );
  }

  let assigneeId = input.assigneeId || null;
  if (assigneeId === undefined) assigneeId = user._id; // default: reporter owns triage
  validateAssignee(project, assigneeId);

  const incident = await Incident.create({
    projectId: project._id,
    title: input.title,
    description: input.description || '',
    severity: input.severity || 'SEV3',
    environment: input.environment || null,
    affectedService: input.affectedService || null,
    assigneeId,
    createdBy: user._id,
    signature: normalizeSignature(input.title),
    version: 0,
  });

  await auditService.record({
    projectId: project._id,
    incidentId: incident._id,
    actorId: user._id,
    action: 'incident.created',
    after: {
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      environment: incident.environment,
      assigneeId: String(assigneeId || ''),
    },
  });

  await eventService.recordInternalEvent({
    projectId: project._id,
    eventType: 'incident',
    source: 'manual',
    occurredAt: incident.createdAt,
    actor: { userId: user._id, name: user.name },
    payload: { incidentId: String(incident._id), title: incident.title, severity: incident.severity },
    incidentId: incident._id,
  });

  emitToProject(project._id, 'incident:created', {
    incidentId: String(incident._id),
    projectId: String(project._id),
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
  });

  return incident.toJSON();
}

/** Incidents created from ingested external reports (no BuildTrace user). */
async function createIncidentFromEvent({ project, event, data }) {
  const title = data.title || 'Untitled incident (external report)';
  const incident = await Incident.create({
    projectId: project._id,
    title,
    description: data.description || '',
    severity: data.severity || 'SEV3',
    environment: data.environment || null,
    affectedService: data.affectedService || null,
    createdBy: null,
    signature: normalizeSignature(title),
    version: 0,
  });

  await auditService.record({
    projectId: project._id,
    incidentId: incident._id,
    actorId: event.actor?.userId || null,
    action: 'incident.created_from_event',
    after: { title, severity: incident.severity, sourceEvent: String(event._id) },
  });

  emitToProject(project._id, 'incident:created', {
    incidentId: String(incident._id),
    projectId: String(project._id),
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    fromEvent: true,
  });

  return incident;
}

function validateAssignee(project, assigneeId) {
  if (!assigneeId) return;
  const isMember = (project.members || []).some((m) => String(m.user?._id || m.user) === String(assigneeId));
  if (!isMember) {
    throw ApiError.validation('Assignee must be a member of this project', [
      { path: 'assigneeId', message: 'User is not a member of the project' },
    ]);
  }
}

/**
 * Update an incident with optimistic concurrency control.
 *
 * The client must send the `version` it last read. The update is executed as
 * a single conditional findOneAndUpdate on { _id, version }. When the
 * conditional update matches nothing, either the record changed (409 with the
 * current record) or the document vanished (404).
 */
async function updateIncident(user, incidentId, patch) {
  const incident = await getIncidentOr404(incidentId);
  const project = await getProjectFor(incident);
  assertProjectRole(user, project, ROLES.DEVELOPER);

  const before = snapshot(incident);

  // --- Validate the requested change against the current state first -----
  const changes = { ...patch };
  delete changes.version;
  const now = new Date();

  if (changes.status !== undefined && changes.status !== incident.status) {
    const allowed = INCIDENT_TRANSITIONS[incident.status] || [];
    if (!allowed.includes(changes.status)) {
      throw ApiError.validation(
        `Invalid status transition: ${incident.status} -> ${changes.status}. Allowed: ${allowed.join(', ')}`,
        [{ path: 'status', message: `Allowed transitions from "${incident.status}": ${allowed.join(', ')}` }]
      );
    }
    const effectiveResolution = changes.resolution !== undefined ? changes.resolution : incident.resolution;
    if (changes.status === INCIDENT_STATUS.RESOLVED && !(effectiveResolution && effectiveResolution.trim())) {
      throw ApiError.validation('A resolution text is required to resolve an incident', [
        { path: 'resolution', message: 'Provide a resolution before resolving' },
      ]);
    }
    if (changes.status === INCIDENT_STATUS.RESOLVED) changes.resolvedAt = now;
    if (changes.status === INCIDENT_STATUS.OPEN && incident.status === INCIDENT_STATUS.RESOLVED) {
      changes.resolvedAt = null;
    }
  }

  if (changes.assigneeId !== undefined) {
    validateAssignee(project, changes.assigneeId);
  }
  if (changes.environment !== undefined && changes.environment !== null
      && !project.environments.includes(changes.environment)) {
    throw ApiError.validation(
      `Environment "${changes.environment}" is not defined on this project`,
      [{ path: 'environment', message: `Allowed: ${project.environments.join(', ')}` }]
    );
  }
  if (changes.title !== undefined) changes.signature = normalizeSignature(changes.title);

  // --- Conditional update: fails atomically when the version is stale ----
  const updated = await Incident.findOneAndUpdate(
    { _id: incidentId, version: patch.version },
    { $set: changes, $inc: { version: 1 } },
    { returnDocument: 'after', runValidators: true }
  )
    .populate(POPULATE);

  if (!updated) {
    const current = await Incident.findById(incidentId).populate(POPULATE).lean();
    if (!current) throw ApiError.notFound('Incident not found');
    throw ApiError.conflict(
      `This incident was modified by someone else (submitted version ${patch.version}, current version ${current.version}). Refresh and re-apply your change.`,
      { currentVersion: current.version, submittedVersion: patch.version }
    );
  }

  await recordChanges(user, project, incident, updated, changes, before);

  emitToProject(project._id, 'incident:updated', {
    incidentId: String(updated._id),
    projectId: String(project._id),
    version: updated.version,
    status: updated.status,
    severity: updated.severity,
    title: updated.title,
  });

  return updated.toJSON();
}

function snapshot(incident) {
  return {
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    status: incident.status,
    assigneeId: incident.assigneeId ? String(incident.assigneeId._id || incident.assigneeId) : null,
    environment: incident.environment,
    affectedService: incident.affectedService,
    rootCause: incident.rootCause,
    resolution: incident.resolution,
  };
}

/**
 * Write the audit trail and the human-readable incident timeline entries for
 * everything that changed. Comments and audit records live in separate
 * collections from the incident's current state.
 */
async function recordChanges(user, project, oldIncident, updated, changes, before) {
  const after = snapshot(updated);
  const changedFields = Object.keys(changes).filter((k) => k !== 'signature' && k !== 'resolvedAt');

  await auditService.record({
    projectId: project._id,
    incidentId: updated._id,
    actorId: user._id,
    action: 'incident.updated',
    before,
    after,
  });

  if (changes.status && changes.status !== oldIncident.status) {
    await IncidentUpdate.create({
      incidentId: updated._id,
      authorId: user._id,
      kind: 'status_change',
      content: `Status changed from ${oldIncident.status} to ${changes.status}${changes.resolution ? `\n\nResolution: ${changes.resolution}` : ''}`,
    });
  }
  if (changes.rootCause && changes.rootCause !== oldIncident.rootCause) {
    await IncidentUpdate.create({
      incidentId: updated._id,
      authorId: user._id,
      kind: 'note',
      content: `Root cause recorded:\n\n${changes.rootCause}`,
    });
  }
  const statusChangeOnly = changedFields.length === 1 && changedFields[0] === 'status';
  if (changedFields.length > 0 && !statusChangeOnly) {
    const diffLines = changedFields
      .map((f) => {
        const from = before[f] === null || before[f] === undefined ? '-' : String(before[f]).slice(0, 200);
        const to = after[f] === null || after[f] === undefined ? '-' : String(after[f]).slice(0, 200);
        return `${f}: ${from} -> ${to}`;
      })
      .join('\n');
    await IncidentUpdate.create({
      incidentId: updated._id,
      authorId: user._id,
      kind: 'note',
      content: `Incident updated:\n\n${diffLines}`,
    });
  }

  await eventService.recordInternalEvent({
    projectId: project._id,
    eventType: 'incident_update',
    source: 'system',
    occurredAt: new Date(),
    actor: { userId: user._id, name: user.name },
    payload: {
      incidentId: String(updated._id),
      changed: changedFields,
      status: updated.status,
    },
    incidentId: updated._id,
  });
}

/* ------------------------------ comments -------------------------------- */

async function listUpdates(user, incidentId, query) {
  const incident = await getIncidentOr404(incidentId);
  const project = await getProjectFor(incident);
  assertProjectRole(user, project, ROLES.VIEWER);

  const { page, limit, skip } = getPagination(query, { defaultLimit: 50 });
  const [items, total] = await Promise.all([
    IncidentUpdate.find({ incidentId })
      .sort({ createdAt: 1, _id: 1 }) // conversation order, stable for same timestamps
      .skip(skip)
      .limit(limit)
      .populate('authorId', 'name email')
      .lean(),
    IncidentUpdate.countDocuments({ incidentId }),
  ]);
  return { items, page, limit, total };
}

async function addUpdate(user, incidentId, { content, kind }) {
  const incident = await getIncidentOr404(incidentId);
  const project = await getProjectFor(incident);
  assertProjectRole(user, project, ROLES.DEVELOPER);

  const update = await IncidentUpdate.create({
    incidentId: incident._id,
    authorId: user._id,
    kind: kind || 'comment',
    content,
  });

  await auditService.record({
    projectId: project._id,
    incidentId: incident._id,
    actorId: user._id,
    action: 'incident.comment_added',
    after: { commentId: String(update._id) },
  });

  await eventService.recordInternalEvent({
    projectId: project._id,
    eventType: 'comment',
    source: 'manual',
    occurredAt: new Date(),
    actor: { userId: user._id, name: user.name },
    payload: { incidentId: String(incident._id), excerpt: content.slice(0, 160) },
    incidentId: incident._id,
  });

  emitToProject(project._id, 'comment:added', {
    incidentId: String(incident._id),
    projectId: String(project._id),
    commentId: String(update._id),
    author: user.name,
  });

  return (await update.populate('authorId', 'name email')).toJSON();
}

/* --------------------- deployment association ---------------------------- */

/**
 * Associate a candidate deployment with an incident.
 * Association is an investigator-confirmed LINK, not a claim of root cause -
 * the root cause remains an explicit, separate field.
 */
async function associateDeployment(user, incidentId, deploymentId) {
  const incident = await getIncidentOr404(incidentId);
  const project = await getProjectFor(incident);
  assertProjectRole(user, project, ROLES.DEVELOPER);

  const deployment = await Deployment.findOne({ _id: deploymentId, projectId: project._id });
  if (!deployment) throw ApiError.notFound('Deployment not found in this project');

  const already = (incident.deploymentIds || []).some((d) => String(d) === String(deploymentId));
  if (already) throw ApiError.conflict('This deployment is already associated with the incident');

  const updated = await Incident.findOneAndUpdate(
    { _id: incidentId, version: incident.version },
    {
      $addToSet: { deploymentIds: deployment._id },
      $pull: { dismissedDeploymentIds: deployment._id },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  ).populate(POPULATE);
  if (!updated) throw staleError(incident);

  await auditService.record({
    projectId: project._id,
    incidentId: incident._id,
    actorId: user._id,
    action: 'incident.deployment_associated',
    after: { deploymentId: String(deployment._id), version: deployment.version },
  });

  await IncidentUpdate.create({
    incidentId: incident._id,
    authorId: user._id,
    kind: 'note',
    content: `Deployment ${deployment.version} (${deployment.environment}) associated as a suspected contributor - not a confirmed root cause.`,
  });

  emitToProject(project._id, 'incident:updated', {
    incidentId: String(incident._id),
    projectId: String(project._id),
    version: updated.version,
  });

  return updated.toJSON();
}

/** Dismiss a candidate deployment so it is excluded from future results. */
async function dismissDeployment(user, incidentId, deploymentId) {
  const incident = await getIncidentOrThrow(incidentId);
  const project = await getProjectFor(incident);
  assertProjectRole(user, project, ROLES.DEVELOPER);

  const deployment = await Deployment.findOne({ _id: deploymentId, projectId: project._id });
  if (!deployment) throw ApiError.notFound('Deployment not found in this project');

  const updated = await Incident.findOneAndUpdate(
    { _id: incidentId, version: incident.version },
    {
      $addToSet: { dismissedDeploymentIds: deployment._id },
      $pull: { deploymentIds: deployment._id },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  ).populate(POPULATE);
  if (!updated) throw staleError(incident);

  await auditService.record({
    projectId: project._id,
    incidentId: incident._id,
    actorId: user._id,
    action: 'incident.deployment_dismissed',
    after: { deploymentId: String(deployment._id) },
  });

  return updated.toJSON();
}

function staleError(incident) {
  return ApiError.conflict(
    `This incident was modified by someone else (current version ${incident.version}). Refresh and retry.`,
    { currentVersion: incident.version }
  );
}

async function getIncidentOrThrow(incidentId) {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw ApiError.notFound('Incident not found');
  return incident;
}

/** Full investigation payload: incident + associated deployments + counts. */
async function getIncidentDetail(user, incidentId) {
  const incident = await getIncidentOr404(incidentId);
  const project = await getProjectFor(incident);
  const role = projectRoleOf(user, project);
  if (!role) throw ApiError.forbidden('You are not a member of this project');

  const [associatedDeployments, commentCount] = await Promise.all([
    Deployment.find({ _id: { $in: incident.deploymentIds } })
      .sort({ occurredAt: -1 })
      .lean(),
    IncidentUpdate.countDocuments({ incidentId: incident._id }),
  ]);

  return {
    ...incident.toJSON(),
    project: { id: String(project._id), name: project.name, slug: project.slug, environments: project.environments },
    yourProjectRole: role,
    associatedDeployments,
    commentCount,
  };
}

/** Authorized hard delete (project admin only). */
async function deleteIncident(user, incidentId) {
  const incident = await getIncidentOrThrow(incidentId);
  const project = await getProjectFor(incident);
  assertProjectRole(user, project, ROLES.ADMIN);

  await Promise.all([
    IncidentUpdate.deleteMany({ incidentId }),
    Incident.deleteOne({ _id: incidentId }),
  ]);

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'incident.deleted',
    before: { title: incident.title, severity: incident.severity, status: incident.status },
  });

  emitToProject(project._id, 'incident:deleted', {
    incidentId: String(incidentId),
    projectId: String(project._id),
  });

  return { deleted: true };
}

module.exports = {
  listIncidents,
  getIncidentOr404,
  getIncidentDetail,
  createIncident,
  createIncidentFromEvent,
  updateIncident,
  listUpdates,
  addUpdate,
  associateDeployment,
  dismissDeployment,
  deleteIncident,
  INCIDENT_STATUSES,
};
