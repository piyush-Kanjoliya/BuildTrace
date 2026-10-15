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

async function addMember(adminToken, projectId, email, role) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set(auth(adminToken))
    .send({ email, role });
  if (res.status !== 201) throw new Error(`addMember failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

describe('incidents', () => {
  it('creates an incident with defaults, a normalized signature and validation', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    const res = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({
        title: 'Checkout timeout errors spike',
        description: 'p99 latency crossed 8s',
        severity: 'SEV2',
        environment: 'production',
        affectedService: 'checkout-api',
      });
    expect(res.status).toBe(201);
    const incident = res.body.data;
    expect(incident.status).toBe('open');
    expect(incident.severity).toBe('SEV2');
    expect(incident.version).toBe(0);
    expect(incident.signature).toBeTruthy(); // stored for recurring detection
    expect(incident.resolvedAt).toBeNull();

    const badEnv = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({ title: 'Env mismatch incident', environment: 'nope-env' });
    expect(badEnv.status).toBe(422);

    const badSeverity = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({ title: 'Bad severity incident', severity: 'SEV9' });
    expect(badSeverity.status).toBe(422);

    const badAssignee = await request(app)
      .post(`/api/v1/projects/${project._id}/incidents`)
      .set(auth(token))
      .send({ title: 'Bad assignee incident', assigneeId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(badAssignee.status).toBe(422);
  });

  it('lists incidents with search, status and severity filters', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);

    await createIncident(token, project._id, {
      title: 'Database connection pool exhaustion', severity: 'SEV1',
    });
    await createIncident(token, project._id, {
      title: 'Checkout latency creep', severity: 'SEV3',
    });
    const c = await createIncident(token, project._id, {
      title: 'Webhook delivery failures', severity: 'SEV2',
    });
    // Move one incident to investigating so the status filter has signal
    await request(app)
      .patch(`/api/v1/incidents/${c._id}`)
      .set(auth(token))
      .send({ version: 0, status: 'investigating' });

    const search = await request(app)
      .get(`/api/v1/projects/${project._id}/incidents`)
      .query({ q: 'connection pool' })
      .set(auth(token));
    expect(search.status).toBe(200);
    expect(search.body.data.total).toBe(1);
    expect(search.body.data.items[0].title).toBe('Database connection pool exhaustion');

    const bySeverity = await request(app)
      .get(`/api/v1/projects/${project._id}/incidents`)
      .query({ severity: 'SEV1' })
      .set(auth(token));
    expect(bySeverity.body.data.total).toBe(1);

    const byStatus = await request(app)
      .get(`/api/v1/projects/${project._id}/incidents`)
      .query({ status: ['open', 'investigating'] })
      .set(auth(token));
    expect(byStatus.body.data.total).toBe(3);

    // Global list (no project scope) must still only show the user's projects
    const global = await request(app).get('/api/v1/incidents').set(auth(token));
    expect(global.status).toBe(200);
    expect(global.body.data.total).toBe(3);
  });

  it('uses optimistic concurrency: a stale version is rejected with 409', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id);

    const first = await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(token))
      .send({ version: 0, title: 'Checkout timeout errors spike (updated)' });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(1);

    // Second writer still holds version 0 -> conflict, and the error reports both versions
    const stale = await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(token))
      .send({ version: 0, severity: 'SEV1' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(1);
    expect(stale.body.error.details.submittedVersion).toBe(0);

    const retryWithFresh = await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(token))
      .send({ version: 1, severity: 'SEV1' });
    expect(retryWithFresh.status).toBe(200);
    expect(retryWithFresh.body.data.severity).toBe('SEV1');

    const missingVersion = await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(token))
      .send({ severity: 'SEV2' });
    expect(missingVersion.status).toBe(422);
  });

  it('validates status transitions and requires a resolution before resolving', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id);
    const base = `/api/v1/incidents/${incident._id}`;

    // resolving without a resolution text -> 422
    const noResolution = await request(app)
      .patch(base)
      .set(auth(token))
      .send({ version: 0, status: 'resolved' });
    expect(noResolution.status).toBe(422);
    expect(noResolution.body.error.details.some((d) => d.path === 'resolution')).toBe(true);

    // open -> monitoring is allowed
    const monitoring = await request(app)
      .patch(base)
      .set(auth(token))
      .send({ version: 0, status: 'monitoring' });
    expect(monitoring.status).toBe(200);

    // monitoring -> resolved with a resolution
    const resolved = await request(app)
      .patch(base)
      .set(auth(token))
      .send({ version: 1, status: 'resolved', resolution: 'Rolled back v2.1.0 and cleared the queue.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('resolved');
    expect(resolved.body.data.resolvedAt).toBeTruthy();

    // resolved -> monitoring is NOT a legal transition
    const illegal = await request(app)
      .patch(base)
      .set(auth(token))
      .send({ version: 2, status: 'monitoring' });
    expect(illegal.status).toBe(422);

    // resolved -> open (reopen) is allowed and clears resolvedAt
    const reopened = await request(app)
      .patch(base)
      .set(auth(token))
      .send({ version: 2, status: 'open' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.resolvedAt).toBeNull();
  });

  it('records comments and a full audit trail', async () => {
    const { token, user } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id);
    const base = `/api/v1/incidents/${incident._id}`;

    const comment = await request(app)
      .post(`${base}/updates`)
      .set(auth(token))
      .send({ content: 'Investigating: the queue depth grew right after the deploy.' });
    expect(comment.status).toBe(201);
    expect(comment.body.data.kind).toBe('comment');
    expect(comment.body.data.authorId._id || comment.body.data.authorId).toBe(user.id);

    await request(app)
      .patch(base)
      .set(auth(token))
      .send({ version: 0, status: 'investigating', rootCause: 'Connection pool too small after traffic shift.' });

    const updates = await request(app).get(`${base}/updates`).set(auth(token));
    expect(updates.status).toBe(200);
    const kinds = updates.body.data.items.map((u) => u.kind);
    expect(kinds).toContain('comment');
    expect(kinds).toContain('status_change');
    // conversation order is chronological
    const created = updates.body.data.items.map((u) => new Date(u.createdAt).getTime());
    expect([...created].sort((x, y) => x - y)).toEqual(created);

    const audit = await request(app).get(`${base}/audit-logs`).set(auth(token));
    expect(audit.status).toBe(200);
    const actions = audit.body.data.items.map((a) => a.action);
    expect(actions).toContain('incident.created');
    expect(actions).toContain('incident.updated');
    expect(actions).toContain('incident.comment_added');
    const updatedEntry = audit.body.data.items.find((a) => a.action === 'incident.updated');
    expect(updatedEntry.before.status).toBe('open');
    expect(updatedEntry.after.status).toBe('investigating');
    expect(String(updatedEntry.actorId._id || updatedEntry.actorId)).toBe(user.id);
  });

  it('associates and dismisses candidate deployments, with audit records', async () => {
    const { token } = await registerAndLogin();
    const project = await createProject(token);
    const incident = await createIncident(token, project._id, { environment: 'production' });
    const dep1 = await createDeployment(token, project._id, {
      version: 'v-dep-1', environment: 'production', occurredAt: minutesAgo(10).toISOString(),
    });
    const dep2 = await createDeployment(token, project._id, {
      version: 'v-dep-2', environment: 'production', occurredAt: minutesAgo(15).toISOString(),
    });

    const associate = await request(app)
      .post(`/api/v1/incidents/${incident._id}/deployments/associate`)
      .set(auth(token))
      .send({ deploymentId: dep1._id });
    expect(associate.status).toBe(200);
    expect(associate.body.data.deploymentIds.map(String)).toContain(dep1._id);

    const duplicate = await request(app)
      .post(`/api/v1/incidents/${incident._id}/deployments/associate`)
      .set(auth(token))
      .send({ deploymentId: dep1._id });
    expect(duplicate.status).toBe(409);

    const unknown = await request(app)
      .post(`/api/v1/incidents/${incident._id}/deployments/associate`)
      .set(auth(token))
      .send({ deploymentId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(unknown.status).toBe(404);

    // Dismissing removes the deployment from candidate results entirely
    const dismiss = await request(app)
      .post(`/api/v1/incidents/${incident._id}/deployments/dismiss`)
      .set(auth(token))
      .send({ deploymentId: dep2._id });
    expect(dismiss.status).toBe(200);
    expect(dismiss.body.data.dismissedDeploymentIds.map(String)).toContain(dep2._id);

    const candidates = await request(app)
      .get(`/api/v1/incidents/${incident._id}/candidates`)
      .set(auth(token));
    expect(candidates.status).toBe(200);
    const candidateIds = candidates.body.data.candidates.map((c) => String(c.deployment._id));
    expect(candidateIds).toContain(dep1._id);
    expect(candidateIds).not.toContain(dep2._id);
    const associatedCandidate = candidates.body.data.candidates.find(
      (c) => String(c.deployment._id) === dep1._id
    );
    expect(associatedCandidate.associatedByInvestigator).toBe(true);

    // The incident detail exposes associated deployments and the audit trail records everything
    const detail = await request(app).get(`/api/v1/incidents/${incident._id}`).set(auth(token));
    expect(detail.body.data.associatedDeployments.map((d) => String(d._id))).toContain(dep1._id);
    expect(detail.body.data.yourProjectRole).toBe('admin');

    const audit = await request(app).get(`/api/v1/incidents/${incident._id}/audit-logs`).set(auth(token));
    const actions = audit.body.data.items.map((a) => a.action);
    expect(actions).toContain('incident.deployment_associated');
    expect(actions).toContain('incident.deployment_dismissed');
  });

  it('enforces RBAC: viewers cannot write, only admins can delete', async () => {
    const admin = await registerAndLogin();
    const dev = await registerAndLogin();
    const viewer = await registerAndLogin();
    const project = await createProject(admin.token);
    await addMember(admin.token, project._id, dev.payload.email, 'developer');
    await addMember(admin.token, project._id, viewer.payload.email, 'viewer');

    const incident = await createIncident(admin.token, project._id);

    // Viewer: read-only. Cannot update, comment, or transition.
    const viewerPatch = await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(viewer.token))
      .send({ version: 0, title: 'Viewer edit attempt' });
    expect(viewerPatch.status).toBe(403);

    const viewerComment = await request(app)
      .post(`/api/v1/incidents/${incident._id}/updates`)
      .set(auth(viewer.token))
      .send({ content: 'viewer comment' });
    expect(viewerComment.status).toBe(403);

    const viewerRead = await request(app)
      .get(`/api/v1/incidents/${incident._id}`)
      .set(auth(viewer.token));
    expect(viewerRead.status).toBe(200);

    // Developer: can update, cannot delete.
    const devPatch = await request(app)
      .patch(`/api/v1/incidents/${incident._id}`)
      .set(auth(dev.token))
      .send({ version: 0, status: 'investigating' });
    expect(devPatch.status).toBe(200);

    const devDelete = await request(app)
      .delete(`/api/v1/incidents/${incident._id}`)
      .set(auth(dev.token));
    expect(devDelete.status).toBe(403);

    const adminDelete = await request(app)
      .delete(`/api/v1/incidents/${incident._id}`)
      .set(auth(admin.token));
    expect(adminDelete.status).toBe(200);

    const gone = await request(app)
      .get(`/api/v1/incidents/${incident._id}`)
      .set(auth(admin.token));
    expect(gone.status).toBe(404);
  });
});
