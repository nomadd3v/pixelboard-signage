// Vellum dashboard — Express. Routes: ingest, edit (Guardian-validated),
// preview, publish (immutable snapshots), versions + rollback, plus owner +
// per-site client auth (ADR-002).

import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { fetchHtml } from './fetch_url.js';
import { ingest } from './ingest.js';
import { validateBoard } from './board/schema.js';
import { compileBoard } from './board/compile.js';
import { listTemplates, instantiateTemplate } from './templates.js';
import { pickBackdrop, applyBackdrop, removeBackdrop, backdropByFile, tagsForBoard, listBackdrops } from './backdrops.js';
import { generateBespokeBackdrop } from './bespoke_backdrop.js';
import { guardian } from './guardian.js';
import { bundleHtml } from './bundle.js';
import { renderPng, chromePath } from './png.js';
import { convertSite, detectCanvas } from './board/convert.js';
import { render } from './render.js';
import { escapeText } from './ids.js';
import { fieldGroups, contentHashSource } from './fields.js';
import { createHash } from 'node:crypto';
import * as store from './storage.js';
import {
  hashPassword, verifyPassword, makeSession, verifyToken,
  parseCookies, serializeCookie, SITE_COOKIE, OWNER_COOKIE, SESSION_TTL_SECONDS,
} from './auth.js';
import { proposeChanges, aiConfigured, generateBoard } from './ai.js';
import { rasterizeUrl, RasterizeUnavailable } from './rasterize.js';
import { dashboardPage, editorShell, loginPage, ownerLoginPage, studioListPage, boardStudioPage, displayWrapper } from './pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_KEY = process.env.VELLUM_MASTER_KEY || '';

// On Vercel the app is public and the filesystem is ephemeral: refuse to boot
// rather than run as an open admin or silently lose data on the fs backend.
const ON_VERCEL = !!process.env.VERCEL;
if (ON_VERCEL) {
  const missing = ['VELLUM_MASTER_KEY', 'VELLUM_SESSION_SECRET', 'PIXELBOARD_SUPABASE_URL', 'PIXELBOARD_SUPABASE_KEY']
    .filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Pixelboard on Vercel needs: ${missing.join(', ')}`);
}
// Vercel caps request bodies at 4.5 MB; stay under it so uploads fail with our message.
const UPLOAD_LIMIT = ON_VERCEL ? '4mb' : '20mb';

function safeEq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- identity (derived only from verified payloads, never cookie names) -----
function ownerViaKey(req) {
  if (!MASTER_KEY) return true; // dev: open
  const key = req.get('x-vellum-key') || req.query.key || req.body?.key;
  return key != null && safeEq(key, MASTER_KEY);
}
function ownerViaCookie(req) {
  const p = verifyToken(req.cookies?.[OWNER_COOKIE]);
  return !!p && p.role === 'owner';
}
function isOwner(req) {
  return ownerViaKey(req) || ownerViaCookie(req);
}
/** Client access to a specific site: token must say client AND match this id. */
function isClientForSite(req, id) {
  const p = verifyToken(req.cookies?.[SITE_COOKIE(id)]);
  return !!p && p.role === 'client' && p.sid === id;
}

const wantsJson = (req) => req.path.startsWith('/api/');

function requireOwner(req, res, next) {
  if (isOwner(req)) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Owner key required.' });
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}
function requireSiteAccess(req, res, next) {
  const id = req.params.id;
  if (isOwner(req) || isClientForSite(req, id)) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'Login required.' });
  return res.redirect(`/sites/${id}/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/**
 * Native size of a site's board: the studio canvas, else the first fixed-size
 * element of an ingested signage page (e.g. a 1920×1080 artboard), else null
 * (an ordinary responsive website — shown full-width instead of scaled).
 */
function canvasOf(site, board) {
  if (board?.canvas?.w && board?.canvas?.h) return { w: board.canvas.w, h: board.canvas.h };
  return detectCanvas(site.template);
}

/**
 * Draft-vs-TV state for the editor: the newest snapshot (what the TV shows) and
 * whether HEAD content differs from it. Hash formula matches storage.savePublish.
 */
async function siteStatus(id, content) {
  const snaps = await store.listSnapshots(id); // newest first
  const live = snaps[0] || null;
  const hash = createHash('sha256').update(contentHashSource(content)).digest('hex').slice(0, 16);
  return {
    live: live ? { id: live.id, createdAt: live.createdAt } : null,
    dirty: !live || live.hash !== hash,
    liveUrl: `/sites/${id}/live/screen`,
    snapshots: snaps.map((s) => ({ id: s.id, createdAt: s.createdAt, current: s.hash === hash })),
  };
}

const asyncH = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message || 'Internal error.' });
});

const setSession = (res, name, token) =>
  res.append('Set-Cookie', serializeCookie(name, token, { maxAge: SESSION_TTL_SECONDS }));
const clearSession = (res, name) =>
  res.append('Set-Cookie', serializeCookie(name, '', { maxAge: 0 }));

// --- flat-image rasterization (ADR-006) -------------------------------------
// The capture target is the running server's OWN published-snapshot route, so
// assets/fonts/gradients resolve exactly as a browser would render them.
//
// Auto-capture on publish defaults ON, but is suppressed under `node --test` so
// the suite stays hermetic (no real browser launches). An explicit env wins, so
// the opt-in e2e leg can still exercise it. On-demand POST /rasterize and the
// lazy /live.png path always work — they only launch a browser when hit.
const RASTER_ON_PUBLISH = process.env.PIXELBOARD_RASTER_ON_PUBLISH != null
  ? process.env.PIXELBOARD_RASTER_ON_PUBLISH !== '0'
  : !process.env.NODE_TEST_CONTEXT; // node --test sets this; suppress real browsers in the suite
const selfOrigin = (req) => `${req.protocol}://${req.get('host')}`;
const canvasSize = (board) => ({ width: board?.canvas?.w || 1920, height: board?.canvas?.h || 1080 });

/** Rasterize one published snapshot to a PNG and store it beside the snapshot. */
async function rasterizeSnapshot(req, siteId, snapshotId, board) {
  const { width, height } = canvasSize(board);
  const png = await rasterizeUrl({
    url: `${selfOrigin(req)}/sites/${siteId}/published/${snapshotId}`,
    width, height,
  });
  await store.savePublishImage(siteId, snapshotId, png);
  return png;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.cookies = parseCookies(req.headers.cookie); next(); });
  app.use('/editor', express.static(path.join(__dirname, 'editor')));
  app.use('/studio-assets', express.static(path.join(__dirname, 'studio')));
  app.use('/vendor/fabric', express.static(path.join(__dirname, '..', 'node_modules', 'fabric', 'dist'))); // Fabric.js spike (ADR-004 path A)
  app.use(express.static(path.join(__dirname, '..', 'public'))); // brand assets (/branding/...), favicon

  // --- owner login ----------------------------------------------------------
  app.get('/login', (req, res) => res.type('html').send(ownerLoginPage(req.query.next)));
  app.post('/login', (req, res) => {
    if (!MASTER_KEY) return res.redirect('/'); // dev: no owner password
    if (!safeEq(req.body?.key || '', MASTER_KEY)) {
      return res.status(401).type('html').send(ownerLoginPage(req.body?.next, 'Incorrect key.'));
    }
    setSession(res, OWNER_COOKIE, makeSession({ sid: '*', role: 'owner' }));
    res.redirect(safeNext(req.body?.next, '/'));
  });
  app.post('/logout', (req, res) => { clearSession(res, OWNER_COOKIE); res.redirect('/login'); });

  // --- dashboard ------------------------------------------------------------
  app.get('/', requireOwner, asyncH(async (_req, res) => {
    const sites = await store.listSites();
    for (const s of sites) s.hasBoard = !!(await store.getBoard(s.id)); // studio-backed vs ingested
    res.type('html').send(dashboardPage(sites, !!chromePath()));
  }));

  // --- ingest a URL into a new site (owner only) ----------------------------
  app.post('/api/sites', requireOwner, asyncH(async (req, res) => {
    const { url, name, keepScripts } = req.body || {};
    if (!url) return res.status(400).json({ error: 'A url is required.' });
    const html = await fetchHtml(url);
    // scripts are stripped unless explicitly kept: a board must render exactly its slots
    const { template, slots, content } = ingest(html, url, { stripScripts: keepScripts !== true });
    const meta = await store.createSite({ name, sourceUrl: url, template, slots, content });
    res.json({ site: meta, slotCount: slots.length });
  }));

  // --- ingest a self-contained HTML FILE into a new site (owner only) --------
  // No fetch: the request body IS the HTML. This is the path for a standalone,
  // all-inline page (0 <script>, styles+images inline) that an external HTTP
  // ingest tool can't reach — it rejects loopback/private hosts, and fetchHtml's
  // SSRF guard blocks those ranges too. Raw parser at a high limit (the global
  // JSON parser caps at 1mb; menu boards run several MB), same pattern as assets.
  app.post('/api/sites/ingest-file',
    express.raw({ type: ['text/html', 'application/xhtml+xml', 'text/plain', 'application/octet-stream'], limit: '12mb' }),
    requireOwner,
    asyncH(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'POST the HTML file as the raw request body (Content-Type: text/html).' });
      }
      const html = req.body.toString('utf8');
      // baseUrl is OPTIONAL and only matters if the page has relative assets; a
      // self-contained file needs none. name overrides the auto title.
      const baseUrl = (req.query.baseUrl || '').toString().trim() || undefined;
      const name = (req.query.name || '').toString().trim() || undefined;
      const { template, slots, content } = ingest(html, baseUrl);
      const meta = await store.createSite({ name, sourceUrl: name ? `file:${name}` : 'file-upload', template, slots, content });
      res.json({ site: meta, slotCount: slots.length });
    }));

  // --- ingested site -> NEW studio-editable site (local server only: lays it out in Chrome) ---
  app.post('/api/sites/:id/convert', requireOwner, asyncH(async (req, res) => {
    if (!chromePath()) return res.status(501).json({ error: 'Converting needs a local server with Chrome.' });
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'No such site.' });
    const { site: meta, board, warnings } = await convertSite(req.params.id, store, { canvas: canvasOf(site, null) });
    res.json({ site: meta, elementCount: board.elements.length, warnings });
  }));

  // --- owner sets/clears a site's client password ---------------------------
  app.post('/api/sites/:id/client-password', requireOwner, asyncH(async (req, res) => {
    if (!(await store.siteExists(req.params.id))) return res.status(404).json({ error: 'No such site.' });
    const pw = req.body?.password;
    if (pw == null || String(pw) === '') {
      await store.clearClientAuth(req.params.id);
      return res.json({ ok: true, protected: false });
    }
    if (String(pw).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    await store.setClientAuth(req.params.id, hashPassword(String(pw)));
    res.json({ ok: true, protected: true });
  }));

  // --- client login ---------------------------------------------------------
  app.get('/sites/:id/login', asyncH(async (req, res) => {
    const meta = (await store.getSite(req.params.id))?.meta;
    if (!meta) return res.status(404).send('No such site.');
    res.type('html').send(loginPage(meta, req.query.next));
  }));
  app.post('/sites/:id/login', asyncH(async (req, res) => {
    const id = req.params.id;
    const meta = (await store.getSite(id))?.meta;
    if (!meta) return res.status(404).send('No such site.');
    const auth = await store.getClientAuth(id);
    const ok = auth && verifyPassword(req.body?.password || '', auth.salt, auth.hash);
    if (!ok) return res.status(401).type('html').send(loginPage(meta, req.body?.next, 'Incorrect password.'));
    setSession(res, SITE_COOKIE(id), makeSession({ sid: id, role: 'client' }));
    res.redirect(safeNext(req.body?.next, `/sites/${id}/edit`));
  }));
  app.post('/sites/:id/logout', (req, res) => {
    clearSession(res, SITE_COOKIE(req.params.id));
    res.redirect(`/sites/${req.params.id}/login`);
  });

  // --- editor shell ---------------------------------------------------------
  app.get('/sites/:id/edit', requireSiteAccess, asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).send('No such site.');
    const canvas = canvasOf(site, await store.getBoard(req.params.id));
    const owner = isOwner(req);
    res.type('html').send(editorShell(site.meta, site.slots, {
      owner,
      ai: owner && aiConfigured(), // owner-only: clients contact the owner directly, never an AI box
      canvas,
      groups: fieldGroups(site.slots, site.content),
      status: await siteStatus(req.params.id, site.content),
    }));
  }));

  // --- draft vs TV state (drives the editor's "Put on TV" bar) ---------------
  app.get('/api/sites/:id/status', requireSiteAccess, asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'No such site.' });
    res.json(await siteStatus(req.params.id, site.content));
  }));

  // --- preview: publish-mode public; edit-mode gated ------------------------
  app.get('/sites/:id/preview', asyncH(async (req, res) => {
    const wantEdit = req.query.mode === 'edit';
    if (wantEdit && !(isOwner(req) || isClientForSite(req, req.params.id))) {
      return res.redirect(`/sites/${req.params.id}/login`);
    }
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).send('No such site.');
    const mode = wantEdit ? 'edit' : 'publish';
    let html = render({ template: site.template, slots: site.slots, content: site.content, mode });
    if (mode === 'edit') html = injectEditor(html, site.meta.id);
    res.type('html').send(html);
  }));

  // --- apply a Guardian-validated change set --------------------------------
  app.post('/api/sites/:id/edit', requireSiteAccess, asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'No such site.' });
    const changes = req.body?.changes || {};
    const verdict = guardian(site.slots, changes);
    if (!verdict.ok) return res.status(422).json(verdict);
    const next = { ...site.content, ...changes };
    const version = await store.saveContent(req.params.id, next, req.body?.message);
    res.json({ ok: true, version });
  }));

  // --- AI chat: plain-English request -> Guardian-validated changes ---------
  app.post('/api/sites/:id/chat', requireSiteAccess, asyncH(async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: 'AI chat is not configured.' });
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'No such site.' });
    const message = (req.body?.message || '').toString().slice(0, 4000);
    if (!message.trim()) return res.status(400).json({ error: 'A message is required.' });

    let proposal;
    try {
      proposal = await proposeChanges({ slots: site.slots, content: site.content, message });
    } catch (e) {
      return res.status(502).json({ error: `AI request failed: ${e.message}` });
    }

    const changes = proposal.changes;
    if (Object.keys(changes).length === 0) {
      return res.json({ ok: true, reply: proposal.reply, applied: {}, version: null });
    }
    // The AI's proposal is validated by the SAME Guardian as a human edit.
    const verdict = guardian(site.slots, changes);
    if (!verdict.ok) {
      return res.status(422).json({ ok: false, reply: proposal.reply, errors: verdict.errors });
    }
    const next = { ...site.content, ...changes };
    const version = await store.saveContent(req.params.id, next, `AI: ${message.slice(0, 60)}`);
    res.json({ ok: true, reply: proposal.reply, applied: changes, version });
  }));

  // --- publish: render static + immutable snapshot --------------------------
  app.post('/api/sites/:id/publish', requireSiteAccess, asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).json({ error: 'No such site.' });
    const html = render({ template: site.template, slots: site.slots, content: site.content, mode: 'publish' });
    const snapshot = await store.savePublish(req.params.id, html, contentHashSource(site.content));
    // Flat image is best-effort: a rasterizer that's missing/slow must never fail
    // a publish. We answer immediately, then capture in the background; the stable
    // /live.png lazily generates on first request if this hasn't landed yet.
    if (RASTER_ON_PUBLISH) {
      const board = await store.getBoard(req.params.id);
      rasterizeSnapshot(req, req.params.id, snapshot.id, board)
        .catch((e) => console.warn(`rasterize on publish failed (${req.params.id}/${snapshot.id}): ${e.message}`));
    }
    res.json({ ok: true, snapshot, url: `/sites/${req.params.id}/published/${snapshot.id}` });
  }));

  // Force (re)rasterization of the latest published snapshot now — the
  // "Rasterize now" button. 409 if nothing is published; 503 if no browser.
  app.post('/api/sites/:id/rasterize', requireSiteAccess, asyncH(async (req, res) => {
    const snap = await store.latestSnapshot(req.params.id);
    if (!snap) return res.status(409).json({ error: 'Publish first — there is no snapshot to rasterize.' });
    const board = await store.getBoard(req.params.id);
    try {
      const png = await rasterizeSnapshot(req, req.params.id, snap.id, board);
      const { width, height } = canvasSize(board);
      res.json({ ok: true, snapshot: snap.id, bytes: png.length, width, height, url: `/sites/${req.params.id}/live.png` });
    } catch (e) {
      if (e instanceof RasterizeUnavailable) return res.status(503).json({ error: e.message });
      throw e;
    }
  }));

  app.get('/sites/:id/published/:snap', asyncH(async (req, res) => {
    const html = await store.readSnapshot(req.params.id, req.params.snap);
    if (html == null) return res.status(404).send('No such snapshot.');
    res.type('html').send(html);
  }));

  // --- uploaded assets: hosted by Pixelboard (ADR-004 asset pipeline) -------
  // Raw image body (content-type image/*) — bypasses the global JSON parser.
  const ASSET_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
  app.post('/api/sites/:id/assets', express.raw({ type: ['image/*'], limit: UPLOAD_LIMIT }), requireSiteAccess, asyncH(async (req, res) => {
    if (!(await store.siteExists(req.params.id))) return res.status(404).json({ error: 'No such site.' });
    const ext = ASSET_EXT[(req.headers['content-type'] || '').split(';')[0].trim()];
    if (!ext) return res.status(415).json({ error: 'Unsupported image type.' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty upload.' });
    const file = await store.saveAsset(req.params.id, req.body, ext);
    res.json({ ok: true, url: `/sites/${req.params.id}/assets/${file}` });
  }));

  app.get('/sites/:id/assets/:file', asyncH(async (req, res) => {
    const buf = await store.readAsset(req.params.id, req.params.file);
    if (!buf) return res.status(404).send('No such asset.');
    res.type(path.extname(req.params.file).slice(1) || 'application/octet-stream').send(buf);
  }));

  // --- history + rollback ---------------------------------------------------
  app.get('/api/sites/:id/versions', requireSiteAccess, asyncH(async (req, res) => {
    res.json({ versions: await store.listVersions(req.params.id) });
  }));
  app.get('/api/sites/:id/snapshots', requireSiteAccess, asyncH(async (req, res) => {
    res.json({ snapshots: await store.listSnapshots(req.params.id) });
  }));
  app.post('/api/sites/:id/rollback', requireSiteAccess, asyncH(async (req, res) => {
    const v = await store.getVersion(req.params.id, req.body?.versionId);
    if (!v) return res.status(404).json({ error: 'No such version.' });
    const version = await store.saveContent(req.params.id, v.content, `Rollback to ${v.id}`);
    res.json({ ok: true, version });
  }));

  // === Studio: design surface (ADR-004) — owner-only authoring ===============
  app.get('/studio', requireOwner, asyncH(async (_req, res) => {
    res.type('html').send(studioListPage(await store.listBoards(), listTemplates(), aiConfigured()));
  }));

  // template library: list + per-template preview (for gallery thumbnails)
  app.get('/api/studio/templates', requireOwner, (_req, res) => res.json({ templates: listTemplates() }));
  app.get('/studio/templates/:tid/preview', requireOwner, asyncH(async (req, res) => {
    const board = instantiateTemplate(req.params.tid);
    if (!board) return res.status(404).send('No such template.');
    res.type('html').send(render({ ...compileBoard(board), mode: 'publish' }));
  }));

  // create a board-backed site (from a template, given dims, or a supplied/starter board)
  app.post('/api/studio/boards', requireOwner, asyncH(async (req, res) => {
    const body = req.body || {};
    let board;
    if (body.templateId) {
      board = instantiateTemplate(body.templateId); // deep clone — never the shared module object
      if (!board) return res.status(404).json({ error: 'No such template.' });
    } else if (body.board) board = body.board;
    else if (body.w && body.h) board = starterBoard(Number(body.w), Number(body.h));
    else board = starterBoard();
    const verdict = validateBoard(board);
    if (!verdict.ok) return res.status(422).json(verdict);
    const artifact = compileBoard(board);
    const meta = await store.createSite({ name: board.name, sourceUrl: 'studio', ...artifact });
    await store.saveBoard(meta.id, board);
    res.json({ ok: true, siteId: meta.id, url: `/studio/${meta.id}` });
  }));

  // start a new project FROM A DESCRIPTION (no ingest) — create + AI-generate + save in one shot
  app.post('/api/studio/boards/ai', requireOwner, asyncH(async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: 'AI is not configured. Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to .env.local.' });
    const body = req.body || {};
    const message = (body.message || '').toString().slice(0, 2000);
    const content = (body.text || '').toString().slice(0, 4000);
    const style = (body.style || '').toString().slice(0, 500);
    if (!content.trim() && !message.trim()) return res.status(400).json({ error: 'Enter the display text (or a description).' });
    const w = Number(body.w) || 1920, h = Number(body.h) || 1080;
    let result;
    try {
      result = await generateBoard({ canvas: { w, h }, message, content, style, forceDark: !!body.backdrop });
    } catch (e) {
      return res.status(502).json({ error: `AI request failed: ${e.message}` });
    }
    let designed = result.board;
    // optional: drop a tag-matched photo backdrop behind the fresh design
    if (body.backdrop) {
      const bd = pickBackdrop(tagsForBoard(designed, `${message} ${style} ${content}`));
      if (bd) {
        const withBd = applyBackdrop(designed, bd);
        if (validateBoard(withBd).ok) designed = withBd;
      }
    }
    const verdict = validateBoard(designed);
    if (!verdict.ok) return res.status(422).json({ ok: false, reply: result.reply, errors: verdict.errors });
    const artifact = compileBoard(designed);
    const meta = await store.createSite({ name: designed.name || 'AI board', sourceUrl: 'studio-ai', ...artifact });
    await store.saveBoard(meta.id, designed);
    res.json({ ok: true, siteId: meta.id, url: `/studio/${meta.id}`, reply: result.reply });
  }));

  app.get('/studio/:id', requireOwner, asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    const board = await store.getBoard(req.params.id);
    if (!site || !board) return res.status(404).send('No such board.');
    res.type('html').send(boardStudioPage(site.meta, board));
  }));

  // recompile a board, PRESERVING client edits for slots that still exist
  app.put('/api/studio/boards/:id', requireOwner, asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site || !(await store.getBoard(req.params.id))) return res.status(404).json({ error: 'No such board.' });
    const board = req.body?.board;
    const verdict = validateBoard(board);
    if (!verdict.ok) return res.status(422).json(verdict);
    const artifact = compileBoard(board);
    const content = {};
    for (const slot of artifact.slots) content[slot.id] = site.content[slot.id] ?? artifact.content[slot.id];
    await store.saveArtifact(req.params.id, { template: artifact.template, slots: artifact.slots, content }, 'Recompiled from studio');
    await store.saveBoard(req.params.id, board);
    res.json({ ok: true, slotCount: artifact.slots.length });
  }));

  // AI board generation: plain English -> validated board doc (NOT saved; the
  // studio loads it for review, then the user hits Save). Same whitelist gate.
  app.post('/api/studio/boards/:id/generate', requireOwner, asyncH(async (req, res) => {
    if (!aiConfigured()) return res.status(503).json({ error: 'AI is not configured. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.' });
    const board = await store.getBoard(req.params.id);
    if (!board) return res.status(404).json({ error: 'No such board.' });
    const message = (req.body?.message || '').toString().slice(0, 2000);
    if (!message.trim()) return res.status(400).json({ error: 'Describe the board to generate.' });
    let result;
    try {
      result = await generateBoard({ canvas: board.canvas, message, currentBoard: board });
    } catch (e) {
      return res.status(502).json({ error: `AI request failed: ${e.message}` });
    }
    const verdict = validateBoard(result.board);
    if (!verdict.ok) return res.status(422).json({ ok: false, reply: result.reply, errors: verdict.errors });
    res.json({ ok: true, reply: result.reply, board: result.board });
  }));

  // backdrop library: list + apply a tag-matched backdrop to a board (codex-generated, batch)
  app.get('/api/studio/backdrops', requireOwner, (_req, res) => res.json({ backdrops: listBackdrops() }));
  app.post('/api/studio/boards/:id/backdrop', requireOwner, asyncH(async (req, res) => {
    const board = await store.getBoard(req.params.id);
    if (!board) return res.status(404).json({ error: 'No such board.' });
    // Three modes: remove, apply a specific (whitelisted) library file, or auto-match.
    let next, applied = null, label;
    if (req.body?.remove) {
      next = removeBackdrop(board); label = 'Removed backdrop';
    } else if (req.body?.file) {
      const bd = backdropByFile(String(req.body.file)); // whitelist — never apply an arbitrary URL
      if (!bd) return res.status(400).json({ error: 'Unknown backdrop.' });
      next = applyBackdrop(board, bd); applied = bd.file; label = 'Added backdrop';
    } else {
      const bd = pickBackdrop(tagsForBoard(board, (req.body?.brief || '').toString()));
      if (!bd) return res.status(503).json({ error: 'No backdrop library yet — generate backdrops first.' });
      next = applyBackdrop(board, bd); applied = bd.file; label = 'Added backdrop';
    }
    const verdict = validateBoard(next);
    if (!verdict.ok) return res.status(422).json(verdict);
    const artifact = compileBoard(next);
    const cur = (await store.getSite(req.params.id)).content;
    const content = {};
    for (const s of artifact.slots) content[s.id] = cur[s.id] ?? artifact.content[s.id];
    await store.saveArtifact(req.params.id, { template: artifact.template, slots: artifact.slots, content }, label);
    await store.saveBoard(req.params.id, next);
    res.json({ ok: true, backdrop: applied });
  }));

  // bespoke backdrop: generate a NEW image via codex (async — minutes). Kick off a
  // job, return its id, and let the studio poll. Never blocks the request.
  const backdropJobs = new Map(); // jobId -> { status:'running'|'done'|'error', backdrop?, error? }
  app.post('/api/studio/boards/:id/backdrop/bespoke', requireOwner, asyncH(async (req, res) => {
    if (ON_VERCEL) return res.status(503).json({ error: 'Bespoke backdrops need a local server with the codex CLI; not available on this deploy. Use the backdrop library.' });
    const board = await store.getBoard(req.params.id);
    if (!board) return res.status(404).json({ error: 'No such board.' });
    const theme = (req.body?.theme || '').toString().slice(0, 300);
    const jobId = randomUUID().slice(0, 8);
    backdropJobs.set(jobId, { status: 'running' });
    res.json({ ok: true, jobId });
    (async () => {
      try {
        const url = await generateBespokeBackdrop({ siteId: req.params.id, canvas: board.canvas, theme });
        const next = applyBackdrop(board, { file: url });
        if (!validateBoard(next).ok) throw new Error('generated board failed validation');
        const artifact = compileBoard(next);
        const cur = (await store.getSite(req.params.id)).content;
        const content = {};
        for (const s of artifact.slots) content[s.id] = cur[s.id] ?? artifact.content[s.id];
        await store.saveArtifact(req.params.id, { template: artifact.template, slots: artifact.slots, content }, 'Bespoke backdrop');
        await store.saveBoard(req.params.id, next);
        backdropJobs.set(jobId, { status: 'done', backdrop: url });
      } catch (e) {
        backdropJobs.set(jobId, { status: 'error', error: e.message });
      }
    })();
  }));
  app.get('/api/studio/backdrop-jobs/:jobId', requireOwner, (req, res) => {
    const j = backdropJobs.get(req.params.jobId);
    if (!j) return res.status(404).json({ error: 'No such job.' });
    res.json(j);
  });

  // --- downloads: current HEAD as one offline HTML file, or a PNG of it ------
  async function offlineBoard(req) {
    const site = await store.getSite(req.params.id);
    if (!site) return null;
    const c = canvasOf(site, await store.getBoard(req.params.id)) || { w: 1920, h: 1080 };
    const html = await bundleHtml(render({ template: site.template, slots: site.slots, content: site.content, mode: 'publish' }));
    const clamp = (v, d) => Math.min(7680, Math.max(100, Number(v) || d));
    return {
      site, html,
      w: clamp(req.query.w, c.w),
      h: clamp(req.query.h, c.h),
      file: (site.meta.name || 'board').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'board',
    };
  }
  app.get('/sites/:id/download/html', requireSiteAccess, asyncH(async (req, res) => {
    const b = await offlineBoard(req);
    if (!b) return res.status(404).send('No such site.');
    res.attachment(`${b.file}.html`).type('html').send(b.html);
  }));
  app.get('/sites/:id/download/png', requireSiteAccess, asyncH(async (req, res) => {
    if (!chromePath()) return res.status(501).send('PNG export needs a local server with Chrome. Use Download HTML here.');
    const b = await offlineBoard(req);
    if (!b) return res.status(404).send('No such site.');
    res.attachment(`${b.file}.png`).type('png').send(await renderPng(b.html, b.w, b.h));
  }));

  // fullscreen / kiosk display of the live (editable) HEAD — serving-layer wrapper
  app.get('/sites/:id/display', asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).send('No such site.');
    const c = canvasOf(site, await store.getBoard(req.params.id)) || { w: 1920, h: 1080 };
    res.type('html').send(displayWrapper(site.meta, c.w, c.h));
  }));

  // --- /live: stable signage URL — always the LATEST published snapshot ------
  // A screen points here permanently; publishing flips what it serves (public).
  app.get('/sites/:id/live', asyncH(async (req, res) => {
    const snaps = await store.listSnapshots(req.params.id);
    if (!snaps.length) {
      return res.status(404).type('html').send('<!doctype html><body style="margin:0;background:#0a0a0a;color:#888;font:16px system-ui;display:grid;place-items:center;height:100vh">Not published yet.</body>');
    }
    const html = await store.readSnapshot(req.params.id, snaps[0].id); // listSnapshots is newest-first
    if (html == null) return res.status(404).send('No such snapshot.');
    res.type('html').send(html);
  }));
  // --- /live.png: stable FLAT-IMAGE signage URL (ADR-006) -------------------
  // The image analog of /live: a dumb screen polls this one URL and always gets
  // a PNG of the LATEST published snapshot (flips on publish). Generated lazily
  // if publish-time capture hasn't landed (or predates this feature); public.
  app.get('/sites/:id/live.png', asyncH(async (req, res) => {
    const snap = await store.latestSnapshot(req.params.id);
    if (!snap) return res.status(404).send('Not published yet.');
    let png = await store.readPublishImage(req.params.id, snap.id);
    if (!png) {
      try {
        png = await rasterizeSnapshot(req, req.params.id, snap.id, await store.getBoard(req.params.id));
      } catch (e) {
        const code = e instanceof RasterizeUnavailable ? 503 : 500;
        return res.status(code).send(`Flat image unavailable: ${e.message}`);
      }
    }
    res.type('png');
    res.set('Cache-Control', 'no-cache'); // the URL is stable; its bytes flip on publish
    res.send(png);
  }));

  // fullscreen kiosk pointing at the live snapshot
  app.get('/sites/:id/live/screen', asyncH(async (req, res) => {
    const site = await store.getSite(req.params.id);
    if (!site) return res.status(404).send('No such site.');
    const c = canvasOf(site, await store.getBoard(req.params.id)) || { w: 1920, h: 1080 };
    res.type('html').send(displayWrapper(site.meta, c.w, c.h, `/sites/${req.params.id}/live`));
  }));

  // body-parser errors (oversized upload/JSON) -> JSON the studio can show
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: `File too large (max ${UPLOAD_LIMIT === '4mb' ? '4 MB' : '20 MB'}).` });
    }
    next(err);
  });

  return app;
}

/** A fresh starter board at the chosen dimensions, with elements placed proportionally. */
function starterBoard(w = 1920, h = 1080) {
  const base = Math.min(w, h);
  const pad = Math.round(w * 0.07);
  return {
    name: 'Untitled board',
    canvas: { w, h },
    elements: [
      { id: 'bg', type: 'rect', x: 0, y: 0, w, h, style: { background: '#0a0a0a' } },
      { id: 'title', type: 'text', x: pad, y: Math.round(h * 0.06), w: w - pad * 2, h: Math.round(base * 0.12),
        value: 'Today’s Special', style: { color: '#ffffff', fontFamily: 'inter', fontSize: Math.round(base * 0.09), fontWeight: 800 },
        slot: { editable: true, label: 'Title' } },
      { id: 'price', type: 'text', x: pad, y: Math.round(h * 0.2), w: w - pad * 2, h: Math.round(base * 0.16),
        value: '$12.99', style: { color: '#ff2ec4', fontFamily: 'inter', fontSize: Math.round(base * 0.13), fontWeight: 900 },
        slot: { editable: true, label: 'Price' } },
    ],
  };
}

/** Only allow same-origin relative redirects. */
function safeNext(next, fallback) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) return next;
  return fallback;
}

/** Append the editor runtime to an edit-mode preview body. */
function injectEditor(html, siteId) {
  // INLINE the editor chrome. The frozen template may carry a <base href> (so its
  // own relative assets resolve against the origin) — a linked /editor/inject.js
  // would be hijacked by that base to the wrong host and 404. Inlined assets have
  // no URL to resolve, so they are immune. Read per-request to stay live under --watch.
  const css = readFileSync(path.join(__dirname, 'editor/inject.css'), 'utf8');
  const js = readFileSync(path.join(__dirname, 'editor/inject.js'), 'utf8');
  const tag =
    `\n<style>${css}</style>` +
    `\n<script>window.__VELLUM_SITE__=${JSON.stringify(escapeText(siteId))};</script>` +
    `\n<script>${js}</script>\n`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
  return html + tag;
}

// Start only when run directly (tests import createApp instead).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT) || 3006;
  const HOST = process.env.HOST || '127.0.0.1'; // set HOST to expose the server beyond loopback
  createApp().listen(PORT, HOST, () => {
    console.log(`Pixelboard on http://${HOST}:${PORT}  (master key ${MASTER_KEY ? 'set' : 'OPEN — dev'})`);
  });
}
