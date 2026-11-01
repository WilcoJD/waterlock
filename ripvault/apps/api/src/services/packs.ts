/**
 * Pack catalogue and opening.
 */
import { MAX_OPEN_QUANTITY, buybackPence, chanceOf, drawCard, packStats } from '@ripvault/shared';
import type { OpenPackResponse, PackDetail, PackSummary, Pull, WeightedEntry } from '@ripvault/shared';
import { all, placeholders, tx } from '../db.ts';
import type { Db } from '../db.ts';
import type { Deps } from '../deps.ts';
import { ApiError, insufficientFunds, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator, asObject } from '../validate.ts';
import { debit } from './ledger.ts';
import { CARD_COLUMNS_SQL, cardSummary, cardSummaryFromColumns, parseTheme } from './rows.ts';
import type { CardColumns, CardRow, PackRow, UserRow } from './rows.ts';
import { applyDueLimit, isCoolingOff, requireUser, spentLast24h } from './users.ts';

interface EntryRow extends CardColumns {
  pack_id: string;
  weight: number;
  card_stock: number | null;
}

export const packUnavailable = () => new ApiError(409, 'pack_unavailable', 'This pack is not available right now');
export const soldOut = () => new ApiError(409, 'sold_out', 'This pack is sold out right now');

function loadEntries(db: Db, packIds: string[]): Map<string, EntryRow[]> {
  const map = new Map<string, EntryRow[]>();
  if (packIds.length === 0) return map;
  const rows = all<EntryRow>(
    db,
    `SELECT pe.pack_id, pe.weight, c.stock AS card_stock, ${CARD_COLUMNS_SQL}
     FROM pack_entries pe JOIN cards c ON c.id = pe.card_id
     WHERE pe.pack_id IN (${placeholders(packIds.length)})`,
    ...packIds,
  );
  for (const r of rows) {
    const list = map.get(r.pack_id) ?? [];
    list.push(r);
    map.set(r.pack_id, list);
  }
  return map;
}

/** Value descending, then id ascending for a stable order. */
function byValueDesc(a: EntryRow, b: EntryRow): number {
  return b.card_value_pence - a.card_value_pence || (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : 0);
}

export function evOf(entries: readonly { weight: number; card_value_pence: number }[], pricePence: number) {
  return packStats(
    entries.map((e) => ({ weight: e.weight, valuePence: e.card_value_pence })),
    pricePence,
  );
}

function summarise(pack: PackRow, entries: EntryRow[]): PackSummary {
  const stats = evOf(entries, pack.price_pence);
  const sorted = [...entries].sort(byValueDesc);
  return {
    id: pack.id,
    name: pack.name,
    tagline: pack.tagline,
    pricePence: pack.price_pence,
    minPullPence: stats.minPence,
    maxPullPence: stats.maxPence,
    hitChance: stats.hitChance ?? 0,
    cardCount: entries.length,
    theme: parseTheme(pack.theme_json),
    featuredCards: sorted.slice(0, 3).map(cardSummaryFromColumns),
    soldOut: entries.some((e) => e.card_stock === 0),
  };
}

function detail(pack: PackRow, entries: EntryRow[]): PackDetail {
  const summary = summarise(pack, entries);
  const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
  return {
    ...summary,
    revisionId: pack.current_revision_id ?? 0,
    totalWeight,
    odds: [...entries].sort(byValueDesc).map((e) => ({
      card: cardSummaryFromColumns(e),
      weight: e.weight,
      chance: chanceOf(e.weight, totalWeight),
    })),
  };
}

export function listPacks(deps: Deps): PackSummary[] {
  const packs = all<PackRow>(deps.db, 'SELECT * FROM packs WHERE active = 1 AND current_revision_id IS NOT NULL ORDER BY sort_order, id');
  const entries = loadEntries(
    deps.db,
    packs.map((p) => p.id),
  );
  return packs.map((p) => summarise(p, entries.get(p.id) ?? []));
}

export function getPackRow(db: Db, id: string): PackRow | undefined {
  return db.prepare('SELECT * FROM packs WHERE id = ?').get(id) as PackRow | undefined;
}

/** Public detail: only active packs. Admin callers pass includeInactive. */
export function getPackDetail(deps: Deps, id: string, includeInactive = false): PackDetail {
  const pack = getPackRow(deps.db, id);
  if (!pack || pack.current_revision_id === null || (!includeInactive && pack.active !== 1)) throw notFound('Pack');
  return detail(pack, loadEntries(deps.db, [pack.id]).get(pack.id) ?? []);
}

export function getPackEntriesWithValues(db: Db, packId: string): EntryRow[] {
  return loadEntries(db, [packId]).get(packId) ?? [];
}

export function revisionEntries(db: Db, revisionId: number): WeightedEntry[] {
  const row = db.prepare('SELECT entries_json FROM pack_revisions WHERE id = ?').get(revisionId) as { entries_json: string } | undefined;
  if (!row) throw new Error(`pack revision ${revisionId} missing`);
  return JSON.parse(row.entries_json) as WeightedEntry[];
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export function openPack(deps: Deps, caller: UserRow, packId: string, rawBody: unknown): OpenPackResponse {
  const v = new Validator(asObject(rawBody));
  const quantity = v.int('quantity', { min: 1, max: MAX_OPEN_QUANTITY, label: 'Quantity' });
  v.check();

  const db = deps.db;
  const now = deps.now();
  const at = now.toISOString();

  return tx(db, () => {
    const pack = getPackRow(db, packId);
    if (!pack || pack.active !== 1 || pack.current_revision_id === null) throw packUnavailable();

    applyDueLimit(deps, caller.id);
    const user = requireUser(db, caller.id);
    if (isCoolingOff(user, now)) {
      throw new ApiError(403, 'cooling_off', `You are taking a break until ${user.cooloff_until}. Pack opening is paused.`);
    }
    const cost = pack.price_pence * quantity;
    if (user.daily_spend_limit_pence !== null) {
      const spent = spentLast24h(db, user.id, now);
      if (spent + cost > user.daily_spend_limit_pence) {
        throw new ApiError(403, 'spend_limit_reached', 'This would take you over your daily spend limit');
      }
    }

    const revisionId = pack.current_revision_id;
    const entries = revisionEntries(db, revisionId);
    const ids = entries.map((e) => e.cardId);
    const cards = new Map(
      all<CardRow>(db, `SELECT * FROM cards WHERE id IN (${placeholders(ids.length)})`, ...ids).map((c) => [c.id, c]),
    );
    if (ids.some((id) => cards.get(id)?.stock === 0)) throw soldOut();
    if (user.balance_pence < cost) throw insufficientFunds();

    const batchId = newId('bat');
    const openingIds = Array.from({ length: quantity }, () => newId('opn'));
    let balance = user.balance_pence;
    for (let i = 0; i < quantity; i++) {
      balance = debit(db, {
        userId: user.id,
        type: 'pack_purchase',
        amountPence: pack.price_pence,
        description: `Opened ${pack.name}`,
        reference: openingIds[i]!,
        at,
      });
    }

    const insertItem = db.prepare(
      `INSERT INTO inventory_items (id, user_id, card_id, pack_id, status, value_at_pull_pence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'vaulted', ?, ?, ?)`,
    );
    const insertOpening = db.prepare(
      `INSERT INTO pack_openings (id, batch_id, user_id, pack_id, revision_id, price_pence, server_seed_hash, client_seed,
         nonce, roll, card_id, inventory_item_id, value_pence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const takeStock = db.prepare('UPDATE cards SET stock = stock - 1, updated_at = ? WHERE id = ? AND stock IS NOT NULL AND stock > 0');

    const pulls: Pull[] = [];
    for (let i = 0; i < quantity; i++) {
      const nonce = user.nonce + i;
      const { cardId, roll } = drawCard(entries, user.server_seed, user.client_seed, nonce);
      const card = cards.get(cardId);
      if (!card) throw new Error(`pack ${pack.id} revision ${revisionId} references missing card ${cardId}`);
      if (card.stock !== null) {
        const r = takeStock.run(at, card.id);
        if (Number(r.changes) === 0) throw soldOut();
      }
      const itemId = newId('itm');
      const value = card.market_value_pence;
      insertItem.run(itemId, user.id, card.id, pack.id, value, at, at);
      insertOpening.run(
        openingIds[i]!,
        batchId,
        user.id,
        pack.id,
        revisionId,
        pack.price_pence,
        user.server_seed_hash,
        user.client_seed,
        nonce,
        roll,
        card.id,
        itemId,
        value,
        at,
      );
      pulls.push({
        openingId: openingIds[i]!,
        inventoryItemId: itemId,
        card: cardSummary(card),
        valuePence: value,
        buybackPence: buybackPence(value, deps.config.buybackBps),
        nonce,
        roll,
      });
    }

    const bumped = db
      .prepare('UPDATE users SET nonce = nonce + ?, updated_at = ? WHERE id = ? AND nonce = ? AND server_seed_hash = ?')
      .run(quantity, at, user.id, user.nonce, user.server_seed_hash);
    if (Number(bumped.changes) !== 1) throw new ApiError(409, 'conflict', 'Your seed changed while opening. Please try again.');

    return {
      batchId,
      pack: { id: pack.id, name: pack.name, pricePence: pack.price_pence },
      quantity,
      totalCostPence: cost,
      pulls,
      balancePence: balance,
      fairness: { serverSeedHash: user.server_seed_hash, clientSeed: user.client_seed, revisionId },
    };
  });
}
