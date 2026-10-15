'use strict';

const mongoose = require('mongoose');
const {
  INCIDENT_STATUSES,
  INCIDENT_STATUS,
  SEVERITIES,
  SEVERITY,
} = require('../utils/constants');

/**
 * An incident. `version` implements optimistic concurrency control: every
 * state change increments it and stale writers receive HTTP 409.
 *
 * deploymentIds holds deployments *associated by an investigator*.
 * dismissedDeploymentIds holds candidates an investigator explicitly rejected.
 * A suggested (correlation-engine) relationship is never mixed with a
 * confirmed root cause - rootCause stays a separate, explicit field.
 */
const incidentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: [true, 'Incident title is required'], trim: true, maxlength: 240 },
    description: { type: String, trim: true, maxlength: 8000, default: '' },
    severity: {
      type: String,
      enum: { values: SEVERITIES, message: 'Invalid severity: {VALUE}' },
      default: SEVERITY.SEV3,
    },
    status: {
      type: String,
      enum: { values: INCIDENT_STATUSES, message: 'Invalid status: {VALUE}' },
      default: INCIDENT_STATUS.OPEN,
    },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    environment: { type: String, trim: true, maxlength: 60, default: null },
    affectedService: { type: String, trim: true, maxlength: 120, default: null },
    deploymentIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Deployment' }], default: [] },
    dismissedDeploymentIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Deployment' }], default: [] },
    rootCause: { type: String, trim: true, maxlength: 4000, default: null },
    resolution: { type: String, trim: true, maxlength: 4000, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    // Normalized signature of the title, used for recurring-issue detection
    signature: { type: String, index: true, default: null },
    version: { type: Number, default: 0 },
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

incidentSchema.index({ projectId: 1, status: 1, createdAt: -1 });
incidentSchema.index({ projectId: 1, severity: 1, createdAt: -1 });
incidentSchema.index({ projectId: 1, createdAt: -1 });
incidentSchema.index({ projectId: 1, signature: 1 });
incidentSchema.index({ assigneeId: 1, status: 1 });

const Incident = mongoose.model('Incident', incidentSchema);

module.exports = Incident;
