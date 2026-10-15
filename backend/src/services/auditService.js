'use strict';

const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

/**
 * Append-only audit trail. Every significant state change records
 * actor, action, previous value, new value, and timestamp.
 */
async function record({ projectId, incidentId = null, actorId = null, action, before = null, after = null }) {
  try {
    return await AuditLog.create({ projectId, incidentId, actorId, action, before, after });
  } catch (err) {
    // Auditing must never break the main operation - log and continue.
    logger.error({ err, action, projectId, incidentId }, 'Failed to write audit log');
    return null;
  }
}

async function listForIncident(incidentId, { skip = 0, limit = 50 } = {}) {
  const [items, total] = await Promise.all([
    AuditLog.find({ incidentId })
      .sort({ timestamp: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actorId', 'name email role')
      .lean(),
    AuditLog.countDocuments({ incidentId }),
  ]);
  return { items, total };
}

module.exports = { record, listForIncident };
