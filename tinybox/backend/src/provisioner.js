'use strict';
/**
 * Business logic for the container lifecycle: create, extend, renew, upgrade,
 * suspend and destroy. Talks to Proxmox and keeps the DB in sync.
 */
const crypto = require('node:crypto');
const { toSql, fromSql } = require('./db');
const { ipForVmid, sshPortForVmid } = require('./proxmox');

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
  constructor({ db, pve, config, log = console }) {
    this.db = db; this.pve = pve; this.config = config; this.log = log;
    this.lock = Promise.resolve(); // serialises VMID allocation
  }

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
      ssh: s.ssh_port ? { host: this.config.proxmox.publicHost, port: s.ssh_port, user: 'root', command: `ssh root@${this.config.proxmox.publicHost} -p ${s.ssh_port}` } : null,
      private_ip: s.ip,
      expires_at: fromSql(s.expires_at).toISOString(),
      created_at: fromSql(s.created_at).toISOString(),
      is_free: plan.price_cents === 0,
    };
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

    const vmid = await this.allocateVmid();
    const info = this.db.prepare(`INSERT INTO servers (user_id, plan_id, vmid, hostname, ip, ssh_port, state, expires_at)
      VALUES (?,?,?,?,?,?, 'provisioning', ?)`).run(userId, plan.id, vmid, hostname, ipForVmid(this.config.proxmox, vmid), sshPortForVmid(this.config.proxmox, vmid), toSql(expiresAt));
    const id = Number(info.lastInsertRowid);
    const rootPassword = randomPassword();

    // Fire and forget; client polls server state.
    this._provision(id, { vmid, hostname, password: rootPassword, sshKey, plan }).catch(() => {});
    return { server: this.server(id), rootPassword };
  }

  async _provision(id, { vmid, hostname, password, sshKey, plan }) {
    try {
      const node = await this.pve.pickNode();
      this.db.prepare('UPDATE servers SET node=? WHERE id=?').run(node, id);
      await this.pve.createContainer({ node, vmid, hostname, password, sshKey, plan });
      this.db.prepare("UPDATE servers SET state='active', error=NULL WHERE id=? AND state='provisioning'").run(id);
      this.log.info?.(`[provision] server ${id} vmid ${vmid} ready on ${node}`);
    } catch (e) {
      this.log.error?.(`[provision] server ${id} failed:`, e.message);
      this.db.prepare("UPDATE servers SET state='error', error=? WHERE id=?").run('Provisioning failed. Delete and try again, or contact support.', id);
    }
  }

  async power(server, action) {
    if (server.state !== 'active') throw new HttpError(409, `Server is ${server.state}`);
    await this.pve.action(server.node, server.vmid, action);
  }

  async liveStatus(server) {
    if (server.state !== 'active') return null;
    try { return await this.pve.status(server.node, server.vmid); } catch (e) { return { status: 'unknown', error: e.message }; }
  }

  async destroyServer(server) {
    if (server.state === 'deleted') return;
    this.db.prepare("UPDATE servers SET state='deleting' WHERE id=?").run(server.id);
    try {
      if (server.node && server.vmid) await this.pve.destroy(server.node, server.vmid);
      this.db.prepare("UPDATE servers SET state='deleted', deleted_at=datetime('now'), vmid=NULL WHERE id=?").run(server.id);
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
        const { server, rootPassword } = await this.createServer(order.user_id, plan.id, meta);
        this.db.prepare('UPDATE orders SET server_id=?, root_password_once=? WHERE id=?').run(server.id, rootPassword, orderId);
      } else {
        const s = this.server(order.server_id);
        if (!s || s.state === 'deleted') throw new Error('server no longer exists');
        if (order.kind === 'upgrade') {
          const oldPlan = this.plan(s.plan_id);
          await this.pve.applyPlan(s.node, s.vmid, plan, oldPlan);
          const wasFree = oldPlan.price_cents === 0;
          const exp = wasFree ? new Date(Date.now() + plan.days * DAY) : fromSql(s.expires_at);
          this.db.prepare('UPDATE servers SET plan_id=?, expires_at=? WHERE id=?').run(plan.id, toSql(exp), s.id);
        } else {
          const base = Math.max(Date.now(), fromSql(s.expires_at).getTime());
          this.db.prepare('UPDATE servers SET expires_at=? WHERE id=?').run(toSql(new Date(base + plan.days * DAY)), s.id);
        }
        if (s.state === 'suspended') {
          await this.pve.action(s.node, s.vmid, 'start');
          this.db.prepare("UPDATE servers SET state='active' WHERE id=?").run(s.id);
        }
      }
    } catch (e) {
      this.log.error?.(`[order] ${orderId} fulfilment failed:`, e.message);
      this.db.prepare("UPDATE orders SET status='failed' WHERE id=?").run(orderId);
    }
    return this.db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
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
          await this.pve.action(s.node, s.vmid, 'stop').catch(() => {});
          this.db.prepare("UPDATE servers SET state='suspended' WHERE id=?").run(s.id);
          this.log.info?.(`[reaper] suspended server ${s.id}`);
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
