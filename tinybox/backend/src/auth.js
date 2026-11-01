'use strict';
/**
 * Core authentication.
 *
 * Session tokens are JWTs (RFC 7519) carried as `Authorization: Bearer`
 * (RFC 6750). Every token gets a `jti`; when a session store is attached
 * (the `account` plugin does this) the jti must map to a live, non-revoked
 * row in the `sessions` table so "log out everywhere", admin revocation and
 * password resets really end a session. Plugins can also register extra
 * request authenticators (`auth.addStrategy`) – the account plugin uses it
 * for API keys – so one `requireAuth` protects every endpoint.
 *
 * References:
 *   RFC 7519 JSON Web Token            https://www.rfc-editor.org/rfc/rfc7519
 *   RFC 6750 Bearer Token Usage         https://www.rfc-editor.org/rfc/rfc6750
 *   OWASP Session Management Cheat Sheet https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
 *   jsonwebtoken                        https://github.com/auth0/node-jsonwebtoken
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

class AuthFailure extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; this.expose = true; }
}

// Columns of `users` that are safe to put on req.user (never the password hash).
const USER_COLUMNS = ['id', 'email', 'is_admin', 'banned', 'created_at', 'email_verified', 'locked', 'locked_reason', 'must_reset_password', 'pending_email', 'deleted_at', 'password_changed_at'];

function makeAuth({ db, config, log = console }) {
  const strategies = [];      // [{ name, authenticate(req) -> { user, auth } | null }]
  const decorators = [];      // fn(user, out) -> adds fields to the public user object
  let sessions = null;        // { create({jti,userId,req,method,expiresAt}), lookup(jti), touch(row, req) }
  let userSelect = null;

  function selectUser() {
    if (!userSelect) {
      const have = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
      userSelect = db.prepare(`SELECT ${USER_COLUMNS.filter((c) => have.has(c)).join(', ')} FROM users WHERE id=?`);
    }
    return userSelect;
  }
  /** Public user row (no secrets) or undefined. */
  function loadUser(id) {
    if (id === undefined || id === null || id === '') return undefined;
    return selectUser().get(Number(id));
  }

  /** The user object returned to clients (`{ token, user }`, `/me`). Plugins add fields with addUserDecorator. */
  function presentUser(u) {
    const out = { id: u.id, email: u.email, is_admin: !!u.is_admin, email_verified: !!u.email_verified };
    for (const fn of decorators) { try { fn(u, out); } catch (e) { log.error?.('[auth] user decorator failed', e.message); } }
    return out;
  }

  /**
   * Issue a session token for a user. opts: { req, method, expiresIn }.
   * With a session store attached, a `sessions` row is created so the token can be revoked.
   */
  function sign(user, opts = {}) {
    const jti = crypto.randomBytes(16).toString('hex');
    const expiresIn = opts.expiresIn || config.account?.sessionTtl || '30d';
    const token = jwt.sign({ sub: user.id, jti }, config.jwtSecret, { expiresIn });
    if (sessions) {
      const { exp } = jwt.decode(token);
      sessions.create({ jti, userId: user.id, req: opts.req, method: opts.method || 'password', expiresAt: new Date(exp * 1000) });
    }
    return token;
  }

  function checkUserState(user) {
    if (!user || user.deleted_at) throw new AuthFailure(401, 'Account not found', 'ACCOUNT_NOT_FOUND');
    if (user.banned) throw new AuthFailure(403, 'Account suspended', 'ACCOUNT_SUSPENDED');
    if (user.locked) throw new AuthFailure(403, 'Account locked. Contact support.', 'ACCOUNT_LOCKED');
  }

  /** Resolve a session JWT to { user, auth }. Synchronous so WebSocket upgrades can use it. */
  function fromJwt(token, { touch = false, req = null } = {}) {
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); }
    catch (e) { throw new AuthFailure(401, 'Session expired, please log in again', e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'); }
    // Purpose tokens (password reset, 2FA challenge, email verification) are signed with the same key but are never sessions.
    if (payload.purpose || typeof payload !== 'object') throw new AuthFailure(401, 'Not a session token', 'TOKEN_INVALID');
    const user = loadUser(payload.sub);
    checkUserState(user);
    let session = null;
    if (sessions) {
      if (!payload.jti) throw new AuthFailure(401, 'Session expired, please log in again', 'SESSION_REVOKED');
      session = sessions.lookup(payload.jti);
      if (!session || session.revoked_at) throw new AuthFailure(401, 'Session expired, please log in again', 'SESSION_REVOKED');
      if (touch) { try { sessions.touch(session, req); } catch (e) { log.error?.('[auth] session touch failed', e.message); } }
    }
    return { user, auth: { via: 'session', jti: payload.jti || null, session } };
  }

  /** Authenticate a request through the registered strategies, then the Bearer JWT. Throws AuthFailure / HttpError. */
  async function authenticate(req) {
    for (const s of strategies) {
      const r = await s.authenticate(req);
      if (r) { checkUserState(r.user); return r; }
    }
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    if (!token) throw new AuthFailure(401, 'Not logged in', 'NOT_LOGGED_IN');
    return fromJwt(token, { touch: true, req });
  }

  function sendFailure(res, e) {
    res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.data !== undefined ? { data: e.data } : {}) });
  }

  function requireAuth(req, res, next) {
    authenticate(req).then(({ user, auth }) => { req.user = user; req.auth = auth; next(); }, (e) => {
      if (e && e.status && e.status < 500) return sendFailure(res, e);
      next(e);
    });
  }

  /** Returns the user for a session JWT, or null. Used by WebSocket upgrades and plugins. */
  function verifyToken(token) {
    try { return fromJwt(String(token || '')).user; } catch { return null; }
  }

  function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' });
      if (req.auth && req.auth.via !== 'session') return res.status(403).json({ error: 'API keys cannot use admin endpoints', code: 'API_KEY_FORBIDDEN' });
      next();
    });
  }

  return {
    sign, verifyToken, requireAuth, requireAdmin, authenticate, presentUser, loadUser,
    /** Register a request authenticator: fn(req) -> { user, auth } | null (null = not this strategy). */
    addStrategy(name, authenticateFn) { strategies.push({ name, authenticate: authenticateFn }); return () => { const i = strategies.findIndex((s) => s.authenticate === authenticateFn); if (i >= 0) strategies.splice(i, 1); }; },
    /** Attach the session store (the account plugin). */
    useSessions(store) { sessions = store; },
    addUserDecorator(fn) { decorators.push(fn); },
    AuthFailure,
  };
}

module.exports = { makeAuth, AuthFailure };
