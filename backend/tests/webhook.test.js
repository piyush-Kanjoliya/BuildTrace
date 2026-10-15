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
  signGithubPayload,
} = require('./helpers');
const Deployment = require('../src/models/Deployment');
const Project = require('../src/models/Project');

beforeAll(setupDb);
afterAll(teardownDb);

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** Create a project wired to a unique GitHub repo; optionally rotate a secret. */
async function createGithubProject(token, { withSecret = true, repoLabel = suffix() } = {}) {
  const repoFullName = `acme/webapp-${repoLabel}`;
  const project = await createProject(token, {
    repositoryUrl: `https://github.com/${repoFullName}`,
  });
  let secret = null;
  if (withSecret) {
    const rotate = await request(app)
      .post(`/api/v1/projects/${project._id}/integrations/webhook-secret`)
      .set(auth(token));
    if (rotate.status !== 200) throw new Error(`rotate failed: ${JSON.stringify(rotate.body)}`);
    secret = rotate.body.data.secret;
  }
  return { project, secret, repoFullName };
}

/** Send a webhook exactly like GitHub does: raw body + HMAC over the raw bytes. */
function sendWebhook({ eventName = 'push', deliveryId, body, secret, repoFullName }) {
  const raw = JSON.stringify(body);
  let req = request(app)
    .post('/api/v1/webhooks/github')
    .set('Content-Type', 'application/json')
    .set('x-github-event', eventName)
    .set('x-github-delivery', deliveryId)
    .set('x-hub-signature-256', signGithubPayload(raw, secret || 'wrong-secret'));
  req = req.send(raw);
  return req;
}

function pushBody(repoFullName, overrides = {}) {
  return {
    ref: 'refs/heads/main',
    repository: { full_name: repoFullName },
    sender: { login: 'octocat' },
    head_commit: {
      id: 'abcdef0123456789abcdef0123456789abcdef01',
      message: 'fix checkout retry storm',
      timestamp: minutesAgo(8).toISOString(),
      author: { name: 'Octo Cat' },
      added: [], removed: [], modified: ['src/checkout.ts'],
    },
    commits: [{ id: 'abcdef0123456789abcdef0123456789abcdef01' }],
    ...overrides,
  };
}

function deploymentBody(repoFullName, { deploymentId, createdAt, status }) {
  return {
    repository: { full_name: repoFullName },
    sender: { login: 'octocat' },
    deployment: {
      id: deploymentId,
      environment: 'production',
      sha: 'abcdef1234567890abcdef1234567890abcdef12',
      created_at: createdAt,
      updated_at: createdAt,
      creator: { login: 'octocat' },
      url: `https://api.github.com/repos/${repoFullName}/deployments/${deploymentId}`,
    },
    ...(status ? { deployment_status: status } : {}),
  };
}

describe('github webhook', () => {
  it('rejects deliveries without the GitHub identification headers', async () => {
    const { token } = await registerAndLogin();
    const { secret, repoFullName } = await createGithubProject(token);
    const raw = JSON.stringify(pushBody(repoFullName));

    const noDelivery = await request(app)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('x-github-event', 'push')
      .set('x-hub-signature-256', signGithubPayload(raw, secret))
      .send(raw);
    expect(noDelivery.status).toBe(400);

    const noEvent = await request(app)
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('x-github-delivery', 'delivery-no-event')
      .set('x-hub-signature-256', signGithubPayload(raw, secret))
      .send(raw);
    expect(noEvent.status).toBe(400);
  });

  it('returns 404 for repositories with no matching project', async () => {
    const { token } = await registerAndLogin();
    const { secret } = await createGithubProject(token);

    const res = await sendWebhook({
      deliveryId: `delivery-unknown-${suffix()}`,
      body: pushBody(`acme/does-not-exist-${suffix()}`),
      secret,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/No BuildTrace project/);
  });

  it('returns 409 when the project has no webhook secret configured', async () => {
    const { token } = await registerAndLogin();
    const { repoFullName } = await createGithubProject(token, { withSecret: false });

    const res = await sendWebhook({
      deliveryId: `delivery-no-secret-${suffix()}`,
      body: pushBody(repoFullName),
      secret: 'arbitrary',
      repoFullName,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/webhook secret/i);
  });

  it('rejects an invalid HMAC signature with 401 and never leaks the secret', async () => {
    const { token } = await registerAndLogin();
    const { repoFullName } = await createGithubProject(token);

    const res = await sendWebhook({
      deliveryId: `delivery-bad-sig-${suffix()}`,
      body: pushBody(repoFullName),
      secret: 'not-the-configured-secret',
      repoFullName,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid webhook signature');
    expect(JSON.stringify(res.body)).not.toContain('btwh_');
    expect(JSON.stringify(res.body)).not.toContain('not-the-configured-secret');
  });

  it('answers ping events with a pong for connectivity checks', async () => {
    const { token } = await registerAndLogin();
    const { secret, repoFullName } = await createGithubProject(token);

    const res = await sendWebhook({
      eventName: 'ping',
      deliveryId: `delivery-ping-${suffix()}`,
      body: { zen: 'Keep it logically awesome.', repository: { full_name: repoFullName } },
      secret,
      repoFullName,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.pong).toBe(true);
  });

  it('records a push as a commit event - never as a deployment - and deduplicates redeliveries', async () => {
    const { token } = await registerAndLogin();
    const { project, secret, repoFullName } = await createGithubProject(token);
    const deliveryId = `delivery-push-${suffix()}`;

    const first = await sendWebhook({
      deliveryId,
      body: pushBody(repoFullName),
      secret,
      repoFullName,
    });
    expect(first.status).toBe(202);
    expect(first.body.data.eventType).toBe('commit');
    expect(first.body.data.duplicate).toBe(false);
    expect(first.body.data.deploymentId).toBeNull();

    // NO deployment may be created from a push
    expect(await Deployment.countDocuments({ projectId: project._id })).toBe(0);

    // GitHub redelivers the same delivery -> safe no-op duplicate
    const second = await sendWebhook({
      deliveryId,
      body: pushBody(repoFullName),
      secret,
      repoFullName,
    });
    expect(second.status).toBe(202);
    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.eventId).toBe(first.body.data.eventId);
  });

  it('processes deployment + deployment_status events onto a single deployment row', async () => {
    const { token } = await registerAndLogin();
    const { project, secret, repoFullName } = await createGithubProject(token);
    const ghDeploymentId = Math.floor(Math.random() * 1e9);
    const identity = `gh-deployment:${ghDeploymentId}`;

    // 1) deployment created event -> in_progress row, never "success"
    const started = await sendWebhook({
      eventName: 'deployment',
      deliveryId: `delivery-dep-${suffix()}`,
      body: deploymentBody(repoFullName, {
        deploymentId: ghDeploymentId,
        createdAt: minutesAgo(12).toISOString(),
      }),
      secret,
      repoFullName,
    });
    expect(started.status).toBe(202);
    expect(started.body.data.eventType).toBe('deployment');

    let deployment = await Deployment.findOne({ projectId: project._id, externalId: identity }).lean();
    expect(deployment).toBeTruthy();
    expect(deployment.status).toBe('in_progress');
    expect(deployment.source).toBe('github');
    expect(deployment.environment).toBe('production');
    expect(deployment.actor.name).toBe('octocat');
    expect(deployment.version).toBe('abcdef12');

    // 2) deployment_status success -> same row flips to success
    const statusDeliveryId = `delivery-dep-status-${suffix()}`;
    const statusBody = deploymentBody(repoFullName, {
      deploymentId: ghDeploymentId,
      createdAt: minutesAgo(11).toISOString(),
      status: {
        state: 'success',
        created_at: minutesAgo(6).toISOString(),
        creator: { login: 'octocat' },
        target_url: 'https://ci.example.com/run/42',
      },
    });
    const finished = await sendWebhook({
      eventName: 'deployment_status',
      deliveryId: statusDeliveryId,
      body: statusBody,
      secret,
      repoFullName,
    });
    expect(finished.status).toBe(202);

    const count = await Deployment.countDocuments({ projectId: project._id, externalId: identity });
    expect(count).toBe(1);
    deployment = await Deployment.findOne({ projectId: project._id, externalId: identity }).lean();
    expect(deployment.status).toBe('success');
    expect(deployment.url).toBe('https://ci.example.com/run/42');

    // 3) a redelivery of the finished status is deduplicated
    const redelivered = await sendWebhook({
      eventName: 'deployment_status',
      deliveryId: statusDeliveryId,
      body: statusBody,
      secret,
      repoFullName,
    });
    expect(redelivered.status).toBe(202);
    expect(redelivered.body.data.duplicate).toBe(true);
    expect(redelivered.body.data.eventId).toBe(finished.body.data.eventId);
  });

  it('never exposes the webhook secret through the project API', async () => {
    const { token } = await registerAndLogin();
    const { project, secret } = await createGithubProject(token);

    const detail = await request(app).get(`/api/v1/projects/${project._id}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body)).not.toContain(secret);
    expect(detail.body.data.githubWebhookSecret).toBeUndefined();

    const integrations = await request(app)
      .get(`/api/v1/projects/${project._id}/integrations`)
      .set(auth(token));
    expect(integrations.body.data.webhookConfigured).toBe(true);
    expect(JSON.stringify(integrations.body)).not.toContain(secret);

    // The raw document also stores it select:false - verify via the model
    const rawDoc = await Project.findById(project._id).lean();
    expect(rawDoc.githubWebhookSecret).toBeUndefined();
  });
});
