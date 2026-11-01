import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { signStripePayload, verifyStripeSignature } from '../src/services/stripe.ts';
import { count, ledgerMismatches, startApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

const WHSEC = 'whsec_test_secret';

interface Captured {
  url: string;
  init: RequestInit;
}

describe('Stripe Checkout top-ups', () => {
  let app: TestApp;
  const calls: Captured[] = [];
  let failNext = false;
  before(async () => {
    app = await startApp({
      config: {
        stripe: { secretKey: 'sk_test_123', webhookSecret: WHSEC, apiBase: 'https://api.stripe.com' },
        publicUrl: 'https://api.ripvault.test',
      },
      fetch: async (url, init) => {
        calls.push({ url, init: init ?? {} });
        if (failNext) {
          failNext = false;
          return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 });
        }
        const n = calls.length;
        return new Response(JSON.stringify({ id: `cs_test_${n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
  });
  after(() => app.close());

  function webhook(event: unknown, opts: { secret?: string; t?: number } = {}) {
    const payload = JSON.stringify(event);
    const t = opts.t ?? Math.floor(app.clock.ms / 1000);
    return app.request('POST', '/webhooks/stripe', {
      rawBody: payload,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripePayload(payload, opts.secret ?? WHSEC, t) },
    });
  }

  function completed(sessionId: string, paymentId: string, amount: number, extra: Record<string, unknown> = {}) {
    return {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          client_reference_id: paymentId,
          metadata: { payment_id: paymentId },
          amount_total: amount,
          currency: 'gbp',
          payment_status: 'paid',
          ...extra,
        },
      },
    };
  }

  test('top-up creates a Checkout Session with the right form fields', async () => {
    const u = app.user();
    const res = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 2_500 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.kind, 'checkout');
    assert.match(res.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
    const call = calls.at(-1)!;
    assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(call.init.method, 'POST');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer sk_test_123');
    assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(call.init.body));
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('line_items[0][price_data][currency]'), 'gbp');
    assert.equal(form.get('line_items[0][price_data][unit_amount]'), '2500');
    assert.equal(form.get('line_items[0][quantity]'), '1');
    assert.equal(form.get('success_url'), 'https://api.ripvault.test/payments/return?status=success');
    assert.equal(form.get('cancel_url'), 'https://api.ripvault.test/payments/return?status=cancel');
    assert.equal(form.get('client_reference_id'), res.body.paymentId);
    assert.equal(form.get('metadata[payment_id]'), res.body.paymentId);
    // Nothing credited until the webhook.
    assert.equal((await app.me(u.token)).balancePence, 0);
    const cfg = await app.request('GET', '/config');
    assert.equal(cfg.body.topup.stripeEnabled, true);
  });

  test('a valid webhook credits exactly once; replays do not double credit', async () => {
    const u = app.user();
    const top = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 5_000 } });
    const sessionId = new URL(top.body.checkoutUrl).pathname.split('/').pop()!;
    const event = completed(sessionId, top.body.paymentId, 5_000);
    const first = await webhook(event);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { received: true });
    assert.equal((await app.me(u.token)).balancePence, 5_000);
    const replay = await webhook(event);
    assert.equal(replay.status, 200);
    const asyncSucceeded = await webhook({ ...event, type: 'checkout.session.async_payment_succeeded' });
    assert.equal(asyncSucceeded.status, 200);
    assert.equal((await app.me(u.token)).balancePence, 5_000);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'topup'", u.id), 1);
    assert.equal((app.db.prepare('SELECT status FROM payments WHERE id = ?').get(top.body.paymentId) as { status: string }).status, 'succeeded');
    assert.deepEqual(ledgerMismatches(app.db), []);
  });

  test('bad signatures, stale timestamps and missing headers are 400 and credit nothing', async () => {
    const u = app.user();
    const top = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 } });
    const sessionId = new URL(top.body.checkoutUrl).pathname.split('/').pop()!;
    const event = completed(sessionId, top.body.paymentId, 1_000);
    const wrongSecret = await webhook(event, { secret: 'whsec_wrong' });
    assert.equal(wrongSecret.status, 400);
    assert.equal(wrongSecret.body.error.code, 'bad_request');
    const stale = await webhook(event, { t: Math.floor(app.clock.ms / 1000) - 301 });
    assert.equal(stale.status, 400);
    const missing = await app.request('POST', '/webhooks/stripe', { rawBody: JSON.stringify(event), headers: { 'Content-Type': 'application/json' } });
    assert.equal(missing.status, 400);
    // Signed payload but body tampered after signing.
    const payload = JSON.stringify(event);
    const sig = signStripePayload(payload, WHSEC, Math.floor(app.clock.ms / 1000));
    const tampered = await app.request('POST', '/webhooks/stripe', { rawBody: payload.replace('1000', '9000'), headers: { 'Stripe-Signature': sig } });
    assert.equal(tampered.status, 400);
    assert.equal((await app.me(u.token)).balancePence, 0);
  });

  test('unpaid sessions, amount mismatches and unknown sessions are acknowledged but not credited', async () => {
    const u = app.user();
    const top = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 } });
    const sessionId = new URL(top.body.checkoutUrl).pathname.split('/').pop()!;
    assert.equal((await webhook(completed(sessionId, top.body.paymentId, 1_000, { payment_status: 'unpaid' }))).status, 200);
    assert.equal((await webhook(completed(sessionId, top.body.paymentId, 999_999))).status, 200);
    assert.equal((await webhook(completed('cs_unknown', 'pay_unknown', 1_000))).status, 200);
    assert.equal((await app.me(u.token)).balancePence, 0);
    // Then the genuine event still credits.
    await webhook(completed(sessionId, top.body.paymentId, 1_000));
    assert.equal((await app.me(u.token)).balancePence, 1_000);
  });

  test('expired sessions are marked expired and cannot be credited later', async () => {
    const u = app.user();
    const top = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 } });
    const sessionId = new URL(top.body.checkoutUrl).pathname.split('/').pop()!;
    await webhook({ id: 'evt_x', type: 'checkout.session.expired', data: { object: { id: sessionId, client_reference_id: top.body.paymentId } } });
    assert.equal((app.db.prepare('SELECT status FROM payments WHERE id = ?').get(top.body.paymentId) as { status: string }).status, 'expired');
    await webhook(completed(sessionId, top.body.paymentId, 1_000));
    assert.equal((await app.me(u.token)).balancePence, 0);
  });

  test('a Stripe API failure is payments_unavailable and marks the payment failed', async () => {
    const u = app.user();
    failNext = true;
    const res = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 }, headers: { 'Idempotency-Key': 'stripe-fail' } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'payments_unavailable');
    assert.equal(res.text.includes('Invalid API Key'), false);
    assert.equal(count(app.db, "SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND status = 'failed'", u.id), 1);
    // The idempotency key was released, so a retry with the same key works and is then replayed.
    const retry = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 }, headers: { 'Idempotency-Key': 'stripe-fail' } });
    assert.equal(retry.status, 200);
    const replay = await app.request('POST', '/wallet/topup', { token: u.token, body: { amountPence: 1_000 }, headers: { 'Idempotency-Key': 'stripe-fail' } });
    assert.equal(replay.text, retry.text);
    assert.equal(count(app.db, 'SELECT COUNT(*) AS n FROM payments WHERE user_id = ?', u.id), 2);
  });

  test('payments return page is HTML', async () => {
    const res = await app.request('GET', '/payments/return?status=success');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /text\/html/);
    assert.match(res.text, /Return to the app/);
    const cancel = await app.request('GET', '/payments/return?status=<script>');
    assert.match(cancel.text, /cancelled/);
    assert.equal(cancel.text.includes('<script>'), false);
  });
});

test('webhook is 503 when Stripe is not configured', async () => {
  const app = await startApp();
  try {
    const res = await app.request('POST', '/webhooks/stripe', { rawBody: '{}', headers: { 'Stripe-Signature': 't=1,v1=00' } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'payments_unavailable');
  } finally {
    await app.close();
  }
});

test('verifyStripeSignature accepts any matching v1 among several', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const t = Math.floor(now.getTime() / 1000);
  const body = Buffer.from('{"a":1}');
  const good = signStripePayload('{"a":1}', 'sec', t);
  const header = `t=${t},v1=${'0'.repeat(64)},${good.split(',')[1]},v0=abc`;
  assert.equal(verifyStripeSignature(body, header, 'sec', now), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, 'sec', now), false);
  assert.equal(verifyStripeSignature(body, good, 'sec', new Date(now.getTime() + 301_000)), false);
  assert.equal(verifyStripeSignature(body, undefined, 'sec', now), false);
});
