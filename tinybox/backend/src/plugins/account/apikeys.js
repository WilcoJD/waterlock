'use strict';
/**
 * API keys for programmatic trading.
 *
 * Two ways to authenticate, modelled on the big exchanges:
 *   1. Bearer:  Authorization: Bearer pk_<id>.<secret>          (simple scripts; the secret travels with every request)
 *   2. HMAC:    X-API-Key: pk_<id>, X-API-Timestamp: <ms>,
 *               X-API-Signature: hex(HMAC-SHA256(secret, timestamp + METHOD + path + body))
 *               The secret never leaves the client; requests older than `skew` seconds or replayed are refused.
 *
 * Storage: bearer-only keys store a keyed hash of the secret. HMAC-capable keys
 * must keep the secret recoverable (the server has to compute the same MAC), so
 * it is stored AES-256-GCM encrypted under ACCOUNT_SECRET_KEY – the same model
 * Binance/Kraken/Coinbase use. Scopes are checked per request by path prefix:
 * read (GET), trade (orders/positions), withdraw (wallet withdrawals; needs an IP allowlist).
 *
 *   Binance SIGNED endpoints   https://developers.binance.com/docs/binance-spot-api-docs/rest-api/endpoint-security-type
 *   Kraken REST auth           https://docs.kraken.com/api/docs/guides/spot-rest-auth
 *   Coinbase CB-ACCESS-SIGN    https://docs.cdp.coinbase.com/exchange/docs/rest-auth
 *   RFC 2104 HMAC              https://www.rfc-editor.org/rfc/rfc2104
 *   RFC 6750 Bearer            https://www.rfc-editor.org/rfc/rfc6750
 */
const crypto = require('node:crypto');
const net = require('node:net');
const { HttpError } = require('../../provisioner');
const { toSql } = require('../../db');
const { SecretBox } = require('./crypto');

const SCOPES = ['read', 'trade', 'withdraw'];
const KEY_RE = /^pk_[a-f0-9]{16}$/;

/** Which scope a request needs. Order matters: first match wins. */
const DEFAULT_RULES = [
  { re: /^\/api\/auth\/me$/, methods: ['GET'], scope: 'read' },            // "whoami" for bots: shows key scopes
  { re: /^\/api\/wallet\/withdraw$/, methods: ['POST'], scope: 'withdraw' },
  { re: /^\/api\/wallet\/deposit-address$/, methods: ['POST'], scope: 'read' },
  { re: /^\/api\/spot\/[^/]+\/orders(\/|$)/, methods: ['POST', 'DELETE'], scope: 'trade' },
  { re: /^\/api\/perps\/positions(\/|$)/, methods: ['POST'], scope: 'trade' },
  { re: /^\/api\/options\/(buy$|positions\/)/, methods: ['POST'], scope: 'trade' },
  { re: /^\/api\/cards\/(products\/[^/]+\/orders$|orders\/)/, methods: ['POST', 'DELETE'], scope: 'trade' },
];
/** Never reachable with an API key, whatever its scopes. */
const DEFAULT_DENY = [/^\/api\/auth(\/|$)/, /^\/api\/account(\/|$)/, /^\/api\/admin(\/|$)/, /^\/api\/wallet\/faucet$/, /^\/api\/servers(\/|$)/, /^\/api\/shop(\/|$)/, /^\/api\/vpn(\/|$)/, /^\/api\/ads(\/|$)/, /^\/api\/cards\/requests(\/|$)/];

function parseIpList(list) {
  if (list === undefined || list === null || list === '') return [];
  const arr = Array.isArray(list) ? list : String(list).split(/[,\s]+/);
  const out = [];
  for (const raw of arr) {
    const s = String(raw).trim(); if (!s) continue;
    const [ip, bits] = s.split('/');
    const fam = net.isIP(ip);
    if (!fam) throw new HttpError(400, `Invalid IP address: ${s}`, { code: 'INVALID_IP' });
    if (bits !== undefined) { const b = Number(bits); if (!Number.isInteger(b) || b < 0 || b > (fam === 4 ? 32 : 128)) throw new HttpError(400, `Invalid CIDR: ${s}`, { code: 'INVALID_IP' }); }
    out.push(bits !== undefined ? `${ip}/${bits}` : ip);
    if (out.length > 20) throw new HttpError(400, 'At most 20 allowlist entries', { code: 'INVALID_IP' });
  }
  return out;
}

function ipToBigInt(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return ip.split('.').reduce((a, o) => (a << 8n) + BigInt(o), 0n);
  if (fam === 6) {
    // Expand :: and embedded IPv4
    let s = ip;
    if (s.includes('.')) { const parts = s.split(':'); const v4 = parts.pop().split('.').map(Number); parts.push(((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)); s = parts.join(':'); }
    const halves = s.split('::');
    const head = halves[0] ? halves[0].split(':') : [], tail = halves[1] ? halves[1].split(':') : [];
    const groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
    return groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
  }
  return null;
}

/** ip allowed by list of IPs / CIDRs (v4 and v6; ::ffff:a.b.c.d is treated as a.b.c.d). */
function ipAllowed(ip, list) {
  if (!list || !list.length) return true;
  let addr = String(ip || '');
  if (addr.startsWith('::ffff:') && net.isIP(addr.slice(7)) === 4) addr = addr.slice(7);
  const fam = net.isIP(addr); if (!fam) return false;
  const n = ipToBigInt(addr);
  for (const entry of list) {
    const [eip, bits] = entry.split('/');
    const efam = net.isIP(eip); if (efam !== fam) continue;
    const width = fam === 4 ? 32 : 128;
    const b = bits === undefined ? width : Number(bits);
    const mask = b === 0 ? 0n : ((1n << BigInt(width)) - 1n) ^ ((1n << BigInt(width - b)) - 1n);
    if ((n & mask) === (ipToBigInt(eip) & mask)) return true;
  }
  return false;
}

class ApiKeys {
  constructor({ db, config, audit, events, log, box }) {
    this.db = db; this.cfg = config; this.audit = audit; this.events = events; this.log = log;
    this.box = box || new SecretBox(config.secretKey);
    this.rules = [...DEFAULT_RULES];
    this.deny = [...DEFAULT_DENY];
    this.seen = new Map(); // signature -> expiry (replay protection)
    this.q = {
      insert: db.prepare('INSERT INTO api_keys (user_id, key_id, auth_mode, secret_hash, secret_enc, label, scopes, ip_allowlist, expires_at) VALUES (?,?,?,?,?,?,?,?,?)'),
      byKey: db.prepare('SELECT * FROM api_keys WHERE key_id=?'),
      list: db.prepare('SELECT id, key_id, auth_mode, label, scopes, ip_allowlist, expires_at, last_used_at, last_used_ip, created_at, revoked_at FROM api_keys WHERE user_id=? ORDER BY id DESC'),
      count: db.prepare('SELECT COUNT(*) n FROM api_keys WHERE user_id=? AND revoked_at IS NULL'),
      revoke: db.prepare("UPDATE api_keys SET revoked_at=datetime('now') WHERE id=? AND user_id=? AND revoked_at IS NULL"),
      revokeAll: db.prepare("UPDATE api_keys SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL"),
      touch: db.prepare("UPDATE api_keys SET last_used_at=datetime('now'), last_used_ip=? WHERE id=?"),
    };
  }

  addScopeRule(rule) { this.rules.unshift(rule); }
  addDeny(re) { this.deny.push(re); }

  static present(k) {
    return { id: k.id, key_id: k.key_id, auth_mode: k.auth_mode, label: k.label, scopes: JSON.parse(k.scopes || '[]'), ip_allowlist: JSON.parse(k.ip_allowlist || '[]'), expires_at: k.expires_at, last_used_at: k.last_used_at, last_used_ip: k.last_used_ip, created_at: k.created_at, revoked_at: k.revoked_at };
  }

  list(userId) { return this.q.list.all(userId).map(ApiKeys.present); }

  /** Create a key. Returns the secret exactly once. */
  create(userId, { label, scopes, ip_allowlist, expires_in_days, auth_mode } = {}, { ip = null } = {}) {
    const lbl = String(label || '').trim();
    if (!lbl || lbl.length > 60) throw new HttpError(400, 'Label must be 1-60 characters', { code: 'VALIDATION' });
    const sc = [...new Set((Array.isArray(scopes) ? scopes : String(scopes || 'read').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
    if (!sc.length || sc.some((s) => !SCOPES.includes(s))) throw new HttpError(400, `Scopes must be one or more of ${SCOPES.join(', ')}`, { code: 'VALIDATION' });
    const mode = auth_mode === undefined || auth_mode === null || auth_mode === '' ? 'hmac' : String(auth_mode);
    if (!['hmac', 'bearer'].includes(mode)) throw new HttpError(400, "auth_mode must be 'hmac' or 'bearer'", { code: 'VALIDATION' });
    const allow = parseIpList(ip_allowlist);
    if (sc.includes('withdraw') && !allow.length) throw new HttpError(400, 'Keys with the withdraw scope need an IP allowlist', { code: 'IP_ALLOWLIST_REQUIRED' });
    let expiresAt = null;
    if (expires_in_days !== undefined && expires_in_days !== null && expires_in_days !== '') {
      const d = Number(expires_in_days);
      if (!Number.isFinite(d) || d < 1 || d > 365) throw new HttpError(400, 'Expiry must be 1-365 days', { code: 'VALIDATION' });
      expiresAt = toSql(new Date(Date.now() + d * 86400 * 1000));
    }
    if (this.q.count.get(userId).n >= (this.cfg.apiKeysPerUser || 10)) throw new HttpError(409, `You can have at most ${this.cfg.apiKeysPerUser || 10} active API keys`, { code: 'LIMIT' });

    const keyId = `pk_${crypto.randomBytes(8).toString('hex')}`;
    const secret = `sk_${crypto.randomBytes(32).toString('base64url')}`;
    const info = this.q.insert.run(userId, keyId, mode, this.box.mac(secret), mode === 'hmac' ? this.box.encrypt(secret) : null, lbl, JSON.stringify(sc), JSON.stringify(allow), expiresAt);
    const row = this.q.byKey.get(keyId);
    this.audit?.(userId, 'account.api_key.created', { key_id: keyId, label: lbl, scopes: sc, auth_mode: mode, ip_allowlist: allow, expires_at: expiresAt }, { targetId: userId, ip });
    this.events?.emit('account.api_key_created', { userId, key: ApiKeys.present(row) });
    return { key: ApiKeys.present(row), secret, bearer: `${keyId}.${secret}`, id: Number(info.lastInsertRowid) };
  }

  revoke(userId, id, { actorId = userId, ip = null, reason = 'user' } = {}) {
    const ok = this.q.revoke.run(Number(id), userId).changes === 1;
    if (ok) this.audit?.(actorId, 'account.api_key.revoked', { id: Number(id), reason }, { targetId: userId, ip });
    return ok;
  }
  revokeAll(userId) { return this.q.revokeAll.run(userId).changes; }

  /** Scope needed for a request, or throws 403 when the path is off-limits to API keys. */
  requiredScope(req) {
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    const method = String(req.method || 'GET').toUpperCase();
    for (const r of this.rules) if (r.re.test(path) && (!r.methods || r.methods.includes(method))) return r.scope;
    if (this.deny.some((re) => re.test(path))) throw new HttpError(403, 'This endpoint is not available to API keys', { code: 'API_KEY_FORBIDDEN' });
    if (method === 'GET' || method === 'HEAD') return 'read';
    throw new HttpError(403, 'This endpoint is not available to API keys', { code: 'API_KEY_FORBIDDEN' });
  }

  _load(keyId) {
    if (!KEY_RE.test(String(keyId || ''))) throw new HttpError(401, 'Invalid API key', { code: 'API_KEY_INVALID' });
    const k = this.q.byKey.get(keyId);
    if (!k) throw new HttpError(401, 'Invalid API key', { code: 'API_KEY_INVALID' });
    return k;
  }
  _checkState(k, req) {
    if (k.revoked_at) throw new HttpError(401, 'API key revoked', { code: 'API_KEY_REVOKED' });
    if (k.expires_at && new Date(k.expires_at.replace(' ', 'T') + 'Z') < new Date()) throw new HttpError(401, 'API key expired', { code: 'API_KEY_EXPIRED' });
    if (!ipAllowed(req.ip, JSON.parse(k.ip_allowlist || '[]'))) throw new HttpError(403, 'Request IP not in this key\'s allowlist', { code: 'API_KEY_IP' });
  }

  /** Canonical body string for signing: compact JSON of the parsed body, '' when there is none. */
  static bodyCandidates(req) {
    const b = req.body;
    if (b === undefined || b === null || (typeof b === 'object' && !Buffer.isBuffer(b) && Object.keys(b).length === 0)) return ['', '{}'];
    if (Buffer.isBuffer(b)) return [b.toString('utf8')];
    if (typeof b === 'string') return [b];
    return [JSON.stringify(b)];
  }
  static signingString({ timestamp, method, path, body }) { return `${timestamp}${String(method).toUpperCase()}${path}${body}`; }
  static sign(secret, parts) { return crypto.createHmac('sha256', secret).update(ApiKeys.signingString(parts)).digest('hex'); }

  /**
   * Strategy for core auth: returns null when the request carries no API key, otherwise { user, auth } or throws.
   */
  authenticate(req, loadUser) {
    const h = String(req.headers.authorization || '');
    const hdrKey = req.headers['x-api-key'];
    let k, mode;
    if (h.startsWith('Bearer pk_')) {
      const [keyId, secret, ...rest] = h.slice(7).trim().split('.');
      if (!secret || rest.length) throw new HttpError(401, 'Malformed API key: expected pk_<id>.<secret>', { code: 'API_KEY_INVALID' });
      k = this._load(keyId);
      if (!SecretBox.equal(this.box.mac(secret), k.secret_hash)) throw new HttpError(401, 'Invalid API key', { code: 'API_KEY_INVALID' });
      mode = 'bearer';
    } else if (hdrKey) {
      const keyId = String(hdrKey).trim();
      if (keyId.includes('.')) throw new HttpError(401, 'Send only the key id in X-API-Key and sign the request; never send the secret', { code: 'API_KEY_INVALID' });
      k = this._load(keyId);
      if (k.auth_mode !== 'hmac' || !k.secret_enc) throw new HttpError(401, 'This key does not support signed requests', { code: 'API_KEY_MODE' });
      const ts = String(req.headers['x-api-timestamp'] || ''), sig = String(req.headers['x-api-signature'] || '').toLowerCase();
      if (!/^\d{10,16}$/.test(ts) || !/^[a-f0-9]{64}$/.test(sig)) throw new HttpError(401, 'Missing X-API-Timestamp / X-API-Signature', { code: 'API_KEY_SIGNATURE' });
      const tsMs = ts.length <= 10 ? Number(ts) * 1000 : Number(ts);
      const skew = (this.cfg.apiKeySkewSec || 30) * 1000;
      if (Math.abs(Date.now() - tsMs) > skew) throw new HttpError(401, `Timestamp outside the ${skew / 1000}s window; sync your clock (GET /api/account/time)`, { code: 'API_KEY_TIMESTAMP', data: { server_time: Date.now() } });
      this._checkState(k, req);
      const secret = this.box.decrypt(k.secret_enc).toString('utf8');
      const path = String(req.originalUrl || req.url || '');
      const ok = ApiKeys.bodyCandidates(req).some((body) => SecretBox.equal(ApiKeys.sign(secret, { timestamp: ts, method: req.method, path, body }), sig));
      if (!ok) throw new HttpError(401, 'Bad signature', { code: 'API_KEY_SIGNATURE' });
      this._replayCheck(sig, skew);
      mode = 'hmac';
    } else return null;

    this._checkState(k, req);
    const scopes = JSON.parse(k.scopes || '[]');
    const need = this.requiredScope(req);
    if (!scopes.includes(need)) throw new HttpError(403, `This API key lacks the '${need}' scope`, { code: 'API_KEY_SCOPE', data: { required: need, scopes } });
    const user = loadUser(k.user_id);
    if (!user) throw new HttpError(401, 'Account not found', { code: 'ACCOUNT_NOT_FOUND' });
    this.q.touch.run(String(req.ip || ''), k.id);
    return { user, auth: { via: 'api_key', mode, key_id: k.key_id, api_key_id: k.id, scopes } };
  }

  _replayCheck(sig, skew) {
    const now = Date.now();
    if (this.seen.size > 5000 || now % 50 === 0) for (const [s, exp] of this.seen) if (exp < now) this.seen.delete(s);
    if (this.seen.has(sig)) throw new HttpError(401, 'Replayed request', { code: 'API_KEY_REPLAY' });
    this.seen.set(sig, now + skew * 2);
  }
}

module.exports = { ApiKeys, SCOPES, parseIpList, ipAllowed, DEFAULT_RULES, DEFAULT_DENY };
