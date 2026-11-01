'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const dbm = require('../src/db');
const { MockProxmox } = require('../src/proxmox');
const { createApp } = require('../src/app');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeConfig(extra = {}) {
  const { helpers, ...base } = require('../src/config');
  const c = structuredClone(base);
  Object.assign(c, { port: 0, publicUrl: 'http://localhost', jwtSecret: 'test', dbPath: ':memory:', brand: 'TinyBox', adminEmails: ['admin@x.io'], marketMaker: false, derivativesEnabled: true });
  c.proxmox = { ...c.proxmox, mock: true, vmidMin: 10000, vmidMax: 10002, natPrefix: '10.77', natGateway: '10.77.0.1', publicHost: 'pve.test', sshPortBase: 20000, nodes: [] };
  c.free = { hoursInitial: 4, hoursPerAd: 1, maxHoursAhead: 24, maxAdsPerDay: 3, maxTotal: 100 };
  c.stripe = { secretKey: '', webhookSecret: '' };
  c.admob = { adUnitIds: [], allowDevRewards: true };
  c.upcloud = { ...c.upcloud, mock: true };
  c.gateway = { ...c.gateway, mock: !!extra.gateway, url: '', publicHost: 'ssh.brand.test', appsDomain: 'apps.brand.test' };
  c.opex = { ...c.opex, enabled: false };
  c.wallet = { allowFaucet: true };
  c.oracle = { source: 'mock' };
  return c;
}

async function setup(extra = {}) {
  const config = makeConfig(extra);
  if (typeof extra.config === 'function') extra.config(config);
  const pve = new MockProxmox(config.proxmox); pve.delayMs = 5;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ssvKeys = new Map([['42', publicKey.export({ type: 'spki', format: 'pem' })]]);
  const silent = { info() {}, warn() {}, error: console.error };
  const { PriceOracle } = require('../src/trading/oracle');
  const oracle = new PriceOracle({ source: 'mock', log: silent });
  const ctx = createApp(config, { db: dbm.open(':memory:'), pve, stripe: null, ssvKeys, log: silent, oracle });
  if (ctx.providers.upcloud.client) ctx.providers.upcloud.client.delayMs = 5;
  const srv = ctx.app.listen(0);
  ctx.attach(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  const signSsv = (fields) => {
    const q = new URLSearchParams(fields).toString();
    const sig = crypto.sign('sha256', Buffer.from(q), privateKey).toString('base64url');
    return `${q}&signature=${sig}&key_id=42`;
  };
  const wsUrl = (path, token) => `ws://127.0.0.1:${srv.address().port}${path}${token ? `?token=${token}` : ''}`;
  return { ...ctx, srv, base, call, wsUrl, signSsv, close: () => { ctx.stopJobs(); srv.close(); } };
}

async function waitActive(call, id, token) {
  for (let i = 0; i < 50; i++) {
    const r = await call('GET', `/api/servers/${id}`, null, token);
    if (r.body.server.state !== 'provisioning') return r.body;
    await sleep(10);
  }
  throw new Error('never became active');
}

module.exports = { setup, waitActive, makeConfig };
