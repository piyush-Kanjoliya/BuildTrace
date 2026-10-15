'use strict';

/**
 * Consistent API response envelopes.
 * Success: { success: true, data, meta? }
 * Error:   { success: false, error: { code, message, details? } }
 */

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function created(res, data) {
  return ok(res, data, 201);
}

function accepted(res, data) {
  return ok(res, data, 202);
}

function noContent(res) {
  return res.status(204).send();
}

/**
 * Paginated payload: { items, page, limit, total, totalPages }
 */
function paginated(res, { items, page, limit, total }) {
  return ok(res, {
    items,
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  });
}

module.exports = { ok, created, accepted, noContent, paginated };
