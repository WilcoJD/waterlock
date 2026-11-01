import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PriceSyncReport } from '@ripvault/shared';
import { batchUrl, priceInPence } from '../src/prices/pokemontcg.ts';
import { syncPrices } from '../src/prices/sync.ts';
import { startApp } from './helpers.ts';

type ApiPrices = Record<string, { cardmarket?: unknown; tcgplayer?: unknown }>;

function fakePokemonTcg(prices: ApiPrices, calls: string[], opts: { failFirst?: number } = {}) {
  let failures = opts.failFirst ?? 0;
  return async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>)['X-Api-Key'], 'test-key');
    if (failures > 0) {
      failures--;
      return new Response('busy', { status: 503 });
    }
    const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
    const ids = [...q.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]!);
    const data = ids.filter((id) => id in prices).map((id) => ({ id, ...prices[id] }));
    return new Response(JSON.stringify({ data, page: 1, pageSize: 250, count: data.length }), { status: 200 });
  };
}

test('price sync updates cardmarket prices, reports missing/unpriced cards, and deactivates packs over max RTP', async () => {
  const calls: string[] = [];
  const prices: ApiPrices = {
    'tst-1': { cardmarket: { prices: { trendPrice: 0.5, averageSellPrice: 0.4 } } }, // 0.5 * 0.86 = 0.43 -> 43p
    'tst-2': { cardmarket: { prices: { trendPrice: null, averageSellPrice: 0.7 } } }, // fallback 0.602 -> 60p (unchanged)
    'tst-3': { cardmarket: { prices: { trendPrice: 2 } } }, // 172p
    // tst-4 (Charizard, 900p) spikes to 30 EUR = 2580p: premium EV becomes (2580*800 + 4000*180 + 15000*20)/1000 = 3084 > 95% of 2000
    'tst-4': { cardmarket: { prices: { trendPrice: 30 } } },
    'tst-5': { cardmarket: { prices: {} } }, // no usable price
    'tst-6': { cardmarket: { prices: { trendPrice: 174.42 } } }, // 15000p (unchanged)
    'tst-7': { cardmarket: { prices: { trendPrice: 5.23 } } }, // 449.78 -> 450 (unchanged)
    'tst-8': { cardmarket: { prices: { trendPrice: 1.16 } } }, // 99.76 -> 100 (unchanged)
    // tst-9 missing from the API response
  };
  const app = await startApp({ config: { pokemontcgApiKey: 'test-key' }, fetch: fakePokemonTcg(prices, calls) });
  try {
    const report: PriceSyncReport = await syncPrices(app.deps, { retryDelayMs: 0 });
    assert.equal(report.source, 'cardmarket');
    assert.equal(report.updated, 3);
    assert.equal(report.unchanged, 4);
    assert.deepEqual(report.missing, ['tst-9']);
    assert.deepEqual(report.errors, ['tst-5: no cardmarket price available']);
    assert.deepEqual(report.deactivatedPacks, ['premium']);
    assert.equal(report.finishedAt, app.clock.now().toISOString());
    assert.equal(calls.length, 1); // 9 cards fit one batch of 40
    assert.match(calls[0]!, /^https:\/\/api\.pokemontcg\.io\/v2\/cards\?q=/);
    assert.match(calls[0]!, /select=id,tcgplayer,cardmarket&pageSize=250/);

    const value = (id: string) => (app.db.prepare('SELECT market_value_pence AS v, price_source AS s FROM cards WHERE id = ?').get(id) as { v: number; s: string });
    assert.deepEqual({ ...value('tst-1') }, { v: 43, s: 'cardmarket' });
    assert.equal(value('tst-3').v, 172);
    assert.equal(value('tst-4').v, 2580);
    assert.deepEqual({ ...value('tst-5') }, { v: 4000, s: 'seed' });
    const packs = await app.request('GET', '/packs');
    assert.equal(packs.body.some((p: { id: string }) => p.id === 'premium'), false);
    const u = app.user({ balancePence: 10_000 });
    assert.equal((await app.request('POST', '/packs/premium/open', { token: u.token, body: { quantity: 1 } })).body.error.code, 'pack_unavailable');

    // Admin can't re-activate it while it is over max RTP.
    const admin = app.admin();
    const reactivate = await app.request('PUT', '/admin/packs/premium/active', { token: admin.token, body: { active: true } });
    assert.equal(reactivate.status, 409);
  } finally {
    await app.close();
  }
});

test('tcgplayer source uses the highest market price across variants, in USD', async () => {
  const calls: string[] = [];
  const app = await startApp({
    config: { pokemontcgApiKey: 'test-key', priceSource: 'tcgplayer' },
    fetch: fakePokemonTcg(
      {
        'tst-1': { tcgplayer: { prices: { normal: { market: 0.25 }, reverseHolofoil: { market: 1.1 } } } }, // 1.1 * 0.79 = 86.9 -> 87p
        'tst-2': { tcgplayer: { prices: { holofoil: { market: null, low: 3 } } } },
      },
      calls,
    ),
  });
  try {
    const report = await syncPrices(app.deps, { retryDelayMs: 0 });
    assert.equal(report.source, 'tcgplayer');
    assert.equal(report.updated, 1);
    assert.equal((app.db.prepare("SELECT market_value_pence AS v FROM cards WHERE id = 'tst-1'").get() as { v: number }).v, 87);
    assert.deepEqual(report.errors, ['tst-2: no tcgplayer price available']);
    assert.equal(report.missing.length, 7);
  } finally {
    await app.close();
  }
});

test('failed batches are retried, then reported as errors without stopping the sync', async () => {
  const calls: string[] = [];
  const app = await startApp({
    config: { pokemontcgApiKey: 'test-key' },
    fetch: fakePokemonTcg({ 'tst-1': { cardmarket: { prices: { trendPrice: 1 } } } }, calls, { failFirst: 3 }),
  });
  try {
    const failed = await syncPrices(app.deps, { retryDelayMs: 0, attempts: 3 });
    assert.equal(calls.length, 3);
    assert.equal(failed.errors.length, 1);
    assert.match(failed.errors[0]!, /HTTP 503/);
    assert.equal(failed.updated, 0);
    assert.deepEqual(failed.missing, []);
    const ok = await syncPrices(app.deps, { retryDelayMs: 0 });
    assert.equal(ok.updated, 1);
  } finally {
    await app.close();
  }
});

test('POST /admin/prices/sync runs the sync for admins only', async () => {
  const calls: string[] = [];
  const app = await startApp({ config: { pokemontcgApiKey: 'test-key' }, fetch: fakePokemonTcg({}, calls) });
  try {
    const u = app.user();
    assert.equal((await app.request('POST', '/admin/prices/sync', { token: u.token })).status, 403);
    const admin = app.admin();
    const res = await app.request('POST', '/admin/prices/sync', { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.missing.length, 9);
    assert.deepEqual(Object.keys(res.body).sort(), ['deactivatedPacks', 'errors', 'finishedAt', 'missing', 'source', 'unchanged', 'updated']);
  } finally {
    await app.close();
  }
});

test('batch URLs and price extraction', () => {
  const url = batchUrl(['sv3pt5-199', 'base1-4']);
  const q = new URL(url).searchParams.get('q');
  assert.equal(q, 'id:"sv3pt5-199" OR id:"base1-4"');
  assert.equal(priceInPence({ id: 'x', cardmarket: { prices: { trendPrice: 10 } } }, 'cardmarket', { eurGbp: 0.86, usdGbp: 0.79 }), 860);
  assert.equal(priceInPence({ id: 'x' }, 'cardmarket', { eurGbp: 0.86, usdGbp: 0.79 }), null);
  assert.equal(priceInPence({ id: 'x', tcgplayer: null }, 'tcgplayer', { eurGbp: 0.86, usdGbp: 0.79 }), null);
  // Vintage stock is Unlimited print: 1st Edition variants are ignored.
  const vintage = { id: 'base1-4', tcgplayer: { prices: { '1stEditionHolofoil': { market: 9000 }, unlimitedHolofoil: { market: 400 } } } };
  assert.equal(priceInPence(vintage, 'tcgplayer', { eurGbp: 0.86, usdGbp: 0.79 }), 31_600);
  const onlyFirst = { id: 'neo1-9', tcgplayer: { prices: { '1stEditionHolofoil': { market: 500 } } } };
  assert.equal(priceInPence(onlyFirst, 'tcgplayer', { eurGbp: 0.86, usdGbp: 0.79 }), null);
});
