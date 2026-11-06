// Backend tests: the public router, the admin API, rendering helpers, markdown and auth.
// Runs the real Pages Functions in-process with a SQLite stand-in for D1 (see src/dev.js).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/dev.js";
import { markdownToHtml, excerptFromMarkdown } from "../functions/_lib/markdown.js";
import { fixLinks, hrefFor } from "../functions/_lib/render.js";
import { hashPassword, verifyPassword, getSession } from "../functions/_lib/auth.js";
import { listThemes } from "../functions/_lib/themes.js";

const PASSWORD = "test-password-123";
let app, mediaDir, cookie;
const url = (p) => "http://127.0.0.1:8788" + p;
const get = (p, init) => app.handle(new Request(url(p), init));
const api = (method, p, body, extra = {}) => get(p, { method, headers: { Cookie: cookie, "X-Requested-With": "fetch", "Content-Type": "application/json", ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  mediaDir = mkdtempSync(join(tmpdir(), "bentley-media-"));
  app = await createApp({ dbPath: ":memory:", mediaDir, seed: true, env: { ADMIN_PASSWORD: PASSWORD, SESSION_SECRET: "x".repeat(48) } });
});
after(() => { app.close(); rmSync(mediaDir, { recursive: true, force: true }); });

test("markdown converts the common constructs and escapes HTML", () => {
  const html = markdownToHtml("# Title\n\nSome **bold** and *em* with `code` and [a link](https://x.test/a).\n\n- one\n- two\n\n> quote\n\n<script>alert(1)</script>");
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>em<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/x.test\/a" rel="noopener">a link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>quote<\/p><\/blockquote>/);
  assert.ok(!html.includes("<script>"), "raw HTML is escaped");
  assert.equal(excerptFromMarkdown("## Hello **world** this is [x](y)", 20), "Hello world this…");
  assert.equal(excerptFromMarkdown("Short", 20), "Short");
});

test("links are rewritten to clean, root-relative URLs", () => {
  const out = fixLinks('<a href="rooms.html#double">x</a> <a href="index.html">h</a> <img src="assets/img/a.jpg" srcset="assets/img/a-800.jpg 800w, assets/img/a-lg.jpg 1400w"> <a href="https://e.test/p.html">e</a> <a href="#main">m</a> <form action="book.html?rid=1">');
  assert.ok(out.includes('href="/rooms#double"'));
  assert.ok(out.includes('href="/"'));
  assert.ok(out.includes('src="/assets/img/a.jpg"'));
  assert.ok(out.includes('srcset="/assets/img/a-800.jpg 800w, /assets/img/a-lg.jpg 1400w"'));
  assert.ok(out.includes('href="https://e.test/p.html"'));
  assert.ok(out.includes('href="#main"'));
  assert.ok(out.includes('action="/book?rid=1"'));
  assert.equal(hrefFor("contact.html?enquiry=Wedding"), "/contact?enquiry=Wedding");
});

test("password hashing and session cookies", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.ok(hash.startsWith("pbkdf2$"));
  assert.equal(await verifyPassword({ ADMIN_PASSWORD_HASH: hash }, "correct horse battery"), true);
  assert.equal(await verifyPassword({ ADMIN_PASSWORD_HASH: hash }, "wrong"), false);
  assert.equal(await verifyPassword({ ADMIN_PASSWORD: "abc" }, "abc"), true);
  const bad = new Request(url("/admin/api/me"), { headers: { Cookie: "bh_admin=abc.def" } });
  assert.equal(await getSession(bad, { SESSION_SECRET: "k" }), null);
  assert.equal(listThemes().length, 10);
});

test("public pages render from the database with the brand, theme and clean URLs", async () => {
  let r = await get("/"); let html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /<title>[^<]*Bentley Hotel/);
  assert.ok(!html.includes("The Bentley Hotel"), "old name must not appear");
  assert.ok(html.includes('data-header="classic"'));
  assert.ok(html.includes('href="/rooms"'));
  r = await get("/rooms"); assert.equal(r.status, 200);
  r = await get("/rooms.html"); assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/rooms");
  r = await get("/index.html"); assert.equal(r.headers.get("location"), "/");
  r = await get("/rooms/"); assert.equal(r.headers.get("location"), "/rooms");
  r = await get("/sitemap.xml"); const sm = await r.text(); assert.ok(sm.includes("<loc>https://www.thebentleyhotel.co.uk/rooms</loc>")); assert.ok(!sm.includes("/404"));
  r = await get("/robots.txt"); assert.match(await r.text(), /Disallow: \/admin/);
  r = await get("/restaurant.htm"); assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/dining");
  r = await get("/no-such-page"); assert.equal(r.status, 404); assert.match(await r.text(), /Sorry, that page/);
  r = await get("/assets/css/styles.css"); assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/css/);
  r = await get("/events"); assert.equal(r.status, 200);
  r = await get("/", { method: "POST" }); assert.equal(r.status, 405);
});

test("admin requires login, blocks CSRF, and the API round-trips content", async () => {
  let r = await get("/admin/api/pages"); assert.equal(r.status, 401);
  r = await get("/admin"); assert.equal(r.status, 200); assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  r = await get("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: JSON.stringify({ password: "nope" }) });
  assert.equal(r.status, 401);
  r = await get("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(r.status, 200);
  const setCookie = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie()[0] : r.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(";")[0];

  r = await get("/admin/api/pages/rooms", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403, "mutations without the fetch header are blocked");

  r = await api("GET", "/admin/api/stats"); const stats = await r.json();
  assert.ok(stats.pages >= 10 && stats.landing >= 1);

  r = await api("POST", "/admin/api/pages", { slug: "test-page", title: "Test page", kind: "page", status: "published", meta: { description: "A test page description that is long enough to pass the audit checks." }, sections: [{ type: "text", title: "Hello", html: "<p>Hi <a href=\"rooms.html\">rooms</a></p>" }, { type: "features", items: [{ icon: "bed", title: "F", text: "t" }] }, { type: "faq", items: [{ q: "Q?", a: "A." }] }] });
  assert.equal(r.status, 201);
  r = await api("POST", "/admin/api/pages", { slug: "test-page", title: "dup" }); assert.equal(r.status, 400);
  r = await api("POST", "/admin/api/pages", { slug: "Bad Slug", title: "x" }); assert.equal(r.status, 400);
  r = await get("/test-page"); const page = await r.text();
  assert.equal(r.status, 200); assert.ok(page.includes('href="/rooms"')); assert.ok(page.includes("<details><summary>Q?</summary>"));

  r = await api("PUT", "/admin/api/pages/test-page", { slug: "test-page", title: "Test page", kind: "page", status: "draft", sections: [] });
  assert.equal(r.status, 200);
  r = await get("/test-page"); assert.equal(r.status, 404, "drafts are not public");
  r = await get("/test-page?preview=draft"); assert.equal(r.status, 404, "drafts are not previewable without a session");
  r = await get("/test-page?preview=draft", { headers: { Cookie: cookie } }); assert.equal(r.status, 200, "drafts can be previewed when logged in");
  r = await api("POST", "/admin/api/pages/test-page/duplicate"); assert.equal(r.status, 201); assert.equal((await r.json()).page.slug, "test-page-copy");
  r = await api("DELETE", "/admin/api/pages/test-page-copy"); assert.equal(r.status, 200);
  r = await api("DELETE", "/admin/api/pages/index"); assert.equal(r.status, 400);

  r = await api("POST", "/admin/api/preview", { page: { slug: "p", title: "Preview", hero: { style: "plain", title: "Preview title" }, sections: [{ type: "stats", items: [{ value: "18", label: "rooms" }] }] } });
  assert.equal(r.status, 200); assert.match(await r.text(), /Preview title[\s\S]*stat__value/);

  r = await api("POST", "/admin/api/posts", { slug: "hello", title: "Hello", status: "published", body_md: "Some **bold**", excerpt: "x" }); assert.equal(r.status, 201);
  r = await get("/blog/hello"); assert.equal(r.status, 200); assert.match(await r.text(), /<strong>bold<\/strong>/);
  r = await get("/blog"); assert.match(await r.text(), /Hello/);
  r = await get("/blog/feed.xml"); assert.match(await r.text(), /<item><title>Hello<\/title>/);
  r = await api("POST", "/admin/api/markdown", { md: "*x*" }); assert.deepEqual(await r.json(), { html: "<p><em>x</em></p>" });

  r = await api("POST", "/admin/api/backlinks", { source_url: "https://example.com/", target_url: "https://www.thebentleyhotel.co.uk/", anchor_text: "Bentley" });
  assert.equal(r.status, 201); const bl = (await r.json()).backlink; assert.equal(bl.status, "unchecked");
  r = await api("POST", "/admin/api/backlinks", { source_url: "not a url" }); assert.equal(r.status, 400);
  r = await api("DELETE", `/admin/api/backlinks/${bl.id}`); assert.equal(r.status, 200);

  r = await api("PUT", "/admin/api/redirects", { redirects: [{ from_path: "/old-page", to_url: "/rooms", code: 301 }] }); assert.equal(r.status, 200);
  r = await get("/old-page"); assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/rooms");
  r = await api("PUT", "/admin/api/redirects", { redirects: [{ from_path: "bad", to_url: "/" }] }); assert.equal(r.status, 400);

  r = await api("PUT", "/admin/api/settings", { site: { theme: "midnight-brass" } }); assert.equal(r.status, 200);
  r = await get("/"); assert.ok((await r.text()).includes('data-dark="true"'), "theme change is live");
  r = await api("PUT", "/admin/api/settings", { site: { theme: "no-such" } }); assert.equal(r.status, 400);
  r = await api("PUT", "/admin/api/settings", { site: { theme: "heritage-green", homepage_slug: "hotel-in-motherwell" } }); assert.equal(r.status, 200);
  r = await get("/"); assert.match(await r.text(), /hotel-in-motherwell|Hotel in Motherwell/i);
  r = await get("/hotel-in-motherwell"); assert.equal(r.headers.get("location"), "/");
  await api("PUT", "/admin/api/settings", { site: { homepage_slug: "index" } });

  r = await api("GET", "/admin/api/seo"); const seo = await r.json(); assert.ok(Array.isArray(seo.pages) && seo.summary.pages > 0);
  r = await api("GET", "/admin/api/themes"); assert.equal((await r.json()).themes.length, 10);
  r = await api("GET", "/admin/api/export"); const dump = await r.json(); assert.ok(dump.pages.length > 10 && dump.settings.site);
  r = await api("POST", "/admin/api/import", { settings: dump.settings, pages: dump.pages, posts: dump.posts, backlinks: dump.backlinks, redirects: dump.redirects }); assert.equal(r.status, 200);
  r = await get("/rooms"); assert.equal(r.status, 200);
  r = await api("POST", "/admin/api/logout"); assert.equal(r.status, 200);
});

test("media upload stores the file and serves it", async () => {
  let r = await get("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = (typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie()[0] : r.headers.get("set-cookie")).split(";")[0];
  // 1x1 PNG
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new File([png], "Test Image.PNG", { type: "image/png" }));
  form.append("alt", "A test");
  r = await get("/admin/api/media", { method: "POST", headers: { Cookie: cookie, "X-Requested-With": "fetch" }, body: form });
  assert.equal(r.status, 201);
  const { media } = await r.json();
  assert.match(media[0].key, /-test-image\.png$/); assert.equal(media[0].width, 1); assert.equal(media[0].alt, "A test");
  r = await get(media[0].url); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
  const bad = new FormData(); bad.append("file", new File([new Uint8Array([1])], "x.svg", { type: "image/svg+xml" }));
  r = await get("/admin/api/media", { method: "POST", headers: { Cookie: cookie, "X-Requested-With": "fetch" }, body: bad }); assert.equal(r.status, 400);
  r = await api("DELETE", `/admin/api/media/${media[0].key}`); assert.equal(r.status, 200);
  r = await get(media[0].url); assert.equal(r.status, 404);
});
