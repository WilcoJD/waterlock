/**
 * Tiny input validator. Collects per-field messages and throws one `validation_failed` error
 * listing them all, so the app can highlight every bad field at once.
 */
import { badRequest, validationFailed } from './errors.ts';

export type JsonObject = Record<string, unknown>;

/** Body must be a JSON object (not an array, null or a primitive). */
export function asObject(body: unknown): JsonObject {
  if (body === undefined) return {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object');
  }
  return body as JsonObject;
}

interface StrOpts {
  min?: number;
  max: number;
  /** Trim surrounding whitespace before checking (default true). */
  trim?: boolean;
  pattern?: RegExp;
  patternMessage?: string;
  label?: string;
}

interface IntOpts {
  min: number;
  max: number;
  label?: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export class Validator {
  readonly errors: Record<string, string> = {};
  private readonly body: JsonObject;

  constructor(body: JsonObject) {
    this.body = body;
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.body, name) && this.body[name] !== undefined;
  }

  fail(name: string, message: string): void {
    if (!(name in this.errors)) this.errors[name] = message;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** Throw validation_failed if anything failed. */
  check(): void {
    if (!this.ok) throw validationFailed({ ...this.errors });
  }

  /** Required string. Returns '' when invalid (the error is recorded). */
  str(name: string, opts: StrOpts): string {
    if (!this.has(name) || this.body[name] === null) {
      this.fail(name, `${opts.label ?? name} is required`);
      return '';
    }
    return this.checkString(name, this.body[name], opts) ?? '';
  }

  /** Optional string: undefined when absent. */
  optStr(name: string, opts: StrOpts): string | undefined {
    if (!this.has(name)) return undefined;
    if (this.body[name] === null) {
      this.fail(name, `${opts.label ?? name} must be a string`);
      return undefined;
    }
    return this.checkString(name, this.body[name], opts);
  }

  /** Nullable string: absent, null and blank all become null. */
  nullableStr(name: string, opts: StrOpts): string | null {
    if (!this.has(name) || this.body[name] === null) return null;
    const raw = this.body[name];
    if (typeof raw === 'string' && raw.trim() === '') return null;
    return this.checkString(name, raw, opts) ?? null;
  }

  private checkString(name: string, raw: unknown, opts: StrOpts): string | undefined {
    const label = opts.label ?? name;
    if (typeof raw !== 'string') {
      this.fail(name, `${label} must be a string`);
      return undefined;
    }
    const value = opts.trim === false ? raw : raw.trim();
    const min = opts.min ?? 1;
    if (value.length < min) {
      this.fail(name, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`);
      return undefined;
    }
    if (value.length > opts.max) {
      this.fail(name, `${label} must be at most ${opts.max} characters`);
      return undefined;
    }
    if (CONTROL_CHARS.test(value)) {
      this.fail(name, `${label} contains invalid characters`);
      return undefined;
    }
    if (opts.pattern && !opts.pattern.test(value)) {
      this.fail(name, opts.patternMessage ?? `${label} is not valid`);
      return undefined;
    }
    return value;
  }

  /** Required safe integer in [min, max]. Returns NaN when invalid. */
  int(name: string, opts: IntOpts): number {
    if (!this.has(name) || this.body[name] === null) {
      this.fail(name, `${opts.label ?? name} is required`);
      return Number.NaN;
    }
    return this.checkInt(name, this.body[name], opts) ?? Number.NaN;
  }

  /** Optional integer: undefined when absent. */
  optInt(name: string, opts: IntOpts): number | undefined {
    if (!this.has(name)) return undefined;
    return this.checkInt(name, this.body[name], opts);
  }

  checkInt(name: string, raw: unknown, opts: IntOpts): number | undefined {
    const label = opts.label ?? name;
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
      this.fail(name, `${label} must be a whole number`);
      return undefined;
    }
    if (raw < opts.min || raw > opts.max) {
      this.fail(name, `${label} must be between ${opts.min} and ${opts.max}`);
      return undefined;
    }
    return raw;
  }

  /** Array of id strings, 1..max entries, de-duplicated (order kept). */
  idList(name: string, opts: { min?: number; max: number; label?: string }): string[] {
    const label = opts.label ?? name;
    const raw = this.body[name];
    if (!Array.isArray(raw)) {
      this.fail(name, `${label} must be a list of ids`);
      return [];
    }
    return validateIdList(raw, opts.min ?? 1, opts.max, (msg) => this.fail(name, `${label} ${msg}`));
  }
}

/** Validate an id list from JSON or a query string. Calls `fail` with a message on error. */
export function validateIdList(raw: unknown[], min: number, max: number, fail: (msg: string) => void): string[] {
  if (raw.length < min || raw.length > max) {
    fail(`must contain between ${min} and ${max} ids`);
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      fail('must only contain valid ids');
      return [];
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Parse a YYYY-MM-DD calendar date. Returns null if malformed or not a real date. */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Whole years between a birth date and `now` (UTC). 29 Feb birthdays count from 1 March in non-leap years. */
export function ageOn(birth: { year: number; month: number; day: number }, now: Date): number {
  let age = now.getUTCFullYear() - birth.year;
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  if (m < birth.month || (m === birth.month && d < birth.day)) age -= 1;
  return age;
}

/** Parse a positive integer query parameter with bounds; throws validation_failed. */
export function queryInt(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw validationFailed({ [name]: `${name} must be a whole number` });
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw validationFailed({ [name]: `${name} must be between ${min} and ${max}` });
  }
  return n;
}

/** Parse a query enum parameter. */
export function queryEnum<T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw validationFailed({ [name]: `${name} must be one of ${allowed.join(', ')}` });
  }
  return raw as T;
}
