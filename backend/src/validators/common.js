'use strict';

const { z } = require('zod');
const { MAX_LIMIT } = require('../utils/pagination');
const { EVENT_TYPES } = require('../utils/constants');

/** A 24-hex-char Mongo ObjectId string */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid ObjectId');

/** Any ISO date / date-coercible string */
const dateInput = z.coerce.date();

const paginationQuery = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
};

const dateRangeQuery = {
  from: dateInput.optional(),
  to: dateInput.optional(),
};

const eventTypeList = z
  .union([z.enum(EVENT_TYPES), z.array(z.enum(EVENT_TYPES))])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

module.exports = { z, objectId, dateInput, paginationQuery, dateRangeQuery, eventTypeList };
