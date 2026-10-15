'use strict';

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { signToken } = require('../middleware/auth');

const BCRYPT_ROUNDS = 10;

/**
 * Registration, login and current-user resolution.
 * Passwords are hashed with bcrypt; login errors are intentionally generic
 * so account existence is never leaked.
 */
async function register({ name, email, password }) {
  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // Self-registered accounts always get the least-privileged interactive role.
  // Global admins are only created out of band (seed / operations).
  const user = await User.create({ name, email: email.toLowerCase(), passwordHash, role: 'developer' });
  const token = signToken(user);
  return { user: user.toJSON(), token };
}

async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!ok) throw ApiError.unauthorized('Invalid email or password');
  const token = signToken(user);
  user.passwordHash = undefined;
  return { user: user.toJSON(), token };
}

async function getById(id) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

/**
 * Lightweight user directory for "add project member" flows.
 * Returns only id/name/email - never hashes or roles of other systems.
 */
async function searchUsers(q, { limit = 20 } = {}) {
  const filter = {};
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  return User.find(filter).select('name email').sort({ name: 1 }).limit(limit).lean();
}

async function findByEmail(email) {
  return User.findOne({ email: String(email).toLowerCase() });
}

module.exports = { register, login, getById, searchUsers, findByEmail };
