import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPull } from '@ripvault/shared';
import type { AdminPackReport, OpenPackResponse, PackDetail, RotateSeedResponse, VerifyOpeningResponse } from '@ripvault/shared';
import { count, startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

describe('admin', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('changing odds creates a new immutable revision; old openings still verify against theirs', async () => {
    const admin = app.admin();
    const u = app.user({ balancePence: 20_000 });
    const before = (await app.request<PackDetail>('GET', '/packs/starter')).body;
    const opened = (await app.request<OpenPackResponse>('POST', '/packs/starter/open', { token: u.token, body: { quantity: 3 } })).body;
    assert.equal(opened.fairness.revisionId, before.revisionId);

    const entries = [
      { cardId: 'tst-1', weight: 10 },
      { cardId: 'tst-2', weight: 10 },
      { cardId: 'tst-9', weight: 1 },
    ];
    const res = await app.request<PackDetail>('PUT', '/admin/packs/starter/odds', { token: admin.token, body: { entries } });
    assert.equal(res.status, 200);
    assert.ok(res.body.revisionId > before.revisionId);
    assert.equal(res.body.totalWeight, 21);
    assert.deepEqual(res.body.odds.map((o) => o.card.id), ['tst-9', 'tst-2', 'tst-1']);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM pack_revisions WHERE pack_id = 'starter'"), 2);
    // Revisions cannot be edited.
    assert.throws(() => app.db.prepare("UPDATE pack_revisions SET entries_json = '[]'").run(), /immutable/);

    const after = (await app.request<OpenPackResponse>('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } })).body;
    assert.equal(after.fairness.revisionId, res.body.revisionId);

    const rotated = (await app.request<RotateSeedResponse>('POST', '/fairness/rotate', { token: u.token })).body;
    for (const pull of opened.pulls) {
      const v = (await app.request<VerifyOpeningResponse>('GET', `/openings/${pull.openingId}/verify`, { token: u.token })).body;
      assert.equal(v.opening.revisionId, before.revisionId);
      assert.equal(v.entries.length, 4); // the old table, not the new one
      const result = verifyPull({
        serverSeed: rotated.revealed.serverSeed,
        serverSeedHash: v.opening.serverSeedHash,
        clientSeed: v.opening.clientSeed,
        nonce: v.opening.nonce,
        entries: v.entries,
        claimedCardId: v.opening.card.id,
      });
      assert.equal(result.valid, true);
    }
  });

  test('odds validation: unknown cards, bad weights, duplicates, and RTP above the max', async () => {
    const admin = app.admin();
    const put = (entries: unknown) => app.request('PUT', '/admin/packs/premium/odds', { token: admin.token, body: { entries } });
    assert.equal((await put([{ cardId: 'nope', weight: 1 }])).body.error.code, 'validation_failed');
    assert.equal((await put([{ cardId: 'tst-1', weight: 0 }])).status, 400);
    assert.equal((await put([{ cardId: 'tst-1', weight: 1.5 }])).status, 400);
    assert.equal((await put([{ cardId: 'tst-1', weight: 1 }, { cardId: 'tst-1', weight: 2 }])).status, 400);
    assert.equal((await put([])).status, 400);
    const rich = await put([{ cardId: 'tst-6', weight: 1 }]); // EV 15000 for a 2000 pack
    assert.equal(rich.status, 400);
    assert.match(rich.body.error.fields.entries, /RTP/);
    assert.equal((await app.request('PUT', '/admin/packs/nope/odds', { token: admin.token, body: { entries: [{ cardId: 'tst-1', weight: 1 }] } })).status, 404);
  });

  test('pack report', async () => {
    const admin = app.admin();
    const u = app.user({ balancePence: 20_000 });
    await app.request('POST', '/packs/single/open', { token: u.token, body: { quantity: 2 } });
    const r = await app.request<AdminPackReport>('GET', '/admin/packs/single/report', { token: admin.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.pack.id, 'single');
    assert.equal(r.body.evPence, 1999);
    assert.equal(r.body.rtp, 1999 / 2200);
    assert.equal(r.body.maxRtp, 0.95);
    assert.equal(r.body.opened, 2);
    assert.equal(r.body.revenuePence, 4400);
    assert.equal(r.body.paidOutValuePence, 3998);
    assert.equal(r.text.includes('server_seed'), false);
  });

  test('card stock can be set or untracked', async () => {
    const admin = app.admin();
    const res = await app.request('PUT', '/admin/cards/tst-8/stock', { token: admin.token, body: { stock: 3 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'tst-8');
    assert.equal(res.body.tier, 'uncommon');
    const packs = await app.request('GET', '/packs');
    assert.equal(packs.body.find((p: { id: string }) => p.id === 'gone').soldOut, false);
    assert.equal((await app.request('PUT', '/admin/cards/tst-8/stock', { token: admin.token, body: { stock: null } })).status, 200);
    assert.equal((await app.request('PUT', '/admin/cards/tst-8/stock', { token: admin.token, body: { stock: -1 } })).status, 400);
    assert.equal((await app.request('PUT', '/admin/cards/nope/stock', { token: admin.token, body: { stock: 1 } })).status, 404);
  });

  test('admin endpoints never expose unrevealed server seeds', async () => {
    const admin = app.admin();
    const u = app.user({ balancePence: 20_000 });
    await app.request('POST', '/packs/single/open', { token: u.token, body: { quantity: 1 } });
    const seed = (app.db.prepare('SELECT server_seed FROM users WHERE id = ?').get(u.id) as { server_seed: string }).server_seed;
    for (const path of ['/admin/shipments', '/admin/withdrawals', '/admin/packs/single/report']) {
      const r = await app.request('GET', path, { token: admin.token });
      assert.equal(r.status, 200);
      assert.equal(r.text.includes(seed), false);
    }
  });
});
