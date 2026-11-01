'use strict';
const config = require('./config');
const { createApp } = require('./app');

const { app, prov, oracle, options, wallet, book, db } = createApp(config);
oracle.start();
if (config.marketMaker && wallet.kind === 'local') {
  const { MarketMaker } = require('./trading/mm');
  new MarketMaker({ db, book, oracle }).start();
  console.log('Demo market maker running (MARKET_MAKER=true)');
}
setInterval(() => options.settle().catch((e) => console.error('[options]', e)), 60 * 1000).unref();
setInterval(() => wallet.processOutbox().catch((e) => console.error('[outbox]', e)), 30 * 1000).unref();

app.listen(config.port, () => {
  console.log(`${config.brand} listening on :${config.port}  (proxmox: ${config.proxmox.mock ? 'MOCK' : config.proxmox.url}, stripe: ${config.stripe.secretKey ? 'live' : 'MOCK checkout'})`);
});

// Reaper: expire free servers, suspend/delete unpaid ones.
const tick = () => prov.reap().catch((e) => console.error('[reaper]', e));
setInterval(tick, 60 * 1000).unref();
setTimeout(tick, 5000).unref();
