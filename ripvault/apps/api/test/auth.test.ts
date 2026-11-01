import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signToken, verifyToken } from '../src/auth/jwt.ts';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import { DAY, startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

const valid = {
  email: 'Ash.Ketchum@Example.com',
  password: 'pallet-town-1',
  displayName: 'Ash',
  dateOfBirth: '1997-04-01',
  acceptTerms: true,
};

describe('auth', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('register returns 201, a token and Me with a lower-cased email and zero balance', async () => {
    const res = await app.request('POST', '/auth/register', { body: valid });
    assert.equal(res.status, 201);
    assert.match(res.body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(res.body.user.email, 'ash.ketchum@example.com');
    assert.equal(res.body.user.displayName, 'Ash');
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.balancePence, 0);
    assert.deepEqual(res.body.user.stats, { packsOpened: 0, cardsInVault: 0, vaultValuePence: 0, biggestPullPence: 0, totalSpentPence: 0 });
    // A fresh seed pair exists, and only its hash is exposed.
    const fair = await app.request('GET', '/fairness', { token: res.body.token });
    assert.equal(fair.status, 200);
    assert.match(fair.body.serverSeedHash, /^[0-9a-f]{64}$/);
    assert.equal(fair.body.nonce, 0);
    assert.equal(JSON.stringify(fair.body).includes('serverSeed"'), false);
  });

  test('duplicate email (any case) is email_taken', async () => {
    const res = await app.request('POST', '/auth/register', { body: { ...valid, email: 'ASH.KETCHUM@example.COM' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'email_taken');
  });

  test('login works with any email casing; wrong password and unknown email give the same generic error', async () => {
    const ok = await app.request('POST', '/auth/login', { body: { email: '  ASH.ketchum@example.com ', password: valid.password } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.email, 'ash.ketchum@example.com');
    const me = await app.request('GET', '/me', { token: ok.body.token });
    assert.equal(me.status, 200);

    const wrong = await app.request('POST', '/auth/login', { body: { email: valid.email, password: 'nope-nope-nope' } });
    const unknown = await app.request('POST', '/auth/login', { body: { email: 'misty@example.com', password: 'whatever123' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.code, 'invalid_credentials');
    assert.deepEqual(wrong.body, unknown.body);
  });

  test('validation_failed lists every bad field', async () => {
    const res = await app.request('POST', '/auth/register', {
      body: { email: 'not-an-email', password: 'short', displayName: '', dateOfBirth: '1990-02-30', acceptTerms: false },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'validation_failed');
    assert.deepEqual(Object.keys(res.body.error.fields).sort(), ['acceptTerms', 'dateOfBirth', 'displayName', 'email', 'password']);
  });

  test('display name over 32 chars and missing fields are rejected', async () => {
    const res = await app.request('POST', '/auth/register', { body: { ...valid, email: 'x@y.com', displayName: 'x'.repeat(33) } });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.fields.displayName);
    const empty = await app.request('POST', '/auth/register', { body: {} });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'validation_failed');
  });

  test('future and malformed dates of birth are validation errors; under 18 is underage', async () => {
    const future = await app.request('POST', '/auth/register', { body: { ...valid, email: 'f@x.com', dateOfBirth: '2030-01-01' } });
    assert.equal(future.status, 400);
    assert.ok(future.body.error.fields.dateOfBirth);
    const bad = await app.request('POST', '/auth/register', { body: { ...valid, email: 'b@x.com', dateOfBirth: '01/02/1990' } });
    assert.equal(bad.status, 400);
    // Clock is 2026-06-01. Born 2008-06-02 => 17 until tomorrow.
    const young = await app.request('POST', '/auth/register', { body: { ...valid, email: 'y@x.com', dateOfBirth: '2008-06-02' } });
    assert.equal(young.status, 403);
    assert.equal(young.body.error.code, 'underage');
    const eighteenToday = await app.request('POST', '/auth/register', { body: { ...valid, email: 'e@x.com', dateOfBirth: '2008-06-01' } });
    assert.equal(eighteenToday.status, 201);
  });

  test('requests without, with malformed, or with forged tokens are 401', async () => {
    assert.equal((await app.request('GET', '/me')).status, 401);
    assert.equal((await app.request('GET', '/me', { headers: { Authorization: 'Bearer nope' } })).status, 401);
    const u = app.user();
    const [h, p] = u.token.split('.');
    const forged = `${h}.${p}.${createHmac('sha256', 'wrong-secret').update(`${h}.${p}`).digest('base64url')}`;
    const res = await app.request('GET', '/me', { token: forged });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthorized');
    // alg=none is refused
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    assert.equal((await app.request('GET', '/me', { token: none })).status, 401);
  });

  test('tokens expire after 30 days', async () => {
    const u = app.user();
    assert.equal((await app.request('GET', '/me', { token: u.token })).status, 200);
    app.clock.advance(30 * DAY + 1000);
    const res = await app.request('GET', '/me', { token: u.token });
    assert.equal(res.status, 401);
    app.clock.advance(-(30 * DAY + 1000));
  });

  test('a token for a deleted user is rejected', async () => {
    const u = app.user();
    app.db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    assert.equal((await app.request('GET', '/me', { token: u.token })).status, 401);
  });

  test('non-admins get 403 on admin routes', async () => {
    const u = app.user();
    const res = await app.request('GET', '/admin/shipments', { token: u.token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'forbidden');
  });

  test('PATCH /me updates the display name with validation', async () => {
    const u = app.user();
    const ok = await app.request('PATCH', '/me', { token: u.token, body: { displayName: '  Misty  ' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.displayName, 'Misty');
    const bad = await app.request('PATCH', '/me', { token: u.token, body: { displayName: '' } });
    assert.equal(bad.status, 400);
  });
});

test('auth endpoints are rate limited per IP (10/min)', async () => {
  const app = await startApp({ config: { authRateLimitPerMinute: 10 } });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await app.request('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'x' } });
      assert.equal(r.status, 401);
    }
    const limited = await app.request('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'x' } });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    // Other endpoints are unaffected; after a minute auth works again.
    assert.equal((await app.request('GET', '/health')).status, 200);
    app.clock.advance(61_000);
    assert.equal((await app.request('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'x' } })).status, 401);
  } finally {
    await app.close();
  }
});

test('jwt: HS256 round trip, expiry, tampering', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const token = signToken('usr_1', 'a'.repeat(32), now);
  assert.equal(verifyToken(token, 'a'.repeat(32), now)?.sub, 'usr_1');
  assert.equal(verifyToken(token, 'b'.repeat(32), now), null);
  assert.equal(verifyToken(token, 'a'.repeat(32), new Date(now.getTime() + 30 * DAY)), null);
  const [h, , s] = token.split('.');
  const evil = Buffer.from(JSON.stringify({ sub: 'usr_admin', iat: 0, exp: 9e9 })).toString('base64url');
  assert.equal(verifyToken(`${h}.${evil}.${s}`, 'a'.repeat(32), now), null);
  assert.equal(verifyToken('a.b', 'a'.repeat(32), now), null);
});

test('password hashing: random salt, verify, reject wrong password', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('wrong horse', a), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});
