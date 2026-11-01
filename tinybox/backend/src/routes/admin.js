'use strict';
const express = require('express');
const { HttpError } = require('../provisioner');

const { toUnits, fromUnits } = require('../money');

module.exports = function adminRoutes({ db, auth, prov, wallet, cards }) {
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
      fees_usdt: fromUnits(db.prepare("SELECT COALESCE(SUM(balance),0) n FROM wallet_balances WHERE owner='sys:fees' AND asset='USDT'").get().n),
      open_perps: one("SELECT COUNT(*) n FROM perp_positions WHERE status='open'").n,
      open_options: one("SELECT COUNT(*) n FROM option_positions WHERE status='open'").n,
      card_trades_24h: one("SELECT COUNT(*) n FROM book_fills WHERE market LIKE 'CARD:%' AND created_at >= datetime('now','-1 day')").n,
      spot_trades_24h: one("SELECT COUNT(*) n FROM book_fills WHERE market NOT LIKE 'CARD:%' AND created_at >= datetime('now','-1 day')").n,
      pending_card_requests: one("SELECT COUNT(*) n FROM card_requests WHERE status='pending'").n,
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

  // ---- wallet ----
  r.get('/wallet', async (req, res) => {
    const house = db.prepare("SELECT owner, asset, balance FROM wallet_balances WHERE owner LIKE 'sys:%' ORDER BY owner, asset").all().map((b) => ({ ...b, balance: fromUnits(b.balance) }));
    const pending = db.prepare("SELECT w.*, u.email FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' ORDER BY w.id").all().map((w) => ({ ...w, amount: fromUnits(w.amount), fee: fromUnits(w.fee) }));
    const outbox = db.prepare('SELECT * FROM wallet_outbox ORDER BY id').all().map((o) => ({ ...o, amount: fromUnits(o.amount) }));
    res.json({ backend: wallet.kind, house, pending_withdrawals: pending, outbox });
  });
  r.post('/wallet/credit', async (req, res) => {
    const a = wallet.asset(req.body.asset);
    await wallet.credit(Number(req.body.user_id), a.symbol, toUnits(String(req.body.amount)), String(req.body.ref || 'manual deposit'));
    res.json({ ok: true });
  });
  r.post('/withdrawals/:id/approve', async (req, res) => { await wallet.approveWithdrawal(Number(req.params.id), req.body.txid); res.json({ ok: true }); });
  r.post('/withdrawals/:id/reject', async (req, res) => { await wallet.rejectWithdrawal(Number(req.params.id)); res.json({ ok: true }); });

  // ---- cards vault ----
  r.get('/cards/requests', (req, res) => res.json({ requests: cards.requests(null) }));
  r.post('/cards/requests/:id/complete', (req, res) => res.json({ request: cards.complete(Number(req.params.id), req.body) }));

  r.delete('/servers/:id', async (req, res) => {
    const s = prov.server(Number(req.params.id));
    if (!s) throw new HttpError(404, 'Not found');
    await prov.destroyServer(s);
    res.json({ ok: true });
  });

  return r;
};
