#!/usr/bin/env python3
"""Build the v2 catalog (markdown pages, CSVs, single PDF) from enriched data.

Usage: build2.py OUT_DIR [--no-pdf]
Inputs (all under this script's directory):
  repo_info.json, discovered.json, batches/*.tsv, enriched/*.tsv, out/stores_*.tsv, out/resell_*.tsv
  plus ../../business-ideas/_source/raw/*.tsv (curated rows)
"""
import csv, json, os, re, sys, collections, datetime, subprocess, html, time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = "/home/user/waterlock/business-ideas/_source/raw"
OUT = sys.argv[1]
NO_PDF = "--no-pdf" in sys.argv
SECTORS = [
    ("hosting", "Hosting, Infrastructure & DevOps"),
    ("business", "Business Software & Vertical SaaS"),
    ("web", "Websites, Content, Commerce & Community"),
    ("media_ai", "Media, AI, Data & Automation"),
    ("games", "Games, Game Tech & Entertainment"),
    ("mobile", "Mobile, Consumer Apps & Vertical Platforms"),
    ("hardware", "Open Hardware, Physical Products & Designs"),
    ("industries", "Traditional Industries & Local Businesses"),
    ("finance", "Fintech, Payments, Crypto & Trading"),
    ("science", "Science, Engineering, GIS & CAD"),
    ("security", "Security, Privacy & Compliance"),
    ("education", "Education & Training"),
    ("devtools", "Developer Platforms, SDKs & Templates"),
]
TITLE = dict(SECTORS)
PERMISSIVE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense", "0BSD", "CC0-1.0",
              "BSL-1.0", "MIT-0", "Artistic-2.0", "PostgreSQL", "WTFPL", "NCSA", "CC-BY-4.0"}
WEAK = {"MPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-2.0", "EPL-1.0", "EUPL-1.2", "CDDL-1.0", "OSL-3.0", "CC-BY-SA-4.0"}
STRONG = {"GPL-2.0", "GPL-3.0"}
PLATFORMS = {
    "woocommerce": ("WooCommerce", "woocommerce/woocommerce", "Cheapest start, huge plugin ecosystem, subscriptions & digital"),
    "prestashop": ("PrestaShop", "PrestaShop/PrestaShop", "Strong in EU/LatAm, multi-language, lots of themes"),
    "opencart": ("OpenCart", "opencart/opencart", "Lightweight, runs on cheap shared hosting"),
    "mageos": ("Mage-OS (Magento fork)", "mage-os/mageos-magento2", "Large catalogs, complex B2C/B2B"),
    "shopware": ("Shopware", "shopware/shopware", "Polished DTC + B2B, popular in DACH"),
    "sylius": ("Sylius", "Sylius/Sylius", "Developer-friendly Symfony, custom B2B flows"),
    "saleor": ("Saleor", "saleor/saleor", "Headless GraphQL, multi-channel, modern DTC"),
    "medusa": ("Medusa", "medusajs/medusa", "Headless JS commerce, fast custom storefronts"),
    "vendure": ("Vendure", "vendure-ecommerce/vendure", "Headless TypeScript, plugins, multi-tenant"),
    "solidus": ("Solidus", "solidusio/solidus", "Rails, subscriptions, high-volume DTC"),
    "spree": ("Spree", "spree/spree", "Rails, multi-store, marketplace add-ons"),
    "bagisto": ("Bagisto", "bagisto/bagisto", "Laravel, multivendor marketplace, POS"),
    "evershop": ("EverShop", "evershopcommerce/evershop", "Simple modern Node/React store"),
    "nopcommerce": ("nopCommerce", "nopSolutions/nopCommerce", ".NET, B2B, multi-store"),
    "odoo": ("Odoo", "odoo/odoo", "Store + inventory + POS + rentals + B2B in one ERP"),
    "mercur": ("Mercur", "mercurjs/mercur", "Multivendor marketplace on Medusa"),
    "ghost": ("Ghost", "TryGhost/Ghost", "Memberships, paid newsletters, digital content"),
}
MD_LIMIT = 420_000
today = datetime.date.today().isoformat()


def tier(spdx):
    if spdx in PERMISSIVE: return "🟢", "perm", "Permissive"
    if spdx in WEAK: return "🟡", "weak", "Weak copyleft"
    if spdx in STRONG: return "🟠", "gpl", "GPL"
    if spdx == "AGPL-3.0": return "🔴", "agpl", "AGPL"
    return "⚪", "other", "Check"


def stars(n):
    n = int(n)
    if n < 0: return "?"
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def anchor(s):
    return "".join(c for c in s.lower().replace(" ", "-") if c.isalnum() or c == "-")


def md(s):
    return str(s).replace("|", "/").replace("\n", " ").strip()


e = html.escape

# ---------------------------------------------------------------- load
info = json.load(open(os.path.join(HERE, "repo_info.json")))


def ensure_info(slugs):
    """Look up slugs missing from repo_info via the search API (40 per query)."""
    todo = sorted({s for s in slugs if s.lower() not in info and re.fullmatch(r"[\w.-]+/[\w.-]+", s)})
    if os.environ.get("SKIP_FETCH"):
        return
    for i in range(0, len(todo), 40):
        batch = todo[i:i + 40]
        p = subprocess.run(["gh", "api", "-X", "GET", "search/repositories", "-f",
                            "q=fork:true " + " ".join("repo:" + s for s in batch), "-f", "per_page=100"],
                           capture_output=True, text=True)
        items = {}
        if p.returncode == 0:
            items = {it["full_name"].lower(): it for it in json.loads(p.stdout).get("items", [])}
        for s in batch:
            it = items.get(s.lower())
            info[s.lower()] = {"nameWithOwner": it["full_name"], "stargazerCount": it["stargazers_count"],
                               "isArchived": it["archived"], "pushedAt": it["pushed_at"],
                               "licenseInfo": {"spdxId": (it.get("license") or {}).get("spdx_id")},
                               "description": (it.get("description") or "")[:260]} if it else \
                {"nameWithOwner": s, "stargazerCount": -1, "isArchived": False, "pushedAt": "",
                 "licenseInfo": {"spdxId": None}, "description": "", "unindexed": True}
        time.sleep(2.2)
    if todo:
        json.dump(info, open(os.path.join(HERE, "repo_info.json"), "w"))


# curated memberships
curated_rows = []
curated_slugs = set()
for key, _ in SECTORS[:8]:
    for line in open(os.path.join(RAW, key + ".tsv"), encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) < 4 or not re.fullmatch(r"[\w.-]+/[\w.-]+", p[2].strip()):
            continue
        curated_rows.append(dict(sector=key, category=p[0], name=p[1], slug=p[2].strip(), angle=" ".join(p[3:]), curated=True))
        curated_slugs.add(p[2].strip().lower())

# discovered (as batched)
disc_rows = []
for f in sorted(os.listdir(os.path.join(HERE, "batches"))):
    if not f.endswith(".tsv"):
        continue
    for line in open(os.path.join(HERE, "batches", f), encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) < 5 or p[0].lower() in curated_slugs:
            continue
        name = p[0].split("/")[1]
        disc_rows.append(dict(sector=p[3], category=p[4], name=name, slug=p[0], angle="", curated=False))

# enrichment
enriched = {}
bad_lines = 0
edir = os.path.join(HERE, "enriched")
for f in sorted(os.listdir(edir)) if os.path.isdir(edir) else []:
    if not f.endswith(".tsv"):
        continue
    for line in open(os.path.join(edir, f), encoding="utf-8"):
        p = [x.strip() for x in line.rstrip("\n").split("\t")]
        if len(p) < 12 or "/" not in p[0]:
            if line.strip():
                bad_lines += 1
            continue
        while len(p) < 13:
            p.append("-")
        try:
            fit = max(1, min(5, int(re.sub(r"\D", "", p[1]) or 1)))
        except ValueError:
            fit = 2
        enriched[p[0].lower()] = dict(fit=fit, type=p[2], what=p[3], replaces=p[4], customers=p[5], models=p[6],
                                      niches=p[7], pricing=p[8], effort=p[9], effort_reason=p[10],
                                      gotchas=p[11], catfix=p[12])

# category sets per sector (for category fixes)
cats_by_sector = collections.defaultdict(dict)
for r in curated_rows + disc_rows:
    cats_by_sector[r["sector"]][r["category"].lower()] = r["category"]

rows, dropped_fit, unenriched = [], 0, 0
seen = set()
for r in curated_rows + disc_rows:
    low = r["slug"].lower()
    i = info.get(low) or {}
    en = enriched.get(low)
    if en is None:
        unenriched += 1
        if not r["curated"]:
            continue          # discovered rows appear only once enriched
        en = dict(fit=3, type="", what="", replaces="-", customers="", models="", niches="", pricing="",
                  effort="", effort_reason="", gotchas="-", catfix="-")
    if en["fit"] == 1:
        dropped_fit += 1
        continue
    if not r["curated"] and en["catfix"] not in ("-", "") and en["catfix"].lower() in cats_by_sector[r["sector"]]:
        r["category"] = cats_by_sector[r["sector"]][en["catfix"].lower()]
    k = (r["category"].lower(), low)
    if k in seen:
        continue
    seen.add(k)
    r.update(en)
    r["slug"] = i.get("nameWithOwner", r["slug"])
    r["stars"] = i.get("stargazerCount", -1)
    r["archived"] = bool(i.get("isArchived"))
    r["pushed"] = (i.get("pushedAt") or "")[:10]
    r["license"] = (i.get("licenseInfo") or {}).get("spdxId") or "NONE"
    r["desc"] = (i.get("description") or "")
    if not r["curated"] and r["name"] and r["name"][0].islower() and "." not in r["name"]:
        r["name"] = r["name"][0].upper() + r["name"][1:]
    rows.append(r)

by = collections.OrderedDict((k, collections.defaultdict(list)) for k, _ in SECTORS)
for r in rows:
    by[r["sector"]][r["category"]].append(r)
for s in by.values():
    for c in s.values():
        c.sort(key=lambda r: (-r["fit"], -r["stars"]))

# stores
stores, seen_c = [], set()
for f in sorted(os.listdir(os.path.join(HERE, "out"))):
    if f.startswith("stores_") and f.endswith(".tsv"):
        for line in open(os.path.join(HERE, "out", f), encoding="utf-8"):
            p = [x.strip() for x in line.rstrip("\n").split("\t")]
            if len(p) < 10 or p[1].lower() in seen_c:
                continue
            seen_c.add(p[1].lower())
            stores.append(dict(zip(["category", "concept", "customer", "model", "platform", "price", "sourcing",
                                    "channel", "cost", "edge"], p[:10])))
            stores[-1]["platform"] = stores[-1]["platform"].lower().replace("-", "").replace(" ", "")
st_cats = collections.defaultdict(list)
for r in stores:
    st_cats[r["category"]].append(r)

# resell
resell, seen_r = [], set()
for f in sorted(os.listdir(os.path.join(HERE, "out"))):
    if f.startswith("resell_") and f.endswith(".tsv"):
        for line in open(os.path.join(HERE, "out", f), encoding="utf-8"):
            p = [x.strip() for x in line.rstrip("\n").split("\t")]
            if len(p) < 11 or p[1].lower() in seen_r:
                continue
            seen_r.add(p[1].lower())
            stack = [s.strip().replace("https://github.com/", "").strip("/") for s in p[4].split(",") if "/" in s]
            resell.append(dict(category=p[0], idea=p[1], what=p[2], supply=p[3], stack=stack, revenue=p[5],
                               margin=p[6], regulation=p[7], first=p[8], cost=p[9], edge=p[10]))
rs_cats = collections.defaultdict(list)
for r in resell:
    rs_cats[r["category"]].append(r)
ensure_info([v[1] for v in PLATFORMS.values()] + [s for r in resell for s in r["stack"]])
for r in resell:
    r["stack"] = [info[s.lower()]["nameWithOwner"] if s.lower() in info else s for s in r["stack"]]

n_proj = len(rows)
n_cats = sum(len(c) for c in by.values())
n_total = n_proj + len(stores) + len(resell)
tiers = collections.Counter(tier(r["license"])[1] for r in rows)
uniq = len({r["slug"].lower() for r in rows})
os.makedirs(os.path.join(OUT, "sectors"), exist_ok=True)
import glob as _glob
for _f in (_glob.glob(os.path.join(OUT, "sectors", "*.md")) + _glob.glob(os.path.join(OUT, "stores*.md")) +
           _glob.glob(os.path.join(OUT, "resell*.md")) +
           [os.path.join(OUT, k + ".md") for k, _ in SECTORS[:8]]):
    if os.path.exists(_f):
        os.remove(_f)       # stale generated pages from earlier builds

LEGEND = ("**License key** (what it means for white-labeling): "
          "🟢 permissive (MIT/Apache/BSD), rebrand and sell freely, keep notices · "
          "🟡 weak copyleft (MPL/LGPL), share changes to *their* files · "
          "🟠 GPL, fine for hosted SaaS, distributed apps must ship source · "
          "🔴 AGPL, hosted users must be offered your modified source · "
          "⚪ other: NOASSERTION means GitHub couldn't auto-detect it (often dual/custom/source-available), NONE means no license file, read it first.\n\n"
          "**Fit** (1-5): how directly the project can become a business. 5 = host or sell almost as-is · 4 = strong product, needs packaging · "
          "3 = tool/component, build around it · 2 = library/framework, sell services or hosting around it. "
          "📦 = archived repo (fork it). Not legal advice; trademarks and logos are never licensed, so always rebrand.\n")


def proj_cell_md(r):
    t = tier(r["license"])[0]
    arch = " · 📦 archived" if r["archived"] else ""
    typ = f" · {r['type']}" if r["type"] else ""
    return (f"**{md(r['name'])}**<br>[{r['slug']}](https://github.com/{r['slug']})<br>"
            f"⭐ {stars(r['stars'])} · {t} {r['license']}{typ} · Fit {r['fit']}/5{arch}")


def what_cell_md(r):
    s = md(r["what"]) or md(r["desc"]) or "-"
    if r["replaces"] and r["replaces"] != "-":
        s += f"<br>*Replaces:* {md(r['replaces'])}"
    return s


def niche_cell_md(r):
    s = md(r["niches"]).replace("; ", "<br>• ")
    s = ("• " + s) if s else ""
    if r["angle"]:
        s += ("<br>" if s else "") + f"*Angle:* {md(r['angle'])}"
    return s or "-"


def price_cell_md(r):
    parts = []
    if r["pricing"]: parts.append(md(r["pricing"]))
    if r["effort"]: parts.append(f"*Effort:* {md(r['effort'])}" + (f" ({md(r['effort_reason'])})" if r["effort_reason"] else ""))
    if r["gotchas"] and r["gotchas"] != "-": parts.append(f"⚠ {md(r['gotchas'])}")
    return "<br>".join(parts) or "-"


def write_parts(base, title, intro, cats, render_cat, back="../README.md"):
    """Write markdown split into parts of <= MD_LIMIT bytes at category boundaries. Returns [(file, first_cat, last_cat, n)]."""
    names = sorted(cats)
    chunks, cur, size = [], [], 0
    bodies = {c: render_cat(c) for c in names}
    for c in names:
        b = len(bodies[c].encode())
        if cur and size + b > MD_LIMIT:
            chunks.append(cur); cur, size = [], 0
        cur.append(c); size += b
    if cur:
        chunks.append(cur)
    out = []
    for i, chunk in enumerate(chunks):
        fn = f"{base}.md" if len(chunks) == 1 else f"{base}-{i + 1}.md"
        part = f" (part {i + 1} of {len(chunks)}: {chunk[0]} → {chunk[-1]})" if len(chunks) > 1 else ""
        L = [f"# {title}{part}\n", f"[← back to index]({back}) · {sum(len(cats[c]) for c in chunk)} entries in this file · {len(cats)} categories in total\n", intro]
        if len(chunks) > 1:
            L.append("**Parts:** " + " · ".join(
                (f"**part {j + 1}**" if j == i else f"[part {j + 1}]({os.path.basename(base)}-{j + 1}.md)") + f" ({ch[0]} → {ch[-1]})"
                for j, ch in enumerate(chunks)) + "\n")
        L.append("**Categories in this file:** " + " · ".join(f"[{c}](#{anchor(c)}) ({len(cats[c])})" for c in chunk) + "\n")
        for c in chunk:
            L.append(bodies[c])
        open(fn, "w", encoding="utf-8").write("\n".join(L))
        out.append((os.path.relpath(fn, OUT), chunk, sum(len(cats[c]) for c in chunk)))
    return out


# ---------------------------------------------------------------- sector pages
sector_parts = {}
for key, title in SECTORS:
    cats = by[key]
    if not cats:
        continue

    def render_cat(c, cats=cats):
        L = [f"## {c}\n", f"{len(cats[c])} projects, sorted by fit then stars.\n",
             "| Project | What it does | Customers | Business models | Niche ideas | Pricing · effort · gotchas |",
             "|---|---|---|---|---|---|"]
        for r in cats[c]:
            L.append(f"| {proj_cell_md(r)} | {what_cell_md(r)} | {md(r['customers']) or '-'} | "
                     f"{md(r['models']).replace('; ', '<br>') or '-'} | {niche_cell_md(r)} | {price_cell_md(r)} |")
        L.append("")
        return "\n".join(L)

    intro = f"{sum(len(v) for v in cats.values())} open-source projects in {len(cats)} categories. Every repo was confirmed on GitHub ({today}).\n\n" + LEGEND
    sector_parts[key] = write_parts(os.path.join(OUT, "sectors", key), title, intro, cats, render_cat)

# ---------------------------------------------------------------- stores pages
plat_count = collections.Counter(r["platform"] for r in stores)
model_count = collections.Counter(r["model"] for r in stores)
cost_count = collections.Counter(r["cost"] for r in stores)
plat_table = ["| Key | Platform | Repo | ⭐ | License | Best for | Concepts |", "|---|---|---|---:|---|---|---:|"]
for k, (name, slug, best) in PLATFORMS.items():
    i = info.get(slug.lower()) or {}
    lic = (i.get("licenseInfo") or {}).get("spdxId") or "?"
    plat_table.append(f"| `{k}` | {name} | [{i.get('nameWithOwner', slug)}](https://github.com/{i.get('nameWithOwner', slug)}) | "
                      f"{stars(i.get('stargazerCount', -1))} | {tier(lic)[0]} {lic} | {best} | {plat_count.get(k, 0)} |")
stores_intro = ("Each concept lists a target customer, business model, best-fit open-source store platform, price point and margin, "
                "where the product comes from, the marketing channel to start with and a startup-cost band "
                "(Low <$2k · Medium $2k-15k · High >$15k). Treat the platform as a starting suggestion.\n\n"
                "### Platforms\n\n" + "\n".join(plat_table) + "\n\n"
                "**Business models:** " + " · ".join(f"{m} ({n})" for m, n in model_count.most_common()) + "\n\n"
                "**Startup cost:** " + " · ".join(f"{m} ({n})" for m, n in cost_count.most_common()) + "\n")


def render_store_cat(c):
    L = [f"## {c}\n", "| Store concept | Customer | Model | Platform | Price & margin | Sourcing | Channel | Cost | Edge |",
         "|---|---|---|---|---|---|---|---|---|"]
    for r in st_cats[c]:
        pk = r["platform"]
        pl = f"[{PLATFORMS[pk][0]}](https://github.com/{PLATFORMS[pk][1]})" if pk in PLATFORMS else md(pk)
        L.append("| " + " | ".join([f"**{md(r['concept'])}**", md(r["customer"]), md(r["model"]), pl, md(r["price"]),
                                    md(r["sourcing"]), md(r["channel"]), md(r["cost"]), md(r["edge"])]) + " |")
    L.append("")
    return "\n".join(L)


store_parts = write_parts(os.path.join(OUT, "stores"), f"Online Store Concepts: {len(stores):,} niches", stores_intro,
                          st_cats, render_store_cat, back="README.md")

# ---------------------------------------------------------------- resell pages
rs_cost = collections.Counter(r["cost"] for r in resell)
resell_intro = ("Businesses where you sell someone else's product, service or inventory under your own brand, plus open-source "
                "software that could run the operation. Supply sources are starting points for research, so check current partner terms. "
                "The regulation column flags where a license or registration is usually needed. "
                "Startup cost: " + " · ".join(f"{k} ({v})" for k, v in rs_cost.most_common()) + ".\n")


def render_rs_cat(c):
    L = [f"## {c}\n", "| Business idea | What you resell | Supply sources | Open-source stack | Revenue model | Margin / take | Regulation | First customers & channel | Cost | Why it works |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    for r in rs_cats[c]:
        stack = ", ".join(f"[{s}](https://github.com/{s})" for s in r["stack"]) or "-"
        L.append("| " + " | ".join([f"**{md(r['idea'])}**", md(r["what"]), md(r["supply"]), stack, md(r["revenue"]),
                                    md(r["margin"]), md(r["regulation"]), md(r["first"]), md(r["cost"]), md(r["edge"])]) + " |")
    L.append("")
    return "\n".join(L)


resell_parts = write_parts(os.path.join(OUT, "resell"), f"White-Label & Reseller Businesses: {len(resell):,} ideas", resell_intro,
                           rs_cats, render_rs_cat, back="README.md")

# ---------------------------------------------------------------- CSVs
with open(os.path.join(OUT, "catalog.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["sector", "category", "project", "repo", "url", "stars", "license", "license_tier", "archived", "last_push",
                "type", "fit", "what_it_does", "replaces", "ideal_customers", "business_models", "niche_ideas", "pricing_idea",
                "whitelabel_effort", "effort_reason", "gotchas", "curated_angle", "github_description"])
    for key, _ in SECTORS:
        for c in sorted(by[key]):
            for r in by[key][c]:
                w.writerow([TITLE[key], c, r["name"], r["slug"], "https://github.com/" + r["slug"], r["stars"], r["license"],
                            tier(r["license"])[2], r["archived"], r["pushed"], r["type"], r["fit"], r["what"], r["replaces"],
                            r["customers"], r["models"], r["niches"], r["pricing"], r["effort"], r["effort_reason"],
                            r["gotchas"], r["angle"], r["desc"]])
with open(os.path.join(OUT, "stores.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["category", "store_concept", "target_customer", "business_model", "platform", "platform_repo",
                "price_point_margin", "sourcing", "marketing_channel", "startup_cost", "edge"])
    for c in sorted(st_cats):
        for r in st_cats[c]:
            w.writerow([c, r["concept"], r["customer"], r["model"], r["platform"],
                        "https://github.com/" + PLATFORMS[r["platform"]][1] if r["platform"] in PLATFORMS else "",
                        r["price"], r["sourcing"], r["channel"], r["cost"], r["edge"]])
with open(os.path.join(OUT, "resell.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["category", "business_idea", "what_you_resell", "supply_sources", "open_source_stack", "revenue_model",
                "margin_take", "regulation_licensing", "first_customers_channel", "startup_cost", "why_it_works"])
    for c in sorted(rs_cats):
        for r in rs_cats[c]:
            w.writerow([c, r["idea"], r["what"], r["supply"], " ".join("https://github.com/" + s for s in r["stack"]),
                        r["revenue"], r["margin"], r["regulation"], r["first"], r["cost"], r["edge"]])

# ---------------------------------------------------------------- index
L = ["# Open-Source White-Label Business Catalog\n",
     f"**{n_total:,} business ideas** in {n_cats + len(st_cats) + len(rs_cats)} categories: {n_proj:,} open-source projects "
     f"({uniq:,} distinct repos) you can self-host, rebrand and sell, {len(stores):,} online store concepts and {len(resell):,} "
     f"white-label / reseller business models. Every repo was confirmed on GitHub on {today}; stars, license and archive status are as of then.\n",
     "**Everything in one file:** [`Open-Source-White-Label-Business-Catalog.pdf`](Open-Source-White-Label-Business-Catalog.pdf) · "
     "spreadsheets: [`catalog.csv`](catalog.csv), [`stores.csv`](stores.csv), [`resell.csv`](resell.csv)\n",
     LEGEND, "## Sectors\n", "| Sector | Categories | Entries | Pages |", "|---|---:|---:|---|"]
for key, title in SECTORS:
    if key not in sector_parts:
        continue
    parts = sector_parts[key]
    links = " · ".join(f"[{'open' if len(parts) == 1 else 'part ' + str(i + 1)}]({p[0]})" for i, p in enumerate(parts))
    L.append(f"| {title} | {len(by[key])} | {sum(len(v) for v in by[key].values()):,} | {links} |")
L.append(f"| Online Store Concepts | {len(st_cats)} | {len(stores):,} | " + " · ".join(f"[{'open' if len(store_parts) == 1 else 'part ' + str(i + 1)}]({p[0]})" for i, p in enumerate(store_parts)) + " |")
L.append(f"| White-Label & Reseller Businesses | {len(rs_cats)} | {len(resell):,} | " + " · ".join(f"[{'open' if len(resell_parts) == 1 else 'part ' + str(i + 1)}]({p[0]})" for i, p in enumerate(resell_parts)) + " |")
L.append("\n## How to use this\n")
L.append("1. Pick a category, then filter by **Fit** (4-5 for products you can host almost as-is) and license (🟢/🟡 for the most freedom; 🟠/🔴 are fine for hosted services if you publish your changes).\n"
         "2. Every project lists what it replaces, who buys it, 2-3 business models and 3 niche angles. The generic version usually exists already; the money is in the niche.\n"
         "3. Rebrand (name, logo, domain, colours), add onboarding, billing and support. That is the product.\n"
         "4. Open the CSVs in a spreadsheet to sort by fit, stars, license or effort and build a shortlist.\n"
         "5. Reseller supply sources are starting points: check each provider's current partner terms, and expect licensing in insurance, lending, travel and health.\n")
L.append("## All categories\n")
for key, title in SECTORS:
    if key not in sector_parts:
        continue
    file_of = {}
    for fn, chunk, _ in sector_parts[key]:
        for c in chunk:
            file_of[c] = fn
    L.append(f"**{title}:** " + " · ".join(f"[{c}]({file_of[c]}#{anchor(c)}) ({len(v)})" for c, v in sorted(by[key].items())) + "\n")
file_of = {c: fn for fn, chunk, _ in store_parts for c in chunk}
L.append("**Online Store Concepts:** " + " · ".join(f"[{c}]({file_of[c]}#{anchor(c)}) ({len(v)})" for c, v in sorted(st_cats.items())) + "\n")
file_of = {c: fn for fn, chunk, _ in resell_parts for c in chunk}
L.append("**White-Label & Reseller Businesses:** " + " · ".join(f"[{c}]({file_of[c]}#{anchor(c)}) ({len(v)})" for c, v in sorted(rs_cats.items())) + "\n")
L.append("\n*Source lists and build scripts are in [`_source/`](_source/README.md).*\n")
open(os.path.join(OUT, "README.md"), "w", encoding="utf-8").write("\n".join(L))

print(f"projects={n_proj} unique_repos={uniq} categories={n_cats} dropped_fit1={dropped_fit} unenriched={unenriched} "
      f"bad_enrich_lines={bad_lines} stores={len(stores)}/{len(st_cats)} resell={len(resell)}/{len(rs_cats)} tiers={dict(tiers)}")

# ---------------------------------------------------------------- HTML for PDF
if NO_PDF:
    sys.exit(0)
PDFDIR = os.path.join(HERE, "pdf")
os.makedirs(PDFDIR, exist_ok=True)
CSS = open(os.path.join(HERE, "pdf.css")).read()


def page(body):
    return f'<!doctype html><html><head><meta charset="utf-8"><title>Catalog</title><style>{CSS}</style></head><body>{body}</body></html>'


def badge(lic):
    cls, lab = tier(lic)[1], tier(lic)[2]
    return f'<span class="b {cls}">{lab}</span> {e(lic)}'


def sec_html(key):
    cats = by[key]
    H = [f'<h2 class="sector" id="{anchor(key)}">{e(TITLE[key])}</h2>',
         f'<p class="lead">{sum(len(v) for v in cats.values()):,} projects in {len(cats)} categories, sorted by fit then stars.</p>']
    for c in sorted(cats):
        H.append(f'<h3>{e(c)} <span class="n">· {len(cats[c])}</span></h3>')
        H.append('<table><colgroup><col style="width:17%"><col style="width:21%"><col style="width:12%"><col style="width:13%"><col style="width:19%"><col style="width:18%"></colgroup>'
                 '<thead><tr><th>Project</th><th>What it does</th><th>Customers</th><th>Business models</th><th>Niche ideas</th><th>Pricing · effort · gotchas</th></tr></thead><tbody>')
        for r in cats[c]:
            arch = ' <span class="arch">ARCHIVED</span>' if r["archived"] else ""
            typ = f' · {e(r["type"])}' if r["type"] else ""
            proj = (f'<b>{e(r["name"])}</b>{arch}<br><a href="https://github.com/{e(r["slug"])}">{e(r["slug"])}</a><br>'
                    f'<span class="meta">★ {stars(r["stars"])} · {badge(r["license"])}{typ} · Fit {r["fit"]}/5</span>')
            what = e(r["what"] or r["desc"] or "-")
            if r["replaces"] and r["replaces"] != "-":
                what += f'<br><span class="meta"><i>Replaces:</i> {e(r["replaces"])}</span>'
            niches = "".join(f"<div>• {e(n.strip())}</div>" for n in r["niches"].split(";") if n.strip())
            if r["angle"]:
                niches += f'<div class="meta"><i>Angle:</i> {e(r["angle"])}</div>'
            models = "".join(f"<div>{e(m.strip())}</div>" for m in r["models"].split(";") if m.strip()) or "-"
            price = []
            if r["pricing"]: price.append(e(r["pricing"]))
            if r["effort"]: price.append(f'<i>Effort:</i> {e(r["effort"])}' + (f' ({e(r["effort_reason"])})' if r["effort_reason"] else ""))
            if r["gotchas"] and r["gotchas"] != "-": price.append(f'<span class="warn">⚠ {e(r["gotchas"])}</span>')
            H.append(f'<tr><td>{proj}</td><td>{what}</td><td>{e(r["customers"]) or "-"}</td><td>{models}</td><td>{niches or "-"}</td><td>{"<br>".join(price) or "-"}</td></tr>')
        H.append("</tbody></table>")
    return "\n".join(H)


def stores_html():
    H = [f'<h2 class="sector" id="stores">Online Store Concepts</h2>',
         f'<p class="lead">{len(stores):,} store ideas in {len(st_cats)} categories. Each lists a target customer, business model, best-fit open-source platform, '
         'price point and margin, sourcing, first marketing channel and startup-cost band (Low &lt;$2k · Medium $2k-15k · High &gt;$15k).</p>',
         '<h3>Platforms</h3><table class="plat"><colgroup><col style="width:12%"><col style="width:18%"><col style="width:26%"><col style="width:8%"><col style="width:12%"><col style="width:24%"></colgroup>'
         '<thead><tr><th>Key</th><th>Platform</th><th>Repository</th><th>★</th><th>License</th><th>Best for</th></tr></thead><tbody>']
    for k, (name, slug, best) in PLATFORMS.items():
        i = info.get(slug.lower()) or {}
        lic = (i.get("licenseInfo") or {}).get("spdxId") or "?"
        H.append(f'<tr><td><b>{k}</b> ({plat_count.get(k, 0)})</td><td>{e(name)}</td><td><a href="https://github.com/{e(slug)}">{e(slug)}</a></td>'
                 f'<td class="num">{stars(i.get("stargazerCount", -1))}</td><td>{badge(lic)}</td><td>{e(best)}</td></tr>')
    H.append("</tbody></table>")
    H.append('<p class="lead"><b>Business models:</b> ' + " · ".join(f"{e(m)} ({n})" for m, n in model_count.most_common()) + "</p>")
    for c in sorted(st_cats):
        H.append(f'<h3>{e(c)} <span class="n">· {len(st_cats[c])}</span></h3>')
        H.append('<table><colgroup><col style="width:17%"><col style="width:11%"><col style="width:9%"><col style="width:7%"><col style="width:12%"><col style="width:13%"><col style="width:11%"><col style="width:5%"><col style="width:15%"></colgroup>'
                 '<thead><tr><th>Store concept</th><th>Customer</th><th>Model</th><th>Platform</th><th>Price &amp; margin</th><th>Sourcing</th><th>Channel</th><th>Cost</th><th>Edge</th></tr></thead><tbody>')
        for r in st_cats[c]:
            pk = r["platform"]
            pl = f'<a href="https://github.com/{PLATFORMS[pk][1]}">{e(PLATFORMS[pk][0])}</a>' if pk in PLATFORMS else e(pk)
            H.append("<tr>" + "".join(f"<td>{x}</td>" for x in [f'<b>{e(r["concept"])}</b>', e(r["customer"]), e(r["model"]), pl, e(r["price"]),
                                                              e(r["sourcing"]), e(r["channel"]), e(r["cost"]), e(r["edge"])]) + "</tr>")
        H.append("</tbody></table>")
    return "\n".join(H)


def resell_html():
    H = [f'<h2 class="sector" id="resell">White-Label &amp; Reseller Businesses</h2>',
         f'<p class="lead">{len(resell):,} ideas in {len(rs_cats)} categories: businesses where you sell someone else\'s product, service or inventory under your own brand, '
         'plus open-source software that could run the operation. Supply sources are starting points for research; the regulation column flags where a license is usually needed.</p>']
    for c in sorted(rs_cats):
        H.append(f'<h3>{e(c)} <span class="n">· {len(rs_cats[c])}</span></h3>')
        H.append('<table><colgroup><col style="width:14%"><col style="width:11%"><col style="width:12%"><col style="width:11%"><col style="width:10%"><col style="width:8%"><col style="width:9%"><col style="width:11%"><col style="width:4%"><col style="width:10%"></colgroup>'
                 '<thead><tr><th>Business idea</th><th>What you resell</th><th>Supply sources</th><th>Open-source stack</th><th>Revenue model</th><th>Margin</th><th>Regulation</th><th>First customers</th><th>Cost</th><th>Why it works</th></tr></thead><tbody>')
        for r in rs_cats[c]:
            stack = "<br>".join(f'<a href="https://github.com/{e(s)}">{e(s)}</a>' for s in r["stack"]) or "-"
            H.append("<tr>" + "".join(f"<td>{x}</td>" for x in [f'<b>{e(r["idea"])}</b>', e(r["what"]), e(r["supply"]), stack, e(r["revenue"]),
                                                              e(r["margin"]), e(r["regulation"]), e(r["first"]), e(r["cost"]), e(r["edge"])]) + "</tr>")
        H.append("</tbody></table>")
    return "\n".join(H)


sections = [(key, TITLE[key], sec_html(key)) for key, _ in SECTORS if by[key]]
sections.append(("stores", "Online Store Concepts", stores_html()))
sections.append(("resell", "White-Label & Reseller Businesses", resell_html()))
for key, title, body in sections:
    open(os.path.join(PDFDIR, f"sec_{key}.html"), "w", encoding="utf-8").write(page(body))

# cover + intro
cover = f"""<section class="cover"><h1>Open-Source White-Label<br>Business Catalog</h1>
<div class="sub">{n_total:,} business ideas: open-source projects you can self-host, rebrand and sell, online store concepts, and white-label / reseller business models.
Every project links to a GitHub repository confirmed to exist (data as of {today}).</div>
<div class="stats">
<div class="stat"><b>{n_total:,}</b><span>ideas in total</span></div>
<div class="stat"><b>{n_cats + len(st_cats) + len(rs_cats)}</b><span>categories</span></div>
<div class="stat"><b>{n_proj:,}</b><span>open-source projects ({uniq:,} repos)</span></div>
<div class="stat"><b>{len(stores):,}</b><span>store concepts</span></div>
<div class="stat"><b>{len(resell):,}</b><span>white-label / reseller ideas</span></div>
</div></section>"""
intro = f"""<section class="intro">
<div><h2>What's inside</h2><ul>
{''.join(f'<li>{e(TITLE[k])}: {sum(len(v) for v in by[k].values()):,} projects, {len(by[k])} categories</li>' for k, _ in SECTORS if by[k])}
<li>Online Store Concepts: {len(stores):,} store ideas, {len(st_cats)} categories</li>
<li>White-Label &amp; Reseller Businesses: {len(resell):,} ideas, {len(rs_cats)} categories</li></ul></div>
<div><h2>Each project entry gives you</h2><ul>
<li><b>What it does</b> and the commercial products it <b>replaces</b></li>
<li><b>Ideal customers</b> and 2-3 <b>business models</b> (managed hosting, vertical SaaS, white-label reseller, setup + support, agency service, courses, kits...)</li>
<li>Three specific <b>niche ideas</b>, a <b>pricing idea</b>, the <b>white-label effort</b> (Low/Medium/High) and <b>gotchas</b> (license, trademark, regulation)</li>
<li><b>Fit 1-5</b>: 5 = host or sell almost as-is · 4 = strong product, needs packaging · 3 = tool, build around it · 2 = library, sell services around it (fit-1 entries were removed)</li></ul></div>
<div><h2>License key: what you're allowed to do</h2><ul>
<li><span class="b perm">Permissive</span> MIT / Apache / BSD: rebrand and sell freely, keep the copyright notice ({tiers['perm']:,} entries)</li>
<li><span class="b weak">Weak copyleft</span> MPL / LGPL: share changes you make to <i>their</i> files ({tiers['weak']:,})</li>
<li><span class="b gpl">GPL</span> fine as a hosted service; apps you distribute must ship their source ({tiers['gpl']:,})</li>
<li><span class="b agpl">AGPL</span> if people use your hosted version, you must offer them your modified source ({tiers['agpl']:,})</li>
<li><span class="b other">Check</span> custom, dual, source-available or no license detected: read it before building on it ({tiers['other']:,})</li></ul>
<p><span class="arch">ARCHIVED</span> = no longer maintained, fork it or pick another. ★ ? = GitHub search returned no stats. Not legal advice. Trademarks and logos are never covered by open-source licenses, so always rebrand.</p></div>
<div><h2>How to turn one into a business</h2><ol>
<li>Pick a category, then filter by Fit 4-5 and a Permissive or Weak-copyleft license for the most freedom (GPL/AGPL are fine if you host it and publish your changes).</li>
<li>Go niche: the generic version already exists; the money is in "X for dentists", "X for churches", "X in Portuguese". Each entry gives you three to start from.</li>
<li>Rebrand (name, logo, domain, colours), then add onboarding, billing and support. That is the product.</li>
<li>Use the companion CSV files to sort and filter the whole catalog in a spreadsheet.</li></ol></div>
<div><h2>Before you rely on an entry</h2><ul>
<li>Hardware designs with non-commercial terms are flagged in gotchas; get permission before selling them.</li>
<li>Reseller supply sources are starting points: check each provider's current partner terms.</li>
<li>Insurance, lending, travel, health, food and similar ideas usually need a license or registration.</li>
<li>Some projects appear in more than one category, each with its own angle.</li></ul></div>
</section>"""
open(os.path.join(PDFDIR, "front.html"), "w", encoding="utf-8").write(page(cover + intro))
json.dump({"sections": [(k, t) for k, t, _ in sections],
           "cats": {k: sorted(by[k]) for k, _ in SECTORS if by[k]} | {"stores": sorted(st_cats), "resell": sorted(rs_cats)},
           "counts": {k: {c: len(v) for c, v in by[k].items()} for k, _ in SECTORS if by[k]} |
                     {"stores": {c: len(v) for c, v in st_cats.items()}, "resell": {c: len(v) for c, v in rs_cats.items()}}},
          open(os.path.join(PDFDIR, "meta.json"), "w"))
print("html sections written:", len(sections))
