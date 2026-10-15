'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');

/**
 * Verify a JWT and return the encoded payload.
 */
function verifyToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

function extractBearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Hard authentication: 401 when no valid token / user missing.
 * The user is always reloaded from the database - never trust the token's claims alone.
 */
async function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) throw ApiError.unauthorized('Missing bearer token');
    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      throw ApiError.unauthorized('Invalid or expired token');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw ApiError.unauthorized('User no longer exists');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Soft authentication: attaches req.user when a valid token is present,
 * but never fails the request. Used for endpoints that behave differently
 * for authenticated users (e.g. webhooks do not use this at all).
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) return next();
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (user) req.user = user;
    return next();
  } catch (err) {
    return next(); // ignore invalid token for optional auth
  }
}

module.exports = { requireAuth, optionalAuth, signToken, verifyToken, extractBearer };
