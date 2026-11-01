'use strict';
/**
 * Brute-force protection for login, 2FA and step-up codes, plus optional
 * captcha verification (Cloudflare Turnstile or hCaptcha).
 *
 * Counters are kept per email and per IP in SQLite so they survive restarts
 * and are shared between processes. Lockouts escalate (doubling, capped) and
 * a successful login only clears the per-email counter: an attacker cannot
 * reset the per-IP counter by logging into their own account.
 *
 *   OWASP Authentication Cheat Sheet (Account Lockout)  https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
 *   OWASP Blocking Brute Force Attacks                  https://owasp.org/www-community/controls/Blocking_Brute_Force_Attacks
 *   Turnstile server-side validation  https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *   hCaptcha siteverify               https://docs.hcaptcha.com/#verify-the-user-response-server-side
 */
const { HttpError } = require('../../provisioner');
const { toSql } = require('../../db');

const CAPTCHA_ENDPOINTS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
};
const MAX_LOCKOUT_MS = 24 * 3600 * 1000;

class LoginThrottle {
  constructor({ db, config, events, audit, log, fetch = globalThis.fetch }) {
    this.db = db; this.cfg = config; this.events = events; this.audit = audit; this.log = log; this.fetch = fetch;
    this.q = {
      get: db.prepare('SELECT * FROM login_throttle WHERE key=?'),
      upsert: db.prepare(`INSERT INTO login_throttle (key, failures, first_at, last_at, locked_until, lockouts) VALUES (?,?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, first_at=excluded.first_at, last_at=excluded.last_at, locked_until=excluded.locked_until, lockouts=excluded.lockouts`),
      del: db.prepare('DELETE FROM login_throttle WHERE key=?'),
      locked: db.prepare("SELECT * FROM login_throttle WHERE locked_until IS NOT NULL AND locked_until > datetime('now') ORDER BY locked_until DESC LIMIT 200"),
      purge: db.prepare("DELETE FROM login_throttle WHERE (locked_until IS NULL OR locked_until < datetime('now')) AND last_at < datetime('now', ?)"),
    };
  }

  static keys(kind, value) { return `${kind}:${String(value || '').toLowerCase().slice(0, 200)}`; }

  _row(key) {
    const r = this.q.get.get(key);
    if (!r) return { key, failures: 0, first_at: null, last_at: null, locked_until: null, lockouts: 0 };
    // Failures outside the observation window no longer count.
    const windowMs = (this.cfg.failureWindowMin || 15) * 60 * 1000;
    const last = r.last_at ? new Date(r.last_at.replace(' ', 'T') + 'Z').getTime() : 0;
    if (Date.now() - last > windowMs && !(r.locked_until && new Date(r.locked_until.replace(' ', 'T') + 'Z') > new Date())) r.failures = 0;
    return r;
  }

  lockedUntil(key) {
    const r = this.q.get.get(key);
    if (!r || !r.locked_until) return null;
    const until = new Date(r.locked_until.replace(' ', 'T') + 'Z');
    return until > new Date() ? until : null;
  }

  /** Throws 429 when the email or the IP is currently locked out. `kind` other than 'login' checks that counter (e.g. 'stepup', '2fa'). */
  check({ email, ip, kind = 'login' }) {
    const keys = kind === 'login' ? [email && LoginThrottle.keys('email', email), ip && LoginThrottle.keys('ip', ip)] : [email && LoginThrottle.keys(kind, email)];
    for (const key of keys.filter(Boolean)) {
      const until = this.lockedUntil(key);
      if (until) {
        const secs = Math.max(1, Math.ceil((until - Date.now()) / 1000));
        throw new HttpError(429, `Too many failed attempts. Try again in ${secs >= 60 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`}.`, { code: 'LOCKED_OUT', data: { retry_after: secs } });
      }
    }
  }

  failures({ email, ip }) {
    return Math.max(email ? this._row(LoginThrottle.keys('email', email)).failures : 0, ip ? this._row(LoginThrottle.keys('ip', ip)).failures : 0);
  }

  /** Register a failure on each key; locks a key when it reaches its limit. Returns { locked: [keys] }. */
  fail({ email, ip, userId = null, kind = 'login' }) {
    const locked = [];
    const now = new Date();
    const targets = [];
    if (email) targets.push([LoginThrottle.keys(kind === 'login' ? 'email' : kind, email), this.cfg.maxFailuresPerEmail || 5]);
    if (ip && kind === 'login') targets.push([LoginThrottle.keys('ip', ip), this.cfg.maxFailuresPerIp || 30]);
    for (const [key, max] of targets) {
      const r = this._row(key);
      const failures = r.failures + 1;
      let lockedUntil = r.locked_until, lockouts = r.lockouts || 0;
      if (failures >= max) {
        lockouts += 1;
        const ms = Math.min(MAX_LOCKOUT_MS, (this.cfg.lockoutMin || 15) * 60 * 1000 * 2 ** (lockouts - 1));
        lockedUntil = toSql(new Date(now.getTime() + ms));
        locked.push(key);
        this.audit?.(null, 'account.lockout', { key, failures, lockouts, until: lockedUntil, kind }, { targetId: userId, ip });
        this.events?.emit('account.lockout', { key, email: key.startsWith('email:') ? email : null, ip, userId, failures, until: lockedUntil, kind });
      }
      this.q.upsert.run(key, failures >= max ? 0 : failures, r.failures === 0 ? toSql(now) : r.first_at || toSql(now), toSql(now), lockedUntil, lockouts);
    }
    return { locked };
  }

  /** Clear the per-email counter after a successful login (the IP counter is deliberately left alone). */
  succeed({ email, kind = 'login' }) { if (email) this.q.del.run(LoginThrottle.keys(kind === 'login' ? 'email' : kind, email)); }
  /** Admin unlock: clears every counter for this email, and an IP if given. */
  clear({ email, ip, key }) {
    if (key) this.q.del.run(String(key));
    if (email) { this.q.del.run(LoginThrottle.keys('email', email)); this.q.del.run(LoginThrottle.keys('stepup', email)); this.q.del.run(LoginThrottle.keys('2fa', email)); }
    if (ip) this.q.del.run(LoginThrottle.keys('ip', ip));
  }
  status(email) {
    const r = this._row(LoginThrottle.keys('email', email));
    return { failures: r.failures, locked_until: this.lockedUntil(r.key)?.toISOString() || null, lockouts: r.lockouts || 0 };
  }
  lockouts() { return this.q.locked.all(); }
  purge() { return this.q.purge.run(`-${Math.max(1, this.cfg.failureWindowMin || 15) * 4} minutes`).changes; }

  // ---- captcha ----
  captchaEnabled() { const p = this.cfg.captcha?.provider; return !!(p && CAPTCHA_ENDPOINTS[p] && this.cfg.captcha?.secret); }
  /** Login needs a captcha once an email or IP has `captcha.afterFailures` recent failures. */
  needsCaptcha({ email, ip }) {
    if (!this.captchaEnabled()) return false;
    return this.failures({ email, ip }) >= (this.cfg.captcha.afterFailures ?? 3);
  }

  /** Verify a captcha token server-side. Throws 400 CAPTCHA_REQUIRED / CAPTCHA_FAILED. */
  async verifyCaptcha(token, ip) {
    if (!this.captchaEnabled()) return true;
    const provider = this.cfg.captcha.provider;
    if (!token || typeof token !== 'string' || token.length > 4096) throw new HttpError(400, 'Please complete the captcha', { code: 'CAPTCHA_REQUIRED', data: { provider, site_key: this.cfg.captcha.siteKey } });
    const body = new URLSearchParams({ secret: this.cfg.captcha.secret, response: token });
    if (ip) body.set('remoteip', ip);
    if (provider === 'hcaptcha' && this.cfg.captcha.siteKey) body.set('sitekey', this.cfg.captcha.siteKey);
    let json;
    try {
      const res = await this.fetch(CAPTCHA_ENDPOINTS[provider], { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: AbortSignal.timeout(8000) });
      json = await res.json();
    } catch (e) {
      this.log?.error?.('[account] captcha verification unavailable:', e.message);
      throw new HttpError(503, 'Captcha verification is temporarily unavailable', { code: 'CAPTCHA_UNAVAILABLE' });
    }
    if (!json || json.success !== true) throw new HttpError(400, 'Captcha verification failed, please try again', { code: 'CAPTCHA_FAILED', data: { errors: json?.['error-codes'] || [] } });
    return true;
  }
}

module.exports = { LoginThrottle, CAPTCHA_ENDPOINTS };
