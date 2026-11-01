'use strict';
require('dotenv').config();

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes)$/i.test(v));
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

const config = {
  port: num(env.PORT, 8080),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),
  jwtSecret: env.JWT_SECRET || 'dev-insecure-secret',
  dbPath: env.DB_PATH || './data/tinybox.db',
  brand: env.BRAND_NAME || 'TinyBox',
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),

  proxmox: {
    mock: bool(env.PROXMOX_MOCK, true),
    url: (env.PROXMOX_URL || '').replace(/\/$/, ''),
    tokenId: env.PROXMOX_TOKEN_ID || '',
    tokenSecret: env.PROXMOX_TOKEN_SECRET || '',
    insecureTls: bool(env.PROXMOX_INSECURE_TLS, false),
    nodes: list(env.PROXMOX_NODES),
    storage: env.PROXMOX_STORAGE || 'local-lvm',
    template: env.PROXMOX_TEMPLATE || 'local:vztmpl/alpine-3.20-default_20240908_amd64.tar.xz',
    bridge: env.PROXMOX_BRIDGE || 'vmbr1',
    pool: env.PROXMOX_POOL || '',
    vmidMin: num(env.VMID_MIN, 10000),
    vmidMax: num(env.VMID_MAX, 10999),
    natPrefix: env.NAT_SUBNET_PREFIX || '10.77',
    natGateway: env.NAT_GATEWAY || '10.77.0.1',
    publicHost: env.PUBLIC_HOST || 'localhost',
    sshPortBase: num(env.SSH_PORT_BASE, 20000),
  },

  free: {
    hoursInitial: num(env.FREE_HOURS_INITIAL, 4),
    hoursPerAd: num(env.FREE_HOURS_PER_AD, 1),
    maxHoursAhead: num(env.FREE_MAX_HOURS_AHEAD, 24),
    maxAdsPerDay: num(env.FREE_MAX_ADS_PER_DAY, 12),
    maxTotal: num(env.FREE_MAX_TOTAL, 200),
  },

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },

  admob: {
    adUnitIds: list(env.ADMOB_AD_UNIT_IDS),
    allowDevRewards: bool(env.ALLOW_DEV_REWARDS, false),
  },
};

if (process.env.NODE_ENV === 'production') {
  if (config.jwtSecret === 'dev-insecure-secret') throw new Error('JWT_SECRET must be set in production');
  if (config.admob.allowDevRewards) throw new Error('ALLOW_DEV_REWARDS must be false in production');
}

module.exports = config;
