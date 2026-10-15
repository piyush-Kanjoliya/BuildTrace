'use strict';

const {
  app,
  request,
  setupDb,
  teardownDb,
  registerAndLogin,
  createProject,
  auth,
} = require('./helpers');
const Event = require('../src/models/Event');

beforeAll(setupDb);
afterAll(teardownDb);

/** Rotate (or create) a project ingest key and return the plaintext key. */
async function rotateIngestKey(token, projectId) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/integrations/ingest-key`)
    .set(auth(token))
    .send();
  if (res.status !== 200) throw new Error(`rotateIngestKey failed: ${JSON.stringify(res.body)}`);
  return res.body.data.key;
}

function ingestWithKey(key, body) {
  return request(app).post('/api/v1/events').set('X-Ingest-Key', key).send(body);
}

describe('event ingestion via project X-Ingest-Key', () => {
  it('accepts a valid ingest key for its own project', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const key = await rotateIngestKey(token, project._id);

    const res = await ingestWithKey(key, {
      projectId: project._id,
      eventType: 'config_change',
      source: 'api',
      payload: { note: 'from CI' },
    });

    expect(res.status).toBe(202);
    expect(res.body.data.duplicate).toBe(false);
    expect(res.body.data.event).toBeTruthy();

    const stored = await Event.findById(res.body.data.event._id).lean();
    expect(stored.projectId.toString()).toBe(project._id);
    expect(stored.source).toBe('api');
  });

  it('rejects an ingest key used against a different project', async () => {
    const { token } = await registerAndLogin();
    const own = await createProject(token);
    const other = await createProject(token);
    const key = await rotateIngestKey(token, own._id);

    const res = await ingestWithKey(key, {
      projectId: other._id,
      eventType: 'config_change',
      source: 'api',
      payload: {},
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an unknown ingest key with 401', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await ingestWithKey('btin_does_not_exist', {
      projectId: project._id,
      eventType: 'config_change',
      source: 'api',
      payload: {},
    });

    expect(res.status).toBe(401);
  });

  it('rejects a request with neither a JWT nor an ingest key', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await request(app)
      .post('/api/v1/events')
      .send({ projectId: project._id, eventType: 'config_change', source: 'api', payload: {} });

    expect(res.status).toBe(401);
  });

  it('still authenticates the JWT path (regression)', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await request(app)
      .post('/api/v1/events')
      .set(auth(token))
      .send({ projectId: project._id, eventType: 'config_change', source: 'manual', payload: {} });

    expect(res.status).toBe(202);
  });
});
