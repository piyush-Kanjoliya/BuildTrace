'use strict';

const mongoose = require('mongoose');
const { ROLES_LIST, ROLES, DEFAULT_ENVIRONMENTS } = require('../utils/constants');

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: {
      type: String,
      enum: { values: ROLES_LIST, message: 'Invalid member role: {VALUE}' },
      default: ROLES.DEVELOPER,
    },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Project name is required'], trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 90 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    repositoryUrl: {
      type: String,
      trim: true,
      maxlength: 400,
      default: '',
      validate: {
        validator: (v) => !v || /^https?:\/\//.test(v),
        message: 'repositoryUrl must be a valid http(s) URL',
      },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
    environments: {
      type: [String],
      default: () => [...DEFAULT_ENVIRONMENTS],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one environment is required',
      },
    },
    // GitHub webhook secret (write-only; never returned in responses/logs)
    githubWebhookSecret: { type: String, select: false, default: null },
    // Optional ingest key hash for automation that cannot use user JWTs
    ingestKeyHash: { type: String, select: false, default: null },
    ingestKeyLast4: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.githubWebhookSecret;
        delete ret.ingestKeyHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

projectSchema.index({ 'members.user': 1 });
projectSchema.index({ name: 'text', description: 'text' });

const Project = mongoose.model('Project', projectSchema);

module.exports = Project;
