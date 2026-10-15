'use strict';

const deploymentService = require('../services/deploymentService');
const projectService = require('../services/projectService');
const { ok, created, paginated } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const createDeployment = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectOr404(req.params.id);
  const deployment = await deploymentService.createDeployment(req.user, project, req.validated.body);
  return created(res, deployment);
});

const listProjectDeployments = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectOr404(req.params.id);
  const result = await deploymentService.listDeployments(req.user, project, req.validated.query);
  return paginated(res, result);
});

const getDeployment = asyncHandler(async (req, res) => {
  const result = await deploymentService.getDeploymentForUser(req.user, req.params.id);
  return ok(res, result);
});

const updateDeployment = asyncHandler(async (req, res) => {
  const deployment = await deploymentService.updateDeployment(req.user, req.params.id, req.validated.body);
  return ok(res, deployment);
});

module.exports = {
  createDeployment,
  listProjectDeployments,
  getDeployment,
  updateDeployment,
};
