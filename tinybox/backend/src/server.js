'use strict';
const config = require('./config');
const { createApp } = require('./app');

const { app, prov } = createApp(config);

app.listen(config.port, () => {
  console.log(`${config.brand} listening on :${config.port}  (proxmox: ${config.proxmox.mock ? 'MOCK' : config.proxmox.url}, stripe: ${config.stripe.secretKey ? 'live' : 'MOCK checkout'})`);
});

// Reaper: expire free servers, suspend/delete unpaid ones.
const tick = () => prov.reap().catch((e) => console.error('[reaper]', e));
setInterval(tick, 60 * 1000).unref();
setTimeout(tick, 5000).unref();
