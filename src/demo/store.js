// Demo build only: a localStorage stand-in for src/storage.js. Same shape —
// HEAD content + an append-only version log + immutable publish snapshots — and
// the same method names, but synchronous and in the browser. Seeded with the
// fictional boards on first load (or after "Reset demo").

import { compile, validateBoard, render, BASE } from './engine.js';
import { SEEDS } from './seeds.js';
import { randomHex, createHash } from './shims/node-crypto.js';

const KEY = 'pixelboard-demo';
const SEED_VERSION = 3; // bump to force every visitor back to a fresh seed
const MAX_SNAPSHOTS = 12; // demo cap so localStorage can't fill (the product keeps all)
const now = () => new Date().toISOString();

let state = null;
let seeding = false;

function persist() {
  if (seeding) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    const err = new Error('Demo storage is full (this demo keeps everything in your browser). Use “Reset demo” to start fresh.');
    err.code = 'quota';
    throw err;
  }
}

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.v === SEED_VERSION && parsed.sites) { state = parsed; return state; }
  } catch { /* corrupt or blocked storage: reseed */ }
  seed();
  return state;
}

function seed() {
  state = { v: SEED_VERSION, order: [], sites: {} };
  seeding = true;
  for (const s of SEEDS) {
    const board = s.build(BASE);
    const verdict = validateBoard(board);
    if (!verdict.ok) throw new Error(`seed ${s.id} fails validateBoard: ${verdict.errors.map((e) => e.path + ' ' + e.message).join('; ')}`);
    const artifact = compile(board);
    createSite({ id: s.id, name: board.name, sourceUrl: 'studio', ...artifact }, 'Designed in the studio');
    saveBoard(s.id, board);
    const site = getSite(s.id);
    savePublish(s.id, render({ template: site.template, slots: site.slots, content: site.content, mode: 'publish' }), JSON.stringify(site.content));
  }
  seeding = false;
  try { persist(); } catch { /* storage blocked: the demo still works in-memory for this page */ }
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state = null;
  load();
}

export function createSite({ id, name, sourceUrl, template, slots, content, board = null }, message = 'Ingested') {
  load();
  const sid = id || randomHex(12);
  state.sites[sid] = {
    meta: { id: sid, name: name || 'Untitled site', sourceUrl, createdAt: now(), updatedAt: now() },
    template, slots, content, board, versions: [], snapshots: [],
  };
  state.order.push(sid);
  saveVersion(sid, content, message);
  persist();
  return state.sites[sid].meta;
}

const raw = (id) => load().sites[id] || null;

export function listSites() {
  load();
  return state.order.map((id) => state.sites[id]?.meta).filter(Boolean);
}
export function siteExists(id) { return !!raw(id); }

/** meta + template + slots + HEAD content (deep copies — callers can't mutate the store). */
export function getSite(id) {
  const s = raw(id);
  if (!s) return null;
  return structuredClone({ meta: s.meta, template: s.template, slots: s.slots, content: s.content });
}

function saveVersion(id, content, message) {
  const version = { id: randomHex(12), message: message || '', createdAt: now() };
  raw(id).versions.push({ ...version, content: structuredClone(content) });
  return version;
}

/** Replace HEAD content and append an immutable version. */
export function saveContent(id, content, message) {
  const s = raw(id);
  s.content = structuredClone(content);
  s.meta.updatedAt = now();
  const v = saveVersion(id, content, message || 'Edit');
  persist();
  return v;
}

export function saveBoard(id, board) { raw(id).board = structuredClone(board); persist(); }
export function getBoard(id) { const b = raw(id)?.board; return b ? structuredClone(b) : null; }

export function saveArtifact(id, { template, slots, content }, message) {
  const s = raw(id);
  Object.assign(s, { template, slots, content: structuredClone(content) });
  s.meta.updatedAt = now();
  const v = saveVersion(id, content, message || 'Recompiled');
  persist();
  return v;
}

export function listBoards() { return listSites().filter((m) => raw(m.id).board); }

export function listVersions(id) {
  return [...(raw(id)?.versions || [])].reverse().map(({ id: vid, message, createdAt }) => ({ id: vid, message, createdAt }));
}
export function getVersion(id, versionId) {
  const v = (raw(id)?.versions || []).find((x) => x.id === versionId);
  return v ? structuredClone(v) : null;
}

/** Immutable publish snapshot of rendered HTML. */
export function savePublish(id, html, contentHashSource) {
  const s = raw(id);
  const snap = { id: randomHex(12), hash: createHash('sha256').update(contentHashSource).digest('hex').slice(0, 16), createdAt: now(), html };
  s.snapshots.push(snap);
  while (s.snapshots.length > MAX_SNAPSHOTS) s.snapshots.shift();
  persist();
  return { id: snap.id, hash: snap.hash, createdAt: snap.createdAt };
}
export function listSnapshots(id) {
  return [...(raw(id)?.snapshots || [])].reverse().map(({ id: sid, hash, createdAt }) => ({ id: sid, hash, createdAt }));
}
export function readSnapshot(id, snapshotId) {
  return (raw(id)?.snapshots || []).find((x) => x.id === snapshotId)?.html ?? null;
}

/** Re-read from localStorage (another tab may have published). */
export function refresh() { state = null; return load(); }
