#!/usr/bin/env python3
"""Fetch resource links, summarize content, and enrich tags."""

from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "data" / "resource-index.json"
CACHE_PATH = ROOT / "data" / "resource-summary-cache.json"

MAX_REMOTE_BYTES = 1_000_000
REQUEST_TIMEOUT_SECONDS = 12
MAX_WORKERS = 12
BLOCKED_TAG_PREFIXES = ("html",)

STOPWORDS = {
    "a",
    "about",
    "after",
    "all",
    "also",
    "an",
    "and",
    "any",
    "are",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "between",
    "both",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "get",
    "had",
    "has",
    "have",
    "how",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "just",
    "more",
    "most",
    "no",
    "not",
    "of",
    "on",
    "or",
    "other",
    "our",
    "out",
    "s",
    "same",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "those",
    "to",
    "too",
    "up",
    "use",
    "using",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "you",
    "your",
    "bitcoin",
}

SSL_CONTEXT = ssl.create_default_context()
USER_AGENT = "btc-resources-tag-enricher/1.0 (+local)"


@dataclass(frozen=True)
class Target:
    key: str
    kind: str
    source: str


class HtmlSummaryParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_title = False
        self.hidden_depth = 0
        self.title_parts: list[str] = []
        self.meta_descriptions: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_d = {k.lower(): (v or "") for k, v in attrs}
        t = tag.lower()

        if t == "title":
            self.in_title = True

        if t in {"script", "style", "noscript", "svg"}:
            self.hidden_depth += 1

        if t == "meta":
            name = attrs_d.get("name", "").strip().lower()
            prop = attrs_d.get("property", "").strip().lower()
            content = normalize_space(attrs_d.get("content", ""))
            if content and (name in {"description", "twitter:description"} or prop == "og:description"):
                self.meta_descriptions.append(content)

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t == "title":
            self.in_title = False
        if t in {"script", "style", "noscript", "svg"} and self.hidden_depth > 0:
            self.hidden_depth -= 1

    def handle_data(self, data: str) -> None:
        text = normalize_space(data)
        if not text:
            return

        if self.in_title:
            self.title_parts.append(text)

        if self.hidden_depth == 0:
            self.text_parts.append(text)


def normalize_space(value: str) -> str:
    text = (value or "").replace("\u27A3", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_tag(value: str) -> str:
    return normalize_space(value).lower()


def is_blocked_tag(tag: str) -> bool:
    key = normalize_tag(tag)
    return any(key.startswith(prefix) for prefix in BLOCKED_TAG_PREFIXES)


def dedupe_tags(tags: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        clean = normalize_space(tag)
        if not clean:
            continue
        key = clean.lower()
        if is_blocked_tag(clean):
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(clean)
    return out


def normalize_cache_key(url: str) -> str:
    url = normalize_space(url)
    if not url:
        return ""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme in {"http", "https"}:
        path = parsed.path.rstrip("/") or "/"
        query = parsed.query
        normalized = urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, query, ""))
        return normalized
    if parsed.scheme == "":
        path = parsed.path.rstrip("/")
        if query := parsed.query:
            return f"{path}?{query}"
        return path
    return url.lower().rstrip("/")


def resolve_target(page_path: str, href: str) -> Target | None:
    href = normalize_space(href)
    if not href:
        return None

    lower = href.lower()
    if lower.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None

    parsed = urllib.parse.urlsplit(href)
    if parsed.scheme in {"http", "https"}:
        key = normalize_cache_key(href)
        return Target(key=key, kind="remote", source=href)

    if parsed.scheme:
        return None

    path_part = parsed.path or ""
    if not path_part:
        return None

    path_part = path_part.lstrip("/")
    if path_part.startswith("btc-resources/"):
        path_part = path_part[len("btc-resources/") :]

    if href.startswith("/"):
        local_path = ROOT / path_part
    else:
        page_dir = (ROOT / page_path).parent
        local_path = (page_dir / path_part).resolve()

    key = normalize_cache_key(str(local_path).replace("\\", "/"))
    return Target(key=key, kind="local", source=str(local_path))


def summarize_text(text: str, max_words: int = 48) -> str:
    cleaned = normalize_space(text)
    if not cleaned:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    chunk = " ".join(sentences[:2])
    words = chunk.split()
    if len(words) > max_words:
        return " ".join(words[:max_words])
    return chunk


def extract_keywords(*parts: str, limit: int = 12) -> list[str]:
    text = " ".join(normalize_space(p).lower() for p in parts if p)
    if not text:
        return []

    tokens = re.findall(r"[a-z0-9][a-z0-9+#'-]{1,}", text)
    counts: dict[str, int] = {}
    first_seen: dict[str, int] = {}

    for idx, token in enumerate(tokens):
        if token in STOPWORDS:
            continue
        if token.isdigit():
            continue
        if len(token) < 3:
            continue
        counts[token] = counts.get(token, 0) + 1
        first_seen.setdefault(token, idx)

    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], first_seen[kv[0]], kv[0]))
    keywords = [token for token, _ in ranked[:limit]]
    return keywords


def parse_html_summary(html: str) -> tuple[str, str, list[str]]:
    parser = HtmlSummaryParser()
    parser.feed(html)
    parser.close()

    title = normalize_space(" ".join(parser.title_parts))
    description = parser.meta_descriptions[0] if parser.meta_descriptions else ""

    text_blob = normalize_space(" ".join(parser.text_parts))
    if len(text_blob) > 8000:
        text_blob = text_blob[:8000]

    summary_source = description or text_blob
    summary = summarize_text(summary_source)
    keywords = extract_keywords(title, description, summary)

    return title, summary, keywords


def read_local_target(path_str: str) -> dict:
    path = Path(path_str)
    if not path.exists() or not path.is_file():
        return {
            "ok": False,
            "error": "local_not_found",
            "summary": "",
            "keywords": [],
            "title": "",
            "sourceKind": "local",
        }

    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        text = path.read_text(encoding="utf-8", errors="ignore")
        title, summary, keywords = parse_html_summary(text)
        return {
            "ok": True,
            "summary": summary,
            "keywords": keywords,
            "title": title,
            "sourceKind": "local_html",
        }

    if suffix == ".pdf":
        name = path.stem.replace("-", " ").replace("_", " ")
        summary = f"PDF resource: {normalize_space(name)}"
        keywords = extract_keywords(name, "pdf document")
        return {
            "ok": True,
            "summary": summary,
            "keywords": keywords,
            "title": normalize_space(name),
            "sourceKind": "local_pdf",
        }

    name = path.stem.replace("-", " ").replace("_", " ")
    summary = f"File resource: {normalize_space(name)}"
    keywords = extract_keywords(name, suffix)
    return {
        "ok": True,
        "summary": summary,
        "keywords": keywords,
        "title": normalize_space(name),
        "sourceKind": "local_file",
    }


def read_remote_target(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS, context=SSL_CONTEXT) as response:
            content_type = (response.headers.get("Content-Type") or "").lower()
            final_url = response.geturl()
            data = response.read(MAX_REMOTE_BYTES)
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "error": f"http_{exc.code}",
            "summary": "",
            "keywords": [],
            "title": "",
            "sourceKind": "remote",
        }
    except Exception:
        return {
            "ok": False,
            "error": "fetch_failed",
            "summary": "",
            "keywords": [],
            "title": "",
            "sourceKind": "remote",
        }

    final_suffix = Path(urllib.parse.urlsplit(final_url).path).suffix.lower()
    if "text/html" in content_type or final_suffix in {".html", ".htm", ""}:
        html = data.decode("utf-8", errors="ignore")
        title, summary, keywords = parse_html_summary(html)
        return {
            "ok": True,
            "summary": summary,
            "keywords": keywords,
            "title": title,
            "sourceKind": "remote_html",
        }

    if "pdf" in content_type or final_suffix == ".pdf":
        file_name = Path(urllib.parse.urlsplit(final_url).path).stem
        pretty_name = normalize_space(file_name.replace("-", " ").replace("_", " "))
        summary = f"PDF resource: {pretty_name}"
        keywords = extract_keywords(pretty_name, "pdf")
        return {
            "ok": True,
            "summary": summary,
            "keywords": keywords,
            "title": pretty_name,
            "sourceKind": "remote_pdf",
        }

    # Generic binary or unknown response.
    file_name = Path(urllib.parse.urlsplit(final_url).path).stem
    pretty_name = normalize_space(file_name.replace("-", " ").replace("_", " "))
    summary = f"External resource: {pretty_name or final_url}"
    keywords = extract_keywords(pretty_name, final_url)
    return {
        "ok": True,
        "summary": summary,
        "keywords": keywords,
        "title": pretty_name,
        "sourceKind": "remote_file",
    }


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def fetch_target(target: Target) -> tuple[str, dict]:
    if target.kind == "local":
        result = read_local_target(target.source)
    else:
        result = read_remote_target(target.source)

    result["fetchedAt"] = datetime.now(timezone.utc).isoformat()
    return target.key, result


def main() -> None:
    index_data = load_json(INDEX_PATH, {})
    resources = index_data.get("resources") or []
    if not resources:
        raise SystemExit("No resources found in data/resource-index.json")

    cache_data = load_json(CACHE_PATH, {"entries": {}})
    cache_entries = cache_data.get("entries") or {}

    targets: dict[str, Target] = {}
    for resource in resources:
        page_path = normalize_space(resource.get("page", ""))
        href = normalize_space(resource.get("url", ""))
        target = resolve_target(page_path, href)
        if target is None:
            continue
        targets.setdefault(target.key, target)

    to_fetch: list[Target] = [target for key, target in targets.items() if key not in cache_entries]

    if to_fetch:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = [executor.submit(fetch_target, target) for target in to_fetch]
            completed = 0
            total = len(futures)
            for future in as_completed(futures):
                key, result = future.result()
                cache_entries[key] = result
                completed += 1
                if completed % 100 == 0 or completed == total:
                    print(f"Fetched {completed}/{total} link targets")

    updated_resources: list[dict] = []
    success_count = 0
    failed_count = 0

    for resource in resources:
        page_path = normalize_space(resource.get("page", ""))
        href = normalize_space(resource.get("url", ""))
        target = resolve_target(page_path, href)
        enriched = dict(resource)

        if target and target.key in cache_entries:
            result = cache_entries[target.key]
            summary = normalize_space(result.get("summary", ""))
            keywords = [normalize_space(k) for k in (result.get("keywords") or [])]
            keywords = [k for k in keywords if k]

            if summary:
                enriched["externalSummary"] = summary
            else:
                enriched.pop("externalSummary", None)

            if keywords:
                enriched["externalKeywords"] = keywords
            else:
                enriched.pop("externalKeywords", None)

            tags = dedupe_tags((enriched.get("tags") or []) + keywords)
            enriched["tags"] = tags

            if result.get("ok"):
                success_count += 1
            else:
                failed_count += 1
                enriched["externalSummaryStatus"] = result.get("error", "unavailable")
        else:
            failed_count += 1

        updated_resources.append(enriched)

    index_data["resources"] = updated_resources
    index_data["resourceCount"] = len(updated_resources)
    index_data["linkSummaryMetadata"] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "targets": len(targets),
        "cachedTargets": len(cache_entries),
        "successCount": success_count,
        "failedCount": failed_count,
    }

    INDEX_PATH.write_text(json.dumps(index_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    cache_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entries": cache_entries,
    }
    CACHE_PATH.write_text(json.dumps(cache_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Updated {INDEX_PATH}")
    print(f"Targets: {len(targets)} | Success: {success_count} | Failed: {failed_count}")


if __name__ == "__main__":
    main()
