/**
 * SQLite access (node:sqlite, synchronous). One connection per process.
 *
 * Rules for callers:
 *  - Every multi-statement write goes through `tx()`. It uses BEGIN IMMEDIATE so a second
 *    process sharing the file waits (busy_timeout) instead of failing half-way.
 *  - Never `await` inside a transaction: `tx()` throws if the callback returns a Promise.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

export type Db = DatabaseSync;
export type Row = Record<string, SQLOutputValue>;
export type Params = SQLInputValue[];

export function openDatabase(path: string): Db {
  if (path !== ':memory:' && !path.startsWith('file:')) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

/** Run `fn` inside BEGIN IMMEDIATE / COMMIT, rolling back on any error. Nested calls join the outer transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return guardSync(fn());
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = guardSync(fn());
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

function guardSync<T>(value: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function') {
    throw new Error('tx() callback returned a Promise; never await inside a transaction');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Small typed query helpers
// ---------------------------------------------------------------------------

export function one<T = Row>(db: Db, sql: string, ...params: Params): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T = Row>(db: Db, sql: string, ...params: Params): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(db: Db, sql: string, ...params: Params): { changes: number; lastInsertRowid: number } {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** `?, ?, ?` for an IN (...) list. */
export function placeholders(n: number): string {
  return new Array(n).fill('?').join(', ');
}

// ---------------------------------------------------------------------------
// Migrations (versioned with PRAGMA user_version)
// ---------------------------------------------------------------------------

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    balance_pence INTEGER NOT NULL DEFAULT 0 CHECK (balance_pence >= 0),
    server_seed TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL,
    client_seed TEXT NOT NULL,
    nonce INTEGER NOT NULL DEFAULT 0 CHECK (nonce >= 0),
    daily_spend_limit_pence INTEGER CHECK (daily_spend_limit_pence IS NULL OR daily_spend_limit_pence >= 0),
    pending_daily_spend_limit_pence INTEGER CHECK (pending_daily_spend_limit_pence IS NULL OR pending_daily_spend_limit_pence >= 0),
    pending_limit_effective_at TEXT,
    cooloff_until TEXT,
    terms_accepted_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    set_id TEXT NOT NULL,
    set_name TEXT NOT NULL,
    number TEXT NOT NULL,
    rarity TEXT NOT NULL,
    image_small TEXT NOT NULL,
    image_large TEXT NOT NULL,
    market_value_pence INTEGER NOT NULL CHECK (market_value_pence >= 0),
    price_source TEXT NOT NULL DEFAULT 'seed',
    price_updated_at TEXT,
    stock INTEGER CHECK (stock IS NULL OR stock >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    price_pence INTEGER NOT NULL CHECK (price_pence > 0),
    theme_json TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    deactivated_reason TEXT,
    current_revision_id INTEGER REFERENCES pack_revisions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE pack_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pack_id TEXT NOT NULL REFERENCES packs(id),
    entries_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX pack_revisions_pack ON pack_revisions(pack_id);
  CREATE TRIGGER pack_revisions_immutable_update BEFORE UPDATE ON pack_revisions
    BEGIN SELECT RAISE(ABORT, 'pack revisions are immutable'); END;
  CREATE TRIGGER pack_revisions_immutable_delete BEFORE DELETE ON pack_revisions
    BEGIN SELECT RAISE(ABORT, 'pack revisions are immutable'); END;

  CREATE TABLE pack_entries (
    pack_id TEXT NOT NULL REFERENCES packs(id),
    card_id TEXT NOT NULL REFERENCES cards(id),
    weight INTEGER NOT NULL CHECK (weight > 0),
    PRIMARY KEY (pack_id, card_id)
  );
  CREATE INDEX pack_entries_card ON pack_entries(card_id);

  CREATE TABLE addresses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    full_name TEXT NOT NULL,
    line1 TEXT NOT NULL,
    line2 TEXT,
    city TEXT NOT NULL,
    region TEXT,
    postcode TEXT NOT NULL,
    country TEXT NOT NULL,
    phone TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX addresses_user ON addresses(user_id, created_at);

  CREATE TABLE shipments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    address_id TEXT REFERENCES addresses(id),
    address_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'processing', 'shipped', 'delivered', 'cancelled')),
    fee_pence INTEGER NOT NULL CHECK (fee_pence >= 0),
    item_count INTEGER NOT NULL CHECK (item_count > 0),
    total_value_pence INTEGER NOT NULL CHECK (total_value_pence >= 0),
    carrier TEXT,
    tracking_number TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX shipments_user ON shipments(user_id, created_at);
  CREATE INDEX shipments_status ON shipments(status, created_at);

  CREATE TABLE inventory_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    card_id TEXT NOT NULL REFERENCES cards(id),
    pack_id TEXT REFERENCES packs(id),
    status TEXT NOT NULL CHECK (status IN ('vaulted', 'shipping', 'shipped', 'sold')),
    value_at_pull_pence INTEGER NOT NULL CHECK (value_at_pull_pence >= 0),
    shipment_id TEXT REFERENCES shipments(id),
    sold_for_pence INTEGER CHECK (sold_for_pence IS NULL OR sold_for_pence >= 0),
    sold_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX inventory_user_status ON inventory_items(user_id, status);
  CREATE INDEX inventory_shipment ON inventory_items(shipment_id);
  CREATE INDEX inventory_card ON inventory_items(card_id);

  CREATE TABLE shipment_items (
    shipment_id TEXT NOT NULL REFERENCES shipments(id),
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
    PRIMARY KEY (shipment_id, inventory_item_id)
  );
  CREATE INDEX shipment_items_item ON shipment_items(inventory_item_id);

  CREATE TABLE pack_openings (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    batch_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    pack_id TEXT NOT NULL REFERENCES packs(id),
    revision_id INTEGER NOT NULL REFERENCES pack_revisions(id),
    price_pence INTEGER NOT NULL CHECK (price_pence > 0),
    server_seed_hash TEXT NOT NULL,
    client_seed TEXT NOT NULL,
    nonce INTEGER NOT NULL CHECK (nonce >= 0),
    roll REAL NOT NULL CHECK (roll >= 0 AND roll < 1),
    card_id TEXT NOT NULL REFERENCES cards(id),
    inventory_item_id TEXT NOT NULL UNIQUE REFERENCES inventory_items(id),
    value_pence INTEGER NOT NULL CHECK (value_pence >= 0),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, server_seed_hash, nonce)
  );
  CREATE INDEX pack_openings_user ON pack_openings(user_id, seq);
  CREATE INDEX pack_openings_pack ON pack_openings(pack_id);
  CREATE INDEX pack_openings_batch ON pack_openings(batch_id);

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('topup', 'pack_purchase', 'buyback', 'shipping_fee', 'shipping_refund',
                                       'withdrawal', 'withdrawal_reversal', 'adjustment')),
    amount_pence INTEGER NOT NULL,
    balance_after_pence INTEGER NOT NULL CHECK (balance_after_pence >= 0),
    reference TEXT,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX transactions_user ON transactions(user_id, id);
  CREATE INDEX transactions_user_type_time ON transactions(user_id, type, created_at);
  CREATE TRIGGER transactions_append_only_update BEFORE UPDATE ON transactions
    BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END;
  CREATE TRIGGER transactions_append_only_delete BEFORE DELETE ON transactions
    BEGIN SELECT RAISE(ABORT, 'transactions are append-only'); END;

  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL CHECK (provider IN ('stripe', 'dev')),
    provider_ref TEXT UNIQUE,
    amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
    currency TEXT NOT NULL DEFAULT 'GBP',
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
    checkout_url TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX payments_user ON payments(user_id, created_at);

  CREATE TABLE withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
    status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'rejected')),
    payout_details TEXT NOT NULL,
    admin_note TEXT,
    processed_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX withdrawals_user ON withdrawals(user_id, created_at);
  CREATE INDEX withdrawals_status ON withdrawals(status, created_at);

  CREATE TABLE seed_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    server_seed TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL UNIQUE,
    client_seed TEXT NOT NULL,
    final_nonce INTEGER NOT NULL CHECK (final_nonce >= 0),
    revealed_at TEXT NOT NULL
  );
  CREATE INDEX seed_history_user ON seed_history(user_id, id);

  CREATE TABLE idempotency_keys (
    user_id TEXT NOT NULL REFERENCES users(id),
    key TEXT NOT NULL,
    request_method TEXT NOT NULL,
    request_path TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status_code INTEGER,
    response_body TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  CREATE INDEX idempotency_created ON idempotency_keys(created_at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Db): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema version ${current} is newer than this build supports (${MIGRATIONS.length})`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
