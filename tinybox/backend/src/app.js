'use strict';
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const dbm = require('./db');
const { createProxmox } = require('./proxmox');
const { Provisioner, HttpError } = require('./provisioner');
const { makeAuth } = require('./auth');
const { createProviders } = require('./cloud/providers');
const { createGateway } = require('./cloud/gateway');
const { VpnService } = require('./cloud/vpn');
const { createWallet } = require('./wallet');
const { OrderBook } = require('./trading/book');
const { createSpot } = require('./trading/spot');
const { PriceOracle } = require('./trading/oracle');
const { PerpsEngine } = require('./trading/perps');
const { OptionsEngine } = require('./trading/options');
const { CardsExchange } = require('./trading/cards');
const { loadPlugins } = require('./plugins');
const { Hooks, Events } = require('./hooks');
const { WsRouter } = require('./ws');
const { helpers: cfgHelpers } = require('./config');

const CORE_WEB_MODULES = ['js/core.js', 'js/account.js', 'js/cloud.js', 'js/wallet.js', 'js/exchange.js', 'js/derivatives.js', 'js/cards.js', 'js/admin.js'];

/**
 * Build the Express app. Everything is injectable so tests can pass an
 * in-memory DB, mock Proxmox, fake Stripe and test SSV keys.
 *
 * Returns the context object (`ctx`) that plugins and routes receive, plus:
 *   app        the Express app
 *   attach(s)  attach WebSocket handling to an http.Server
 *   startJobs()/stopJobs()  background timers (reaper, oracle, settlement, plugin jobs)
 */
function createApp(config, overrides = {}) {
  const log = overrides.log || console;
  const plugins = overrides.plugins || loadPlugins({ log, strict: config.plugins?.strict });

  // Plugin config sections (tests may pre-set config[name] to override).
  for (const p of plugins) {
    if (typeof p.config === 'function') {
      try { config[p.name] = { ...p.config(process.env, cfgHelpers), ...(config[p.name] || {}) }; }
      catch (e) { if (config.plugins?.strict) throw e; log.error?.(`[plugins] ${p.name} config failed: ${e.message}`); }
    }
  }

  const db = overrides.db || dbm.open(config.dbPath, {
    schemas: plugins.filter((p) => p.schema).map((p) => ({ name: p.name, sql: p.schema })),
    migrations: plugins.filter((p) => p.migrate).map((p) => ({ name: p.name, fn: p.migrate })),
    log, strict: config.plugins?.strict,
  });
  if (overrides.db) {
    // Tests hand us an open DB: still apply plugin schemas to it.
    for (const p of plugins) { if (p.schema) db.exec(p.schema); if (p.migrate) p.migrate(db, {}); }
  }

  const hooks = new Hooks();
  const events = new Events(log);
  const audit = (actorId, action, details = {}, { targetId = null, ip = null } = {}) => {
    db.prepare('INSERT INTO audit_log (actor_id, target_id, action, details, ip) VALUES (?,?,?,?,?)').run(actorId, targetId, action, JSON.stringify(details), ip);
    events.emit('audit', { actorId, targetId, action, details, ip });
  };

  const pve = overrides.pve || createProxmox(config.proxmox);
  const stripe = overrides.stripe !== undefined ? overrides.stripe
    : config.stripe.secretKey ? require('stripe')(config.stripe.secretKey) : null;
  const gateway = overrides.gateway !== undefined ? overrides.gateway : createGateway(config.gateway);
  const providers = overrides.providers || createProviders({ config, gateway, pve });
  const prov = new Provisioner({ db, pve, providers, gateway, config, log, events });
  const vpn = new VpnService({ db, gateway, config });
  prov.onServersChanged = (userId) => vpn.sync(userId);
  const auth = makeAuth({ db, config });

  // One wallet for every product
  const wallet = overrides.wallet || createWallet({ db, config, log });
  wallet.events = events;
  const book = new OrderBook({ db, wallet, log, events });
  const spot = createSpot({ db, book, wallet, config });
  const oracle = overrides.oracle || new PriceOracle({ source: config.oracle.source, log });
  const perps = new PerpsEngine({ db, wallet, oracle, config, log, events });
  const options = new OptionsEngine({ db, wallet, oracle, config, log, events });
  const cards = new CardsExchange({ db, book, events });
  const ws = new WsRouter({ auth, log });

  const ctx = {
    db, config, log, plugins, hooks, events, audit, ws,
    pve, stripe, prov, auth, ssvKeys: overrides.ssvKeys, gateway, providers, vpn,
    wallet, book, spot, oracle, perps, options, cards,
  };

  // Plugin services
  for (const p of plugins) {
    if (typeof p.init === 'function') {
      try { const svc = p.init(ctx); if (svc !== undefined) ctx[p.name] = svc; }
      catch (e) { if (config.plugins?.strict) throw e; log.error?.(`[plugins] ${p.name} init failed: ${e.message}`); }
    }
  }

  const app = express();
  ctx.app = app;
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors());

  // Stripe needs the raw body for signature verification.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/shop').webhook(ctx));

  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => { req.body = req.body || {}; next(); });

  app.get('/api/health', (req, res) => res.json({ ok: true, mock: config.proxmox.mock, stripe: !!stripe }));
  app.get('/api/site', (req, res) => {
    const site = {
      brand: config.brand, wallet: wallet.kind, spot: spot.kind, derivatives: config.derivativesEnabled,
      oracle: config.oracle.source, white_label: !!gateway, faucet: config.wallet.allowFaucet && wallet.kind === 'local',
      modules: plugins.flatMap((p) => p.web || []),
      plugins: plugins.map((p) => p.name),
    };
    for (const p of plugins) if (typeof p.site === 'function') { try { Object.assign(site, p.site(ctx)); } catch (e) { log.error?.(`[plugins] ${p.name} site failed: ${e.message}`); } }
    res.json(site);
  });
  app.use('/api/auth', require('./routes/auth')(ctx));
  app.use('/api/servers', require('./routes/servers')(ctx));
  app.use('/api/shop', require('./routes/shop')(ctx));
  app.use('/api/ads', require('./routes/ads')(ctx));
  app.use('/api/admin', require('./routes/admin')(ctx));
  app.use('/api/wallet', require('./routes/wallet')(ctx));
  app.use('/api/vpn', require('./routes/vpn')(ctx));
  app.use('/api/cards', require('./routes/cards')(ctx));
  app.use('/api', require('./routes/trade')(ctx));

  // Plugin routes
  for (const p of plugins) {
    if (typeof p.routes === 'function') {
      try { p.routes(app, ctx); } catch (e) { if (config.plugins?.strict) throw e; log.error?.(`[plugins] ${p.name} routes failed: ${e.message}`); }
    }
  }
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Website
  app.use(express.static(path.join(__dirname, '..', '..', 'web'), { extensions: ['html'] }));

  // Errors (Express 5 forwards async rejections here)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error?.('[error]', req.method, req.originalUrl, err);
    const safe = err instanceof HttpError || (err.expose && status < 500);
    res.status(status).json({ error: safe ? err.message : 'Something went wrong' });
  });

  // ---- background jobs ----
  let stops = [];
  ctx.startJobs = () => {
    if (stops.length) return;
    const every = (ms, fn, label) => { const t = setInterval(() => Promise.resolve().then(fn).catch((e) => log.error?.(`[${label}]`, e)), ms); t.unref?.(); stops.push(() => clearInterval(t)); };
    oracle.start(); stops.push(() => oracle.stop());
    every(60 * 1000, () => prov.reap(), 'reaper');
    every(60 * 1000, () => options.settle(), 'options');
    every(30 * 1000, () => wallet.processOutbox(), 'outbox');
    if (config.marketMaker && wallet.kind === 'local') {
      const { MarketMaker } = require('./trading/mm');
      const mm = new MarketMaker({ db, book, oracle, log }); mm.start(); stops.push(() => clearTimeout(mm.t));
      log.info?.('Demo market maker running (MARKET_MAKER=true)');
    }
    for (const p of plugins) {
      if (typeof p.jobs === 'function') {
        try { const stop = p.jobs(ctx); if (typeof stop === 'function') stops.push(stop); }
        catch (e) { if (config.plugins?.strict) throw e; log.error?.(`[plugins] ${p.name} jobs failed: ${e.message}`); }
      }
    }
  };
  ctx.stopJobs = () => { for (const s of stops.splice(0)) { try { s(); } catch {} } ws.close(); };
  ctx.attach = (server) => { ws.attach(server); return server; };

  return { app, ...ctx, CORE_WEB_MODULES };
}

module.exports = { createApp };
