import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenPackResponse, PackDetail, PackSummary } from '@ripvault/shared';
import { DAY, HOUR, count, ledgerMismatches, startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

describe('pack catalogue', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('GET /packs lists active packs by sortOrder with stats from current values', async () => {
    const res = await app.request<PackSummary[]>('GET', '/packs');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.map((p) => p.id),
      ['starter', 'premium', 'limited', 'gone', 'single'],
    );
    const starter = res.body[0]!;
    assert.equal(starter.pricePence, 500);
    assert.equal(starter.minPullPence, 40);
    assert.equal(starter.maxPullPence, 900);
    assert.equal(starter.hitChance, 0.05); // only the 900p card (weight 50/1000) is worth >= 500
    assert.equal(starter.cardCount, 4);
    assert.deepEqual(starter.theme, { from: '#1d4ed8', to: '#0f172a', accent: '#f59e0b' });
    assert.deepEqual(
      starter.featuredCards.map((c) => c.id),
      ['tst-4', 'tst-3', 'tst-2'],
    );
    assert.equal(starter.featuredCards[0]!.tier, 'rare');
    assert.equal(starter.soldOut, false);
    assert.equal(res.body.find((p) => p.id === 'gone')!.soldOut, true);
  });

  test('GET /packs/:id gives odds sorted by value with chances summing to 1', async () => {
    const res = await app.request<PackDetail>('GET', '/packs/premium');
    assert.equal(res.status, 200);
    assert.equal(res.body.totalWeight, 1000);
    assert.ok(res.body.revisionId > 0);
    assert.deepEqual(
      res.body.odds.map((o) => o.card.id),
      ['tst-6', 'tst-5', 'tst-4'],
    );
    const sum = res.body.odds.reduce((s, o) => s + o.chance, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.equal(res.body.odds[0]!.chance, 0.02);
    assert.equal(res.body.odds[0]!.card.tier, 'legendary');
  });

  test('unknown or inactive packs are 404', async () => {
    assert.equal((await app.request('GET', '/packs/nope')).status, 404);
    app.db.prepare("UPDATE packs SET active = 0 WHERE id = 'single'").run();
    assert.equal((await app.request('GET', '/packs/single')).status, 404);
    const list = await app.request<PackSummary[]>('GET', '/packs');
    assert.equal(list.body.some((p) => p.id === 'single'), false);
    app.db.prepare("UPDATE packs SET active = 1 WHERE id = 'single'").run();
  });
});

describe('opening packs', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('debits price x quantity, one ledger row per pack, vaults each pull and bumps the nonce', async () => {
    const u = app.user({ balancePence: 10_000 });
    const res = await app.request<OpenPackResponse>('POST', '/packs/starter/open', { token: u.token, body: { quantity: 4 } });
    assert.equal(res.status, 200);
    const body = res.body;
    assert.equal(body.quantity, 4);
    assert.equal(body.totalCostPence, 2000);
    assert.equal(body.balancePence, 8000);
    assert.equal(body.pulls.length, 4);
    assert.deepEqual(
      body.pulls.map((p) => p.nonce),
      [0, 1, 2, 3],
    );
    assert.deepEqual(body.pack, { id: 'starter', name: 'Starter Rip', pricePence: 500 });
    for (const p of body.pulls) {
      assert.ok(p.roll >= 0 && p.roll < 1);
      assert.equal(p.valuePence, p.card.marketValuePence);
      assert.equal(p.buybackPence, Math.floor((p.valuePence * 9000) / 10000));
    }
    assert.match(body.fairness.serverSeedHash, /^[0-9a-f]{64}$/);
    const ledger = app.db
      .prepare("SELECT amount_pence, balance_after_pence FROM transactions WHERE user_id = ? AND type = 'pack_purchase' ORDER BY id")
      .all(u.id) as { amount_pence: number; balance_after_pence: number }[];
    assert.deepEqual(
      ledger.map((r) => [r.amount_pence, r.balance_after_pence]),
      [
        [-500, 9500],
        [-500, 9000],
        [-500, 8500],
        [-500, 8000],
      ],
    );
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM inventory_items WHERE user_id = ? AND status = 'vaulted'", u.id), 4);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ? AND batch_id = ?', u.id, body.batchId), 4);
    const fair = await app.request('GET', '/fairness', { token: u.token });
    assert.equal(fair.body.nonce, 4);
    const again = await app.request<OpenPackResponse>('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(again.body.pulls[0]!.nonce, 4);
    const me = await app.me(u.token);
    assert.equal(me.stats.packsOpened, 5);
    assert.equal(me.stats.totalSpentPence, 2500);
    assert.equal(me.stats.cardsInVault, 5);
    assert.deepEqual(ledgerMismatches(app.db), []);
  });

  test('quantity must be an integer 1..10', async () => {
    const u = app.user({ balancePence: 100_000 });
    for (const quantity of [0, 11, 1.5, '2', null, -1]) {
      const r = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity } });
      assert.equal(r.status, 400, `quantity ${JSON.stringify(quantity)}`);
      assert.equal(r.body.error.code, 'validation_failed');
      assert.ok(r.body.error.fields.quantity);
    }
    const ten = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 10 } });
    assert.equal(ten.status, 200);
  });

  test('insufficient funds leaves no trace', async () => {
    const u = app.user({ balancePence: 1_400 });
    const res = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 3 } });
    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'insufficient_funds');
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?', u.id), 1); // just the funding row
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM inventory_items WHERE user_id = ?', u.id), 0);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ?', u.id), 0);
    const me = await app.me(u.token);
    assert.equal(me.balancePence, 1_400);
    assert.equal((await app.request('GET', '/fairness', { token: u.token })).body.nonce, 0);
  });

  test('inactive or unknown pack is pack_unavailable', async () => {
    const u = app.user({ balancePence: 10_000 });
    const unknown = await app.request('POST', '/packs/nope/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.body.error.code, 'pack_unavailable');
    app.db.prepare("UPDATE packs SET active = 0 WHERE id = 'premium'").run();
    const inactive = await app.request('POST', '/packs/premium/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(inactive.body.error.code, 'pack_unavailable');
    app.db.prepare("UPDATE packs SET active = 1 WHERE id = 'premium'").run();
    assert.equal((await app.me(u.token)).balancePence, 10_000);
  });

  test('a pack with an out-of-stock card is sold_out and cannot be opened', async () => {
    const u = app.user({ balancePence: 10_000 });
    const res = await app.request('POST', '/packs/gone/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'sold_out');
    assert.equal((await app.me(u.token)).balancePence, 10_000);
  });

  test('drawing more tracked stock than exists rolls the whole request back', async () => {
    const u = app.user({ balancePence: 10_000 });
    // 'limited' holds one card with stock 1: the second pull of the batch hits stock 0.
    const res = await app.request('POST', '/packs/limited/open', { token: u.token, body: { quantity: 2 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'sold_out');
    assert.equal((app.db.prepare("SELECT stock FROM cards WHERE id = 'tst-7'").get() as { stock: number }).stock, 1);
    assert.equal((await app.me(u.token)).balancePence, 10_000);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM inventory_items WHERE user_id = ?', u.id), 0);
    assert.equal((await app.request('GET', '/fairness', { token: u.token })).body.nonce, 0);
    // One works, and decrements stock to 0, after which the pack shows sold out.
    const one = await app.request('POST', '/packs/limited/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(one.status, 200);
    assert.equal((app.db.prepare("SELECT stock FROM cards WHERE id = 'tst-7'").get() as { stock: number }).stock, 0);
    const list = await app.request<PackSummary[]>('GET', '/packs');
    assert.equal(list.body.find((p) => p.id === 'limited')!.soldOut, true);
    // Put it back for other tests.
    app.db.prepare("UPDATE cards SET stock = 1 WHERE id = 'tst-7'").run();
    assert.deepEqual(ledgerMismatches(app.db), []);
  });
});

describe('safer play', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('daily spend limit over a rolling 24h', async () => {
    const u = app.user({ balancePence: 100_000 });
    const set = await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: 1_500 } });
    assert.equal(set.status, 200);
    assert.equal(set.body.limits.dailySpendLimitPence, 1_500);
    assert.equal((await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 2 } })).status, 200);
    const over = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 2 } });
    assert.equal(over.status, 403);
    assert.equal(over.body.error.code, 'spend_limit_reached');
    assert.equal((await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } })).status, 200);
    assert.equal((await app.me(u.token)).limits.spentLast24hPence, 1_500);
    // 24h after the first purchases they roll off.
    app.clock.advance(DAY + 1);
    const me = await app.me(u.token);
    assert.equal(me.limits.spentLast24hPence, 0);
    assert.equal((await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 3 } })).status, 200);
  });

  test('lowering applies now; raising waits 24h as pending; then applies automatically', async () => {
    const u = app.user({ balancePence: 100_000 });
    await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: 1_000 } });
    const raise = await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: 5_000 } });
    assert.equal(raise.body.limits.dailySpendLimitPence, 1_000);
    assert.equal(raise.body.limits.pendingDailySpendLimitPence, 5_000);
    assert.equal(raise.body.limits.pendingEffectiveAt, new Date(app.clock.ms + DAY).toISOString());
    // Still the old limit for now.
    const blocked = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 3 } });
    assert.equal(blocked.body.error.code, 'spend_limit_reached');
    app.clock.advance(23 * HOUR);
    assert.equal((await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 3 } })).status, 403);
    app.clock.advance(HOUR);
    const opened = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 3 } });
    assert.equal(opened.status, 200);
    const me = await app.me(u.token);
    assert.equal(me.limits.dailySpendLimitPence, 5_000);
    assert.equal(me.limits.pendingDailySpendLimitPence, null);
    assert.equal(me.limits.pendingEffectiveAt, null);
  });

  test('clearing a limit is also delayed; lowering cancels a pending raise', async () => {
    const u = app.user({ balancePence: 100_000 });
    await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: 2_000 } });
    const clear = await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: null } });
    assert.equal(clear.body.limits.dailySpendLimitPence, 2_000);
    assert.equal(clear.body.limits.pendingDailySpendLimitPence, null);
    assert.ok(clear.body.limits.pendingEffectiveAt);
    const lower = await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: 500 } });
    assert.equal(lower.body.limits.dailySpendLimitPence, 500);
    assert.equal(lower.body.limits.pendingEffectiveAt, null);
    const clear2 = await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: null } });
    assert.ok(clear2.body.limits.pendingEffectiveAt);
    app.clock.advance(DAY);
    assert.equal((await app.me(u.token)).limits.dailySpendLimitPence, null);
  });

  test('limits validation', async () => {
    const u = app.user();
    assert.equal((await app.request('PUT', '/me/limits', { token: u.token, body: {} })).status, 400);
    assert.equal((await app.request('PUT', '/me/limits', { token: u.token, body: { dailySpendLimitPence: -5 } })).status, 400);
    assert.equal((await app.request('PUT', '/me/limits', { token: u.token, body: { coolOffDays: 3 } })).status, 400);
  });

  test('cool-off blocks opening and top-ups, can only be extended, and ends on time', async () => {
    const u = app.user({ balancePence: 10_000 });
    const res = await app.request('PUT', '/me/limits', { token: u.token, body: { coolOffDays: 7 } });
    const until = new Date(app.clock.ms + 7 * DAY).toISOString();
    assert.equal(res.body.limits.coolingOffUntil, until);
    const open = await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(open.status, 403);
    assert.equal(open.body.error.code, 'cooling_off');
    const topup = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 } });
    assert.equal(topup.body.error.code, 'cooling_off');
    // Shorter break does not shorten it.
    const shorter = await app.request('PUT', '/me/limits', { token: u.token, body: { coolOffDays: 1 } });
    assert.equal(shorter.body.limits.coolingOffUntil, until);
    // Withdrawals still work while cooling off.
    const wd = await app.request('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 1_000, payoutDetails: 'paypal:me@x.com' } });
    assert.equal(wd.status, 201);
    app.clock.advance(7 * DAY + 1);
    assert.equal((await app.me(u.token)).limits.coolingOffUntil, null);
    assert.equal((await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } })).status, 200);
    assert.deepEqual(ledgerMismatches(app.db), []);
  });
});
