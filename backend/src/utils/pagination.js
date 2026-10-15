'use strict';

const MAX_LIMIT = 100;

/**
 * Normalize pagination inputs into safe skip/limit values.
 */
function getPagination(query = {}, { defaultLimit = 20, maxLimit = MAX_LIMIT } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Parse a `sort` query param like "-occurredAt" or "createdAt" into a
 * Mongoose sort object, restricted to an allowlist of fields.
 * A stable secondary key (_id) is always appended so ordering is deterministic.
 */
function getSort(sortParam, allowedFields, defaultSort = { occurredAt: -1 }) {
  const sort = {};
  if (typeof sortParam === 'string' && sortParam.trim()) {
    for (const part of sortParam.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const desc = trimmed.startsWith('-');
      const field = desc ? trimmed.slice(1) : trimmed;
      if (allowedFields.includes(field)) sort[field] = desc ? -1 : 1;
    }
  }
  if (Object.keys(sort).length === 0) {
    Object.assign(sort, defaultSort);
  }
  // Stable secondary ordering key for identical timestamps
  if (!sort._id && !Object.keys(sort).includes('_id')) sort._id = -1;
  return sort;
}

module.exports = { getPagination, getSort, MAX_LIMIT };
