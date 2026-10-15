'use strict';

const {
  app,
  request,
  setupDb,
  teardownDb,
  registerAndLogin,
  createProject,
  createDeployment,
  minutesAgo,
  auth,
} = require('./helpers');

beforeAll(setupDb);
afterAll(teardownDb);

/** Add a user to a project with the given role. */
async function addMember(adminToken, projectId, email, role) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set(auth(adminToken))
    .send({ email, role });
  if (res.status !== 201) throw new Error(`addMember failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

describe('deployments', () => {
  it('creates a manual deployment, normalizes data and validates the environment', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/deployments`)
      .set(auth(token))
      .send({
        version: 'v2.1.0',
        environment: 'production',
        service: 'checkout-api',
        commitSha: 'A1B2C3D4E5F6AA',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe('v2.1.0');
    expect(res.body.data.status).toBe('success'); // default for manual entries
    expect(res.body.data.commitSha).toBe('a1b2c3d4e5f6aa'); // lowercased by the model
    expect(res.body.data.source).toBe('manual');
    expect(res.body.data.occurredAtTrusted).toBe(true);

    const badEnv = await request(app)
      .post(`/api/v1/projects/${project._id}/deployments`)
      .set(auth(token))
      .send({ version: 'v3', environment: 'qa-undefined' });
    expect(badEnv.status).toBe(422);
    expect(badEnv.body.error.details.some((d) => d.path === 'environment')).toBe(true);
  });

  it('rejects deployment creation for viewers and non-members', async () => {
    const admin = await registerAndLogin();
    const viewer = await registerAndLogin();
    const outsider = await registerAndLogin();
    const project = await createProject(admin.token);
    await addMember(admin.token, project._id, viewer.payload.email, 'viewer');

    const asViewer = await request(app)
      .post(`/api/v1/projects/${project._id}/deployments`)
      .set(auth(viewer.token))
      .send({ version: 'v1', environment: 'production' });
    expect(asViewer.status).toBe(403);

    const asOutsider = await request(app)
      .post(`/api/v1/projects/${project._id}/deployments`)
      .set(auth(outsider.token))
      .send({ version: 'v1', environment: 'production' });
    expect(asOutsider.status).toBe(403);
  });

  it('lists project deployments with environment, status and author filters', async () => {
    const admin = await registerAndLogin({ name: 'Filter Author' });
    const project = await createProject(admin.token);

    await createDeployment(admin.token, project._id, {
      version: 'v-prod-ok', environment: 'production', status: 'success',
    });
    await createDeployment(admin.token, project._id, {
      version: 'v-staging-fail', environment: 'staging', status: 'failed',
    });
    await createDeployment(admin.token, project._id, {
      version: 'v-prod-fail', environment: 'production', status: 'failed',
    });

    const byEnv = await request(app)
      .get(`/api/v1/projects/${project._id}/deployments`)
      .query({ environment: 'production' })
      .set(auth(admin.token));
    expect(byEnv.status).toBe(200);
    expect(byEnv.body.data.total).toBe(2);
    expect(byEnv.body.data.items.every((d) => d.environment === 'production')).toBe(true);

    const byStatus = await request(app)
      .get(`/api/v1/projects/${project._id}/deployments`)
      .query({ status: 'failed' })
      .set(auth(admin.token));
    expect(byStatus.body.data.total).toBe(2);

    const byAuthor = await request(app)
      .get(`/api/v1/projects/${project._id}/deployments`)
      .query({ author: 'filter author' })
      .set(auth(admin.token));
    expect(byAuthor.body.data.total).toBe(3);

    const noMatch = await request(app)
      .get(`/api/v1/projects/${project._id}/deployments`)
      .query({ author: 'nobody' })
      .set(auth(admin.token));
    expect(noMatch.body.data.total).toBe(0);
  });

  it('scopes the global deployment list to memberships', async () => {
    const alice = await registerAndLogin();
    const bob = await registerAndLogin();
    const project = await createProject(alice.token);
    await createDeployment(alice.token, project._id);

    const aliceList = await request(app).get('/api/v1/deployments').set(auth(alice.token));
    expect(aliceList.status).toBe(200);
    expect(aliceList.body.data.total).toBe(1);
    expect(aliceList.body.data.items[0].projectId.name).toBe(project.name);

    const bobList = await request(app).get('/api/v1/deployments').set(auth(bob.token));
    expect(bobList.body.data.total).toBe(0);

    // Explicit projectId the user cannot access must not leak data
    const bobScoped = await request(app)
      .get('/api/v1/deployments')
      .query({ projectId: project._id })
      .set(auth(bob.token));
    expect(bobScoped.status).toBe(403);
  });

  it('returns deployment details with associated and potential incidents', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const deployment = await createDeployment(token, project._id, {
      version: 'v-detail', environment: 'production', occurredAt: minutesAgo(20).toISOString(),
    });

    // Incident 1: will be explicitly associated by the investigator.
    const inc1 = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({ title: 'Associated incident for the deployment', environment: 'production' });
    await request(app)
      .post(`/api/v1/incidents/${inc1.body.data._id}/deployments/associate`)
      .set(auth(token))
      .send({ deploymentId: deployment._id });

    // Incident 2: only temporally near the deployment - "potential".
    await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({ title: 'Potential incident near the deployment', environment: 'production' });

    const detail = await request(app).get(`/api/v1/deployments/${deployment._id}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.deployment._id).toBe(deployment._id);
    const { associated, potential } = detail.body.data.relatedIncidents;
    expect(associated).toHaveLength(1);
    expect(associated[0].relation).toBe('associated');
    expect(potential.length).toBeGreaterThanOrEqual(1);
    expect(potential.every((i) => i.relation === 'potential')).toBe(true);
  });

  it('updates a deployment for developers but rejects viewers', async () => {
    const admin = await registerAndLogin();
    const dev = await registerAndLogin();
    const viewer = await registerAndLogin();
    const project = await createProject(admin.token);
    await addMember(admin.token, project._id, dev.payload.email, 'developer');
    await addMember(admin.token, project._id, viewer.payload.email, 'viewer');

    const deployment = await createDeployment(dev.token, project._id, { version: 'v-old' });

    const devPatch = await request(app)
      .patch(`/api/v1/deployments/${deployment._id}`)
      .set(auth(dev.token))
      .send({ status: 'rolled_back', commitMessage: 'rolled back after incident' });
    expect(devPatch.status).toBe(200);
    expect(devPatch.body.data.status).toBe('rolled_back');

    const viewerPatch = await request(app)
      .patch(`/api/v1/deployments/${deployment._id}`)
      .set(auth(viewer.token))
      .send({ status: 'success' });
    expect(viewerPatch.status).toBe(403);

    const emptyPatch = await request(app)
      .patch(`/api/v1/deployments/${deployment._id}`)
      .set(auth(dev.token))
      .send({});
    expect(emptyPatch.status).toBe(422);
  });
});
