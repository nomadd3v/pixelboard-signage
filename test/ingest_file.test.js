// Route test for POST /api/sites/ingest-file — direct ingest of a standalone,
// self-contained HTML file (no fetch, no URL). The body IS the HTML.
//
// Env set BEFORE importing the app so MASTER_KEY gates the owner-only route.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `vellum-ingest-file-${process.pid}`);
process.env.VELLUM_DATA_DIR = TMP;
process.env.VELLUM_MASTER_KEY = 'master-secret';
process.env.VELLUM_SESSION_SECRET = 'test-session-secret';

const store = await import('../src/storage.js');
const { createApp } = await import('../src/server.js');

// A self-contained menu page: inline styles, inline (data:) image, zero scripts.
const STANDALONE = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff}</style></head>
<body>
  <h1>Tonight's Menu</h1>
  <p>Wood-fired <a href="https://example.test/specials">specials</a> all week.</p>
  <img src="data:image/png;base64,iVBORw0KGgo=" alt="House plate">
</body></html>`;

let base;
let server;

before(async () => {
  await fs.mkdir(TMP, { recursive: true });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)).then(() => fs.rm(TMP, { recursive: true, force: true })));

const postHtml = (p, body, headers = {}) =>
  fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'text/html', ...headers }, body });

test('owner can ingest a standalone HTML file by posting the raw body', async () => {
  const r = await postHtml('/api/sites/ingest-file?name=Menu', STANDALONE, { 'x-vellum-key': 'master-secret' });
  assert.equal(r.status, 200);
  const { site, slotCount } = await r.json();
  assert.ok(site.id, 'returns a created site');
  assert.equal(site.name, 'Menu', 'name override applied');
  assert.ok(slotCount >= 3, 'extracted text/link/image slots');

  // The site is a normal ingested site: frozen template + slots + default
  // content. Text is replaced by sentinel tokens in the template; the original
  // value lives in the content map keyed by slot id.
  const full = await store.getSite(site.id);
  assert.ok(Object.values(full.content).some((v) => v.includes('Tonight')), 'content carries page text');
  assert.ok(full.slots.some((s) => s.field === 'href'), 'link slot extracted');
  assert.ok(full.slots.some((s) => s.field === 'src'), 'image slot extracted');
});

test('ingest-file is owner-gated', async () => {
  const r = await postHtml('/api/sites/ingest-file', STANDALONE); // no key
  assert.equal(r.status, 401);
});

test('ingest-file rejects an empty body', async () => {
  const r = await postHtml('/api/sites/ingest-file', '', { 'x-vellum-key': 'master-secret' });
  assert.equal(r.status, 400);
});
