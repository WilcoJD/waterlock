import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { getFairness, listOpenings, rotateSeed, verifyOpening } from '../services/fairness.ts';

export function registerFairnessRoutes(router: Router, deps: Deps): void {
  const auth = { auth: 'user' } as const;
  router.get('/fairness', (ctx) => ({ status: 200, body: getFairness(deps, ctx.user!.id) }), auth);
  router.post('/fairness/rotate', (ctx) => ({ status: 200, body: rotateSeed(deps, ctx.user!, ctx.body) }), auth);
  router.get('/openings', (ctx) => ({ status: 200, body: listOpenings(deps, ctx.user!.id, ctx.query) }), auth);
  router.get('/openings/:id/verify', (ctx) => ({ status: 200, body: verifyOpening(deps, ctx.user!.id, ctx.params.id!) }), auth);
}
