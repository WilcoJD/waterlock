'use strict';
/**
 * Client for the white-label gateway agent (tinybox/gateway/agent.js).
 * The gateway owns the public IPs and brand domain:
 *   - SSH:   ssh root@<public_host> -p <allocated port>  -> server:22
 *   - Web:   https://<subdomain>.<apps domain> (and custom domains) -> server:80
 *   - VPN:   one WireGuard peer per user, firewalled to that user's servers
 *   - Egress: servers route through the gateway, so the internet sees our IPs
 */
const crypto = require('node:crypto');

class GatewayClient {
  constructor(cfg) { this.cfg = cfg; }
  get enabled() { return true; }
  async _req(method, path, body) {
    const res = await fetch(this.cfg.url + path, {
      method, headers: { authorization: `Bearer ${this.cfg.token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gateway ${method} ${path} -> ${res.status}: ${data.error || ''}`);
    return data;
  }
  info() { return this._req('GET', '/info'); }
  expose(id, route) { return this._req('PUT', `/routes/${id}`, route); }
  unexpose(id) { return this._req('DELETE', `/routes/${id}`); }
  setPeer(id, peer) { return this._req('PUT', `/peers/${id}`, peer); }
  removePeer(id) { return this._req('DELETE', `/peers/${id}`); }
}

/** In-memory stand-in used in development and tests. */
class MockGateway {
  constructor(cfg) { this.cfg = cfg; this.routes = new Map(); this.peers = new Map(); this.nextPort = 40000; }
  get enabled() { return true; }
  async info() { return { public_host: this.cfg.publicHost, wg_public_key: 'MOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOC=', wg_endpoint: `${this.cfg.publicHost}:51820`, vpn_subnet: '10.99.0.0/16', apps_domain: this.cfg.appsDomain }; }
  async expose(id, r) {
    const prev = this.routes.get(id);
    const ssh_port = prev?.ssh_port || this.nextPort++;
    this.routes.set(id, { ...r, ssh_port });
    return { ssh_port, subdomain: r.subdomain };
  }
  async unexpose(id) { this.routes.delete(id); return { ok: true }; }
  async setPeer(id, p) { this.peers.set(id, p); return { ok: true }; }
  async removePeer(id) { this.peers.delete(id); return { ok: true }; }
}

function createGateway(cfg) {
  if (cfg.mock) return new MockGateway(cfg);
  if (cfg.url) return new GatewayClient(cfg);
  return null; // no gateway: servers are reached directly (not white-labelled)
}

/** WireGuard keypair (raw X25519, base64) generated with Node's crypto. */
function wgKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const b64 = (s) => Buffer.from(s, 'base64url').toString('base64');
  return { publicKey: b64(publicKey.export({ format: 'jwk' }).x), privateKey: b64(privateKey.export({ format: 'jwk' }).d) };
}

module.exports = { createGateway, GatewayClient, MockGateway, wgKeypair };
