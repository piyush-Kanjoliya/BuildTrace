'use strict';

const Project = require('../models/Project');
const User = require('../models/User');
const Deployment = require('../models/Deployment');
const Incident = require('../models/Incident');
const IncidentUpdate = require('../models/IncidentUpdate');
const Event = require('../models/Event');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const auditService = require('./auditService');
const { assertProjectRole, isProjectMember } = require('../middleware/rbac');
const { getPagination, getSort } = require('../utils/pagination');
const { ROLES, INCIDENT_STATUS } = require('../utils/constants');
const { generateSecret, sha256 } = require('../utils/security');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

async function uniqueSlug(base) {
  let slug = base;
  for (let i = 0; i < 50; i += 1) {
    const exists = await Project.exists({ slug });
    if (!exists) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw ApiError.conflict('Could not generate a unique project slug');
}

/**
 * Create a project. The creator becomes a project admin.
 * Optional initial members are added by email; unknown emails are reported
 * back (not silently ignored).
 */
async function createProject(user, input) {
  const slug = await uniqueSlug(slugify(input.name));
  const members = [{ user: user._id, role: ROLES.ADMIN, addedAt: new Date() }];
  const skippedMembers = [];

  for (const m of input.members || []) {
    const memberUser = await User.findOne({ email: m.email });
    if (!memberUser) {
      skippedMembers.push({ email: m.email, reason: 'No account with this email' });
      continue;
    }
    if (String(memberUser._id) === String(user._id)) continue;
    members.push({ user: memberUser._id, role: m.role || ROLES.DEVELOPER, addedAt: new Date() });
  }

  const project = await Project.create({
    name: input.name,
    slug,
    description: input.description || '',
    repositoryUrl: input.repositoryUrl || '',
    environments: input.environments && input.environments.length ? input.environments : undefined,
    createdBy: user._id,
    members,
  });

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'project.created',
    after: { name: project.name, slug: project.slug, environments: project.environments },
  });

  return { project: await hydrate(project), skippedMembers };
}

async function hydrate(project) {
  const doc = typeof project.toObject === 'function' ? project : project;
  const populated = await Project.findById(doc._id)
    .populate('members.user', 'name email role')
    .populate('createdBy', 'name email');
  return populated.toJSON();
}

/**
 * List projects the user can see: memberships (any role) or everything for a
 * global admin. Search and pagination supported.
 */
async function listProjects(user, query) {
  const { page, limit, skip } = getPagination(query);
  const sort = getSort(query.sort, ['createdAt', 'updatedAt', 'name'], { createdAt: -1 });

  const filter = {};
  if (user.role !== ROLES.ADMIN) filter['members.user'] = user._id;
  if (query.q) {
    const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ name: rx }, { slug: rx }, { description: rx }];
  }

  const [items, total] = await Promise.all([
    Project.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('members.user', 'name email')
      .lean(),
    Project.countDocuments(filter),
  ]);

  // Attach a small summary per project for the list view
  const ids = items.map((p) => p._id);
  const [openCounts, deployCounts] = await Promise.all([
    Incident.aggregate([
      { $match: { projectId: { $in: ids }, status: { $ne: INCIDENT_STATUS.RESOLVED } } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]),
    Deployment.aggregate([
      { $match: { projectId: { $in: ids } } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]),
  ]);
  const openMap = Object.fromEntries(openCounts.map((r) => [String(r._id), r.count]));
  const depMap = Object.fromEntries(deployCounts.map((r) => [String(r._id), r.count]));

  const enriched = items.map((p) => ({
    ...p,
    memberCount: (p.members || []).length,
    summary: { openIncidents: openMap[String(p._id)] || 0, deployments: depMap[String(p._id)] || 0 },
  }));

  return { items: enriched, page, limit, total };
}

async function getProjectOr404(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw ApiError.notFound('Project not found');
  return project;
}

/** Access check: any membership role (viewer and above) can read. */
function assertCanRead(user, project) {
  assertProjectRole(user, project, ROLES.VIEWER);
}

async function getProjectForUser(user, projectId) {
  const project = await getProjectOr404(projectId);
  assertCanRead(user, project);
  const populated = await hydrate(project);

  const [openIncidents, totalDeployments, lastDeployment] = await Promise.all([
    Incident.countDocuments({ projectId, status: { $ne: INCIDENT_STATUS.RESOLVED } }),
    Deployment.countDocuments({ projectId }),
    Deployment.findOne({ projectId }).sort({ occurredAt: -1 }).lean(),
  ]);

  return {
    ...populated,
    summary: {
      openIncidents,
      totalDeployments,
      lastDeployedAt: lastDeployment ? lastDeployment.occurredAt : null,
      memberCount: (populated.members || []).length,
    },
  };
}

async function updateProject(user, projectId, patch) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const before = {
    name: project.name,
    description: project.description,
    repositoryUrl: project.repositoryUrl,
    environments: [...project.environments],
  };
  if (patch.name !== undefined) project.name = patch.name;
  if (patch.description !== undefined) project.description = patch.description;
  if (patch.repositoryUrl !== undefined) project.repositoryUrl = patch.repositoryUrl;
  if (patch.environments !== undefined) project.environments = patch.environments;
  await project.save();

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'project.updated',
    before,
    after: {
      name: project.name,
      description: project.description,
      repositoryUrl: project.repositoryUrl,
      environments: [...project.environments],
    },
  });

  return hydrate(project);
}

/**
 * Delete a project and cascade its dependent data.
 * Only project admins (or global admins) may delete; the operation removes
 * deployments, incidents + their updates, events and audit logs.
 */
async function deleteProject(user, projectId) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const incidentIds = (await Incident.find({ projectId }).select('_id').lean()).map((i) => i._id);

  const results = await Promise.all([
    Deployment.deleteMany({ projectId }),
    Incident.deleteMany({ projectId }),
    IncidentUpdate.deleteMany({ incidentId: { $in: incidentIds } }),
    Event.deleteMany({ projectId }),
    AuditLog.deleteMany({ projectId }),
  ]);
  await Project.deleteOne({ _id: projectId });

  return {
    deleted: {
      project: 1,
      deployments: results[0].deletedCount,
      incidents: results[1].deletedCount,
      incidentUpdates: results[2].deletedCount,
      events: results[3].deletedCount,
      auditLogs: results[4].deletedCount,
    },
  };
}

/* ------------------------------- members -------------------------------- */

async function addMember(user, projectId, { email, role }) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const memberUser = await User.findOne({ email });
  if (!memberUser) throw ApiError.notFound(`No user account found for ${email}`);
  if ((project.members || []).some((m) => String(m.user) === String(memberUser._id))) {
    throw ApiError.conflict(`${email} is already a member of this project`);
  }

  project.members.push({ user: memberUser._id, role, addedAt: new Date() });
  await project.save();

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'project.member_added',
    after: { member: memberUser.email, role },
  });

  return hydrate(project);
}

async function updateMember(user, projectId, memberUserId, { role }) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const membership = (project.members || []).find((m) => String(m.user) === String(memberUserId));
  if (!membership) throw ApiError.notFound('Member not found on this project');

  // Never allow the last admin to be demoted (would orphan the project)
  const adminCount = project.members.filter((m) => m.role === ROLES.ADMIN).length;
  if (membership.role === ROLES.ADMIN && role !== ROLES.ADMIN && adminCount <= 1) {
    throw ApiError.conflict('Cannot demote the last project admin. Promote another member first.');
  }

  const beforeRole = membership.role;
  membership.role = role;
  await project.save();

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'project.member_role_changed',
    before: { memberId: String(memberUserId), role: beforeRole },
    after: { memberId: String(memberUserId), role },
  });

  return hydrate(project);
}

async function removeMember(user, projectId, memberUserId) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const membership = (project.members || []).find((m) => String(m.user) === String(memberUserId));
  if (!membership) throw ApiError.notFound('Member not found on this project');

  const adminCount = project.members.filter((m) => m.role === ROLES.ADMIN).length;
  if (membership.role === ROLES.ADMIN && adminCount <= 1) {
    throw ApiError.conflict('Cannot remove the last project admin');
  }

  project.members = project.members.filter((m) => String(m.user) !== String(memberUserId));
  await project.save();

  await auditService.record({
    projectId: project._id,
    actorId: user._id,
    action: 'project.member_removed',
    before: { memberId: String(memberUserId), role: membership.role },
  });

  return hydrate(project);
}

/* --------------------------- integrations -------------------------------- */

/** Current webhook/integration status - never returns the secret itself. */
async function getIntegrationStatus(user, projectId) {
  const project = await getProjectOr404(projectId);
  assertCanRead(user, project);
  const withSecrets = await Project.findById(projectId).select('+githubWebhookSecret +ingestKeyHash');
  return {
    repositoryUrl: project.repositoryUrl,
    webhookConfigured: Boolean(withSecrets.githubWebhookSecret),
    ingestKeyConfigured: Boolean(withSecrets.ingestKeyHash),
    ingestKeyLast4: project.ingestKeyLast4,
    webhookPath: `/api/v1/webhooks/github`,
    eventsUrl: `/api/v1/events`,
  };
}

/** Rotate the GitHub webhook secret. Returns the new secret exactly once. */
async function rotateWebhookSecret(user, projectId) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const secret = generateSecret('btwh');
  await Project.updateOne({ _id: projectId }, { $set: { githubWebhookSecret: secret } });

  await auditService.record({
    projectId,
    actorId: user._id,
    action: 'project.webhook_secret_rotated',
    after: { configured: true },
  });

  return { secret, note: 'Store this secret now. It cannot be retrieved again.' };
}

async function clearWebhookSecret(user, projectId) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);
  await Project.updateOne({ _id: projectId }, { $set: { githubWebhookSecret: null } });
  await auditService.record({ projectId, actorId: user._id, action: 'project.webhook_secret_cleared' });
  return { webhookConfigured: false };
}

/** Rotate an ingest key (hashed at rest) for automation that cannot use JWTs. */
async function rotateIngestKey(user, projectId) {
  const project = await getProjectOr404(projectId);
  assertProjectRole(user, project, ROLES.ADMIN);

  const key = generateSecret('btin');
  await Project.updateOne(
    { _id: projectId },
    { $set: { ingestKeyHash: sha256(key), ingestKeyLast4: key.slice(-4) } }
  );
  await auditService.record({
    projectId,
    actorId: user._id,
    action: 'project.ingest_key_rotated',
    after: { last4: key.slice(-4) },
  });
  return { key, note: 'Store this key now. It cannot be retrieved again.' };
}

module.exports = {
  createProject,
  listProjects,
  getProjectOr404,
  getProjectForUser,
  updateProject,
  deleteProject,
  addMember,
  updateMember,
  removeMember,
  getIntegrationStatus,
  rotateWebhookSecret,
  clearWebhookSecret,
  rotateIngestKey,
  isProjectMember,
};
