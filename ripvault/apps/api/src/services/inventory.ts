/**
 * The vault: listing and instant sell-back.
 */
import { INVENTORY_STATUSES, buybackPence } from '@ripvault/shared';
import type { InventoryItem, InventoryResponse, InventorySort, InventoryStatus, SellResponse } from '@ripvault/shared';
import { placeholders, tx } from '../db.ts';
import type { Db } from '../db.ts';
import type { Deps } from '../deps.ts';
import { invalidState, notFound } from '../errors.ts';
import { Validator, asObject, queryEnum } from '../validate.ts';
import { credit } from './ledger.ts';
import { INVENTORY_SELECT_SQL, inventoryItemFromRow } from './rows.ts';
import type { InventoryJoinRow, UserRow } from './rows.ts';

export const MAX_SELL_ITEMS = 100;

const SORTS: readonly InventorySort[] = ['value_desc', 'value_asc', 'newest', 'oldest'];
const ORDER_BY: Record<InventorySort, string> = {
  value_desc: 'c.market_value_pence DESC, i.created_at DESC, i.rowid DESC',
  value_asc: 'c.market_value_pence ASC, i.created_at DESC, i.rowid DESC',
  newest: 'i.created_at DESC, i.rowid DESC',
  oldest: 'i.created_at ASC, i.rowid ASC',
};

export function listInventory(deps: Deps, userId: string, query: URLSearchParams): InventoryResponse {
  const status = queryEnum<InventoryStatus | 'all'>(query, 'status', [...INVENTORY_STATUSES, 'all'], 'vaulted');
  const sort = queryEnum(query, 'sort', SORTS, 'value_desc');
  const rows = deps.db
    .prepare(`${INVENTORY_SELECT_SQL} WHERE i.user_id = ? AND (? = 'all' OR i.status = ?) ORDER BY ${ORDER_BY[sort]}`)
    .all(userId, status, status) as unknown as InventoryJoinRow[];
  const items = rows.map((r) => inventoryItemFromRow(r, deps.config.buybackBps));
  return {
    items,
    totalValuePence: items.reduce((s, i) => s + i.currentValuePence, 0),
    totalBuybackPence: items.filter((i) => i.status === 'vaulted').reduce((s, i) => s + i.buybackPence, 0),
  };
}

export function getItemsByIds(db: Db, userId: string, ids: string[]): InventoryJoinRow[] {
  if (ids.length === 0) return [];
  return db
    .prepare(`${INVENTORY_SELECT_SQL} WHERE i.user_id = ? AND i.id IN (${placeholders(ids.length)})`)
    .all(userId, ...ids) as unknown as InventoryJoinRow[];
}

export function getInventoryItem(deps: Deps, userId: string, id: string): InventoryItem {
  const row = getItemsByIds(deps.db, userId, [id])[0];
  if (!row) throw notFound('Item');
  return inventoryItemFromRow(row, deps.config.buybackBps);
}

/**
 * Load items for an action that needs all of them vaulted and owned by the caller. Anything else
 * (unknown id, someone else's item, already sold/shipping) fails the whole request.
 */
export function requireVaultedItems(db: Db, userId: string, ids: string[], action: string): InventoryJoinRow[] {
  const rows = getItemsByIds(db, userId, ids);
  if (rows.length !== ids.length || rows.some((r) => r.item_status !== 'vaulted')) {
    throw invalidState(`Some of these cards can no longer be ${action}. Refresh your vault and try again.`);
  }
  // Keep the caller's order.
  const byId = new Map(rows.map((r) => [r.item_id, r]));
  return ids.map((id) => byId.get(id)!);
}

export function sellItems(deps: Deps, user: UserRow, rawBody: unknown): SellResponse {
  const v = new Validator(asObject(rawBody));
  const ids = v.idList('itemIds', { min: 1, max: MAX_SELL_ITEMS, label: 'itemIds' });
  v.check();

  const db = deps.db;
  const at = deps.now().toISOString();
  const bps = deps.config.buybackBps;
  return tx(db, () => {
    const rows = requireVaultedItems(db, user.id, ids, 'sold');
    let creditedPence = 0;
    let balance = 0;
    const markSold = db.prepare(
      `UPDATE inventory_items SET status = 'sold', sold_for_pence = ?, sold_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'vaulted'`,
    );
    const restock = db.prepare('UPDATE cards SET stock = stock + 1, updated_at = ? WHERE id = ? AND stock IS NOT NULL');
    for (const row of rows) {
      const amount = buybackPence(row.card_value_pence, bps);
      const changed = markSold.run(amount, at, at, row.item_id, user.id);
      if (Number(changed.changes) !== 1) throw invalidState('Some of these cards can no longer be sold.');
      restock.run(at, row.card_id);
      balance = credit(db, {
        userId: user.id,
        type: 'buyback',
        amountPence: amount,
        description: `Sold ${row.card_name}`,
        reference: row.item_id,
        at,
      });
      creditedPence += amount;
    }
    const items = getItemsByIds(db, user.id, ids).map((r) => inventoryItemFromRow(r, bps));
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { soldCount: rows.length, creditedPence, balancePence: balance, items };
  });
}
