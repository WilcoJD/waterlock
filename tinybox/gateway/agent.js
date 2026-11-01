#!/usr/bin/env node
'use strict';
/**
 * White-label gateway agent. Runs on the edge VM that owns the brand's
 * public IPs (on UpCloud, attached to the same private SDN network as the
 * customer servers). The platform backend calls it to:
 *   PUT    /routes/:id   publish a server: SSH port forward + HTTPS subdomain (+ custom domain)
 *   DELETE /routes/:id
 *   PUT    /peers/:id    add/update a user's WireGuard peer (only reaches their servers)
 *   DELETE /peers/:id
 *   GET    /info
 * It applies changes with iptables-restore (own chains only), `wg set`
 * and the Caddy admin API. No dependencies; Node >= 18.
 *
 * Env: AGENT_TOKEN, LISTEN (127.0.0.1:8787 – put it on the private interface),
 *      STATE_FILE, PUBLIC_HOST, APPS_DOMAIN, WAN_IF, LAN_SUBNET, WG_IF, WG_PORT,
 *      PORT_MIN/PORT_MAX, CADDY_ADMIN, CADDY_DNS_JSON (optional ACME DNS provider for the wildcard),
 *      DRY_RUN=1 (print instead of applying)
 */
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');

const E = process.env;
const cfg = {
  token: E.AGENT_TOKEN || '',
  listen: E.LISTEN || '127.0.0.1:8787',
  stateFile: E.STATE_FILE || '/var/lib/platform-gateway/state.json',
  publicHost: E.PUBLIC_HOST || 'ssh.example.cloud',
  appsDomain: E.APPS_DOMAIN || 'apps.example.cloud',
  wan: E.WAN_IF || 'eth0',
  lan: E.LAN_SUBNET || '10.88.0.0/16',
  wg: E.WG_IF || 'wg0',
  wgPort: Number(E.WG_PORT || 51820),
  portMin: Number(E.PORT_MIN || 40000),
  portMax: Number(E.PORT_MAX || 49999),
  caddy: E.CADDY_ADMIN || 'http://127.0.0.1:2019',
  caddyDns: E.CADDY_DNS_JSON ? JSON.parse(E.CADDY_DNS_JSON) : null,
  dry: E.DRY_RUN === '1',
};
if (!cfg.token && !cfg.dry) { console.error('AGENT_TOKEN is required'); process.exit(1); }

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const ID_RE = /^[a-z0-9_-]{1,64}$/i;

// ---------- state ----------
let state = { routes: {}, peers: {} };
try { state = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); } catch {}
function save() {
  if (cfg.dry) return;
  fs.mkdirSync(require('node:path').dirname(cfg.stateFile), { recursive: true });
  fs.writeFileSync(cfg.stateFile + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(cfg.stateFile + '.tmp', cfg.stateFile);
}
function allocPort() {
  const used = new Set(Object.values(state.routes).map((r) => r.ssh_port));
  for (let p = cfg.portMin; p <= cfg.portMax; p++) if (!used.has(p)) return p;
  throw Object.assign(new Error('port pool exhausted'), { status: 503 });
}

// ---------- apply ----------
function rules() {
  const nat = ['*nat', ':PF_DNAT - [0:0]', ':PF_SNAT - [0:0]'];
  const flt = ['*filter', ':PF_FWD - [0:0]',
    '-A PF_FWD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    // abuse protection for customer egress
    `-A PF_FWD -s ${cfg.lan} -p tcp -m multiport --dports 25,465,587 -j REJECT`];
  for (const r of Object.values(state.routes)) {
    nat.push(`-A PF_DNAT -i ${cfg.wan} -p tcp --dport ${r.ssh_port} -j DNAT --to-destination ${r.target_ip}:${r.ssh_target_port}`);
    flt.push(`-A PF_FWD -d ${r.target_ip} -p tcp --dport ${r.ssh_target_port} -m conntrack --ctstate DNAT -j ACCEPT`);
  }
  for (const p of Object.values(state.peers)) for (const ip of p.allowed) flt.push(`-A PF_FWD -i ${cfg.wg} -s ${p.vpn_ip} -d ${ip} -j ACCEPT`);
  flt.push(`-A PF_FWD -i ${cfg.wg} -j DROP`);
  // egress: customer servers reach the internet only via our IPs (white-label SNAT)
  flt.push(`-A PF_FWD -s ${cfg.lan} -o ${cfg.wan} -j ACCEPT`, '-A PF_FWD -j DROP');
  nat.push(`-A PF_SNAT -s ${cfg.lan} -o ${cfg.wan} -j MASQUERADE`);
  return [...nat, 'COMMIT', ...flt, 'COMMIT', ''].join('\n');
}

function caddyConfig() {
  const routes = Object.values(state.routes).map((r) => ({
    match: [{ host: [`${r.subdomain}.${cfg.appsDomain}`, ...(r.custom_domain ? [r.custom_domain] : [])] }],
    handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `${r.target_ip}:${r.http_target_port}` }], headers: { response: { delete: ['Server', 'Via'] } } }],
    terminal: true,
  }));
  routes.push({ handle: [{ handler: 'static_response', status_code: 404, body: 'Not found' }] });
  const policies = [];
  if (cfg.caddyDns) policies.push({ subjects: [`*.${cfg.appsDomain}`], issuers: [{ module: 'acme', challenges: { dns: { provider: cfg.caddyDns } } }] });
  policies.push({ on_demand: true });
  return {
    admin: { listen: cfg.caddy.replace(/^https?:\/\//, '') },
    apps: {
      http: { servers: { edge: { listen: [':443', ':80'], routes } } },
      tls: { automation: { policies, on_demand: { permission: { module: 'http', endpoint: `http://${cfg.listen}/caddy/ask` } } } },
    },
  };
}

function run(cmd, args, input) {
  if (cfg.dry) { console.log('$', cmd, args.join(' ')); if (input) console.log(input); return ''; }
  return execFileSync(cmd, args, { input, encoding: 'utf8' });
}

let jumped = false;
function ensureJumps() {
  if (jumped || cfg.dry) return;
  const ipt = (args) => { try { execFileSync('iptables', args, { stdio: 'ignore' }); return true; } catch { return false; } };
  for (const [table, chain] of [['nat', 'PF_DNAT'], ['nat', 'PF_SNAT'], ['filter', 'PF_FWD']]) ipt(['-t', table, '-N', chain]);
  for (const [table, parent, chain] of [['nat', 'PREROUTING', 'PF_DNAT'], ['nat', 'POSTROUTING', 'PF_SNAT'], ['filter', 'FORWARD', 'PF_FWD']]) {
    if (!ipt(['-t', table, '-C', parent, '-j', chain])) ipt(['-t', table, '-I', parent, '1', '-j', chain]);
  }
  jumped = true;
}

async function apply() {
  ensureJumps();
  run('iptables-restore', ['--noflush'], rules());
  // WireGuard peers
  const want = new Map(Object.values(state.peers).map((p) => [p.public_key, p.vpn_ip]));
  const have = cfg.dry ? [] : run('wg', ['show', cfg.wg, 'peers']).split('\n').filter(Boolean);
  for (const k of have) if (!want.has(k)) run('wg', ['set', cfg.wg, 'peer', k, 'remove']);
  for (const [k, ip] of want) run('wg', ['set', cfg.wg, 'peer', k, 'allowed-ips', `${ip}/32`]);
  // Caddy
  const body = JSON.stringify(caddyConfig());
  if (cfg.dry) { console.log('caddy /load', body); return; }
  const res = await fetch(`${cfg.caddy}/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  if (!res.ok) throw new Error(`caddy load failed: ${res.status} ${await res.text()}`);
}

let applying = Promise.resolve();
const applyQueued = () => (applying = applying.then(apply, apply));

// ---------- HTTP ----------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
  });
}
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const authOk = (req) => {
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(cfg.token);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};
// Only RFC1918 targets: the gateway must never become a relay to arbitrary hosts.
const isPrivateIp = (ip) => {
  const m = IP_RE.exec(String(ip || ''));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((o) => Number(o) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  // Caddy asks before issuing an on-demand certificate: only for domains we route.
  if (url.pathname === '/caddy/ask') {
    const d = url.searchParams.get('domain') || '';
    const ok = Object.values(state.routes).some((r) => r.custom_domain === d || `${r.subdomain}.${cfg.appsDomain}` === d);
    return [ok ? 200 : 404, { ok }];
  }
  if (!cfg.dry && !authOk(req)) return [401, { error: 'unauthorized' }];
  const [, kind, id] = url.pathname.split('/');
  if (req.method === 'GET' && kind === 'info') {
    const pub = cfg.dry ? 'DRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUN=' : run('wg', ['show', cfg.wg, 'public-key']).trim();
    return [200, { public_host: cfg.publicHost, apps_domain: cfg.appsDomain, wg_public_key: pub, wg_endpoint: `${cfg.publicHost}:${cfg.wgPort}`, routes: Object.keys(state.routes).length, peers: Object.keys(state.peers).length }];
  }
  if (!ID_RE.test(id || '')) return [404, { error: 'not found' }];
  if (kind === 'routes' && req.method === 'PUT') {
    const b = await readJson(req);
    if (!isPrivateIp(b.target_ip)) throw bad('target_ip must be an IPv4 address');
    const sub = String(b.subdomain || '').toLowerCase();
    if (!HOST_RE.test(sub) || sub.includes('.')) throw bad('bad subdomain');
    if (b.custom_domain && !HOST_RE.test(b.custom_domain)) throw bad('bad custom_domain');
    const prev = state.routes[id];
    state.routes[id] = {
      target_ip: b.target_ip, ssh_target_port: Number(b.ssh_target_port) || 22, http_target_port: Number(b.http_target_port) || 80,
      subdomain: sub, custom_domain: b.custom_domain || null, owner: String(b.owner || ''), ssh_port: prev?.ssh_port || allocPort(),
    };
    save(); await applyQueued();
    return [200, { ssh_port: state.routes[id].ssh_port, subdomain: sub }];
  }
  if (kind === 'routes' && req.method === 'DELETE') { delete state.routes[id]; save(); await applyQueued(); return [200, { ok: true }]; }
  if (kind === 'peers' && req.method === 'PUT') {
    const b = await readJson(req);
    if (!KEY_RE.test(b.public_key || '')) throw bad('bad public_key');
    if (!isPrivateIp(b.vpn_ip)) throw bad('bad vpn_ip');
    const allowed = (b.allowed || []).filter(isPrivateIp);
    state.peers[id] = { public_key: b.public_key, vpn_ip: b.vpn_ip, allowed };
    save(); await applyQueued();
    return [200, { ok: true }];
  }
  if (kind === 'peers' && req.method === 'DELETE') { delete state.peers[id]; save(); await applyQueued(); return [200, { ok: true }]; }
  return [404, { error: 'not found' }];
}

if (require.main === module) {
  const [host, port] = cfg.listen.split(':');
  http.createServer(async (req, res) => {
    let status, body;
    try { [status, body] = await handle(req, res); } catch (e) { status = e.status || 500; body = { error: e.status ? e.message : 'internal error' }; if (!e.status) console.error(e); }
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
  }).listen(Number(port), host, () => {
    console.log(`gateway agent on ${cfg.listen}${cfg.dry ? ' (DRY RUN)' : ''}`);
    applyQueued().catch((e) => console.error('initial apply failed:', e.message));
  });
}

module.exports = { rules, caddyConfig, state, cfg };
