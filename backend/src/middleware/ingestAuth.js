'use strict';

const Project = require('../models/Project');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { verifyToken, extractBearer } = require('./auth');
const { sha256 } = require('../utils/security');

/**
 * Event-ingestion authentication.
 *
 * Accepts EITHER:
 *  - a Bearer JWT (a signed-in user; the project role is still enforced in the
 *    controller exactly as before), OR
 *  - a project-scoped `X-Ingest-Key` for automation that cannot hold a user JWT.
 *
 * The ingest key is matched by its SHA-256 hash (the plaintext key is never
 * stored or compared directly) and authorizes ingestion for EXACTLY the project
 * that owns the key. It is only ever consulted on the ingestion route - it never
 * grants access to any other part of the API.
 */
async function ingestAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (token) {
      let payload;
      try {
        payload = verifyToken(token);
      } catch (err) {
        throw ApiError.unauthorized('Invalid or expired token');
      }
      const user = await User.findById(payload.sub);
      if (!user) throw ApiError.unauthorized('User no longer exists');
      req.user = user;
      return next();
    }

    const key = req.headers['x-ingest-key'];
    if (typeof key === 'string' && key.trim()) {
      const project = await Project.findOne({ ingestKeyHash: sha256(key.trim()) });
      if (!project) throw ApiError.unauthorized('Invalid ingest key');
      req.ingestProject = project;
      return next();
    }

    throw ApiError.unauthorized('Missing bearer token or ingest key');
  } catch (err) {
    return next(err);
  }
}

module.exports = { ingestAuth, sha256 };
