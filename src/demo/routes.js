// Demo build only: answers the studio's /api/* calls in the browser.
// src/studio/studio.js runs UNCHANGED against this shim — each handler below
// mirrors its Express route in src/server.js, calling the same pure engine
// functions (validateBoard -> compileBoard -> content-preserving recompile).
// Nothing reaches the network. Any /api call without a handler is answered 404
// and recorded on window.__demoUnhandled so the smoke test can prove coverage.

import * as store from './store.js';
import {
  compile, validateBoard, applyBackdrop, removeBackdrop, tagsForBoard,
  demoBackdrops, demoBackdropByFile, demoPickBackdrop,
} from './engine.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Recompile a board-backed site, PRESERVING content for slot ids that still exist (server.js PUT /api/studio/boards/:id). */
export function recompile(id, board, message) {
  const verdict = validateBoard(board);
  if (!verdict.ok) return { status: 422, body: verdict };
  const artifact = compile(board);
  const cur = store.getSite(id).content;
  const content = {};
  for (const slot of artifact.slots) content[slot.id] = cur[slot.id] ?? artifact.content[slot.id];
  store.saveArtifact(id, { template: artifact.template, slots: artifact.slots, content }, message);
  store.saveBoard(id, board);
  return { status: 200, body: { ok: true, slotCount: artifact.slots.length } };
}

/** Center-crop an uploaded image to a square and downscale it into a data: URL
 *  (the Pixelboard asset host, in-browser). Square because every demo image slot is. */
export async function imageFileToDataUrl(blob, max = 800) {
  if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(blob.type || '')) throw new Error('Unsupported image type — use PNG, JPEG, WebP, GIF, or AVIF.');
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(max, side);
  const c = document.createElement('canvas');
  c.width = c.height = out;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  return c.toDataURL('image/jpeg', 0.85);
}

/** DEMO COMPENSATION for a studio.js bug: serialize() rebuilds each element's
 *  style from the few props the canvas manages, silently dropping opacity,
 *  letterSpacing, lineHeight, image borderRadius and forcing objectFit:'fill'.
 *  Carry those back from the previous board (same element id + type) so a plain
 *  Save doesn't degrade the design. The product server has no such merge. */
export function mergeUnmanagedStyle(prev, next) {
  if (!prev || !next || !Array.isArray(next.elements)) return next;
  const old = new Map(prev.elements.map((e) => [e.id, e]));
  return {
    ...next,
    elements: next.elements.map((e) => {
      const o = old.get(e.id);
      if (!o || o.type !== e.type || !o.style) return e;
      const style = { ...(e.style || {}) };
      for (const [k, v] of Object.entries(o.style)) if (!(k in style)) style[k] = v;
      if (e.type === 'image' && o.style.objectFit) style.objectFit = o.style.objectFit;
      return { ...e, style };
    }),
  };
}

const ROUTES = [
  ['PUT', /^\/api\/studio\/boards\/([^/]+)$/, async (id, body) => {
    const prev = store.getBoard(id);
    if (!store.getSite(id) || !prev) return json(404, { error: 'No such board.' });
    const r = recompile(id, mergeUnmanagedStyle(prev, body?.board), 'Recompiled from studio');
    return json(r.status, r.body);
  }],
  ['GET', /^\/api\/studio\/backdrops$/, async () => json(200, { backdrops: demoBackdrops() })],
  ['POST', /^\/api\/studio\/boards\/([^/]+)\/backdrop$/, async (id, body) => {
    const board = store.getBoard(id);
    if (!board) return json(404, { error: 'No such board.' });
    let next, applied = null, label;
    if (body?.remove) {
      next = removeBackdrop(board); label = 'Removed backdrop';
    } else if (body?.file) {
      const bd = demoBackdropByFile(String(body.file)); // whitelist — never apply an arbitrary URL
      if (!bd) return json(400, { error: 'Unknown backdrop.' });
      next = applyBackdrop(board, bd); applied = bd.file; label = 'Added backdrop';
    } else {
      const bd = demoPickBackdrop(tagsForBoard(board, (body?.brief || '').toString()));
      if (!bd) return json(503, { error: 'No backdrop library.' });
      next = applyBackdrop(board, bd); applied = bd.file; label = 'Added backdrop';
    }
    const r = recompile(id, next, label);
    return r.status === 200 ? json(200, { ok: true, backdrop: applied }) : json(r.status, r.body);
  }],
  ['POST', /^\/api\/studio\/boards\/([^/]+)\/generate$/, async () =>
    json(503, { error: 'AI generation is off in this static demo — no model is called. Use the canned suggestions.' })],
  ['POST', /^\/api\/sites\/([^/]+)\/assets$/, async (id, _body, init) => {
    if (!store.getSite(id)) return json(404, { error: 'No such site.' });
    try {
      return json(200, { ok: true, url: await imageFileToDataUrl(init.body) });
    } catch (e) {
      return json(415, { error: e.message });
    }
  }],
];

export function installFetchShim() {
  if (window.__demoFetchShim) return;
  window.__demoFetchShim = true;
  window.__demoUnhandled = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    for (const [m, re, handler] of ROUTES) {
      const hit = m === method && re.exec(url.pathname);
      if (!hit) continue;
      let body = null;
      if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = null; } }
      try {
        return await handler(decodeURIComponent(hit[1] || ''), body, init);
      } catch (e) {
        return json(e.code === 'quota' ? 507 : 500, { error: e.message || 'Demo error.' });
      }
    }
    window.__demoUnhandled.push(`${method} ${url.pathname}`);
    return json(404, { error: `Not available in the static demo: ${method} ${url.pathname}` });
  };
}
