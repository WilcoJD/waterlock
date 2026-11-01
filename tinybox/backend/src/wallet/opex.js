'use strict';
/**
 * OPEX (https://github.com/opexdev/core, MIT) as the single wallet of record.
 *
 * Each platform user gets a "shadow" OPEX account (a Keycloak user in the OPEX
 * realm). The backend keeps its random password encrypted and logs in on the
 * user's behalf. OPEX then provides:
 *   - balances:            GET  {api}/opex/v1/wallet/asset              (user token)
 *   - deposit addresses:   GET  {api}/opex/v1/wallet/deposit/address    (user token, bc-gateway)
 *   - withdrawals:         POST {api}/opex/v1/withdraw                  (user token)
 *   - spot orders:         see trading/opex-spot.js
 *   - internal transfers:  POST {wallet}/v2/transfer/{amt}_{sym}/from/{uuid}_MAIN/to/{uuid}_MAIN
 *     used to charge/pay users for cloud, perps, options and cards.
 *
 * SECURITY: OPEX's wallet service permits /v2/transfer and /deposit without a
 * user token on its *internal* port. It must only be reachable from this
 * backend's private network – never expose it publicly.
 *
 * This adapter follows the OPEX API as of late 2026; verify against the
 * version you deploy.
 */
const crypto = require('node:crypto');
const { WalletBase, InsufficientFunds } = require('./base');
const { HttpError } = require('../provisioner');
const { fromUnits, toUnits } = require('../money');

class OpexWallet extends WalletBase {
  constructor({ db, config, log }) {
    super({ db, log });
    this.c = config.opex;
    this.key = crypto.createHash('sha256').update(this.c.secretKey || config.jwtSecret).digest();
    this.tokens = new Map(); // userId -> { token, exp }
    this.adminToken = null;
  }
  get kind() { return 'opex'; }

  // ---------- crypto helpers ----------
  _enc(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }
  _dec(b64) {
    const b = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }

  async _http(url, { method = 'GET', token, json, form } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error_description || data.error)) || res.statusText;
      const e = new Error(`OPEX ${method} ${url.replace(/\?.*/, '')} -> ${res.status}: ${msg}`);
      e.status = res.status; e.data = data;
      throw e;
    }
    return data;
  }

  // ---------- Keycloak ----------
  async _admin() {
    if (this.adminToken && this.adminToken.exp > Date.now() + 10000) return this.adminToken.token;
    const r = await this._http(`${this.c.keycloakUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST', form: { grant_type: 'password', client_id: 'admin-cli', username: this.c.keycloakAdminUser, password: this.c.keycloakAdminPass },
    });
    this.adminToken = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
    return r.access_token;
  }

  /** Create the user's shadow OPEX account if it doesn't exist yet. */
  async ensureAccount(userId) {
    const row = this.db.prepare('SELECT * FROM opex_accounts WHERE user_id=?').get(userId);
    if (row) return row;
    const user = this.db.prepare('SELECT email FROM users WHERE id=?').get(userId);
    const username = `${this.c.usernamePrefix}${userId}`;
    const password = crypto.randomBytes(24).toString('base64url');
    const admin = await this._admin();
    const realm = this.c.realm;
    try {
      await this._http(`${this.c.keycloakUrl}/admin/realms/${realm}/users`, {
        method: 'POST', token: admin,
        json: { username, email: user.email, emailVerified: true, enabled: true, credentials: [{ type: 'password', value: password, temporary: false }], attributes: { platformUserId: [String(userId)] } },
      });
    } catch (e) { if (e.status !== 409) throw e; }
    const found = await this._http(`${this.c.keycloakUrl}/admin/realms/${realm}/users?exact=true&username=${encodeURIComponent(username)}`, { token: admin });
    if (!found?.[0]?.id) throw new Error('OPEX user was not created');
    // If the user already existed (409), reset its password so we know it.
    await this._http(`${this.c.keycloakUrl}/admin/realms/${realm}/users/${found[0].id}/reset-password`, { method: 'PUT', token: admin, json: { type: 'password', value: password, temporary: false } });
    this.db.prepare('INSERT OR REPLACE INTO opex_accounts (user_id, opex_uuid, username, secret) VALUES (?,?,?,?)').run(userId, found[0].id, username, this._enc(password));
    return this.db.prepare('SELECT * FROM opex_accounts WHERE user_id=?').get(userId);
  }

  async userToken(userId) {
    const t = this.tokens.get(userId);
    if (t && t.exp > Date.now() + 10000) return t.token;
    const acc = await this.ensureAccount(userId);
    const r = await this._http(`${this.c.keycloakUrl}/realms/${this.c.realm}/protocol/openid-connect/token`, {
      method: 'POST', form: { grant_type: 'password', client_id: this.c.clientId, ...(this.c.clientSecret ? { client_secret: this.c.clientSecret } : {}), username: acc.username, password: this._dec(acc.secret) },
    });
    this.tokens.set(userId, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
    return r.access_token;
  }

  async _uuid(owner) {
    if (owner.startsWith('sys:')) {
      const id = this.c.systemAccounts[owner.slice(4)] || this.c.systemAccounts.default;
      if (!id) throw new Error(`No OPEX system account configured for ${owner}`);
      return id;
    }
    return (await this.ensureAccount(Number(owner.slice(2)))).opex_uuid;
  }

  // ---------- WalletPort ----------
  async balances(owner) {
    if (owner.startsWith('sys:')) return [];
    const token = await this.userToken(Number(owner.slice(2)));
    const list = await this._http(`${this.c.apiUrl}/opex/v1/wallet/asset`, { token });
    const m = new Map((list || []).map((a) => [String(a.asset).toUpperCase(), a]));
    return this.assets().map((a) => ({ asset: a.symbol, balance: m.has(a.symbol) ? toUnits(String(m.get(a.symbol).balance)) : 0, locked: m.has(a.symbol) ? toUnits(String(m.get(a.symbol).locked || 0)) : 0 }));
  }
  async balance(owner, asset) {
    return (await this.balances(owner)).find((b) => b.asset === asset)?.balance || 0;
  }

  async transfer({ src, dst, asset, amount, kind, ref }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'Amount must be positive');
    if (src === dst) return;
    const [from, to] = await Promise.all([this._uuid(src), this._uuid(dst)]);
    try {
      await this._http(`${this.c.walletUrl}/v2/transfer/${fromUnits(amount)}_${asset}/from/${from}_MAIN/to/${to}_MAIN`, {
        method: 'POST', json: { description: `${kind}${ref ? ' ' + ref : ''}`, transferRef: `${kind}:${ref || ''}:${crypto.randomUUID()}`, transferCategory: 'NO_CATEGORY' },
      });
    } catch (e) {
      if (e.status === 400 && /balance|insufficient/i.test(JSON.stringify(e.data || ''))) throw new InsufficientFunds(asset);
      throw e;
    }
    const tx = this.newTx();
    this._log(tx, src, asset, -amount, kind, ref);
    this._log(tx, dst, asset, amount, kind, ref);
    return tx;
  }

  async depositAddress(userId, asset, chain) {
    const gw = this.c.gateways[`${asset}:${chain}`];
    if (!gw) throw new HttpError(400, `Deposits of ${asset} on ${chain} are not enabled`);
    const cached = this.db.prepare('SELECT address FROM deposit_addresses WHERE user_id=? AND asset=? AND chain=?').get(userId, asset, chain);
    if (cached) return { address: cached.address };
    const token = await this.userToken(userId);
    const r = await this._http(`${this.c.apiUrl}/opex/v1/wallet/deposit/address?currency=${encodeURIComponent(asset)}&gatewayUuid=${encodeURIComponent(gw)}`, { token });
    const address = r.address || r.depositAddress || r?.[0]?.address;
    if (!address) throw new Error('OPEX returned no deposit address');
    this.db.prepare('INSERT OR REPLACE INTO deposit_addresses (user_id, asset, chain, address) VALUES (?,?,?,?)').run(userId, asset, chain, address);
    return { address, memo: r.memo || null };
  }

  async requestWithdraw(userId, req) {
    const a = this._validateWithdraw(userId, req);
    const token = await this.userToken(userId);
    const r = await this._http(`${this.c.apiUrl}/opex/v1/withdraw`, {
      method: 'POST', token,
      json: { currency: a.symbol, amount: fromUnits(req.amount), destAddress: req.address, destNetwork: req.chain, destSymbol: a.symbol, destNote: null, gatewayUuid: this.c.gateways[`${a.symbol}:${req.chain}`] || null },
    });
    const info = this.db.prepare('INSERT INTO withdrawals (user_id, asset, chain, address, amount, fee, external_id, status) VALUES (?,?,?,?,?,?,?,?)')
      .run(userId, a.symbol, req.chain, req.address, req.amount, a.withdraw_fee, String(r?.withdrawUuid || r?.uuid || ''), 'pending');
    return Number(info.lastInsertRowid);
  }

  // Deposits are credited by OPEX's bc-gateway automatically; admins approve withdrawals in the OPEX admin panel.
  async credit() { throw new HttpError(400, 'With OPEX, deposits are credited by the blockchain gateway (or the OPEX admin panel).'); }
  async approveWithdrawal() { throw new HttpError(400, 'Approve withdrawals in the OPEX admin panel'); }
  async rejectWithdrawal() { throw new HttpError(400, 'Reject withdrawals in the OPEX admin panel'); }
}

module.exports = { OpexWallet };
