import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { openPack } from '../services/packs.ts';

export function registerPackRoutes(router: Router, deps: Deps): void {
  router.post('/packs/:id/open', (ctx) => ({ status: 200, body: openPack(deps, ctx.user!, ctx.params.id!, ctx.body) }), {
    auth: 'user',
    idempotent: 'sync',
  });
}
