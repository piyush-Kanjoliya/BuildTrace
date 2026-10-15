'use strict';

const { Types } = require('mongoose');
const ApiError = require('./ApiError');

/**
 * Validate an ObjectId path/query/body param, throwing a 400 early
 * instead of letting Mongoose throw a CastError deeper in the stack.
 */
function assertObjectId(value, name = 'id') {
  if (!value || !Types.ObjectId.isValid(String(value))) {
    throw ApiError.badRequest(`Invalid ${name}: "${value}" is not a valid ObjectId`);
  }
  return String(value);
}

function maybeObjectId(value) {
  return value && Types.ObjectId.isValid(String(value)) ? String(value) : null;
}

module.exports = { assertObjectId, maybeObjectId };
