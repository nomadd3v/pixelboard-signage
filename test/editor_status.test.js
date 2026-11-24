// Editor state: /api/sites/:id/status tracks draft-vs-TV, and the operator page
// never shows the AI box to a client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `vellum-status-${process.pid}`);
process.env.VELLUM_DATA_DIR = TMP;
process.env.VELLUM_MASTER_KEY = 'master-secret';
process.env.VELLUM_SESSION_SECRET = 'test-session-secret';
process.env.ANTHROPIC_API_KEY = 'sk-test-fake'; // AI "configured" — must still be owner-only

const { ingest } = await import('../src/ingest.js');
const store = await import('../src/storage.js');
const { hashPassword } = await import('../src/auth.js');
const { createApp } = await import('../src/server.js');

let base, server, id, h1;
const OWNER = { 'x-vellum-key': 'master-secret' };
const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });
const post = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

before(async () => {
  await fs.mkdir(TMP, { recursive: true });
  const art = ingest('<html><body><h1>Hi</h1><p>Body</p></body></html>');
  id = (await store.createSite({ name: 'S', sourceUrl: 'https://s.test', ...art })).id;
  h1 = art.slots.find((s) => s.label === 'Heading 1').id;
  await store.setClientAuth(id, hashPassword('client-pw'));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)).then(() => fs.rm(TMP, { recursive: true, force: true })));

test('status: unpublished -> dirty; publish -> clean; edit -> dirty again', async () => {
  let s = await (await get(`/api/sites/${id}/status`, OWNER)).json();
  assert.equal(s.live, null);
  assert.equal(s.dirty, true);
  assert.equal(s.liveUrl, `/sites/${id}/live/screen`);

  const pub = await post(`/api/sites/${id}/publish`, {}, OWNER);
  assert.equal(pub.status, 200);
  s = await (await get(`/api/sites/${id}/status`, OWNER)).json();
  assert.equal(s.dirty, false);
  assert.ok(s.live && s.live.id);
  assert.equal(s.snapshots[0].current, true);

  assert.equal((await post(`/api/sites/${id}/edit`, { changes: { [h1]: 'Changed' } }, OWNER)).status, 200);
  s = await (await get(`/api/sites/${id}/status`, OWNER)).json();
  assert.equal(s.dirty, true, 'HEAD differs from the newest snapshot');
  assert.equal(s.snapshots[0].current, false);

  // putting the same content back on the TV makes it clean again
  await post(`/api/sites/${id}/publish`, {}, OWNER);
  s = await (await get(`/api/sites/${id}/status`, OWNER)).json();
  assert.equal(s.dirty, false);
  assert.equal(s.snapshots.length, 2);
});

test('status needs site access', async () => {
  assert.equal((await get(`/api/sites/${id}/status`)).status, 401);
});

test('editor page: fields are labelled; AI box is owner-only even when AI is configured', async () => {
  const owner = await (await get(`/sites/${id}/edit`, OWNER)).text();
  assert.match(owner, /Put on TV/);
  assert.match(owner, /data-slot="/);
  assert.match(owner, /Headline/);
  assert.match(owner, /Ask AI/);

  const login = await fetch(base + `/sites/${id}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'client-pw' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const client = await (await get(`/sites/${id}/edit`, { cookie })).text();
  assert.match(client, /Put on TV/);
  assert.doesNotMatch(client, /Ask AI/);
  assert.doesNotMatch(client, /chatmsg/);
  assert.doesNotMatch(client, /Ask for a change/);
});
