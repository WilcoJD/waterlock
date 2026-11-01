'use strict';
/**
 * Fixed-point amounts. Every wallet asset is stored as an integer number of
 * "units" where 1 whole coin = 1e8 units (like satoshis). All arithmetic on
 * products uses BigInt so nothing overflows or loses precision.
 */
const SCALE = 100000000;
const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });
const BSCALE = 100000000n;

function toUnits(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw bad('Invalid amount');
    v = v.toFixed(8);
  }
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw bad(`Invalid amount: ${v}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  if (f.length > 8 && /[1-9]/.test(f.slice(8))) throw bad('Too many decimal places (max 8)');
  const n = BigInt(i) * BSCALE + BigInt((f + '00000000').slice(0, 8));
  const out = Number(neg ? -n : n);
  if (!Number.isSafeInteger(out)) throw bad('Amount too large');
  return out;
}

function fromUnits(n) {
  const neg = n < 0;
  const a = BigInt(Math.abs(n));
  const i = a / BSCALE;
  const f = (a % BSCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + i.toString() + (f ? '.' + f : '');
}

/** price (quote units per 1 whole base) * qty (base units) / baseScale, rounded. */
function mulDiv(a, b, div, roundUp = false) {
  const p = BigInt(a) * BigInt(b);
  const d = BigInt(div);
  let q = p / d;
  if (roundUp && p % d !== 0n) q += 1n;
  return Number(q);
}

module.exports = { SCALE, toUnits, fromUnits, mulDiv };
