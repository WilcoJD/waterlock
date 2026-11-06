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

## Editing content outside the admin

The seed content in `content/seed` is the site's starting point and its fallback. Each page is a JSON file with a `hero` and a list of `sections`; `docs/architecture.md` lists every section type and field. The fifteen original pages were migrated with their HTML kept as `html` sections, so they can be edited either as HTML or rebuilt from typed sections in the admin.

## Online booking and the Cloudbeds diary

Every booking is made in Cloudbeds, so it lands straight in the hotel's Cloudbeds calendar like any other online booking, and the availability and prices guests see are always live. There is nothing to sync by hand.

| Piece | How it works | Needs |
| --- | --- | --- |
| **Booking search bars** (home, rooms, availability) | Arrival, departure, adults, children and room, sent to `/book` using Cloudbeds' own parameter names (`checkin`, `checkout`, `adults`, `kids`, `rid`, `currency`). Works without JavaScript. | Nothing |
| **Book a room** (`book.html`) | Cloudbeds' official **Immersive Experience 2.0** web component (`<cb-immersive-experience>`) shows the full booking engine, payment included, inside the hotel's own page. It picks up the dates, guests and room from the search. | The hotel's domain whitelisted in Cloudbeds (see below) |
| **Availability calendar** (`availability.html`) | A night-by-night grid for the four public room types showing rooms left, the lowest nightly price, "no arrivals" days and minimum stays. Guests click an arrival date, then a departure date, then **Book these dates**. Data comes from `/api/availability`, a small Cloudflare Pages Function that calls the Cloudbeds API with a secret key. | A Cloudbeds API key stored as a secret in Cloudflare |
| **Fallbacks** | Off the hotel's own domain (staging, previews), or if the embed fails to load within 15 seconds, booking links go to the hosted Cloudbeds page with the same search. If the API isn't set up, the calendar page shows Cloudbeds' own live date picker instead (on the hotel's domain) or the booking search bar. | Nothing |

Room types sold on the site (Cloudbeds room type IDs): Single `148837309972637`, Twin `148838930526405`, Double `148839795253447`, Family `158032272887993`. The corporate "Ensol" room types are deliberately left off. The IDs and the domain list are at the top of `public/assets/js/booking.js`, `functions/api/availability.js` and `functions/_lib/render.js` (booking form).

### Cloudbeds settings (hotel owner)

1. **Whitelist the website's domains.** In Cloudbeds go to *Settings → Booking Engine → Embeds → Premium → Whitelisted domains* and add `https://www.thebentleyhotel.co.uk` and `https://thebentleyhotel.co.uk` (up to 5 domains are allowed). Cloudbeds' servers already accept both hostnames, which suggests this is done, but please confirm. Premium Embeds must be part of your Cloudbeds package. The booking component only works on whitelisted HTTPS domains, so on any other address the site uses the hosted fallback.
2. **Point the domain at the new site.** Both `thebentleyhotel.co.uk` and `www.thebentleyhotel.co.uk` currently send visitors (through Cloudflare) straight to the Cloudbeds booking page. Remove that redirect rule when the website goes live.
3. **Optional: API key for the availability calendar.** In Cloudbeds go to *Account → Apps & Marketplace → API Credentials* and create a property API key. If API access isn't listed, Cloudbeds may ask you to submit their API Access form. Give the key only the **read:rate** scope, which is all the calendar uses. The key starts `cbat_`, is shown once, and stops working if it goes unused for 30 days. Every calendar visit uses it, but a quiet month could let it lapse, so an uptime monitor that opens `https://www.thebentleyhotel.co.uk/api/availability` once a day keeps it alive. Never put the key in the website's files.

### Deploying on Cloudflare Pages

The domain is already on Cloudflare, so Cloudflare Pages is the simplest home: it serves `public/` and runs `functions/` on the same domain.

See **Deployment** above for the Pages set-up; the availability function needs only the `CLOUDBEDS_API_KEY` secret. Check `https://www.thebentleyhotel.co.uk/api/availability` after deploying: it should return JSON with four rooms. `{"error":"not_configured"}` means the secret is missing, and `upstream_error` means Cloudbeds rejected the key or its scope.

### Testing

`npm test` includes the availability function's unit tests (against a fixture built from Cloudbeds' published API schema). To try the function locally with the real key, put `CLOUDBEDS_API_KEY=cbat_…` in `bentley-hotel/.dev.vars` (git-ignored) and run `npx wrangler pages dev public`. These checks could not be done from the build environment, so please check them once the site is live on the hotel's domain:

- **Book a room page:** the booking engine loads.
- **Searches carry over:** a search from the home page arrives with its dates and room selected.
- **Availability calendar:** it shows the same rooms and prices as Cloudbeds.

## Editing

- **Text:** either edit the HTML files in `public/` directly, or edit the page sources in `src/pages/` and regenerate with `cd src && python3 build.py pages ../public`. The generator adds the shared top bar, header, footer and `<head>` to every page, so a change to the phone number, email or navigation is made once in `src/build.py`. If you edit `public/` directly, remember the header and footer are repeated in every file.
- **Colours and fonts:** these are set as variables at the top of `public/assets/css/styles.css` (`--green-900`, `--brass-600`, and so on).
- **Photos:** put new images in `public/assets/img/` and point the `<picture>` tags at them. The `srcset` width values (such as `800w`) must match each file's real pixel width. The site currently has no photos of the restaurant, conservatory interior, bar or function room. Adding them will help most on the Dining, Weddings and Functions pages (the home page's restaurant section was made text-only so the one exterior photo isn't shown twice). The only exterior photo is 700px wide. A larger one (at least 1400px wide, ideally with a 1200×630 crop for social-media link previews) would sharpen the home-page hero and shared links.
- **Enquiry form:** the form on `contact.html` opens the visitor's email app with their message ready to send to the address in `data-mailto`. To collect enquiries without email apps, swap it for a form service (for example Netlify Forms, Formspree or Basin).
- **Domain:** canonical links, Open Graph tags and `sitemap.xml` assume the site will live at `https://www.thebentleyhotel.co.uk/`. Change them if it goes elsewhere. That domain currently redirects to the Cloudbeds booking page, so point it at the new site when it goes live.
- **Hosting in a subfolder:** every page uses relative links except `404.html`, which uses root-relative links (`/assets/...`, `/rooms.html`) because hosts serve it at whatever missing URL was requested. If the site is served from a subfolder (for example `username.github.io/bentley-hotel/`), add that folder to the paths in `404.html`.

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

### Housekeeping outside the website

- `thebentleyhotel.net`, the old official site that Bridebook and Yelp still link to, now redirects to a domain-for-sale page. Consider buying it back, or ask those sites to update their links.
- Several OTAs list out-of-date details: 15 rooms, check-in from 14:30 or 15:00, check-out at 10:00, and implausible room sizes on Expedia (for example "850 sq ft" doubles). It's worth correcting these in each extranet.
