/**
 * Pack maths shared by the API (to price and validate packs) and the app (to display odds).
 */

export type Tier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const TIERS: readonly Tier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Lower bound (inclusive, in pence) of each tier. Based on the card's market value. */
export const TIER_THRESHOLDS: Readonly<Record<Tier, number>> = {
  common: 0,
  uncommon: 100, // £1
  rare: 500, // £5
  epic: 2_500, // £25
  legendary: 10_000, // £100
};

export function tierForValue(valuePence: number): Tier {
  if (valuePence >= TIER_THRESHOLDS.legendary) return 'legendary';
  if (valuePence >= TIER_THRESHOLDS.epic) return 'epic';
  if (valuePence >= TIER_THRESHOLDS.rare) return 'rare';
  if (valuePence >= TIER_THRESHOLDS.uncommon) return 'uncommon';
  return 'common';
}

export type PullOutcome = 'loss' | 'win' | 'big_win';

/** How a pull compares to what the pack cost. Used for celebration effects. */
export function pullOutcome(valuePence: number, packPricePence: number): PullOutcome {
  if (valuePence >= packPricePence * 3) return 'big_win';
  if (valuePence >= packPricePence) return 'win';
  return 'loss';
}

export interface ValuedEntry {
  weight: number;
  valuePence: number;
}

export interface PackStats {
  totalWeight: number;
  /** Expected value of one pack in pence (rounded down). */
  evPence: number;
  minPence: number;
  maxPence: number;
  /** Chance the pull is worth at least the pack price (0..1), if a price is given. */
  hitChance: number | null;
  /** evPence / price (0..1+), if a price is given. "Return to player". */
  rtp: number | null;
}

export function packStats(entries: readonly ValuedEntry[], packPricePence?: number): PackStats {
  if (entries.length === 0) {
    return { totalWeight: 0, evPence: 0, minPence: 0, maxPence: 0, hitChance: null, rtp: null };
  }
  let totalWeight = 0;
  let weightedValue = 0;
  let minPence = Number.POSITIVE_INFINITY;
  let maxPence = 0;
  let hitWeight = 0;
  for (const e of entries) {
    totalWeight += e.weight;
    weightedValue += e.weight * e.valuePence;
    if (e.valuePence < minPence) minPence = e.valuePence;
    if (e.valuePence > maxPence) maxPence = e.valuePence;
    if (packPricePence !== undefined && e.valuePence >= packPricePence) hitWeight += e.weight;
  }
  const evPence = totalWeight > 0 ? Math.floor(weightedValue / totalWeight) : 0;
  const priced = packPricePence !== undefined && packPricePence > 0;
  return {
    totalWeight,
    evPence,
    minPence,
    maxPence,
    hitChance: priced && totalWeight > 0 ? hitWeight / totalWeight : null,
    rtp: priced ? evPence / packPricePence! : null,
  };
}

/**
 * True when the pack's exact expected value / price is above `maxRtpBps` (basis points).
 * Uses the unrounded weighted mean (sum(weight × value) / totalWeight), not the floored `evPence`, so a
 * pack can never sit up to 1p of EV above the cap. BigInt keeps the products exact beyond 2^53.
 */
export function exceedsMaxRtp(entries: readonly ValuedEntry[], packPricePence: number, maxRtpBps: number): boolean {
  let totalWeight = BigInt(0);
  let weightedValue = BigInt(0);
  for (const e of entries) {
    totalWeight += BigInt(e.weight);
    weightedValue += BigInt(e.weight) * BigInt(e.valuePence);
  }
  if (totalWeight === BigInt(0)) return false;
  return weightedValue * BigInt(10_000) > totalWeight * BigInt(packPricePence) * BigInt(maxRtpBps);
}

/** weight / total as a probability in [0, 1]. */
export function chanceOf(weight: number, totalWeight: number): number {
  return totalWeight > 0 ? weight / totalWeight : 0;
}

/** 0.125 -> "12.5%", 0.0004 -> "0.04%", 0.00001 -> "<0.01%". */
export function formatChance(p: number): string {
  if (p <= 0) return '0%';
  if (p < 0.0001) return '<0.01%';
  const pct = p * 100;
  const digits = pct >= 10 ? 1 : pct >= 1 ? 2 : pct >= 0.1 ? 2 : 3;
  return `${Number(pct.toFixed(digits))}%`;
}

/** 0.0005 -> "1 in 2,000". */
export function formatOneIn(p: number): string {
  if (p <= 0) return '—';
  const n = Math.max(1, Math.round(1 / p));
  return `1 in ${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
