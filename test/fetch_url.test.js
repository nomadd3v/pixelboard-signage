import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertSafeHost } from '../src/fetch_url.js';

// The SSRF guard is applied to the initial URL AND to every redirect hop, so a
// 3xx can never bounce the fetch onto a blocked target. These exercise the
// per-hop check directly (DNS makes full redirect-loop testing flaky).

test('assertSafeHost rejects loopback / private / link-local / metadata literals', async () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://[::1]/',
  ];
  for (const u of blocked) {
    await assert.rejects(assertSafeHost(new URL(u)), /private\/loopback/, `should block ${u}`);
  }
});

test('assertSafeHost rejects non-http(s) protocols', async () => {
  await assert.rejects(assertSafeHost(new URL('file:///etc/passwd')), /http\(s\)/);
  await assert.rejects(assertSafeHost(new URL('ftp://example.com/')), /http\(s\)/);
});

test('assertSafeHost allows a public host', async () => {
  // 1.1.1.1 is a stable public literal — no DNS, no network call from the check.
  await assert.doesNotReject(assertSafeHost(new URL('https://1.1.1.1/')));
});
