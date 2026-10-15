'use strict';

const { Router } = require('express');
const webhookController = require('../controllers/webhookController');

const router = Router();

/**
 * GitHub webhook endpoint.
 * NOTE: the raw-body parser is mounted in app.js BEFORE express.json() so the
 * HMAC signature is computed over the exact bytes GitHub sent.
 */
router.post('/github', webhookController.handleGithubWebhook);

module.exports = router;
