'use strict';
/**
 * Business logic for the container lifecycle: create, extend, renew, upgrade,
 * suspend and destroy. Talks to Proxmox and keeps the DB in sync.
 */
const crypto = require('node:crypto');
const { toSql, fromSql } = require('./db');
const { ipForVmid } = require('./proxmox');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const PAID_GRACE_DAYS = 7; // suspended (stopped) paid servers are deleted after this

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;
const SSH_KEY_RE = /^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]+( [^\r\n]{0,200})?$/;

class Provisioner {
  constructor({ db, pve, providers, gateway, config, log = console, events = null }) {
    this.db = db; this.pve = pve; this.providers = providers; this.gateway = gateway; this.config = config; this.log = log;
    this.events = events || { emit() {} };
    this.lock = Promise.resolve(); // serialises VMID allocation
    this.onServersChanged = async () => {}; // set by the VPN service
  }

  provider(s) { return this.providers[s.provider || 'proxmox']; }

  plan(id) {
    const p = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
    if (!p) throw new HttpError(404, 'Unknown plan');
    return p;
  }

  server(id) { return this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id); }

  /** Public JSON representation of a server row. */
  present(s) {
    const plan = this.plan(s.plan_id);
    return {
      id: s.id, hostname: s.hostname, plan: { id: plan.id, name: plan.name, cores: plan.cores, memory_mb: plan.memory_mb, disk_gb: plan.disk_gb },
      state: s.state, error: s.error, vmid: s.vmid,
      ssh: s.ssh_port ? this._ssh(s) : null,
      web_url: s.subdomain && this.gateway ? `https://${s.subdomain}.${this.config.gateway.appsDomain}` : null,
      custom_domain: s.custom_domain,
      provider_kind: s.provider === 'upcloud' ? 'vm' : 'container',
      private_ip: s.ip,
      expires_at: fromSql(s.expires_at).toISOString(),
      created_at: fromSql(s.created_at).toISOString(),
      is_free: plan.price_cents === 0,
    };
  }

  _ssh(s) {
    const host = this.gateway ? this.config.gateway.publicHost : (s.direct_host || this.config.proxmox.publicHost);
    return { host, port: s.ssh_port, user: 'root', command: s.ssh_port === 22 ? `ssh root@${host}` : `ssh root@${host} -p ${s.ssh_port}` };
  }

  async allocateVmid() {
    const run = async () => {
      const { vmidMin, vmidMax } = this.config.proxmox;
      const used = await this.pve.usedVmids();
      for (const r of this.db.prepare("SELECT vmid FROM servers WHERE vmid IS NOT NULL AND state != 'deleted'").all()) used.add(r.vmid);
      for (let id = vmidMin; id <= vmidMax; id++) if (!used.has(id)) return id;
      throw new HttpError(503, 'Out of capacity, please try again later');
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => {});
    return p;
  }

  /**
   * Create a server row and kick off provisioning in the background.
   * Returns { server, rootPassword } – the password is only ever shown once.
   */
  async createServer(userId, planId, { hostname, sshKey } = {}, { expiresAt } = {}) {
    const plan = this.plan(planId);
    hostname = (hostname || `box-${crypto.randomBytes(3).toString('hex')}`).toLowerCase();
    if (!HOSTNAME_RE.test(hostname)) throw new HttpError(400, 'Hostname must be 1-32 chars: a-z, 0-9, dashes');
    if (sshKey) {
      sshKey = sshKey.trim();
      if (!SSH_KEY_RE.test(sshKey)) throw new HttpError(400, 'That does not look like an OpenSSH public key');
    }

    if (plan.price_cents === 0) {
      const mine = this.db.prepare("SELECT COUNT(*) n FROM servers s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? AND p.price_cents=0 AND s.state IN ('provisioning','active','error')").get(userId).n;
      if (mine > 0) throw new HttpError(409, 'You already have a free server. Upgrade in the shop for more!');
      const total = this.db.prepare("SELECT COUNT(*) n FROM servers s JOIN plans p ON p.id=s.plan_id WHERE p.price_cents=0 AND s.state IN ('provisioning','active')").get().n;
      if (total >= this.config.free.maxTotal) throw new HttpError(503, 'Free servers are fully booked right now. Try again later or grab a paid plan.');
      expiresAt = expiresAt || new Date(Date.now() + this.config.free.hoursInitial * HOUR);
    }
    if (!expiresAt) expiresAt = new Date(Date.now() + plan.days * DAY);

    const provider = this.providers[plan.provider];
    if (!provider) throw new HttpError(500, `Provider ${plan.provider} not configured`);
    const vmid = provider.needsVmid ? await this.allocateVmid() : null;
    const info = this.db.prepare(`INSERT INTO servers (user_id, plan_id, provider, vmid, hostname, ip, state, expires_at)
      VALUES (?,?,?,?,?,?, 'provisioning', ?)`).run(userId, plan.id, plan.provider, vmid, hostname, vmid ? ipForVmid(this.config.proxmox, vmid) : null, toSql(expiresAt));
    const id = Number(info.lastInsertRowid);
    const rootPassword = randomPassword();

    // Fire and forget; client polls server state.
    this.events.emit('server.created', { server: this.server(id), userId, planId: plan.id });
    this._provision(id, { password: rootPassword, sshKey, plan }).catch(() => {});
    return { server: this.server(id), rootPassword };
  }

  async _provision(id, { password, sshKey, plan }) {
    const server = this.server(id);
    try {
      const r = await this.provider(server).create({ server, plan, password, sshKey });
      this.db.prepare('UPDATE servers SET node=?, provider_id=?, ip=?, target_ssh_port=?, target_http_port=?, direct_host=? WHERE id=?')
        .run(r.node, r.provider_id, r.ip, r.target_ssh_port, r.target_http_port, r.direct_host || null, id);
      await this._expose(this.server(id), r);
      this.db.prepare("UPDATE servers SET state='active', error=NULL WHERE id=? AND state='provisioning'").run(id);
      this.log.info?.(`[provision] server ${id} (${server.provider}) ready on ${r.node}`);
      this.events.emit('server.ready', { server: this.server(id), userId: server.user_id });
      await this.onServersChanged(server.user_id).catch((e) => this.log.error?.('[vpn]', e.message));
    } catch (e) {
      this.log.error?.(`[provision] server ${id} failed:`, e.message);
      this.db.prepare("UPDATE servers SET state='error', error=? WHERE id=?").run('Provisioning failed. Delete and try again, or contact support.', id);
      this.events.emit('server.error', { server: this.server(id), userId: server.user_id, error: e.message });
    }
  }

  /** Publish the server under our brand via the gateway (or directly if there is none). */
  async _expose(s, r = {}) {
    if (!this.gateway) {
      this.db.prepare('UPDATE servers SET ssh_port=? WHERE id=?').run(r.direct_ssh_port || 22, s.id);
      return;
    }
    const subdomain = s.subdomain || `${s.hostname}-${s.id}`.toLowerCase();
    const g = await this.gateway.expose(`s${s.id}`, {
      target_ip: s.ip, ssh_target_port: s.target_ssh_port || 22, http_target_port: s.target_http_port || 80,
      subdomain, custom_domain: s.custom_domain || null, owner: `u${s.user_id}`,
    });
    this.db.prepare('UPDATE servers SET ssh_port=?, subdomain=? WHERE id=?').run(g.ssh_port, subdomain, s.id);
  }

  async setCustomDomain(s, domain) {
    if (!this.gateway) throw new HttpError(400, 'Custom domains need the gateway');
    domain = domain ? String(domain).trim().toLowerCase() : null;
    if (domain && !/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new HttpError(400, 'Enter a valid domain name');
    if (domain && this.db.prepare("SELECT 1 FROM servers WHERE custom_domain=? AND id!=? AND state!='deleted'").get(domain, s.id)) throw new HttpError(409, 'That domain is already in use');
    this.db.prepare('UPDATE servers SET custom_domain=? WHERE id=?').run(domain, s.id);
    await this._expose(this.server(s.id));
  }

  async power(server, action) {
    if (server.state !== 'active') throw new HttpError(409, `Server is ${server.state}`);
    await this.provider(server).action(server, action);
  }

  async liveStatus(server) {
    if (server.state !== 'active') return null;
    try { return await this.provider(server).status(server); } catch (e) { return { status: 'unknown', error: e.message }; }
  }

  async destroyServer(server) {
    if (server.state === 'deleted') return;
    this.db.prepare("UPDATE servers SET state='deleting' WHERE id=?").run(server.id);
    try {
      await this.provider(server).destroy(server);
      if (this.gateway) await this.gateway.unexpose(`s${server.id}`);
      this.db.prepare("UPDATE servers SET state='deleted', deleted_at=datetime('now'), vmid=NULL WHERE id=?").run(server.id);
      this.events.emit('server.deleted', { server: { ...server, state: 'deleted' }, userId: server.user_id });
      await this.onServersChanged(server.user_id).catch(() => {});
    } catch (e) {
      this.log.error?.(`[destroy] server ${server.id}:`, e.message);
      this.db.prepare("UPDATE servers SET state='error', error='Delete failed, will retry' WHERE id=?").run(server.id);
      throw new HttpError(502, 'Could not delete server right now, please retry');
    }
  }

  /** Free tier: add hours (from a rewarded ad), capped at maxHoursAhead from now. */
  extendFree(server, hours) {
    const now = Date.now();
    const cur = Math.max(fromSql(server.expires_at).getTime(), now);
    const cap = now + this.config.free.maxHoursAhead * HOUR;
    const next = Math.min(cur + hours * HOUR, cap);
    this.db.prepare('UPDATE servers SET expires_at=? WHERE id=?').run(toSql(new Date(next)), server.id);
    return new Date(next);
  }

  /** Apply a paid order (called from Stripe webhook or mock checkout). Idempotent per order. */
  async fulfillOrder(orderId) {
    const order = this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order || order.status === 'fulfilled') return order;
    const plan = this.plan(order.plan_id);
    // Mark first to make double-delivery of webhooks harmless.
    const claimed = this.db.prepare("UPDATE orders SET status='fulfilled' WHERE id=? AND status!='fulfilled'").run(orderId);
    if (claimed.changes === 0) return order;

    try {
      if (order.kind === 'new') {
        const meta = order.meta ? JSON.parse(order.meta) : {};
        const { server, rootPassword } = await this.createServer(order.user_id, plan.id, meta, {});
        this.db.prepare('UPDATE orders SET server_id=?, root_password_once=? WHERE id=?').run(server.id, rootPassword, orderId);
      } else {
        const s = this.server(order.server_id);
        if (!s || s.state === 'deleted') throw new Error('server no longer exists');
        if (order.kind === 'upgrade') {
          const oldPlan = this.plan(s.plan_id);
          if (oldPlan.provider !== plan.provider) throw new Error('cannot move between containers and VMs');
          await this.provider(s).applyPlan(s, plan, oldPlan);
          const wasFree = oldPlan.price_cents === 0;
          const exp = wasFree ? new Date(Date.now() + plan.days * DAY) : fromSql(s.expires_at);
          this.db.prepare('UPDATE servers SET plan_id=?, expires_at=? WHERE id=?').run(plan.id, toSql(exp), s.id);
        } else {
          const base = Math.max(Date.now(), fromSql(s.expires_at).getTime());
          this.db.prepare('UPDATE servers SET expires_at=? WHERE id=?').run(toSql(new Date(base + plan.days * DAY)), s.id);
        }
        if (s.state === 'suspended') {
          await this.provider(s).action(s, 'start');
          this.db.prepare("UPDATE servers SET state='active' WHERE id=?").run(s.id);
        }
      }
    } catch (e) {
      this.log.error?.(`[order] ${orderId} fulfilment failed:`, e.message);
      this.db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(orderId);
    }
    const done = this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    this.events.emit('order.fulfilled', { order: done, userId: done.user_id });
    return done;
  }

  /**
   * Periodic job: free servers are deleted at expiry; paid servers are
   * suspended (stopped) at expiry and deleted after a grace period.
   */
  async reap() {
    const now = toSql(new Date());
    const graceCut = toSql(new Date(Date.now() - PAID_GRACE_DAYS * DAY));
    const expired = this.db.prepare(`SELECT s.*, p.price_cents FROM servers s JOIN plans p ON p.id=s.plan_id
      WHERE s.state IN ('active','suspended','error') AND s.expires_at < ?`).all(now);
    for (const s of expired) {
      try {
        if (s.price_cents === 0 || s.state === 'error' || (s.state === 'suspended' && s.expires_at < graceCut)) {
          await this.destroyServer(s);
          this.log.info?.(`[reaper] deleted server ${s.id}`);
        } else if (s.state === 'active') {
          await this.provider(s).action(s, 'stop').catch(() => {});
          this.db.prepare("UPDATE servers SET state='suspended' WHERE id=?").run(s.id);
          this.log.info?.(`[reaper] suspended server ${s.id}`);
          this.events.emit('server.suspended', { server: this.server(s.id), userId: s.user_id });
        }
      } catch (e) {
        this.log.error?.(`[reaper] server ${s.id}:`, e.message);
      }
    }
    // Retry stuck deletions
    for (const s of this.db.prepare("SELECT * FROM servers WHERE state='deleting' AND created_at < datetime('now','-1 hour')").all()) {
      await this.destroyServer(s).catch(() => {});
    }
  }
}

module.exports = { Provisioner, HttpError, randomPassword };
