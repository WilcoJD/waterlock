'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dbm = require('../src/db');
const { MockProxmox } = require('../src/proxmox');
const { createApp } = require('../src/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { setup, waitActive } = require('./helpers');



test('full user journey', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { call } = s;

  // Auth
  assert.equal((await call('POST', '/api/auth/register', { email: 'bad', password: 'x' })).status, 400);
  const reg = await call('POST', '/api/auth/register', { email: 'Alice@x.io', password: 'password1' });
  assert.equal(reg.status, 201);
  assert.equal((await call('POST', '/api/auth/register', { email: 'alice@x.io', password: 'password1' })).status, 409);
  assert.equal((await call('POST', '/api/auth/login', { email: 'alice@x.io', password: 'nope-nope' })).status, 401);
  const { token } = (await call('POST', '/api/auth/login', { email: 'alice@x.io', password: 'password1' })).body;
  assert.ok(token);
  assert.equal((await call('GET', '/api/servers')).status, 401);

  // Plans
  const plans = (await call('GET', '/api/shop/plans')).body.plans;
  assert.equal(plans[0].id, 'free');

  // Free server
  assert.equal((await call('POST', '/api/servers/free', { hostname: 'Bad_Name!' }, token)).status, 400);
  const created = await call('POST', '/api/servers/free', { hostname: 'mybox' }, token);
  assert.equal(created.status, 201);
  assert.ok(created.body.root_password.length >= 12);
  assert.equal(created.body.server.private_ip, '10.77.0.2');
  const freeId = created.body.server.id;
  const detail = await waitActive(call, freeId, token);
  assert.equal(detail.server.ssh.port, 20000, 'no gateway: direct proxmox port forward');
  assert.equal(detail.server.ssh.host, 'pve.test');
  assert.equal(detail.server.state, 'active');
  assert.equal(detail.live.status, 'running');
  assert.equal((await call('POST', '/api/servers/free', {}, token)).status, 409, 'only one free server');

  // Power
  assert.equal((await call('POST', `/api/servers/${freeId}/stop`, {}, token)).body.live.status, 'stopped');
  assert.equal((await call('POST', `/api/servers/${freeId}/start`, {}, token)).body.live.status, 'running');
  assert.equal((await call('POST', `/api/servers/${freeId}/explode`, {}, token)).status, 404);

  // Ads: dev reward
  const before = new Date(detail.server.expires_at).getTime();
  const rew = await call('POST', '/api/ads/dev-reward', { server_id: freeId }, token);
  assert.equal(rew.status, 200);
  assert.ok(Math.abs(new Date(rew.body.expires_at).getTime() - before - 3600e3) < 5000);

  // Ads: AdMob SSV
  const me = (await call('GET', '/api/auth/me', null, token)).body.user;
  const fields = { ad_network: '5450213213286189855', ad_unit: '1234', custom_data: String(freeId), reward_amount: '1', reward_item: 'hour', timestamp: String(Date.now()), transaction_id: 'tx1', user_id: String(me.id) };
  const q = s.signSsv(fields);
  assert.equal((await call('GET', `/api/ads/admob-ssv?${q}`)).status, 200);
  assert.equal((await call('GET', `/api/ads/admob-ssv?${q}`)).status, 200, 'replay is a harmless no-op');
  const tampered = q.replace('custom_data=', 'custom_data=9');
  assert.equal((await call('GET', `/api/ads/admob-ssv?${tampered}`)).status, 400);
  const st = (await call('GET', '/api/ads/status', null, token)).body;
  assert.equal(st.ads_today, 2);
  await call('POST', '/api/ads/dev-reward', { server_id: freeId }, token);
  assert.equal((await call('POST', '/api/ads/dev-reward', { server_id: freeId }, token)).status, 429, 'daily cap');

  // Shop: buy a new paid server (mock checkout)
  const co = await call('POST', '/api/shop/checkout', { plan_id: 'micro', hostname: 'paid1' }, token);
  assert.equal(co.status, 200);
  assert.ok(co.body.mock);
  const ord = await call('GET', `/api/shop/orders/${co.body.order_id}`, null, token);
  assert.equal(ord.body.order.status, 'fulfilled');
  assert.ok(ord.body.root_password);
  assert.equal((await call('GET', `/api/shop/orders/${co.body.order_id}`, null, token)).body.root_password, null, 'password shown once');
  const paidId = ord.body.server.id;
  await waitActive(call, paidId, token);

  // Renew paid, can't renew free
  const exp0 = new Date((await call('GET', `/api/servers/${paidId}`, null, token)).body.server.expires_at).getTime();
  const rn = await call('POST', '/api/shop/checkout', { kind: 'renew', server_id: paidId }, token);
  assert.equal(rn.status, 200, JSON.stringify(rn.body));
  const exp1 = new Date((await call('GET', `/api/servers/${paidId}`, null, token)).body.server.expires_at).getTime();
  assert.ok(Math.abs(exp1 - exp0 - 30 * 86400e3) < 5000);
  assert.equal((await call('POST', '/api/shop/checkout', { kind: 'renew', server_id: freeId }, token)).status, 400);

  // Upgrade free -> nano
  assert.equal((await call('POST', '/api/shop/checkout', { kind: 'upgrade', server_id: paidId, plan_id: 'nano' }, token)).status, 400, 'no downgrade');
  const up = await call('POST', '/api/shop/checkout', { kind: 'upgrade', server_id: freeId, plan_id: 'nano' }, token);
  assert.equal(up.status, 200);
  const upgraded = (await call('GET', `/api/servers/${freeId}`, null, token)).body.server;
  assert.equal(upgraded.plan.id, 'nano');
  assert.equal(upgraded.is_free, false);
  assert.equal(s.pve.cts.get(upgraded.vmid).plan.id, 'nano');

  // Other users can't touch it
  const bob = (await call('POST', '/api/auth/register', { email: 'bob@x.io', password: 'password2' })).body.token;
  assert.equal((await call('GET', `/api/servers/${freeId}`, null, bob)).status, 404);
  assert.equal((await call('DELETE', `/api/servers/${freeId}`, null, bob)).status, 404);

  // Capacity: range has 3 vmids, 2 used
  const b1 = await call('POST', '/api/servers/free', {}, bob);
  assert.equal(b1.status, 201);
  const carol = (await call('POST', '/api/auth/register', { email: 'carol@x.io', password: 'password3' })).body.token;
  assert.equal((await call('POST', '/api/servers/free', {}, carol)).status, 503);

  // Delete
  assert.equal((await call('DELETE', `/api/servers/${paidId}`, null, token)).status, 200);
  assert.equal((await call('GET', '/api/servers', null, token)).body.servers.length, 1);
  assert.equal(s.pve.cts.size, 2);

  // Admin
  assert.equal((await call('GET', '/api/admin/stats', null, token)).status, 403);
  const admin = (await call('POST', '/api/auth/register', { email: 'admin@x.io', password: 'password4' })).body.token;
  const stats = (await call('GET', '/api/admin/stats', null, admin)).body;
  assert.equal(stats.users, 4);
});

test('reaper deletes expired free servers and suspends expired paid ones', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { call, db, prov } = s;
  const { token } = (await call('POST', '/api/auth/register', { email: 'r@x.io', password: 'password1' })).body;
  const free = (await call('POST', '/api/servers/free', {}, token)).body.server;
  await waitActive(call, free.id, token);
  const co = await call('POST', '/api/shop/checkout', { plan_id: 'nano' }, token);
  const paidId = (await call('GET', `/api/shop/orders/${co.body.order_id}`, null, token)).body.server.id;
  await waitActive(call, paidId, token);

  db.prepare("UPDATE servers SET expires_at=datetime('now','-1 minute')").run();
  await prov.reap();
  assert.equal(prov.server(free.id).state, 'deleted');
  assert.equal(prov.server(paidId).state, 'suspended');
  assert.equal(s.pve.cts.get(prov.server(paidId).vmid).status, 'stopped');

  // Renewing a suspended server brings it back
  await call('POST', '/api/shop/checkout', { kind: 'renew', server_id: paidId }, token);
  assert.equal(prov.server(paidId).state, 'active');
  assert.equal(s.pve.cts.get(prov.server(paidId).vmid).status, 'running');

  // After the grace period it is deleted
  db.prepare("UPDATE servers SET state='suspended', expires_at=datetime('now','-8 day') WHERE id=?").run(paidId);
  await prov.reap();
  assert.equal(prov.server(paidId).state, 'deleted');
  assert.equal(s.pve.cts.size, 0);
});
