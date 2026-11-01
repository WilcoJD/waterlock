/**
 * Idempotency-Key support for money-moving POSTs.
 *
 * The first successful (2xx) response for a (user, key) pair is stored for 24h and replayed
 * byte-for-byte for repeats of the same request. Error responses are not stored: every failure
 * path rolls back completely, so re-running a failed request is always safe. Using a key on a
 * different route (or with a different body) is a 409 conflict.
 */
import { createHash } from 'node:crypto';
import { tx } from '../db.ts';
import type { Deps } from '../deps.ts';
import { conflict, validationFailed } from '../errors.ts';
import type { HandlerResult, RequestContext } from '../http/router.ts';

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
/** An async request that has held its key longer than this is assumed dead and may be retried. */
const IN_PROGRESS_STALE_MS = 2 * 60 * 1000;

interface StoredKey {
  request_method: string;
  request_path: string;
  request_hash: string;
  status_code: number | null;
  response_body: string | null;
  created_at: string;
}

export function readIdempotencyKey(ctx: RequestContext): string | null {
  const raw = ctx.headers['idempotency-key'];
  if (raw === undefined) return null;
  const value = (Array.isArray(raw) ? raw[0] ?? '' : raw).trim();
  if (value.length < 1 || value.length > 100 || !/^[\x21-\x7e]+$/.test(value)) {
    throw validationFailed({ 'Idempotency-Key': 'Idempotency-Key must be 1-100 printable characters' });
  }
  return value;
}

function requestHash(ctx: RequestContext): string {
  return createHash('sha256').update(`${ctx.method} ${ctx.path}\n`).update(ctx.rawBody).digest('hex');
}

/** Look up a live key; returns a replay result, throws conflict, or returns null when unused. */
function lookup(deps: Deps, ctx: RequestContext, userId: string, key: string, hash: string): HandlerResult | null {
  const now = deps.now().getTime();
  const row = deps.db
    .prepare(
      `SELECT request_method, request_path, request_hash, status_code, response_body, created_at
       FROM idempotency_keys WHERE user_id = ? AND key = ?`,
    )
    .get(userId, key) as StoredKey | undefined;
  if (!row) return null;
  const age = now - Date.parse(row.created_at);
  const expired = age >= IDEMPOTENCY_RETENTION_MS;
  const abandoned = row.status_code === null && age >= IN_PROGRESS_STALE_MS;
  if (expired || abandoned) {
    deps.db.prepare('DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?').run(userId, key);
    return null;
  }
  if (row.request_method !== ctx.method || row.request_path !== ctx.path) {
    throw conflict('This Idempotency-Key was already used for a different request');
  }
  if (row.request_hash !== hash) {
    throw conflict('This Idempotency-Key was already used with a different request body');
  }
  if (row.status_code === null || row.response_body === null) {
    throw conflict('A request with this Idempotency-Key is still being processed');
  }
  return { status: row.status_code, json: row.response_body, headers: { 'Idempotent-Replayed': 'true' } };
}

function serialise(result: HandlerResult): string {
  return result.json ?? JSON.stringify(result.body ?? null);
}

function purgeExpired(deps: Deps): void {
  const cutoff = new Date(deps.now().getTime() - IDEMPOTENCY_RETENTION_MS).toISOString();
  deps.db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);
}

/** Run a synchronous handler and record its response in the same transaction. */
export function runIdempotentSync(deps: Deps, ctx: RequestContext, userId: string, key: string, handler: () => HandlerResult): HandlerResult {
  const hash = requestHash(ctx);
  return tx(deps.db, () => {
    const replay = lookup(deps, ctx, userId, key, hash);
    if (replay) return replay;
    const result = handler();
    if (result.status >= 200 && result.status < 300) {
      const json = serialise(result);
      purgeExpired(deps);
      deps.db
        .prepare(
          `INSERT INTO idempotency_keys (user_id, key, request_method, request_path, request_hash, status_code, response_body, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, key, ctx.method, ctx.path, hash, result.status, json, deps.now().toISOString());
      return { status: result.status, json, ...(result.headers ? { headers: result.headers } : {}) };
    }
    return result;
  });
}

/** Run a handler that awaits (e.g. a payment provider call): reserve the key first, then fill it in. */
export async function runIdempotentAsync(
  deps: Deps,
  ctx: RequestContext,
  userId: string,
  key: string,
  handler: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const hash = requestHash(ctx);
  const replay = tx(deps.db, () => {
    const existing = lookup(deps, ctx, userId, key, hash);
    if (existing) return existing;
    purgeExpired(deps);
    deps.db
      .prepare(
        `INSERT INTO idempotency_keys (user_id, key, request_method, request_path, request_hash, status_code, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .run(userId, key, ctx.method, ctx.path, hash, deps.now().toISOString());
    return null;
  });
  if (replay) return replay;

  const release = () => {
    deps.db.prepare('DELETE FROM idempotency_keys WHERE user_id = ? AND key = ? AND status_code IS NULL').run(userId, key);
  };
  let result: HandlerResult;
  try {
    result = await handler();
  } catch (err) {
    release();
    throw err;
  }
  if (result.status >= 200 && result.status < 300) {
    const json = serialise(result);
    deps.db
      .prepare('UPDATE idempotency_keys SET status_code = ?, response_body = ? WHERE user_id = ? AND key = ?')
      .run(result.status, json, userId, key);
    return { status: result.status, json, ...(result.headers ? { headers: result.headers } : {}) };
  }
  release();
  return result;
}
