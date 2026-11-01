/**
 * Pure helpers for the pack shop, odds sheet and rip screen (no React, no native modules), so they
 * can be unit-tested with plain Node.
 */
import { TIERS, formatPence, pullOutcome } from '@ripvault/shared';
import type { OddsRow, PackDetail, PackSummary, PackTheme, Pull, Tier } from '@ripvault/shared';
import { colors } from '../../theme.ts';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Used when a pack has no (or a malformed) theme, e.g. a deep link before the pack has loaded. */
export const FALLBACK_PACK_THEME: PackTheme = { from: colors.violetDeep, to: colors.bgTop, accent: colors.gold };

/**
 * Pack themes come from the server. A malformed colour would crash the native gradient, so every
 * colour is checked and replaced with the fallback when it is not #RRGGBB.
 */
export function safePackTheme(theme: Partial<PackTheme> | null | undefined): PackTheme {
  const pick = (value: unknown, fallback: string) => (typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback);
  return {
    from: pick(theme?.from, FALLBACK_PACK_THEME.from),
    to: pick(theme?.to, FALLBACK_PACK_THEME.to),
    accent: pick(theme?.accent, FALLBACK_PACK_THEME.accent),
  };
}

// ---------------------------------------------------------------------------
// In-memory pack cache (lets the rip screen show the right pack art instantly)
// ---------------------------------------------------------------------------

const packCache = new Map<string, PackSummary>();

/** Strip the odds table from a PackDetail so only the summary is cached. */
export function toPackSummary(pack: PackSummary | PackDetail): PackSummary {
  const { id, name, tagline, pricePence, minPullPence, maxPullPence, hitChance, cardCount, theme, featuredCards, soldOut } = pack;
  return { id, name, tagline, pricePence, minPullPence, maxPullPence, hitChance, cardCount, theme, featuredCards, soldOut };
}

export function rememberPacks(packs: readonly (PackSummary | PackDetail)[]): void {
  for (const pack of packs) packCache.set(pack.id, toPackSummary(pack));
}

export function getRememberedPack(packId: string): PackSummary | undefined {
  return packCache.get(packId);
}

// ---------------------------------------------------------------------------
// Route params & quantity
// ---------------------------------------------------------------------------

/** Expo Router params can be string | string[]; take the first value. */
export function firstParam(value: string | string[] | undefined | null): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/** Clamp a quantity to 1..max (max is at least 1). Non-integers and junk become 1. */
export function clampQuantity(value: number, max: number): number {
  const upper = Math.max(1, Math.floor(Number.isFinite(max) ? max : 1));
  if (!Number.isFinite(value)) return 1;
  return Math.min(upper, Math.max(1, Math.floor(value)));
}

/** Parse the `qty` route param ("3") and clamp it to 1..max. */
export function parseQuantityParam(value: string | string[] | undefined | null, max: number): number {
  const raw = firstParam(value);
  if (raw === undefined || !/^\d{1,4}$/.test(raw.trim())) return 1;
  return clampQuantity(Number(raw.trim()), max);
}

/** Quick-pick chips for the quantity selector: 1, 3, 5, 10... up to max (always including max). */
export function quantityPresets(max: number): number[] {
  const upper = clampQuantity(max, max);
  const set = new Set<number>([1, 3, 5, 10, 20, 50].filter((n) => n <= upper));
  set.add(upper);
  const all = [...set].sort((a, b) => a - b);
  // At most five chips: always 1x, plus the four largest (which include max).
  return all.length <= 5 ? all : [1, ...all.slice(-4)];
}

/** CTA copy: "Rip for £1.00" (one pack) or "Rip 3 for £3.00". */
export function ripLabel(quantity: number, pricePence: number): string {
  const total = formatPence(pricePence * quantity);
  return quantity === 1 ? `Rip for ${total}` : `Rip ${quantity} for ${total}`;
}

/** Route to the rip screen for a pack and quantity. */
export function openHref(packId: string, quantity: number): string {
  return `/open/${encodeURIComponent(packId)}?qty=${quantity}`;
}

/** Route to the odds sheet (qty is carried so its "Rip" button matches the shop's selection). */
export function oddsHref(packId: string, quantity?: number): string {
  const base = `/pack/${encodeURIComponent(packId)}`;
  return quantity && quantity > 1 ? `${base}?qty=${quantity}` : base;
}

/** Route to the ship screen for the given inventory item ids. */
export function shipHref(itemIds: readonly string[]): string {
  return `/ship?items=${itemIds.map(encodeURIComponent).join(',')}`;
}

/** 12345 -> "12,345" (no Intl dependency). */
export function groupDigits(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------------------------------------------------------------------------
// Odds grouping
// ---------------------------------------------------------------------------

export interface TierSection {
  tier: Tier;
  /** Combined chance of pulling any card of this tier (0..1). */
  chance: number;
  data: OddsRow[];
}

/** Odds rows grouped by tier (legendary first), each group sorted by value (highest first). */
export function groupOddsByTier(odds: readonly OddsRow[]): TierSection[] {
  const byTier = new Map<Tier, OddsRow[]>();
  for (const row of odds) {
    const list = byTier.get(row.card.tier) ?? [];
    list.push(row);
    byTier.set(row.card.tier, list);
  }
  const sections: TierSection[] = [];
  for (const tier of [...TIERS].reverse()) {
    const rows = byTier.get(tier);
    if (!rows || rows.length === 0) continue;
    rows.sort((a, b) => b.card.marketValuePence - a.card.marketValuePence || (a.card.name < b.card.name ? -1 : 1));
    sections.push({ tier, chance: rows.reduce((sum, r) => sum + r.chance, 0), data: rows });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Pulls
// ---------------------------------------------------------------------------

/** Reveal order: lowest value first so the best card comes last. Ties keep draw (nonce) order. */
export function revealOrder(pulls: readonly Pull[]): Pull[] {
  return [...pulls].sort((a, b) => a.valuePence - b.valuePence || a.nonce - b.nonce);
}

/** Summary order: best first. */
export function bestFirst(pulls: readonly Pull[]): Pull[] {
  return [...pulls].sort((a, b) => b.valuePence - a.valuePence || a.nonce - b.nonce);
}

/** "12-14" (or "12" for a single pull): the nonces used, for the fairness footnote. */
export function nonceRange(pulls: readonly Pull[]): string {
  if (pulls.length === 0) return '';
  const nonces = pulls.map((p) => p.nonce);
  const min = Math.min(...nonces);
  const max = Math.max(...nonces);
  return min === max ? String(min) : `${min}–${max}`;
}

/** "4.2×" multiple of the pack price, or null when it is not a hit. */
export function hitMultiple(valuePence: number, packPricePence: number): string | null {
  if (packPricePence <= 0 || pullOutcome(valuePence, packPricePence) === 'loss') return null;
  const multiple = valuePence / packPricePence;
  return `${multiple >= 10 ? Math.floor(multiple) : Math.floor(multiple * 10) / 10}×`;
}

export type PullRowStatus = 'new' | 'kept' | 'selling' | 'sold' | 'gone';

export interface PullRowState {
  status: PullRowStatus;
  /** Credited amount once sold. */
  soldForPence?: number;
  /** Label for cards that left the vault another way ("Shipping"). */
  goneLabel?: string;
}

export interface PullTotals {
  totalValuePence: number;
  totalBuybackPence: number;
  /** Rows the "Sell all" button would sell: not sold, not kept, not in flight, not gone. */
  sellableIds: string[];
  sellablePence: number;
  /** Rows that can still be shipped (new or kept). */
  shippableIds: string[];
  soldCount: number;
  soldPence: number;
}

export function pullTotals(pulls: readonly Pull[], rows: Readonly<Record<string, PullRowState | undefined>>): PullTotals {
  const totals: PullTotals = {
    totalValuePence: 0,
    totalBuybackPence: 0,
    sellableIds: [],
    sellablePence: 0,
    shippableIds: [],
    soldCount: 0,
    soldPence: 0,
  };
  for (const pull of pulls) {
    totals.totalValuePence += pull.valuePence;
    totals.totalBuybackPence += pull.buybackPence;
    const state = rows[pull.inventoryItemId] ?? { status: 'new' };
    if (state.status === 'new') {
      totals.sellableIds.push(pull.inventoryItemId);
      totals.sellablePence += pull.buybackPence;
    }
    if (state.status === 'new' || state.status === 'kept') totals.shippableIds.push(pull.inventoryItemId);
    if (state.status === 'sold') {
      totals.soldCount += 1;
      totals.soldPence += state.soldForPence ?? pull.buybackPence;
    }
  }
  return totals;
}

/** Stable key for "this exact set of items" (so a retried sale reuses its Idempotency-Key). */
export function idsSignature(ids: readonly string[]): string {
  return [...ids].sort().join(',');
}
