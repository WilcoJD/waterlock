'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('../provisioner');
const { fromUnits } = require('../money');

const userOwner = (userId) => (userId === 0 ? 'sys:mm' : `u:${userId}`);

/**
 * Shared behaviour for wallet backends. Every money movement in every
 * product (cloud, spot, perps, options, cards) goes through transfer().
 * Payouts from platform accounts go through payout(), which falls back to a
 * retry outbox so a temporary failure never loses a user's money.
 */
class WalletBase {
  constructor({ db, log = console }) { this.db = db; this.log = log; this.events = { emit() {} }; }

  assets() {
    return this.db.prepare('SELECT * FROM assets ORDER BY sort').all().map((a) => ({
      symbol: a.symbol, name: a.name, chains: JSON.parse(a.chains), withdraw_fee: fromUnits(a.withdraw_fee), min_withdraw: fromUnits(a.min_withdraw),
    }));
  }
  asset(symbol) {
    const a = this.db.prepare('SELECT * FROM assets WHERE symbol=?').get(String(symbol || '').toUpperCase());
    if (!a) throw new HttpError(400, `Unknown asset ${symbol}`);
    return { ...a, chains: JSON.parse(a.chains) };
  }

  /** Audit log of every movement we initiate (and the ledger itself for the local backend). */
  _log(tx, owner, asset, delta, kind, ref) {
    this.db.prepare('INSERT INTO wallet_entries (tx, owner, asset, delta, kind, ref) VALUES (?,?,?,?,?,?)').run(tx, owner, asset, delta, kind, ref || null);
    if (owner.startsWith('u:')) this.events.emit('wallet.transfer', { userId: Number(owner.slice(2)), asset, delta, kind, ref, tx });
  }
  newTx() { return crypto.randomUUID(); }

  entries(owner, limit = 100) {
    return this.db.prepare('SELECT id, asset, delta, kind, ref, created_at FROM wallet_entries WHERE owner=? ORDER BY id DESC LIMIT ?').all(owner, limit)
      .map((e) => ({ ...e, amount: fromUnits(e.delta) }));
  }

  /** Pay out from a platform account; never throws – failures are queued and retried. */
  async payout(t) {
    if (!(t.amount > 0)) return;
    try {
      await this.transfer(t);
    } catch (e) {
      this.log.error?.('[wallet] payout queued:', e.message);
      this.db.prepare('INSERT INTO wallet_outbox (src,dst,asset,amount,kind,ref,last_error) VALUES (?,?,?,?,?,?,?)').run(t.src, t.dst, t.asset, t.amount, t.kind, t.ref || null, e.message);
    }
  }

  async processOutbox() {
    for (const o of this.db.prepare('SELECT * FROM wallet_outbox ORDER BY id LIMIT 100').all()) {
      try {
        await this.transfer({ src: o.src, dst: o.dst, asset: o.asset, amount: o.amount, kind: o.kind, ref: o.ref });
        this.db.prepare('DELETE FROM wallet_outbox WHERE id=?').run(o.id);
      } catch (e) {
        this.db.prepare('UPDATE wallet_outbox SET attempts=attempts+1, last_error=? WHERE id=?').run(e.message, o.id);
      }
    }
  }

  withdrawals(userId) {
    return this.db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 100').all(userId)
      .map((w) => ({ id: w.id, asset: w.asset, chain: w.chain, address: w.address, amount: fromUnits(w.amount), fee: fromUnits(w.fee), status: w.status, txid: w.txid, created_at: w.created_at }));
  }

  _validateWithdraw(userId, { asset, chain, address, amount }) {
    const a = this.asset(asset);
    if (!a.chains.includes(chain)) throw new HttpError(400, `${a.symbol} can't be withdrawn on ${chain}`);
    if (!/^[A-Za-z0-9:_-]{20,128}$/.test(String(address || ''))) throw new HttpError(400, 'Enter a valid address');
    if (amount < a.min_withdraw) throw new HttpError(400, `Minimum withdrawal is ${fromUnits(a.min_withdraw)} ${a.symbol}`);
    return a;
  }
}

class InsufficientFunds extends HttpError {
  constructor(asset) { super(400, `Insufficient ${asset} balance`); }
}

module.exports = { WalletBase, InsufficientFunds, userOwner };
