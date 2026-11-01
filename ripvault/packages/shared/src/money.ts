/**
 * Money is always an integer number of pence (minor units). Never use floats for balances.
 * Rates are integer basis points (1 bp = 0.01%), so 9000 bps = 90%.
 */

export const CURRENCY = 'GBP' as const;
export const CURRENCY_SYMBOL = '£';

export function assertPence(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be an integer number of pence`);
}

export interface FormatOptions {
  /** Always show a leading + for positive amounts (for ledgers). */
  signed?: boolean;
  /** Drop ".00" for whole pounds, e.g. "£25". */
  trimWholePounds?: boolean;
}

/** 123456 -> "£1,234.56", -250 -> "-£2.50". Does not depend on Intl (not on every RN engine). */
export function formatPence(pence: number, options: FormatOptions = {}): string {
  const negative = pence < 0;
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rem = abs % 100;
  const poundsStr = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = options.trimWholePounds && rem === 0 ? poundsStr : `${poundsStr}.${String(rem).padStart(2, '0')}`;
  const sign = negative ? '-' : options.signed && abs > 0 ? '+' : '';
  return `${sign}${CURRENCY_SYMBOL}${body}`;
}

/**
 * Parse user input like "12", "12.5", "£12.50", "1,000" into pence.
 * Returns null for anything that is not a non-negative amount with at most 2 decimals.
 */
export function parsePounds(input: string): number | null {
  const cleaned = input.trim().replace(/^£/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(pence) ? pence : null;
}

/** Apply a basis-point rate, rounding down (in the house's favour, never over-paying). */
export function applyBps(pence: number, bps: number): number {
  assertPence(pence);
  if (!Number.isSafeInteger(bps) || bps < 0) throw new RangeError('bps must be a non-negative integer');
  return Math.floor((pence * bps) / 10_000);
}

/** Buyback offer for a card worth `marketValuePence` at `buybackBps` (default 90%). */
export function buybackPence(marketValuePence: number, buybackBps: number): number {
  return applyBps(marketValuePence, buybackBps);
}

/** Convert a decimal price in another currency to pence using a decimal FX rate, rounding to nearest. */
export function convertToPence(amount: number, fxRateToGbp: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('amount must be a non-negative number');
  if (!Number.isFinite(fxRateToGbp) || fxRateToGbp <= 0) throw new RangeError('fx rate must be positive');
  return Math.round(amount * fxRateToGbp * 100);
}
