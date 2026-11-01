'use strict';
/**
 * Spot trading facade. With OPEX enabled, orders go to the OPEX matching
 * engine (the user's shadow account trades from the same OPEX wallet).
 * Without OPEX, the built-in OrderBook runs the markets on the local ledger.
 */
const { HttpError } = require('../provisioner');
const { parseOrderInput } = require('./book');

class LocalSpot {
  constructor({ db, book }) { this.db = db; this.book = book; }
  get kind() { return 'local'; }
  async markets() {
    return this.db.prepare("SELECT id FROM markets WHERE kind='spot' AND active=1 ORDER BY rowid").all().map((m) => this.book.ticker(m.id));
  }
  _m(id) { const m = this.book.market(id); if (m.kind !== 'spot') throw new HttpError(404, 'Unknown market'); return m; }
  async depth(id) { this._m(id); return this.book.depth(id); }
  async trades(id) { this._m(id); return this.book.trades(id); }
  async place(userId, id, body) { const m = this._m(id); return this.book.place(userId, id, parseOrderInput(m, body)); }
  async cancel(userId, id, orderId) { this._m(id); return this.book.cancel(userId, Number(orderId)); }
  async openOrders(userId, id) { return this.book.openOrders(userId, id).filter((o) => !o.market.startsWith('CARD:')); }
  async history(userId) { return this.book.history(userId).filter((o) => !o.market.startsWith('CARD:')); }
}

class OpexSpot {
  constructor({ wallet, config }) { this.wallet = wallet; this.api = config.opex.apiUrl; this.pairs = config.opex.spotPairs; }
  get kind() { return 'opex'; }
  _get(path, token) { return this.wallet._http(`${this.api}${path}`, { token }); }
  async markets() {
    const prices = await this._get('/opex/v1/market/ticker/24h').catch(() => []);
    const by = new Map((prices || []).map((t) => [t.symbol, t]));
    return this.pairs.map((id) => {
      const t = by.get(id) || {};
      const [base, quote] = id.split('_');
      return { market: id, base, quote, last: t.lastPrice ?? null, bid: t.bidPrice ?? null, ask: t.askPrice ?? null, change_24h: Number(t.priceChangePercent || 0), volume_24h: t.volume ?? 0 };
    });
  }
  _check(id) { if (!this.pairs.includes(id)) throw new HttpError(404, 'Unknown market'); }
  async depth(id) { this._check(id); const r = await this._get(`/opex/v1/market/depth?symbol=${id}&limit=20`); return { market: id, bids: r.bids.map(([p, q]) => [String(p), String(q)]), asks: r.asks.map(([p, q]) => [String(p), String(q)]) }; }
  async trades(id) { this._check(id); const r = await this._get(`/opex/v1/market/trades?symbol=${id}&limit=50`); return (r || []).map((t) => ({ id: t.id, price: String(t.price), qty: String(t.qty), side: t.isBuyerMaker ? 'sell' : 'buy', time: new Date(t.time).toISOString() })); }
  async place(userId, id, b) {
    this._check(id);
    const token = await this.wallet.userToken(userId);
    const q = new URLSearchParams({ symbol: id, side: String(b.side).toUpperCase(), type: String(b.type || 'limit').toUpperCase(), quantity: String(b.qty) });
    if ((b.type || 'limit') === 'limit') { q.set('price', String(b.price)); q.set('timeInForce', 'GTC'); }
    const r = await this.wallet._http(`${this.api}/opex/v1/order?${q}`, { method: 'POST', token });
    return { id: r.orderId, market: id, side: b.side, type: b.type || 'limit', price: b.price ?? null, qty: String(b.qty), filled: String(r.executedQty ?? 0), status: String(r.status || 'NEW').toLowerCase() };
  }
  async cancel(userId, id, orderId) {
    this._check(id);
    const token = await this.wallet.userToken(userId);
    await this.wallet._http(`${this.api}/opex/v1/order?symbol=${id}&orderId=${encodeURIComponent(orderId)}`, { method: 'PUT', token });
    return { ok: true };
  }
  async openOrders(userId, id) {
    const token = await this.wallet.userToken(userId);
    const r = await this.wallet._http(`${this.api}/opex/v1/order/open${id ? `?symbol=${id}` : ''}`, { token });
    return (r || []).map((o) => ({ id: o.orderId, market: o.symbol, side: String(o.side).toLowerCase(), type: String(o.type).toLowerCase(), price: String(o.price), qty: String(o.origQty), filled: String(o.executedQty), status: 'open', created_at: new Date(o.time).toISOString() }));
  }
  async history() { return []; }
}

function createSpot({ db, book, wallet, config }) {
  return config.opex.enabled ? new OpexSpot({ wallet, config }) : new LocalSpot({ db, book });
}

module.exports = { createSpot };
