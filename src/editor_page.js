// The operator editor (/sites/:id/edit) — phone-first. Server-rendered, no
// framework. The design target is a shop owner who used to keep this board in a
// spreadsheet: open the link, see the board, change the numbers, put it on the TV.
//
// Three things on the page, in this order:
//   1. a status bar that always says whether the TV matches what you see
//   2. the board preview (tap a text to edit in place, as before)
//   3. the same values as a labelled field list, grouped by row — big targets
// Every edit goes through POST /api/sites/:id/edit (Guardian) exactly as before;
// this page only changes how the operator reaches a slot.

import { escapeText, escapeAttr } from './ids.js';

const CSS = `
  :root{color-scheme:light dark;--bg:#fff;--fg:#111;--mute:#6b7280;--line:#e5e7eb;--card:#f8fafc;--acc:#2563eb;--ok:#16a34a;--warn:#d97706;--bad:#dc2626}
  @media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#f3f4f6;--mute:#9ca3af;--line:#262a33;--card:#161a21}}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  a{color:var(--acc)}
  button,.btn{min-height:44px;padding:.55rem 1rem;border:0;border-radius:10px;background:var(--acc);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.4rem}
  button:disabled{opacity:.55;cursor:default}
  .ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
  .muted{color:var(--mute);font-size:.9rem}
  input[type=text],input[type=url],textarea{width:100%;min-height:44px;padding:.55rem .7rem;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit;font-size:16px}
  textarea{resize:vertical;min-height:72px}
  input:focus,textarea:focus{outline:2px solid var(--acc);outline-offset:1px;border-color:transparent}

  .top{display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;border-bottom:1px solid var(--line)}
  .top h1{font-size:1.1rem;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .top form{margin:0}
  .top .ghost{min-height:36px;padding:.3rem .7rem;font-weight:500}

  /* status bar: the one place that answers "is this on the TV?" */
  .state{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:.75rem;padding:.6rem 1rem;background:var(--bg);border-bottom:1px solid var(--line)}
  .state .dot{width:12px;height:12px;border-radius:50%;background:var(--ok);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 25%,transparent)}
  .state.dirty .dot{background:var(--warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 25%,transparent)}
  .state.busy .dot{background:var(--mute);box-shadow:none}
  .state .txt{flex:1;min-width:0;line-height:1.25}
  .state .txt b{display:block;font-size:.95rem}
  .state .txt span{display:block;font-size:.8rem;color:var(--mute)}
  .state #publish{white-space:nowrap}
  .state.dirty #publish{background:var(--warn)}
  .state:not(.dirty) #publish{background:transparent;color:var(--mute);border:1px solid var(--line);font-weight:500}

  .wrap{max-width:1500px;margin:0 auto;padding:0 1rem 6rem}
  .stage{margin:1rem 0 .5rem}
  #pvwrap{position:relative;width:100%;overflow:hidden;border-radius:12px;background:#000;border:1px solid var(--line)}
  #pvwrap iframe{position:absolute;top:0;left:0;border:0;transform-origin:0 0}
  .plain{width:100%;height:60vh;border:1px solid var(--line);border-radius:12px;background:#fff}
  .hint{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:.4rem 0 1rem}
  .hint .muted{font-size:.82rem}
  .hint a{white-space:nowrap;font-size:.82rem}

  .groups{display:grid;gap:1rem}
  .group{border:1px solid var(--line);border-radius:14px;background:var(--card);overflow:hidden;container-type:inline-size}
  .group>summary{list-style:none;display:flex;align-items:center;gap:.6rem;padding:.8rem 1rem;cursor:pointer;font-weight:700;font-size:1.02rem}
  .group>summary::-webkit-details-marker{display:none}
  .group>summary .n{margin-left:auto;font-weight:500;font-size:.8rem;color:var(--mute)}
  .group>summary::after{content:"›";font-size:1.3rem;color:var(--mute);transform:rotate(90deg);transition:transform .15s}
  .group:not([open])>summary::after{transform:none}
  .fields{display:grid;gap:.1rem;padding:0 .6rem .6rem}
  @container (min-width:640px){.fields{grid-template-columns:1fr 1fr}}
  .f{display:grid;grid-template-columns:minmax(7rem,38%) 1fr;align-items:center;gap:.6rem;padding:.35rem .4rem;border-radius:10px}
  .f.multi,.f.pic{grid-template-columns:1fr}
  .f label{font-size:.9rem;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .f.multi label,.f.pic label{white-space:normal}
  .f input,.f textarea{text-align:left}
  .f.num input{font-variant-numeric:tabular-nums;font-weight:600;text-align:right}
  .f.saved input,.f.saved textarea{border-color:var(--ok)}
  .f.bad input,.f.bad textarea{border-color:var(--bad)}
  .f .err{grid-column:1/-1;color:var(--bad);font-size:.82rem;display:none}
  .f.bad .err{display:block}
  .pic .row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
  .pic img{width:72px;height:72px;object-fit:contain;background:#000;border-radius:8px;border:1px solid var(--line)}
  .pic details summary{cursor:pointer;color:var(--mute);font-size:.85rem}
  .pic details{flex:1 1 100%}
  .pic .up{position:relative;overflow:hidden}
  .pic .up input{position:absolute;inset:0;opacity:0;cursor:pointer}

  .more{margin-top:1.5rem;border-top:1px solid var(--line)}
  .more details{border-bottom:1px solid var(--line)}
  .more summary{padding:.8rem 0;cursor:pointer;font-weight:600}
  .more .body{padding:0 0 1rem}
  .more ul{list-style:none;margin:0;padding:0}
  .more li{padding:.45rem 0;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
  .more li .tag{font-size:.75rem;padding:.1rem .5rem;border-radius:999px;background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok);font-weight:600}
  .linkbox{display:flex;gap:.5rem;align-items:center}
  .linkbox input{flex:1;font-size:.9rem}
  .toast{position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%) translateY(20px);opacity:0;background:var(--fg);color:var(--bg);padding:.6rem 1rem;border-radius:999px;font-size:.9rem;transition:all .2s;pointer-events:none;z-index:9}
  .toast.show{opacity:1;transform:translateX(-50%)}

  @media(min-width:1000px){
    .wrap{display:grid;grid-template-columns:minmax(0,1fr) 460px;gap:1.5rem;align-items:start}
    .stage{position:sticky;top:4.2rem}
    .side{padding-top:1rem}
    .more{grid-column:1/-1}
  }
`;

const fmtTime = `function fmt(iso){if(!iso)return '';var d=new Date(iso),n=Date.now()-d.getTime();
  if(n<60e3)return 'just now';if(n<3600e3)return Math.round(n/60e3)+' min ago';
  var sameDay=new Date().toDateString()===d.toDateString();
  return (sameDay?'today':d.toLocaleDateString([],{month:'short',day:'numeric'}))+' at '+d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}`;

function fieldHtml(f) {
  const id = escapeAttr(f.slotId);
  if (f.kind === 'attr' && f.field === 'src') {
    return `<div class="f pic" data-f="${id}">
      <label>${escapeText(f.label)}</label>
      <div class="row">
        <img src="${escapeAttr(f.value)}" alt="" data-thumb>
        <span class="btn ghost up">Choose new picture<input type="file" accept="image/*" data-upload="${id}"></span>
        <details><summary>or paste a picture link</summary>
          <input type="url" data-slot="${id}" value="${escapeAttr(f.value)}" placeholder="https://..."></details>
      </div>
      <div class="err"></div>
    </div>`;
  }
  if (f.kind === 'attr') {
    return `<div class="f" data-f="${id}">
      <label for="in-${id}">${escapeText(f.label)}</label>
      <input id="in-${id}" type="${f.field === 'href' ? 'url' : 'text'}" data-slot="${id}" value="${escapeAttr(f.value)}">
      <div class="err"></div>
    </div>`;
  }
  if (f.multiline) {
    return `<div class="f multi" data-f="${id}">
      <label for="in-${id}">${escapeText(f.label)}</label>
      <textarea id="in-${id}" data-slot="${id}" rows="2">${escapeText(f.value)}</textarea>
      <div class="err"></div>
    </div>`;
  }
  return `<div class="f${f.numeric ? ' num' : ''}" data-f="${id}">
    <label for="in-${id}">${escapeText(f.label)}</label>
    <input id="in-${id}" type="text" data-slot="${id}" value="${escapeAttr(f.value)}"${f.numeric ? ' inputmode="decimal"' : ''} autocomplete="off">
    <div class="err"></div>
  </div>`;
}

function groupHtml(g, i) {
  // rows and the board open by default; headings/footers/other collapse so the
  // numbers come first on a phone
  const open = g.kind === 'row' || g.kind === 'board' || i === 0;
  return `<details class="group"${open ? ' open' : ''}>
    <summary>${escapeText(g.title)}<span class="n">${g.fields.length} field${g.fields.length === 1 ? '' : 's'}</span></summary>
    <div class="fields">${g.fields.map(fieldHtml).join('')}</div>
  </details>`;
}

export function editorPage(meta, { owner = false, ai = false, canvas = null, groups = [], status = {} } = {}) {
  const sid = escapeAttr(meta.id);
  const back = owner
    ? '<a class="btn ghost" href="/">&larr; All boards</a>'
    : `<form method="post" action="/sites/${sid}/logout"><button class="ghost" type="submit">Log out</button></form>`;
  const stage = canvas
    ? `<div id="pvwrap" style="aspect-ratio:${Number(canvas.w)}/${Number(canvas.h)}">
         <iframe id="pv" src="/sites/${sid}/preview?mode=edit" style="width:${Number(canvas.w)}px;height:${Number(canvas.h)}px"></iframe>
       </div>`
    : `<iframe id="pv" class="plain" src="/sites/${sid}/preview?mode=edit"></iframe>`;
  const total = groups.reduce((n, g) => n + g.fields.length, 0);

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeText(meta.name)} · Pixelboard</title>
<style>${CSS}</style></head><body>
<div class="top">
  <h1>${escapeText(meta.name)}</h1>
  ${back}
</div>
<div class="state${status.dirty ? ' dirty' : ''}" id="state">
  <span class="dot"></span>
  <div class="txt"><b id="st-main"></b><span id="st-sub"></span></div>
  <button id="publish" onclick="publish()">Put on TV</button>
</div>

<div class="wrap">
  <div class="stage">
    ${stage}
    <div class="hint">
      <span class="muted">This is what the TV will show. Tap any text on the board, or use the fields${canvas ? ' below' : ''}.</span>
      <a class="muted" href="/sites/${sid}/display" target="_blank">Full size &nearr;</a>
    </div>
  </div>

  <div class="side">
    <div class="groups" id="groups">
      ${groups.length ? groups.map(groupHtml).join('') : '<p class="muted">Nothing on this board can be edited yet.</p>'}
    </div>
    <p class="muted" style="margin:.8rem .2rem">${total} editable field${total === 1 ? '' : 's'}. Changes save as you go and show on the TV when you tap <b>Put on TV</b>.</p>
  </div>

  <div class="more">
    <details>
      <summary>TV link</summary>
      <div class="body">
        <p class="muted" style="margin:.2rem 0 .6rem">Open this on the TV (or its browser/stick) once. It always shows the latest board you put on TV.</p>
        <div class="linkbox"><input type="text" id="tvlink" readonly value=""><button class="ghost" onclick="copyLink()">Copy</button></div>
      </div>
    </details>
    <details>
      <summary>History</summary>
      <div class="body"><ul id="snaps"><li class="muted">Loading…</li></ul></div>
    </details>
    <details>
      <summary>Flat image (for screens that can't load HTML)</summary>
      <div class="body">
        <p class="muted" style="margin:.2rem 0 .6rem">A PNG of the latest published board, made when you put it on the TV. Point a simple screen at the link below.</p>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;align-items:center">
          <a target="_blank" href="/sites/${sid}/live.png">/sites/${sid}/live.png</a>
          <button class="ghost" onclick="rasterizeNow()">Make it now</button>
          <span id="rzstatus" class="muted"></span>
        </div>
      </div>
    </details>
    <details>
      <summary>Download</summary>
      <div class="body" style="display:flex;gap:.6rem;flex-wrap:wrap">
        <a class="btn ghost" href="/sites/${sid}/download/png" download>Picture (PNG)</a>
        <a class="btn ghost" href="/sites/${sid}/download/html" download>Web page (HTML)</a>
      </div>
    </details>
    ${ai ? `<details>
      <summary>Ask AI for a change (owner)</summary>
      <div class="body">
        <p class="muted" style="margin:.2rem 0 .6rem">Plain English, e.g. "set Jeff's reviews to 2". Proposals still go through the Guardian.</p>
        <form class="linkbox" onsubmit="return chat(event)">
          <input type="text" id="chatmsg" placeholder="Describe a change…" autocomplete="off">
          <button type="submit">Send</button>
        </form>
        <p id="chatreply" class="muted"></p>
      </div>
    </details>` : ''}
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
(function(){
  var SITE=${JSON.stringify(meta.id)};
  var state=${JSON.stringify({ dirty: !!status.dirty, live: status.live || null, liveUrl: status.liveUrl || '' }).replace(/</g, '\\u003c')};
  var pv=document.getElementById('pv');
  ${fmtTime}

  // --- preview scaling (board renders at native size, scaled to fit) --------
  var wrap=document.getElementById('pvwrap');
  if(wrap){
    var W=${Number(canvas && canvas.w) || 0},H=${Number(canvas && canvas.h) || 0};
    function fit(){ var w=wrap.clientWidth; pv.style.transform='scale('+(w/W)+')'; }
    addEventListener('resize',fit); fit();
  }

  // --- status bar -------------------------------------------------------------
  var stateEl=document.getElementById('state'),stMain=document.getElementById('st-main'),stSub=document.getElementById('st-sub'),pub=document.getElementById('publish');
  function paint(){
    stateEl.classList.toggle('dirty',state.dirty); stateEl.classList.remove('busy');
    if(!state.live){ stMain.textContent='Not on the TV yet'; stSub.textContent='Tap Put on TV when the board looks right.'; }
    else if(state.dirty){ stMain.textContent='Changes not on the TV yet'; stSub.textContent='TV last updated '+fmt(state.live.createdAt)+'. Your edits are saved here.'; }
    else { stMain.textContent='On the TV'; stSub.textContent='Updated '+fmt(state.live.createdAt)+'. Everything you see is live.'; }
    pub.textContent=state.dirty?'Put on TV':'On TV ✓'; pub.disabled=!state.dirty;
    document.getElementById('tvlink').value=location.origin+state.liveUrl;
  }
  paint(); setInterval(function(){ if(state.live) paint(); },60e3);

  async function refreshStatus(){
    try{ var r=await fetch('/api/sites/'+SITE+'/status'); if(r.ok){ var d=await r.json(); state.dirty=d.dirty; state.live=d.live; state.liveUrl=d.liveUrl; paint(); renderSnaps(d.snapshots||[]); } }catch(e){}
  }

  var toastT; function toast(t){ var el=document.getElementById('toast'); el.textContent=t; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(function(){el.classList.remove('show')},1800); }

  // --- saving: one path for fields, board taps, uploads ---------------------
  async function save(changes){
    var r=await fetch('/api/sites/'+SITE+'/edit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({changes:changes})});
    var d=await r.json().catch(function(){return {}});
    if(!r.ok) return {ok:false,errors:d.errors||[{message:d.error||'Could not save.'}]};
    state.dirty=true; paint();
    return {ok:true};
  }
  function friendly(e){
    var m={empty_required:"This can't be left blank.",html_not_allowed:"Plain text only here (no < or > tags).",unsafe_url:"That link type isn't allowed.",forbidden_char:"That contains a character the board can't show."};
    return m[e.code]||e.message||'Could not save.';
  }
  function fieldOf(id){ return document.querySelector('.f[data-f="'+id+'"]'); }
  function inputOf(id){ return document.querySelector('[data-slot="'+id+'"]'); }
  var last={};
  document.querySelectorAll('[data-slot]').forEach(function(i){ last[i.dataset.slot]=i.value; });

  async function commitField(input){
    var id=input.dataset.slot, val=input.value, f=fieldOf(id);
    if(val===last[id]) return;
    f.classList.remove('bad','saved');
    var res=await save(obj(id,val));
    if(!res.ok){ f.classList.add('bad'); f.querySelector('.err').textContent=res.errors.map(friendly).join(' '); input.value=last[id]; sendToBoard(id,last[id]); return; }
    last[id]=val; f.classList.add('saved'); setTimeout(function(){f.classList.remove('saved')},1500);
    var th=f.querySelector('[data-thumb]'); if(th) th.src=val;
    if(f.classList.contains('pic')||input.type==='url') pv.contentWindow.location.reload(); // attr slots re-render
  }
  function obj(k,v){ var o={}; o[k]=v; return o; }
  function sendToBoard(id,val){ try{ pv.contentWindow.postMessage({type:'vellum-set',slotId:id,value:val},'*'); }catch(e){} }

  document.getElementById('groups').addEventListener('input',function(e){
    var i=e.target; if(!i.dataset.slot||i.type==='url') return;
    sendToBoard(i.dataset.slot,i.value); // live preview while typing; saved on blur/enter
  });
  document.getElementById('groups').addEventListener('change',function(e){ if(e.target.dataset.slot) commitField(e.target); });
  document.getElementById('groups').addEventListener('keydown',function(e){
    if(e.key==='Enter'&&e.target.tagName==='INPUT'){ e.preventDefault(); e.target.blur(); }
  });
  document.getElementById('groups').addEventListener('focusin',function(e){ if(e.target.dataset.slot) try{pv.contentWindow.postMessage({type:'vellum-focus',slotId:e.target.dataset.slot},'*')}catch(x){} });
  document.getElementById('groups').addEventListener('focusout',function(e){ if(e.target.dataset.slot) try{pv.contentWindow.postMessage({type:'vellum-focus',slotId:null},'*')}catch(x){} });

  // picture upload -> hosted asset -> slot value
  document.getElementById('groups').addEventListener('change',async function(e){
    var up=e.target; if(!up.dataset.upload||!up.files||!up.files[0]) return;
    var id=up.dataset.upload,f=fieldOf(id),file=up.files[0];
    f.classList.remove('bad'); toast('Uploading…');
    try{
      var r=await fetch('/api/sites/'+SITE+'/assets',{method:'POST',headers:{'content-type':file.type},body:file});
      var d=await r.json(); if(!r.ok) throw new Error(d.error||'Upload failed');
      var inp=inputOf(id); inp.value=d.url; await commitField(inp); toast('Picture updated');
    }catch(err){ f.classList.add('bad'); f.querySelector('.err').textContent=err.message; }
    up.value='';
  });

  // taps on the board itself (inject.js) arrive here
  window.addEventListener('message',async function(e){
    if(!e.data||e.data.type!=='vellum-edit') return;
    var id=e.data.slotId,val=e.data.value,inp=inputOf(id),f=fieldOf(id);
    var res=await save(obj(id,val));
    if(!res.ok){ toast(res.errors.map(friendly).join(' ')); if(e.source) e.source.postMessage({type:'vellum-revert',slots:[id]},'*'); return; }
    if(inp){ inp.value=val; last[id]=val; } if(f){ f.classList.add('saved'); setTimeout(function(){f.classList.remove('saved')},1500); }
    toast('Saved');
  });

  // --- Put on TV ----------------------------------------------------------------
  window.publish=async function(){
    // commit any field still focused
    var a=document.activeElement; if(a&&a.dataset&&a.dataset.slot) await commitField(a);
    stateEl.classList.add('busy'); stMain.textContent='Putting it on the TV…'; stSub.textContent=''; pub.disabled=true;
    var r=await fetch('/api/sites/'+SITE+'/publish',{method:'POST'}); var d=await r.json().catch(function(){return {}});
    if(!r.ok){ toast('Could not publish: '+(d.error||r.status)); paint(); return; }
    toast('On the TV'); await refreshStatus();
  };

  // --- history ------------------------------------------------------------------
  function renderSnaps(list){
    var ul=document.getElementById('snaps');
    ul.innerHTML=list.length? list.map(function(s,i){
      return '<li>'+(i===0?'<span class="tag">on TV now</span>':'')+'<span>'+fmt(s.createdAt)+'</span><a class="muted" target="_blank" href="/sites/'+SITE+'/published/'+s.id+'">view</a></li>';
    }).join('') : '<li class="muted">Nothing has been put on the TV yet.</li>';
  }
  window.rasterizeNow=async function(){
    var el=document.getElementById('rzstatus'); el.textContent='Working…';
    var r=await fetch('/api/sites/'+SITE+'/rasterize',{method:'POST'}); var d=await r.json().catch(function(){return {}});
    el.textContent=r.ok? 'Done ('+d.width+'×'+d.height+')' : (d.error||'Failed.');
  };
  refreshStatus();

  window.copyLink=function(){ var i=document.getElementById('tvlink'); i.select(); try{ navigator.clipboard.writeText(i.value); }catch(e){ document.execCommand('copy'); } toast('Link copied'); };

${ai ? `  // --- owner-only AI ----------------------------------------------------------
  window.chat=async function(e){
    e.preventDefault();
    var input=document.getElementById('chatmsg'),out=document.getElementById('chatreply'),msg=input.value.trim(); if(!msg) return false;
    out.textContent='Thinking…';
    try{
      var r=await fetch('/api/sites/'+SITE+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:msg})});
      var d=await r.json();
      if(r.status===422){ out.textContent=(d.reply?d.reply+' — ':'')+'Rejected: '+(d.errors||[]).map(friendly).join('; '); return false; }
      if(!r.ok){ out.textContent='AI is not available right now ('+(d.error||r.status)+'). Use the fields above.'; return false; }
      var n=Object.keys(d.applied||{}).length;
      out.textContent=d.reply+(n?' ('+n+' field'+(n>1?'s':'')+' updated)':'');
      if(n){ input.value=''; location.reload(); }
    }catch(err){ out.textContent='AI is not available right now. Use the fields above.'; }
    return false;
  };
` : ''}
})();
</script>
</body></html>`;
}
