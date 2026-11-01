import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryResponse, OpenPackResponse, SellResponse } from '@ripvault/shared';
import { count, ledgerMismatches, startApp } from './helpers.ts';
import type { TestApp, TestUser } from './helpers.ts';

async function openSingles(app: TestApp, u: TestUser, quantity: number): Promise<string[]> {
  const r = await app.request<OpenPackResponse>('POST', '/packs/single/open', { token: u.token, body: { quantity } });
  assert.equal(r.status, 200);
  return r.body.pulls.map((p) => p.inventoryItemId);
}

describe('vault and sell-back', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('inventory lists with totals, filters and sorts', async () => {
    const u = app.user({ balancePence: 50_000 });
    await app.request('POST', '/packs/starter/open', { token: u.token, body: { quantity: 5 } });
    const [eevee] = await openSingles(app, u, 1);
    const inv = (await app.request<InventoryResponse>('GET', '/inventory', { token: u.token })).body;
    assert.equal(inv.items.length, 6);
    assert.equal(inv.items[0]!.id, eevee);
    const values = inv.items.map((i) => i.currentValuePence);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));
    assert.equal(inv.totalValuePence, values.reduce((a, b) => a + b, 0));
    assert.equal(inv.totalBuybackPence, inv.items.reduce((s, i) => s + Math.floor((i.currentValuePence * 9000) / 10000), 0));
    const asc = (await app.request<InventoryResponse>('GET', '/inventory?sort=value_asc', { token: u.token })).body;
    assert.deepEqual(asc.items.map((i) => i.currentValuePence), [...values].reverse());
    const newest = (await app.request<InventoryResponse>('GET', '/inventory?sort=newest', { token: u.token })).body;
    assert.equal(newest.items[0]!.id, eevee);
    const item = await app.request('GET', `/inventory/${eevee}`, { token: u.token });
    assert.equal(item.status, 200);
    assert.equal(item.body.packId, 'single');
    assert.equal(item.body.valueAtPullPence, 1999);
    assert.equal(item.body.status, 'vaulted');
    assert.equal((await app.request('GET', '/inventory?status=bogus', { token: u.token })).status, 400);
    assert.equal((await app.request<InventoryResponse>('GET', '/inventory?status=sold', { token: u.token })).body.items.length, 0);
  });

  test('sells at 90% of current market value rounded down, as one buyback transaction per item', async () => {
    const u = app.user({ balancePence: 50_000 });
    const ids = await openSingles(app, u, 2);
    const before = (await app.me(u.token)).balancePence;
    const res = await app.request<SellResponse>('POST', '/inventory/sell', { token: u.token, body: { itemIds: ids } });
    assert.equal(res.status, 200);
    assert.equal(res.body.soldCount, 2);
    assert.equal(res.body.creditedPence, 2 * 1799); // floor(1999 * 0.9) = 1799
    assert.equal(res.body.balancePence, before + 3598);
    assert.ok(res.body.items.every((i) => i.status === 'sold' && i.soldForPence === 1799 && i.soldAt !== null));
    const rows = app.db
      .prepare("SELECT amount_pence, reference FROM transactions WHERE user_id = ? AND type = 'buyback' ORDER BY id")
      .all(u.id) as { amount_pence: number; reference: string }[];
    assert.deepEqual(rows.map((r) => r.amount_pence), [1799, 1799]);
    assert.deepEqual(rows.map((r) => r.reference), ids);
    // Uses the CURRENT market value, not the value at pull.
    const [later] = await openSingles(app, u, 1);
    app.db.prepare("UPDATE cards SET market_value_pence = 1001 WHERE id = 'tst-9'").run();
    const sold = await app.request<SellResponse>('POST', '/inventory/sell', { token: u.token, body: { itemIds: [later] } });
    assert.equal(sold.body.creditedPence, 900); // floor(900.9)
    app.db.prepare("UPDATE cards SET market_value_pence = 1999 WHERE id = 'tst-9'").run();
    assert.deepEqual(ledgerMismatches(app.db), []);
  });

  test('selling a tracked card puts it back in stock', async () => {
    const u = app.user({ balancePence: 10_000 });
    const opened = await app.request<OpenPackResponse>('POST', '/packs/limited/open', { token: u.token, body: { quantity: 1 } });
    const stock = () => (app.db.prepare("SELECT stock FROM cards WHERE id = 'tst-7'").get() as { stock: number }).stock;
    assert.equal(stock(), 0);
    const res = await app.request<SellResponse>('POST', '/inventory/sell', { token: u.token, body: { itemIds: [opened.body.pulls[0]!.inventoryItemId] } });
    assert.equal(res.body.creditedPence, 405); // floor(450 * 0.9)
    assert.equal(stock(), 1);
  });

  test('not-owned, not-vaulted and already-sold items fail the whole sale with invalid_state', async () => {
    const a = app.user({ balancePence: 50_000 });
    const b = app.user({ balancePence: 50_000 });
    const [a1, a2] = await openSingles(app, a, 2);
    const [b1] = await openSingles(app, b, 1);
    const balanceA = (await app.me(a.token)).balancePence;

    const notOwned = await app.request('POST', '/inventory/sell', { token: a.token, body: { itemIds: [a1, b1] } });
    assert.equal(notOwned.status, 409);
    assert.equal(notOwned.body.error.code, 'invalid_state');
    const unknown = await app.request('POST', '/inventory/sell', { token: a.token, body: { itemIds: [a1, 'itm_doesnotexist'] } });
    assert.equal(unknown.body.error.code, 'invalid_state');
    assert.equal((await app.me(a.token)).balancePence, balanceA);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM inventory_items WHERE status = 'sold' AND id IN (?, ?, ?)", a1!, a2!, b1!), 0);

    // Sell a1, then try a1 again (duplicate sale) together with a2: nothing sold.
    await app.request('POST', '/inventory/sell', { token: a.token, body: { itemIds: [a1] } });
    const dup = await app.request('POST', '/inventory/sell', { token: a.token, body: { itemIds: [a2, a1] } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'invalid_state');
    assert.equal((app.db.prepare('SELECT status FROM inventory_items WHERE id = ?').get(a2!) as { status: string }).status, 'vaulted');

    // Repeated ids in one request are de-duplicated: credited once.
    const once = await app.request<SellResponse>('POST', '/inventory/sell', { token: a.token, body: { itemIds: [a2, a2, a2] } });
    assert.equal(once.status, 200);
    assert.equal(once.body.soldCount, 1);
    assert.equal(once.body.creditedPence, 1799);

    // Someone else's item is not visible either.
    assert.equal((await app.request('GET', `/inventory/${b1}`, { token: a.token })).status, 404);
    assert.deepEqual(ledgerMismatches(app.db), []);
  });

  test('itemIds must be 1..100 valid ids', async () => {
    const u = app.user();
    for (const itemIds of [[], 'abc', [1], Array.from({ length: 101 }, (_, i) => `itm_${i}`), ['bad id!']]) {
      const r = await app.request('POST', '/inventory/sell', { token: u.token, body: { itemIds } });
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'validation_failed');
    }
  });

  test('items in a shipment cannot be sold', async () => {
    const u = app.user({ balancePence: 50_000 });
    const [i1] = await openSingles(app, u, 1);
    const addr = await app.request('POST', '/addresses', {
      token: u.token,
      body: { fullName: 'A B', line1: '1 Road', city: 'Leeds', postcode: 'LS1 1AA', country: 'GB' },
    });
    await app.request('POST', '/shipments', { token: u.token, body: { itemIds: [i1], addressId: addr.body.id } });
    const r = await app.request('POST', '/inventory/sell', { token: u.token, body: { itemIds: [i1] } });
    assert.equal(r.body.error.code, 'invalid_state');
  });
});
