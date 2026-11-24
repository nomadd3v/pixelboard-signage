#!/usr/bin/env node
// Smoke-test server for the built demo — models the production host:
//   /work/pixelboard            -> 308 to /work/pixelboard/
//   /work/pixelboard/<file>     -> the file, if it exists (filesystem first)
//   /work/pixelboard/<other>    -> index.html (SPA fallback, like the Vercel rewrite)
//   anything else               -> 404
// Usage: PORT=<leased port> node src/demo/serve.mjs [dir]   (binds 127.0.0.1)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.argv[2] || '/tmp/bb-demos/pixelboard');
const BASE = '/work/pixelboard/';
const PORT = Number(process.env.PORT);
if (!PORT) { console.error('PORT is required (lease one with rez port allocate)'); process.exit(1); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === BASE.slice(0, -1)) { res.writeHead(308, { location: BASE + url.search }); return res.end(); }
  if (!p.startsWith(BASE)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const file = path.join(DIR, path.normalize(p.slice(BASE.length)).replace(/^(\.\.[/\\])+/, ''));
  let body, type;
  try {
    if (!file.startsWith(DIR) || !(await stat(file)).isFile()) throw new Error('fallback');
    body = await readFile(file); type = TYPES[path.extname(file)] || 'application/octet-stream';
  } catch {
    body = await readFile(path.join(DIR, 'index.html')); type = TYPES['.html'];
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`demo on :${PORT}${BASE} (serving ${DIR})`));
