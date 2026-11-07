#!/usr/bin/env python3
"""Render the whole business-ideas catalog into a single PDF via Chromium."""
import csv, collections, html, subprocess, sys, os

SRC = sys.argv[1]          # business-ideas dir
OUT_HTML = sys.argv[2]
OUT_PDF = sys.argv[3]
e = html.escape

SECTORS = ["Hosting, Infrastructure & DevOps", "Business Software & Vertical SaaS",
           "Websites, Content, Commerce & Community", "Media, AI, Data & Automation",
           "Games, Game Tech & Entertainment", "Mobile, Consumer Apps & Vertical Platforms",
           "Open Hardware, Physical Products & Designs", "Traditional Industries & Local Businesses"]
PERM = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense", "0BSD",
        "CC0-1.0", "BSL-1.0", "MIT-0", "Artistic-2.0", "PostgreSQL", "WTFPL", "NCSA"}
WEAK = {"MPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-2.0", "EPL-1.0", "EUPL-1.2", "CDDL-1.0", "OSL-3.0"}


def tier(l):
    if l in PERM: return "perm", "Permissive"
    if l in WEAK: return "weak", "Weak copyleft"
    if l in {"GPL-2.0", "GPL-3.0"}: return "gpl", "GPL"
    if l == "AGPL-3.0": return "agpl", "AGPL"
    return "other", "Check"


def stars(s):
    n = int(s)
    if n < 0: return "?"
    return f"{n/1000:.1f}k" if n >= 1000 else str(n)


def slug(*p):
    return "s-" + "".join(c if c.isalnum() else "-" for c in "-".join(p).lower())


cat = list(csv.DictReader(open(os.path.join(SRC, "catalog.csv"), encoding="utf-8")))
stores = list(csv.DictReader(open(os.path.join(SRC, "stores.csv"), encoding="utf-8")))
resell = list(csv.DictReader(open(os.path.join(SRC, "resell.csv"), encoding="utf-8")))

by = collections.OrderedDict((s, collections.defaultdict(list)) for s in SECTORS)
for r in cat:
    by[r["sector"]][r["category"]].append(r)
st = collections.defaultdict(list)
for r in stores: st[r["category"]].append(r)
rs = collections.defaultdict(list)
for r in resell: rs[r["category"]].append(r)

tiers = collections.Counter(tier(r["license"])[0] for r in cat)
n_cats = sum(len(v) for v in by.values()) + len(st) + len(rs)
total = len(cat) + len(stores) + len(resell)
date = max(r["last_push"][:10] for r in cat if r["last_push"]) or ""

H = []
w = H.append
w("""<!doctype html><html><head><meta charset="utf-8"><title>Open-Source White-Label Business Catalog</title><style>
@page { size: A4 landscape; margin: 12mm 11mm 13mm 11mm; }
* { box-sizing: border-box; }
body { font-family: 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif; font-size: 7.6pt; color: #1d2330; margin: 0; }
a { color: #1f5fbf; text-decoration: none; }
h1 { font-size: 30pt; margin: 0 0 6mm; letter-spacing: -0.5pt; }
h2.sector { font-size: 19pt; margin: 0 0 2mm; color: #0f2a52; page-break-before: always; border-bottom: 2.5pt solid #0f2a52; padding-bottom: 2mm; }
h3 { font-size: 10.5pt; margin: 5mm 0 1.5mm; color: #0f2a52; page-break-after: avoid; break-after: avoid; }
h3 .n { color: #8a93a3; font-weight: normal; font-size: 8.5pt; }
p.lead { font-size: 8.5pt; color: #4a5263; margin: 0 0 3mm; max-width: 230mm; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th { text-align: left; background: #eef2f8; color: #2c3e5c; font-size: 7pt; padding: 1.3mm 1.6mm; border-bottom: 0.8pt solid #b9c4d6; }
td { padding: 1.1mm 1.6mm; border-bottom: 0.4pt solid #e2e6ee; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
tr:nth-child(even) td { background: #fafbfd; }
td.num { text-align: right; white-space: nowrap; }
.b { display: inline-block; padding: 0.2mm 1.4mm; border-radius: 2mm; font-size: 6.4pt; font-weight: bold; white-space: nowrap; }
.perm { background: #d8f2df; color: #146c2e; } .weak { background: #fdf0c4; color: #7a5a00; }
.gpl { background: #fde0c8; color: #8a3f00; } .agpl { background: #fbd5d5; color: #9b1c1c; }
.other { background: #e7e9ee; color: #4a5263; }
.arch { font-size: 6.2pt; color: #8a3f00; font-weight: bold; }
.cover { height: 180mm; display: flex; flex-direction: column; justify-content: center; padding: 0 10mm; }
.cover .sub { font-size: 13pt; color: #4a5263; margin-bottom: 10mm; max-width: 220mm; line-height: 1.4; }
.stats { display: flex; gap: 6mm; flex-wrap: wrap; }
.stat { border: 0.8pt solid #c9d2e1; border-radius: 2mm; padding: 4mm 6mm; min-width: 45mm; }
.stat b { display: block; font-size: 20pt; color: #0f2a52; }
.stat span { font-size: 8.5pt; color: #4a5263; }
.intro { page-break-before: always; font-size: 9pt; line-height: 1.45; columns: 2; column-gap: 10mm; }
.intro h2 { font-size: 13pt; color: #0f2a52; margin: 0 0 2mm; break-after: avoid; }
.intro div { break-inside: avoid; margin-bottom: 5mm; }
.intro li { margin-bottom: 1mm; }
.toc { page-break-before: always; columns: 3; column-gap: 8mm; font-size: 7.4pt; }
.toc h2 { column-span: all; font-size: 16pt; color: #0f2a52; margin: 0 0 3mm; }
.toc .sec { font-weight: bold; font-size: 8.6pt; margin: 3mm 0 1mm; break-after: avoid; color: #0f2a52; }
.toc .c { display: flex; justify-content: space-between; border-bottom: 0.3pt dotted #c9d2e1; padding: 0.3mm 0; break-inside: avoid; }
.toc .c span { color: #8a93a3; }
.plat td { font-size: 7.4pt; }
</style></head><body>""")

# Cover
w(f"""<section class="cover"><h1>Open-Source White-Label<br>Business Catalog</h1>
<div class="sub">Open-source projects you can self-host, rebrand and sell, plus online store concepts and white-label / reseller
business models. Every project links to a GitHub repository confirmed to exist (data as of {e(date)}).</div>
<div class="stats">
<div class="stat"><b>{total:,}</b><span>ideas in total</span></div>
<div class="stat"><b>{n_cats}</b><span>categories</span></div>
<div class="stat"><b>{len(cat):,}</b><span>open-source projects</span></div>
<div class="stat"><b>{len(stores):,}</b><span>store concepts</span></div>
<div class="stat"><b>{len(resell):,}</b><span>white-label / reseller ideas</span></div>
</div></section>""")

# Intro
w(f"""<section class="intro">
<div><h2>What's inside</h2><ul>
{''.join(f'<li><a href="#{slug(s)}">{e(s)}</a>: {sum(len(v) for v in by[s].values())} projects, {len(by[s])} categories</li>' for s in SECTORS)}
<li><a href="#s-stores">Online Store Concepts</a>: {len(stores):,} store ideas, {len(st)} categories</li>
<li><a href="#s-resell">White-Label &amp; Reseller Businesses</a>: {len(resell):,} ideas, {len(rs)} categories</li>
</ul></div>
<div><h2>License key: what you're allowed to do</h2><ul>
<li><span class="b perm">Permissive</span> MIT / Apache / BSD: rebrand and sell freely, keep the copyright notice. ({tiers['perm']:,} projects)</li>
<li><span class="b weak">Weak copyleft</span> MPL / LGPL: share changes you make to <i>their</i> files. ({tiers['weak']:,})</li>
<li><span class="b gpl">GPL</span> fine to run as a hosted service; apps you distribute must ship their source. ({tiers['gpl']:,})</li>
<li><span class="b agpl">AGPL</span> if people use your hosted version, you must offer them your modified source. ({tiers['agpl']:,})</li>
<li><span class="b other">Check</span> custom, dual, source-available or no license detected: read it before building a business. ({tiers['other']:,})</li>
</ul>
<p><span class="arch">ARCHIVED</span> means the repo is no longer maintained: fork it or pick another. ⭐ "?" means GitHub search didn't return stats.
Not legal advice. Trademarks and logos are never covered by open-source licenses, so always rebrand.</p></div>
<div><h2>How to turn one into a business</h2><ol>
<li>Pick a category, then a Permissive or Weak-copyleft project for the most freedom (GPL/AGPL are fine if you host it and publish your changes).</li>
<li>Go niche. The generic version already exists; the money is in "X for dentists", "X for churches", "X in Portuguese".</li>
<li>Rebrand (name, logo, domain, colours), then add onboarding, billing and support. That is the product.</li>
<li>Models that work again and again: managed hosting · white-label reseller for agencies · vertical SaaS · setup + support retainers · a mobile app on top of the open-source backend.</li>
</ol></div>
<div><h2>Before you rely on an entry</h2><ul>
<li>Hardware designs with non-commercial terms are flagged in their business angle. Get permission before selling them.</li>
<li>Reseller supply sources are starting points: check each provider's current partner terms.</li>
<li>Insurance, lending, travel, health and similar ideas usually need a license or registration.</li>
<li>Some projects appear in more than one category, each with a different angle.</li>
</ul></div>
</section>""")

# TOC
w('<section class="toc"><h2>Contents</h2>')
for s in SECTORS:
    w(f'<div class="sec"><a href="#{slug(s)}">{e(s)}</a></div>')
    for c in sorted(by[s]):
        w(f'<div class="c"><a href="#{slug(s, c)}">{e(c)}</a><span>{len(by[s][c])}</span></div>')
w('<div class="sec"><a href="#s-stores">Online Store Concepts</a></div>')
for c in sorted(st):
    w(f'<div class="c"><a href="#{slug("st", c)}">{e(c)}</a><span>{len(st[c])}</span></div>')
w('<div class="sec"><a href="#s-resell">White-Label &amp; Reseller Businesses</a></div>')
for c in sorted(rs):
    w(f'<div class="c"><a href="#{slug("rs", c)}">{e(c)}</a><span>{len(rs[c])}</span></div>')
w('</section>')

# Project sectors
COLS = '<colgroup><col style="width:17%"><col style="width:22%"><col style="width:6%"><col style="width:16%"><col style="width:39%"></colgroup>'
for s in SECTORS:
    cats = by[s]
    w(f'<h2 class="sector" id="{slug(s)}">{e(s)}</h2><p class="lead">{sum(len(v) for v in cats.values())} projects in {len(cats)} categories, sorted by GitHub stars.</p>')
    for c in sorted(cats):
        w(f'<h3 id="{slug(s, c)}">{e(c)} <span class="n">· {len(cats[c])}</span></h3>')
        w(f'<table>{COLS}<thead><tr><th>Project</th><th>Repository</th><th>Stars</th><th>License</th><th>Business angle</th></tr></thead><tbody>')
        for r in sorted(cats[c], key=lambda r: -int(r["stars"])):
            cls, lab = tier(r["license"])
            arch = ' <span class="arch">ARCHIVED</span>' if r["archived"] == "True" else ""
            w(f'<tr><td><b>{e(r["project"])}</b>{arch}</td><td><a href="{e(r["url"])}">{e(r["repo"])}</a></td>'
              f'<td class="num">{stars(r["stars"])}</td><td><span class="b {cls}">{lab}</span> {e(r["license"])}</td>'
              f'<td>{e(r["business_angle"])}</td></tr>')
        w('</tbody></table>')

# Stores
plat = collections.Counter(r["platform"] for r in stores)
models = collections.Counter(r["business_model"] for r in stores)
prepo = {r["platform"]: r["platform_repo"] for r in stores}
w(f'<h2 class="sector" id="s-stores">Online Store Concepts</h2><p class="lead">{len(stores):,} store ideas in {len(st)} categories. '
  'Each lists a target customer, a business model and an open-source store platform it fits (most would run on several).</p>')
w('<h3>Platforms</h3><table class="plat"><colgroup><col style="width:20%"><col style="width:60%"><col style="width:20%"></colgroup>'
  '<thead><tr><th>Platform key</th><th>Repository</th><th>Concepts using it</th></tr></thead><tbody>')
for k, n in plat.most_common():
    u = prepo.get(k, "")
    w(f'<tr><td><b>{e(k)}</b></td><td><a href="{e(u)}">{e(u.replace("https://github.com/", ""))}</a></td><td class="num">{n}</td></tr>')
w('</tbody></table>')
w('<p class="lead" style="margin-top:3mm"><b>Business models:</b> ' + " · ".join(f"{e(m)} ({n})" for m, n in models.most_common()) + '</p>')
SCOLS = '<colgroup><col style="width:24%"><col style="width:18%"><col style="width:13%"><col style="width:9%"><col style="width:36%"></colgroup>'
for c in sorted(st):
    w(f'<h3 id="{slug("st", c)}">{e(c)} <span class="n">· {len(st[c])}</span></h3>')
    w(f'<table>{SCOLS}<thead><tr><th>Store concept</th><th>Target customer</th><th>Model</th><th>Platform</th><th>Edge</th></tr></thead><tbody>')
    for r in st[c]:
        pl = f'<a href="{e(r["platform_repo"])}">{e(r["platform"])}</a>' if r["platform_repo"] else e(r["platform"])
        w(f'<tr><td><b>{e(r["store_concept"])}</b></td><td>{e(r["target_customer"])}</td><td>{e(r["business_model"])}</td><td>{pl}</td><td>{e(r["edge"])}</td></tr>')
    w('</tbody></table>')

# Resell
costs = collections.Counter(r["startup_cost"] for r in resell)
w(f'<h2 class="sector" id="s-resell">White-Label &amp; Reseller Businesses</h2><p class="lead">{len(resell):,} ideas in {len(rs)} categories: '
  "businesses where you sell someone else's product, service or inventory under your own brand, plus open-source software that could run it. "
  'Startup cost: ' + " · ".join(f"{e(k)} ({v})" for k, v in costs.most_common()) + '.</p>')
RCOLS = '<colgroup><col style="width:19%"><col style="width:17%"><col style="width:19%"><col style="width:17%"><col style="width:21%"><col style="width:7%"></colgroup>'
for c in sorted(rs):
    w(f'<h3 id="{slug("rs", c)}">{e(c)} <span class="n">· {len(rs[c])}</span></h3>')
    w(f'<table>{RCOLS}<thead><tr><th>Business idea</th><th>What you resell</th><th>Supply sources</th><th>Open-source stack</th><th>Revenue model</th><th>Cost</th></tr></thead><tbody>')
    for r in rs[c]:
        stack = ", ".join(f'<a href="{e(u)}">{e(u.replace("https://github.com/", ""))}</a>' for u in r["open_source_stack"].split()) or "-"
        w(f'<tr><td><b>{e(r["business_idea"])}</b></td><td>{e(r["what_you_resell"])}</td><td>{e(r["supply_sources"])}</td>'
          f'<td>{stack}</td><td>{e(r["revenue_model"])}</td><td>{e(r["startup_cost"])}</td></tr>')
    w('</tbody></table>')
w('</body></html>')
open(OUT_HTML, "w", encoding="utf-8").write("\n".join(H))
print("html written", total, "rows")
