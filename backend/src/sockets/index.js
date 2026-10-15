'use strict';

const { Server } = require('socket.io');
const logger = require('../config/logger');
const env = require('../config/env');
const { verifyToken } = require('../middleware/auth');
const User = require('../models/User');
const Project = require('../models/Project');
const { ROLES } = require('../utils/constants');

/**
 * Socket.IO layer.
 *
 * - Every connection is authenticated with the same JWT as the REST API.
 * - Users only join rooms for projects they are members of (global admins
 *   may join any project room they explicitly subscribe to).
 * - The payloads emitted here are *notifications with ids and summaries only*.
 *   MongoDB remains the single source of truth; clients refetch authoritative
 *   state on notification and on reconnect.
 */

let io = null;

function projectRoom(projectId) {
  return `project:${String(projectId)}`;
}

/** IDs of all projects a user may subscribe to. */
async function projectsForUser(user) {
  if (user.role === ROLES.ADMIN) {
    const ids = await Project.find({}, { _id: 1 }).lean();
    return ids.map((p) => String(p._id));
  }
  const projects = await Project.find({ 'members.user': user._id }, { _id: 1 }).lean();
  return projects.map((p) => String(p._id));
}

async function canAccessProject(user, projectId) {
  if (user.role === ROLES.ADMIN) return true;
  const exists = await Project.exists({ _id: projectId, 'members.user': user._id });
  return Boolean(exists);
}

function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });

  // Authenticate the handshake before any room membership is granted
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error('User no longer exists'));
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      socket.data.memberships = await projectsForUser(user);
      return next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id, userId: socket.data.userId }, 'socket connected');

    // Explicit subscribe (also used after a user is added to a new project)
    socket.on('project:subscribe', async (projectId, ack) => {
      try {
        const allowed = socket.data.memberships.includes(String(projectId))
          || (await canAccessProject({ _id: socket.data.userId, role: socket.data.role }, projectId));
        if (!allowed) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Not a project member' });
          return;
        }
        socket.join(projectRoom(projectId));
        if (!socket.data.memberships.includes(String(projectId))) {
          socket.data.memberships.push(String(projectId));
        }
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Subscription failed' });
      }
    });

    socket.on('project:unsubscribe', (projectId) => {
      socket.leave(projectRoom(projectId));
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'socket disconnected');
    });
  });

  return io;
}

/**
 * Broadcast a notification to everyone subscribed to a project room.
 * Safe no-op when sockets are not initialised (tests, scripts).
 */
function emitToProject(projectId, event, payload) {
  if (!io) return;
  io.to(projectRoom(projectId)).emit(event, payload);
}

function getIO() {
  return io;
}

async function closeSockets() {
  if (io) {
    await new Promise((resolve) => io.close(resolve));
    io = null;
  }
}

module.exports = { initSockets, emitToProject, closeSockets, getIO, projectRoom, canAccessProject };
