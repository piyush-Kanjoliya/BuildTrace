'use strict';

const { Router } = require('express');
const authController = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { z } = require('../validators/common');

const router = Router();

/**
 * User directory used by "add project member" flows.
 * Deliberately minimal: only name + email are exposed, and the endpoint
 * requires authentication.
 */
const searchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get('/', validate({ query: searchQuerySchema }), authController.listUsers);

module.exports = router;
