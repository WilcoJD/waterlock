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
];

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
      active INTEGER NOT NULL DEFAULT 1
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
      deleted_at TEXT
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
  `);

  const upsert = db.prepare(`
    INSERT INTO plans (id,name,cores,cpulimit,memory_mb,swap_mb,disk_gb,net_rate_mbps,price_cents,days,sort)
    VALUES (:id,:name,:cores,:cpulimit,:memory_mb,:swap_mb,:disk_gb,:net_rate_mbps,:price_cents,:days,:sort)
    ON CONFLICT(id) DO NOTHING`);
  for (const p of DEFAULT_PLANS) upsert.run(p);
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
