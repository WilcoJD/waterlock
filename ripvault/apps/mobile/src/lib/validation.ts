/** Client-side form checks. The API validates everything again; these are for instant feedback. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Keep digits only (for numeric inputs such as date parts). */
export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * Build "YYYY-MM-DD" from day/month/year inputs. Returns null unless it is a real calendar date
 * (e.g. 31/02 is rejected) with a 4-digit year.
 */
export function buildIsoDate(day: string, month: string, year: string): string | null {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
