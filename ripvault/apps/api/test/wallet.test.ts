import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { WalletResponse, Withdrawal, WithdrawalResponse } from '@ripvault/shared';
import { ledgerMismatches, startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

describe('wallet', () => {
  let app: TestApp;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('dev top-up credits instantly within min/max', async () => {
    const u = app.user();
    const res = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 2_500 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.kind, 'credited');
    assert.match(res.body.paymentId, /^pay_/);
    assert.equal(res.body.balancePence, 2_500);
    for (const amountPence of [499, 50_001, 10.5, '1000']) {
      const bad = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence } });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, 'validation_failed');
    }
  });

  test('ledger history paginates newest first with balanceAfter', async () => {
    const u = app.user();
    for (const amountPence of [1_000, 2_000, 3_000]) await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence } });
    const p1 = (await app.request<WalletResponse>('GET', '/wallet?limit=2', { token: u.token })).body;
    assert.equal(p1.balancePence, 6_000);
    assert.deepEqual(p1.transactions.map((t) => [t.type, t.amountPence, t.balanceAfterPence]), [
      ['topup', 3_000, 6_000],
      ['topup', 2_000, 3_000],
    ]);
    assert.ok(p1.nextCursor);
    const p2 = (await app.request<WalletResponse>('GET', `/wallet?limit=2&before=${p1.nextCursor}`, { token: u.token })).body;
    assert.deepEqual(p2.transactions.map((t) => t.amountPence), [1_000]);
    assert.equal(p2.nextCursor, null);
    assert.equal((await app.request('GET', '/wallet?limit=0', { token: u.token })).status, 400);
    // Other users' rows never appear.
    const other = app.user();
    assert.equal((await app.request<WalletResponse>('GET', '/wallet', { token: other.token })).body.transactions.length, 0);
  });

  test('withdrawals debit immediately; listing masks payout details', async () => {
    const u = app.user({ balancePence: 5_000 });
    const res = await app.request<WithdrawalResponse>('POST', '/wallet/withdrawals', {
      token: u.token,
      body: { amountPence: 2_000, payoutDetails: 'paypal: ash@example.com' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.balancePence, 3_000);
    assert.equal(res.body.withdrawal.status, 'pending');
    assert.equal(res.body.withdrawal.payoutDetails, 'paypal: ash@example.com');
    const list = await app.request<Withdrawal[]>('GET', '/wallet/withdrawals', { token: u.token });
    assert.equal(list.body.length, 1);
    assert.notEqual(list.body[0]!.payoutDetails, 'paypal: ash@example.com');
    assert.match(list.body[0]!.payoutDetails, /^pa\*+om$/);

    const tooMuch = await app.request('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 3_001, payoutDetails: 'paypal: a@b.com' } });
    assert.equal(tooMuch.status, 402);
    const tooSmall = await app.request('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 999, payoutDetails: 'paypal: a@b.com' } });
    assert.equal(tooSmall.status, 400);
    const noDetails = await app.request('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 1_000, payoutDetails: 'ab' } });
    assert.equal(noDetails.status, 400);
  });

  test('admin marks paid (no refund) or rejected (refund via withdrawal_reversal), only from pending', async () => {
    const admin = app.admin();
    const u = app.user({ balancePence: 10_000 });
    const w1 = (await app.request<WithdrawalResponse>('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 3_000, payoutDetails: 'bank 12345678' } })).body;
    const w2 = (await app.request<WithdrawalResponse>('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 4_000, payoutDetails: 'bank 12345678' } })).body;
    assert.equal(w2.balancePence, 3_000);

    const pending = await app.request('GET', '/admin/withdrawals?status=pending', { token: admin.token });
    const mine = pending.body.filter((w: { userEmail: string }) => w.userEmail === u.email);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].payoutDetails, 'bank 12345678'); // admins see full details

    const paid = await app.request('PATCH', `/admin/withdrawals/${w1.withdrawal.id}`, { token: admin.token, body: { status: 'paid', adminNote: 'sent' } });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'paid');
    assert.equal(paid.body.adminNote, 'sent');
    assert.equal((await app.me(u.token)).balancePence, 3_000);

    const rejected = await app.request('PATCH', `/admin/withdrawals/${w2.withdrawal.id}`, { token: admin.token, body: { status: 'rejected', adminNote: 'details invalid' } });
    assert.equal(rejected.body.status, 'rejected');
    assert.equal((await app.me(u.token)).balancePence, 7_000);
    const reversal = app.db.prepare("SELECT amount_pence, reference FROM transactions WHERE user_id = ? AND type = 'withdrawal_reversal'").get(u.id);
    assert.deepEqual({ ...reversal }, { amount_pence: 4_000, reference: w2.withdrawal.id });

    const again = await app.request('PATCH', `/admin/withdrawals/${w2.withdrawal.id}`, { token: admin.token, body: { status: 'paid' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'invalid_state');
    assert.equal((await app.me(u.token)).balancePence, 7_000);
    assert.equal((await app.request('PATCH', `/admin/withdrawals/${w1.withdrawal.id}`, { token: admin.token, body: { status: 'pending' } })).status, 400);
    assert.equal((await app.request('PATCH', '/admin/withdrawals/wdr_missing', { token: admin.token, body: { status: 'paid' } })).status, 404);
    assert.deepEqual(ledgerMismatches(app.db), []);
  });
});

test('withdrawals can be disabled', async () => {
  const app = await startApp({ config: { withdrawals: { enabled: false, minPence: 1000 } } });
  try {
    const u = app.user({ balancePence: 5_000 });
    const res = await app.request('POST', '/wallet/withdrawals', { token: u.token, body: { amountPence: 2_000, payoutDetails: 'paypal: a@b.com' } });
    assert.equal(res.status, 403);
    assert.equal((await app.me(u.token)).balancePence, 5_000);
  } finally {
    await app.close();
  }
});
