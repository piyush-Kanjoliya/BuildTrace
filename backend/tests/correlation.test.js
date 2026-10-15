'use strict';

const {
  app,
  request,
  setupDb,
  teardownDb,
  registerAndLogin,
  createProject,
  createDeployment,
  createIncident,
  minutesAgo,
  auth,
} = require('./helpers');

beforeAll(setupDb);
afterAll(teardownDb);

function candidatesFor(token, incidentId) {
  return request(app).get(`/api/v1/incidents/${incidentId}/candidates`).set(auth(token));
}

describe('deployment correlation engine', () => {
  it('ranks candidates by transparent weighted factors with per-factor explanations', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const incident = await createIncident(token, project._id, {
      title: 'Checkout timeout errors spike',
      description: 'p99 latency on checkout',
      environment: 'production',
      affectedService: 'checkout-api',
    });

    const depClose = await createDeployment(token, project._id, {
      version: 'v-close',
      environment: 'production',
      service: 'checkout-api',
      commitMessage: 'fix checkout timeout retry logic',
      changedFiles: ['src/checkout/retry.ts', 'src/checkout/pool.ts', 'src/checkout/timeout.ts'],
      occurredAt: minutesAgo(5).toISOString(),
    });
    await createDeployment(token, project._id, {
      version: 'v-env-mismatch',
      environment: 'staging',
      service: 'checkout-api',
      occurredAt: minutesAgo(10).toISOString(),
    });
    await createDeployment(token, project._id, {
      version: 'v-far',
      environment: 'production',
      service: 'search-api',
      commitMessage: 'update search index scoring',
      occurredAt: minutesAgo(55).toISOString(),
    });

    const res = await candidatesFor(token, incident._id);
    expect(res.status).toBe(200);
    const { candidates, window, weights, methodology, noneFound } = res.body.data;

    expect(noneFound).toBe(false);
    expect(candidates).toHaveLength(3);
    expect(window.minutes).toBe(60);
    expect(methodology).toContain('suggestion engine');
    expect(weights.proximity + weights.environment + weights.service + weights.changeSignals).toBeCloseTo(1, 5);

    // Descending score order, and the closest + matching + keyword-sharing
    // deployment must win
    const scores = candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(String(candidates[0].deployment._id)).toBe(String(depClose._id));

    const close = candidates[0];
    expect(close.factors).toHaveLength(4);
    const byFactor = Object.fromEntries(close.factors.map((f) => [f.factor, f]));
    expect(byFactor.proximity.explanation).toMatch(/min before the incident/);
    expect(byFactor.environment.value).toBe(1);
    expect(byFactor.environment.explanation).toContain('same environment');
    expect(byFactor.service.value).toBe(1);
    expect(byFactor.service.explanation).toContain('checkout-api');
    expect(byFactor.change_signals.explanation).toMatch(/checkout|timeout/);
    expect(close.associatedByInvestigator).toBe(false);

    // The staging deployment scores below the production one (environment
    // mismatch only loses the 0.20 environment weight, everything else equal-ish)
    const envMismatch = candidates.find((c) => String(c.deployment._id) !== String(depClose._id)
      && c.deployment.environment === 'staging');
    expect(envMismatch.factors.find((f) => f.factor === 'environment').value).toBe(0);
    expect(envMismatch.score).toBeLessThan(close.score);
  });

  it('excludes deployments outside the window, failed builds, and dismissed candidates', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id, {
      title: 'Database connection pool exhaustion', environment: 'production',
    });

    const inWindow = await createDeployment(token, project._id, {
      version: 'v-in-window', environment: 'production', occurredAt: minutesAgo(20).toISOString(),
    });
    await createDeployment(token, project._id, {
      version: 'v-outside-window', environment: 'production', occurredAt: minutesAgo(90).toISOString(),
    });
    await createDeployment(token, project._id, {
      version: 'v-failed-build', environment: 'production', status: 'failed',
      occurredAt: minutesAgo(5).toISOString(),
    });
    const toDismiss = await createDeployment(token, project._id, {
      version: 'v-to-dismiss', environment: 'production', occurredAt: minutesAgo(15).toISOString(),
    });

    const initial = await candidatesFor(token, incident._id);
    const initialIds = initial.body.data.candidates.map((c) => String(c.deployment._id));
    expect(initialIds).toContain(String(inWindow._id));
    expect(initialIds).toContain(String(toDismiss._id));
    // outside-window and failed deployments must not appear
    expect(initial.body.data.candidates.every((c) => c.deployment.version !== 'v-outside-window')).toBe(true);
    expect(initial.body.data.candidates.every((c) => c.deployment.version !== 'v-failed-build')).toBe(true);

    const dismiss = await request(app)
      .post(`/api/v1/incidents/${incident._id}/deployments/dismiss`)
      .set(auth(token))
      .send({ deploymentId: toDismiss._id });
    expect(dismiss.status).toBe(200);

    const afterDismiss = await candidatesFor(token, incident._id);
    const afterIds = afterDismiss.body.data.candidates.map((c) => String(c.deployment._id));
    expect(afterIds).toContain(String(inWindow._id));
    expect(afterIds).not.toContain(String(toDismiss._id));
  });

  it('returns an explicit none-found payload when there is nothing to correlate', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id, { title: 'Isolated incident with no deploys' });

    const res = await candidatesFor(token, incident._id);
    expect(res.status).toBe(200);
    expect(res.body.data.noneFound).toBe(true);
    expect(res.body.data.candidates).toHaveLength(0);
    expect(res.body.data.noneFoundMessage).toMatch(/No successful deployment found/);
  });

  it('surfaces late-arriving deployments in candidates automatically', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id, {
      title: 'Payment webhook failures', environment: 'production', affectedService: 'payments-api',
    });

    const before = await candidatesFor(token, incident._id);
    expect(before.body.data.noneFound).toBe(true);

    // A deployment that happened 20 minutes ago is ingested only now
    const late = await request(app)
      .post('/api/v1/events')
      .set(auth(token))
      .send({
        projectId: project._id,
        eventType: 'deployment',
        externalId: 'late-deploy-event',
        occurredAt: minutesAgo(20).toISOString(),
        payload: {
          deployment: {
            identity: 'ci-late-1', version: 'v-late', environment: 'production',
            service: 'payments-api', status: 'success',
          },
        },
      });
    expect(late.status).toBe(202);
    expect(late.body.data.processingStatus).toBe('processed');

    const after = await candidatesFor(token, incident._id);
    expect(after.body.data.noneFound).toBe(false);
    expect(after.body.data.candidates).toHaveLength(1);
    const candidate = after.body.data.candidates[0];
    expect(candidate.deployment.version).toBe('v-late');
    expect(candidate.lateArrival).toBe(true);
    expect(candidate.score).toBeGreaterThan(0);
  });
});
