'use strict';
/**
 * European, cash-settled (USDT) options on the index price. The platform
 * quotes every strike/expiry with Black-Scholes at a configured implied
 * volatility plus a spread (sys:options is the counterparty). Users buy
 * calls/puts, may sell them back at the bid before expiry, and are paid
 * the intrinsic value automatically at expiry (08:00 UTC).
 */
const { HttpError } = require('../provisioner');
const { fromUnits } = require('../money');
const { userOwner } = require('../wallet/base');

// Abramowitz-Stegun normal CDF
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function blackScholes(kind, S, K, T, vol) {
  if (T <= 0) return { price: Math.max(0, kind === 'call' ? S - K : K - S), delta: kind === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0) };
  const d1 = (Math.log(S / K) + (vol * vol / 2) * T) / (vol * Math.sqrt(T));
  const d2 = d1 - vol * Math.sqrt(T);
  return kind === 'call'
    ? { price: S * ncdf(d1) - K * ncdf(d2), delta: ncdf(d1) }
    : { price: K * ncdf(-d2) - S * ncdf(-d1), delta: ncdf(d1) - 1 };
}

const YEAR_MS = 365 * 24 * 3600e3;

class OptionsEngine {
  constructor({ db, wallet, oracle, config, log = console }) {
    this.db = db; this.wallet = wallet; this.oracle = oracle; this.log = log;
    this.c = config.options;
  }

  /** Next N daily expiries plus the next M Fridays, all 08:00 UTC. */
  expiries(now = new Date()) {
    const out = new Set();
    const at8 = (d) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8)); return x; };
    let d = at8(now); if (d <= now) d = new Date(d.getTime() + 864e5);
    for (let i = 0; i < this.c.dailyExpiries; i++) out.add(new Date(d.getTime() + i * 864e5).toISOString());
    let f = at8(now); while (f.getUTCDay() !== 5 || f <= now) f = new Date(f.getTime() + 864e5);
    for (let i = 0; i < this.c.weeklyExpiries; i++) out.add(new Date(f.getTime() + i * 7 * 864e5).toISOString());
    return [...out].sort();
  }

  strikes(symbol, S) {
    const step = this.c.strikeStep[symbol];
    const atm = Math.round(S / step) * step;
    const n = this.c.strikesEachSide;
    return Array.from({ length: n * 2 + 1 }, (_, i) => atm + (i - n) * step).filter((k) => k > 0);
  }

  quote(symbol, kind, strike, expiry, now = Date.now()) {
    const S = this.oracle.price(symbol);
    const T = (new Date(expiry).getTime() - now) / YEAR_MS;
    const { price, delta } = blackScholes(kind, S, strike, T, this.c.iv[symbol]);
    const minTick = this.c.minPremium;
    const ask = Math.max(minTick, price * (1 + this.c.spread));
    const bid = Math.max(0, price * (1 - this.c.spread) - minTick);
    return { mark: price, bid, ask, delta, iv: this.c.iv[symbol], spot: S };
  }

  chain(symbol) {
    if (!this.c.symbols.includes(symbol)) throw new HttpError(400, 'Unknown underlying');
    const S = this.oracle.price(symbol);
    const r2 = (x) => Number(x.toFixed(2));
    return {
      symbol, spot: S, iv: this.c.iv[symbol],
      expiries: this.expiries().map((expiry) => ({
        expiry,
        rows: this.strikes(symbol, S).map((strike) => {
          const c = this.quote(symbol, 'call', strike, expiry);
          const p = this.quote(symbol, 'put', strike, expiry);
          return { strike, call: { bid: r2(c.bid), ask: r2(c.ask), delta: r2(c.delta) }, put: { bid: r2(p.bid), ask: r2(p.ask), delta: r2(p.delta) } };
        }),
      })),
    };
  }

  async buy(userId, { symbol, kind, strike, expiry, qty }) {
    if (!this.c.symbols.includes(symbol)) throw new HttpError(400, 'Unknown underlying');
    if (!['call', 'put'].includes(kind)) throw new HttpError(400, 'kind must be call or put');
    strike = Number(strike); qty = Number(qty);
    if (!this.expiries().includes(expiry)) throw new HttpError(400, 'That expiry is not listed');
    if (!this.strikes(symbol, this.oracle.price(symbol)).includes(strike)) throw new HttpError(400, 'That strike is not listed right now');
    if (!(qty >= this.c.minQty) || Math.round(qty / this.c.minQty) * this.c.minQty - qty > 1e-9) throw new HttpError(400, `Quantity must be a multiple of ${this.c.minQty}`);
    const q = this.quote(symbol, kind, strike, expiry);
    const premium = Math.round(q.ask * qty * 1e8);
    const fee = Math.round(Math.min(q.spot * qty * this.c.feeRate, q.ask * qty * 0.125) * 1e8); // capped at 12.5% of premium
    const openPremium = this.db.prepare("SELECT COALESCE(SUM(premium),0) n FROM option_positions WHERE user_id=? AND status='open'").get(userId).n;
    if ((openPremium + premium) / 1e8 > this.c.maxPremiumPerUser) throw new HttpError(400, `Options limit reached (max ${this.c.maxPremiumPerUser} USDT in open premium)`);
    await this.wallet.transfer({ src: userOwner(userId), dst: 'sys:options', asset: 'USDT', amount: premium + fee, kind: 'options', ref: `buy ${symbol} ${strike} ${kind}` });
    if (fee) await this.wallet.payout({ src: 'sys:options', dst: 'sys:fees', asset: 'USDT', amount: fee, kind: 'fee', ref: 'options' });
    const id = Number(this.db.prepare('INSERT INTO option_positions (user_id,symbol,kind,strike,expiry,qty,premium) VALUES (?,?,?,?,?,?,?)').run(userId, symbol, kind, strike, expiry, qty, premium).lastInsertRowid);
    return this.present(this.db.prepare('SELECT * FROM option_positions WHERE id=?').get(id));
  }

  /** Sell back to the platform at the current bid. */
  async close(userId, id) {
    const p = this.db.prepare("SELECT * FROM option_positions WHERE id=? AND user_id=? AND status='open'").get(id, userId);
    if (!p) throw new HttpError(404, 'Position not found');
    if (new Date(p.expiry) <= new Date()) throw new HttpError(409, 'This option has expired and is being settled');
    const q = this.quote(p.symbol, p.kind, p.strike, p.expiry);
    const value = Math.round(q.bid * p.qty * 1e8);
    const r = this.db.prepare("UPDATE option_positions SET status='closed', payout=?, settle_price=?, closed_at=datetime('now') WHERE id=? AND status='open'").run(value, q.spot, id);
    if (!r.changes) throw new HttpError(409, 'Already closed');
    await this.wallet.payout({ src: 'sys:options', dst: userOwner(userId), asset: 'USDT', amount: value, kind: 'options', ref: `close #${id}` });
    return this.present(this.db.prepare('SELECT * FROM option_positions WHERE id=?').get(id));
  }

  /** Cash-settle everything past expiry at the current index. Run every minute. */
  async settle(now = new Date()) {
    const due = this.db.prepare("SELECT * FROM option_positions WHERE status='open' AND expiry <= ?").all(now.toISOString());
    for (const p of due) {
      let S; try { S = this.oracle.price(p.symbol); } catch { continue; }
      const intrinsic = Math.max(0, p.kind === 'call' ? S - p.strike : p.strike - S);
      const payout = Math.round(intrinsic * p.qty * 1e8);
      const r = this.db.prepare("UPDATE option_positions SET status='settled', payout=?, settle_price=?, closed_at=datetime('now') WHERE id=? AND status='open'").run(payout, S, p.id);
      if (r.changes && payout > 0) await this.wallet.payout({ src: 'sys:options', dst: userOwner(p.user_id), asset: 'USDT', amount: payout, kind: 'options', ref: `settle #${p.id}` });
    }
  }

  present(p) {
    let mark = null;
    if (p.status === 'open') { try { mark = this.quote(p.symbol, p.kind, p.strike, p.expiry).bid * p.qty; } catch {} }
    return {
      id: p.id, symbol: p.symbol, kind: p.kind, strike: p.strike, expiry: p.expiry, qty: p.qty, premium: fromUnits(p.premium), status: p.status,
      value: mark === null ? null : Number(mark.toFixed(2)), pnl: mark === null ? null : Number((mark - p.premium / 1e8).toFixed(2)),
      payout: p.payout === null ? null : fromUnits(p.payout), settle_price: p.settle_price, opened_at: p.opened_at, closed_at: p.closed_at,
    };
  }

  positions(userId, status = 'open') {
    const rows = status === 'open'
      ? this.db.prepare("SELECT * FROM option_positions WHERE user_id=? AND status='open' ORDER BY expiry, id").all(userId)
      : this.db.prepare("SELECT * FROM option_positions WHERE user_id=? AND status!='open' ORDER BY id DESC LIMIT 100").all(userId);
    return rows.map((p) => this.present(p));
  }
}

module.exports = { OptionsEngine, blackScholes };
