'use strict';
const { wgKeypair } = require('./gateway');
const { HttpError } = require('../provisioner');

/**
 * One WireGuard peer per user on the white-label gateway. The peer can only
 * reach that user's own servers (split tunnel to their private IPs).
 */
class VpnService {
  constructor({ db, gateway, config }) { this.db = db; this.gateway = gateway; this.config = config; }

  vpnIp(userId) {
    const n = userId + 10; // .0.0-.0.9 reserved (gateway is 10.99.0.1)
    if (n > 65000) throw new HttpError(503, 'VPN address pool exhausted');
    return `${this.config.gateway.vpnPrefix}.${n >> 8}.${n & 255}`;
  }

  targets(userId) {
    return this.db.prepare("SELECT ip FROM servers WHERE user_id=? AND state IN ('active','suspended') AND ip IS NOT NULL").all(userId).map((r) => r.ip);
  }

  status(userId) {
    const p = this.db.prepare('SELECT vpn_ip, created_at FROM vpn_peers WHERE user_id=?').get(userId);
    return { enabled: !!this.gateway, configured: !!p, vpn_ip: p?.vpn_ip || null, servers: this.targets(userId) };
  }

  /** (Re)generate the user's keys and return a ready-to-import WireGuard config. */
  async issue(userId) {
    if (!this.gateway) throw new HttpError(400, 'VPN needs the gateway to be configured');
    const info = await this.gateway.info();
    const { publicKey, privateKey } = wgKeypair();
    const vpnIp = this.vpnIp(userId);
    const targets = this.targets(userId);
    await this.gateway.setPeer(`u${userId}`, { public_key: publicKey, vpn_ip: vpnIp, allowed: targets });
    this.db.prepare('INSERT OR REPLACE INTO vpn_peers (user_id, vpn_ip, public_key) VALUES (?,?,?)').run(userId, vpnIp, publicKey);
    const allowed = targets.length ? targets.map((ip) => `${ip}/32`).join(', ') : `${this.config.gateway.privateSubnet}`;
    return [
      `# ${this.config.brand} private network – keep this file secret`,
      '[Interface]',
      `PrivateKey = ${privateKey}`,
      `Address = ${vpnIp}/32`,
      '',
      '[Peer]',
      `PublicKey = ${info.wg_public_key}`,
      `Endpoint = ${info.wg_endpoint}`,
      `AllowedIPs = ${allowed}`,
      'PersistentKeepalive = 25',
      '',
    ].join('\n');
  }

  /** Called when a user's servers change: update which IPs their peer may reach. */
  async sync(userId) {
    if (!this.gateway) return;
    const p = this.db.prepare('SELECT * FROM vpn_peers WHERE user_id=?').get(userId);
    if (!p) return;
    await this.gateway.setPeer(`u${userId}`, { public_key: p.public_key, vpn_ip: p.vpn_ip, allowed: this.targets(userId) });
  }
}

module.exports = { VpnService };
