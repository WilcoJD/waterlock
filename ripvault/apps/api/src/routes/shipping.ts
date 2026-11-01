import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import {
  cancelShipment,
  createAddress,
  createShipment,
  deleteAddress,
  getShipment,
  listAddresses,
  listShipments,
  quoteShipping,
} from '../services/shipping.ts';

export function registerShippingRoutes(router: Router, deps: Deps): void {
  const auth = { auth: 'user' } as const;
  router.get('/addresses', (ctx) => ({ status: 200, body: listAddresses(deps, ctx.user!.id) }), auth);
  router.post('/addresses', (ctx) => ({ status: 201, body: createAddress(deps, ctx.user!, ctx.body) }), auth);
  router.delete(
    '/addresses/:id',
    (ctx) => {
      deleteAddress(deps, ctx.user!.id, ctx.params.id!);
      return { status: 204 };
    },
    auth,
  );
  router.get('/shipping/quote', (ctx) => ({ status: 200, body: quoteShipping(deps, ctx.user!.id, ctx.query) }), auth);
  router.get('/shipments', (ctx) => ({ status: 200, body: listShipments(deps, ctx.user!.id) }), auth);
  router.post('/shipments', (ctx) => ({ status: 201, body: createShipment(deps, ctx.user!, ctx.body) }), {
    auth: 'user',
    idempotent: 'sync',
  });
  router.get('/shipments/:id', (ctx) => ({ status: 200, body: getShipment(deps, ctx.user!.id, ctx.params.id!) }), auth);
  router.post('/shipments/:id/cancel', (ctx) => ({ status: 200, body: cancelShipment(deps, ctx.user!, ctx.params.id!) }), auth);
}
