// Supabase storage (Vercel deploy). Same exports and same on-disk layout as
// storage_fs.js, but each "file" is a row in pixelboard.objects keyed by its
// relative path, reached via service_role-only RPCs. Multi-file writes go through
// one put_many call, so a killed invocation can't leave a half-written site.
// Binary assets go to the private storage bucket `pixelboard-assets`.

import { randomUUID, createHash } from 'node:crypto';

const URL_ = (process.env.PIXELBOARD_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.PIXELBOARD_SUPABASE_KEY || '';
const BUCKET = 'pixelboard-assets';

const shortId = () => randomUUID().replace(/-/g, '').slice(0, 12);
const now = () => new Date().toISOString();
// ids are hex; anything else (notably LIKE wildcards % and _) is refused outright.
const site = (id, ...rest) => {
  if (!/^[a-z0-9-]+$/i.test(String(id))) throw Object.assign(new Error('bad site id'), { status: 404 });
  return ['sites', id, ...rest].join('/');
};

async function rpc(fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`store ${fn} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const getText = (path) => rpc('pixelboard_get', { p_path: path });
async function getJson(path, fallback) {
  const t = await getText(path);
  if (t == null) {
    if (fallback !== undefined) return fallback;
    throw new Error(`not found: ${path}`);
  }
  return JSON.parse(t);
}
/** files: { path: string | object } — objects are JSON-encoded. */
const putMany = (files) => rpc('pixelboard_put_many', {
  items: Object.entries(files).map(([path, v]) => ({ path, body: typeof v === 'string' ? v : JSON.stringify(v, null, 2) })),
});
const list = (pattern, withBody = true) => rpc('pixelboard_list', { pattern, with_body: withBody });

function versionFile(id, content, message) {
  const vid = shortId();
  const version = { id: vid, message: message || '', createdAt: now() };
  return { version, path: site(id, 'versions', `${vid}.json`), body: { ...version, content } };
}

export async function createSite({ name, sourceUrl, template, slots, content }) {
  const id = shortId();
  const meta = { id, name: name || sourceUrl || 'Untitled site', sourceUrl, createdAt: now(), updatedAt: now() };
  const v = versionFile(id, content, 'Ingested');
  await putMany({
    [site(id, 'site.json')]: meta,
    [site(id, 'template.html')]: template,
    [site(id, 'slots.json')]: slots,
    [site(id, 'content.json')]: content,
    [v.path]: v.body,
  });
  return meta;
}

export async function listSites() {
  const rows = await list('sites/%/site.json');
  const auth = new Set((await list('sites/%/auth.json', false)).map((r) => r.path.split('/')[1]));
  return rows
    .map((r) => JSON.parse(r.body))
    .map((meta) => ({ ...meta, protected: auth.has(meta.id) }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getSite(id) {
  const rows = await list(site(id, '%'));
  const files = Object.fromEntries(rows.filter((r) => !r.path.slice(site(id).length + 1).includes('/')).map((r) => [r.path, r.body]));
  const meta = files[site(id, 'site.json')];
  if (!meta) return null;
  return {
    meta: JSON.parse(meta),
    template: files[site(id, 'template.html')] ?? '',
    slots: JSON.parse(files[site(id, 'slots.json')] ?? '[]'),
    content: JSON.parse(files[site(id, 'content.json')] ?? '{}'),
  };
}

export async function saveContent(id, content, message) {
  const meta = await getJson(site(id, 'site.json'));
  meta.updatedAt = now();
  const v = versionFile(id, content, message || 'Edit');
  await putMany({ [site(id, 'content.json')]: content, [site(id, 'site.json')]: meta, [v.path]: v.body });
  return v.version;
}

export async function saveBoard(id, board) {
  await putMany({ [site(id, 'board.json')]: board });
}

export async function getBoard(id) {
  return getJson(site(id, 'board.json'), null);
}

export async function saveArtifact(id, { template, slots, content }, message) {
  const meta = await getJson(site(id, 'site.json'));
  meta.updatedAt = now();
  const v = versionFile(id, content, message || 'Recompiled');
  await putMany({
    [site(id, 'template.html')]: template,
    [site(id, 'slots.json')]: slots,
    [site(id, 'content.json')]: content,
    [site(id, 'site.json')]: meta,
    [v.path]: v.body,
  });
  return v.version;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

export async function saveAsset(id, buffer, ext) {
  const file = createHash('sha256').update(buffer).digest('hex').slice(0, 16) + '.' + ext;
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${id}/${file}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': MIME[ext] || 'application/octet-stream', 'x-upsert': 'true' },
    body: buffer,
  });
  if (!res.ok) throw new Error(`asset upload failed: ${res.status} ${await res.text()}`);
  return file;
}

export async function readAsset(id, file) {
  const name = String(file).split('/').pop();
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${id}/${name}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`asset read failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function listBoards() {
  const boards = new Set((await list('sites/%/board.json', false)).map((r) => r.path.split('/')[1]));
  return (await listSites()).filter((s) => boards.has(s.id));
}

export async function listVersions(id) {
  const rows = await list(site(id, 'versions', '%'));
  return rows
    .map((r) => JSON.parse(r.body))
    .map((v) => ({ id: v.id, message: v.message, createdAt: v.createdAt }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getVersion(id, versionId) {
  return getJson(site(id, 'versions', `${versionId}.json`), null);
}

export async function savePublish(id, html, contentHashSource) {
  const sid = shortId();
  const hash = createHash('sha256').update(contentHashSource).digest('hex').slice(0, 16);
  const meta = { id: sid, hash, createdAt: now() };
  await putMany({ [site(id, 'snapshots', sid, 'index.html')]: html, [site(id, 'snapshots', sid, 'meta.json')]: meta });
  return meta;
}

export async function listSnapshots(id) {
  const rows = await list(site(id, 'snapshots', '%', 'meta.json'));
  return rows.map((r) => JSON.parse(r.body)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function readSnapshot(id, snapshotId) {
  return getText(site(id, 'snapshots', String(snapshotId).split('/').pop(), 'index.html'));
}

export async function setClientAuth(id, material) {
  if (!(await siteExists(id))) return false;
  await putMany({ [site(id, 'auth.json')]: { ...material, updatedAt: now() } });
  return true;
}

export async function getClientAuth(id) {
  return getJson(site(id, 'auth.json'), null);
}

export async function clearClientAuth(id) {
  await rpc('pixelboard_delete', { p_path: site(id, 'auth.json') });
}

export async function siteExists(id) {
  return (await getText(site(id, 'site.json'))) != null;
}

export async function isProtected(id) {
  return (await getClientAuth(id)) != null;
}

/** The newest snapshot's meta, or null if the site was never published. */
export async function latestSnapshot(id) {
  return (await listSnapshots(id))[0] || null;
}

// --- flat-image (rasterized) snapshots (ADR-006): PNG in the assets bucket ----
const imgName = (id, snapshotId) => `${id}/snap-${String(snapshotId).split('/').pop()}.png`;

export async function savePublishImage(id, snapshotId, pngBuffer) {
  if ((await getText(site(id, 'snapshots', String(snapshotId).split('/').pop(), 'meta.json'))) == null) return false;
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${imgName(id, snapshotId)}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: pngBuffer,
  });
  if (!res.ok) throw new Error(`snapshot image upload failed: ${res.status} ${await res.text()}`);
  return true;
}

export async function readPublishImage(id, snapshotId) {
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${imgName(id, snapshotId)}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`snapshot image read failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
