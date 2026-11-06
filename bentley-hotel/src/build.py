#!/usr/bin/env python3
"""Assemble the Bentley Hotel static site: shared head/header/footer + per-page bodies.

Usage: python3 -I build.py <pages_dir> <out_dir> [--only name]
Each page body file starts with a JSON front-matter block between '<!--META' and 'META-->'.
Tokens expanded in page bodies: {{icon:name}}, {{pic:image|alt|loading|sizes}},
{{bookingform:prefix|roomId}}, {{BOOK}}, {{HOSTED_BOOKING}}, {{PHONE}}, {{PHONE_TEL}}, {{EMAIL}}.
"""
import json
import re
import sys
from html import escape as html_escape
from pathlib import Path

SITE = "https://www.thebentleyhotel.co.uk"
BOOK = "book.html"
HOSTED_BOOKING = "https://us2.cloudbeds.com/en/reservation/7ELXfI"
PHONE = "01698 265588"
PHONE_TEL = "+441698265588"
EMAIL = "liam@thebentleyhotel.co.uk"

ICONS = {
    "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    "pin": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    "bed": '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "user": '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "wifi": '<path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M12 20h.01"/>',
    "car": '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
    "coffee": '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/>',
    "utensils": '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    "wine": '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
    "heart": '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    "train": '<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h0"/><path d="M16 15h0"/>',
    "plane": '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    "road": '<path d="M4 22 8 2"/><path d="m20 22-4-20"/><path d="M12 6v2"/><path d="M12 12v2"/><path d="M12 18v2"/>',
    "arrow": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    "menu": '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "tv": '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
    "shower": '<path d="m4 4 2.5 2.5"/><path d="M13.5 6.5a4.95 4.95 0 0 0-7 7"/><path d="M15 5 5 15"/><path d="M14 17v.01"/><path d="M10 16v.01"/><path d="M13 13v.01"/><path d="M16 10v.01"/><path d="M11 20v.01"/><path d="M17 14v.01"/><path d="M20 11v.01"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "star": '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    "castle": '<path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-3-3a3 3 0 0 0-3 3v4"/><path d="M22 11V9"/><path d="M2 11V9"/><path d="M6 4V2"/><path d="M18 4V2"/><path d="M10 4V2"/><path d="M14 4V2"/>',
    "glass": '<path d="M8 22h8"/><path d="M12 11v11"/><path d="m19 3-7 8-7-8Z"/>',
    "briefcase": '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    "tree": '<path d="M17 14h.01"/><path d="M12 22v-7"/><path d="M9 15h6"/><path d="M12 2 5 12h4l-2 3h10l-2-3h4Z"/>',
    "ticket": '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
    "football": '<circle cx="12" cy="12" r="10"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Z"/><path d="M12 2v5"/><path d="m16 10 5-1.5"/><path d="m14.5 14.5 3 4"/><path d="m9.5 14.5-3 4"/><path d="M8 10 3 8.5"/>',
    "accessible": '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>',
    "kettle": '<path d="M6 8h12l-1 12H7Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/><path d="M18 11h1a2 2 0 0 1 0 4h-1.4"/>',
    "nosmoke": '<path d="M2 2l20 20"/><path d="M12 12H2v4h14"/><path d="M22 12v4"/><path d="M18 12h-.5"/><path d="M7 12v4"/><path d="M18 8c0-2.5-2-2.5-2-5"/><path d="M22 8c0-2.5-2-2.5-2-5"/>',
    "check": '<path d="M20 6 9 17l-5-5"/>',
}


def icon(name, cls=""):
    c = f' class="{cls}"' if cls else ""
    return (f'<svg{c} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>')


BRAND_MARK = (
    '<svg class="brand__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
    '<path d="M6 46V20C6 10 14 3 24 3s18 7 18 17v26Z" fill="#17302a"/>'
    '<path d="M9.5 43V20.5C9.5 12.4 16 6.5 24 6.5s14.5 5.9 14.5 14V43Z" fill="none" stroke="#b8925a" stroke-width="1.2"/>'
    '<text x="24" y="35" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="25" font-weight="600" fill="#f1dcb4">B</text>'
    '</svg>'
)

NAV = [
    ("index.html", "Home", "Home"),
    ("rooms.html", "Rooms", "Rooms"),
    ("dining.html", "Dining", "Restaurant &amp; Bar"),
    ("weddings.html", "Weddings", "Weddings"),
    ("functions.html", "Functions", "Functions &amp; Meetings"),
    ("gallery.html", "Gallery", "Gallery"),
    ("history.html", "History", "Our History"),
    ("location.html", "Location", "Location &amp; Directions"),
    ("contact.html", "Contact", "Contact"),
]
FOOTER_MORE = [
    ("availability.html", "Availability calendar"),
    ("faq.html", "Questions &amp; answers"),
    ("accessibility.html", "Accessibility"),
    ("privacy.html", "Privacy &amp; cookies"),
]


def head(meta):
    title = html_escape(meta["title"], quote=True)
    desc = html_escape(meta["description"], quote=True)
    path = meta["path"]
    url = SITE + "/" + ("" if path == "index.html" else path)
    og_file = meta.get("og_image", "exterior-700.jpg")
    og_img = SITE + "/assets/img/" + og_file
    og_name, og_suffix = og_file.rsplit(".", 1)[0].rsplit("-", 1)
    og_w, og_h = IMAGES[og_name][og_suffix]
    og_alt = meta.get("og_alt", "The Bentley Hotel, a sandstone Victorian villa with a tall tower and a conservatory, in Motherwell")
    jsonld = meta.get("jsonld")
    jsonld_html = ""
    if jsonld:
        jsonld_html = '\n  <script type="application/ld+json">\n' + json.dumps(jsonld, indent=2, ensure_ascii=False) + "\n  </script>"
    robots = '\n  <meta name="robots" content="noindex">' if meta.get("noindex") else ""
    canonical = "" if meta.get("noindex") else f'\n  <link rel="canonical" href="{url}">'
    return f"""<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{desc}">{robots}{canonical}
  <meta name="theme-color" content="#17302a">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="The Bentley Hotel, Motherwell">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{og_img}">
  <meta property="og:image:width" content="{og_w}">
  <meta property="og:image:height" content="{og_h}">
  <meta property="og:image:alt" content="{og_alt}">
  <meta property="og:locale" content="en_GB">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="favicon.ico" sizes="32x32">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&amp;family=Source+Sans+3:wght@400;600&amp;display=swap">
  <script>document.documentElement.classList.add("js")</script>
  <link rel="stylesheet" href="assets/css/styles.css">
  <script src="assets/js/main.js" defer></script>
  <script src="assets/js/booking.js" defer></script>{jsonld_html}
</head>"""


def header(active):
    items = []
    for href, label, _long in NAV:
        cur = ' aria-current="page"' if href == active else ""
        items.append(f'        <li><a href="{href}"{cur}>{label}</a></li>')
    items.append(f'        <li><a class="btn btn--primary" href="{BOOK}">Book direct</a></li>')
    nav_items = "\n".join(items)
    return f"""<body>
  <a class="skip-link" href="#main">Skip to content</a>

  <div class="topbar">
    <div class="container">
      <div class="topbar__group">
        <span class="topbar__item">{icon("pin")}<span>19 High Road, Motherwell ML1 3HU</span></span>
        <span class="topbar__item topbar__hide-sm">{icon("clock")}<span>Check-in from 2pm &middot; Check-out by 11am</span></span>
      </div>
      <div class="topbar__group">
        <a class="topbar__item" href="tel:{PHONE_TEL}">{icon("phone")}<span>{PHONE}</span></a>
        <a class="topbar__item topbar__hide-sm" href="mailto:{EMAIL}">{icon("mail")}<span>{EMAIL}</span></a>
      </div>
    </div>
  </div>

  <header class="site-header">
    <div class="container">
      <a class="brand" href="index.html" aria-label="The Bentley Hotel, Motherwell — home">
        {BRAND_MARK}
        <span class="brand__text"><span class="brand__name">The Bentley</span><span class="brand__sub">Hotel &middot; Motherwell</span></span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
        {icon("menu", "icon-open")}{icon("x", "icon-close")}<span>Menu</span>
      </button>
      <nav class="site-nav" id="site-nav" aria-label="Main">
        <ul>
{nav_items}
        </ul>
      </nav>
    </div>
  </header>
"""


def footer():
    links = "\n".join(f'            <li><a href="{h}">{l}</a></li>' for h, _s, l in NAV[1:])
    return f"""
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="brand" href="index.html" aria-label="The Bentley Hotel, Motherwell — home">
            {BRAND_MARK}
            <span class="brand__text"><span class="brand__name">The Bentley</span><span class="brand__sub">Hotel &middot; Motherwell</span></span>
          </a>
          <p>An 18-bedroom hotel with a restaurant and function suite, in a Victorian villa built in 1874 as Motherwell House.</p>
        </div>
        <div>
          <h2>Find us</h2>
          <address>
            The Bentley Hotel<br>
            19 High Road<br>
            Motherwell<br>
            North Lanarkshire ML1 3HU
          </address>
          <p class="mt-0"><a href="location.html">Directions &amp; parking</a></p>
        </div>
        <div>
          <h2>Get in touch</h2>
          <ul>
            <li><a href="tel:{PHONE_TEL}">{PHONE}</a></li>
            <li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
            <li><a href="{BOOK}">Book a room online</a></li>
            <li><a href="availability.html">Availability calendar</a></li>
            <li><a href="faq.html">Questions &amp; answers</a></li>
            <li><a href="contact.html">Send an enquiry</a></li>
          </ul>
        </div>
        <div>
          <h2>Explore</h2>
          <ul>
{links}
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; <span data-year>2026</span> The Bentley Hotel, Motherwell.</span>
        <span><a href="accessibility.html">Accessibility</a> &middot; <a href="privacy.html">Privacy &amp; cookies</a> &middot; <a href="faq.html">FAQ</a></span>
      </div>
    </div>
  </footer>

  <nav class="mobile-book" aria-label="Quick actions">
    <a href="tel:{PHONE_TEL}">{icon("phone")}Call</a>
    <a href="{BOOK}">{icon("calendar")}Book now</a>
  </nav>
</body>
</html>
"""


# Real pixel widths of the image variants in assets/img (name -> {suffix: (width, height)})
IMAGES = {
    "exterior": {"700": (700, 490)},
    "room-single-1": {"800": (800, 450), "lg": (1138, 640)},
    "room-single-2": {"800": (800, 533), "lg": (960, 640)},
    "room-twin-1": {"800": (800, 636), "lg": (1258, 1000)},
    "room-twin-2": {"800": (800, 533), "lg": (1400, 933)},
    "room-double-1": {"800": (800, 515), "lg": (1400, 901)},
    "room-double-2": {"800": (800, 533), "lg": (1400, 933)},
    "room-double-3": {"800": (800, 596), "lg": (1343, 1000)},
    "room-family-1": {"800": (800, 600), "lg": (1334, 1000)},
}
SIZES = {
    "full": "100vw",
    "half": "(min-width: 900px) 50vw, 100vw",
    "third": "(min-width: 900px) 33vw, (min-width: 600px) 50vw, 100vw",
    "quarter": "(min-width: 900px) 25vw, 50vw",
    "card": "(min-width: 1000px) 25vw, (min-width: 560px) 50vw, 100vw",
}


def pic(name, alt, loading="lazy", sizes="half"):
    variants = IMAGES[name]
    order = sorted(variants.items(), key=lambda kv: kv[1][0])
    webp = ", ".join(f"assets/img/{name}-{s}.webp {w}w" for s, (w, h) in order)
    jpg = ", ".join(f"assets/img/{name}-{s}.jpg {w}w" for s, (w, h) in order)
    s0, (w0, h0) = order[0]
    fetch = ' fetchpriority="high"' if loading == "eager" else ""
    return (f'<picture><source type="image/webp" srcset="{webp}" sizes="{SIZES[sizes]}">'
            f'<img src="assets/img/{name}-{s0}.jpg" srcset="{jpg}" sizes="{SIZES[sizes]}" '
            f'width="{w0}" height="{h0}" alt="{alt}" loading="{loading}" decoding="async"{fetch}></picture>')


ROOM_OPTIONS = [
    ("148837309972637", "Single Room"),
    ("148838930526405", "Twin Room"),
    ("148839795253447", "Double Room"),
    ("158032272887993", "Family Room"),
]


def booking_form(prefix, room=""):
    """Booking search bar. Works without JS (GET to book.html with Cloudbeds' parameter names)."""
    adults = "".join(f'<option value="{n}"{" selected" if n == 2 else ""}>{n}</option>' for n in range(1, 7))
    kids = "".join(f'<option value="{n}">{n}</option>' for n in range(0, 5))
    rooms = '<option value="">Any room</option>' + "".join(
        f'<option value="{rid}"{" selected" if rid == room else ""}>{name}</option>' for rid, name in ROOM_OPTIONS)
    return f"""<form class="booking-bar" data-booking-form action="book.html" method="get" aria-label="Check availability and book">
          <div class="booking-bar__fields">
            <div class="field booking-bar__date"><label for="{prefix}-in">Arrive</label><input id="{prefix}-in" name="checkin" type="date" required></div>
            <div class="field booking-bar__date"><label for="{prefix}-out">Depart</label><input id="{prefix}-out" name="checkout" type="date" required></div>
            <div class="field booking-bar__num"><label for="{prefix}-adults">Adults</label><select id="{prefix}-adults" name="adults">{adults}</select></div>
            <div class="field booking-bar__num"><label for="{prefix}-kids">Children</label><select id="{prefix}-kids" name="kids">{kids}</select></div>
            <div class="field booking-bar__room"><label for="{prefix}-room">Room</label><select id="{prefix}-room" name="rid">{rooms}</select></div>
            <div class="booking-bar__submit"><button class="btn btn--primary" type="submit">{icon("calendar")}Check availability</button></div>
          </div>
          <input type="hidden" name="currency" value="gbp">
        </form>"""


def render_body(body):
    """Expand {{icon:name}}, {{pic:name|alt|loading|sizes}}, {{bookingform:prefix|room}} and {{BOOK}} style tokens in page bodies."""
    body = re.sub(r"\{\{bookingform:([a-z0-9]+)(?:\|([0-9]+))?\}\}", lambda m: booking_form(m.group(1), m.group(2) or ""), body)
    body = re.sub(r"\{\{icon:([a-z]+)(?:\|([a-z\- ]+))?\}\}", lambda m: icon(m.group(1), m.group(2) or ""), body)
    body = re.sub(r"\{\{pic:([a-z0-9\-]+)\|([^|}]*)(?:\|([a-z]+))?(?:\|([a-z]+))?\}\}",
                  lambda m: pic(m.group(1), m.group(2), m.group(3) or "lazy", m.group(4) or "half"), body)
    return (body.replace("{{BOOK}}", BOOK).replace("{{PHONE}}", PHONE)
                .replace("{{PHONE_TEL}}", PHONE_TEL).replace("{{EMAIL}}", EMAIL)
                .replace("{{HOSTED_BOOKING}}", HOSTED_BOOKING))


def write_sitemap(pages_dir, out_dir):
    """sitemap.xml lists every indexable page (not 404 or noindex pages)."""
    urls = []
    for f in sorted(pages_dir.glob("*.html")):
        m = re.match(r"\s*<!--META\s*(.*?)\s*META-->", f.read_text(encoding="utf-8"), re.S)
        meta = json.loads(m.group(1)) if m else {}
        if f.name == "404.html" or meta.get("noindex"):
            continue
        urls.append(SITE + "/" + ("" if f.name == "index.html" else f.name))
    urls.sort(key=lambda u: (u != SITE + "/", u))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += [f"  <url><loc>{u}</loc></url>" for u in urls]
    xml.append("</urlset>")
    (out_dir / "sitemap.xml").write_text("\n".join(xml) + "\n", encoding="utf-8")
    print("built sitemap.xml", len(urls), "urls")


def build(pages_dir, out_dir, only=None):
    pages_dir, out_dir = Path(pages_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not only:
        write_sitemap(pages_dir, out_dir)
    for f in sorted(pages_dir.glob("*.html")):
        if only and f.stem != only:
            continue
        raw = f.read_text(encoding="utf-8")
        m = re.match(r"\s*<!--META\s*(.*?)\s*META-->\s*", raw, re.S)
        if not m:
            raise SystemExit(f"{f.name}: missing META block")
        meta = json.loads(m.group(1))
        meta.setdefault("path", f.name)
        body = render_body(raw[m.end():])
        if "{{" in body:
            raise SystemExit(f"{f.name}: unexpanded token near {body[body.index('{{'):body.index('{{')+40]!r}")
        html = head(meta) + "\n" + header(meta["path"]) + '\n  <main id="main">\n' + body.rstrip() + "\n  </main>\n" + footer()
        if meta.get("root_relative"):
            # 404 pages are served at arbitrary paths, so make every local URL root-relative
            html = re.sub(r'(href|src)="(?!https?:|mailto:|tel:|#|/)([^"]*)"', lambda m: f'{m.group(1)}="/{m.group(2)}"', html)
            html = re.sub(r'srcset="([^"]*)"', lambda m: 'srcset="' + ", ".join(("/" + s.strip()) if not s.strip().startswith(("/", "http")) else s.strip() for s in m.group(1).split(",")) + '"', html)
            html = html.replace('href="/index.html"', 'href="/"')
        (out_dir / f.name).write_text(html, encoding="utf-8")
        print("built", f.name, len(html))


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if "--only" in args:
        i = args.index("--only")
        only = args[i + 1]
        del args[i:i + 2]
    build(args[0], args[1], only)
