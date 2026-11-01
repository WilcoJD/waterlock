'use strict';
/**
 * Compute providers behind one interface:
 *   proxmox – tiny LXC containers (on your own hosts, or Proxmox nodes running on UpCloud VMs)
 *   upcloud – full VMs resold from UpCloud
 */
const crypto = require('node:crypto');
const { createProxmox, sshPortForVmid } = require('../proxmox');
const { UpCloudClient } = require('./upcloud');
const { cloudInit } = require('./cloudinit');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ProxmoxProvider {
  constructor({ pve, config }) { this.pve = pve; this.config = config; }
  get needsVmid() { return true; }
  async create({ server, plan, password, sshKey }) {
    const node = await this.pve.pickNode();
    await this.pve.createContainer({ node, vmid: server.vmid, hostname: server.hostname, password, sshKey, plan });
    return { node, provider_id: String(server.vmid), ip: server.ip, target_ssh_port: 22, target_http_port: 80,
      direct_host: this.config.proxmox.publicHost, direct_ssh_port: sshPortForVmid(this.config.proxmox, server.vmid) };
  }
  action(s, a) { return this.pve.action(s.node, s.vmid, a); }
  status(s) { return this.pve.status(s.node, s.vmid); }
  applyPlan(s, plan, old) { return this.pve.applyPlan(s.node, s.vmid, plan, old); }
  destroy(s) { return s.node && s.vmid ? this.pve.destroy(s.node, s.vmid) : null; }
}

class MockUpCloud {
  constructor() { this.servers = new Map(); this.n = 2; this.delayMs = 300; }
  async create({ hostname, plan, publicIp }) {
    await sleep(this.delayMs);
    const uuid = crypto.randomUUID();
    const n = this.n++;
    const s = { uuid, hostname, plan, state: 'started', privateIp: `10.88.${n >> 8}.${n & 255}`, publicIp: publicIp ? `203.0.113.${n & 255}` : null, started: Date.now() };
    this.servers.set(uuid, s);
    return { uuid, privateIp: s.privateIp, publicIp: s.publicIp };
  }
  _s(uuid) { const s = this.servers.get(uuid); if (!s) throw new Error('no such server'); return s; }
  async action(uuid, a) { const s = this._s(uuid); s.state = a === 'start' || a === 'reboot' ? 'started' : 'stopped'; if (s.state === 'started') s.started = Date.now(); }
  async status(uuid) {
    const s = this._s(uuid); const run = s.state === 'started';
    return { status: run ? 'running' : 'stopped', uptime: run ? Math.floor((Date.now() - s.started) / 1000) : 0, cpu: run ? Math.random() * 0.2 : 0, cpus: s.plan.cores,
      mem: run ? Math.floor(s.plan.memory_mb * 1048576 * 0.3) : 0, maxmem: s.plan.memory_mb * 1048576, disk: s.plan.disk_gb * 1073741824 * 0.2, maxdisk: s.plan.disk_gb * 1073741824, netin: 0, netout: 0 };
  }
  async applyPlan(uuid, plan) { this._s(uuid).plan = plan; }
  async destroy(uuid) { this.servers.delete(uuid); }
}

class UpCloudProvider {
  constructor({ client, config, gateway }) { this.client = client; this.config = config; this.gateway = gateway; }
  get needsVmid() { return false; }
  async create({ server, plan, password, sshKey }) {
    const c = this.config;
    const userData = cloudInit({ hostname: server.hostname, password, sshKey, brand: c.brand, gatewayIp: this.gateway ? c.gateway.privateIp : null, hideMetadata: c.upcloud.hideMetadata });
    const r = await this.client.create({ hostname: server.hostname, title: `${c.brand} #${server.id}`, plan, userData, publicIp: !this.gateway });
    return { node: c.upcloud.zone, provider_id: r.uuid, ip: r.privateIp, target_ssh_port: 22, target_http_port: 80, direct_host: r.publicIp, direct_ssh_port: 22 };
  }
  action(s, a) { return this.client.action(s.provider_id, a); }
  status(s) { return this.client.status(s.provider_id); }
  applyPlan(s, plan, old) { return this.client.applyPlan(s.provider_id, plan, old); }
  destroy(s) { return s.provider_id ? this.client.destroy(s.provider_id) : null; }
}

function createProviders({ config, gateway, pve }) {
  const up = config.upcloud.mock ? new MockUpCloud() : new UpCloudClient(config.upcloud);
  return {
    proxmox: new ProxmoxProvider({ pve: pve || createProxmox(config.proxmox), config }),
    upcloud: new UpCloudProvider({ client: up, config, gateway }),
  };
}

module.exports = { createProviders, ProxmoxProvider, UpCloudProvider, MockUpCloud };
