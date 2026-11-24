// Demo build only: the REAL engine modules, re-exported for the browser demo.
// guardian / render / compileBoard / validateBoard / ingest are imported
// unchanged from src/. The only demo-specific step is font delivery: the
// compiled template's <head> carries FONT_LINKS (Google Fonts + /fonts/*.ttf);
// the demo swaps that block for one self-hosted stylesheet under the demo base
// so a published board makes no third-party requests.

import { compileBoard } from '../board/compile.js';
import { validateBoard, FONT_LINKS, FONT_PRIMARY, FONT_STACKS } from '../board/schema.js';
import { guardian } from '../guardian.js';
import { render } from '../render.js';
import { slotId, SENTINEL_OPEN, SENTINEL_CLOSE } from '../ids.js';
import { applyBackdrop, removeBackdrop, backdropByFile, listBackdrops, pickBackdrop, tagsForBoard } from '../backdrops.js';

export const BASE = __PB_BASE__;
export const DEMO_FONT_LINKS = `<link rel="stylesheet" href="${BASE}fonts/fonts.css">`;

/** compileBoard(), with the head font block pointed at the self-hosted copy. */
export function compile(board) {
  const artifact = compileBoard(board);
  if (!artifact.template.includes(FONT_LINKS)) throw new Error('compiled template no longer carries FONT_LINKS verbatim');
  artifact.template = artifact.template.replace(FONT_LINKS, DEMO_FONT_LINKS);
  return artifact;
}

// Library files the build left out (see backdrops() in build.mjs) — never offered.
const SKIP = new Set(__PB_BACKDROP_SKIP__);
const shipped = () => listBackdrops().filter((b) => !SKIP.has(b.file));
const reroot = (b) => ({ ...b, file: BASE + b.file.replace(/^\//, '') });

/** Backdrop library, with file paths re-rooted under the demo base. */
export const demoBackdrops = () => shipped().map(reroot);
/** Whitelist check for a (demo-based) backdrop path -> the library entry, re-rooted. */
export function demoBackdropByFile(file) {
  const rel = String(file).startsWith(BASE) ? '/' + String(file).slice(BASE.length) : String(file);
  const bd = SKIP.has(rel) ? null : backdropByFile(rel);
  return bd ? reroot(bd) : null;
}
export function demoPickBackdrop(tags) {
  const bd = pickBackdrop(tags, shipped());
  return bd ? reroot(bd) : null;
}

export {
  guardian, render, validateBoard, compileBoard, slotId, FONT_PRIMARY, FONT_STACKS,
  SENTINEL_OPEN, SENTINEL_CLOSE, applyBackdrop, removeBackdrop, tagsForBoard,
};
