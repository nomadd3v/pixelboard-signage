// Ingest: parse HTML into a frozen template + a slot manifest + default content.
// See docs/adrs/ADR-001-content-model.md (Decisions 1 & 2).

import * as cheerio from 'cheerio';
import { slotId, token, escapeAttr } from './ids.js';

// Text nodes inside these elements are NOT content (would corrupt the page).
const TEXT_SKIP = new Set([
  'script', 'style', 'title', 'textarea', 'option', 'head', 'noscript', 'template',
]);

// Element node type in domhandler/cheerio.
const isTag = (n) => n.type === 'tag' || n.type === 'script' || n.type === 'style';
const isText = (n) => n.type === 'text';

function safeHref(href) {
  if (!href) return false;
  const v = href.trim();
  if (v === '' || v.startsWith('#')) return false; // pure anchors aren't content
  return /^(https?:|mailto:|tel:|\/|\.)/i.test(v);
}

/** Compute a stable dom path: tag/nth-of-type chain + optional @field suffix. */
function domPath(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.parent) {
    const tag = cur.name;
    let idx = 1;
    let sib = cur.prev;
    while (sib) {
      if (isTag(sib) && sib.name === tag) idx++;
      sib = sib.prev;
    }
    parts.unshift(`${tag}:${idx}`);
    cur = cur.parent;
  }
  return parts.join('>');
}

function textIndex(textNode) {
  // index of this text node among its parent's text-node children
  let idx = 0;
  let sib = textNode.parent ? textNode.parent.children[0] : null;
  for (; sib; sib = sib.next) {
    if (sib === textNode) break;
    if (isText(sib)) idx++;
  }
  return idx;
}

/**
 * Ingest a raw HTML string.
 * @param {string} html
 * @param {string} [baseUrl]  source URL; if given, a <base href> is injected so the
 *   frozen template's relative assets (css/js/images/nav) resolve against the origin
 *   when the snapshot is served from Vellum's own host instead of 404-ing.
 * @param {{ stripScripts?: boolean }} [opts]  stripScripts: drop every <script> and
 *   script preload/modulepreload BEFORE slot ids are computed (deterministic, so a
 *   re-import keeps the same ids). For signage: a framework page's hydration bundle
 *   would re-render over edited slots, and it would run inside Pixelboard's origin.
 * @returns {{ template: string, slots: object[], content: Record<string,string> }}
 */
export function ingest(html, baseUrl, { stripScripts = true } = {}) {
  const $ = cheerio.load(html, { decodeEntities: false }, true);

  // Frozen means inert: drop every script (and script-preload hint) and inline
  // event handlers BEFORE walking for slots. A snapshot that executes the source
  // page's JS isn't frozen — a hydrating SPA (React/Next) will diff the template
  // DOM, reject it, and re-render the live app over the editor.
  if (stripScripts) $('script, link[rel="modulepreload"], link[rel="preload"][as="script"]').remove();
  if (stripScripts) $('*').each((_, el) => {
    for (const name of Object.keys(el.attribs || {})) {
      if (/^on/i.test(name)) $(el).removeAttr(name);
    }
  });

  const slots = [];
  const content = {};
  const seen = new Set();

  function addSlot(slot) {
    if (seen.has(slot.id)) return false; // collision: keep first, skip dup path
    seen.add(slot.id);
    slots.push(slot);
    content[slot.id] = slot.original;
    return true;
  }

  // Walk every element for attribute slots, every text node for text slots.
  const walk = (node) => {
    if (isTag(node)) {
      const el = $(node);
      const tag = node.name;
      const attrMarks = [];

      const attrSlot = (field, urlLike, requiredIfPresent) => {
        const raw = node.attribs?.[field];
        if (raw == null) return;
        if (urlLike && !safeHref(raw) && field === 'href') return; // skip non-content hrefs
        const original = raw;
        if (urlLike && field === 'src' && original.trim() === '') return;
        const id = slotId(`${domPath(node)}@${field}`, field);
        const ok = addSlot({
          id,
          kind: 'attr',
          field,
          urlLike,
          original,
          required: requiredIfPresent ? original.trim() !== '' : false,
          label: labelFor(tag, field),
          path: `${domPath(node)}@${field}`,
        });
        if (ok) {
          el.attr(field, token(id));
          attrMarks.push(`${id}:${field}`);
        }
      };

      if (tag === 'img') {
        attrSlot('src', true, true);
        attrSlot('alt', false, false);
      } else if (tag === 'a') {
        attrSlot('href', true, true);
      }

      if (attrMarks.length) el.attr('data-v-attr', attrMarks.join(' '));

      // Recurse into children (text + nested elements).
      for (const child of node.children || []) walk(child);
      return;
    }

    if (isText(node)) {
      const parentTag = node.parent?.name;
      if (parentTag && TEXT_SKIP.has(parentTag)) return;
      const value = node.data;
      if (!value || value.trim() === '') return;
      const id = slotId(`${domPath(node.parent)}>#text:${textIndex(node)}`, 'text');
      const ok = addSlot({
        id,
        kind: 'text',
        field: 'text',
        urlLike: false,
        original: value,
        required: true,
        label: labelFor(parentTag, 'text'),
        path: `${domPath(node.parent)}>#text:${textIndex(node)}`,
      });
      if (ok) node.data = token(id);
    }
  };

  const root = $.root()[0];
  for (const child of root.children || []) walk(child);

  // Resolve relative assets: prepend <base href> as the FIRST child of <head> so it
  // governs every element after it (the stylesheet <link> included). Respect a base
  // the source already declares.
  if (baseUrl && $('base[href]').length === 0) {
    let head = $('head');
    if (head.length === 0) {
      $('html').length ? $('html').prepend('<head></head>') : $.root().prepend('<head></head>');
      head = $('head');
    }
    head.prepend(`<base href="${escapeAttr(baseUrl)}">`);
  }

  return { template: $.html(), slots, content };
}

function labelFor(tag, field) {
  if (field === 'src') return 'Image';
  if (field === 'alt') return 'Image alt text';
  if (field === 'href') return 'Link URL';
  const headings = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading', h5: 'Heading', h6: 'Heading' };
  if (headings[tag]) return headings[tag];
  if (tag === 'a') return 'Link text';
  if (tag === 'button') return 'Button';
  if (tag === 'li') return 'List item';
  return 'Text';
}
