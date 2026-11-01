import { publicAppConfig } from '../config.ts';
import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { getPackDetail, listPacks } from '../services/packs.ts';
import { handleStripeWebhook } from '../services/stripe.ts';

const RETURN_PAGE = (title: string, message: string, status: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b1020;color:#f8fafc;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0;padding:16px;text-align:center}main{max-width:420px}
a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:12px;background:#f59e0b;color:#111827;
text-decoration:none;font-weight:600}</style></head>
<body><main><h1>${title}</h1><p>${message}</p><a href="ripvault://wallet?topup=${status}">Return to the app</a></main></body></html>`;

export function registerPublicRoutes(router: Router, deps: Deps): void {
  router.get('/health', () => ({ status: 200, body: { ok: true, time: deps.now().toISOString() } }));
  router.get('/config', () => ({ status: 200, body: publicAppConfig(deps.config) }));
  router.get('/packs', () => ({ status: 200, body: listPacks(deps) }));
  router.get('/packs/:id', (ctx) => ({ status: 200, body: getPackDetail(deps, ctx.params.id!) }));

  router.get('/payments/return', (ctx) => {
    const status = ctx.query.get('status') === 'success' ? 'success' : 'cancel';
    const html =
      status === 'success'
        ? RETURN_PAGE('Payment received', 'Thanks! Your balance updates as soon as the payment is confirmed.', status)
        : RETURN_PAGE('Payment cancelled', 'No money was taken. You can try again from the app.', status);
    return { status: 200, html };
  });

  router.post(
    '/webhooks/stripe',
    (ctx) => {
      const sig = ctx.headers['stripe-signature'];
      return { status: 200, body: handleStripeWebhook(deps, ctx.rawBody, Array.isArray(sig) ? sig[0] : sig) };
    },
    { rawBody: true, maxBodyBytes: 512 * 1024 },
  );
}
