#!/usr/bin/env python3
"""One-off migration: turn src/pages/*.html (token HTML + META) into content/seed/pages/*.json.
Each top-level <section> of the body becomes a section of type "html" with tokens expanded."""
import importlib.util, json, re, sys
from pathlib import Path
HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("build", HERE / "build.py"); build = importlib.util.module_from_spec(spec); spec.loader.exec_module(build)
OUT = HERE.parent / "content" / "seed" / "pages"; OUT.mkdir(parents=True, exist_ok=True)
NAV = {h: (i, s) for i, (h, s, _l) in enumerate(build.NAV)}
FOOT = {h for h, _l in build.FOOTER_MORE}
for f in sorted((HERE / "pages").glob("*.html")):
    raw = f.read_text(encoding="utf-8")
    m = re.match(r"\s*<!--META\s*(.*?)\s*META-->\s*", raw, re.S)
    meta = json.loads(m.group(1)); body = build.render_body(raw[m.end():]).strip()
    # split into top-level sections
    parts = re.findall(r"<section\b.*?</section>", body, re.S)
    rest = re.sub(r"<section\b.*?</section>", "", body, flags=re.S).strip()
    assert not rest, f"{f.name}: non-section content left over: {rest[:80]}"
    slug = f.stem
    page = {
        "slug": slug, "kind": "system" if slug == "404" else "page", "status": "published",
        "title": meta["title"].split(" | ")[0], "nav_label": NAV.get(f.name, (None, None))[1], "in_nav": 1 if f.name in NAV else 0,
        "nav_order": (NAV[f.name][0] + 1) * 10 if f.name in NAV else 100, "in_footer": 1 if (f.name in NAV or f.name in FOOT) else 0,
        "meta": {"title": meta["title"], "description": meta["description"], "canonical": "", "og_image": meta.get("og_image", "exterior-700.jpg"),
                 "og_alt": meta.get("og_alt", ""), "noindex": bool(meta.get("noindex")), "jsonld": meta.get("jsonld")},
        "hero": None, "sections": [{"type": "html", "html": s} for s in parts], "event": None,
    }
    (OUT / f"{slug}.json").write_text(json.dumps(page, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{slug}: {len(parts)} sections")
