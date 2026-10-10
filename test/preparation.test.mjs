// Synthetic validation fixtures below are tests, not demonstration outputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, startApplication } from '../server.mjs';
import { createStore } from '../store.mjs';
import { EVENT_FIELDS } from '../workflow.mjs';
import { runAdapter } from '../adapter.mjs';
const input = { proposal: 'SYNTHETIC VALIDATION FIXTURE ONLY. The test event is called Sample Lab.', goal: 'Draft a preparation checklist only.' };
const plan = { steps: ['Extract supported fields.', 'Save reviewable questions and checklist.'] };
function result() {
  const source = { source: 'proposal', quote: 'The test event is called Sample Lab.' };
  return {
    facts: EVENT_FIELDS.map((field) => ({ field, value: field === 'eventName' ? 'Sample Lab' : '', sources: field === 'eventName' ? [source] : [] })),
    summary: [{ text: 'The test event is called Sample Lab.', sources: [source] }],
    questions: [{ id: 'q-date', field: 'date', question: 'What is the confirmed date?', reason: 'Needed for sponsorship timing.' }],
    checklist: [{ id: 'c-date', task: 'Confirm event timing before preparing sponsorship commitments.', status: 'not_started', dependsOnFields: ['date'] }],
  };
}
async function setup(t) {
  const root = join(APP_ROOT, 'test', '.temporary'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'preparation-'));
  // Keep new isolated fixtures for inspection; no bulk cleanup during tests.
  const store = createStore(directory); await store.init(); return { directory, store, request: await store.create(input) };
}
test('Preparation requires plan; plan/result persist and retries do not rewrite timestamps', async (t) => {
  const { directory, store, request } = await setup(t);
  await assert.rejects(store.saveWorkflow(request.id, 'preparation', result()), (e) => e.status === 409);
  const savedPlan = await store.saveWorkflow(request.id, 'plan', plan);
  assert.equal(savedPlan.status, 'planned'); assert.equal(savedPlan.acknowledgement, null);
  const prepared = await store.saveWorkflow(request.id, 'preparation', result());
  assert.equal(prepared.status, 'prepared'); assert.equal(prepared.progress.length, 2);
  const retried = await store.saveWorkflow(request.id, 'preparation', result());
  assert.deepEqual(retried, prepared);
  assert.deepEqual(await createStore(directory).get(request.id), prepared);
  const conflicting = result(); conflicting.checklist[0].task = 'Different checklist';
  await assert.rejects(store.saveWorkflow(request.id, 'preparation', conflicting), (e) => e.status === 409);
  await assert.rejects(store.saveWorkflow(request.id, 'plan', { steps: ['Different plan'] }), (e) => e.status === 409);
  assert.deepEqual(await store.get(request.id), prepared);
});
test('Reject invented quotations, invalid sources, unknown markers, missing/duplicate facts, fake completed checklist and extra fields', async (t) => {
  const { store, request } = await setup(t); await store.saveWorkflow(request.id, 'plan', plan);
  const mutations = [
    (r) => { r.facts[0].sources[0].quote = 'A fabricated passage.'; },
    (r) => { r.facts[0].sources[0].source = 'external'; },
    (r) => { r.facts[1].value = 'Unknown'; },
    (r) => { r.facts[1].sources = [r.facts[0].sources[0]]; },
    (r) => { r.facts.pop(); },
    (r) => { r.facts[1] = structuredClone(r.facts[0]); },
    (r) => { r.summary[0].sources = []; },
    (r) => { r.questions[0].field = 'eventName'; },
    (r) => { r.checklist[0].status = 'done'; },
    (r) => { r.checklist[0].dependsOnFields = ['unsupported']; },
    (r) => { r.approved = true; },
  ];
  for (const mutate of mutations) { const candidate = result(); mutate(candidate); await assert.rejects(store.saveWorkflow(request.id, 'preparation', candidate), (e) => e.status === 400); }
  assert.equal((await store.get(request.id)).preparation, null);
  await assert.rejects(store.saveWorkflow(request.id, 'plan', { steps: [], invented: true }), (e) => e.status === 400);
});
test('Corrupt saved workflow fails closed and preserves damaged bytes', async (t) => {
  const { directory, store, request } = await setup(t);
  await store.saveWorkflow(request.id, 'plan', plan);
  const path = join(directory, `${request.id}.plan.json`);
  await writeFile(path, JSON.stringify({ requestId: request.id, actor: 'false', recordedAt: 'invalid', content: plan }));
  const bytes = await readFile(path, 'utf8');
  await assert.rejects(store.get(request.id), (e) => e.status === 500);
  assert.equal(await readFile(path, 'utf8'), bytes);
});
test('HTTP workflow operations require adapter key and matching current read receipt; restart preserves results', async (t) => {
  const { directory, request } = await setup(t);
  let app = await startApplication({ directory, port: 0 });
  t.after(() => new Promise((resolve) => { app.server.close(resolve); app.server.closeAllConnections(); }));
  let baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  const keyFile = join(directory, '.agent-key');
  const options = () => ({ baseUrl, keyFile });
  const read = await runAdapter(['read', request.id], options());
  assert.equal(read.status, 'waiting'); assert.deepEqual(read.progress, []);
  const browserToken = (await (await fetch(`${baseUrl}/api/session`)).json()).token;
  for (const kind of ['plan', 'preparation']) {
    const response = await fetch(`${baseUrl}/agent/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Browser-Token': browserToken }, body: JSON.stringify({ id: request.id, readReceipt: read.readReceipt, content: kind === 'plan' ? plan : result() }) });
    assert.equal(response.status, 403);
    await assert.rejects(runAdapter([kind, request.id, 'bad', JSON.stringify(kind === 'plan' ? plan : result())], options()), /receipt/i);
  }
  const other = await app.store.create(input);
  await assert.rejects(runAdapter(['plan', other.id, read.readReceipt, JSON.stringify(plan)], options()), /another request/i);
  await runAdapter(['plan', request.id, read.readReceipt, JSON.stringify(plan)], options());
  const saved = await runAdapter(['preparation', request.id, read.readReceipt, JSON.stringify(result())], options());
  assert.equal(saved.preparation.content.facts.filter((f) => f.value === '').length, EVENT_FIELDS.length - 1);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/requests/${request.id}`)).json(), saved);
  await new Promise((resolve) => { app.server.close(resolve); app.server.closeAllConnections(); });
  app = await startApplication({ directory, port: 0 }); baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  await assert.rejects(runAdapter(['preparation', request.id, read.readReceipt, JSON.stringify(result())], options()), /receipt/i);
  const resumed = await runAdapter(['read', request.id], options());
  assert.equal(resumed.status, 'prepared'); assert.deepEqual(resumed.preparation, saved.preparation);
  const retried = await runAdapter(['preparation', request.id, resumed.readReceipt, JSON.stringify(result())], options());
  assert.deepEqual(retried.preparation, saved.preparation);
  await assert.rejects(runAdapter(['preparation', request.id, resumed.readReceipt, '{'], options()), /JSON/i);
});
