/**
 * Stripe Checkout for wallet top-ups, using fetch (no SDK).
 *  - createCheckoutSession: POST /v1/checkout/sessions (form-encoded), GBP, one line item.
 *  - verifyStripeSignature: Stripe-Signature "t=...,v1=..." HMAC-SHA256 over `${t}.${rawBody}`.
 *  - handleStripeWebhook: credits a pending payment exactly once on a paid checkout session.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { tx } from '../db.ts';
import type { Deps } from '../deps.ts';
import { badRequest, paymentsUnavailable } from '../errors.ts';
import { credit } from './ledger.ts';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface CheckoutSession {
  id: string;
  url: string;
}

export async function createCheckoutSession(
  deps: Deps,
  input: { paymentId: string; userId: string; email: string; amountPence: number },
): Promise<CheckoutSession> {
  const stripe = deps.config.stripe;
  if (!stripe) throw paymentsUnavailable();
  const returnBase = `${deps.config.publicUrl}/payments/return`;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'gbp');
  form.set('line_items[0][price_data][unit_amount]', String(input.amountPence));
  form.set('line_items[0][price_data][product_data][name]', 'RipVault wallet top-up');
  form.set('success_url', `${returnBase}?status=success`);
  form.set('cancel_url', `${returnBase}?status=cancel`);
  form.set('client_reference_id', input.paymentId);
  form.set('metadata[payment_id]', input.paymentId);
  form.set('metadata[user_id]', input.userId);
  form.set('payment_intent_data[metadata][payment_id]', input.paymentId);
  form.set('customer_email', input.email);

  let res: Response;
  try {
    res = await deps.fetch(`${stripe.apiBase}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Stripe-side idempotency: a retried create returns the same session.
        'Idempotency-Key': `checkout-${input.paymentId}`,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    deps.logger.error('stripe checkout request failed', { paymentId: input.paymentId, error: String(err) });
    throw paymentsUnavailable('Card payments are unavailable right now. Please try again shortly.');
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const session = data as { id?: unknown; url?: unknown } | null;
  if (!res.ok || !session || typeof session.id !== 'string' || typeof session.url !== 'string') {
    const stripeError = (data as { error?: { message?: unknown } } | null)?.error?.message;
    deps.logger.error('stripe checkout session rejected', {
      paymentId: input.paymentId,
      status: res.status,
      stripeError: typeof stripeError === 'string' ? stripeError : undefined,
    });
    throw paymentsUnavailable('Card payments are unavailable right now. Please try again shortly.');
  }
  return { id: session.id, url: session.url };
}

/** Verify a Stripe-Signature header against the raw body. */
export function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string, now: Date): boolean {
  if (!header) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Build a valid Stripe-Signature header (tests and local tooling). */
export function signStripePayload(payload: string, secret: string, timestampSeconds: number): string {
  const sig = createHmac('sha256', secret).update(`${timestampSeconds}.${payload}`).digest('hex');
  return `t=${timestampSeconds},v1=${sig}`;
}

interface PaymentRow {
  id: string;
  user_id: string;
  provider: string;
  provider_ref: string | null;
  amount_pence: number;
  status: string;
}

interface StripeSessionObject {
  id?: unknown;
  client_reference_id?: unknown;
  metadata?: { payment_id?: unknown } | null;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
}

export function handleStripeWebhook(deps: Deps, rawBody: Buffer, signatureHeader: string | undefined): { received: true } {
  const stripe = deps.config.stripe;
  if (!stripe) throw paymentsUnavailable('Stripe is not configured');
  if (!verifyStripeSignature(rawBody, signatureHeader, stripe.webhookSecret, deps.now())) {
    throw badRequest('Invalid Stripe signature');
  }
  let event: { id?: unknown; type?: unknown; data?: { object?: StripeSessionObject } };
  try {
    event = JSON.parse(rawBody.toString('utf8')) as typeof event;
  } catch {
    throw badRequest('Invalid JSON payload');
  }
  const type = typeof event.type === 'string' ? event.type : '';
  const session = event.data?.object;
  if (!session || typeof session !== 'object') return { received: true };

  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (session.payment_status === 'paid') completePayment(deps, session, String(event.id ?? ''));
      break;
    case 'checkout.session.expired':
      markPayment(deps, session, 'expired', 'Checkout session expired');
      break;
    case 'checkout.session.async_payment_failed':
      markPayment(deps, session, 'failed', 'Payment failed');
      break;
    default:
      break;
  }
  return { received: true };
}

function findPayment(deps: Deps, session: StripeSessionObject): PaymentRow | undefined {
  const sessionId = typeof session.id === 'string' ? session.id : null;
  if (!sessionId) return undefined;
  const bySession = deps.db
    .prepare("SELECT * FROM payments WHERE provider = 'stripe' AND provider_ref = ?")
    .get(sessionId) as PaymentRow | undefined;
  if (bySession) return bySession;
  // The webhook can beat our own write of provider_ref; fall back to our payment id.
  const ref = typeof session.client_reference_id === 'string' ? session.client_reference_id : session.metadata?.payment_id;
  if (typeof ref !== 'string') return undefined;
  const byRef = deps.db
    .prepare("SELECT * FROM payments WHERE provider = 'stripe' AND id = ? AND (provider_ref IS NULL OR provider_ref = ?)")
    .get(ref, sessionId) as PaymentRow | undefined;
  return byRef;
}

function completePayment(deps: Deps, session: StripeSessionObject, eventId: string): void {
  const payment = findPayment(deps, session);
  const sessionId = String(session.id);
  if (!payment) {
    deps.logger.warn('stripe webhook for unknown payment', { sessionId, eventId });
    return;
  }
  const currency = typeof session.currency === 'string' ? session.currency.toLowerCase() : '';
  if (session.amount_total !== payment.amount_pence || currency !== 'gbp') {
    deps.logger.error('stripe amount mismatch; not crediting', {
      paymentId: payment.id,
      expected: payment.amount_pence,
      got: session.amount_total,
      currency,
    });
    return;
  }
  const at = deps.now().toISOString();
  tx(deps.db, () => {
    const claimed = deps.db
      .prepare(
        `UPDATE payments SET status = 'succeeded', provider_ref = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(sessionId, at, at, payment.id);
    if (Number(claimed.changes) !== 1) return; // already credited (replay) or no longer pending
    credit(deps.db, {
      userId: payment.user_id,
      type: 'topup',
      amountPence: payment.amount_pence,
      description: 'Card top-up',
      reference: payment.id,
      at,
    });
  });
  deps.logger.info('stripe payment credited', { paymentId: payment.id, eventId });
}

function markPayment(deps: Deps, session: StripeSessionObject, status: 'expired' | 'failed', reason: string): void {
  const payment = findPayment(deps, session);
  if (!payment) return;
  const at = deps.now().toISOString();
  deps.db
    .prepare(`UPDATE payments SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
    .run(status, reason, at, payment.id);
}

