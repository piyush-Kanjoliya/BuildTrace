'use strict';

const { Router } = require('express');
const deploymentController = require('../controllers/deploymentController');
const deploymentService = require('../services/deploymentService');
const { validate, validateObjectIds } = require('../middleware/validate');
const { updateDeploymentSchema, listDeploymentsQuerySchema } = require('../validators/deploymentValidators');
const { paginated } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();

/** Global deployment list, scoped server-side to the user's projects. */
router.get(
  '/',
  validate({ query: listDeploymentsQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await deploymentService.listDeploymentsGlobal(req.user, req.validated.query);
    return paginated(res, result);
  })
);

router.get('/:id', validateObjectIds('id'), deploymentController.getDeployment);
router.patch(
  '/:id',
  validateObjectIds('id'),
  validate({ body: updateDeploymentSchema }),
  deploymentController.updateDeployment
);

module.exports = router;
