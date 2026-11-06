/**
 * In-memory mock of the admin JSON API (docs/architecture.md) for testing the admin front-end.
 * No dependencies: Node's http module, the seed content and the shared themes/markdown modules.
 *
 *   node tests/admin-mock.mjs            → http://127.0.0.1:8899/admin  (password: bentley)
 *   import { createMock } from "./admin-mock.mjs"; const m = createMock(); await m.listen(8899);
 */
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { adminHtml } from "../functions/admin/ui.js";
import { listThemes, THEMES } from "../functions/_lib/themes.js";
import { markdownToHtml, escapeHtml } from "../functions/_lib/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_DIR = join(ROOT, "content", "seed");
const PUBLIC = join(ROOT, "public");
const TYPES = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gif": "image/gif", ".pdf": "application/pdf" };
// Same policy the real server sends, so the tests catch CSP violations (inline handlers, remote assets).
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; frame-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const now = () => new Date().toISOString();
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Loads content/seed plus a couple of extra sample records so every list has something in it. */
export function loadSeed() {
  const pages = new Map();
  for (const f of readdirSync(join(SEED_DIR, "pages")).filter((f) => f.endsWith(".json")).sort()) {
    const p = readJson(join(SEED_DIR, "pages", f));
    pages.set(p.slug, { ...p, created_at: now(), updated_at: now() });
  }
  pages.set("events/burns-night", {
    slug: "events/burns-night", kind: "event", status: "published", title: "Burns Night Supper", nav_label: null, in_nav: 0, nav_order: 100, in_footer: 0,
    meta: { title: "Burns Night Supper 2026 | Bentley Hotel", description: "Haggis, neeps and tatties, the Address and a wee dram at our Burns Night supper in Motherwell.", canonical: "", og_image: "exterior", og_alt: "", noindex: false, jsonld: null },
    hero: { style: "split", eyebrow: "Saturday 24 January", title: "Burns Night Supper", lede: "A four-course supper with the Address to the Haggis.", image: "exterior", image_alt: "The hotel", buttons: [{ label: "Book a table", href: "contact.html?enquiry=Burns+Night", style: "primary" }], badge: null },
    sections: [{ type: "event_details", title: "The evening", dates_text: "", price_text: "", includes: [], note: "", buttons: [] }, { type: "cta", title: "Reserve your places", text: "Call us or send an enquiry.", buttons: [{ label: "Call 01698 265588", href: "tel:+441698265588", style: "primary" }] }],
    event: { dates_text: "Saturday 24 January 2026, 7pm", price_text: "£45 per person", includes: ["Four-course supper", "Piper and Address to the Haggis", "A dram of malt whisky"], note: "Tables of 2 to 12.", category: "festive", month: 1 },
    created_at: now(), updated_at: now(),
  });
  const posts = new Map();
  for (const f of existsSync(join(SEED_DIR, "posts")) ? readdirSync(join(SEED_DIR, "posts")).filter((f) => f.endsWith(".json")) : []) {
    const p = readJson(join(SEED_DIR, "posts", f));
    posts.set(p.slug, { ...p, updated_at: now() });
  }
  posts.set("welcome-to-our-new-website", { slug: "welcome-to-our-new-website", status: "published", title: "Welcome to our new website", excerpt: "A fresh look for the Bentley Hotel online.", body_md: "# Welcome\n\nWe have a **new website**. Have a look around.", cover_image: "exterior", cover_alt: "The hotel from High Road", tags: ["news"], published_at: "2026-01-10T10:00:00.000Z", updated_at: now(), meta: {} });
  const backlinks = readJson(join(SEED_DIR, "backlinks.json")).map((b, i) => ({ id: i + 1, anchor_text: "", notes: "", ...b, status: "unchecked", http_status: null, last_checked: null, created_at: now() }));
  return { settings: readJson(join(SEED_DIR, "settings.json")), pages, posts, media: new Map(), backlinks, nextBacklinkId: backlinks.length + 1, redirects: readJson(join(SEED_DIR, "redirects.json")) };
}

function parseMultipart(buf, contentType) {
  const m = /boundary="?([^";]+)"?/.exec(contentType || "");
  if (!m) return [];
  const boundary = Buffer.from("--" + m[1]);
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    pos += boundary.length;
    if (buf.slice(pos, pos + 2).toString() === "--") break;
    const headEnd = buf.indexOf("\r\n\r\n", pos);
    if (headEnd === -1) break;
    const headers = buf.slice(pos, headEnd).toString();
    const next = buf.indexOf(boundary, headEnd + 4);
    const body = buf.slice(headEnd + 4, next === -1 ? buf.length : next - 2);
    parts.push({ name: (/name="([^"]*)"/.exec(headers) || [])[1], filename: (/filename="([^"]*)"/.exec(headers) || [])[1], type: (/Content-Type:\s*([^\r\n]+)/i.exec(headers) || [])[1] || "application/octet-stream", body });
    pos = next;
  }
  return parts;
}

const pageSummary = (p) => ({ slug: p.slug, kind: p.kind, status: p.status, title: p.title, nav_label: p.nav_label, in_nav: p.in_nav, nav_order: p.nav_order, in_footer: p.in_footer, meta: p.meta, event: p.event, updated_at: p.updated_at });

function renderSection(s) {
  if (s.type === "html") return s.html || "";
  const items = (s.items || []).map((it) => `<li>${typeof it === "string" ? escapeHtml(it) : escapeHtml(it.title || it.q || it.label || it.caption || it.value || JSON.stringify(it))}</li>`).join("");
  return `<section class="section" data-type="${escapeHtml(s.type)}">${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ""}${s.intro || s.text ? `<p>${escapeHtml(s.intro || s.text)}</p>` : ""}${s.html && s.type === "text" ? s.html : ""}${items ? `<ul>${items}</ul>` : ""}</section>`;
}
function renderPage(page, site) {
  const hero = page.hero ? `<header class="hero"><p>${escapeHtml(page.hero.eyebrow || "")}</p><h1>${escapeHtml(page.hero.title || page.title)}</h1><p>${escapeHtml(page.hero.lede || "")}</p></header>` : `<header><h1>${escapeHtml(page.title)}</h1></header>`;
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml((page.meta && page.meta.title) || page.title)}</title><link rel="stylesheet" href="assets/css/styles.css"></head><body data-theme="${escapeHtml(site.theme || "")}">${hero}<main>${(page.sections || []).map(renderSection).join("\n")}</main><footer>${escapeHtml(site.name || "")}</footer></body></html>`;
}

function seoAudit(pages) {
  const titles = new Map();
  for (const p of pages) { const t = (p.meta && p.meta.title) || ""; titles.set(t, (titles.get(t) || 0) + 1); }
  const out = pages.map((p) => {
    const issues = [];
    const t = (p.meta && p.meta.title) || "", d = (p.meta && p.meta.description) || "";
    if (!t) issues.push("No meta title"); else if (t.length > 60) issues.push(`Meta title is ${t.length} characters (aim for 60 or fewer)`);
    if (!d) issues.push("No meta description"); else if (d.length > 160) issues.push(`Meta description is ${d.length} characters (aim for 160 or fewer)`);
    if (t && titles.get(t) > 1) issues.push("Duplicate meta title");
    if (!(p.meta && p.meta.og_image)) issues.push("No social-sharing image");
    if (p.meta && p.meta.noindex && p.status === "published") issues.push("Published but marked noindex");
    return { slug: p.slug, title: p.title, kind: p.kind, status: p.status, issues };
  });
  return { pages: out, summary: { pages: pages.length, with_issues: out.filter((p) => p.issues.length).length } };
}

export function createMock({ password = process.env.ADMIN_PASSWORD || "bentley", log = false } = {}) {
  let db = loadSeed();
  const sessions = new Set();
  const requests = []; // every API request, for assertions in tests

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const send = (status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    const json = (body, status = 200, headers = {}) => send(status, body, headers);
    const error = (message, status = 400) => json({ error: message }, status);
    const html = (body, status = 200) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP }); res.end(body); };
    const cookie = /(?:^|;\s*)bh_admin=([^;]+)/.exec(req.headers.cookie || "");
    const loggedIn = Boolean(cookie && sessions.has(cookie[1]));
    const site = () => db.settings.site;
    if (log) console.log(req.method, req.url);

    try {
      // ----- admin HTML -----
      if (path === "/admin" || (path.startsWith("/admin/") && !path.startsWith("/admin/api"))) return html(adminHtml({ loggedIn }));

      // ----- public side: static assets, media, a crude rendering of pages (for "View live") -----
      if (!path.startsWith("/admin/api")) {
        const file = join(PUBLIC, decodeURIComponent(path));
        if (!path.includes("..") && (path.startsWith("/assets/") || path === "/favicon.svg" || path === "/favicon.ico") && existsSync(file)) { res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }); return res.end(readFileSync(file)); }
        if (path.startsWith("/media/")) { const m = db.media.get(path.slice(7)); if (!m) return error("Not found", 404); res.writeHead(200, { "Content-Type": m.content_type }); return res.end(m.bytes); }
        if (path.startsWith("/blog/")) { const p = db.posts.get(path.slice(6)); return p ? html(`<!doctype html><title>${escapeHtml(p.title)}</title><h1>${escapeHtml(p.title)}</h1>${markdownToHtml(p.body_md)}`) : error("Not found", 404); }
        const slug = path === "/" ? site().homepage_slug || "index" : path.slice(1).replace(/\.html$/, "");
        const p = db.pages.get(slug);
        return p ? html(renderPage(p, site())) : html(renderPage(db.pages.get("404") || { title: "Not found", sections: [] }, site()), 404);
      }

      // ----- API -----
      const route = path.slice("/admin/api".length).replace(/^\//, "");
      const parts = route.split("/").filter(Boolean);
      const method = req.method;
      const body = () => { try { return raw.length ? JSON.parse(raw.toString("utf8")) : {}; } catch { throw new Error("Invalid JSON body"); } };
      requests.push({ method, route, body: method === "GET" ? null : raw.length && !/multipart/.test(req.headers["content-type"] || "") ? JSON.parse(raw.toString("utf8")) : null });

      if (route === "login" && method === "POST") {
        if (body().password !== password) return error("Wrong password", 401);
        const token = randomBytes(16).toString("hex");
        sessions.add(token);
        return json({ ok: true }, 200, { "Set-Cookie": `bh_admin=${token}; Path=/admin; HttpOnly; SameSite=Strict` });
      }
      if (route === "me") return json({ loggedIn, configured: true });
      if (!loggedIn) return error("Not logged in", 401);
      if (method !== "GET" && req.headers["x-requested-with"] !== "fetch") return error("Request blocked (missing X-Requested-With header)", 403);
      if (route === "logout" && method === "POST") { if (cookie) sessions.delete(cookie[1]); return json({ ok: true }, 200, { "Set-Cookie": "bh_admin=; Path=/admin; Max-Age=0" }); }

      if (route === "settings") {
        if (method === "GET") return json({ site: site(), version: db.settings.version || 1 });
        if (method === "PUT") {
          const b = body();
          const next = { ...site(), ...(b.site || {}) };
          if (!THEMES[next.theme]) return error("Unknown theme");
          if (next.homepage_slug && next.homepage_slug !== "index" && !db.pages.has(next.homepage_slug)) return error("Homepage page not found");
          db.settings.site = next; db.settings.version = (db.settings.version || 1) + 1;
          return json({ ok: true, site: next });
        }
      }
      if (route === "themes" && method === "GET") return json({ themes: listThemes(), current: site().theme });
      if (route === "stats" && method === "GET") {
        const all = [...db.pages.values()];
        return json({ pages: all.filter((p) => p.kind === "page").length, landing: all.filter((p) => p.kind === "landing").length, events: all.filter((p) => p.kind === "event").length, drafts: all.filter((p) => p.status === "draft").length, posts: db.posts.size, media: db.media.size, backlinks: db.backlinks.length, redirects: db.redirects.length });
      }

      if (parts[0] === "pages") {
        const all = () => [...db.pages.values()].sort((a, b) => a.nav_order - b.nav_order || a.title.localeCompare(b.title));
        if (parts.length === 1 && method === "GET") { const kind = url.searchParams.get("kind"); return json({ pages: all().filter((p) => !kind || p.kind === kind).map(pageSummary) }); }
        if (parts.length === 1 && method === "POST") {
          const p = body();
          if (!p.slug || !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(p.slug)) return error("Slug must be lower-case letters, numbers and hyphens, with / for sections");
          if (!p.title) return error("Title is required");
          if (db.pages.has(p.slug)) return error(`A page with the slug "${p.slug}" already exists`);
          const page = { ...p, created_at: now(), updated_at: now() };
          db.pages.set(p.slug, page);
          return json({ ok: true, page }, 201);
        }
        const isDup = parts[parts.length - 1] === "duplicate" && parts.length > 2;
        const slug = decodeURIComponent(parts.slice(1, isDup ? -1 : undefined).join("/"));
        const existing = db.pages.get(slug);
        if (!existing) return error("Page not found", 404);
        if (isDup && method === "POST") {
          let n = 2, newSlug = `${slug}-copy`;
          while (db.pages.has(newSlug)) newSlug = `${slug}-copy-${n++}`;
          const page = { ...existing, slug: newSlug, status: "draft", title: `${existing.title} (copy)`, in_nav: 0, created_at: now(), updated_at: now() };
          db.pages.set(newSlug, page);
          return json({ ok: true, page }, 201);
        }
        if (method === "GET") return json({ page: existing });
        if (method === "PUT") {
          const p = body();
          if (p.slug && p.slug !== slug) return error("The slug cannot be changed here");
          if (!p.title) return error("Title is required");
          if ((p.sections || []).some((s) => !s || typeof s.type !== "string")) return error("Every section needs a type");
          const page = { ...existing, ...p, slug, updated_at: now() };
          db.pages.set(slug, page);
          return json({ ok: true, page });
        }
        if (method === "DELETE") { if (slug === "index" || slug === "404") return error("That page cannot be deleted"); db.pages.delete(slug); return json({ ok: true }); }
      }
      if (route === "preview" && method === "POST") { const b = body(); if (!b.page) return error("page is required"); return html(renderPage(b.page, site())); }

      if (parts[0] === "posts") {
        if (parts.length === 1 && method === "GET") return json({ posts: [...db.posts.values()].map((p) => ({ ...p, body_md: undefined })).sort((a, b) => String(b.published_at || b.updated_at).localeCompare(String(a.published_at || a.updated_at))) });
        if (parts.length === 1 && method === "POST") {
          const p = body();
          if (!p.slug || !/^[a-z0-9][a-z0-9-]*$/.test(p.slug)) return error("Post slug must be lower-case letters, numbers and hyphens");
          if (!p.title) return error("Title is required");
          if (db.posts.has(p.slug)) return error(`A post with the slug "${p.slug}" already exists`);
          const post = { ...p, published_at: p.published_at || (p.status === "published" ? now() : null), updated_at: now() };
          db.posts.set(p.slug, post);
          return json({ ok: true, post }, 201);
        }
        const slug = parts[1];
        const existing = db.posts.get(slug);
        if (!existing) return error("Post not found", 404);
        if (method === "GET") return json({ post: existing });
        if (method === "PUT") { const p = body(); if (p.slug && p.slug !== slug) return error("The slug cannot be changed"); const post = { ...existing, ...p, slug, updated_at: now() }; db.posts.set(slug, post); return json({ ok: true, post }); }
        if (method === "DELETE") { db.posts.delete(slug); return json({ ok: true }); }
      }
      if (route === "markdown" && method === "POST") return json({ html: markdownToHtml(String(body().md || "")) });

      if (parts[0] === "media") {
        const pub = (m) => ({ key: m.key, filename: m.filename, content_type: m.content_type, size: m.size, alt: m.alt, width: m.width, height: m.height, created_at: m.created_at });
        if (parts.length === 1 && method === "GET") return json({ media: [...db.media.values()].map(pub).reverse() });
        if (parts.length === 1 && method === "POST") {
          const files = parseMultipart(raw, req.headers["content-type"]).filter((p) => p.name === "file" && p.filename);
          if (!files.length) return error("No file uploaded");
          const saved = [];
          for (const f of files) {
            if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(f.type)) return error(`File type not allowed: ${f.type}`);
            const key = `${Date.now().toString(36)}-${f.filename.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-")}.${f.type.split("/")[1].replace("jpeg", "jpg")}`;
            const rec = { key, filename: f.filename, content_type: f.type, size: f.body.length, alt: "", width: null, height: null, created_at: now(), bytes: f.body };
            db.media.set(key, rec);
            saved.push({ ...pub(rec), url: `/media/${key}` });
          }
          return json({ ok: true, media: saved }, 201);
        }
        const key = decodeURIComponent(parts[1]);
        if (!db.media.has(key)) return error("Not found", 404);
        if (method === "PUT") { db.media.get(key).alt = String(body().alt || ""); return json({ ok: true }); }
        if (method === "DELETE") { db.media.delete(key); return json({ ok: true }); }
      }

      if (parts[0] === "backlinks") {
        const check = (row) => {
          // Simulated: the mock never fetches the network. URLs containing "missing" or "broken" exercise the other states.
          const r = /missing/.test(row.source_url) ? { status: "missing", http_status: 200 } : /broken|error/.test(row.source_url) ? { status: "error", http_status: 404 } : { status: "live", http_status: 200 };
          Object.assign(row, r, { last_checked: now() });
          return row;
        };
        if (parts.length === 1 && method === "GET") return json({ backlinks: [...db.backlinks].sort((a, b) => b.id - a.id) });
        if (parts.length === 1 && method === "POST") {
          const b = body();
          if (!/^https?:\/\//.test(b.source_url || "")) return error("Source URL must start with http:// or https://");
          const row = { id: db.nextBacklinkId++, source_url: b.source_url, target_url: String(b.target_url || ""), anchor_text: String(b.anchor_text || ""), notes: String(b.notes || ""), status: "unchecked", http_status: null, last_checked: null, created_at: now() };
          db.backlinks.push(row);
          return json({ ok: true, backlink: row }, 201);
        }
        if (route === "backlinks/check-all" && method === "POST") return json({ ok: true, backlinks: db.backlinks.map(check) });
        const id = Number(parts[1]);
        const row = db.backlinks.find((b) => b.id === id);
        if (!row) return error("Not found", 404);
        if (parts[2] === "check" && method === "POST") return json({ ok: true, backlink: check(row) });
        if (method === "PUT") { const b = body(); for (const k of ["source_url", "target_url", "anchor_text", "notes"]) if (k in b) row[k] = String(b[k] ?? ""); return json({ ok: true, backlink: row }); }
        if (method === "DELETE") { db.backlinks = db.backlinks.filter((b) => b.id !== id); return json({ ok: true }); }
      }

      if (route === "redirects") {
        if (method === "GET") return json({ redirects: db.redirects });
        if (method === "PUT") {
          const b = body();
          const listIn = Array.isArray(b) ? b : b.redirects || [];
          for (const r of listIn) if (!String(r.from_path || "").startsWith("/")) return error(`Redirect "from" paths must start with /: ${r.from_path}`);
          db.redirects = listIn.map((r) => ({ from_path: String(r.from_path).trim(), to_url: String(r.to_url || "").trim(), code: [301, 302, 307, 308].includes(Number(r.code)) ? Number(r.code) : 301 }));
          return json({ ok: true, redirects: db.redirects });
        }
      }
      if (route === "seo" && method === "GET") return json(seoAudit([...db.pages.values()]));
      if (route === "seed" && method === "POST") { const fresh = loadSeed(); if (body().replace) db = fresh; else { for (const [k, v] of fresh.pages) if (!db.pages.has(k)) db.pages.set(k, v); for (const [k, v] of fresh.posts) if (!db.posts.has(k)) db.posts.set(k, v); } return json({ ok: true, pages: fresh.pages.size }); }
      if (route === "export" && method === "GET") return json({ exported_at: now(), settings: db.settings, pages: [...db.pages.values()], posts: [...db.posts.values()], media: [...db.media.values()].map(({ bytes, ...m }) => m), backlinks: db.backlinks, redirects: db.redirects });
      if (route === "import" && method === "POST") {
        const b = body();
        if (!Array.isArray(b.pages)) return error("Import file must contain a pages array");
        db.pages = new Map(b.pages.map((p) => [p.slug, p])); db.posts = new Map((b.posts || []).map((p) => [p.slug, p]));
        if (b.settings) db.settings = b.settings; db.backlinks = b.backlinks || []; db.redirects = b.redirects || [];
        return json({ ok: true });
      }
      return error("Not found", 404);
    } catch (e) {
      return error(e.message || "Something went wrong", 400);
    }
  });

  return {
    server, requests,
    get db() { return db; },
    listen: (port = 8899, host = "127.0.0.1") => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve(`http://${host}:${port}`)); }),
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mock = createMock({ log: true });
  const base = await mock.listen(Number(process.env.PORT) || 8899);
  console.log(`Admin mock: ${base}/admin  (password: ${process.env.ADMIN_PASSWORD || "bentley"})`);
}
