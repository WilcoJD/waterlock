import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, count, ledgerMismatches, startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

describe('Idempotency-Key', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('replaying an open returns the identical response and never double charges', async () => {
    const u = app.user({ balancePence: 10_000 });
    const opts = { token: u.token, body: { quantity: 2 }, headers: { 'Idempotency-Key': 'open-123' } };
    const first = await app.request('POST', '/packs/starter/open', opts);
    const second = await app.request('POST', '/packs/starter/open', opts);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.text, first.text);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.equal((await app.me(u.token)).balancePence, 9_000);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ?', u.id), 2);
    // A new key opens again.
    const third = await app.request('POST', '/packs/starter/open', { ...opts, headers: { 'Idempotency-Key': 'open-124' } });
    assert.notEqual(third.body.batchId, first.body.batchId);
    assert.equal((await app.me(u.token)).balancePence, 8_000);
  });

  test('the same key on a different route or with a different body is a conflict', async () => {
    const u = app.user({ balancePence: 10_000 });
    const headers = { 'Idempotency-Key': 'k1' };
    assert.equal((await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 }, headers })).status, 200);
    const otherRoute = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 }, headers });
    assert.equal(otherRoute.status, 409);
    assert.equal(otherRoute.body.error.code, 'conflict');
    const otherPack = await app.request('POST', '/packs/premium/open', { token: u.token, body: { quantity: 1 }, headers });
    assert.equal(otherPack.status, 409);
    const otherBody = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 2 }, headers });
    assert.equal(otherBody.status, 409);
    assert.equal((await app.me(u.token)).balancePence, 9_500);
  });

  test('keys are per user', async () => {
    const a = app.user({ balancePence: 10_000 });
    const b = app.user({ balancePence: 10_000 });
    const headers = { 'Idempotency-Key': 'shared-key' };
    const ra = await app.request('POST', '/packs/starter/open', { token: a.token, body: { quantity: 1 }, headers });
    const rb = await app.request('POST', '/packs/starter/open', { token: b.token, body: { quantity: 1 }, headers });
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.notEqual(ra.body.batchId, rb.body.batchId);
    assert.equal((await app.me(b.token)).balancePence, 9_500);
  });

  test('failed requests are not stored, so a retry after topping up works', async () => {
    const u = app.user({ balancePence: 100 });
    const opts = { token: u.token, body: { quantity: 1 }, headers: { 'Idempotency-Key': 'retry-me' } };
    assert.equal((await app.request('POST', '/packs/starter/open', opts)).status, 402);
    app.fund(u.id, 1_000);
    const ok = await app.request('POST', '/packs/starter/open', opts);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.balancePence, 600);
  });

  test('sell, top-up, shipment and withdrawal replays do not repeat the side effect', async () => {
    const u = app.user({ balancePence: 20_000 });
    const opened = await app.request('POST', '/packs/single/open', { token: u.token, body: { quantity: 3 } });
    const [i1, i2, i3] = opened.body.pulls.map((p: { inventoryItemId: string }) => p.inventoryItemId);

    const sell = { token: u.token, body: { itemIds: [i1] }, headers: { 'Idempotency-Key': 'sell-1' } };
    const s1 = await app.request('POST', '/inventory/sell', sell);
    const s2 = await app.request('POST', '/inventory/sell', sell);
    assert.equal(s1.status, 200);
    assert.equal(s2.text, s1.text);

    const top = { token: u.token, body: { amountPence: 1_000 }, headers: { 'Idempotency-Key': 'top-1' } };
    const t1 = await app.request('POST', '/wallet/topup', top);
    const t2 = await app.request('POST', '/wallet/topup', top);
    assert.equal(t1.body.kind, 'credited');
    assert.equal(t2.text, t1.text);

    const addr = await app.request('POST', '/addresses', {
      token: u.token,
      body: { fullName: 'A B', line1: '1 Road', city: 'London', postcode: 'SW1A 1AA', country: 'GB' },
    });
    const ship = { token: u.token, body: { itemIds: [i2], addressId: addr.body.id }, headers: { 'Idempotency-Key': 'ship-1' } };
    const sh1 = await app.request('POST', '/shipments', ship);
    const sh2 = await app.request('POST', '/shipments', ship);
    assert.equal(sh1.status, 201);
    assert.equal(sh2.status, 201);
    assert.equal(sh2.text, sh1.text);

    const wd = { token: u.token, body: { amountPence: 1_000, payoutDetails: 'sort 00-00-00 acc 12345678' }, headers: { 'Idempotency-Key': 'wd-1' } };
    const w1 = await app.request('POST', '/wallet/withdrawals', wd);
    const w2 = await app.request('POST', '/wallet/withdrawals', wd);
    assert.equal(w1.status, 201);
    assert.equal(w2.text, w1.text);

    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'buyback'", u.id), 1);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'topup'", u.id), 1);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM shipments WHERE user_id = ?', u.id), 1);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM withdrawals WHERE user_id = ?', u.id), 1);
    // 20000 - 3*2200 + 1799 + 1000 - 399 - 1000
    assert.equal((await app.me(u.token)).balancePence, 20_000 - 6_600 + 1_799 + 1_000 - 399 - 1_000);
    assert.ok(i3);
    assert.deepEqual(ledgerMismatches(app.db), []);
  });

  test('keys expire after 24h; bad keys are rejected', async () => {
    const u = app.user({ balancePence: 10_000 });
    const opts = { token: u.token, body: { quantity: 1 }, headers: { 'Idempotency-Key': 'old-key' } };
    await app.request('POST', '/packs/starter/open', opts);
    app.clock.advance(DAY + 1);
    const again = await app.request('POST', '/packs/starter/open', opts);
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('idempotent-replayed'), null);
    assert.equal((await app.me(u.token)).balancePence, 9_000);
    const long = await app.request('POST', '/packs/starter/open', { ...opts, headers: { 'Idempotency-Key': 'x'.repeat(101) } });
    assert.equal(long.status, 400);
  });
});
