#!/usr/bin/env python3
"""Apply resource tags from resource-index.json directly to HTML anchor elements."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "data" / "resource-index.json"

ATTR_NAMES = [
    "data-resource-name",
    "data-resource-page",
    "data-resource-category",
    "data-resource-url",
    "data-resource-tags",
]


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_key(value: str) -> str:
    return normalize_space(value).lower().rstrip("/")


def is_resource_href(href: str) -> bool:
    if not href:
        return False
    h = normalize_space(href).lower()
    if not h:
        return False
    if h.startswith("#"):
        return False
    if h.startswith("javascript:"):
        return False
    if h.startswith("mailto:"):
        return False
    if h.startswith("tel:"):
        return False
    return True


def extract_attr(tag: str, attr: str) -> str:
    # quoted
    m = re.search(rf"\b{re.escape(attr)}\s*=\s*\"([^\"]*)\"", tag, flags=re.IGNORECASE)
    if m:
        return html.unescape(m.group(1))
    m = re.search(rf"\b{re.escape(attr)}\s*=\s*'([^']*)'", tag, flags=re.IGNORECASE)
    if m:
        return html.unescape(m.group(1))
    # unquoted
    m = re.search(rf"\b{re.escape(attr)}\s*=\s*([^\s>]+)", tag, flags=re.IGNORECASE)
    if m:
        return html.unescape(m.group(1))
    return ""


def strip_tags(text: str) -> str:
    return normalize_space(re.sub(r"<[^>]+>", " ", text or ""))


def clean_start_tag(start_tag: str) -> str:
    cleaned = start_tag
    for name in ATTR_NAMES:
        cleaned = re.sub(
            rf"\s+{re.escape(name)}\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
    return cleaned


def inject_attrs(start_tag: str, resource: dict) -> str:
    cleaned = clean_start_tag(start_tag)
    attrs = {
        "data-resource-name": normalize_space(resource.get("name", "")),
        "data-resource-page": normalize_space(resource.get("page", "")),
        "data-resource-category": normalize_space(resource.get("categoryHeader", resource.get("category", ""))),
        "data-resource-url": normalize_space(resource.get("url", "")),
        "data-resource-tags": "|".join(normalize_space(t) for t in (resource.get("tags") or []) if normalize_space(t)),
    }

    suffix = "/>" if cleaned.endswith("/>") else ">"
    prefix = cleaned[:-2] if suffix == "/>" else cleaned[:-1]

    for name in ATTR_NAMES:
        value = html.escape(attrs[name], quote=True)
        prefix += f' {name}="{value}"'

    return prefix + suffix


def choose_candidate(candidates: list[dict], anchor_name: str) -> dict | None:
    if not candidates:
        return None

    if anchor_name:
        target = normalize_key(anchor_name)
        for idx, candidate in enumerate(candidates):
            if normalize_key(candidate.get("name", "")) == target:
                return candidates.pop(idx)

    return candidates.pop(0)


def apply_page_tags(page_path: Path, page_resources: list[dict]) -> tuple[int, int]:
    text = page_path.read_text(encoding="utf-8", errors="ignore")

    by_href: dict[str, list[dict]] = {}
    for resource in page_resources:
        key = normalize_key(resource.get("url", ""))
        if not key:
            continue
        by_href.setdefault(key, []).append(resource)

    anchor_pattern = re.compile(r"(?is)<a\b[^>]*>.*?</a>")

    replaced = 0
    seen = 0

    def repl(match: re.Match) -> str:
        nonlocal replaced, seen

        block = match.group(0)
        start_match = re.match(r"(?is)<a\b[^>]*>", block)
        if not start_match:
            return block

        start_tag = start_match.group(0)
        inner_html = block[len(start_tag) : -4]  # strip </a>

        href = extract_attr(start_tag, "href")
        if not is_resource_href(href):
            return block

        href_key = normalize_key(href)
        candidates = by_href.get(href_key)
        if not candidates:
            return block

        title_attr = extract_attr(start_tag, "title")
        anchor_name = strip_tags(inner_html) or normalize_space(title_attr)

        candidate = choose_candidate(candidates, anchor_name)
        if candidate is None:
            return block

        seen += 1
        new_start = inject_attrs(start_tag, candidate)
        if new_start != start_tag:
            replaced += 1

        return new_start + block[len(start_tag) :]

    new_text = anchor_pattern.sub(repl, text)

    if new_text != text:
        page_path.write_text(new_text, encoding="utf-8", newline="\n")

    return replaced, seen


def main() -> None:
    if not INDEX_PATH.exists():
        raise SystemExit(f"Missing index file: {INDEX_PATH}")

    index_data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    resources = index_data.get("resources") or []

    resources_by_page: dict[str, list[dict]] = {}
    for resource in resources:
        page = normalize_space(resource.get("page", ""))
        if not page:
            continue
        resources_by_page.setdefault(page, []).append(resource)

    total_replaced = 0
    total_seen = 0
    pages_changed = 0

    for page, page_resources in sorted(resources_by_page.items()):
        path = ROOT / page
        if not path.exists() or not path.is_file():
            continue

        replaced, seen = apply_page_tags(path, page_resources)
        total_replaced += replaced
        total_seen += seen
        if replaced > 0:
            pages_changed += 1
            print(f"Updated {page}: tagged {replaced} anchors")

    print(f"Done. Tagged anchors: {total_replaced} / matched resources: {total_seen} / pages changed: {pages_changed}")


if __name__ == "__main__":
    main()
