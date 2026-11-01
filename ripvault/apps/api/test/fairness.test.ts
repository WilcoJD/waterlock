import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashServerSeed, verifyPull } from '@ripvault/shared';
import type { FairnessState, OpenPackResponse, OpeningsResponse, RotateSeedResponse, VerifyOpeningResponse } from '@ripvault/shared';
import { startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

describe('provably fair', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('openings verify with the shared verifyPull once the seed is rotated', async () => {
    const u = app.user({ balancePence: 50_000 });
    const before = (await app.request<FairnessState>('GET', '/fairness', { token: u.token })).body;
    const opened = (await app.request<OpenPackResponse>('POST', '/packs/premium/open', { token: u.token, body: { quantity: 5 } })).body;
    assert.equal(opened.fairness.serverSeedHash, before.serverSeedHash);
    assert.equal(opened.fairness.clientSeed, before.clientSeed);

    // Before rotation the server seed is hidden everywhere.
    const hidden = (await app.request<OpeningsResponse>('GET', '/openings', { token: u.token })).body;
    assert.equal(hidden.openings.length, 5);
    assert.ok(hidden.openings.every((o) => o.serverSeed === null));
    const serverSeed = (app.db.prepare('SELECT server_seed FROM users WHERE id = ?').get(u.id) as { server_seed: string }).server_seed;
    for (const path of ['/fairness', '/openings', '/me', `/openings/${opened.pulls[0]!.openingId}/verify`]) {
      const r = await app.request('GET', path, { token: u.token });
      assert.equal(r.text.includes(serverSeed), false, `${path} leaked the server seed`);
    }

    const rotated = await app.request<RotateSeedResponse>('POST', '/fairness/rotate', { token: u.token, body: { clientSeed: 'my-lucky-seed_1' } });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.body.revealed.serverSeed, serverSeed);
    assert.equal(rotated.body.revealed.serverSeedHash, before.serverSeedHash);
    assert.equal(hashServerSeed(rotated.body.revealed.serverSeed), before.serverSeedHash);
    assert.equal(rotated.body.revealed.finalNonce, 5);
    assert.equal(rotated.body.current.clientSeed, 'my-lucky-seed_1');
    assert.equal(rotated.body.current.nonce, 0);
    assert.notEqual(rotated.body.current.serverSeedHash, before.serverSeedHash);
    assert.equal(rotated.body.current.revealed.length, 1);

    for (const pull of opened.pulls) {
      const v = (await app.request<VerifyOpeningResponse>('GET', `/openings/${pull.openingId}/verify`, { token: u.token })).body;
      assert.equal(v.opening.serverSeed, serverSeed);
      assert.equal(v.opening.revisionId, opened.fairness.revisionId);
      const result = verifyPull({
        serverSeed: v.opening.serverSeed!,
        serverSeedHash: v.opening.serverSeedHash,
        clientSeed: v.opening.clientSeed,
        nonce: v.opening.nonce,
        entries: v.entries,
        claimedCardId: v.opening.card.id,
      });
      assert.equal(result.valid, true);
      assert.equal(result.roll, pull.roll);
      assert.equal(v.opening.roll, pull.roll);
    }

    // New openings use the new seed pair from nonce 0.
    const next = (await app.request<OpenPackResponse>('POST', '/packs/starter/open', { token: u.token, body: { quantity: 1 } })).body;
    assert.equal(next.pulls[0]!.nonce, 0);
    assert.equal(next.fairness.clientSeed, 'my-lucky-seed_1');
    const list = (await app.request<OpeningsResponse>('GET', '/openings', { token: u.token })).body;
    assert.equal(list.openings[0]!.serverSeed, null);
    assert.equal(list.openings[1]!.serverSeed, serverSeed);
  });

  test('rotate without a client seed generates 16 hex chars; invalid seeds are rejected', async () => {
    const u = app.user();
    const r = await app.request<RotateSeedResponse>('POST', '/fairness/rotate', { token: u.token });
    assert.equal(r.status, 200);
    assert.match(r.body.current.clientSeed, /^[0-9a-f]{16}$/);
    for (const clientSeed of ['', 'has space', 'x'.repeat(65), 42]) {
      const bad = await app.request('POST', '/fairness/rotate', { token: u.token, body: { clientSeed } });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, 'validation_failed');
    }
  });

  test('openings paginate with nextCursor and are private to their owner', async () => {
    const a = app.user({ balancePence: 50_000 });
    const b = app.user();
    await app.request('POST', '/packs/starter/open', { token: a.token, body: { quantity: 5 } });
    const p1 = (await app.request<OpeningsResponse>('GET', '/openings?limit=3', { token: a.token })).body;
    assert.equal(p1.openings.length, 3);
    assert.ok(p1.nextCursor);
    const p2 = (await app.request<OpeningsResponse>('GET', `/openings?limit=3&before=${p1.nextCursor}`, { token: a.token })).body;
    assert.equal(p2.openings.length, 2);
    assert.equal(p2.nextCursor, null);
    assert.deepEqual(
      [...p1.openings, ...p2.openings].map((o) => o.nonce),
      [4, 3, 2, 1, 0],
    );
    const theirs = await app.request('GET', `/openings/${p1.openings[0]!.id}/verify`, { token: b.token });
    assert.equal(theirs.status, 404);
    assert.equal((await app.request<OpeningsResponse>('GET', '/openings', { token: b.token })).body.openings.length, 0);
  });
});
