'use strict';
/**
 * TOTP / HOTP with node:crypto only.
 *
 *   RFC 4226 HOTP                      https://www.rfc-editor.org/rfc/rfc4226
 *   RFC 6238 TOTP                      https://www.rfc-editor.org/rfc/rfc6238
 *   RFC 4648 Base32                    https://www.rfc-editor.org/rfc/rfc4648
 *   Key Uri Format (otpauth://)        https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *
 * Defaults match every authenticator app: HMAC-SHA1, 6 digits, 30 second
 * steps, T0 = 0. Verification accepts ±1 step of clock drift and, through
 * `lastStep`, refuses to accept a step that was already used (replay).
 */
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 4226 §5.3: HMAC, dynamic truncation, modulo 10^digits. */
function hotp(secret, counter, { digits = 6, algorithm = 'sha1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const stepOf = (ms, period) => Math.floor(ms / 1000 / period);

/** RFC 6238: HOTP with the counter = floor((now - T0) / period). */
function totp(secret, { now = Date.now(), period = 30, digits = 6, algorithm = 'sha1' } = {}) {
  return hotp(secret, stepOf(now, period), { digits, algorithm });
}

/**
 * Verify a code. Returns the matching time step, or null.
 * `lastStep`: the step of the last accepted code; anything at or before it is refused (replay protection).
 */
function verifyTotp(secret, code, { now = Date.now(), period = 30, digits = 6, window = 1, lastStep = -1, algorithm = 'sha1' } = {}) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(c)) return null;
  const cur = stepOf(now, period);
  for (let d = -window; d <= window; d++) {
    const step = cur + d;
    if (step <= lastStep) continue;
    const expected = hotp(secret, step, { digits, algorithm });
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

function generateSecret(bytes = 20) { return crypto.randomBytes(bytes); }

/** otpauth://totp/<issuer>:<account>?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30 */
function otpauthUrl({ issuer, account, secret, digits = 6, period = 30, algorithm = 'SHA1' }) {
  const iss = String(issuer).replace(/:/g, ' ');
  const acc = String(account).replace(/:/g, ' ');
  // Percent-encoding (RFC 3986) throughout: URLSearchParams would write spaces as '+', which some apps show literally.
  const label = `${encodeURIComponent(iss)}:${encodeURIComponent(acc)}`;
  const q = Object.entries({ secret: base32Encode(secret), issuer: iss, algorithm, digits: String(digits), period: String(period) }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `otpauth://totp/${label}?${q}`;
}

module.exports = { base32Encode, base32Decode, hotp, totp, verifyTotp, generateSecret, otpauthUrl, stepOf };
