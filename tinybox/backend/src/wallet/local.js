'use strict';
const { WalletBase, InsufficientFunds } = require('./base');
const { atomic } = require('../atomic');
const { HttpError } = require('../provisioner');

/**
 * Double-entry ledger in SQLite. Used for development, tests and for
 * operators who don't run OPEX. Deposits are credited by an admin (or the
 * dev faucet); withdrawals are queued for an admin to send and approve.
 * Platform ('sys:') accounts may go negative: that is the house P&L.
 */
class LocalWallet extends WalletBase {
  get kind() { return 'local'; }

  balanceSync(owner, asset) {
    return this.db.prepare('SELECT balance FROM wallet_balances WHERE owner=? AND asset=?').get(owner, asset)?.balance || 0;
  }
  async balance(owner, asset) { return this.balanceSync(owner, asset); }

  async balances(owner) {
    const rows = this.db.prepare('SELECT asset, balance FROM wallet_balances WHERE owner=?').all(owner);
    const m = new Map(rows.map((r) => [r.asset, r.balance]));
    return this.assets().map((a) => ({ asset: a.symbol, balance: m.get(a.symbol) || 0 }));
  }

  transferSync({ src, dst, asset, amount, kind, ref }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'Amount must be positive');
    if (src === dst) return;
    return atomic(this.db, () => {
      const bal = this.balanceSync(src, asset);
      if (!src.startsWith('sys:') && bal < amount) throw new InsufficientFunds(asset);
      const up = this.db.prepare(`INSERT INTO wallet_balances (owner, asset, balance) VALUES (?,?,?)
        ON CONFLICT(owner, asset) DO UPDATE SET balance = balance + excluded.balance`);
      up.run(src, asset, -amount);
      up.run(dst, asset, amount);
      const tx = this.newTx();
      this._log(tx, src, asset, -amount, kind, ref);
      this._log(tx, dst, asset, amount, kind, ref);
      return tx;
    });
  }
  async transfer(t) { return this.transferSync(t); }

  async depositAddress() {
    return { address: null, note: 'On-chain deposits need the OPEX blockchain gateway (WALLET_BACKEND=opex). In local mode an admin credits deposits manually.' };
  }

  /** Admin manual deposit (e.g. after checking a bank/crypto transfer). */
  async credit(userId, asset, amount, ref) {
    const tx = this.transferSync({ src: 'sys:deposits', dst: `u:${userId}`, asset, amount, kind: 'deposit', ref });
    this.events.emit('deposit.credited', { userId, asset, amount, ref, tx });
    return tx;
  }

  async requestWithdraw(userId, req) {
    const a = this._validateWithdraw(userId, req);
    return atomic(this.db, () => {
      this.transferSync({ src: `u:${userId}`, dst: 'sys:withdrawals', asset: a.symbol, amount: req.amount + a.withdraw_fee, kind: 'withdraw', ref: req.address });
      const info = this.db.prepare('INSERT INTO withdrawals (user_id, asset, chain, address, amount, fee) VALUES (?,?,?,?,?,?)').run(userId, a.symbol, req.chain, req.address, req.amount, a.withdraw_fee);
      this.events.emit('withdraw.requested', { userId, id: Number(info.lastInsertRowid), asset: a.symbol, chain: req.chain, address: req.address, amount: req.amount, fee: a.withdraw_fee });
      return Number(info.lastInsertRowid);
    });
  }

  async approveWithdrawal(id, txid) {
    const w = this.db.prepare("SELECT * FROM withdrawals WHERE id=? AND status='pending'").get(id);
    if (!w) throw new HttpError(404, 'No pending withdrawal');
    this.db.prepare("UPDATE withdrawals SET status='sent', txid=? WHERE id=?").run(txid || null, id);
    this.events.emit('withdraw.sent', { userId: w.user_id, id, asset: w.asset, amount: w.amount, txid });
  }
  async rejectWithdrawal(id) {
    atomic(this.db, () => {
      const w = this.db.prepare("SELECT * FROM withdrawals WHERE id=? AND status='pending'").get(id);
      if (!w) throw new HttpError(404, 'No pending withdrawal');
      this.db.prepare("UPDATE withdrawals SET status='rejected' WHERE id=?").run(id);
      this.transferSync({ src: 'sys:withdrawals', dst: `u:${w.user_id}`, asset: w.asset, amount: w.amount + w.fee, kind: 'withdraw_refund', ref: String(id) });
      this.events.emit('withdraw.rejected', { userId: w.user_id, id, asset: w.asset, amount: w.amount });
    });
  }

  async ensureAccount() {}
}

module.exports = { LocalWallet };
