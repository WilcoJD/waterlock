import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, DEV_JWT_SECRET, loadConfig, publicAppConfig } from '../src/config.ts';
import { startApp } from './helpers.ts';

const PROD_SECRET = 'x'.repeat(40);

test('development defaults match docs/API.md', () => {
  const c = loadConfig({});
  assert.equal(c.env, 'development');
  assert.equal(c.port, 4000);
  assert.equal(c.databasePath, './data/ripvault.db');
  assert.equal(c.jwtSecret, DEV_JWT_SECRET);
  assert.equal(c.buybackBps, 9000);
  assert.equal(c.maxPackRtpBps, 9500);
  assert.deepEqual(c.shipping, { flatFeePence: 399, freeOverPence: 5000, maxItemsPerShipment: 50, countries: ['GB'] });
  assert.equal(c.devTopups, true);
  assert.equal(c.stripe, null);
  assert.equal(c.publicUrl, 'http://localhost:4000');
  assert.equal(c.withdrawals.enabled, true);
  assert.equal(c.seedDemoUser, true);
  assert.equal(c.priceSource, 'cardmarket');
  assert.equal(c.fxEurGbp, 0.86);
  assert.equal(c.fxUsdGbp, 0.79);
  assert.equal(c.authRateLimitPerMinute, 10);
});

test('production requires a 32+ char JWT_SECRET', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), (e: unknown) => e instanceof ConfigError && /JWT_SECRET/.test(e.message));
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short-secret' }), ConfigError);
  assert.equal(loadConfig({ NODE_ENV: 'production', JWT_SECRET: PROD_SECRET }).jwtSecret, PROD_SECRET);
});

test('production forces dev top-ups off and forbids the demo user', () => {
  const c = loadConfig({ NODE_ENV: 'production', JWT_SECRET: PROD_SECRET, DEV_TOPUPS: '1' });
  assert.equal(c.devTopups, false);
  assert.equal(c.seedDemoUser, false);
  assert.equal(publicAppConfig(c).topup.devTopupsEnabled, false);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: PROD_SECRET, SEED_DEMO_USER: '1' }), /SEED_DEMO_USER/);
});

test('invalid values are all reported together', () => {
  try {
    loadConfig({ BUYBACK_BPS: '12000', SHIPPING_COUNTRIES: 'GBR', PRICE_SOURCE: 'ebay', STRIPE_SECRET_KEY: 'sk_test', FX_EUR_GBP: '-1', PORT: 'abc' });
    assert.fail('expected ConfigError');
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.problems.length, 6);
  }
});

test('empty SHIPPING_FREE_OVER_PENCE means never free; stripe needs both keys', () => {
  assert.equal(loadConfig({ SHIPPING_FREE_OVER_PENCE: '' }).shipping.freeOverPence, null);
  assert.equal(loadConfig({ SHIPPING_FREE_OVER_PENCE: '2500' }).shipping.freeOverPence, 2500);
  const c = loadConfig({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1', SHIPPING_COUNTRIES: 'gb, ie' });
  assert.ok(c.stripe);
  assert.deepEqual(c.shipping.countries, ['GB', 'IE']);
});

test('GET /config serves the public AppConfig only', async () => {
  const app = await startApp();
  try {
    const res = await app.request('GET', '/config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      currency: 'GBP',
      buybackBps: 9000,
      maxOpenQuantity: 10,
      shipping: { flatFeePence: 399, freeOverPence: 5000, maxItemsPerShipment: 50, countries: ['GB'] },
      topup: { minPence: 500, maxPence: 50000, presetsPence: [1000, 2500, 5000, 10000], stripeEnabled: false, devTopupsEnabled: true },
      withdrawals: { enabled: true, minPence: 1000 },
      minimumAge: 18,
    });
    assert.equal(res.text.includes('jwt'), false);
  } finally {
    await app.close();
  }
});

test('dev top-up is disabled under a production config (even if the object says devTopups)', async () => {
  const prod = loadConfig({ NODE_ENV: 'production', JWT_SECRET: PROD_SECRET, LOG_REQUESTS: '0' });
  const app = await startApp({ config: { ...prod, databasePath: ':memory:', devTopups: true } });
  try {
    const cfg = await app.request('GET', '/config');
    assert.equal(cfg.body.topup.devTopupsEnabled, false);
    const u = app.user();
    const res = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1000 } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'payments_unavailable');
    assert.equal((await app.me(u.token)).balancePence, 0);
  } finally {
    await app.close();
  }
});
