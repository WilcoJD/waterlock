'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../provisioner');

/** Spot, perpetuals, options and price feed. */
module.exports = function tradeRoutes({ config, auth, spot, perps, options, oracle, hooks }) {
  const r = express.Router();
  const orderLimit = rateLimit({ windowMs: 10 * 1000, limit: 50, keyGenerator: (req) => String(req.user?.id || req.ip) });

  // ---- prices ----
  r.get('/prices', (req, res) => res.json({ prices: oracle.all(), spark: Object.fromEntries(oracle.symbols.map((s) => [s, oracle.spark(s).slice(-120).map(([, p]) => p)])), source: oracle.source }));

  // ---- spot ----
  r.get('/spot/markets', async (req, res) => res.json({ backend: spot.kind, markets: await spot.markets() }));
  r.get('/spot/:market/depth', async (req, res) => res.json(await spot.depth(req.params.market)));
  r.get('/spot/:market/trades', async (req, res) => res.json({ trades: await spot.trades(req.params.market) }));
  r.post('/spot/:market/orders', auth.requireAuth, orderLimit, async (req, res) => {
    await hooks.run('trade.before', { product: 'spot', userId: req.user.id, user: req.user, market: req.params.market, body: req.body, req });
    res.status(201).json({ order: await spot.place(req.user.id, req.params.market, req.body) });
  });
  r.delete('/spot/:market/orders/:id', auth.requireAuth, async (req, res) => res.json(await spot.cancel(req.user.id, req.params.market, req.params.id)));
  r.get('/spot/orders', auth.requireAuth, async (req, res) => res.json({ open: await spot.openOrders(req.user.id, req.query.market), history: await spot.history(req.user.id) }));

  // ---- derivatives ----
  const deriv = (req, res, next) => (config.derivativesEnabled ? next() : next(new HttpError(403, 'Derivatives are not available')));
  r.get('/perps/markets', deriv, (req, res) => res.json({ markets: perps.markets() }));
  r.get('/perps/positions', deriv, auth.requireAuth, (req, res) => res.json({ positions: perps.positions(req.user.id, req.query.status === 'closed' ? 'closed' : 'open') }));
  r.post('/perps/positions', deriv, auth.requireAuth, orderLimit, async (req, res) => {
    await hooks.run('trade.before', { product: 'perps', userId: req.user.id, user: req.user, market: req.body.symbol, body: req.body, req });
    res.status(201).json({ position: await perps.open(req.user.id, req.body) });
  });
  r.post('/perps/positions/:id/close', deriv, auth.requireAuth, async (req, res) => res.json({ position: await perps.close(req.user.id, Number(req.params.id)) }));

  r.get('/options/:symbol/chain', deriv, (req, res) => res.json(options.chain(String(req.params.symbol).toUpperCase())));
  r.get('/options/positions', deriv, auth.requireAuth, (req, res) => res.json({ positions: options.positions(req.user.id, req.query.status === 'closed' ? 'closed' : 'open') }));
  r.post('/options/buy', deriv, auth.requireAuth, orderLimit, async (req, res) => {
    await hooks.run('trade.before', { product: 'options', userId: req.user.id, user: req.user, market: String(req.body.symbol || '').toUpperCase(), body: req.body, req });
    res.status(201).json({ position: await options.buy(req.user.id, { ...req.body, symbol: String(req.body.symbol || '').toUpperCase() }) });
  });
  r.post('/options/positions/:id/close', deriv, auth.requireAuth, async (req, res) => res.json({ position: await options.close(req.user.id, Number(req.params.id)) }));

  return r;
};
