// Ingested site -> studio board. An ingested site is a frozen HTML template whose
// layout lives in CSS; the studio needs absolute elements. So: render the site
// (edit mode, which tags every slot), lay it out in headless Chrome, measure every
// text run / image / coloured box, and emit a board doc through the same whitelist
// as everything else. One-way and non-destructive: the result is a NEW site (the
// original keeps its history); slot ids are re-derived from element ids (ADR-004
// Decision 1), so client content is carried over by value, not by id.
//
// Fidelity limits (by design — the schema is a whitelist): borders become rects
// (outer colour + inset fill, or four strips), gradients/shadows/filters are
// dropped, mixed inline styling collapses to the run's computed style, fonts map
// to the nearest curated family. Local server only (needs Chrome).

import { render } from '../render.js';
import { fetchAsset } from '../fetch_url.js';
import { dumpDom } from '../png.js';
import { validateBoard, FONT_STACKS } from './schema.js';
import { compileBoard } from './compile.js';

/** First fixed-size element of an ingested signage page (e.g. a 1920×1080 artboard), else null. */
export function detectCanvas(template) {
  const re = /style="[^"]*?\b(width|height):\s*(\d{3,4})px;[^"]*?\b(width|height):\s*(\d{3,4})px/g;
  for (const m of template.matchAll(re)) {
    if (m[1] === m[3]) continue;
    const dim = { [m[1]]: Number(m[2]), [m[3]]: Number(m[4]) };
    if (dim.width >= 640 && dim.height >= 360 && dim.width <= 7680 && dim.height <= 7680) return { w: dim.width, h: dim.height };
  }
  return null;
}

// Runs inside Chrome. Walks the artboard in paint order and reports raw boxes +
// computed styles; everything schema-shaped happens back in node (toBoard).
const MEASURE = `
(() => {
  const W = __W__, H = __H__;
  const all = Array.from(document.querySelectorAll('body *'));
  const root = all.find((e) => Math.abs(e.offsetWidth - W) < 2 && Math.abs(e.offsetHeight - H) < 2) || document.body;
  const rr = root.getBoundingClientRect();
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'SVG']);
  const out = [];
  const px = (v) => parseFloat(v) || 0;
  // Normalise any CSS colour (incl. color(srgb …)) to #rrggbb / rgba() via a 2D canvas.
  const ctx = document.createElement('canvas').getContext('2d');
  const srgb = (c) => { const m = /color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+%?))?\\)/.exec(c || ''); if (!m) return c; const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return 'rgba(' + [m[1], m[2], m[3]].map((v) => Math.round(parseFloat(v) * 255)).join(', ') + ', ' + a + ')'; };
  const norm = (c) => { ctx.fillStyle = '#000'; ctx.fillStyle = srgb(c); return ctx.fillStyle; };
  const alpha = (c) => { c = norm(c); const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const isInline = (e) => /^inline/.test(getComputedStyle(e).display);
  const hasBlockDesc = (e) => Array.from(e.querySelectorAll('*')).some((d) => !SKIP.has(d.tagName) && !isInline(d));
  const angleOf = (cs) => { const m = /matrix\\(([^)]+)\\)/.exec(cs.transform); if (!m) return 0; const [a, b] = m[1].split(',').map(parseFloat); return Math.round(Math.atan2(b, a) * 180 / Math.PI * 100) / 100; };
  function box(e, rot) {
    const b = e.getBoundingClientRect();
    if (!rot) return { x: b.left - rr.left, y: b.top - rr.top, w: b.width, h: b.height };
    // compile() rotates about the top-left; recover the unrotated top-left from the AABB centre
    const w = e.offsetWidth, h = e.offsetHeight, t = rot * Math.PI / 180;
    const cx = b.left + b.width / 2 - rr.left, cy = b.top + b.height / 2 - rr.top;
    return { x: cx - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t), y: cy - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t), w, h };
  }
  function textBox(e) {
    // Prefer the enclosing block's content box when this run is the block's only
    // text: keeps wrap width + text-align meaningful once the value changes.
    let blk = e;
    while (blk !== root && isInline(blk)) blk = blk.parentElement;
    const mine = (e.textContent || '').replace(/\\s+/g, ' ').trim();
    const theirs = (blk.textContent || '').replace(/\\s+/g, ' ').trim();
    const r = document.createRange(); r.selectNodeContents(e);
    const tb = r.getBoundingClientRect();
    if (blk !== e && mine !== theirs) return { x: tb.left - rr.left, y: tb.top - rr.top, w: tb.width, h: tb.height, align: 'left' };
    const cs = getComputedStyle(blk), b = blk.getBoundingClientRect();
    const pl = px(cs.paddingLeft), pr = px(cs.paddingRight);
    return { x: b.left - rr.left + pl, y: tb.top - rr.top, w: b.width - pl - pr, h: tb.height, align: cs.textAlign };
  }
  function walk(e, opacity) {
    if (SKIP.has(e.tagName)) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    opacity *= px(cs.opacity);
    if (opacity <= 0.01) return;
    const ab = e.getBoundingClientRect();
    const visible = ab.width > 0 && ab.height > 0 && ab.right > rr.left && ab.left < rr.right && ab.bottom > rr.top && ab.top < rr.bottom;
    if (visible) {
      const rot = angleOf(cs);
      const b = box(e, rot);
      const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
      const bc = norm(cs.borderTopColor), hasBorder = bw.some((v) => v > 0) && alpha(bc) > 0 && cs.borderTopStyle !== 'none';
      const radius = px(cs.borderTopLeftRadius);
      const bg = norm(cs.backgroundColor), hasBg = alpha(bg) > 0;
      if (hasBorder && hasBg) {
        out.push({ type: 'rect', ...b, rot, background: bc, radius, opacity });
        out.push({ type: 'rect', x: b.x + bw[3], y: b.y + bw[0], w: b.w - bw[1] - bw[3], h: b.h - bw[0] - bw[2], rot, background: bg, radius: Math.max(0, radius - bw[0]), opacity });
      } else if (hasBorder) {
        if (bw[0]) out.push({ type: 'rect', x: b.x, y: b.y, w: b.w, h: bw[0], rot, background: bc, opacity });
        if (bw[2]) out.push({ type: 'rect', x: b.x, y: b.y + b.h - bw[2], w: b.w, h: bw[2], rot, background: bc, opacity });
        if (bw[3]) out.push({ type: 'rect', x: b.x, y: b.y, w: bw[3], h: b.h, rot, background: bc, opacity });
        if (bw[1]) out.push({ type: 'rect', x: b.x + b.w - bw[1], y: b.y, w: bw[1], h: b.h, rot, background: bc, opacity });
      } else if (hasBg) {
        out.push({ type: 'rect', ...b, rot, background: bg, radius, opacity });
      }
      const bgi = /url\\("?([^")]+)"?\\)/.exec(cs.backgroundImage);
      // gradients have no schema shape: flatten to the first opaque stop (a rule/divider keeps its colour)
      const grad = !bgi && /gradient\\(/.test(cs.backgroundImage) && (cs.backgroundImage.match(/rgba?\\([^)]+\\)|#[0-9a-f]{3,8}/gi) || []).find((c) => alpha(c) > 0.5);
      if (grad) out.push({ type: 'rect', ...b, rot, background: norm(grad), radius, opacity });
      if (bgi) out.push({ type: 'image', ...b, rot, src: bgi[1], fit: cs.backgroundSize === 'cover' ? 'cover' : cs.backgroundSize === 'contain' ? 'contain' : 'fill', radius, opacity });
      if (e.tagName === 'IMG' && (e.currentSrc || e.src)) {
        out.push({ type: 'image', ...b, rot, src: e.currentSrc || e.src, fit: cs.objectFit === 'contain' || cs.objectFit === 'cover' ? cs.objectFit : 'fill', radius, opacity });
      }
      const text = (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const direct = Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (text && (direct || e.classList.contains('v-slot')) && !hasBlockDesc(e)) {
        const tb = textBox(e);
        const slots = Array.from(e.querySelectorAll('.v-slot')).map((s) => s.dataset.vSlot);
        if (e.classList.contains('v-slot')) slots.unshift(e.dataset.vSlot);
        const fs = px(cs.fontSize);
        out.push({
          type: 'text', ...tb, rot, text, slots, opacity,
          color: norm(cs.color), family: cs.fontFamily, size: fs, weight: cs.fontWeight, style: cs.fontStyle,
          lineHeight: cs.lineHeight === 'normal' ? 1.2 : px(cs.lineHeight) / fs, letterSpacing: px(cs.letterSpacing),
          transform: cs.textTransform, multiline: tb.h > fs * 1.6,
        });
        return;
      }
    }
    for (const c of Array.from(e.children)) walk(c, opacity);
  }
  walk(root, 1);
  const json = JSON.stringify({ root: root === document.body ? 'body' : 'artboard', elements: out });
  document.body.innerHTML = '<pre id="pb-measure">' + btoa(unescape(encodeURIComponent(json))) + '</pre>';
})();
`;

// --- pure mapping helpers ----------------------------------------------------

const FAMILY_HINTS = [
  ['inter', 'inter'], ['bebas', 'bebas'], ['anton', 'anton'], ['oswald', 'oswald'],
  ['archivo', 'archivo-black'], ['space grotesk', 'space-grotesk'], ['playfair', 'playfair'],
  ['fraunces', 'fraunces'], ['gochi', 'gochi-hand'], ['rock salt', 'rock-salt'],
  ['give you glory', 'give-you-glory'], ['gloria', 'gloria-hallelujah'], ['caveat', 'caveat'],
  ['nanum', 'nanum-pen'], ['crafty', 'crafty-girls'],
  ['mono', 'mono'], ['menlo', 'mono'], ['consolas', 'mono'], ['courier', 'mono'],
  ['georgia', 'serif'], ['times', 'serif'], ['garamond', 'serif'], ['baskerville', 'serif'], ['serif', 'serif'],
];

/** Nearest curated font key for a computed font-family list. */
export function mapFamily(family) {
  const f = String(family || '').toLowerCase();
  const first = f.split(',')[0].replace(/["']/g, '').trim();
  if (FONT_STACKS[first]) return first;
  for (const [hint, key] of FAMILY_HINTS) {
    if (first.includes(hint)) return key;
    if (key === 'serif' && hint === 'serif' && /\bserif\b/.test(f) && !/sans-serif/.test(f)) return 'serif';
  }
  return 'system';
}

/** rgb()/rgba() -> #rrggbb[aa] (schema accepts both; hex keeps board docs tidy). */
export function toHex(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c || '');
  if (!m) return /^#/.test(c || '') ? c : '#000000';
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b) + (a < 1 ? h(a * 255) : '');
}

const r1 = (n) => Math.round(n * 10) / 10;
const WEIGHTS = new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]);

/**
 * Measured boxes -> validated board doc. Pure.
 * @param {{elements: object[]}} measured
 * @param {{name: string, canvas: {w:number,h:number}, slots: object[]}} opts
 */
export function toBoard(measured, { name, canvas, slots }) {
  const labelOf = new Map(slots.map((s) => [s.id, s.label || 'Text']));
  const elements = [];
  let n = 0;
  for (const m of measured.elements) {
    // clamp to the canvas; drop anything that ends up sub-pixel
    const x = r1(m.x), y = r1(m.y), w = r1(m.w), h = r1(m.h);
    if (w < 1 || h < 1) continue;
    const el = { id: `${m.type}-${++n}`, type: m.type, x, y, w, h, style: {} };
    if (Math.abs(m.rot || 0) > 0.05) el.rotation = m.rot;
    if (m.opacity < 0.995) el.style.opacity = Math.round(m.opacity * 100) / 100;
    if (m.radius > 0) el.style.borderRadius = r1(m.radius);
    if (m.type === 'rect') {
      el.style.background = toHex(m.background);
    } else if (m.type === 'image') {
      el.value = m.src;
      el.style.objectFit = m.fit;
    } else {
      let text = m.text;
      if (m.transform === 'uppercase') text = text.toUpperCase();
      else if (m.transform === 'lowercase') text = text.toLowerCase();
      el.value = text;
      // single-line runs get a little slack so a fallback-font metric can't force a wrap
      if (!m.multiline) el.w = r1(el.w + 8);
      const weight = Number(m.weight) || (m.weight === 'bold' ? 700 : 400);
      Object.assign(el.style, {
        color: toHex(m.color), fontFamily: mapFamily(m.family), fontSize: r1(m.size),
        fontWeight: WEIGHTS.has(weight) ? weight : 400,
        lineHeight: Math.round(Math.min(10, Math.max(0, m.lineHeight)) * 100) / 100,
        textAlign: ['center', 'right', 'justify'].includes(m.align) ? m.align : 'left',
      });
      if (m.style === 'italic') el.style.fontStyle = 'italic';
      if (m.letterSpacing) el.style.letterSpacing = r1(m.letterSpacing);
      if (m.slots?.length) {
        el.id = `slot-${m.slots[0].slice(0, 12)}-${n}`;
        el.slot = { editable: true, label: labelOf.get(m.slots[0]) || 'Text' };
      }
    }
    elements.push(el);
  }
  return { name, canvas, elements };
}

// --- orchestration -------------------------------------------------------------

/** Inline <link rel=stylesheet> so Chrome (networking blocked) lays the page out as served. */
async function inlineStylesheets(html, baseUrl, warnings) {
  const links = [...html.matchAll(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi)];
  for (const [tag] of links) {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl).href;
      const { buffer } = await fetchAsset(url, 5 * 1024 * 1024);
      html = html.replace(tag, `<style>${buffer.toString('utf8').replace(/<\/style/gi, '<\\/style')}</style>`);
    } catch (e) {
      warnings.push(`stylesheet ${href}: ${e.message}`);
    }
  }
  return html;
}

const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** Copy remote images into the new site's assets so the board doesn't depend on the source host. */
async function localizeImages(board, siteId, store, warnings) {
  const seen = new Map();
  for (const el of board.elements) {
    if (el.type !== 'image' || !/^https?:/i.test(el.value)) continue;
    if (!seen.has(el.value)) {
      seen.set(el.value, (async () => {
        try {
          const { buffer, type } = await fetchAsset(el.value);
          const ext = IMG_EXT[type];
          if (!ext) throw new Error(`unsupported type ${type || 'unknown'}`);
          return `/sites/${siteId}/assets/${await store.saveAsset(siteId, buffer, ext)}`;
        } catch (e) {
          warnings.push(`image ${el.value}: ${e.message} (kept remote URL)`);
          return el.value;
        }
      })());
    }
    el.value = await seen.get(el.value);
  }
}

/**
 * Convert an ingested site into a new, studio-editable site.
 * @returns {Promise<{ site: object, board: object, warnings: string[] }>}
 */
export async function convertSite(id, store, { canvas } = {}) {
  const site = await store.getSite(id);
  if (!site) throw Object.assign(new Error('No such site.'), { status: 404 });
  const c = canvas || detectCanvas(site.template) || { w: 1920, h: 1080 };
  const warnings = [];

  let html = render({ template: site.template, slots: site.slots, content: site.content, mode: 'edit' });
  html = await inlineStylesheets(html, site.meta.sourceUrl, warnings);
  const script = `<script>window.addEventListener('load',()=>{${MEASURE.replace('__W__', c.w).replace('__H__', c.h)}});</script>`;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}</body>`) : html + script;

  const dom = await dumpDom(html, c.w, c.h);
  const b64 = /<pre id="pb-measure">([^<]*)<\/pre>/.exec(dom)?.[1];
  if (!b64) throw new Error('Chrome produced no measurement (page script did not run).');
  const measured = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  if (measured.root === 'body') warnings.push(`no ${c.w}×${c.h} artboard found; measured from <body>`);

  const board = toBoard(measured, { name: `${site.meta.name} (studio)`, canvas: c, slots: site.slots });
  const verdict = validateBoard(board);
  if (!verdict.ok) throw new Error('Converted board failed validation: ' + verdict.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; '));

  const meta = await store.createSite({ name: board.name, sourceUrl: `converted:${id}`, ...compileBoard(board) });
  await localizeImages(board, meta.id, store, warnings);
  await store.saveArtifact(meta.id, compileBoard(board), `Converted from ingested site ${id}`);
  await store.saveBoard(meta.id, board);
  return { site: meta, board, warnings };
}
