// Auth primitives: password hashing (scrypt), signed session tokens (HMAC),
// and cookie parse/serialize. See docs/adrs/ADR-002-auth-and-client-sessions.md.

import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const KEYLEN = 32;

// --- session signing secret -------------------------------------------------
let SECRET = process.env.VELLUM_SESSION_SECRET || '';
if (!SECRET) {
  SECRET = randomBytes(32).toString('hex');
  console.warn(
    'VELLUM_SESSION_SECRET unset — using an ephemeral secret. ' +
    'Sessions will not survive a restart. Set it for production.',
  );
}

// --- passwords --------------------------------------------------------------

/** Hash a password with a fresh random salt. Returns hex {salt, hash}. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N }).toString('hex');
  return { salt, hash };
}

/** Constant-time verify a password against a stored {salt, hash}. */
export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  let derived;
  try {
    derived = scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N });
  } catch {
    return false;
  }
  const stored = Buffer.from(hash, 'hex');
  return derived.length === stored.length && timingSafeEqual(derived, stored);
}

// --- signed tokens ----------------------------------------------------------

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url');

function hmac(data) {
  return createHmac('sha256', SECRET).update(data).digest();
}

/** Sign a payload object into a `<body>.<sig>` token. */
export function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(body));
  return `${body}.${sig}`;
}

/** Verify + decode a token. Returns the payload, or null if invalid/expired. */
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(hmac(body));
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function makeSession({ sid, role }) {
  return signToken({ sid, role, exp: Date.now() + SESSION_TTL_MS });
}

// --- cookies ----------------------------------------------------------------

/** Parse a Cookie header into a flat object. Never throws on junk input. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(raw);
    } catch {
      out[k] = raw; // malformed percent-encoding: keep verbatim, don't 500
    }
  }
  return out;
}

// Set Secure in production / HTTPS deployments so the session cookie never
// rides plaintext. Off for localhost dev.
const SECURE_COOKIES = process.env.VELLUM_SECURE_COOKIES === '1'
  || process.env.NODE_ENV === 'production';

/** Serialize a Set-Cookie value. maxAge in seconds; 0 clears. */
export function serializeCookie(name, value, { maxAge } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (SECURE_COOKIES) c += '; Secure';
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  return c;
}

export const SITE_COOKIE = (id) => `vsess_${id}`;
export const OWNER_COOKIE = 'vsess_owner';
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
