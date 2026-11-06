# Bentley Hotel website: architecture

The site runs on **Cloudflare Pages**. Content lives in a **D1** database (SQLite), uploaded images in an **R2** bucket, and pages are rendered on Cloudflare's edge by Pages Functions. If the database is not configured, the catch-all function falls back to the static files in `public/`, which are exported from the seed content, so the site always works.

```
bentley-hotel/
├── public/                 static export + assets (css, js, img). Always a working site on its own.
├── functions/
│   ├── [[path]].js         public router: pages, blog, events, sitemap, robots, redirects, media, static fallback
│   ├── admin/[[path]].js   admin UI (HTML) and JSON API under /admin and /admin/api/*
│   ├── api/availability.js live availability from Cloudbeds (unchanged)
│   └── _lib/               shared code: schema.sql, db.js, render.js, themes.js, markdown.js, auth.js, seed.js
├── content/seed/           the built-in content: settings.json, pages/*.json, posts/*.json, backlinks.json, redirects.json
├── src/
│   ├── build.js            node src/build.js  → bundles the seed into functions/_lib/seed-data.js and exports static HTML into public/
│   ├── hash-password.js    makes an ADMIN_PASSWORD_HASH value
│   ├── dev.js              node src/dev.js    → local server (functions + a SQLite stand-in for D1 + a folder for R2)
│   └── check.py            validates the built site
└── wrangler.toml           Pages project settings and bindings (D1 "DB", R2 "MEDIA")
```

## Data model (D1)

See `functions/_lib/schema.sql`. JSON columns are stored as text.

- **settings** (key, value): `site` holds the name, contact details, booking URLs, theme id, homepage slug, analytics/head HTML, social links; `version` is bumped on every admin write and is part of the edge cache key.
- **pages** (slug, kind, status, title, nav_label, in_nav, nav_order, in_footer, meta, hero, sections, event, created_at, updated_at). `kind` is `page`, `landing` (homepage variants / campaign pages), `event` (Burns Night, Christmas …) or `system` (404). Slugs may contain `/` (for example `events/burns-night`) and are served at `/<slug>` (and `/<slug>.html`).
- **posts** (slug, status, title, excerpt, body_md, cover_image, cover_alt, tags, published_at, updated_at, meta): the blog, written in Markdown.
- **media** (key, filename, content_type, size, alt, width, height, created_at): uploaded files, served at `/media/<key>` from R2.
- **backlinks** (id, source_url, target_url, anchor_text, status, http_status, last_checked, notes, created_at): links from other sites to ours; "Check" fetches the source page and confirms the link is still there.
- **redirects** (from_path, to_url, code): old URLs (for example from the previous website) sent to the right page.

## Page JSON

```json
{
  "slug": "rooms", "kind": "page", "status": "published",
  "title": "Rooms", "nav_label": "Rooms", "in_nav": 1, "nav_order": 20, "in_footer": 1,
  "meta": { "title": "Rooms | Bentley Hotel, Motherwell", "description": "…", "canonical": "", "og_image": "assets/img/room-double-1-lg.jpg", "og_alt": "…", "noindex": false, "jsonld": null },
  "hero": { "style": "plain|split|image", "eyebrow": "Stay with us", "title": "Rooms at Bentley Hotel", "lede": "…", "image": "room-double-1", "image_alt": "…", "buttons": [{ "label": "Check availability", "href": "book.html", "style": "primary" }], "badge": { "value": "1874", "label": "…" } },
  "sections": [ { "type": "…", "…": "…" } ],
  "event": { "dates_text": "", "price_text": "", "includes": [], "note": "", "category": "festive", "month": 1 }
}
```

### Section types (`sections[].type`)

| type | fields |
| --- | --- |
| `html` | `html` (a complete `<section>…</section>`; used for the migrated pages; tokens already expanded) |
| `text` | `eyebrow, title, html, aside_html, layout` (`split`, `narrow`, `wide`), `background` (`paper`, `cream`, `sand`, `green`) |
| `features` | `eyebrow, title, intro, columns` (3 or 4), `items[]` {`icon, title, text, link_label, link_href`}, `background` |
| `cards` | `eyebrow, title, intro, items[]` {`image, image_alt, meta, title, text, href`}, `background` |
| `booking_strip` | `title, note` |
| `faq` | `eyebrow, title, intro, items[]` {`q, a`} (a is HTML) |
| `gallery` | `eyebrow, title, intro, items[]` {`image, image_alt, caption`} |
| `stats` | `items[]` {`value, label`} |
| `checklist` | `eyebrow, title, intro, items[]` (strings), `columns` (1 or 2), `background` |
| `timeline` | `eyebrow, title, intro, items[]` {`when, title, text`} |
| `event_details` | `title, dates_text, price_text, includes[], note, buttons[]` (falls back to the page's `event` field) |
| `events_list` | `eyebrow, title, intro, category` (optional filter) — lists published event pages |
| `posts_list` | `eyebrow, title, intro, count` — latest blog posts |
| `quote` | `text, cite` |
| `cta` | `title, text, buttons[]` |
| `contact` | renders the contact cards + enquiry form |

Images: `image` is either one of the built-in photo names (`exterior`, `room-single-1` … `room-family-1`, rendered as responsive `<picture>`), a media key (`media/<key>`), or any URL/path.

Buttons: `{ "label", "href", "style": "primary|dark|outline|light" }`. `href` may be `book.html`, a slug, a `#anchor`, `tel:`/`mailto:` or a full URL.

## Rendering

`functions/_lib/render.js` exports `renderPage({ site, theme, page, nav, extra })`, `renderPost`, `renderList` and the shared head/header/footer. Themes (`functions/_lib/themes.js`) supply CSS custom properties, a font pairing and layout flags (`header`, `hero`, `buttons`, `sections`), applied as `<style>` in the head and `data-*` attributes on `<body>`.

Draft pages can be viewed at `/<slug>?preview=draft` while logged in to the admin (the session cookie is scoped to `/admin`, so the admin's preview opens drafts through `/admin/api/preview` instead).

Edge cache: public responses are cached for 5 minutes under a key that includes `settings.version`, so an admin save appears within seconds.

## Admin

`/admin` is a single-page application (plain HTML/JS, no framework) served by `functions/admin/[[path]].js`. It talks to `/admin/api/*` with JSON. Login uses the `ADMIN_PASSWORD` secret (or `ADMIN_PASSWORD_HASH`, a PBKDF2 hash made with `node src/hash-password.js`) and a signed, HttpOnly, SameSite=Strict session cookie (secret `SESSION_SECRET`). Mutating requests must carry `X-Requested-With: fetch` from the same origin. For extra protection put Cloudflare Access in front of `/admin`.

API (all JSON; 401 if not logged in):

| Method and path | Purpose |
| --- | --- |
| `POST /admin/api/login` `{password}` / `POST /admin/api/logout` / `GET /admin/api/me` | session |
| `GET,PUT /admin/api/settings` | site settings (name, contacts, theme, homepage, analytics…) |
| `GET /admin/api/themes` | the ten themes with their colours for the picker |
| `GET /admin/api/pages?kind=` `POST /admin/api/pages` `GET,PUT,DELETE /admin/api/pages/<slug>` `POST /admin/api/pages/<slug>/duplicate` | pages, landing pages, events |
| `POST /admin/api/preview` `{page}` | renders a page JSON to HTML (for the live preview) |
| `GET,POST /admin/api/posts` `GET,PUT,DELETE /admin/api/posts/<slug>` `POST /admin/api/markdown` `{md}` | blog |
| `GET /admin/api/media` `POST /admin/api/media` (multipart) `PUT,DELETE /admin/api/media/<key>` | uploads (R2) |
| `GET,POST /admin/api/backlinks` `PUT,DELETE /admin/api/backlinks/<id>` `POST /admin/api/backlinks/<id>/check` `POST /admin/api/backlinks/check-all` | backlinks |
| `GET,PUT /admin/api/redirects` | redirects (whole list) |
| `GET /admin/api/seo` | audit: missing or long titles/descriptions, duplicate titles, pages without OG image, noindex pages, broken internal links |
| `GET /admin/api/export` `POST /admin/api/import` `POST /admin/api/seed` | backup/restore; load the built-in content |

## Local development

`node src/dev.js` runs the real functions with a SQLite file (`.dev/bentley.sqlite`) standing in for D1 and `.dev/media/` for R2, at http://127.0.0.1:8788. `npm test` runs the unit and integration tests. `node src/build.js` regenerates `public/` from `content/seed`.

## Deployment

1. `npx wrangler d1 create bentley-hotel` and put the database id into `wrangler.toml`; `npx wrangler d1 execute bentley-hotel --remote --file functions/_lib/schema.sql`.
2. `npx wrangler r2 bucket create bentley-hotel-media`.
3. Pages secrets: `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`), `SESSION_SECRET` (long random string), `CLOUDBEDS_API_KEY`.
4. Deploy (Git integration: root `bentley-hotel`, output `public`, no build command). Open `/admin`, log in and click **Load built-in content** to fill the database with the seed.
