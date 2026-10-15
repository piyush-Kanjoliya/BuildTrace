'use strict';

// Loads environment from backend/.env, then the repo-root .env as fallback
require('./loadEnv');

const path = require('path');

/**
 * Centralized, environment-based configuration.
 * Every value can be overridden through environment variables (see .env.example).
 */
const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/buildtrace',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL || 'info',

  jwt: {
    secret: process.env.JWT_SECRET || 'buildtrace-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 min
    max: parseInt(process.env.RATE_LIMIT_MAX || '600', 10),
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '20', 10),
  },

  correlation: {
    // Investigation window (minutes) before incident detection time
    windowMinutes: parseInt(process.env.CORRELATION_WINDOW_MINUTES || '60', 10),
    // Transparent, configurable rule-based weights (must sum to 1.0). See docs/architecture.md
    weights: {
      proximity: parseFloat(process.env.CORRELATION_W_PROXIMITY || '0.45'),
      environment: parseFloat(process.env.CORRELATION_W_ENVIRONMENT || '0.2'),
      service: parseFloat(process.env.CORRELATION_W_SERVICE || '0.2'),
      changeSignals: parseFloat(process.env.CORRELATION_W_CHANGE_SIGNALS || '0.15'),
    },
  },

  events: {
    // An event is flagged "late-arriving" when received this many minutes after it occurred
    lateThresholdMinutes: parseInt(process.env.LATE_EVENT_THRESHOLD_MINUTES || '5', 10),
  },

  seed: {
    password: process.env.SEED_PASSWORD || 'BuildTrace123!',
  },

  isTest: (process.env.NODE_ENV || 'development') === 'test',
  isProd: process.env.NODE_ENV === 'production',
  rootDir: path.resolve(__dirname, '..', '..'),
};

if (env.isProd && env.jwt.secret === 'buildtrace-dev-secret-change-me') {
  // Fail fast in production with an insecure default secret
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = env;
