'use strict';
/**
 * `account` plugin – account security:
 *   email verification, password reset + policy, TOTP two-factor auth with
 *   backup codes, revocable sessions + login history, brute-force lockout +
 *   captcha, API keys (bearer / HMAC) for trading bots, GDPR export, account
 *   deletion, email change, and the admin "Security" console.
 *
 * Exposed as ctx.account (see the `service` object below). Hooks it enforces:
 *   withdraw.before      verified email (configurable) + 2FA step-up code
 *   vpn.issue.before     2FA step-up code
 *   trade.before         verified email for perps/options (configurable)
 *   cloud.checkout.before verified email (configurable)
 *
 * References:
 *   RFC 6238 TOTP                       https://www.rfc-editor.org/rfc/rfc6238
 *   RFC 4226 HOTP                       https://www.rfc-editor.org/rfc/rfc4226
 *   Key Uri Format                      https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 *   OWASP Authentication Cheat Sheet    https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
 *   OWASP MFA Cheat Sheet               https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
 *   Cloudflare Turnstile siteverify     https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *   hCaptcha siteverify                 https://docs.hcaptcha.com/
 *   Binance / Kraken API signing        https://developers.binance.com/docs/binance-spot-api-docs/rest-api/endpoint-security-type
 *                                       https://docs.kraken.com/api/docs/guides/spot-rest-auth
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../../provisioner');
const totpLib = require('./totp');
const { checkPassword } = require('./passwords');
const { PurposeTokens } = require('./tokens');
const { Sessions } = require('./sessions');
const { LoginThrottle } = require('./throttle');
const { ApiKeys } = require('./apikeys');
const { Lifecycle } = require('./lifecycle');
const { Mailer } = require('./mail');
const { SecretBox } = require('./crypto');

const BACKUP_CODE_COUNT = 10;
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-' + crypto.randomBytes(8).toString('hex'), 10);

function newBackupCode() {
  const bytes = crypto.randomBytes(10);
  let s = ''; for (let i = 0; i < 10; i++) s += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
const normaliseBackup = (c) => String(c || '').toLowerCase().replace(/[\s-]/g, '');

module.exports = {
  name: 'account',
  web: [], // the browser side lives in the core module web/js/account.js

  schema: `
    CREATE TABLE IF NOT EXISTS sessions (
      jti TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      method TEXT NOT NULL DEFAULT 'password',      -- password|2fa|register|reset
      ip TEXT, user_agent TEXT, device TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      revoked_at TEXT, revoked_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, revoked_at);
    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, email TEXT, ip TEXT, user_agent TEXT, device TEXT,
      ok INTEGER NOT NULL, method TEXT, reason TEXT,
      new_device INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS login_history_user ON login_history(user_id, id);
    CREATE TABLE IF NOT EXISTS known_devices (
      user_id INTEGER NOT NULL, device TEXT NOT NULL, label TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, device)
    );
    CREATE TABLE IF NOT EXISTS login_throttle (
      key TEXT PRIMARY KEY,                        -- 'email:<email>' | 'ip:<ip>' | 'stepup:<email>' | '2fa:<email>'
      failures INTEGER NOT NULL DEFAULT 0, first_at TEXT, last_at TEXT, locked_until TEXT,
      lockouts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS account_tokens (     -- single-use purpose tokens (verify, reset, login-2fa, email-change)
      jti TEXT PRIMARY KEY, user_id INTEGER, purpose TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, used_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, meta TEXT
    );
    CREATE INDEX IF NOT EXISTS account_tokens_user ON account_tokens(user_id, purpose);
    CREATE TABLE IF NOT EXISTS user_totp (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      secret_enc TEXT NOT NULL,                    -- AES-256-GCM under ACCOUNT_SECRET_KEY
      enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), enabled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      code_hash TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS backup_codes_user ON backup_codes(user_id, used_at);
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
      key_id TEXT NOT NULL UNIQUE,                 -- pk_<16 hex>
      auth_mode TEXT NOT NULL DEFAULT 'hmac',      -- hmac (secret encrypted, both modes work) | bearer (secret hashed)
      secret_hash TEXT NOT NULL, secret_enc TEXT,
      label TEXT NOT NULL, scopes TEXT NOT NULL,   -- JSON array of read|trade|withdraw
      ip_allowlist TEXT,                           -- JSON array of IPs/CIDRs
      expires_at TEXT, last_used_at TEXT, last_used_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id, revoked_at);
  `,

  migrate(db, helpers = {}) {
    const addCols = helpers.addCols || ((t, defs) => {
      const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      for (const [c, d] of defs) if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
    });
    addCols('users', [
      ['email_verified', 'INTEGER NOT NULL DEFAULT 0'], ['locked', 'INTEGER NOT NULL DEFAULT 0'], ['locked_reason', 'TEXT'],
      ['must_reset_password', 'INTEGER NOT NULL DEFAULT 0'], ['pending_email', 'TEXT'], ['deleted_at', 'TEXT'], ['password_changed_at', 'TEXT'],
    ]);
  },

  config(env, { num, bool, list }) {
    const production = env.NODE_ENV === 'production';
    const strict = bool(env.ACCOUNT_STRICT, production);
    return {
      strict,
      devReturnTokens: bool(env.ACCOUNT_DEV_RETURN_TOKENS, !production),
      passwordPolicy: env.ACCOUNT_PASSWORD_POLICY || (strict ? 'strict' : 'legacy'),
      passwordMinLength: num(env.ACCOUNT_PASSWORD_MIN_LENGTH, 10),
      requireVerifiedFor: env.ACCOUNT_REQUIRE_VERIFIED_FOR !== undefined ? list(env.ACCOUNT_REQUIRE_VERIFIED_FOR) : (strict ? ['withdraw', 'derivatives', 'cloud'] : []),
      verifyTokenTtlHours: num(env.ACCOUNT_VERIFY_TTL_HOURS, 24),
      verifyResendCooldownSec: num(env.ACCOUNT_VERIFY_RESEND_COOLDOWN_SEC, 60),
      resetTokenTtlMin: num(env.ACCOUNT_RESET_TTL_MIN, 30),
      resetCooldownSec: num(env.ACCOUNT_RESET_COOLDOWN_SEC, 60),
      challengeTtlMin: num(env.ACCOUNT_2FA_CHALLENGE_TTL_MIN, 5),
      challengeMaxAttempts: num(env.ACCOUNT_2FA_CHALLENGE_ATTEMPTS, 5),
      sessionTtl: env.ACCOUNT_SESSION_TTL || '30d',
      sessionRetentionDays: num(env.ACCOUNT_SESSION_RETENTION_DAYS, 90),
      loginHistoryRetentionDays: num(env.ACCOUNT_LOGIN_HISTORY_DAYS, 365),
      maxFailuresPerEmail: num(env.ACCOUNT_MAX_FAILURES_EMAIL, 5),
      maxFailuresPerIp: num(env.ACCOUNT_MAX_FAILURES_IP, 30),
      failureWindowMin: num(env.ACCOUNT_FAILURE_WINDOW_MIN, 15),
      lockoutMin: num(env.ACCOUNT_LOCKOUT_MIN, 15),
      captcha: {
        provider: (env.ACCOUNT_CAPTCHA_PROVIDER || '').toLowerCase(),   // '' | turnstile | hcaptcha
        siteKey: env.ACCOUNT_CAPTCHA_SITE_KEY || '',
        secret: env.ACCOUNT_CAPTCHA_SECRET || '',
        afterFailures: num(env.ACCOUNT_CAPTCHA_AFTER_FAILURES, 3),
        onRegister: bool(env.ACCOUNT_CAPTCHA_ON_REGISTER, true),
      },
      secretKey: env.ACCOUNT_SECRET_KEY || '',       // encrypts TOTP seeds / HMAC API secrets; defaults to JWT_SECRET
      totpIssuer: env.ACCOUNT_TOTP_ISSUER || '',     // defaults to the brand name
      apiKeySkewSec: num(env.ACCOUNT_API_KEY_SKEW_SEC, 30),
      apiKeysPerUser: num(env.ACCOUNT_API_KEYS_PER_USER, 10),
    };
  },

  init(ctx) {
    const { db, config, hooks, events, audit, auth, log } = ctx;
    const cfg = config.account;
    if (process.env.NODE_ENV === 'production' && !cfg.secretKey && !config.jwtSecret) throw new Error('ACCOUNT_SECRET_KEY or JWT_SECRET is required');
    const box = new SecretBox(cfg.secretKey || config.jwtSecret);
    const tokens = new PurposeTokens({ db, secret: config.jwtSecret });
    const sessions = new Sessions({ db, config: cfg, events, log });
    const throttle = new LoginThrottle({ db, config: cfg, events, audit, log });
    const apiKeys = new ApiKeys({ db, config: cfg, audit, events, log, box });
    const mailer = new Mailer({ ctx });
    const lifecycle = new Lifecycle({ ctx, config: cfg, tokens, sessions, apiKeys, mailer });

    auth.useSessions(sessions);
    auth.addStrategy('api-key', (req) => apiKeys.authenticate(req, auth.loadUser));
    auth.addUserDecorator((u, out) => { out.two_factor = isTwoFactorEnabled(u.id); if (u.pending_email) out.pending_email = u.pending_email; });

    const q = {
      user: db.prepare('SELECT * FROM users WHERE id=?'),
      userByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
      totp: db.prepare('SELECT * FROM user_totp WHERE user_id=?'),
      totpEnabled: db.prepare('SELECT 1 FROM user_totp WHERE user_id=? AND enabled=1'),
      totpUpsert: db.prepare("INSERT INTO user_totp (user_id, secret_enc, enabled, last_step) VALUES (?,?,0,0) ON CONFLICT(user_id) DO UPDATE SET secret_enc=excluded.secret_enc, enabled=0, last_step=0, created_at=datetime('now'), enabled_at=NULL"),
      totpEnable: db.prepare("UPDATE user_totp SET enabled=1, enabled_at=datetime('now'), last_step=? WHERE user_id=?"),
      totpStep: db.prepare('UPDATE user_totp SET last_step=? WHERE user_id=? AND last_step < ?'),
      totpDelete: db.prepare('DELETE FROM user_totp WHERE user_id=?'),
      codesDelete: db.prepare('DELETE FROM backup_codes WHERE user_id=?'),
      codeInsert: db.prepare('INSERT INTO backup_codes (user_id, code_hash) VALUES (?,?)'),
      codeFind: db.prepare('SELECT id FROM backup_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL'),
      codeUse: db.prepare("UPDATE backup_codes SET used_at=datetime('now') WHERE id=? AND used_at IS NULL"),
      codesLeft: db.prepare('SELECT COUNT(*) n FROM backup_codes WHERE user_id=? AND used_at IS NULL'),
      setVerified: db.prepare('UPDATE users SET email_verified=1 WHERE id=?'),
      setPassword: db.prepare("UPDATE users SET password_hash=?, must_reset_password=0, password_changed_at=datetime('now') WHERE id=?"),
      setMustReset: db.prepare('UPDATE users SET must_reset_password=? WHERE id=?'),
    };

    const devTokens = (token) => (cfg.devReturnTokens ? { dev_token: token } : {});
    const ipOf = (req) => (req ? req.ip || null : null);
    let clock = () => Date.now();   // injectable for tests (TOTP steps)

    // ---------- helpers ----------
    function isTwoFactorEnabled(userId) { return !!q.totpEnabled.get(userId); }

    function requireVerified(user, action) {
      if (!cfg.requireVerifiedFor.includes(action)) return;
      const fresh = user && user.email_verified !== undefined ? user : q.user.get(user?.id);
      if (!fresh?.email_verified) throw new HttpError(403, 'Please verify your email address first', { code: 'EMAIL_UNVERIFIED', data: { action } });
    }

    function newBackupCodes(userId) {
      q.codesDelete.run(userId);
      const codes = [];
      for (let i = 0; i < BACKUP_CODE_COUNT; i++) { const c = newBackupCode(); codes.push(c); q.codeInsert.run(userId, box.mac(normaliseBackup(c))); }
      return codes;
    }

    /**
     * Verify a TOTP code or a backup code for a user. kind: 'stepup' | '2fa' (separate lockout counters).
     * Returns { method }. Throws 401 BAD_CODE or 429 LOCKED_OUT.
     */
    function verifySecondFactor(user, code, { kind = 'stepup', ip = null } = {}) {
      const row = q.totp.get(user.id);
      if (!row || !row.enabled) throw new HttpError(400, 'Two-factor authentication is not enabled', { code: 'TWO_FACTOR_OFF' });
      throttle.check({ email: user.email, kind });
      const raw = String(code || '').trim();
      if (/^\d{6}$/.test(raw.replace(/\s+/g, ''))) {
        const secret = box.decrypt(row.secret_enc);
        const step = totpLib.verifyTotp(secret, raw.replace(/\s+/g, ''), { lastStep: row.last_step, now: clock() });
        if (step !== null) { q.totpStep.run(step, user.id, step); throttle.succeed({ email: user.email, kind }); return { method: 'totp' }; }
      } else if (/^[a-z0-9]{10}$/i.test(normaliseBackup(raw))) {
        const hit = q.codeFind.get(user.id, box.mac(normaliseBackup(raw)));
        if (hit && q.codeUse.run(hit.id).changes === 1) {
          throttle.succeed({ email: user.email, kind });
          audit(user.id, 'account.backup_code.used', { left: q.codesLeft.get(user.id).n }, { targetId: user.id, ip });
          return { method: 'backup' };
        }
      }
      throttle.fail({ email: user.email, userId: user.id, kind });
      throw new HttpError(401, 'Wrong two-factor code', { code: 'BAD_CODE' });
    }

    /** Step-up: when the user has 2FA on, the request must carry a valid `x-2fa-code` header. API keys skip this (their scopes + IP allowlist stand in). */
    async function requireStepUp(req, { purpose = 'sensitive' } = {}) {
      if (!req?.user) throw new HttpError(401, 'Not logged in');
      if (req.auth?.via === 'api_key') return { method: 'api_key' };
      if (!isTwoFactorEnabled(req.user.id)) return { method: 'none' };
      const code = req.headers['x-2fa-code'];
      if (!code) throw new HttpError(401, 'Two-factor code required', { code: 'STEP_UP_REQUIRED', data: { purpose, reason: 'missing' } });
      try { return verifySecondFactor(req.user, String(code), { kind: 'stepup', ip: ipOf(req) }); }
      catch (e) {
        if (e.status === 429) throw e;
        throw new HttpError(401, 'Wrong two-factor code', { code: 'STEP_UP_REQUIRED', data: { purpose, reason: 'invalid' } });
      }
    }

    /** Finish a login: run the login hook, mint a session, record history, emit events. Returns the response body. */
    async function issueSession(user, req, { method = 'password', runHooks = true } = {}) {
      const u = auth.loadUser(user.id);
      const payload = { user: auth.presentUser(u), req, ip: ipOf(req), extra: {} };
      if (runHooks) await hooks.run('auth.login.after', payload);   // other plugins may veto or add fields
      const token = auth.sign(u, { req, method });
      sessions.recordLogin({ user: u, req, ok: true, method });
      throttle.succeed({ email: u.email });
      throttle.succeed({ email: u.email, kind: '2fa' });
      if (runHooks) events.emit('user.login', { user: payload.user, ip: ipOf(req), method });
      return { token, user: auth.presentUser(u), ...payload.extra };
    }

    // ---------- email verification ----------
    async function sendVerification(user, { force = false } = {}) {
      if (user.email_verified) throw new HttpError(400, 'Email is already verified', { code: 'ALREADY_VERIFIED' });
      const last = tokens.latest(user.id, 'verify');
      if (last && !force) {
        const age = (Date.now() - new Date(last.created_at.replace(' ', 'T') + 'Z').getTime()) / 1000;
        if (age < cfg.verifyResendCooldownSec) throw new HttpError(429, 'Please wait before requesting another email', { code: 'COOLDOWN', data: { retry_after: Math.ceil(cfg.verifyResendCooldownSec - age) } });
      }
      const { token } = tokens.issue({ userId: user.id, purpose: 'verify', ttlMs: cfg.verifyTokenTtlHours * 3600 * 1000, claims: { email: user.email } });
      const { sent } = await mailer.verifyEmail(user, token, cfg.verifyTokenTtlHours);
      return { sent, required: cfg.requireVerifiedFor.length > 0, ...devTokens(token) };
    }

    function verifyEmail(token, { ip = null } = {}) {
      const { payload } = tokens.consume(token, 'verify');
      const user = q.user.get(payload.sub);
      if (!user || user.deleted_at || user.email !== payload.email) throw new HttpError(400, 'This link is invalid or has expired', { code: 'TOKEN_INVALID' });
      if (!user.email_verified) {
        q.setVerified.run(user.id);
        audit(user.id, 'account.email_verified', { email: user.email }, { targetId: user.id, ip });
        events.emit('account.email_verified', { userId: user.id, email: user.email });
      }
      return auth.loadUser(user.id);
    }

    // ---------- password reset ----------
    async function requestPasswordReset(emailRaw, { ip = null } = {}) {
      const email = String(emailRaw || '').trim().toLowerCase();
      const user = q.userByEmail.get(email);
      if (!user || user.deleted_at) return {};                       // same response: no account enumeration
      const last = tokens.latest(user.id, 'reset');
      if (last && (Date.now() - new Date(last.created_at.replace(' ', 'T') + 'Z').getTime()) / 1000 < cfg.resetCooldownSec) return {};
      const { token } = tokens.issue({ userId: user.id, purpose: 'reset', ttlMs: cfg.resetTokenTtlMin * 60 * 1000 });
      audit(null, 'account.password_reset.requested', {}, { targetId: user.id, ip });
      mailer.passwordReset(user, token, cfg.resetTokenTtlMin).catch(() => {});   // not awaited: response time must not depend on mail delivery
      return devTokens(token);
    }

    async function confirmPasswordReset(token, password, { ip = null, req = null } = {}) {
      const { payload } = tokens.peek(token, 'reset');
      const user = q.user.get(payload.sub);
      if (!user || user.deleted_at) throw new HttpError(400, 'This link is invalid or has expired', { code: 'TOKEN_INVALID' });
      checkPassword(password, { email: user.email, policy: cfg.passwordPolicy, minLength: cfg.passwordMinLength });
      const hash = await bcrypt.hash(password, 11);
      tokens.consume(token, 'reset');
      q.setPassword.run(hash, user.id);
      sessions.revokeAll(user.id, { reason: 'password_reset' });
      tokens.revokeAll(user.id, 'login-2fa');
      throttle.clear({ email: user.email });
      audit(user.id, 'account.password_reset', {}, { targetId: user.id, ip });
      events.emit('account.password_reset', { userId: user.id, email: user.email, ip });
      if (user.locked && user.locked_reason === 'force_reset') db.prepare('UPDATE users SET locked=0, locked_reason=NULL WHERE id=?').run(user.id);
      return { ok: true };
    }

    /** After a normal password change: keep the current session, end every other one. */
    function afterPasswordChange(user, req) {
      db.prepare("UPDATE users SET password_changed_at=datetime('now') WHERE id=?").run(user.id);
      const n = sessions.revokeAll(user.id, { except: req.auth?.jti, reason: 'password_changed' });
      audit(user.id, 'account.password_changed', { other_sessions_revoked: n }, { targetId: user.id, ip: ipOf(req) });
      events.emit('account.password_changed', { userId: user.id, email: user.email, ip: ipOf(req), sessions_revoked: n });
      return { sessions_revoked: n };
    }

    /** Admin "force reset": the next login is refused until the user resets through email. */
    async function forcePasswordReset(user, { actorId, ip = null, reason = 'admin' } = {}) {
      q.setMustReset.run(1, user.id);
      sessions.revokeAll(user.id, { reason: 'force_reset' });
      const { token } = tokens.issue({ userId: user.id, purpose: 'reset', ttlMs: Math.max(cfg.resetTokenTtlMin, 60 * 24) * 60 * 1000 });
      const { sent } = await mailer.passwordReset(user, token, Math.max(cfg.resetTokenTtlMin, 60 * 24));
      audit(actorId ?? null, 'admin.user.force_reset', { reason }, { targetId: user.id, ip });
      return { sent, ...devTokens(token) };
    }
    /** Login found `must_reset_password`: (re)send a reset link and tell the client. */
    async function mustResetResponse(user, { ip = null } = {}) {
      const last = tokens.latest(user.id, 'reset');
      let dev = {};
      if (!last || last.used_at || (Date.now() - new Date(last.created_at.replace(' ', 'T') + 'Z').getTime()) / 1000 > cfg.resetCooldownSec) {
        const { token } = tokens.issue({ userId: user.id, purpose: 'reset', ttlMs: cfg.resetTokenTtlMin * 60 * 1000 });
        mailer.passwordReset(user, token, cfg.resetTokenTtlMin).catch(() => {});
        dev = devTokens(token);
      }
      return { error: 'You must choose a new password before logging in. We have emailed you a reset link.', code: 'PASSWORD_RESET_REQUIRED', ...(dev.dev_token ? { data: dev } : {}) };
    }

    // ---------- login pipeline (called from routes/auth.js) ----------
    async function beforeRegister(req, { email }) {
      if (throttle.captchaEnabled() && cfg.captcha.onRegister) await throttle.verifyCaptcha(req.body?.captcha_token, ipOf(req));
    }
    async function afterRegister(user, req) {
      try {
        const v = await sendVerification(user, { force: true });
        return { email_verification: v };
      } catch (e) { log.error?.('[account] verification mail failed:', e.message); return { email_verification: { sent: false } }; }
    }
    async function beforeLogin(req, { email }) {
      const ip = ipOf(req);
      throttle.check({ email, ip });
      if (throttle.needsCaptcha({ email, ip })) await throttle.verifyCaptcha(req.body?.captcha_token, ip);
    }
    /** Record a failed password attempt. Returns extra fields for the 401 body (captcha hint). */
    function loginFailed(req, { email, user = null, reason = 'bad_password' }) {
      const ip = ipOf(req);
      sessions.recordLogin({ user, userId: user?.id || null, email, req, ok: false, reason });
      throttle.fail({ email, ip, userId: user?.id || null });
      return throttle.needsCaptcha({ email, ip }) ? { code: 'CAPTCHA_REQUIRED', data: { provider: cfg.captcha.provider, site_key: cfg.captcha.siteKey } } : {};
    }
    function createChallenge(user, req) {
      const { token } = tokens.issue({ userId: user.id, purpose: 'login-2fa', ttlMs: cfg.challengeTtlMin * 60 * 1000, meta: { ip: ipOf(req) } });
      return token;
    }
    async function verifyChallenge(challenge, code, req) {
      const { payload } = tokens.peek(challenge, 'login-2fa', { maxAttempts: cfg.challengeMaxAttempts });
      const user = q.user.get(payload.sub);
      if (!user || user.deleted_at) throw new HttpError(400, 'This login attempt has expired, please log in again', { code: 'TOKEN_INVALID' });
      if (user.banned) throw new HttpError(403, 'Account suspended', { code: 'ACCOUNT_SUSPENDED' });
      if (user.locked) throw new HttpError(403, 'Account locked. Contact support.', { code: 'ACCOUNT_LOCKED' });
      let method;
      try { ({ method } = verifySecondFactor(user, code, { kind: '2fa', ip: ipOf(req) })); }
      catch (e) {
        if (e.status === 429) throw e;
        const left = tokens.fail(payload.jti, cfg.challengeMaxAttempts);
        sessions.recordLogin({ user, req, ok: false, method: '2fa', reason: 'bad_code' });
        throw new HttpError(401, left ? 'Wrong code' : 'Too many wrong codes, please log in again', { code: left ? 'BAD_CODE' : 'TOKEN_INVALID', data: { attempts_left: left } });
      }
      tokens.consume(challenge, 'login-2fa');
      return issueSession(user, req, { method: method === 'backup' ? '2fa-backup' : '2fa' });
    }

    // ---------- TOTP enrolment ----------
    async function totpSetup(user, { password } = {}, { ip = null } = {}) {
      const full = q.user.get(user.id);
      if (!(await bcrypt.compare(String(password || ''), full.password_hash))) { throttle.fail({ email: full.email, ip, userId: user.id }); throw new HttpError(401, 'Password is wrong', { code: 'BAD_PASSWORD' }); }
      if (isTwoFactorEnabled(user.id)) throw new HttpError(409, 'Two-factor authentication is already enabled', { code: 'TWO_FACTOR_ON' });
      const secret = totpLib.generateSecret(20);
      q.totpUpsert.run(user.id, box.encrypt(secret));
      const issuer = cfg.totpIssuer || config.brand || 'Platform';
      return { secret: totpLib.base32Encode(secret), otpauth_url: totpLib.otpauthUrl({ issuer, account: full.email, secret }), issuer, account: full.email, digits: 6, period: 30, algorithm: 'SHA1' };
    }
    function totpConfirm(user, code, { ip = null } = {}) {
      const row = q.totp.get(user.id);
      if (!row) throw new HttpError(400, 'Start the setup first', { code: 'NO_SETUP' });
      if (row.enabled) throw new HttpError(409, 'Two-factor authentication is already enabled', { code: 'TWO_FACTOR_ON' });
      throttle.check({ email: user.email, kind: 'stepup' });
      const step = totpLib.verifyTotp(box.decrypt(row.secret_enc), String(code || '').replace(/\s+/g, ''), { lastStep: -1, now: clock() });
      if (step === null) { throttle.fail({ email: user.email, userId: user.id, kind: 'stepup' }); throw new HttpError(401, 'Wrong code. Check the time on your phone and try again.', { code: 'BAD_CODE' }); }
      q.totpEnable.run(step, user.id);
      const codes = newBackupCodes(user.id);
      throttle.succeed({ email: user.email, kind: 'stepup' });
      audit(user.id, 'account.2fa.enabled', {}, { targetId: user.id, ip });
      events.emit('account.2fa_enabled', { userId: user.id, email: user.email, ip });
      return { enabled: true, backup_codes: codes };
    }
    async function totpDisable(user, { code, password } = {}, { ip = null, actorId = user.id, reason = 'user' } = {}) {
      if (actorId === user.id) {
        const full = q.user.get(user.id);
        if (!(await bcrypt.compare(String(password || ''), full.password_hash))) { throttle.fail({ email: full.email, ip, userId: user.id }); throw new HttpError(401, 'Password is wrong', { code: 'BAD_PASSWORD' }); }
        verifySecondFactor(user, code, { kind: 'stepup', ip });
      }
      if (!isTwoFactorEnabled(user.id)) throw new HttpError(400, 'Two-factor authentication is not enabled', { code: 'TWO_FACTOR_OFF' });
      q.totpDelete.run(user.id); q.codesDelete.run(user.id);
      audit(actorId, actorId === user.id ? 'account.2fa.disabled' : 'admin.user.2fa_disabled', { reason }, { targetId: user.id, ip });
      events.emit('account.2fa_disabled', { userId: user.id, email: user.email, by: actorId === user.id ? 'user' : 'admin', actorId, reason, ip });
      return { enabled: false };
    }
    function regenerateBackupCodes(user, { ip = null } = {}) {
      if (!isTwoFactorEnabled(user.id)) throw new HttpError(400, 'Two-factor authentication is not enabled', { code: 'TWO_FACTOR_OFF' });
      const codes = newBackupCodes(user.id);
      audit(user.id, 'account.backup_codes.regenerated', {}, { targetId: user.id, ip });
      return { backup_codes: codes };
    }
    function twoFactorStatus(userId) {
      const row = q.totp.get(userId);
      return { enabled: !!row?.enabled, enabled_at: row?.enabled ? row.enabled_at : null, pending_setup: !!row && !row.enabled, backup_codes_left: row?.enabled ? q.codesLeft.get(userId).n : 0 };
    }

    // ---------- hooks ----------
    hooks.on('withdraw.before', async ({ user, req }) => { requireVerified(user, 'withdraw'); await requireStepUp(req, { purpose: 'withdraw' }); });
    hooks.on('vpn.issue.before', async ({ req }) => { await requireStepUp(req, { purpose: 'vpn' }); });
    hooks.on('trade.before', ({ product, user }) => { if (product === 'perps' || product === 'options') requireVerified(user, 'derivatives'); });
    hooks.on('cloud.checkout.before', ({ user }) => { requireVerified(user, 'cloud'); });

    const service = {
      cfg, tokens, sessions, throttle, apiKeys, mailer, lifecycle, box,
      isTwoFactorEnabled, requireStepUp, verifySecondFactor, requireVerified, issueSession,
      checkPassword: (password, { email } = {}) => checkPassword(password, { email, policy: cfg.passwordPolicy, minLength: cfg.passwordMinLength }),
      sendVerification, verifyEmail,
      requestPasswordReset, confirmPasswordReset, afterPasswordChange, forcePasswordReset, mustResetResponse,
      beforeRegister, afterRegister, beforeLogin, loginFailed, createChallenge, verifyChallenge,
      totpSetup, totpConfirm, totpDisable, regenerateBackupCodes, twoFactorStatus,
      /** Tests / operators: replace the HTTP client used for captcha verification. */
      setFetch(fn) { throttle.fetch = fn; },
      /** Tests: replace the clock used for TOTP verification (fn -> ms). */
      setClock(fn) { clock = fn || (() => Date.now()); },
      /** Housekeeping: expired tokens/sessions/throttle rows. */
      purge() { return { tokens: tokens.purge(), sessions: sessions.purge(), throttle: throttle.purge() }; },
    };
    return service;
  },

  routes(app, ctx) {
    require('./routes')(app, ctx);
    require('./admin')(app, ctx);
  },

  jobs(ctx) {
    const t = setInterval(() => { try { ctx.account.purge(); } catch (e) { ctx.log.error?.('[account] purge failed', e.message); } }, 10 * 60 * 1000);
    t.unref?.();
    return () => clearInterval(t);
  },

  site(ctx) {
    const c = ctx.config.account;
    return {
      account: {
        password_min_length: c.passwordPolicy === 'legacy' ? 8 : Math.max(8, c.passwordMinLength),
        password_policy: c.passwordPolicy,
        require_verified_for: c.requireVerifiedFor,
        captcha: c.captcha?.provider && c.captcha?.siteKey ? { provider: c.captcha.provider, site_key: c.captcha.siteKey, on_register: !!c.captcha.onRegister } : null,
        two_factor: true, api_keys: true, dev_return_tokens: !!c.devReturnTokens,
      },
    };
  },
};
