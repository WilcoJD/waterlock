import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPence,
  parsePounds,
  applyBps,
  buybackPence,
  convertToPence,
  packStats,
  tierForValue,
  pullOutcome,
  formatChance,
  formatOneIn,
  shippingFeePence,
  canTransitionShipment,
} from '../src/index.ts';

test('formatPence', () => {
  assert.equal(formatPence(0), '£0.00');
  assert.equal(formatPence(7), '£0.07');
  assert.equal(formatPence(253), '£2.53');
  assert.equal(formatPence(746436), '£7,464.36');
  assert.equal(formatPence(123456789), '£1,234,567.89');
  assert.equal(formatPence(-250), '-£2.50');
  assert.equal(formatPence(250, { signed: true }), '+£2.50');
  assert.equal(formatPence(0, { signed: true }), '£0.00');
  assert.equal(formatPence(2500, { trimWholePounds: true }), '£25');
  assert.equal(formatPence(2550, { trimWholePounds: true }), '£25.50');
});

test('parsePounds', () => {
  assert.equal(parsePounds('12'), 1200);
  assert.equal(parsePounds('12.5'), 1250);
  assert.equal(parsePounds('£12.50'), 1250);
  assert.equal(parsePounds(' 1,000.01 '), 100001);
  assert.equal(parsePounds('0.07'), 7);
  assert.equal(parsePounds('12.345'), null);
  assert.equal(parsePounds('-5'), null);
  assert.equal(parsePounds('abc'), null);
  assert.equal(parsePounds(''), null);
});

test('buyback rounds down at 90%', () => {
  assert.equal(buybackPence(1000, 9000), 900);
  assert.equal(buybackPence(78, 9000), 70); // 70.2 -> 70
  assert.equal(buybackPence(1, 9000), 0);
  assert.equal(applyBps(1493, 9000), 1343);
  assert.throws(() => applyBps(1.5, 9000));
  assert.throws(() => applyBps(100, -1));
});

test('convertToPence', () => {
  assert.equal(convertToPence(10, 0.79), 790);
  assert.equal(convertToPence(0.1, 0.86), 9);
  assert.throws(() => convertToPence(-1, 1));
  assert.throws(() => convertToPence(1, 0));
});

test('packStats', () => {
  const s = packStats(
    [
      { weight: 90, valuePence: 10 },
      { weight: 9, valuePence: 500 },
      { weight: 1, valuePence: 5000 },
    ],
    100,
  );
  assert.equal(s.totalWeight, 100);
  assert.equal(s.evPence, Math.floor((900 + 4500 + 5000) / 100));
  assert.equal(s.minPence, 10);
  assert.equal(s.maxPence, 5000);
  assert.equal(s.hitChance, 0.1);
  assert.equal(s.rtp, 1.04);
  const empty = packStats([]);
  assert.equal(empty.evPence, 0);
  assert.equal(empty.rtp, null);
});

test('tiers and outcomes', () => {
  assert.equal(tierForValue(0), 'common');
  assert.equal(tierForValue(99), 'common');
  assert.equal(tierForValue(100), 'uncommon');
  assert.equal(tierForValue(500), 'rare');
  assert.equal(tierForValue(2500), 'epic');
  assert.equal(tierForValue(10000), 'legendary');
  assert.equal(pullOutcome(50, 100), 'loss');
  assert.equal(pullOutcome(100, 100), 'win');
  assert.equal(pullOutcome(300, 100), 'big_win');
});

test('chance formatting', () => {
  assert.equal(formatChance(0.125), '12.5%');
  assert.equal(formatChance(0.5), '50%');
  assert.equal(formatChance(0.0123), '1.23%');
  assert.equal(formatChance(0.0004), '0.04%');
  assert.equal(formatChance(0.00001), '<0.01%');
  assert.equal(formatChance(0), '0%');
  assert.equal(formatOneIn(0.0005), '1 in 2,000');
  assert.equal(formatOneIn(0), '—');
});

test('shipping fee and transitions', () => {
  const cfg = { flatFeePence: 399, freeOverPence: 5000 };
  assert.equal(shippingFeePence(4999, cfg), 399);
  assert.equal(shippingFeePence(5000, cfg), 0);
  assert.equal(shippingFeePence(999999, { flatFeePence: 399, freeOverPence: null }), 399);
  assert.equal(canTransitionShipment('requested', 'processing'), true);
  assert.equal(canTransitionShipment('requested', 'shipped'), false);
  assert.equal(canTransitionShipment('delivered', 'cancelled'), false);
});
