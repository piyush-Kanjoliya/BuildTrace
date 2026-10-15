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

function ingest(token, body) {
  return request(app).post('/api/v1/events').set(auth(token)).send(body);
}

/** ObjectIds compare correctly as equal-length hex strings. */
function isSortedAscending(ids) {
  return ids.every((id, i) => i === 0 || ids[i - 1] <= id);
}
function isSortedDescending(ids) {
  return ids.every((id, i) => i === 0 || ids[i - 1] >= id);
}

describe('timeline', () => {
  it('orders by occurrence time with a stable _id secondary key in both directions', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    // Three events with an IDENTICAL occurredAt - the tie must resolve by _id
    const sameTime = minutesAgo(30).toISOString();
    for (const n of [1, 2, 3]) {
      const res = await ingest(token, {
        projectId: project._id,
        eventType: 'commit',
        externalId: `tie-${n}`,
        occurredAt: sameTime,
        payload: { n },
      });
      expect(res.status).toBe(202);
    }
    // Plus one strictly newer deployment event
    await createDeployment(token, project._id, {
      version: 'v-timeline', environment: 'production', occurredAt: minutesAgo(5).toISOString(),
    });

    const desc = await request(app)
      .get(`/api/v1/projects/${project._id}/timeline`)
      .query({ limit: 50 })
      .set(auth(token));
    expect(desc.status).toBe(200);
    const descItems = desc.body.data.items;
    expect(descItems.length).toBeGreaterThanOrEqual(4);

    const descTimes = descItems.map((e) => new Date(e.occurredAt).getTime());
    expect(isSortedDescending(descTimes)).toBe(true);

    const tieItemsDesc = descItems.filter((e) => String(e.externalId || '').startsWith('tie-'));
    expect(tieItemsDesc).toHaveLength(3);
    const tieIdsDesc = tieItemsDesc.map((e) => e._id);
    expect(isSortedDescending(tieIdsDesc)).toBe(true); // stable tie-break

    const asc = await request(app)
      .get(`/api/v1/projects/${project._id}/timeline`)
      .query({ limit: 50, order: 'asc' })
      .set(auth(token));
    const ascItems = asc.body.data.items;
    const ascTimes = ascItems.map((e) => new Date(e.occurredAt).getTime());
    expect(isSortedAscending(ascTimes)).toBe(true);

    const tieItemsAsc = ascItems.filter((e) => String(e.externalId || '').startsWith('tie-'));
    expect(tieItemsAsc.map((e) => e._id)).toEqual([...tieIdsDesc].reverse());

    // Ascending order starts with the oldest event of the set
    expect(ascTimes[0]).toBeLessThanOrEqual(descTimes[descTimes.length - 1] + 1);
  });

  it('flags late-arriving and uncertain-timestamp events on the timeline', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    await ingest(token, {
      projectId: project._id,
      eventType: 'rollback',
      externalId: 'late-rollback',
      occurredAt: minutesAgo(90).toISOString(),
      payload: { reason: 'reverted bad config' },
    });
    await ingest(token, {
      projectId: project._id,
      eventType: 'other',
      externalId: 'uncertain-1',
      payload: { note: 'no clock on this agent' },
    });

    const res = await request(app)
      .get(`/api/v1/projects/${project._id}/timeline`)
      .set(auth(token));
    const items = res.body.data.items;

    const late = items.find((e) => e.externalId === 'late-rollback');
    expect(late.lateArrival).toBe(true);
    expect(late.timestampUncertain).toBe(false);
    expect(late.receiptDelayMinutes).toBeGreaterThanOrEqual(89);

    const uncertain = items.find((e) => e.externalId === 'uncertain-1');
    expect(uncertain.lateArrival).toBe(false);
    expect(uncertain.timestampUncertain).toBe(true);
    expect(uncertain.occurredAtOriginal).toBeTruthy();
  });

  it('filters by event type and reports per-type counts', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    await createDeployment(token, project._id, { version: 'v-t1', environment: 'production' });
    await createDeployment(token, project._id, { version: 'v-t2', environment: 'production' });
    await createIncident(token, project._id, { title: 'Timeline filter incident' });

    const all = await request(app)
      .get(`/api/v1/projects/${project._id}/timeline`)
      .set(auth(token));
    expect(all.status).toBe(200);
    expect(all.body.data.typeCounts.deployment).toBe(2);
    expect(all.body.data.typeCounts.incident).toBe(1);
    expect(all.body.data.availableTypes).toContain('deployment');

    const onlyDeployments = await request(app)
      .get(`/api/v1/projects/${project._id}/timeline`)
      .query({ types: 'deployment' })
      .set(auth(token));
    expect(onlyDeployments.body.data.total).toBe(2);
    expect(onlyDeployments.body.data.items.every((e) => e.eventType === 'deployment')).toBe(true);
  });

  it('keeps incident lifecycle activity in the timeline', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id, { title: 'Lifecycle timeline incident' });

    await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(token))
      .send({ version: 0, status: 'investigating' });
    await request(app)
      .post(`/api/v1/incidents/${incident._id}/updates`)
      .set(auth(token))
      .send({ content: 'first responder on it' });

    const res = await request(app)
      .get(`/api/v1/projects/${project._id}/timeline`)
      .query({ types: ['incident', 'incident_update', 'comment'] })
      .set(auth(token));
    expect(res.status).toBe(200);
    const types = res.body.data.items.map((e) => e.eventType);
    expect(types).toContain('incident');
    expect(types).toContain('incident_update');
    expect(types).toContain('comment');
  });
});
