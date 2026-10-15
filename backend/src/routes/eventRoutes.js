'use strict';

const { Router } = require('express');
const eventController = require('../controllers/eventController');
const { validateObjectIds } = require('../middleware/validate');

const router = Router();

/**
 * NOTE: event ingestion (POST /api/v1/events) is mounted separately in app.js
 * because it authenticates with EITHER a Bearer JWT OR a project X-Ingest-Key,
 * so it cannot sit behind the JWT-only global requireAuth surface.
 */

/** Retry a failed event's processing (project admins). */
router.post('/:id/retry', validateObjectIds('id'), eventController.retryEvent);

module.exports = router;
