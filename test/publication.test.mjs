import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ROOT, startApplication } from '../server.mjs';
import { createStore } from '../store.mjs';

const id = 'req_65163d02-e331-4d92-aa41-10bde1d63f56';
async function fixture() {
  const temporary = join(APP_ROOT, 'test', '.temporary');
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(join(temporary, 'publication-'));
  const source = join(APP_ROOT, 'examples', 'fictional-swimming-clinic');
  for (const name of await readdir(source)) await copyFile(join(source, name), join(directory, name));
  return { directory, store: createStore(directory) };
}

test('publication requires reviewed current card and exposes only a narrow public projection', async () => {
  const { store } = await fixture();
  const initial = await store.get(id);
  assert.equal(initial.packages.find((p) => p.content.id === 'pkg_water').reviewCurrent, true);
  assert.equal(initial.packages.find((p) => p.content.id === 'pkg_boards').reviewCurrent, false);
  assert.deepEqual(await store.listPublicListings(), []);
  const body = { packageId: 'pkg_water', published: true, expectedRevision: initial.packageRevision, continuationRevision: initial.continuationRevision };
  await assert.rejects(store.setPublication(id, { ...body, packageId: 'pkg_boards' }), (e) => e.status === 409);
  await assert.rejects(store.setPublication(id, { ...body, expectedRevision: 0 }), (e) => e.status === 409);
  const published = await store.setPublication(id, body);
  assert.equal(published.packages.find((p) => p.content.id === 'pkg_water').publication.published, true);
  assert.equal(published.publicationRevision, 1);
  const listings = await store.listPublicListings();
  assert.equal(listings.length, 1);
  assert.equal(listings[0].packageId, 'pkg_water');
  assert.match(listings[0].eventTitle, /swimming/i);
  assert.ok(listings[0].supportRequested.length);
  const serialized = JSON.stringify(listings);
  assert.equal(serialized.includes(id), false, 'Public listings must not reveal the private request URL identifier.');
  assert.match(listings[0].id, /^[a-f0-9]{24}$/);
  for (const secret of ['proposal', 'goal', 'answerHistory', 'questionId', 'sources', 'readReceipt', 'contact']) assert.equal(serialized.includes(`"${secret}"`), false);
  const edited = structuredClone(published.packages.find((p) => p.content.id === 'pkg_water').content);
  edited.title = 'Edited after publication';
  await store.updatePackage(id, { expectedRevision: published.packageRevision, continuationRevision: published.continuationRevision, packageId: 'pkg_water', content: edited });
  assert.deepEqual(await store.listPublicListings(), [], 'Editing a published card removes it until review and new opt-in.');
});

test('publication API requires browser token, persists opt-in and supports explicit unpublish', async (t) => {
  const { directory, store } = await fixture();
  const app = await startApplication({ directory, port: 0 });
  t.after(() => new Promise((resolve) => { app.server.close(resolve); app.server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const initial = await store.get(id);
  const body = { packageId: 'pkg_water', published: true, expectedRevision: initial.packageRevision, continuationRevision: initial.continuationRevision };
  const publish = (value, token) => fetch(`${base}/api/requests/${id}/publication`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Browser-Token': token } : {}) }, body: JSON.stringify(value) });
  assert.equal((await publish(body)).status, 403);
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  assert.equal((await publish(body, token)).status, 200);
  const listed = await (await fetch(`${base}/api/marketplace/listings`)).json();
  assert.equal(listed.listings.length, 1);
  const persisted = await createStore(directory).get(id);
  assert.equal(persisted.packages.find((p) => p.content.id === 'pkg_water').publication.published, true);
  assert.equal((await publish({ ...body, published: false }, token)).status, 200);
  assert.deepEqual((await (await fetch(`${base}/api/marketplace/listings`)).json()).listings, []);
});
