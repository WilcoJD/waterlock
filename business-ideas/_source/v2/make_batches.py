#!/usr/bin/env python3
"""Build enrichment batches: unique slugs (curated + discovered) grouped by sector."""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = "/home/user/waterlock/business-ideas/_source/raw"
PROJECT_SECTORS = ["hosting", "business", "web", "media_ai", "games", "mobile", "hardware", "industries",
                   "finance", "science", "security", "education", "devtools"]
MODE = sys.argv[1] if len(sys.argv) > 1 else "all"   # curated | discovered | all
BATCH = int(sys.argv[2]) if len(sys.argv) > 2 else 380
START = int(sys.argv[3]) if len(sys.argv) > 3 else 1
CAP, CAP_HI, HI_STARS = 15, 25, 2000

info = json.load(open(os.path.join(HERE, "repo_info.json")))
state = json.load(open(os.path.join(HERE, "discovered.json")))

# curated memberships
curated = collections.OrderedDict()   # slug lower -> dict(sector, category, name, angles)
for s in PROJECT_SECTORS[:8]:
    for line in open(os.path.join(RAW, s + ".tsv"), encoding="utf-8"):
        p = line.rstrip("\n").split("\t")
        if len(p) < 4 or not re.fullmatch(r"[\w.-]+/[\w.-]+", p[2].strip()):
            continue
        low = p[2].strip().lower()
        c = curated.setdefault(low, {"sector": s, "category": p[0], "name": p[1], "angles": []})
        c["angles"].append(p[3])

# discovered: cap per category
by_cat = collections.defaultdict(list)
for sector, cat, slug in state["rows"]:
    if slug.lower() in curated:
        continue
    by_cat[(sector, cat)].append(slug)
keep = collections.OrderedDict()
for (sector, cat), slugs in by_cat.items():
    slugs.sort(key=lambda s: -info[s.lower()]["stargazerCount"])
    n = 0
    for s in slugs:
        st = info[s.lower()]["stargazerCount"]
        if n >= CAP_HI or (n >= CAP and st < HI_STARS):
            break
        keep[s.lower()] = {"sector": sector, "category": cat, "name": s.split("/")[1], "angles": []}
        n += 1

rows = []
items = (list(curated.items()) if MODE in ("curated", "all") else []) + (list(keep.items()) if MODE in ("discovered", "all") else [])
for low, c in items:
    i = info.get(low) or {}
    rows.append((c["sector"], c["category"], i.get("nameWithOwner", low), i.get("stargazerCount", -1),
                 (i.get("licenseInfo") or {}).get("spdxId") or "NONE",
                 (i.get("description") or "").replace("\t", " ").replace("\n", " "),
                 " / ".join(c["angles"])[:300].replace("\t", " ")))
order = {s: n for n, s in enumerate(PROJECT_SECTORS)}
rows.sort(key=lambda r: (order.get(r[0], 99), r[1], -r[3]))

os.makedirs(os.path.join(HERE, "batches"), exist_ok=True)
if MODE == "all":
    for f in os.listdir(os.path.join(HERE, "batches")):
        os.remove(os.path.join(HERE, "batches", f))
manifest = []
for b in range(0, len(rows), BATCH):
    chunk = rows[b:b + BATCH]
    name = f"batch_{START + b // BATCH:02d}.tsv"
    with open(os.path.join(HERE, "batches", name), "w", encoding="utf-8") as f:
        for r in chunk:
            f.write("\t".join([r[2], str(r[3]), r[4], r[0], r[1], r[5], r[6]]) + "\n")
    secs = collections.Counter(r[0] for r in chunk)
    manifest.append((name, len(chunk), dict(secs)))
json.dump({"curated_rows": sum(len(c["angles"]) for c in curated.values()), "curated_unique": len(curated),
           "discovered_kept": len(keep), "discovered_total": len(state["rows"]), "batches": manifest},
          open(os.path.join(HERE, "batches", f"manifest_{MODE}.json"), "w"), indent=1)
print(f"curated unique {len(curated)}, discovered kept {len(keep)} of {len(state['rows'])}, "
      f"total {len(rows)} slugs in {len(manifest)} batches")
for m in manifest:
    print(m)
