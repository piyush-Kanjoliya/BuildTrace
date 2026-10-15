'use strict';

const projectService = require('../services/projectService');
const dashboardService = require('../services/dashboardService');
const timelineService = require('../services/timelineService');
const { ok, created, paginated } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { getProjectOr404 } = projectService;

const createProject = asyncHandler(async (req, res) => {
  const result = await projectService.createProject(req.user, req.validated.body);
  return created(res, result);
});

const listProjects = asyncHandler(async (req, res) => {
  const result = await projectService.listProjects(req.user, req.validated.query);
  return paginated(res, result);
});

const getProject = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectForUser(req.user, req.params.id);
  return ok(res, project);
});

const updateProject = asyncHandler(async (req, res) => {
  const project = await projectService.updateProject(req.user, req.params.id, req.validated.body);
  return ok(res, project);
});

const deleteProject = asyncHandler(async (req, res) => {
  const result = await projectService.deleteProject(req.user, req.params.id);
  return ok(res, result);
});

/* ------------------------------- members -------------------------------- */

const addMember = asyncHandler(async (req, res) => {
  const project = await projectService.addMember(req.user, req.params.id, req.validated.body);
  return created(res, project);
});

const updateMember = asyncHandler(async (req, res) => {
  const project = await projectService.updateMember(
    req.user,
    req.params.id,
    req.params.memberId,
    req.validated.body
  );
  return ok(res, project);
});

const removeMember = asyncHandler(async (req, res) => {
  const project = await projectService.removeMember(req.user, req.params.id, req.params.memberId);
  return ok(res, project);
});

/* ---------------------------- integrations ------------------------------- */

const integrationStatus = asyncHandler(async (req, res) => {
  const status = await projectService.getIntegrationStatus(req.user, req.params.id);
  return ok(res, status);
});

const rotateWebhookSecret = asyncHandler(async (req, res) => {
  const result = await projectService.rotateWebhookSecret(req.user, req.params.id);
  return ok(res, result);
});

const clearWebhookSecret = asyncHandler(async (req, res) => {
  const result = await projectService.clearWebhookSecret(req.user, req.params.id);
  return ok(res, result);
});

const rotateIngestKey = asyncHandler(async (req, res) => {
  const result = await projectService.rotateIngestKey(req.user, req.params.id);
  return ok(res, result);
});

/* ------------------------ project-scoped analytics ------------------------ */

const getDashboard = asyncHandler(async (req, res) => {
  const project = await getProjectOr404(req.params.id);
  const data = await dashboardService.getDashboard(req.user, project);
  return ok(res, data);
});

const getTimeline = asyncHandler(async (req, res) => {
  const project = await getProjectOr404(req.params.id);
  const result = await timelineService.getTimeline(req.user, project, req.validated.query);
  return ok(res, result);
});

module.exports = {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  addMember,
  updateMember,
  removeMember,
  integrationStatus,
  rotateWebhookSecret,
  clearWebhookSecret,
  rotateIngestKey,
  getDashboard,
  getTimeline,
};
