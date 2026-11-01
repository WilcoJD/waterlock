import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { login, register } from '../services/users.ts';

export function registerAuthRoutes(router: Router, deps: Deps): void {
  router.post('/auth/register', async (ctx) => ({ status: 201, body: await register(deps, ctx.body) }), { rateLimit: 'auth' });
  router.post('/auth/login', async (ctx) => ({ status: 200, body: await login(deps, ctx.body) }), { rateLimit: 'auth' });
}
