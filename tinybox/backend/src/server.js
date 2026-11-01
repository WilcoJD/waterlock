'use strict';
const config = require('./config');
const { createApp } = require('./app');

const ctx = createApp(config);
const server = ctx.app.listen(config.port, () => {
  console.log(`${config.brand} listening on :${config.port}  (proxmox: ${config.proxmox.mock ? 'MOCK' : config.proxmox.url}, upcloud: ${config.upcloud.mock ? 'MOCK' : config.upcloud.zone}, wallet: ${ctx.wallet.kind}, stripe: ${config.stripe.secretKey ? 'live' : 'MOCK checkout'}, plugins: ${ctx.plugins.map((p) => p.name).join(', ') || 'none'})`);
});
ctx.attach(server);
ctx.startJobs();

const shutdown = () => { ctx.stopJobs(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
