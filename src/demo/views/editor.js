// Production editing — the operator's view. Every change, typed into a field,
// typed onto the board, or fired from the "try to break it" buttons, goes
// through the real guardian() from src/guardian.js before it can touch HEAD.
// This mirrors POST /api/sites/:id/edit, /publish and /rollback in server.js.

import * as store from '../store.js';
import { seedById } from '../seeds.js';
import { PHOTOS, photoFile } from '../photos.js';
import { guardian, render, slotId, SENTINEL_OPEN, SENTINEL_CLOSE } from '../engine.js';
import { imageFileToDataUrl } from '../routes.js';
import { h, href, wordmark, relTime, toast, fitFrame } from '../ui.js';
import { INJECT_CSS, INJECT_JS } from 'virtual:editor-inject';

let ID, frame, fields, logEl, historyEl, statusEl, refit;

/** The in-iframe editor runtime, inlined exactly as server.js injectEditor() does. */
function injectEditor(html, siteId) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tag = `\n<style>${INJECT_CSS}</style>` +
    `\n<script>window.__VELLUM_SITE__=${JSON.stringify(esc(siteId))};</script>` +
    `\n<script>${INJECT_JS}</script>\n`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag;
}

const site = () => store.getSite(ID);
const slotLabel = (s, id) => s.slots.find((x) => x.id === id)?.label || 'unknown slot';

export function mount(app, id) {
  ID = id;
  const meta = site().meta;
  const board = store.getBoard(id);
  const seed = seedById(id);
  document.title = `Editing ${meta.name} · Pixelboard demo`;

  statusEl = h('span.pbd-status', 'Click any dashed text on the board to edit it in place.');
  const top = h('header.pbd-top',
    wordmark(22),
    h('a.pbd-back', { href: href('') }, '← Boards'),
    h('h1.pbd-title', meta.name),
    h('span.pbd-sp'),
    board ? h('a.pbd-btn.ghost', { href: href(`studio/${id}`) }, 'Design (studio)') : null,
    h('a.pbd-btn.ghost', { href: href(`display/${id}`) }, 'Screen'),
    h('button.pbd-btn', { type: 'button', onclick: publish }, 'Publish'));

  // --- preview ---------------------------------------------------------------
  const W = board?.canvas.w || 1280, H = board?.canvas.h || 800;
  frame = h('iframe.pbd-frame.pbd-edit-frame', { title: 'Board preview — click text to edit', scrolling: 'no' });
  const box = h('div.pbd-stage-box', frame);
  const stage = h('section.pbd-stage',
    h('div.pbd-stage-head',
      h('span.pbd-chip', h('span.dash'), 'editable slot'),
      h('span.pbd-chip', h('span.dash.img'), 'editable image'),
      h('span.pbd-muted.small', 'Everything else is locked design.')),
    box,
    h('p.pbd-stage-foot', statusEl));

  // --- panel -------------------------------------------------------------------
  logEl = h('ol.pbd-log', h('li.pbd-log-empty', 'Verdicts from the Guardian show up here — accepted or refused, with the exact error code.'));
  fields = h('div.pbd-fields');
  historyEl = h('div.pbd-history');

  const panel = h('aside.pbd-panel',
    h('section.pbd-card.pbd-break',
      h('h2', 'Try to break it'),
      h('p.pbd-muted', 'Each button sends a real change set to the Guardian — the same deterministic check every edit gets, from staff or from an AI. One is legitimate; the rest are attacks on the design.'),
      breakButtons(seed)),
    h('section.pbd-card',
      h('h2', 'Guardian log'),
      logEl),
    h('section.pbd-card',
      h('h2', 'Content'),
      h('p.pbd-muted', 'The only things staff can touch — the slots the designer marked editable. Press Enter to apply.'),
      fields),
    h('section.pbd-card',
      h('h2', 'Publish & history'),
      h('p.pbd-muted', 'The screen shows the latest published snapshot — edits don’t reach it until you publish. Restore any version, then publish to roll the screen back.'),
      h('div.pbd-row',
        h('button.pbd-btn', { type: 'button', onclick: publish }, 'Publish to screen'),
        h('a.pbd-btn.ghost', { href: href(`display/${id}`) }, 'Open the screen')),
      historyEl));

  app.textContent = '';
  app.append(top, h('main.pbd-editor', stage, panel));

  refit = fitFrame(box, frame, W, H, H > W ? Math.min(window.innerHeight * 0.8, 1100) : Infinity);
  window.addEventListener('message', onFrameMessage);
  renderPreview();
  renderFields();
  renderHistory();
}

// --- the one gate --------------------------------------------------------------

/** Run a change set through the Guardian; save as a new version only if it passes. */
function attempt(changes, how, { quiet = false } = {}) {
  const s = site();
  const verdict = guardian(s.slots, changes);
  if (!verdict.ok) {
    logVerdict(verdict, changes, how, s);
    statusEl.textContent = 'Refused — ' + verdict.errors.map((e) => e.message).join(' ');
    statusEl.className = 'pbd-status bad';
    flashField(Object.keys(changes));
    return verdict;
  }
  const labels = Object.keys(changes).map((k) => slotLabel(s, k));
  let version;
  try {
    version = store.saveContent(ID, { ...s.content, ...changes }, `Edited ${labels.join(', ')}`);
  } catch (e) {
    toast(e.message, 'bad');
    return { ok: false, errors: [] };
  }
  logVerdict(verdict, changes, how, s, version);
  statusEl.textContent = `Accepted — saved as version ${version.id.slice(0, 6)}. Publish to put it on the screen.`;
  statusEl.className = 'pbd-status ok';
  if (!quiet) { renderPreview(); renderFields(); renderHistory(); }
  return verdict;
}

function onFrameMessage(e) {
  if (e.source !== frame.contentWindow || !e.data || e.data.type !== 'vellum-edit') return;
  const verdict = attempt({ [e.data.slotId]: e.data.value }, 'typed on the board');
  if (!verdict.ok) frame.contentWindow.postMessage({ type: 'vellum-revert', slots: [e.data.slotId] }, '*');
}

// --- try to break it -------------------------------------------------------------

function bumpPrice(v) {
  const m = /(\d+)(?:\.(\d{1,2}))?/.exec(v || '');
  if (!m) return '$5.25';
  const cents = Math.round(parseFloat(m[0]) * 100) + 25;
  return (v.includes('$') ? '$' : '') + (m[2] || cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
}

function breakButtons(seed) {
  const s = site();
  const text = s.slots.filter((x) => x.kind === 'text');
  const imgs = s.slots.filter((x) => x.kind === 'attr' && x.field === 'src');
  const pick = (elId, field, fallback) => {
    const want = elId ? slotId(elId, field) : null;
    return s.slots.find((x) => x.id === want) || fallback;
  };
  const story = seed?.story || {};
  const price = pick(story.price, 'text', text[0]);
  const markup = pick(story.markup, 'text', text[1] || text[0]);
  const image = pick(story.image, 'src', imgs[0]);
  const token = pick(story.token, 'text', text[2] || text[0]);
  const designId = story.design ? slotId(story.design, 'text') : 'deadbeef0000';

  const scenarios = [
    price && {
      good: true, title: `Change the ${price.label.toLowerCase()} the right way`,
      sub: 'A normal edit — should be accepted and saved as a new version.',
      run: () => { const cur = site().content[price.id] ?? price.original; return { [price.id]: bumpPrice(cur) }; },
    },
    price && {
      title: `Empty the ${price.label.toLowerCase()}`,
      sub: 'A blank price would leave a hole in the layout.',
      run: () => ({ [price.id]: '' }),
    },
    markup && {
      title: `Paste code into the ${markup.label.toLowerCase()}`,
      sub: 'Markup or a script in a text field.',
      run: () => ({ [markup.id]: 'FREE <script>alert("hacked")</script>' }),
    },
    image && {
      title: `Point the ${image.label.toLowerCase()} at a javascript: URL`,
      sub: 'An image source that would run code instead of showing a picture.',
      run: () => ({ [image.id]: 'javascript:alert(document.cookie)' }),
    },
    token && {
      title: 'Smuggle a template token',
      sub: 'Forge the engine’s internal slot marker to rewrite another part of the board.',
      run: () => ({ [token.id]: `Hi ${SENTINEL_OPEN}${(price || token).id}${SENTINEL_CLOSE}` }),
    },
    {
      title: 'Rewrite the logo',
      sub: 'The brand name isn’t an editable slot — it’s frozen design.',
      run: () => ({ [designId]: 'FREE EVERYTHING' }),
    },
  ].filter(Boolean);

  return h('div.pbd-break-list', scenarios.map((sc) => h('button.pbd-break-btn' + (sc.good ? '.good' : ''), {
    type: 'button',
    onclick: () => attempt(sc.run(), sc.good ? 'legit edit' : 'attack: ' + sc.title),
  },
  h('span.pbd-break-icon', sc.good ? '✓' : '✕'),
  h('span.pbd-break-text', h('strong', sc.title), h('small', sc.sub)))));
}

// --- log -------------------------------------------------------------------------

const show = (v) => String(v)
  .replace(new RegExp(SENTINEL_OPEN, 'g'), '⟦').replace(new RegExp(SENTINEL_CLOSE, 'g'), '⟧')
  .replace(/^data:image\/[^;]+;base64,.*/s, '(uploaded image)');
const val = (v) => (String(v ?? '') === '' ? h('em.pbd-muted', 'empty') : h('q', show(v)));

function logVerdict(verdict, changes, how, s, version) {
  logEl.querySelector('.pbd-log-empty')?.remove();
  const entries = Object.entries(changes);
  const li = h('li.pbd-verdict' + (verdict.ok ? '.ok' : '.bad'),
    h('div.pbd-v-head',
      h('span.pbd-v-badge', verdict.ok ? 'ACCEPTED' : 'REFUSED'),
      h('span.pbd-muted.small', how),
      h('span.pbd-sp'),
      h('span.pbd-muted.small', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }))),
    verdict.ok
      ? entries.map(([k, v]) => h('div.pbd-v-row', h('span.pbd-v-slot', slotLabel(s, k)), ' ← ', val(v)))
      : verdict.errors.map((e) => h('div.pbd-v-err',
        h('code', e.code),
        h('span.pbd-v-msg', e.message),
        h('div.pbd-v-row', h('span.pbd-v-slot', e.code === 'unknown_slot' ? `slot ${e.slotId}` : slotLabel(s, e.slotId)), ' ← ', val(changes[e.slotId])))),
    h('div.pbd-muted.small', verdict.ok ? `Saved as version ${version.id.slice(0, 6)}.` : 'Nothing saved — the board is unchanged.'));
  logEl.prepend(li);
  while (logEl.children.length > 30) logEl.lastChild.remove();
  li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// --- preview, fields, history -------------------------------------------------------

function renderPreview() {
  const s = site();
  frame.srcdoc = injectEditor(render({ template: s.template, slots: s.slots, content: s.content, mode: 'edit' }), ID);
  refit?.();
}

function flashField(ids) {
  for (const id of ids) {
    const el = fields.querySelector(`[data-slot="${CSS.escape(id)}"]`);
    if (!el) continue;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
}

function renderFields() {
  const s = site();
  fields.textContent = '';
  for (const slot of s.slots) {
    const cur = s.content[slot.id] ?? slot.original;
    if (slot.kind === 'text') {
      const input = h('input.pbd-input', { type: 'text', name: `slot-${slot.id}`, value: cur, 'aria-label': slot.label, spellcheck: false });
      const commit = () => { if (input.value !== (site().content[slot.id] ?? slot.original)) attempt({ [slot.id]: input.value }, 'typed in the field'); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') input.value = site().content[slot.id] ?? slot.original; });
      input.addEventListener('change', commit);
      fields.append(h('label.pbd-field', { 'data-slot': slot.id }, h('span', slot.label), input));
    } else if (slot.field === 'src') {
      const url = h('input.pbd-input', { type: 'text', name: `slot-${slot.id}-url`, value: cur.startsWith('data:') ? '(uploaded image)' : cur, 'aria-label': slot.label + ' URL', spellcheck: false });
      url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); attempt({ [slot.id]: url.value }, 'pasted a URL'); } });
      const lib = h('div.pbd-photos', PHOTOS.map((p) => {
        const src = href(photoFile(p.key));
        return h('button.pbd-photo' + (src === cur ? '.on' : ''), { type: 'button', title: p.label, onclick: () => attempt({ [slot.id]: src }, 'picked a photo') },
          h('img', { src, alt: p.label, loading: 'lazy' }));
      }));
      const file = h('input', { type: 'file', name: `slot-${slot.id}-upload`, accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif', hidden: true });
      file.addEventListener('change', async () => {
        const f = file.files?.[0]; if (!f) return;
        try { attempt({ [slot.id]: await imageFileToDataUrl(f) }, 'uploaded a photo'); } catch (e) { toast(e.message, 'bad'); }
        file.value = '';
      });
      fields.append(h('div.pbd-field.img', { 'data-slot': slot.id },
        h('span', slot.label),
        h('div.pbd-img-row',
          h('img.pbd-img-cur', { src: cur, alt: '' }),
          h('div.pbd-img-side',
            lib,
            h('div.pbd-row',
              url,
              h('button.pbd-btn.ghost.sm', { type: 'button', onclick: () => file.click() }, 'Upload'))),
          file)));
    } else {
      const input = h('input.pbd-input', { type: 'text', name: `slot-${slot.id}`, value: cur, 'aria-label': slot.label });
      input.addEventListener('change', () => attempt({ [slot.id]: input.value }, 'typed in the field'));
      fields.append(h('label.pbd-field', { 'data-slot': slot.id }, h('span', slot.label), input));
    }
  }
}

function renderHistory() {
  const versions = store.listVersions(ID);
  const snaps = store.listSnapshots(ID);
  historyEl.textContent = '';
  historyEl.append(
    h('h3', 'On the screen'),
    snaps.length
      ? h('ul.pbd-list', snaps.slice(0, 6).map((sn, i) => h('li',
        h('span', i === 0 ? h('strong', 'live · ') : null, `snapshot ${sn.id.slice(0, 6)}`),
        h('span.pbd-muted.small', relTime(sn.createdAt)),
        h('a.pbd-link.small', { href: href(`display/${ID}${i === 0 ? '' : '?snap=' + sn.id}`) }, i === 0 ? 'view' : 'view (pinned)'))))
      : h('p.pbd-muted', 'Not published yet.'),
    h('h3', 'Versions'),
    h('ul.pbd-list', versions.slice(0, 10).map((v, i) => h('li',
      h('span', i === 0 ? h('strong', 'current · ') : null, v.message || 'Edit'),
      h('span.pbd-muted.small', `${v.id.slice(0, 6)} · ${relTime(v.createdAt)}`),
      i === 0 ? h('span.pbd-muted.small', '—') : h('button.pbd-btn.ghost.xs', { type: 'button', onclick: () => rollback(v.id) }, 'Restore')))));
}

function rollback(versionId) {
  const v = store.getVersion(ID, versionId);
  if (!v) return toast('No such version.', 'bad');
  try {
    const nv = store.saveContent(ID, v.content, `Rollback to ${v.id.slice(0, 6)}`);
    statusEl.textContent = `Restored version ${v.id.slice(0, 6)} (saved as ${nv.id.slice(0, 6)}). Publish to put it back on the screen.`;
    statusEl.className = 'pbd-status ok';
    toast('Version restored — publish to roll the screen back.');
  } catch (e) { toast(e.message, 'bad'); }
  renderPreview(); renderFields(); renderHistory();
}

function publish() {
  const s = site();
  const html = render({ template: s.template, slots: s.slots, content: s.content, mode: 'publish' });
  try {
    const snap = store.savePublish(ID, html, JSON.stringify(s.content));
    statusEl.textContent = `Published snapshot ${snap.id.slice(0, 6)} — the screen now shows it.`;
    statusEl.className = 'pbd-status ok';
    toast(`Published snapshot ${snap.id.slice(0, 6)} — the screen flips to it.`, 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  renderHistory();
}
