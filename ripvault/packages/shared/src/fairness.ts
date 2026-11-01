/**
 * Provably fair pack results.
 *
 * Every player has:
 *   - a secret server seed (random 32 bytes, hex). Only its SHA-256 hash is shown
 *     before they open anything, so the server is committed to it.
 *   - the hash of the NEXT server seed, also published in advance. Rotating promotes that seed, so
 *     the seed paired with a newly chosen client seed was committed before the player chose it.
 *   - a client seed they can change at any time (by rotating).
 *   - a nonce that goes up by one for every pack they open.
 *
 * roll = first 52 bits of HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${cursor}`) / 2^52
 *
 * The roll (a number in [0, 1)) picks a card from the pack's odds table, sorted
 * by cardId. When the player rotates their seed, the old server seed is revealed
 * and every past result can be recomputed with `verifyPull`.
 */
import { hmacSha256Hex, sha256Hex } from './sha256.ts';

/** Server seeds are 32 random bytes encoded as 64 lowercase hex characters. */
export const SERVER_SEED_HEX_LENGTH = 64;
export const CLIENT_SEED_MIN_LENGTH = 1;
export const CLIENT_SEED_MAX_LENGTH = 64;
/** Allowed characters for a client seed (kept simple so it is easy to type and copy). */
export const CLIENT_SEED_PATTERN = /^[A-Za-z0-9_\-]{1,64}$/;

const TWO_POW_52 = 2 ** 52;

export function hashServerSeed(serverSeed: string): string {
  return sha256Hex(serverSeed);
}

export function isValidClientSeed(seed: string): boolean {
  return CLIENT_SEED_PATTERN.test(seed);
}

/** Deterministic roll in [0, 1). `cursor` lets one nonce produce several rolls if a pack ever holds more than one card. */
export function rollFromSeeds(serverSeed: string, clientSeed: string, nonce: number, cursor = 0): number {
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new RangeError('nonce must be a non-negative integer');
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new RangeError('cursor must be a non-negative integer');
  const digest = hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${cursor}`);
  // 13 hex characters = 52 bits, exactly representable as a double.
  return parseInt(digest.slice(0, 13), 16) / TWO_POW_52;
}

export interface WeightedEntry {
  cardId: string;
  /** Positive integer weight. Chance = weight / sum(weights). */
  weight: number;
}

/** Sort entries the one canonical way (by cardId, plain code-unit order) so server and client agree. */
export function canonicalEntries<T extends WeightedEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
}

export function validateEntries(entries: readonly WeightedEntry[]): void {
  if (entries.length === 0) throw new Error('A pack needs at least one card');
  const seen = new Set<string>();
  for (const e of entries) {
    if (!Number.isSafeInteger(e.weight) || e.weight <= 0) {
      throw new Error(`Weight for ${e.cardId} must be a positive integer`);
    }
    if (seen.has(e.cardId)) throw new Error(`Duplicate card ${e.cardId} in pack`);
    seen.add(e.cardId);
  }
}

/**
 * Map a roll in [0, 1) onto canonically sorted entries.
 * Returns the index into `canonicalEntries(entries)`.
 */
export function pickIndex(sortedEntries: readonly WeightedEntry[], roll: number): number {
  if (!(roll >= 0 && roll < 1)) throw new RangeError('roll must be in [0, 1)');
  let total = 0;
  for (const e of sortedEntries) total += e.weight;
  if (total <= 0 || !Number.isSafeInteger(total)) throw new Error('Invalid total weight');
  let target = Math.floor(roll * total); // 0 .. total - 1
  for (let i = 0; i < sortedEntries.length; i++) {
    const w = sortedEntries[i]!.weight;
    if (target < w) return i;
    target -= w;
  }
  return sortedEntries.length - 1;
}

/** Convenience: roll + pick in one go. Entries may be in any order; they are sorted canonically first. */
export function drawCard(
  entries: readonly WeightedEntry[],
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor = 0,
): { cardId: string; roll: number } {
  const sorted = canonicalEntries(entries);
  const roll = rollFromSeeds(serverSeed, clientSeed, nonce, cursor);
  const entry = sorted[pickIndex(sorted, roll)]!;
  return { cardId: entry.cardId, roll };
}

export interface VerifyPullInput {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  cursor?: number;
  entries: readonly WeightedEntry[];
  /** The card the server says was pulled. */
  claimedCardId: string;
}

export interface VerifyPullResult {
  /** sha256(serverSeed) equals the hash that was shown before opening. */
  hashMatches: boolean;
  roll: number;
  cardId: string;
  /** hashMatches and the recomputed card equals the claimed card. */
  valid: boolean;
}

export function verifyPull(input: VerifyPullInput): VerifyPullResult {
  const hashMatches = hashServerSeed(input.serverSeed) === input.serverSeedHash.toLowerCase();
  const { cardId, roll } = drawCard(input.entries, input.serverSeed, input.clientSeed, input.nonce, input.cursor ?? 0);
  return { hashMatches, roll, cardId, valid: hashMatches && cardId === input.claimedCardId };
}
