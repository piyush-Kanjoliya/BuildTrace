'use strict';

const { app, request, setupDb, teardownDb, registerAndLogin, createUser, login } = require('./helpers');

beforeAll(setupDb);
afterAll(teardownDb);

describe('authentication', () => {
  it('registers a user and returns a token (self-service role is developer)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'New User',
      email: 'new-user@test.dev',
      password: 'Password123!',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.role).toBe('developer');
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects registration with a weak password (validation)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Weak User',
      email: 'weak@test.dev',
      password: 'short',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d) => d.path === 'password')).toBe(true);
  });

  it('rejects duplicate email registration with 409', async () => {
    await request(app).post('/api/v1/auth/register').send({
      name: 'Dup One',
      email: 'dup@test.dev',
      password: 'Password123!',
    });
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Dup Two',
      email: 'dup@test.dev',
      password: 'Password123!',
    });
    expect(res.status).toBe(409);
  });

  it('rejects login with a wrong password using a generic message', async () => {
    const { payload } = await registerAndLogin();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: payload.email, password: 'WrongPassword123!' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('returns the current user for a valid token and 401 otherwise', async () => {
    const { payload } = await registerAndLogin();
    const token = await login(payload.email, payload.password);
    const meRes = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${token}` });
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(payload.email);

    const noToken = await request(app).get('/api/v1/auth/me');
    expect(noToken.status).toBe(401);

    const badToken = await request(app).get('/api/v1/auth/me').set({ Authorization: 'Bearer nonsense' });
    expect(badToken.status).toBe(401);
  });

  it('rejects a token signed for a deleted user', async () => {
    const { payload } = await registerAndLogin();
    const token = await login(payload.email, payload.password);
    const { user } = await createUser({ email: 'temp@test.dev' });
    const tempToken = await login('temp@test.dev', 'Password123!');
    await require('../src/models/User').deleteOne({ _id: user._id });
    const res = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${tempToken}` });
    expect(res.status).toBe(401);
    expect(token).toBeTruthy();
  });
});
