'use strict';
/**
 * Perpetual futures (USDT-margined, isolated margin) priced off the index
 * oracle, in the style of the Opex-v2 perpetuals platform: the platform is
 * the counterparty (sys:perps), positions open/close at index ± spread,
 * and are liquidated when losses reach the margin minus maintenance.
 */
const { HttpError } = require('../provisioner');
const { toUnits, fromUnits } = require('../money');
const { userOwner } = require('../wallet/base');
const { KeyedMutex } = require('../atomic');

class PerpsEngine {
  constructor({ db, wallet, oracle, config, log = console, events = null }) {
    this.db = db; this.wallet = wallet; this.oracle = oracle; this.log = log;
    this.events = events || { emit() {} };
    this.c = config.perps;
    this.mutex = new KeyedMutex();
    this.unsub = oracle.onPrice((sym, price) => this._onPrice(sym, price).catch((e) => log.error?.('[perps]', e)));
  }

  markets() {
    return this.c.symbols.map((s) => ({ symbol: s, index: this.oracle.prices.get(s)?.price ?? null, max_leverage: this.c.maxLeverage, fee_bps: this.c.feeBps, maintenance: this.c.maintenance }));
  }

  _liq(side, entry, lev) {
    const m = this.c.maintenance;
    return side === 'long' ? entry * (1 - 1 / lev + m) : entry * (1 + 1 / lev - m);
  }

  async open(userId, { symbol, side, margin, leverage, tp, sl }) {
    if (!this.c.symbols.includes(symbol)) throw new HttpError(400, 'Unknown market');
    if (!['long', 'short'].includes(side)) throw new HttpError(400, 'side must be long or short');
    leverage = Math.floor(Number(leverage));
    if (!(leverage >= 1 && leverage <= this.c.maxLeverage)) throw new HttpError(400, `Leverage must be 1-${this.c.maxLeverage}x`);
    const marginU = toUnits(String(margin));
    if (marginU < toUnits(this.c.minMargin)) throw new HttpError(400, `Minimum margin is ${this.c.minMargin} USDT`);

    return this.mutex.run(`u${userId}`, async () => {
      const notional = (marginU / 1e8) * leverage;
      const openNotional = this.db.prepare("SELECT COALESCE(SUM(qty*entry),0) n FROM perp_positions WHERE user_id=? AND status='open'").get(userId).n;
      if (openNotional + notional > this.c.maxNotionalPerUser) throw new HttpError(400, `Position limit reached (max ${this.c.maxNotionalPerUser} USDT notional)`);
      const idx = this.oracle.price(symbol);
      const entry = side === 'long' ? idx * (1 + this.c.spread) : idx * (1 - this.c.spread);
      const qty = notional / entry;
      const fee = Math.round(notional * this.c.feeBps / 10000 * 1e8);
      const liq = this._liq(side, entry, leverage);
      if (tp != null && tp !== '' && (side === 'long' ? Number(tp) <= entry : Number(tp) >= entry)) throw new HttpError(400, 'Take-profit must be beyond the entry price');
      if (sl != null && sl !== '' && (side === 'long' ? Number(sl) >= entry || Number(sl) <= liq : Number(sl) <= entry || Number(sl) >= liq)) throw new HttpError(400, 'Stop-loss must be between entry and liquidation price');

      await this.wallet.transfer({ src: userOwner(userId), dst: 'sys:perps', asset: 'USDT', amount: marginU + fee, kind: 'perps', ref: `open ${symbol}` });
      if (fee) await this.wallet.payout({ src: 'sys:perps', dst: 'sys:fees', asset: 'USDT', amount: fee, kind: 'fee', ref: 'perps' });
      const id = Number(this.db.prepare('INSERT INTO perp_positions (user_id,symbol,side,qty,entry,leverage,margin,liq_price,tp,sl) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(userId, symbol, side, qty, entry, leverage, marginU, liq, tp ? Number(tp) : null, sl ? Number(sl) : null).lastInsertRowid);
      const pos = this.present(this.db.prepare('SELECT * FROM perp_positions WHERE id=?').get(id));
      this.events.emit('perps.opened', { position: pos, userId });
      return pos;
    });
  }

  _pnl(p, price) { return (price - p.entry) * p.qty * (p.side === 'long' ? 1 : -1); }

  async close(userId, id, reason = 'closed') {
    return this.mutex.run(`u${userId}`, async () => {
      const p = this.db.prepare("SELECT * FROM perp_positions WHERE id=? AND status='open'").get(id);
      if (!p || (userId !== null && p.user_id !== userId)) throw new HttpError(404, 'Position not found');
      const idx = this.oracle.price(p.symbol);
      const exit = p.side === 'long' ? idx * (1 - this.c.spread) : idx * (1 + this.c.spread);
      const pnl = Math.round(this._pnl(p, exit) * 1e8);
      const fee = Math.round(p.qty * exit * this.c.feeBps / 10000 * 1e8);
      const back = Math.max(0, p.margin + pnl - fee);
      const r = this.db.prepare("UPDATE perp_positions SET status=?, exit_price=?, pnl=?, closed_at=datetime('now') WHERE id=? AND status='open'").run(reason, exit, back - p.margin, id);
      if (!r.changes) throw new HttpError(409, 'Position already closed');
      await this.wallet.payout({ src: 'sys:perps', dst: userOwner(p.user_id), asset: 'USDT', amount: back, kind: 'perps', ref: `close ${p.symbol}` });
      const feeTaken = Math.min(fee, Math.max(0, p.margin + pnl));
      if (feeTaken) await this.wallet.payout({ src: 'sys:perps', dst: 'sys:fees', asset: 'USDT', amount: feeTaken, kind: 'fee', ref: 'perps' });
      const pos = this.present(this.db.prepare('SELECT * FROM perp_positions WHERE id=?').get(id));
      this.events.emit('perps.closed', { position: pos, userId: p.user_id, reason });
      return pos;
    });
  }

  async _onPrice(symbol, price) {
    const open = this.db.prepare("SELECT * FROM perp_positions WHERE symbol=? AND status='open'").all(symbol);
    for (const p of open) {
      const long = p.side === 'long';
      if (long ? price <= p.liq_price : price >= p.liq_price) {
        this.db.prepare("UPDATE perp_positions SET status='liquidated', exit_price=?, pnl=?, closed_at=datetime('now') WHERE id=? AND status='open'").run(price, -p.margin, p.id);
        this.log.info?.(`[perps] liquidated #${p.id}`);
        this.events.emit('perps.liquidated', { position: this.present(this.db.prepare('SELECT * FROM perp_positions WHERE id=?').get(p.id)), userId: p.user_id, price });
      } else if ((p.tp && (long ? price >= p.tp : price <= p.tp)) || (p.sl && (long ? price <= p.sl : price >= p.sl))) {
        await this.close(null, p.id, 'closed').catch(() => {});
      }
    }
  }

  present(p) {
    let mark = null, upnl = null;
    try { mark = this.oracle.price(p.symbol); } catch {}
    if (p.status === 'open' && mark) upnl = this._pnl(p, mark);
    return {
      id: p.id, symbol: p.symbol, side: p.side, qty: Number(p.qty.toFixed(8)), entry: Number(p.entry.toFixed(4)), leverage: p.leverage,
      margin: fromUnits(p.margin), liq_price: Number(p.liq_price.toFixed(4)), tp: p.tp, sl: p.sl, status: p.status,
      mark, unrealized_pnl: upnl === null ? null : Number(upnl.toFixed(4)), roe_pct: upnl === null ? null : Number(((upnl / (p.margin / 1e8)) * 100).toFixed(2)),
      exit_price: p.exit_price, realized_pnl: p.pnl === null ? null : fromUnits(p.pnl), opened_at: p.opened_at, closed_at: p.closed_at,
    };
  }

  positions(userId, status = 'open') {
    const rows = status === 'open'
      ? this.db.prepare("SELECT * FROM perp_positions WHERE user_id=? AND status='open' ORDER BY id DESC").all(userId)
      : this.db.prepare("SELECT * FROM perp_positions WHERE user_id=? AND status!='open' ORDER BY id DESC LIMIT 100").all(userId);
    return rows.map((p) => this.present(p));
  }
}

module.exports = { PerpsEngine };
