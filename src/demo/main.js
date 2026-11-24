// Demo build only — entry point of the static Pixelboard demo served at
// __PB_BASE__. One index.html answers every path under the base (the host
// rewrites unknown paths to it); this router picks the view from the path.
//
//   <base>                     boards + guided tour
//   <base>studio/<board>       design surface (the real src/studio/studio.js)
//   <base>edit/<board>         production editing, Guardian-gated
//   <base>display/<board>      fullscreen screen showing the live snapshot
//
// Anything else renders the home view with a notice — never a 404.

import './demo.css';
import { BASE } from './engine.js';
import * as store from './store.js';

const VIEWS = {
  studio: () => import('./views/studio.js'),
  edit: () => import('./views/editor.js'),
  display: () => import('./views/display.js'),
};

async function boot() {
  const path = decodeURIComponent(location.pathname);
  let rel = path.startsWith(BASE) ? path.slice(BASE.length) : '';
  rel = rel.replace(/^\/+|\/+$/g, '');
  const [view, id, ...extra] = rel ? rel.split('/') : [];
  const app = document.getElementById('app');

  let notice = '';
  if (view && VIEWS[view] && id && !extra.length) {
    if (store.siteExists(id)) {
      const mod = await VIEWS[view]();
      document.body.dataset.view = view;
      return mod.mount(app, id);
    }
    notice = 'That board isn’t in this demo (maybe it was reset). Pick one below.';
  } else if (rel) {
    notice = 'That page isn’t part of the demo — here’s the start.';
  }
  if (rel) history.replaceState(null, '', BASE);
  const home = await import('./views/home.js');
  document.body.dataset.view = 'home';
  home.mount(app, { notice });
}

boot().catch((e) => {
  console.error(e);
  const app = document.getElementById('app');
  app.textContent = '';
  const p = document.createElement('p');
  p.className = 'pbd-fatal';
  p.textContent = 'The demo hit an error: ' + (e.message || e) + ' — try “Reset demo” from the home page.';
  const a = document.createElement('a');
  a.href = BASE;
  a.textContent = 'Back to the demo home';
  app.append(p, a);
});
