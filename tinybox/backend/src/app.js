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

/**
 * Build the Express app. Everything is injectable so tests can pass an
 * in-memory DB, mock Proxmox, fake Stripe and test SSV keys.
 */
function createApp(config, overrides = {}) {
  const log = overrides.log || console;
  const db = overrides.db || dbm.open(config.dbPath);
  const pve = overrides.pve || createProxmox(config.proxmox);
  const stripe = overrides.stripe !== undefined ? overrides.stripe
    : config.stripe.secretKey ? require('stripe')(config.stripe.secretKey) : null;
  const gateway = overrides.gateway !== undefined ? overrides.gateway : createGateway(config.gateway);
  const providers = overrides.providers || createProviders({ config, gateway, pve });
  const prov = new Provisioner({ db, pve, providers, gateway, config, log });
  const vpn = new VpnService({ db, gateway, config });
  prov.onServersChanged = (userId) => vpn.sync(userId);
  const auth = makeAuth({ db, config });

  // One wallet for every product
  const wallet = overrides.wallet || createWallet({ db, config, log });
  const book = new OrderBook({ db, wallet, log });
  const spot = createSpot({ db, book, wallet, config });
  const oracle = overrides.oracle || new PriceOracle({ source: config.oracle.source, log });
  const perps = new PerpsEngine({ db, wallet, oracle, config, log });
  const options = new OptionsEngine({ db, wallet, oracle, config, log });
  const cards = new CardsExchange({ db, book });

  const ctx = { db, config, pve, stripe, prov, auth, log, ssvKeys: overrides.ssvKeys, gateway, providers, vpn, wallet, book, spot, oracle, perps, options, cards };

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors());

  // Stripe needs the raw body for signature verification.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/shop').webhook(ctx));

  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => { req.body = req.body || {}; next(); });

  app.get('/api/health', (req, res) => res.json({ ok: true, mock: config.proxmox.mock, stripe: !!stripe }));
  app.get('/api/site', (req, res) => res.json({
    brand: config.brand, wallet: wallet.kind, spot: spot.kind, derivatives: config.derivativesEnabled,
    oracle: config.oracle.source, white_label: !!gateway, faucet: config.wallet.allowFaucet && wallet.kind === 'local',
  }));
  app.use('/api/auth', require('./routes/auth')(ctx));
  app.use('/api/servers', require('./routes/servers')(ctx));
  app.use('/api/shop', require('./routes/shop')(ctx));
  app.use('/api/ads', require('./routes/ads')(ctx));
  app.use('/api/admin', require('./routes/admin')(ctx));
  app.use('/api/wallet', require('./routes/wallet')(ctx));
  app.use('/api/vpn', require('./routes/vpn')(ctx));
  app.use('/api/cards', require('./routes/cards')(ctx));
  app.use('/api', require('./routes/trade')(ctx));
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

  return { app, ...ctx };
}

module.exports = { createApp };
