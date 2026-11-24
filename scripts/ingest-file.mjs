// Ingest a local HTML file as a new site (for local testing — the URL route's
// SSRF guard blocks local addresses). Usage:
//   node scripts/ingest-file.mjs <file.html> [name] [--keep-scripts]
import { readFileSync } from 'node:fs';
import { ingest } from '../src/ingest.js';
import * as store from '../src/storage.js';

const [file, name] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!file) { console.error('usage: ingest-file.mjs <file.html> [name] [--keep-scripts]'); process.exit(1); }
const keep = process.argv.includes('--keep-scripts');
const html = readFileSync(file, 'utf8');
const art = ingest(html, undefined, { stripScripts: !keep });
const meta = await store.createSite({ name: name || file, sourceUrl: `file:${file}`, ...art });
console.log(meta.id, `${art.slots.length} slots`);
