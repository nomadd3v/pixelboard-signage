// Bespoke backdrop generation via codex (ChatGPT-sub image gen). Codex is a batch
// tool — minutes per image, agentic — so this NEVER runs in a request; the server
// calls it from an async job (kick -> poll -> attach). Generates a fresh,
// atmospheric, dark-center-safe image for a board's theme, normalizes it to the
// board's canvas, and saves it as a per-site asset (reusing the asset pipeline).
import { execFile } from 'node:child_process';
import { readdirSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAsset } from './storage.js';

const GEN_DIR = join(homedir(), '.codex', 'generated_images');

function walk(dir) {
  let out = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else out.push(p);
    }
  } catch { /* dir may not exist yet */ }
  return out;
}

// Demo-builder-derived prompt: atmospheric (not a literal scene), dark/text-safe
// center, no text/patterns. The single load-bearing rule is the dark center.
function backdropPrompt(theme) {
  return 'Generate a single atmospheric backdrop image for a digital-signage board.'
    + (theme ? ` Mood / theme: ${theme}.` : '')
    + ' Cinematic and photographic — light, texture, depth, bokeh, material — NOT a busy scene with a clear subject.'
    + ' CRITICAL: keep the CENTER and LOWER area very dark and low-contrast so white text stays readable on top;'
    + ' push any light or detail to the edges and corners.'
    + ' NO text, NO logos, NO faces, NO geometric patterns or grids, NO bright center. 16:9 landscape, dark, premium, restrained.';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1 << 26, killSignal: 'SIGKILL', ...opts }, (err) => {
      if (err && (err.killed || err.signal)) return reject(new Error(`${cmd} timed out`));
      if (err) return reject(new Error(`${cmd} failed: ${String(err.message).slice(0, 140)}`));
      resolve();
    });
  });
}

/**
 * Generate a bespoke backdrop and save it as a per-site asset.
 * @returns {Promise<string>} the asset URL (/sites/:id/assets/<file>)
 */
export async function generateBespokeBackdrop({ siteId, canvas, theme, timeoutMs = 300000 }) {
  const before = new Set(walk(GEN_DIR));
  await run('codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', backdropPrompt(theme)], { timeout: timeoutMs });
  // harvest by set-difference (never "newest globally" — other codex runs may interleave)
  const fresh = walk(GEN_DIR).filter((f) => !before.has(f) && /\.(png|jpe?g|webp)$/i.test(f));
  if (!fresh.length) throw new Error('codex produced no image');
  fresh.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const srcImg = fresh[0];
  // normalize to the board's canvas, then save through the asset pipeline
  const tmp = join(tmpdir(), `pb-bd-${siteId}-${statSync(srcImg).mtimeMs}.jpg`);
  await run('magick', [srcImg, '-resize', `${canvas.w}x${canvas.h}^`, '-gravity', 'center', '-extent', `${canvas.w}x${canvas.h}`, '-quality', '86', tmp]);
  const buf = readFileSync(tmp);
  try { unlinkSync(tmp); } catch { /* best-effort */ }
  const file = await saveAsset(siteId, buf, 'jpg');
  return `/sites/${siteId}/assets/${file}`;
}
