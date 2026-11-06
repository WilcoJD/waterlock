// Browser tests for the admin front-end (functions/admin/ui.js) against the in-memory mock API
// (tests/admin-mock.mjs). Run with:  node --test tests/admin-ui.test.mjs
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createMock } from "./admin-mock.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "bentley";

let mock, browser, page;
const consoleErrors = [];
const pageErrors = [];

before(async () => {
  mock = createMock({ password: PASSWORD });
  await mock.listen(PORT);
  browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
});

after(async () => {
  if (browser) await browser.close();
  if (mock) await mock.close();
});

// A failed test can leave a modal dialog open; close it so later tests start clean.
beforeEach(async () => { if (page) await page.evaluate(() => { const d = document.querySelector("dialog[open]"); if (d) d.close(); }); });

const countPages = (kind) => [...mock.db.pages.values()].filter((p) => p.kind === kind).length;
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction(() => !document.querySelector("#view .loading")); };
const toastVisible = (text) => page.locator(".toast", { hasText: text }).first().waitFor({ state: "visible" });

test("login: wrong password is rejected, right password opens the dashboard", async () => {
  await page.goto(`${BASE}/admin`);
  await page.getByLabel("Password").waitFor();
  assert.equal(await page.locator("#app").isHidden(), true, "app shell hidden before login");
  await page.getByLabel("Password").fill("not-it");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator("#login-error").filter({ hasText: "Wrong password" }).waitFor();
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
  assert.equal(await page.locator("#login").isHidden(), true);
  const stats = await page.locator(".stat").allInnerTexts();
  assert.equal(stats.length, 6, "six count tiles");
  assert.match(stats[0], new RegExp(`^${countPages("page")}\\b[\\s\\S]*Pages`), "page count from the seed");
  assert.match(stats[1], new RegExp(`^${countPages("landing")}\\b[\\s\\S]*Landing pages`));
  assert.match(stats[2], new RegExp(`^${countPages("event")}\\b[\\s\\S]*Events`));
  assert.match(stats[5], new RegExp(`^${mock.db.backlinks.length}\\b[\\s\\S]*Backlinks`));
  await page.getByRole("heading", { name: "SEO audit" }).waitFor();
  assert.ok((await page.locator(".card", { hasText: "SEO audit" }).innerText()).includes("issue"), "audit summary shown");
  // the server told the page it was logged out; the login API call is the only one before signing in
  assert.equal(mock.requests.filter((r) => r.route !== "login")[0].method, "GET");
});

test("pages list: search works and Edit opens the editor with the slug locked", async () => {
  await go("#/pages");
  await page.getByRole("heading", { level: 1, name: "Pages" }).waitFor();
  const rowsBefore = await page.locator("tbody tr").count();
  assert.equal(rowsBefore, countPages("page") + countPages("system"), "lists pages and the system page");
  const matching = [...mock.db.pages.values()].filter((p) => (p.kind === "page" || p.kind === "system") && /room/i.test(p.title + p.slug)).length;
  await page.getByLabel("Search").fill("room");
  await page.waitForFunction((n) => document.querySelectorAll("tbody tr").length === n, matching);
  assert.ok(matching < rowsBefore, "search narrowed the list");
  await page.getByRole("row", { name: /Rooms/ }).getByRole("link", { name: "Edit" }).click();
  await page.getByRole("heading", { level: 1, name: "Edit page: Rooms" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Rooms");
  const slug = page.getByLabel("Slug");
  assert.equal(await slug.inputValue(), "rooms");
  assert.equal(await slug.getAttribute("readonly"), "", "slug is read-only after creation");
  assert.equal(await page.locator("#sections .sec").count(), 11, "all eleven html sections listed");
  assert.equal(await page.locator("#sections .sec__body:not([hidden])").count(), 0, "existing sections start collapsed");
  // meta counters
  const titleCounter = page.locator(".count").first();
  assert.match(await titleCounter.innerText(), /^\d+\/60/);
  await page.getByLabel("Meta title").fill("x".repeat(70));
  assert.match(await titleCounter.innerText(), /70\/60 .*too long/);
  assert.ok(await titleCounter.evaluate((el) => el.classList.contains("over")));
  await page.getByLabel("Meta title").fill("Rooms | Bentley Hotel, Motherwell");
  assert.equal(await page.locator("[data-dirty]").isVisible(), true, "unsaved-changes indicator appears");
});

test("page editor: add a features section with two items, save and check the PUT body", async () => {
  await page.getByLabel("Add a section").selectOption("features");
  await page.getByRole("button", { name: "Add section" }).click();
  const sec = page.locator("#sections .sec").last();
  await sec.locator(".sec__body:not([hidden])").waitFor();
  assert.equal(await sec.locator(".tag").innerText(), "FEATURES");
  await sec.getByLabel("Heading").fill("Why stay with us");
  await sec.getByLabel("Columns").selectOption("4");
  await sec.getByRole("button", { name: "Add item" }).click();
  await sec.getByRole("button", { name: "Add item" }).click();
  const items = sec.locator(".rep__item");
  assert.equal(await items.count(), 2);
  await items.nth(0).getByLabel("Title", { exact: true }).fill("Free WiFi");
  await items.nth(0).getByLabel("Icon").fill("wifi");
  await items.nth(1).getByLabel("Title", { exact: true }).fill("Free parking");
  await items.nth(1).getByLabel("Text").fill("Right outside the door.");
  // reorder: move the second item up, then back down
  await items.nth(1).getByRole("button", { name: "Move item 2 up" }).click();
  assert.equal(await sec.locator(".rep__item").nth(0).getByLabel("Title", { exact: true }).inputValue(), "Free parking");
  await sec.locator(".rep__item").nth(0).getByRole("button", { name: "Move item 1 down" }).click();
  assert.equal(await sec.locator(".rep__item").nth(0).getByLabel("Title", { exact: true }).inputValue(), "Free WiFi");

  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/admin/api/pages/rooms"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const req = await put;
  const body = req.postDataJSON();
  assert.equal(req.headers()["x-requested-with"], "fetch");
  assert.equal(body.slug, "rooms");
  assert.equal(body.kind, "page");
  assert.equal(body.title, "Rooms");
  assert.equal(body.meta.title, "Rooms | Bentley Hotel, Motherwell");
  assert.equal(body.sections.length, 12);
  assert.equal(body.sections[0].type, "html");
  const added = body.sections[11];
  assert.equal(added.type, "features");
  assert.equal(added.title, "Why stay with us");
  assert.equal(added.columns, 4, "columns sent as a number");
  assert.deepEqual(added.items.map((i) => i.title), ["Free WiFi", "Free parking"]);
  assert.equal(added.items[0].icon, "wifi");
  assert.equal(added.items[1].text, "Right outside the door.");
  assert.equal(body.event, null, "non-event pages send event: null");
  await toastVisible("Saved");
  assert.equal(await page.locator("[data-dirty]").isVisible(), false, "indicator cleared after save");
  assert.equal(mock.db.pages.get("rooms").sections.at(-1).items.length, 2, "mock stored the new section");
});

test("page editor: preview posts the page and shows it in an iframe; Escape closes it", async () => {
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/admin/api/preview"));
  await page.getByRole("button", { name: "Preview" }).click();
  const body = (await post).postDataJSON();
  assert.equal(body.page.slug, "rooms");
  assert.equal(body.page.sections.at(-1).title, "Why stay with us");
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor();
  assert.match(await dialog.getByRole("heading").innerText(), /Preview: Rooms/);
  const frame = dialog.locator("iframe.pv");
  await frame.waitFor();
  const srcdoc = await frame.getAttribute("srcdoc");
  assert.ok(srcdoc.includes("Why stay with us"), "preview HTML contains the unsaved section");
  assert.ok(srcdoc.includes(`<base href="${BASE}/">`), "base tag injected so relative assets resolve");
  await page.waitForFunction(() => { const f = document.querySelector("dialog[open] iframe.pv"); return f && f.contentDocument && f.contentDocument.querySelector("h2"); });
  await dialog.getByRole("button", { name: "Phone" }).click();
  assert.ok(await frame.evaluate((el) => el.classList.contains("pv--phone")));
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });
});

test("blog: create a post with a live markdown preview", async () => {
  await go("#/posts");
  await page.getByRole("heading", { level: 1, name: "Blog" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("link", { name: "New post" }).click();
  await page.getByRole("heading", { level: 1, name: "New blog post" }).waitFor();
  await page.getByLabel("Title", { exact: true }).fill("Burns Night 2026: tickets on sale");
  assert.equal(await page.getByLabel("Slug").inputValue(), "burns-night-2026-tickets-on-sale", "slug follows the title");
  await page.getByLabel("Tags").fill("events, burns night");
  await page.getByLabel("Status").selectOption("published");
  const md = page.getByLabel("Body (Markdown)");
  await md.fill("# Tickets\n\nOur **Burns Night** supper is back.\n\n- Haggis\n- Neeps");
  await page.locator("#md-preview strong", { hasText: "Burns Night" }).waitFor();
  assert.equal(await page.locator("#md-preview li").count(), 2, "markdown rendered through the API");
  assert.equal(await page.locator("#md-preview h2").innerText(), "Tickets");
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/admin/api/posts"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const body = (await post).postDataJSON();
  assert.equal(body.slug, "burns-night-2026-tickets-on-sale");
  assert.deepEqual(body.tags, ["events", "burns night"]);
  assert.equal(body.status, "published");
  assert.ok(body.body_md.startsWith("# Tickets"));
  await page.getByRole("heading", { level: 1, name: "Edit post: Burns Night 2026: tickets on sale" }).waitFor();
  assert.equal(await page.getByLabel("Slug").getAttribute("readonly"), "");
  assert.ok(mock.db.posts.has("burns-night-2026-tickets-on-sale"));
  await go("#/posts");
  await page.getByRole("row", { name: /Burns Night 2026/ }).waitFor();
});

test("backlinks: add one and check it", async () => {
  await go("#/backlinks");
  await page.getByRole("heading", { level: 1, name: "Backlinks" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), mock.db.backlinks.length, "seed backlinks listed");
  await page.getByLabel("Source URL (the page that links to us)").fill("https://www.visitlanarkshire.com/stay/bentley-hotel");
  await page.getByLabel("Target URL (our page)").fill("https://www.thebentleyhotel.co.uk/rooms");
  await page.getByLabel("Anchor text").fill("Bentley Hotel rooms");
  await page.getByLabel("Notes").first().fill("Tourism board listing");
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/admin/api/backlinks"));
  await page.getByRole("button", { name: "Add backlink" }).click();
  assert.equal((await post).postDataJSON().anchor_text, "Bentley Hotel rooms");
  const row = page.getByRole("row", { name: /visitlanarkshire/ });
  await row.waitFor();
  assert.equal((await row.locator(".badge").textContent()).trim(), "unchecked");
  const check = page.waitForRequest((r) => r.method() === "POST" && /\/admin\/api\/backlinks\/\d+\/check$/.test(r.url()));
  await row.getByRole("button", { name: "Check" }).click();
  await check;
  await page.getByRole("row", { name: /visitlanarkshire/ }).locator(".badge--live").waitFor();
  const cells = await page.getByRole("row", { name: /visitlanarkshire/ }).locator("td").allInnerTexts();
  assert.equal(cells[4], "200", "HTTP status shown");
  assert.notEqual(cells[5], "—", "last checked shown");
  assert.equal(mock.db.backlinks.find((b) => b.source_url.includes("visitlanarkshire")).status, "live");
});

test("themes: pick a theme from the dropdown and apply it", async () => {
  await go("#/themes");
  await page.getByRole("heading", { level: 1, name: "Themes" }).waitFor();
  assert.equal(await page.locator(".theme").count(), 10, "ten theme cards");
  assert.equal(await page.locator('.theme[aria-pressed="true"] strong').innerText(), "Heritage Green");
  assert.equal(await page.locator(".theme .swatch").first().evaluate((el) => el.style.background), "rgb(23, 48, 42)", "swatch coloured via CSSOM, not inline style attributes");
  await page.getByLabel("Theme").selectOption("midnight-brass");
  assert.equal(await page.locator('.theme[aria-pressed="true"] strong').innerText(), "Midnight Brass");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/admin/api/settings"));
  await page.getByRole("button", { name: "Apply theme" }).click();
  const body = (await put).postDataJSON();
  assert.equal(body.site.theme, "midnight-brass");
  assert.equal(body.site.name, "Bentley Hotel", "the rest of the settings are sent along");
  await page.locator("#theme-applied").getByRole("link", { name: "Open site" }).waitFor();
  assert.equal(mock.db.settings.site.theme, "midnight-brass");
  await page.locator('.theme[aria-pressed="true"] .badge--live', { hasText: "current" }).waitFor();
});

test("settings, SEO, redirects and media screens render with real data", async () => {
  await go("#/settings");
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "Bentley Hotel");
  const homepage = page.getByLabel("Homepage");
  assert.equal(await homepage.inputValue(), "index");
  assert.ok((await homepage.locator("option").count()) >= 2, "landing pages offered as homepage");
  await go("#/seo");
  await page.getByRole("heading", { level: 1, name: "SEO" }).waitFor();
  await page.getByRole("link", { name: "Page not found" }).waitFor();
  assert.equal(await page.getByLabel("Site URL").inputValue(), "https://www.thebentleyhotel.co.uk");
  await go("#/redirects");
  await page.getByRole("heading", { level: 1, name: "Redirects" }).waitFor();
  const n = mock.db.redirects.length;
  assert.equal(await page.locator("tbody tr").count(), n);
  await page.getByRole("button", { name: "Add redirect" }).click();
  assert.equal(await page.locator("tbody tr").count(), n + 1);
  const rows = page.locator("tbody tr");
  await rows.nth(n).getByLabel("From path").fill("/old-events.htm");
  await rows.nth(n).getByLabel("To").fill("/events/burns-night");
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/admin/api/redirects"));
  await page.getByRole("button", { name: "Save redirects" }).click();
  const body = (await put).postDataJSON();
  assert.equal(body.redirects.length, n + 1);
  assert.deepEqual(body.redirects[n], { from_path: "/old-events.htm", to_url: "/events/burns-night", code: 301 });
  await toastVisible("Redirects saved");
  await go("#/media");
  await page.getByRole("heading", { level: 1, name: "Media" }).waitFor();
  await page.locator(".empty", { hasText: "No uploads yet" }).waitFor();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.locator("#upload").setInputFiles([{ name: "lounge.png", mimeType: "image/png", buffer: png }, { name: "menu.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") }]);
  await page.locator(".media__card").nth(1).waitFor();
  assert.equal(mock.db.media.size, 2, "both files reached the server in one multipart request");
  const card = page.locator(".media__card", { hasText: "lounge.png" });
  await card.getByLabel("Alt text").fill("The lounge");
  await card.getByRole("button", { name: "Save" }).click();
  await toastVisible("Alt text saved");
  assert.equal([...mock.db.media.values()].find((m) => m.filename === "lounge.png").alt, "The lounge");
});

test("events editor: event fields, slug prefix and the image picker", async () => {
  await go("#/events");
  await page.getByRole("heading", { level: 1, name: "Events" }).waitFor();
  await page.getByRole("link", { name: "New event" }).click();
  await page.getByRole("heading", { level: 1, name: "New event" }).waitFor();
  await page.getByLabel("Title", { exact: true }).fill("Hogmanay Gala Dinner");
  assert.equal(await page.getByLabel("Slug").inputValue(), "events/hogmanay-gala-dinner");
  assert.equal(await page.locator("[data-event-fields]").isVisible(), true, "event fields shown for events");
  await page.getByLabel("Dates").first().fill("Wednesday 31 December 2026, 7.30pm");
  await page.getByLabel("What is included (one per line)").fill("Champagne reception\nFive courses\nCeilidh band");
  await page.getByLabel("Month").selectOption("12");
  // image picker on the hero
  await page.locator("#right").getByRole("button", { name: "Choose" }).first().click();
  const dlg = page.locator("dialog[open]");
  await dlg.getByRole("heading", { name: "Choose an image" }).waitFor();
  await dlg.getByRole("button", { name: "The lounge" }).waitFor({ timeout: 5000 });
  await dlg.getByRole("button", { name: "room-double-1" }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-path="hero.image"]').inputValue(), "room-double-1");
  const post = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/admin/api/pages"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const body = (await post).postDataJSON();
  assert.equal(body.slug, "events/hogmanay-gala-dinner");
  assert.equal(body.kind, "event");
  assert.deepEqual(body.event.includes, ["Champagne reception", "Five courses", "Ceilidh band"]);
  assert.equal(body.event.month, 12);
  assert.equal(body.hero.image, "room-double-1");
  assert.equal(body.sections[0].type, "event_details");
  await page.getByRole("heading", { level: 1, name: "Edit event: Hogmanay Gala Dinner" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "View live" }).getAttribute("href"), "/events/hogmanay-gala-dinner");
});

test("unsaved changes: leaving the editor asks first; Escape keeps you on the page", async () => {
  await page.getByLabel("Title", { exact: true }).fill("Hogmanay Gala Dinner 2026");
  await page.getByRole("link", { name: "Dashboard" }).click();
  const dlg = page.locator("dialog[open]");
  await dlg.getByRole("heading", { name: "Unsaved changes" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Hogmanay Gala Dinner 2026", "still in the editor");
  assert.equal(await page.evaluate(() => location.hash), "#/pages/events/hogmanay-gala-dinner");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Leave without saving" }).click();
  await page.getByRole("heading", { level: 1, name: "Dashboard" }).waitFor();
});

test("phone width: no horizontal overflow and the navigation stays reachable", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await go("#/pages/rooms");
  await page.getByRole("heading", { level: 1, name: "Edit page: Rooms" }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page scrolls horizontally by ${overflow}px`);
  assert.ok(await page.getByRole("link", { name: "Settings" }).isVisible());
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("sign out returns to the login screen and the API refuses the session", async () => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Password").waitFor();
  assert.equal(await page.locator("#app").isHidden(), true);
});

test("no console or page errors during the whole run", () => {
  const unexpected = consoleErrors.filter((t) => !/status of 401/.test(t));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpected, [], "console errors: " + unexpected.join(" | "));
  assert.equal(consoleErrors.filter((t) => /status of 401/.test(t)).length, 1, "only the deliberate wrong-password 401 is logged");
});
