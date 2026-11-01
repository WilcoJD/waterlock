'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Plans sold in the shop. "free" is the ad-supported tier.
// Free containers are throttled (CPU limit + network rate) to discourage abuse.
const DEFAULT_PLANS = [
  { id: 'free',  name: 'Free Tiny',  cores: 1, cpulimit: 0.25, memory_mb: 128,  swap_mb: 64,  disk_gb: 1,  net_rate_mbps: 1,   price_cents: 0,    days: 0,  sort: 0 },
  { id: 'nano',  name: 'Nano',       cores: 1, cpulimit: 0.5,  memory_mb: 256,  swap_mb: 128, disk_gb: 3,  net_rate_mbps: 10,  price_cents: 199,  days: 30, sort: 1 },
  { id: 'micro', name: 'Micro',      cores: 1, cpulimit: 1,    memory_mb: 512,  swap_mb: 256, disk_gb: 8,  net_rate_mbps: 25,  price_cents: 399,  days: 30, sort: 2 },
  { id: 'small', name: 'Small',      cores: 2, cpulimit: 2,    memory_mb: 1024, swap_mb: 512, disk_gb: 16, net_rate_mbps: 50,  price_cents: 699,  days: 30, sort: 3 },
  { id: 'medium',name: 'Medium',     cores: 4, cpulimit: 4,    memory_mb: 4096, swap_mb: 1024,disk_gb: 40, net_rate_mbps: 100, price_cents: 1999, days: 30, sort: 4 },
  // Full virtual machines resold from UpCloud (provider_plan = UpCloud plan name)
  { id: 'vm-1', name: 'Cloud VM 1', cores: 1, cpulimit: 1, memory_mb: 1024,  swap_mb: 0, disk_gb: 25,  net_rate_mbps: 1000, price_cents: 900,  days: 30, sort: 10, provider: 'upcloud', provider_plan: '1xCPU-1GB' },
  { id: 'vm-2', name: 'Cloud VM 2', cores: 1, cpulimit: 1, memory_mb: 2048,  swap_mb: 0, disk_gb: 50,  net_rate_mbps: 1000, price_cents: 1500, days: 30, sort: 11, provider: 'upcloud', provider_plan: '1xCPU-2GB' },
  { id: 'vm-4', name: 'Cloud VM 4', cores: 2, cpulimit: 2, memory_mb: 4096,  swap_mb: 0, disk_gb: 80,  net_rate_mbps: 1000, price_cents: 2900, days: 30, sort: 12, provider: 'upcloud', provider_plan: '2xCPU-4GB' },
  { id: 'vm-8', name: 'Cloud VM 8', cores: 4, cpulimit: 4, memory_mb: 8192,  swap_mb: 0, disk_gb: 160, net_rate_mbps: 1000, price_cents: 5500, days: 30, sort: 13, provider: 'upcloud', provider_plan: '4xCPU-8GB' },
].map((p) => ({ provider: 'proxmox', provider_plan: null, ...p }));

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cores INTEGER NOT NULL,
      cpulimit REAL NOT NULL,
      memory_mb INTEGER NOT NULL,
      swap_mb INTEGER NOT NULL,
      disk_gb INTEGER NOT NULL,
      net_rate_mbps INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      days INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      provider TEXT NOT NULL DEFAULT 'proxmox',    -- proxmox (LXC) | upcloud (VM)
      provider_plan TEXT                           -- e.g. UpCloud plan name '1xCPU-1GB'
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      plan_id TEXT NOT NULL REFERENCES plans(id),
      vmid INTEGER UNIQUE,
      node TEXT,
      hostname TEXT NOT NULL,
      ip TEXT,
      ssh_port INTEGER,
      state TEXT NOT NULL DEFAULT 'provisioning', -- provisioning|active|suspended|error|deleting|deleted
      error TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      provider TEXT NOT NULL DEFAULT 'proxmox',
      provider_id TEXT,                            -- UpCloud server UUID (proxmox uses vmid)
      target_ssh_port INTEGER,                     -- where the gateway forwards SSH to
      target_http_port INTEGER,
      subdomain TEXT,                              -- white-label web address
      custom_domain TEXT,
      direct_host TEXT                             -- public host when no gateway is used
    );
    CREATE INDEX IF NOT EXISTS servers_user ON servers(user_id, state);

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      plan_id TEXT NOT NULL REFERENCES plans(id),
      server_id INTEGER REFERENCES servers(id),   -- set when renewing/upgrading an existing server
      kind TEXT NOT NULL,                          -- new|renew|upgrade
      amount_cents INTEGER NOT NULL,
      stripe_session_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',      -- pending|fulfilled|failed
      meta TEXT,                                   -- JSON: hostname/sshKey for new servers
      root_password_once TEXT,                     -- shown to the buyer once, then wiped
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ad_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      server_id INTEGER REFERENCES servers(id),
      transaction_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,                        -- admob|dev
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== White-label VPN (one WireGuard peer per user) =====
    CREATE TABLE IF NOT EXISTS vpn_peers (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      vpn_ip TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Unified wallet (local ledger backend) =====
    -- owner is 'u:<userId>' for users or 'sys:<name>' for platform accounts
    CREATE TABLE IF NOT EXISTS assets (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      chains TEXT NOT NULL,                        -- JSON array of network names
      withdraw_fee INTEGER NOT NULL DEFAULT 0,     -- units
      min_withdraw INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS wallet_balances (
      owner TEXT NOT NULL,
      asset TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner, asset)
    );
    CREATE TABLE IF NOT EXISTS wallet_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx TEXT NOT NULL,
      owner TEXT NOT NULL,
      asset TEXT NOT NULL,
      delta INTEGER NOT NULL,
      kind TEXT NOT NULL,                          -- deposit|withdraw|cloud|spot|perps|options|cards|fee|...
      ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS wallet_entries_owner ON wallet_entries(owner, id);
    CREATE TABLE IF NOT EXISTS wallet_outbox (      -- payouts that must eventually succeed (retried)
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src TEXT NOT NULL, dst TEXT NOT NULL, asset TEXT NOT NULL, amount INTEGER NOT NULL,
      kind TEXT NOT NULL, ref TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS deposit_addresses (
      user_id INTEGER NOT NULL, asset TEXT NOT NULL, chain TEXT NOT NULL, address TEXT NOT NULL,
      PRIMARY KEY (user_id, asset, chain)
    );
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      asset TEXT NOT NULL, chain TEXT NOT NULL, address TEXT NOT NULL,
      amount INTEGER NOT NULL, fee INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',      -- pending|sent|rejected
      txid TEXT, external_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS opex_accounts (       -- shadow OPEX/Keycloak account per user
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      opex_uuid TEXT NOT NULL,
      username TEXT NOT NULL,
      secret TEXT NOT NULL                         -- AES-GCM encrypted password
    );

    -- ===== Order books: local spot markets and card markets =====
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,                         -- 'BTC_USDT' or 'CARD:<sku>'
      kind TEXT NOT NULL,                          -- spot|card
      base TEXT NOT NULL, quote TEXT NOT NULL,
      base_scale INTEGER NOT NULL,                 -- 1e8 for coins, 1 for cards
      tick INTEGER NOT NULL,                       -- min price step (quote units)
      min_qty INTEGER NOT NULL,
      taker_fee_bps INTEGER NOT NULL DEFAULT 10,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS book_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL REFERENCES markets(id),
      user_id INTEGER NOT NULL,                    -- 0 = platform market maker
      side TEXT NOT NULL,                          -- buy|sell
      type TEXT NOT NULL,                          -- limit|market
      price INTEGER NOT NULL,                      -- limit price (0 for market)
      qty INTEGER NOT NULL,
      filled INTEGER NOT NULL DEFAULT 0,
      escrow INTEGER NOT NULL DEFAULT 0,           -- remaining escrowed amount (quote for buys, base for sells)
      status TEXT NOT NULL DEFAULT 'open',         -- open|filled|cancelled
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS book_open ON book_orders(market, status);
    CREATE TABLE IF NOT EXISTS book_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL,
      buy_order INTEGER NOT NULL, sell_order INTEGER NOT NULL,
      buyer INTEGER NOT NULL, seller INTEGER NOT NULL, taker_side TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS book_fills_m ON book_fills(market, id);

    -- ===== Derivatives =====
    CREATE TABLE IF NOT EXISTS perp_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      symbol TEXT NOT NULL, side TEXT NOT NULL,    -- long|short
      qty REAL NOT NULL, entry REAL NOT NULL, leverage INTEGER NOT NULL,
      margin INTEGER NOT NULL,                     -- USDT units
      liq_price REAL NOT NULL,
      tp REAL, sl REAL,
      status TEXT NOT NULL DEFAULT 'open',         -- open|closed|liquidated
      exit_price REAL, pnl INTEGER,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS option_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      symbol TEXT NOT NULL, kind TEXT NOT NULL,    -- call|put
      strike REAL NOT NULL, expiry TEXT NOT NULL,  -- ISO time
      qty REAL NOT NULL, premium INTEGER NOT NULL, -- total paid, USDT units
      status TEXT NOT NULL DEFAULT 'open',         -- open|closed|settled
      payout INTEGER, settle_price REAL,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
    );

    -- ===== Trading cards =====
    CREATE TABLE IF NOT EXISTS card_games (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS card_series (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES card_games(id),
      name TEXT NOT NULL, code TEXT NOT NULL, released TEXT, sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS card_products (
      sku TEXT PRIMARY KEY,
      series_id TEXT NOT NULL REFERENCES card_series(id),
      kind TEXT NOT NULL,                          -- single|pack|box
      name TEXT NOT NULL, number TEXT, rarity TEXT,
      grade TEXT NOT NULL DEFAULT 'RAW',           -- RAW, PSA 10, ...
      cards_per_pack INTEGER, image TEXT
    );
    CREATE TABLE IF NOT EXISTS card_holdings (
      user_id INTEGER NOT NULL, sku TEXT NOT NULL REFERENCES card_products(sku),
      qty INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, sku)
    );
    CREATE TABLE IF NOT EXISTS card_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL,                          -- ship_in|ship_out|break
      sku TEXT NOT NULL, qty INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',      -- pending|completed|rejected
      address TEXT, tracking TEXT, note TEXT, result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Lightweight migrations for databases created by older versions.
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const addCols = (t, defs) => { const have = cols(t); for (const [c, d] of defs) if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); };
  addCols('plans', [['provider', "TEXT NOT NULL DEFAULT 'proxmox'"], ['provider_plan', 'TEXT']]);
  addCols('servers', [['provider', "TEXT NOT NULL DEFAULT 'proxmox'"], ['provider_id', 'TEXT'], ['target_ssh_port', 'INTEGER'], ['target_http_port', 'INTEGER'], ['subdomain', 'TEXT'], ['custom_domain', 'TEXT'], ['direct_host', 'TEXT']]);
  addCols('orders', [['pay_with', "TEXT NOT NULL DEFAULT 'card'"]]);

  const upsert = db.prepare(`
    INSERT INTO plans (id,name,cores,cpulimit,memory_mb,swap_mb,disk_gb,net_rate_mbps,price_cents,days,sort,provider,provider_plan)
    VALUES (:id,:name,:cores,:cpulimit,:memory_mb,:swap_mb,:disk_gb,:net_rate_mbps,:price_cents,:days,:sort,:provider,:provider_plan)
    ON CONFLICT(id) DO NOTHING`);
  for (const p of DEFAULT_PLANS) upsert.run(p);
  require('./seed').seed(db);
  return db;
}

// Store timestamps as SQLite-compatible UTC strings: 'YYYY-MM-DD HH:MM:SS'
function toSql(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}
function fromSql(s) {
  return s ? new Date(s.replace(' ', 'T') + 'Z') : null;
}

module.exports = { open, toSql, fromSql, DEFAULT_PLANS };
