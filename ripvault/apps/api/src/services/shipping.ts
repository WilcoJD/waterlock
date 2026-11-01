/**
 * Addresses and shipments of physical cards.
 */
import { shippingFeePence } from '@ripvault/shared';
import type {
  Address,
  AddressInput,
  CancelShipmentResponse,
  CreateShipmentResponse,
  Shipment,
  ShipmentStatus,
  ShippingQuoteResponse,
} from '@ripvault/shared';
import { placeholders, tx } from '../db.ts';
import type { Db } from '../db.ts';
import type { Deps } from '../deps.ts';
import { ApiError, invalidState, notFound, validationFailed } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator, asObject, validateIdList } from '../validate.ts';
import { requireVaultedItems } from './inventory.ts';
import { credit, debit, balanceOf } from './ledger.ts';
import { INVENTORY_SELECT_SQL, inventoryItemFromRow } from './rows.ts';
import type { InventoryJoinRow, UserRow } from './rows.ts';

export const MAX_ADDRESSES_PER_USER = 20;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

interface AddressRow {
  id: string;
  user_id: string;
  full_name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country: string;
  phone: string | null;
  created_at: string;
  deleted_at: string | null;
}

function addressDto(row: AddressRow): Address {
  return {
    id: row.id,
    fullName: row.full_name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postcode: row.postcode,
    country: row.country,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

function snapshot(row: AddressRow): AddressInput {
  const { id: _id, createdAt: _createdAt, ...rest } = addressDto(row);
  return rest;
}

export function listAddresses(deps: Deps, userId: string): Address[] {
  const rows = deps.db
    .prepare('SELECT * FROM addresses WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC')
    .all(userId) as unknown as AddressRow[];
  return rows.map(addressDto);
}

export function createAddress(deps: Deps, user: UserRow, rawBody: unknown): Address {
  const v = new Validator(asObject(rawBody));
  const fullName = v.str('fullName', { max: 100, label: 'Full name' });
  const line1 = v.str('line1', { max: 200, label: 'Address line 1' });
  const line2 = v.nullableStr('line2', { max: 200, label: 'Address line 2' });
  const city = v.str('city', { max: 100, label: 'Town or city' });
  const region = v.nullableStr('region', { max: 100, label: 'County or region' });
  const postcode = v
    .str('postcode', { min: 2, max: 12, label: 'Postcode', pattern: /^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/, patternMessage: 'Enter a valid postcode' })
    .toUpperCase();
  const country = v.str('country', { min: 2, max: 2, label: 'Country', pattern: /^[A-Za-z]{2}$/ }).toUpperCase();
  const phone = v.nullableStr('phone', { min: 6, max: 20, label: 'Phone', pattern: /^\+?[0-9 ()-]{6,20}$/, patternMessage: 'Enter a valid phone number' });
  if (country && !deps.config.shipping.countries.includes(country)) {
    v.fail('country', `We currently ship to ${deps.config.shipping.countries.join(', ')} only`);
  }
  v.check();
  const at = deps.now().toISOString();
  return tx(deps.db, () => {
    const count = deps.db
      .prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ? AND deleted_at IS NULL')
      .get(user.id) as { n: number };
    if (count.n >= MAX_ADDRESSES_PER_USER) {
      throw invalidState(`You can save up to ${MAX_ADDRESSES_PER_USER} addresses. Delete one first.`);
    }
    const id = newId('adr');
    deps.db
      .prepare(
        `INSERT INTO addresses (id, user_id, full_name, line1, line2, city, region, postcode, country, phone, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, user.id, fullName, line1, line2, city, region, postcode, country, phone, at);
    return addressDto(deps.db.prepare('SELECT * FROM addresses WHERE id = ?').get(id) as unknown as AddressRow);
  });
}

export function deleteAddress(deps: Deps, userId: string, id: string): void {
  const r = deps.db
    .prepare('UPDATE addresses SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(deps.now().toISOString(), id, userId);
  if (Number(r.changes) !== 1) throw notFound('Address');
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export interface ShipmentRow {
  id: string;
  user_id: string;
  address_json: string;
  status: ShipmentStatus;
  fee_pence: number;
  item_count: number;
  total_value_pence: number;
  carrier: string | null;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
}

export function shipmentDtos(db: Db, rows: ShipmentRow[], buybackBps: number): Shipment[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const itemRows = db
    .prepare(
      `SELECT si.shipment_id AS si_shipment_id, x.* FROM shipment_items si
       JOIN (${INVENTORY_SELECT_SQL}) x ON x.item_id = si.inventory_item_id
       WHERE si.shipment_id IN (${placeholders(ids.length)})
       ORDER BY x.card_value_pence DESC, x.item_id`,
    )
    .all(...ids) as unknown as (InventoryJoinRow & { si_shipment_id: string })[];
  const byShipment = new Map<string, InventoryJoinRow[]>();
  for (const r of itemRows) {
    const list = byShipment.get(r.si_shipment_id) ?? [];
    list.push(r);
    byShipment.set(r.si_shipment_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    feePence: row.fee_pence,
    itemCount: row.item_count,
    totalValuePence: row.total_value_pence,
    items: (byShipment.get(row.id) ?? []).map((i) => inventoryItemFromRow(i, buybackBps)),
    address: JSON.parse(row.address_json) as AddressInput,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function shipmentDto(db: Db, row: ShipmentRow, buybackBps: number): Shipment {
  return shipmentDtos(db, [row], buybackBps)[0]!;
}

export function listShipments(deps: Deps, userId: string): Shipment[] {
  const rows = deps.db
    .prepare('SELECT * FROM shipments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(userId) as unknown as ShipmentRow[];
  return shipmentDtos(deps.db, rows, deps.config.buybackBps);
}

export function getShipmentRow(db: Db, userId: string, id: string): ShipmentRow | undefined {
  return db.prepare('SELECT * FROM shipments WHERE id = ? AND user_id = ?').get(id, userId) as ShipmentRow | undefined;
}

export function getShipment(deps: Deps, userId: string, id: string): Shipment {
  const row = getShipmentRow(deps.db, userId, id);
  if (!row) throw notFound('Shipment');
  return shipmentDto(deps.db, row, deps.config.buybackBps);
}

function quoteFor(deps: Deps, items: InventoryJoinRow[]): ShippingQuoteResponse {
  const totalValuePence = items.reduce((s, i) => s + i.card_value_pence, 0);
  return { itemCount: items.length, totalValuePence, feePence: shippingFeePence(totalValuePence, deps.config.shipping) };
}

export function quoteShipping(deps: Deps, userId: string, query: URLSearchParams): ShippingQuoteResponse {
  const raw = (query.get('itemIds') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const max = deps.config.shipping.maxItemsPerShipment;
  const problems: string[] = [];
  const ids = validateIdList(raw, 1, max, (msg) => problems.push(`itemIds ${msg}`));
  if (problems.length > 0) throw validationFailed({ itemIds: problems[0]! });
  return quoteFor(deps, requireVaultedItems(deps.db, userId, ids, 'shipped'));
}

export function createShipment(deps: Deps, user: UserRow, rawBody: unknown): CreateShipmentResponse {
  const v = new Validator(asObject(rawBody));
  const ids = v.idList('itemIds', { min: 1, max: deps.config.shipping.maxItemsPerShipment, label: 'itemIds' });
  const addressId = v.str('addressId', { max: 64, label: 'addressId' });
  v.check();
  const db = deps.db;
  const at = deps.now().toISOString();
  return tx(db, () => {
    const address = db
      .prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .get(addressId, user.id) as AddressRow | undefined;
    if (!address) throw notFound('Address');
    if (!deps.config.shipping.countries.includes(address.country)) {
      throw validationFailed({ addressId: `We currently ship to ${deps.config.shipping.countries.join(', ')} only` });
    }
    const items = requireVaultedItems(db, user.id, ids, 'shipped');
    const quote = quoteFor(deps, items);
    const shipmentId = newId('shp');
    db.prepare(
      `INSERT INTO shipments (id, user_id, address_id, address_json, status, fee_pence, item_count, total_value_pence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?)`,
    ).run(shipmentId, user.id, address.id, JSON.stringify(snapshot(address)), quote.feePence, quote.itemCount, quote.totalValuePence, at, at);
    const move = db.prepare(
      `UPDATE inventory_items SET status = 'shipping', shipment_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'vaulted'`,
    );
    const link = db.prepare('INSERT INTO shipment_items (shipment_id, inventory_item_id) VALUES (?, ?)');
    for (const item of items) {
      if (Number(move.run(shipmentId, at, item.item_id, user.id).changes) !== 1) {
        throw invalidState('Some of these cards can no longer be shipped.');
      }
      link.run(shipmentId, item.item_id);
    }
    let balance = balanceOf(db, user.id);
    if (quote.feePence > 0) {
      balance = debit(db, {
        userId: user.id,
        type: 'shipping_fee',
        amountPence: quote.feePence,
        description: `Shipping ${quote.itemCount} card${quote.itemCount === 1 ? '' : 's'}`,
        reference: shipmentId,
        at,
      });
    }
    const row = getShipmentRow(db, user.id, shipmentId)!;
    return { shipment: shipmentDto(db, row, deps.config.buybackBps), balancePence: balance };
  });
}

/** Cancel a shipment: refund the fee and put its items back in the vault. Must run inside tx(). */
export function cancelShipmentRow(deps: Deps, row: ShipmentRow, allowedFrom: readonly ShipmentStatus[]): void {
  const db = deps.db;
  const at = deps.now().toISOString();
  const r = db
    .prepare(
      `UPDATE shipments SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN (${placeholders(allowedFrom.length)})`,
    )
    .run(at, row.id, ...allowedFrom);
  if (Number(r.changes) !== 1) throw invalidState('This shipment can no longer be cancelled');
  db.prepare(
    `UPDATE inventory_items SET status = 'vaulted', shipment_id = NULL, updated_at = ?
     WHERE shipment_id = ? AND status = 'shipping'`,
  ).run(at, row.id);
  if (row.fee_pence > 0) {
    credit(db, {
      userId: row.user_id,
      type: 'shipping_refund',
      amountPence: row.fee_pence,
      description: 'Shipping cancelled: fee refunded',
      reference: row.id,
      at,
    });
  }
}

export function cancelShipment(deps: Deps, user: UserRow, id: string): CancelShipmentResponse {
  return tx(deps.db, () => {
    const row = getShipmentRow(deps.db, user.id, id);
    if (!row) throw notFound('Shipment');
    // Already cancelled (a retry after a lost response, or an admin cancelled it): idempotent success
    // with the current state, so the app shows the refund instead of a false failure.
    if (row.status !== 'cancelled') {
      if (row.status !== 'requested') {
        throw new ApiError(409, 'invalid_state', 'This shipment is already being processed and can no longer be cancelled');
      }
      cancelShipmentRow(deps, row, ['requested']);
    }
    return {
      shipment: shipmentDto(deps.db, getShipmentRow(deps.db, user.id, id)!, deps.config.buybackBps),
      balancePence: balanceOf(deps.db, user.id),
    };
  });
}
