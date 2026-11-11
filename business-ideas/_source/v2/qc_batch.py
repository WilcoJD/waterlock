#!/usr/bin/env python3
"""QC an enrichment batch: structure, completeness and per-repo specificity.
Usage: qc_batch.py NN   (checks batches/batch_NN.tsv vs enriched/batch_NN.tsv)"""
import sys, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
nn = sys.argv[1]
inp = [l.rstrip("\n").split("\t") for l in open(os.path.join(HERE, "batches", f"batch_{nn}.tsv"), encoding="utf-8") if l.strip()]
outp = os.path.join(HERE, "enriched", f"batch_{nn}.tsv")
if not os.path.exists(outp):
    print(f"batch {nn}: MISSING"); sys.exit(1)
out = [l.rstrip("\n").split("\t") for l in open(outp, encoding="utf-8") if l.strip()]
bad_cols = sum(1 for r in out if len(r) != 13)
in_slugs = {r[0].lower() for r in inp}
out_slugs = collections.Counter(r[0].lower() for r in out)
missing = in_slugs - set(out_slugs)
extra = set(out_slugs) - in_slugs
dups = [s for s, n in out_slugs.items() if n > 1]
def uniq(i):
    vals = [r[i] for r in out if len(r) > i]
    return len(set(vals)) / max(1, len(vals))
fits = collections.Counter(r[1] for r in out if len(r) > 1)
u_cust, u_niche, u_price, u_what = uniq(5), uniq(7), uniq(8), uniq(3)
ok = bad_cols == 0 and not missing and not extra and not dups and u_niche >= 0.8 and u_cust >= 0.5
print(f"batch {nn}: {'OK' if ok else 'FAIL'} lines={len(out)}/{len(inp)} badcols={bad_cols} missing={len(missing)} extra={len(extra)} dups={len(dups)} "
      f"uniq what={u_what:.0%} customers={u_cust:.0%} niches={u_niche:.0%} pricing={u_price:.0%} fits={dict(sorted(fits.items()))}")
if missing and len(missing) <= 10: print("  missing:", sorted(missing))
sys.exit(0 if ok else 1)
