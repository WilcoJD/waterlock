/**
 * On-device verification of pack openings, built on the shared provably-fair code (the exact
 * functions the API uses to draw cards). Pure: no React / native imports.
 */
import { canonicalEntries, hashServerSeed, pickIndex, rollFromSeeds, verifyPull } from '@ripvault/shared';
import type { Opening, WeightedEntry } from '@ripvault/shared';

/** Rolls are 52-bit fractions sent as JSON doubles; allow for any float noise in storage. */
const ROLL_EPSILON = 1e-12;

export function sameRoll(a: number, b: number): boolean {
  return Math.abs(a - b) <= ROLL_EPSILON;
}

/** Where a roll landed in a pack's odds table. Tickets are 0 .. totalWeight - 1. */
export interface OddsRange {
  /** Position in the canonical (card id sorted) odds table. */
  index: number;
  cardId: string;
  weight: number;
  /** First ticket owned by this card (inclusive). */
  start: number;
  /** Last ticket owned by this card (inclusive). */
  end: number;
  totalWeight: number;
  /** floor(roll x totalWeight): the ticket the roll picked. */
  ticket: number;
  /** weight / totalWeight. */
  chance: number;
  /** Number of cards in the odds table. */
  entryCount: number;
}

/** Map a roll onto the odds table exactly like drawCard() does. Throws on an invalid table/roll. */
export function oddsRangeFor(entries: readonly WeightedEntry[], roll: number): OddsRange {
  const sorted = canonicalEntries(entries);
  const index = pickIndex(sorted, roll);
  let start = 0;
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i]!.weight;
    if (i < index) start += w;
    total += w;
  }
  const entry = sorted[index]!;
  return {
    index,
    cardId: entry.cardId,
    weight: entry.weight,
    start,
    end: start + entry.weight - 1,
    totalWeight: total,
    ticket: Math.floor(roll * total),
    chance: total > 0 ? entry.weight / total : 0,
    entryCount: sorted.length,
  };
}

export interface LocalVerification {
  status: 'verified' | 'mismatch';
  /** sha256(revealed server seed) equals the hash shown before the pack was opened. */
  hashMatches: boolean;
  /** The recomputed roll equals the roll the server recorded. */
  rollMatches: boolean;
  /** The recomputed card equals the card the player received. */
  cardMatches: boolean;
  /** Recomputed roll and card. */
  roll: number;
  cardId: string;
  range: OddsRange;
}

export type VerifyOutcome =
  | { status: 'pending' }
  | LocalVerification
  | { status: 'error'; message: string };

type OpeningInputs = Pick<Opening, 'serverSeed' | 'serverSeedHash' | 'clientSeed' | 'nonce' | 'roll'> & {
  card: { id: string };
};

/**
 * Full check for one opening: hash commitment, roll and card. 'pending' until the server seed has
 * been revealed (the player rotates their seeds).
 */
export function verifyOpeningLocally(opening: OpeningInputs, entries: readonly WeightedEntry[]): VerifyOutcome {
  if (!opening.serverSeed) return { status: 'pending' };
  try {
    const result = verifyPull({
      serverSeed: opening.serverSeed,
      serverSeedHash: opening.serverSeedHash,
      clientSeed: opening.clientSeed,
      nonce: opening.nonce,
      entries,
      claimedCardId: opening.card.id,
    });
    const range = oddsRangeFor(entries, result.roll);
    const rollMatches = sameRoll(result.roll, opening.roll);
    const cardMatches = result.cardId === opening.card.id;
    return {
      status: result.hashMatches && rollMatches && cardMatches ? 'verified' : 'mismatch',
      hashMatches: result.hashMatches,
      rollMatches,
      cardMatches,
      roll: result.roll,
      cardId: result.cardId,
      range,
    };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'This opening could not be recomputed.' };
  }
}

export type QuickStatus = 'pending' | 'verified' | 'mismatch';

/**
 * Cheap check for list rows: the revealed seed matches its hash and reproduces the recorded roll.
 * (Mapping the roll to a card needs the odds table; the verify screen does the full check.)
 */
export function quickCheck(opening: Omit<OpeningInputs, 'card'>): QuickStatus {
  if (!opening.serverSeed) return 'pending';
  try {
    const hashOk = hashServerSeed(opening.serverSeed) === opening.serverSeedHash.toLowerCase();
    const rollOk = sameRoll(rollFromSeeds(opening.serverSeed, opening.clientSeed, opening.nonce), opening.roll);
    return hashOk && rollOk ? 'verified' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

/**
 * Openings that used the same server seed share it once revealed. Fill `serverSeed` from any loaded
 * opening with the same hash, so rows loaded before a rotation do not stay "pending".
 */
export function withRevealedSeeds<T extends Pick<Opening, 'serverSeed' | 'serverSeedHash'>>(openings: readonly T[]): T[] {
  const seeds = new Map<string, string>();
  for (const o of openings) if (o.serverSeed) seeds.set(o.serverSeedHash, o.serverSeed);
  if (seeds.size === 0) return [...openings];
  return openings.map((o) => {
    if (o.serverSeed) return o;
    const seed = seeds.get(o.serverSeedHash);
    return seed ? { ...o, serverSeed: seed } : o;
  });
}

/** A random client seed in the server's default format (16 lowercase hex characters). */
export function clientSeedFromUuid(uuid: string): string {
  const hex = uuid.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hex.slice(0, 16).padEnd(16, '0');
}
