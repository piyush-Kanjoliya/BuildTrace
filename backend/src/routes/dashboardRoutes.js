'use strict';

const { Router } = require('express');
const eventController = require('../controllers/eventController');
const { validate } = require('../middleware/validate');
const { z, objectId } = require('../validators/common');

const router = Router();

/**
 * Dashboard metrics.
 * GET /api/v1/dashboard            -> user-scoped (all member projects)
 * GET /api/v1/dashboard?projectId= -> project-scoped (member check enforced)
 */
const dashboardQuerySchema = z.object({ projectId: objectId.optional() });

router.get('/', validate({ query: dashboardQuerySchema }), eventController.getDashboard);

module.exports = router;
