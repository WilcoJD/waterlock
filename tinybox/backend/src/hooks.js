'use strict';
const { EventEmitter } = require('node:events');

/**
 * Hooks let plugins veto or amend an action before it happens. Handlers run
 * in registration order and may be async; throwing an HttpError aborts the
 * action and the error is returned to the user.
 *
 *   ctx.hooks.on('withdraw.before', async ({ userId, asset, amount, req }) => { if (...) throw new HttpError(403, 'KYC required'); });
 *   await ctx.hooks.run('withdraw.before', payload);
 *
 * Hook names used by the core (payload fields in docs/EXTENDING.md):
 *   auth.register.before, auth.login.before, auth.login.after,
 *   withdraw.before, trade.before (product: spot|cards|perps|options),
 *   cloud.checkout.before, cloud.free.before, vpn.issue.before
 */
class Hooks {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(fn);
    return () => { const a = this.handlers.get(name); const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  }
  async run(name, payload = {}) {
    for (const fn of this.handlers.get(name) || []) await fn(payload);
    return payload;
  }
  has(name) { return (this.handlers.get(name) || []).length > 0; }
}

/**
 * Events are fire-and-forget notifications after something happened. A
 * listener that throws is logged, never propagated.
 *
 * Event names emitted by the core (see docs/EXTENDING.md for payloads):
 *   user.registered, user.login,
 *   wallet.transfer, withdraw.requested, withdraw.sent, withdraw.rejected, deposit.credited,
 *   order.placed, order.filled, order.cancelled,
 *   perps.opened, perps.closed, perps.liquidated, options.bought, options.closed, options.settled,
 *   server.created, server.ready, server.error, server.suspended, server.deleted, order.fulfilled,
 *   cards.request.created, cards.request.completed,
 *   audit
 */
class Events extends EventEmitter {
  constructor(log = console) { super(); this.log = log; this.setMaxListeners(200); }
  emit(name, payload) {
    for (const fn of this.listeners(name)) {
      try {
        const r = fn(payload);
        if (r && typeof r.catch === 'function') r.catch((e) => this.log.error?.(`[event ${name}]`, e.message));
      } catch (e) { this.log.error?.(`[event ${name}]`, e.message); }
    }
    for (const fn of this.listeners('*')) { try { fn(name, payload); } catch {} }
    return true;
  }
}

module.exports = { Hooks, Events };
