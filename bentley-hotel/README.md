# Bentley Hotel, Motherwell: website

The website for **Bentley Hotel, 19 High Road, Motherwell ML1 3HU**, with an admin area for editing it. It runs on Cloudflare Pages: pages, blog posts, events, landing pages, uploads, backlinks, redirects and SEO settings live in a database and are edited at `/admin`; the public pages are rendered on Cloudflare's edge. A static copy of the site in `public/` is always kept up to date as a fallback, so the site works even before the database is set up. Online booking runs on the hotel's Cloudbeds system.

```
bentley-hotel/
├── public/            the static export and assets (css, js, img): a complete site on its own
├── functions/         Cloudflare Pages Functions
│   ├── [[path]].js        public pages, blog, events, sitemap, redirects, media
│   ├── admin/             the admin app (ui.js) and its API ([[path]].js)
│   ├── api/availability.js  live availability from Cloudbeds
│   └── _lib/              renderer, themes, database, auth, markdown, schema.sql, seed-data.js
├── content/seed/      the built-in content as JSON (pages, landing pages, events, settings…)
├── src/               build.js (static export), dev.js (local server), check.py (validator), hash-password.js
├── tests/             node --test suites (backend, availability function, admin UI)
├── docs/architecture.md   data model, section types, API, deployment detail
└── wrangler.toml      Cloudflare Pages settings and bindings
```

## What the admin area does

Log in at `/admin`. Everything is edited there and appears on the site within seconds:

| Section | What you can do |
| --- | --- |
| **Pages** | Edit any page: title, SEO fields, hero and a list of sections (text, features, cards, FAQ, gallery, stats, checklist, timeline, quote, call-to-action, raw HTML…). Live preview before saving. Draft or published. |
| **Landing pages** | Ten alternative homepages for campaigns and search (hotel in Motherwell, wedding venue, match days, Glasgow concerts, families, contractors, conferences, Strathclyde Park, short breaks, group bookings). Any of them can be set as the homepage in Settings; all are linkable on their own. |
| **Events** | Twenty event and package pages (Burns Night, Christmas Day lunch, party nights, Hogmanay, New Year's Day, festive stays, Valentine's, Mother's and Father's Day, Easter, St Andrew's Day, Halloween, wedding open day, afternoon tea, match days, christenings, birthdays, funeral receptions, corporate day delegate, engagement parties) with editable dates, prices and inclusions, listed at `/events`. |
| **Blog** | News posts written in Markdown with a live preview, cover image, tags and SEO fields; listed at `/blog` with an RSS feed. |
| **Media** | Upload photos and PDFs (menus, price lists) and use them anywhere. |
| **Backlinks** | Keep a list of sites that link to you and check, with one click, that each link is still live. |
| **Redirects** | Send old addresses (for example from the previous website) to the right page. |
| **SEO** | An audit of every page (missing or long titles and descriptions, duplicates, missing social image, broken internal links) plus site-wide settings, analytics code and verification tags. The sitemap and robots.txt are generated automatically. |
| **Themes** | A dropdown of ten themes (colours, typefaces and layout: header style, hero style, button shape, flat or banded sections) applied site-wide. |
| **Settings** | Contact details, booking links, check-in/out text, homepage choice, footer text, social links. Export and import the whole site as JSON. |

## Deployment (Cloudflare Pages)

1. **Pages project:** *Workers & Pages → Create → Pages → Connect to Git*, choose this repository and branch, set **Root directory** to `bentley-hotel`, **Build output directory** to `public`, and leave the build command empty.
2. **Database:** `npx wrangler d1 create bentley-hotel`, paste the id into `wrangler.toml` (uncomment the `[[d1_databases]]` block), then `npx wrangler d1 execute bentley-hotel --remote --file functions/_lib/schema.sql`.
3. **Uploads:** `npx wrangler r2 bucket create bentley-hotel-media` and uncomment the `[[r2_buckets]]` block.
4. **Secrets** (*Settings → Variables and Secrets*): `ADMIN_PASSWORD` (or better `ADMIN_PASSWORD_HASH` from `npm run hash-password`), `SESSION_SECRET` (any long random string) and `CLOUDBEDS_API_KEY`.
5. Deploy, open `https://www.thebentleyhotel.co.uk/admin`, log in and click **Load built-in content**. The database fills with every page in `content/seed`.
6. Add the custom domains `www.thebentleyhotel.co.uk` and `thebentleyhotel.co.uk` to the project, after removing the Cloudflare redirect that currently sends them to the Cloudbeds page.

For extra protection, put Cloudflare Access (Zero Trust) in front of `/admin*` so a login with your email is needed before the password screen.

Without the database and bucket, the site serves the static export in `public/` and `/admin` explains what is missing. Without Cloudflare at all, `public/` works on any static host (except the admin, blog editing and uploads).

## Working on the site locally

- `npm run dev` starts the real functions at http://127.0.0.1:8788 with a SQLite file standing in for the database and a folder for uploads; the admin password is printed (set `ADMIN_PASSWORD` to choose it). The built-in content is loaded on first run.
- `npm run build` regenerates `functions/_lib/seed-data.js` and the static export in `public/` from `content/seed`. Run it after editing the seed JSON.
- `npm test` runs the backend tests (router, admin API, auth, markdown, uploads), the availability function tests and the admin UI tests.
- `npm run check` validates the built site (tags, links, anchors, images, headings, metadata, structured data).

## Editing the look

- **Colours, fonts and layout** come from the theme chosen in the admin. The ten themes are defined in `functions/_lib/themes.js`; add or adjust one there (colours as CSS variables, Google Fonts pairing, layout flags) and it appears in the dropdown.
- **Everything else visual** is in `public/assets/css/styles.css`; `public/assets/js/main.js` and `booking.js` handle the menu, gallery viewer, booking forms and the availability calendar.
- **Photos:** the nine built-in photos live in `public/assets/img/` (WebP and JPEG at two sizes). Upload new ones in the admin's Media section; they can be used in any section. Photos of the restaurant, conservatory, bar and function suite would help most.
- **Domain:** `settings.site.site_url` (Settings in the admin) is used for canonical links, the sitemap and social sharing tags.

## Where the content came from

The Wayback Machine (web.archive.org) could not be reached from the environment this site was built in. Its network policy blocks that host. The copy was therefore rebuilt from:

- **The hotel's own Cloudbeds booking page:** the official description, room types and occupancy, check-in and check-out times, amenities, phone, email, address, and all the photos used here.
- **Copies of the hotel's old official website text** on listing sites (Bridebook, Cvent, Venues4Hire and others): the wedding welcome text and package, the restaurant and conservatory description, and the Back o' Barns function room.
- **OTA listings** (Booking.com, Expedia and Hotels.com, Trip.com, KAYAK and others): policies, distances and recurring themes in guest reviews. No individual reviews are quoted.
- **Public sources** for history and local context: North Lanarkshire Council's Hamilton Road Conservation Area appraisal, Historic Environment Scotland, the Food Standards Agency ratings API, and Wikipedia.

Where sources disagreed, the site follows the hotel's own booking engine, and leaves the detail out when nothing official settles it.

## Owner checklist: please confirm before going live

These items were deliberately left vague or out because the sources conflicted or were out of date:

1. **Room count and family room.** The site says 18 en-suite bedrooms (the current official text). Older listings say 15 or 16, and many OTAs still say 15. The family room is shown as sleeping up to 3 (one may be a child), with a double and a single bed, which matches the Cloudbeds occupancy and photo.
2. **Breakfast.** Is it included in the rate, and what are the serving times? The site says only that a cooked-to-order full Scottish breakfast is served and that the booking shows whether it's included.
3. **Restaurant and bar.** Current opening hours, whether non-residents are welcome, and whether the bar is open (a May 2026 review mentioned reconstruction). The site asks people to call. Add hours and menus when you can.
4. **Reception hours and late arrivals.** OTAs disagree (09:00–23:00 or 24 hours). The site asks late arrivals to let the hotel know.
5. **Function room.** The site treats the air-conditioned "Function Suite" and the Back o' Barns room as the same space. Please confirm. The capacities shown (theatre 120, dinner 100, reception 120) come from official text and directory listings. Room size, AV equipment and day-delegate rates would strengthen the page.
6. **Wedding package.** The package list comes from old official copy (about 2017), reworded "for the happy couple". Check that it's current, and whether the hotel is registered for civil ceremonies. Old prices (Bridebook's "from £70") were left out.
7. **Honeymoon / Executive Suite (four-poster).** This appears in old copy and on some OTAs but isn't sold on Cloudbeds, so it's not on the site.
8. **Accessibility.** The site says many bedrooms are reached by stairs and asks guests with access needs to call. Please replace this with an accurate accessibility statement (lift, step-free access, ground-floor rooms).
9. **Cots, extra beds and children's policy.** OTAs disagree. The site asks families to call.
10. **History.** "Motherwell House, 1874, built for Colonel Black of the Cameronians" comes from the hotel's own copy, and no independent record was found. Deeds, old photos or documents would let the History page say more. The building is in the Hamilton Road Conservation Area but is **not** a listed building, so the site doesn't call it listed.
11. **"Back o' Barns".** The name is a historic Hamilton place name. If there's a story behind it, it would make a good line on the Functions page.
12. **Email.** The site uses `liam@thebentleyhotel.co.uk`, as published on the booking engine. Switch to a general address (for example `info@` or `enquiries@`) if you prefer.
13. **Social media.** Facebook appears as both `facebook.com/TheBentley1874` and `facebook.com/thebentleyhotel1874`. Confirm which is official, and add links (plus any Instagram) to the footer.
14. **Refurbishment.** OTAs showed a temporary closure in early 2025, and 2026 reviews mention work under way. If the refurbishment is finished, it's worth saying so.
15. **Booking settings in Cloudbeds.** Confirm the whitelisted domains and Premium Embeds (see "Cloudbeds settings" above), and whether prices shown in the availability calendar include VAT. The calendar says the exact total, including any taxes or extras, is shown before payment.

### Added in the content round: please confirm

The expanded pages (Dining, Weddings, Functions, Rooms, Location, History) and the new Gallery, FAQ, Accessibility and Privacy pages were written only from verified facts, and a second pass removed anything unsupported. A few things are stated carefully and would benefit from a straight answer from you:

16. **Bar status.** The pages describe the bar as open and tell visitors to call ahead. A May 2026 review mentioned reconstruction. If the bar is closed, say so and the Dining page can be changed in minutes.
17. **Non-residents and lunch.** The site says visitors who aren't staying can book a table, and that the restaurant suits a lunch between meetings, without stating hours. Confirm which services (breakfast, lunch, dinner, Sunday) are open to non-residents and on which days, and the hours can go in.
18. **Breakfast add-on.** The site says guests can ask to add breakfast if their rate doesn't include it. Confirm that, the serving times, and whether breakfast is included as standard.
19. **Private dining.** The Dining page offers a reserved long table in the restaurant, the conservatory for small parties and the function suite for larger ones. Confirm the conservatory can be reserved privately.
20. **Ceremonies.** Weddings pages say "ask us about ceremonies" and never claim a civil-ceremony licence. If the venue is approved for ceremonies, it can be stated plainly.
21. **Late licence for functions.** Only the wedding package's 1am licence is verified; the Functions page says "ask us about a late licence". Confirm what applies to other events.
22. **Parking spaces, coaches and minibuses.** Numbers are unknown, so the site says "free on-site parking" and asks minibus drivers to call first.
23. **Lift and ground-floor rooms.** Rooms, FAQ and Accessibility pages answer this question without saying whether there is a lift. The Accessibility page lists the questions guests ask (lift, step-free entrance, accessible toilet, hearing loop, bath or walk-in shower) and promises an answer by phone. A short written answer to each would let the page say it outright.
24. **Photo rights.** The nine photographs come from the hotel's Cloudbeds booking page; confirm they are the hotel's own and current. Photos of the restaurant, conservatory, bar and function suite would help the Gallery, Weddings and Functions pages most.
25. **Privacy notice positions.** It states that the hotel keeps no marketing list without asking, makes no automated decisions, shares details only with those who need them (Cloudbeds, authorities where the law requires), that Cloudbeds takes online payment on the hotel's behalf, and that the site is hosted on Cloudflare. Confirm each, and update the "last updated" dates on the Privacy and Accessibility pages whenever they change.
26. **Viewings.** Gallery, Weddings and Functions pages offer to show people round the function suite and conservatory by arrangement.

### Landing pages, events and the admin: please confirm

The ten landing pages and twenty event pages were written from the same verified facts and checked by a second pass. They describe occasions as things the hotel arranges and leave prices, menus and dates to the editable event fields ("confirmed each season"). Before publishing them from the admin, please confirm:

27. **Which events you actually run.** Burns Night, Christmas Day lunch, party nights, Hogmanay, New Year's Day lunch, festive stays, Valentine's, Mother's and Father's Day, Easter, St Andrew's Day, Halloween, afternoon tea and a wedding open day are all written so they work even if a date isn't set yet. Unpublish any you don't offer (each page has a Draft/Published switch).
28. **Prices, dates and menus** for each event go in the event fields in the admin; until then the pages say they are confirmed each season.
29. **Offers phrased as "we can arrange":** late licences for non-wedding parties, DJs and bands, bringing your own cake, children's portions, boardroom/classroom/U-shape layouts, breakfast in the match-day package. Delete any you don't want to offer.
30. **"Rooms are upstairs"** appears on several event pages (the Burns Night page's wording was reused). If some bedrooms are on the ground floor, change it; it also bears on the lift question (item 23).
31. **Deposits and cancellation:** the pages say "we'll explain when you book" rather than stating a policy. Tell us the policy and it can be published.
32. **Admin login:** set a strong `ADMIN_PASSWORD` (12+ characters) or, better, an `ADMIN_PASSWORD_HASH`, and a long random `SESSION_SECRET`, and consider Cloudflare Access in front of `/admin`. Log out on shared computers; sessions last 12 hours.

### Housekeeping outside the website

- `thebentleyhotel.net`, the old official site that Bridebook and Yelp still link to, now redirects to a domain-for-sale page. Consider buying it back, or ask those sites to update their links.
- Several OTAs list out-of-date details: 15 rooms, check-in from 14:30 or 15:00, check-out at 10:00, and implausible room sizes on Expedia (for example "850 sq ft" doubles). It's worth correcting these in each extranet.
