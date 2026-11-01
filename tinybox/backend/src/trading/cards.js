'use strict';
/**
 * Trading-card exchange. Catalogue is grouped game -> series -> products
 * (sealed boxes, sealed packs, single cards in RAW or graded condition).
 * Every product SKU has its own order book (CARD:<sku>) on the shared
 * OrderBook, paid from the unified wallet.
 *
 * Physical custody ("vault") model: users ship cards in, staff verify and
 * credit them; holdings trade instantly; users can request shipping out or
 * a "break" (staff open a sealed pack/box and credit the pulled cards).
 */
const { HttpError } = require('../provisioner');
const { atomic } = require('../atomic');
const { parseOrderInput } = require('./book');

class CardsExchange {
  constructor({ db, book, events = null }) { this.db = db; this.book = book; this.events = events || { emit() {} }; }

  catalog() {
    const games = this.db.prepare('SELECT * FROM card_games ORDER BY sort').all();
    const series = this.db.prepare('SELECT * FROM card_series ORDER BY game_id, released DESC').all();
    return games.map((g) => ({ ...g, series: series.filter((s) => s.game_id === g.id) }));
  }

  _withTicker(p) { const t = this.book.ticker(`CARD:${p.sku}`); return { ...p, last: t.last, bid: t.bid, ask: t.ask, change_24h: t.change_24h, volume_24h: t.volume_24h }; }

  series(seriesId) {
    const s = this.db.prepare('SELECT s.*, g.name game_name FROM card_series s JOIN card_games g ON g.id=s.game_id WHERE s.id=?').get(seriesId);
    if (!s) throw new HttpError(404, 'Series not found');
    const products = this.db.prepare("SELECT * FROM card_products WHERE series_id=? ORDER BY CASE kind WHEN 'box' THEN 0 WHEN 'pack' THEN 1 ELSE 2 END, number, grade").all(seriesId);
    return { ...s, products: products.map((p) => this._withTicker(p)) };
  }

  product(sku) {
    const p = this.db.prepare('SELECT p.*, s.name series_name, s.code series_code, s.game_id, g.name game_name FROM card_products p JOIN card_series s ON s.id=p.series_id JOIN card_games g ON g.id=s.game_id WHERE p.sku=?').get(sku);
    if (!p) throw new HttpError(404, 'Item not found');
    return { ...this._withTicker(p), depth: this.book.depth(`CARD:${sku}`), trades: this.book.trades(`CARD:${sku}`, 30) };
  }

  search(q) {
    const like = `%${String(q || '').slice(0, 50)}%`;
    return this.db.prepare('SELECT p.*, s.name series_name FROM card_products p JOIN card_series s ON s.id=p.series_id WHERE p.name LIKE ? OR p.sku LIKE ? OR s.name LIKE ? LIMIT 50').all(like, like, like).map((p) => this._withTicker(p));
  }

  place(userId, sku, body) {
    const m = this.book.market(`CARD:${sku}`);
    const input = parseOrderInput(m, body);
    if (!Number.isInteger(input.qty)) throw new HttpError(400, 'Quantity must be a whole number');
    return this.book.place(userId, m.id, input);
  }
  cancel(userId, orderId) { return this.book.cancel(userId, Number(orderId)); }
  orders(userId) { return this.book.openOrders(userId).filter((o) => o.market.startsWith('CARD:')); }

  holdings(userId) {
    return this.db.prepare(`SELECT h.sku, h.qty, h.locked, p.name, p.kind, p.grade, p.rarity, s.name series_name
      FROM card_holdings h JOIN card_products p ON p.sku=h.sku JOIN card_series s ON s.id=p.series_id
      WHERE h.user_id=? AND (h.qty>0 OR h.locked>0) ORDER BY s.name, p.name`).all(userId).map((h) => ({ ...h, last: this.book.ticker(`CARD:${h.sku}`).last }));
  }

  // ---------- vault requests ----------
  request(userId, { kind, sku, qty, address, note }) {
    qty = Number(qty);
    if (!['ship_in', 'ship_out', 'break'].includes(kind)) throw new HttpError(400, 'Unknown request type');
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new HttpError(400, 'Quantity must be 1-1000');
    const p = this.db.prepare('SELECT * FROM card_products WHERE sku=?').get(sku);
    if (!p) throw new HttpError(404, 'Item not found');
    if (kind === 'break' && p.kind === 'single') throw new HttpError(400, 'Only sealed packs and boxes can be broken');
    if (kind === 'ship_out' && !String(address || '').trim()) throw new HttpError(400, 'Enter a shipping address');
    return atomic(this.db, () => {
      if (kind !== 'ship_in') {
        // Lock the items so they can't be sold while the request is pending.
        const r = this.db.prepare('UPDATE card_holdings SET qty=qty-?, locked=locked+? WHERE user_id=? AND sku=? AND qty>=?').run(qty, qty, userId, sku, qty);
        if (!r.changes) throw new HttpError(400, "You don't own enough of this item");
      }
      const id = Number(this.db.prepare('INSERT INTO card_requests (user_id, kind, sku, qty, address, note) VALUES (?,?,?,?,?,?)').run(userId, kind, sku, qty, address || null, note || null).lastInsertRowid);
      const row = this.db.prepare('SELECT * FROM card_requests WHERE id=?').get(id);
      this.events.emit('cards.request.created', { request: row, userId });
      return row;
    });
  }
  requests(userId) {
    return (userId === null
      ? this.db.prepare("SELECT r.*, u.email FROM card_requests r JOIN users u ON u.id=r.user_id ORDER BY r.status='pending' DESC, r.id DESC LIMIT 200").all()
      : this.db.prepare('SELECT * FROM card_requests WHERE user_id=? ORDER BY id DESC LIMIT 100').all(userId)
    ).map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null }));
  }

  /** Admin: complete a request. For breaks, `pulls` = [{sku, qty}] credited to the user. */
  complete(id, { tracking, pulls, reject, note } = {}) {
    return atomic(this.db, () => {
      const r = this.db.prepare("SELECT * FROM card_requests WHERE id=? AND status='pending'").get(id);
      if (!r) throw new HttpError(404, 'No pending request');
      const credit = (sku, qty) => this.db.prepare('INSERT INTO card_holdings (user_id, sku, qty) VALUES (?,?,?) ON CONFLICT(user_id, sku) DO UPDATE SET qty=qty+excluded.qty').run(r.user_id, sku, qty);
      const unlock = (back) => this.db.prepare(`UPDATE card_holdings SET locked=locked-?, qty=qty+? WHERE user_id=? AND sku=?`).run(r.qty, back ? r.qty : 0, r.user_id, r.sku);
      if (reject) {
        if (r.kind !== 'ship_in') unlock(true);
      } else if (r.kind === 'ship_in') {
        credit(r.sku, r.qty);
      } else if (r.kind === 'ship_out') {
        unlock(false);
      } else {
        if (!Array.isArray(pulls) || !pulls.length) throw new HttpError(400, 'List the pulled cards');
        for (const pl of pulls) {
          if (!this.db.prepare('SELECT 1 FROM card_products WHERE sku=?').get(pl.sku)) throw new HttpError(400, `Unknown sku ${pl.sku}`);
          if (!(Number.isInteger(pl.qty) && pl.qty > 0)) throw new HttpError(400, 'Bad pull quantity');
        }
        unlock(false);
        for (const pl of pulls) credit(pl.sku, pl.qty);
      }
      this.db.prepare('UPDATE card_requests SET status=?, tracking=?, note=COALESCE(?, note), result=? WHERE id=?')
        .run(reject ? 'rejected' : 'completed', tracking || null, note || null, pulls ? JSON.stringify(pulls) : null, id);
      const row = this.db.prepare('SELECT * FROM card_requests WHERE id=?').get(id);
      this.events.emit('cards.request.completed', { request: row, userId: r.user_id, rejected: !!reject });
      return row;
    });
  }
}

module.exports = { CardsExchange };
