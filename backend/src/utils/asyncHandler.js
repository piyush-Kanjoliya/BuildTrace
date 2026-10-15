'use strict';

/**
 * Wraps async route handlers so rejected promises reach the error middleware.
 * (Express 5 forwards async errors natively, but this keeps handlers explicit
 * and compatible with any middleware signature.)
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
