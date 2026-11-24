// PNG export: screenshot the offline bundle with headless Chrome. The bundle is
// self-contained, so Chrome renders it with networking disabled — nothing the
// page references can be fetched at render time. Local server only (needs a Chrome
// binary); on Vercel `chromePath()` is null and the route says so.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.PIXELBOARD_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function chromePath() {
  if (process.env.VERCEL) return null;
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

// Write `html` to a temp dir and run Chrome over it, networking blocked.
// `extra` is the output-mode flag (--screenshot=… / --dump-dom); resolves stdout.
async function runChrome(html, w, h, extra, dir) {
  const chrome = chromePath();
  if (!chrome) throw Object.assign(new Error('This needs Chrome (available on a local server, not on a serverless deploy).'), { status: 501 });
  const page = path.join(dir, 'board.html');
  await writeFile(page, html);
  return new Promise((resolve, reject) => {
    execFile(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--no-default-browser-check', '--mute-audio', `--user-data-dir=${path.join(dir, 'profile')}`,
      '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>', // block any network fetch
      `--window-size=${w},${h}`, '--force-device-scale-factor=1',
      '--virtual-time-budget=5000', extra, `file://${page}`,
    ], { timeout: 60000, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Chrome failed: ${(stderr || err.message).toString().slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

/** Render self-contained HTML to a w×h PNG buffer. */
export async function renderPng(html, w, h) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixelboard-png-'));
  try {
    const out = path.join(dir, 'board.png');
    await runChrome(html, w, h, `--screenshot=${out}`, dir);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Load HTML in a w×h window, let its scripts run, return the serialized DOM. */
export async function dumpDom(html, w, h) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixelboard-dom-'));
  try {
    return await runChrome(html, w, h, '--dump-dom', dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
