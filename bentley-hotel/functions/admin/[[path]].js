/**
 * Admin area for the Bentley Hotel site: the single-page app at /admin and its JSON API at /admin/api/*.
 * See docs/architecture.md for the endpoint list.
 */
import * as db from "../_lib/db.js";
import { authConfigured, verifyPassword, createSession, clearSessionCookie, getSession, csrfOk } from "../_lib/auth.js";
import { getTheme, listThemes, THEMES } from "../_lib/themes.js";
import { renderPage } from "../_lib/render.js";
import { markdownToHtml } from "../_lib/markdown.js";
import { adminHtml } from "./ui.js";
import SEED from "../_lib/seed-data.js";

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
const err = (message, status = 400) => json({ error: message }, status);
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; frame-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const MAX_UPLOAD = 15 * 1024 * 1024;
const ALLOWED_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };

const loginAttempts = new Map(); // best-effort, per isolate

async function readJson(request) {
  try { return await request.json(); } catch { throw new Error("Invalid JSON body"); }
}

function imageSize(bytes) {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return { width: null, height: null };
}

async function checkBacklink(env, row, site) {
  const result = { status: "error", http_status: null, last_checked: new Date().toISOString() };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(row.source_url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BentleyHotelLinkCheck/1.0)", Accept: "text/html,*/*" }, redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    result.http_status = res.status;
    const text = (await res.text()).slice(0, 2_000_000).toLowerCase();
    const targets = new Set();
    const t1 = String(row.target_url || site.site_url || "").toLowerCase().replace(/\/$/, "");
    if (t1) { targets.add(t1); try { const u = new URL(t1); targets.add(u.host); targets.add(u.host.replace(/^www\./, "")); } catch {} }
    result.status = res.ok && [...targets].some((x) => x && text.includes(x)) ? "live" : (res.ok ? "missing" : "error");
  } catch {
    result.status = "error";
  }
  await db.updateBacklink(env.DB, row.id, result);
  return { ...row, ...result };
}

function seoAudit(pages, site) {
  const titles = new Map(), descs = new Map();
  for (const p of pages) {
    const t = (p.meta && p.meta.title) || ""; const d = (p.meta && p.meta.description) || "";
    titles.set(t, (titles.get(t) || 0) + 1); descs.set(d, (descs.get(d) || 0) + 1);
  }
  const slugs = new Set(pages.map((p) => p.slug));
  const out = pages.filter((p) => p.kind !== "system").map((p) => {
    const issues = [];
    const t = (p.meta && p.meta.title) || "", d = (p.meta && p.meta.description) || "";
    if (!t) issues.push("No meta title"); else if (t.length > 65) issues.push(`Meta title is ${t.length} characters (aim for 60 or fewer)`);
    if (!d) issues.push("No meta description"); else if (d.length > 160) issues.push(`Meta description is ${d.length} characters (aim for 160 or fewer)`); else if (d.length < 50) issues.push("Meta description is very short");
    if (t && titles.get(t) > 1) issues.push("Duplicate meta title");
    if (d && descs.get(d) > 1) issues.push("Duplicate meta description");
    if (!(p.meta && p.meta.og_image)) issues.push("No social-sharing image");
    if (p.meta && p.meta.noindex && p.status === "published") issues.push("Published but marked noindex");
    if (!p.hero && !(p.sections || []).length) issues.push("Page has no content");
    const htmlBlob = JSON.stringify(p.sections || "");
    for (const m of htmlBlob.matchAll(/href=\\"\/?([a-z0-9][a-z0-9\-\/]*?)(?:\.html)?(?:[?#\\][^"]*)?\\"/g)) {
      const s = m[1];
      if (["blog", "events", "admin", "media", "assets"].includes(s.split("/")[0])) continue;
      if (!slugs.has(s) && s !== "index") issues.push(`Link to a page that doesn't exist: /${s}`);
    }
    if (p.kind === "event" && !(p.event && p.event.dates_text)) issues.push("Event has no dates text");
    return { slug: p.slug, title: p.title, kind: p.kind, status: p.status, issues: [...new Set(issues)] };
  });
  return { pages: out, summary: { pages: pages.length, with_issues: out.filter((p) => p.issues.length).length, drafts: pages.filter((p) => p.status === "draft").length, site_url: site.site_url } };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/admin";

  if (!path.startsWith("/admin/api")) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const session = env.DB ? await getSession(request, env) : null;
    return new Response(adminHtml({ loggedIn: Boolean(session) }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  }

  const route = path.slice("/admin/api".length).replace(/^\//, "");
  const parts = route.split("/").filter(Boolean);
  const method = request.method;

  try {
    if (!env.DB) return err("The database is not configured. Add the D1 binding (DB) in wrangler.toml or the Pages settings.", 503);
    if (!authConfigured(env)) return err("Admin login is not configured. Set the ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) and SESSION_SECRET secrets.", 503);
    await db.ensureSchema(env.DB);

    if (route === "login" && method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      const a = loginAttempts.get(ip) || { n: 0, until: 0 };
      if (a.until > Date.now()) return err("Too many attempts. Try again in a minute.", 429);
      const body = await readJson(request);
      if (await verifyPassword(env, body.password)) {
        loginAttempts.delete(ip);
        return json({ ok: true }, 200, { "Set-Cookie": await createSession(env, request) });
      }
      a.n += 1; if (a.n >= 5) { a.until = Date.now() + 60_000; a.n = 0; }
      loginAttempts.set(ip, a);
      await new Promise((r) => setTimeout(r, 400));
      return err("Wrong password", 401);
    }

    const session = await getSession(request, env);
    if (route === "me") return json({ loggedIn: Boolean(session), configured: true, version: SEED.version || null });
    if (!session) return err("Not logged in", 401);
    if (method !== "GET" && method !== "HEAD" && !csrfOk(request)) return err("Request blocked (missing X-Requested-With header or cross-site request)", 403);

    if (route === "logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });

    // ----- settings & themes -----
    if (route === "settings") {
      if (method === "GET") { const s = await db.getSettings(env.DB); return json({ site: s.site || SEED.settings.site, version: s.version || 0, seeded: Boolean(s.site) }); }
      if (method === "PUT") {
        const body = await readJson(request);
        const current = (await db.getSettings(env.DB)).site || SEED.settings.site;
        const site = { ...current, ...(body.site || {}) };
        if (!THEMES[site.theme]) return err("Unknown theme");
        if (site.homepage_slug && site.homepage_slug !== "index" && !(await db.getPage(env.DB, site.homepage_slug))) return err("Homepage page not found");
        for (const k of ["name", "phone", "phone_tel", "email", "site_url", "booking_url", "hosted_booking_url"]) if (typeof site[k] !== "string") return err(`${k} must be text`);
        if (site.site_url && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site.site_url.replace(/\/$/, ""))) return err("Site URL must be like https://www.thebentleyhotel.co.uk (no path)");
        site.site_url = (site.site_url || "").replace(/\/$/, "");
        for (const k of ["ga4_measurement_id", "ga4_booking_event", "ga4_linker_domains", "google_site_verification", "bing_site_verification", "cookie_banner_text", "currency_code"]) if (site[k] != null && typeof site[k] !== "string") return err(`${k} must be text`);
        site.ga4_measurement_id = String(site.ga4_measurement_id || "").trim().toUpperCase();
        if (site.ga4_measurement_id && !/^G-[A-Z0-9]{4,16}$/.test(site.ga4_measurement_id)) return err("GA4 Measurement ID must look like G-XXXXXXXXXX");
        if (!["purchase", "booking_confirmed", "off"].includes(site.ga4_booking_event || "purchase")) return err("Booking event must be purchase, booking_confirmed or off");
        site.ga4_booking_event = site.ga4_booking_event || "purchase";
        site.ga4_linker_domains = String(site.ga4_linker_domains || "").split(/[\s,]+/).filter(Boolean).map((d) => d.toLowerCase()).join(",");
        if (site.ga4_linker_domains && !/^[a-z0-9.-]+(,[a-z0-9.-]+)*$/.test(site.ga4_linker_domains)) return err("Linker domains must be host names separated by commas");
        for (const k of ["google_site_verification", "bing_site_verification"]) { site[k] = String(site[k] || "").trim(); if (site[k] && !/^[A-Za-z0-9_=-]{8,128}$/.test(site[k])) return err(`${k.replace("_site_verification", "")} verification code looks wrong (paste only the content value, not the whole tag)`); }
        site.currency_code = String(site.currency_code || "GBP").toUpperCase().slice(0, 3) || "GBP";
        site.address = { ...current.address, ...(site.address || {}) };
        site.social = Array.isArray(site.social) ? site.social.filter((s) => s && s.url).map((s) => ({ label: String(s.label || ""), url: String(s.url) })) : [];
        await db.setSetting(env.DB, "site", site);
        await db.bumpVersion(env.DB);
        return json({ ok: true, site });
      }
    }
    if (route === "themes" && method === "GET") return json({ themes: listThemes(), current: ((await db.getSettings(env.DB)).site || {}).theme || "heritage-green" });
    if (route === "stats" && method === "GET") {
      const pages = await db.listPages(env.DB);
      return json({ pages: pages.filter((p) => p.kind === "page").length, landing: pages.filter((p) => p.kind === "landing").length, events: pages.filter((p) => p.kind === "event").length,
        drafts: pages.filter((p) => p.status === "draft").length, posts: (await db.listPosts(env.DB)).length, media: (await db.listMedia(env.DB)).length, backlinks: (await db.listBacklinks(env.DB)).length, redirects: (await db.listRedirects(env.DB)).length });
    }

    // ----- pages -----
    if (parts[0] === "pages") {
      if (parts.length === 1 && method === "GET") return json({ pages: await db.listPages(env.DB, { kind: url.searchParams.get("kind") || undefined }) });
      if (parts.length === 1 && method === "POST") { const page = await db.upsertPage(env.DB, await readJson(request), { create: true }); return json({ ok: true, page }, 201); }
      const slug = parts.slice(1).join("/").replace(/\/duplicate$/, "");
      const isDup = parts[parts.length - 1] === "duplicate" && parts.length > 2;
      if (isDup && method === "POST") {
        const src = await db.getPage(env.DB, slug);
        if (!src) return err("Page not found", 404);
        let n = 2, newSlug = `${slug}-copy`;
        while (await db.getPage(env.DB, newSlug)) newSlug = `${slug}-copy-${n++}`;
        const page = await db.upsertPage(env.DB, { ...src, slug: newSlug, status: "draft", title: `${src.title} (copy)`, in_nav: 0 }, { create: true });
        return json({ ok: true, page }, 201);
      }
      if (method === "GET") { const page = await db.getPage(env.DB, slug); return page ? json({ page }) : err("Page not found", 404); }
      if (method === "PUT") {
        const body = await readJson(request);
        if (body.slug && body.slug !== slug) return err("The slug cannot be changed here; duplicate the page with a new slug instead");
        const page = await db.upsertPage(env.DB, { ...body, slug });
        return json({ ok: true, page });
      }
      if (method === "DELETE") { if (slug === "index" || slug === "404") return err("That page cannot be deleted"); await db.deletePage(env.DB, slug); return json({ ok: true }); }
    }
    if (route === "preview" && method === "POST") {
      const body = await readJson(request);
      const settings = await db.getSettings(env.DB);
      const site = settings.site || SEED.settings.site;
      const pages = await db.listPages(env.DB, { status: "published" });
      const page = db.normalisePage({ ...body.page, slug: body.page && body.page.slug || "preview" });
      const htmlOut = renderPage(page, { site, theme: getTheme(body.theme || site.theme), pages, events: pages.filter((p) => p.kind === "event"), posts: await db.listPosts(env.DB, { status: "published", limit: 3 }), hasBlog: true, hasEvents: true, extraHead: '<meta name="robots" content="noindex">' });
      return new Response(htmlOut, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    // ----- posts -----
    if (parts[0] === "posts") {
      if (parts.length === 1 && method === "GET") return json({ posts: (await db.listPosts(env.DB)).map((p) => ({ ...p, body_md: undefined })) });
      if (parts.length === 1 && method === "POST") { const post = await db.upsertPost(env.DB, await readJson(request), { create: true }); return json({ ok: true, post }, 201); }
      const slug = parts[1];
      if (method === "GET") { const post = await db.getPost(env.DB, slug); return post ? json({ post }) : err("Post not found", 404); }
      if (method === "PUT") { const body = await readJson(request); if (body.slug && body.slug !== slug) return err("The slug cannot be changed"); return json({ ok: true, post: await db.upsertPost(env.DB, { ...body, slug }) }); }
      if (method === "DELETE") { await db.deletePost(env.DB, slug); return json({ ok: true }); }
    }
    if (route === "markdown" && method === "POST") { const body = await readJson(request); return json({ html: markdownToHtml(String(body.md || "")) }); }

    // ----- media -----
    if (parts[0] === "media") {
      if (parts.length === 1 && method === "GET") return json({ media: await db.listMedia(env.DB) });
      if (parts.length === 1 && method === "POST") {
        if (!env.MEDIA) return err("Uploads are not configured. Add the R2 binding (MEDIA).", 503);
        const form = await request.formData();
        const files = form.getAll("file").filter((f) => f && typeof f === "object" && "arrayBuffer" in f);
        if (!files.length) return err("No file uploaded");
        const saved = [];
        for (const f of files) {
          const ext = ALLOWED_TYPES[f.type];
          if (!ext) return err(`File type not allowed: ${f.type || "unknown"} (use JPEG, PNG, WebP, GIF or PDF)`);
          if (f.size > MAX_UPLOAD) return err(`${f.name} is larger than 15 MB`);
          const bytes = new Uint8Array(await f.arrayBuffer());
          const safe = String(f.name || "upload").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "upload";
          const key = `${Date.now().toString(36)}-${safe}.${ext}`;
          const stored = await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: f.type } });
          const dims = f.type.startsWith("image/") ? imageSize(bytes) : { width: null, height: null };
          // Stores that keep files at their own address (Vercel Blob) return it; R2 does not, and /media/<key> serves the file.
          const external = stored && typeof stored.url === "string" && /^https:\/\//.test(stored.url) ? stored.url : null;
          const rec = { key, filename: f.name, content_type: f.type, size: f.size, alt: String(form.get("alt") || ""), ...dims, url: external };
          await db.addMedia(env.DB, rec);
          saved.push({ ...rec, url: `/media/${key}` });
        }
        await db.bumpVersion(env.DB);
        return json({ ok: true, media: saved }, 201);
      }
      const key = parts[1];
      if (method === "PUT") { const body = await readJson(request); await db.updateMedia(env.DB, key, { alt: body.alt }); await db.bumpVersion(env.DB); return json({ ok: true }); }
      if (method === "DELETE") { if (env.MEDIA) await env.MEDIA.delete(key); await db.deleteMedia(env.DB, key); await db.bumpVersion(env.DB); return json({ ok: true }); }
    }

    // ----- backlinks -----
    if (parts[0] === "backlinks") {
      const site = (await db.getSettings(env.DB)).site || SEED.settings.site;
      if (parts.length === 1 && method === "GET") return json({ backlinks: await db.listBacklinks(env.DB) });
      if (parts.length === 1 && method === "POST") { const id = await db.addBacklink(env.DB, await readJson(request)); return json({ ok: true, backlink: await db.getBacklink(env.DB, id) }, 201); }
      if (route === "backlinks/check-all" && method === "POST") {
        const rows = (await db.listBacklinks(env.DB)).slice(0, 25);
        const results = [];
        for (const row of rows) results.push(await checkBacklink(env, row, site));
        return json({ ok: true, backlinks: results });
      }
      const id = Number(parts[1]);
      if (!Number.isInteger(id)) return err("Bad id");
      if (parts[2] === "check" && method === "POST") { const row = await db.getBacklink(env.DB, id); if (!row) return err("Not found", 404); return json({ ok: true, backlink: await checkBacklink(env, row, site) }); }
      if (method === "PUT") { const body = await readJson(request); await db.updateBacklink(env.DB, id, { source_url: body.source_url, target_url: body.target_url, anchor_text: body.anchor_text, notes: body.notes }); return json({ ok: true, backlink: await db.getBacklink(env.DB, id) }); }
      if (method === "DELETE") { await db.deleteBacklink(env.DB, id); return json({ ok: true }); }
    }

    // ----- redirects, seo, seed, export, import -----
    if (route === "redirects") {
      if (method === "GET") return json({ redirects: await db.listRedirects(env.DB) });
      if (method === "PUT") { const body = await readJson(request); return json({ ok: true, redirects: await db.replaceRedirects(env.DB, body.redirects || []) }); }
    }
    if (route === "seo" && method === "GET") {
      const site = (await db.getSettings(env.DB)).site || SEED.settings.site;
      return json(seoAudit(await db.listPages(env.DB, { full: true }), site));
    }
    if (route === "seed" && method === "POST") {
      const body = await readJson(request).catch(() => ({}));
      await db.loadSeed(env.DB, SEED, { replace: Boolean(body.replace) });
      return json({ ok: true, pages: SEED.pages.length, posts: (SEED.posts || []).length });
    }
    if (route === "export" && method === "GET") return json(await db.exportAll(env.DB), 200, { "Content-Disposition": `attachment; filename="bentley-hotel-export-${new Date().toISOString().slice(0, 10)}.json"` });
    if (route === "import" && method === "POST") {
      const body = await readJson(request);
      if (!Array.isArray(body.pages)) return err("Import file must contain a pages array");
      await db.loadSeed(env.DB, { settings: body.settings, pages: body.pages, posts: body.posts || [], backlinks: body.backlinks || [], redirects: body.redirects || [] }, { replace: true });
      return json({ ok: true });
    }
    return err("Not found", 404);
  } catch (e) {
    const known = e && e.message && !/^(TypeError|ReferenceError)/.test(String(e.name)) && !/undefined|null|not a function/i.test(e.message);
    return err(known ? e.message : "Something went wrong", known ? 400 : 500);
  }
}
