// AI layer: pure helpers + the chat route. The route is tested with the 'mock'
// provider, where the user message IS the JSON proposal — so we can drive exact
// Guardian outcomes (accept / reject / no-op) without a network call or API key.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = path.join(os.tmpdir(), `vellum-ai-${process.pid}`);
process.env.VELLUM_DATA_DIR = TMP;
process.env.VELLUM_MASTER_KEY = 'm';
process.env.VELLUM_SESSION_SECRET = 's';
process.env.VELLUM_AI_PROVIDER = 'mock';

const { ingest } = await import('../src/ingest.js');
const store = await import('../src/storage.js');
const ai = await import('../src/ai.js');
const { createApp } = await import('../src/server.js');

const SAMPLE = '<html><body><h1>Old heading</h1><p>Body text.</p></body></html>';

// --- pure helpers -----------------------------------------------------------

test('aiProvider honors explicit VELLUM_AI_PROVIDER', () => {
  assert.equal(ai.aiProvider(), 'mock');
  assert.equal(ai.aiConfigured(), true);
});

test('buildUserPrompt lists slots with ids and current values', () => {
  const { slots, content } = ingest(SAMPLE);
  const prompt = ai.buildUserPrompt(slots, content, 'change the heading');
  const h1 = slots.find((s) => s.label === 'Heading 1');
  assert.ok(prompt.includes(`id=${h1.id}`));
  assert.ok(prompt.includes('Old heading'));
  assert.ok(prompt.includes('User request: change the heading'));
});

test('toChangesMap converts array -> map and drops malformed entries', () => {
  const map = ai.toChangesMap({ changes: [
    { slot_id: 'a', value: 'x' },
    { slot_id: 'b', value: 'y' },
    { slot_id: 'c' },            // missing value -> dropped
    { value: 'z' },              // missing id -> dropped
    null,                        // junk -> dropped
  ] });
  assert.deepEqual(map, { a: 'x', b: 'y' });
});

test('proposeChanges (mock) round-trips a proposal through the provider', async () => {
  const { slots, content } = ingest(SAMPLE);
  const h1 = slots.find((s) => s.label === 'Heading 1');
  const message = JSON.stringify({ reply: 'done', changes: [{ slot_id: h1.id, value: 'New heading' }] });
  const out = await ai.proposeChanges({ slots, content, message });
  assert.equal(out.reply, 'done');
  assert.deepEqual(out.changes, { [h1.id]: 'New heading' });
});

// --- chat route (mock provider, real Guardian) ------------------------------

let server; let base; let SID; let H1;

before(async () => {
  await fs.mkdir(TMP, { recursive: true });
  const ing = ingest(SAMPLE);
  SID = (await store.createSite({ name: 'AI', sourceUrl: 'https://ai.test', ...ing })).id;
  H1 = ing.slots.find((s) => s.label === 'Heading 1').id;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)).then(() => fs.rm(TMP, { recursive: true, force: true })));

const chat = (proposal) => fetch(`${base}/api/sites/${SID}/chat`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' },
  body: JSON.stringify({ message: JSON.stringify(proposal) }),
});

test('chat applies a valid AI-proposed change (Guardian accepts)', async () => {
  const r = await chat({ reply: 'updated the heading', changes: [{ slot_id: H1, value: 'AI heading' }] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.applied[H1], 'AI heading');
  // persisted
  const site = await store.getSite(SID);
  assert.equal(site.content[H1], 'AI heading');
});

test('chat rejects an AI proposal the Guardian blocks (markup)', async () => {
  const r = await chat({ reply: 'tried', changes: [{ slot_id: H1, value: '<script>x</script>' }] });
  assert.equal(r.status, 422);
  const d = await r.json();
  assert.equal(d.ok, false);
  assert.equal(d.errors[0].code, 'html_not_allowed');
  // NOT persisted — still the previous valid value
  const site = await store.getSite(SID);
  assert.equal(site.content[H1], 'AI heading');
});

test('chat rejects an AI proposal targeting an unknown slot', async () => {
  const r = await chat({ reply: 'oops', changes: [{ slot_id: 'deadbeefdead', value: 'x' }] });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).errors[0].code, 'unknown_slot');
});

test('chat with no proposed changes is a clean no-op', async () => {
  const r = await chat({ reply: "I can't do that with content edits.", changes: [] });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.applied, {});
});

test('chat requires authorization (anonymous denied)', async () => {
  const r = await fetch(`${base}/api/sites/${SID}/chat`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(r.status, 401);
});

test('generateBoard (mock) returns a schema-valid board at the given canvas', async () => {
  const { validateBoard } = await import('../src/board/schema.js');
  const { board, reply } = await ai.generateBoard({ canvas: { w: 1080, h: 1920 }, message: 'Taco Tuesday' });
  assert.ok(reply);
  assert.deepEqual(board.canvas, { w: 1080, h: 1920 });
  assert.equal(validateBoard(board).ok, true);
});

test('POST /api/studio/boards/:id/generate returns a validated board (mock, owner-gated)', async () => {
  const { compileBoard } = await import('../src/board/compile.js');
  const board = { name: 'G', canvas: { w: 1080, h: 1080 }, elements: [{ id: 'bg', type: 'rect', x: 0, y: 0, w: 1080, h: 1080, style: { background: '#000000' } }] };
  const meta = await store.createSite({ name: 'G', sourceUrl: 'studio', ...compileBoard(board) });
  await store.saveBoard(meta.id, board);
  const r = await fetch(`${base}/api/studio/boards/${meta.id}/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' },
    body: JSON.stringify({ message: 'Happy Hour' }),
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.board.canvas.w, 1080);
  // owner-gated: no key -> 401
  const r2 = await fetch(`${base}/api/studio/boards/${meta.id}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x' }) });
  assert.equal(r2.status, 401);
});

test('/sites/:id/live serves the latest published snapshot and flips on republish', async () => {
  const { compileBoard } = await import('../src/board/compile.js');
  const board = { name: 'L', canvas: { w: 1080, h: 1080 }, elements: [
    { id: 't', type: 'text', x: 10, y: 10, w: 500, h: 100, value: 'LIVE-V1', slot: { editable: true, label: 'T' } },
  ] };
  const art = compileBoard(board);
  const meta = await store.createSite({ name: 'L', sourceUrl: 'studio', ...art });
  await store.saveBoard(meta.id, board);
  // before publish -> not-published page (404)
  assert.equal((await fetch(`${base}/sites/${meta.id}/live`)).status, 404);
  // publish v1
  await fetch(`${base}/api/sites/${meta.id}/publish`, { method: 'POST', headers: { 'x-vellum-key': 'm' } });
  const r1 = await fetch(`${base}/sites/${meta.id}/live`);
  assert.equal(r1.status, 200);
  assert.match(await r1.text(), /LIVE-V1/);
  // edit + republish -> /live flips to v2
  await store.saveContent(meta.id, { [art.slots[0].id]: 'LIVE-V2' }, 'edit');
  await fetch(`${base}/api/sites/${meta.id}/publish`, { method: 'POST', headers: { 'x-vellum-key': 'm' } });
  assert.match(await (await fetch(`${base}/sites/${meta.id}/live`)).text(), /LIVE-V2/);
});

test('create-from-template instantiates a real, editable board (owner-gated)', async () => {
  const { listTemplates } = await import('../src/templates.js');
  const tid = listTemplates()[0].id;
  // owner-gated
  assert.equal((await fetch(`${base}/api/studio/templates`)).status, 401);
  // template preview renders publish HTML
  const pv = await fetch(`${base}/studio/templates/${tid}/preview`, { headers: { 'x-vellum-key': 'm' } });
  assert.equal(pv.status, 200);
  assert.match(await pv.text(), /pb-board/);
  // create a board from the template
  const r = await fetch(`${base}/api/studio/boards`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' },
    body: JSON.stringify({ templateId: tid }),
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  const site = await store.getSite(d.siteId);
  assert.ok(site.slots.length >= 1);
  assert.ok(await store.getBoard(d.siteId));
  // unknown template -> 404
  const r2 = await fetch(`${base}/api/studio/boards`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' }, body: JSON.stringify({ templateId: 'nope' }) });
  assert.equal(r2.status, 404);
});

test('POST /api/studio/boards/ai creates+generates+saves a board (mock, owner-gated)', async () => {
  const r = await fetch(`${base}/api/studio/boards/ai`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' },
    body: JSON.stringify({ message: 'Taco Tuesday', w: 1920, h: 1080 }),
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(d.siteId && d.url);
  const site = await store.getSite(d.siteId);
  assert.ok(site.slots.length >= 1);            // generated + saved (not just created blank)
  assert.ok(await store.getBoard(d.siteId));
  // owner-gated + empty message rejected
  assert.equal((await fetch(`${base}/api/studio/boards/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"x"}' })).status, 401);
  assert.equal((await fetch(`${base}/api/studio/boards/ai`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' }, body: '{"message":""}' })).status, 400);
});

test('AI create accepts content+style (two-field mode) and requires one of them', async () => {
  const r = await fetch(`${base}/api/studio/boards/ai`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' },
    body: JSON.stringify({ text: "Today's Special\n$9.99", style: 'dark and bold', w: 1920, h: 1080 }),
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok((await store.getSite(d.siteId)).slots.length >= 1);
  // neither text nor message -> 400
  const r2 = await fetch(`${base}/api/studio/boards/ai`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vellum-key': 'm' }, body: '{"style":"dark"}' });
  assert.equal(r2.status, 400);
});

// --- gradient sanitizer (AI background generation, ADR-005 + ADR-006 follow-up) ---

test('sanitizeGradient: linear keeps {type,angle,stops}, drops stray radial keys + clamps angle', () => {
  const g = ai.sanitizeGradient({ type: 'linear', angle: 540, position: { x: 1, y: 2 }, size: { w: 9, h: 9 },
    stops: [{ color: '#000', at: 0 }, { color: '#fff', at: 100 }] });
  assert.deepEqual(Object.keys(g).sort(), ['angle', 'stops', 'type']);
  assert.equal(g.angle, 360); // clamped from 540
});

test('sanitizeGradient: radial drops stray angle, keeps valid position/size only', () => {
  const g = ai.sanitizeGradient({ type: 'radial', angle: 90, position: { x: 30, y: 35 }, size: { w: 800, h: 50 },
    stops: [{ color: '#111', at: 0 }, { color: '#000', at: 100 }] });
  assert.equal(g.angle, undefined);
  assert.deepEqual(g.position, { x: 30, y: 35 });
  assert.equal(g.size, undefined); // w=800 out of 0..400 range -> dropped, not invalid
});

test('sanitizeGradient: sorts/clamps stops and rejects the unsalvageable', () => {
  const g = ai.sanitizeGradient({ type: 'linear', angle: 180,
    stops: [{ color: '#fff', at: 120 }, { color: '#000', at: -10 }] }); // out of order + out of range
  assert.deepEqual(g.stops, [{ color: '#000', at: 0 }, { color: '#fff', at: 100 }]); // clamped + sorted
  assert.equal(ai.sanitizeGradient({ type: 'linear', stops: [{ color: '#000', at: 0 }] }), null); // <2 stops
  assert.equal(ai.sanitizeGradient({ type: 'conic', stops: [] }), null); // bad type
});

test('enhanceBoardBackgrounds: dark flat bg -> radial gradient + legibility scrim, still valid', async () => {
  const { validateBoard } = await import('../src/board/schema.js');
  const canvas = { w: 1920, h: 1080 };
  const board = { name: 'D', canvas, elements: [
    { id: 'bg', type: 'rect', x: 0, y: 0, w: 1920, h: 1080, style: { background: '#0a0a0a' } },
    { id: 'title', type: 'text', x: 100, y: 100, w: 1720, h: 200, value: 'Hi', style: { color: '#fff', fontFamily: 'inter', fontSize: 120, fontWeight: 800 }, slot: { editable: true, label: 'T' } },
  ] };
  ai.enhanceBoardBackgrounds(board, canvas);
  const bg = board.elements.find((e) => e.id === 'bg');
  assert.equal(bg.style.backgroundGradient.type, 'radial');
  assert.equal(bg.style.background, '#0a0a0a'); // kept as fallback
  const scrim = board.elements.find((e) => e.id === 'bgscrim');
  assert.ok(scrim, 'dark board gets a scrim');
  assert.equal(board.elements.indexOf(scrim), 1); // above bg, below the title
  assert.equal(validateBoard(board).ok, true);
});

test('enhanceBoardBackgrounds: light bg gets a gradient but NO darkening scrim; idempotent', async () => {
  const canvas = { w: 1080, h: 1080 };
  const board = { name: 'L', canvas, elements: [
    { id: 'bg', type: 'rect', x: 0, y: 0, w: 1080, h: 1080, style: { background: '#f5efe6' } },
  ] };
  ai.enhanceBoardBackgrounds(board, canvas);
  assert.equal(board.elements.find((e) => e.id === 'bg').style.backgroundGradient.type, 'radial');
  assert.equal(board.elements.find((e) => e.id === 'bgscrim'), undefined); // no scrim on light boards
  const n = board.elements.length;
  ai.enhanceBoardBackgrounds(board, canvas); // idempotent: bg already has a gradient
  assert.equal(board.elements.length, n);
});

test('sanitizeGradient output passes the real validateBoard whitelist', async () => {
  const { validateBoard } = await import('../src/board/schema.js');
  const lin = ai.sanitizeGradient({ type: 'linear', angle: 200, stops: [{ color: 'rgba(4,13,28,0)', at: 0 }, { color: 'rgba(4,13,28,0.7)', at: 100 }] });
  const rad = ai.sanitizeGradient({ type: 'radial', position: { x: 30, y: 35 }, size: { w: 120, h: 120 }, stops: [{ color: '#241226', at: 0 }, { color: '#0a0a0a', at: 100 }] });
  const board = { name: 'G', canvas: { w: 1920, h: 1080 }, elements: [
    { id: 'bg', type: 'rect', x: 0, y: 0, w: 1920, h: 1080, style: { backgroundGradient: rad } },
    { id: 'scrim', type: 'rect', x: 0, y: 0, w: 1920, h: 1080, style: { opacity: 0.8, backgroundGradient: lin } },
  ] };
  assert.equal(validateBoard(board).ok, true);
});
