'use strict';

const incidentService = require('../services/incidentService');
const correlationService = require('../services/correlationService');
const auditService = require('../services/auditService');
const projectService = require('../services/projectService');
const { ok, created, paginated } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { getPagination } = require('../utils/pagination');
const { assertProjectRole } = require('../middleware/rbac');
const { ROLES } = require('../utils/constants');

/* --------------------------- create & read ------------------------------- */

const createIncident = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectOr404(req.params.id);
  const incident = await incidentService.createIncident(req.user, project, req.validated.body);
  return created(res, incident);
});

const listProjectIncidents = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectOr404(req.params.id);
  const result = await incidentService.listIncidents(req.user, { project }, req.validated.query);
  return paginated(res, result);
});

/** Global incident list - scoped server-side to the user's projects. */
const listAllIncidents = asyncHandler(async (req, res) => {
  const result = await incidentService.listIncidents(req.user, {}, req.validated.query);
  return paginated(res, result);
});

const getIncident = asyncHandler(async (req, res) => {
  const detail = await incidentService.getIncidentDetail(req.user, req.params.id);
  return ok(res, detail);
});

const updateIncident = asyncHandler(async (req, res) => {
  const incident = await incidentService.updateIncident(req.user, req.params.id, req.validated.body);
  return ok(res, incident);
});

const deleteIncident = asyncHandler(async (req, res) => {
  const result = await incidentService.deleteIncident(req.user, req.params.id);
  return ok(res, result);
});

/* ------------------------------ comments ---------------------------------- */

const listUpdates = asyncHandler(async (req, res) => {
  const result = await incidentService.listUpdates(req.user, req.params.id, req.validated.query);
  return paginated(res, result);
});

const addUpdate = asyncHandler(async (req, res) => {
  const update = await incidentService.addUpdate(req.user, req.params.id, req.validated.body);
  return created(res, update);
});

/* ---------------------------- investigation -------------------------------- */

const getCandidates = asyncHandler(async (req, res) => {
  const incident = await incidentService.getIncidentOr404(req.params.id);
  const project = await projectService.getProjectOr404(incident.projectId);
  const result = await correlationService.getCandidatesForIncident(req.user, incident, project);
  return ok(res, result);
});

const associateDeployment = asyncHandler(async (req, res) => {
  const incident = await incidentService.associateDeployment(
    req.user,
    req.params.id,
    req.validated.body.deploymentId
  );
  return ok(res, incident);
});

const dismissDeployment = asyncHandler(async (req, res) => {
  const incident = await incidentService.dismissDeployment(
    req.user,
    req.params.id,
    req.validated.body.deploymentId
  );
  return ok(res, incident);
});

const getAuditLogs = asyncHandler(async (req, res) => {
  const incident = await incidentService.getIncidentOr404(req.params.id);
  const project = await projectService.getProjectOr404(incident.projectId);
  assertProjectRole(req.user, project, ROLES.VIEWER);
  const { page, limit, skip } = getPagination(req.validated.query, {
    defaultLimit: 50,
  });
  const result = await auditService.listForIncident(req.params.id, { skip, limit });
  return paginated(res, { ...result, page, limit });
});

module.exports = {
  createIncident,
  listProjectIncidents,
  listAllIncidents,
  getIncident,
  updateIncident,
  deleteIncident,
  listUpdates,
  addUpdate,
  getCandidates,
  associateDeployment,
  dismissDeployment,
  getAuditLogs,
};
