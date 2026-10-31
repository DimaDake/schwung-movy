"""MkDocs hook: writes the manual's table of contents.

A page that contains the marker `<!-- contents -->` gets it replaced by every
manual chapter (in nav order) with its `##` sections as links. Generated from
the chapters' own headings at build time, so the list cannot go stale; a link
that does not resolve fails `mkdocs build --strict` (validation.anchors).
"""
import os
import re

from markdown.extensions.toc import slugify

MARKER = "<!-- contents -->"
_chapters = []  # [(title, src_uri)], filled from the nav


def on_nav(nav, config, files):
    _chapters.clear()

    def walk(items):
        for item in items:
            if item.is_page and item.file.src_uri.startswith("manual/") and not item.file.src_uri.endswith("index.md"):
                _chapters.append((item.title, item.file.src_uri))
            if item.children:
                walk(item.children)

    walk(nav.items)
    return nav


def _sections(path):
    out, fenced = [], False
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.lstrip().startswith(("```", "~~~")):
                fenced = not fenced
            if not fenced and line.startswith("## "):
                title = line[3:].strip()
                out.append((re.sub(r"[*`]", "", title), slugify(title, "-")))
    return out


def on_page_markdown(markdown, page, config, files):
    if MARKER not in markdown:
        return markdown
    here = os.path.dirname(page.file.src_uri)
    lines = ['<div class="manual-contents" markdown>', ""]
    for n, (title, uri) in enumerate(_chapters, 1):
        rel = os.path.relpath(uri, here) if here else uri
        lines.append(f"{n}. **[{title}]({rel})**")
        for name, anchor in _sections(os.path.join(config["docs_dir"], uri)):
            lines.append(f"    - [{name}]({rel}#{anchor})")
    lines += ["", "</div>"]
    return markdown.replace(MARKER, "\n".join(lines))
