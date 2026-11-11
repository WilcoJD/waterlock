#!/usr/bin/env python3
"""Prepare resumable inputs for enrichment batches and stores/resell expansion agents.
Usage: prep_resume.py enrich NN [NN ...]   -> batches/batch_NN.rem.tsv + enriched/prompt_NN.txt
       prep_resume.py creative            -> in/stores_N.resume.txt, in/resell_N.resume.txt
"""
import os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
BRIEF = open(os.path.join(HERE, "enrich_brief.txt")).read()

STORE_NEW = {
    1: ["Automotive Detailing & Car Care", "Home Fitness & Recovery", "Smart Home Accessories", "Baby Food & Weaning",
        "Houseplant Accessories", "Left-Handed & Adaptive Products", "Tea Ceremony & Matcha", "Hot Sauce & Condiments"],
    2: ["Board Games & Puzzles", "Model Kits & Miniatures", "Cosplay & Costume", "K-Beauty & J-Beauty",
        "Men's Jewelry & Accessories", "Modest Fashion", "Workwear & Uniforms (B2B)", "Restaurant & Cafe Supply (B2B)"],
    3: ["Camping Cookware & Field Kitchen", "Overlanding & 4x4", "Handmade Fishing Lures & Flies", "Archery",
        "Climbing & Bouldering", "Skateboarding", "Surf & Wetsuits", "Equestrian Tack & Rider Wear"],
    4: ["Vinyl & Vintage Audio Care", "Mechanical Keyboards & Desk Setup", "Retro Gaming Accessories", "Maker Electronics Kits",
        "Astronomy & Stargazing Gear", "Ham Radio & Mesh Devices", "Drone Parts & FPV", "3D Printing Filament & Parts"],
    5: ["Local Farm Boxes & CSA", "Specialty Flour, Grains & Baking", "Fermentation Supplies", "Home Brewing & Winemaking Kits",
        "Cheese & Dairy Making", "Mushroom Growing Kits", "Beekeeping Supplies", "Backyard Chickens & Homesteading",
        "Halal & Kosher Specialty", "Regional Diaspora Groceries"],
}
RESELL_NEW = {
    1: ["Reselling Cloud GPU & AI Compute", "White-Label AI Agents & Chatbots", "Reselling Coworking & Meeting Rooms",
        "White-Label Meal Plans & Nutrition", "Reselling Parking & Storage Space", "White-Label Pet Services",
        "Reselling Print & Packaging Capacity", "White-Label Home Inspection & Energy Audits"],
    2: ["White-Label Cybersecurity Services", "Reselling Satellite & Rural Internet", "White-Label Fleet Telematics",
        "Reselling Event Spaces & Venues", "White-Label Language & Translation Services", "Reselling Farm Produce & Agri Inputs",
        "White-Label Senior Care & Concierge", "Reselling Education Seats (Bootcamps, Exam Prep, Study Abroad)"],
    3: ["Franchise-Style Micro-Businesses (coffee carts, kiosks, vending routes)", "White-Label Fintech Cards & Wallets (BaaS)",
        "Reselling Freight, Container & Courier Capacity", "White-Label Drone & Aerial Services",
        "Reselling Medical Tourism & Dental Travel", "White-Label Sports & Camps Programs",
        "Reselling Music, Stock Media & Licensing", "White-Label Legal & Company Formation Services"],
}


def rows(path, ncols):
    out = []
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= ncols - 1 and p[0].strip():
                out.append(p)
    return out


def enrich(nn):
    inp = rows(os.path.join(HERE, "batches", f"batch_{nn}.tsv"), 7)
    outp = os.path.join(HERE, "enriched", f"batch_{nn}.tsv")
    done = {p[0].lower() for p in rows(outp, 13) if len(p) == 13}
    rem = [p for p in inp if p[0].lower() not in done]
    rem_path = os.path.join(HERE, "batches", f"batch_{nn}.rem.tsv")
    with open(rem_path, "w", encoding="utf-8") as f:
        for p in rem:
            f.write("\t".join(p) + "\n")
    tmp = os.path.join(HERE, "enriched", f"tmp_{nn}") + "/"
    if done:
        brief = BRIEF.replace("Input file: {IN}", f"Input file: {rem_path} (these are the repos STILL TO DO; {len(done)} other repos of this batch are already finished in the output file)")
        brief = brief.replace("Write the output to {OUT} with heredoc appends",
                              f"APPEND to the existing output file {outp} (it already has {len(done)} finished lines; never rewrite or truncate it) with heredoc appends")
        brief = brief.replace("  wc -l < {OUT}                            -> must equal wc -l < {IN}\n", "")
        brief = brief.replace("  diff <(cut -f1 {IN} | sort) <(cut -f1 {OUT} | sort)   -> must be empty (every slug exactly once)",
                              "  comm -23 <(cut -f1 {IN} | sort) <(cut -f1 {OUT} | sort)   -> must be empty (every remaining slug now present)\n  cut -f1 {OUT} | sort | uniq -d   -> must be empty (no slug twice)")
    else:
        brief = BRIEF
    brief = brief.replace("{IN}", rem_path).replace("{OUT}", outp).replace("{TMP}", tmp)
    open(os.path.join(HERE, "enriched", f"prompt_{nn}.txt"), "w").write(brief)
    print(f"batch {nn}: {len(inp)} in, {len(done)} done, {len(rem)} remaining -> prompt_{nn}.txt")


def creative(kind, n, ncols, new_cats, minimum, new_minimum):
    slice_rows = rows(os.path.join(HERE, "in", f"{kind}_{n}.tsv"), 4)
    cats = []
    for p in slice_rows:
        if p[0] not in cats:
            cats.append(p[0])
    existing_all = [l.strip() for l in open(os.path.join(HERE, "in", f"{kind}_all_categories.txt")) if l.strip()]
    out_rows = rows(os.path.join(HERE, "out", f"{kind}_{n}.tsv"), ncols)
    counts = collections.Counter(p[0] for p in out_rows)
    names = collections.defaultdict(list)
    for p in out_rows:
        names[p[0]].append(p[1])
    todo, missing = [], []
    for c in cats:
        if counts.get(c, 0) < minimum:
            (todo if counts.get(c) else missing).append((c, counts.get(c, 0), minimum))
    for c in new_cats:
        target_name = c if c not in existing_all else c
        if counts.get(target_name, 0) < new_minimum:
            (todo if counts.get(target_name) else missing).append((target_name, counts.get(target_name, 0), new_minimum))
    L = [f"STATUS of {kind}_{n}: output file currently has {len(out_rows)} rows in {len(counts)} categories.",
         f"Done categories (>= target rows, leave them alone): " + "; ".join(f"{c} ({counts[c]})" for c in counts if counts[c] >= minimum) or "none", ""]
    L.append(f"NEEDS TOPPING UP ({len(todo)} categories): append new rows until each reaches its target; do NOT repeat the existing concept/idea names listed:")
    for c, have, target in todo:
        L.append(f"- {c}: has {have}, target {target}. Existing names: " + " | ".join(names[c]))
    L.append("")
    L.append(f"MISSING ENTIRELY ({len(missing)} categories): write these in full (target rows shown). The original rows for your slice categories are in the slice file; rewrite them into the new schema first, then add new ones:")
    for c, have, target in missing:
        src = [p for p in slice_rows if p[0] == c]
        L.append(f"- {c}: target {target}" + (f", {len(src)} original rows to upgrade" if src else ", brand-new category"))
    path = os.path.join(HERE, "in", f"{kind}_{n}.resume.txt")
    open(path, "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(f"{kind}_{n}: {len(out_rows)} rows, topup {len(todo)}, missing {len(missing)} -> {os.path.basename(path)}")


if __name__ == "__main__":
    if sys.argv[1] == "enrich":
        for nn in sys.argv[2:]:
            enrich(nn)
    else:
        for n in range(1, 6):
            creative("stores", n, 10, STORE_NEW[n], 35, 25)
        for n in range(1, 4):
            creative("resell", n, 11, RESELL_NEW[n], 30, 20)
