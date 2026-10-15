'use strict';

const ApiError = require('../utils/ApiError');
const { ROLE_LEVEL, ROLES } = require('../utils/constants');

/**
 * Role-based authorization helpers.
 *
 * Rules:
 *  - A global admin can do anything on any project.
 *  - Every other user must be a project member; their project role
 *    (admin > developer > viewer) must satisfy the required minimum level.
 *
 * These helpers are used by services and route middleware - the API never
 * trusts a client-supplied role, projectId identity, or actor id.
 */

function projectRoleOf(user, project) {
  if (!user || !project) return null;
  if (user.role === ROLES.ADMIN) return ROLES.ADMIN;
  const membership = (project.members || []).find(
    (m) => String(m.user?._id || m.user) === String(user._id)
  );
  return membership ? membership.role : null;
}

function hasProjectRole(user, project, minRole = ROLES.VIEWER) {
  const role = projectRoleOf(user, project);
  if (!role) return false;
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

function isProjectMember(user, project) {
  return projectRoleOf(user, project) !== null;
}

/**
 * Throw 403 unless the user has at least `minRole` on the project.
 */
function assertProjectRole(user, project, minRole = ROLES.VIEWER) {
  if (!user) throw ApiError.unauthorized();
  if (!hasProjectRole(user, project, minRole)) {
    throw ApiError.forbidden(
      `Requires project role "${minRole}" or higher on project "${project.name}"`
    );
  }
}

module.exports = { projectRoleOf, hasProjectRole, isProjectMember, assertProjectRole };
