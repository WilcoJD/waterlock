import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { createWithdrawal, devTopup, getWallet, listWithdrawals, stripeTopup } from '../services/wallet.ts';

export function registerWalletRoutes(router: Router, deps: Deps): void {
  router.get('/wallet', (ctx) => ({ status: 200, body: getWallet(deps, ctx.user!.id, ctx.query) }), { auth: 'user' });

  // Stripe top-ups await the Stripe API, so they use the async idempotency path; dev top-ups are synchronous.
  if (deps.config.stripe) {
    router.post('/wallet/topup', async (ctx) => ({ status: 200, body: await stripeTopup(deps, ctx.user!, ctx.body) }), {
      auth: 'user',
      idempotent: 'async',
    });
  } else {
    router.post('/wallet/topup', (ctx) => ({ status: 200, body: devTopup(deps, ctx.user!, ctx.body) }), {
      auth: 'user',
      idempotent: 'sync',
    });
  }

  router.get('/wallet/withdrawals', (ctx) => ({ status: 200, body: listWithdrawals(deps, ctx.user!.id) }), { auth: 'user' });
  router.post('/wallet/withdrawals', (ctx) => ({ status: 201, body: createWithdrawal(deps, ctx.user!, ctx.body) }), {
    auth: 'user',
    idempotent: 'sync',
  });
}
