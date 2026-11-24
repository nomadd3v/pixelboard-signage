#!/usr/bin/env node
// Build the PUBLIC STATIC DEMO of Pixelboard — served flat at /work/pixelboard/.
//
//   npm run build:demo                      -> /tmp/bb-demos/pixelboard/
//   DEMO_OUT_DIR=/some/dir npm run build:demo
//
// Nothing here touches `npm start` / the server: this script only READS src/,
// public/ and node_modules/ and writes to the output dir. What it does:
//   1. Parity: compiles every fictional seed board with the real node:crypto AND
//      with the browser sha256 shim; fails unless the artifacts are identical.
//   2. Bundles src/demo/main.js with esbuild (minified, no sourcemaps, no
//      comments). The engine (compile/guardian/render/ingest/backdrops) and
//      src/studio/studio.js are bundled unchanged; the only source rewrite is the
//      one scrub below, which fails the build if it stops matching.
//   3. Asserts the bundle's input list against an ALLOWLIST — so src/ai.js,
//      server.js, storage.js, auth.js, templates.js, data/ etc. provably never
//      ship.
//   4. Copies only the assets the demo references (stripping JPEG/PNG metadata),
//      writes self-hosted fonts + generated placeholder photos, then scans every
//      output byte for forbidden tokens .

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.env.DEMO_OUT_DIR || '/tmp/bb-demos/pixelboard');
const BASE = '/work/pixelboard/';
const r = (...p) => path.join(ROOT, ...p);
const fail = (msg) => { console.error('\n✗ build:demo — ' + msg); process.exit(1); };

if (OUT === ROOT || OUT.startsWith(ROOT + path.sep)) fail(`refusing to write inside the repo (${OUT})`);

// ---- source scrubs (anchored; each must match or the build fails) ----------
const SCRUBS = [
  // studio.js falls back to a root-absolute brand image; re-root it under the demo base.
  { file: 'src/studio/studio.js', from: "'/branding/logomark-512.png'", to: JSON.stringify(BASE + 'branding/logomark-512.png'), min: 1 },
  // the (demo-unreachable) 503 branch of the AI handler names the server's env vars; say what's true here instead.
  { file: 'src/studio/studio.js', from: "'AI not configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.'", to: "'AI generation is off in this static demo.'", min: 1 },
];

// ---- bundle allowlist --------------------------------------------------------
const ALLOW = [
  /^src\/demo\//,
  /^src\/(guardian|render|ids|ingest|backdrops)\.js$/,
  /^src\/board\/(compile|schema)\.js$/,
  /^src\/studio\/studio\.js$/,
  /^node_modules\/fabric\/dist\/index\.min\.mjs$/,
  /^node_modules\/(cheerio|cheerio-select|htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|css-select|css-what|boolbase|nth-check)\//,
  /^virtual:/,
  /^<define:__PB_[A-Z_]+__>$/,
];
const DENY = [/src\/(ai|server|storage|auth|fetch_url|bespoke_backdrop|templates|pages|tags)\.js$/, /^data\//, /@anthropic-ai/, /node_modules\/express\//, /\.env/];

// ---- forbidden tokens: fail fast -----
const FORBIDDEN = [/sk-/i, /eyJ/, /sk-ant/i, /OPENROUTER/i, /ANTHROPIC_API_KEY/, /\/home\//, /localhost:/i];

// =============================================================================
// 1. sha256-shim parity on the full compileBoard() artifact
// =============================================================================
async function parity() {
  const alias = {
    name: 'parity-alias',
    setup(b) { b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: r('src/demo/shims/node-crypto.js') })); },
  };
  const tmp = path.join(OUT + '.parity');
  mkdirSync(tmp, { recursive: true });
  const entry = path.join(tmp, 'entry.mjs');
  writeFileSync(entry, `export { compileBoard } from ${JSON.stringify(r('src/board/compile.js'))};\nexport { validateBoard } from ${JSON.stringify(r('src/board/schema.js'))};\nexport { SEEDS } from ${JSON.stringify(r('src/demo/seeds.js'))};\nexport { sha256Hex, createHash } from ${JSON.stringify(r('src/demo/shims/node-crypto.js'))};\n`);
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'shim.mjs'), plugins: [alias], logLevel: 'silent' });
  const shim = await import(pathToFileURL(path.join(tmp, 'shim.mjs')).href);
  const real = await import(pathToFileURL(r('src/board/compile.js')).href);
  const schema = await import(pathToFileURL(r('src/board/schema.js')).href);

  let boards = 0;
  for (const seed of shim.SEEDS) {
    for (const look of Object.keys(seed.looks)) {
      const board = seed.build(BASE, look);
      const v = schema.validateBoard(board);
      if (!v.ok) fail(`seed ${seed.id}/${look} fails validateBoard: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
      const a = JSON.stringify(real.compileBoard(board));
      const b = JSON.stringify(shim.compileBoard(board));
      if (a !== b) fail(`sha256 shim parity FAILED for ${seed.id}/${look} — slot ids diverge`);
      boards++;
    }
  }
  const corpus = ['', 'a', 'é漢字🙂', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000), 'special-photo|src'];
  for (const s of corpus) {
    if (shim.createHash('sha256').update(s).digest('hex') !== createHash('sha256').update(s).digest('hex')) fail(`sha256 shim digest mismatch on ${JSON.stringify(s.slice(0, 20))}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ sha256 shim parity: ${boards} seed boards compile to identical artifacts; ${corpus.length} digest vectors match`);
}

// =============================================================================
// 2. bundle
// =============================================================================
const demoPlugin = {
  name: 'pixelboard-demo',
  setup(b) {
    const applied = new Map();
    b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: r('src/demo/shims/node-crypto.js') }));
    b.onResolve({ filter: /^\/vendor\/fabric\/index\.min\.mjs$/ }, () => ({ path: r('node_modules/fabric/dist/index.min.mjs') }));
    b.onResolve({ filter: /^cheerio$/ }, () => ({ path: r('node_modules/cheerio/dist/browser/slim.js') }));
    b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => {
      if (a.path === 'virtual:editor-inject') {
        return { loader: 'js', contents: `export const INJECT_CSS = ${JSON.stringify(readFileSync(r('src/editor/inject.css'), 'utf8'))};\nexport const INJECT_JS = ${JSON.stringify(readFileSync(r('src/editor/inject.js'), 'utf8'))};` };
      }
      if (a.path === 'virtual:studio-css') {
        const css = readFileSync(r('src/studio/studio.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        if (/url\(/.test(css)) fail('studio.css gained a url() — re-root it under the demo base before shipping');
        return { loader: 'js', contents: `export const STUDIO_CSS = ${JSON.stringify(css)};` };
      }
      return null;
    });
    b.onLoad({ filter: /\.js$/ }, (a) => {
      const rel = path.relative(ROOT, a.path).split(path.sep).join('/');
      const mine = SCRUBS.filter((s) => s.file === rel);
      if (!mine.length) return null;
      let code = readFileSync(a.path, 'utf8');
      for (const s of mine) {
        const n = code.split(s.from).length - 1;
        if (n < s.min) fail(`scrub no longer matches in ${s.file}: ${s.from}`);
        code = code.split(s.from).join(s.to);
        applied.set(s, n);
      }
      return { contents: code, loader: 'js' };
    });
    b.onEnd(() => { for (const s of SCRUBS) if (!applied.has(s)) fail(`scrub never ran: ${s.file}`); });
  },
};

async function bundle(skipBackdrops) {
  const res = await build({
    absWorkingDir: ROOT,
    entryPoints: { app: 'src/demo/main.js' },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022', 'chrome100', 'safari15', 'firefox100'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
    outdir: path.join(OUT, 'assets'),
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: '[name]-[hash]',
    publicPath: BASE + 'assets/',
    define: { __PB_BASE__: JSON.stringify(BASE), __PB_BACKDROP_SKIP__: JSON.stringify(skipBackdrops) },
    plugins: [demoPlugin],
    metafile: true,
    logLevel: 'warning',
  });
  const inputs = Object.keys(res.metafile.inputs);
  const denied = inputs.filter((i) => DENY.some((d) => d.test(i)));
  const unlisted = inputs.filter((i) => !ALLOW.some((a) => a.test(i)));
  if (denied.length || unlisted.length) fail(`bundle input allowlist violated:\n  denied: ${denied.join(', ') || '-'}\n  not allowlisted: ${unlisted.join(', ') || '-'}`);
  console.log(`✓ bundle inputs allowlisted (${inputs.length}): ${[...new Set(inputs.map((i) => i.replace(/^node_modules\/([^/]+)\/.*/, 'node_modules/$1/*')))].join(', ')}`);
  const outs = Object.keys(res.metafile.outputs).map((o) => path.relative(OUT, path.resolve(ROOT, o)));
  const entryJs = outs.find((o) => /^assets\/app-[^/]+\.js$/.test(o));
  const entryCss = outs.find((o) => /^assets\/app-[^/]+\.css$/.test(o));
  if (!entryJs || !entryCss) fail('could not find entry js/css in esbuild outputs');
  return { entryJs, entryCss };
}

// =============================================================================
// 3. assets
// =============================================================================
/** Drop PNG text/time chunks (generator timestamps etc.). */
function stripPng(buf) {
  const sig = buf.subarray(0, 8);
  const parts = [sig];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const end = o + 12 + len;
    if (!['tEXt', 'iTXt', 'zTXt', 'tIME', 'eXIf'].includes(type)) parts.push(buf.subarray(o, end));
    o = end;
  }
  return Buffer.concat(parts);
}
/** Drop JPEG APP1..APP15 (EXIF/XMP/IPTC) and COM segments; keep JFIF + image data. */
function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) fail('not a JPEG');
  const parts = [buf.subarray(0, 2)];
  let o = 2;
  while (o < buf.length) {
    if (buf[o] !== 0xff) fail('corrupt JPEG segment');
    const marker = buf[o + 1];
    if (marker === 0xda) { parts.push(buf.subarray(o)); break; } // start of scan: rest is image data
    const len = buf.readUInt16BE(o + 2);
    const keep = !((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe);
    if (keep) parts.push(buf.subarray(o, o + 2 + len));
    o += 2 + len;
  }
  return Buffer.concat(parts);
}
function copyStripped(src, dst) {
  mkdirSync(path.dirname(dst), { recursive: true });
  const buf = readFileSync(src);
  if (/\.png$/i.test(src)) writeFileSync(dst, stripPng(buf));
  else if (/\.jpe?g$/i.test(src)) writeFileSync(dst, stripJpeg(buf));
  else copyFileSync(src, dst);
}

/** Backdrops: the whole (AI-generated, abstract) library, metadata-stripped. A JPEG
 *  whose compressed bytes happen to contain a leak-gate pattern (e.g. the 3 bytes
 *  "sk-") is left out rather than shipped — the demo's picker skips it. */
async function backdrops() {
  const { BACKDROPS } = await import(pathToFileURL(r('src/backdrops.js')).href);
  const skip = [];
  for (const b of BACKDROPS) {
    const buf = stripJpeg(readFileSync(r('public', b.file)));
    const hit = FORBIDDEN.find((re) => re.test(buf.toString('latin1')));
    if (hit) { skip.push(b.file); console.log(`  - skipping ${b.file}: compressed bytes match ${hit} by chance`); continue; }
    mkdirSync(path.dirname(path.join(OUT, b.file)), { recursive: true });
    writeFileSync(path.join(OUT, b.file), buf);
  }
  console.log(`✓ backdrops: ${BACKDROPS.length - skip.length}/${BACKDROPS.length} shipped (metadata stripped)`);
  return skip;
}

async function assets() {
  // brand chrome actually referenced by the demo
  for (const f of ['wordmark-dark.svg', 'logomark-512.png', 'layers/icon-text.svg', 'layers/icon-image.svg', 'layers/icon-rect.svg', 'layers/icon-ai-sparkle.svg']) {
    copyStripped(r('public/branding', f), path.join(OUT, 'branding', f));
  }
  // generated placeholder photos
  const { PHOTOS } = await import(pathToFileURL(r('src/demo/photos.js')).href);
  mkdirSync(path.join(OUT, 'photos'), { recursive: true });
  for (const p of PHOTOS) writeFileSync(path.join(OUT, 'photos', `${p.key}.svg`), p.svg);

  // fonts: self-hosted replacements for the Google Fonts <link> in FONT_LINKS,
  // plus any self-hosted @font-face rules FONT_LINKS already carries (/fonts/*.ttf)
  const FONTS = [
    ['Inter', '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', '100 900'],
    ['Fraunces', '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', '100 900'],
    ['Playfair Display', '@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2', '400 900'],
    ['Oswald', '@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2', '200 700'],
    ['Space Grotesk', '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', '300 700'],
    ['JetBrains Mono', '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2', '100 800'],
    ['Bebas Neue', '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2', '400'],
    ['Anton', '@fontsource/anton/files/anton-latin-400-normal.woff2', '400'],
    ['Archivo Black', '@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2', '400'],
  ];
  mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  let css = '/* self-hosted (OFL-1.1, via @fontsource) */\n';
  for (const [family, file, weight] of FONTS) {
    const name = family.toLowerCase().replace(/\s+/g, '-') + '.woff2';
    copyFileSync(r('node_modules', file), path.join(OUT, 'fonts', name));
    css += `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${weight};src:url('${BASE}fonts/${name}') format('woff2')}\n`;
  }
  const { FONT_LINKS } = await import(pathToFileURL(r('src/board/schema.js')).href);
  for (const m of FONT_LINKS.matchAll(/@font-face\{[^}]*?url\('\/fonts\/([^']+)'\)[^}]*\}/g)) {
    const file = m[1];
    if (!existsSync(r('public/fonts', file))) fail(`FONT_LINKS references /fonts/${file} but public/fonts/ lacks it`);
    copyFileSync(r('public/fonts', file), path.join(OUT, 'fonts', file));
    css += m[0].replace(`url('/fonts/${file}')`, `url('${BASE}fonts/${file}')`) + '\n';
  }
  if (!/fonts\.googleapis\.com/.test(FONT_LINKS)) console.warn('  (FONT_LINKS no longer uses Google Fonts — self-hosted set may be redundant)');
  writeFileSync(path.join(OUT, 'fonts', 'fonts.css'), css);
  return PHOTOS.length;
}

function indexHtml({ entryJs, entryCss }) {
  const fav = readFileSync(r('public/favicon.svg'), 'utf8').trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pixelboard · interactive demo</title>
<meta name="description" content="Interactive demo of Pixelboard — design a digital-signage board, hand it to staff, and watch the Guardian refuse every edit that would break it.">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(fav)}">
<link rel="stylesheet" href="${BASE}fonts/fonts.css">
<link rel="stylesheet" href="${BASE}${entryCss}">
<script type="module" src="${BASE}${entryJs}"></script>
</head>
<body>
<div id="app"><p style="padding:2rem;color:#8d8d99;font:15px system-ui">Loading the Pixelboard demo…</p></div>
<noscript><p style="padding:2rem;color:#ececf1;font:15px system-ui">This interactive demo needs JavaScript.</p></noscript>
</body>
</html>
`;
}

// =============================================================================
// 4. output scan
// =============================================================================
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
function scan() {
  const hits = [];
  const files = walk(OUT);
  for (const f of files) {
    const txt = readFileSync(f).toString('latin1');
    for (const re of FORBIDDEN) if (re.test(txt)) hits.push(`${path.relative(OUT, f)}: ${re}`);
  }
  if (hits.length) fail('forbidden tokens in output:\n  ' + hits.join('\n  '));
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  console.log(`✓ output scan: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB, 0 forbidden-token hits`);
}

// =============================================================================
await parity();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const skip = await backdrops();
const entry = await bundle(skip);
const nPhotos = await assets();
writeFileSync(path.join(OUT, 'index.html'), indexHtml(entry));
scan();
console.log(`✓ demo built -> ${OUT}  (base ${BASE}, ${nPhotos} generated photos)`);
