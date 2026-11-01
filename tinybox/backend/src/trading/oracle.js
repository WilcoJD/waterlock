'use strict';
/**
 * Index prices for derivatives (and the dev market maker).
 * source=coinbase polls Coinbase Exchange public tickers; source=mock is a
 * random walk for development and tests.
 */
const DEFAULT_SEED = { BTC: 95000, ETH: 3500, SOL: 180 };

class PriceOracle {
  constructor({ source = 'mock', symbols = ['BTC', 'ETH', 'SOL'], intervalMs = 2000, seed = DEFAULT_SEED, log = console }) {
    this.source = source; this.symbols = symbols; this.intervalMs = intervalMs; this.log = log;
    this.prices = new Map(symbols.map((s) => [s, { price: seed[s] || 100, at: Date.now() }]));
    this.history = new Map(symbols.map((s) => [s, []]));
    this.listeners = new Set();
    this.timer = null;
  }

  price(symbol) {
    const p = this.prices.get(symbol);
    if (!p) { const e = new Error(`No price for ${symbol}`); e.status = 400; e.expose = true; throw e; }
    if (this.source !== 'mock' && Date.now() - p.at > 60000) { const e = new Error('Price feed is stale – trading paused'); e.status = 503; e.expose = true; throw e; }
    return p.price;
  }
  all() { return Object.fromEntries([...this.prices].map(([k, v]) => [k, v.price])); }
  spark(symbol) { return this.history.get(symbol) || []; }

  /** Manually set a price (tests / admin). */
  set(symbol, price) { this._update(symbol, price); }

  _update(symbol, price) {
    if (!(price > 0)) return;
    this.prices.set(symbol, { price, at: Date.now() });
    const h = this.history.get(symbol); h.push([Date.now(), price]); if (h.length > 300) h.shift();
    for (const fn of this.listeners) { try { fn(symbol, price); } catch (e) { this.log.error?.('[oracle listener]', e); } }
  }
  onPrice(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async tick() {
    if (this.source === 'mock') {
      for (const s of this.symbols) {
        const p = this.prices.get(s).price;
        this._update(s, Number((p * (1 + (Math.random() - 0.5) * 0.002)).toFixed(2)));
      }
      return;
    }
    await Promise.all(this.symbols.map(async (s) => {
      try {
        const r = await fetch(`https://api.exchange.coinbase.com/products/${s}-USD/ticker`, { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'platform-oracle' } });
        if (r.ok) this._update(s, Number((await r.json()).price));
      } catch (e) { this.log.warn?.('[oracle]', s, e.message); }
    }));
  }

  start() {
    if (this.timer) return;
    const loop = async () => { await this.tick().catch(() => {}); this.timer = setTimeout(loop, this.intervalMs); this.timer.unref?.(); };
    loop();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { PriceOracle };
