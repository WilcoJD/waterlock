#!/usr/bin/env python3
"""Check the built site in public/: tag balance, local links and anchors, images, headings,
title and description lengths, JSON-LD validity.  Usage: python3 -I src/check.py [public_dir]"""
import html as html_mod
import json
import os
import re
import sys
from html.parser import HTMLParser

VOID = {"meta", "link", "img", "br", "hr", "input", "source", "area", "base", "col", "embed", "param", "track", "wbr", "path", "circle", "rect"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors, self.links, self.ids, self.headings, self.imgs = [], [], [], [], [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for k in ("href", "src"):
            if k in a:
                self.links.append(a[k])
        if "srcset" in a:
            self.links += [x.strip().split(" ")[0] for x in a["srcset"].split(",")]
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "img":
            self.imgs.append(a)
        if re.fullmatch(r"h[1-6]", tag):
            self.headings.append(int(tag[1]))
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"unexpected </{tag}> (open: {self.stack[-3:]})")


def main(root):
    problems = 0
    pages = {}
    for name in sorted(os.listdir(root)):
        if not name.endswith(".html"):
            continue
        text = open(os.path.join(root, name), encoding="utf-8").read()
        p = Page()
        p.feed(text)
        pages[name] = p
        issues = list(p.errors)
        if p.stack:
            issues.append(f"unclosed tags at end: {p.stack}")
        for link in p.links:
            if re.match(r"(https?:|mailto:|tel:|#|data:)", link):
                continue
            target = link.lstrip("/").split("#")[0].split("?")[0] or "index.html"
            if not os.path.exists(os.path.join(root, target)):
                issues.append(f"missing local file: {link}")
        for img in p.imgs:
            if "alt" not in img:
                issues.append(f"img without alt: {img.get('src')}")
            if "width" not in img or "height" not in img:
                issues.append(f"img without width/height: {img.get('src')}")
        if p.headings.count(1) != 1:
            issues.append(f"{p.headings.count(1)} h1 elements")
        for a, b in zip(p.headings, p.headings[1:]):
            if b > a + 1:
                issues.append(f"heading level skips from h{a} to h{b}")
                break
        dupes = sorted({i for i in p.ids if p.ids.count(i) > 1})
        if dupes:
            issues.append(f"duplicate ids: {dupes}")
        title = re.search(r"<title>(.*?)</title>", text, re.S)
        desc = re.search(r'name="description" content="(.*?)"', text)
        tlen = len(html_mod.unescape(title.group(1))) if title else 0
        dlen = len(html_mod.unescape(desc.group(1))) if desc else 0
        if not (10 <= tlen <= 65):
            issues.append(f"title length {tlen} (aim 10-65)")
        if name != "404.html" and not (50 <= dlen <= 160):
            issues.append(f"description length {dlen} (aim 50-160)")
        for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S):
            try:
                json.loads(m)
            except ValueError as e:
                issues.append(f"invalid JSON-LD: {e}")
        for m in re.findall(r"\{\{[a-z]+:[^}]*\}\}|\{\{[A-Z_]+\}\}", text):
            issues.append(f"unexpanded token {m}")
        status = "ok" if not issues else f"{len(issues)} issue(s)"
        print(f"{name:20} {status}")
        for i in issues:
            print(f"    - {i}")
        problems += len(issues)
    # fragment links between pages
    for name, p in pages.items():
        text = open(os.path.join(root, name), encoding="utf-8").read()
        for target, frag in re.findall(r'href="/?([a-z0-9\-]+\.html)#([A-Za-z0-9\-_]+)"', text):
            if target in pages and frag not in pages[target].ids:
                print(f"{name:20} broken anchor {target}#{frag}")
                problems += 1
    print(f"\n{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "public")))
