'use strict';
/**
 * User-facing routes of the account plugin.
 *
 *   /api/auth/*      extras next to the core login/register: 2FA challenge, email verification, password reset
 *   /api/account/*   security overview, 2FA enrolment, sessions, login history, API keys, export, delete, email change
 *
 * Every object is scoped to req.user; admin views live in ./admin.js.
 *   OWASP REST Security Cheat Sheet   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
 *   express-rate-limit                https://github.com/express-rate-limit/express-rate-limit
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../../provisioner');

module.exports = function accountRoutes(app, ctx) {
  const { db, auth, account } = ctx;
  if (!account) return;
  const { sessions, apiKeys, lifecycle, tokens, cfg } = account;

  const ipLimit = (limit, windowMs = 15 * 60 * 1000) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false });
  const userLimit = (limit, windowMs = 15 * 60 * 1000) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `u:${req.user.id}` });
  const ip = (req) => req.ip || null;
  const str = (v, max = 512) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
  /** Session-only: API keys may never manage the account that owns them. */
  const sessionOnly = (req, res, next) => (req.auth?.via === 'session' ? next() : next(new HttpError(403, 'Log in with your account to do this', { code: 'SESSION_REQUIRED' })));
  const fullUser = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  async function checkPasswordOf(req) {
    const u = fullUser(req.user.id);
    if (!(await bcrypt.compare(str(req.body.password, 256), u.password_hash))) {
      account.throttle.fail({ email: u.email, ip: ip(req), userId: u.id });
      throw new HttpError(401, 'Password is wrong', { code: 'BAD_PASSWORD' });
    }
    return u;
  }

  // ======================= /api/auth extras =======================
  const a = express.Router();

  // Second step of a 2FA login: { challenge, code } -> { token, user }
  a.post('/2fa/verify', ipLimit(30), async (req, res) => {
    const challenge = str(req.body.challenge, 2048), code = str(req.body.code, 64);
    if (!challenge || !code) throw new HttpError(400, 'challenge and code are required', { code: 'VALIDATION' });
    res.json(await account.verifyChallenge(challenge, code, req));
  });

  a.post('/verify-email', ipLimit(30), (req, res) => {
    const user = account.verifyEmail(str(req.body.token, 2048), { ip: ip(req) });
    res.json({ ok: true, user: auth.presentUser(user) });
  });
  a.post('/verify-email/resend', auth.requireAuth, sessionOnly, userLimit(6), async (req, res) => {
    res.json({ ok: true, ...(await account.sendVerification(fullUser(req.user.id))) });
  });

  a.post('/password-reset/request', ipLimit(10), async (req, res) => {
    const email = str(req.body.email, 254).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email', { code: 'VALIDATION' });
    if (account.throttle.captchaEnabled() && cfg.captcha.onRegister) await account.throttle.verifyCaptcha(req.body.captcha_token, ip(req));
    const r = await account.requestPasswordReset(email, { ip: ip(req) });
    res.json({ ok: true, message: 'If that email belongs to an account, a reset link is on its way.', ...r });
  });
  a.post('/password-reset/confirm', ipLimit(15), async (req, res) => {
    res.json(await account.confirmPasswordReset(str(req.body.token, 2048), str(req.body.password, 256), { ip: ip(req), req }));
  });
  /** Check a reset/verify token without using it (so the page can show a clear error before the form). */
  a.post('/token-info', ipLimit(60), (req, res) => {
    const purpose = str(req.body.purpose, 32);
    if (!['reset', 'verify', 'email-change'].includes(purpose)) throw new HttpError(400, 'Unknown purpose', { code: 'VALIDATION' });
    const { payload, row } = tokens.peek(str(req.body.token, 2048), purpose);
    res.json({ ok: true, purpose, expires_at: row.expires_at, email: payload.email ? String(payload.email).replace(/^(.).*(@.*)$/, '$1***$2') : undefined });
  });
  app.use('/api/auth', a);

  // ======================= /api/account =======================
  const r = express.Router();
  r.get('/time', (req, res) => res.json({ now: Date.now(), iso: new Date().toISOString() }));
  r.post('/email/confirm', ipLimit(30), (req, res) => {
    const user = lifecycle.confirmEmailChange(str(req.body.token, 2048), { ip: ip(req) });
    res.json({ ok: true, user: auth.presentUser(auth.loadUser(user.id)) });
  });

  r.use(auth.requireAuth, sessionOnly);

  r.get('/security', (req, res) => {
    const u = fullUser(req.user.id);
    const tf = account.twoFactorStatus(u.id);
    res.json({
      user: auth.presentUser(u),
      email_verified: !!u.email_verified, pending_email: u.pending_email || null,
      verification_required_for: cfg.requireVerifiedFor,
      two_factor: tf,
      sessions: sessions.count(u.id), api_keys: apiKeys.list(u.id).filter((k) => !k.revoked_at).length,
      password_changed_at: u.password_changed_at, last_login: sessions.lastLogin(u.id) || null,
      password_policy: { min_length: cfg.passwordPolicy === 'legacy' ? 8 : Math.max(8, cfg.passwordMinLength), policy: cfg.passwordPolicy },
    });
  });

  // ---- two-factor ----
  r.get('/2fa', (req, res) => res.json(account.twoFactorStatus(req.user.id)));
  r.post('/2fa/setup', userLimit(10), async (req, res) => res.json(await account.totpSetup(req.user, { password: str(req.body.password, 256) }, { ip: ip(req) })));
  r.post('/2fa/confirm', userLimit(15), (req, res) => res.json(account.totpConfirm(req.user, str(req.body.code, 16), { ip: ip(req) })));
  r.post('/2fa/disable', userLimit(10), async (req, res) => res.json(await account.totpDisable(req.user, { code: str(req.body.code, 32), password: str(req.body.password, 256) }, { ip: ip(req) })));
  r.post('/2fa/backup-codes', userLimit(5, 60 * 60 * 1000), async (req, res) => {
    await account.requireStepUp(req, { purpose: 'backup_codes' });
    res.json(account.regenerateBackupCodes(req.user, { ip: ip(req) }));
  });

  // ---- sessions & login history ----
  r.get('/sessions', (req, res) => res.json({ sessions: sessions.list(req.user.id, req.auth.jti) }));
  r.delete('/sessions/:id', (req, res) => {
    const id = str(req.params.id, 64);
    if (!sessions.revoke(req.user.id, id, 'user')) throw new HttpError(404, 'Session not found', { code: 'NOT_FOUND' });
    ctx.audit(req.user.id, 'account.session.revoked', { jti: id.slice(0, 8) }, { targetId: req.user.id, ip: ip(req) });
    res.json({ ok: true, current: id === req.auth.jti });
  });
  r.post('/sessions/revoke-all', (req, res) => {
    const includeCurrent = req.body.include_current === true;
    const n = sessions.revokeAll(req.user.id, { except: includeCurrent ? null : req.auth.jti, reason: 'logout_everywhere' });
    ctx.audit(req.user.id, 'account.sessions.revoked_all', { count: n, include_current: includeCurrent }, { targetId: req.user.id, ip: ip(req) });
    res.json({ ok: true, revoked: n });
  });
  r.get('/login-history', (req, res) => res.json({ history: sessions.history(req.user.id, req.query.limit) }));

  // ---- API keys ----
  r.get('/api-keys', (req, res) => res.json({ keys: apiKeys.list(req.user.id), scopes: ['read', 'trade', 'withdraw'] }));
  r.post('/api-keys', userLimit(20, 60 * 60 * 1000), async (req, res) => {
    await account.requireStepUp(req, { purpose: 'api_key' });
    const b = req.body || {};
    const out = apiKeys.create(req.user.id, { label: b.label, scopes: b.scopes, ip_allowlist: b.ip_allowlist, expires_in_days: b.expires_in_days, auth_mode: b.auth_mode }, { ip: ip(req) });
    res.status(201).json(out);
  });
  r.delete('/api-keys/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !apiKeys.revoke(req.user.id, id, { ip: ip(req) })) throw new HttpError(404, 'API key not found', { code: 'NOT_FOUND' });
    res.json({ ok: true });
  });

  // ---- data & lifecycle ----
  r.get('/export', userLimit(5, 60 * 60 * 1000), async (req, res) => {
    const data = await lifecycle.exportData(req.user.id);
    ctx.audit(req.user.id, 'account.exported', {}, { targetId: req.user.id, ip: ip(req) });
    if (req.query.download !== undefined) res.setHeader('content-disposition', `attachment; filename="account-${req.user.id}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  });
  r.get('/delete/check', async (req, res) => res.json({ blockers: await lifecycle.deletionBlockers(req.user.id) }));
  r.post('/delete', userLimit(5, 60 * 60 * 1000), async (req, res) => {
    const u = await checkPasswordOf(req);
    await account.requireStepUp(req, { purpose: 'delete_account' });
    if (str(req.body.confirm, 64) !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm', { code: 'VALIDATION' });
    if (u.is_admin) throw new HttpError(403, 'Admin accounts cannot self-delete; ask another admin to remove the admin role first', { code: 'ADMIN_ACCOUNT' });
    res.json(await lifecycle.deleteAccount(u, { ip: ip(req) }));
  });
  r.post('/email/change', userLimit(5, 60 * 60 * 1000), async (req, res) => {
    const u = await checkPasswordOf(req);
    await account.requireStepUp(req, { purpose: 'email_change' });
    res.json(await lifecycle.requestEmailChange(u, req.body.new_email, { ip: ip(req) }));
  });

  app.use('/api/account', r);
};
