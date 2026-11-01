'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');

module.exports = function cardRoutes({ auth, cards, hooks }) {
  const r = express.Router();
  const orderLimit = rateLimit({ windowMs: 10 * 1000, limit: 50, keyGenerator: (req) => String(req.user?.id || req.ip) });

  r.get('/catalog', (req, res) => res.json({ games: cards.catalog() }));
  r.get('/series/:id', (req, res) => res.json(cards.series(req.params.id)));
  r.get('/products/:sku', (req, res) => res.json(cards.product(req.params.sku)));
  r.get('/search', (req, res) => res.json({ results: cards.search(req.query.q) }));

  r.post('/products/:sku/orders', auth.requireAuth, orderLimit, async (req, res) => {
    await hooks.run('trade.before', { product: 'cards', userId: req.user.id, user: req.user, market: `CARD:${req.params.sku}`, body: req.body, req });
    res.status(201).json({ order: await cards.place(req.user.id, req.params.sku, req.body) });
  });
  r.delete('/orders/:id', auth.requireAuth, async (req, res) => res.json(await cards.cancel(req.user.id, req.params.id)));
  r.get('/orders', auth.requireAuth, (req, res) => res.json({ orders: cards.orders(req.user.id) }));
  r.get('/holdings', auth.requireAuth, (req, res) => res.json({ holdings: cards.holdings(req.user.id) }));
  r.post('/requests', auth.requireAuth, (req, res) => res.status(201).json({ request: cards.request(req.user.id, req.body) }));
  r.get('/requests', auth.requireAuth, (req, res) => res.json({ requests: cards.requests(req.user.id) }));
  return r;
};
