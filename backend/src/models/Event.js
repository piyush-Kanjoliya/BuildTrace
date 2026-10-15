'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPES, EVENT_SOURCES } = require('../utils/constants');

/**
 * A raw ingested event. This collection is the chronological backbone of the
 * timeline and the ingestion/deduplication ledger.
 *
 * Deduplication: `dedupKey` (source + external id / client idempotency key)
 * has a database-enforced partial unique index. Events recorded internally
 * (with no external identity) leave dedupKey null and are excluded from the
 * index, so legitimate repeated internal events are never merged.
 */
const eventSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    eventType: {
      type: String,
      enum: { values: EVENT_TYPES, message: 'Invalid event type: {VALUE}' },
      required: true,
    },
    source: {
      type: String,
      enum: { values: EVENT_SOURCES, message: 'Invalid event source: {VALUE}' },
      required: true,
    },
    externalId: { type: String, trim: true, maxlength: 200, default: null },
    idempotencyKey: { type: String, trim: true, maxlength: 200, default: null },
    dedupKey: { type: String, default: null },
    occurredAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    occurredAtSource: { type: String, enum: ['payload', 'receipt'], default: 'payload' },
    timestampUncertain: { type: Boolean, default: false },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      name: { type: String, trim: true, maxlength: 140, default: null },
    },
    // Linkages created while processing this event
    deploymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deployment', default: null },
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    processingStatus: {
      type: String,
      enum: ['pending', 'processed', 'failed', 'ignored'],
      default: 'pending',
    },
    processedAt: { type: Date, default: null },
    error: {
      message: { type: String, default: null },
      at: { type: Date, default: null },
    },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

eventSchema.index({ dedupKey: 1 }, { unique: true, partialFilterExpression: { dedupKey: { $type: 'string' } } });
// Timeline ordering: occurrence time with _id as the stable secondary key
eventSchema.index({ projectId: 1, occurredAt: -1, _id: -1 });
eventSchema.index({ projectId: 1, eventType: 1, occurredAt: -1 });
eventSchema.index({ projectId: 1, source: 1, externalId: 1 });
eventSchema.index({ processingStatus: 1 });

const Event = mongoose.model('Event', eventSchema);

module.exports = Event;
