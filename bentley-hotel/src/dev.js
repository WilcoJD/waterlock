#!/usr/bin/env node
/**
 * Local development server: runs the real Pages Functions with a SQLite file standing in for D1,
 * a folder standing in for R2 and public/ as the static assets.
 *
 *   node src/dev.js            → http://127.0.0.1:8788  (admin at /admin, password printed below)
 *   PORT=9000 node src/dev.js
 *   DEV_DB=:memory: SEED=1 node src/dev.js   (fresh database, loaded with the built-in content)
 *
 * Also exported for tests: createApp({ dbPath, mediaDir, env }) → { handle(request), env, close() }.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf", ".gif": "image/gif" };

/** Minimal D1-compatible wrapper around node:sqlite. */
export function d1(dbPath) {
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    all: async () => ({ results: sqlite.prepare(sql).all(...args), success: true, meta: {} }),
    first: async (col) => { const row = sqlite.prepare(sql).get(...args); return row == null ? null : col ? row[col] : row; },
    run: async () => { const r = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
    raw: async () => sqlite.prepare(sql).all(...args).map(Object.values),
    _sql: sql, _args: args,
  });
  return {
    prepare: (sql) => statement(sql),
    exec: async (sql) => { sqlite.exec(sql); },
    batch: async (stmts) => { sqlite.exec("BEGIN"); try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec("COMMIT"); return out; } catch (e) { sqlite.exec("ROLLBACK"); throw e; } },
    dump: () => sqlite,
    close: () => sqlite.close(),
  };
}

/** Folder-backed stand-in for an R2 bucket. */
export function r2(dir) {
  mkdirSync(dir, { recursive: true });
  const meta = (key) => join(dir, key + ".meta.json");
  return {
    put: async (key, body, opts = {}) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      writeFileSync(join(dir, key), bytes);
      writeFileSync(meta(key), JSON.stringify({ contentType: (opts.httpMetadata && opts.httpMetadata.contentType) || "application/octet-stream", size: bytes.length }));
    },
    get: async (key) => {
      const p = join(dir, key);
      if (!existsSync(p) || !existsSync(meta(key))) return null;
      const m = JSON.parse(readFileSync(meta(key), "utf8"));
      const buf = readFileSync(p);
      return { body: new Blob([buf]).stream(), httpMetadata: { contentType: m.contentType }, size: buf.length, key };
    },
    delete: async (key) => { for (const p of [join(dir, key), meta(key)]) if (existsSync(p)) unlinkSync(p); },
    list: async () => ({ objects: readdirSync(dir).filter((f) => !f.endsWith(".meta.json")).map((key) => ({ key })) }),
  };
}

/** Static files from public/, with Cloudflare Pages-style clean URLs. */
export function assets(dir = PUBLIC) {
  return {
    fetch: async (request) => {
      const url = new URL(typeof request === "string" ? request : request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel.includes("..")) return new Response("Not found", { status: 404 });
      const candidates = [rel, rel + ".html", rel.replace(/\/$/, "") + "/index.html"];
      if (rel === "/") candidates.unshift("/index.html");
      for (const c of candidates) {
        const p = join(dir, c);
        if (existsSync(p) && !readdirSafe(p)) {
          return new Response(readFileSync(p), { headers: { "Content-Type": TYPES[extname(p)] || "application/octet-stream" } });
        }
      }
      return new Response("Not found", { status: 404 });
    },
  };
}
function readdirSafe(p) { try { readdirSync(p); return true; } catch { return false; } }

export async function createApp({ dbPath = ":memory:", mediaDir = join(ROOT, ".dev", "media"), env: extra = {}, seed = false } = {}) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const DB = d1(dbPath);
  await DB.exec(readFileSync(join(ROOT, "functions", "_lib", "schema.sql"), "utf8"));
  const env = { DB, MEDIA: r2(mediaDir), ASSETS: assets(), ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "bentley-dev-password", SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString("hex"), ...extra };
  if (typeof globalThis.caches === "undefined") globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const { onRequest: site } = await import("../functions/[[path]].js");
  const { onRequest: admin } = await import("../functions/admin/[[path]].js");
  const { onRequest: availability } = await import("../functions/api/availability.js");
  const { onRequest: webhook } = await import("../functions/api/cloudbeds/webhook.js");
  const { onRequest: sync } = await import("../functions/api/cloudbeds/sync.js");
  if (seed) {
    const { loadSeed, isEmpty } = await import("../functions/_lib/db.js");
    const { default: SEED } = await import("../functions/_lib/seed-data.js");
    if (await isEmpty(DB)) await loadSeed(DB, SEED);
  }
  const handle = async (request) => {
    const path = new URL(request.url).pathname;
    const context = { request, env, waitUntil: () => {}, params: {} };
    try {
      if (path === "/admin" || path.startsWith("/admin/")) return await admin(context);
      if (path === "/api/availability") return await availability(context);
      if (path === "/api/cloudbeds/webhook") return await webhook(context);
      if (path === "/api/cloudbeds/sync") return await sync(context);
      return await site(context);
    } catch (e) {
      console.error(e);
      return new Response("Internal error: " + e.message, { status: 500 });
    }
  };
  return { handle, env, close: () => DB.close() };
}

async function toRequest(req, port) {
  const url = `http://127.0.0.1:${port}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
  return new Request(url, { method: req.method, headers, body, duplex: "half" });
}

export async function serve({ port = Number(process.env.PORT) || 8788, dbPath = process.env.DEV_DB || join(ROOT, ".dev", "bentley.sqlite"), seed = process.env.SEED !== "0" } = {}) {
  const app = await createApp({ dbPath, seed });
  const server = createServer(async (req, res) => {
    const response = await app.handle(await toRequest(req, port));
    res.statusCode = response.status;
    response.headers.forEach((v, k) => { if (k.toLowerCase() !== "set-cookie") res.setHeader(k, v); });
    const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  console.log(`Bentley Hotel dev server: http://127.0.0.1:${port}  admin: http://127.0.0.1:${port}/admin  (password: ${app.env.ADMIN_PASSWORD})`);
  return { server, app };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) serve();
