/**
 * The only code that changes a balance. Each call updates users.balance_pence with a conditional
 * UPDATE and appends the matching ledger row (with balance_after) in the caller's transaction, so
 * balance_pence == SUM(transactions.amount_pence) always holds.
 */
import type { TransactionType } from '@ripvault/shared';
import type { Db } from '../db.ts';
import { insufficientFunds } from '../errors.ts';

export interface LedgerEntry {
  userId: string;
  type: TransactionType;
  amountPence: number;
  description: string;
  reference: string | null;
  at: string;
}

function assertInTx(db: Db): void {
  if (!db.isTransaction) throw new Error('balance changes must run inside tx()');
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('ledger amount must be a non-negative integer of pence');
}

/** Add money. Returns the new balance. */
export function credit(db: Db, e: LedgerEntry): number {
  assertInTx(db);
  assertAmount(e.amountPence);
  const row = db
    .prepare('UPDATE users SET balance_pence = balance_pence + ?, updated_at = ? WHERE id = ? RETURNING balance_pence')
    .get(e.amountPence, e.at, e.userId) as { balance_pence: number } | undefined;
  if (!row) throw new Error(`credit: user ${e.userId} not found`);
  appendLedger(db, e.userId, e.type, e.amountPence, row.balance_pence, e.description, e.reference, e.at);
  return row.balance_pence;
}

/** Take money, failing with insufficient_funds (and changing nothing) if the balance is too low. */
export function debit(db: Db, e: LedgerEntry): number {
  assertInTx(db);
  assertAmount(e.amountPence);
  const row = db
    .prepare(
      'UPDATE users SET balance_pence = balance_pence - ?, updated_at = ? WHERE id = ? AND balance_pence >= ? RETURNING balance_pence',
    )
    .get(e.amountPence, e.at, e.userId, e.amountPence) as { balance_pence: number } | undefined;
  if (!row) throw insufficientFunds();
  appendLedger(db, e.userId, e.type, -e.amountPence, row.balance_pence, e.description, e.reference, e.at);
  return row.balance_pence;
}

function appendLedger(
  db: Db,
  userId: string,
  type: TransactionType,
  amount: number,
  balanceAfter: number,
  description: string,
  reference: string | null,
  at: string,
): void {
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount_pence, balance_after_pence, reference, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, type, amount, balanceAfter, reference, description, at);
}

export function balanceOf(db: Db, userId: string): number {
  const row = db.prepare('SELECT balance_pence FROM users WHERE id = ?').get(userId) as { balance_pence: number } | undefined;
  return row?.balance_pence ?? 0;
}
