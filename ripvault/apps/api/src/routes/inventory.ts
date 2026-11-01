import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { getInventoryItem, listInventory, sellItems } from '../services/inventory.ts';

export function registerInventoryRoutes(router: Router, deps: Deps): void {
  router.get('/inventory', (ctx) => ({ status: 200, body: listInventory(deps, ctx.user!.id, ctx.query) }), { auth: 'user' });
  router.post('/inventory/sell', (ctx) => ({ status: 200, body: sellItems(deps, ctx.user!, ctx.body) }), {
    auth: 'user',
    idempotent: 'sync',
  });
  router.get('/inventory/:id', (ctx) => ({ status: 200, body: getInventoryItem(deps, ctx.user!.id, ctx.params.id!) }), {
    auth: 'user',
  });
}
