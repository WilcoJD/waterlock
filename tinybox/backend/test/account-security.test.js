'use strict';
/**
 * Account security plugin: email verification, password policy/reset, TOTP 2FA + backup codes,
 * step-up, sessions/login history, brute-force lockout + captcha, API keys (bearer + HMAC), GDPR export,
 * deletion, email change, admin Security console. Deterministic and offline (captcha HTTP is injected).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setup } = require('./helpers');
const totpLib = require('../src/plugins/account/totp');
const { checkPassword } = require('../src/plugins/account/passwords');
const { ipAllowed, parseIpList, ApiKeys } = require('../src/plugins/account/apikeys');

const STRONG = 'correct-horse-battery-staple';
const strict = (c) => { c.account = { passwordPolicy: 'strict', requireVerifiedFor: ['withdraw', 'derivatives', 'cloud'] }; };
const code = (secretB32, offsetMs = 0) => totpLib.totp(totpLib.base32Decode(secretB32), { now: Date.now() + offsetMs });
/** Deterministic TOTP time: every next() moves the server clock (and the generated code) one 30 s step forward. */
function clockFor(s) {
  let offset = 0;
  s.account.setClock(() => Date.now() + offset);
  return { now: (secret) => code(secret, offset), next: (secret) => { offset += 30_000; return code(secret, offset); } };
}

/** fetch wrapper with arbitrary headers (helpers.call only knows the token). */
function requester(base) {
  return async (method, path, body, { token, headers = {}, raw } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body !== undefined && body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers, raw: raw ? res : undefined };
  };
}
async function register(call, email, password = STRONG) {
  const r = await call('POST', '/api/auth/register', { email, password });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function verify(call, reg) {
  const r = await call('POST', '/api/auth/verify-email', { token: reg.email_verification.dev_token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}
async function enable2fa(req, token, clk, password = STRONG) {
  const setup2 = await req('POST', '/api/account/2fa/setup', { password }, { token });
  assert.equal(setup2.status, 200, JSON.stringify(setup2.body));
  const conf = await req('POST', '/api/account/2fa/confirm', { code: clk.now(setup2.body.secret) }, { token });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  return { secret: setup2.body.secret, backup: conf.body.backup_codes };
}

// ---------------------------------------------------------------- unit level
test('TOTP/HOTP match the RFC 4226 / RFC 6238 test vectors; base32 round-trips; otpauth URL is well formed', () => {
  const secret = Buffer.from('12345678901234567890');
  for (const [t, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totpLib.totp(secret, { now: t * 1000, digits: 8 }), expected);
  }
  ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'].forEach((v, i) => assert.equal(totpLib.hotp(secret, i), v));
  assert.equal(totpLib.base32Decode(totpLib.base32Encode(secret)).toString(), '12345678901234567890');
  const now = 1_700_000_000_000;
  const c = totpLib.totp(secret, { now });
  assert.equal(totpLib.verifyTotp(secret, c, { now }), totpLib.stepOf(now, 30));
  assert.equal(totpLib.verifyTotp(secret, c, { now: now + 30_000 }), totpLib.stepOf(now, 30), 'previous step accepted (±1 window)');
  assert.equal(totpLib.verifyTotp(secret, c, { now: now + 61_000 }), null, 'two steps late is refused');
  assert.equal(totpLib.verifyTotp(secret, c, { now, lastStep: totpLib.stepOf(now, 30) }), null, 'replay refused');
  assert.equal(totpLib.verifyTotp(secret, '12345', { now }), null);
  const url = totpLib.otpauthUrl({ issuer: 'Tiny Box', account: 'a@b.io', secret });
  assert.match(url, /^otpauth:\/\/totp\/Tiny%20Box:a%40b\.io\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Tiny%20Box&algorithm=SHA1&digits=6&period=30$/);
});

test('password policy: length, common list (with suffix/leet variants), email, legacy mode', () => {
  const reason = (pw, o) => { try { checkPassword(pw, o); return 'ok'; } catch (e) { return e.data.reason; } };
  assert.equal(reason('password1', { policy: 'legacy' }), 'ok');
  assert.equal(reason('short', { policy: 'legacy' }), 'too_short');
  assert.equal(reason('password1', {}), 'too_short');
  assert.equal(reason('Password123!', {}), 'common');
  assert.equal(reason('p@ssw0rd2024', {}), 'common');
  assert.equal(reason('qwertyuiop12', {}), 'common');
  assert.equal(reason('aaaaaaaaaaaa', {}), 'repetitive');
  assert.equal(reason('alice@x.io', { email: 'alice@x.io' }), 'contains_email');
  assert.equal(reason('alice-rocks-2024', { email: 'alice@x.io' }), 'contains_email');
  assert.equal(reason('x'.repeat(129), {}), 'too_long');
  assert.equal(reason(STRONG, { email: 'alice@x.io' }), 'ok');
  assert.equal(reason('Tr0ub4dor&3xyz', {}), 'ok');
});

test('API key helpers: IP allowlists (v4, v6, mapped), signing string', () => {
  assert.ok(ipAllowed('1.2.3.4', ['1.2.3.0/24']));
  assert.ok(!ipAllowed('1.2.4.4', ['1.2.3.0/24']));
  assert.ok(ipAllowed('::ffff:1.2.3.4', ['1.2.3.4']));
  assert.ok(ipAllowed('2001:db8::1', ['2001:db8::/32']));
  assert.ok(!ipAllowed('2001:db9::1', ['2001:db8::/32']));
  assert.ok(ipAllowed('anything', []), 'empty list = allow all');
  assert.ok(!ipAllowed('garbage', ['1.2.3.4']));
  assert.deepEqual(parseIpList(' 1.2.3.4, 10.0.0.0/8 '), ['1.2.3.4', '10.0.0.0/8']);
  assert.throws(() => parseIpList('1.2.3'), /Invalid IP/);
  assert.throws(() => parseIpList('1.2.3.4/33'), /Invalid CIDR/);
  assert.equal(ApiKeys.signingString({ timestamp: '1700000000000', method: 'post', path: '/api/x?y=1', body: '{"a":1}' }), '1700000000000POST/api/x?y=1{"a":1}');
  assert.equal(ApiKeys.sign('secret', { timestamp: '1', method: 'GET', path: '/p', body: '' }), crypto.createHmac('sha256', 'secret').update('1GET/p').digest('hex'));
});

// ---------------------------------------------------------------- email verification + gates
test('email verification: dev token, gates on withdraw/derivatives/cloud, single use, resend cooldown', async (t) => {
  const s = await setup({ config: strict });
  t.after(s.close);
  const { call } = s;
  const reg = await register(call, 'alice@x.io');
  assert.equal(reg.user.email_verified, false);
  assert.ok(reg.email_verification.dev_token, 'token returned outside production');
  assert.equal(reg.email_verification.sent, false, 'no notify plugin -> not sent');
  const { token } = reg;
  assert.equal((await call('GET', '/api/auth/me', null, token)).body.user.email_verified, false);
  assert.ok((await call('GET', '/api/site')).body.plugins.includes('account'));
  assert.deepEqual((await call('GET', '/api/site')).body.account.require_verified_for, ['withdraw', 'derivatives', 'cloud']);

  await call('POST', '/api/wallet/faucet', {}, token);
  const wd = await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '100' }, token);
  assert.equal(wd.status, 403); assert.equal(wd.body.code, 'EMAIL_UNVERIFIED');
  const perp = await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '100', leverage: 5 }, token);
  assert.equal(perp.status, 403); assert.equal(perp.body.code, 'EMAIL_UNVERIFIED');
  const co = await call('POST', '/api/shop/checkout', { plan_id: 'nano', hostname: 'web1', pay_with: 'wallet' }, token);
  assert.equal(co.status, 403); assert.equal(co.body.code, 'EMAIL_UNVERIFIED');
  assert.equal((await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '1', qty: '0.001' }, token)).status, 201, 'spot is not gated');

  // resend is on cooldown right after registration
  const rs = await call('POST', '/api/auth/verify-email/resend', {}, token);
  assert.equal(rs.status, 429); assert.equal(rs.body.code, 'COOLDOWN'); assert.ok(rs.body.data.retry_after > 0);

  assert.equal((await call('POST', '/api/auth/verify-email', { token: 'garbage' })).status, 400);
  await verify(call, reg);
  assert.equal((await call('GET', '/api/auth/me', null, token)).body.user.email_verified, true);
  assert.equal((await call('POST', '/api/auth/verify-email', { token: reg.email_verification.dev_token })).status, 400, 'single use');
  assert.equal((await call('POST', '/api/auth/verify-email/resend', {}, token)).body.code, 'ALREADY_VERIFIED');
  assert.equal((await call('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '100' }, token)).status, 201);
  assert.equal((await call('POST', '/api/perps/positions', { symbol: 'BTC', side: 'long', margin: '100', leverage: 5 }, token)).status, 201);
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='account.email_verified' AND target_id=?").get(reg.user.id));

  // a verify token is never a session
  assert.equal((await call('GET', '/api/auth/me', null, reg.email_verification.dev_token)).status, 401);
});

test('strict password policy on register and change-password', async (t) => {
  const s = await setup({ config: strict });
  t.after(s.close);
  const { call } = s;
  for (const pw of ['password1', 'Password123!', 'bob@x.io', 'short']) {
    const r = await call('POST', '/api/auth/register', { email: 'bob@x.io', password: pw });
    assert.equal(r.status, 400, pw); assert.equal(r.body.code, 'WEAK_PASSWORD');
  }
  assert.equal((await call('GET', '/api/site')).body.account.password_min_length, 10);
  const { token } = await register(call, 'bob@x.io');
  assert.equal((await call('POST', '/api/auth/change-password', { current: STRONG, password: 'letmein12345' }, token)).body.code, 'WEAK_PASSWORD');
  assert.equal((await call('POST', '/api/auth/change-password', { current: 'nope', password: 'another-long-passphrase' }, token)).status, 401);
  assert.equal((await call('POST', '/api/auth/change-password', { current: STRONG, password: STRONG }, token)).status, 400, 'same password refused');
  const ok = await call('POST', '/api/auth/change-password', { current: STRONG, password: 'another-long-passphrase' }, token);
  assert.equal(ok.status, 200);
  assert.equal((await call('POST', '/api/auth/login', { email: 'bob@x.io', password: 'another-long-passphrase' })).status, 200);
});

// ---------------------------------------------------------------- password reset
test('password reset: no enumeration, single-use token, policy, sessions invalidated, cooldown', async (t) => {
  const s = await setup({ config: strict });
  t.after(s.close);
  const { call } = s;
  const reg = await register(call, 'carol@x.io');
  const other = (await call('POST', '/api/auth/login', { email: 'carol@x.io', password: STRONG })).body.token;

  const unknown = await call('POST', '/api/auth/password-reset/request', { email: 'nobody@x.io' });
  assert.equal(unknown.status, 200); assert.equal(unknown.body.dev_token, undefined);
  assert.equal((await call('POST', '/api/auth/password-reset/request', { email: 'not-an-email' })).status, 400);
  const req1 = await call('POST', '/api/auth/password-reset/request', { email: 'Carol@x.io' });
  assert.equal(req1.status, 200); assert.ok(req1.body.dev_token);
  assert.equal((await call('POST', '/api/auth/password-reset/request', { email: 'carol@x.io' })).body.dev_token, undefined, 'cooldown: no second token');

  const info = await call('POST', '/api/auth/token-info', { token: req1.body.dev_token, purpose: 'reset' });
  assert.equal(info.status, 200); assert.equal(info.body.purpose, 'reset');
  assert.equal((await call('POST', '/api/auth/token-info', { token: req1.body.dev_token, purpose: 'verify' })).status, 400, 'purpose mismatch');

  assert.equal((await call('POST', '/api/auth/password-reset/confirm', { token: req1.body.dev_token, password: 'password123' })).body.code, 'WEAK_PASSWORD');
  assert.equal((await call('GET', '/api/auth/me', null, other)).status, 200, 'weak attempt did not consume the token or sessions');
  const done = await call('POST', '/api/auth/password-reset/confirm', { token: req1.body.dev_token, password: 'brand-new-passphrase-9' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await call('POST', '/api/auth/password-reset/confirm', { token: req1.body.dev_token, password: 'brand-new-passphrase-9' })).body.code, 'TOKEN_INVALID', 'single use');
  assert.equal((await call('GET', '/api/auth/me', null, other)).body.code, 'SESSION_REVOKED');
  assert.equal((await call('GET', '/api/auth/me', null, reg.token)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'carol@x.io', password: STRONG })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'carol@x.io', password: 'brand-new-passphrase-9' })).status, 200);
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='account.password_reset' AND target_id=?").get(reg.user.id));
});

// ---------------------------------------------------------------- 2FA
test('TOTP 2FA: enrol, confirm, challenge login, replay protection, backup codes, step-up, disable', async (t) => {
  const s = await setup();
  t.after(s.close);
  const req = requester(s.base);
  const { call } = s;
  const reg = await register(call, 'dave@x.io');
  const t0 = reg.token;
  await call('POST', '/api/wallet/faucet', {}, t0);
  const clk = clockFor(s);

  assert.equal((await req('GET', '/api/account/2fa', null, { token: t0 })).body.enabled, false);
  assert.equal((await req('POST', '/api/account/2fa/setup', { password: 'wrong' }, { token: t0 })).status, 401);
  assert.equal((await req('POST', '/api/account/2fa/confirm', { code: '123456' }, { token: t0 })).body.code, 'NO_SETUP');
  const st = await req('POST', '/api/account/2fa/setup', { password: STRONG }, { token: t0 });
  assert.equal(st.status, 200);
  assert.match(st.body.secret, /^[A-Z2-7]{32}$/);
  assert.match(st.body.otpauth_url, /^otpauth:\/\/totp\/TinyBox:dave%40x\.io\?secret=/);
  assert.equal((await req('GET', '/api/account/2fa', null, { token: t0 })).body.pending_setup, true);
  assert.equal((await req('POST', '/api/account/2fa/confirm', { code: '000000' }, { token: t0 })).body.code, 'BAD_CODE');
  const conf = await req('POST', '/api/account/2fa/confirm', { code: clk.now(st.body.secret) }, { token: t0 });
  assert.equal(conf.status, 200);
  assert.equal((await req('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '10' }, { token: t0, headers: { 'x-2fa-code': clk.now(st.body.secret) } })).body.code, 'STEP_UP_REQUIRED', 'the enrolment code cannot be reused');
  assert.equal(conf.body.backup_codes.length, 10);
  assert.ok(conf.body.backup_codes.every((c) => /^[a-z0-9]{5}-[a-z0-9]{5}$/.test(c)));
  assert.equal((await req('GET', '/api/auth/me', null, { token: t0 })).body.user.two_factor, true);
  assert.equal((await req('GET', '/api/account/2fa', null, { token: t0 })).body.backup_codes_left, 10);
  assert.equal((await req('POST', '/api/account/2fa/setup', { password: STRONG }, { token: t0 })).body.code, 'TWO_FACTOR_ON');
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='account.2fa.enabled'").get());

  // login now returns a challenge
  const lg = await call('POST', '/api/auth/login', { email: 'dave@x.io', password: STRONG });
  assert.equal(lg.status, 200); assert.equal(lg.body.two_factor, true); assert.ok(lg.body.challenge); assert.equal(lg.body.token, undefined);
  assert.equal((await call('GET', '/api/auth/me', null, lg.body.challenge)).status, 401, 'challenge is not a session');
  const bad = await call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: '000000' });
  assert.equal(bad.status, 401); assert.equal(bad.body.code, 'BAD_CODE'); assert.equal(bad.body.data.attempts_left, 4);
  assert.equal((await call('POST', '/api/auth/2fa/verify', { challenge: 'junk', code: '000000' })).status, 400);
  const c1 = clk.next(st.body.secret);
  const ok = await call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: c1 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.ok(ok.body.token); assert.equal(ok.body.user.email, 'dave@x.io');
  const t1 = ok.body.token;
  assert.equal((await call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: clk.next(st.body.secret) })).status, 400, 'challenge consumed');

  // step-up on withdraw: code required, the code just used for login cannot be replayed
  const wd = { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '10' };
  const noCode = await req('POST', '/api/wallet/withdraw', wd, { token: t1 });
  assert.equal(noCode.status, 401); assert.equal(noCode.body.code, 'STEP_UP_REQUIRED'); assert.equal(noCode.body.data.reason, 'missing');
  const replay = await req('POST', '/api/wallet/withdraw', wd, { token: t1, headers: { 'x-2fa-code': c1 } });
  assert.equal(replay.status, 401); assert.equal(replay.body.code, 'STEP_UP_REQUIRED'); assert.equal(replay.body.data.reason, 'invalid');
  const c2 = clk.next(st.body.secret);
  assert.equal((await req('POST', '/api/wallet/withdraw', wd, { token: t1, headers: { 'x-2fa-code': c2 } })).status, 201);
  assert.equal((await req('POST', '/api/wallet/withdraw', wd, { token: t1, headers: { 'x-2fa-code': c2 } })).status, 401, 'a code works exactly once');
  // backup code as step-up, once
  const bc = conf.body.backup_codes[0];
  assert.equal((await req('POST', '/api/wallet/withdraw', wd, { token: t1, headers: { 'x-2fa-code': bc.toUpperCase() } })).status, 201, 'backup codes are case/dash insensitive');
  assert.equal((await req('POST', '/api/wallet/withdraw', wd, { token: t1, headers: { 'x-2fa-code': bc } })).status, 401, 'backup code used up');
  assert.equal((await req('GET', '/api/account/2fa', null, { token: t1 })).body.backup_codes_left, 9);

  // backup code login
  const lg2 = await call('POST', '/api/auth/login', { email: 'dave@x.io', password: STRONG });
  const bl = await call('POST', '/api/auth/2fa/verify', { challenge: lg2.body.challenge, code: conf.body.backup_codes[1] });
  assert.equal(bl.status, 200); assert.ok(bl.body.token);
  assert.equal(s.db.prepare("SELECT method FROM sessions WHERE jti=?").get(require('jsonwebtoken').decode(bl.body.token).jti).method, '2fa-backup');

  // regenerate backup codes needs step-up
  assert.equal((await req('POST', '/api/account/2fa/backup-codes', {}, { token: t1 })).body.code, 'STEP_UP_REQUIRED');
  const regen = await req('POST', '/api/account/2fa/backup-codes', {}, { token: t1, headers: { 'x-2fa-code': conf.body.backup_codes[2] } });
  assert.equal(regen.status, 200); assert.equal(regen.body.backup_codes.length, 10);
  assert.notEqual(regen.body.backup_codes[0], conf.body.backup_codes[0]);
  assert.equal((await req('GET', '/api/account/2fa', null, { token: t1 })).body.backup_codes_left, 10);

  // disable requires password + code
  assert.equal((await req('POST', '/api/account/2fa/disable', { password: 'wrong', code: regen.body.backup_codes[0] }, { token: t1 })).status, 401);
  assert.equal((await req('POST', '/api/account/2fa/disable', { password: STRONG, code: '000000' }, { token: t1 })).body.code, 'BAD_CODE');
  assert.equal((await req('POST', '/api/account/2fa/disable', { password: STRONG, code: regen.body.backup_codes[0] }, { token: t1 })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', null, { token: t1 })).body.user.two_factor, false);
  assert.ok((await call('POST', '/api/auth/login', { email: 'dave@x.io', password: STRONG })).body.token, 'plain login again');
  assert.equal((await req('POST', '/api/wallet/withdraw', wd, { token: t1 })).status, 201, 'no step-up without 2FA');
});

test('2FA challenge burns after too many wrong codes and is throttled', async (t) => {
  const s = await setup();
  t.after(s.close);
  const req = requester(s.base);
  const reg = await register(s.call, 'erin@x.io');
  const clk = clockFor(s);
  const { secret } = await enable2fa(req, reg.token, clk);
  const lg = await s.call('POST', '/api/auth/login', { email: 'erin@x.io', password: STRONG });
  let last;
  for (let i = 0; i < 4; i++) last = await s.call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: '111111' });
  assert.equal(last.body.data.attempts_left, 1);
  last = await s.call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: '111111' });
  // 5 wrong codes on the email -> throttle lockout kicks in (maxFailuresPerEmail = 5)
  assert.ok([401, 429].includes(last.status), JSON.stringify(last.body));
  const again = await s.call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: clk.next(secret) });
  assert.ok([400, 429].includes(again.status), 'challenge burnt or locked');
  assert.ok(s.db.prepare("SELECT 1 FROM login_history WHERE user_id=? AND ok=0 AND reason='bad_code'").get(reg.user.id));
});

// ---------------------------------------------------------------- sessions
test('sessions: list/current, revoke one, log out everywhere, logout, history, new-device event, password change', async (t) => {
  const s = await setup();
  t.after(s.close);
  const req = requester(s.base);
  const events = [];
  s.events.on('account.new_device', (p) => events.push(p));
  const UA1 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const reg = (await req('POST', '/api/auth/register', { email: 'fay@x.io', password: STRONG }, { headers: { 'user-agent': UA1 } })).body;
  const l1 = (await req('POST', '/api/auth/login', { email: 'fay@x.io', password: STRONG }, { headers: { 'user-agent': UA1 } })).body;
  assert.equal(events.length, 0, 'same device: no new-device event');
  const l2 = (await req('POST', '/api/auth/login', { email: 'fay@x.io', password: STRONG }, { headers: { 'user-agent': UA2 } })).body;
  assert.equal(events.length, 1); assert.equal(events[0].device, 'Safari on iPhone'); assert.equal(events[0].userId, reg.user.id);

  const list = (await req('GET', '/api/account/sessions', null, { token: l1.token })).body.sessions;
  assert.equal(list.length, 3);
  assert.equal(list.filter((x) => x.current).length, 1);
  assert.ok(list.some((x) => x.device === 'Chrome on Windows') && list.some((x) => x.device === 'Safari on iPhone'));
  for (const x of list) assert.equal(typeof x.id, 'string');

  const other = list.find((x) => !x.current && x.device === 'Safari on iPhone');
  assert.equal((await req('DELETE', `/api/account/sessions/${other.id}`, null, { token: l1.token })).status, 200);
  const dead = await req('GET', '/api/auth/me', null, { token: l2.token });
  assert.equal(dead.status, 401); assert.equal(dead.body.code, 'SESSION_REVOKED');
  assert.equal((await req('DELETE', `/api/account/sessions/${other.id}`, null, { token: l1.token })).status, 404, 'already revoked');
  assert.equal((await req('DELETE', '/api/account/sessions/nonexistent', null, { token: l1.token })).status, 404);

  // other users cannot revoke my sessions (IDOR)
  const mallory = (await req('POST', '/api/auth/register', { email: 'mallory@x.io', password: STRONG })).body;
  const mine = (await req('GET', '/api/account/sessions', null, { token: l1.token })).body.sessions.find((x) => x.current);
  assert.equal((await req('DELETE', `/api/account/sessions/${mine.id}`, null, { token: mallory.token })).status, 404);
  assert.equal((await req('GET', '/api/auth/me', null, { token: l1.token })).status, 200);

  // password change keeps the current session, ends the rest
  const l3 = (await req('POST', '/api/auth/login', { email: 'fay@x.io', password: STRONG })).body;
  const pc = await req('POST', '/api/auth/change-password', { current: STRONG, password: 'yet-another-passphrase' }, { token: l1.token });
  assert.equal(pc.status, 200); assert.equal(pc.body.sessions_revoked, 2);
  assert.equal((await req('GET', '/api/auth/me', null, { token: l3.token })).status, 401);
  assert.equal((await req('GET', '/api/auth/me', null, { token: l1.token })).status, 200);

  // log out everywhere (keeps current), then logout
  const l4 = (await req('POST', '/api/auth/login', { email: 'fay@x.io', password: 'yet-another-passphrase' })).body;
  const all = await req('POST', '/api/account/sessions/revoke-all', {}, { token: l1.token });
  assert.equal(all.body.revoked, 1);
  assert.equal((await req('GET', '/api/auth/me', null, { token: l4.token })).status, 401);
  assert.equal((await req('POST', '/api/auth/logout', {}, { token: l1.token })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', null, { token: l1.token })).body.code, 'SESSION_REVOKED');

  // history
  await req('POST', '/api/auth/login', { email: 'fay@x.io', password: 'nope-nope-nope' });
  const l5 = (await req('POST', '/api/auth/login', { email: 'fay@x.io', password: 'yet-another-passphrase' })).body;
  const hist = (await req('GET', '/api/account/login-history', null, { token: l5.token })).body.history;
  assert.ok(hist.length >= 6);
  assert.ok(hist.some((h) => h.ok === 0 && h.reason === 'bad_password'));
  assert.ok(hist.some((h) => h.ok === 1 && h.new_device === 1));
  assert.ok(hist.every((h) => !('password' in h)));

  // core auth API stays compatible
  const u = s.db.prepare('SELECT * FROM users WHERE id=?').get(reg.user.id);
  const tok = s.auth.sign(u);
  assert.equal(s.auth.verifyToken(tok).email, 'fay@x.io');
  s.account.sessions.revokeAll(u.id, { reason: 'test' });
  assert.equal(s.auth.verifyToken(tok), null, 'revoked sessions fail verifyToken');
  assert.equal(s.auth.verifyToken(require('jsonwebtoken').sign({ sub: u.id }, 'test')), null, 'token without jti refused');
  assert.equal(s.auth.verifyToken('junk'), null);
});

// ---------------------------------------------------------------- brute force
test('brute force: per-email lockout with audit + event, admin unlock, per-IP lockout', async (t) => {
  const s = await setup({ config: (c) => { c.account = { maxFailuresPerEmail: 3, maxFailuresPerIp: 8, lockoutMin: 15 }; } });
  t.after(s.close);
  const { call } = s;
  const lockouts = [];
  s.events.on('account.lockout', (p) => lockouts.push(p));
  const reg = await register(call, 'gina@x.io');
  const admin = await register(call, 'admin@x.io');
  for (let i = 0; i < 2; i++) assert.equal((await call('POST', '/api/auth/login', { email: 'gina@x.io', password: 'wrong-wrong-1' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'gina@x.io', password: 'wrong-wrong-1' })).status, 401, 'third failure locks');
  assert.equal(lockouts.length, 1); assert.equal(lockouts[0].email, 'gina@x.io');
  const locked = await call('POST', '/api/auth/login', { email: 'gina@x.io', password: STRONG });
  assert.equal(locked.status, 429); assert.equal(locked.body.code, 'LOCKED_OUT'); assert.ok(locked.body.data.retry_after > 0);
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='account.lockout' AND target_id=?").get(reg.user.id));
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@x.io', password: STRONG })).status, 200, 'other accounts unaffected');

  // admin sees and clears it
  const det = await call('GET', `/api/admin/security/users/${reg.user.id}`, null, admin.token);
  assert.equal(det.status, 200); assert.ok(det.body.user.throttle.locked_until);
  assert.ok((await call('GET', '/api/admin/security/lockouts', null, admin.token)).body.lockouts.some((l) => l.key === 'email:gina@x.io'));
  assert.equal((await call('POST', `/api/admin/security/users/${reg.user.id}/clear-lockout`, {}, admin.token)).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { email: 'gina@x.io', password: STRONG })).status, 200);

  // per-IP: spraying unknown emails locks the IP, including for valid accounts
  for (let i = 0; i < 8; i++) await call('POST', '/api/auth/login', { email: `ghost${i}@x.io`, password: 'whatever-123' });
  const ipLocked = await call('POST', '/api/auth/login', { email: 'admin@x.io', password: STRONG });
  assert.equal(ipLocked.status, 429);
  assert.ok(lockouts.some((l) => l.key.startsWith('ip:')));
  assert.equal((await call('POST', '/api/admin/security/lockouts/clear', { key: lockouts.find((l) => l.key.startsWith('ip:')).key }, admin.token)).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { email: 'admin@x.io', password: STRONG })).status, 200);
});

test('captcha (Turnstile) on register and after repeated login failures, with injected HTTP', async (t) => {
  const s = await setup({ config: (c) => { c.account = { captcha: { provider: 'turnstile', siteKey: 'site', secret: 'shh', afterFailures: 2, onRegister: true }, maxFailuresPerEmail: 10 }; } });
  t.after(s.close);
  const { call } = s;
  const calls = [];
  let answer = { success: true };
  s.account.setFetch(async (url, opts) => { calls.push({ url, body: Object.fromEntries(new URLSearchParams(opts.body)) }); return { json: async () => answer }; });

  assert.equal((await call('GET', '/api/site')).body.account.captcha.provider, 'turnstile');
  const noTok = await call('POST', '/api/auth/register', { email: 'hank@x.io', password: STRONG });
  assert.equal(noTok.status, 400); assert.equal(noTok.body.code, 'CAPTCHA_REQUIRED'); assert.equal(noTok.body.data.site_key, 'site');
  answer = { success: false, 'error-codes': ['invalid-input-response'] };
  const badTok = await call('POST', '/api/auth/register', { email: 'hank@x.io', password: STRONG, captcha_token: 'bad' });
  assert.equal(badTok.status, 400); assert.equal(badTok.body.code, 'CAPTCHA_FAILED'); assert.deepEqual(badTok.body.data.errors, ['invalid-input-response']);
  answer = { success: true };
  assert.equal((await call('POST', '/api/auth/register', { email: 'hank@x.io', password: STRONG, captcha_token: 'good' })).status, 201);
  assert.equal(calls[1].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[1].body.secret, 'shh'); assert.equal(calls[1].body.response, 'good'); assert.ok(calls[1].body.remoteip);

  // login: free until 2 failures, then captcha required
  assert.equal((await call('POST', '/api/auth/login', { email: 'hank@x.io', password: 'bad-bad-bad1' })).body.code, undefined);
  const second = await call('POST', '/api/auth/login', { email: 'hank@x.io', password: 'bad-bad-bad1' });
  assert.equal(second.status, 401); assert.equal(second.body.code, 'CAPTCHA_REQUIRED');
  const needs = await call('POST', '/api/auth/login', { email: 'hank@x.io', password: STRONG });
  assert.equal(needs.status, 400); assert.equal(needs.body.code, 'CAPTCHA_REQUIRED');
  const withTok = await call('POST', '/api/auth/login', { email: 'hank@x.io', password: STRONG, captcha_token: 'ok' });
  assert.equal(withTok.status, 200); assert.ok(withTok.body.token);
  // verifier down -> 503, never a silent pass
  s.account.setFetch(async () => { throw new Error('ECONNRESET'); });
  await call('POST', '/api/auth/login', { email: 'hank@x.io', password: 'bad-bad-bad1' });
  await call('POST', '/api/auth/login', { email: 'hank@x.io', password: 'bad-bad-bad1' });
  assert.equal((await call('POST', '/api/auth/login', { email: 'hank@x.io', password: STRONG, captcha_token: 'ok' })).body.code, 'CAPTCHA_UNAVAILABLE');
});

// ---------------------------------------------------------------- API keys
test('API keys: bearer + HMAC auth, scopes by path, IP allowlist, replay/skew, revoke, forbidden areas', async (t) => {
  const s = await setup();
  t.after(s.close);
  const req = requester(s.base);
  const { call } = s;
  const reg = await register(call, 'ivy@x.io');
  const tok = reg.token;
  await call('POST', '/api/wallet/faucet', {}, tok);
  const created = [];
  s.events.on('account.api_key_created', (p) => created.push(p));

  assert.equal((await req('POST', '/api/account/api-keys', { label: '', scopes: ['read'] }, { token: tok })).status, 400);
  assert.equal((await req('POST', '/api/account/api-keys', { label: 'x', scopes: ['admin'] }, { token: tok })).status, 400);
  assert.equal((await req('POST', '/api/account/api-keys', { label: 'x', scopes: ['withdraw'] }, { token: tok })).body.code, 'IP_ALLOWLIST_REQUIRED');
  assert.equal((await req('POST', '/api/account/api-keys', { label: 'x', scopes: ['read'], ip_allowlist: ['999.1.1.1'] }, { token: tok })).body.code, 'INVALID_IP');
  assert.equal((await req('POST', '/api/account/api-keys', { label: 'x', scopes: ['read'], expires_in_days: 0 }, { token: tok })).status, 400);
  assert.equal((await req('POST', '/api/account/api-keys', { label: 'x', scopes: ['read'], auth_mode: 'magic' }, { token: tok })).status, 400);

  const ro = (await req('POST', '/api/account/api-keys', { label: 'read only', scopes: ['read'], auth_mode: 'bearer' }, { token: tok })).body;
  assert.match(ro.key.key_id, /^pk_[a-f0-9]{16}$/); assert.match(ro.secret, /^sk_/); assert.equal(ro.bearer, `${ro.key.key_id}.${ro.secret}`);
  assert.equal(created.length, 1);
  const listed = (await req('GET', '/api/account/api-keys', null, { token: tok })).body.keys;
  assert.equal(listed.length, 1); assert.equal(listed[0].secret, undefined); assert.equal(listed[0].secret_hash, undefined);

  // bearer: read works, trade/withdraw/account/admin do not
  const w = await req('GET', '/api/wallet', null, { token: ro.bearer });
  assert.equal(w.status, 200, JSON.stringify(w.body)); assert.ok(w.body.balances.length);
  const meViaKey = await req('GET', '/api/auth/me', null, { token: ro.bearer });
  assert.equal(meViaKey.status, 200); assert.equal(meViaKey.body.auth.via, 'api_key'); assert.deepEqual(meViaKey.body.auth.scopes, ['read']);
  assert.equal((await req('POST', '/api/auth/logout', {}, { token: ro.bearer })).body.code, 'API_KEY_FORBIDDEN');
  assert.equal((await req('POST', '/api/auth/change-password', { current: STRONG, password: 'x'.repeat(12) }, { token: ro.bearer })).body.code, 'API_KEY_FORBIDDEN');
  assert.equal((await req('GET', '/api/account/sessions', null, { token: ro.bearer })).body.code, 'API_KEY_FORBIDDEN');
  assert.equal((await req('POST', '/api/account/api-keys', { label: 'x', scopes: ['read'] }, { token: ro.bearer })).body.code, 'API_KEY_FORBIDDEN');
  const noTrade = await req('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '1', qty: '0.001' }, { token: ro.bearer });
  assert.equal(noTrade.status, 403); assert.equal(noTrade.body.code, 'API_KEY_SCOPE'); assert.equal(noTrade.body.data.required, 'trade');
  assert.equal((await req('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '10' }, { token: ro.bearer })).body.code, 'API_KEY_SCOPE');
  assert.equal((await req('POST', '/api/wallet/faucet', {}, { token: ro.bearer })).body.code, 'API_KEY_FORBIDDEN');
  assert.equal((await req('POST', '/api/servers/free', { hostname: 'bot' }, { token: ro.bearer })).body.code, 'API_KEY_FORBIDDEN');
  assert.equal((await req('GET', '/api/wallet', null, { token: `${ro.key.key_id}.sk_wrong` })).body.code, 'API_KEY_INVALID');
  assert.equal((await req('GET', '/api/wallet', null, { token: 'pk_0000000000000000.sk_x' })).body.code, 'API_KEY_INVALID');
  assert.equal((await req('GET', '/api/wallet', null, { token: ro.key.key_id })).body.code, 'API_KEY_INVALID', 'bearer needs the secret');
  assert.equal((await req('GET', '/api/wallet', null, { headers: { 'x-api-key': ro.key.key_id, 'x-api-timestamp': String(Date.now()), 'x-api-signature': 'a'.repeat(64) } })).body.code, 'API_KEY_MODE', 'bearer-only key cannot sign');

  // HMAC key with trade scope and allowlist
  const tr = (await req('POST', '/api/account/api-keys', { label: 'bot', scopes: ['read', 'trade'], ip_allowlist: '127.0.0.1, ::1', expires_in_days: 30 }, { token: tok })).body;
  assert.equal(tr.key.auth_mode, 'hmac'); assert.ok(tr.key.expires_at);
  const signed = (method, path, body, { ts = String(Date.now()), secret = tr.secret, key = tr.key.key_id } = {}) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const sig = crypto.createHmac('sha256', secret).update(`${ts}${method}${path}${bodyStr}`).digest('hex');
    return req(method, path, bodyStr || undefined, { headers: { 'x-api-key': key, 'x-api-timestamp': ts, 'x-api-signature': sig } });
  };
  const g = await signed('GET', '/api/spot/orders?market=BTC_USDT');
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const order = await signed('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '1000', qty: '0.001' });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const cancel = await signed('DELETE', `/api/spot/BTC_USDT/orders/${order.body.order.id}`);
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await signed('GET', '/api/wallet', null, { secret: 'sk_nope' })).body.code, 'API_KEY_SIGNATURE');
  assert.equal((await signed('GET', '/api/wallet', null, { ts: String(Date.now() - 120_000) })).body.code, 'API_KEY_TIMESTAMP');
  const ts = String(Date.now());
  assert.equal((await signed('GET', '/api/wallet', null, { ts })).status, 200);
  assert.equal((await signed('GET', '/api/wallet', null, { ts })).body.code, 'API_KEY_REPLAY');
  assert.equal((await req('GET', '/api/wallet', null, { headers: { 'x-api-key': `${tr.key.key_id}.${tr.secret}` } })).body.code, 'API_KEY_INVALID', 'secret must not be sent in X-API-Key');
  assert.equal((await req('GET', '/api/wallet', null, { headers: { 'x-api-key': tr.key.key_id } })).body.code, 'API_KEY_SIGNATURE', 'missing headers');
  assert.equal((await req('GET', '/api/wallet', null, { token: tr.bearer })).status, 200, 'hmac keys also work as bearer');
  assert.equal((await req('GET', '/api/account/time')).status, 200);
  const sess = (await req('GET', '/api/account/api-keys', null, { token: tok })).body.keys.find((k) => k.id === tr.key.id);
  assert.ok(sess.last_used_at);

  // IP allowlist mismatch
  const far = (await req('POST', '/api/account/api-keys', { label: 'far', scopes: ['read'], ip_allowlist: ['10.9.9.9'], auth_mode: 'bearer' }, { token: tok })).body;
  const denied = await req('GET', '/api/wallet', null, { token: far.bearer });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'API_KEY_IP');

  // withdraw via API key: scope + allowlist stand in for the 2FA step-up
  const clk = clockFor(s);
  const { secret } = await enable2fa(req, tok, clk);
  const wk = await req('POST', '/api/account/api-keys', { label: 'wd', scopes: ['withdraw'], ip_allowlist: ['127.0.0.1', '::1'] }, { token: tok });
  assert.equal(wk.body.code, 'STEP_UP_REQUIRED', 'creating a key needs step-up once 2FA is on');
  const wk2 = await req('POST', '/api/account/api-keys', { label: 'wd', scopes: ['withdraw'], ip_allowlist: ['127.0.0.1', '::1'] }, { token: tok, headers: { 'x-2fa-code': clk.next(secret) } });
  assert.equal(wk2.status, 201, JSON.stringify(wk2.body));
  const wdr = await req('POST', '/api/wallet/withdraw', { asset: 'USDT', chain: 'TRC20', address: 'TXYZabcdefghijklmnopqrstuv', amount: '10' }, { token: wk2.body.bearer });
  assert.equal(wdr.status, 201, JSON.stringify(wdr.body));

  // revoke: own only; admin via API key is refused
  const mallory = await register(call, 'mallory2@x.io');
  assert.equal((await req('DELETE', `/api/account/api-keys/${tr.key.id}`, null, { token: mallory.token })).status, 404);
  assert.equal((await req('DELETE', `/api/account/api-keys/${tr.key.id}`, null, { token: tok })).status, 200);
  assert.equal((await req('GET', '/api/wallet', null, { token: tr.bearer })).body.code, 'API_KEY_REVOKED');
  assert.equal((await req('DELETE', `/api/account/api-keys/${tr.key.id}`, null, { token: tok })).status, 404);
  const adminKeyUser = await register(call, 'admin@x.io');
  const ak = (await req('POST', '/api/account/api-keys', { label: 'a', scopes: ['read'], auth_mode: 'bearer' }, { token: adminKeyUser.token })).body;
  assert.equal((await req('GET', '/api/admin/stats', null, { token: ak.bearer })).status, 403);
  // expired key
  s.db.prepare("UPDATE api_keys SET expires_at=datetime('now','-1 minute') WHERE id=?").run(ak.key.id);
  assert.equal((await req('GET', '/api/wallet', null, { token: ak.bearer })).body.code, 'API_KEY_EXPIRED');
});

// ---------------------------------------------------------------- lifecycle
test('GDPR export, delete (blocked by assets, then anonymised), email change', async (t) => {
  const s = await setup();
  t.after(s.close);
  const req = requester(s.base);
  const { call } = s;
  const reg = await register(call, 'jo@x.io');
  const tok = reg.token;
  await call('POST', '/api/wallet/faucet', {}, tok);
  await call('POST', '/api/spot/BTC_USDT/orders', { side: 'buy', type: 'limit', price: '1000', qty: '0.001' }, tok);

  const exp = await req('GET', '/api/account/export?download', null, { token: tok });
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment; filename="account-\d+-/);
  assert.equal(exp.body.profile.email, 'jo@x.io'); assert.equal(exp.body.profile.password_hash, undefined);
  assert.ok(exp.body.wallet.balances.find((b) => b.asset === 'USDT'));
  assert.ok(exp.body.wallet.ledger.length >= 4); assert.equal(exp.body.trading.orders.length, 1);
  assert.ok(Array.isArray(exp.body.cloud.servers) && Array.isArray(exp.body.security.login_history));
  assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='account.exported'").get());

  const blocked = await req('POST', '/api/account/delete', { password: STRONG, confirm: 'DELETE' }, { token: tok });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'ACCOUNT_HAS_ASSETS');
  assert.ok(blocked.body.data.blockers.some((b) => /Cancel your open orders/.test(b)));
  assert.ok(blocked.body.data.blockers.some((b) => /Wallet still holds/.test(b)));
  assert.ok((await req('GET', '/api/account/delete/check', null, { token: tok })).body.blockers.length >= 2);

  const kim = await register(call, 'kim@x.io');
  assert.equal((await req('POST', '/api/account/delete', { password: 'wrong', confirm: 'DELETE' }, { token: kim.token })).status, 401);
  assert.equal((await req('POST', '/api/account/delete', { password: STRONG, confirm: 'nope' }, { token: kim.token })).status, 400);
  assert.deepEqual((await req('GET', '/api/account/delete/check', null, { token: kim.token })).body.blockers, []);
  assert.equal((await req('POST', '/api/account/delete', { password: STRONG, confirm: 'DELETE' }, { token: kim.token })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', null, { token: kim.token })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'kim@x.io', password: STRONG })).status, 401);
  const row = s.db.prepare('SELECT * FROM users WHERE id=?').get(kim.user.id);
  assert.match(row.email, /^deleted-\d+-[a-f0-9]+@deleted\.invalid$/); assert.ok(row.deleted_at);
  assert.equal((await call('POST', '/api/auth/register', { email: 'kim@x.io', password: STRONG })).status, 201, 'email is free again');
  assert.equal((await call('POST', '/api/auth/password-reset/request', { email: row.email })).body.dev_token, undefined);

  // email change: verification of the new address
  const taken = await req('POST', '/api/account/email/change', { password: STRONG, new_email: 'kim@x.io' }, { token: tok });
  assert.equal(taken.status, 409);
  assert.equal((await req('POST', '/api/account/email/change', { password: STRONG, new_email: 'jo@x.io' }, { token: tok })).status, 400);
  assert.equal((await req('POST', '/api/account/email/change', { password: 'wrong', new_email: 'jo2@x.io' }, { token: tok })).status, 401);
  const ch = await req('POST', '/api/account/email/change', { password: STRONG, new_email: 'Jo2@x.io' }, { token: tok });
  assert.equal(ch.status, 200); assert.equal(ch.body.pending_email, 'jo2@x.io'); assert.ok(ch.body.dev_token);
  assert.equal((await req('GET', '/api/auth/me', null, { token: tok })).body.user.pending_email, 'jo2@x.io');
  assert.equal((await req('GET', '/api/auth/me', null, { token: tok })).body.user.email, 'jo@x.io', 'unchanged until confirmed');
  const cf = await req('POST', '/api/account/email/confirm', { token: ch.body.dev_token });
  assert.equal(cf.status, 200); assert.equal(cf.body.user.email, 'jo2@x.io'); assert.equal(cf.body.user.email_verified, true);
  assert.equal((await req('POST', '/api/account/email/confirm', { token: ch.body.dev_token })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { email: 'jo2@x.io', password: STRONG })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { email: 'jo@x.io', password: STRONG })).status, 401);
});

// ---------------------------------------------------------------- admin
test('admin Security console: search, lock/unlock, force reset, disable 2FA, sessions, audit; IDOR + role checks', async (t) => {
  const s = await setup();
  t.after(s.close);
  const req = requester(s.base);
  const { call } = s;
  const admin = await register(call, 'admin@x.io');
  const lee = await register(call, 'lee@x.io');
  const clk = clockFor(s);
  const { secret: leeSecret } = await enable2fa(req, lee.token, clk);
  const lg = await call('POST', '/api/auth/login', { email: 'lee@x.io', password: STRONG });
  const leeTok2 = (await call('POST', '/api/auth/2fa/verify', { challenge: lg.body.challenge, code: clk.next(leeSecret) })).body.token;
  assert.ok(leeTok2);

  // role check
  assert.equal((await call('GET', '/api/admin/security/users', null, lee.token)).status, 403);
  assert.equal((await call('GET', '/api/admin/security/users')).status, 401);

  const ov = await call('GET', '/api/admin/security/overview', null, admin.token);
  assert.equal(ov.status, 200); assert.equal(ov.body.users, 2); assert.equal(ov.body.two_factor, 1);
  const search = await call('GET', '/api/admin/security/users?q=lee', null, admin.token);
  assert.equal(search.body.users.length, 1); assert.equal(search.body.users[0].two_factor, true); assert.equal(search.body.users[0].sessions, 2);
  assert.equal((await call('GET', `/api/admin/security/users?q=${lee.user.id}`, null, admin.token)).body.users[0].email, 'lee@x.io');
  assert.equal((await call('GET', '/api/admin/security/users?filter=2fa', null, admin.token)).body.users.length, 1);
  assert.equal((await call('GET', '/api/admin/security/users/999', null, admin.token)).status, 404);
  assert.equal((await call('GET', '/api/admin/security/users/abc', null, admin.token)).status, 400);
  const det = await call('GET', `/api/admin/security/users/${lee.user.id}`, null, admin.token);
  assert.equal(det.body.sessions.length, 2); assert.ok(det.body.login_history.length >= 2); assert.equal(det.body.two_factor.enabled, true);
  assert.ok(det.body.audit.some((a) => a.action === 'account.2fa.enabled'));

  // revoke one session, then lock
  assert.equal((await call('DELETE', `/api/admin/security/users/${lee.user.id}/sessions/${det.body.sessions[0].id}`, null, admin.token)).status, 200);
  assert.equal((await call('POST', `/api/admin/security/users/${admin.user.id}/lock`, {}, admin.token)).status, 400, 'no self lock');
  const lock = await call('POST', `/api/admin/security/users/${lee.user.id}/lock`, { reason: 'fraud review' }, admin.token);
  assert.equal(lock.status, 200);
  const dead = await call('GET', '/api/auth/me', null, lee.token);
  assert.equal(dead.status, 403, 'locked users are refused'); assert.equal(dead.body.code, 'ACCOUNT_LOCKED');
  const lockedLogin = await call('POST', '/api/auth/login', { email: 'lee@x.io', password: STRONG });
  assert.equal(lockedLogin.status, 403); assert.equal(lockedLogin.body.code, 'ACCOUNT_LOCKED');
  assert.equal((await call('GET', `/api/admin/security/users/${lee.user.id}`, null, admin.token)).body.user.locked, true);
  assert.equal((await call('POST', `/api/admin/security/users/${lee.user.id}/unlock`, {}, admin.token)).status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, lee.token)).body.code, 'SESSION_REVOKED', 'sessions were revoked by the lock');
  assert.equal((await call('POST', '/api/auth/login', { email: 'lee@x.io', password: STRONG })).body.two_factor, true);

  // disable 2FA: reason required; audited as admin action
  assert.equal((await call('POST', `/api/admin/security/users/${lee.user.id}/disable-2fa`, {}, admin.token)).status, 400);
  const d2 = await call('POST', `/api/admin/security/users/${lee.user.id}/disable-2fa`, { reason: 'ticket #123 lost phone' }, admin.token);
  assert.equal(d2.status, 200);
  const relog = await call('POST', '/api/auth/login', { email: 'lee@x.io', password: STRONG });
  assert.ok(relog.body.token, 'plain password login again');
  const aud = await call('GET', `/api/admin/security/audit?user_id=${lee.user.id}&action=admin.`, null, admin.token);
  assert.ok(aud.body.audit.some((a) => a.action === 'admin.user.2fa_disabled' && a.actor_email === 'admin@x.io' && a.details.reason.includes('#123')));
  assert.ok(aud.body.audit.every((a) => a.target_id === lee.user.id || a.actor_id === lee.user.id));
  assert.equal((await call('GET', '/api/admin/security/audit?user_id=x', null, admin.token)).status, 400);

  // force reset
  const fr = await call('POST', `/api/admin/security/users/${lee.user.id}/force-reset`, { reason: 'credential leak' }, admin.token);
  assert.equal(fr.status, 200); assert.ok(fr.body.dev_token);
  assert.equal((await call('GET', '/api/auth/me', null, relog.body.token)).status, 401);
  const must = await call('POST', '/api/auth/login', { email: 'lee@x.io', password: STRONG });
  assert.equal(must.status, 403); assert.equal(must.body.code, 'PASSWORD_RESET_REQUIRED');
  assert.equal((await call('POST', '/api/auth/password-reset/confirm', { token: fr.body.dev_token, password: 'fresh-start-passphrase' })).status, 200);
  assert.ok((await call('POST', '/api/auth/login', { email: 'lee@x.io', password: 'fresh-start-passphrase' })).body.token);

  // verify-email by admin, revoke all sessions
  assert.equal((await call('POST', `/api/admin/security/users/${lee.user.id}/verify-email`, { reason: 'checked id' }, admin.token)).status, 200);
  assert.equal((await call('GET', `/api/admin/security/users/${lee.user.id}`, null, admin.token)).body.user.email_verified, true);
  const rv = await call('POST', `/api/admin/security/users/${lee.user.id}/sessions/revoke`, {}, admin.token);
  assert.ok(rv.body.revoked >= 1);
  assert.equal((await call('GET', `/api/admin/security/users/${lee.user.id}`, null, admin.token)).body.sessions.length, 0);

  // admin with 2FA needs step-up for takeover-grade actions
  const { secret: adminSecret } = await enable2fa(req, admin.token, clk);
  const su = await call('POST', `/api/admin/security/users/${lee.user.id}/force-reset`, {}, admin.token);
  assert.equal(su.body.code, 'STEP_UP_REQUIRED');
  assert.equal((await req('POST', `/api/admin/security/users/${lee.user.id}/force-reset`, {}, { token: admin.token, headers: { 'x-2fa-code': clk.next(adminSecret) } })).status, 200);
});
