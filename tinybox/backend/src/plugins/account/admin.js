'use strict';
/**
 * Admin "Security" console API: /api/admin/security/*
 * Search users, lock/unlock, force password reset, disable 2FA (support
 * flow), inspect sessions / login history / API keys, revoke them, read the
 * audit log filtered by user. Every action is audited with the admin as actor
 * and the user as target; account-takeover-grade actions (disable 2FA, force
 * reset) additionally require the admin's own 2FA step-up when they have it.
 *
 *   OWASP Authorization Cheat Sheet  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
 */
const express = require('express');
const { HttpError } = require('../../provisioner');

module.exports = function adminSecurityRoutes(app, ctx) {
  const { db, auth, account, audit } = ctx;
  if (!account) return;
  const { sessions, apiKeys, throttle } = account;
  const r = express.Router();
  r.use(auth.requireAdmin);

  const ip = (req) => req.ip || null;
  const str = (v, max = 200) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
  const SUMMARY = `SELECT u.id, u.email, u.is_admin, u.banned, u.locked, u.locked_reason, u.email_verified, u.must_reset_password, u.pending_email, u.deleted_at, u.created_at,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))) sessions,
      EXISTS(SELECT 1 FROM user_totp t WHERE t.user_id=u.id AND t.enabled=1) two_factor,
      (SELECT created_at FROM login_history h WHERE h.user_id=u.id AND h.ok=1 ORDER BY h.id DESC LIMIT 1) last_login,
      (SELECT COUNT(*) FROM login_history h WHERE h.user_id=u.id AND h.ok=0 AND h.created_at >= datetime('now','-1 day')) failed_24h,
      (SELECT COUNT(*) FROM api_keys k WHERE k.user_id=u.id AND k.revoked_at IS NULL) api_keys
    FROM users u`;
  const present = (u) => ({ ...u, is_admin: !!u.is_admin, banned: !!u.banned, locked: !!u.locked, email_verified: !!u.email_verified, must_reset_password: !!u.must_reset_password, two_factor: !!u.two_factor, throttle: u.deleted_at ? null : throttle.status(u.email) });
  function target(req) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Bad user id', { code: 'VALIDATION' });
    const u = db.prepare(`${SUMMARY} WHERE u.id=?`).get(id);
    if (!u) throw new HttpError(404, 'User not found', { code: 'NOT_FOUND' });
    return u;
  }

  r.get('/users', (req, res) => {
    const qs = str(req.query.q, 100).trim().toLowerCase();
    const filter = str(req.query.filter, 20);
    const where = [];
    const args = [];
    if (qs) { where.push('(u.email LIKE ? OR u.id = ?)'); args.push(`%${qs}%`, Number(qs) || -1); }
    if (filter === 'locked') where.push('u.locked=1');
    if (filter === 'unverified') where.push('u.email_verified=0 AND u.deleted_at IS NULL');
    if (filter === '2fa') where.push('EXISTS(SELECT 1 FROM user_totp t WHERE t.user_id=u.id AND t.enabled=1)');
    if (filter === 'admins') where.push('u.is_admin=1');
    if (filter === 'deleted') where.push('u.deleted_at IS NOT NULL');
    const rows = db.prepare(`${SUMMARY}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY u.id DESC LIMIT 50`).all(...args);
    res.json({ users: rows.map(present) });
  });

  r.get('/overview', (req, res) => {
    const one = (sql) => db.prepare(sql).get().n;
    res.json({
      users: one('SELECT COUNT(*) n FROM users WHERE deleted_at IS NULL'),
      verified: one('SELECT COUNT(*) n FROM users WHERE email_verified=1 AND deleted_at IS NULL'),
      two_factor: one('SELECT COUNT(*) n FROM user_totp WHERE enabled=1'),
      locked: one('SELECT COUNT(*) n FROM users WHERE locked=1 AND deleted_at IS NULL'),
      active_sessions: one("SELECT COUNT(*) n FROM sessions WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"),
      logins_24h: one("SELECT COUNT(*) n FROM login_history WHERE ok=1 AND created_at >= datetime('now','-1 day')"),
      failed_24h: one("SELECT COUNT(*) n FROM login_history WHERE ok=0 AND created_at >= datetime('now','-1 day')"),
      lockouts_active: throttle.lockouts().length,
      api_keys: one('SELECT COUNT(*) n FROM api_keys WHERE revoked_at IS NULL'),
    });
  });

  r.get('/users/:id', (req, res) => {
    const u = target(req);
    res.json({
      user: present(u),
      sessions: sessions.list(u.id),
      login_history: sessions.history(u.id, 50),
      api_keys: apiKeys.list(u.id),
      two_factor: account.twoFactorStatus(u.id),
      audit: auditRows({ userId: u.id, limit: 50 }),
    });
  });

  r.post('/users/:id/lock', (req, res) => {
    const u = target(req);
    if (u.id === req.user.id) throw new HttpError(400, 'You cannot lock your own account', { code: 'SELF' });
    const reason = str(req.body.reason, 200) || 'admin';
    db.prepare('UPDATE users SET locked=1, locked_reason=? WHERE id=?').run(reason, u.id);
    const n = sessions.revokeAll(u.id, { reason: 'admin_lock' });
    audit(req.user.id, 'admin.user.lock', { reason, sessions_revoked: n }, { targetId: u.id, ip: ip(req) });
    ctx.events.emit('account.locked', { userId: u.id, email: u.email, by: req.user.id, reason });
    res.json({ ok: true, sessions_revoked: n });
  });
  r.post('/users/:id/unlock', (req, res) => {
    const u = target(req);
    if (u.deleted_at) throw new HttpError(409, 'Deleted accounts cannot be unlocked', { code: 'DELETED' });
    db.prepare('UPDATE users SET locked=0, locked_reason=NULL WHERE id=?').run(u.id);
    throttle.clear({ email: u.email });
    audit(req.user.id, 'admin.user.unlock', {}, { targetId: u.id, ip: ip(req) });
    res.json({ ok: true });
  });
  r.post('/users/:id/force-reset', async (req, res) => {
    const u = target(req);
    if (u.deleted_at) throw new HttpError(409, 'Account is deleted', { code: 'DELETED' });
    await account.requireStepUp(req, { purpose: 'admin_force_reset' });
    res.json({ ok: true, ...(await account.forcePasswordReset(db.prepare('SELECT * FROM users WHERE id=?').get(u.id), { actorId: req.user.id, ip: ip(req), reason: str(req.body.reason, 200) || 'admin' })) });
  });
  r.post('/users/:id/disable-2fa', async (req, res) => {
    const u = target(req);
    const reason = str(req.body.reason, 200).trim();
    if (reason.length < 3) throw new HttpError(400, 'A reason (ticket reference) is required', { code: 'VALIDATION' });
    await account.requireStepUp(req, { purpose: 'admin_disable_2fa' });
    const out = await account.totpDisable({ id: u.id, email: u.email }, {}, { ip: ip(req), actorId: req.user.id, reason });
    // Ending every session forces the user (or whoever holds the session) to log in again with the password alone.
    sessions.revokeAll(u.id, { reason: 'admin_2fa_disabled' });
    res.json({ ok: true, ...out });
  });
  r.post('/users/:id/verify-email', (req, res) => {
    const u = target(req);
    db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(u.id);
    audit(req.user.id, 'admin.user.email_verified', { reason: str(req.body.reason, 200) || 'admin' }, { targetId: u.id, ip: ip(req) });
    ctx.events.emit('account.email_verified', { userId: u.id, email: u.email, by: 'admin' });
    res.json({ ok: true });
  });
  r.post('/users/:id/sessions/revoke', (req, res) => {
    const u = target(req);
    const n = sessions.revokeAll(u.id, { reason: 'admin' });
    audit(req.user.id, 'admin.user.sessions_revoked', { count: n }, { targetId: u.id, ip: ip(req) });
    res.json({ ok: true, revoked: n });
  });
  r.delete('/users/:id/sessions/:jti', (req, res) => {
    const u = target(req);
    if (!sessions.revoke(u.id, str(req.params.jti, 64), 'admin')) throw new HttpError(404, 'Session not found', { code: 'NOT_FOUND' });
    audit(req.user.id, 'admin.user.session_revoked', { jti: str(req.params.jti, 8) }, { targetId: u.id, ip: ip(req) });
    res.json({ ok: true });
  });
  r.delete('/users/:id/api-keys/:keyId', (req, res) => {
    const u = target(req);
    const id = Number(req.params.keyId);
    if (!Number.isInteger(id) || !apiKeys.revoke(u.id, id, { actorId: req.user.id, ip: ip(req), reason: 'admin' })) throw new HttpError(404, 'API key not found', { code: 'NOT_FOUND' });
    res.json({ ok: true });
  });
  r.post('/users/:id/clear-lockout', (req, res) => {
    const u = target(req);
    throttle.clear({ email: u.email });
    audit(req.user.id, 'admin.user.lockout_cleared', {}, { targetId: u.id, ip: ip(req) });
    res.json({ ok: true });
  });

  // ---- lockouts & audit ----
  r.get('/lockouts', (req, res) => res.json({ lockouts: throttle.lockouts() }));
  r.post('/lockouts/clear', (req, res) => {
    const key = str(req.body.key, 220);
    if (!/^(email|ip|stepup|2fa):/.test(key)) throw new HttpError(400, 'Bad key', { code: 'VALIDATION' });
    throttle.clear({ key });
    audit(req.user.id, 'admin.lockout_cleared', { key }, { ip: ip(req) });
    res.json({ ok: true });
  });

  function auditRows({ userId, action, limit = 100, before }) {
    const where = [], args = [];
    if (userId) { where.push('(a.target_id=? OR a.actor_id=?)'); args.push(userId, userId); }
    if (action) { where.push('a.action LIKE ?'); args.push(`${action}%`); }
    if (before) { where.push('a.id < ?'); args.push(before); }
    args.push(Math.min(500, Math.max(1, Number(limit) || 100)));
    return db.prepare(`SELECT a.id, a.actor_id, a.target_id, a.action, a.details, a.ip, a.created_at, ac.email actor_email, tg.email target_email
      FROM audit_log a LEFT JOIN users ac ON ac.id=a.actor_id LEFT JOIN users tg ON tg.id=a.target_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ?`).all(...args).map((row) => ({ ...row, details: safeJson(row.details) }));
  }
  r.get('/audit', (req, res) => {
    const userId = req.query.user_id ? Number(req.query.user_id) : null;
    if (req.query.user_id && !Number.isInteger(userId)) throw new HttpError(400, 'Bad user id', { code: 'VALIDATION' });
    res.json({ audit: auditRows({ userId, action: str(req.query.action, 60), limit: req.query.limit, before: req.query.before ? Number(req.query.before) : undefined }) });
  });

  app.use('/api/admin/security', r);
};

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }
