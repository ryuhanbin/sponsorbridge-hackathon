import { test } from 'node:test';
import http from 'node:http';
const rawStatus = (url, headers) => new Promise((resolve, reject) => {
  const req = http.get(url, { headers }, (response) => { response.resume(); resolve(response.statusCode); });
  req.on('error', reject);
});
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore, publishOnce, validId } from '../store.mjs';
import { APP_ROOT, startApplication, loadAgentKey } from '../server.mjs';
import { runAdapter } from '../adapter.mjs';

async function temporary(t) {
  const root = join(APP_ROOT, 'test', '.temporary');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  // Retain isolated test fixtures for inspection. Do not bulk-delete during runs.
  // Each test uses a fresh directory; runtime application records are untouched.
  return directory;
}
const input = { proposal: '  TEST ONLY: Proposal text\nNo event facts asserted.  ', goal: 'TEST ONLY: save and acknowledge this goal.' };

test('Disk persistence preserves exact text, unique IDs and waiting across new store instances', async (t) => {
  const directory = await temporary(t), store = createStore(directory); await store.init();
  const first = await store.create(input), second = await store.create(input);
  assert.notEqual(first.id, second.id); validId(first.id);
  assert.equal(first.status, 'waiting'); assert.equal(first.acknowledgement, null);
  const restored = await createStore(directory).get(first.id);
  assert.deepEqual(restored, first);
  assert.equal(restored.proposal, input.proposal);
});

test('Blank, missing, oversized, unexpected fields and unsafe IDs are rejected', async (t) => {
  const store = createStore(await temporary(t)); await store.init();
  for (const payload of [{ ...input, goal: ' \n ' }, { ...input, proposal: '' }, { goal: input.goal }, { ...input, goal: 'x'.repeat(2001) }, { ...input, proposal: 'x'.repeat(20001) }, { ...input, status: 'acknowledged' }, null]) {
    await assert.rejects(store.create(payload), (error) => error.status === 400);
  }
  for (const id of ['../data', '..%2Ffile', 'req_123', '', `req_${randomUUID()}/ack`, 123]) assert.throws(() => validId(id));
  await assert.rejects(store.get(`req_${randomUUID()}`), (error) => error.status === 404);
});

test('Immutable publication never replaces existing files; unpublished partial file is ignored', async (t) => {
  const directory = await temporary(t), path = join(directory, 'immutable.json');
  await publishOnce(path, { original: true });
  await assert.rejects(publishOnce(path, { original: false }), (error) => error.code === 'EEXIST');
  assert.deepEqual(JSON.parse(await readFile(path)), { original: true });
  const store = createStore(directory); await store.init();
  const request = await store.create(input);
  await writeFile(join(directory, `${request.id}.ack.json.crash.pending`), '{partial');
  assert.equal((await store.get(request.id)).status, 'waiting');
  const files = await readdir(directory);
  // Sandbox cleanup guards can retain fully written publication temporaries.
  // Verify the committed file set and injected crash file, not successful cleanup.
  assert.ok(files.includes(`${request.id}.ack.json.crash.pending`));
  assert.deepEqual(files.filter((name) => !name.endsWith('.pending')).sort(), ['immutable.json', `${request.id}.request.json`].sort());
  assert.equal((await createStore(directory).get(request.id)).acknowledgement, null);
});

test('Concurrent acknowledgements are idempotent, conflicts preserve originals and corruption fails closed', async (t) => {
  const directory = await temporary(t), store = createStore(directory); await store.init();
  const request = await store.create(input);
  const results = await Promise.all(Array.from({ length: 6 }, () => store.acknowledge(request.id, 'Read the test goal.')));
  assert.ok(results.every((result) => result.acknowledgement.summary === 'Read the test goal.'));
  await assert.rejects(store.acknowledge(request.id, 'Replacement'), (error) => error.status === 409);
  assert.equal((await store.get(request.id)).acknowledgement.summary, 'Read the test goal.');
  await writeFile(join(directory, `${request.id}.request.json`), '{bad');
  await assert.rejects(store.get(request.id), (error) => error.status === 500);
  assert.equal(await readFile(join(directory, `${request.id}.request.json`), 'utf8'), '{bad');
});

test('HTTP contracts, adapter read-before-ack and server restart', async (t) => {
  const directory = await temporary(t);
  let app = await startApplication({ directory, port: 0 });
  t.after(() => new Promise((yes) => { app.server.close(yes); app.server.closeAllConnections(); }));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, options) => fetch(`${base}${path}`, options);
  const token = (await (await call('/api/session')).json()).token;
  const post = (body, tokenValue = token) => call('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Browser-Token': tokenValue }, body: JSON.stringify(body) });
  let id;
  await t.test('Server binds exclusively to IPv4 loopback', () => assert.equal(app.server.address().address, '127.0.0.1'));
  await t.test('Save, repeated retrieval and waiting state; no browser ACK capability', async () => {
    const response = await post(input); assert.equal(response.status, 201);
    const record = await response.json(); id = record.id; assert.equal(record.status, 'waiting');
    const saved = await (await call(`/api/requests/${id}`)).json(); assert.deepEqual(saved, record);
    assert.equal((await call('/agent/ack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Browser-Token': token }, body: JSON.stringify({ id, summary: 'Cannot do this from browser.' }) })).status, 403);
    assert.equal((await (await call(`/api/requests/${id}`)).json()).status, 'waiting');
  });
  await t.test('Reject blank input, malformed JSON, oversized bodies and wrong content type', async () => {
    assert.equal((await post({ ...input, goal: '  ' })).status, 400);
    assert.equal((await post({ ...input, proposal: '' })).status, 400);
    assert.equal((await call('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Browser-Token': token }, body: '{' })).status, 400);
    assert.equal((await post({ ...input, proposal: 'x'.repeat(100000) })).status, 413);
    assert.equal((await call('/api/requests', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Browser-Token': token }, body: 'data' })).status, 415);
  });
  await t.test('Reject unsafe IDs, foreign Host/Origin, cross-site reads and invalid tokens; private files not served', async () => {
    assert.equal((await call('/api/requests/invalid')).status, 400);
    assert.equal((await call('/api/requests/req_%2e%2e%2fsecret')).status, 400);
    assert.equal((await call(`/api/requests/req_${randomUUID()}`)).status, 404);
    assert.equal(await rawStatus(`${base}/api/session`, { Host: 'evil.example' }), 403);
    assert.equal((await call('/api/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal(await rawStatus(`${base}/api/session`, { 'Sec-Fetch-Site': 'cross-site' }), 403);
    assert.equal((await post(input, 'bad')).status, 403);
    assert.equal((await call('/data/.agent-key')).status, 404);
    assert.equal((await call('/server.mjs')).status, 404);
  });
  let staleReceipt;
  const keyFile = join(directory, '.agent-key');
  await t.test('Adapter read returns source text and receipt but does not acknowledge', async () => {
    const read = await runAdapter(['read', id], { baseUrl: base, keyFile });
    assert.equal(read.goal, input.goal); assert.equal(read.proposal, input.proposal); assert.equal(read.status, 'waiting');
    staleReceipt = read.readReceipt;
    assert.equal((await app.store.get(id)).status, 'waiting');
    await assert.rejects(runAdapter(['ack', id, 'invalid', 'Read goal.'], { baseUrl: base, keyFile }), /receipt/i);
  });
  await t.test('Restart server; saved request and key survive, previous read receipt is rejected', async () => {
    const beforeKey = await loadAgentKey(directory);
    await new Promise((yes) => { app.server.close(yes); app.server.closeAllConnections(); });
    app = await startApplication({ directory, port: 0 }); base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal(await loadAgentKey(directory), beforeKey);
    const record = await (await call(`/api/requests/${id}`)).json();
    assert.equal(record.status, 'waiting'); assert.equal(record.goal, input.goal); assert.equal(record.proposal, input.proposal);
    await assert.rejects(runAdapter(['ack', id, staleReceipt, 'Read the test goal.'], { baseUrl: base, keyFile }), /receipt/i);
  });
  await t.test('Adapter acknowledgement is visible through polling API and persists', async () => {
    const read = await runAdapter(['read', id], { baseUrl: base, keyFile });
    const ack = await runAdapter(['ack', id, read.readReceipt, 'The saved test goal asks to save and acknowledge it.'], { baseUrl: base, keyFile });
    assert.equal(ack.status, 'acknowledged'); assert.equal(ack.acknowledgement.requestId, id);
    const observed = await (await call(`/api/requests/${id}`)).json(); assert.deepEqual(observed, ack);
    assert.deepEqual(await createStore(directory).get(id), ack);
    const other = await app.store.create(input);
    await assert.rejects(runAdapter(['ack', other.id, read.readReceipt, 'Incorrect request.'], { baseUrl: base, keyFile }), /another request/i);
    await assert.rejects(runAdapter(['ack', id, read.readReceipt, 'Overwrite attempt.'], { baseUrl: base, keyFile }), /preserved/i);
  });
});
