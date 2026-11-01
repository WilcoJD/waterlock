/**
 * Database row shapes and their mapping onto the shared API DTOs.
 */
import { buybackPence, tierForValue } from '@ripvault/shared';
import type { CardSummary, InventoryItem, InventoryStatus, PackTheme, Role } from '@ripvault/shared';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  date_of_birth: string;
  role: Role;
  balance_pence: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
  daily_spend_limit_pence: number | null;
  pending_daily_spend_limit_pence: number | null;
  pending_limit_effective_at: string | null;
  cooloff_until: string | null;
  terms_accepted_at: string;
  created_at: string;
  updated_at: string;
}

export interface CardRow {
  id: string;
  name: string;
  set_id: string;
  set_name: string;
  number: string;
  rarity: string;
  image_small: string;
  image_large: string;
  market_value_pence: number;
  price_source: string;
  price_updated_at: string | null;
  stock: number | null;
  created_at: string;
  updated_at: string;
}

export interface PackRow {
  id: string;
  name: string;
  tagline: string;
  price_pence: number;
  theme_json: string;
  sort_order: number;
  active: number;
  deactivated_reason: string | null;
  current_revision_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Columns needed to build a CardSummary, so joins can alias them consistently. */
export interface CardColumns {
  card_id: string;
  card_name: string;
  card_set_name: string;
  card_number: string;
  card_rarity: string;
  card_image_small: string;
  card_image_large: string;
  card_value_pence: number;
}

export const CARD_COLUMNS_SQL = `c.id AS card_id, c.name AS card_name, c.set_name AS card_set_name, c.number AS card_number,
  c.rarity AS card_rarity, c.image_small AS card_image_small, c.image_large AS card_image_large,
  c.market_value_pence AS card_value_pence`;

export function cardSummary(row: CardRow): CardSummary {
  return {
    id: row.id,
    name: row.name,
    setName: row.set_name,
    number: row.number,
    rarity: row.rarity,
    imageSmall: row.image_small,
    imageLarge: row.image_large,
    marketValuePence: row.market_value_pence,
    tier: tierForValue(row.market_value_pence),
  };
}

export function cardSummaryFromColumns(row: CardColumns): CardSummary {
  return {
    id: row.card_id,
    name: row.card_name,
    setName: row.card_set_name,
    number: row.card_number,
    rarity: row.card_rarity,
    imageSmall: row.card_image_small,
    imageLarge: row.card_image_large,
    marketValuePence: row.card_value_pence,
    tier: tierForValue(row.card_value_pence),
  };
}

export interface InventoryJoinRow extends CardColumns {
  item_id: string;
  item_user_id: string;
  item_status: InventoryStatus;
  item_value_at_pull_pence: number;
  item_created_at: string;
  item_pack_id: string | null;
  item_shipment_id: string | null;
  item_sold_for_pence: number | null;
  item_sold_at: string | null;
}

export const INVENTORY_SELECT_SQL = `SELECT i.id AS item_id, i.user_id AS item_user_id, i.status AS item_status,
  i.value_at_pull_pence AS item_value_at_pull_pence, i.created_at AS item_created_at, i.pack_id AS item_pack_id,
  i.shipment_id AS item_shipment_id, i.sold_for_pence AS item_sold_for_pence, i.sold_at AS item_sold_at,
  ${CARD_COLUMNS_SQL}
  FROM inventory_items i JOIN cards c ON c.id = i.card_id`;

export function inventoryItemFromRow(row: InventoryJoinRow, buybackBps: number): InventoryItem {
  const card = cardSummaryFromColumns(row);
  return {
    id: row.item_id,
    card,
    status: row.item_status,
    valueAtPullPence: row.item_value_at_pull_pence,
    currentValuePence: card.marketValuePence,
    buybackPence: buybackPence(card.marketValuePence, buybackBps),
    acquiredAt: row.item_created_at,
    packId: row.item_pack_id,
    shipmentId: row.item_shipment_id,
    soldForPence: row.item_sold_for_pence,
    soldAt: row.item_sold_at,
  };
}

export function parseTheme(json: string): PackTheme {
  try {
    const t = JSON.parse(json) as Partial<PackTheme>;
    return { from: String(t.from ?? '#1f2937'), to: String(t.to ?? '#111827'), accent: String(t.accent ?? '#f59e0b') };
  } catch {
    return { from: '#1f2937', to: '#111827', accent: '#f59e0b' };
  }
}
