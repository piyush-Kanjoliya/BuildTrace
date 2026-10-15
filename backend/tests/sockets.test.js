'use strict';

const http = require('http');
const { io: createClient } = require('socket.io-client');
const {
  app,
  request,
  setupDb,
  teardownDb,
  registerAndLogin,
  createProject,
  auth,
} = require('./helpers');
const { initSockets, closeSockets } = require('../src/sockets');

let server;
let baseUrl;

beforeAll(async () => {
  await setupDb();
  server = http.createServer(app);
  initSockets(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await closeSockets();
  await new Promise((resolve) => server.close(() => resolve()));
  await teardownDb();
});

function connect(token) {
  const socket = createClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    auth: token ? { token } : {},
  });
  socket.connect();
  return socket;
}

function waitFor(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function subscribe(socket, projectId) {
  return new Promise((resolve) => socket.emit('project:subscribe', projectId, resolve));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('socket.io real-time notifications', () => {
  it('rejects connections without a valid JWT', async () => {
    const anonymous = connect(null);
    const anonymousError = await waitFor(anonymous, 'connect_error');
    expect(anonymousError.message).toBe('Authentication required');
    anonymous.close();

    const forged = connect('this-is-not-a-valid-token');
    const forgedError = await waitFor(forged, 'connect_error');
    expect(forgedError.message).toMatch(/Invalid or expired/);
    forged.close();
  });

  it('broadcasts incident:created to project members only, in real time', async () => {
    const owner = await registerAndLogin();
    const viewer = await registerAndLogin();
    const outsider = await registerAndLogin();
    const project = await createProject(owner.token);

    const addMember = await request(app)
      .post(`/api/v1/projects/${project._id}/members`)
      .set(auth(owner.token))
      .send({ email: viewer.payload.email, role: 'viewer' });
    expect(addMember.status).toBe(201);

    const ownerSocket = connect(owner.token);
    const viewerSocket = connect(viewer.token);
    const outsiderSocket = connect(outsider.token);
    await Promise.all([
      waitFor(ownerSocket, 'connect'),
      waitFor(viewerSocket, 'connect'),
      waitFor(outsiderSocket, 'connect'),
    ]);

    // Members can subscribe; non-members are explicitly rejected
    const ownerAck = await subscribe(ownerSocket, project._id);
    const viewerAck = await subscribe(viewerSocket, project._id);
    const outsiderAck = await subscribe(outsiderSocket, project._id);
    expect(ownerAck.ok).toBe(true);
    expect(viewerAck.ok).toBe(true);
    expect(outsiderAck.ok).toBe(false);

    let outsiderReceived = false;
    outsiderSocket.on('incident:created', () => {
      outsiderReceived = true;
    });

    // Trigger the incident through the real REST API - the same process that
    // owns the socket server - and verify both member sockets get notified
    const incidentCreated = waitFor(ownerSocket, 'incident:created');
    const viewerNotified = waitFor(viewerSocket, 'incident:created');
    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(owner.token))
      .send({ title: 'Realtime broadcast incident', severity: 'SEV2' });
    expect(res.status).toBe(201);

    const payload = await incidentCreated;
    const viewerPayload = await viewerNotified;
    expect(payload.title).toBe('Realtime broadcast incident');
    expect(payload.projectId).toBe(project._id);
    expect(String(payload.incidentId)).toBe(String(res.body.data._id));
    expect(viewerPayload.incidentId).toBe(payload.incidentId);

    // The non-member must NOT have received anything
    await sleep(300);
    expect(outsiderReceived).toBe(false);

    ownerSocket.close();
    viewerSocket.close();
    outsiderSocket.close();
  });

  it('broadcasts comment:added for incident activity', async () => {
    const owner = await registerAndLogin();
    const project = await createProject(owner.token);
    const incident = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(owner.token))
      .send({ title: 'Comment broadcast incident' });

    const socket = connect(owner.token);
    await waitFor(socket, 'connect');
    const ack = await subscribe(socket, project._id);
    expect(ack.ok).toBe(true);

    const notified = waitFor(socket, 'comment:added');
    const res = await request(app)
      .post(`/api/v1/incidents/${incident.body.data._id}/updates`)
      .set(auth(owner.token))
      .send({ content: 'Realtime comment from a responder' });
    expect(res.status).toBe(201);

    const payload = await notified;
    expect(payload.incidentId).toBe(String(incident.body.data._id));
    expect(payload.author).toBeTruthy();

    socket.close();
  });
});
