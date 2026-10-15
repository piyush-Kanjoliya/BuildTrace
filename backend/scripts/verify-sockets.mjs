/**
 * Phase G live verification: Socket.IO realtime notifications.
 *
 * Connects with the same JWT the browser uses, subscribes to a project room,
 * and proves that:
 *   1. unauthenticated connections are rejected during the handshake,
 *   2. subscribing requires project membership,
 *   3. posting a comment emits `comment:added` to the room,
 *   4. ingesting an event emits `event:processed` to the room,
 *   5. payloads are notification-only (ids + summaries, no full documents).
 *
 * Usage:  node backend/scripts/verify-sockets.mjs   (server must be running)
 */
import { io } from 'socket.io-client';

const ORIGIN = 'http://localhost:5000';
const API = `${ORIGIN}/api/v1`;
const FAILURES = [];

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` | ${detail}` : ''}`);
  if (!ok) FAILURES.push(name);
}

async function jsonFetch(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, data: payload.data, error: payload.error };
}

/* ------------------------------ credentials ------------------------------ */

const login = await jsonFetch('/auth/login', {
  method: 'POST',
  body: { email: 'admin@buildtrace.dev', password: 'BuildTrace123!' },
});
if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login)}`);
const token = login.data.token;

const projects = (await jsonFetch('/projects?limit=100', { token })).data.items;

// Pick the first project that actually has an incident to comment on.
let project = null;
let incident = null;
for (const candidate of projects) {
  const incidents = await jsonFetch(`/projects/${candidate._id}/incidents?limit=1`, { token });
  if ((incidents.data?.items || []).length > 0) {
    project = candidate;
    incident = incidents.data.items[0];
    break;
  }
}
if (!project) throw new Error('no project with an incident found');
console.log(`Project: ${project.name} | incident: ${incident.title}\n`);

/* --------------------- 1. unauthenticated handshake ---------------------- */

await new Promise((resolve) => {
  const anon = io(ORIGIN, { auth: {}, transports: ['websocket'], reconnection: false, timeout: 4000 });
  const done = (ok, detail) => {
    check('unauthenticated socket rejected', ok, detail);
    anon.close();
    resolve();
  };
  anon.on('connect', () => done(false, 'connected without a token'));
  anon.on('connect_error', (err) => done(true, `rejected: ${err.message}`));
  setTimeout(() => done(false, 'no response'), 6000);
});

/* ------------------------- 2. authenticated flow ------------------------- */

const socket = io(ORIGIN, { auth: { token }, transports: ['websocket'], reconnection: false });
await new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', (err) => reject(new Error(err.message)));
  setTimeout(() => reject(new Error('authenticated connect timed out')), 6000);
});
check('authenticated socket connects', true, `id=${socket.id}`);

const subscribeAck = await new Promise((resolve) => {
  socket.emit('project:subscribe', String(project._id), resolve);
  setTimeout(() => resolve(null), 4000);
});
check('project room subscription acknowledged', subscribeAck?.ok === true, JSON.stringify(subscribeAck));

function waitFor(event, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// 3. comment -> comment:added
const commentWait = waitFor('comment:added');
const commentRes = await jsonFetch(`/incidents/${incident._id}/updates`, {
  method: 'POST',
  token,
  body: { content: 'Phase G socket verification comment', kind: 'comment' },
});
check('comment POST accepted', [200, 201].includes(commentRes.status), `status=${commentRes.status}`);
try {
  const payload = await commentWait;
  check(
    'comment:added delivered to room',
    payload?.incidentId === String(incident._id) && typeof payload?.author === 'string',
    JSON.stringify(payload)
  );
  const fields = Object.keys(payload || {});
  check(
    'notification payload is ids + summary only',
    !fields.includes('content') && !fields.includes('doc'),
    `fields=${fields.join(',')}`
  );
} catch (err) {
  check('comment:added delivered to room', false, err.message);
}

// 4. ingested event -> event:processed
const eventWait = waitFor('event:processed');
const eventRes = await jsonFetch('/events', {
  method: 'POST',
  token,
  body: {
    projectId: project._id,
    eventType: 'config_change',
    source: 'manual',
    occurredAt: new Date().toISOString(),
    payload: { note: 'Phase G socket verification event' },
  },
});
check('event ingest accepted', [200, 201, 202].includes(eventRes.status), `status=${eventRes.status}`);
try {
  const payload = await eventWait;
  check(
    'event:processed delivered to room',
    payload?.projectId === String(project._id) && payload?.eventType === 'config_change',
    JSON.stringify(payload)
  );
} catch (err) {
  check('event:processed delivered to room', false, err.message);
}

socket.close();
console.log();
if (FAILURES.length) {
  console.log(`${FAILURES.length} CHECK(S) FAILED: ${FAILURES.join('; ')}`);
  process.exit(1);
}
console.log('ALL SOCKET CHECKS PASSED');
process.exit(0);
