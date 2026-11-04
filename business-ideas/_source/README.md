# Catalog source

- `raw/*.tsv`: hand-editable source lists (one per sector). Add, remove or rewrite rows here.
- `build.py`: confirms every repo on GitHub, then regenerates the markdown pages and CSVs in `business-ideas/`.

```
python3 business-ideas/_source/build.py
```

Project rows: `category<TAB>project<TAB>owner/repo<TAB>business angle`.
Store rows: `category<TAB>concept<TAB>customer<TAB>model<TAB>platform<TAB>edge`.
Reseller rows: `category<TAB>idea<TAB>what you resell<TAB>supply<TAB>repos<TAB>revenue<TAB>cost`.
