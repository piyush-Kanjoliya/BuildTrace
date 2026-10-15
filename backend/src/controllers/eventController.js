'use strict';

const eventService = require('../services/eventService');
const projectService = require('../services/projectService');
const dashboardService = require('../services/dashboardService');
const ApiError = require('../utils/ApiError');
const { ok, accepted } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { assertProjectRole } = require('../middleware/rbac');
const { ROLES } = require('../utils/constants');

/**
 * Ingest a domain event.
 *
 * Contract:
 *  - Authenticated with a Bearer JWT (project DEVELOPER+) or a project-scoped
 *    X-Ingest-Key. See ingestAuth.
 *  - 202 Accepted when the event is persisted (processing is asynchronous to
 *    the acceptance; the response carries the processing outcome).
 *  - duplicate=true with the ORIGINAL event when a duplicate delivery arrives.
 *  - A late occurredAt never causes rejection - it is preserved and flagged.
 */
const ingestEvent = asyncHandler(async (req, res) => {
  const projectId = req.validated.body.projectId;
  let project;
  let actor = null;

  if (req.user) {
    // JWT path: the authenticated user must be a DEVELOPER+ on the target project.
    project = await projectService.getProjectOr404(projectId);
    assertProjectRole(req.user, project, ROLES.DEVELOPER);
    actor = req.user;
  } else if (req.ingestProject) {
    // Ingest-key path: the key is scoped to exactly its own project.
    if (String(req.ingestProject._id) !== String(projectId)) {
      throw ApiError.forbidden('This ingest key is not valid for the specified project');
    }
    project = req.ingestProject;
  } else {
    throw ApiError.unauthorized();
  }

  const result = await eventService.ingestEvent({
    project,
    input: req.validated.body,
    actor,
  });

  return accepted(res, {
    duplicate: result.duplicate,
    reprocessed: Boolean(result.reprocessed),
    event: result.event,
    deploymentId: result.deploymentId || null,
    incidentId: result.incidentId || null,
    processingStatus: result.event?.processingStatus || null,
    failed: Boolean(result.failed),
    error: result.error || null,
  });
});

const retryEvent = asyncHandler(async (req, res) => {
  const result = await eventService.retryEvent(req.user, req.params.id);
  return ok(res, {
    event: result.event,
    failed: Boolean(result.failed),
    error: result.error || null,
  });
});

const listProjectEvents = asyncHandler(async (req, res) => {
  const project = await projectService.getProjectOr404(req.params.id);
  const result = await eventService.listEvents(req.user, project, req.validated.query);
  return ok(res, result);
});

/** Global or project-scoped dashboard. */
const getDashboard = asyncHandler(async (req, res) => {
  const projectId = req.validated.query.projectId;
  let project = null;
  if (projectId) project = await projectService.getProjectOr404(projectId);
  const data = await dashboardService.getDashboard(req.user, project);
  return ok(res, data);
});

module.exports = { ingestEvent, retryEvent, listProjectEvents, getDashboard };
