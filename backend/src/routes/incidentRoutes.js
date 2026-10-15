'use strict';

const { Router } = require('express');
const incidentController = require('../controllers/incidentController');
const { validate, validateObjectIds } = require('../middleware/validate');
const {
  updateIncidentSchema,
  listIncidentsQuerySchema,
  createCommentSchema,
  associateDeploymentSchema,
} = require('../validators/incidentValidators');
const { paginationQuery } = require('../validators/common');
const { z } = require('../validators/common');

const router = Router();

const auditQuerySchema = z.object({ ...paginationQuery });
const updatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Global incident list (scoped server-side to the user's projects). */
router.get('/', validate({ query: listIncidentsQuerySchema }), incidentController.listAllIncidents);

router.get('/:id', validateObjectIds('id'), incidentController.getIncident);
router.patch(
  '/:id',
  validateObjectIds('id'),
  validate({ body: updateIncidentSchema }),
  incidentController.updateIncident
);
router.delete('/:id', validateObjectIds('id'), incidentController.deleteIncident);

/* ------------------------------ collaboration ----------------------------- */

router.get(
  '/:id/updates',
  validateObjectIds('id'),
  validate({ query: updatesQuerySchema }),
  incidentController.listUpdates
);
router.post(
  '/:id/updates',
  validateObjectIds('id'),
  validate({ body: createCommentSchema }),
  incidentController.addUpdate
);

/* ------------------------------ investigation ----------------------------- */

router.get('/:id/candidates', validateObjectIds('id'), incidentController.getCandidates);
router.get(
  '/:id/audit-logs',
  validateObjectIds('id'),
  validate({ query: auditQuerySchema }),
  incidentController.getAuditLogs
);
router.post(
  '/:id/deployments/associate',
  validateObjectIds('id'),
  validate({ body: associateDeploymentSchema }),
  incidentController.associateDeployment
);
router.post(
  '/:id/deployments/dismiss',
  validateObjectIds('id'),
  validate({ body: associateDeploymentSchema }),
  incidentController.dismissDeployment
);

module.exports = router;
