/**
 * Regression tests for reviewed defects (provably-fair commitment, exact RTP cap, price-sync window,
 * sold_out roll leak, admin seeding, X-Forwarded-For, pack re-activation, idempotent cancel).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashServerSeed } from '@ripvault/shared';
import type { Address, CreateShipmentResponse, FairnessState, OpenPackResponse, RotateSeedResponse, SeedCard, SeedPack } from '@ripvault/shared';
import { loadConfig } from '../src/config.ts';
import { MIGRATIONS, migrate } from '../src/db.ts';
import { syncPrices, deactivateOverRtpPacks } from '../src/prices/sync.ts';
import { getPackEntriesWithValues } from '../src/services/packs.ts';
import { exceedsMaxRtp } from '../src/services/admin.ts';
import { seedDatabase } from '../src/seed/seed.ts';
import { count, fixtureSeed, startApp } from './helpers.ts';

const img = (id: string) => ({ imageSmall: `https://images.example.test/${id}.png`, imageLarge: `https://images.example.test/${id}_hires.png` });
const card = (id: string, value: number, stock: number | null = null): SeedCard => ({
  id,
  name: id,
  setId: 'tst',
  setName: 'Test Set',
  number: id,
  rarity: 'Common',
  ...img(id),
  marketValuePence: value,
  stock,
});
const theme = { from: '#1d4ed8', to: '#0f172a', accent: '#f59e0b' };
const pack = (id: string, pricePence: number, entries: SeedPack['entries']): SeedPack => ({
  id,
  name: id,
  tagline: id,
  pricePence,
  sortOrder: 10,
  theme,
  entries,
});

// ---------------------------------------------------------------------------
// money-1 / security-4: the next server seed is committed before the player picks a client seed
// ---------------------------------------------------------------------------

test('fairness: rotate promotes the pre-committed next server seed (hash published before the client seed is chosen)', async () => {
  const app = await startApp();
  try {
    const u = app.user();
    const before = (await app.request<FairnessState>('GET', '/fairness', { token: u.token })).body;
    assert.match(before.nextServerSeedHash ?? '', /^[0-9a-f]{64}$/);
    assert.notEqual(before.nextServerSeedHash, before.serverSeedHash);

    // The unrevealed next seed never leaves the server either.
    const nextSeed = (app.db.prepare('SELECT next_server_seed AS s FROM users WHERE id = ?').get(u.id) as { s: string }).s;
    assert.equal(hashServerSeed(nextSeed), before.nextServerSeedHash);
    for (const path of ['/fairness', '/me', '/openings']) {
      assert.equal((await app.request('GET', path, { token: u.token })).text.includes(nextSeed), false, `${path} leaked the next seed`);
    }

    const rotated = await app.request<RotateSeedResponse>('POST', '/fairness/rotate', { token: u.token, body: { clientSeed: 'player-chosen' } });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.body.revealed.serverSeedHash, before.serverSeedHash);
    // The seed now paired with the player's client seed is the one committed before they chose it.
    assert.equal(rotated.body.current.serverSeedHash, before.nextServerSeedHash);
    assert.equal(rotated.body.current.clientSeed, 'player-chosen');
    assert.equal(rotated.body.current.nonce, 0);
    assert.match(rotated.body.current.nextServerSeedHash ?? '', /^[0-9a-f]{64}$/);
    assert.notEqual(rotated.body.current.nextServerSeedHash, before.nextServerSeedHash);
    assert.notEqual(rotated.body.current.nextServerSeedHash, rotated.body.current.serverSeedHash);

    // Rotating again reveals exactly the promoted seed.
    const again = await app.request<RotateSeedResponse>('POST', '/fairness/rotate', { token: u.token, body: {} });
    assert.equal(again.body.revealed.serverSeed, nextSeed);
    assert.equal(again.body.current.serverSeedHash, rotated.body.current.nextServerSeedHash);
  } finally {
    await app.close();
  }
});

test('fairness: migrating an existing database gives every user a committed next server seed', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const step = MIGRATIONS[0]!;
    db.exec('BEGIN');
    if (typeof step === 'string') db.exec(step);
    else step(db);
    db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
    const at = '2026-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, date_of_birth, server_seed, server_seed_hash, client_seed,
         terms_accepted_at, created_at, updated_at) VALUES ('usr_old', 'old@example.test', 'x', 'Old', '1990-01-01', ?, ?, 'c', ?, ?, ?)`,
    ).run('a'.repeat(64), hashServerSeed('a'.repeat(64)), at, at, at);
    migrate(db);
    const row = db.prepare('SELECT next_server_seed AS s, next_server_seed_hash AS h, token_version AS v FROM users').get() as {
      s: string;
      h: string;
      v: number;
    };
    assert.match(row.s, /^[0-9a-f]{64}$/);
    assert.equal(row.h, hashServerSeed(row.s));
    assert.equal(row.v, 0);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// money-2: the max-RTP cap uses the exact (unfloored) expected value
// ---------------------------------------------------------------------------

test('rtp cap: a pack whose exact EV is above the cap is refused even when the floored EV is not', async () => {
  const seed = fixtureSeed();
  seed.cards.push(card('rtp-a', 95), card('rtp-b', 96));
  // True EV 95.5p on a 100p pack = 95.5% RTP; floored EV 95p = exactly the 95% cap.
  seed.packs.push(pack('edge', 100, [{ cardId: 'rtp-a', weight: 1 }, { cardId: 'rtp-b', weight: 1 }]));
  const app = await startApp({ seed });
  try {
    const row = () => app.db.prepare("SELECT active FROM packs WHERE id = 'edge'").get() as { active: number };
    assert.equal(row().active, 0, 'seed must leave the over-cap pack inactive');

    const admin = app.admin();
    const reactivate = await app.request('PUT', '/admin/packs/edge/active', { token: admin.token, body: { active: true } });
    assert.equal(reactivate.status, 409);

    const odds = await app.request('PUT', '/admin/packs/edge/odds', {
      token: admin.token,
      body: { entries: [{ cardId: 'rtp-a', weight: 1 }, { cardId: 'rtp-b', weight: 1 }] },
    });
    assert.equal(odds.status, 400);
    assert.match(odds.body.error.fields.entries, /95\.50%/);

    app.db.prepare("UPDATE packs SET active = 1, deactivated_reason = NULL WHERE id = 'edge'").run();
    assert.deepEqual(deactivateOverRtpPacks(app.deps), ['edge']);

    assert.equal(exceedsMaxRtp(getPackEntriesWithValues(app.db, 'edge'), 100, 9_500), true);
    assert.equal(exceedsMaxRtp(getPackEntriesWithValues(app.db, 'edge'), 100, 9_550), false);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// money-3: price sync never leaves an over-cap pack on sale with new prices
// ---------------------------------------------------------------------------

test('price sync: new prices and over-RTP deactivation land together (no window with an over-cap pack on sale)', async () => {
  const seed = fixtureSeed();
  // 9 tst-* cards + 40 fillers = 2 batches of 40: batch 1 holds every tst-* card.
  for (let i = 0; i < 40; i++) seed.cards.push(card(`zz-${String(i).padStart(2, '0')}`, 10));
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let secondStarted!: () => void;
  const started = new Promise<void>((resolve) => (secondStarted = resolve));
  const fakeFetch = async (url: string) => {
    calls++;
    const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
    const ids = [...q.matchAll(/id:"([^"]+)"/g)].map((m) => m[1]!);
    if (calls === 2) {
      secondStarted();
      await held;
    }
    // tst-6 (in premium) spikes to EUR 2000.
    const data = ids.map((id) => ({ id, cardmarket: { prices: { trendPrice: id === 'tst-6' ? 2000 : 0.12 } } }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  };
  const app = await startApp({ seed, fetch: fakeFetch });
  try {
    const syncing = syncPrices(app.deps, { retryDelayMs: 0 });
    await started;
    // Mid-sync: no active pack may be over the cap at the values a player would be charged/credited.
    const active = app.db.prepare('SELECT id, price_pence FROM packs WHERE active = 1').all() as { id: string; price_pence: number }[];
    const over = active.filter((p) => exceedsMaxRtp(getPackEntriesWithValues(app.db, p.id), p.price_pence, app.config.maxPackRtpBps));
    assert.deepEqual(over.map((p) => p.id), [], 'an over-cap pack was on sale during the sync');
    const u = app.user({ balancePence: 100_000 });
    const mid = await app.request<OpenPackResponse>('POST', '/packs/premium/open', { token: u.token, body: { quantity: 1 } });
    if (mid.status === 200) assert.ok(mid.body.pulls[0]!.valuePence <= 15_000);
    release();
    const report = await syncing;
    assert.ok(report.deactivatedPacks.includes('premium'));
    assert.equal(calls, 2);
    assert.equal((app.db.prepare("SELECT active FROM packs WHERE id = 'premium'").get() as { active: number }).active, 0);
    assert.ok((app.db.prepare("SELECT market_value_pence AS v FROM cards WHERE id = 'tst-6'").get() as { v: number }).v > 100_000);
  } finally {
    release();
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// money-4: sold_out never depends on the upcoming rolls
// ---------------------------------------------------------------------------

test('open: a batch larger than a tracked card\'s stock is refused before any roll is drawn', async () => {
  const seed = fixtureSeed();
  seed.cards.push(card('probe-chase', 300, 1));
  // The chase card is drawn about once in a million: the outcome must not depend on the rolls.
  seed.packs.push(pack('probe', 100, [{ cardId: 'probe-chase', weight: 1 }, { cardId: 'tst-1', weight: 1_000_000 }]));
  const app = await startApp({ seed });
  try {
    const u = app.user({ balancePence: 10_000 });
    const r = await app.request('POST', '/packs/probe/open', { token: u.token, body: { quantity: 2 } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'sold_out');
    const me = await app.me(u.token);
    assert.equal(me.balancePence, 10_000);
    assert.equal((await app.request<FairnessState>('GET', '/fairness', { token: u.token })).body.nonce, 0);
    // A single pack is still fine.
    const one = await app.request('POST', '/packs/probe/open', { token: u.token, body: { quantity: 1 } });
    assert.equal(one.status, 200);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// security-2: seeding ADMIN_EMAIL never silently promotes an existing player, and kills old sessions
// ---------------------------------------------------------------------------

test('seed: refuses to promote an existing non-admin account to admin unless explicitly asked', async () => {
  const app = await startApp();
  try {
    const attacker = app.user({ email: 'ops@ripvault.dev' });
    const deps = { ...app.deps, config: { ...app.config, adminEmail: 'ops@ripvault.dev', adminPassword: 'admin-password-1' } };
    await assert.rejects(() => seedDatabase(deps, fixtureSeed()), /ADMIN_EMAIL/);
    const role = () => (app.db.prepare('SELECT role FROM users WHERE id = ?').get(attacker.id) as { role: string }).role;
    assert.equal(role(), 'user');
    assert.equal((await app.request('GET', '/admin/withdrawals', { token: attacker.token })).status, 403);

    // Explicit opt-in promotes, and sessions issued before the promotion stop working.
    const promoted = await seedDatabase({ ...deps, config: { ...deps.config, adminPromoteExisting: true } }, fixtureSeed());
    assert.equal(promoted.admin, 'updated');
    assert.equal(role(), 'admin');
    assert.equal((await app.request('GET', '/me', { token: attacker.token })).status, 401);
    assert.equal((await app.request('GET', '/admin/withdrawals', { token: attacker.token })).status, 401);
    const login = await app.request('POST', '/auth/login', { body: { email: 'ops@ripvault.dev', password: 'admin-password-1' } });
    assert.equal(login.status, 200);
    assert.equal((await app.request('GET', '/admin/withdrawals', { token: login.body.token })).status, 200);

    // Re-seeding with the same password keeps the admin signed in; a new password signs them out.
    await seedDatabase(deps, fixtureSeed());
    assert.equal((await app.request('GET', '/me', { token: login.body.token })).status, 200);
    await seedDatabase({ ...deps, config: { ...deps.config, adminPassword: 'admin-password-2' } }, fixtureSeed());
    assert.equal((await app.request('GET', '/me', { token: login.body.token })).status, 401);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// security-3: TRUST_PROXY uses the address the trusted proxy appended, not the client's first entry
// ---------------------------------------------------------------------------

test('rate limit: spoofed leading X-Forwarded-For entries do not get fresh buckets behind a trusted proxy', async () => {
  const app = await startApp({ config: { trustProxy: 1, authRateLimitPerMinute: 3 } });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.request('POST', '/auth/login', {
        body: { email: 'nobody@example.com', password: 'x' },
        headers: { 'X-Forwarded-For': `10.9.${i}.${i}, 203.0.113.7` },
      });
      statuses.push(r.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 429, 429, 429]);
    // A different real client (as appended by the proxy) has its own bucket.
    const other = await app.request('POST', '/auth/login', {
      body: { email: 'nobody@example.com', password: 'x' },
      headers: { 'X-Forwarded-For': '203.0.113.8' },
    });
    assert.equal(other.status, 401);
  } finally {
    await app.close();
  }
});

test('config: TRUST_PROXY is a hop count (1/true = one proxy, 0/false = off)', () => {
  const load = (v: string) => loadConfig({ NODE_ENV: 'test', TRUST_PROXY: v }).trustProxy;
  assert.equal(load('0'), 0);
  assert.equal(load('false'), 0);
  assert.equal(load('1'), 1);
  assert.equal(load('true'), 1);
  assert.equal(load('2'), 2);
  assert.equal(loadConfig({ NODE_ENV: 'test' }).trustProxy, 0);
  assert.throws(() => load('lots'), /TRUST_PROXY/);
});

// ---------------------------------------------------------------------------
// contract-1: re-tuning the odds of an auto-deactivated pack puts it back on sale
// ---------------------------------------------------------------------------

test('admin odds: a pack switched off by the RTP guard comes back once its new odds are within the cap', async () => {
  const app = await startApp();
  try {
    const admin = app.admin();
    app.db.prepare("UPDATE cards SET market_value_pence = 10000, price_source = 'cardmarket' WHERE id = 'tst-4'").run();
    assert.ok(deactivateOverRtpPacks(app.deps).includes('starter'));
    const ids = async () => (await app.request('GET', '/packs')).body.map((p: { id: string }) => p.id);
    assert.equal((await ids()).includes('starter'), false);

    const odds = await app.request('PUT', '/admin/packs/starter/odds', {
      token: admin.token,
      body: { entries: [{ cardId: 'tst-1', weight: 500 }, { cardId: 'tst-2', weight: 300 }, { cardId: 'tst-3', weight: 150 }] },
    });
    assert.equal(odds.status, 200);
    assert.equal((await ids()).includes('starter'), true);
    assert.equal((await app.request('GET', '/packs/starter')).status, 200);

    // A pack an admin switched off by hand stays off.
    assert.equal((await app.request('PUT', '/admin/packs/single/active', { token: admin.token, body: { active: false } })).status, 200);
    const single = await app.request('PUT', '/admin/packs/single/odds', { token: admin.token, body: { entries: [{ cardId: 'tst-9', weight: 1 }] } });
    assert.equal(single.status, 200);
    assert.equal((await ids()).includes('single'), false);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// contract-2: cancelling an already-cancelled shipment is idempotent
// ---------------------------------------------------------------------------

test('shipments: cancelling an already-cancelled shipment returns it (200) without refunding twice', async () => {
  const app = await startApp();
  try {
    const u = app.user({ balancePence: 50_000 });
    const opened = await app.request<OpenPackResponse>('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } });
    const addr = await app.request<Address>('POST', '/addresses', {
      token: u.token,
      body: { fullName: 'Ash Ketchum', line1: '1 Pallet Road', city: 'London', postcode: 'SW1A 1AA', country: 'GB' },
    });
    const created = await app.request<CreateShipmentResponse>('POST', '/shipments', {
      token: u.token,
      body: { itemIds: [opened.body.pulls[0]!.inventoryItemId], addressId: addr.body.id },
    });
    assert.equal(created.status, 201);
    const first = await app.request('POST', `/shipments/${created.body.shipment.id}/cancel`, { token: u.token });
    assert.equal(first.status, 200);
    const second = await app.request('POST', `/shipments/${created.body.shipment.id}/cancel`, { token: u.token });
    assert.equal(second.status, 200);
    assert.equal(second.body.shipment.status, 'cancelled');
    assert.equal(second.body.balancePence, first.body.balancePence);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'shipping_refund'", u.id), 1);
  } finally {
    await app.close();
  }
});
