#!/usr/bin/env node
// Convert ingested sites into studio-editable copies (local server only — needs Chrome).
//   npm run convert -- <siteId> [WxH]     one site
//   npm run convert -- --all              every site that has no board yet
import * as store from '../src/storage.js';
import { convertSite } from '../src/board/convert.js';

const [arg, size] = process.argv.slice(2);
if (!arg) { console.error('usage: convert-site.mjs <siteId> [WxH] | --all'); process.exit(2); }
const canvas = size ? (([w, h]) => ({ w: Number(w), h: Number(h) }))(size.split('x')) : undefined;

const ids = arg === '--all'
  ? (await Promise.all((await store.listSites()).map(async (s) => ((await store.getBoard(s.id)) ? null : s.id)))).filter(Boolean)
  : [arg];
if (!ids.length) console.log('nothing to convert — every site already has a board');
for (const id of ids) {
  try {
    const { site, board, warnings } = await convertSite(id, store, { canvas });
    console.log(`${id} -> ${site.id}  "${site.name}"  ${board.elements.length} elements, ${board.elements.filter((e) => e.slot?.editable).length} editable`);
    for (const w of warnings) console.log('  ! ' + w);
  } catch (e) {
    console.error(`${id} FAILED: ${e.message}`);
    process.exitCode = 1;
  }
}
