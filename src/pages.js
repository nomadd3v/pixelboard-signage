// Server-rendered operator pages: the dashboard and the editor shell.
// Both are plain template strings — no client framework.

import { escapeText, escapeAttr } from './ids.js';
import { FONT_LINKS, FONT_PRIMARY } from './board/schema.js';
import { editorPage } from './editor_page.js';

const SHELL = (title, body) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeText(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 880px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  a { color: #2563eb; }
  .row { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
  input[type=text], input[type=url], input[type=password] { flex:1; min-width:12rem; min-height:44px; padding:.5rem .7rem; border:1px solid #8884; border-radius:8px; font:inherit; font-size:16px; }
  button { min-height:44px; padding:.5rem 1rem; border:0; border-radius:8px; background:#2563eb; color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  button.ghost, a.btn.ghost { background:#8883; color:inherit; font-weight:500; }
  a.btn { display:inline-flex; align-items:center; min-height:44px; padding:.5rem 1rem; border-radius:8px; background:#2563eb; color:#fff; font:inherit; font-weight:600; text-decoration:none; }
  ul { list-style:none; padding:0; } li { padding:.5rem 0; border-bottom:1px solid #8882; }
  .muted { color:#8889; font-size:.85rem; }
  .card { border:1px solid #8884; border-radius:10px; padding:1rem; margin:1rem 0; }
</style></head><body>
${body}
</body></html>`;

export function dashboardPage(sites, canConvert = false) {
  const card = (s) => {
    const id = escapeAttr(s.id);
    const kind = s.hasBoard ? 'Studio board' : s.sourceUrl && s.sourceUrl.startsWith('converted:') ? 'Studio board' : 'Imported page';
    return `<li class="site">
      <div class="site-head">
        <div>
          <a class="site-name" href="/sites/${id}/edit">${escapeText(s.name)}</a>
          <div class="muted">${kind} &middot; updated <span data-when="${escapeAttr(s.updatedAt)}">${escapeText(s.updatedAt)}</span></div>
        </div>
        ${s.protected
          ? '<span class="chip ok">Staff can log in</span>'
          : '<span class="chip warn">No staff password</span>'}
      </div>
      <div class="actions">
        <a class="btn" href="/sites/${id}/edit">Edit board</a>
        <button class="ghost" onclick="copy('/sites/${id}/live/screen','TV link copied')">Copy TV link</button>
        ${s.protected ? `<button class="ghost" onclick="copy('/sites/${id}/login','Staff link copied')">Copy staff link</button>` : ''}
        ${s.hasBoard
          ? `<a class="btn ghost" href="/studio/${id}">Design in Studio</a>`
          : canConvert
            ? `<button class="ghost" onclick="convertSite('${id}', this)" title="Lay the imported page out as studio elements in a new, design-editable copy">Make editable in Studio</button>`
            : ''}
      </div>
      <details class="access">
        <summary>Staff access</summary>
        <p class="muted" style="margin:.3rem 0 .6rem">Give staff the staff link and this password. They can change the words and numbers and put the board on the TV — nothing else.</p>
        <div class="row">
          <input type="password" placeholder="${s.protected ? 'New password (replaces the old one)' : 'Choose a password (6+ characters)'}" data-pw="${id}">
          <button class="ghost" onclick="setPw('${id}')">${s.protected ? 'Change password' : 'Set password'}</button>
          ${s.protected ? `<button class="ghost danger" onclick="clearPw('${id}')">Remove</button>` : ''}
        </div>
        <div class="muted" style="margin-top:.5rem">Staff link: <code>/sites/${id}/login</code> &middot; TV link: <code>/sites/${id}/live/screen</code></div>
      </details>
    </li>`;
  };
  const items = sites.length ? sites.map(card).join('') : '<li class="muted" style="padding:1rem 0">No boards yet. Start one in the Studio, or import a page below.</li>';

  return SHELL('Pixelboard', `
    <style>
      .site{border:1px solid #8884;border-radius:14px;padding:1rem;margin:.9rem 0}
      .site-head{display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;flex-wrap:wrap}
      .site-name{font-size:1.1rem;font-weight:700;text-decoration:none;color:inherit}
      .chip{font-size:.78rem;padding:.2rem .6rem;border-radius:999px;font-weight:600;white-space:nowrap}
      .chip.ok{background:#16a34a22;color:#16a34a}.chip.warn{background:#d9770622;color:#d97706}
      .actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}
      .access{margin-top:.8rem;border-top:1px solid #8882;padding-top:.5rem}
      .access summary{cursor:pointer;font-weight:600}
      .danger{color:#dc2626}
      code{background:#8883;padding:.1rem .3rem;border-radius:4px;font-size:.85em;word-break:break-all}
      ul{margin:0}
      li.site{border-bottom:1px solid #8884}
      .toast{position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);opacity:0;background:#111;color:#fff;padding:.6rem 1rem;border-radius:999px;font-size:.9rem;transition:opacity .2s;pointer-events:none}
      .toast.show{opacity:1}
    </style>
    <div class="row" style="justify-content:space-between">
      <h1 style="margin:0">Pixelboard</h1>
      <div class="row">
        <a class="btn" href="/studio">+ New board</a>
        <form method="post" action="/logout" style="margin:0"><button class="ghost" type="submit">Log out</button></form>
      </div>
    </div>
    <p class="muted">Your boards. Open one to change what's on it, copy its TV link for the screen, or give staff a password so they can update it themselves.</p>
    <ul>${items}</ul>

    <details class="card" style="margin-top:1.5rem">
      <summary style="cursor:pointer;font-weight:600">Import an existing web page</summary>
      <p class="muted" style="margin:.4rem 0 .6rem">Paste a page's address. Pixelboard freezes its design and makes the words, numbers and pictures editable.</p>
      <form class="row" onsubmit="return ingestSite(event)">
        <input type="url" id="url" placeholder="https://example.com/board.html" required>
        <input type="text" id="name" placeholder="Board name (optional)">
        <button type="submit">Import</button>
      </form>
      <div class="row" style="margin-top:.6rem">
        <input type="file" id="file" accept=".html,.htm,text/html" style="flex:1">
        <input type="text" id="filename" placeholder="Client name (optional)" style="min-width:12rem">
        <button class="ghost" type="button" onclick="ingestFile()">Ingest local HTML file</button>
      </div>
      <p class="muted" style="margin:.4rem 0 0">URL fetches + freezes a live page. The file option ingests a standalone <code>.html</code> from your computer — no fetch, works for self-contained pages.</p>
      <p id="msg" class="muted"></p>
    </details>
    <div class="toast" id="toast"></div>
    <script>
      var toastT; function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(function(){el.classList.remove('show')},1800); }
      function copy(path,msg){ var v=location.origin+path; (navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).catch(function(){ prompt('Copy this link', v); }); toast(msg); }
      document.querySelectorAll('[data-when]').forEach(function(el){ var d=new Date(el.dataset.when); if(!isNaN(d)) el.textContent=d.toLocaleDateString([],{month:'short',day:'numeric'})+' at '+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}); });
      async function setPw(id){
        const el=document.querySelector('[data-pw="'+id+'"]'); const v=el.value;
        if(v.length<6){alert('Password must be at least 6 characters.');return;}
        const r=await fetch('/api/sites/'+id+'/client-password',{method:'POST',
          headers:{'content-type':'application/json'},body:JSON.stringify({password:v})});
        const d=await r.json(); if(!r.ok){alert(d.error||'Failed');return;}
        el.value=''; location.reload();
      }
      async function clearPw(id){
        if(!confirm('Remove the staff password? Only you will be able to edit this board.'))return;
        const r=await fetch('/api/sites/'+id+'/client-password',{method:'POST',
          headers:{'content-type':'application/json'},body:JSON.stringify({password:''})});
        if(r.ok) location.reload();
      }
      async function convertSite(id, btn){
        btn.disabled=true; btn.textContent='Converting…';
        try{
          const r=await fetch('/api/sites/'+id+'/convert',{method:'POST'});
          const d=await r.json(); if(!r.ok){alert(d.error||'Failed');btn.disabled=false;btn.textContent='Make editable in Studio';return;}
          if(d.warnings&&d.warnings.length) console.warn('convert warnings',d.warnings);
          location.href='/studio/'+d.site.id;
        }catch(err){alert(err.message);btn.disabled=false;btn.textContent='Make editable in Studio';}
      }
      async function ingestSite(e){
        e.preventDefault();
        const msg=document.getElementById('msg'); msg.textContent='Fetching and freezing the page…';
        try{
          const r=await fetch('/api/sites',{method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify({url:document.getElementById('url').value,name:document.getElementById('name').value})});
          const d=await r.json();
          if(!r.ok){msg.textContent='Error: '+(d.error||r.status);return false;}
          msg.textContent='Found '+d.slotCount+' editable fields. Opening the board…';
          location.href='/sites/'+d.site.id+'/edit';
        }catch(err){msg.textContent='Error: '+err.message;}
        return false;
      }
      async function ingestFile(){
        const msg=document.getElementById('msg');
        const f=document.getElementById('file').files[0];
        if(!f){msg.textContent='Choose an .html file first.';return;}
        msg.textContent='Reading + freezing '+f.name+'...';
        const name=document.getElementById('filename').value.trim();
        const q=name?('?name='+encodeURIComponent(name)):'';
        try{
          const r=await fetch('/api/sites/ingest-file'+q,{method:'POST',
            headers:{'content-type':'text/html'},body:f});
          const d=await r.json();
          if(!r.ok){msg.textContent='Error: '+(d.error||r.status);return;}
          msg.textContent='Ingested '+d.slotCount+' editable slots. Opening editor...';
          location.href='/sites/'+d.site.id+'/edit';
        }catch(err){msg.textContent='Error: '+err.message;}
      }
    </script>`);
}

// The operator editor lives in editor_page.js (phone-first field list + preview).
export function editorShell(meta, slots, opts = {}) {
  return editorPage(meta, opts);
}

function authForm(action, next, error, { label, placeholder, heading, sub }) {
  return SHELL(heading, `
    <h1>${escapeText(heading)}</h1>
    <p class="muted">${escapeText(sub)}</p>
    ${error ? `<p style="color:#dc2626">${escapeText(error)}</p>` : ''}
    <form class="row" method="post" action="${escapeAttr(action)}" style="max-width:24rem">
      <input type="hidden" name="next" value="${escapeAttr(next || '')}">
      <input type="password" name="${escapeAttr(label)}" placeholder="${escapeAttr(placeholder)}" required autofocus>
      <button type="submit">Continue</button>
    </form>`);
}

export function loginPage(meta, next, error) {
  return authForm(`/sites/${escapeAttr(meta.id)}/login`, next, error, {
    label: 'password',
    placeholder: 'Site password',
    heading: `Edit ${meta.name}`,
    sub: 'Enter the password you were given to edit this site.',
  });
}

export function ownerLoginPage(next, error) {
  return authForm('/login', next, error, {
    label: 'key',
    placeholder: 'Owner master key',
    heading: 'Pixelboard — owner login',
    sub: 'Enter the owner master key to manage all sites.',
  });
}

// === Studio (design surface, ADR-004) =======================================

const SIZE_OPTIONS = `
  <option value="1920x1080">Landscape · 16:9 (1920×1080)</option>
  <option value="1080x1920">Portrait · 9:16 (1080×1920)</option>
  <option value="1080x1080">Square · 1:1 (1080×1080)</option>
  <option value="2560x1080">Ultrawide · 21:9 (2560×1080)</option>`;

export function studioListPage(boards, templates, aiOn) {
  const items = boards.length
    ? boards.map((b) => `<li>
        <div class="row" style="justify-content:space-between">
          <a href="/studio/${escapeAttr(b.id)}"><strong>${escapeText(b.name)}</strong></a>
          <span class="muted">${escapeText(b.id)}</span>
        </div>
        <div class="muted">updated ${escapeText(b.updatedAt)} &middot;
          <a href="/sites/${escapeAttr(b.id)}/edit">edit content</a> &middot;
          <a href="/sites/${escapeAttr(b.id)}/display" target="_blank">preview</a> &middot;
          <a href="/sites/${escapeAttr(b.id)}/live/screen" target="_blank">live screen &rarr;</a></div>
      </li>`).join('')
    : '<li class="muted">No boards yet — start one above.</li>';

  const tpl = (t) => {
    const ar = t.canvas.w / t.canvas.h;
    const W = 260, H = Math.round(W / ar); // thumb honors the template's own ratio
    return `<div class="tpl">
      <div class="tpl-thumb" style="width:${W}px;height:${H}px">
        <iframe src="/studio/templates/${escapeAttr(t.id)}/preview" scrolling="no" tabindex="-1"
          style="width:${t.canvas.w}px;height:${t.canvas.h}px;transform:scale(${(W / t.canvas.w).toFixed(4)});transform-origin:top left;border:0;pointer-events:none"></iframe>
      </div>
      <div class="tpl-name">${escapeText(t.name)}</div>
      <div class="muted" style="font-size:.78rem;margin:.1rem 0 .5rem">${escapeText(t.description)}</div>
      <button onclick="useTemplate('${escapeAttr(t.id)}')">Use this template</button>
    </div>`;
  };
  const gallery = templates && templates.length
    ? `<div class="tpl-grid">${templates.map(tpl).join('')}</div>`
    : '<p class="muted">No templates.</p>';

  const aiCard = aiOn
    ? `<div class="hero">
        <h2 style="margin:0 0 .2rem">✦ Start with AI</h2>
        <p class="muted" style="margin:0 0 .6rem">Give the exact text for the board, plus the look — Pixelboard lays out <em>your</em> words in that style.</p>
        <label class="muted" style="font-size:.75rem;letter-spacing:.04em">DISPLAY TEXT — your exact words (one line each)</label>
        <textarea id="ai-text" rows="4" placeholder="Today's Special&#10;Surf &amp; Turf Spud&#10;$14.99"></textarea>
        <label class="muted" style="font-size:.75rem;letter-spacing:.04em;display:block;margin-top:.6rem">BACKGROUND &amp; STYLE</label>
        <input type="text" id="ai-style" placeholder="e.g. dark &amp; moody, rustic wood backdrop, bold condensed type" style="width:100%;background:#0d0d10;border:1px solid #8884;border-radius:8px;color:inherit;font:inherit;padding:.55rem">
        <div class="row" style="margin-top:.7rem">
          <select id="ai-size">${SIZE_OPTIONS}</select>
          <label style="display:flex;align-items:center;gap:.35rem;font-size:.85rem;color:#cfcfd6"><input type="checkbox" id="ai-backdrop"> photo backdrop</label>
          <button id="ai-go">Generate board ✦</button>
          <span id="ai-status" class="muted"></span>
        </div>
      </div>`
    : `<div class="hero">
        <h2 style="margin:0 0 .2rem">✦ Start with AI</h2>
        <p class="muted" style="margin:0">AI generation is off. Add <code>ANTHROPIC_API_KEY</code> or <code>OPENROUTER_API_KEY</code> to <code>.env.local</code> and restart.</p>
      </div>`;

  return SHELL('Pixelboard Studio', `
    <style>
      .hero{border:1px solid #ffffff22;border-radius:12px;padding:1.25rem;margin:1rem 0;
        background:linear-gradient(135deg,#2E6BFF18,#7B2FF714 40%,#FF2EC418);}
      .hero textarea{width:100%;background:#0d0d10;border:1px solid #8884;border-radius:8px;color:inherit;font:inherit;padding:.6rem;resize:vertical}
      .hero #ai-go{background:linear-gradient(120deg,#2E6BFF,#7B2FF7,#FF2EC4);border:0}
      .tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem;margin:1rem 0}
      .tpl-thumb{background:#000;border:1px solid #8884;border-radius:8px;overflow:hidden;margin-bottom:.5rem}
      .tpl-name{font-weight:600}
      .two{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0}
      h2{margin-top:1.8rem}
      code{background:#8883;padding:.1rem .3rem;border-radius:4px;font-size:.85em}
    </style>
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <h1 style="margin:0">Pixelboard</h1>
      <a class="muted" href="/">All sites &amp; settings &rarr;</a>
    </div>
    <p class="muted">Start a new board — with AI, a template, or a blank canvas.</p>

    ${aiCard}

    <h2>Start from a template</h2>
    ${gallery}

    <div class="two">
      <div class="card">
        <h3 style="margin-top:0">Blank board</h3>
        <div class="row">
          <select id="preset">${SIZE_OPTIONS}<option value="custom">Custom…</option></select>
          <input type="text" id="cw" placeholder="W" style="display:none;max-width:5rem">
          <input type="text" id="ch" placeholder="H" style="display:none;max-width:5rem">
          <button onclick="newBoard()">Create</button>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Import a site</h3>
        <p class="muted" style="margin:.2rem 0 .6rem">Already have a website? Ingest it into an editable board.</p>
        <a href="/">Go to import &rarr;</a>
      </div>
    </div>
    <p id="msg" class="muted"></p>

    <h2>Your boards</h2>
    <ul>${items}</ul>
    <script>
      const preset=document.getElementById('preset'), cw=document.getElementById('cw'), ch=document.getElementById('ch'), msg=document.getElementById('msg');
      preset.onchange=()=>{ const c=preset.value==='custom'; cw.style.display=ch.style.display=c?'':'none'; };
      async function create(body){
        const r = await fetch('/api/studio/boards', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        const d = await r.json();
        if(!r.ok){ msg.textContent = 'Error: '+(d.error||r.status); return; }
        location.href = d.url;
      }
      async function newBoard(){
        let w,h;
        if(preset.value==='custom'){ w=+cw.value; h=+ch.value; if(!w||!h){ msg.textContent='Enter width and height.'; return; } }
        else { [w,h]=preset.value.split('x').map(Number); }
        create({w,h});
      }
      function useTemplate(id){ create({templateId:id}); }
      const aiGo=document.getElementById('ai-go');
      if(aiGo){ aiGo.onclick=async()=>{
        const text=document.getElementById('ai-text').value.trim();
        const style=document.getElementById('ai-style').value.trim();
        const st=document.getElementById('ai-status');
        if(!text){ st.textContent='Enter the display text first.'; return; }
        const [w,h]=document.getElementById('ai-size').value.split('x').map(Number);
        aiGo.disabled=true; st.textContent='Generating… (a few seconds)';
        try{
          const r=await fetch('/api/studio/boards/ai',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,style,w,h,backdrop:document.getElementById('ai-backdrop').checked})});
          const d=await r.json();
          if(!r.ok){ st.textContent='Error: '+(d.error||(d.errors&&d.errors.map(x=>x.message).join('; '))||r.status); aiGo.disabled=false; return; }
          location.href=d.url;
        }catch(e){ st.textContent='Error: '+e.message; aiGo.disabled=false; }
      }; }
    </script>`);
}

export function boardStudioPage(meta, board) {
  // Inject board doc + site id for the client editor. Escape "<" so a value can't
  // close the <script> tag.
  const inject = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Designing ${escapeText(meta.name)}</title>
${FONT_LINKS}
<link rel="stylesheet" href="/studio-assets/studio.css"></head><body>
<div class="pb-app">
  <div class="pb-top">
    <h1>${escapeText(meta.name)}</h1>
    <span id="pb-status" class="muted"></span>
    <span class="sp"></span>
    <a href="/studio">Studio</a>
    <a href="/sites/${escapeAttr(meta.id)}/edit" target="_blank">Production editor</a>
    <a href="/sites/${escapeAttr(meta.id)}/display" target="_blank">Preview</a>
    <a href="/sites/${escapeAttr(meta.id)}/live/screen" target="_blank">Live screen</a>
    <a href="/sites/${escapeAttr(meta.id)}/download/png" download title="Saved board as a PNG — Save &amp; compile first">PNG</a>
    <a href="/sites/${escapeAttr(meta.id)}/download/html" download title="Saved board as one offline HTML file">HTML</a>
    <button class="btn ghost" id="pb-backdrop" title="Add a matching photo backdrop from the library">✦ Backdrop</button>
    <button class="btn" id="pb-save">Save &amp; compile</button>
  </div>
  <div class="pb-tools">
    <button data-add="text" title="Add text"><img src="/branding/layers/icon-text.svg"></button>
    <button data-add="image" title="Add image"><img src="/branding/layers/icon-image.svg"></button>
    <button data-add="rect" title="Add shape"><img src="/branding/layers/icon-rect.svg"></button>
    <button data-ai title="Generate with AI" style="margin-top:auto"><img src="/branding/layers/icon-ai-sparkle.svg"></button>
  </div>
  <div class="pb-stage" id="pb-stage" style="display:grid;place-items:center"><canvas id="fabric-canvas"></canvas></div>
  <div class="pb-panel" id="pb-panel"></div>
</div>
<div class="pb-modal" id="pb-bd-modal" hidden>
  <div class="pb-modal-box">
    <div class="pb-modal-head">
      <h2>Choose a backdrop</h2>
      <div class="pb-modal-actions">
        <button class="btn ghost" data-bd-action="auto" title="Pick the best match for this board">✨ Auto-match</button>
        <button class="btn ghost" data-bd-action="remove" title="Remove the current backdrop">Remove</button>
        <button class="pb-modal-x" data-bd-action="close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="pb-bd-grid" id="pb-bd-grid"><p class="muted">Loading…</p></div>
  </div>
</div>
<script>window.__PB_BOARD__=${inject(board)};window.__PB_SITE__=${inject(meta.id)};window.__PB_FONTS__=${inject(FONT_PRIMARY)};</script>
<script type="module" src="/studio-assets/studio.js"></script>
</body></html>`;
}

/** Fullscreen/kiosk wrapper — scales `src` to the viewport (NOT a render mode).
 *  `src` defaults to the live editable preview; signage screens pass /sites/:id/live. */
export function displayWrapper(meta, w, h, src) {
  const url = src || `/sites/${meta.id}/preview`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${escapeText(meta.name)}</title>
<style>html,body{margin:0;padding:0;height:100%;width:100%;background:#000;overflow:hidden}
/* position:fixed keeps the oversized board OUT of the scroll flow, so it can't
   inflate the mobile layout viewport (which would break the fit math). */
#stage{position:fixed;top:50%;left:50%;width:${Number(w)}px;height:${Number(h)}px;transform-origin:center center}
iframe{width:100%;height:100%;border:0;display:block}</style></head>
<body><div id="stage"><iframe src="${escapeAttr(url)}"></iframe></div>
<script>
  var W=${Number(w)},H=${Number(h)},s=document.getElementById('stage');
  // Use visualViewport on mobile — innerWidth/innerHeight report the inflated
  // layout viewport, not the actual visible area.
  function fit(){
    var vp=window.visualViewport, vw=vp?vp.width:innerWidth, vh=vp?vp.height:innerHeight;
    s.style.transform='translate(-50%,-50%) scale('+Math.min(vw/W,vh/H)+')';
  }
  addEventListener('resize',fit);
  if(window.visualViewport) visualViewport.addEventListener('resize',fit);
  fit();
</script></body></html>`;
}
