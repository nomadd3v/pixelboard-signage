// Filesystem storage. One directory per site; content is HEAD; versions and
// publish snapshots are immutable. Graduates to a document DB later (ADR-001).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.VELLUM_DATA_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const sitesDir = () => path.join(ROOT, 'sites');
const siteDir = (id) => path.join(sitesDir(), id);

const shortId = () => randomUUID().replace(/-/g, '').slice(0, 12);
const now = () => new Date().toISOString();

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
}
async function writeJson(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
}

/** Create a site from an ingest result. */
export async function createSite({ name, sourceUrl, template, slots, content }) {
  const id = shortId();
  const dir = siteDir(id);
  await fs.mkdir(dir, { recursive: true });
  const meta = { id, name: name || sourceUrl || 'Untitled site', sourceUrl, createdAt: now(), updatedAt: now() };
  await writeJson(path.join(dir, 'site.json'), meta);
  await fs.writeFile(path.join(dir, 'template.html'), template);
  await writeJson(path.join(dir, 'slots.json'), slots);
  await writeJson(path.join(dir, 'content.json'), content);
  // seed version 0
  await saveVersion(id, content, 'Ingested');
  return meta;
}

export async function listSites() {
  let entries;
  try {
    entries = await fs.readdir(sitesDir(), { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const meta = await readJson(path.join(siteDir(ent.name), 'site.json'), null);
    if (meta) out.push({ ...meta, protected: await isProtected(meta.id) });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Load a full site: meta + template + slots + HEAD content. */
export async function getSite(id) {
  const dir = siteDir(id);
  const meta = await readJson(path.join(dir, 'site.json'), null);
  if (!meta) return null;
  return {
    meta,
    template: await fs.readFile(path.join(dir, 'template.html'), 'utf8'),
    slots: await readJson(path.join(dir, 'slots.json'), []),
    content: await readJson(path.join(dir, 'content.json'), {}),
  };
}

async function saveVersion(id, content, message) {
  const vid = shortId();
  const version = { id: vid, message: message || '', createdAt: now() };
  await writeJson(path.join(siteDir(id), 'versions', `${vid}.json`), { ...version, content });
  return version;
}

/** Replace HEAD content and append an immutable version. */
export async function saveContent(id, content, message) {
  const dir = siteDir(id);
  await writeJson(path.join(dir, 'content.json'), content);
  const meta = await readJson(path.join(dir, 'site.json'));
  meta.updatedAt = now();
  await writeJson(path.join(dir, 'site.json'), meta);
  return saveVersion(id, content, message || 'Edit');
}

// --- boards (design surface, ADR-004) ---------------------------------------
// A board-backed site stores its design doc as board.json alongside the compiled
// artifact (template/slots/content). Recompiling overwrites the artifact while
// PRESERVING client content for slot ids that still exist.

export async function saveBoard(id, board) {
  await writeJson(path.join(siteDir(id), 'board.json'), board);
}

export async function getBoard(id) {
  return readJson(path.join(siteDir(id), 'board.json'), null);
}

/** Overwrite the compiled artifact + content for a board-backed site; append a version. */
export async function saveArtifact(id, { template, slots, content }, message) {
  const dir = siteDir(id);
  await fs.writeFile(path.join(dir, 'template.html'), template);
  await writeJson(path.join(dir, 'slots.json'), slots);
  await writeJson(path.join(dir, 'content.json'), content);
  const meta = await readJson(path.join(dir, 'site.json'));
  meta.updatedAt = now();
  await writeJson(path.join(dir, 'site.json'), meta);
  return saveVersion(id, content, message || 'Recompiled');
}

// Uploaded assets: hosted by Pixelboard per-site so designed boards (and their
// published snapshots) don't depend on external image URLs. Content-addressed.
export async function saveAsset(id, buffer, ext) {
  const file = createHash('sha256').update(buffer).digest('hex').slice(0, 16) + '.' + ext;
  const dir = path.join(siteDir(id), 'assets');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), buffer);
  return file;
}

export async function readAsset(id, file) {
  try {
    return await fs.readFile(path.join(siteDir(id), 'assets', path.basename(file)));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Sites that have a board.json (created from the studio). */
export async function listBoards() {
  const sites = await listSites();
  const out = [];
  for (const s of sites) if (await getBoard(s.id)) out.push(s);
  return out;
}

export async function listVersions(id) {
  const dir = path.join(siteDir(id), 'versions');
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const v = await readJson(path.join(dir, f));
    out.push({ id: v.id, message: v.message, createdAt: v.createdAt });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getVersion(id, versionId) {
  return readJson(path.join(siteDir(id), 'versions', `${versionId}.json`), null);
}

/** Write an immutable publish snapshot. `html` is the rendered static page. */
export async function savePublish(id, html, contentHashSource) {
  const sid = shortId();
  const hash = createHash('sha256').update(contentHashSource).digest('hex').slice(0, 16);
  const dir = path.join(siteDir(id), 'snapshots', sid);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), html);
  const meta = { id: sid, hash, createdAt: now() };
  await writeJson(path.join(dir, 'meta.json'), meta);
  return meta;
}

export async function listSnapshots(id) {
  const dir = path.join(siteDir(id), 'snapshots');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const meta = await readJson(path.join(dir, ent.name, 'meta.json'), null);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function readSnapshot(id, snapshotId) {
  try {
    return await fs.readFile(path.join(siteDir(id), 'snapshots', snapshotId, 'index.html'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// --- client auth (kept in auth.json, never exposed via site responses) ------

const authPath = (id) => path.join(siteDir(id), 'auth.json');

/** Store hashed password material for a site's client. `material` = {salt,hash}. */
export async function setClientAuth(id, material) {
  if (!(await siteExists(id))) return false;
  await writeJson(authPath(id), { ...material, updatedAt: now() });
  return true;
}

/** Read a site's stored client auth material, or null if the site is open. */
export async function getClientAuth(id) {
  return readJson(authPath(id), null);
}

/** Remove a site's client password (revert it to owner-only). */
export async function clearClientAuth(id) {
  try {
    await fs.unlink(authPath(id));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

export async function siteExists(id) {
  return (await readJson(path.join(siteDir(id), 'site.json'), null)) != null;
}

/** True if the site has a client password set. */
export async function isProtected(id) {
  return (await getClientAuth(id)) != null;
}

/** The newest snapshot's meta, or null if the site was never published. */
export async function latestSnapshot(id) {
  const snaps = await listSnapshots(id); // newest-first
  return snaps[0] || null;
}

// --- flat-image (rasterized) snapshots (ADR-006) ----------------------------
// A PNG beside a snapshot's index.html: the pixel-exact frame a dumb screen polls.

export async function savePublishImage(id, snapshotId, pngBuffer) {
  const dir = path.join(siteDir(id), 'snapshots', path.basename(snapshotId));
  if (!(await readJson(path.join(dir, 'meta.json'), null))) return false; // no such snapshot
  await fs.writeFile(path.join(dir, 'display.png'), pngBuffer);
  return true;
}

export async function readPublishImage(id, snapshotId) {
  try {
    return await fs.readFile(path.join(siteDir(id), 'snapshots', path.basename(snapshotId), 'display.png'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
