'use strict';
/**
 * Minimal Proxmox VE API client for LXC containers, using API-token auth.
 * Also exports a MockProxmox with the same interface so the whole stack
 * runs without a real cluster (PROXMOX_MOCK=true).
 */
const https = require('node:https');
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ipForVmid(cfg, vmid) {
  const n = vmid - cfg.vmidMin + 2; // .0.0 network, .0.1 gateway
  return `${cfg.natPrefix}.${n >> 8}.${n & 255}`;
}
function sshPortForVmid(cfg, vmid) {
  return cfg.sshPortBase + (vmid - cfg.vmidMin);
}

class ProxmoxClient {
  constructor(cfg) {
    this.cfg = cfg;
    const u = new URL(cfg.url);
    this.base = u;
    this.mod = u.protocol === 'http:' ? http : https;
    this.agent = new this.mod.Agent({ keepAlive: true, rejectUnauthorized: !cfg.insecureTls });
  }

  request(method, path, params) {
    const body = params && method !== 'GET' && method !== 'DELETE'
      ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString()
      : null;
    let fullPath = '/api2/json' + path;
    if (params && (method === 'GET' || method === 'DELETE')) {
      const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
      if (qs) fullPath += '?' + qs;
    }
    const headers = { Authorization: `PVEAPIToken=${this.cfg.tokenId}=${this.cfg.tokenSecret}` };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    return new Promise((resolve, reject) => {
      const req = this.mod.request({
        hostname: this.base.hostname,
        port: this.base.port || (this.base.protocol === 'http:' ? 80 : 443),
        path: fullPath, method, headers, agent: this.agent, timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            const err = new Error(`Proxmox ${method} ${path} -> ${res.statusCode} ${res.statusMessage}: ${data.slice(0, 500)}`);
            err.status = res.statusCode;
            return reject(err);
          }
          try { resolve(JSON.parse(data).data); } catch { resolve(null); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Proxmox request timeout')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  async waitTask(node, upid, timeoutMs = 180000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const st = await this.request('GET', `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
      if (st && st.status === 'stopped') {
        if (st.exitstatus !== 'OK') throw new Error(`Proxmox task failed: ${st.exitstatus}`);
        return st;
      }
      await sleep(1000);
    }
    throw new Error('Proxmox task timed out');
  }

  /** Online node with the most free memory (optionally restricted to cfg.nodes). */
  async pickNode() {
    const nodes = (await this.request('GET', '/nodes'))
      .filter((n) => n.status === 'online')
      .filter((n) => !this.cfg.nodes.length || this.cfg.nodes.includes(n.node));
    if (!nodes.length) throw new Error('No online Proxmox nodes available');
    nodes.sort((a, b) => (b.maxmem - b.mem) - (a.maxmem - a.mem));
    return nodes[0].node;
  }

  async usedVmids() {
    const res = await this.request('GET', '/cluster/resources', { type: 'vm' });
    return new Set(res.map((r) => r.vmid));
  }

  async createContainer({ node, vmid, hostname, password, sshKey, plan }) {
    const c = this.cfg;
    const params = {
      vmid,
      hostname,
      ostemplate: c.template,
      storage: c.storage,
      rootfs: `${c.storage}:${plan.disk_gb}`,
      cores: plan.cores,
      cpulimit: plan.cpulimit,
      memory: plan.memory_mb,
      swap: plan.swap_mb,
      net0: `name=eth0,bridge=${c.bridge},ip=${ipForVmid(c, vmid)}/16,gw=${c.natGateway},firewall=1,rate=${(plan.net_rate_mbps / 8).toFixed(3)}`,
      nameserver: '1.1.1.1 9.9.9.9',
      unprivileged: 1,
      features: 'nesting=1',
      onboot: 1,
      start: 1,
      password,
      description: `Managed by TinyBox. plan=${plan.id}`,
      tags: `tinybox;${plan.id}`,
    };
    if (sshKey) params['ssh-public-keys'] = sshKey;
    if (c.pool) params.pool = c.pool;
    const upid = await this.request('POST', `/nodes/${node}/lxc`, params);
    await this.waitTask(node, upid);
  }

  async action(node, vmid, action) {
    if (!['start', 'stop', 'shutdown', 'reboot'].includes(action)) throw new Error('bad action');
    const upid = await this.request('POST', `/nodes/${node}/lxc/${vmid}/status/${action}`, {});
    await this.waitTask(node, upid, 120000);
  }

  async status(node, vmid) {
    const s = await this.request('GET', `/nodes/${node}/lxc/${vmid}/status/current`);
    return {
      status: s.status, uptime: s.uptime, cpu: s.cpu, cpus: s.cpus,
      mem: s.mem, maxmem: s.maxmem, disk: s.disk, maxdisk: s.maxdisk,
      netin: s.netin, netout: s.netout,
    };
  }

  async applyPlan(node, vmid, plan, oldPlan) {
    await this.request('PUT', `/nodes/${node}/lxc/${vmid}/config`, {
      cores: plan.cores, cpulimit: plan.cpulimit, memory: plan.memory_mb, swap: plan.swap_mb,
      net0: `name=eth0,bridge=${this.cfg.bridge},ip=${ipForVmid(this.cfg, vmid)}/16,gw=${this.cfg.natGateway},firewall=1,rate=${(plan.net_rate_mbps / 8).toFixed(3)}`,
      tags: `tinybox;${plan.id}`,
    });
    if (oldPlan && plan.disk_gb > oldPlan.disk_gb) {
      // Disks can only grow.
      const upid = await this.request('PUT', `/nodes/${node}/lxc/${vmid}/resize`, { disk: 'rootfs', size: `${plan.disk_gb}G` });
      if (typeof upid === 'string' && upid.startsWith('UPID')) await this.waitTask(node, upid);
    }
  }

  async destroy(node, vmid) {
    try {
      const s = await this.status(node, vmid);
      if (s.status === 'running') await this.action(node, vmid, 'stop');
    } catch (e) {
      if (e.status === 500 && /does not exist/.test(e.message)) return; // already gone
      if (e.status !== 500) throw e;
    }
    const upid = await this.request('DELETE', `/nodes/${node}/lxc/${vmid}`, { purge: 1, 'destroy-unreferenced-disks': 1 });
    await this.waitTask(node, upid);
  }
}

/** In-memory fake used for development, tests and demos. */
class MockProxmox {
  constructor(cfg) { this.cfg = cfg; this.cts = new Map(); this.delayMs = 300; }
  async pickNode() { return 'mock-node'; }
  async usedVmids() { return new Set(this.cts.keys()); }
  async createContainer({ vmid, hostname, plan }) {
    await sleep(this.delayMs);
    this.cts.set(vmid, { hostname, plan, status: 'running', started: Date.now() });
  }
  async action(node, vmid, action) {
    const ct = this.cts.get(vmid); if (!ct) throw new Error('no such container');
    await sleep(this.delayMs / 3);
    ct.status = action === 'start' || action === 'reboot' ? 'running' : 'stopped';
    if (ct.status === 'running') ct.started = Date.now();
  }
  async status(node, vmid) {
    const ct = this.cts.get(vmid); if (!ct) throw new Error('no such container');
    const run = ct.status === 'running';
    return {
      status: ct.status, uptime: run ? Math.floor((Date.now() - ct.started) / 1000) : 0,
      cpu: run ? Math.random() * 0.1 : 0, cpus: ct.plan.cores,
      mem: run ? Math.floor(ct.plan.memory_mb * 1048576 * (0.2 + Math.random() * 0.2)) : 0,
      maxmem: ct.plan.memory_mb * 1048576,
      disk: Math.floor(ct.plan.disk_gb * 1073741824 * 0.3), maxdisk: ct.plan.disk_gb * 1073741824,
      netin: 0, netout: 0,
    };
  }
  async applyPlan(node, vmid, plan) { const ct = this.cts.get(vmid); if (ct) ct.plan = plan; }
  async destroy(node, vmid) { await sleep(this.delayMs / 3); this.cts.delete(vmid); }
}

function createProxmox(cfg) {
  return cfg.mock ? new MockProxmox(cfg) : new ProxmoxClient(cfg);
}

module.exports = { createProxmox, ProxmoxClient, MockProxmox, ipForVmid, sshPortForVmid };
