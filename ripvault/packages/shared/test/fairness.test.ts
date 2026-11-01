import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, createHash } from 'node:crypto';
import {
  rollFromSeeds,
  pickIndex,
  canonicalEntries,
  drawCard,
  verifyPull,
  hashServerSeed,
  validateEntries,
  isValidClientSeed,
} from '../src/index.ts';

test('roll is deterministic, in [0,1), and matches an independent node:crypto derivation', () => {
  for (let nonce = 0; nonce < 200; nonce++) {
    const server = randomBytes(32).toString('hex');
    const client = 'player-seed';
    const roll = rollFromSeeds(server, client, nonce);
    assert.ok(roll >= 0 && roll < 1);
    assert.equal(roll, rollFromSeeds(server, client, nonce));
    const digest = createHmac('sha256', server).update(`${client}:${nonce}:0`).digest('hex');
    assert.equal(roll, parseInt(digest.slice(0, 13), 16) / 2 ** 52);
  }
});

test('different nonces and cursors give different rolls', () => {
  const s = 'a'.repeat(64);
  assert.notEqual(rollFromSeeds(s, 'c', 0), rollFromSeeds(s, 'c', 1));
  assert.notEqual(rollFromSeeds(s, 'c', 0, 0), rollFromSeeds(s, 'c', 0, 1));
});

test('rollFromSeeds rejects bad nonces', () => {
  assert.throws(() => rollFromSeeds('s', 'c', -1));
  assert.throws(() => rollFromSeeds('s', 'c', 1.5));
});

test('pickIndex maps roll ranges onto weights exactly', () => {
  const entries = [
    { cardId: 'a', weight: 1 },
    { cardId: 'b', weight: 2 },
    { cardId: 'c', weight: 7 },
  ];
  // total 10: [0,0.1) -> a, [0.1,0.3) -> b, [0.3,1) -> c
  assert.equal(pickIndex(entries, 0), 0);
  assert.equal(pickIndex(entries, 0.0999999), 0);
  assert.equal(pickIndex(entries, 0.1), 1);
  assert.equal(pickIndex(entries, 0.2999999), 1);
  assert.equal(pickIndex(entries, 0.3), 2);
  assert.equal(pickIndex(entries, 0.9999999999), 2);
  assert.throws(() => pickIndex(entries, 1));
  assert.throws(() => pickIndex(entries, -0.1));
});

test('canonicalEntries sorts by cardId code units and does not mutate input', () => {
  const input = [
    { cardId: 'swsh7-215', weight: 1 },
    { cardId: 'base1-4', weight: 1 },
    { cardId: 'Base1-4', weight: 1 },
  ];
  const copy = structuredClone(input);
  assert.deepEqual(canonicalEntries(input).map((e) => e.cardId), ['Base1-4', 'base1-4', 'swsh7-215']);
  assert.deepEqual(input, copy);
});

test('draw distribution follows weights', () => {
  const entries = [
    { cardId: 'common', weight: 900 },
    { cardId: 'rare', weight: 99 },
    { cardId: 'chase', weight: 1 },
  ];
  const server = 'f'.repeat(64);
  const counts: Record<string, number> = { common: 0, rare: 0, chase: 0 };
  const N = 50_000;
  for (let n = 0; n < N; n++) counts[drawCard(entries, server, 'dist', n).cardId]!++;
  assert.ok(Math.abs(counts.common! / N - 0.9) < 0.01, `common ${counts.common}`);
  assert.ok(Math.abs(counts.rare! / N - 0.099) < 0.01, `rare ${counts.rare}`);
  assert.ok(counts.chase! > 10 && counts.chase! < 120, `chase ${counts.chase}`);
});

test('verifyPull confirms honest results and catches tampering', () => {
  const serverSeed = randomBytes(32).toString('hex');
  const serverSeedHash = createHash('sha256').update(serverSeed).digest('hex');
  assert.equal(hashServerSeed(serverSeed), serverSeedHash);
  const entries = [
    { cardId: 'x', weight: 5 },
    { cardId: 'y', weight: 5 },
  ];
  const { cardId } = drawCard(entries, serverSeed, 'me', 3);
  const ok = verifyPull({ serverSeed, serverSeedHash, clientSeed: 'me', nonce: 3, entries, claimedCardId: cardId });
  assert.equal(ok.valid, true);
  const wrongCard = verifyPull({
    serverSeed,
    serverSeedHash,
    clientSeed: 'me',
    nonce: 3,
    entries,
    claimedCardId: cardId === 'x' ? 'y' : 'x',
  });
  assert.equal(wrongCard.valid, false);
  const wrongSeed = verifyPull({
    serverSeed: 'b'.repeat(64),
    serverSeedHash,
    clientSeed: 'me',
    nonce: 3,
    entries,
    claimedCardId: cardId,
  });
  assert.equal(wrongSeed.hashMatches, false);
  assert.equal(wrongSeed.valid, false);
});

test('validateEntries and client seed rules', () => {
  assert.throws(() => validateEntries([]));
  assert.throws(() => validateEntries([{ cardId: 'a', weight: 0 }]));
  assert.throws(() => validateEntries([{ cardId: 'a', weight: 1.5 }]));
  assert.throws(() => validateEntries([{ cardId: 'a', weight: 1 }, { cardId: 'a', weight: 2 }]));
  validateEntries([{ cardId: 'a', weight: 1 }]);
  assert.equal(isValidClientSeed('my-lucky_seed42'), true);
  assert.equal(isValidClientSeed(''), false);
  assert.equal(isValidClientSeed('has space'), false);
  assert.equal(isValidClientSeed('x'.repeat(65)), false);
});
