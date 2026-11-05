# The Bentley Hotel, Motherwell: website

A website for **The Bentley Hotel, 19 High Road, Motherwell ML1 3HU**: plain HTML, CSS and a little JavaScript, with online booking connected live to the hotel's **Cloudbeds** reservations system.

```
bentley-hotel/
├── public/                  ← the website (upload this folder to any static host)
│   ├── *.html               pages
│   ├── assets/css, js, img  styles, scripts (main.js, booking.js), photos
│   └── _headers             security and caching headers (Cloudflare Pages)
├── functions/api/           ← /api/availability: live availability from the Cloudbeds API (Cloudflare Pages Function)
├── tests/                   ← unit tests for the function:  npm test
├── wrangler.toml            ← Cloudflare Pages settings
└── README.md
```

## Pages

| File | Page |
| --- | --- |
| `index.html` | Home, with a booking search bar |
| `rooms.html` | Rooms: Single, Twin, Double and Family (each with a booking link), booking search, check-in info, FAQ |
| `book.html` | **Book a room**: the live Cloudbeds booking engine on the hotel's own site |
| `availability.html` | **Availability calendar** ("the diary"): rooms free per night, with prices |
| `dining.html` | Restaurant, conservatory and bar |
| `weddings.html` | Weddings: capacities, package, venue, FAQ |
| `functions.html` | Functions, meetings and conferences (Back o' Barns room) |
| `history.html` | Motherwell House (1874), the Cameronians, timeline, conservation area |
| `location.html` | Map, directions by train, car and air, things to do nearby |
| `contact.html` | Contact details and an enquiry form |
| `404.html` | "Page not found" page |

Also in `public/`: `assets/css/styles.css` (all styling), `assets/js/main.js` (mobile menu, scroll reveal, enquiry form), `assets/js/booking.js` (booking search, booking page, availability calendar), `assets/img/` (photos in WebP and JPEG at two sizes), `favicon.svg` / `favicon.ico` / `apple-touch-icon.png`, `robots.txt` and `sitemap.xml`.

## Online booking and the Cloudbeds diary

Every booking is made in Cloudbeds, so it lands straight in the hotel's Cloudbeds calendar like any other online booking, and the availability and prices guests see are always live. There is nothing to sync by hand.

| Piece | How it works | Needs |
| --- | --- | --- |
| **Booking search bars** (home, rooms, availability) | Arrival, departure, adults, children and room, sent to `book.html` using Cloudbeds' own parameter names (`checkin`, `checkout`, `adults`, `kids`, `rid`, `currency`). Works without JavaScript. | Nothing |
| **Book a room** (`book.html`) | Cloudbeds' official **Immersive Experience 2.0** web component (`<cb-immersive-experience>`) shows the full booking engine, payment included, inside the hotel's own page. It picks up the dates, guests and room from the search. | The hotel's domain whitelisted in Cloudbeds (see below) |
| **Availability calendar** (`availability.html`) | A night-by-night grid for the four public room types showing rooms left, the lowest nightly price, "no arrivals" days and minimum stays. Guests click an arrival date, then a departure date, then **Book these dates**. Data comes from `/api/availability`, a small Cloudflare Pages Function that calls the Cloudbeds API with a secret key. | A Cloudbeds API key stored as a secret in Cloudflare |
| **Fallbacks** | Off the hotel's own domain (staging, previews), or if the embed fails to load within 15 seconds, booking links go to the hosted Cloudbeds page with the same search. If the API isn't set up, the calendar page shows Cloudbeds' own live date picker instead (on the hotel's domain) or the booking search bar. | Nothing |

Room types sold on the site (Cloudbeds room type IDs): Single `148837309972637`, Twin `148838930526405`, Double `148839795253447`, Family `158032272887993`. The corporate "Ensol" room types are deliberately left off. The IDs and the domain list are at the top of `public/assets/js/booking.js` and `functions/api/availability.js`.

### Cloudbeds settings (hotel owner)

1. **Whitelist the website's domains.** In Cloudbeds go to *Settings → Booking Engine → Embeds → Premium → Whitelisted domains* and add `https://www.thebentleyhotel.co.uk` and `https://thebentleyhotel.co.uk` (up to 5 domains are allowed). Cloudbeds' servers already accept both hostnames, which suggests this is done, but please confirm. Premium Embeds must be part of your Cloudbeds package. The booking component only works on whitelisted HTTPS domains, so on any other address the site uses the hosted fallback.
2. **Point the domain at the new site.** Both `thebentleyhotel.co.uk` and `www.thebentleyhotel.co.uk` currently send visitors (through Cloudflare) straight to the Cloudbeds booking page. Remove that redirect rule when the website goes live.
3. **Optional: API key for the availability calendar.** In Cloudbeds go to *Account → Apps & Marketplace → API Credentials* and create a property API key. If API access isn't listed, Cloudbeds may ask you to submit their API Access form. Give the key only the **read:rate** scope, which is all the calendar uses. The key starts `cbat_`, is shown once, and stops working if it goes unused for 30 days. Every calendar visit uses it, but a quiet month could let it lapse, so an uptime monitor that opens `https://www.thebentleyhotel.co.uk/api/availability` once a day keeps it alive. Never put the key in the website's files.

### Deploying on Cloudflare Pages

The domain is already on Cloudflare, so Cloudflare Pages is the simplest home: it serves `public/` and runs `functions/` on the same domain.

1. In Cloudflare, go to *Workers & Pages → Create → Pages → Connect to Git*, choose this repository and branch, set **Root directory** to `bentley-hotel` and **Build output directory** to `public`, and leave the build command empty.
2. Under *Settings → Variables and Secrets*, add the secret `CLOUDBEDS_API_KEY` (the `cbat_…` key). `CLOUDBEDS_PROPERTY_ID` (`141393122377981`, the property ID the booking engine uses) is already set in `wrangler.toml`.
3. Add the custom domains `www.thebentleyhotel.co.uk` and `thebentleyhotel.co.uk` to the Pages project, after removing the current redirect.
4. Check `https://www.thebentleyhotel.co.uk/api/availability`. It should return JSON with four rooms. `{"error":"not_configured"}` means the secret is missing, and `upstream_error` means Cloudbeds rejected the key or its scope.

Without Cloudflare, `public/` works on any static host. Booking and the booking search work there too (once the domain is whitelisted in Cloudbeds), and the availability page falls back to Cloudbeds' date picker.

### Testing

`npm test` (Node 18 or later) runs the unit tests for the availability function against a test fixture built from Cloudbeds' published API schema. To try the function locally with the real key, put `CLOUDBEDS_API_KEY=cbat_…` in `bentley-hotel/.dev.vars` (git-ignored) and run `npx wrangler pages dev public`. These checks could not be done from the build environment, so please check them once the site is live on the hotel's domain:

- **Book a room page:** the booking engine loads.
- **Searches carry over:** a search from the home page arrives with its dates and room selected.
- **Availability calendar:** it shows the same rooms and prices as Cloudbeds.

## Editing

- **Text:** edit the HTML files in `public/` directly. The header, top bar and footer are repeated at the top and bottom of every page, so if you change the phone number, email or navigation, change it in all eleven files (search and replace works well).
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

### Housekeeping outside the website

- `thebentleyhotel.net`, the old official site that Bridebook and Yelp still link to, now redirects to a domain-for-sale page. Consider buying it back, or ask those sites to update their links.
- Several OTAs list out-of-date details: 15 rooms, check-in from 14:30 or 15:00, check-out at 10:00, and implausible room sizes on Expedia (for example "850 sq ft" doubles). It's worth correcting these in each extranet.
