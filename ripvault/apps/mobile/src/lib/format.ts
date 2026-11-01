/**
 * Display formatting that does not depend on Intl (consistent on every JS engine).
 * For money use formatPence from @ripvault/shared (or the MoneyText component).
 * For odds use formatChance / formatOneIn from @ripvault/shared.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value: string | number | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "3 Oct 2026" (device local time). */
export function formatDate(value: string | number | Date): string {
  const d = toDate(value);
  if (!d) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "3 Oct 2026, 14:05" (device local time, 24h). */
export function formatDateTime(value: string | number | Date): string {
  const d = toDate(value);
  if (!d) return '';
  return `${formatDate(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function formatRelative(value: string | number | Date, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 0) return formatDate(d);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}

/** Time remaining until `value`: "2d 4h", "3h 12m", "8m", or "now" once passed. */
export function formatTimeUntil(value: string | number | Date, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '';
  const totalMinutes = Math.ceil((d.getTime() - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return 'now';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Shorten a long hash/seed for display: "3f9a2c…e81b". */
export function shortHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** "1 card" / "3 cards". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Whole years between a YYYY-MM-DD date of birth and `now`; null if the date is not real. */
export function ageFromIsoDate(iso: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  let age = now.getUTCFullYear() - year;
  const beforeBirthday =
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}
