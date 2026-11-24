// Integration: ingest -> create -> guarded edit -> publish -> rollback.
// Uses an isolated VELLUM_DATA_DIR set before storage.js loads.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `vellum-test-${process.pid}`);
process.env.VELLUM_DATA_DIR = TMP;

const { ingest } = await import('../src/ingest.js');
const { guardian } = await import('../src/guardian.js');
const { render } = await import('../src/render.js');
const { compileBoard } = await import('../src/board/compile.js');
const store = await import('../src/storage.js');

const SAMPLE = `<html><body><h1>Old title</h1><p>Body text here.</p>
<img src="/a.png" alt="pic"></body></html>`;

before(async () => { await fs.mkdir(TMP, { recursive: true }); });
after(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

test('full lifecycle: ingest, edit, publish, rollback', async () => {
  const ing = ingest(SAMPLE);
  const meta = await store.createSite({ name: 'Test Co', sourceUrl: 'https://t.test', ...ing });
  assert.ok(meta.id);

  // site is listable and loadable
  assert.ok((await store.listSites()).some((s) => s.id === meta.id));
  const site = await store.getSite(meta.id);
  assert.equal(site.slots.length, ing.slots.length);

  // a guarded edit to the h1
  const h1 = site.slots.find((s) => s.label === 'Heading 1');
  const changes = { [h1.id]: 'New title' };
  assert.equal(guardian(site.slots, changes).ok, true);
  const next = { ...site.content, ...changes };
  await store.saveContent(meta.id, next, 'rename');

  // HEAD reflects the edit; publish renders it into an immutable snapshot
  const after2 = await store.getSite(meta.id);
  assert.equal(after2.content[h1.id], 'New title');
  const html = render({ template: after2.template, slots: after2.slots, content: after2.content, mode: 'publish' });
  assert.ok(html.includes('New title'));
  assert.ok(!html.includes('data-v-attr'));
  const snap = await store.savePublish(meta.id, html, JSON.stringify(after2.content));
  assert.ok(snap.id && snap.hash);
  const served = await store.readSnapshot(meta.id, snap.id);
  assert.ok(served.includes('New title'));

  // versions exist; rollback to the first (ingest) version restores old title
  const versions = await store.listVersions(meta.id);
  assert.ok(versions.length >= 2);
  const ingestVersion = versions[versions.length - 1]; // oldest
  const full = await store.getVersion(meta.id, ingestVersion.id);
  await store.saveContent(meta.id, full.content, 'rollback');
  const rolled = await store.getSite(meta.id);
  assert.equal(rolled.content[h1.id], 'Old title');

  // ...but the published snapshot is immutable — still shows New title
  assert.ok((await store.readSnapshot(meta.id, snap.id)).includes('New title'));
});

test('asset upload round-trips (content-addressed) and resists traversal', async () => {
  const meta = await store.createSite({ name: 'Assets', sourceUrl: 'x', ...ingest(SAMPLE) });
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const file = await store.saveAsset(meta.id, buf, 'png');
  assert.match(file, /^[0-9a-f]{16}\.png$/);
  assert.deepEqual(await store.readAsset(meta.id, file), buf);
  assert.equal(await store.saveAsset(meta.id, buf, 'png'), file); // same bytes -> same name
  assert.equal(await store.readAsset(meta.id, '../../etc/passwd'), null); // traversal neutralized
});

test('board recompile preserves client content by slot id (storage level)', async () => {
  const board = { name: 'B', canvas: { w: 1080, h: 1920 }, elements: [
    { id: 'h', type: 'text', x: 10, y: 10, w: 500, h: 100, value: 'A', slot: { editable: true, label: 'H' } },
  ] };
  const a1 = compileBoard(board);
  const meta = await store.createSite({ name: 'B', sourceUrl: 'studio', ...a1 });
  await store.saveBoard(meta.id, board);
  const sid = a1.slots[0].id;
  await store.saveContent(meta.id, { ...a1.content, [sid]: 'CLIENT EDIT' }, 'edit');
  // designer moves + restyles, recompile preserving content
  const a2 = compileBoard({ ...board, elements: [{ ...board.elements[0], x: 900, y: 1500, style: { fontSize: 120 } }] });
  const cur = (await store.getSite(meta.id)).content;
  const merged = {};
  for (const s of a2.slots) merged[s.id] = cur[s.id] ?? a2.content[s.id];
  await store.saveArtifact(meta.id, { ...a2, content: merged }, 'recompile');
  assert.equal((await store.getSite(meta.id)).content[sid], 'CLIENT EDIT');
  assert.ok(await store.getBoard(meta.id));
});
