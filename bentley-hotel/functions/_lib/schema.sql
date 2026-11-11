-- Bentley Hotel website: D1 schema. Apply with:
--   npx wrangler d1 execute bentley-hotel --remote --file functions/_lib/schema.sql
-- (node src/dev.js applies it automatically to the local SQLite stand-in).

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'page',          -- page | landing | event | system
  status TEXT NOT NULL DEFAULT 'published',   -- published | draft
  title TEXT NOT NULL,
  nav_label TEXT,
  in_nav INTEGER NOT NULL DEFAULT 0,
  nav_order INTEGER NOT NULL DEFAULT 100,
  in_footer INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',            -- JSON: title, description, canonical, og_image, og_alt, noindex, jsonld
  hero TEXT,                                  -- JSON or NULL
  sections TEXT NOT NULL DEFAULT '[]',        -- JSON array
  event TEXT,                                 -- JSON for kind = event
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS pages_kind_status ON pages (kind, status);
CREATE INDEX IF NOT EXISTS pages_nav ON pages (in_nav, nav_order);

CREATE TABLE IF NOT EXISTS posts (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  cover_image TEXT,
  cover_alt TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS posts_published ON posts (status, published_at);

CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  width INTEGER,
  height INTEGER,
  url TEXT,                                   -- external URL when stored outside the platform (Vercel Blob)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS backlinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unchecked',   -- unchecked | live | missing | error
  http_status INTEGER,
  last_checked TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS redirects (
  from_path TEXT PRIMARY KEY,
  to_url TEXT NOT NULL,
  code INTEGER NOT NULL DEFAULT 301,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Bookings register: reservations pulled from Cloudbeds (webhooks + nightly sync) and reported to GA4.
CREATE TABLE IF NOT EXISTS bookings (
  reservation_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT '',            -- confirmed | not_confirmed | canceled | checked_in | checked_out | no_show
  source TEXT NOT NULL DEFAULT '',            -- Cloudbeds source name, e.g. "Website/Booking Engine", "Booking.com"
  guest_name TEXT NOT NULL DEFAULT '',
  checkin TEXT, checkout TEXT, nights INTEGER NOT NULL DEFAULT 0,
  adults INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0,
  rooms TEXT NOT NULL DEFAULT '[]',           -- JSON [{room_type_id, room_type_name, room_name, adults, children}]
  total REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'GBP',
  booked_at TEXT, modified_at TEXT, cancelled_at TEXT,
  reported_at TEXT,                           -- when the GA4 purchase event was sent
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bookings_booked ON bookings (booked_at);
CREATE INDEX IF NOT EXISTS bookings_checkin ON bookings (checkin);

-- Activity log for integrations (sync runs, webhooks, GA4 events, errors).
CREATE TABLE IF NOT EXISTS integration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                         -- sync | webhook | ga4 | webhook_register | error
  ok INTEGER NOT NULL DEFAULT 1,
  message TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
