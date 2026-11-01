'use strict';
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const dbm = require('./db');
const { createProxmox } = require('./proxmox');
const { Provisioner, HttpError } = require('./provisioner');
const { makeAuth } = require('./auth');

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
  const prov = new Provisioner({ db, pve, config, log });
  const auth = makeAuth({ db, config });
  const ctx = { db, config, pve, stripe, prov, auth, log, ssvKeys: overrides.ssvKeys };

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors());

  // Stripe needs the raw body for signature verification.
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/shop').webhook(ctx));

  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => { req.body = req.body || {}; next(); });

  app.get('/api/health', (req, res) => res.json({ ok: true, mock: config.proxmox.mock, stripe: !!stripe }));
  app.use('/api/auth', require('./routes/auth')(ctx));
  app.use('/api/servers', require('./routes/servers')(ctx));
  app.use('/api/shop', require('./routes/shop')(ctx));
  app.use('/api/ads', require('./routes/ads')(ctx));
  app.use('/api/admin', require('./routes/admin')(ctx));
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
