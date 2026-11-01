/**
 * Admin operations. Never exposes unrevealed server seeds or password hashes.
 */
import {
  SHIPMENT_STATUSES,
  WITHDRAWAL_STATUSES,
  canTransitionShipment,
  canonicalEntries,
  exceedsMaxRtp as exceedsMaxRtpExact,
  validateEntries,
} from '@ripvault/shared';
import type {
  AdminPackReport,
  CardSummary,
  PackDetail,
  Shipment,
  ShipmentStatus,
  WeightedEntry,
  Withdrawal,
  WithdrawalStatus,
} from '@ripvault/shared';
import { all, placeholders, tx } from '../db.ts';
import type { Db } from '../db.ts';
import type { Deps } from '../deps.ts';
import { ApiError, invalidState, notFound, validationFailed } from '../errors.ts';
import { Validator, asObject, queryEnum } from '../validate.ts';
import { credit } from './ledger.ts';
import { evOf, getPackDetail, getPackEntriesWithValues, getPackRow } from './packs.ts';
import { cardSummary } from './rows.ts';
import type { CardRow, UserRow } from './rows.ts';
import { cancelShipmentRow, shipmentDto, shipmentDtos } from './shipping.ts';
import type { ShipmentRow } from './shipping.ts';
import { withdrawalDto } from './wallet.ts';
import type { WithdrawalRow } from './wallet.ts';

export type AdminShipment = Shipment & { userEmail: string };
export type AdminWithdrawal = Withdrawal & { userEmail: string };

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

export function adminListShipments(deps: Deps, query: URLSearchParams): AdminShipment[] {
  const status = queryEnum<ShipmentStatus | 'all'>(query, 'status', [...SHIPMENT_STATUSES, 'all'], 'all');
  const rows = deps.db
    .prepare(
      `SELECT s.*, u.email AS user_email FROM shipments s JOIN users u ON u.id = s.user_id
       WHERE (? = 'all' OR s.status = ?) ORDER BY s.created_at DESC, s.rowid DESC LIMIT 500`,
    )
    .all(status, status) as unknown as (ShipmentRow & { user_email: string })[];
  const dtos = shipmentDtos(deps.db, rows, deps.config.buybackBps);
  return dtos.map((s, i) => ({ ...s, userEmail: rows[i]!.user_email }));
}

function adminShipment(deps: Deps, id: string): AdminShipment {
  const row = deps.db
    .prepare('SELECT s.*, u.email AS user_email FROM shipments s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .get(id) as (ShipmentRow & { user_email: string }) | undefined;
  if (!row) throw notFound('Shipment');
  return { ...shipmentDto(deps.db, row, deps.config.buybackBps), userEmail: row.user_email };
}

export function adminUpdateShipment(deps: Deps, id: string, rawBody: unknown): AdminShipment {
  const body = asObject(rawBody);
  const v = new Validator(body);
  const status = v.str('status', { max: 20, label: 'status' }) as ShipmentStatus;
  if (status && !SHIPMENT_STATUSES.includes(status)) v.fail('status', `status must be one of ${SHIPMENT_STATUSES.join(', ')}`);
  const carrier = v.has('carrier') ? v.nullableStr('carrier', { max: 100, label: 'carrier' }) : undefined;
  const tracking = v.has('trackingNumber') ? v.nullableStr('trackingNumber', { max: 100, label: 'trackingNumber' }) : undefined;
  v.check();

  const db = deps.db;
  const at = deps.now().toISOString();
  tx(db, () => {
    const row = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id) as ShipmentRow | undefined;
    if (!row) throw notFound('Shipment');
    const sameStatus = row.status === status;
    if (!sameStatus && !canTransitionShipment(row.status, status)) {
      throw invalidState(`A ${row.status} shipment cannot move to ${status}`);
    }
    if (sameStatus && (row.status === 'cancelled' || row.status === 'delivered')) {
      throw invalidState(`This shipment is already ${row.status}`);
    }
    if (status === 'cancelled') {
      cancelShipmentRow(deps, row, ['requested', 'processing']);
    } else if (!sameStatus) {
      const r = db
        .prepare('UPDATE shipments SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(status, at, id, row.status);
      if (Number(r.changes) !== 1) throw invalidState('Shipment changed; refresh and try again');
      if (status === 'shipped') {
        db.prepare(
          `UPDATE inventory_items SET status = 'shipped', updated_at = ? WHERE shipment_id = ? AND status = 'shipping'`,
        ).run(at, id);
      }
    }
    if (carrier !== undefined) db.prepare('UPDATE shipments SET carrier = ?, updated_at = ? WHERE id = ?').run(carrier, at, id);
    if (tracking !== undefined) {
      db.prepare('UPDATE shipments SET tracking_number = ?, updated_at = ? WHERE id = ?').run(tracking, at, id);
    }
  });
  deps.logger.info('admin updated shipment', { shipmentId: id, status });
  return adminShipment(deps, id);
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

export function adminListWithdrawals(deps: Deps, query: URLSearchParams): AdminWithdrawal[] {
  const status = queryEnum<WithdrawalStatus | 'all'>(query, 'status', [...WITHDRAWAL_STATUSES, 'all'], 'all');
  const rows = deps.db
    .prepare(
      `SELECT w.*, u.email AS user_email FROM withdrawals w JOIN users u ON u.id = w.user_id
       WHERE (? = 'all' OR w.status = ?) ORDER BY w.created_at DESC, w.rowid DESC LIMIT 500`,
    )
    .all(status, status) as unknown as (WithdrawalRow & { user_email: string })[];
  return rows.map((r) => ({ ...withdrawalDto(r, false), userEmail: r.user_email }));
}

export function adminUpdateWithdrawal(deps: Deps, admin: UserRow, id: string, rawBody: unknown): AdminWithdrawal {
  const v = new Validator(asObject(rawBody));
  const status = v.str('status', { max: 20, label: 'status' });
  if (status && status !== 'paid' && status !== 'rejected') v.fail('status', 'status must be paid or rejected');
  const note = v.has('adminNote') ? v.nullableStr('adminNote', { max: 500, label: 'adminNote' }) : null;
  v.check();
  const db = deps.db;
  const at = deps.now().toISOString();
  tx(db, () => {
    const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id) as WithdrawalRow | undefined;
    if (!row) throw notFound('Withdrawal');
    const r = db
      .prepare(
        `UPDATE withdrawals SET status = ?, admin_note = ?, processed_by = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
      )
      .run(status, note, admin.id, at, id);
    if (Number(r.changes) !== 1) throw invalidState(`This withdrawal is already ${row.status}`);
    if (status === 'rejected') {
      credit(db, {
        userId: row.user_id,
        type: 'withdrawal_reversal',
        amountPence: row.amount_pence,
        description: 'Withdrawal rejected: funds returned',
        reference: row.id,
        at,
      });
    }
  });
  deps.logger.info('admin updated withdrawal', { withdrawalId: id, status });
  const row = db
    .prepare('SELECT w.*, u.email AS user_email FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.id = ?')
    .get(id) as unknown as WithdrawalRow & { user_email: string };
  return { ...withdrawalDto(row, false), userEmail: row.user_email };
}

// ---------------------------------------------------------------------------
// Packs & cards
// ---------------------------------------------------------------------------

export function packReport(deps: Deps, packId: string): AdminPackReport {
  const pack = getPackDetail(deps, packId, true);
  const row = getPackRow(deps.db, packId)!;
  const stats = evOf(getPackEntriesWithValues(deps.db, packId), row.price_pence);
  const totals = deps.db
    .prepare(
      `SELECT COUNT(*) AS opened, COALESCE(SUM(price_pence), 0) AS revenue, COALESCE(SUM(value_pence), 0) AS paid_out
       FROM pack_openings WHERE pack_id = ?`,
    )
    .get(packId) as { opened: number; revenue: number; paid_out: number };
  return {
    pack,
    evPence: stats.evPence,
    rtp: stats.rtp ?? 0,
    maxRtp: deps.config.maxPackRtpBps / 10_000,
    opened: totals.opened,
    revenuePence: totals.revenue,
    paidOutValuePence: totals.paid_out,
  };
}

export const ADMIN_DEACTIVATED_REASON = 'Deactivated by admin';
/** Every automatic RTP deactivation reason (price sync, seed) starts with this. */
export const RTP_DEACTIVATED_PREFIX = 'RTP ';

export function isRtpDeactivation(reason: string | null): boolean {
  return reason !== null && reason.startsWith(RTP_DEACTIVATED_PREFIX);
}

/**
 * True when the exact (unfloored) EV / price is above the configured maximum return-to-player.
 * `entries` are pack entries with their current card values.
 */
export function exceedsMaxRtp(
  entries: readonly { weight: number; card_value_pence: number }[],
  pricePence: number,
  maxRtpBps: number,
): boolean {
  return exceedsMaxRtpExact(
    entries.map((e) => ({ weight: e.weight, valuePence: e.card_value_pence })),
    pricePence,
    maxRtpBps,
  );
}

/** Exact RTP as a percentage string with 2 decimals (for messages; never used for the cap check). */
export function rtpPercent(entries: readonly { weight: number; card_value_pence: number }[], pricePence: number): string {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total === 0 || pricePence <= 0) return '0.00';
  const weighted = entries.reduce((s, e) => s + e.weight * e.card_value_pence, 0);
  return ((weighted / total / pricePence) * 100).toFixed(2);
}

/**
 * Write a new immutable revision for a pack and make it current. Must run inside tx().
 * `entries` must already be validated.
 */
export function writePackRevision(db: Db, packId: string, entries: WeightedEntry[], createdBy: string, at: string): number {
  const canonical = canonicalEntries(entries).map((e) => ({ cardId: e.cardId, weight: e.weight }));
  const rev = db
    .prepare('INSERT INTO pack_revisions (pack_id, entries_json, created_by, created_at) VALUES (?, ?, ?, ?)')
    .run(packId, JSON.stringify(canonical), createdBy, at);
  const revisionId = Number(rev.lastInsertRowid);
  db.prepare('DELETE FROM pack_entries WHERE pack_id = ?').run(packId);
  const ins = db.prepare('INSERT INTO pack_entries (pack_id, card_id, weight) VALUES (?, ?, ?)');
  for (const e of canonical) ins.run(packId, e.cardId, e.weight);
  db.prepare('UPDATE packs SET current_revision_id = ?, updated_at = ? WHERE id = ?').run(revisionId, at, packId);
  return revisionId;
}

export function parseEntries(raw: unknown): { entries: WeightedEntry[]; error: string | null } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 1_000) {
    return { entries: [], error: 'entries must be a list of 1-1000 { cardId, weight } rows' };
  }
  const entries: WeightedEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') return { entries: [], error: 'each entry must be { cardId, weight }' };
    const { cardId, weight } = e as { cardId?: unknown; weight?: unknown };
    if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > 64) {
      return { entries: [], error: 'each entry needs a cardId' };
    }
    if (typeof weight !== 'number' || !Number.isSafeInteger(weight) || weight <= 0 || weight > 1_000_000_000) {
      return { entries: [], error: `weight for ${cardId} must be a positive whole number` };
    }
    entries.push({ cardId, weight });
  }
  try {
    validateEntries(entries);
  } catch (err) {
    return { entries: [], error: (err as Error).message };
  }
  return { entries, error: null };
}

export function setPackOdds(deps: Deps, admin: UserRow, packId: string, rawBody: unknown): PackDetail {
  const body = asObject(rawBody);
  const { entries, error } = parseEntries(body.entries);
  if (error) throw validationFailed({ entries: error });
  const db = deps.db;
  const at = deps.now().toISOString();
  tx(db, () => {
    const pack = getPackRow(db, packId);
    if (!pack) throw notFound('Pack');
    const ids = entries.map((e) => e.cardId);
    const cards = all<{ id: string; market_value_pence: number }>(
      db,
      `SELECT id, market_value_pence FROM cards WHERE id IN (${placeholders(ids.length)})`,
      ...ids,
    );
    const values = new Map(cards.map((c) => [c.id, c.market_value_pence]));
    const unknown = ids.filter((id) => !values.has(id));
    if (unknown.length > 0) throw validationFailed({ entries: `Unknown card ids: ${unknown.slice(0, 10).join(', ')}` });
    const valued = entries.map((e) => ({ weight: e.weight, card_value_pence: values.get(e.cardId)! }));
    if (exceedsMaxRtp(valued, pack.price_pence, deps.config.maxPackRtpBps)) {
      throw validationFailed({
        entries: `These odds give an RTP of ${rtpPercent(valued, pack.price_pence)}%, above the ${(deps.config.maxPackRtpBps / 100).toFixed(2)}% maximum`,
      });
    }
    writePackRevision(db, packId, entries, admin.id, at);
    // A pack the RTP guard (price sync or seed) switched off goes back on sale once its odds are within
    // the cap again. A pack an admin switched off by hand stays off (PUT /admin/packs/:id/active).
    if (pack.active === 0 && isRtpDeactivation(pack.deactivated_reason)) {
      db.prepare('UPDATE packs SET active = 1, deactivated_reason = NULL, updated_at = ? WHERE id = ?').run(at, packId);
    }
  });
  deps.logger.info('admin set pack odds', { packId, adminId: admin.id });
  return getPackDetail(deps, packId, true);
}

export function setPackActive(deps: Deps, packId: string, rawBody: unknown): PackDetail {
  const body = asObject(rawBody);
  if (typeof body.active !== 'boolean') throw validationFailed({ active: 'active must be true or false' });
  const db = deps.db;
  const at = deps.now().toISOString();
  tx(db, () => {
    const pack = getPackRow(db, packId);
    if (!pack || pack.current_revision_id === null) throw notFound('Pack');
    if (body.active) {
      if (exceedsMaxRtp(getPackEntriesWithValues(db, packId), pack.price_pence, deps.config.maxPackRtpBps)) {
        throw new ApiError(409, 'invalid_state', 'This pack is above the maximum RTP at current prices; fix its odds first');
      }
    }
    db.prepare('UPDATE packs SET active = ?, deactivated_reason = ?, updated_at = ? WHERE id = ?').run(
      body.active ? 1 : 0,
      body.active ? null : ADMIN_DEACTIVATED_REASON,
      at,
      packId,
    );
  });
  return getPackDetail(deps, packId, true);
}

export function setCardStock(deps: Deps, cardId: string, rawBody: unknown): CardSummary {
  const body = asObject(rawBody);
  const stock = body.stock;
  if (!(stock === null || (typeof stock === 'number' && Number.isSafeInteger(stock) && stock >= 0 && stock <= 1_000_000))) {
    throw validationFailed({ stock: 'stock must be a whole number from 0 to 1000000, or null to stop tracking' });
  }
  const r = deps.db
    .prepare('UPDATE cards SET stock = ?, updated_at = ? WHERE id = ?')
    .run(stock, deps.now().toISOString(), cardId);
  if (Number(r.changes) !== 1) throw notFound('Card');
  return cardSummary(deps.db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as unknown as CardRow);
}
