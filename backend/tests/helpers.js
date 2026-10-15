'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = require('../src/app');
const { connectDatabase } = require('../src/config/db');
const User = require('../src/models/User');

/** Connect and fully reset the test database, then ensure all indexes exist. */
async function setupDb() {
  await connectDatabase(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

async function teardownDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.connection.close();
}

/** Create a user directly (bypasses registration for role control). */
async function createUser({ name = 'Test User', email, role = 'developer', password = 'Password123!' }) {
  const passwordHash = await bcrypt.hash(password, 4);
  const suffix = Math.random().toString(36).slice(2, 8);
  const user = await User.create({
    name,
    email: email || `user-${suffix}@test.dev`,
    passwordHash,
    role,
  });
  return { user, password };
}

/** Register + login through the API; returns { user, token }. */
async function registerAndLogin(overrides = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const payload = {
    name: 'API User',
    email: `api-${suffix}@test.dev`,
    password: 'Password123!',
    ...overrides,
  };
  const reg = await request(app).post('/api/v1/auth/register').send(payload);
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
  return { user: reg.body.data.user, token: reg.body.data.token, payload };
}

/** Log in an existing user; returns token. */
async function login(email, password) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

/** Create a project through the API as the given user. */
async function createProject(token, overrides = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const res = await request(app)
    .post('/api/v1/projects')
    .set(auth(token))
    .send({
      name: `Project ${suffix}`,
      description: 'test project',
      environments: ['production', 'staging'],
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createProject failed: ${JSON.stringify(res.body)}`);
  return res.body.data.project;
}

/** Create a deployment through the API. */
async function createDeployment(token, projectId, overrides = {}) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/deployments`)
    .set(auth(token))
    .send({
      version: 'v1.0.0',
      environment: 'production',
      status: 'success',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createDeployment failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Create an incident through the API. */
async function createIncident(token, projectId, overrides = {}) {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/incidents`)
    .set(auth(token))
    .send({
      title: 'Checkout timeout errors spike',
      description: 'checkout is slow',
      severity: 'SEV2',
      environment: 'production',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createIncident failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/** Minutes-ago Date helper. */
function minutesAgo(min) {
  return new Date(Date.now() - min * 60000);
}

/** Sign a GitHub webhook payload exactly like GitHub does. */
function signGithubPayload(rawBody, secret) {
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return signature;
}

module.exports = {
  app,
  request,
  mongoose,
  setupDb,
  teardownDb,
  createUser,
  registerAndLogin,
  login,
  auth,
  createProject,
  createDeployment,
  createIncident,
  minutesAgo,
  signGithubPayload,
};
