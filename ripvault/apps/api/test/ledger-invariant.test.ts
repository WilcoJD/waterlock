import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, CreateShipmentResponse, InventoryResponse } from '@ripvault/shared';
import { HOUR, ledgerMismatches, prng, startApp } from './helpers.ts';
import type { TestUser } from './helpers.ts';

/**
 * Random sequence of opens / sells / shipments / cancels / withdrawals / top-ups / admin actions
 * across several users. After every step: balance == SUM(ledger) for everyone and no balance is
 * negative. Errors (insufficient funds, sold out, invalid state...) are expected and must leave
 * no partial state behind.
 */
test('randomized operations keep balance == sum(ledger) and never go negative', async () => {
  const app = await startApp();
  const rand = prng(20261101);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  try {
    const admin = app.admin();
    const users: (TestUser & { addressId: string })[] = [];
    for (let i = 0; i < 4; i++) {
      const u = app.user({ balancePence: Math.floor(rand() * 8_000) });
      const addr = await app.request<Address>('POST', '/addresses', {
        token: u.token,
        body: { fullName: `User ${i}`, line1: '1 Test St', city: 'Bristol', postcode: 'BS1 1AA', country: 'GB' },
      });
      users.push({ ...u, addressId: addr.body.id });
    }
    const packs = ['starter', 'premium', 'limited', 'single', 'gone'];
    const statuses = new Map<number, number>();
    const tally = (s: number) => statuses.set(s, (statuses.get(s) ?? 0) + 1);

    for (let step = 0; step < 300; step++) {
      const u = pick(users);
      const op = Math.floor(rand() * 9);
      const vault = async () =>
        (await app.request<InventoryResponse>('GET', '/inventory', { token: u.token })).body.items.map((i) => i.id);
      let status = 0;
      switch (op) {
        case 0:
        case 1: {
          const r = await app.request('POST', `/packs/${pick(packs)}/open`, {
            token: u.token,
            body: { quantity: 1 + Math.floor(rand() * 4) },
            headers: rand() < 0.3 ? { 'Idempotency-Key': `k-${Math.floor(rand() * 20)}` } : {},
          });
          status = r.status;
          break;
        }
        case 2: {
          const ids = await vault();
          if (ids.length === 0) continue;
          const chosen = ids.filter(() => rand() < 0.5);
          if (rand() < 0.2) chosen.push('itm_bogus');
          if (chosen.length === 0) chosen.push(ids[0]!);
          status = (await app.request('POST', '/inventory/sell', { token: u.token, body: { itemIds: chosen } })).status;
          break;
        }
        case 3: {
          const ids = await vault();
          if (ids.length === 0) continue;
          const chosen = ids.slice(0, 1 + Math.floor(rand() * Math.min(5, ids.length)));
          status = (await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: chosen, addressId: u.addressId } })).status;
          break;
        }
        case 4: {
          const list = (await app.request('GET', '/shipments', { token: u.token })).body as { id: string }[];
          if (list.length === 0) continue;
          status = (await app.request('POST', `/shipments/${pick(list).id}/cancel`, { token: u.token })).status;
          break;
        }
        case 5: {
          const amountPence = 1_000 + Math.floor(rand() * 4_000);
          status = (await app.request('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence, payoutDetails: 'paypal: x@y.com' } })).status;
          break;
        }
        case 6: {
          const pending = (await app.request('GET', '/admin/withdrawals?status=pending', { token: admin.token })).body as { id: string }[];
          if (pending.length === 0) continue;
          status = (await app.request('PATCH', `/admin/withdrawals/${pick(pending).id}`, { token: admin.token, body: { status: pick(['paid', 'rejected']) } })).status;
          break;
        }
        case 7: {
          const all = (await app.request('GET', '/admin/shipments', { token: admin.token })).body as { id: string }[];
          if (all.length === 0) continue;
          const to = pick(['processing', 'shipped', 'delivered', 'cancelled']);
          status = (await app.request('PATCH', `/admin/shipments/${pick(all).id}`, { token: admin.token, body: { status: to } })).status;
          break;
        }
        case 8: {
          status = (await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 500 + Math.floor(rand() * 3_000) } })).status;
          app.clock.advance(Math.floor(rand() * 6 * HOUR));
          break;
        }
      }
      tally(status);
      assert.ok(status < 500, `step ${step} op ${op} returned ${status}`);
      const bad = ledgerMismatches(app.db);
      assert.deepEqual(bad, [], `ledger mismatch after step ${step} (op ${op})`);
    }

    // Structural checks at the end.
    const orphanOpenings = app.db
      .prepare('SELECT COUNT(*) AS n FROM pack_openings o LEFT JOIN inventory_items i ON i.id = o.inventory_item_id WHERE i.id IS NULL')
      .get() as { n: number };
    assert.equal(orphanOpenings.n, 0);
    const shippingWithoutShipment = app.db
      .prepare("SELECT COUNT(*) AS n FROM inventory_items WHERE status IN ('shipping', 'shipped') AND shipment_id IS NULL")
      .get() as { n: number };
    assert.equal(shippingWithoutShipment.n, 0);
    const negativeStock = app.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE stock < 0').get() as { n: number };
    assert.equal(negativeStock.n, 0);
    // Every purchase ledger row has a matching opening.
    const purchases = app.db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE type = 'pack_purchase'").get() as { n: number };
    const openings = app.db.prepare('SELECT COUNT(*) AS n FROM pack_openings').get() as { n: number };
    assert.equal(purchases.n, openings.n);
    // We exercised both success and failure paths.
    assert.ok((statuses.get(200) ?? 0) + (statuses.get(201) ?? 0) > 50, JSON.stringify([...statuses]));
    assert.ok([402, 409].some((s) => (statuses.get(s) ?? 0) > 0), JSON.stringify([...statuses]));
  } finally {
    await app.close();
  }
});
