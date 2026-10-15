'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./config/logger');
const protectedRoutes = require('./routes');
const authRoutes = require('./routes/authRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const eventController = require('./controllers/eventController');
const { requireAuth } = require('./middleware/auth');
const { ingestAuth } = require('./middleware/ingestAuth');
const { validate } = require('./middleware/validate');
const { ingestEventSchema } = require('./validators/eventValidators');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimit');
const { isDbConnected } = require('./config/db');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind a reverse proxy / load balancer in production

/* ------------------------------- security -------------------------------- */

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/server-to-server requests have no Origin header
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      // Unknown origin: continue without CORS headers (browser blocks it)
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Ingest-Key'],
  })
);

/* ------------------------------- logging ---------------------------------- */

app.use(
  pinoHttp({
    logger,
    autoLogging: !env.isTest,
    customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
    // Log only the shape of the request/response - never headers or bodies
    serializers: {
      req(req) {
        return { method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

/* --------------------------- webhooks (raw body) --------------------------
 * Mounted BEFORE express.json() so the GitHub HMAC-SHA256 signature can be
 * verified against the exact raw request bytes.
 */
app.use('/api/v1/webhooks', express.raw({ type: '*/*', limit: '2mb' }), webhookRoutes);

/* ------------------------------ body parsing ------------------------------- */

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/* ------------------------------ rate limiting ------------------------------ */

app.use('/api', apiLimiter);

/* --------------------------- public health check --------------------------- */

function healthHandler(req, res) {
  const dbConnected = isDbConnected();
  const payload = {
    success: dbConnected,
    data: {
      status: dbConnected ? 'ok' : 'degraded',
      database: dbConnected ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  };
  res.status(dbConnected ? 200 : 503).json(payload);
}

app.get(['/health', '/api/v1/health'], healthHandler);

/* ----------------------- public auth (register/login) ----------------------- */

app.use('/api/v1/auth', authRoutes);

/* ------------------------- event ingestion (dual auth) ----------------------
 * Mounted BEFORE the JWT-only protected surface because it accepts EITHER a
 * Bearer JWT (project DEVELOPER+) OR a project-scoped X-Ingest-Key; ingestAuth
 * enforces that and the controller still applies the role check for JWT users.
 */
app.post('/api/v1/events', ingestAuth, validate({ body: ingestEventSchema }), eventController.ingestEvent);

/* --------------------------- protected API surface -------------------------- */

// Everything else under /api/v1 requires a valid Bearer token; each route
// additionally enforces project membership and role server-side.
app.use('/api/v1', requireAuth, protectedRoutes);

/* --------------------------- errors (last, always) ------------------------- */

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
