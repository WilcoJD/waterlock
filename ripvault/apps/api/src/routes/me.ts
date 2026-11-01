import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { buildMe, updateLimits, updateMe } from '../services/users.ts';

export function registerMeRoutes(router: Router, deps: Deps): void {
  router.get('/me', (ctx) => ({ status: 200, body: buildMe(deps, ctx.user!.id) }), { auth: 'user' });
  router.patch('/me', (ctx) => ({ status: 200, body: updateMe(deps, ctx.user!, ctx.body) }), { auth: 'user' });
  router.put('/me/limits', (ctx) => ({ status: 200, body: updateLimits(deps, ctx.user!, ctx.body) }), { auth: 'user' });
}
