#!/usr/bin/env python3
"""Discover candidate repos per category via the GitHub search API (the only
GitHub endpoint this session can reach for repos outside the session).

Writes v2/repo_info.json  (slug lower -> metadata, for curated + discovered)
       v2/discovered.json (category rows: sector, category, slug) + progress.
Resumable: re-running skips queries already done.
"""
import json, os, re, subprocess, sys, time, glob

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = "/home/user/waterlock/business-ideas/_source/raw"
INFO = os.path.join(HERE, "repo_info.json")
STATE = os.path.join(HERE, "discovered.json")
LOG = os.path.join(HERE, "discover.log")
PROJECT_SECTORS = ["hosting", "business", "web", "media_ai", "games", "mobile", "hardware", "industries"]
NOISE = re.compile(r"\b(awesome|curated|tutorials?|interview|roadmap|cheat ?sheets?|leetcode|dotfiles|"
                   r"learning path|study guide|exercises|homework|coursework|my (personal )?(portfolio|website|blog)|"
                   r"collection of|list of|examples? (of|for)|sample (app|project|code)|demo (app|project)|"
                   r"interview questions|coding challenges?|practice problems)\b", re.I)
NO_PUSHED_FILTER = {"hardware", "games", "industries"}

info = json.load(open(INFO)) if os.path.exists(INFO) else {}
state = json.load(open(STATE)) if os.path.exists(STATE) else {"done": [], "rows": [], "assigned": {}}
done = set(state["done"])
assigned = state["assigned"]          # slug lower -> "sector|category"
rows = state["rows"]


def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%H:%M:%S ") + msg + "\n")


def save():
    json.dump(info, open(INFO + ".tmp", "w")); os.replace(INFO + ".tmp", INFO)
    state["done"] = sorted(done)
    json.dump(state, open(STATE + ".tmp", "w")); os.replace(STATE + ".tmp", STATE)


def rec(it):
    return {"nameWithOwner": it["full_name"], "stargazerCount": it["stargazers_count"],
            "isArchived": it["archived"], "pushedAt": it["pushed_at"], "fork": it.get("fork", False),
            "licenseInfo": {"spdxId": (it.get("license") or {}).get("spdx_id")},
            "description": (it.get("description") or "")[:260], "language": it.get("language") or "",
            "topics": (it.get("topics") or [])[:12], "homepage": it.get("homepage") or ""}


def search(q, page=1):
    for attempt in range(6):
        p = subprocess.run(["gh", "api", "-X", "GET", "search/repositories", "-f", "q=" + q,
                            "-f", "per_page=100", "-f", f"page={page}", "-f", "sort=stars", "-f", "order=desc"],
                           capture_output=True, text=True)
        if p.returncode == 0:
            try:
                return json.loads(p.stdout)
            except json.JSONDecodeError:
                return None
        err = (p.stderr or "")[:200]
        if "422" in err or "Validation Failed" in err or "Unprocessable" in err:
            log(f"422 {q}: {err}"); return None
        wait = 65 if ("403" in err or "429" in err or "rate limit" in err.lower()) else 10
        log(f"retry {attempt} ({wait}s) {q}: {err}")
        time.sleep(wait)
    return None


def curated():
    """Fetch metadata (incl. description) for every curated slug not yet in repo_info."""
    slugs = []
    for s in PROJECT_SECTORS:
        for line in open(os.path.join(RAW, s + ".tsv"), encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 4 and re.fullmatch(r"[\w.-]+/[\w.-]+", p[2].strip()):
                slugs.append(p[2].strip())
    slugs = sorted({s for s in slugs if s.lower() not in info or "description" not in info[s.lower()]})
    log(f"curated: {len(slugs)} slugs to fetch")
    i = 0
    while i < len(slugs):
        batch, length = [], 0
        while i < len(slugs) and len(batch) < 40 and length + len(slugs[i]) < 1050:
            batch.append(slugs[i]); length += len(slugs[i]) + 6; i += 1
        data = search("fork:true " + " ".join("repo:" + s for s in batch))
        items = {it["full_name"].lower(): it for it in (data or {}).get("items", [])}
        for s in batch:
            if s.lower() in items:
                info[s.lower()] = rec(items[s.lower()])
            else:
                info.setdefault(s.lower(), {"nameWithOwner": s, "stargazerCount": -1, "isArchived": False,
                                            "pushedAt": "", "licenseInfo": {"spdxId": None}, "description": "",
                                            "language": "", "topics": [], "homepage": "", "unindexed": True})
        time.sleep(2.2)
    save()


def discover():
    lines = [l.rstrip("\n") for l in open(os.path.join(HERE, "queries.txt"), encoding="utf-8")
             if l.strip() and not l.startswith("#")]
    total_q = sum(len(l.split("|")[3].split(";;")) for l in lines)
    log(f"discover: {len(lines)} categories, {total_q} queries")
    cat_counts = {}
    for r in rows:
        cat_counts[r[0] + "|" + r[1]] = cat_counts.get(r[0] + "|" + r[1], 0) + 1
    nq = 0
    for line in lines:
        sector, cat, min_stars, qs = line.split("|", 3)
        key = sector + "|" + cat
        for q in qs.split(";;"):
            if cat_counts.get(key, 0) >= 40:
                break
            qual = f"{q.strip()} stars:>={min_stars} archived:false"
            if sector not in NO_PUSHED_FILTER:
                qual += " pushed:>2023-06-01"
            qid = key + "||" + qual
            if qid in done:
                continue
            data = search(qual)
            nq += 1
            items = (data or {}).get("items", [])
            added = 0
            for it in items:
                slug = it["full_name"]
                low = slug.lower()
                text = slug + " " + (it.get("description") or "")
                if NOISE.search(text) or slug.split("/")[1].lower().startswith("awesome"):
                    continue
                if low not in info or "description" not in info[low]:
                    info[low] = rec(it)
                if low in assigned:
                    continue
                assigned[low] = key
                rows.append([sector, cat, slug])
                cat_counts[key] = cat_counts.get(key, 0) + 1
                added += 1
            done.add(qid)
            log(f"[{nq}] {key} <- {qual!r}: {len(items)} results, +{added} (cat total {cat_counts.get(key, 0)})")
            if nq % 10 == 0:
                save()
            time.sleep(0.4)
    save()
    log(f"discover done: {len(rows)} assigned rows, {len(info)} repos known")


if __name__ == "__main__":
    curated()
    discover()
    print("done", len(rows), "rows", len(info), "repos")
