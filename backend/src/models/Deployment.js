'use strict';

const mongoose = require('mongoose');
const { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS, EVENT_SOURCES } = require('../utils/constants');

/**
 * A deployment record. Occurrence and receipt timestamps are both stored so
 * late-arriving deployments keep their true position in the timeline.
 */
const deploymentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    version: { type: String, trim: true, maxlength: 120, default: 'unknown' },
    commitSha: { type: String, trim: true, lowercase: true, maxlength: 64, default: null },
    environment: { type: String, required: true, trim: true, maxlength: 60 },
    status: {
      type: String,
      enum: { values: DEPLOYMENT_STATUSES, message: 'Invalid deployment status: {VALUE}' },
      default: DEPLOYMENT_STATUS.SUCCESS,
    },
    // Developer or automation identity
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      name: { type: String, trim: true, maxlength: 140, default: null },
      type: { type: String, enum: ['user', 'automation', 'unknown'], default: 'unknown' },
    },
    occurredAt: { type: Date, required: true, default: Date.now },
    receivedAt: { type: Date, required: true, default: Date.now },
    // Timestamp of the most recent status transition that was actually applied.
    // Used to ignore stale (out-of-order) status updates.
    lastStatusAt: { type: Date, default: null },
    // false when the source supplied no reliable occurrence timestamp
    occurredAtTrusted: { type: Boolean, default: true },
    source: {
      type: String,
      enum: { values: EVENT_SOURCES, message: 'Invalid deployment source: {VALUE}' },
      default: 'manual',
    },
    externalId: { type: String, trim: true, maxlength: 200, default: null },
    service: { type: String, trim: true, maxlength: 120, default: null },
    commitMessage: { type: String, trim: true, maxlength: 2000, default: null },
    changedFiles: { type: [String], default: [] },
    filesChangedCount: { type: Number, min: 0, default: 0 },
    url: { type: String, trim: true, maxlength: 500, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Duplicate protection for source-provided deployments (GitHub deliveries, CI).
// Manual/in-house deployments have no externalId and are excluded by the partial filter.
deploymentSchema.index(
  { projectId: 1, source: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } }
);
deploymentSchema.index({ projectId: 1, occurredAt: -1 });
deploymentSchema.index({ projectId: 1, environment: 1, occurredAt: -1 });
deploymentSchema.index({ projectId: 1, status: 1, occurredAt: -1 });

const Deployment = mongoose.model('Deployment', deploymentSchema);

module.exports = Deployment;
