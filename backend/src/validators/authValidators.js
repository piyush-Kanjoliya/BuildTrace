'use strict';

const { z } = require('./common');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.email('A valid email address is required').max(254).toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
});

const loginSchema = z.object({
  email: z.email('A valid email address is required').toLowerCase(),
  password: z.string().min(1, 'Password is required').max(128),
});

module.exports = { registerSchema, loginSchema };
