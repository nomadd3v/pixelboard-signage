// SSRF-guarded URL fetch for the ingest engine. The blueprint omits this; the
// engine fetches arbitrary operator-supplied URLs, so block private/loopback/
// link-local targets and metadata endpoints before connecting.
//
// v0.1 limitation: resolve-then-fetch has a DNS-rebinding TOCTOU window. The
// dashboard is master-key gated and single-operator, so this is accepted for
// now; a pinned-IP agent is the follow-up.

import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB ceiling

function isBlockedV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // this-host
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isBlockedV6(ip) {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true; // loopback / unspecified
  if (v.startsWith('fe80')) return true; // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local
  if (v.startsWith('::ffff:')) return isBlockedV4(v.split(':').pop()); // v4-mapped
  return false;
}

function isBlockedIp(ip) {
  return net.isIPv6(ip) ? isBlockedV6(ip) : isBlockedV4(ip);
}

const MAX_REDIRECTS = 5;

/**
 * Validate a single URL hop: http(s) only, host must not resolve to a
 * private/loopback/link-local/metadata target. Throws on any violation.
 * Called for the initial URL AND for every redirect hop, so a 3xx can never
 * bounce the fetch to a blocked address.
 */
export async function assertSafeHost(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs may be ingested.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // WHATWG URL keeps brackets on IPv6 literals
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('Refusing to fetch a private/loopback address.');
    return;
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('Could not resolve host.');
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new Error('Host resolves to a private/loopback address.');
  }
}

/** SSRF-guarded GET (every redirect hop re-checked). Returns the final Response. */
async function guardedGet(rawUrl, accept) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL.');
  }

  // Follow redirects manually so each hop is re-checked against the SSRF guard.
  let res;
  for (let hop = 0; ; hop++) {
    await assertSafeHost(url);
    try {
      res = await fetch(url, {
        redirect: 'manual', // we follow hops ourselves and re-validate each one
        headers: { 'User-Agent': 'Vellum-Ingest/0.1', Accept: accept },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new Error(`Could not reach ${url.hostname}: ${e.cause?.message || e.message}`);
    }
    if (res.status < 300 || res.status >= 400) break; // not a redirect
    const location = res.headers.get('location');
    if (!location) break; // 3xx with no target — treat as final, let status check handle it
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (>${MAX_REDIRECTS}).`);
    try {
      url = new URL(location, url); // resolve relative Location against current hop
    } catch {
      throw new Error('Upstream sent an invalid redirect target.');
    }
  }
  return res;
}

async function readCapped(res, maxBytes, what) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${what} exceeds ${Math.round(maxBytes / 1048576)} MB limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Fetch a page's HTML with SSRF + size guards. Returns the body string. */
export async function fetchHtml(rawUrl) {
  const res = await guardedGet(rawUrl, 'text/html,*/*');
  if (!res.ok) throw new Error(`Upstream returned ${res.status}.`);
  const ctype = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/i.test(ctype)) {
    throw new Error(`Expected HTML, got "${ctype || 'unknown'}".`);
  }
  return (await readCapped(res, MAX_BYTES, 'Page')).toString('utf8');
}

/** Fetch any asset (css/font/image) with the same guards. Returns { buffer, type }. */
export async function fetchAsset(rawUrl, maxBytes = 20 * 1024 * 1024) {
  const res = await guardedGet(rawUrl, '*/*');
  if (!res.ok) throw new Error(`${rawUrl} returned ${res.status}.`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  return { buffer: await readCapped(res, maxBytes, 'Asset'), type };
}
