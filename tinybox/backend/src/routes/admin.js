'use strict';
const express = require('express');
const { HttpError } = require('../provisioner');

module.exports = function adminRoutes({ db, auth, prov }) {
  const r = express.Router();
  r.use(auth.requireAdmin);

  r.get('/stats', (req, res) => {
    const one = (sql) => db.prepare(sql).get();
    res.json({
      users: one('SELECT COUNT(*) n FROM users').n,
      servers_by_state: db.prepare("SELECT state, COUNT(*) n FROM servers GROUP BY state").all(),
      servers_by_plan: db.prepare("SELECT plan_id, COUNT(*) n FROM servers WHERE state IN ('active','provisioning','suspended') GROUP BY plan_id").all(),
      revenue_cents_30d: one("SELECT COALESCE(SUM(amount_cents),0) n FROM orders WHERE status='fulfilled' AND created_at >= datetime('now','-30 day')").n,
      ad_rewards_24h: one("SELECT COUNT(*) n FROM ad_rewards WHERE created_at >= datetime('now','-1 day')").n,
    });
  });

  r.get('/users', (req, res) => {
    res.json({ users: db.prepare(`SELECT u.id, u.email, u.is_admin, u.banned, u.created_at,
      (SELECT COUNT(*) FROM servers s WHERE s.user_id=u.id AND s.state!='deleted') servers
      FROM users u ORDER BY u.id DESC LIMIT 500`).all() });
  });

  r.get('/servers', (req, res) => {
    const rows = db.prepare("SELECT s.*, u.email FROM servers s JOIN users u ON u.id=s.user_id WHERE s.state!='deleted' ORDER BY s.id DESC LIMIT 1000").all();
    res.json({ servers: rows.map((s) => ({ ...prov.present(s), email: s.email, node: s.node })) });
  });

  r.post('/users/:id/ban', async (req, res) => {
    const id = Number(req.params.id);
    db.prepare('UPDATE users SET banned=1 WHERE id=?').run(id);
    for (const s of db.prepare("SELECT * FROM servers WHERE user_id=? AND state IN ('active','suspended','error')").all(id)) {
      await prov.destroyServer(s).catch(() => {});
    }
    res.json({ ok: true });
  });

  r.delete('/servers/:id', async (req, res) => {
    const s = prov.server(Number(req.params.id));
    if (!s) throw new HttpError(404, 'Not found');
    await prov.destroyServer(s);
    res.json({ ok: true });
  });

  return r;
};
