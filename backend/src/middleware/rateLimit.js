'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const jsonLimitHandler = (req, res) => {
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again later.',
    },
  });
};

/**
 * Global API rate limiter (generous default; configurable via env).
 */
const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
  skip: () => env.isTest,
});

/**
 * Stricter limiter for login/register to slow credential stuffing.
 */
const authLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimitHandler,
  skip: () => env.isTest,
});

module.exports = { apiLimiter, authLimiter };
