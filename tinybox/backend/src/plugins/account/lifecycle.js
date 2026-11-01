'use strict';
/**
 * Account lifecycle: GDPR data export (Art. 15/20), account deletion
 * (Art. 17, implemented as anonymisation because ledger lines must stay
 * balanced) and email change with verification of the new address.
 *
 *   GDPR Art. 15, 17, 20   https://gdpr-info.eu/art-15-gdpr/  https://gdpr-info.eu/art-17-gdpr/  https://gdpr-info.eu/art-20-gdpr/
 *   OWASP: anonymise rather than hard-delete when financial records must be retained
 */
const crypto = require('node:crypto');
const { HttpError } = require('../../provisioner');
const { fromUnits } = require('../../money');
const { atomic } = require('../../atomic');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class Lifecycle {
  constructor({ ctx, config, tokens, sessions, apiKeys, mailer }) {
    this.ctx = ctx; this.cfg = config; this.tokens = tokens; this.sessions = sessions; this.apiKeys = apiKeys; this.mailer = mailer;
    this.db = ctx.db;
  }

  all(sql, ...args) { try { return this.db.prepare(sql).all(...args); } catch { return []; } }

  /** Everything we hold about a user, as plain JSON. Secrets (hashes, TOTP seeds, API secrets) are never included. */
  async exportData(userId) {
    const db = this.db;
    const u = db.prepare('SELECT id, email, is_admin, created_at, email_verified, locked, pending_email, password_changed_at FROM users WHERE id=?').get(userId);
    const owner = `u:${userId}`;
    let balances = [];
    try { balances = (await this.ctx.wallet.balances(owner)).map((b) => ({ asset: b.asset, balance: fromUnits(b.balance), locked: b.locked ? fromUnits(b.locked) : '0' })); } catch {}
    const money = (rows, fields) => rows.map((r) => { const o = { ...r }; for (const f of fields) if (o[f] !== null && o[f] !== undefined) o[f] = fromUnits(o[f]); return o; });
    return {
      exported_at: new Date().toISOString(),
      profile: { ...u, is_admin: !!u.is_admin, email_verified: !!u.email_verified, two_factor_enabled: !!db.prepare('SELECT 1 FROM user_totp WHERE user_id=? AND enabled=1').get(userId) },
      wallet: {
        balances,
        ledger: money(this.all('SELECT id, tx, asset, delta, kind, ref, created_at FROM wallet_entries WHERE owner=? ORDER BY id', owner), ['delta']),
        withdrawals: money(this.all('SELECT id, asset, chain, address, amount, fee, status, txid, created_at FROM withdrawals WHERE user_id=? ORDER BY id', userId), ['amount', 'fee']),
        deposit_addresses: this.all('SELECT asset, chain, address FROM deposit_addresses WHERE user_id=?', userId),
      },
      trading: {
        orders: this.all('SELECT id, market, side, type, price, qty, filled, status, created_at FROM book_orders WHERE user_id=? ORDER BY id', userId),
        fills: this.all('SELECT id, market, price, qty, taker_side, created_at, CASE WHEN buyer=? THEN \'buy\' ELSE \'sell\' END side FROM book_fills WHERE buyer=? OR seller=? ORDER BY id', userId, userId, userId),
        perp_positions: money(this.all('SELECT * FROM perp_positions WHERE user_id=? ORDER BY id', userId), ['margin', 'pnl']),
        option_positions: money(this.all('SELECT * FROM option_positions WHERE user_id=? ORDER BY id', userId), ['premium', 'payout']),
        card_holdings: this.all('SELECT sku, qty, locked FROM card_holdings WHERE user_id=?', userId),
        card_requests: this.all('SELECT id, kind, sku, qty, status, address, tracking, note, result, created_at FROM card_requests WHERE user_id=? ORDER BY id', userId),
      },
      cloud: {
        servers: this.all('SELECT id, hostname, plan_id, state, provider, ip, subdomain, custom_domain, created_at, expires_at, deleted_at FROM servers WHERE user_id=? ORDER BY id', userId),
        orders: this.all('SELECT id, plan_id, server_id, kind, amount_cents, status, pay_with, created_at FROM orders WHERE user_id=? ORDER BY id', userId),
        ad_rewards: this.all('SELECT id, server_id, source, created_at FROM ad_rewards WHERE user_id=? ORDER BY id', userId),
        vpn: this.all('SELECT vpn_ip, created_at FROM vpn_peers WHERE user_id=?', userId),
      },
      security: {
        sessions: this.sessions.list(userId),
        login_history: this.sessions.history(userId, 500),
        api_keys: this.apiKeys.list(userId),
        audit: this.all('SELECT id, actor_id, action, details, ip, created_at FROM audit_log WHERE target_id=? OR actor_id=? ORDER BY id DESC LIMIT 1000', userId, userId).map((a) => ({ ...a, details: safeJson(a.details) })),
      },
    };
  }

  /** Reasons an account cannot be deleted yet (empty array = deletable). */
  async deletionBlockers(userId) {
    const db = this.db, owner = `u:${userId}`, out = [];
    try { for (const b of await this.ctx.wallet.balances(owner)) if (Number(b.balance) !== 0 || Number(b.locked || 0) !== 0) out.push(`Wallet still holds ${fromUnits(b.balance)} ${b.asset}: withdraw it first`); } catch { out.push('Wallet balances could not be checked'); }
    const n = (sql) => { try { return db.prepare(sql).get(userId).n; } catch { return 0; } };
    if (n("SELECT COUNT(*) n FROM servers WHERE user_id=? AND state NOT IN ('deleted')")) out.push('Delete your servers first');
    if (n("SELECT COUNT(*) n FROM book_orders WHERE user_id=? AND status='open'")) out.push('Cancel your open orders first');
    if (n("SELECT COUNT(*) n FROM perp_positions WHERE user_id=? AND status='open'")) out.push('Close your futures positions first');
    if (n("SELECT COUNT(*) n FROM option_positions WHERE user_id=? AND status='open'")) out.push('Close or wait for your options positions first');
    if (n("SELECT COUNT(*) n FROM withdrawals WHERE user_id=? AND status='pending'")) out.push('Wait for pending withdrawals to complete');
    if (n("SELECT COUNT(*) n FROM card_requests WHERE user_id=? AND status='pending'")) out.push('Wait for pending vault requests to complete');
    if (n('SELECT COUNT(*) n FROM card_holdings WHERE user_id=? AND (qty > 0 OR locked > 0)')) out.push('Ship out or sell your vaulted cards first');
    return out;
  }

  /** Anonymise the account: email, password and secrets are destroyed; ledger and audit rows stay (balanced books). */
  async deleteAccount(user, { ip = null } = {}) {
    const blockers = await this.deletionBlockers(user.id);
    if (blockers.length) throw new HttpError(409, 'Your account still has assets or servers', { code: 'ACCOUNT_HAS_ASSETS', data: { blockers } });
    const db = this.db;
    const anon = `deleted-${user.id}-${crypto.randomBytes(4).toString('hex')}@deleted.invalid`;
    atomic(db, () => {
      db.prepare("UPDATE users SET email=?, password_hash=?, email_verified=0, pending_email=NULL, deleted_at=datetime('now'), locked=1, locked_reason='deleted' WHERE id=?").run(anon, `deleted:${crypto.randomBytes(16).toString('hex')}`, user.id);
      db.prepare('DELETE FROM user_totp WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM backup_codes WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM known_devices WHERE user_id=?').run(user.id);
      db.prepare('DELETE FROM deposit_addresses WHERE user_id=?').run(user.id);
      db.prepare("UPDATE account_tokens SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL").run(user.id);
      this.sessions.revokeAll(user.id, { reason: 'account_deleted' });
      this.apiKeys.revokeAll(user.id);
    });
    this.ctx.audit(user.id, 'account.deleted', { email_hash: crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 16) }, { targetId: user.id, ip });
    this.ctx.events.emit('account.deleted', { userId: user.id });
    return { ok: true };
  }

  async requestEmailChange(user, newEmailRaw, { ip = null } = {}) {
    const newEmail = String(newEmailRaw || '').trim().toLowerCase();
    if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) throw new HttpError(400, 'Enter a valid email', { code: 'VALIDATION' });
    if (newEmail === user.email) throw new HttpError(400, 'That is already your email', { code: 'VALIDATION' });
    if (this.db.prepare('SELECT 1 FROM users WHERE email=?').get(newEmail)) throw new HttpError(409, 'That email is already in use', { code: 'EMAIL_TAKEN' });
    this.db.prepare('UPDATE users SET pending_email=? WHERE id=?').run(newEmail, user.id);
    const { token } = this.tokens.issue({ userId: user.id, purpose: 'email-change', ttlMs: this.cfg.verifyTokenTtlHours * 3600 * 1000, claims: { email: newEmail } });
    const { sent } = await this.mailer.emailChange(newEmail, user, token);
    this.ctx.audit(user.id, 'account.email_change.requested', { new_email: newEmail }, { targetId: user.id, ip });
    return { pending_email: newEmail, sent, ...(this.cfg.devReturnTokens ? { dev_token: token } : {}) };
  }

  confirmEmailChange(token, { ip = null } = {}) {
    const { payload } = this.tokens.consume(token, 'email-change');
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(payload.sub);
    if (!user || user.deleted_at || user.pending_email !== payload.email) throw new HttpError(400, 'This link is invalid or has expired', { code: 'TOKEN_INVALID' });
    if (this.db.prepare('SELECT 1 FROM users WHERE email=? AND id != ?').get(payload.email, user.id)) throw new HttpError(409, 'That email is already in use', { code: 'EMAIL_TAKEN' });
    const old = user.email;
    this.db.prepare('UPDATE users SET email=?, pending_email=NULL, email_verified=1 WHERE id=?').run(payload.email, user.id);
    this.ctx.audit(user.id, 'account.email_changed', { from: old, to: payload.email }, { targetId: user.id, ip });
    this.ctx.events.emit('account.email_changed', { userId: user.id, from: old, to: payload.email });
    return this.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

module.exports = { Lifecycle, EMAIL_RE };
