/**
 * Safer-play rules as the API applies them (docs/API.md, PUT /me/limits), turned into copy.
 * Pure: no React / native imports.
 *
 * - Setting a first limit, lowering it, or re-saving the same value applies immediately (and cancels
 *   any pending raise).
 * - Raising or removing a limit waits LIMIT_INCREASE_DELAY_MS (24h).
 * - A break (cool-off) can only be extended, never shortened.
 */
import { LIMIT_INCREASE_DELAY_MS, formatPence } from '@ripvault/shared';
import type { SpendLimits } from '@ripvault/shared';
import { formatDateTime } from '../../lib/format.ts';

export const LIMIT_PRESETS_PENCE: readonly number[] = [1_000, 2_500, 5_000, 10_000];
export const COOL_OFF_OPTIONS: readonly (1 | 7 | 30)[] = [1, 7, 30];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Matches the API's MAX_SPEND_LIMIT_PENCE. */
export const MAX_LIMIT_PENCE = 100_000_000;

export function limitLabel(pence: number | null): string {
  return pence === null ? 'No limit' : formatPence(pence, { trimWholePounds: true });
}

export interface LimitChange {
  /** immediate: applies now. delayed: applies after 24h. none: nothing would change. */
  kind: 'immediate' | 'delayed' | 'none';
  /** One-line explanation for the chosen value. */
  message: string;
  /** When a delayed change would apply. */
  effectiveAt: Date | null;
}

/** What saving `next` (pence, or null = remove) would do, given the current limits. */
export function describeLimitChange(limits: SpendLimits, next: number | null, now: Date = new Date()): LimitChange {
  const current = limits.dailySpendLimitPence;
  const hasPending = limits.pendingEffectiveAt !== null;
  if (next !== null && (current === null || next <= current)) {
    if (current !== null && next === current) {
      return hasPending
        ? { kind: 'immediate', message: `Keeps your limit at ${limitLabel(next)} and cancels the pending change.`, effectiveAt: null }
        : { kind: 'none', message: `${limitLabel(next)} is already your daily limit.`, effectiveAt: null };
    }
    return {
      kind: 'immediate',
      message:
        current === null
          ? `Starts straight away: at most ${limitLabel(next)} on packs in any 24 hours.`
          : `Lowering your limit applies straight away.`,
      effectiveAt: null,
    };
  }
  if (current === null && next === null) {
    return { kind: 'none', message: "You don't have a daily limit right now.", effectiveAt: null };
  }
  const effectiveAt = new Date(now.getTime() + LIMIT_INCREASE_DELAY_MS);
  return {
    kind: 'delayed',
    message: `${next === null ? 'Removing' : 'Raising'} your limit takes 24 hours. It would apply on ${formatDateTime(effectiveAt)}; until then ${limitLabel(current)} still applies.`,
    effectiveAt,
  };
}

/** Spend left in the rolling 24h window (null = no limit). Never negative. */
export function remainingToday(limits: SpendLimits): number | null {
  if (limits.dailySpendLimitPence === null) return null;
  return Math.max(0, limits.dailySpendLimitPence - limits.spentLast24hPence);
}

/** 0..1 share of the daily limit used (0 when there is no limit; a 0 limit counts as full). */
export function limitUsage(limits: SpendLimits): number {
  const limit = limits.dailySpendLimitPence;
  if (limit === null) return 0;
  if (limit <= 0) return 1;
  return Math.min(1, limits.spentLast24hPence / limit);
}

/** True while a break is running. */
export function isCoolingOff(limits: SpendLimits, now: Date = new Date()): boolean {
  return limits.coolingOffUntil !== null && Date.parse(limits.coolingOffUntil) > now.getTime();
}

export interface CoolOffPlan {
  until: Date;
  /** False when a running break already lasts longer (the API never shortens a break). */
  extends: boolean;
}

export function planCoolOff(days: 1 | 7 | 30, limits: SpendLimits, now: Date = new Date()): CoolOffPlan {
  const until = new Date(now.getTime() + days * DAY_MS);
  const currentUntil = limits.coolingOffUntil ? Date.parse(limits.coolingOffUntil) : 0;
  return { until, extends: until.getTime() > currentUntil };
}

export function coolOffLabel(days: 1 | 7 | 30): string {
  return days === 1 ? '24 hours' : `${days} days`;
}
