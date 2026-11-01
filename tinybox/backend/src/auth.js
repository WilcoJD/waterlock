'use strict';
const jwt = require('jsonwebtoken');

function makeAuth({ db, config }) {
  function sign(user) {
    return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '30d' });
  }

  function requireAuth(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    try {
      const { sub } = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT id, email, is_admin, banned FROM users WHERE id=?').get(sub);
      if (!user) return res.status(401).json({ error: 'Account not found' });
      if (user.banned) return res.status(403).json({ error: 'Account suspended' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Session expired, please log in again' });
    }
  }

  function requireAdmin(req, res, next) {
    requireAuth(req, res, () => (req.user.is_admin ? next() : res.status(403).json({ error: 'Admins only' })));
  }

  return { sign, requireAuth, requireAdmin };
}

module.exports = { makeAuth };
