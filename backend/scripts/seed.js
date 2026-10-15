'use strict';

/**
 * Demo data seeder.
 *
 * Creates realistic users, projects, deployments, incidents, comments, events
 * and audit records so the application can be explored immediately.
 * All data is written through the real models/services - the same validation
 * and timeline machinery used in production paths.
 *
 * Usage:
 *   npm run seed            # refuses to run when NODE_ENV=production
 *   NODE_ENV=production npm run seed -- --force   # explicit override
 *
 * WARNING: this RESETS the BuildTrace collections in the target database.
 */

const bcrypt = require('bcryptjs');
const env = require('../src/config/env');
const { connectDatabase, disconnectDatabase, mongoose } = require('../src/config/db');
const User = require('../src/models/User');
const Project = require('../src/models/Project');
const Deployment = require('../src/models/Deployment');
const Incident = require('../src/models/Incident');
const IncidentUpdate = require('../src/models/IncidentUpdate');
const Event = require('../src/models/Event');
const AuditLog = require('../src/models/AuditLog');
const eventService = require('../src/services/eventService');
const { normalizeSignature } = require('../src/utils/text');
const logger = require('../src/config/logger');

// Deterministic PRNG so demo data is stable between runs
function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261014);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const minutesAgo = (m) => new Date(Date.now() - m * 60000);
const sha = () => Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');

const COMMIT_MESSAGES = [
  'Fix checkout timeout retry logic',
  'Add connection pool size configuration',
  'Refactor payment webhook signature validation',
  'Bump redis client to 4.7.0',
  'Fix memory leak in session cache eviction',
  'Improve 502 error handling in api gateway',
  'Add database index for transactions query',
  'Update rate limiter window configuration',
  'Fix race condition in coupon redemption',
  'Optimize checkout latency by caching tax lookup',
  'Handle null currency in legacy import path',
  'Upgrade mongoose and fix deprecated options',
];

const CHANGED_FILES = [
  'src/checkout/checkoutService.js',
  'src/payments/webhookHandler.js',
  'src/retry/backoff.js',
  'src/db/connectionPool.js',
  'src/cache/sessionStore.js',
  'src/gateway/router.js',
  'src/middleware/rateLimit.js',
  'src/models/Transaction.js',
  'src/coupons/redeem.js',
  'src/tax/lookup.js',
  'config/production.json',
  'Dockerfile',
];

const SERVICES_A = ['checkout-api', 'payments-api', 'webhook-worker'];
const SERVICES_B = ['web-dashboard', 'api-gateway'];

function buildDeploymentData({ project, actorPool, count, services, environments, daysBack }) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const roll = rand();
    const status = roll < 0.78 ? 'success' : roll < 0.88 ? 'failed' : roll < 0.95 ? 'in_progress' : 'rolled_back';
    // `daysBack` spread biased to recent days
    const occurredAt = minutesAgo(Math.floor(rand() * daysBack * 24 * 60) + 5);
    // 15% of deployments are delivered late to the platform
    const late = rand() < 0.15;
    const receivedAt = late
      ? new Date(occurredAt.getTime() + Math.floor((20 + rand() * 90) * 60000))
      : new Date(occurredAt.getTime() + Math.floor(rand() * 120000));
    const files = Array.from(new Set(Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(CHANGED_FILES))));
    rows.push({
      projectId: project._id,
      version: `v1.${Math.floor(rand() * 20)}.${Math.floor(rand() * 10)}`,
      commitSha: sha(),
      environment: pick(environments),
      status,
      actor: pick(actorPool),
      occurredAt,
      receivedAt,
      occurredAtTrusted: true,
      lastStatusAt: occurredAt,
      source: 'seed',
      service: pick(services),
      commitMessage: pick(COMMIT_MESSAGES),
      changedFiles: files,
      filesChangedCount: files.length,
      url: `https://ci.buildtrace.dev/deployments/${Math.floor(rand() * 9000) + 1000}`,
      metadata: { seeded: true },
    });
  }
  return rows;
}

/** Create a deployment that lands `offsetMinutes` before an incident, aligned to its story. */
function craftCandidate({ project, actor, service, message, offsetMinutes, environment = 'production', status = 'success' }) {
  const occurredAt = minutesAgo(offsetMinutes);
  const files = [pick(CHANGED_FILES), pick(CHANGED_FILES)];
  return {
    projectId: project._id,
    version: `v2.${Math.floor(rand() * 10)}.${Math.floor(rand() * 10)}`,
    commitSha: sha(),
    environment,
    status,
    actor,
    occurredAt,
    receivedAt: new Date(occurredAt.getTime() + 60000),
    occurredAtTrusted: true,
    lastStatusAt: occurredAt,
    source: 'seed',
    service,
    commitMessage: message,
    changedFiles: files,
    filesChangedCount: files.length,
    metadata: { seeded: true, crafted: true },
  };
}

async function reset() {
  await Promise.all([
    User.deleteMany({}),
    Project.deleteMany({}),
    Deployment.deleteMany({}),
    Incident.deleteMany({}),
    IncidentUpdate.deleteMany({}),
    Event.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
}

async function main() {
  if (env.isProd && !process.argv.includes('--force')) {
    logger.error('Refusing to seed a production database without --force');
    process.exit(1);
  }

  await connectDatabase();
  logger.info('Resetting demo collections...');
  await reset();

  const passwordHash = await bcrypt.hash(env.seed.password, 10);

  /* --------------------------------- users -------------------------------- */
  const [admin, maya, leo, priya] = await User.create([
    { name: 'Alex Rivera', email: 'admin@buildtrace.dev', passwordHash, role: 'admin' },
    { name: 'Maya Chen', email: 'maya@buildtrace.dev', passwordHash, role: 'developer' },
    { name: 'Leo Novak', email: 'leo@buildtrace.dev', passwordHash, role: 'developer' },
    { name: 'Priya Sharma', email: 'priya@buildtrace.dev', passwordHash, role: 'viewer' },
  ]);

  /* ------------------------------- projects -------------------------------- */
  const payments = await Project.create({
    name: 'Payments Platform',
    slug: 'payments-platform',
    description: 'Core checkout, payment processing and webhook delivery services.',
    repositoryUrl: 'https://github.com/buildtrace-demo/payments-platform',
    createdBy: admin._id,
    environments: ['production', 'staging', 'development'],
    members: [
      { user: admin._id, role: 'admin' },
      { user: maya._id, role: 'developer' },
      { user: leo._id, role: 'developer' },
      { user: priya._id, role: 'viewer' },
    ],
  });

  const dashboard = await Project.create({
    name: 'Web Dashboard',
    slug: 'web-dashboard',
    description: 'Customer-facing analytics dashboard and API gateway.',
    repositoryUrl: 'https://github.com/buildtrace-demo/web-dashboard',
    createdBy: admin._id,
    environments: ['production', 'staging'],
    members: [
      { user: admin._id, role: 'admin' },
      { user: maya._id, role: 'developer' },
      { user: priya._id, role: 'developer' },
      { user: leo._id, role: 'viewer' },
    ],
  });

  const actorPoolA = [
    { userId: maya._id, name: maya.name, type: 'user' },
    { userId: leo._id, name: leo.name, type: 'user' },
    { userId: null, name: 'github-actions[bot]', type: 'automation' },
  ];
  const actorPoolB = [
    { userId: maya._id, name: maya.name, type: 'user' },
    { userId: null, name: 'vercel-bot', type: 'automation' },
  ];

  /* ------------------------------ deployments ------------------------------- */
  const deps = await Deployment.create([
    ...buildDeploymentData({ project: payments, actorPool: actorPoolA, count: 34, services: SERVICES_A, environments: ['production', 'production', 'staging'], daysBack: 14 }),
    ...buildDeploymentData({ project: dashboard, actorPool: actorPoolB, count: 22, services: SERVICES_B, environments: ['production', 'staging'], daysBack: 14 }),
  ]);
  logger.info({ count: deps.length }, 'deployments seeded');

  /* -------------------------------- incidents ------------------------------ */
  // Crafted candidates land shortly BEFORE the incident detection time so the
  // correlation engine demonstrably finds them inside the 60-minute window.
  const crafted = await Deployment.create([
    craftCandidate({ project: payments, actor: actorPoolA[0], service: 'checkout-api', message: 'Fix checkout timeout retry logic', offsetMinutes: 25 }),
    craftCandidate({ project: payments, actor: actorPoolA[1], service: 'payments-api', message: 'Add database index for transactions query', offsetMinutes: 40 }),
    craftCandidate({ project: dashboard, actor: actorPoolB[0], service: 'api-gateway', message: 'Improve 502 error handling in api gateway', offsetMinutes: 18 }),
    craftCandidate({ project: dashboard, actor: actorPoolB[1], service: 'web-dashboard', message: 'Optimize checkout latency by caching tax lookup', offsetMinutes: 12, status: 'rolled_back' }),
  ]);

  const incidentDefs = [
    {
      project: payments, title: 'Checkout latency spike in production', severity: 'SEV1', status: 'investigating',
      environment: 'production', affectedService: 'checkout-api', assignee: maya,
      createdAt: minutesAgo(20), description: 'p99 latency on /checkout jumped from 220ms to over 2.5s. Error budget burning fast.',
      comments: [
        { author: maya, content: 'Dashboards confirm the spike started ~25 minutes ago, right after the retry logic deploy.' },
        { author: leo, content: 'Connection pool saturation visible in DB metrics. Suspecting the new retry backoff.' },
      ],
    },
    {
      project: payments, title: 'Checkout latency spike on staging', severity: 'SEV4', status: 'resolved',
      environment: 'staging', affectedService: 'checkout-api', assignee: leo,
      createdAt: minutesAgo(60 * 30), description: 'Staging checkout slow after load test kicked off.',
      rootCause: 'Load generator misconfiguration, not an application defect.',
      resolution: 'Stopped the runaway load generator; latency returned to normal.',
      comments: [{ author: leo, content: 'Not application-related - closed after verifying with the perf team.' }],
    },
    {
      project: payments, title: 'Payment webhook signature failures', severity: 'SEV2', status: 'monitoring',
      environment: 'production', affectedService: 'webhook-worker', assignee: leo,
      createdAt: minutesAgo(60 * 20), description: 'Partner reports webhook deliveries failing signature validation intermittently.',
      comments: [
        { author: leo, content: 'Root cause identified: clock skew on one webhook worker node.' },
        { author: maya, content: 'Fixed NTP drift; monitoring signature failure rate for 24h.' },
      ],
    },
    {
      project: payments, title: 'Duplicate charges reported by support', severity: 'SEV1', status: 'resolved',
      environment: 'production', affectedService: 'payments-api', assignee: maya,
      createdAt: minutesAgo(60 * 44), description: 'Three support tickets mention duplicate card charges.',
      rootCause: 'Idempotency key collision after the redis eviction fix changed key prefixes.',
      resolution: 'Rolled back the eviction change, refunded affected customers, added guard test.',
      comments: [{ author: maya, content: 'Refunds processed for all three customers. Postmortem scheduled.' }],
    },
    {
      project: payments, title: 'Intermittent 502 errors on webhook-worker', severity: 'SEV2', status: 'open',
      environment: 'production', affectedService: 'webhook-worker', assignee: null,
      createdAt: minutesAgo(60 * 5), description: 'Sporadic 502s when partners retry bursts of webhooks.',
      comments: [],
    },
    {
      project: payments, title: 'Intermittent 502 errors on webhook-worker', severity: 'SEV3', status: 'open',
      environment: 'production', affectedService: 'webhook-worker', assignee: null,
      createdAt: minutesAgo(60 * 70), description: 'Burst retries overwhelm the worker pool at peak hours.',
      comments: [{ author: admin, content: 'This has the same signature as the open incident from last week.' }],
    },
    {
      project: dashboard, title: 'Dashboard charts fail to load for large accounts', severity: 'SEV2', status: 'investigating',
      environment: 'production', affectedService: 'web-dashboard', assignee: priya,
      createdAt: minutesAgo(14), description: 'Accounts with >100k events see blank charts; API returns 502 after 30s.',
      comments: [{ author: priya, content: 'Reproduced with the demo enterprise account. Query plan shows a full collection scan.' }],
    },
    {
      project: dashboard, title: 'Login redirect loop on Safari', severity: 'SEV3', status: 'resolved',
      environment: 'production', affectedService: 'web-dashboard', assignee: maya,
      createdAt: minutesAgo(60 * 96), description: 'Safari users bounced between /login and /app indefinitely.',
      rootCause: 'SameSite=Lax cookie dropped on the OAuth return POST.',
      resolution: 'Switched the return route to GET and redeployed the auth SDK.',
      comments: [{ author: maya, content: 'Verified on Safari 17 and 18 - no more loops.' }],
    },
    {
      project: dashboard, title: 'API gateway 5xx burst after traffic shift', severity: 'SEV2', status: 'monitoring',
      environment: 'production', affectedService: 'api-gateway', assignee: admin,
      createdAt: minutesAgo(16), description: '5xx rate jumped to 4% right after the canary traffic shift to the new gateway build.',
      comments: [{ author: admin, content: 'Canary at 10% shows the same error profile; holding the rollout.' }],
    },
    {
      project: dashboard, title: 'Export CSV job stuck in queue', severity: 'SEV4', status: 'resolved',
      environment: 'production', affectedService: 'api-gateway', assignee: priya,
      createdAt: minutesAgo(60 * 120), description: 'One export job never left the queue.',
      resolution: 'Worker had crashed after an OOM; job replayed manually.',
      comments: [],
    },
  ];

  const incidents = [];
  for (const def of incidentDefs) {
    const incident = await Incident.create({
      projectId: def.project._id,
      title: def.title,
      description: def.description,
      severity: def.severity,
      status: def.status,
      assigneeId: def.assignee ? def.assignee._id : null,
      environment: def.environment,
      affectedService: def.affectedService,
      createdBy: admin._id,
      rootCause: def.rootCause || null,
      resolution: def.resolution || null,
      resolvedAt: def.status === 'resolved' ? new Date(def.createdAt.getTime() + 45 * 60000) : null,
      signature: normalizeSignature(def.title),
      version: 0,
      createdAt: def.createdAt,
      updatedAt: def.createdAt,
    });
    incidents.push({ incident, def, project: def.project });

    await AuditLog.create({
      projectId: def.project._id,
      incidentId: incident._id,
      actorId: admin._id,
      action: 'incident.created',
      after: { title: incident.title, severity: incident.severity, status: incident.status },
      timestamp: def.createdAt,
    });

    let commentTime = def.createdAt.getTime() + 5 * 60000;
    for (const c of def.comments) {
      await IncidentUpdate.create({
        incidentId: incident._id,
        authorId: c.author._id,
        kind: 'comment',
        content: c.content,
        createdAt: new Date(commentTime),
        updatedAt: new Date(commentTime),
      });
      commentTime += 12 * 60000;
    }
    if (def.status !== 'open') {
      await IncidentUpdate.create({
        incidentId: incident._id,
        authorId: admin._id,
        kind: 'status_change',
        content: `Status changed from open to ${def.status}${def.resolution ? `\n\nResolution: ${def.resolution}` : ''}`,
        createdAt: new Date(def.createdAt.getTime() + 30 * 60000),
        updatedAt: new Date(def.createdAt.getTime() + 30 * 60000),
      });
    }
  }
  logger.info({ count: incidents.length }, 'incidents seeded');

  // Associate the crafted candidates with their incidents (investigator-confirmed links)
  const [checkoutInc, chartInc, gatewayInc] = [
    incidents.find((i) => i.def.title.startsWith('Checkout latency spike in production')),
    incidents.find((i) => i.def.title.startsWith('Dashboard charts fail')),
    incidents.find((i) => i.def.title.startsWith('API gateway 5xx')),
  ];
  await Incident.updateOne({ _id: checkoutInc.incident._id }, { $addToSet: { deploymentIds: crafted[0]._id } });
  await Incident.updateOne({ _id: gatewayInc.incident._id }, { $addToSet: { deploymentIds: crafted[2]._id } });
  await Incident.updateOne({ _id: chartInc.incident._id }, { $push: { dismissedDeploymentIds: crafted[3]._id } });

  /* --------------------------------- events -------------------------------- */
  // Deployment events (occurrence = deployment time; some are delivered late)
  for (const d of [...deps, ...crafted]) {
    await eventService.recordInternalEvent({
      projectId: d.projectId,
      eventType: d.status === 'rolled_back' ? 'rollback' : 'deployment',
      source: 'seed',
      occurredAt: d.occurredAt,
      actor: d.actor?.userId ? { userId: d.actor.userId, name: d.actor.name } : { userId: null, name: d.actor?.name },
      payload: {
        version: d.version,
        commitSha: d.commitSha,
        environment: d.environment,
        status: d.status,
        service: d.service,
      },
      deploymentId: d._id,
    }).then((ev) => Event.updateOne({ _id: ev._id }, { $set: { receivedAt: d.receivedAt } }));
  }

  // Incident + comment events
  for (const { incident, def } of incidents) {
    await eventService.recordInternalEvent({
      projectId: def.project._id,
      eventType: 'incident',
      source: 'seed',
      occurredAt: def.createdAt,
      actor: { userId: admin._id, name: admin.name },
      payload: { incidentId: String(incident._id), title: incident.title, severity: incident.severity },
      incidentId: incident._id,
    });
  }

  // A handful of push/commit events - deliberately NOT deployments
  for (let i = 0; i < 8; i += 1) {
    const project = i % 2 === 0 ? payments : dashboard;
    await eventService.recordInternalEvent({
      projectId: project._id,
      eventType: 'commit',
      source: 'seed',
      occurredAt: minutesAgo(Math.floor(rand() * 60 * 24 * 10) + 60),
      actor: { userId: maya._id, name: maya.name },
      payload: { branch: 'main', commitMessage: pick(COMMIT_MESSAGES), commits: 1 + Math.floor(rand() * 4) },
    });
  }

  // One deliberately late-arriving rollback: occurred long ago, received now
  const lateRollbackOccurred = minutesAgo(180);
  const lateEvent = await eventService.recordInternalEvent({
    projectId: payments._id,
    eventType: 'rollback',
    source: 'seed',
    occurredAt: lateRollbackOccurred,
    actor: { userId: leo._id, name: leo.name },
    payload: { version: 'v1.9.4', environment: 'production', note: 'Rolled back after latency regression' },
  });
  await Event.updateOne({ _id: lateEvent._id }, { $set: { receivedAt: new Date() } });

  const eventCount = await Event.countDocuments();
  logger.info({ eventCount }, 'events seeded');

  /* ---------------------------------- done ---------------------------------- */
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  BuildTrace demo data seeded');
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  Login password for all demo users: ${env.seed.password}`);
  console.log('    admin@buildtrace.dev  (global admin)');
  console.log('    maya@buildtrace.dev   (developer)');
  console.log('    leo@buildtrace.dev    (developer)');
  console.log('    priya@buildtrace.dev  (viewer)');
  console.log(`  Projects: ${payments.name}, ${dashboard.name}`);
  console.log(`  Deployments: ${deps.length + crafted.length}, Incidents: ${incidents.length}, Events: ${eventCount}`);
  console.log('──────────────────────────────────────────────────────────\n');

  await disconnectDatabase();
  await mongoose.connection.close().catch(() => {});
  process.exit(0);
}

main().catch(async (err) => {
  logger.error({ err }, 'Seeding failed');
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
