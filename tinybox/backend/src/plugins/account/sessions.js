'use strict';
/**
 * Session store (one row per issued JWT), login history and new-device
 * detection.
 *
 *   OWASP Session Management Cheat Sheet  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
 *   User-Agent grammar (RFC 9110 §10.1.5)  https://www.rfc-editor.org/rfc/rfc9110#name-user-agent
 */
const crypto = require('node:crypto');
const { toSql } = require('../../db');

/** Short human description of a User-Agent: "Chrome on Windows", "Safari on iPhone", "Expo app", "API client". */
function describeUa(ua = '') {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  if (/okhttp|Expo|ReactNative/i.test(s)) return 'Mobile app';
  if (/node|python|curl|wget|axios|go-http|java|libwww|httpie|postman/i.test(s)) return 'API client';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : 'unknown OS';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /HeadlessChrome/.test(s) ? 'Chrome' : 'Browser';
  return `${browser} on ${os}`;
}

const ipOf = (req) => (req ? String(req.ip || req.socket?.remoteAddress || '') : '');
const uaOf = (req) => (req ? String(req.headers?.['user-agent'] || '').slice(0, 300) : '');

class Sessions {
  constructor({ db, config, events, log }) {
    this.db = db; this.cfg = config; this.events = events; this.log = log;
    this.q = {
      insert: db.prepare('INSERT INTO sessions (jti, user_id, method, ip, user_agent, device, expires_at) VALUES (?,?,?,?,?,?,?)'),
      get: db.prepare('SELECT * FROM sessions WHERE jti=?'),
      touch: db.prepare("UPDATE sessions SET last_seen_at=datetime('now'), ip=? WHERE jti=?"),
      list: db.prepare("SELECT jti, method, ip, device, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY last_seen_at DESC"),
      revoke: db.prepare("UPDATE sessions SET revoked_at=datetime('now'), revoked_reason=? WHERE jti=? AND user_id=? AND revoked_at IS NULL"),
      revokeAll: db.prepare("UPDATE sessions SET revoked_at=datetime('now'), revoked_reason=? WHERE user_id=? AND revoked_at IS NULL AND jti != ?"),
      count: db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))"),
      purge: db.prepare("DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < datetime('now', ?)) OR (expires_at IS NOT NULL AND expires_at < datetime('now', ?))"),
      history: db.prepare('INSERT INTO login_history (user_id, email, ip, user_agent, device, ok, method, reason, new_device) VALUES (?,?,?,?,?,?,?,?,?)'),
      historyList: db.prepare('SELECT id, ip, device, user_agent, ok, method, reason, new_device, created_at FROM login_history WHERE user_id=? ORDER BY id DESC LIMIT ?'),
      historyPurge: db.prepare("DELETE FROM login_history WHERE created_at < datetime('now', ?)"),
      lastLogin: db.prepare('SELECT created_at, ip, device FROM login_history WHERE user_id=? AND ok=1 ORDER BY id DESC LIMIT 1'),
      deviceGet: db.prepare('SELECT 1 FROM known_devices WHERE user_id=? AND device=?'),
      deviceAny: db.prepare('SELECT 1 FROM known_devices WHERE user_id=? LIMIT 1'),
      deviceUpsert: db.prepare("INSERT INTO known_devices (user_id, device, label) VALUES (?,?,?) ON CONFLICT(user_id, device) DO UPDATE SET last_seen_at=datetime('now')"),
    };
  }

  // ---- store used by core auth ----
  create({ jti, userId, req, method, expiresAt }) {
    this.q.insert.run(jti, userId, method, ipOf(req) || null, uaOf(req) || null, describeUa(uaOf(req)), expiresAt ? toSql(expiresAt) : null);
  }
  lookup(jti) { return this.q.get.get(jti); }
  touch(row, req) {
    // At most one write per minute per session.
    const last = new Date(String(row.last_seen_at).replace(' ', 'T') + 'Z').getTime();
    const ip = ipOf(req);
    if (Date.now() - last > 60 * 1000 || (ip && ip !== row.ip)) this.q.touch.run(ip || row.ip, row.jti);
  }

  // ---- user-facing ----
  list(userId, currentJti = null) {
    return this.q.list.all(userId).map((s) => ({ id: s.jti, method: s.method, ip: s.ip, device: s.device, user_agent: s.user_agent, created_at: s.created_at, last_seen_at: s.last_seen_at, expires_at: s.expires_at, current: s.jti === currentJti }));
  }
  count(userId) { return this.q.count.get(userId).n; }
  /** Revoke one session. Ownership is part of the WHERE clause, so a user can never revoke someone else's. */
  revoke(userId, jti, reason = 'user') { return this.q.revoke.run(reason, jti, userId).changes === 1; }
  revokeAll(userId, { except = null, reason = 'user' } = {}) { return this.q.revokeAll.run(reason, userId, except || '').changes; }

  /**
   * Record a login attempt. For successful logins, detects a device (browser+OS) never seen for this user and
   * emits `account.new_device` – but not for the very first login after registration.
   */
  recordLogin({ user, userId = user?.id || null, email, req, ok, method = 'password', reason = null }) {
    const ip = ipOf(req) || null, ua = uaOf(req) || null, device = describeUa(ua);
    let newDevice = false;
    if (ok && userId) {
      const seenAny = !!this.q.deviceAny.get(userId);
      const seen = !!this.q.deviceGet.get(userId, device);
      newDevice = seenAny && !seen;
      this.q.deviceUpsert.run(userId, device, device);
    }
    this.q.history.run(userId, email || user?.email || null, ip, ua, device, ok ? 1 : 0, method, reason, newDevice ? 1 : 0);
    if (newDevice) this.events.emit('account.new_device', { userId, user: user ? { id: user.id, email: user.email } : null, ip, device, user_agent: ua, at: new Date().toISOString() });
    return { newDevice, device, ip };
  }
  history(userId, limit = 50) { return this.q.historyList.all(userId, Math.min(500, Math.max(1, Number(limit) || 50))); }
  lastLogin(userId) { return this.q.lastLogin.get(userId); }

  purge() {
    const keepSessions = `-${Math.max(1, this.cfg.sessionRetentionDays || 90)} days`;
    const keepHistory = `-${Math.max(1, this.cfg.loginHistoryRetentionDays || 365)} days`;
    return this.q.purge.run(keepSessions, keepSessions).changes + this.q.historyPurge.run(keepHistory).changes;
  }
}

const deviceHash = (ua) => crypto.createHash('sha256').update(String(ua || '')).digest('hex').slice(0, 16);

module.exports = { Sessions, describeUa, deviceHash, ipOf, uaOf };
