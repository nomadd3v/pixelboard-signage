// Route-level authz boundary tests (ADR-002). These are deliberately negative /
// cross-tenant: the happy path passing proves nothing about isolation.
//
// Env is set BEFORE importing the app so MASTER_KEY gates owner access (in dev,
// with no key, everything is open and the boundary can't be exercised).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `vellum-routes-${process.pid}`);
process.env.VELLUM_DATA_DIR = TMP;
process.env.VELLUM_MASTER_KEY = 'master-secret';
process.env.VELLUM_SESSION_SECRET = 'test-session-secret';

const { ingest } = await import('../src/ingest.js');
const store = await import('../src/storage.js');
const { createApp } = await import('../src/server.js');

const SAMPLE = '<html><body><h1>Hi</h1><p>Body</p></body></html>';

let base;
let server;
let A; // site A id (password "alpha-pw")
let B; // site B id (password "bravo-pw")

before(async () => {
  await fs.mkdir(TMP, { recursive: true });
  // two sites created directly via storage
  A = (await store.createSite({ name: 'A', sourceUrl: 'https://a.test', ...ingest(SAMPLE) })).id;
  B = (await store.createSite({ name: 'B', sourceUrl: 'https://b.test', ...ingest(SAMPLE) })).id;
  await store.setClientAuth(A, (await import('../src/auth.js')).hashPassword('alpha-pw'));
  await store.setClientAuth(B, (await import('../src/auth.js')).hashPassword('bravo-pw'));

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)).then(() => fs.rm(TMP, { recursive: true, force: true })));

// helpers ---------------------------------------------------------------------
const get = (p, headers = {}) => fetch(base + p, { headers, redirect: 'manual' });
const postJson = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function clientCookie(id, password) {
  const r = await fetch(base + `/sites/${id}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
  });
  assert.equal(r.status, 302, 'login should redirect on success');
  const setc = r.headers.get('set-cookie');
  assert.ok(setc, 'login sets a cookie');
  return setc.split(';')[0]; // name=value
}

// --- anonymous ---------------------------------------------------------------

test('anonymous is denied the editing surface', async () => {
  assert.equal((await get('/')).status, 302); // -> /login
  assert.equal((await postJson('/api/sites', { url: 'https://x.test' })).status, 401);
  assert.equal((await postJson(`/api/sites/${A}/edit`, { changes: {} })).status, 401);
  assert.equal((await get(`/sites/${A}/preview?mode=edit`)).status, 302);
});

test('public artifacts stay public', async () => {
  // publish as owner first
  const pub = await postJson(`/api/sites/${A}/publish`, {}, { 'x-vellum-key': 'master-secret' });
  assert.equal(pub.status, 200);
  const { snapshot } = await pub.json();
  assert.equal((await get(`/sites/${A}/published/${snapshot.id}`)).status, 200);
  assert.equal((await get(`/sites/${A}/preview?mode=publish`)).status, 200);
});

// --- client isolation (the core promise) -------------------------------------

test('client of A can edit A', async () => {
  const c = await clientCookie(A, 'alpha-pw');
  const r = await postJson(`/api/sites/${A}/edit`, { changes: {} }, { cookie: c });
  assert.equal(r.status, 200);
});

test('client of A is denied site B (cross-tenant)', async () => {
  const c = await clientCookie(A, 'alpha-pw');
  assert.equal((await postJson(`/api/sites/${B}/edit`, { changes: {} }, { cookie: c })).status, 401);
  assert.equal((await postJson(`/api/sites/${B}/publish`, {}, { cookie: c })).status, 401);
  assert.equal((await get(`/sites/${B}/preview?mode=edit`, { cookie: c })).status, 302);
  assert.equal((await get(`/api/sites/${B}/versions`, { cookie: c })).status, 401);
});

test('cookie-rename attack fails: A token presented under B cookie name', async () => {
  // take A's valid token, present it under the name vsess_<B>
  const aCookie = await clientCookie(A, 'alpha-pw');          // "vsess_<A>=<token>"
  const token = aCookie.split('=').slice(1).join('=');
  const renamed = `vsess_${B}=${token}`;
  // HMAC still verifies (real token) — only the sid check rejects it
  assert.equal((await postJson(`/api/sites/${B}/edit`, { changes: {} }, { cookie: renamed })).status, 401);
});

test('privilege-escalation fails: client token presented as owner cookie', async () => {
  const aCookie = await clientCookie(A, 'alpha-pw');
  const token = aCookie.split('=').slice(1).join('=');
  const asOwner = `vsess_owner=${token}`; // client token, owner cookie name
  assert.equal((await get('/', { cookie: asOwner })).status, 302); // role!=='owner' -> denied
  assert.equal((await postJson(`/api/sites/${B}/edit`, { changes: {} }, { cookie: asOwner })).status, 401);
});

test('client cannot set passwords (owner-only)', async () => {
  const c = await clientCookie(A, 'alpha-pw');
  assert.equal((await postJson(`/api/sites/${A}/client-password`, { password: 'x' }, { cookie: c })).status, 401);
});

// --- owner -------------------------------------------------------------------

test('owner (via key header) can do everything across sites', async () => {
  const k = { 'x-vellum-key': 'master-secret' };
  assert.equal((await get('/', k)).status, 200);
  assert.equal((await postJson(`/api/sites/${A}/edit`, { changes: {} }, k)).status, 200);
  assert.equal((await postJson(`/api/sites/${B}/edit`, { changes: {} }, k)).status, 200);
});

test('owner cookie login grants the browser session', async () => {
  const r = await fetch(base + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: 'master-secret' }),
  });
  assert.equal(r.status, 302);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/', { cookie })).status, 200);
});

test('wrong client password is rejected', async () => {
  const r = await fetch(base + `/sites/${A}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'nope' }),
  });
  assert.equal(r.status, 401);
});

test('login against a passwordless site rejects cleanly (no 500)', async () => {
  const C = (await store.createSite({ name: 'C', sourceUrl: 'https://c.test', ...ingest(SAMPLE) })).id;
  const r = await fetch(base + `/sites/${C}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'anything' }),
  });
  assert.equal(r.status, 401);
});

// --- editor injection must survive a <base href> in the frozen template -------
// Regression: relative editor assets (/editor/inject.js) were hijacked by the
// injected <base href> to the wrong origin and 404'd, so click-to-edit silently
// died. The editor chrome is now inlined (no URL to resolve).
test('edit-mode preview inlines the editor even when template has <base href>', async () => {
  const D = (await store.createSite({
    name: 'D', sourceUrl: 'https://d.test',
    ...ingest('<html><head><link rel=stylesheet href="a.css"></head><body><h1>Hi</h1></body></html>', 'https://d.test/'),
  })).id;
  const r = await fetch(base + `/sites/${D}/preview?mode=edit`, {
    headers: { 'x-vellum-key': 'master-secret' },
  });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<base href="https:\/\/d\.test\/">/, 'base href is present');
  assert.match(html, /v-slot\[data-v-slot\]/, 'editor runtime is inlined, not linked');
  assert.doesNotMatch(html, /<script src="\/editor\/inject\.js"><\/script>/, 'no hijackable linked editor asset');
});
