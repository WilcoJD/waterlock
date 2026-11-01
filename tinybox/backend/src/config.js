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

  // ---- Cloud: UpCloud reselling + white-label gateway ----
  upcloud: {
    mock: bool(env.UPCLOUD_MOCK, true),
    token: env.UPCLOUD_TOKEN || '',
    username: env.UPCLOUD_USERNAME || '',
    password: env.UPCLOUD_PASSWORD || '',
    zone: env.UPCLOUD_ZONE || 'de-fra1',
    template: env.UPCLOUD_TEMPLATE || '',          // storage UUID of a cloud-init OS template
    network: env.UPCLOUD_NETWORK || '',            // private SDN network UUID shared with the gateway
    hideMetadata: bool(env.UPCLOUD_HIDE_METADATA, true),
  },
  gateway: {
    mock: bool(env.GATEWAY_MOCK, false),
    url: (env.GATEWAY_URL || '').replace(/\/$/, ''),
    token: env.GATEWAY_TOKEN || '',
    publicHost: env.GATEWAY_PUBLIC_HOST || 'ssh.example.cloud',
    appsDomain: env.GATEWAY_APPS_DOMAIN || 'apps.example.cloud',
    privateIp: env.GATEWAY_PRIVATE_IP || '10.88.0.1',
    privateSubnet: env.GATEWAY_PRIVATE_SUBNET || '10.88.0.0/16',
    vpnPrefix: env.VPN_PREFIX || '10.99',
  },

  // ---- Unified wallet / OPEX ----
  wallet: {
    allowFaucet: bool(env.ALLOW_FAUCET, false),     // dev only: free test funds
  },
  opex: {
    enabled: bool(env.OPEX_ENABLED, false),
    apiUrl: (env.OPEX_API_URL || 'http://localhost:8094').replace(/\/$/, ''),
    walletUrl: (env.OPEX_WALLET_URL || 'http://wallet:8080').replace(/\/$/, ''),   // INTERNAL network only
    keycloakUrl: (env.OPEX_KEYCLOAK_URL || 'http://keycloak:8080').replace(/\/$/, ''),
    realm: env.OPEX_REALM || 'opex',
    clientId: env.OPEX_CLIENT_ID || 'web-app',
    clientSecret: env.OPEX_CLIENT_SECRET || '',
    keycloakAdminUser: env.OPEX_KEYCLOAK_ADMIN_USER || 'admin',
    keycloakAdminPass: env.OPEX_KEYCLOAK_ADMIN_PASS || '',
    usernamePrefix: env.OPEX_USERNAME_PREFIX || 'pf_',
    secretKey: env.OPEX_SECRET_KEY || '',
    systemAccounts: env.OPEX_SYSTEM_ACCOUNTS ? JSON.parse(env.OPEX_SYSTEM_ACCOUNTS) : {}, // {"default":"<uuid>","fees":"<uuid>"}
    gateways: env.OPEX_GATEWAYS ? JSON.parse(env.OPEX_GATEWAYS) : {},                  // {"USDT:TRC20":"<gatewayUuid>"}
    spotPairs: list(env.OPEX_SPOT_PAIRS).length ? list(env.OPEX_SPOT_PAIRS) : ['BTC_USDT', 'ETH_USDT'],
  },

  // ---- Derivatives ----
  oracle: { source: env.ORACLE_SOURCE || 'mock' },   // mock | coinbase
  marketMaker: bool(env.MARKET_MAKER, false),         // dev liquidity bot (local wallet only)
  derivativesEnabled: bool(env.DERIVATIVES_ENABLED, true),
  perps: {
    symbols: ['BTC', 'ETH', 'SOL'],
    maxLeverage: num(env.PERPS_MAX_LEVERAGE, 20),
    feeBps: num(env.PERPS_FEE_BPS, 5),
    spread: num(env.PERPS_SPREAD, 0.0002),
    maintenance: num(env.PERPS_MAINTENANCE, 0.005),
    minMargin: env.PERPS_MIN_MARGIN || '1',
    maxNotionalPerUser: num(env.PERPS_MAX_NOTIONAL, 50000),
  },
  options: {
    symbols: ['BTC', 'ETH', 'SOL'],
    iv: { BTC: num(env.IV_BTC, 0.55), ETH: num(env.IV_ETH, 0.65), SOL: num(env.IV_SOL, 0.85) },
    strikeStep: { BTC: 1000, ETH: 50, SOL: 5 },
    strikesEachSide: 6,
    dailyExpiries: 3,
    weeklyExpiries: 3,
    spread: num(env.OPTIONS_SPREAD, 0.05),
    minPremium: 0.5,
    minQty: 0.01,
    feeRate: 0.0003,
    maxPremiumPerUser: num(env.OPTIONS_MAX_PREMIUM, 10000),
  },

  plugins: { strict: bool(env.PLUGINS_STRICT, process.env.NODE_ENV === 'production') },

  admob: {
    adUnitIds: list(env.ADMOB_AD_UNIT_IDS),
    allowDevRewards: bool(env.ALLOW_DEV_REWARDS, false),
  },
};

if (process.env.NODE_ENV === 'production') {
  if (config.jwtSecret === 'dev-insecure-secret') throw new Error('JWT_SECRET must be set in production');
  if (config.admob.allowDevRewards) throw new Error('ALLOW_DEV_REWARDS must be false in production');
  if (config.wallet.allowFaucet) throw new Error('ALLOW_FAUCET must be false in production');
  if (config.marketMaker) throw new Error('MARKET_MAKER (demo liquidity) must be false in production');
}

module.exports = config;
module.exports.helpers = { num, bool, list };
