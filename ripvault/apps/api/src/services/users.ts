/**
 * Accounts, profile, safer-play limits.
 */
import {
  DISPLAY_NAME_MAX_LENGTH,
  LIMIT_INCREASE_DELAY_MS,
  MINIMUM_AGE,
  PASSWORD_MIN_LENGTH,
  hashServerSeed,
} from '@ripvault/shared';
import type { AuthResponse, Me, SpendLimits, UserStats } from '@ripvault/shared';
import { DEMO_USER_EMAIL, isEmailLike } from '../config.ts';
import { signToken } from '../auth/jwt.ts';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password.ts';
import { tx } from '../db.ts';
import type { Db } from '../db.ts';
import type { Deps } from '../deps.ts';
import { ApiError, notFound } from '../errors.ts';
import { newClientSeed, newId, newServerSeed } from '../ids.ts';
import { Validator, ageOn, asObject, parseIsoDate } from '../validate.ts';
import type { UserRow } from './rows.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_SPEND_LIMIT_PENCE = 100_000_000;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getUser(db: Db, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByEmail(db: Db, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normaliseEmail(email)) as UserRow | undefined;
}

export function requireUser(db: Db, id: string): UserRow {
  const user = getUser(db, id);
  if (!user) throw notFound('User');
  return user;
}

export interface NewUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  dateOfBirth: string;
  role?: 'user' | 'admin';
}

/** Insert a user with a fresh seed pair. Must run inside tx(). Throws email_taken on duplicates. */
export function insertUser(db: Db, input: NewUserInput, at: string): UserRow {
  const id = newId('usr');
  const serverSeed = newServerSeed();
  try {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, date_of_birth, role, balance_pence,
         server_seed, server_seed_hash, client_seed, nonce, terms_accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      id,
      normaliseEmail(input.email),
      input.passwordHash,
      input.displayName,
      input.dateOfBirth,
      input.role ?? 'user',
      serverSeed,
      hashServerSeed(serverSeed),
      newClientSeed(),
      at,
      at,
      at,
    );
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: users\.email/.test(err.message)) {
      throw new ApiError(409, 'email_taken', 'An account with this email already exists');
    }
    throw err;
  }
  return getUser(db, id)!;
}

// ---------------------------------------------------------------------------
// Register / login
// ---------------------------------------------------------------------------

export async function register(deps: Deps, rawBody: unknown): Promise<AuthResponse> {
  const v = new Validator(asObject(rawBody));
  const email = normaliseEmail(v.str('email', { max: 254, label: 'Email' }));
  if (v.ok && !isEmailLike(email)) v.fail('email', 'Enter a valid email address');
  const password = v.str('password', { min: PASSWORD_MIN_LENGTH, max: 200, trim: false, label: 'Password' });
  const displayName = v.str('displayName', { min: 1, max: DISPLAY_NAME_MAX_LENGTH, label: 'Display name' });
  const dob = v.str('dateOfBirth', { max: 10, label: 'Date of birth' });
  const now = deps.now();
  const birth = dob ? parseIsoDate(dob) : null;
  if (dob && !birth) v.fail('dateOfBirth', 'Date of birth must be a real date in YYYY-MM-DD format');
  if (birth) {
    const birthMs = Date.UTC(birth.year, birth.month - 1, birth.day);
    if (birthMs > now.getTime()) v.fail('dateOfBirth', 'Date of birth cannot be in the future');
    else if (birth.year < 1900) v.fail('dateOfBirth', 'Date of birth is not valid');
  }
  if (asObject(rawBody).acceptTerms !== true) v.fail('acceptTerms', 'You must accept the terms to continue');
  v.check();
  if (ageOn(birth!, now) < MINIMUM_AGE) {
    throw new ApiError(403, 'underage', `You must be at least ${MINIMUM_AGE} to use RipVault`);
  }
  if (getUserByEmail(deps.db, email)) {
    throw new ApiError(409, 'email_taken', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(password);
  const at = deps.now().toISOString();
  const user = tx(deps.db, () => insertUser(deps.db, { email, passwordHash, displayName, dateOfBirth: dob }, at));
  deps.logger.info('user registered', { userId: user.id });
  return { token: signToken(user.id, deps.config.jwtSecret, deps.now()), user: buildMe(deps, user.id) };
}

const INVALID_CREDENTIALS = () => new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');

export async function login(deps: Deps, rawBody: unknown): Promise<AuthResponse> {
  const v = new Validator(asObject(rawBody));
  const email = normaliseEmail(v.str('email', { max: 254, label: 'Email' }));
  const password = v.str('password', { min: 1, max: 200, trim: false, label: 'Password' });
  v.check();

  const user = getUserByEmail(deps.db, email);
  // Always run scrypt so response time does not reveal whether the email exists.
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) throw INVALID_CREDENTIALS();
  if (deps.config.env === 'production' && user.email === DEMO_USER_EMAIL) throw INVALID_CREDENTIALS();
  return { token: signToken(user.id, deps.config.jwtSecret, deps.now()), user: buildMe(deps, user.id) };
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

/** Apply a pending (raised or cleared) spend limit once its effective time has passed. */
export function applyDueLimit(deps: Deps, userId: string): void {
  const nowIso = deps.now().toISOString();
  tx(deps.db, () => {
    deps.db
      .prepare(
        `UPDATE users SET daily_spend_limit_pence = pending_daily_spend_limit_pence,
           pending_daily_spend_limit_pence = NULL, pending_limit_effective_at = NULL, updated_at = ?
         WHERE id = ? AND pending_limit_effective_at IS NOT NULL AND pending_limit_effective_at <= ?`,
      )
      .run(nowIso, userId, nowIso);
  });
}

/** Pack spend in the rolling 24h before `now`. */
export function spentLast24h(db: Db, userId: string, now: Date): number {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const row = db
    .prepare(
      `SELECT COALESCE(-SUM(amount_pence), 0) AS spent FROM transactions
       WHERE user_id = ? AND type = 'pack_purchase' AND created_at > ?`,
    )
    .get(userId, since) as { spent: number };
  return row.spent;
}

export function isCoolingOff(user: UserRow, now: Date): boolean {
  return user.cooloff_until !== null && Date.parse(user.cooloff_until) > now.getTime();
}

export function buildMe(deps: Deps, userId: string): Me {
  applyDueLimit(deps, userId);
  const db = deps.db;
  const user = requireUser(db, userId);
  const now = deps.now();

  const openings = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(value_pence), 0) AS biggest FROM pack_openings WHERE user_id = ?')
    .get(userId) as { n: number; biggest: number };
  const vault = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(c.market_value_pence), 0) AS value
       FROM inventory_items i JOIN cards c ON c.id = i.card_id WHERE i.user_id = ? AND i.status = 'vaulted'`,
    )
    .get(userId) as { n: number; value: number };
  const spent = db
    .prepare(`SELECT COALESCE(-SUM(amount_pence), 0) AS total FROM transactions WHERE user_id = ? AND type = 'pack_purchase'`)
    .get(userId) as { total: number };

  const stats: UserStats = {
    packsOpened: openings.n,
    cardsInVault: vault.n,
    vaultValuePence: vault.value,
    biggestPullPence: openings.biggest,
    totalSpentPence: spent.total,
  };
  const limits: SpendLimits = {
    dailySpendLimitPence: user.daily_spend_limit_pence,
    pendingDailySpendLimitPence: user.pending_limit_effective_at ? user.pending_daily_spend_limit_pence : null,
    pendingEffectiveAt: user.pending_limit_effective_at,
    spentLast24hPence: spentLast24h(db, userId, now),
    coolingOffUntil: isCoolingOff(user, now) ? user.cooloff_until : null,
  };
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    balancePence: user.balance_pence,
    createdAt: user.created_at,
    stats,
    limits,
  };
}

export function updateMe(deps: Deps, user: UserRow, rawBody: unknown): Me {
  const v = new Validator(asObject(rawBody));
  const displayName = v.optStr('displayName', { min: 1, max: DISPLAY_NAME_MAX_LENGTH, label: 'Display name' });
  v.check();
  if (displayName !== undefined) {
    deps.db
      .prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(displayName, deps.now().toISOString(), user.id);
  }
  return buildMe(deps, user.id);
}

export function updateLimits(deps: Deps, user: UserRow, rawBody: unknown): Me {
  const body = asObject(rawBody);
  const v = new Validator(body);
  const hasLimit = Object.prototype.hasOwnProperty.call(body, 'dailySpendLimitPence');
  let newLimit: number | null = null;
  if (hasLimit && body.dailySpendLimitPence !== null) {
    newLimit = v.checkInt('dailySpendLimitPence', body.dailySpendLimitPence, { min: 0, max: MAX_SPEND_LIMIT_PENCE, label: 'Daily limit' }) ?? null;
  }
  let coolOffDays: number | undefined;
  if (v.has('coolOffDays')) {
    const d = body.coolOffDays;
    if (d === 1 || d === 7 || d === 30) coolOffDays = d;
    else v.fail('coolOffDays', 'coolOffDays must be 1, 7 or 30');
  }
  if (!hasLimit && !v.has('coolOffDays')) v.fail('dailySpendLimitPence', 'Provide dailySpendLimitPence or coolOffDays');
  v.check();

  const now = deps.now();
  const nowIso = now.toISOString();
  tx(deps.db, () => {
    applyDueLimit(deps, user.id);
    const current = requireUser(deps.db, user.id);
    if (hasLimit) {
      const existing = current.daily_spend_limit_pence;
      const tighter = newLimit !== null && (existing === null || newLimit <= existing);
      if (tighter) {
        // Lowering (or setting a first limit) applies straight away and cancels any pending raise.
        deps.db
          .prepare(
            `UPDATE users SET daily_spend_limit_pence = ?, pending_daily_spend_limit_pence = NULL,
               pending_limit_effective_at = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(newLimit, nowIso, user.id);
      } else if (existing === null && newLimit === null) {
        deps.db
          .prepare(
            'UPDATE users SET pending_daily_spend_limit_pence = NULL, pending_limit_effective_at = NULL, updated_at = ? WHERE id = ?',
          )
          .run(nowIso, user.id);
      } else {
        // Raising or removing waits out the cool-down.
        const effective = new Date(now.getTime() + LIMIT_INCREASE_DELAY_MS).toISOString();
        deps.db
          .prepare(
            'UPDATE users SET pending_daily_spend_limit_pence = ?, pending_limit_effective_at = ?, updated_at = ? WHERE id = ?',
          )
          .run(newLimit, effective, nowIso, user.id);
      }
    }
    if (coolOffDays !== undefined) {
      const until = new Date(now.getTime() + coolOffDays * DAY_MS);
      const existingUntil = current.cooloff_until ? Date.parse(current.cooloff_until) : 0;
      if (until.getTime() > existingUntil) {
        deps.db.prepare('UPDATE users SET cooloff_until = ?, updated_at = ? WHERE id = ?').run(until.toISOString(), nowIso, user.id);
      }
    }
  });
  return buildMe(deps, user.id);
}
