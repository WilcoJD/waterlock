'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../provisioner');

module.exports = function serverRoutes({ db, auth, prov }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: (req) => String(req.user.id) });

  const own = (req) => {
    const s = prov.server(Number(req.params.id));
    if (!s || s.user_id !== req.user.id || s.state === 'deleted') throw new HttpError(404, 'Server not found');
    return s;
  };

  r.get('/', (req, res) => {
    const rows = db.prepare("SELECT * FROM servers WHERE user_id=? AND state!='deleted' ORDER BY id DESC").all(req.user.id);
    res.json({ servers: rows.map((s) => prov.present(s)) });
  });

  // Only the free plan can be created directly; paid plans go through the shop.
  r.post('/free', createLimiter, async (req, res) => {
    const { server, rootPassword } = await prov.createServer(req.user.id, 'free', { hostname: req.body.hostname, sshKey: req.body.ssh_key });
    res.status(201).json({ server: prov.present(server), root_password: rootPassword });
  });

  r.get('/:id', async (req, res) => {
    const s = own(req);
    res.json({ server: prov.present(s), live: await prov.liveStatus(s) });
  });

  r.post('/:id/:action', async (req, res) => {
    if (!['start', 'stop', 'shutdown', 'reboot'].includes(req.params.action)) throw new HttpError(404, 'Unknown action');
    const s = own(req);
    await prov.power(s, req.params.action);
    res.json({ ok: true, live: await prov.liveStatus(s) });
  });

  // White-label custom domain (CNAME it to the apps domain)
  r.put('/:id/domain', async (req, res) => {
    const s = own(req);
    await prov.setCustomDomain(s, req.body.domain || null);
    res.json({ server: prov.present(prov.server(s.id)) });
  });

  r.delete('/:id', async (req, res) => {
    const s = own(req);
    await prov.destroyServer(s);
    res.json({ ok: true });
  });

  return r;
};
