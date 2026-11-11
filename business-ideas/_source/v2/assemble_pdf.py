#!/usr/bin/env python3
"""Render each HTML section to PDF, build a TOC with real page numbers, merge, stamp page numbers.
Usage: assemble_pdf.py FINAL.pdf
"""
import json, os, re, subprocess, sys, io, html
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape

HERE = os.path.dirname(os.path.abspath(__file__))
PDFDIR = os.path.join(HERE, "pdf")
FINAL = sys.argv[1]
meta = json.load(open(os.path.join(PDFDIR, "meta.json")))
CSS = open(os.path.join(HERE, "pdf.css")).read()
e = html.escape


def render(name):
    src, dst = os.path.join(PDFDIR, name + ".html"), os.path.join(PDFDIR, name + ".pdf")
    if not (os.path.exists(dst) and os.path.getmtime(dst) > os.path.getmtime(src)):
        subprocess.run(["node", os.path.join(HERE, "render2.js"), src, dst], check=True)
    return dst


def heading_pages(pdf, key):
    """Find the page index of each category heading ("Name · count") with pdftotext."""
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    pages = [re.sub(r"\s+", " ", pg) for pg in txt.split("\f")]
    found = {}
    for c in meta["cats"][key]:
        pat = re.compile(re.escape(c) + r" ?· ?" + str(meta["counts"][key].get(c, "")) + r"\b")
        for i, pg in enumerate(pages):
            if pat.search(pg):
                found[c] = i
                break
    return found


# 1. render body sections and gather page counts + heading pages
front = render("front")
front_pages = len(PdfReader(front).pages)
sections = []
for key, title in meta["sections"]:
    pdf = render("sec_" + key)
    r = PdfReader(pdf)
    heads = heading_pages(pdf, key)
    sections.append(dict(key=key, title=title, pdf=pdf, n=len(r.pages), heads=heads))
    print(key, len(r.pages), "pages,", len(heads), "/", len(meta["cats"][key]), "headings located", file=sys.stderr)
body_pages = sum(s["n"] for s in sections)


# 2. TOC with page numbers (offset = front + toc pages; iterate once for the toc's own length)
def toc_html(toc_pages):
    off = front_pages + toc_pages
    H = ['<section class="toc"><h2>Contents</h2>']
    start = off
    for s in sections:
        H.append(f'<div class="sec"><span style="color:#0f2a52">{e(s["title"])}</span><span>{start + 1}</span></div>')
        cats = meta["cats"][s["key"]]
        counts = meta["counts"][s["key"]]
        pages = s["heads"]
        for c in cats:
            p = pages.get(c)
            H.append(f'<div class="c"><span style="color:#1d2330">{e(c)} <span>({counts.get(c, "")})</span></span><span>{start + p + 1 if p is not None else ""}</span></div>')
        start += s["n"]
    H.append("</section>")
    return f'<!doctype html><html><head><meta charset="utf-8"><title>Contents</title><style>{CSS}</style></head><body>{"".join(H)}</body></html>'


toc_pages = 6
for _ in range(3):
    open(os.path.join(PDFDIR, "toc.html"), "w", encoding="utf-8").write(toc_html(toc_pages))
    subprocess.run(["node", os.path.join(HERE, "render2.js"), os.path.join(PDFDIR, "toc.html"), os.path.join(PDFDIR, "toc.pdf")], check=True)
    n = len(PdfReader(os.path.join(PDFDIR, "toc.pdf")).pages)
    if n == toc_pages:
        break
    toc_pages = n
print("front", front_pages, "toc", toc_pages, "body", body_pages, file=sys.stderr)

# 3. merge with outlines
w = PdfWriter()
w.append(PdfReader(front), import_outline=False)
w.append(PdfReader(os.path.join(PDFDIR, "toc.pdf")), import_outline=False)
w.add_outline_item("Contents", front_pages)
page_no = front_pages + toc_pages
for s in sections:
    r = PdfReader(s["pdf"])
    w.append(r, import_outline=False)
    parent = w.add_outline_item(s["title"], page_no)
    for c in meta["cats"][s["key"]]:
        if c in s["heads"]:
            w.add_outline_item(c, page_no + s["heads"][c], parent=parent)
    page_no += s["n"]
total = page_no

# 4. stamp page numbers (one overlay PDF with `total` pages)
buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=landscape(A4))
W, Hh = landscape(A4)
for i in range(total):
    c.setFont("Helvetica", 6.5)
    c.setFillGray(0.55)
    c.drawString(28, 16, "Open-Source White-Label Business Catalog")
    c.drawRightString(W - 28, 16, f"{i + 1} / {total}")
    c.showPage()
c.save()
buf.seek(0)
overlay = PdfReader(buf)
for i, pg in enumerate(w.pages):
    if i >= front_pages:          # keep the cover clean
        pg.merge_page(overlay.pages[i])
        pg.compress_content_streams(level=6)
w.compress_identical_objects(remove_identicals=True, remove_orphans=True)
w.add_metadata({"/Title": "Open-Source White-Label Business Catalog", "/Author": "Catalog build"})
with open(FINAL, "wb") as f:
    w.write(f)
print("pages", total, "size MB", round(os.path.getsize(FINAL) / 1e6, 1))
