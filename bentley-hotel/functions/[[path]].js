/**
 * Public router for the Bentley Hotel site (Cloudflare Pages Function, catch-all).
 *
 *  /                       the homepage (settings.site.homepage_slug, default "index")
 *  /<slug>                 a page (pages table; "events/burns-night" style slugs allowed)
 *  /events                 events & packages index (or a page with the slug "events" if one exists)
 *  /blog, /blog/<slug>, /blog/feed.xml   the blog
 *  /sitemap.xml, /robots.txt
 *  /media/<key>            uploaded files from R2
 *  anything else           redirects table, then the static files in public/
 *
 * Without a D1 binding (env.DB) everything falls through to the static export in public/.
 */
import * as db from "./_lib/db.js";
import { getTheme } from "./_lib/themes.js";
import { getSession } from "./_lib/auth.js";
import { renderPage, renderPost, renderListing, renderFeed, renderSitemap, sortEvents } from "./_lib/render.js";

const CACHE_SECONDS = 300;
const STATIC_PREFIXES = ["/assets/", "/favicon", "/apple-touch-icon", "/_headers"];

const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", ...extra } });
const redirect = (to, code = 301) => new Response(null, { status: code, headers: { Location: to, "Cache-Control": "public, max-age=3600" } });

async function serveMedia(env, key) {
  if (!env.MEDIA || !/^[A-Za-z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const type = (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream";
  return new Response(obj.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}

async function loadContext(env) {
  const settings = await db.getSettings(env.DB);
  const site = settings.site;
  if (!site) return null;
  const pages = await db.listPages(env.DB, { status: "published" });
  const events = sortEvents(pages.filter((p) => p.kind === "event"));
  const posts = await db.listPosts(env.DB, { status: "published", limit: 6 });
  return { site, theme: getTheme(site.theme), version: settings.version || 0, pages, events, posts, hasBlog: posts.length > 0, hasEvents: events.length > 0 };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path = url.pathname;

  if (!env.DB) return env.ASSETS.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (STATIC_PREFIXES.some((p) => path.startsWith(p))) return env.ASSETS.fetch(request);
  if (path.startsWith("/media/")) return serveMedia(env, path.slice(7));

  // Old URLs from the redirects table win over everything else.
  const r = await db.getRedirect(env.DB, path).catch(() => null);
  if (r && r.to_url) return redirect(r.to_url, r.code || 301);

  // Clean URLs: /rooms.html -> /rooms, /index -> /, trailing slashes removed.
  if (path.endsWith(".html")) return redirect(path === "/index.html" ? "/" : path.slice(0, -5) + url.search);
  if (path.length > 1 && path.endsWith("/")) return redirect(path.replace(/\/+$/, "") + url.search);
  if (path === "/index") return redirect("/" + url.search);

  let ctx;
  try { ctx = await loadContext(env); } catch (err) { return env.ASSETS.fetch(request); }
  if (!ctx) return env.ASSETS.fetch(request); // database present but not seeded yet

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = cache ? new Request(`${url.origin}${path}?v=${ctx.version}`) : null;
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }

  const site = ctx.site;
  const base = (site.site_url || url.origin).replace(/\/$/, "");
  let response = null;

  if (path === "/robots.txt") {
    response = new Response(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${base}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } else if (path === "/sitemap.xml") {
    const urls = [base + "/"];
    for (const p of ctx.pages) if (p.kind !== "system" && p.slug !== "index" && p.slug !== site.homepage_slug && !(p.meta && p.meta.noindex)) urls.push(`${base}/${p.slug}`);
    if (ctx.hasEvents) urls.push(base + "/events");
    if (ctx.hasBlog) { urls.push(base + "/blog"); for (const p of await db.listPosts(env.DB, { status: "published" })) urls.push(`${base}/blog/${p.slug}`); }
    response = new Response(renderSitemap(urls), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  } else if (path === "/blog/feed.xml") {
    response = new Response(renderFeed(await db.listPosts(env.DB, { status: "published", limit: 20 }), site), { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
  } else if (path === "/blog") {
    const posts = await db.listPosts(env.DB, { status: "published" });
    response = html(renderListing({ kind: "posts", items: posts, title: "News", eyebrow: "From the hotel", lede: `News and articles from ${site.name}.`, path: "/blog", description: `News and articles from ${site.name}, ${site.address.town}.` }, ctx));
  } else if (path.startsWith("/blog/")) {
    const post = await db.getPost(env.DB, path.slice(6));
    response = post && post.status === "published" ? html(renderPost(post, ctx)) : null;
  } else if (path === "/events" && !ctx.pages.some((p) => p.slug === "events")) {
    response = html(renderListing({ kind: "events", items: ctx.events, title: "Events & packages", eyebrow: "Through the year", lede: "Burns Night to Hogmanay, family lunches to party nights: what we host and arrange.", path: "/events", description: `Events, celebrations and packages at ${site.name}, ${site.address.town}: Burns Night, Christmas, Hogmanay, family lunches and more.` }, ctx));
  } else {
    const home = site.homepage_slug || "index";
    if (path !== "/" && (path === "/" + home || (path === "/index"))) return redirect("/" + url.search);
    const slug = path === "/" ? home : path.slice(1);
    const page = await db.getPage(env.DB, slug);
    if (page && page.status === "published" && page.kind !== "system") response = html(renderPage(page, ctx));
    else if (page && page.status === "draft" && url.searchParams.get("preview") === "draft" && await getSession(request, env)) response = html(renderPage(page, ctx), 200, { "Cache-Control": "no-store" });
  }

  if (!response) {
    // A static file (for example an uploaded asset) or the 404 page.
    const asset = await env.ASSETS.fetch(request);
    if (asset && asset.status !== 404) return asset;
    const nf = await db.getPage(env.DB, "404");
    return html(nf ? renderPage(nf, ctx) : "<h1>Page not found</h1>", 404, { "Cache-Control": "no-store" });
  }

  if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  if (cache && response.status === 200) {
    const store = cache.put(cacheKey, response.clone());
    if (context.waitUntil) context.waitUntil(store); else await store;
  }
  return response;
}
