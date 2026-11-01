'use strict';
/**
 * DEMO liquidity bot (MARKET_MAKER=true, local wallet only). Keeps a few
 * bid/ask levels on every spot market around the oracle price and on every
 * card market around a reference price, as platform user 0 (sys:mm).
 * Never enable this in production – it trades with house money.
 */
const { toUnits } = require('../money');
const crypto = require('node:crypto');

const REF = { box: 120, pack: 5, 'Secret Rare': 80, Mythic: 90, 'Ultra Rare': 30, Legendary: 35, Rare: 4, Uncommon: 0.6, Common: 0.15 };

class MarketMaker {
  constructor({ db, book, oracle, log = console }) { this.db = db; this.book = book; this.oracle = oracle; this.log = log; }

  cardRef(p) {
    let v = p.kind === 'single' ? REF[p.rarity] || 1 : REF[p.kind];
    if (p.grade && p.grade !== 'RAW' && p.grade !== 'SEALED') v *= 4;
    const h = crypto.createHash('md5').update(p.sku).digest()[0] / 255; // stable per-sku variation
    return v * (0.7 + h * 0.6);
  }

  async _quote(marketId, mid, { levels, step, size, decimals }) {
    for (const o of this.book.openOrders(0, marketId)) await this.book.cancel(0, o.id).catch(() => {});
    const m = this.book.market(marketId);
    const round = (p) => Math.max(m.tick, Math.round(toUnits(p.toFixed(decimals)) / m.tick) * m.tick);
    for (let i = 1; i <= levels; i++) {
      await this.book.place(0, marketId, { side: 'buy', type: 'limit', price: round(mid * (1 - step * i)), qty: size(i) }).catch((e) => this.log.warn?.('[mm]', e.message));
      await this.book.place(0, marketId, { side: 'sell', type: 'limit', price: round(mid * (1 + step * i)), qty: size(i) }).catch((e) => this.log.warn?.('[mm]', e.message));
    }
  }

  async tick() {
    for (const m of this.db.prepare("SELECT * FROM markets WHERE kind='spot' AND active=1").all()) {
      let mid; try { mid = this.oracle.price(m.base); } catch { continue; }
      await this._quote(m.id, mid, { levels: 5, step: 0.0008, decimals: 3, size: (i) => Math.max(m.min_qty, toUnits(((500 * i) / mid).toFixed(6))) });
    }
    for (const p of this.db.prepare('SELECT * FROM card_products').all()) {
      const id = `CARD:${p.sku}`;
      if (this.book.openOrders(0, id).length) continue; // cards: quote once, refresh only when taken out
      await this._quote(id, this.cardRef(p), { levels: 3, step: 0.04, decimals: 2, size: (i) => i });
    }
  }

  start(intervalMs = 15000) {
    const loop = async () => { await this.tick().catch((e) => this.log.error?.('[mm]', e)); this.t = setTimeout(loop, intervalMs); this.t.unref?.(); };
    loop();
  }
}

module.exports = { MarketMaker };
