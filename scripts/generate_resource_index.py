#!/usr/bin/env python3
"""Build a local resource index from the site's HTML pages."""

from __future__ import annotations

import json
import re
from collections import OrderedDict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "resource-index.json"

HEADING_TAGS = {"h2", "h3", "h4"}
STOPWORDS = {
    "a",
    "about",
    "all",
    "and",
    "are",
    "at",
    "be",
    "bitcoin",
    "by",
    "for",
    "from",
    "guide",
    "how",
    "in",
    "is",
    "it",
    "its",
    "list",
    "of",
    "on",
    "or",
    "resources",
    "the",
    "to",
    "with",
    "your",
}
DOMAIN_STOPWORDS = {"com", "org", "net", "io", "www", "co", "app", "dev"}
DOMAIN_HINTS = {
    "github.com": ["github", "open source", "repository", "code"],
    "youtube.com": ["youtube", "video"],
    "youtu.be": ["youtube", "video"],
    "stacker.news": ["stacker news"],
    "medium.com": ["medium article"],
    "substack.com": ["substack"],
    "bitcoinops.org": ["bitcoin optech"],
    "reddit.com": ["reddit"],
}

BLOCKED_TAGS = {"html"}


def is_blocked_tag(key: str) -> bool:
    return key.startswith("html") or key in BLOCKED_TAGS


EXCLUDED_RESOURCES = {
    (
        "index.html",
        "toxic asshole",
        "https://www.youtube.com/@bitcoindiscord",
    ),
    (
        "index.html",
        "s",
        "https://www.youtube.com/watch?v=urgpz0fuixs",
    ),
}

def normalize_space(value: str) -> str:
    text = (value or "").replace("\u27A3", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_key(value: str) -> str:
    return normalize_space(value).lower()


def clean_heading(value: str) -> str:
    heading = normalize_space(value)
    heading = re.sub(r"\s*:\s*$", "", heading)
    return heading or "General Resources"


def tokenize(value: str) -> list[str]:
    return re.findall(r"[a-z0-9][a-z0-9+#'-]*", (value or "").lower())


def unique_ordered(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def add_tag(tags: list[str], seen: set[str], value: str) -> None:
    tag = normalize_space(value)
    if not tag:
        return
    key = tag.lower()
    if is_blocked_tag(key):
        return
    if key in seen:
        return
    seen.add(key)
    tags.append(tag)


def page_label(page_path: str) -> str:
    stem = Path(page_path).stem
    if stem.lower() == "index":
        return "home"
    return stem.replace("-", " ").replace("_", " ")


def is_resource_href(href: str) -> bool:
    if not href:
        return False
    href_l = href.strip().lower()
    if not href_l:
        return False
    if href_l.startswith("#"):
        return False
    if href_l.startswith("javascript:"):
        return False
    if href_l.startswith("mailto:"):
        return False
    if href_l.startswith("tel:"):
        return False
    if "{{" in href_l or "}}" in href_l:
        return False
    return True

def normalize_exclusion_url(url: str) -> str:
    normalized = normalize_space(url).lower()
    if normalized.endswith("/"):
        normalized = normalized.rstrip("/")
    return normalized


def is_excluded_resource(entry: dict[str, str]) -> bool:
    key = (
        normalize_key(entry.get("page", "")),
        normalize_key(entry.get("name", "")),
        normalize_exclusion_url(entry.get("url", "")),
    )
    return key in EXCLUDED_RESOURCES


def normalize_destination_key(url: str) -> str:
    normalized = normalize_space(url)
    if not normalized:
        return ""

    candidate = normalized.replace("&amp;", "&")
    absolute_candidate = candidate

    if not re.match(r"^[a-z][a-z0-9+.-]*://", absolute_candidate, re.IGNORECASE) and re.match(
        r"^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:]|$)", absolute_candidate, re.IGNORECASE
    ):
        absolute_candidate = f"https://{absolute_candidate}"

    parsed = urlparse(absolute_candidate)
    if parsed.scheme and parsed.netloc:
        host = (parsed.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]

        path = (parsed.path or "/").lower()
        path = re.sub(r"/+$", "", path) or "/"

        query_pairs: list[str] = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            query_pairs.append(f"{normalize_space(key).lower()}={normalize_space(value).lower()}")
        query_pairs.sort()

        canonical = host + path
        if query_pairs:
            canonical += "?" + "&".join(query_pairs)
    else:
        canonical = candidate.lower()

    return re.sub(r"[^a-z0-9]", "", canonical.lower())


def merge_entry_tags(primary: list[str], secondary: list[str], max_tags: int = 64) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()

    for tag in (primary or []) + (secondary or []):
        clean = normalize_space(tag)
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        merged.append(clean)
        if len(merged) >= max_tags:
            break

    return merged


def merge_entry_content(primary: str, secondary: str) -> str:
    left = normalize_space(primary)
    right = normalize_space(secondary)
    if not left:
        return right
    if not right:
        return left

    left_key = normalize_key(left)
    right_key = normalize_key(right)
    if right_key in left_key:
        return left
    if left_key in right_key:
        return right
    return f"{left} {right}"


def dedupe_entries_by_destination(entries: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: list[dict[str, object]] = []
    by_destination: dict[str, int] = {}

    for entry in entries:
        destination_key = normalize_destination_key(str(entry.get("url", "")))
        if not destination_key:
            deduped.append(entry)
            continue

        existing_index = by_destination.get(destination_key)
        if existing_index is None:
            by_destination[destination_key] = len(deduped)
            deduped.append(entry)
            continue

        existing = deduped[existing_index]
        merged = dict(existing)
        merged["tags"] = merge_entry_tags(
            list(existing.get("tags", [])),
            list(entry.get("tags", [])),
        )
        merged["content"] = merge_entry_content(
            str(existing.get("content", "")),
            str(entry.get("content", "")),
        )
        deduped[existing_index] = merged

    return deduped


def build_tags(entry: dict[str, str]) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()

    name = entry["name"]
    category = entry["categoryHeader"]
    page = page_label(entry["page"])
    content = entry.get("content", "")
    title = entry.get("title", "")
    url = entry["url"]
    explicit_tags_raw = normalize_space(entry.get("explicitTags", ""))

    # Explicitly include anchor text (resource name) as a tag.
    add_tag(tags, seen, name)
    add_tag(tags, seen, category)
    add_tag(tags, seen, page)

    if explicit_tags_raw:
        for explicit_tag in explicit_tags_raw.split("|"):
            add_tag(tags, seen, explicit_tag)

    for phrase in (name, title, category, page):
        normalized_phrase = normalize_space(phrase.lower())
        if normalized_phrase and normalized_phrase != normalize_space(phrase):
            add_tag(tags, seen, normalized_phrase)
        for token in tokenize(phrase):
            if token in STOPWORDS:
                continue
            add_tag(tags, seen, token)

    name_tokens = set(tokenize(name))
    context_tokens: list[str] = []
    for token in tokenize(content):
        if token in STOPWORDS or token in name_tokens:
            continue
        context_tokens.append(token)
    for token in unique_ordered(context_tokens)[:10]:
        add_tag(tags, seen, token)

    parsed = urlparse(url)
    if parsed.scheme in {"http", "https"}:
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        add_tag(tags, seen, host)

        for part in re.split(r"[.\-]", host):
            if not part or part in DOMAIN_STOPWORDS:
                continue
            add_tag(tags, seen, part)

        path_tokens = [t for t in tokenize(parsed.path) if t not in STOPWORDS]
        for token in unique_ordered(path_tokens)[:10]:
            add_tag(tags, seen, token)

        for domain, hints in DOMAIN_HINTS.items():
            if host == domain or host.endswith(f".{domain}"):
                for hint in hints:
                    add_tag(tags, seen, hint)
    else:
        if url.lower().endswith(".pdf"):
            add_tag(tags, seen, "pdf")
        for token in unique_ordered(tokenize(url))[:10]:
            if token in STOPWORDS:
                continue
            add_tag(tags, seen, token)

    hint_source = " ".join([name, category, title, content, url]).lower()
    if "youtube" in hint_source or "youtu.be" in hint_source:
        add_tag(tags, seen, "video")
    if "podcast" in hint_source:
        add_tag(tags, seen, "podcast")
    if "privacy" in hint_source:
        add_tag(tags, seen, "privacy")
    if "node" in hint_source:
        add_tag(tags, seen, "node")

    return tags[:48]


class ResourcePageParser(HTMLParser):
    def __init__(self, page_path: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_path = page_path
        self.page_title_parts: list[str] = []
        self.page_title = ""

        self.in_title = False
        self.active_heading_tag = ""
        self.active_heading_parts: list[str] = []
        self.current_category = "General Resources"

        self.in_li = False
        self.li_text_parts: list[str] = []
        self.li_anchors: list[dict[str, str | list[str]]] = []

        self.current_anchor: dict[str, str | list[str]] | None = None

        self.resources: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k: (v or "") for k, v in attrs}

        if tag == "title":
            self.in_title = True

        if tag in HEADING_TAGS:
            self.active_heading_tag = tag
            self.active_heading_parts = []

        if tag == "li":
            self.in_li = True
            self.li_text_parts = []
            self.li_anchors = []

        if tag == "a":
            anchor = {
                "href": attrs_dict.get("href", "").strip(),
                "title": normalize_space(attrs_dict.get("title", "")),
                "explicit_tags": normalize_space(attrs_dict.get("data-resource-tags", "")),
                "text_parts": [],
                "category": self.current_category,
            }
            self.current_anchor = anchor
            if self.in_li:
                self.li_anchors.append(anchor)

    def handle_data(self, data: str) -> None:
        text = normalize_space(data)
        if not text:
            return

        if self.in_title:
            self.page_title_parts.append(text)

        if self.active_heading_tag:
            self.active_heading_parts.append(text)

        if self.in_li:
            self.li_text_parts.append(text)

        if self.current_anchor is not None:
            text_parts = self.current_anchor["text_parts"]
            if isinstance(text_parts, list):
                text_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
            self.page_title = normalize_space(" ".join(self.page_title_parts))

        if self.active_heading_tag and tag == self.active_heading_tag:
            heading = clean_heading(" ".join(self.active_heading_parts))
            self.current_category = heading
            self.active_heading_tag = ""
            self.active_heading_parts = []

        if tag == "a" and self.current_anchor is not None:
            if not self.in_li:
                self._append_anchor_entry(self.current_anchor, context_text="")
            self.current_anchor = None

        if tag == "li" and self.in_li:
            li_text = normalize_space(" ".join(self.li_text_parts))
            deduped = OrderedDict()
            for anchor in self.li_anchors:
                name = self._anchor_name(anchor)
                href = normalize_space(str(anchor.get("href", "")))
                if not name or not is_resource_href(href):
                    continue

                key = (normalize_key(href), normalize_key(name))
                source = "text" if normalize_space(" ".join(anchor.get("text_parts", []))) else "title"
                candidate = {"anchor": anchor, "source": source}
                existing = deduped.get(key)
                if existing is None:
                    deduped[key] = candidate
                elif existing["source"] == "title" and source == "text":
                    deduped[key] = candidate

            for item in deduped.values():
                self._append_anchor_entry(item["anchor"], context_text=li_text)

            self.in_li = False
            self.li_text_parts = []
            self.li_anchors = []

    def _anchor_name(self, anchor: dict[str, str | list[str]]) -> str:
        text = normalize_space(" ".join(anchor.get("text_parts", [])))
        title = normalize_space(str(anchor.get("title", "")))
        return text or title

    def _append_anchor_entry(self, anchor: dict[str, str | list[str]], context_text: str) -> None:
        href = normalize_space(str(anchor.get("href", "")))
        if not is_resource_href(href):
            return

        name = self._anchor_name(anchor)
        if not name:
            return

        title = normalize_space(str(anchor.get("title", "")))
        category = clean_heading(str(anchor.get("category", self.current_category)))
        content = normalize_space(context_text) or name

        self.resources.append(
            {
                "name": name,
                "page": self.page_path.replace("\\", "/"),
                "categoryHeader": category,
                "url": href,
                "title": title,
                "content": content,
                "explicitTags": normalize_space(str(anchor.get("explicit_tags", ""))),
            }
        )


def collect_pages() -> list[Path]:
    pages: list[Path] = [
        ROOT / "index.html",
        ROOT / "bitcoin.html",
        ROOT / "lightning.html",
    ]
    pages.extend(sorted((ROOT / "bitcoin-information").glob("*.html")))
    return [page for page in pages if page.exists()]


def main() -> None:
    entries: list[dict[str, str]] = []
    for page_path in collect_pages():
        parser = ResourcePageParser(str(page_path.relative_to(ROOT)).replace("\\", "/"))
        parser.feed(page_path.read_text(encoding="utf-8", errors="ignore"))
        parser.close()

        for entry in parser.resources:
            if is_excluded_resource(entry):
                continue
            tags = build_tags(entry)
            entries.append(
                {
                    "name": entry["name"],
                    "page": entry["page"],
                    "categoryHeader": entry["categoryHeader"],
                    "category": entry["categoryHeader"],
                    "url": entry["url"],
                    "tags": tags,
                    "content": entry.get("content", ""),
                }
            )

    deduped_entries = dedupe_entries_by_destination(entries)

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "resourceCount": len(deduped_entries),
        "resources": deduped_entries,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    removed = len(entries) - len(deduped_entries)
    print(f"Generated {len(deduped_entries)} resources (deduped {removed}) -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()


