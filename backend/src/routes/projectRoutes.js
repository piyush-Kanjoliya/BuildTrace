'use strict';

const { Router } = require('express');
const projectController = require('../controllers/projectController');
const deploymentController = require('../controllers/deploymentController');
const incidentController = require('../controllers/incidentController');
const eventController = require('../controllers/eventController');
const { validate, validateObjectIds } = require('../middleware/validate');
const {
  createProjectSchema,
  updateProjectSchema,
  listProjectsQuerySchema,
  addMemberSchema,
  updateMemberSchema,
} = require('../validators/projectValidators');
const { createDeploymentSchema, listDeploymentsQuerySchema } = require('../validators/deploymentValidators');
const { createIncidentSchema, listIncidentsQuerySchema } = require('../validators/incidentValidators');
const { listEventsQuerySchema } = require('../validators/eventValidators');

const router = Router();

/* ------------------------------- projects -------------------------------- */

router.post('/', validate({ body: createProjectSchema }), projectController.createProject);
router.get('/', validate({ query: listProjectsQuerySchema }), projectController.listProjects);
router.get('/:id', validateObjectIds('id'), projectController.getProject);
router.patch(
  '/:id',
  validateObjectIds('id'),
  validate({ body: updateProjectSchema }),
  projectController.updateProject
);
router.delete('/:id', validateObjectIds('id'), projectController.deleteProject);

/* -------------------------------- members --------------------------------- */

router.post(
  '/:id/members',
  validateObjectIds('id'),
  validate({ body: addMemberSchema }),
  projectController.addMember
);
router.patch(
  '/:id/members/:memberId',
  validateObjectIds('id', 'memberId'),
  validate({ body: updateMemberSchema }),
  projectController.updateMember
);
router.delete(
  '/:id/members/:memberId',
  validateObjectIds('id', 'memberId'),
  projectController.removeMember
);

/* ------------------------------ integrations ------------------------------ */

router.get('/:id/integrations', validateObjectIds('id'), projectController.integrationStatus);
router.post('/:id/integrations/webhook-secret', validateObjectIds('id'), projectController.rotateWebhookSecret);
router.delete('/:id/integrations/webhook-secret', validateObjectIds('id'), projectController.clearWebhookSecret);
router.post('/:id/integrations/ingest-key', validateObjectIds('id'), projectController.rotateIngestKey);

/* -------------------------- analytics & timeline -------------------------- */

router.get('/:id/dashboard', validateObjectIds('id'), projectController.getDashboard);
router.get(
  '/:id/timeline',
  validateObjectIds('id'),
  validate({ query: listEventsQuerySchema }),
  projectController.getTimeline
);
router.get(
  '/:id/events',
  validateObjectIds('id'),
  validate({ query: listEventsQuerySchema }),
  eventController.listProjectEvents
);

/* ------------------------- nested deployments ----------------------------- */

router.post(
  '/:id/deployments',
  validateObjectIds('id'),
  validate({ body: createDeploymentSchema }),
  deploymentController.createDeployment
);
router.get(
  '/:id/deployments',
  validateObjectIds('id'),
  validate({ query: listDeploymentsQuerySchema }),
  deploymentController.listProjectDeployments
);

/* --------------------------- nested incidents ------------------------------ */

router.post(
  '/:id/incidents',
  validateObjectIds('id'),
  validate({ body: createIncidentSchema }),
  incidentController.createIncident
);
router.get(
  '/:id/incidents',
  validateObjectIds('id'),
  validate({ query: listIncidentsQuerySchema }),
  incidentController.listProjectIncidents
);

module.exports = router;
