'use strict';

const mongoose = require('mongoose');

/**
 * Append-only audit record for significant domain actions.
 * Records actor, action, before, after and timestamp.
 */
const auditLogSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true, maxlength: 120 },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  timestamp: { type: Date, default: Date.now },
});

auditLogSchema.index({ projectId: 1, timestamp: -1 });
auditLogSchema.index({ incidentId: 1, timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
