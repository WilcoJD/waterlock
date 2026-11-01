/**
 * Vault display helpers: buyback rate labels, value change since pull, client-side sorting and
 * per-status presentation. Pure functions (no React) so they are easy to reason about and test.
 */
import type { InventoryItem, InventorySort, InventoryStatus } from '@ripvault/shared';
import { colors } from '../../theme.ts';
import type { IconName } from '../../components/index.ts';

/** 9000 -> "90%", 9250 -> "92.5%", 9255 -> "92.55%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export interface ValueChange {
  /** current - atPull, in pence (may be negative). */
  deltaPence: number;
  /** Percentage change, or null when the pull value was 0 (no meaningful %). */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
}

export function valueChange(currentPence: number, atPullPence: number): ValueChange {
  const deltaPence = currentPence - atPullPence;
  const pct = atPullPence > 0 ? (deltaPence / atPullPence) * 100 : null;
  return { deltaPence, pct, direction: deltaPence > 0 ? 'up' : deltaPence < 0 ? 'down' : 'flat' };
}

/** 12.345 -> "+12%", 3.21 -> "+3.2%", -0.04 -> "-0.04%"... keeps it short for tiles. */
export function formatPct(pct: number): string {
  const abs = Math.abs(pct);
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  const digits = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
  return `${sign}${abs.toFixed(digits)}%`;
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Same order as the API's ORDER BY for each sort (value, then newest first), applied on the client so
 * changing the sort is instant. Returns a new array.
 */
export function sortInventory(items: readonly InventoryItem[], sort: InventorySort): InventoryItem[] {
  const out = [...items];
  const newestFirst = (a: InventoryItem, b: InventoryItem) => time(b.acquiredAt) - time(a.acquiredAt);
  switch (sort) {
    case 'value_desc':
      out.sort((a, b) => b.currentValuePence - a.currentValuePence || newestFirst(a, b));
      break;
    case 'value_asc':
      out.sort((a, b) => a.currentValuePence - b.currentValuePence || newestFirst(a, b));
      break;
    case 'newest':
      out.sort(newestFirst);
      break;
    case 'oldest':
      out.sort((a, b) => time(a.acquiredAt) - time(b.acquiredAt));
      break;
  }
  return out;
}

export interface SortOptionMeta {
  value: InventorySort;
  label: string;
  /** Compact label for the toolbar chip. */
  short: string;
  icon: IconName;
}

export const SORT_OPTIONS: readonly SortOptionMeta[] = [
  { value: 'value_desc', label: 'Value: high to low', short: 'Value high-low', icon: 'trending-down' },
  { value: 'value_asc', label: 'Value: low to high', short: 'Value low-high', icon: 'trending-up' },
  { value: 'newest', label: 'Newest first', short: 'Newest', icon: 'time-outline' },
  { value: 'oldest', label: 'Oldest first', short: 'Oldest', icon: 'hourglass-outline' },
];

export function sortMeta(sort: InventorySort): SortOptionMeta {
  return SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0]!;
}

export interface ItemStatusMeta {
  label: string;
  color: string;
  icon: IconName;
}

export const ITEM_STATUS_META: Readonly<Record<InventoryStatus, ItemStatusMeta>> = {
  vaulted: { label: 'In vault', color: colors.violet, icon: 'cube' },
  shipping: { label: 'Shipping', color: colors.info, icon: 'paper-plane' },
  shipped: { label: 'Shipped', color: colors.success, icon: 'checkmark-done' },
  sold: { label: 'Sold', color: colors.gold, icon: 'cash-outline' },
};

/** Sum of a pence field over items (integers only, so no float drift). */
export function sumPence(items: readonly InventoryItem[], pick: (item: InventoryItem) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}
