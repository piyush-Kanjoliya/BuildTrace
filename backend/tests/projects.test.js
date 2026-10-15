'use strict';

const {
  app,
  request,
  setupDb,
  teardownDb,
  registerAndLogin,
  createUser,
  login,
  auth,
  createProject,
} = require('./helpers');
const Deployment = require('../src/models/Deployment');
const Incident = require('../src/models/Incident');

beforeAll(setupDb);
afterAll(teardownDb);

describe('projects', () => {
  it('creates a project; creator becomes project admin', async () => {
    const { token, user } = await registerAndLogin();
    const res = await request(app)
      .post('/api/v1/projects')
      .set(auth(token))
      .send({ name: 'My Platform', description: 'desc', environments: ['production'] });
    expect(res.status).toBe(201);
    const project = res.body.data.project;
    expect(project.slug).toBe('my-platform');
    const me = project.members.find((m) => String(m.user.id || m.user._id) === String(user.id));
    expect(me.role).toBe('admin');
  });

  it('validates creation: missing name -> 422, bad repositoryUrl -> 422', async () => {
    const { token } = await registerAndLogin();
    const missing = await request(app).post('/api/v1/projects').set(auth(token)).send({ description: 'x' });
    expect(missing.status).toBe(422);

    const badUrl = await request(app)
      .post('/api/v1/projects')
      .set(auth(token))
      .send({ name: 'Bad Repo', repositoryUrl: 'not-a-url' });
    expect(badUrl.status).toBe(422);
  });

  it('scopes the project list to memberships (non-admin)', async () => {
    const alice = await registerAndLogin();
    const bob = await registerAndLogin();
    await createProject(alice.token, { name: 'Alice Only' });

    const bobList = await request(app).get('/api/v1/projects').set(auth(bob.token));
    expect(bobList.status).toBe(200);
    expect(bobList.body.data.items).toHaveLength(0);

    const aliceList = await request(app).get('/api/v1/projects').set(auth(alice.token));
    expect(aliceList.body.data.items).toHaveLength(1);
  });

  it('enforces roles: developer cannot update, admin can', async () => {
    const admin = await registerAndLogin();
    const dev = await registerAndLogin();
    const project = await createProject(admin.token);

    // add dev as developer member
    const add = await request(app)
      .post(`/api/v1/projects/${project._id}/members`)
      .set(auth(admin.token))
      .send({ email: dev.payload.email, role: 'developer' });
    expect(add.status).toBe(201);

    const devPatch = await request(app)
      .patch(`/api/v1/projects/${project._id}`)
      .set(auth(dev.token))
      .send({ description: 'hacked' });
    expect(devPatch.status).toBe(403);

    const adminPatch = await request(app)
      .patch(`/api/v1/projects/${project._id}`)
      .set(auth(admin.token))
      .send({ description: 'updated by admin' });
    expect(adminPatch.status).toBe(200);
    expect(adminPatch.body.data.description).toBe('updated by admin');
  });

  it('cannot demote or remove the last project admin', async () => {
    const admin = await registerAndLogin();
    const project = await createProject(admin.token);

    const demote = await request(app)
      .patch(`/api/v1/projects/${project._id}/members/${admin.user.id}`)
      .set(auth(admin.token))
      .send({ role: 'developer' });
    expect(demote.status).toBe(409);

    const remove = await request(app)
      .delete(`/api/v1/projects/${project._id}/members/${admin.user.id}`)
      .set(auth(admin.token));
    expect(remove.status).toBe(409);
  });

  it('rejects invalid and unknown project ids', async () => {
    const { token } = await registerAndLogin();
    const invalid = await request(app).get('/api/v1/projects/not-an-id').set(auth(token));
    expect(invalid.status).toBe(400);

    const unknown = await request(app).get('/api/v1/projects/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(token));
    expect(unknown.status).toBe(404);
  });

  it('cascades deletion of deployments, incidents, updates and events', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const dep = await request(app)
      .post(`/api/v1/projects/${project._id}/deployments`)
      .set(auth(token))
      .send({ version: 'v1', environment: 'production' });
    expect(dep.status).toBe(201);

    const inc = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({ title: 'Something broke badly' });
    expect(inc.status).toBe(201);

    const del = await request(app).delete(`/api/v1/projects/${project._id}`).set(auth(token));
    expect(del.status).toBe(200);
    expect(del.body.data.deleted.deployments).toBe(1);
    expect(del.body.data.deleted.incidents).toBe(1);

    expect(await Deployment.countDocuments({ projectId: project._id })).toBe(0);
    expect(await Incident.countDocuments({ projectId: project._id })).toBe(0);
  });

  it('lets a global admin see and manage projects they are not a member of', async () => {
    const owner = await registerAndLogin();
    const project = await createProject(owner.token);

    await createUser({ email: 'global-admin@test.dev', role: 'admin' });
    const adminToken = await login('global-admin@test.dev', 'Password123!');

    const read = await request(app).get(`/api/v1/projects/${project._id}`).set(auth(adminToken));
    expect(read.status).toBe(200);

    const patch = await request(app)
      .patch(`/api/v1/projects/${project._id}`)
      .set(auth(adminToken))
      .send({ description: 'admin intervention' });
    expect(patch.status).toBe(200);
  });
});
