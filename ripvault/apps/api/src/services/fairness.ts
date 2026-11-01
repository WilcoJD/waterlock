/**
 * Provably-fair seeds, rotation and opening history. The current (unrevealed) server seed and the
 * pre-committed next server seed never leave this module: only their hashes are returned until the
 * player rotates. Rotation promotes the next seed, whose hash the player saw before choosing the client
 * seed it is paired with, so the server can never pick a server seed after seeing the client seed.
 */
import { hashServerSeed, isValidClientSeed } from '@ripvault/shared';
import type {
  FairnessState,
  Opening,
  OpeningsResponse,
  RevealedSeed,
  RotateSeedResponse,
  VerifyOpeningResponse,
} from '@ripvault/shared';
import { tx } from '../db.ts';
import type { Db } from '../db.ts';
import type { Deps } from '../deps.ts';
import { notFound } from '../errors.ts';
import { newClientSeed, newServerSeed } from '../ids.ts';
import { Validator, asObject, queryInt } from '../validate.ts';
import { CARD_COLUMNS_SQL, cardSummaryFromColumns } from './rows.ts';
import type { CardColumns, UserRow } from './rows.ts';
import { requireUser } from './users.ts';
import { revisionEntries } from './packs.ts';

interface SeedHistoryRow {
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  final_nonce: number;
  revealed_at: string;
}

function revealed(row: SeedHistoryRow): RevealedSeed {
  return {
    serverSeed: row.server_seed,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    finalNonce: row.final_nonce,
    revealedAt: row.revealed_at,
  };
}

export function getFairness(deps: Deps, userId: string): FairnessState {
  const user = requireUser(deps.db, userId);
  const history = deps.db
    .prepare(
      `SELECT server_seed, server_seed_hash, client_seed, final_nonce, revealed_at
       FROM seed_history WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    )
    .all(userId) as unknown as SeedHistoryRow[];
  return {
    serverSeedHash: user.server_seed_hash,
    clientSeed: user.client_seed,
    nonce: user.nonce,
    nextServerSeedHash: user.next_server_seed_hash,
    revealed: history.map(revealed),
  };
}

export function rotateSeed(deps: Deps, caller: UserRow, rawBody: unknown): RotateSeedResponse {
  const body = asObject(rawBody);
  const v = new Validator(body);
  let clientSeed: string | undefined;
  if (v.has('clientSeed')) {
    const raw = body.clientSeed;
    if (typeof raw !== 'string' || !isValidClientSeed(raw)) {
      v.fail('clientSeed', 'Client seed must be 1-64 letters, numbers, "-" or "_"');
    } else {
      clientSeed = raw;
    }
  }
  v.check();
  const at = deps.now().toISOString();
  const result = tx(deps.db, () => {
    const user = requireUser(deps.db, caller.id);
    deps.db
      .prepare(
        `INSERT INTO seed_history (user_id, server_seed, server_seed_hash, client_seed, final_nonce, revealed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, user.server_seed, user.server_seed_hash, user.client_seed, user.nonce, at);
    // Promote the seed whose hash was already published as nextServerSeedHash BEFORE this request
    // (so before the player chose the client seed), and commit a fresh next seed for the rotation after.
    const promoted = user.next_server_seed ?? newServerSeed();
    const upcoming = newServerSeed();
    deps.db
      .prepare(
        `UPDATE users SET server_seed = ?, server_seed_hash = ?, client_seed = ?, nonce = 0,
           next_server_seed = ?, next_server_seed_hash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(promoted, hashServerSeed(promoted), clientSeed ?? newClientSeed(), upcoming, hashServerSeed(upcoming), at, user.id);
    return {
      serverSeed: user.server_seed,
      serverSeedHash: user.server_seed_hash,
      clientSeed: user.client_seed,
      finalNonce: user.nonce,
      revealedAt: at,
    } satisfies RevealedSeed;
  });
  return { revealed: result, current: getFairness(deps, caller.id) };
}

// ---------------------------------------------------------------------------
// Openings
// ---------------------------------------------------------------------------

interface OpeningRow extends CardColumns {
  seq: number;
  id: string;
  batch_id: string;
  pack_id: string;
  pack_name: string;
  price_pence: number;
  value_pence: number;
  inventory_item_id: string;
  revision_id: number;
  server_seed_hash: string;
  revealed_seed: string | null;
  client_seed: string;
  nonce: number;
  roll: number;
  created_at: string;
}

const OPENING_SELECT = `SELECT o.seq, o.id, o.batch_id, o.pack_id, p.name AS pack_name, o.price_pence, o.value_pence,
    o.inventory_item_id, o.revision_id, o.server_seed_hash, sh.server_seed AS revealed_seed, o.client_seed, o.nonce,
    o.roll, o.created_at, ${CARD_COLUMNS_SQL}
  FROM pack_openings o
  JOIN packs p ON p.id = o.pack_id
  JOIN cards c ON c.id = o.card_id
  LEFT JOIN seed_history sh ON sh.user_id = o.user_id AND sh.server_seed_hash = o.server_seed_hash`;

function opening(row: OpeningRow): Opening {
  return {
    id: row.id,
    batchId: row.batch_id,
    pack: { id: row.pack_id, name: row.pack_name },
    pricePence: row.price_pence,
    card: cardSummaryFromColumns(row),
    valuePence: row.value_pence,
    inventoryItemId: row.inventory_item_id,
    revisionId: row.revision_id,
    serverSeedHash: row.server_seed_hash,
    serverSeed: row.revealed_seed,
    clientSeed: row.client_seed,
    nonce: row.nonce,
    roll: row.roll,
    createdAt: row.created_at,
  };
}

function parseCursor(value: string | null): number | null {
  if (value === null || value === '') return null;
  if (!/^\d{1,15}$/.test(value)) return -1;
  return Number(value);
}

export function listOpenings(deps: Deps, userId: string, query: URLSearchParams): OpeningsResponse {
  const limit = queryInt(query, 'limit', 50, 1, 100);
  const before = parseCursor(query.get('before'));
  if (before === -1) return { openings: [], nextCursor: null };
  const rows = deps.db
    .prepare(`${OPENING_SELECT} WHERE o.user_id = ? AND (? IS NULL OR o.seq < ?) ORDER BY o.seq DESC LIMIT ?`)
    .all(userId, before, before, limit + 1) as unknown as OpeningRow[];
  const page = rows.slice(0, limit);
  return {
    openings: page.map(opening),
    nextCursor: rows.length > limit ? String(page[page.length - 1]!.seq) : null,
  };
}

export function getOpeningRow(db: Db, userId: string, openingId: string): OpeningRow | undefined {
  return db.prepare(`${OPENING_SELECT} WHERE o.user_id = ? AND o.id = ?`).get(userId, openingId) as OpeningRow | undefined;
}

export function verifyOpening(deps: Deps, userId: string, openingId: string): VerifyOpeningResponse {
  const row = getOpeningRow(deps.db, userId, openingId);
  if (!row) throw notFound('Opening');
  return { opening: opening(row), entries: revisionEntries(deps.db, row.revision_id) };
}
