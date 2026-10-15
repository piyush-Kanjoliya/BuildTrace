'use strict';

const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');

/**
 * 404 handler for unknown routes.
 */
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * Convert a ZodError into a flat list of field issues.
 */
function zodDetails(err) {
  return err.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Centralized error handler. Produces a consistent error envelope:
 * { success: false, error: { code, message, details? } }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let code = err.code || ApiError.defaultCode(statusCode);
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof ZodError) {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = zodDetails(err);
  } else if (err.name === 'ValidationError' && err.errors) {
    // Mongoose schema validation
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Database validation failed';
    details = Object.values(err.errors).map((e) => ({
      path: e.path,
      message: e.message,
    }));
  } else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'BAD_REQUEST';
    message = `Invalid value for "${err.path}"`;
  } else if (err.code === 11000) {
    // Duplicate key -> conflict; include which key caused it (no values leaked)
    statusCode = 409;
    code = 'DUPLICATE_KEY';
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    message = `Duplicate value for unique field(s): ${fields.join(', ') || 'unknown'}`;
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed JSON body';
  }

  if (statusCode >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, 'Unhandled error');
    if (env.isProd) message = 'Internal server error';
  } else {
    logger.warn(
      { statusCode, code, path: req.originalUrl, method: req.method, message },
      'Request error'
    );
  }

  const body = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  if (err.currentRecord) body.error.currentRecord = err.currentRecord;

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
