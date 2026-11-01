# Extending the platform

Everything new is added as a **plugin** (backend) plus a **browser module** (frontend), so features can be developed independently without touching shared files.

## Backend plugin

Create `backend/src/plugins/<name>/index.js`:

```js
'use strict';
const express = require('express');
const { HttpError } = require('../../provisioner');

module.exports = {
  name: 'kyc',                                   // kebab-case; also config[name] and ctx[name]
  web: ['js/kyc.js'],                            // browser modules under web/, loaded after core modules

  schema: `
    CREATE TABLE IF NOT EXISTS kyc_cases (...);  -- must be idempotent
  `,
  migrate(db, { addCols }) { addCols && addCols('users', [['kyc_tier', 'INTEGER NOT NULL DEFAULT 0']]); },

  config(env, { num, bool, list }) {            // -> config.kyc ; tests may pre-set config.kyc to override
    return { required_tier_for_withdraw: num(env.KYC_WITHDRAW_TIER, 1) };
  },

  init(ctx) {                                    // runs once core services exist; return value becomes ctx.kyc
    ctx.hooks.on('withdraw.before', async ({ userId }) => { if (!ok) throw new HttpError(403, 'Verify your identity first'); });
    ctx.events.on('user.registered', ({ user }) => { ... });
    return { tierOf(userId) { ... } };
  },

  routes(app, ctx) {                             // mounted after core routes, before the /api 404
    const r = express.Router();
    r.get('/status', ctx.auth.requireAuth, (req, res) => res.json({ ... }));
    r.get('/admin/queue', ctx.auth.requireAdmin, (req, res) => res.json({ ... }));
    app.use('/api/kyc', r);
  },

  jobs(ctx) {                                    // background timers; return a stop function
    const t = setInterval(() => { ... }, 60000); t.unref();
    return () => clearInterval(t);
  },

  site(ctx) { return { kyc: { tiers: [...] } }; }   // merged into GET /api/site (public!)
};
```

Rules:
* A plugin must **never** `require` another plugin's files. Talk through `ctx.<name>` (check for `undefined`: the other plugin may be disabled), `ctx.hooks` and `ctx.events`.
* Plugin failures are logged and skipped in development, fatal in production (`PLUGINS_STRICT`).
* Errors returned to users must be `HttpError(status, message)` from `provisioner.js`; anything else is reported as "Something went wrong".
* Money is always integer **units** (1e8 per whole coin) via `money.js` (`toUnits`, `fromUnits`, `mulDiv`). Every movement goes through `ctx.wallet.transfer({src, dst, asset, amount, kind, ref})` (throws on insufficient funds) or `ctx.wallet.payout(...)` (never throws; retried from the outbox). Users are `u:<id>`, platform accounts are `sys:<name>` and may go negative.
* Sensitive actions call `ctx.audit(actorId, 'domain.action', details, { targetId, ip })`.
* Use `ctx.log` (`info/warn/error`), never `console` directly.

### `ctx` contents

| key | what |
|---|---|
| `db` | `node:sqlite` DatabaseSync (synchronous). Use `atomic(db, fn)` from `atomic.js` for transactions. |
| `config` | merged config; `config.<plugin>` is yours |
| `auth` | `requireAuth`, `requireAdmin` middlewares, `sign(user)`, `verifyToken(token)` |
| `hooks`, `events`, `audit` | see below |
| `ws` | WebSocket router: `ctx.ws.route('/ws/<x>', (socket, req, { user, url, path }) => ...)`; `WsRouter.send(socket, obj)` |
| `wallet` | unified wallet (`balances(owner)`, `transfer`, `payout`, `assets()`, `asset(sym)`) |
| `book` | shared order book (`place`, `cancel`, `depth`, `trades`, `ticker`, `onChange(fn)`) |
| `spot`, `perps`, `options`, `cards`, `oracle` | trading services |
| `prov`, `providers`, `gateway`, `vpn`, `pve` | cloud services |
| `plugins` | loaded plugin list |
| `startJobs()/stopJobs()/attach(server)` | lifecycle |

### Hooks (can veto)

`await ctx.hooks.run(name, payload)` – handlers run in order; throw `HttpError` to abort. Handlers may mutate the payload (e.g. `payload.extra.requires_2fa = true` on login).

| name | payload |
|---|---|
| `auth.register.before` | `{ email, req, ip }` |
| `auth.login.after` | `{ user, req, ip, extra }` – add fields to `extra` to include them in the login response |
| `withdraw.before` | `{ userId, user, asset, chain, address, amount (units), req }` |
| `trade.before` | `{ product: 'spot'|'cards'|'perps'|'options', userId, user, market, body, req }` |
| `cloud.checkout.before` | `{ userId, user, plan, kind, serverId, amountCents, payWith, req }` |
| `cloud.free.before` | `{ userId, user, body, req }` |
| `vpn.issue.before` | `{ userId, user, req }` |

### Events (after the fact, never block)

`ctx.events.on(name, handler)`; `ctx.events.on('*', (name, payload) => ...)` for everything.

| name | payload |
|---|---|
| `user.registered`, `user.login` | `{ user: {id,email,is_admin}, ip }` |
| `wallet.transfer` | `{ userId, asset, delta (units, signed), kind, ref, tx }` – one per ledger line touching a user |
| `deposit.credited` | `{ userId, asset, amount, ref, tx }` |
| `withdraw.requested` / `withdraw.sent` / `withdraw.rejected` | `{ userId, id, asset, amount, ... }` |
| `order.placed` / `order.filled` / `order.cancelled` | `{ order, userId, market, fills? }` (spot and cards; `market.kind`) |
| `perps.opened` / `perps.closed` / `perps.liquidated` | `{ position, userId, reason?, price? }` |
| `options.bought` / `options.closed` / `options.settled` | `{ position, userId, payout? }` |
| `server.created` / `server.ready` / `server.error` / `server.suspended` / `server.deleted` | `{ server, userId }` |
| `order.fulfilled` | `{ order (cloud order row), userId }` |
| `cards.request.created` / `cards.request.completed` | `{ request, userId, rejected? }` |
| `audit` | `{ actorId, targetId, action, details, ip }` |

Add new events freely from your own domain and document them in your plugin's README.

### Tests

`backend/test/helpers.js` exports `setup(extra)` → `{ call(method, path, body, token), base, wsUrl(path, token), db, ...ctx, close }` with everything mocked (Proxmox, UpCloud, gateway when `extra.gateway`, Stripe off, mock oracle, faucet on). Write `backend/test/<feature>.test.js` with `node:test`; run `npm test` (all) or `node --test test/<feature>.test.js`. Set `config.<plugin>` overrides by passing a modified config: `setup({ config: (c) => { c.kyc.x = 1; } })`.

End-to-end browser checks: Playwright + Chromium are preinstalled (`require('playwright')`, `chromium.launch()`), start the server with `PORT=<free> ... node src/server.js` and the mock env from `.env.example`.

## Browser module

Plain JS, no build step, loaded after `web/js/core.js`. Everything is on `window.App`:

```js
(() => {
  const { $, esc, fmt, api, S, toast, busy, modal, route, every, query, needAuth,
          registerSection, addMenuColumn, addMenuLink, registerAdminTab, registerAccountPanel, registerHeaderWidget, registerHomeTile } = App;

  route(/^\/kyc$/, needAuth(async (view) => { view.innerHTML = '...'; }));          // hash routes: #/kyc
  addMenuLink('exchange', 'Account', ['#/kyc', 'Verification', 'Raise your limits']); // mega menu
  registerAdminTab({ id: 'kyc', label: 'KYC queue', order: 50, async render(pane) { ... } });
  registerAccountPanel({ id: 'kyc', order: 20, wide: false, async render(card) { ... } });
  registerHeaderWidget({ id: 'bell', order: 10, render: () => '<a href="#/notifications">🔔</a>', mount(el) {} });
})();
```

Helpers: `api(method, path, body)` (adds the JWT, throws `Error(message)`), `fmt` (`usd`, `num`, `pct`, `money`, `left`, `date`, `bytes`), `busy(button, asyncFn)` (spinner + error toast), `modal(html, (root, close) => {})`, `every(ms, fn)` (cleared on navigation), `S` (`user`, `token`, `prices`, `spark`, `site`), `App.sparkline(values)`, `App.bookHtml/orderFormHtml/mountOrderForm` (order book widgets), `App.render()` to re-render the current page. Auth pages call `App.authChallenge(response, creds)` when login returns no token (for 2FA) and `App.authPageMounted(mode, form)` after rendering (to add fields such as a captcha).

Styling: reuse classes from `web/styles.css` (`card`, `btn primary|blue|danger|small`, `tabs`, `table.t`, `badge`, `kv`, `notice`, `section-head`, `grid`). Dark theme only; must work at 390px width (no horizontal scroll).

## Mobile app

`mobile/` is Expo. `src/api.js` wraps the same REST API; screens live in `src/screens/`. Nothing in the backend may assume the website is the only client.

## File ownership during parallel work

When several people work at once, each feature owns only its plugin directory, its browser module, its test file and the files listed in its brief. Shared files (`app.js`, `db.js`, `config.js`, `core.js`, `index.html`, `styles.css`, `package.json`) are not edited; if something is truly missing from the framework, note it in the final report instead.
