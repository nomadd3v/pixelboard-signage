// CLI helper: ingest a LOCAL HTML file into a running Pixelboard.
//
//   npm run ingest -- ./menu.html
//   npm run ingest -- ./menu.html --name "Taco Tuesday"
//   npm run ingest -- ./menu.html --base https://origin.example/   # if it has relative assets
//
// Posts the file's raw bytes to POST /api/sites/ingest-file — the same pipeline
// the dashboard's "Ingest local HTML file" button uses. No browser, no fetch of
// a remote URL. Env:
//   PIXELBOARD_URL   base url of the running server (default http://localhost:3006)
//   VELLUM_MASTER_KEY  owner key, if the server has one set

import { readFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') out.name = argv[++i];
    else if (a === '--base' || a === '-b') out.base = argv[++i];
    else if (a === '--url' || a === '-u') out.url = argv[++i];
    else if (a === '--key' || a === '-k') out.key = argv[++i];
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const file = args._[0];
if (!file) {
  console.error('Usage: npm run ingest -- <file.html> [--name "Client"] [--base https://origin/]');
  process.exit(1);
}

const serverUrl = (args.url || process.env.PIXELBOARD_URL || 'http://localhost:3006').replace(/\/$/, '');
const key = args.key || process.env.VELLUM_MASTER_KEY || '';
const name = args.name || path.basename(file).replace(/\.html?$/i, '');

let html;
try {
  html = await readFile(file);
} catch (e) {
  console.error(`Cannot read ${file}: ${e.message}`);
  process.exit(1);
}

const q = new URLSearchParams({ name });
if (args.base) q.set('baseUrl', args.base);

const headers = { 'content-type': 'text/html' };
if (key) headers['x-vellum-key'] = key;

let res;
try {
  res = await fetch(`${serverUrl}/api/sites/ingest-file?${q}`, { method: 'POST', headers, body: html });
} catch (e) {
  console.error(`Could not reach Pixelboard at ${serverUrl} — is the dev server running?  (${e.message})`);
  process.exit(1);
}

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Ingest failed (${res.status}): ${data.error || 'unknown error'}`);
  process.exit(1);
}

const editUrl = `${serverUrl}/sites/${data.site.id}/edit`;
console.log(`✓ Ingested "${data.site.name}" — ${data.slotCount} editable slots`);
console.log(`  site id: ${data.site.id}`);
console.log(`  edit:    ${editUrl}`);
console.log(`  kiosk:   ${serverUrl}/sites/${data.site.id}/display`);
