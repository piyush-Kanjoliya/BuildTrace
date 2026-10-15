'use strict';

const { Types } = require('mongoose');
const ApiError = require('../utils/ApiError');

/**
 * Zod-powered request validation middleware.
 *
 * Usage:
 *   router.post('/', validate({ body: schema }), handler)
 *
 * Validated (and coerced) values replace the originals so downstream code
 * works with trusted data. Query params are copied into a plain object
 * because Express 5 exposes req.query as a getter.
 */
function validate(schemas) {
  return function validateMiddleware(req, res, next) {
    try {
      if (schemas.params) {
        req.validated = req.validated || {};
        req.validated.params = schemas.params.parse(req.params);
      }
      if (schemas.body) {
        req.validated = req.validated || {};
        req.validated.body = schemas.body.parse(req.body ?? {});
      }
      if (schemas.query) {
        req.validated = req.validated || {};
        const flat = { ...req.query };
        req.validated.query = schemas.query.parse(flat);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Validate ObjectId params in one shot (e.g. :id, :deploymentId).
 */
function validateObjectIds(...names) {
  return function objectIdMiddleware(req, res, next) {
    try {
      for (const name of names) {
        const value = req.params[name];
        if (!value || !Types.ObjectId.isValid(String(value))) {
          throw ApiError.badRequest(`Invalid ${name}: "${value}" is not a valid ObjectId`);
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validate, validateObjectIds };
