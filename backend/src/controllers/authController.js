'use strict';

const authService = require('../services/authService');
const { ok, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Authentication endpoints.
 * Strategy: stateless JWT (Bearer token). Logout is client-side token
 * disposal; the endpoint exists so clients have a single, explicit call and
 * to make the contract symmetrical.
 */
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.validated.body);
  return created(res, result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.validated.body);
  return ok(res, result);
});

const logout = asyncHandler(async (req, res) => {
  // With Bearer tokens the server holds no session; respond with an explicit
  // contract so the client knows to discard its token.
  return ok(res, { loggedOut: true });
});

const me = asyncHandler(async (req, res) => {
  return ok(res, req.user.toJSON());
});

const listUsers = asyncHandler(async (req, res) => {
  const users = await authService.searchUsers(req.validated.query.q, {
    limit: req.validated.query.limit,
  });
  return ok(res, { items: users });
});

module.exports = { register, login, logout, me, listUsers };
