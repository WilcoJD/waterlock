import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from '../src/config.ts';
import { SeedFileError, loadSeedFiles, seedFilesPresent } from '../src/seed/load.ts';
import { seedDatabase, validateSeedData } from '../src/seed/seed.ts';
import { count, fixtureSeed, ledgerMismatches, startApp } from './helpers.ts';

test('seeding is idempotent and only creates a revision when odds change', async () => {
  const app = await startApp();
  try {
    const revs = () => count(app.db, 'SELECT COUNT(*) AS n FROM pack_revisions');
    assert.equal(revs(), 5);
    const again = await seedDatabase(app.deps, fixtureSeed());
    assert.equal(again.cardsInserted, 0);
    assert.equal(again.cardsUpdated, 9);
    assert.equal(again.packsInserted, 0);
    assert.equal(again.revisionsCreated, 0);
    assert.equal(revs(), 5);

    // Same odds in a different order: still no new revision.
    const shuffled = fixtureSeed();
    shuffled.packs[0]!.entries.reverse();
    assert.equal((await seedDatabase(app.deps, shuffled)).revisionsCreated, 0);

    const changed = fixtureSeed();
    changed.packs[0]!.entries[0]!.weight = 499;
    changed.packs[0]!.name = 'Starter Rip v2';
    const r = await seedDatabase(app.deps, changed);
    assert.equal(r.revisionsCreated, 1);
    assert.equal(revs(), 6);
    assert.equal((await app.request('GET', '/packs/starter')).body.name, 'Starter Rip v2');

    // Re-seeding does not reset live stock or synced prices.
    app.db.prepare("UPDATE cards SET stock = 7 WHERE id = 'tst-5'").run();
    app.db.prepare("UPDATE cards SET market_value_pence = 1234, price_source = 'cardmarket' WHERE id = 'tst-4'").run();
    await seedDatabase(app.deps, fixtureSeed());
    assert.equal((app.db.prepare("SELECT stock FROM cards WHERE id = 'tst-5'").get() as { stock: number }).stock, 7);
    assert.equal((app.db.prepare("SELECT market_value_pence AS v FROM cards WHERE id = 'tst-4'").get() as { v: number }).v, 1234);
  } finally {
    await app.close();
  }
});

test('admin and demo users', async () => {
  const app = await startApp({ seed: false, config: { adminEmail: 'boss@ripvault.dev', adminPassword: 'admin-password-1', seedDemoUser: true } });
  try {
    const r = await seedDatabase(app.deps, fixtureSeed());
    assert.equal(r.admin, 'created');
    assert.equal(r.demoUser, 'created');
    const demo = await app.request('POST', '/auth/login', { body: { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD } });
    assert.equal(demo.status, 200);
    assert.equal(demo.body.user.balancePence, 5_000);
    const ledger = app.db.prepare('SELECT type, amount_pence FROM transactions WHERE user_id = ?').all(demo.body.user.id);
    assert.deepEqual(ledger.map((x) => ({ ...x })), [{ type: 'adjustment', amount_pence: 5_000 }]);
    const admin = await app.request('POST', '/auth/login', { body: { email: 'BOSS@ripvault.dev', password: 'admin-password-1' } });
    assert.equal(admin.body.user.role, 'admin');
    const again = await seedDatabase(app.deps, fixtureSeed());
    assert.equal(again.admin, 'updated');
    assert.equal(again.demoUser, 'exists');
    assert.equal((await app.me(demo.body.token)).balancePence, 5_000);
    assert.deepEqual(ledgerMismatches(app.db), []);
  } finally {
    await app.close();
  }
});

test('no demo user in production config', async () => {
  const app = await startApp({ seed: false, config: { env: 'production', seedDemoUser: true } });
  try {
    const r = await seedDatabase(app.deps, fixtureSeed());
    assert.equal(r.demoUser, 'skipped');
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM users WHERE email = ?', DEMO_USER_EMAIL), 0);
  } finally {
    await app.close();
  }
});

test('packs over max RTP at seed values are seeded inactive', async () => {
  const data = fixtureSeed();
  data.packs[1]!.pricePence = 1_000; // premium EV 1740 > 950
  const app = await startApp({ seed: data });
  try {
    assert.equal((app.db.prepare("SELECT active FROM packs WHERE id = 'premium'").get() as { active: number }).active, 0);
    assert.equal((await app.request('GET', '/packs/premium')).status, 404);
  } finally {
    await app.close();
  }
});

test('invalid seed data is rejected with readable problems', () => {
  const data = fixtureSeed();
  data.cards[0]!.marketValuePence = -1;
  data.packs[0]!.entries.push({ cardId: 'missing-card', weight: 1 });
  data.packs[1]!.id = 'Bad Slug';
  const problems = validateSeedData(data);
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => p.includes('marketValuePence')));
  assert.ok(problems.some((p) => p.includes('unknown card missing-card')));
});

test('seed loader fails clearly when files are missing or broken, and reads them when present', () => {
  const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const missing = join(fixtures, 'seed-missing'); // has cards.json but no packs.json
  assert.equal(seedFilesPresent(missing), false);
  assert.throws(() => loadSeedFiles(missing), (e: unknown) => e instanceof SeedFileError && /Seed file not found: .*packs\.json/.test(e.message));
  assert.throws(() => loadSeedFiles(join(fixtures, 'seed-bad-json')), (e: unknown) => e instanceof SeedFileError && /not valid JSON/.test(e.message));
  const valid = join(fixtures, 'seed-valid');
  assert.equal(seedFilesPresent(valid), true);
  const data = loadSeedFiles(valid);
  assert.equal(data.cards.length, 1);
  assert.deepEqual(validateSeedData(data), []);
});
