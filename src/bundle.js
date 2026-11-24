// Offline bundle: turn a rendered (publish-mode) page into ONE self-contained HTML
// file — stylesheets inlined, and every font/image (in CSS, <img>, style attrs)
// embedded as a data: URI. Used for the "Download HTML" file and as the input
// to the PNG render, so neither depends on the source site staying up.
//
// Root-relative URLs with no <base> are Pixelboard's own (/sites/:id/assets/…,
// /backdrops, /fonts, /branding) and are read locally; everything else goes
// through the SSRF-guarded fetchAsset.

import * as cheerio from 'cheerio';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAsset } from './fetch_url.js';
import * as store from './storage.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const LOCAL = 'http://pixelboard.local';
const MAX_TOTAL = 60 * 1024 * 1024;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf',
  otf: 'font/otf', css: 'text/css',
};
const mimeOf = (p, fallback) => MIME[path.extname(p).slice(1).toLowerCase()] || fallback || 'application/octet-stream';

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?[^;]*;/g;

export async function bundleHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const baseHref = $('base[href]').attr('href');
  const base = baseHref ? new URL(baseHref, LOCAL).href : LOCAL + '/';
  const cache = new Map();
  let total = 0;

  async function load(abs) {
    if (!cache.has(abs)) {
      cache.set(abs, (async () => {
        const u = new URL(abs);
        let out;
        if (u.origin === LOCAL) {
          const m = u.pathname.match(/^\/sites\/([^/]+)\/assets\/([^/]+)$/);
          if (m) {
            const buf = await store.readAsset(m[1], decodeURIComponent(m[2]));
            if (!buf) throw new Error(`missing asset ${u.pathname}`);
            out = { buffer: buf, type: mimeOf(m[2]) };
          } else {
            const p = path.join(PUBLIC, path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, ''));
            if (!p.startsWith(PUBLIC + path.sep)) throw new Error(`bad path ${u.pathname}`);
            out = { buffer: await readFile(p), type: mimeOf(p) };
          }
        } else {
          out = await fetchAsset(abs);
          if (!out.type || out.type === 'application/octet-stream') out.type = mimeOf(u.pathname, out.type);
        }
        total += out.buffer.length;
        if (total > MAX_TOTAL) throw new Error('Board assets exceed 60 MB.');
        return out;
      })());
    }
    return cache.get(abs);
  }

  const resolve = (ref, against) => {
    try { return new URL(ref, against).href; } catch { return null; }
  };
  const isInline = (ref) => /^(data:|#|about:|blob:)/i.test(ref.trim());

  async function dataUri(ref, against) {
    if (!ref || isInline(ref)) return ref;
    const abs = resolve(ref.trim(), against);
    if (!abs || !/^https?:/.test(abs)) return ref;
    try {
      const { buffer, type } = await load(abs);
      return `data:${type};base64,${buffer.toString('base64')}`;
    } catch {
      return ref; // a missing decorative asset shouldn't fail the whole download
    }
  }

  async function replaceAsync(str, re, fn) {
    const jobs = [];
    str.replace(re, (...m) => { jobs.push(fn(...m)); return ''; });
    const done = await Promise.all(jobs);
    let i = 0;
    return str.replace(re, () => done[i++]);
  }

  async function inlineCss(css, against, depth = 0) {
    if (depth < 4) {
      css = await replaceAsync(css, CSS_IMPORT, async (whole, _q, ref) => {
        const abs = resolve(ref, against);
        if (!abs) return whole;
        try {
          const { buffer } = await load(abs);
          return inlineCss(buffer.toString('utf8'), abs, depth + 1);
        } catch { return whole; }
      });
    }
    return replaceAsync(css, CSS_URL, async (whole, _q, ref) => `url("${await dataUri(ref, against)}")`);
  }

  // stylesheets -> <style>
  for (const el of $('link[rel~="stylesheet"][href]').toArray()) {
    const abs = resolve($(el).attr('href'), base);
    try {
      const { buffer } = await load(abs);
      const media = $(el).attr('media');
      $(el).replaceWith(`<style${media ? ` media="${media}"` : ''}>${await inlineCss(buffer.toString('utf8'), abs)}</style>`);
    } catch {
      /* leave the link; the file still works online */
    }
  }
  for (const el of $('style').toArray()) $(el).text(await inlineCss($(el).text(), base));
  for (const el of $('[style]').toArray()) $(el).attr('style', await inlineCss($(el).attr('style'), base));

  for (const [sel, attr] of [['img[src]', 'src'], ['source[src]', 'src'], ['video[poster]', 'poster'], ['image[href]', 'href'], ['link[rel~="icon"][href]', 'href']]) {
    for (const el of $(sel).toArray()) $(el).attr(attr, await dataUri($(el).attr(attr), base));
  }
  $('img[srcset], source[srcset]').removeAttr('srcset'); // src is now embedded; srcset would re-fetch
  $('link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"], script').remove();
  $('base').remove();
  return $.html();
}
