'use strict';
/**
 * Small crypto helpers shared by the account plugin: AES-256-GCM for secrets
 * that must be recoverable (TOTP seeds, HMAC API secrets), keyed hashes for
 * secrets that only need comparing (backup codes, bearer API keys).
 *
 *   NIST SP 800-38D (GCM)        https://csrc.nist.gov/publications/detail/sp/800-38d/final
 *   Node crypto                   https://nodejs.org/api/crypto.html
 *   OWASP Password Storage        https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
const crypto = require('node:crypto');

class SecretBox {
  /** `secretKey` is any string; a 256-bit key is derived from it with HKDF so a short dev secret still works. */
  constructor(secretKey) {
    if (!secretKey) throw new Error('SecretBox needs a key');
    this.key = Buffer.from(crypto.hkdfSync('sha256', String(secretKey), 'tinybox-account', 'aes-256-gcm', 32));
    this.macKey = Buffer.from(crypto.hkdfSync('sha256', String(secretKey), 'tinybox-account', 'hmac-sha256', 32));
  }

  /** -> "v1:<iv b64url>:<ciphertext b64url>:<tag b64url>" */
  encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), 'utf8')), c.final()]);
    return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join(':');
  }

  decrypt(blob) {
    const [v, iv, ct, tag] = String(blob).split(':');
    if (v !== 'v1') throw new Error('Unknown ciphertext version');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]);
  }

  /** Keyed hash (HMAC-SHA256) for high-entropy secrets: a database dump alone cannot be used to brute-force them. */
  mac(value) { return crypto.createHmac('sha256', this.macKey).update(String(value)).digest('hex'); }

  /** Constant-time compare of two hex/base64 strings. */
  static equal(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { SecretBox, sha256, randomToken };
