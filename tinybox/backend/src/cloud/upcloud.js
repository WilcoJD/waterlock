'use strict';
/**
 * UpCloud API client (https://developers.upcloud.com/1.3/) for reselling
 * cloud servers. Servers are created with ONLY a private SDN interface; the
 * white-label gateway gives them internet access (SNAT through our IPs) and
 * publishes SSH/HTTP under our brand, so customers never see UpCloud.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class UpCloudClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = 'https://api.upcloud.com/1.3';
    this.auth = cfg.token ? `Bearer ${cfg.token}` : 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  }

  async req(method, path, body) {
    const res = await fetch(this.base + path, {
      method, headers: { authorization: this.auth, 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const e = new Error(`UpCloud ${method} ${path} -> ${res.status}: ${data?.error?.error_message || text.slice(0, 300)}`);
      e.status = res.status; e.code = data?.error?.error_code;
      throw e;
    }
    return data;
  }

  async get(uuid) { return (await this.req('GET', `/server/${uuid}`)).server; }

  async waitState(uuid, want, timeoutMs = 300000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const s = await this.get(uuid);
      if (s.state === want) return s;
      if (s.state === 'error') throw new Error('UpCloud server entered error state');
      await sleep(3000);
    }
    throw new Error(`Timed out waiting for server to be ${want}`);
  }

  async create({ hostname, title, plan, userData, publicIp }) {
    const iface = [{ type: 'private', network: this.cfg.network, ip_addresses: { ip_address: [{ family: 'IPv4' }] }, source_ip_filtering: 'yes' }];
    if (publicIp) iface.push({ type: 'public', ip_addresses: { ip_address: [{ family: 'IPv4' }] } });
    const r = await this.req('POST', '/server', {
      server: {
        zone: this.cfg.zone, title, hostname, plan: plan.provider_plan, metadata: 'yes',
        storage_devices: { storage_device: [{ action: 'clone', storage: this.cfg.template, title: `${hostname}-disk`, size: plan.disk_gb, tier: 'maxiops' }] },
        networking: { interfaces: { interface: iface } },
        login_user: { username: 'root', create_password: 'no' },
        user_data: userData,
        labels: { label: [{ key: 'managed-by', value: 'platform' }] },
      },
    });
    const uuid = r.server.uuid;
    const s = await this.waitState(uuid, 'started');
    const ifs = s.networking?.interfaces?.interface || [];
    const priv = ifs.find((i) => i.type === 'private')?.ip_addresses?.ip_address?.[0]?.address;
    const pub = ifs.find((i) => i.type === 'public')?.ip_addresses?.ip_address?.[0]?.address;
    return { uuid, privateIp: priv, publicIp: pub, storage: s.storage_devices?.storage_device?.[0]?.storage };
  }

  async action(uuid, action) {
    if (action === 'start') { await this.req('POST', `/server/${uuid}/start`); return this.waitState(uuid, 'started'); }
    if (action === 'stop' || action === 'shutdown') {
      await this.req('POST', `/server/${uuid}/stop`, { stop_server: { stop_type: action === 'stop' ? 'hard' : 'soft', timeout: 60 } });
      return this.waitState(uuid, 'stopped');
    }
    if (action === 'reboot') {
      await this.req('POST', `/server/${uuid}/restart`, { restart_server: { stop_type: 'soft', timeout: 60, timeout_action: 'destroy' } });
      await sleep(3000);
      return this.waitState(uuid, 'started');
    }
    throw new Error('bad action');
  }

  async status(uuid) {
    const s = await this.get(uuid);
    const map = { started: 'running', stopped: 'stopped', maintenance: 'busy', error: 'error' };
    return { status: map[s.state] || s.state, cpus: Number(s.core_number), maxmem: Number(s.memory_amount) * 1048576 };
  }

  /** Resize: UpCloud requires the server to be stopped. Disks only grow. */
  async applyPlan(uuid, plan, oldPlan) {
    const s = await this.get(uuid);
    if (s.state !== 'stopped') { await this.req('POST', `/server/${uuid}/stop`, { stop_server: { stop_type: 'soft', timeout: 120 } }); await this.waitState(uuid, 'stopped'); }
    await this.req('PUT', `/server/${uuid}`, { server: { plan: plan.provider_plan } });
    const disk = s.storage_devices?.storage_device?.[0]?.storage;
    if (disk && oldPlan && plan.disk_gb > oldPlan.disk_gb) await this.req('PUT', `/storage/${disk}`, { storage: { size: plan.disk_gb } });
    await this.action(uuid, 'start');
  }

  async destroy(uuid) {
    let s;
    try { s = await this.get(uuid); } catch (e) { if (e.status === 404) return; throw e; }
    if (s.state !== 'stopped') { await this.req('POST', `/server/${uuid}/stop`, { stop_server: { stop_type: 'hard' } }).catch(() => {}); await this.waitState(uuid, 'stopped', 120000); }
    await this.req('DELETE', `/server/${uuid}?storages=1&backups=delete`);
  }
}

module.exports = { UpCloudClient };
