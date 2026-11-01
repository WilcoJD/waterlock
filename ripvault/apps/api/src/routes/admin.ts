import type { Deps } from '../deps.ts';
import type { Router } from '../http/router.ts';
import { syncPrices } from '../prices/sync.ts';
import {
  adminListShipments,
  adminListWithdrawals,
  adminUpdateShipment,
  adminUpdateWithdrawal,
  packReport,
  setCardStock,
  setPackActive,
  setPackOdds,
} from '../services/admin.ts';

export function registerAdminRoutes(router: Router, deps: Deps): void {
  const admin = { auth: 'admin' } as const;
  router.get('/admin/shipments', (ctx) => ({ status: 200, body: adminListShipments(deps, ctx.query) }), admin);
  router.patch('/admin/shipments/:id', (ctx) => ({ status: 200, body: adminUpdateShipment(deps, ctx.params.id!, ctx.body) }), admin);
  router.get('/admin/withdrawals', (ctx) => ({ status: 200, body: adminListWithdrawals(deps, ctx.query) }), admin);
  router.patch(
    '/admin/withdrawals/:id',
    (ctx) => ({ status: 200, body: adminUpdateWithdrawal(deps, ctx.user!, ctx.params.id!, ctx.body) }),
    admin,
  );
  router.get('/admin/packs/:id/report', (ctx) => ({ status: 200, body: packReport(deps, ctx.params.id!) }), admin);
  router.put('/admin/packs/:id/odds', (ctx) => ({ status: 200, body: setPackOdds(deps, ctx.user!, ctx.params.id!, ctx.body) }), admin);
  // Switch a pack on/off (e.g. re-enable one the RTP guard switched off; refused while it is over max RTP).
  router.put('/admin/packs/:id/active', (ctx) => ({ status: 200, body: setPackActive(deps, ctx.params.id!, ctx.body) }), admin);
  router.put('/admin/cards/:id/stock', (ctx) => ({ status: 200, body: setCardStock(deps, ctx.params.id!, ctx.body) }), admin);
  router.post('/admin/prices/sync', async () => ({ status: 200, body: await syncPrices(deps) }), admin);
}
