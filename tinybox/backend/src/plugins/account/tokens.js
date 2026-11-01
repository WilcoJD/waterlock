'use strict';
/**
 * Single-use "purpose" tokens: email verification, password reset, 2FA login
 * challenges, email-change confirmation. Each is a signed JWT (RFC 7519) that
 * carries `purpose` and a `jti`; the jti is also stored in `account_tokens`
 * so a token can be used only once, counted (wrong 2FA codes), expired early
 * or revoked in bulk. Session JWTs never carry `purpose`, and core auth
 * refuses any token that does, so a reset link can never act as a login.
 *
 *   RFC 7519                     https://www.rfc-editor.org/rfc/rfc7519
 *   OWASP Forgot Password Cheat Sheet https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../../provisioner');
const { toSql } = require('../../db');

const INVALID = () => new HttpError(400, 'This link is invalid or has expired', { code: 'TOKEN_INVALID' });

class PurposeTokens {
  constructor({ db, secret }) {
    this.db = db; this.secret = secret;
    this.q = {
      insert: db.prepare('INSERT INTO account_tokens (jti, user_id, purpose, expires_at, meta) VALUES (?,?,?,?,?)'),
      get: db.prepare('SELECT * FROM account_tokens WHERE jti=?'),
      use: db.prepare("UPDATE account_tokens SET used_at=datetime('now') WHERE jti=? AND used_at IS NULL"),
      fail: db.prepare('UPDATE account_tokens SET attempts=attempts+1 WHERE jti=?'),
      revokeAll: db.prepare("UPDATE account_tokens SET used_at=datetime('now') WHERE user_id=? AND purpose=? AND used_at IS NULL"),
      latest: db.prepare('SELECT * FROM account_tokens WHERE user_id=? AND purpose=? ORDER BY created_at DESC, rowid DESC LIMIT 1'),
      purge: db.prepare("DELETE FROM account_tokens WHERE expires_at < datetime('now','-1 day')"),
    };
  }

  /** issue({ userId, purpose, ttlMs, claims, meta, single }) -> { token, jti, expiresAt }. `single` revokes earlier tokens of the same purpose. */
  issue({ userId, purpose, ttlMs, claims = {}, meta = null, single = true }) {
    if (single) this.q.revokeAll.run(userId, purpose);
    const jti = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    const token = jwt.sign({ ...claims, sub: userId, purpose, jti }, this.secret, { expiresIn: Math.max(1, Math.ceil(ttlMs / 1000)) });
    this.q.insert.run(jti, userId, purpose, toSql(expiresAt), meta ? JSON.stringify(meta) : null);
    return { token, jti, expiresAt };
  }

  /** Validate without consuming. -> { payload, row }. Throws HttpError 400 TOKEN_INVALID. */
  peek(token, purpose, { maxAttempts = Infinity } = {}) {
    let payload;
    try { payload = jwt.verify(String(token || ''), this.secret); } catch { throw INVALID(); }
    if (!payload || payload.purpose !== purpose || !payload.jti) throw INVALID();
    const row = this.q.get.get(payload.jti);
    if (!row || row.used_at || row.purpose !== purpose) throw INVALID();
    if (new Date(row.expires_at.replace(' ', 'T') + 'Z') < new Date()) throw INVALID();
    if (row.attempts >= maxAttempts) throw INVALID();
    return { payload, row };
  }

  /** Validate and mark used. */
  consume(token, purpose, opts) {
    const r = this.peek(token, purpose, opts);
    const info = this.q.use.run(r.payload.jti);
    if (info.changes !== 1) throw INVALID(); // lost a race with a concurrent consume
    return r;
  }

  /** Count a failed attempt; returns attempts left (burns the token at zero). */
  fail(jti, maxAttempts) {
    this.q.fail.run(jti);
    const row = this.q.get.get(jti);
    const left = Math.max(0, maxAttempts - (row?.attempts || 0));
    if (left === 0) this.q.use.run(jti);
    return left;
  }

  revokeAll(userId, purpose) { return this.q.revokeAll.run(userId, purpose).changes; }
  latest(userId, purpose) { return this.q.latest.get(userId, purpose); }
  purge() { return this.q.purge.run().changes; }
}

module.exports = { PurposeTokens };
