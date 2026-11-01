/**
 * Small display helpers for the account area (wallet, profile, fairness, limits).
 * Pure: no React / native imports, so they can be unit-tested with plain Node.
 */
import { formatPence, parsePounds } from '@ripvault/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2026" (device local time); '' for an invalid date. */
export function formatMonthYear(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 12345 -> "12,345" (no Intl, consistent on every JS engine). */
export function formatCount(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A roll in [0, 1) with enough digits to compare by eye: 0.4821930417. */
export function formatRoll(roll: number): string {
  return roll.toFixed(10);
}

/** First letter of a display name for the avatar ("?" if there is none). */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  // Array.from keeps surrogate pairs (emoji) intact.
  return (Array.from(trimmed)[0] ?? '?').toUpperCase();
}

/** Pence as an editable pounds string for a text field: 2500 -> "25", 1250 -> "12.50". */
export function penceToInput(pence: number): string {
  return formatPence(pence, { trimWholePounds: true }).replace(/^£/, '').replace(/,/g, '');
}

export interface AmountCheck {
  /** Parsed amount (null when empty or not a valid amount). */
  pence: number | null;
  /** User-facing problem with the amount, or null when it is fine. */
  error: string | null;
}

/**
 * Validate a typed pounds amount against inclusive bounds.
 *   checkAmount('12.5', { minPence: 500, maxPence: 50_000 }) -> { pence: 1250, error: null }
 * `maxMessage` lets callers explain the ceiling (e.g. "That's more than your balance").
 */
export function checkAmount(
  input: string,
  bounds: { minPence: number; maxPence: number; minMessage?: string; maxMessage?: string },
): AmountCheck {
  if (input.trim() === '') return { pence: null, error: 'Enter an amount' };
  const pence = parsePounds(input);
  if (pence === null) return { pence: null, error: 'Enter an amount like 20 or 12.50' };
  if (pence < bounds.minPence) {
    return { pence, error: bounds.minMessage ?? `The minimum is ${formatPence(bounds.minPence, { trimWholePounds: true })}` };
  }
  if (pence > bounds.maxPence) {
    return { pence, error: bounds.maxMessage ?? `The maximum is ${formatPence(bounds.maxPence, { trimWholePounds: true })}` };
  }
  return { pence, error: null };
}
