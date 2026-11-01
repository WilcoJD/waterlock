'use strict';
/**
 * Price-time priority limit order book with escrow settlement.
 *
 * Used for local spot markets (BTC_USDT...) and for trading-card markets
 * (CARD:<sku>). Funds are escrowed *before* an order touches the book:
 *   buy  -> quote (USDT) moves from the user's wallet to sys:escrow
 *   sell -> base moves to escrow (wallet asset, or locked card holdings)
 * Fills pay out of escrow, so matching never fails half-way. Takers pay
 * `taker_fee_bps` in quote; makers trade free. Each market is serialised by
 * a mutex so concurrent requests can't race each other.
 */
const { atomic, KeyedMutex } = require('../atomic');
const { HttpError } = require('../provisioner');
const { mulDiv, fromUnits, toUnits } = require('../money');
const { userOwner } = require('../wallet/base');

const ESCROW = 'sys:escrow';
const FEES = 'sys:fees';

class OrderBook {
  constructor({ db, wallet, log = console }) {
    this.db = db; this.wallet = wallet; this.log = log;
    this.mutex = new KeyedMutex();
    this.listeners = new Set();
  }

  market(id) {
    const m = this.db.prepare('SELECT * FROM markets WHERE id=? AND active=1').get(id);
    if (!m) throw new HttpError(404, 'Unknown market');
    return m;
  }

  // ---------- base-asset adapters ----------
  async _escrowBase(m, userId, qty) {
    if (m.kind === 'spot') return this.wallet.transfer({ src: userOwner(userId), dst: ESCROW, asset: m.base, amount: qty, kind: 'spot', ref: m.id });
    atomic(this.db, () => {
      if (userId === 0) { // platform market maker: unlimited demo inventory
        this.db.prepare('INSERT INTO card_holdings (user_id, sku, qty, locked) VALUES (0,?,0,?) ON CONFLICT(user_id, sku) DO UPDATE SET locked=locked+excluded.locked').run(m.base, qty);
        return;
      }
      const r = this.db.prepare('UPDATE card_holdings SET qty=qty-?, locked=locked+? WHERE user_id=? AND sku=? AND qty>=?').run(qty, qty, userId, m.base, qty);
      if (r.changes === 0) throw new HttpError(400, "You don't own enough of this item");
    });
  }
  // Returns a list of async payouts to run after the DB transaction.
  _releaseBase(m, userId, qty, pay) {
    if (qty <= 0) return;
    if (m.kind === 'spot') return pay.push({ src: ESCROW, dst: userOwner(userId), asset: m.base, amount: qty, kind: 'spot_refund', ref: m.id });
    this.db.prepare('UPDATE card_holdings SET qty=qty+?, locked=locked-? WHERE user_id=? AND sku=?').run(userId === 0 ? 0 : qty, qty, userId, m.base);
  }
  _deliverBase(m, sellerId, buyerId, qty, pay) {
    if (m.kind === 'spot') return pay.push({ src: ESCROW, dst: userOwner(buyerId), asset: m.base, amount: qty, kind: 'spot', ref: m.id });
    this.db.prepare('UPDATE card_holdings SET locked=locked-? WHERE user_id=? AND sku=?').run(qty, sellerId, m.base);
    this.db.prepare('INSERT INTO card_holdings (user_id, sku, qty) VALUES (?,?,?) ON CONFLICT(user_id, sku) DO UPDATE SET qty=qty+excluded.qty').run(buyerId, m.base, qty);
  }

  _fee(m, cost) { return mulDiv(cost, m.taker_fee_bps, 10000); }
  _opposite(m, side) {
    return side === 'buy'
      ? this.db.prepare("SELECT * FROM book_orders WHERE market=? AND status='open' AND side='sell' ORDER BY price ASC, id ASC").all(m.id)
      : this.db.prepare("SELECT * FROM book_orders WHERE market=? AND status='open' AND side='buy' ORDER BY price DESC, id ASC").all(m.id);
  }

  /** Quote needed for a market buy of `qty`, walking the asks (excluding own orders). */
  _marketBuyCost(m, userId, qty) {
    let left = qty, cost = 0, fee = 0;
    for (const o of this._opposite(m, 'buy')) {
      if (o.user_id === userId) continue;
      const q = Math.min(left, o.qty - o.filled);
      const c = mulDiv(o.price, q, m.base_scale);
      cost += c; fee += this._fee(m, c); left -= q;
      if (!left) break;
    }
    return { fillable: qty - left, total: cost + fee };
  }

  /**
   * Place an order. price/qty are in units (price: quote units per 1 whole
   * base; qty: base units, or item count for cards).
   */
  async place(userId, marketId, { side, type = 'limit', price = 0, qty }) {
    const m = this.market(marketId);
    if (!['buy', 'sell'].includes(side)) throw new HttpError(400, 'side must be buy or sell');
    if (!['limit', 'market'].includes(type)) throw new HttpError(400, 'type must be limit or market');
    if (!Number.isSafeInteger(qty) || qty < m.min_qty) throw new HttpError(400, `Minimum quantity is ${m.base_scale === 1 ? m.min_qty : fromUnits(m.min_qty)}`);
    if (type === 'limit') {
      if (!Number.isSafeInteger(price) || price <= 0) throw new HttpError(400, 'Enter a price');
      if (price % m.tick !== 0) throw new HttpError(400, `Price must be a multiple of ${fromUnits(m.tick)}`);
    } else price = 0;

    return this.mutex.run(m.id, async () => {
      let escrow;
      if (side === 'buy') {
        if (type === 'limit') {
          const cost = mulDiv(price, qty, m.base_scale, true);
          escrow = cost + mulDiv(cost, m.taker_fee_bps, 10000, true);
        } else {
          const r = this._marketBuyCost(m, userId, qty);
          if (!r.fillable) throw new HttpError(400, 'No sellers right now');
          qty = r.fillable; escrow = r.total;
        }
        if (escrow > 0) await this.wallet.transfer({ src: userOwner(userId), dst: ESCROW, asset: m.quote, amount: escrow, kind: m.kind, ref: m.id });
      } else {
        if (type === 'market' && !this._opposite(m, 'sell').some((o) => o.user_id !== userId)) throw new HttpError(400, 'No buyers right now');
        await this._escrowBase(m, userId, qty);
        escrow = qty;
      }

      const pay = [];
      let order;
      try {
        order = atomic(this.db, () => {
          const id = Number(this.db.prepare('INSERT INTO book_orders (market,user_id,side,type,price,qty,escrow) VALUES (?,?,?,?,?,?,?)')
            .run(m.id, userId, side, type, price, qty, escrow).lastInsertRowid);
          this._match(m, id, pay);
          return this.db.prepare('SELECT * FROM book_orders WHERE id=?').get(id);
        });
      } catch (e) {
        // Matching failed (shouldn't happen) – give the escrow back.
        if (side === 'buy') pay.push({ src: ESCROW, dst: userOwner(userId), asset: m.quote, amount: escrow, kind: 'refund', ref: m.id });
        else atomic(this.db, () => this._releaseBase(m, userId, escrow, pay));
        for (const p of pay) await this.wallet.payout(p);
        throw e;
      }
      for (const p of pay) await this.wallet.payout(p);
      this._emit(m.id);
      return this.present(order, m);
    });
  }

  _match(m, takerId, pay) {
    const t = this.db.prepare('SELECT * FROM book_orders WHERE id=?').get(takerId);
    let left = t.qty;
    let tEscrow = t.escrow;
    for (const o of this._opposite(m, t.side)) {
      if (!left) break;
      if (t.type === 'limit' && (t.side === 'buy' ? o.price > t.price : o.price < t.price)) break;
      if (o.user_id === t.user_id) continue; // self-trade prevention
      const q = Math.min(left, o.qty - o.filled);
      const cost = mulDiv(o.price, q, m.base_scale);
      const fee = this._fee(m, cost);
      const buyer = t.side === 'buy' ? t : o;
      const seller = t.side === 'buy' ? o : t;

      // base: seller escrow -> buyer
      this._deliverBase(m, seller.user_id, buyer.user_id, q, pay);
      // quote: buyer escrow -> seller (taker pays fee)
      const sellerGets = t.side === 'sell' ? cost - fee : cost;
      if (sellerGets > 0) pay.push({ src: ESCROW, dst: userOwner(seller.user_id), asset: m.quote, amount: sellerGets, kind: m.kind, ref: m.id });
      if (fee > 0) pay.push({ src: ESCROW, dst: FEES, asset: m.quote, amount: fee, kind: 'fee', ref: m.id });

      // maker bookkeeping
      const makerFilled = o.filled + q;
      const makerEscrow = o.escrow - (o.side === 'buy' ? cost : q);
      const makerDone = makerFilled === o.qty;
      if (makerDone && makerEscrow > 0) this._refund(m, o, makerEscrow, pay);
      this.db.prepare('UPDATE book_orders SET filled=?, escrow=?, status=? WHERE id=?').run(makerFilled, makerDone ? 0 : makerEscrow, makerDone ? 'filled' : 'open', o.id);

      tEscrow -= t.side === 'buy' ? cost + fee : q;
      left -= q;
      this.db.prepare('INSERT INTO book_fills (market,price,qty,buy_order,sell_order,buyer,seller,taker_side) VALUES (?,?,?,?,?,?,?,?)')
        .run(m.id, o.price, q, buyer.id, seller.id, buyer.user_id, seller.user_id, t.side);
    }
    const filled = t.qty - left;
    let status = left ? 'open' : 'filled';
    if (left && t.type === 'market') status = 'cancelled';
    if (status !== 'open' && tEscrow > 0) { this._refund(m, t, tEscrow, pay); tEscrow = 0; }
    this.db.prepare('UPDATE book_orders SET filled=?, escrow=?, status=? WHERE id=?').run(filled, tEscrow, status, t.id);
  }

  _refund(m, o, amount, pay) {
    if (amount <= 0) return;
    if (o.side === 'buy') pay.push({ src: ESCROW, dst: userOwner(o.user_id), asset: m.quote, amount, kind: 'refund', ref: m.id });
    else this._releaseBase(m, o.user_id, amount, pay);
  }

  async cancel(userId, orderId) {
    const o0 = this.db.prepare('SELECT * FROM book_orders WHERE id=?').get(orderId);
    if (!o0 || (userId !== null && o0.user_id !== userId)) throw new HttpError(404, 'Order not found');
    const m = this.market(o0.market);
    return this.mutex.run(m.id, async () => {
      const pay = [];
      atomic(this.db, () => {
        const o = this.db.prepare("SELECT * FROM book_orders WHERE id=? AND status='open'").get(orderId);
        if (!o) throw new HttpError(409, 'Order is no longer open');
        this._refund(m, o, o.escrow, pay);
        this.db.prepare("UPDATE book_orders SET status='cancelled', escrow=0 WHERE id=?").run(o.id);
      });
      for (const p of pay) await this.wallet.payout(p);
      this._emit(m.id);
      return { ok: true };
    });
  }

  // ---------- read side ----------
  present(o, m = this.market(o.market)) {
    const q = (v) => (m.base_scale === 1 ? v : fromUnits(v));
    return { id: o.id, market: o.market, side: o.side, type: o.type, price: o.price ? fromUnits(o.price) : null, qty: q(o.qty), filled: q(o.filled), status: o.status, created_at: o.created_at };
  }

  depth(marketId, levels = 20) {
    const m = this.market(marketId);
    const agg = (side, dir) => this.db.prepare(`SELECT price, SUM(qty-filled) q FROM book_orders WHERE market=? AND status='open' AND side=? GROUP BY price ORDER BY price ${dir} LIMIT ?`).all(m.id, side, levels)
      .map((r) => [fromUnits(r.price), m.base_scale === 1 ? r.q : fromUnits(r.q)]);
    return { market: m.id, bids: agg('buy', 'DESC'), asks: agg('sell', 'ASC') };
  }

  trades(marketId, limit = 50) {
    const m = this.market(marketId);
    return this.db.prepare('SELECT id, price, qty, taker_side, created_at FROM book_fills WHERE market=? ORDER BY id DESC LIMIT ?').all(m.id, limit)
      .map((f) => ({ id: f.id, price: fromUnits(f.price), qty: m.base_scale === 1 ? f.qty : fromUnits(f.qty), side: f.taker_side, time: f.created_at }));
  }

  ticker(marketId) {
    const m = this.market(marketId);
    const last = this.db.prepare('SELECT price FROM book_fills WHERE market=? ORDER BY id DESC LIMIT 1').get(m.id);
    const open = this.db.prepare("SELECT price FROM book_fills WHERE market=? AND created_at >= datetime('now','-1 day') ORDER BY id ASC LIMIT 1").get(m.id);
    const vol = this.db.prepare("SELECT COALESCE(SUM(qty),0) v FROM book_fills WHERE market=? AND created_at >= datetime('now','-1 day')").get(m.id).v;
    const bid = this.db.prepare("SELECT MAX(price) p FROM book_orders WHERE market=? AND status='open' AND side='buy'").get(m.id).p;
    const ask = this.db.prepare("SELECT MIN(price) p FROM book_orders WHERE market=? AND status='open' AND side='sell'").get(m.id).p;
    const change = last && open ? ((last.price - open.price) / open.price) * 100 : 0;
    return {
      market: m.id, base: m.base, quote: m.quote,
      last: last ? fromUnits(last.price) : null, bid: bid ? fromUnits(bid) : null, ask: ask ? fromUnits(ask) : null,
      change_24h: Number(change.toFixed(2)), volume_24h: m.base_scale === 1 ? vol : fromUnits(vol),
    };
  }

  openOrders(userId, marketId) {
    const rows = marketId
      ? this.db.prepare("SELECT * FROM book_orders WHERE user_id=? AND market=? AND status='open' ORDER BY id DESC").all(userId, marketId)
      : this.db.prepare("SELECT * FROM book_orders WHERE user_id=? AND status='open' ORDER BY id DESC").all(userId);
    return rows.map((o) => this.present(o));
  }
  history(userId, marketId, limit = 50) {
    return this.db.prepare("SELECT * FROM book_orders WHERE user_id=? AND market LIKE ? AND status!='open' ORDER BY id DESC LIMIT ?").all(userId, marketId || '%', limit).map((o) => this.present(o));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(marketId) { for (const fn of this.listeners) { try { fn(marketId); } catch {} } }
}

/** Convert user input to units for a market. */
function parseOrderInput(m, body) {
  const qty = m.base_scale === 1 ? Number(body.qty) : toUnits(String(body.qty));
  const price = body.type === 'market' ? 0 : toUnits(String(body.price));
  return { side: body.side, type: body.type || 'limit', qty, price };
}

module.exports = { OrderBook, parseOrderInput, ESCROW, FEES };
