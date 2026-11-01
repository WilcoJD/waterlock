/**
 * Wallet: ledger history, top-ups and withdrawals.
 */
import type {
  TopupResponse,
  Transaction,
  TransactionType,
  WalletResponse,
  Withdrawal,
  WithdrawalResponse,
  WithdrawalStatus,
} from '@ripvault/shared';
import { devTopupsAllowed } from '../config.ts';
import { tx } from '../db.ts';
import type { Deps } from '../deps.ts';
import { ApiError, forbidden, paymentsUnavailable } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator, asObject, queryInt } from '../validate.ts';
import { credit, debit, balanceOf } from './ledger.ts';
import type { UserRow } from './rows.ts';
import { createCheckoutSession } from './stripe.ts';
import { isCoolingOff, requireUser } from './users.ts';

interface TransactionRow {
  id: number;
  type: TransactionType;
  amount_pence: number;
  balance_after_pence: number;
  description: string;
  reference: string | null;
  created_at: string;
}

function transaction(row: TransactionRow): Transaction {
  return {
    id: String(row.id),
    type: row.type,
    amountPence: row.amount_pence,
    balanceAfterPence: row.balance_after_pence,
    description: row.description,
    reference: row.reference,
    createdAt: row.created_at,
  };
}

export function getWallet(deps: Deps, userId: string, query: URLSearchParams): WalletResponse {
  const limit = queryInt(query, 'limit', 50, 1, 100);
  const beforeRaw = query.get('before');
  let before: number | null = null;
  if (beforeRaw !== null && beforeRaw !== '') {
    if (!/^\d{1,15}$/.test(beforeRaw)) return { balancePence: balanceOf(deps.db, userId), transactions: [], nextCursor: null };
    before = Number(beforeRaw);
  }
  const rows = deps.db
    .prepare(
      `SELECT id, type, amount_pence, balance_after_pence, description, reference, created_at FROM transactions
       WHERE user_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
    )
    .all(userId, before, before, limit + 1) as unknown as TransactionRow[];
  const page = rows.slice(0, limit);
  return {
    balancePence: balanceOf(deps.db, userId),
    transactions: page.map(transaction),
    nextCursor: rows.length > limit ? String(page[page.length - 1]!.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Top-ups
// ---------------------------------------------------------------------------

function validateTopup(deps: Deps, user: UserRow, rawBody: unknown): number {
  const { minPence, maxPence } = deps.config.topup;
  const v = new Validator(asObject(rawBody));
  const amount = v.int('amountPence', { min: minPence, max: maxPence, label: 'Amount' });
  v.check();
  const fresh = requireUser(deps.db, user.id);
  if (isCoolingOff(fresh, deps.now())) {
    throw new ApiError(403, 'cooling_off', `You are taking a break until ${fresh.cooloff_until}. Top-ups are paused.`);
  }
  return amount;
}

/** Instant development top-up (never in production). Synchronous, so it can share the idempotency transaction. */
export function devTopup(deps: Deps, user: UserRow, rawBody: unknown): TopupResponse {
  const amount = validateTopup(deps, user, rawBody);
  if (!devTopupsAllowed(deps.config)) throw paymentsUnavailable();
  const at = deps.now().toISOString();
  return tx(deps.db, () => {
    const paymentId = newId('pay');
    deps.db
      .prepare(
        `INSERT INTO payments (id, user_id, provider, provider_ref, amount_pence, currency, status, created_at, updated_at, completed_at)
         VALUES (?, ?, 'dev', NULL, ?, 'GBP', 'succeeded', ?, ?, ?)`,
      )
      .run(paymentId, user.id, amount, at, at, at);
    const balance = credit(deps.db, {
      userId: user.id,
      type: 'topup',
      amountPence: amount,
      description: 'Top-up (development)',
      reference: paymentId,
      at,
    });
    return { kind: 'credited', paymentId, balancePence: balance };
  });
}

/** Stripe Checkout top-up: records a pending payment, then asks Stripe for a session. */
export async function stripeTopup(deps: Deps, user: UserRow, rawBody: unknown): Promise<TopupResponse> {
  const amount = validateTopup(deps, user, rawBody);
  const paymentId = newId('pay');
  const at = deps.now().toISOString();
  deps.db
    .prepare(
      `INSERT INTO payments (id, user_id, provider, provider_ref, amount_pence, currency, status, created_at, updated_at)
       VALUES (?, ?, 'stripe', NULL, ?, 'GBP', 'pending', ?, ?)`,
    )
    .run(paymentId, user.id, amount, at, at);
  try {
    const session = await createCheckoutSession(deps, { paymentId, userId: user.id, email: user.email, amountPence: amount });
    deps.db
      .prepare('UPDATE payments SET provider_ref = ?, checkout_url = ?, updated_at = ? WHERE id = ?')
      .run(session.id, session.url, deps.now().toISOString(), paymentId);
    return { kind: 'checkout', paymentId, checkoutUrl: session.url };
  } catch (err) {
    deps.db
      .prepare("UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
      .run('Could not create checkout session', deps.now().toISOString(), paymentId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

export interface WithdrawalRow {
  id: string;
  user_id: string;
  amount_pence: number;
  status: WithdrawalStatus;
  payout_details: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

/** "paypal@example.com" -> "pa**************om". */
export function maskPayoutDetails(details: string): string {
  if (details.length <= 4) return '*'.repeat(details.length);
  return `${details.slice(0, 2)}${'*'.repeat(Math.min(details.length - 4, 12))}${details.slice(-2)}`;
}

export function withdrawalDto(row: WithdrawalRow, masked: boolean): Withdrawal {
  return {
    id: row.id,
    amountPence: row.amount_pence,
    status: row.status,
    payoutDetails: masked ? maskPayoutDetails(row.payout_details) : row.payout_details,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWithdrawals(deps: Deps, userId: string): Withdrawal[] {
  const rows = deps.db
    .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
    .all(userId) as unknown as WithdrawalRow[];
  return rows.map((r) => withdrawalDto(r, true));
}

export function createWithdrawal(deps: Deps, user: UserRow, rawBody: unknown): WithdrawalResponse {
  if (!deps.config.withdrawals.enabled) throw forbidden('Withdrawals are not available right now');
  const v = new Validator(asObject(rawBody));
  const amount = v.int('amountPence', { min: deps.config.withdrawals.minPence, max: 100_000_000, label: 'Amount' });
  const payoutDetails = v.str('payoutDetails', { min: 3, max: 200, label: 'Payout details' });
  v.check();
  const at = deps.now().toISOString();
  return tx(deps.db, () => {
    const id = newId('wdr');
    const balance = debit(deps.db, {
      userId: user.id,
      type: 'withdrawal',
      amountPence: amount,
      description: 'Withdrawal requested',
      reference: id,
      at,
    });
    deps.db
      .prepare(
        `INSERT INTO withdrawals (id, user_id, amount_pence, status, payout_details, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(id, user.id, amount, payoutDetails, at, at);
    const row = deps.db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id) as unknown as WithdrawalRow;
    return { withdrawal: withdrawalDto(row, false), balancePence: balance };
  });
}
