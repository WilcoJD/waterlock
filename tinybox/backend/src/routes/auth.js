'use strict';
/**
 * Core auth routes: register, login, me, change-password, logout.
 * Response shape is stable: `{ token, user }` (plus `email_verification` on
 * register) – or `{ two_factor: true, challenge }` when the account plugin
 * reports 2FA on, in which case the client calls POST /api/auth/2fa/verify.
 * Everything security-related (throttling, captcha, password policy, email
 * verification, sessions) is delegated to ctx.account when that plugin is
 * loaded; without it the routes behave like the original minimal version.
 *
 *   OWASP Authentication Cheat Sheet  https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
 *   bcryptjs                          https://github.com/dcodeIO/bcrypt.js
 */
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../provisioner');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Compared against when the email is unknown so a missing account takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(`no-such-user-${crypto.randomBytes(8).toString('hex')}`, 11);

module.exports = function authRoutes(ctx) {
  const { db, config, auth, hooks, events } = ctx;
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const me = (u) => auth.presentUser(u);
  const str = (v, max = 256) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
  const acct = () => ctx.account; // resolved lazily: plugins may be disabled

  function checkPassword(password, email) {
    const a = acct();
    if (a) return a.checkPassword(password, { email });
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters', { code: 'WEAK_PASSWORD' });
    if (password.length > 128) throw new HttpError(400, 'Password must be at most 128 characters', { code: 'WEAK_PASSWORD' });
  }

  /** Mint the login response. With the account plugin: sessions, login history, new-device events. */
  async function finishLogin(user, req, { method = 'password', runHooks = true } = {}) {
    const a = acct();
    if (a) return a.issueSession(user, req, { method, runHooks });
    const payload = { user: me(user), req, ip: req.ip, extra: {} };
    if (runHooks) { await hooks.run('auth.login.after', payload); events.emit('user.login', { user: me(user), ip: req.ip }); }
    return { token: auth.sign(user, { req, method }), user: me(user), ...payload.extra };
  }

  r.post('/register', limiter, async (req, res) => {
    const email = str(req.body.email, 320).trim().toLowerCase();
    const password = str(req.body.password, 1024);
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email', { code: 'VALIDATION' });
    checkPassword(password, email);
    if (acct()) await acct().beforeRegister(req, { email });               // captcha when configured
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Email already registered', { code: 'EMAIL_TAKEN' });
    await hooks.run('auth.register.before', { email, req, ip: req.ip });
    const hash = await bcrypt.hash(password, 11);
    const isAdmin = config.adminEmails.includes(email) ? 1 : 0;
    const info = db.prepare('INSERT INTO users (email, password_hash, is_admin) VALUES (?,?,?)').run(email, hash, isAdmin);
    const user = auth.loadUser(Number(info.lastInsertRowid));
    events.emit('user.registered', { user: me(user), ip: req.ip });
    const body = await finishLogin(user, req, { method: 'register', runHooks: false });
    const extra = acct() ? await acct().afterRegister(user, req) : {};  // verification mail (dev: token in response)
    res.status(201).json({ ...body, ...extra });
  });

  r.post('/login', limiter, async (req, res) => {
    const email = str(req.body.email, 320).trim().toLowerCase();
    const password = str(req.body.password, 1024);
    const a = acct();
    if (a) await a.beforeLogin(req, { email });                            // lockout + captcha
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const ok = (await bcrypt.compare(password, user && !user.deleted_at ? user.password_hash : DUMMY_HASH)) && !!user && !user.deleted_at;
    if (!ok) {
      const extra = a ? a.loginFailed(req, { email, user: user && !user.deleted_at ? user : null }) : {};
      return res.status(401).json({ error: 'Wrong email or password', ...extra });
    }
    if (user.banned) { a?.loginFailed(req, { email, user, reason: 'banned' }); return res.status(403).json({ error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' }); }
    if (user.locked) { a?.loginFailed(req, { email, user, reason: 'locked' }); return res.status(403).json({ error: 'Account locked. Contact support.', code: 'ACCOUNT_LOCKED' }); }
    if (a && user.must_reset_password) return res.status(403).json(await a.mustResetResponse(user, { ip: req.ip }));
    if (a && a.isTwoFactorEnabled(user.id)) {
      // Password accepted; the session is issued by POST /api/auth/2fa/verify.
      return res.json({ two_factor: true, challenge: a.createChallenge(user, req), methods: ['totp', 'backup'], expires_in: a.cfg.challengeTtlMin * 60 });
    }
    res.json(await finishLogin(user, req, { method: 'password' }));
  });

  r.get('/me', auth.requireAuth, (req, res) => res.json({ user: me(auth.loadUser(req.user.id) || req.user), auth: { via: req.auth?.via || 'session', ...(req.auth?.scopes ? { scopes: req.auth.scopes } : {}) } }));

  r.post('/change-password', auth.requireAuth, async (req, res) => {
    if (req.auth?.via !== 'session') throw new HttpError(403, 'Log in with your account to do this', { code: 'SESSION_REQUIRED' });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!(await bcrypt.compare(str(req.body.current, 1024), user.password_hash))) {
      acct()?.throttle.fail({ email: user.email, ip: req.ip, userId: user.id });
      return res.status(401).json({ error: 'Current password is wrong', code: 'BAD_PASSWORD' });
    }
    const next = str(req.body.password, 1024);
    checkPassword(next, user.email);
    if (await bcrypt.compare(next, user.password_hash)) throw new HttpError(400, 'Choose a password you have not used before', { code: 'WEAK_PASSWORD' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(next, 11), user.id);
    const extra = acct() ? acct().afterPasswordChange(user, req) : {};
    res.json({ ok: true, ...extra });
  });

  /** End the current session (no-op without the account plugin: stateless JWTs simply expire). */
  r.post('/logout', auth.requireAuth, (req, res) => {
    if (req.auth?.via !== 'session') throw new HttpError(400, 'API keys have no session to log out of', { code: 'SESSION_REQUIRED' });
    const a = acct();
    if (a && req.auth.jti) a.sessions.revoke(req.user.id, req.auth.jti, 'logout');
    res.json({ ok: true });
  });

  return r;
};
