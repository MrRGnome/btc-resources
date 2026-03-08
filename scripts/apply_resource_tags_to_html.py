#!/usr/bin/env python3
"""Apply resource metadata from resource-index.json directly to HTML anchor elements."""

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
    "data-resource-description",
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
    m = re.search(rf"\b{re.escape(attr)}\s*=\s*\"([^\"]*)\"", tag, flags=re.IGNORECASE)
    if m:
        return html.unescape(m.group(1))

    m = re.search(rf"\b{re.escape(attr)}\s*=\s*'([^']*)'", tag, flags=re.IGNORECASE)
    if m:
        return html.unescape(m.group(1))

    m = re.search(rf"\b{re.escape(attr)}\s*=\s*([^\s>]+)", tag, flags=re.IGNORECASE)
    if m:
        return html.unescape(m.group(1))

    return ""


def has_attr(tag: str, attr: str) -> bool:
    return re.search(rf"\b{re.escape(attr)}\s*=", tag, flags=re.IGNORECASE) is not None


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


def set_attr(start_tag: str, attr: str, value: str) -> str:
    escaped = html.escape(normalize_space(value), quote=True)

    if has_attr(start_tag, attr):
        return re.sub(
            rf"(\b{re.escape(attr)}\s*=\s*)(\"[^\"]*\"|'[^']*'|[^\s>]+)",
            rf"\1\"{escaped}\"",
            start_tag,
            count=1,
            flags=re.IGNORECASE,
        )

    suffix = "/>" if start_tag.endswith("/>") else ">"
    prefix = start_tag[:-2] if suffix == "/>" else start_tag[:-1]
    return f'{prefix} {attr}="{escaped}"{suffix}'


def infer_description(anchor_name: str, title_attr: str, href: str) -> str:
    name = normalize_space(anchor_name)
    title = normalize_space(title_attr)

    if name:
        return name
    if title:
        return title

    href_clean = normalize_space(href)
    if href_clean:
        return f"Resource link: {href_clean}"

    return "Resource link"


def inject_attrs(start_tag: str, resource: dict, fallback_name: str, fallback_title: str) -> str:
    cleaned = clean_start_tag(start_tag)

    description = normalize_space(
        resource.get("externalSummary", "") or resource.get("content", "") or fallback_name or fallback_title
    )

    attrs = {
        "data-resource-name": normalize_space(resource.get("name", "") or fallback_name),
        "data-resource-page": normalize_space(resource.get("page", "")),
        "data-resource-category": normalize_space(resource.get("categoryHeader", resource.get("category", ""))),
        "data-resource-url": normalize_space(resource.get("url", "")),
        "data-resource-tags": "|".join(normalize_space(t) for t in (resource.get("tags") or []) if normalize_space(t)),
        "data-resource-description": description,
    }

    suffix = "/>" if cleaned.endswith("/>") else ">"
    prefix = cleaned[:-2] if suffix == "/>" else cleaned[:-1]

    for name in ATTR_NAMES:
        value = html.escape(attrs[name], quote=True)
        prefix += f' {name}="{value}"'

    return prefix + suffix


def choose_candidate(candidates: list[dict] | None, anchor_name: str) -> dict | None:
    if not candidates:
        return None

    target = normalize_key(anchor_name)
    if target:
        for candidate in candidates:
            if normalize_key(candidate.get("name", "")) == target:
                return candidate

    return candidates[0]


def apply_page_tags(page_path: Path, page_resources: list[dict], global_resources: list[dict]) -> tuple[int, int]:
    text = page_path.read_text(encoding="utf-8", errors="ignore")

    by_href: dict[str, list[dict]] = {}
    for resource in page_resources:
        key = normalize_key(resource.get("url", ""))
        if not key:
            continue
        by_href.setdefault(key, []).append(resource)

    global_by_href: dict[str, list[dict]] = {}
    for resource in global_resources:
        key = normalize_key(resource.get("url", ""))
        if not key:
            continue
        global_by_href.setdefault(key, []).append(resource)

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

        title_attr = extract_attr(start_tag, "title")
        anchor_name = strip_tags(inner_html) or normalize_space(title_attr)

        href_key = normalize_key(href)
        candidate = choose_candidate(by_href.get(href_key), anchor_name)
        if candidate is None:
            candidate = choose_candidate(global_by_href.get(href_key), anchor_name)

        if candidate is None:
            if has_attr(start_tag, "data-resource-tags") and not has_attr(start_tag, "data-resource-description"):
                desc = infer_description(anchor_name, title_attr, href)
                new_start = set_attr(start_tag, "data-resource-description", desc)
                if new_start != start_tag:
                    replaced += 1
                return new_start + block[len(start_tag) :]
            return block

        seen += 1
        new_start = inject_attrs(start_tag, candidate, anchor_name, title_attr)
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

        replaced, seen = apply_page_tags(path, page_resources, resources)
        total_replaced += replaced
        total_seen += seen
        if replaced > 0:
            pages_changed += 1
            print(f"Updated {page}: tagged {replaced} anchors")

    print(f"Done. Tagged anchors: {total_replaced} / matched resources: {total_seen} / pages changed: {pages_changed}")


if __name__ == "__main__":
    main()
