'use strict';

const {
  app,
  request,
  setupDb,
  teardownDb,
  registerAndLogin,
  createProject,
  minutesAgo,
  auth,
} = require('./helpers');
const Event = require('../src/models/Event');
const Deployment = require('../src/models/Deployment');

beforeAll(setupDb);
afterAll(teardownDb);

async function addMember(adminToken, projectId, email, role) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set(auth(adminToken))
    .send({ email, role });
  if (res.status !== 201) throw new Error(`addMember failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

function ingest(token, body) {
  return request(app).post('/api/v1/events').set(auth(token)).send(body);
}

describe('event ingestion', () => {
  it('preserves a late occurredAt and flags the event as late-arriving', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await ingest(token, {
      projectId: project._id,
      eventType: 'commit',
      externalId: 'late-commit-1',
      occurredAt: minutesAgo(45).toISOString(),
      payload: { branch: 'main', headCommit: { message: 'refactor queue drain' } },
    });
    expect(res.status).toBe(202);
    expect(res.body.data.duplicate).toBe(false);
    expect(res.body.data.processingStatus).toBe('processed');

    // The occurrence time is preserved exactly - it is never clamped to "now"
    const occurredDeltaMinutes = Math.abs(
      (Date.now() - new Date(res.body.data.event.occurredAt).getTime()) / 60000 - 45
    );
    expect(occurredDeltaMinutes).toBeLessThan(0.1);

    const list = await request(app)
      .get(`/api/v1/projects/${project._id}/events`)
      .set(auth(token));
    const item = list.body.data.items.find((e) => e.externalId === 'late-commit-1');
    expect(item.lateArrival).toBe(true);
    expect(item.receiptDelayMinutes).toBeGreaterThanOrEqual(44);
    expect(item.timestampUncertain).toBe(false);
  });

  it('never rejects an old event even when it predates project activity', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await ingest(token, {
      projectId: project._id,
      eventType: 'commit',
      externalId: 'ancient-commit',
      occurredAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      payload: {},
    });
    expect(res.status).toBe(202);
    expect(res.body.data.processingStatus).toBe('processed');
  });

  it('deduplicates repeated deliveries via the client idempotency key', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const body = {
      projectId: project._id,
      eventType: 'config_change',
      idempotencyKey: 'retry-click-77',
      payload: { key: 'RATE_LIMIT_MAX', value: '900' },
    };
    const first = await ingest(token, body);
    expect(first.status).toBe(202);
    expect(first.body.data.duplicate).toBe(false);

    const second = await ingest(token, body);
    expect(second.status).toBe(202);
    expect(second.body.data.duplicate).toBe(true);
    expect(String(second.body.data.event._id)).toBe(String(first.body.data.event._id));

    // Exactly one row exists - the unique dedupKey index enforced it
    const count = await Event.countDocuments({ projectId: project._id, idempotencyKey: 'retry-click-77' });
    expect(count).toBe(1);
  });

  it('deduplicates on source-scoped external ids independently per source', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const a = await ingest(token, {
      projectId: project._id, eventType: 'commit', source: 'github', externalId: 'delivery-1', payload: {},
    });
    const b = await ingest(token, {
      projectId: project._id, eventType: 'commit', source: 'github', externalId: 'delivery-1', payload: {},
    });
    expect(a.body.data.duplicate).toBe(false);
    expect(b.body.data.duplicate).toBe(true);

    // Same external id from a DIFFERENT source is a distinct event
    const c = await ingest(token, {
      projectId: project._id, eventType: 'commit', source: 'api', externalId: 'delivery-1', payload: {},
    });
    expect(c.body.data.duplicate).toBe(false);
  });

  it('marks events without a reliable timestamp as receipt-time and uncertain', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await ingest(token, {
      projectId: project._id,
      eventType: 'other',
      externalId: 'no-timestamp-1',
      payload: { note: 'legacy script without clock' },
    });
    expect(res.status).toBe(202);
    expect(res.body.data.event.occurredAtSource).toBe('receipt');
    expect(res.body.data.event.timestampUncertain).toBe(true);

    const list = await request(app)
      .get(`/api/v1/projects/${project._id}/events`)
      .set(auth(token));
    const item = list.body.data.items.find((e) => e.externalId === 'no-timestamp-1');
    expect(item.timestampUncertain).toBe(true);
    expect(item.receiptDelayMinutes).toBeLessThan(0.5);
  });

  it('treats a push/commit event as NOT a deployment', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await ingest(token, {
      projectId: project._id,
      eventType: 'commit',
      externalId: 'push-1',
      payload: { branch: 'main', headCommit: { message: 'feat: new checkout flow' } },
    });
    expect(res.status).toBe(202);
    expect(res.body.data.deploymentId).toBeNull();
    expect(await Deployment.countDocuments({ projectId: project._id })).toBe(0);
  });

  it('creates a deployment from a deployment event and links it on the event', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await ingest(token, {
      projectId: project._id,
      eventType: 'deployment',
      externalId: 'evt-deploy-7000',
      occurredAt: minutesAgo(10).toISOString(),
      payload: {
        deployment: {
          identity: 'ci-deploy-7000',
          version: 'v7.0.0',
          environment: 'production',
          service: 'checkout-api',
          status: 'success',
          commitMessage: 'increase connection pool size',
          changedFiles: ['src/db/pool.ts'],
        },
      },
    });
    expect(res.status).toBe(202);
    expect(res.body.data.processingStatus).toBe('processed');
    expect(res.body.data.deploymentId).toBeTruthy();

    const deployment = await Deployment.findById(res.body.data.deploymentId).lean();
    expect(deployment.status).toBe('success');
    expect(deployment.version).toBe('v7.0.0');
    expect(deployment.service).toBe('checkout-api');
    expect(deployment.source).toBe('api');
    expect(deployment.externalId).toBe('ci-deploy-7000');
    expect(deployment.filesChangedCount).toBe(1);

    const storedEvent = await Event.findById(res.body.data.event._id).lean();
    expect(String(storedEvent.deploymentId)).toBe(String(deployment._id));
  });

  it('upserts status updates for the same deployment identity onto one row', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const created = await ingest(token, {
      projectId: project._id,
      eventType: 'deployment',
      externalId: 'evt-identity-1',
      occurredAt: minutesAgo(12).toISOString(),
      payload: { deployment: { identity: 'ci-row-1', version: 'v1.2.3', environment: 'production', status: 'in_progress' } },
    });
    const deploymentId = created.body.data.deploymentId;
    expect(deploymentId).toBeTruthy();

    const statusUpdate = await ingest(token, {
      projectId: project._id,
      eventType: 'deployment_status',
      externalId: 'evt-identity-1-status',
      occurredAt: minutesAgo(4).toISOString(),
      payload: { deployment: { identity: 'ci-row-1', status: 'success', url: 'https://ci.example.com/run/1' } },
    });
    expect(statusUpdate.status).toBe(202);
    expect(String(statusUpdate.body.data.deploymentId)).toBe(String(deploymentId));

    // Still exactly one deployment row for this identity
    const count = await Deployment.countDocuments({ projectId: project._id, externalId: 'ci-row-1' });
    expect(count).toBe(1);

    const updated = await Deployment.findById(deploymentId).lean();
    expect(updated.status).toBe('success');
    expect(updated.url).toBe('https://ci.example.com/run/1');
  });

  it('ignores a stale (out-of-order) status update for the same deployment', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const created = await ingest(token, {
      projectId: project._id,
      eventType: 'deployment',
      externalId: 'evt-stale-1',
      occurredAt: minutesAgo(5).toISOString(),
      payload: { deployment: { identity: 'ci-stale-1', environment: 'production', status: 'success' } },
    });
    const deploymentId = created.body.data.deploymentId;

    // This event is NEWER (occurred 2 minutes ago)
    await ingest(token, {
      projectId: project._id,
      eventType: 'deployment_status',
      externalId: 'evt-stale-2',
      occurredAt: minutesAgo(2).toISOString(),
      payload: { deployment: { identity: 'ci-stale-1', status: 'rolled_back' } },
    });

    // This event describes an OLDER transition (8 minutes ago) - must not win
    const stale = await ingest(token, {
      projectId: project._id,
      eventType: 'deployment_status',
      externalId: 'evt-stale-3',
      occurredAt: minutesAgo(8).toISOString(),
      payload: { deployment: { identity: 'ci-stale-1', status: 'success' } },
    });
    expect(stale.status).toBe(202);
    expect(stale.body.data.processingStatus).toBe('processed');

    const deployment = await Deployment.findById(deploymentId).lean();
    expect(deployment.status).toBe('rolled_back'); // the newer decision stands
    // The raw out-of-order event is still stored for the timeline
    expect(await Event.countDocuments({ projectId: project._id, externalId: 'evt-stale-3' })).toBe(1);
  });

  it('persists processing failures, retries them, and recovers on redelivery', async () => {
    const admin = await registerAndLogin();
    const dev = await registerAndLogin();
    const project = await createProject(admin.token);
    await addMember(admin.token, project._id, dev.payload.email, 'developer');

    const brokenBody = {
      projectId: project._id,
      eventType: 'deployment',
      externalId: 'evt-fail-1',
      occurredAt: minutesAgo(20).toISOString(),
      // Not a valid deployment status -> Deployment.create fails validation
      payload: { deployment: { identity: 'ci-broken-1', environment: 'production', status: 'not-a-status' } },
    };

    const failed = await ingest(admin.token, brokenBody);
    expect(failed.status).toBe(202);
    expect(failed.body.data.failed).toBe(true);
    expect(failed.body.data.error).toBeTruthy();
    const eventId = failed.body.data.event._id;

    const stored = await Event.findById(eventId).lean();
    expect(stored.processingStatus).toBe('failed');
    expect(stored.error.message).toBeTruthy();

    // Only project admins may retry
    const devRetry = await request(app)
      .post(`/api/v1/events/${eventId}/retry`)
      .set(auth(dev.token));
    expect(devRetry.status).toBe(403);

    // Retry while the payload is still broken -> still failed
    const adminRetry = await request(app)
      .post(`/api/v1/events/${eventId}/retry`)
      .set(auth(admin.token));
    expect(adminRetry.status).toBe(200);
    expect(adminRetry.body.data.failed).toBe(true);

    // Correct the stored payload and retry: the event recovers
    await Event.updateOne(
      { _id: eventId },
      { $set: { 'payload.deployment.status': 'success' } }
    );
    const recovered = await request(app)
      .post(`/api/v1/events/${eventId}/retry`)
      .set(auth(admin.token));
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.failed).toBe(false);
    expect(recovered.body.data.event.processingStatus).toBe('processed');
    expect(await Deployment.countDocuments({ projectId: project._id, externalId: 'ci-broken-1' })).toBe(1);

    // A redelivery of a previously FAILED event is reprocessed, not echoed as failed
    const brokenBody2 = { ...brokenBody, externalId: 'evt-fail-2' };
    const failed2 = await ingest(admin.token, brokenBody2);
    expect(failed2.body.data.failed).toBe(true);

    const redelivered = await ingest(admin.token, {
      ...brokenBody2,
      payload: { deployment: { identity: 'ci-broken-2', environment: 'production', status: 'success' } },
    });
    expect(redelivered.status).toBe(202);
    expect(redelivered.body.data.duplicate).toBe(true);
    expect(redelivered.body.data.reprocessed).toBe(true);
    expect(redelivered.body.data.processingStatus).toBe('processed');

    // Retrying a healthy event is a conflict
    const retryHealthy = await request(app)
      .post(`/api/v1/events/${eventId}/retry`)
      .set(auth(admin.token));
    expect(retryHealthy.status).toBe(409);
  });

  it('enforces RBAC on ingestion and retry endpoints', async () => {
    const admin = await registerAndLogin();
    const viewer = await registerAndLogin();
    const project = await createProject(admin.token);
    await addMember(admin.token, project._id, viewer.payload.email, 'viewer');

    const asViewer = await ingest(viewer.token, {
      projectId: project._id,
      eventType: 'other',
      externalId: 'viewer-attempt',
      payload: {},
    });
    expect(asViewer.status).toBe(403);

    const missingProject = await ingest(admin.token, {
      eventType: 'other',
      payload: {},
    });
    expect(missingProject.status).toBe(422);
  });
});
