'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../provisioner');
const { toUnits, fromUnits } = require('../money');

module.exports = function walletRoutes({ db, config, auth, wallet, perps, options, cards }) {
  const r = express.Router();
  r.use(auth.requireAuth);
  const wdLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, keyGenerator: (req) => String(req.user.id) });

  // One wallet: balances plus everything currently committed in each product.
  r.get('/', async (req, res) => {
    const owner = `u:${req.user.id}`;
    const balances = (await wallet.balances(owner)).map((b) => ({ asset: b.asset, balance: fromUnits(b.balance), locked: b.locked ? fromUnits(b.locked) : '0' }));
    const inOrders = db.prepare("SELECT m.quote asset, COALESCE(SUM(o.escrow),0) n FROM book_orders o JOIN markets m ON m.id=o.market WHERE o.user_id=? AND o.status='open' AND o.side='buy' GROUP BY m.quote").all(req.user.id);
    const perpMargin = db.prepare("SELECT COALESCE(SUM(margin),0) n FROM perp_positions WHERE user_id=? AND status='open'").get(req.user.id).n;
    const optValue = options ? options.positions(req.user.id).reduce((a, p) => a + (p.value || 0), 0) : 0;
    const cardValue = cards ? cards.holdings(req.user.id).reduce((a, h) => a + Number(h.last || 0) * (h.qty + h.locked), 0) : 0;
    res.json({
      backend: wallet.kind, assets: wallet.assets(), balances,
      committed: {
        open_buy_orders: inOrders.map((x) => ({ asset: x.asset, amount: fromUnits(x.n) })),
        perps_margin_usdt: fromUnits(perpMargin),
        options_value_usdt: optValue.toFixed(2),
        cards_value_usdt: cardValue.toFixed(2),
      },
      faucet: config.wallet.allowFaucet && wallet.kind === 'local',
    });
  });

  r.get('/history', (req, res) => res.json({ entries: wallet.entries(`u:${req.user.id}`) }));

  r.post('/deposit-address', async (req, res) => {
    const a = wallet.asset(req.body.asset);
    const chain = String(req.body.chain || a.chains[0]);
    if (!a.chains.includes(chain)) throw new HttpError(400, 'Unsupported network');
    res.json({ asset: a.symbol, chain, ...(await wallet.depositAddress(req.user.id, a.symbol, chain)) });
  });

  r.post('/withdraw', wdLimit, async (req, res) => {
    const a = wallet.asset(req.body.asset);
    const id = await wallet.requestWithdraw(req.user.id, { asset: a.symbol, chain: String(req.body.chain || ''), address: String(req.body.address || '').trim(), amount: toUnits(String(req.body.amount)) });
    res.status(201).json({ id, withdrawals: wallet.withdrawals(req.user.id) });
  });
  r.get('/withdrawals', (req, res) => res.json({ withdrawals: wallet.withdrawals(req.user.id) }));

  // Development only: free test funds.
  r.post('/faucet', async (req, res) => {
    if (!config.wallet.allowFaucet || wallet.kind !== 'local') throw new HttpError(403, 'Faucet disabled');
    const today = db.prepare("SELECT COUNT(*) n FROM wallet_entries WHERE owner=? AND kind='faucet' AND created_at >= datetime('now','-1 day')").get(`u:${req.user.id}`).n;
    if (today >= 10) throw new HttpError(429, 'Faucet limit reached for today');
    const grants = { USDT: '10000', BTC: '0.1', ETH: '2', SOL: '20' };
    for (const [asset, amt] of Object.entries(grants)) await wallet.transfer({ src: 'sys:faucet', dst: `u:${req.user.id}`, asset, amount: toUnits(amt), kind: 'faucet', ref: 'test funds' });
    res.json({ ok: true, granted: grants });
  });

  return r;
};
