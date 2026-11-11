/**
 * Data access for the Bentley Hotel site (Cloudflare D1, or the SQLite stand-in in src/dev.js).
 * Rows store JSON columns as text; these helpers parse and serialise them.
 */

const JSON_PAGE = ["meta", "hero", "sections", "event"];
const JSON_POST = ["tags", "meta"];

const parse = (v, fallback) => { if (v == null || v === "") return fallback; try { return JSON.parse(v); } catch { return fallback; } };
const now = () => new Date().toISOString();

export function rowToPage(r) {
  if (!r) return null;
  return { ...r, in_nav: Number(r.in_nav) ? 1 : 0, in_footer: Number(r.in_footer) ? 1 : 0, nav_order: Number(r.nav_order) || 100,
    meta: parse(r.meta, {}), hero: parse(r.hero, null), sections: parse(r.sections, []), event: parse(r.event, null) };
}
export function rowToPost(r) {
  if (!r) return null;
  return { ...r, tags: parse(r.tags, []), meta: parse(r.meta, {}) };
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;
export function validSlug(s) { return typeof s === "string" && s.length <= 120 && SLUG_RE.test(s); }

/** Normalises and validates page JSON from the admin or the seed. Throws Error with a readable message. */
export function normalisePage(input) {
  const p = { ...input };
  if (!validSlug(p.slug)) throw new Error("Slug must be lower-case letters, numbers and hyphens (with / for sections), e.g. events/burns-night");
  if (!p.title || typeof p.title !== "string") throw new Error("Title is required");
  if (!["page", "landing", "event", "system"].includes(p.kind)) p.kind = "page";
  if (!["published", "draft"].includes(p.status)) p.status = "draft";
  p.nav_label = p.nav_label ? String(p.nav_label) : null;
  p.in_nav = p.in_nav ? 1 : 0;
  p.in_footer = p.in_footer ? 1 : 0;
  p.nav_order = Number.isFinite(Number(p.nav_order)) ? Number(p.nav_order) : 100;
  p.meta = typeof p.meta === "object" && p.meta ? p.meta : {};
  p.hero = typeof p.hero === "object" ? p.hero : null;
  p.sections = Array.isArray(p.sections) ? p.sections : [];
  for (const s of p.sections) if (!s || typeof s.type !== "string") throw new Error("Every section needs a type");
  p.event = p.kind === "event" ? (typeof p.event === "object" && p.event ? p.event : {}) : (typeof p.event === "object" ? p.event : null);
  return p;
}

export function normalisePost(input) {
  const p = { ...input };
  if (!validSlug(p.slug) || p.slug.includes("/")) throw new Error("Post slug must be lower-case letters, numbers and hyphens");
  if (!p.title || typeof p.title !== "string") throw new Error("Title is required");
  if (!["published", "draft"].includes(p.status)) p.status = "draft";
  p.excerpt = String(p.excerpt || "");
  p.body_md = String(p.body_md || "");
  p.cover_image = p.cover_image ? String(p.cover_image) : null;
  p.cover_alt = p.cover_alt ? String(p.cover_alt) : null;
  p.tags = Array.isArray(p.tags) ? p.tags.map(String) : [];
  p.published_at = p.published_at ? String(p.published_at) : (p.status === "published" ? now() : null);
  p.meta = typeof p.meta === "object" && p.meta ? p.meta : {};
  return p;
}

/* ---------- settings ---------- */

export async function getSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of results || []) out[r.key] = parse(r.value, null);
  return out;
}
export async function setSetting(db, key, value) {
  await db.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, JSON.stringify(value)).run();
}
export async function bumpVersion(db) {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)").run();
}

/* ---------- pages ---------- */

const PAGE_COLS = "slug, kind, status, title, nav_label, in_nav, nav_order, in_footer, meta, hero, sections, event, created_at, updated_at";
const PAGE_LIST_COLS = "slug, kind, status, title, nav_label, in_nav, nav_order, in_footer, meta, event, updated_at";

export async function listPages(db, { kind, status, full = false } = {}) {
  const where = [], args = [];
  if (kind) { where.push(`kind = ?${args.length + 1}`); args.push(kind); }
  if (status) { where.push(`status = ?${args.length + 1}`); args.push(status); }
  const sql = `SELECT ${full ? PAGE_COLS : PAGE_LIST_COLS} FROM pages${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY nav_order, title`;
  const { results } = await db.prepare(sql).bind(...args).all();
  return (results || []).map((r) => full ? rowToPage(r) : { ...rowToPage({ ...r, hero: null, sections: "[]" }), sections: undefined });
}
export async function getPage(db, slug) {
  return rowToPage(await db.prepare(`SELECT ${PAGE_COLS} FROM pages WHERE slug = ?1`).bind(slug).first());
}
export async function upsertPage(db, page, { create = false } = {}) {
  const p = normalisePage(page);
  if (create) {
    const exists = await db.prepare("SELECT 1 FROM pages WHERE slug = ?1").bind(p.slug).first();
    if (exists) throw new Error(`A page with the slug "${p.slug}" already exists`);
  }
  await db.prepare(`INSERT INTO pages (${PAGE_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)
    ON CONFLICT(slug) DO UPDATE SET kind=excluded.kind, status=excluded.status, title=excluded.title, nav_label=excluded.nav_label, in_nav=excluded.in_nav,
    nav_order=excluded.nav_order, in_footer=excluded.in_footer, meta=excluded.meta, hero=excluded.hero, sections=excluded.sections, event=excluded.event, updated_at=excluded.updated_at`)
    .bind(p.slug, p.kind, p.status, p.title, p.nav_label, p.in_nav, p.nav_order, p.in_footer, JSON.stringify(p.meta), p.hero ? JSON.stringify(p.hero) : null,
      JSON.stringify(p.sections), p.event ? JSON.stringify(p.event) : null, now()).run();
  await bumpVersion(db);
  return p;
}
export async function deletePage(db, slug) {
  await db.prepare("DELETE FROM pages WHERE slug = ?1").bind(slug).run();
  await bumpVersion(db);
}

/* ---------- posts ---------- */

const POST_COLS = "slug, status, title, excerpt, body_md, cover_image, cover_alt, tags, published_at, updated_at, meta";
export async function listPosts(db, { status, limit } = {}) {
  const sql = `SELECT ${POST_COLS} FROM posts${status ? " WHERE status = ?1" : ""} ORDER BY COALESCE(published_at, updated_at) DESC${limit ? ` LIMIT ${Number(limit)}` : ""}`;
  const stmt = status ? db.prepare(sql).bind(status) : db.prepare(sql);
  const { results } = await stmt.all();
  return (results || []).map(rowToPost);
}
export async function getPost(db, slug) {
  return rowToPost(await db.prepare(`SELECT ${POST_COLS} FROM posts WHERE slug = ?1`).bind(slug).first());
}
export async function upsertPost(db, post, { create = false } = {}) {
  const p = normalisePost(post);
  if (create) {
    const exists = await db.prepare("SELECT 1 FROM posts WHERE slug = ?1").bind(p.slug).first();
    if (exists) throw new Error(`A post with the slug "${p.slug}" already exists`);
  }
  await db.prepare(`INSERT INTO posts (${POST_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
    ON CONFLICT(slug) DO UPDATE SET status=excluded.status, title=excluded.title, excerpt=excluded.excerpt, body_md=excluded.body_md, cover_image=excluded.cover_image,
    cover_alt=excluded.cover_alt, tags=excluded.tags, published_at=excluded.published_at, updated_at=excluded.updated_at, meta=excluded.meta`)
    .bind(p.slug, p.status, p.title, p.excerpt, p.body_md, p.cover_image, p.cover_alt, JSON.stringify(p.tags), p.published_at, now(), JSON.stringify(p.meta)).run();
  await bumpVersion(db);
  return p;
}
export async function deletePost(db, slug) {
  await db.prepare("DELETE FROM posts WHERE slug = ?1").bind(slug).run();
  await bumpVersion(db);
}

/* ---------- media ---------- */

export async function listMedia(db) {
  const { results } = await db.prepare("SELECT key, filename, content_type, size, alt, width, height, url, created_at FROM media ORDER BY created_at DESC").all();
  return results || [];
}
export async function addMedia(db, m) {
  await db.prepare("INSERT INTO media (key, filename, content_type, size, alt, width, height, url) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
    .bind(m.key, m.filename, m.content_type, m.size || 0, m.alt || "", m.width || null, m.height || null, m.url || null).run();
}
export async function updateMedia(db, key, { alt }) {
  await db.prepare("UPDATE media SET alt = ?2 WHERE key = ?1").bind(key, String(alt || "")).run();
}
export async function getMedia(db, key) {
  return db.prepare("SELECT key, filename, content_type, size, alt, width, height, url, created_at FROM media WHERE key = ?1").bind(key).first();
}
export async function deleteMedia(db, key) {
  await db.prepare("DELETE FROM media WHERE key = ?1").bind(key).run();
}

/* ---------- backlinks ---------- */

export async function listBacklinks(db) {
  const { results } = await db.prepare("SELECT * FROM backlinks ORDER BY created_at DESC").all();
  return results || [];
}
export async function addBacklink(db, b) {
  if (!/^https?:\/\//.test(b.source_url || "")) throw new Error("Source URL must start with http:// or https://");
  const r = await db.prepare("INSERT INTO backlinks (source_url, target_url, anchor_text, notes) VALUES (?1,?2,?3,?4) RETURNING id")
    .bind(String(b.source_url), String(b.target_url || ""), String(b.anchor_text || ""), String(b.notes || "")).first();
  return r ? r.id : null;
}
export async function updateBacklink(db, id, fields) {
  const allowed = ["source_url", "target_url", "anchor_text", "status", "http_status", "last_checked", "notes"];
  const sets = [], args = [];
  for (const k of allowed) if (k in fields) { args.push(fields[k]); sets.push(`${k} = ?${args.length}`); }
  if (!sets.length) return;
  args.push(id);
  await db.prepare(`UPDATE backlinks SET ${sets.join(", ")} WHERE id = ?${args.length}`).bind(...args).run();
}
export async function getBacklink(db, id) {
  return db.prepare("SELECT * FROM backlinks WHERE id = ?1").bind(id).first();
}
export async function deleteBacklink(db, id) {
  await db.prepare("DELETE FROM backlinks WHERE id = ?1").bind(id).run();
}

/* ---------- redirects ---------- */

export async function listRedirects(db) {
  const { results } = await db.prepare("SELECT from_path, to_url, code FROM redirects ORDER BY from_path").all();
  return results || [];
}
export async function getRedirect(db, path) {
  return db.prepare("SELECT to_url, code FROM redirects WHERE from_path = ?1").bind(path).first();
}
export async function replaceRedirects(db, list) {
  const rows = [];
  for (const r of list || []) {
    const from = String(r.from_path || "").trim();
    if (!from.startsWith("/")) throw new Error(`Redirect "from" paths must start with /: ${from}`);
    rows.push({ from_path: from, to_url: String(r.to_url || "").trim(), code: [301, 302, 307, 308].includes(Number(r.code)) ? Number(r.code) : 301 });
  }
  const stmts = [db.prepare("DELETE FROM redirects")];
  for (const r of rows) stmts.push(db.prepare("INSERT INTO redirects (from_path, to_url, code) VALUES (?1,?2,?3)").bind(r.from_path, r.to_url, r.code));
  await db.batch(stmts);
  await bumpVersion(db);
  return rows;
}

/* ---------- seed, export, import ---------- */

export async function isEmpty(db) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM pages").first();
  return !r || Number(r.n) === 0;
}

/** Loads seed content. `replace: true` wipes pages/posts/backlinks/redirects/settings first. */
export async function loadSeed(db, seed, { replace = false } = {}) {
  const stmts = [];
  if (replace) stmts.push(db.prepare("DELETE FROM pages"), db.prepare("DELETE FROM posts"), db.prepare("DELETE FROM backlinks"), db.prepare("DELETE FROM redirects"), db.prepare("DELETE FROM settings"));
  if (stmts.length) await db.batch(stmts);
  const existing = await getSettings(db);
  if (seed.settings) {
    for (const [k, v] of Object.entries(seed.settings)) if (replace || !(k in existing)) await setSetting(db, k, v);
  }
  for (const page of seed.pages || []) {
    const p = normalisePage(page);
    await db.prepare(`INSERT INTO pages (${PAGE_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13)
      ON CONFLICT(slug) DO ${replace ? "UPDATE SET kind=excluded.kind, status=excluded.status, title=excluded.title, nav_label=excluded.nav_label, in_nav=excluded.in_nav, nav_order=excluded.nav_order, in_footer=excluded.in_footer, meta=excluded.meta, hero=excluded.hero, sections=excluded.sections, event=excluded.event, updated_at=excluded.updated_at" : "NOTHING"}`)
      .bind(p.slug, p.kind, p.status, p.title, p.nav_label, p.in_nav, p.nav_order, p.in_footer, JSON.stringify(p.meta), p.hero ? JSON.stringify(p.hero) : null, JSON.stringify(p.sections), p.event ? JSON.stringify(p.event) : null, now()).run();
  }
  for (const post of seed.posts || []) {
    const p = normalisePost(post);
    await db.prepare(`INSERT INTO posts (${POST_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(slug) DO NOTHING`)
      .bind(p.slug, p.status, p.title, p.excerpt, p.body_md, p.cover_image, p.cover_alt, JSON.stringify(p.tags), p.published_at, now(), JSON.stringify(p.meta)).run();
  }
  for (const b of seed.backlinks || []) {
    const dup = await db.prepare("SELECT 1 FROM backlinks WHERE source_url = ?1").bind(b.source_url).first();
    if (!dup) await addBacklink(db, b);
  }
  if (seed.redirects && seed.redirects.length) {
    for (const r of seed.redirects) await db.prepare("INSERT INTO redirects (from_path, to_url, code) VALUES (?1,?2,?3) ON CONFLICT(from_path) DO NOTHING").bind(r.from_path, r.to_url, Number(r.code) || 301).run();
  }
  await bumpVersion(db);
}

export async function exportAll(db) {
  return {
    exported_at: now(),
    settings: await getSettings(db),
    pages: await listPages(db, { full: true }),
    posts: await listPosts(db),
    media: await listMedia(db),
    backlinks: await listBacklinks(db),
    redirects: await listRedirects(db),
  };
}

/* ---------- schema upkeep ---------- */

let schemaChecked = false;
/** Creates tables added after the first release and adds missing columns. Safe to call often. */
export async function ensureSchema(db) {
  if (schemaChecked) return;
  schemaChecked = true;
  await db.prepare(`CREATE TABLE IF NOT EXISTS bookings (reservation_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', guest_name TEXT NOT NULL DEFAULT '',
    checkin TEXT, checkout TEXT, nights INTEGER NOT NULL DEFAULT 0, adults INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0, rooms TEXT NOT NULL DEFAULT '[]',
    total REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'GBP', booked_at TEXT, modified_at TEXT, cancelled_at TEXT, reported_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 1, message TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run();
  try { await db.prepare("ALTER TABLE media ADD COLUMN url TEXT").run(); } catch { /* column already there */ }
}

/* ---------- bookings ---------- */

export function rowToBooking(r) {
  if (!r) return null;
  return { ...r, rooms: parse(r.rooms, []), total: Number(r.total) || 0, nights: Number(r.nights) || 0, adults: Number(r.adults) || 0, children: Number(r.children) || 0 };
}
export async function upsertBooking(db, b) {
  await db.prepare(`INSERT INTO bookings (reservation_id, status, source, guest_name, checkin, checkout, nights, adults, children, rooms, total, currency, booked_at, modified_at, cancelled_at, updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
    ON CONFLICT(reservation_id) DO UPDATE SET status=excluded.status, source=excluded.source, guest_name=excluded.guest_name, checkin=excluded.checkin, checkout=excluded.checkout,
    nights=excluded.nights, adults=excluded.adults, children=excluded.children, rooms=excluded.rooms, total=excluded.total, currency=excluded.currency, booked_at=COALESCE(excluded.booked_at, bookings.booked_at),
    modified_at=excluded.modified_at, cancelled_at=excluded.cancelled_at, updated_at=excluded.updated_at`)
    .bind(String(b.reservation_id), b.status || "", b.source || "", b.guest_name || "", b.checkin || null, b.checkout || null, Number(b.nights) || 0, Number(b.adults) || 0, Number(b.children) || 0,
      JSON.stringify(b.rooms || []), Number(b.total) || 0, b.currency || "GBP", b.booked_at || null, b.modified_at || null, b.cancelled_at || null, now()).run();
}
export async function getBooking(db, id) {
  return rowToBooking(await db.prepare("SELECT * FROM bookings WHERE reservation_id = ?1").bind(String(id)).first());
}
export async function markBookingReported(db, id) {
  await db.prepare("UPDATE bookings SET reported_at = ?2 WHERE reservation_id = ?1").bind(String(id), now()).run();
}
export async function listBookings(db, { from, to, status, limit = 200 } = {}) {
  const where = [], args = [];
  if (from) { args.push(from); where.push(`COALESCE(booked_at, created_at) >= ?${args.length}`); }
  if (to) { args.push(to); where.push(`COALESCE(booked_at, created_at) < ?${args.length}`); }
  if (status) { args.push(status); where.push(`status = ?${args.length}`); }
  const { results } = await db.prepare(`SELECT * FROM bookings${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(booked_at, created_at) DESC LIMIT ${Math.min(Number(limit) || 200, 1000)}`).bind(...args).all();
  return (results || []).map(rowToBooking);
}
/** Monthly counts and revenue for the last `months` months (by booking date), live bookings only. */
export async function bookingStats(db, months = 12) {
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - months + 1, 1); since.setUTCHours(0, 0, 0, 0);
  const { results } = await db.prepare(`SELECT substr(COALESCE(booked_at, created_at), 1, 7) AS month, COUNT(*) AS bookings, SUM(CASE WHEN status IN ('canceled','no_show') THEN 0 ELSE total END) AS revenue,
      SUM(CASE WHEN status IN ('canceled','no_show') THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN source LIKE '%Booking Engine%' OR source LIKE '%Website%' THEN 1 ELSE 0 END) AS direct
    FROM bookings WHERE COALESCE(booked_at, created_at) >= ?1 GROUP BY month ORDER BY month`).bind(since.toISOString()).all();
  return (results || []).map((r) => ({ month: r.month, bookings: Number(r.bookings), revenue: Math.round((Number(r.revenue) || 0) * 100) / 100, cancelled: Number(r.cancelled), direct: Number(r.direct) }));
}
export async function logIntegration(db, kind, ok, message) {
  await db.prepare("INSERT INTO integration_log (kind, ok, message) VALUES (?1, ?2, ?3)").bind(kind, ok ? 1 : 0, String(message || "").slice(0, 2000)).run();
  await db.prepare("DELETE FROM integration_log WHERE id NOT IN (SELECT id FROM integration_log ORDER BY id DESC LIMIT 500)").run();
}
export async function recentLog(db, limit = 50) {
  const { results } = await db.prepare(`SELECT id, kind, ok, message, at FROM integration_log ORDER BY id DESC LIMIT ${Number(limit) || 50}`).all();
  return results || [];
}
