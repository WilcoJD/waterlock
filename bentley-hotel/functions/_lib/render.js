/**
 * Renders Bentley Hotel pages to HTML: shared head/header/footer, typed sections, blog posts and
 * listings. Used by the edge functions at request time and by `node src/build.js` for the static export.
 */
import { ICONS, IMAGES, BRAND_MARK } from "./icons.js";
import { getTheme, themeStyle } from "./themes.js";
import { escapeHtml, markdownToHtml } from "./markdown.js";
import { analyticsHead, analyticsBody } from "./analytics.js";

const SIZES = {
  full: "100vw",
  half: "(min-width: 900px) 50vw, 100vw",
  third: "(min-width: 900px) 33vw, (min-width: 600px) 50vw, 100vw",
  quarter: "(min-width: 900px) 25vw, 50vw",
  card: "(min-width: 1000px) 25vw, (min-width: 560px) 50vw, 100vw",
};

export const esc = escapeHtml;
const attr = (v) => escapeHtml(v == null ? "" : String(v));

export function icon(name, cls = "") {
  const d = ICONS[name] || ICONS.info;
  return `<svg${cls ? ` class="${cls}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
}

/** Root-relative URL for an image reference: a built-in photo name, a media key or any path/URL. */
export function imageUrl(image) {
  if (!image) return "";
  const bare = /^([a-z0-9-]+?)-(\d+|lg)\.(jpe?g|webp)$/.exec(image);
  if (bare && IMAGES[bare[1]]) return `/assets/img/${image}`;
  if (IMAGES[image]) {
    const sizes = IMAGES[image];
    const best = sizes.lg ? "lg" : Object.keys(sizes).sort((a, b) => sizes[b][0] - sizes[a][0])[0];
    return `/assets/img/${image}-${best}.jpg`;
  }
  if (/^media\//.test(image)) return "/" + image;
  if (/^https?:\/\//.test(image) || image.startsWith("/")) return image;
  return "/" + image.replace(/^\.?\//, "");
}

export function picture(image, alt, { loading = "lazy", sizes = "half", cls = "" } = {}) {
  if (!image) return "";
  if (IMAGES[image]) {
    const variants = Object.entries(IMAGES[image]).sort((a, b) => a[1][0] - b[1][0]);
    const webp = variants.map(([s, [w]]) => `/assets/img/${image}-${s}.webp ${w}w`).join(", ");
    const jpg = variants.map(([s, [w]]) => `/assets/img/${image}-${s}.jpg ${w}w`).join(", ");
    const [s0, [w0, h0]] = variants[0];
    const fetch = loading === "eager" ? ' fetchpriority="high"' : "";
    return `<picture${cls ? ` class="${cls}"` : ""}><source type="image/webp" srcset="${webp}" sizes="${SIZES[sizes] || SIZES.half}"><img src="/assets/img/${image}-${s0}.jpg" srcset="${jpg}" sizes="${SIZES[sizes] || SIZES.half}" width="${w0}" height="${h0}" alt="${attr(alt)}" loading="${loading}" decoding="async"${fetch}></picture>`;
  }
  return `<img src="${attr(imageUrl(image))}" alt="${attr(alt)}" loading="${loading}" decoding="async"${cls ? ` class="${cls}"` : ""}>`;
}

/** Makes every relative link root-relative and turns page links into clean URLs (/rooms.html -> /rooms). */
export function fixLinks(html) {
  return String(html)
    .replace(/\b(href|src|action|poster)="(?!(?:https?:|mailto:|tel:|data:|\/|#|javascript:))([^"]*)"/g, (_, k, v) => `${k}="/${v.replace(/^\.?\//, "")}"`)
    .replace(/\bsrcset="([^"]*)"/g, (_, v) => `srcset="${v.split(",").map((s) => { const t = s.trim(); return /^(https?:|\/)/.test(t) ? t : "/" + t; }).join(", ")}"`)
    .replace(/\b(href|action)="\/index\.html([?#"])/g, '$1="/$2')
    .replace(/\b(href|action)="\/([a-z0-9][a-z0-9\-/]*)\.html([?#"])/g, '$1="/$2$3');
}

export function hrefFor(href) {
  if (!href) return "#";
  if (/^(https?:|mailto:|tel:|#)/.test(href)) return href;
  return fixLinks(`href="${href}"`).slice(6, -1);
}

export function bookingForm(site, prefix = "book", room = "") {
  const rooms = [["148837309972637", "Single Room"], ["148838930526405", "Twin Room"], ["148839795253447", "Double Room"], ["158032272887993", "Family Room"]];
  const adults = [1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === 2 ? " selected" : ""}>${n}</option>`).join("");
  const kids = [0, 1, 2, 3, 4].map((n) => `<option value="${n}">${n}</option>`).join("");
  const opts = '<option value="">Any room</option>' + rooms.map(([id, name]) => `<option value="${id}"${id === room ? " selected" : ""}>${name}</option>`).join("");
  return `<form class="booking-bar" data-booking-form action="/book" method="get" aria-label="Check availability and book">
          <div class="booking-bar__fields">
            <div class="field booking-bar__date"><label for="${prefix}-in">Arrive</label><input id="${prefix}-in" name="checkin" type="date" required></div>
            <div class="field booking-bar__date"><label for="${prefix}-out">Depart</label><input id="${prefix}-out" name="checkout" type="date" required></div>
            <div class="field booking-bar__num"><label for="${prefix}-adults">Adults</label><select id="${prefix}-adults" name="adults">${adults}</select></div>
            <div class="field booking-bar__num"><label for="${prefix}-kids">Children</label><select id="${prefix}-kids" name="kids">${kids}</select></div>
            <div class="field booking-bar__room"><label for="${prefix}-room">Room</label><select id="${prefix}-room" name="rid">${opts}</select></div>
            <div class="booking-bar__submit"><button class="btn btn--primary" type="submit">${icon("calendar")}Check availability</button></div>
          </div>
          <input type="hidden" name="currency" value="gbp">
        </form>`;
}

/** Expands the editor tokens in HTML authored in the admin. */
export function expandTokens(html, site) {
  return String(html || "")
    .replace(/\{\{icon:([a-z]+)(?:\|([a-z\- ]+))?\}\}/g, (_, n, c) => icon(n, c || ""))
    .replace(/\{\{pic:([a-z0-9\-\/\.]+)\|([^|}]*)(?:\|([a-z]+))?(?:\|([a-z]+))?\}\}/g, (_, img, alt, loading, sizes) => picture(img, alt, { loading: loading || "lazy", sizes: sizes || "half" }))
    .replace(/\{\{bookingform:([a-z0-9]+)(?:\|([0-9]+))?\}\}/g, (_, p, r) => bookingForm(site, p, r || ""))
    .replace(/\{\{BOOK\}\}/g, hrefFor(site.booking_url || "book.html"))
    .replace(/\{\{HOSTED_BOOKING\}\}/g, site.hosted_booking_url || "")
    .replace(/\{\{PHONE\}\}/g, escapeHtml(site.phone || ""))
    .replace(/\{\{PHONE_TEL\}\}/g, escapeHtml(site.phone_tel || ""))
    .replace(/\{\{EMAIL\}\}/g, escapeHtml(site.email || ""));
}

const btnClass = (style) => `btn btn--${["primary", "dark", "outline", "light"].includes(style) ? style : "primary"}`;
export function buttons(list, extraClass = "") {
  if (!Array.isArray(list) || !list.length) return "";
  return `<div class="btn-row${extraClass ? " " + extraClass : ""}">${list.map((b) => {
    const href = hrefFor(b.href);
    const ext = /^https?:/.test(href) ? ' rel="noopener"' : "";
    const ic = b.icon && ICONS[b.icon] ? icon(b.icon) : "";
    return `<a class="${btnClass(b.style)}" href="${attr(href)}"${ext}>${ic}${escapeHtml(b.label || "")}</a>`;
  }).join("")}</div>`;
}

const bg = (s) => ({ cream: " section--cream", sand: " section--sand", green: " section--green" }[s] || "");
const intro = (s, center = false) => (s.eyebrow || s.title || s.intro)
  ? `<div class="section-intro${center ? " center" : ""}">${s.eyebrow ? `<p class="eyebrow">${escapeHtml(s.eyebrow)}</p>` : ""}${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ""}${s.intro ? `<p>${s.intro}</p>` : ""}</div>` : "";
let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

export const SECTION_RENDERERS = {
  html: (s, ctx) => fixLinks(expandTokens(s.html, ctx.site)),
  text: (s, ctx) => {
    const id = nextId("s");
    const body = `<div>${s.eyebrow ? `<p class="eyebrow">${escapeHtml(s.eyebrow)}</p>` : ""}${s.title ? `<h2 id="${id}">${escapeHtml(s.title)}</h2>` : ""}${fixLinks(expandTokens(s.html, ctx.site))}</div>`;
    const aside = s.aside_html ? `<div>${fixLinks(expandTokens(s.aside_html, ctx.site))}</div>` : "";
    const inner = s.layout === "narrow" ? `<div class="container container--narrow">${body}${aside}</div>`
      : aside ? `<div class="container"><div class="split split--wide-text split--top">${body}${aside}</div></div>`
      : `<div class="container">${body}</div>`;
    return `<section class="section${bg(s.background)}"${s.title ? ` aria-labelledby="${id}"` : ""}>${inner}</section>`;
  },
  features: (s, ctx) => {
    const cols = Number(s.columns) === 4 ? 4 : 3;
    const items = (s.items || []).map((it) => `<div class="feature reveal">${it.icon ? `<div class="feature__icon">${icon(it.icon)}</div>` : ""}${it.meta ? `<p class="card__meta">${escapeHtml(it.meta)}</p>` : ""}<h3>${escapeHtml(it.title || "")}</h3><p>${it.text || ""}</p>${it.link_href ? `<p class="mt-2"><a class="text-link" href="${attr(hrefFor(it.link_href))}">${escapeHtml(it.link_label || "Find out more")} ${icon("arrow")}</a></p>` : ""}</div>`).join("");
    return `<section class="section${bg(s.background)}"><div class="container">${intro(s, Boolean(s.center))}<div class="grid grid--${cols}">${items}</div>${buttons(s.buttons, s.center ? "center" : "")}</div></section>`;
  },
  cards: (s, ctx) => {
    const items = (s.items || []).map((it) => {
      const inner = `<div class="card__media">${picture(it.image, it.image_alt || "", { sizes: "card" })}</div><div class="card__body">${it.meta ? `<p class="card__meta">${escapeHtml(it.meta)}</p>` : ""}<h3>${escapeHtml(it.title || "")}</h3><p>${it.text || ""}</p></div>`;
      return it.href ? `<a class="card card--link reveal" href="${attr(hrefFor(it.href))}">${inner}</a>` : `<div class="card reveal">${inner}</div>`;
    }).join("");
    const cols = (s.items || []).length >= 4 ? 4 : 3;
    return `<section class="section${bg(s.background)}"><div class="container">${intro(s, Boolean(s.center))}<div class="grid grid--${cols}">${items}</div>${buttons(s.buttons, s.center ? "center" : "")}</div></section>`;
  },
  booking_strip: (s, ctx) => `<section class="booking-strip" aria-labelledby="${nextId("bs")}"><div class="container"><div class="booking-card"><h2 class="booking-card__title">${escapeHtml(s.title || "Check availability & book direct")}</h2>${bookingForm(ctx.site, nextId("bk"))}${s.note ? `<p class="booking-card__note small">${fixLinks(s.note)}</p>` : `<p class="booking-card__note small">Live prices from our reservations diary. Prefer to browse? <a href="/availability">See the availability calendar</a>.</p>`}</div></div></section>`,
  faq: (s, ctx) => {
    const items = (s.items || []).map((it) => `<details><summary>${escapeHtml(it.q || "")}</summary><div>${/^\s*<p/.test(it.a || "") ? fixLinks(it.a) : `<p>${fixLinks(it.a || "")}</p>`}</div></details>`).join("");
    return `<section class="section${bg(s.background || "sand")}"><div class="container container--narrow">${intro({ ...s, intro: s.intro }, true)}<div class="faq">${items}</div></div></section>`;
  },
  gallery: (s) => {
    const items = (s.items || []).map((it) => `<figure class="gallery-item"><a class="media-frame media-frame--wide gallery-link" href="${attr(imageUrl(it.image))}" data-gallery>${picture(it.image, it.image_alt || "", { sizes: "third" })}</a>${it.caption ? `<figcaption>${escapeHtml(it.caption)}</figcaption>` : ""}</figure>`).join("");
    return `<section class="section${bg(s.background)}"><div class="container">${intro(s)}<div class="grid grid--3 gallery-grid">${items}</div></div></section>`;
  },
  stats: (s) => `<section class="section section--tight${bg(s.background)}"><div class="container"><div class="stats">${(s.items || []).map((it) => `<div class="stat"><span class="stat__value">${escapeHtml(it.value || "")}</span><span class="stat__label">${escapeHtml(it.label || "")}</span></div>`).join("")}</div></div></section>`,
  checklist: (s) => `<section class="section${bg(s.background)}"><div class="container">${intro(s)}<ul class="checklist${Number(s.columns) === 2 ? " checklist--2" : ""}">${(s.items || []).map((it) => `<li>${fixLinks(it)}</li>`).join("")}</ul>${buttons(s.buttons)}</div></section>`,
  timeline: (s) => `<section class="section${bg(s.background)}"><div class="container container--narrow">${intro(s)}<ol class="timeline">${(s.items || []).map((it) => `<li><span class="timeline__when">${escapeHtml(it.when || "")}</span><h3>${escapeHtml(it.title || "")}</h3><p>${it.text || ""}</p></li>`).join("")}</ol></div></section>`,
  quote: (s) => `<section class="section section--sand quote-band"><div class="container"><svg class="ornament" viewBox="0 0 120 16" aria-hidden="true" focusable="false"><path d="M0 8h46M74 8h46" stroke="currentColor" stroke-width="1"/><path d="M60 1l7 7-7 7-7-7z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="60" cy="8" r="1.8" fill="currentColor"/></svg><div class="quote-band__text"><p>${escapeHtml(s.text || "")}</p></div>${s.cite ? `<p class="small muted">${escapeHtml(s.cite)}</p>` : ""}</div></section>`,
  cta: (s) => `<section class="cta-band"><div class="container"><div><h2>${escapeHtml(s.title || "")}</h2><p>${s.text || ""}</p></div>${buttons(s.buttons)}</div></section>`,
  event_details: (s, ctx) => {
    const ev = { ...(ctx.page && ctx.page.event ? ctx.page.event : {}), ...s };
    const includes = (ev.includes || []).map((i) => `<li>${fixLinks(i)}</li>`).join("");
    const price = ev.price_text && ev.price_text.trim() ? escapeHtml(ev.price_text) : "Confirmed each season. Call us or send an enquiry and we&rsquo;ll let you know as soon as it&rsquo;s set.";
    return `<section class="section section--cream" aria-labelledby="${nextId("ev")}"><div class="container"><div class="event-details"><div>${ev.category ? `<span class="event-badge">${escapeHtml(ev.category)}</span>` : ""}<h2 class="mt-1">${escapeHtml(ev.title || "The details")}</h2><dl class="info-list"><div><dt>When</dt><dd>${escapeHtml(ev.dates_text || "Dates confirmed each year")}</dd></div><div><dt>Price</dt><dd>${price}</dd></div><div><dt>Where</dt><dd>${escapeHtml(ev.where || "Bentley Hotel, 19 High Road, Motherwell")}</dd></div><div><dt>Booking</dt><dd>${fixLinks(ev.booking || `Call <a href="tel:${attr(ctx.site.phone_tel)}">${escapeHtml(ctx.site.phone)}</a> or send an enquiry`)}</dd></div></dl>${ev.note ? `<div class="notice mt-2">${icon("info")}<p>${fixLinks(ev.note)}</p></div>` : ""}</div><div>${includes ? `<h3>What we arrange</h3><ul class="checklist">${includes}</ul>` : ""}${buttons(ev.buttons)}</div></div></div></section>`;
  },
  events_list: (s, ctx) => {
    let events = sortEvents((ctx.events || []).filter((e) => e.status === "published"));
    if (s.category) events = events.filter((e) => e.event && e.event.category === s.category);
    const items = events.map((e) => `<a class="card card--link reveal" href="/${attr(e.slug)}"><div class="card__body">${e.event && e.event.category ? `<p class="card__meta">${escapeHtml(e.event.category)}</p>` : ""}<h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.meta && e.meta.description ? e.meta.description : "")}</p>${e.event && e.event.dates_text ? `<p class="small muted">${escapeHtml(e.event.dates_text)}</p>` : ""}</div></a>`).join("");
    return `<section class="section${bg(s.background)}"><div class="container">${intro(s, true)}${items ? `<div class="grid grid--3">${items}</div>` : `<p class="center muted">Events and packages are announced here through the year. Call us on ${escapeHtml(ctx.site.phone)} to ask about dates.</p>`}</div></section>`;
  },
  posts_list: (s, ctx) => {
    const posts = (ctx.posts || []).slice(0, Number(s.count) || 3);
    return `<section class="section${bg(s.background)}"><div class="container">${intro(s, true)}${posts.length ? `<div class="post-list">${posts.map(postCard).join("")}</div>` : `<p class="center muted">News and articles will appear here.</p>`}<div class="btn-row center"><a class="btn btn--outline" href="/blog">All news</a></div></div></section>`;
  },
  contact: (s, ctx) => {
    const site = ctx.site;
    return `<section class="section section--tight" aria-labelledby="${nextId("ct")}"><div class="container"><h2 class="visually-hidden">Contact details</h2><div class="contact-cards"><div class="contact-card"><h3>${icon("phone")}Call</h3><p><a href="tel:${attr(site.phone_tel)}">${escapeHtml(site.phone)}</a></p></div><div class="contact-card"><h3>${icon("mail")}Email</h3><p><a href="mailto:${attr(site.email)}">${escapeHtml(site.email)}</a></p></div><div class="contact-card"><h3>${icon("calendar")}Book a room</h3><p><a href="${attr(hrefFor(site.booking_url))}">Check availability online</a></p></div><div class="contact-card"><h3>${icon("pin")}Visit</h3><p>${escapeHtml(site.address.street)}, ${escapeHtml(site.address.town)} ${escapeHtml(site.address.postcode)}</p></div></div></div></section>`;
  },
};

export function renderSections(sections, ctx) {
  return (sections || []).map((s) => {
    const fn = SECTION_RENDERERS[s && s.type];
    return fn ? fn(s, ctx) : `<!-- unknown section type ${escapeHtml(String(s && s.type))} -->`;
  }).join("\n");
}

export function renderHero(hero, ctx) {
  if (!hero) return "";
  const crumbs = ctx.breadcrumbs && ctx.breadcrumbs.length
    ? `<ol class="breadcrumb">${ctx.breadcrumbs.map((c, i, a) => i === a.length - 1 ? `<li aria-current="page">${escapeHtml(c.label)}</li>` : `<li><a href="${attr(c.href)}">${escapeHtml(c.label)}</a></li>`).join("")}</ol>` : "";
  if (hero.style === "split") {
    const facts = (hero.facts || []).map((f) => `<li>${f.icon ? icon(f.icon) : ""}${escapeHtml(f.text || "")}</li>`).join("");
    return `<section class="hero" aria-labelledby="hero-title"><div class="container"><div>${hero.eyebrow ? `<p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>` : ""}<h1 id="hero-title">${hero.title_html || escapeHtml(hero.title || "")}</h1>${hero.lede ? `<p class="lede">${escapeHtml(hero.lede)}</p>` : ""}${buttons(hero.buttons)}${facts ? `<ul class="hero__facts">${facts}</ul>` : ""}</div>${hero.image ? `<div class="hero__media"><div class="hero__frame">${picture(hero.image, hero.image_alt || "", { loading: "eager", sizes: "half" })}</div>${hero.badge && hero.badge.value ? `<div class="hero__badge"><strong>${escapeHtml(hero.badge.value)}</strong><span>${escapeHtml(hero.badge.label || "")}</span></div>` : ""}</div>` : ""}</div></section>`;
  }
  const bgImg = hero.style === "image" && hero.image ? `<div class="page-hero__bg">${picture(hero.image, hero.image_alt || "", { loading: "eager", sizes: "full" })}</div>` : "";
  return `<section class="page-hero${bgImg ? "" : " page-hero--plain"}${hero.compact ? " page-hero--compact" : ""}" aria-labelledby="page-title">${bgImg}<div class="container">${crumbs}${hero.eyebrow ? `<p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>` : ""}<h1 id="page-title">${escapeHtml(hero.title || "")}</h1>${hero.lede ? `<p class="lede">${escapeHtml(hero.lede)}</p>` : ""}${buttons(hero.buttons)}</div></section>`;
}

function postCard(p) {
  const date = p.published_at ? new Date(p.published_at) : null;
  return `<a class="card card--link reveal" href="/blog/${attr(p.slug)}">${p.cover_image ? `<div class="card__media">${picture(p.cover_image, p.cover_alt || "", { sizes: "third" })}</div>` : ""}<div class="card__body">${date && !isNaN(date) ? `<p class="card__meta">${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>` : ""}<h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.excerpt || "")}</p></div></a>`;
}

/* ---------- document shell ---------- */

function head({ site, theme, title, description, path, ogImage, ogAlt, noindex, jsonld, extraHead }) {
  const url = (site.site_url || "").replace(/\/$/, "") + (path === "/" ? "/" : path);
  const og = ogImage ? imageUrl(ogImage) : imageUrl(site.default_og_image || "exterior");
  const ogAbs = /^https?:/.test(og) ? og : (site.site_url || "").replace(/\/$/, "") + og;
  const ld = jsonld ? `\n  <script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : "";
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${attr(description)}">${noindex ? '\n  <meta name="robots" content="noindex">' : `\n  <link rel="canonical" href="${attr(url)}">`}
  <meta name="theme-color" content="${attr(theme.vars["green-900"])}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${attr(site.name)}, ${attr(site.address.town)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${attr(url)}">
  <meta property="og:image" content="${attr(ogAbs)}">
  <meta property="og:image:alt" content="${attr(ogAlt || site.default_og_alt || "")}">
  <meta property="og:locale" content="en_GB">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${attr(theme.fonts.google)}">
  <script>document.documentElement.classList.add("js")</script>
  <link rel="stylesheet" href="/assets/css/styles.css">
  ${themeStyle(theme)}
  <script src="/assets/js/main.js" defer></script>
  <script src="/assets/js/booking.js" defer></script>${ld}
  ${analyticsHead(site)}${site.head_html || ""}${extraHead || ""}
</head>`;
}

function header({ site, nav, activeSlug, theme }) {
  const items = nav.map((n) => `        <li><a href="/${n.slug === "index" ? "" : attr(n.slug)}"${n.slug === activeSlug ? ' aria-current="page"' : ""}>${escapeHtml(n.label)}</a></li>`).join("\n");
  const book = hrefFor(site.booking_url || "book.html");
  return `<body data-header="${theme.layout.header}" data-hero="${theme.layout.hero}" data-buttons="${theme.layout.buttons}" data-sections="${theme.layout.sections}" data-dark="${theme.dark ? "true" : "false"}">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="topbar"><div class="container">
      <div class="topbar__group">
        <span class="topbar__item">${icon("pin")}<span>${escapeHtml(site.address.street)}, ${escapeHtml(site.address.town)} ${escapeHtml(site.address.postcode)}</span></span>
        <span class="topbar__item topbar__hide-sm">${icon("clock")}<span>Check-in from ${escapeHtml(site.checkin)} &middot; Check-out by ${escapeHtml(site.checkout)}</span></span>
      </div>
      <div class="topbar__group">
        <a class="topbar__item" href="tel:${attr(site.phone_tel)}">${icon("phone")}<span>${escapeHtml(site.phone)}</span></a>
        <a class="topbar__item topbar__hide-sm" href="mailto:${attr(site.email)}">${icon("mail")}<span>${escapeHtml(site.email)}</span></a>
      </div>
  </div></div>
  <header class="site-header"><div class="container">
      <a class="brand" href="/" aria-label="${attr(site.name)}, ${attr(site.address.town)} — home">${BRAND_MARK}<span class="brand__text"><span class="brand__name">${escapeHtml(site.name)}</span><span class="brand__sub">${escapeHtml(site.address.town)} &middot; Est. 1874</span></span></a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">${icon("menu", "icon-open")}${icon("x", "icon-close")}<span>Menu</span></button>
      <nav class="site-nav" id="site-nav" aria-label="Main"><ul>
${items}
        <li><a class="btn btn--primary" href="${attr(book)}">Book direct</a></li>
      </ul></nav>
  </div></header>
  <main id="main">
`;
}

function footer({ site, footerNav, more }) {
  const explore = footerNav.map((n) => `<li><a href="/${attr(n.slug)}">${escapeHtml(n.label)}</a></li>`).join("");
  const moreItems = (more || []).map((m) => `<li><a href="${attr(m.href)}">${escapeHtml(m.label)}</a></li>`).join("");
  const social = (site.social || []).filter((s) => s.url).map((s) => `<li><a href="${attr(s.url)}" rel="noopener">${escapeHtml(s.label || s.url)}</a></li>`).join("");
  return `  </main>
  <footer class="site-footer"><div class="container">
      <div class="footer-grid">
        <div><a class="brand" href="/" aria-label="${attr(site.name)} — home">${BRAND_MARK}<span class="brand__text"><span class="brand__name">${escapeHtml(site.name)}</span><span class="brand__sub">${escapeHtml(site.address.town)} &middot; Est. 1874</span></span></a><p>${escapeHtml(site.footer_blurb || "")}</p>${social ? `<ul>${social}</ul>` : ""}</div>
        <div><h2>Find us</h2><address>${escapeHtml(site.name)}<br>${escapeHtml(site.address.street)}<br>${escapeHtml(site.address.town)}<br>${escapeHtml(site.address.region)} ${escapeHtml(site.address.postcode)}</address><p class="mt-0"><a href="/location">Directions &amp; parking</a></p></div>
        <div><h2>Get in touch</h2><ul><li><a href="tel:${attr(site.phone_tel)}">${escapeHtml(site.phone)}</a></li><li><a href="mailto:${attr(site.email)}">${escapeHtml(site.email)}</a></li><li><a href="${attr(hrefFor(site.booking_url))}">Book a room online</a></li>${moreItems}<li><a href="/contact">Send an enquiry</a></li></ul></div>
        <div><h2>Explore</h2><ul>${explore}</ul></div>
      </div>
      <div class="footer-bottom"><span>&copy; <span data-year>${new Date().getFullYear()}</span> ${escapeHtml(site.name)}, ${escapeHtml(site.address.town)}.</span><span><a href="/accessibility">Accessibility</a> &middot; <a href="/privacy">Privacy &amp; cookies</a> &middot; <a href="/faq">FAQ</a><span data-cookie-settings-wrap hidden> &middot; <button type="button" class="link-button" data-cookie-settings>Cookie settings</button></span></span></div>
  </div></footer>
  <nav class="mobile-book" aria-label="Quick actions"><a href="tel:${attr(site.phone_tel)}">${icon("phone")}Call</a><a href="${attr(hrefFor(site.booking_url))}">${icon("calendar")}Book now</a></nav>
  ${analyticsBody(site)}${site.analytics_html || ""}
</body>
</html>
`;
}

/** Events in calendar order: January first; "all year" (month 0) events last. */
export function sortEvents(events) {
  const m = (e) => { const n = Number(e.event && e.event.month); return n >= 1 && n <= 12 ? n : 13; };
  return [...events].sort((a, b) => m(a) - m(b) || a.title.localeCompare(b.title));
}

function moreLinks(ctx) {
  const inFooter = new Set((ctx.footerNav || footerNavFromPages(ctx.pages || [])).map((n) => n.slug));
  const more = [];
  if (ctx.hasEvents) more.push({ href: "/events", label: "Events & packages" });
  if (ctx.hasBlog) more.push({ href: "/blog", label: "News" });
  if (!inFooter.has("availability")) more.push({ href: "/availability", label: "Availability calendar" });
  if (!inFooter.has("faq")) more.push({ href: "/faq", label: "Questions & answers" });
  return more;
}

export function navFromPages(pages) {
  return pages.filter((p) => p.in_nav && p.status === "published").sort((a, b) => a.nav_order - b.nav_order || a.title.localeCompare(b.title))
    .map((p) => ({ slug: p.slug, label: p.nav_label || p.title }));
}
export function footerNavFromPages(pages) {
  return pages.filter((p) => p.in_footer && p.status === "published" && p.slug !== "index").sort((a, b) => a.nav_order - b.nav_order || a.title.localeCompare(b.title))
    .map((p) => ({ slug: p.slug, label: p.nav_label || p.title }));
}

/**
 * ctx: { site, theme (id or object), pages (all, for nav), events, posts, hasBlog, hasEvents }
 */
export function renderPage(page, ctx) {
  const site = ctx.site;
  const theme = typeof ctx.theme === "object" && ctx.theme ? ctx.theme : getTheme(ctx.theme || site.theme);
  const nav = ctx.nav || navFromPages(ctx.pages || []);
  const footerNav = ctx.footerNav || footerNavFromPages(ctx.pages || []);
  const more = moreLinks({ ...ctx, footerNav });
  const meta = page.meta || {};
  const path = page.slug === "index" || page.slug === site.homepage_slug ? "/" : "/" + page.slug;
  const breadcrumbs = page.kind === "event" ? [{ href: "/", label: "Home" }, { href: "/events", label: "Events & packages" }, { label: page.title }]
    : [{ href: "/", label: "Home" }, { label: page.title }];
  const sctx = { site, page, breadcrumbs, events: ctx.events || [], posts: ctx.posts || [] };
  const body = renderHero(page.hero, sctx) + "\n" + renderSections(page.sections, sctx);
  const title = meta.title || `${page.title} | ${site.name}, ${site.address.town}`;
  return head({ site, theme, title, description: meta.description || site.tagline || "", path, ogImage: meta.og_image, ogAlt: meta.og_alt, noindex: meta.noindex, jsonld: meta.jsonld, extraHead: ctx.extraHead })
    + "\n" + header({ site, nav, activeSlug: page.kind === "event" ? "events" : page.slug, theme }) + body + "\n" + footer({ site, footerNav, more });
}

export function renderPost(post, ctx) {
  const site = ctx.site;
  const theme = typeof ctx.theme === "object" && ctx.theme ? ctx.theme : getTheme(ctx.theme || site.theme);
  const date = post.published_at ? new Date(post.published_at) : null;
  const dateText = date && !isNaN(date) ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
  const tags = (Array.isArray(post.tags) ? post.tags : []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const body = `<section class="page-hero page-hero--plain page-hero--compact" aria-labelledby="page-title"><div class="container"><ol class="breadcrumb"><li><a href="/">Home</a></li><li><a href="/blog">News</a></li><li aria-current="page">${escapeHtml(post.title)}</li></ol><p class="eyebrow">News</p><h1 id="page-title">${escapeHtml(post.title)}</h1>${post.excerpt ? `<p class="lede">${escapeHtml(post.excerpt)}</p>` : ""}${dateText ? `<p class="post-meta">${dateText}</p>` : ""}</div></section>
<section class="section"><div class="container container--narrow">${post.cover_image ? `<figure><div class="media-frame media-frame--wide">${picture(post.cover_image, post.cover_alt || "", { loading: "eager", sizes: "half" })}</div></figure>` : ""}<div class="post-body">${fixLinks(markdownToHtml(post.body_md))}</div>${tags ? `<ul class="tag-list" aria-label="Tags">${tags}</ul>` : ""}<p class="mt-3"><a class="text-link" href="/blog">All news ${icon("arrow")}</a></p></div></section>
<section class="cta-band"><div class="container"><div><h2>Stay with us</h2><p>Eighteen en-suite rooms in a house built in 1874, five minutes from Motherwell station.</p></div><div class="btn-row"><a class="btn btn--primary" href="${attr(hrefFor(site.booking_url))}">${icon("calendar")}Check availability</a><a class="btn btn--light" href="tel:${attr(site.phone_tel)}">${icon("phone")}Call us</a></div></div></section>`;
  const meta = post.meta || {};
  const jsonld = { "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, datePublished: post.published_at || undefined, dateModified: post.updated_at || undefined, author: { "@type": "Organization", name: site.name }, publisher: { "@type": "Organization", name: site.name }, description: post.excerpt || undefined, image: post.cover_image ? (site.site_url || "").replace(/\/$/, "") + imageUrl(post.cover_image) : undefined };
  return head({ site, theme, title: meta.title || `${post.title} | ${site.name}`, description: meta.description || post.excerpt || "", path: `/blog/${post.slug}`, ogImage: post.cover_image || meta.og_image, ogAlt: post.cover_alt, noindex: meta.noindex, jsonld })
    + "\n" + header({ site, nav: ctx.nav || navFromPages(ctx.pages || []), activeSlug: "blog", theme }) + body + "\n" + footer({ site, footerNav: ctx.footerNav || footerNavFromPages(ctx.pages || []), more: moreLinks(ctx) });
}

export function renderListing({ kind, items, title, lede, eyebrow, path, description }, ctx) {
  const site = ctx.site;
  const theme = typeof ctx.theme === "object" && ctx.theme ? ctx.theme : getTheme(ctx.theme || site.theme);
  const cards = kind === "posts" ? items.map(postCard).join("")
    : items.map((e) => `<a class="card card--link reveal" href="/${attr(e.slug)}"><div class="card__body">${e.event && e.event.category ? `<p class="card__meta">${escapeHtml(e.event.category)}</p>` : ""}<h3>${escapeHtml(e.title)}</h3><p>${escapeHtml(e.meta && e.meta.description ? e.meta.description : "")}</p>${e.event && e.event.dates_text ? `<p class="small muted">${escapeHtml(e.event.dates_text)}</p>` : ""}</div></a>`).join("");
  const body = `<section class="page-hero page-hero--plain page-hero--compact" aria-labelledby="page-title"><div class="container"><ol class="breadcrumb"><li><a href="/">Home</a></li><li aria-current="page">${escapeHtml(title)}</li></ol><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1 id="page-title">${escapeHtml(title)}</h1><p class="lede">${escapeHtml(lede)}</p></div></section>
<section class="section" aria-labelledby="list-title"><div class="container"><h2 id="list-title" class="visually-hidden">${kind === "posts" ? "Latest posts" : "All events and packages"}</h2>${cards ? `<div class="${kind === "posts" ? "post-list" : "grid grid--3"}">${cards}</div>` : `<p class="center muted">Nothing here yet. Call us on ${escapeHtml(site.phone)} and we&rsquo;ll help.</p>`}</div></section>
<section class="cta-band"><div class="container"><div><h2>Talk to us</h2><p>For dates, numbers and anything you can&rsquo;t see here, give us a call.</p></div><div class="btn-row"><a class="btn btn--primary" href="tel:${attr(site.phone_tel)}">${icon("phone")}${escapeHtml(site.phone)}</a><a class="btn btn--light" href="/contact">Send an enquiry</a></div></div></section>`;
  return head({ site, theme, title: `${title} | ${site.name}, ${site.address.town}`, description, path })
    + "\n" + header({ site, nav: ctx.nav || navFromPages(ctx.pages || []), activeSlug: kind === "posts" ? "blog" : "events", theme }) + body + "\n" + footer({ site, footerNav: ctx.footerNav || footerNavFromPages(ctx.pages || []), more: moreLinks(ctx) });
}

/** RSS 2.0 feed for the blog. */
export function renderFeed(posts, site) {
  const base = (site.site_url || "").replace(/\/$/, "");
  const items = posts.map((p) => `<item><title>${escapeHtml(p.title)}</title><link>${base}/blog/${escapeHtml(p.slug)}</link><guid>${base}/blog/${escapeHtml(p.slug)}</guid>${p.published_at ? `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>` : ""}<description>${escapeHtml(p.excerpt || "")}</description></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeHtml(site.name)} news</title><link>${base}/blog</link><description>${escapeHtml(site.tagline || "")}</description>${items}</channel></rss>`;
}

export function renderSitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}
