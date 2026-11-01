# Account security (`account` plugin)

Email verification, password policy and reset, TOTP two-factor authentication with backup codes, revocable sessions with login history, brute-force lockout with optional captcha, API keys for trading bots (bearer or HMAC-signed), GDPR export, account deletion, email change, and an admin **Security** console.

Code: `backend/src/auth.js` (core sessions/strategies), `backend/src/routes/auth.js` (register/login/me/change-password/logout), `backend/src/plugins/account/**` (everything else), `web/js/account.js` (browser), `backend/test/account-security.test.js`.

## What users get

| Feature | Where |
|---|---|
| Verify email (signed link `/#/verify?token=…`, resend with 60 s cooldown). Unverified accounts can browse and trade spot; withdrawals, perps/options and paid cloud checkout require a verified email when `ACCOUNT_REQUIRE_VERIFIED_FOR` says so. | Account → Overview / Security, header badge "Verify email" |
| Forgot password (`/#/forgot`) → single-use link `/#/reset?token=…` (30 min). A reset logs out every session. | Login page link |
| Password policy: ≥ 10 characters (configurable), ≤ 128, no composition rules, ~260 most common passwords (and their "…123", leet variants) refused, must not contain the email. Legacy mode keeps the old "≥ 8" rule. | Register, change password, reset |
| TOTP 2FA (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step, replay-protected) with QR code, manual key, 10 single-use backup codes (regenerable), disable needs password + code. Login then returns a challenge and asks for a code. | Account → Security |
| Step-up: with 2FA on, withdrawals, VPN config downloads, API-key creation, backup-code regeneration, email change, account deletion and admin takeover actions need a fresh code (`x-2fa-code` header; the browser asks automatically through `App.withStepUp`). | everywhere |
| Sessions: every login is a revocable session with device, IP, created/last-seen. Revoke one, "log out everywhere else", explicit logout. Login history with failed attempts and "new device" flags. | Account → Sessions |
| API keys with scopes `read` / `trade` / `withdraw`, optional IP allowlist (required for `withdraw`), optional expiry, bearer or HMAC-signed use; secret shown once. | Account → API keys |
| Data export (JSON), account deletion (blocked while balances, servers, orders, positions or vaulted cards remain; anonymises the account), email change with confirmation of the new address. | Account → Data & privacy / Security |

## Admin → Security tab

* Overview tiles (users, verified, 2FA on, locked, sessions, logins/failures 24 h, lockouts, API keys).
* **Users**: search by email/id, filters (locked, unverified, 2FA, admins, deleted). Per user: lock/unlock (lock revokes all sessions), force password reset (revokes sessions, emails a reset link, next login is refused until reset), disable 2FA (support flow: a reason/ticket is mandatory, every session is revoked, audited as `admin.user.2fa_disabled`), mark email verified, revoke all or single sessions, revoke API keys, clear lockout; sessions, login history, API keys and the audit log for that user.
* **Lockouts**: active brute-force locks (`email:`, `ip:`, `stepup:`, `2fa:` keys) with clear buttons.
* **Audit log**: filter by action prefix and user id.

Admins who have 2FA on must pass a step-up for force-reset and disable-2FA. Admins cannot lock themselves. Admin endpoints are never reachable with API keys.

## Configuration (all optional)

Defaults follow `NODE_ENV`: **strict** behaviour is on in production and off elsewhere so the shared development/test suites (which register users with short passwords and trade without verifying email) keep working. Turn it on anywhere with `ACCOUNT_STRICT=true`, or set the individual keys.

| Key | Default | Meaning |
|---|---|---|
| `ACCOUNT_STRICT` | `true` in production, else `false` | Master default for the two keys below. |
| `ACCOUNT_PASSWORD_POLICY` | `strict` when strict, else `legacy` | `strict`: min length, common list, email check. `legacy`: ≥ 8 chars + email check only. |
| `ACCOUNT_PASSWORD_MIN_LENGTH` | `10` | Minimum length under the strict policy (never below 8). |
| `ACCOUNT_REQUIRE_VERIFIED_FOR` | `withdraw,derivatives,cloud` when strict, else empty | Actions that need a verified email: `withdraw` (`withdraw.before`), `derivatives` (`trade.before` for perps/options), `cloud` (`cloud.checkout.before`). |
| `ACCOUNT_DEV_RETURN_TOKENS` | `true` outside production | Return verification/reset/email-change tokens in API responses (`dev_token`) so flows work without a mail transport. **Must be false in production.** |
| `ACCOUNT_VERIFY_TTL_HOURS` | `24` | Lifetime of email-verification links. |
| `ACCOUNT_VERIFY_RESEND_COOLDOWN_SEC` | `60` | Minimum gap between verification mails. |
| `ACCOUNT_RESET_TTL_MIN` | `30` | Lifetime of password-reset links. |
| `ACCOUNT_RESET_COOLDOWN_SEC` | `60` | Minimum gap between reset mails for one account (requests inside it are silently ignored). |
| `ACCOUNT_2FA_CHALLENGE_TTL_MIN` | `5` | How long a login challenge (password accepted, code pending) stays valid. |
| `ACCOUNT_2FA_CHALLENGE_ATTEMPTS` | `5` | Wrong codes before a challenge is burnt. |
| `ACCOUNT_SESSION_TTL` | `30d` | JWT/session lifetime (jsonwebtoken `expiresIn` syntax). |
| `ACCOUNT_SESSION_RETENTION_DAYS` | `90` | Revoked/expired session rows are purged after this. |
| `ACCOUNT_LOGIN_HISTORY_DAYS` | `365` | Login history retention. |
| `ACCOUNT_MAX_FAILURES_EMAIL` | `5` | Failed password/2FA/step-up attempts per email (per counter) before lockout. |
| `ACCOUNT_MAX_FAILURES_IP` | `30` | Failed logins per IP before lockout. |
| `ACCOUNT_FAILURE_WINDOW_MIN` | `15` | Observation window; counters reset when idle longer than this. |
| `ACCOUNT_LOCKOUT_MIN` | `15` | First lockout length; doubles on every consecutive lockout, capped at 24 h. |
| `ACCOUNT_CAPTCHA_PROVIDER` | empty | `turnstile` or `hcaptcha` to enable captcha. |
| `ACCOUNT_CAPTCHA_SITE_KEY` | empty | Public site key (sent to the browser through `GET /api/site`). |
| `ACCOUNT_CAPTCHA_SECRET` | empty | Secret used for server-side `siteverify`. |
| `ACCOUNT_CAPTCHA_AFTER_FAILURES` | `3` | Login requires a captcha once an email or IP has this many recent failures. |
| `ACCOUNT_CAPTCHA_ON_REGISTER` | `true` | Captcha on registration and password-reset requests. |
| `ACCOUNT_SECRET_KEY` | falls back to `JWT_SECRET` | Key for AES-256-GCM encryption of TOTP seeds and HMAC API secrets (HKDF-derived). Rotating it invalidates existing 2FA enrolments and HMAC keys – do not rotate casually. |
| `ACCOUNT_TOTP_ISSUER` | `BRAND_NAME` | Issuer shown in authenticator apps. |
| `ACCOUNT_API_KEY_SKEW_SEC` | `30` | Allowed clock skew for signed requests. |
| `ACCOUNT_API_KEYS_PER_USER` | `10` | Active API keys per user. |

The plugin also reads `JWT_SECRET`, `PUBLIC_URL` (links in mails), `BRAND_NAME` and `ADMIN_EMAILS`.

`GET /api/site` gains `account: { password_min_length, password_policy, require_verified_for, captcha: { provider, site_key, on_register } | null, two_factor: true, api_keys: true, dev_return_tokens }`.

## Endpoints

Errors are `{ error, code?, data? }`. Codes used here: `VALIDATION`, `WEAK_PASSWORD` (`data.reason`), `EMAIL_TAKEN`, `EMAIL_UNVERIFIED`, `ALREADY_VERIFIED`, `COOLDOWN` (`data.retry_after`), `TOKEN_INVALID`, `BAD_PASSWORD`, `BAD_CODE` (`data.attempts_left`), `STEP_UP_REQUIRED` (`data.reason` = `missing`|`invalid`), `TWO_FACTOR_ON`, `TWO_FACTOR_OFF`, `NO_SETUP`, `LOCKED_OUT` (`data.retry_after`), `ACCOUNT_LOCKED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_NOT_FOUND`, `PASSWORD_RESET_REQUIRED`, `CAPTCHA_REQUIRED` (`data.provider`, `data.site_key`), `CAPTCHA_FAILED`, `CAPTCHA_UNAVAILABLE`, `SESSION_REVOKED`, `TOKEN_EXPIRED`, `SESSION_REQUIRED`, `NOT_FOUND`, `ACCOUNT_HAS_ASSETS` (`data.blockers`), `API_KEY_*` (see API keys), `IP_ALLOWLIST_REQUIRED`, `INVALID_IP`, `LIMIT`.

### Core auth (`/api/auth`)

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/register` | – | `{ email, password, captcha_token? }` → 201 `{ token, user, email_verification: { sent, required, dev_token? } }` |
| POST | `/login` | – | `{ email, password, captcha_token? }` → `{ token, user, …hook extras }` **or** `{ two_factor: true, challenge, methods: ['totp','backup'], expires_in }` |
| GET | `/me` | session or key | `{ user: { id, email, is_admin, email_verified, two_factor, pending_email? }, auth: { via: 'session'|'api_key', scopes? } }` |
| POST | `/change-password` | session | `{ current, password }` → `{ ok, sessions_revoked }` (other sessions are ended) |
| POST | `/logout` | session | → `{ ok }` (revokes the current session) |

### Plugin auth extras (`/api/auth`)

| Method | Path | Auth | Body → Response |
|---|---|---|---|
| POST | `/2fa/verify` | – | `{ challenge, code }` → `{ token, user }`; 401 `BAD_CODE` with `attempts_left`; 400 `TOKEN_INVALID` once burnt/expired |
| POST | `/verify-email` | – | `{ token }` → `{ ok, user }` |
| POST | `/verify-email/resend` | session | → `{ ok, sent, required, dev_token? }`; 429 `COOLDOWN` |
| POST | `/password-reset/request` | – | `{ email, captcha_token? }` → always 200 `{ ok, message, dev_token? }` |
| POST | `/password-reset/confirm` | – | `{ token, password }` → `{ ok }` (all sessions revoked, 2FA challenges voided, lockouts cleared) |
| POST | `/token-info` | – | `{ token, purpose: 'reset'|'verify'|'email-change' }` → `{ ok, purpose, expires_at, email (masked) }` without consuming |

### Account (`/api/account`, session only – API keys are refused with `API_KEY_FORBIDDEN`)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/time` | public: `{ now (ms), iso }` for HMAC clients |
| POST | `/email/confirm` | public: `{ token }` → `{ ok, user }` |
| GET | `/security` | `{ user, email_verified, pending_email, verification_required_for, two_factor: { enabled, enabled_at, pending_setup, backup_codes_left }, sessions, api_keys, password_changed_at, last_login, password_policy }` |
| GET | `/2fa` | `{ enabled, enabled_at, pending_setup, backup_codes_left }` |
| POST | `/2fa/setup` | `{ password }` → `{ secret (base32), otpauth_url, issuer, account, digits, period, algorithm }` |
| POST | `/2fa/confirm` | `{ code }` → `{ enabled: true, backup_codes: [10] }` |
| POST | `/2fa/disable` | `{ password, code }` → `{ enabled: false }` |
| POST | `/2fa/backup-codes` | step-up → `{ backup_codes }` (old ones void) |
| GET | `/sessions` | `{ sessions: [{ id, device, ip, user_agent, method, created_at, last_seen_at, expires_at, current }] }` |
| DELETE | `/sessions/:id` | `{ ok, current }` (404 for other users' sessions) |
| POST | `/sessions/revoke-all` | `{ include_current?: bool }` → `{ ok, revoked }` |
| GET | `/login-history?limit=50` | `{ history: [{ id, ip, device, ok, method, reason, new_device, created_at }] }` |
| GET | `/api-keys` | `{ keys: [...without secrets], scopes }` |
| POST | `/api-keys` | step-up; `{ label, scopes: ['read','trade','withdraw'], auth_mode: 'hmac'|'bearer', ip_allowlist?: ['1.2.3.4','10.0.0.0/8'], expires_in_days? }` → 201 `{ key, secret, bearer, id }` (secret only here) |
| DELETE | `/api-keys/:id` | `{ ok }` |
| GET | `/export[?download]` | full JSON export (rate limited 5/h) |
| GET | `/delete/check` | `{ blockers: [string] }` |
| POST | `/delete` | `{ password, confirm: 'DELETE' }` + step-up → `{ ok }`; 409 `ACCOUNT_HAS_ASSETS` |
| POST | `/email/change` | `{ new_email, password }` + step-up → `{ pending_email, sent, dev_token? }` |

### Admin (`/api/admin/security`, admin session)

| Method | Path | Notes |
|---|---|---|
| GET | `/overview` | counters |
| GET | `/users?q=&filter=` | ≤ 50 users with flags, session/key counts, last login, failed logins 24 h, throttle status |
| GET | `/users/:id` | `{ user, sessions, login_history, api_keys, two_factor, audit }` |
| POST | `/users/:id/lock` `{ reason }` / `/unlock` | lock revokes sessions; unlock clears lockouts |
| POST | `/users/:id/force-reset` `{ reason }` | step-up; `{ ok, sent, dev_token? }` |
| POST | `/users/:id/disable-2fa` `{ reason }` | step-up; reason required; all sessions revoked |
| POST | `/users/:id/verify-email` `{ reason }` | manual verification |
| POST | `/users/:id/sessions/revoke` | all sessions |
| DELETE | `/users/:id/sessions/:jti` | one session |
| DELETE | `/users/:id/api-keys/:keyId` | revoke a key |
| POST | `/users/:id/clear-lockout` | clears email/stepup/2fa counters |
| GET | `/lockouts` · POST `/lockouts/clear { key }` | active lockouts |
| GET | `/audit?user_id=&action=&limit=&before=` | audit log with actor/target emails, `details` parsed |

## API keys for bots

Create a key in Account → API keys (or `POST /api/account/api-keys`). You get a public `key_id` (`pk_` + 16 hex), a `secret` (`sk_…`) and a ready-made bearer string `pk_<id>.<secret>`.

**Scopes by path** (first match wins; anything else that is not a `GET` is refused with 403 `API_KEY_FORBIDDEN`):

| Scope | Allows |
|---|---|
| `read` | every `GET` outside `/api/auth`, `/api/account`, `/api/admin` (plus `GET /api/auth/me` as a "whoami" that shows the key's scopes); `POST /api/wallet/deposit-address` |
| `trade` | `POST/DELETE /api/spot/:market/orders[/:id]`, `POST /api/perps/positions[/:id/close]`, `POST /api/options/buy`, `POST /api/options/positions/:id/close`, `POST /api/cards/products/:sku/orders`, `DELETE /api/cards/orders/:id` |
| `withdraw` | `POST /api/wallet/withdraw` (key must have an IP allowlist; the 2FA step-up is replaced by the allowlist + scope, like Binance's "enable withdrawals requires IP restriction") |

Never reachable with keys: `/api/auth/*`, `/api/account/*`, `/api/admin/*`, `/api/servers`, `/api/shop`, `/api/vpn`, `/api/ads`, `/api/cards/requests`, `/api/wallet/faucet`. Other plugins can extend the rules through `ctx.account.apiKeys.addScopeRule({ re, methods, scope })` / `addDeny(re)`.

### 1. Bearer (simplest)

```
GET /api/wallet
Authorization: Bearer pk_5150edd57fc1531f.sk_SuQLf4FAasskuFydB6e8i5nwGZfU5sX9NZUdfmpAIyY
```

Keys created with `auth_mode: 'bearer'` store only a keyed hash of the secret and cannot sign requests.

### 2. HMAC-signed requests (recommended; the secret never leaves your machine)

Headers: `X-API-Key: pk_<id>`, `X-API-Timestamp: <unix ms>` (seconds also accepted), `X-API-Signature: hex(HMAC-SHA256(secret, timestamp + METHOD + path + body))` where

* `METHOD` is upper-case,
* `path` is the request path **including the query string** (e.g. `/api/spot/orders?market=BTC_USDT`),
* `body` is the compact JSON you send (no whitespace, e.g. `JSON.stringify(obj)` or `json.dumps(obj, separators=(',', ':'))`) or the empty string for requests without a body. Send amounts as strings (the API accepts them) so number formatting cannot differ.

The timestamp must be within `ACCOUNT_API_KEY_SKEW_SEC` (30 s) of server time (`GET /api/account/time`) and a signature is accepted once (replays get 401 `API_KEY_REPLAY`). `auth_mode: 'hmac'` keys also work as bearer tokens.

Node.js:

```js
const crypto = require('node:crypto');
const KEY = 'pk_5150edd57fc1531f', SECRET = 'sk_…', BASE = 'https://your.brand';
async function call(method, path, body) {
  const ts = String(Date.now());
  const payload = body ? JSON.stringify(body) : '';
  const sig = crypto.createHmac('sha256', SECRET).update(ts + method + path + payload).digest('hex');
  const res = await fetch(BASE + path, { method, body: payload || undefined, headers: { 'content-type': 'application/json', 'X-API-Key': KEY, 'X-API-Timestamp': ts, 'X-API-Signature': sig } });
  return res.json();
}
await call('GET', '/api/wallet');
await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '60000', qty: '0.001' });
```

Python:

```python
import hmac, hashlib, json, time, requests
KEY, SECRET, BASE = 'pk_…', 'sk_…', 'https://your.brand'
def call(method, path, body=None):
    ts = str(int(time.time() * 1000))
    payload = json.dumps(body, separators=(',', ':')) if body else ''
    sig = hmac.new(SECRET.encode(), (ts + method + path + payload).encode(), hashlib.sha256).hexdigest()
    return requests.request(method, BASE + path, data=payload or None, headers={'content-type': 'application/json', 'X-API-Key': KEY, 'X-API-Timestamp': ts, 'X-API-Signature': sig}).json()
```

Error codes: `API_KEY_INVALID`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_IP`, `API_KEY_SCOPE` (`data.required`), `API_KEY_FORBIDDEN`, `API_KEY_MODE`, `API_KEY_SIGNATURE`, `API_KEY_TIMESTAMP` (`data.server_time`), `API_KEY_REPLAY`.

## Browser helpers (`web/js/account.js`)

* `App.authChallenge(response, creds)` – called by the login form when the server returns `{ two_factor, challenge }`; shows the code prompt and completes the login.
* `App.withStepUp(async (headers) => api(...,{ headers }), { purpose })` – retries a call with an `x-2fa-code` header after asking the user, when the server answers 401 `STEP_UP_REQUIRED`. Use it for every sensitive action (e.g. the withdraw form).
* `App.authPageMounted(mode, form)` – renders the Turnstile/hCaptcha widget on registration when configured; the login form mounts it on demand after `CAPTCHA_REQUIRED`.
* Routes: `#/login`, `#/register`, `#/forgot`, `#/reset?token=`, `#/verify?token=`, `#/email-change?token=`, `#/account?tab=overview|security|sessions|api|privacy`, `#/admin?tab=security[&view=users|lockouts|audit][&user=<id>]`.
* Header widget `verify-email` (badge while the email is unverified). Other plugins' `registerAccountPanel` panels render on the Overview tab.
* QR codes use `qrcode-generator` 1.4.4 from cdnjs with Subresource Integrity.

## Mobile

All user endpoints are plain JSON. A mobile login must handle the `{ two_factor, challenge }` response by asking for a code and calling `POST /api/auth/2fa/verify`, and must retry with an `x-2fa-code` header on 401 `STEP_UP_REQUIRED`. `GET /api/auth/me` tells whether the email is verified / 2FA is on. Link pages (`/#/verify`, `/#/reset`) are hash routes on the website; an app can deep-link them or call the `POST` endpoints directly with the token.

## Hooks, events, audit

Hooks the plugin enforces: `withdraw.before` (verified email if configured + step-up), `vpn.issue.before` (step-up), `trade.before` (verified email for `perps`/`options` if configured), `cloud.checkout.before` (verified email if configured).

Events emitted (consume with `ctx.events.on`; the notify plugin should turn these into in-app/email/push alerts):

| Event | Payload |
|---|---|
| `account.email_verified` | `{ userId, email, by?: 'admin' }` |
| `account.password_reset` | `{ userId, email, ip }` |
| `account.password_changed` | `{ userId, email, ip, sessions_revoked }` |
| `account.2fa_enabled` | `{ userId, email, ip }` |
| `account.2fa_disabled` | `{ userId, email, by: 'user'|'admin', actorId, reason, ip }` |
| `account.new_device` | `{ userId, user: { id, email }, ip, device, user_agent, at }` – first login from a browser/OS combination not seen before (not on the very first login) |
| `account.lockout` | `{ key, email, ip, userId, failures, until, kind: 'login'|'stepup'|'2fa' }` |
| `account.api_key_created` | `{ userId, key }` |
| `account.email_changed` | `{ userId, from, to }` |
| `account.locked` | `{ userId, email, by, reason }` |
| `account.deleted` | `{ userId }` |
| `user.login` | now also carries `method: 'password'|'2fa'|'2fa-backup'` |

Audit actions (`audit_log.action`): `account.email_verified`, `account.password_reset.requested`, `account.password_reset`, `account.password_changed`, `account.2fa.enabled`, `account.2fa.disabled`, `account.backup_code.used`, `account.backup_codes.regenerated`, `account.session.revoked`, `account.sessions.revoked_all`, `account.api_key.created`, `account.api_key.revoked`, `account.exported`, `account.deleted`, `account.email_change.requested`, `account.email_changed`, `account.lockout` (actor NULL = system), `admin.user.lock`, `admin.user.unlock`, `admin.user.force_reset`, `admin.user.2fa_disabled`, `admin.user.email_verified`, `admin.user.sessions_revoked`, `admin.user.session_revoked`, `admin.user.lockout_cleared`, `admin.lockout_cleared`.

Services on `ctx.account`: `isTwoFactorEnabled(userId)`, `requireStepUp(req, { purpose })`, `requireVerified(user, action)`, `verifySecondFactor(user, code, { kind })`, `issueSession(user, req, { method })`, `checkPassword(password, { email })`, `sendVerification(user)`, `verifyEmail(token)`, `requestPasswordReset(email)`, `confirmPasswordReset(token, password)`, `forcePasswordReset(user, { actorId })`, `totpSetup/totpConfirm/totpDisable/regenerateBackupCodes/twoFactorStatus`, `sessions` (store), `throttle`, `apiKeys`, `lifecycle` (`exportData`, `deletionBlockers`, `deleteAccount`, `requestEmailChange`, `confirmEmailChange`), `tokens`, `setFetch(fn)` (captcha HTTP), `setClock(fn)` (TOTP time, tests), `purge()`.

Core `ctx.auth` additions: `sign(user, { req, method, expiresIn })`, `authenticate(req)`, `presentUser(u)`, `loadUser(id)`, `addStrategy(name, fn)`, `useSessions(store)`, `addUserDecorator(fn)`. `requireAuth` sets `req.auth = { via: 'session', jti, session }` or `{ via: 'api_key', mode, key_id, api_key_id, scopes }`.

## How it works (security notes)

* **Sessions**: JWTs carry a `jti`; `sessions` rows record device/IP/last-seen; `requireAuth`, `verifyToken` (WebSockets) and admin endpoints all refuse revoked or unknown jtis. Tokens minted before this upgrade (no jti) are refused: users log in again once after deploying. Purpose tokens (reset, verify, challenge, email change) carry a `purpose` claim and are never accepted as sessions.
* **Passwords**: bcrypt cost 11; unknown emails are compared against a dummy hash so timing does not reveal account existence; reset requests always answer 200.
* **Lockout**: counters per email and per IP in SQLite (`login_throttle`), 15-minute window, 15-minute lockout doubling per consecutive lockout (max 24 h). Success clears only the email counter. Wrong 2FA and step-up codes have their own per-email counters. Locked-out users can still use the password-reset flow (OWASP lockout-as-DoS mitigation).
* **TOTP**: 160-bit secrets, AES-256-GCM at rest, last accepted step stored so a code is accepted once; ±1 step drift. Backup codes: 10 × 50-bit, stored as HMAC-SHA256 under the server key, single use.
* **API keys**: bearer secrets stored as keyed hash; HMAC keys encrypted (the server must recompute the MAC). Constant-time comparisons everywhere. Replay cache for signatures.
* **Deletion**: anonymises email/password, destroys 2FA/API secrets, revokes sessions; ledger, orders and audit rows stay so books remain balanced (financial record retention). Blocked until balances/servers/positions are gone.
* **Admin takeover actions** (force reset, disable 2FA) require the admin's own 2FA step-up when they have it, and a reason that lands in the audit log.
* Everything that mutates security state calls `ctx.audit`; nothing logs tokens or secrets.

## Operational runbook

* **First deploy**: set `JWT_SECRET` and (recommended) a separate `ACCOUNT_SECRET_KEY`; all existing users must log in again. Keep `ACCOUNT_DEV_RETURN_TOKENS` unset (false) in production. Make sure the notify plugin is loaded with a mail transport – without it verification/reset mails are logged as "not sent" and users cannot complete those flows (admins can verify emails and force resets by hand).
* **User lost their phone**: Admin → Security → user → *Disable 2FA (support)* with the ticket reference after identity checks; the user logs in with the password and re-enrols. Alternatively they use a backup code.
* **Account takeover suspected**: lock the account (revokes all sessions), *Force password reset*, revoke API keys, review login history and the audit log.
* **User locked out by brute force**: *Clear lockout* on the user, or clear the `ip:` key under Lockouts if a shared NAT is affected. Consider lowering `ACCOUNT_CAPTCHA_AFTER_FAILURES` or enabling captcha instead of raising limits.
* **Captcha**: create a Turnstile widget (Cloudflare dashboard) or hCaptcha site; set provider, site key and secret. The server refuses logins/registrations with 503 `CAPTCHA_UNAVAILABLE` when the verifier is unreachable – never a silent pass.
* **Rotating `ACCOUNT_SECRET_KEY`** breaks every 2FA enrolment and HMAC key (they can no longer be decrypted). Plan a migration (decrypt with old, encrypt with new) before rotating.
* **Housekeeping**: a job purges expired tokens, old sessions, login history and stale throttle rows every 10 minutes (`ctx.account.purge()`).
* **GDPR requests**: users self-serve export and deletion; for manual requests use the same service functions from a script (`ctx.account.lifecycle.exportData(id)`).

## Known limitations / follow-ups

* HMAC signatures cover the compact re-serialisation of the parsed JSON body because `app.js` does not capture the raw body; documented above (send compact JSON, amounts as strings).
* Strict password policy and email-verification gates default to off outside production so the shared test suites (which register `password1` users and withdraw unverified) keep passing. Flip `ACCOUNT_STRICT=true` in staging.
* Security alert mails (new device, password changed…) are emitted as events for the notify plugin; without it only the audit log records them.

## References

* RFC 6238 TOTP – https://www.rfc-editor.org/rfc/rfc6238 ; RFC 4226 HOTP – https://www.rfc-editor.org/rfc/rfc4226 ; RFC 4648 Base32 – https://www.rfc-editor.org/rfc/rfc4648
* Google Authenticator Key Uri Format – https://github.com/google/google-authenticator/wiki/Key-Uri-Format
* OWASP Authentication Cheat Sheet – https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html ; Session Management – https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html ; Forgot Password – https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html ; MFA – https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html ; Password Storage – https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
* NIST SP 800-63B – https://pages.nist.gov/800-63-3/sp800-63b.html
* Cloudflare Turnstile server-side validation – https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ ; client rendering – https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
* hCaptcha docs – https://docs.hcaptcha.com/
* Binance SIGNED endpoint security (HMAC SHA256, recvWindow) – https://developers.binance.com/docs/binance-spot-api-docs/rest-api/endpoint-security-type
* Kraken REST authentication (API-Key / API-Sign, nonce) – https://docs.kraken.com/api/docs/guides/spot-rest-auth
* Coinbase Exchange REST auth (CB-ACCESS-SIGN) – https://docs.cdp.coinbase.com/exchange/docs/rest-auth
* RFC 7519 JWT – https://www.rfc-editor.org/rfc/rfc7519 ; RFC 6750 Bearer – https://www.rfc-editor.org/rfc/rfc6750 ; RFC 2104 HMAC – https://www.rfc-editor.org/rfc/rfc2104
* jsonwebtoken – https://github.com/auth0/node-jsonwebtoken ; express-rate-limit – https://github.com/express-rate-limit/express-rate-limit ; bcryptjs – https://github.com/dcodeIO/bcrypt.js
* qrcode-generator – https://github.com/kazuhikoarase/qrcode-generator (cdnjs 1.4.4)
* SecLists common credentials – https://github.com/danielmiessler/SecLists/tree/master/Passwords/Common-Credentials
* GDPR Art. 15/17/20 – https://gdpr-info.eu/
