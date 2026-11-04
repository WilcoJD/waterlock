#!/usr/bin/env python3
"""Verify catalog repos via GitHub GraphQL and render markdown + CSV."""
import csv, json, os, re, subprocess, sys, collections, datetime

SCRATCH = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(SCRATCH, "raw")
CACHE = os.path.join(SCRATCH, "gh_cache.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(SCRATCH)

SECTORS = [
    ("hosting", "Hosting, Infrastructure & DevOps"),
    ("business", "Business Software & Vertical SaaS"),
    ("web", "Websites, Content, Commerce & Community"),
    ("media_ai", "Media, AI, Data & Automation"),
    ("games", "Games, Game Tech & Entertainment"),
    ("mobile", "Mobile, Consumer Apps & Vertical Platforms"),
    ("hardware", "Open Hardware, Physical Products & Designs"),
    ("industries", "Traditional Industries & Local Businesses"),
]

PERMISSIVE = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense",
              "0BSD", "CC0-1.0", "BSL-1.0", "MIT-0", "Artistic-2.0", "PostgreSQL", "WTFPL", "NCSA"}
WEAK = {"MPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-2.0", "EPL-1.0", "EUPL-1.2", "CDDL-1.0", "OSL-3.0"}
STRONG = {"GPL-2.0", "GPL-3.0"}
NETWORK = {"AGPL-3.0"}


def tier(spdx):
    if spdx in PERMISSIVE: return "🟢"
    if spdx in WEAK: return "🟡"
    if spdx in STRONG: return "🟠"
    if spdx in NETWORK: return "🔴"
    return "⚪"


def load_rows():
    rows, seen = [], set()
    for key, _ in SECTORS:
        path = os.path.join(RAW, key + ".tsv")
        if not os.path.exists(path):
            print("missing", path); continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                parts = [p.strip() for p in line.rstrip("\n").split("\t")]
                if len(parts) < 4 or "/" not in parts[2]:
                    continue
                cat, name, slug, angle = parts[0], parts[1], parts[2], " ".join(parts[3:])
                slug = slug.replace("https://github.com/", "").strip("/")
                if (cat.lower(), slug.lower()) in seen:
                    continue
                seen.add((cat.lower(), slug.lower()))
                rows.append(dict(sector=key, category=cat, name=name, slug=slug, angle=angle))
    return rows


def fetch(slugs):
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    # Only the search API reaches repos outside this session, so OR together repo: qualifiers.
    import re, time
    todo = [s for s in slugs if s.lower() not in cache and re.fullmatch(r"[\w.-]+/[\w.-]+", s)]
    for s in slugs:
        if s.lower() not in cache and s not in todo:
            cache[s.lower()] = None
    i = 0
    while i < len(todo):
        batch, length = [], 0
        while i < len(todo) and len(batch) < 40 and length + len(todo[i]) < 1050:
            batch.append(todo[i]); length += len(todo[i]) + 6; i += 1
        q = "fork:true " + " ".join("repo:" + s for s in batch)
        for attempt in range(5):
            p = subprocess.run(["gh", "api", "-X", "GET", "search/repositories", "-f", "q=" + q,
                                "-f", "per_page=100"], capture_output=True, text=True)
            if p.returncode == 0:
                break
            print("retry", p.stderr[:200], file=sys.stderr)
            time.sleep(20)
        else:
            continue
        items = {it["full_name"].lower(): it for it in json.loads(p.stdout).get("items", [])}
        for s in batch:
            it = items.get(s.lower())
            cache[s.lower()] = None if not it else {
                "nameWithOwner": it["full_name"], "stargazerCount": it["stargazers_count"],
                "isArchived": it["archived"], "pushedAt": it["pushed_at"],
                "licenseInfo": {"spdxId": (it.get("license") or {}).get("spdx_id")}}
        print(f"fetched {i}/{len(todo)} (found {len(items)}/{len(batch)})", file=sys.stderr)
        json.dump(cache, open(CACHE, "w"))
        time.sleep(2.2)
    json.dump(cache, open(CACHE, "w"))
    recover(cache, [s for s in slugs if cache.get(s.lower()) is None])
    json.dump(cache, open(CACHE, "w"))
    return cache


def recover(cache, missing):
    """Search misses renamed/unindexed repos: confirm with git, then try a name lookup."""
    import time
    from concurrent.futures import ThreadPoolExecutor
    tried = cache.setdefault("__recovered__", {})
    missing = [s for s in missing if s.lower() not in tried and re.fullmatch(r"[\w.-]+/[\w.-]+", s)]
    if not missing:
        return

    def exists(s):
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
        try:
            p = subprocess.run(["git", "ls-remote", f"https://github.com/{s}", "HEAD"],
                               capture_output=True, text=True, timeout=30, env=env)
            return p.returncode == 0 and p.stdout.strip() != ""
        except subprocess.TimeoutExpired:
            return False

    with ThreadPoolExecutor(16) as ex:
        alive = [s for s, ok in zip(missing, ex.map(exists, missing)) if ok]
    for s in missing:
        tried[s.lower()] = True
    print(f"recover: {len(alive)}/{len(missing)} exist via git", file=sys.stderr)
    for s in alive:
        owner, name = s.split("/", 1)
        info = {"nameWithOwner": s, "stargazerCount": -1, "isArchived": False, "pushedAt": "",
                "licenseInfo": {"spdxId": None}}
        p = subprocess.run(["gh", "api", "-X", "GET", "search/repositories", "-f",
                            f"q={name} in:name fork:true", "-f", "per_page=20"], capture_output=True, text=True)
        if p.returncode == 0:
            own = re.sub(r"[^a-z0-9]", "", owner.lower())
            for it in json.loads(p.stdout).get("items", []):
                o2 = re.sub(r"[^a-z0-9]", "", it["owner"]["login"].lower())
                if it["name"].lower() == name.lower() and (own[:5] in o2 or o2[:5] in own):
                    info = {"nameWithOwner": it["full_name"], "stargazerCount": it["stargazers_count"],
                            "isArchived": it["archived"], "pushedAt": it["pushed_at"],
                            "licenseInfo": {"spdxId": (it.get("license") or {}).get("spdx_id")}}
                    break
        cache[s.lower()] = info
        time.sleep(2.2)


def stars(n):
    if n < 0:
        return "?"
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def anchor(s):
    return "".join(c for c in s.lower().replace(" ", "-") if c.isalnum() or c == "-")


def main():
    rows = load_rows()
    cache = fetch(sorted({r["slug"] for r in rows}))
    good, dropped = [], []
    for r in rows:
        info = cache.get(r["slug"].lower())
        if not info:
            dropped.append(r); continue
        r["slug"] = info["nameWithOwner"]
        r["stars"] = info["stargazerCount"]
        r["archived"] = info["isArchived"]
        r["pushed"] = (info["pushedAt"] or "")[:10]
        lic = (info.get("licenseInfo") or {}).get("spdxId") or "NONE"
        r["license"] = lic
        r["tier"] = tier(lic)
        good.append(r)

    os.makedirs(OUT, exist_ok=True)
    today = datetime.date.today().isoformat()
    by_sector = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in good:
        by_sector[r["sector"]][r["category"]].append(r)

    legend = ("**License key** (what it means for white-labeling):\n"
              "🟢 permissive (MIT/Apache/BSD), rebrand and sell freely, keep notices · "
              "🟡 weak copyleft (MPL/LGPL), share changes to *their* files · "
              "🟠 GPL, fine for hosted SaaS, but distributed apps must ship source · "
              "🔴 AGPL, hosted users must be offered your modified source · "
              "⚪ other: NOASSERTION means GitHub couldn't auto-detect it (often dual, custom or source-available), NONE means no license file, so read the license before you build a business on it.\n\n"
              "📦 = repo archived (fork it or pick another). Not legal advice; trademarks/logos are never licensed, "
              "so always rebrand.\n")

    index = [f"# Open-Source White-Label Business Catalog\n",
             f"{len(good)} verified open-source projects across "
             f"{sum(len(c) for c in by_sector.values())} categories that can be self-hosted, rebranded "
             f"and turned into a business. Every repo was confirmed on GitHub on {today} "
             f"via the search API, with `git ls-remote` as a fallback for repos search misses (stars, license and archive status are as of then; ? = not available).\n",
             legend,
             "## Sectors\n",
             "| Sector | Categories | Projects |", "|---|---:|---:|"]
    for key, title in SECTORS:
        cats = by_sector.get(key, {})
        index.append(f"| [{title}]({key}.md) | {len(cats)} | {sum(len(v) for v in cats.values())} |")
    index.append("\nAlso: [`catalog.csv`](catalog.csv), spreadsheet-friendly versions of everything for sorting, filtering and shortlisting.\n")
    index.append("## How to use this\n")
    index.append("1. Pick a category, then pick a 🟢/🟡 project for the most freedom (or 🟠/🔴 if you're happy hosting it as a service and publishing your changes).\n"
                 "2. Pick a niche: the generic version usually exists already, the money is in \"X for dentists\", \"X for churches\", \"X in Portuguese\".\n"
                 "3. Rebrand (name, logo, domain, colors), add onboarding, billing and support. That's the product.\n"
                 "4. Business models that work repeatedly: managed hosting · white-label reseller for agencies · vertical SaaS · setup + support retainers · mobile app built on the open-source backend.\n")
    index.append("## All categories\n")
    for key, title in SECTORS:
        cats = by_sector.get(key, {})
        links = " · ".join(f"[{c}]({key}.md#{anchor(c)}) ({len(v)})" for c, v in sorted(cats.items()))
        index.append(f"**{title}:** {links}\n")
    open(os.path.join(OUT, "README.md"), "w").write("\n".join(index))

    for key, title in SECTORS:
        cats = by_sector.get(key, {})
        lines = [f"# {title}\n", f"[← back to index](README.md) · {sum(len(v) for v in cats.values())} projects · {len(cats)} categories\n", legend]
        lines.append("**Categories:** " + " · ".join(f"[{c}](#{anchor(c)})" for c in sorted(cats)) + "\n")
        for c in sorted(cats):
            lines.append(f"## {c}\n")
            lines.append("| Project | Repo | ⭐ | License | Business angle |")
            lines.append("|---|---|---:|---|---|")
            for r in sorted(cats[c], key=lambda r: -r["stars"]):
                arch = " 📦" if r["archived"] else ""
                ang = r["angle"].replace("|", "/")
                lines.append(f"| {r['name']}{arch} | [{r['slug']}](https://github.com/{r['slug']}) | {stars(r['stars'])} | {r['tier']} {r['license']} | {ang} |")
            lines.append("")
        open(os.path.join(OUT, key + ".md"), "w").write("\n".join(lines))

    with open(os.path.join(OUT, "catalog.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sector", "category", "project", "repo", "url", "stars", "license", "archived", "last_push", "business_angle"])
        for r in sorted(good, key=lambda r: (r["sector"], r["category"], -r["stars"])):
            w.writerow([dict(SECTORS)[r["sector"]], r["category"], r["name"], r["slug"],
                        "https://github.com/" + r["slug"], r["stars"], r["license"], r["archived"], r["pushed"], r["angle"]])

    n_stores, n_store_cats = render_stores(today, legend)
    n_rs, n_rs_cats = render_resell()
    index_path = os.path.join(OUT, "README.md")
    txt = open(index_path).read().replace(
        "\nAlso: [`catalog.csv`]",
        f"| [Store Concepts (e-commerce niches)](stores.md) | {n_store_cats} | {n_stores} store ideas |\n"
        f"| [White-Label & Reseller Businesses](resell.md) | {n_rs_cats} | {n_rs} ideas |\n"
        "\nAlso: [`catalog.csv`]")
    txt = txt.replace("(catalog.csv), all entries", "(catalog.csv), [`stores.csv`](stores.csv) and [`resell.csv`](resell.csv), all entries")
    open(index_path, "w").write(txt)

    lic = collections.Counter(r["tier"] for r in good)
    print(f"rows={len(rows)} verified={len(good)} dropped={len(dropped)} "
          f"categories={sum(len(c) for c in by_sector.values())} tiers={dict(lic)}")
    with open(os.path.join(SCRATCH, "dropped.tsv"), "w") as f:
        for r in dropped:
            f.write(f"{r['sector']}\t{r['category']}\t{r['name']}\t{r['slug']}\n")


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


def render_resell():
    path = os.path.join(RAW, "resell.tsv")
    if not os.path.exists(path):
        return 0, 0
    rows, seen = [], set()
    for line in open(path, encoding="utf-8"):
        p = [x.strip() for x in line.rstrip("\n").split("\t")]
        if len(p) < 7 or p[1].lower() in seen:
            continue
        seen.add(p[1].lower())
        stack = [s.strip().replace("https://github.com/", "").strip("/") for s in p[4].split(",")
                 if "/" in s]
        rows.append(dict(category=p[0], idea=p[1], what=p[2], supply=p[3], stack=stack,
                         revenue=p[5], cost=p[6]))
    cache = fetch(sorted({s for r in rows for s in r["stack"]}))
    bad = 0
    for r in rows:
        ok = []
        for s in r["stack"]:
            info = cache.get(s.lower())
            if info:
                ok.append(info["nameWithOwner"])
            else:
                bad += 1
        r["stack"] = ok
    cats = collections.defaultdict(list)
    for r in rows:
        cats[r["category"]].append(r)
    costs = collections.Counter(r["cost"] for r in rows)
    L = [f"# White-Label & Reseller Businesses: {len(rows)} Ideas\n",
         f"[← back to index](README.md) · {len(rows)} ideas · {len(cats)} categories\n",
         "Businesses where you sell someone else's product, service or inventory under your own brand, "
         "plus open-source software that could run the operation (every repo linked here was checked against GitHub). "
         "Supply sources are starting points for research. Check current partner terms yourself. "
         "Categories marked *license required* (insurance, lending, travel, health, etc.) need permits in most countries.\n",
         "**Startup cost:** " + " · ".join(f"{k} ({v})" for k, v in costs.most_common()) + "\n",
         "**Categories:** " + " · ".join(f"[{c}](#{anchor(c)})" for c in sorted(cats)) + "\n"]
    for c in sorted(cats):
        L.append(f"## {c}\n")
        L.append("| Business idea | What you resell | Supply sources | Open-source stack | Revenue model | Cost |")
        L.append("|---|---|---|---|---|---|")
        for r in cats[c]:
            stack = ", ".join(f"[{s}](https://github.com/{s})" for s in r["stack"]) or "-"
            cells = [r["idea"], r["what"], r["supply"], stack, r["revenue"], r["cost"]]
            L.append("| " + " | ".join(x.replace("|", "/") for x in cells) + " |")
        L.append("")
    open(os.path.join(OUT, "resell.md"), "w").write("\n".join(L))
    with open(os.path.join(OUT, "resell.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["category", "business_idea", "what_you_resell", "supply_sources", "open_source_stack",
                    "revenue_model", "startup_cost"])
        for r in sorted(rows, key=lambda r: r["category"]):
            w.writerow([r["category"], r["idea"], r["what"], r["supply"],
                        " ".join("https://github.com/" + s for s in r["stack"]), r["revenue"], r["cost"]])
    print(f"resell={len(rows)} resell_categories={len(cats)} stack_repos_dropped={bad}")
    return len(rows), len(cats)


def render_stores(today, legend):
    path = os.path.join(RAW, "stores.tsv")
    if not os.path.exists(path):
        return 0, 0
    cache = fetch([v[1] for v in PLATFORMS.values()])
    rows, seen = [], set()
    for line in open(path, encoding="utf-8"):
        p = [x.strip() for x in line.rstrip("\n").split("\t")]
        if len(p) < 6 or p[1].lower() in seen:
            continue
        seen.add(p[1].lower())
        rows.append(dict(category=p[0], concept=p[1], customer=p[2], model=p[3],
                         platform=p[4].lower().replace("-", "").replace(" ", ""), edge=" ".join(p[5:])))
    cats = collections.defaultdict(list)
    for r in rows:
        cats[r["category"]].append(r)
    plat_count = collections.Counter(r["platform"] for r in rows)
    model_count = collections.Counter(r["model"] for r in rows)

    def plat_link(k):
        if k in PLATFORMS:
            return f"[{PLATFORMS[k][0]}](#platforms)"
        return k

    L = [f"# Store Concepts: {len(rows)} E-Commerce Niches\n",
         f"[← back to index](README.md) · {len(rows)} store ideas · {len(cats)} categories\n",
         "Each concept lists a target customer, a business model and an open-source store platform it fits. "
         "Treat the platform as a starting suggestion: most concepts would run on several of them.\n",
         "## Platforms\n", "| Key | Platform | Repo | ⭐ | License | Best for | Concepts |", "|---|---|---|---:|---|---|---:|"]
    for k, (name, slug, best) in PLATFORMS.items():
        info = cache.get(slug.lower()) or {}
        lic = (info.get("licenseInfo") or {}).get("spdxId") or "?"
        L.append(f"| `{k}` | {name} | [{info.get('nameWithOwner', slug)}](https://github.com/{info.get('nameWithOwner', slug)}) | "
                 f"{stars(info.get('stargazerCount', 0))} | {tier(lic)} {lic} | {best} | {plat_count.get(k, 0)} |")
    L.append("\n**Business models used:** " + " · ".join(f"{m} ({n})" for m, n in model_count.most_common()) + "\n")
    L.append("**Categories:** " + " · ".join(f"[{c}](#{anchor(c)})" for c in sorted(cats)) + "\n")
    for c in sorted(cats):
        L.append(f"## {c}\n")
        L.append("| Store concept | Target customer | Model | Platform | Edge |")
        L.append("|---|---|---|---|---|")
        for r in cats[c]:
            cells = [r["concept"], r["customer"], r["model"], plat_link(r["platform"]), r["edge"]]
            L.append("| " + " | ".join(x.replace("|", "/") for x in cells) + " |")
        L.append("")
    open(os.path.join(OUT, "stores.md"), "w").write("\n".join(L))
    with open(os.path.join(OUT, "stores.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["category", "store_concept", "target_customer", "business_model", "platform", "platform_repo", "edge"])
        for r in sorted(rows, key=lambda r: r["category"]):
            w.writerow([r["category"], r["concept"], r["customer"], r["model"], r["platform"],
                        "https://github.com/" + PLATFORMS[r["platform"]][1] if r["platform"] in PLATFORMS else "", r["edge"]])
    print(f"stores={len(rows)} store_categories={len(cats)} unknown_platforms="
          f"{ {k: v for k, v in plat_count.items() if k not in PLATFORMS} }")
    return len(rows), len(cats)


if __name__ == "__main__":
    main()
