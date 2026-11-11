# Catalog source

## v2 (current catalog)
- `v2/queries.txt`: 658 categories × GitHub search queries used to discover candidate repos (`v2/discover.py`).
- `v2/repo_info.json.gz`: GitHub metadata (stars, license, archived, description) for every repo seen; `v2/discovered_rows.json`: category → repo assignments from discovery.
- `v2/batches/*.tsv`: the repos sent for enrichment (slug, stars, license, sector, category, description, curated notes).
- `v2/enriched/*.tsv`: the enrichment, one 13-column line per repo: slug, fit 1-5, type, what it does, replaces, ideal customers, business models, niche ideas, pricing idea, white-label effort, effort reason, gotchas, category fix.
- `v2/out/stores_*.tsv` (10 columns) and `v2/out/resell_*.tsv` (11 columns): store concepts and white-label/reseller ideas.
- `raw/*.tsv`: the original hand-curated project lists (category, project, owner/repo, business angle); these rows keep their category memberships in the catalog.

Rebuild everything (needs `gh` with search access, Playwright + Chromium, pypdf, reportlab, pdftotext):
```
python3 business-ideas/_source/v2/build2.py business-ideas            # pages + CSVs + HTML sections
python3 business-ideas/_source/v2/assemble_pdf.py business-ideas/Open-Source-White-Label-Business-Catalog.pdf
```
(The scripts expect to run from a working copy that has `repo_info.json` unzipped next to them, and `batches/`, `enriched/`, `out/` as laid out here.)

## v1 (superseded)
`build.py` + `make_pdf.py` + `render.js` built the first, one-line-per-project edition from `raw/*.tsv`.
