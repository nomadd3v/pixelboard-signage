import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword, verifyPassword,
  signToken, verifyToken, makeSession,
  parseCookies, serializeCookie,
} from '../src/auth.js';

// --- passwords --------------------------------------------------------------

test('password hash verifies the right password and rejects the wrong one', () => {
  const { salt, hash } = hashPassword('hunter2');
  assert.equal(verifyPassword('hunter2', salt, hash), true);
  assert.equal(verifyPassword('wrong', salt, hash), false);
});

test('password hashing is salted (same password -> different hash)', () => {
  const a = hashPassword('same');
  const b = hashPassword('same');
  assert.notEqual(a.hash, b.hash);
  assert.notEqual(a.salt, b.salt);
});

test('verifyPassword tolerates malformed stored material', () => {
  assert.equal(verifyPassword('x', '', ''), false);
  assert.equal(verifyPassword('x', 'abc', 'zzzz'), false);
});

// --- tokens -----------------------------------------------------------------

test('signed token round-trips its payload', () => {
  const t = signToken({ sid: 'site1', role: 'client' });
  const p = verifyToken(t);
  assert.equal(p.sid, 'site1');
  assert.equal(p.role, 'client');
});

test('tampered token is rejected', () => {
  const t = signToken({ sid: 'site1', role: 'client' });
  const [body] = t.split('.');
  // forge a new signature attempt by swapping the body, keep sig
  const forged = `${Buffer.from(JSON.stringify({ sid: 'site1', role: 'owner' })).toString('base64url')}.${t.split('.')[1]}`;
  assert.equal(verifyToken(forged), null);
  assert.equal(verifyToken(body), null); // missing sig
  assert.equal(verifyToken('garbage'), null);
});

test('expired session token is rejected', () => {
  const expired = signToken({ sid: 's', role: 'client', exp: Date.now() - 1000 });
  assert.equal(verifyToken(expired), null);
  const fresh = makeSession({ sid: 's', role: 'client' });
  assert.ok(verifyToken(fresh));
});

// --- cookies ----------------------------------------------------------------

test('cookie parse/serialize round-trip', () => {
  const c = serializeCookie('vsess_abc', 'tok.en', { maxAge: 60 });
  assert.match(c, /^vsess_abc=tok\.en; Path=\/; HttpOnly; SameSite=Lax; Max-Age=60$/);
  const parsed = parseCookies('vsess_abc=tok.en; other=1');
  assert.equal(parsed.vsess_abc, 'tok.en');
  assert.equal(parsed.other, '1');
});
