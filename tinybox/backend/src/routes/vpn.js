'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');

module.exports = function vpnRoutes({ auth, vpn }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  r.get('/', (req, res) => res.json(vpn.status(req.user.id)));
  // Issues new keys each time (old config stops working) and returns a WireGuard .conf
  r.post('/config', rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: (req) => String(req.user.id) }), async (req, res) => {
    const conf = await vpn.issue(req.user.id);
    res.json({ config: conf, filename: 'private-network.conf' });
  });
  return r;
};
