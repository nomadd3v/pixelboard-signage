// Demo home: the pitch, the three-step tour, and the fictional boards.

import * as store from '../store.js';
import { SEEDS } from '../seeds.js';
import { h, href, wordmark, demoTag, relTime, fitFrame, boardFrame, toast } from '../ui.js';

export function mount(app, { notice } = {}) {
  app.textContent = '';
  const boards = store.listBoards();
  const first = boards[0]?.id || 'marigold';

  const top = h('header.pbd-top',
    wordmark(26), demoTag(),
    h('span.pbd-sp'),
    h('button.pbd-btn.ghost', {
      type: 'button',
      title: 'Throw away every edit and restore the original boards',
      onclick: () => { store.reset(); toast('Demo reset — original boards restored.'); mount(app, {}); },
    }, 'Reset demo'));

  const hero = h('section.pbd-hero', h('div.pbd-hero-text',
    notice ? h('p.pbd-notice', notice) : null,
    h('p.pbd-eyebrow', 'Digital signage · design studio + locked-down editor'),
    h('h1', 'Design the board once.', h('br'), h('span.pbd-grad', 'Let anyone update it.'), h('br'), 'Nobody can break it.'),
    h('p.pbd-lede',
      'Pixelboard is a design studio for menu boards and screens. A designer lays the board out; staff change prices, specials and photos through an editor where every edit passes the ',
      h('strong', 'Guardian'),
      ' — a deterministic validator that refuses anything that would break the design or inject code.'),
    h('div.pbd-cta',
      h('a.pbd-btn.big', { href: href(`edit/${first}`) }, 'Try to break a board →'),
      h('a.pbd-btn.ghost.big', { href: href(`studio/${first}`) }, 'Open the studio'))),
    heroPreview(boards));

  const steps = h('section.pbd-steps',
    step(1, 'Design', 'Open a board in the studio. Drag, resize, restyle — and tick which fields staff may edit. Those become guarded slots.', href(`studio/${first}`), 'Open the studio'),
    step(2, 'Edit safely', 'Switch to production editing. Change a price — then try to break it: empty a slot, paste code, use a sketchy image URL. Watch the Guardian refuse, with its real error.', href(`edit/${first}`), 'Try to break it'),
    step(3, 'Publish & roll back', 'Publish to an immutable snapshot and open the screen. Roll back to any earlier version and publish again — the screen flips.', href(`display/${first}`), 'Open the screen'));

  const grid = h('section.pbd-boards');
  for (const meta of boards) {
    const seed = SEEDS.find((s) => s.id === meta.id);
    const snaps = store.listSnapshots(meta.id);
    const board = store.getBoard(meta.id);
    const thumb = h('div.pbd-thumb');
    const html = snaps.length ? store.readSnapshot(meta.id, snaps[0].id) : null;
    if (html) {
      const f = boardFrame(html, { title: `${meta.name} — live screen` });
      thumb.append(f);
      requestAnimationFrame(() => fitFrame(thumb, f, board.canvas.w, board.canvas.h, 300));
    }
    grid.append(h('article.pbd-board',
      h('a.pbd-thumb-link', { href: href(`display/${meta.id}`), title: 'Open the live screen' }, thumb),
      h('div.pbd-board-body',
        h('h3', seed?.business || meta.name),
        h('p.pbd-muted', seed?.kind || `${board.canvas.w}×${board.canvas.h}`),
        h('p.pbd-muted.small', snaps.length ? `On screen: snapshot ${snaps[0].id.slice(0, 6)} · published ${relTime(snaps[0].createdAt)}` : 'Not published yet'),
        h('div.pbd-row',
          h('a.pbd-btn.ghost.sm', { href: href(`studio/${meta.id}`) }, 'Design'),
          h('a.pbd-btn.sm', { href: href(`edit/${meta.id}`) }, 'Edit content'),
          h('a.pbd-btn.ghost.sm', { href: href(`display/${meta.id}`) }, 'Screen')))));
  }

  const foot = h('footer.pbd-foot',
    h('p',
      h('strong', 'What’s real here: '),
      'the Pixelboard engine itself — the board compiler, the Guardian, the renderer and the Fabric.js studio are bundled straight from the product source and run in your browser. ',
      'The server is swapped for an in-browser store, so your edits stay on this device (“Reset demo” clears them).'),
    h('p',
      h('strong', 'What’s not: '),
      'every business, menu and price is fictional; the food “photos” are generated illustrations. ',
      '✦ AI generation is switched off — this demo makes no AI calls; the studio offers clearly-labelled canned suggestions instead.'));

  app.append(top, h('main.pbd-home', hero, steps, h('h2.pbd-h2', 'The boards'), grid, foot));
}

function step(n, title, body, link, label) {
  return h('article.pbd-step',
    h('span.pbd-step-n', String(n)),
    h('h3', title),
    h('p', body),
    h('a.pbd-link', { href: link }, label + ' →'));
}

/** The first landscape board's live screen, framed like a TV — the hero's right column. */
function heroPreview(boards) {
  const meta = boards.find((b) => { const bd = store.getBoard(b.id); return bd && bd.canvas.w > bd.canvas.h; }) || boards[0];
  if (!meta) return null;
  const board = store.getBoard(meta.id);
  const snaps = store.listSnapshots(meta.id);
  const html = snaps.length ? store.readSnapshot(meta.id, snaps[0].id) : null;
  if (!html) return null;
  const thumb = h('div.pbd-thumb');
  const f = boardFrame(html, { title: `${meta.name} — live screen` });
  thumb.append(f);
  requestAnimationFrame(() => fitFrame(thumb, f, board.canvas.w, board.canvas.h));
  return h('a.pbd-hero-screen', { href: href(`display/${meta.id}`), title: 'Open the live screen' },
    h('span.pbd-hero-live', h('i'), 'LIVE · ', meta.name),
    thumb);
}
