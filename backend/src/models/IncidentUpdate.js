'use strict';

const mongoose = require('mongoose');

/**
 * A comment / update on an incident. Kept in its own collection so the
 * incident document stays small (no unbounded embedded arrays).
 */
const incidentUpdateSchema = new mongoose.Schema(
  {
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: {
      type: String,
      enum: ['comment', 'status_change', 'note'],
      default: 'comment',
    },
    content: { type: String, required: [true, 'Update content is required'], trim: true, maxlength: 8000 },
  },
  { timestamps: true }
);

incidentUpdateSchema.index({ incidentId: 1, createdAt: 1 });

const IncidentUpdate = mongoose.model('IncidentUpdate', incidentUpdateSchema);

module.exports = IncidentUpdate;
