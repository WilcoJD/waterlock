import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { sha256Hex, hmacSha256Hex, utf8Encode } from '../src/index.ts';

const samples = [
  '',
  'abc',
  'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
  'a'.repeat(55),
  'a'.repeat(56),
  'a'.repeat(63),
  'a'.repeat(64),
  'a'.repeat(65),
  'a'.repeat(1000),
  'Pokémon ✨ ピカチュウ 🃏 £',
  'lone \ud800 surrogate',
];

test('sha256 matches node:crypto for fixed samples', () => {
  for (const s of samples) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s));
  }
});

test('sha256 known vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('utf8Encode matches Buffer.from', () => {
  for (const s of samples) {
    assert.deepEqual(Buffer.from(utf8Encode(s)), Buffer.from(s, 'utf8'), JSON.stringify(s));
  }
});

test('sha256 and hmac match node:crypto for random inputs', () => {
  for (let i = 0; i < 300; i++) {
    const msg = randomBytes(i % 200).toString('base64');
    const key = randomBytes((i * 7) % 150).toString('hex'); // includes keys longer than the 64-byte block
    assert.equal(sha256Hex(msg), createHash('sha256').update(msg, 'utf8').digest('hex'));
    assert.equal(hmacSha256Hex(key, msg), createHmac('sha256', key).update(msg, 'utf8').digest('hex'));
  }
});
