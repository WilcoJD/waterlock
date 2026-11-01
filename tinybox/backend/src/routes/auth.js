'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

module.exports = function authRoutes({ db, config, auth, hooks, events }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const me = (u) => ({ id: u.id, email: u.email, is_admin: !!u.is_admin });

  r.post('/register', limiter, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already registered' });
    await hooks.run('auth.register.before', { email, req, ip: req.ip });
    const hash = await bcrypt.hash(password, 11);
    const isAdmin = config.adminEmails.includes(email) ? 1 : 0;
    const info = db.prepare('INSERT INTO users (email, password_hash, is_admin) VALUES (?,?,?)').run(email, hash, isAdmin);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(info.lastInsertRowid));
    events.emit('user.registered', { user: me(user), ip: req.ip });
    res.status(201).json({ token: auth.sign(user), user: me(user) });
  });

  r.post('/login', limiter, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Wrong email or password' });
    if (user.banned) return res.status(403).json({ error: 'Account suspended' });
    const payload = { user: me(user), req, ip: req.ip, extra: {} };
    await hooks.run('auth.login.after', payload);
    events.emit('user.login', { user: me(user), ip: req.ip });
    res.json({ token: auth.sign(user), user: me(user), ...payload.extra });
  });

  r.get('/me', auth.requireAuth, (req, res) => res.json({ user: me(req.user) }));

  r.post('/change-password', auth.requireAuth, async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!(await bcrypt.compare(String(req.body.current || ''), user.password_hash))) return res.status(401).json({ error: 'Current password is wrong' });
    const next = String(req.body.password || '');
    if (next.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await bcrypt.hash(next, 11), user.id);
    res.json({ ok: true });
  });

  return r;
};
