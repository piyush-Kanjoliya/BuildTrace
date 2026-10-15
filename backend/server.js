'use strict';

const http = require('http');
const app = require('./src/app');
const env = require('./src/config/env');
const logger = require('./src/config/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/db');
const { initSockets, closeSockets } = require('./src/sockets');

let server;
let shuttingDown = false;

async function start() {
  // Fail fast when the database is unreachable
  await connectDatabase();

  server = http.createServer(app);
  initSockets(server);

  await new Promise((resolve) => {
    server.listen(env.port, () => {
      logger.info(
        { port: env.port, env: env.nodeEnv },
        `BuildTrace API listening on http://localhost:${env.port}`
      );
      resolve();
    });
  });
}

/**
 * Graceful shutdown: stop accepting connections, close Socket.IO, then close
 * the database. Forced exit if cleanup exceeds the deadline.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully...');

  const deadline = setTimeout(() => {
    logger.error('Graceful shutdown timed out - forcing exit');
    process.exit(1);
  }, 10000);
  deadline.unref();

  try {
    await closeSockets();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception - shutting down');
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});

module.exports = { start, shutdown };
