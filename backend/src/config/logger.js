'use strict';

const pino = require('pino');
const env = require('./env');

/**
 * Structured logger. Pretty-printed in development, JSON in production/tests.
 */
const logger = pino({
  level: env.isTest ? 'silent' : env.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'password',
      'passwordHash',
      'token',
      '*.webhookSecret',
      '*.githubWebhookSecret',
      '*.ingestKey',
    ],
    censor: '[REDACTED]',
  },
  transport: env.isProd || env.isTest
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
});

module.exports = logger;
