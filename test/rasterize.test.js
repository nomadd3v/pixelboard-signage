// Flat-image rasterization (ADR-006). The storage round-trip and route guards
// are hermetic (no browser). The actual headless capture is gated behind
// PIXELBOARD_RASTER_E2E=1 so `npm test` stays fast and environment-independent
// (a missing browser must never fail the suite — that's the whole "best-effort"
// contract). Run the e2e leg with:  PIXELBOARD_RASTER_E2E=1 node --test test/rasterize.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `vellum-raster-${process.pid}`);
process.env.VELLUM_DATA_DIR = TMP;
process.env.VELLUM_MASTER_KEY = 'm';
process.env.VELLUM_SESSION_SECRET = 's';

const store = await import('../src/storage.js');
const { compileBoard } = await import('../src/board/compile.js');
const { createApp } = await import('../src/server.js');
const { closeRasterizer } = await import('../src/rasterize.js');

let server, base;
before(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await closeRasterizer();
  server?.close();
  await fs.rm(TMP, { recursive: true, force: true });
});

const newBoardSite = async (text) => {
  const board = { name: 'R', canvas: { w: 400, h: 300 }, elements: [
    { id: 't', type: 'text', x: 10, y: 10, w: 380, h: 80, value: text, slot: { editable: true, label: 'T' } },
  ] };
  const art = compileBoard(board);
  const meta = await store.createSite({ name: 'R', sourceUrl: 'studio', ...art });
  await store.saveBoard(meta.id, board);
  return meta;
};

test('savePublishImage round-trips a PNG beside its snapshot; rejects unknown snapshots', async () => {
  const meta = await newBoardSite('IMG-V1');
  assert.equal(await store.savePublishImage(meta.id, 'no-such-snap', Buffer.from('x')), false);

  const snap = await store.savePublish(meta.id, '<html></html>', 'c1');
  const png = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG magic, stand-in bytes
  assert.equal(await store.savePublishImage(meta.id, snap.id, png), true);
  assert.deepEqual(await store.readPublishImage(meta.id, snap.id), png);
  assert.equal(await store.readPublishImage(meta.id, 'no-such-snap'), null);
});

test('latestSnapshot returns the newest snapshot (or null when unpublished)', async () => {
  const meta = await newBoardSite('LS');
  assert.equal(await store.latestSnapshot(meta.id), null);
  const s1 = await store.savePublish(meta.id, '<html>1</html>', 'h1');
  await new Promise((r) => setTimeout(r, 5)); // distinct createdAt
  const s2 = await store.savePublish(meta.id, '<html>2</html>', 'h2');
  const latest = await store.latestSnapshot(meta.id);
  assert.equal(latest.id, s2.id);
  assert.notEqual(latest.id, s1.id);
});

test('GET /sites/:id/live.png is 404 before publish', async () => {
  const meta = await newBoardSite('NP');
  assert.equal((await fetch(`${base}/sites/${meta.id}/live.png`)).status, 404);
});

test('POST /api/sites/:id/rasterize is 409 before publish (owner-gated)', async () => {
  const meta = await newBoardSite('NP2');
  // anonymous is rejected by requireSiteAccess
  assert.equal((await fetch(`${base}/api/sites/${meta.id}/rasterize`, { method: 'POST' })).status, 401);
  // owner, but nothing published yet
  const r = await fetch(`${base}/api/sites/${meta.id}/rasterize`, { method: 'POST', headers: { 'x-vellum-key': 'm' } });
  assert.equal(r.status, 409);
});

// --- real headless capture (opt-in) -----------------------------------------
test('e2e: publish + /live.png produces a real PNG at canvas size', { skip: process.env.PIXELBOARD_RASTER_E2E !== '1' }, async () => {
  const meta = await newBoardSite('REAL-V1');
  await fetch(`${base}/api/sites/${meta.id}/publish`, { method: 'POST', headers: { 'x-vellum-key': 'm' } });
  // force a deterministic (awaited) capture rather than racing the async publish hook
  const rz = await fetch(`${base}/api/sites/${meta.id}/rasterize`, { method: 'POST', headers: { 'x-vellum-key': 'm' } });
  assert.equal(rz.status, 200);
  const meta2 = await rz.json();
  assert.equal(meta2.width, 400);
  assert.equal(meta2.height, 300);

  const img = await fetch(`${base}/sites/${meta.id}/live.png`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await img.arrayBuffer());
  assert.equal(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a'); // PNG magic
  assert.ok(buf.length > 100);
});
