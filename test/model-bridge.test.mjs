import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, startApplication } from '../server.mjs';

const example = join(APP_ROOT, 'examples', 'fictional-swimming-clinic');
const fixture = async (suffix) => JSON.parse(await readFile(join(example, `req_65163d02-e331-4d92-aa41-10bde1d63f56.${suffix}.json`), 'utf8'));

test('Local API key runs save validated, honestly attributed drafts without exposing the key', async (t) => {
  const root = join(APP_ROOT, 'test', '.temporary'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'model-bridge-'));
  const source = await fixture('request');
  const plan = (await fixture('plan')).content;
  const preparation = (await fixture('preparation')).content;
  const answers = (await fixture('answers.1')).entries;
  const continuation = (await fixture('continuation.1')).content;
  const secret = 'ck_TEST_SECRET_DO_NOT_PUBLISH';
  const calls = [];
  const app = await startApplication({ port: 0, directory, modelInvoke: async (prompt, key) => {
    calls.push({ prompt, key });
    return calls.length === 1 ? { plan, preparation } : continuation;
  } });
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const get = async (path) => {
    const response = await fetch(`${base}${path}`); return { status: response.status, body: await response.json() };
  };
  const token = (await get('/api/session')).body.token;
  const post = async (path, body, authenticated = true) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'X-Browser-Token': token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const created = (await post('/api/requests', { proposal: source.proposal, goal: source.goal })).body;
  const id = created.id;
  assert.equal((await post('/api/model/connect', { key: secret }, false)).status, 403);
  assert.equal((await post('/api/model/start', { id })).status, 409);
  const connected = await post('/api/model/connect', { key: secret });
  assert.deepEqual(connected.body, { connected: true });
  assert.equal(JSON.stringify(connected).includes(secret), false);
  assert.equal((await post('/api/model/start', { id })).status, 202);
  async function finish() {
    for (let i = 0; i < 100; i++) {
      const state = (await get(`/api/model/status?id=${id}`)).body;
      if (state.run?.state !== 'running') return state;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Model run did not finish.');
  }
  assert.equal((await finish()).run.state, 'completed');
  const prepared = (await get(`/api/requests/${id}`)).body;
  assert.equal(prepared.preparation.actor, 'CodeBuddy CLI via API key');
  assert.equal(prepared.preparation.content.facts.length, 15);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, secret);
  assert.match(calls[0].prompt, /FICTIONAL SWIMMING-CLINIC DEMO ONLY/);
  assert.equal((await post(`/api/requests/${id}/answers`, { expectedRevision: 0, entries: answers })).status, 200);
  assert.equal((await post('/api/model/start', { id })).status, 202);
  assert.equal((await finish()).run.state, 'completed');
  const drafted = (await get(`/api/requests/${id}`)).body;
  assert.equal(drafted.continuation.actor, 'CodeBuddy CLI via API key');
  assert.ok(drafted.packages.length > 0);
  assert.equal(calls.length, 2);
  assert.equal((await post('/api/model/start', { id })).status, 409);
  for (const name of await readdir(directory)) {
    if (name.endsWith('.json')) assert.equal((await readFile(join(directory, name), 'utf8')).includes(secret), false);
  }
  assert.equal((await post('/api/model/disconnect', {})).body.connected, false);
  assert.equal((await get(`/api/model/status?id=${id}`)).body.connected, false);
});
