(function () {
  "use strict";

  var SEARCH_MIN_CHARS = 2;
  var SEARCH_MAX_RESULTS = 30;
  var PRIORITY_RULES = [
    { resourceKey: "bitcoindiscordcom", terms: ["help", "discord", "chat", "support"] },
    { resourceKey: "knotsliescom", terms: ["knots", "bip110"] },
  ];
  var ARTICLE_MANIFEST_URL = "https://raw.githubusercontent.com/MrRGnome/articles/refs/heads/master/articles.json";

  var ARTICLE_LIST_PAGE = "articles.html";

  function normalizeSpace(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeText(value) {
    return normalizeSpace((value || "").toLowerCase().replace(/[^a-z0-9+#'\-]+/g, " "));
  }
  function getSharedJsonText(path) {
    if (window.__btcGetSharedJsonText && typeof window.__btcGetSharedJsonText === "function") {
      return window.__btcGetSharedJsonText(path);
    }

    window.__btcSharedJsonTextPromises = window.__btcSharedJsonTextPromises || {};

    window.__btcGetSharedJsonText = function (sharedPath) {
      if (!sharedPath) {
        return Promise.reject(new Error("Missing JSON path."));
      }

      if (!window.__btcSharedJsonTextPromises[sharedPath]) {
        window.__btcSharedJsonTextPromises[sharedPath] = fetch(sharedPath)
          .then(function (response) {
            if (!response.ok) {
              throw new Error("Failed to load JSON: HTTP " + response.status + " (" + sharedPath + ")");
            }
            return response.text();
          })
          .catch(function (error) {
            delete window.__btcSharedJsonTextPromises[sharedPath];
            throw error;
          });
      }

      return window.__btcSharedJsonTextPromises[sharedPath];
    };

    return window.__btcGetSharedJsonText(path);
  }

  function getCurrentPagePath() {
    var path = (window.location.pathname || "").replace(/\\/g, "/");
    var subdirectory = "";
    if (window.TemplateEngine && TemplateEngine.settings && TemplateEngine.settings.SUBDIRECTORY) {
      subdirectory = TemplateEngine.settings.SUBDIRECTORY;
    }

    if (subdirectory && path.indexOf(subdirectory + "/") === 0) {
      path = path.slice(subdirectory.length + 1);
    } else if (subdirectory && path === subdirectory) {
      path = "";
    }

    path = path.replace(/^\/+/, "");
    if (!path || path.endsWith("/")) {
      path += "index.html";
    }

    return path;
  }

  function getResourceIndexPath(currentPagePath) {
    if (currentPagePath.indexOf("bitcoin-information/") === 0) {
      return "../data/resource-index.json";
    }
    return "./data/resource-index.json";
  }

  function getSectionIndexPath(currentPagePath) {
    if (currentPagePath.indexOf("bitcoin-information/") === 0) {
      return "../data/resource-section-index.json";
    }
    return "./data/resource-section-index.json";
  }

  function createEmptyArticleManifestPayload() {
    return { articles: {} };
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    var normalized = [];
    var seen = Object.create(null);

    value.forEach(function (item) {
      var clean = normalizeSpace(String(item || ""));
      var key = clean.toLowerCase();
      if (!clean || seen[key]) {
        return;
      }
      seen[key] = true;
      normalized.push(clean);
    });

    return normalized;
  }

  function deriveArticleId(fallbackId, filename) {
    var id = normalizeSpace(fallbackId || "");
    if (id) {
      return id;
    }

    var cleanFile = normalizeSpace(filename || "").replace(/\\/g, "/");
    if (!cleanFile) {
      return "";
    }

    var fileName = cleanFile.split("/").pop() || "";
    return normalizeSpace(fileName.replace(/\.json$/i, ""));
  }

  function normalizeManifestEntries(manifest) {
    var entries = [];
    var source = manifest && manifest.articles;

    if (!source || typeof source !== "object") {
      return entries;
    }

    if (Array.isArray(source)) {
      source.forEach(function (item) {
        if (!item || typeof item !== "object") {
          return;
        }

        var id = deriveArticleId(item.id, item.filename);
        if (!id) {
          return;
        }

        entries.push({
          id: id,
          title: normalizeSpace(item.title || ""),
          author: normalizeSpace(item.author || ""),
          line1: normalizeSpace(item.line1 || ""),
          line2: normalizeSpace(item.line2 || ""),
          tags: normalizeStringArray(item.tags)
        });
      });
      return entries;
    }

    Object.keys(source).forEach(function (idKey) {
      var item = source[idKey];
      if (!item || typeof item !== "object") {
        return;
      }

      var id = deriveArticleId(idKey, item.filename);
      if (!id) {
        return;
      }

      entries.push({
        id: id,
        title: normalizeSpace(item.title || ""),
        author: normalizeSpace(item.author || ""),
        line1: normalizeSpace(item.line1 || ""),
        line2: normalizeSpace(item.line2 || ""),
        tags: normalizeStringArray(item.tags)
      });
    });

    return entries;
  }

  function mapArticleToSearchResource(entry) {
    var title = normalizeSpace(entry.title || "");
    var line1 = normalizeSpace(entry.line1 || "");
    var line2 = normalizeSpace(entry.line2 || "");
    var tags = normalizeStringArray(entry.tags);
    var summary = normalizeSpace((line1 + " " + line2).trim());

    if (!tags.length) {
      tags = normalizeStringArray([title, entry.id, entry.author]);
    }

    return {
      name: title || ("Article " + entry.id),
      page: title || ("Article " + entry.id),
      categoryHeader: normalizeSpace(entry.author || ""),
      category: line1,
      url: "/article.html?id=" + encodeURIComponent(entry.id || ""),
      tags: tags.slice(),
      content: line2,
      externalSummary: summary,
      externalKeywords: tags.slice()
    };
  }

  function mergeArticleResourcesIntoIndex(indexPayload, manifestPayload) {
    var payload = (indexPayload && typeof indexPayload === "object") ? indexPayload : { resources: [] };
    if (!Array.isArray(payload.resources)) {
      payload.resources = [];
    }

    var seenByUrlKey = Object.create(null);
    payload.resources.forEach(function (resource) {
      var urlKey = normalizeDestinationUrl(resource && resource.url ? resource.url : "");
      if (urlKey) {
        seenByUrlKey[urlKey] = true;
      }
    });

    var articleEntries = normalizeManifestEntries(manifestPayload);
    articleEntries.forEach(function (entry) {
      var articleResource = mapArticleToSearchResource(entry);
      var articleUrlKey = normalizeDestinationUrl(articleResource.url || "");
      if (articleUrlKey && seenByUrlKey[articleUrlKey]) {
        return;
      }
      if (articleUrlKey) {
        seenByUrlKey[articleUrlKey] = true;
      }
      payload.resources.push(articleResource);
    });

    if (typeof payload.resourceCount === "number") {
      payload.resourceCount = payload.resources.length;
    }

    return payload;
  }

  function getSubdirectory() {
    var subdirectory = "";
    if (window.TemplateEngine && TemplateEngine.settings && TemplateEngine.settings.SUBDIRECTORY) {
      subdirectory = normalizeSpace(TemplateEngine.settings.SUBDIRECTORY || "");
    }
    return subdirectory.replace(/^\/+|\/+$/g, "");
  }

  function normalizePagePath(pagePath) {
    var normalized = normalizeSpace(pagePath || "").replace(/\\/g, "/");
    var subdirectory = getSubdirectory();

    if (subdirectory && normalized.indexOf(subdirectory + "/") === 0) {
      normalized = normalized.slice(subdirectory.length + 1);
    }

    normalized = normalized.replace(/^\/+/, "");
    if (!normalized || normalized.endsWith("/")) {
      normalized += "index.html";
    }

    return normalized;
  }

  function buildSitePageUrl(pagePath) {
    var normalizedPagePath = normalizePagePath(pagePath || "");
    var subdirectory = getSubdirectory();
    if (subdirectory) {
      return "/" + subdirectory + "/" + normalizedPagePath;
    }
    return "/" + normalizedPagePath;
  }

  function normalizeCategoryKey(value) {
    return normalizeSpace((value || "").toLowerCase()).replace(/:+$/, "");
  }

  function normalizeHrefForMatch(href) {
    try {
      return new URL(href, window.location.href).href;
    } catch (error) {
      return normalizeSpace(href);
    }
  }

  function getAnchorDisplayName(anchor) {
    return normalizeSpace(anchor.textContent || anchor.getAttribute("title") || "");
  }

  function isSearchableHref(href) {
    var lowered = normalizeSpace(href).toLowerCase();
    if (!lowered) {
      return false;
    }
    if (lowered.charAt(0) === "#") {
      return false;
    }
    if (lowered.indexOf("javascript:") === 0 || lowered.indexOf("mailto:") === 0 || lowered.indexOf("tel:") === 0) {
      return false;
    }
    return true;
  }

  function prepResources(data) {
    var resources = [];
    if (Array.isArray(data)) {
      resources = data;
    } else if (data && Array.isArray(data.resources)) {
      resources = data.resources;
    }

    resources.forEach(function (resource) {
      var tags = Array.isArray(resource.tags) ? resource.tags : [];
      var externalKeywords = Array.isArray(resource.externalKeywords) ? resource.externalKeywords : [];
      resource.tags = tags;
      resource.externalKeywords = externalKeywords;
      resource._name = normalizeText(resource.name || "");
      resource._category = normalizeText(resource.categoryHeader || resource.category || "");
      resource._page = normalizeText(resource.page || "");
      resource._url = normalizeText(resource.url || "");
      resource._urlKey = normalizeDestinationUrl(resource.url || "");
      resource._content = normalizeText(resource.content || "");
      resource._summary = normalizeText(resource.externalSummary || "");
      resource._tags = normalizeText(tags.join(" "));
      resource._keywords = normalizeText(externalKeywords.join(" "));
      resource._search = normalizeText([
        resource.name || "",
        resource.categoryHeader || resource.category || "",
        resource.page || "",
        resource.url || "",
        resource.content || "",
        resource.externalSummary || "",
        tags.join(" "),
        externalKeywords.join(" "),
      ].join(" "));
    });

    return resources;
  }
  function prepSectionIndex(data) {
    var source = (data && data.sections && typeof data.sections === "object") ? data.sections : data;
    var normalizedIndex = {};

    if (!source || typeof source !== "object") {
      return normalizedIndex;
    }

    Object.keys(source).forEach(function (pageKey) {
      var normalizedPageKey = normalizePagePath(pageKey);
      var categoryMap = source[pageKey];
      if (!categoryMap || typeof categoryMap !== "object") {
        return;
      }

      if (!normalizedIndex[normalizedPageKey]) {
        normalizedIndex[normalizedPageKey] = {};
      }

      Object.keys(categoryMap).forEach(function (categoryKey) {
        var normalizedCategory = normalizeCategoryKey(categoryKey);
        var sectionId = normalizeSpace(categoryMap[categoryKey] || "");
        if (normalizedCategory && sectionId) {
          normalizedIndex[normalizedPageKey][normalizedCategory] = sectionId;
        }
      });
    });

    return normalizedIndex;
  }

  function getParentSectionUrl(resource, sectionIndex) {
    var resourceUrl = normalizeSpace(resource && resource.url ? resource.url : "");
    if (/^\/article\.html\?id=/i.test(resourceUrl)) {
      return buildSitePageUrl(ARTICLE_LIST_PAGE);
    }

    var pagePath = normalizePagePath(resource.page || "");
    var pageUrl = buildSitePageUrl(pagePath);
    var categoryKey = normalizeCategoryKey(resource.categoryHeader || resource.category || "");

    if (!categoryKey) {
      return pageUrl;
    }

    var pageSections = sectionIndex[pagePath] || {};
    var sectionId = pageSections[categoryKey];

    if (sectionId) {
      return pageUrl + "#" + sectionId;
    }

    return pageUrl;
  }

  function attachHiddenTagsToLinks(resources, currentPagePath) {
    var pageKey = normalizeText(currentPagePath);
    var pageResources = resources.filter(function (resource) {
      return normalizeText(resource.page || "") === pageKey;
    });

    if (!pageResources.length) {
      return;
    }

    var byHref = new Map();
    pageResources.forEach(function (resource) {
      var hrefKey = normalizeHrefForMatch(resource.url || "");
      if (!byHref.has(hrefKey)) {
        byHref.set(hrefKey, []);
      }
      byHref.get(hrefKey).push(resource);
    });

    var anchors = document.querySelectorAll("a[href]");
    anchors.forEach(function (anchor) {
      var rawHref = anchor.getAttribute("href") || "";
      if (!isSearchableHref(rawHref)) {
        return;
      }

      var hrefKey = normalizeHrefForMatch(rawHref);
      var candidates = byHref.get(hrefKey);
      if (!candidates || !candidates.length) {
        return;
      }

      var anchorName = normalizeText(getAnchorDisplayName(anchor));
      var selectedIndex = -1;
      var i;
      for (i = 0; i < candidates.length; i += 1) {
        if (normalizeText(candidates[i].name || "") === anchorName) {
          selectedIndex = i;
          break;
        }
      }
      if (selectedIndex === -1) {
        selectedIndex = 0;
      }

      var selected = candidates[selectedIndex];
      candidates.splice(selectedIndex, 1);

      anchor.setAttribute("data-resource-name", selected.name || "");
      anchor.setAttribute("data-resource-page", selected.page || "");
      anchor.setAttribute("data-resource-category", selected.categoryHeader || selected.category || "");
      anchor.setAttribute("data-resource-url", selected.url || "");
      anchor.setAttribute("data-resource-tags", (selected.tags || []).join("|"));
      anchor.classList.add("resource-tagged-link");
    });
  }

  function scoreResource(resource, tokens) {
    var score = 0;

    tokens.forEach(function (token) {
      if (resource._name.indexOf(token) === 0) {
        score += 12;
      } else if (resource._name.indexOf(token) !== -1) {
        score += 7;
      }

      if (resource._tags.indexOf(token) !== -1) {
        score += 5;
      }

      if (resource._keywords.indexOf(token) !== -1) {
        score += 4;
      }

      if (resource._category.indexOf(token) !== -1) {
        score += 4;
      }

      if (resource._summary.indexOf(token) !== -1) {
        score += 2;
      }

      if (resource._content.indexOf(token) !== -1) {
        score += 2;
      }

      if (resource._url.indexOf(token) !== -1) {
        score += 1;
      }
    });

    return score;
  }
    function matchesPriorityTerm(token, term) {
    var cleanToken = normalizeText(token || "").replace(/\s+/g, "");
    var cleanTerm = normalizeText(term || "").replace(/\s+/g, "");

    if (!cleanToken || !cleanTerm) {
      return false;
    }

    return cleanToken === cleanTerm || cleanToken.indexOf(cleanTerm) !== -1 || cleanTerm.indexOf(cleanToken) === 0;
  }

  function shouldApplyPriorityRule(tokens, rule) {
    if (!rule || !Array.isArray(rule.terms) || !rule.terms.length) {
      return false;
    }

    return (tokens || []).some(function (token) {
      return rule.terms.some(function (term) {
        return matchesPriorityTerm(token, term);
      });
    });
  }

  function dedupeByUrlKey(resources) {
    var deduped = [];
    var seen = Object.create(null);
    var i;

    for (i = 0; i < resources.length; i += 1) {
      var resource = resources[i];
      var resourceKey = (resource && resource._urlKey) || "";
      if (resourceKey && seen[resourceKey]) {
        continue;
      }
      if (resourceKey) {
        seen[resourceKey] = true;
      }
      deduped.push(resource);
    }

    return deduped;
  }

  function applyPriorityResources(resources, rankedResources, tokens) {
    var prioritized = (rankedResources || []).slice();
    var sourceResources = resources || [];

    PRIORITY_RULES.forEach(function (rule) {
      if (!shouldApplyPriorityRule(tokens, rule)) {
        return;
      }

      var priorityResource = null;
      var i;

      for (i = 0; i < prioritized.length; i += 1) {
        if (prioritized[i] && prioritized[i]._urlKey === rule.resourceKey) {
          priorityResource = prioritized.splice(i, 1)[0];
          break;
        }
      }

      if (!priorityResource) {
        for (i = 0; i < sourceResources.length; i += 1) {
          if (sourceResources[i] && sourceResources[i]._urlKey === rule.resourceKey) {
            priorityResource = sourceResources[i];
            break;
          }
        }
      }

      if (priorityResource) {
        prioritized.unshift(priorityResource);
      }
    });

    return dedupeByUrlKey(prioritized);
  }

  function searchResources(resources, query) {
    var normalizedQuery = normalizeText(query);
    if (normalizedQuery.length < SEARCH_MIN_CHARS) {
      return [];
    }

    var tokens = normalizedQuery.split(" ").filter(function (token) {
      return token;
    });
    var queryUrlKey = normalizeDestinationUrl(query || "");

    var results = [];
    resources.forEach(function (resource) {
      var matchesAllTokens = tokens.every(function (token) {
        return resource._search.indexOf(token) !== -1;
      });

      var matchesUrlKey = queryUrlKey && resource._urlKey && resource._urlKey.indexOf(queryUrlKey) !== -1;

      if (!matchesAllTokens && !matchesUrlKey) {
        return;
      }

      var score = scoreResource(resource, tokens);
      results.push({ resource: resource, score: score });
    });

    results.sort(function (a, b) {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (a.resource.name || "").localeCompare(b.resource.name || "");
    });

    var rankedResources = results.map(function (item) {
      return item.resource;
    });

    rankedResources = applyPriorityResources(resources, rankedResources, tokens);

    return rankedResources.slice(0, SEARCH_MAX_RESULTS);
  }

  function normalizeDestinationUrl(url) {
    var normalized = normalizeSpace(url || "");
    if (!normalized) {
      return "";
    }

    var candidate = normalized.replace(/&amp;/gi, "&");
    var absoluteCandidate = candidate;

    if (
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(absoluteCandidate) &&
      /^[a-z0-9.-]+\.[a-z]{2,}(?:[\/?#:]|$)/i.test(absoluteCandidate)
    ) {
      absoluteCandidate = "https://" + absoluteCandidate;
    }

    try {
      var parsed = new URL(absoluteCandidate, window.location.href);
      var host = (parsed.hostname || "").toLowerCase().replace(/^www\./, "");
      var path = (parsed.pathname || "/").toLowerCase().replace(/\/+$/, "");
      if (!path) {
        path = "/";
      }

      var queryPairs = [];
      if (parsed.searchParams && typeof parsed.searchParams.forEach === "function") {
        parsed.searchParams.forEach(function (value, key) {
          queryPairs.push((key || "").toLowerCase() + "=" + (value || "").toLowerCase());
        });
      } else if (parsed.search) {
        queryPairs.push(parsed.search.replace(/^\?/, "").toLowerCase());
      }

      queryPairs.sort();

      var canonical = host + path;
      if (queryPairs.length) {
        canonical += "?" + queryPairs.join("&");
      }

      return canonical.replace(/[^a-z0-9]/g, "");
    } catch (error) {
      return candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    }
  }


  function isExternalUrl(url) {
    return /^https?:\/\//i.test(url || "");
  }

  function renderStatus(container, message, extraClass) {
    container.innerHTML = "";
    var status = document.createElement("div");
    status.className = "resource-search-status" + (extraClass ? " " + extraClass : "");
    status.textContent = message;
    container.appendChild(status);
  }

  function createInputEvent() {
    if (typeof Event === "function") {
      return new Event("input", { bubbles: true });
    }

    var legacyEvent = document.createEvent("Event");
    legacyEvent.initEvent("input", true, true);
    return legacyEvent;
  }

  function appendTagToSearchInput(input, tagText) {
    var cleanTag = normalizeSpace(tagText || "");
    if (!cleanTag || !input) {
      return;
    }

    var currentValue = normalizeSpace(input.value || "");
    var nextValue = currentValue;

    if (!currentValue) {
      nextValue = cleanTag;
    } else {
      var existing = " " + currentValue.toLowerCase() + " ";
      var candidate = " " + cleanTag.toLowerCase() + " ";
      if (existing.indexOf(candidate) === -1) {
        nextValue = currentValue + " " + cleanTag;
      }
    }

    input.value = nextValue;
    input.dispatchEvent(createInputEvent());
    input.focus();
  }

  function renderResults(container, results, query, sectionIndex) {
    if (!query || normalizeText(query).length < SEARCH_MIN_CHARS) {
      container.innerHTML = "";
      container.classList.add("hidden");
      return;
    }

    if (!results.length) {
      renderStatus(container, "No resources matched your search.");
      container.classList.remove("hidden");
      return;
    }

    container.innerHTML = "";

    var list = document.createElement("ul");
    list.className = "resource-search-list";

    results.forEach(function (resource) {
      var item = document.createElement("li");
      item.className = "resource-search-item";

      var link = document.createElement("a");
      link.className = "resource-search-link";
      link.href = resource.url || "#";
      link.textContent = resource.name || resource.url || "Resource";
      if (isExternalUrl(resource.url || "")) {
        link.target = "_blank";
        link.rel = "noopener";
      }
      item.appendChild(link);

      var meta = document.createElement("div");
      meta.className = "resource-search-meta";

      var parentLink = document.createElement("a");
      parentLink.className = "resource-search-parent-link";
      parentLink.href = getParentSectionUrl(resource, sectionIndex || {});
      parentLink.textContent = resource.categoryHeader || resource.category || "General";
      parentLink.title = "Open section on parent page";
      meta.appendChild(parentLink);

      item.appendChild(meta);

      var summaryText = normalizeSpace(resource.externalSummary || resource.content || "");
      if (summaryText) {
        var summary = document.createElement("div");
        summary.className = "resource-search-summary";
        summary.textContent = summaryText;
        item.appendChild(summary);
      }

      var tags = document.createElement("div");
      tags.className = "resource-search-tags";

      var tagsLabel = document.createElement("span");
      tagsLabel.className = "resource-search-tags-label";
      tagsLabel.textContent = "Tags:";
      tags.appendChild(tagsLabel);

      (resource.tags || []).slice(0, 10).forEach(function (tagValue, index) {
        if (index > 0) {
          tags.appendChild(document.createTextNode(" | "));
        } else {
          tags.appendChild(document.createTextNode(" "));
        }

        var tagButton = document.createElement("button");
        tagButton.type = "button";
        tagButton.className = "resource-search-tag";
        tagButton.setAttribute("data-tag", tagValue);
        tagButton.textContent = tagValue;
        tags.appendChild(tagButton);
      });

      item.appendChild(tags);

      list.appendChild(item);
    });

    container.appendChild(list);
    container.classList.remove("hidden");
  }
  function initSearch(resources, sectionIndex) {
    var input = document.getElementById("resource-search-input");
    var resultsContainer = document.getElementById("resource-search-results");
    if (!input || !resultsContainer) {
      return;
    }

    resultsContainer.innerHTML = "";
    resultsContainer.classList.add("hidden");

    var onInput = function () {
      var query = input.value || "";
      var results = searchResources(resources, query);
      renderResults(resultsContainer, results, query, sectionIndex);
    };

    input.addEventListener("input", onInput);

    resultsContainer.addEventListener("click", function (event) {
      var tagButton = event.target;
      if (!tagButton || !tagButton.classList || !tagButton.classList.contains("resource-search-tag")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      appendTagToSearchInput(input, tagButton.getAttribute("data-tag") || tagButton.textContent || "");
    });
  }
  function createEmptySectionIndexPayload() {
    return { sections: {} };
  }

  function loadJsonWithCache(path, fallbackFactory) {
    var hasFallback = typeof fallbackFactory === "function";

    function fallbackValue() {
      return hasFallback ? fallbackFactory() : null;
    }

    return getSharedJsonText(path)
      .then(function (jsonText) {
        return JSON.parse(jsonText);
      })
      .catch(function (error) {
        if (hasFallback) {
          return fallbackValue();
        }
        throw error;
      });
  }

  function bootstrap() {
    var currentPagePath = getCurrentPagePath();
    var indexPath = getResourceIndexPath(currentPagePath);
    var sectionIndexPath = getSectionIndexPath(currentPagePath);

    var resourcesPromise = loadJsonWithCache(indexPath);
    var sectionIndexPromise = loadJsonWithCache(sectionIndexPath, createEmptySectionIndexPayload);
    var articlesPromise = loadJsonWithCache(ARTICLE_MANIFEST_URL, createEmptyArticleManifestPayload);

    Promise.all([resourcesPromise, sectionIndexPromise, articlesPromise])
      .then(function (values) {
        var mergedIndex = mergeArticleResourcesIntoIndex(values[0], values[2]);
        var resources = prepResources(mergedIndex);
        var sectionIndex = prepSectionIndex(values[1]);
        attachHiddenTagsToLinks(resources, currentPagePath);
        initSearch(resources, sectionIndex);
      })
      .catch(function (error) {
        var resultsContainer = document.getElementById("resource-search-results");
        if (resultsContainer) {
          renderStatus(resultsContainer, "Resource search index failed to load.", "error");
        }
        if (window.console && typeof console.error === "function") {
          console.error(error);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();








