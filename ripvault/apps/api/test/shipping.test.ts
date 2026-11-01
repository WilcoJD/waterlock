import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Address, CreateShipmentResponse, OpenPackResponse, Shipment } from '@ripvault/shared';
import { count, ledgerMismatches, startApp } from './helpers.ts';
import type { TestApp, TestUser } from './helpers.ts';

const ADDRESS = { fullName: 'Ash Ketchum', line1: '1 Pallet Road', line2: '', city: 'London', region: null, postcode: 'sw1a 1aa', country: 'gb', phone: '+44 7700 900000' };

async function setup(app: TestApp, singles: number): Promise<{ u: TestUser; ids: string[]; addressId: string }> {
  const u = app.user({ balancePence: 50_000 });
  const r = await app.request<OpenPackResponse>('POST', '/packs/single/open', { token: u.token, body: { quantity: singles } });
  const addr = await app.request<Address>('POST', '/addresses', { token: u.token, body: ADDRESS });
  assert.equal(addr.status, 201);
  return { u, ids: r.body.pulls.map((p) => p.inventoryItemId), addressId: addr.body.id };
}

describe('addresses', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('create normalises fields, list, and soft delete', async () => {
    const u = app.user();
    const res = await app.request<Address>('POST', '/addresses', { token: u.token, body: ADDRESS });
    assert.equal(res.status, 201);
    assert.equal(res.body.postcode, 'SW1A 1AA');
    assert.equal(res.body.country, 'GB');
    assert.equal(res.body.line2, null);
    assert.equal(res.body.region, null);
    assert.match(res.body.id, /^adr_/);
    assert.equal((await app.request<Address[]>('GET', '/addresses', { token: u.token })).body.length, 1);
    assert.equal((await app.request('DELETE', `/addresses/${res.body.id}`, { token: u.token })).status, 204);
    assert.equal((await app.request<Address[]>('GET', '/addresses', { token: u.token })).body.length, 0);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM addresses WHERE id = ?', res.body.id), 1);
    assert.equal((await app.request('DELETE', `/addresses/${res.body.id}`, { token: u.token })).status, 404);
  });

  test('validation and allowed countries', async () => {
    const u = app.user();
    const bad = await app.request('POST', '/addresses', { token: u.token, body: { ...ADDRESS, country: 'US', fullName: '', postcode: '!' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['country', 'fullName', 'postcode']);
  });

  test("user B cannot see or delete user A's address", async () => {
    const a = app.user();
    const b = app.user();
    const addr = await app.request<Address>('POST', '/addresses', { token: a.token, body: ADDRESS });
    assert.equal((await app.request<Address[]>('GET', '/addresses', { token: b.token })).body.length, 0);
    assert.equal((await app.request('DELETE', `/addresses/${addr.body.id}`, { token: b.token })).status, 404);
  });
});

describe('shipments', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('quote: flat fee under the threshold, free at or above it', async () => {
    const { u, ids } = await setup(app, 3);
    const one = await app.request('GET', `/shipping/quote?itemIds=${ids[0]}`, { token: u.token });
    assert.deepEqual(one.body, { itemCount: 1, totalValuePence: 1999, feePence: 399 });
    const three = await app.request('GET', `/shipping/quote?itemIds=${ids.join(',')}`, { token: u.token });
    assert.deepEqual(three.body, { itemCount: 3, totalValuePence: 5997, feePence: 0 });
    assert.equal((await app.request('GET', '/shipping/quote', { token: u.token })).status, 400);
  });

  test('create: debits the fee, moves items to shipping, snapshots the address', async () => {
    const { u, ids, addressId } = await setup(app, 2);
    const before = (await app.me(u.token)).balancePence;
    const res = await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: [ids[0]], addressId } });
    assert.equal(res.status, 201);
    const s = res.body.shipment;
    assert.equal(s.status, 'requested');
    assert.equal(s.feePence, 399);
    assert.equal(s.itemCount, 1);
    assert.equal(s.totalValuePence, 1999);
    assert.equal(s.items[0]!.status, 'shipping');
    assert.equal(s.items[0]!.shipmentId, s.id);
    assert.equal(s.address.postcode, 'SW1A 1AA');
    assert.equal(res.body.balancePence, before - 399);
    // The snapshot survives the address being deleted.
    await app.request('DELETE', `/addresses/${addressId}`, { token: u.token });
    const got = await app.request<Shipment>('GET', `/shipments/${s.id}`, { token: u.token });
    assert.equal(got.body.address.line1, '1 Pallet Road');
    const list = await app.request<Shipment[]>('GET', '/shipments', { token: u.token });
    assert.equal(list.body.length, 1);
    const fee = app.db.prepare("SELECT amount_pence, reference FROM transactions WHERE user_id = ? AND type = 'shipping_fee'").get(u.id);
    assert.deepEqual({ ...fee }, { amount_pence: -399, reference: s.id });
    // A deleted address cannot be used for new shipments.
    const again = await app.request('POST', '/shipments', { token: u.token, body: { itemIds: [ids[1]], addressId } });
    assert.equal(again.status, 404);
  });

  test('free shipping above the threshold debits nothing', async () => {
    const { u, ids, addressId } = await setup(app, 3);
    const before = (await app.me(u.token)).balancePence;
    const res = await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: ids, addressId } });
    assert.equal(res.body.shipment.feePence, 0);
    assert.equal(res.body.balancePence, before);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'shipping_fee'", u.id), 0);
  });

  test('insufficient funds for the fee changes nothing', async () => {
    const u = app.user({ balancePence: 2_200 });
    const r = await app.request<OpenPackResponse>('POST', '/packs/single/open', { token: u.token, body: { quantity: 1 } });
    const addr = await app.request<Address>('POST', '/addresses', { token: u.token, body: ADDRESS });
    const res = await app.request('POST', '/shipments', { token: u.token, body: { itemIds: [r.body.pulls[0]!.inventoryItemId], addressId: addr.body.id } });
    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'insufficient_funds');
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM shipments WHERE user_id = ?', u.id), 0);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM inventory_items WHERE user_id = ? AND status = 'vaulted'", u.id), 1);
  });

  test('cancel while requested refunds the fee and re-vaults; not after processing', async () => {
    const { u, ids, addressId } = await setup(app, 2);
    const start = (await app.me(u.token)).balancePence;
    const created = await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: [ids[0]], addressId } });
    const cancel = await app.request('POST', `/shipments/${created.body.shipment.id}/cancel`, { token: u.token });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.shipment.status, 'cancelled');
    assert.equal(cancel.body.balancePence, start);
    assert.equal((app.db.prepare('SELECT status, shipment_id FROM inventory_items WHERE id = ?').get(ids[0]!) as { status: string }).status, 'vaulted');
    // Cancelled shipments still list their items (history).
    assert.equal(cancel.body.shipment.items.length, 1);
    // Cancelling again is an idempotent success (no second refund).
    const again = await app.request('POST', `/shipments/${created.body.shipment.id}/cancel`, { token: u.token });
    assert.equal(again.status, 200);
    assert.equal(again.body.shipment.status, 'cancelled');
    assert.equal(again.body.balancePence, start);

    // The re-vaulted card can be shipped again; once processing it cannot be cancelled by the player.
    const admin = app.admin();
    const second = await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: [ids[0]], addressId } });
    await app.request('PATCH', `/admin/shipments/${second.body.shipment.id}`, { token: admin.token, body: { status: 'processing' } });
    const late = await app.request('POST', `/shipments/${second.body.shipment.id}/cancel`, { token: u.token });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'invalid_state');
    assert.deepEqual(ledgerMismatches(app.db), []);
  });

  test("user B cannot see, quote or cancel user A's shipment or ship A's items", async () => {
    const a = await setup(app, 2);
    const b = await setup(app, 1);
    const created = await app.request<CreateShipmentResponse>('POST', '/shipments', { token: a.u.token, body: { itemIds: [a.ids[0]], addressId: a.addressId } });
    const id = created.body.shipment.id;
    assert.equal((await app.request('GET', `/shipments/${id}`, { token: b.u.token })).status, 404);
    assert.equal((await app.request('POST', `/shipments/${id}/cancel`, { token: b.u.token })).status, 404);
    assert.equal((await app.request<Shipment[]>('GET', '/shipments', { token: b.u.token })).body.length, 0);
    assert.equal((await app.request('GET', `/shipping/quote?itemIds=${a.ids[1]}`, { token: b.u.token })).body.error.code, 'invalid_state');
    const steal = await app.request('POST', '/shipments', { token: b.u.token, body: { itemIds: [a.ids[1]], addressId: b.addressId } });
    assert.equal(steal.body.error.code, 'invalid_state');
    const wrongAddress = await app.request('POST', '/shipments', { token: b.u.token, body: { itemIds: [b.ids[0]], addressId: a.addressId } });
    assert.equal(wrongAddress.status, 404);
  });

  test('admin transitions: processing -> shipped marks items shipped; invalid transitions refused; admin cancel refunds', async () => {
    const admin = app.admin();
    const { u, ids, addressId } = await setup(app, 2);
    const s1 = (await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: [ids[0]], addressId } })).body.shipment;
    const skip = await app.request('PATCH', `/admin/shipments/${s1.id}`, { token: admin.token, body: { status: 'shipped' } });
    assert.equal(skip.status, 409);
    assert.equal(skip.body.error.code, 'invalid_state');
    const processing = await app.request('PATCH', `/admin/shipments/${s1.id}`, { token: admin.token, body: { status: 'processing' } });
    assert.equal(processing.body.status, 'processing');
    assert.equal(processing.body.userEmail, u.email);
    const shipped = await app.request('PATCH', `/admin/shipments/${s1.id}`, {
      token: admin.token,
      body: { status: 'shipped', carrier: 'Royal Mail', trackingNumber: 'RM123456789GB' },
    });
    assert.equal(shipped.status, 200);
    assert.equal(shipped.body.carrier, 'Royal Mail');
    assert.equal(shipped.body.trackingNumber, 'RM123456789GB');
    assert.equal(shipped.body.items[0].status, 'shipped');
    const delivered = await app.request('PATCH', `/admin/shipments/${s1.id}`, { token: admin.token, body: { status: 'delivered' } });
    assert.equal(delivered.body.status, 'delivered');
    assert.equal((await app.request('PATCH', `/admin/shipments/${s1.id}`, { token: admin.token, body: { status: 'cancelled' } })).status, 409);
    assert.equal((await app.request('PATCH', `/admin/shipments/${s1.id}`, { token: admin.token, body: { status: 'lost' } })).status, 400);

    const before = (await app.me(u.token)).balancePence;
    const s2 = (await app.request<CreateShipmentResponse>('POST', '/shipments', { token: u.token, body: { itemIds: [ids[1]], addressId } })).body.shipment;
    await app.request('PATCH', `/admin/shipments/${s2.id}`, { token: admin.token, body: { status: 'processing' } });
    const cancelled = await app.request('PATCH', `/admin/shipments/${s2.id}`, { token: admin.token, body: { status: 'cancelled' } });
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal((await app.me(u.token)).balancePence, before);
    assert.equal((app.db.prepare('SELECT status FROM inventory_items WHERE id = ?').get(ids[1]!) as { status: string }).status, 'vaulted');

    const list = await app.request('GET', '/admin/shipments?status=cancelled', { token: admin.token });
    assert.ok(list.body.some((s: Shipment) => s.id === s2.id));
    assert.ok(list.body.every((s: Shipment) => s.status === 'cancelled'));
    assert.equal((await app.request('GET', '/admin/shipments?status=nope', { token: admin.token })).status, 400);
    assert.deepEqual(ledgerMismatches(app.db), []);
  });
});
