'use strict';

/**
 * Vitest global setup - runs before any test module (and therefore before
 * the app/config modules are required). dotenv never overrides existing
 * environment variables, so these values win over .env files.
 */
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI =
  process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/buildtrace_test';
process.env.JWT_SECRET = 'test-only-secret';
process.env.LOG_LEVEL = 'silent';
process.env.CORRELATION_WINDOW_MINUTES = '60';
process.env.LATE_EVENT_THRESHOLD_MINUTES = '5';
