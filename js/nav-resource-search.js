(function () {
  "use strict";

  var SEARCH_MIN_CHARS = 2;
  var SEARCH_MAX_RESULTS = 30;
  var PRIORITY_RULES = [
    { resourceKey: "bitcoindiscordcom", terms: ["help", "discord", "chat", "support"] },
    { resourceKey: "knotsliescom", terms: ["knots", "bip110"] },
  ];
  var RESULT_TEMPLATE_NAME = "nav-search-result-item.html";

  var resultTemplate = "";
  var templateLoading = false;
  var templateCallbacks = [];
  var resourceIndex = [];

  function normalizeSpace(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeText(value) {
    return normalizeSpace((value || "").toLowerCase().replace(/[^a-z0-9+#'\-]+/g, " "));
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
  function getNavSearchQueryParam() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      if (!params.has("s")) {
        return null;
      }
      return params.get("s");
    } catch (error) {
      var search = window.location.search || "";
      var match = search.match(/[?&]s=([^&]*)/i);
      if (!match) {
        return null;
      }
      try {
        return decodeURIComponent(match[1].replace(/\+/g, " "));
      } catch (decodeError) {
        return match[1];
      }
    }
  }

  function isExternalUrl(url) {
    return /^https?:\/\//i.test(url || "");
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
        externalKeywords.join(" ")
      ].join(" "));
    });

    return resources;
  }
  function scoreResource(resource, tokens) {
    var score = 0;

    tokens.forEach(function (token) {
      if (resource._name.indexOf(token) === 0) {
        score += 12;
      } else if (resource._name.indexOf(token) !== -1) {
        score += 8;
      }

      if (resource._tags.indexOf(token) !== -1) {
        score += 6;
      }

      if (resource._keywords.indexOf(token) !== -1) {
        score += 5;
      }

      if (resource._category.indexOf(token) !== -1) {
        score += 4;
      }

      if (resource._summary.indexOf(token) !== -1 || resource._content.indexOf(token) !== -1) {
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

      results.push({ resource: resource, score: scoreResource(resource, tokens) });
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


  function ensureTemplateLoaded(callback) {
    if (resultTemplate) {
      callback(resultTemplate);
      return;
    }

    templateCallbacks.push(callback);

    if (templateLoading) {
      return;
    }

    templateLoading = true;
    TemplateEngine.LoadTemplate(RESULT_TEMPLATE_NAME, function (templateText) {
      resultTemplate = templateText || "";
      templateLoading = false;

      var pending = templateCallbacks.slice();
      templateCallbacks = [];
      pending.forEach(function (cb) {
        cb(resultTemplate);
      });
    });
  }

  function mapResultViewModel(resource) {
    var tags = Array.isArray(resource.tags) ? resource.tags : [];
    var summary = normalizeSpace(resource.externalSummary || resource.content || "");
    var displayName = normalizeSpace(resource.name || resource.content || "");
    var linkAttributes = isExternalUrl(resource.url || "") ? 'target="_blank" rel="noopener"' : "";

    if (!displayName || isExternalUrl(displayName)) {
      displayName = "Resource";
    }

    return {
      name: displayName,
      url: resource.url || "#",
      categoryHeader: resource.categoryHeader || resource.category || "General",
      page: resource.page || "",
      summary: summary || "No summary available.",
      tagsDisplay: tags.slice(0, 10).join(" | "),
      linkAttributes: linkAttributes
    };
  }

  function showStatus(message, statusClass) {
    var list = document.getElementById("nav-resource-search-results-list");
    var panel = document.getElementById("nav-resource-search-results");
    if (!list || !panel) {
      return;
    }

    list.innerHTML = "<li class=\"nav-resource-result-status " + (statusClass || "") + "\">" + message + "</li>";
    panel.classList.remove("hidden");
  }

  function hideResults() {
    var panel = document.getElementById("nav-resource-search-results");
    if (panel) {
      panel.classList.add("hidden");
    }
  }

  function renderResults(results, query) {
    var list = document.getElementById("nav-resource-search-results-list");
    var panel = document.getElementById("nav-resource-search-results");

    if (!list || !panel) {
      return;
    }

    if (!query || normalizeText(query).length < SEARCH_MIN_CHARS) {
      hideResults();
      return;
    }

    if (!results.length) {
      showStatus("No resources matched your search.", "empty");
      return;
    }

    ensureTemplateLoaded(function (templateText) {
      var html = "";
      results.forEach(function (resource) {
        var viewModel = mapResultViewModel(resource);
        html += TemplateEngine.ParseAndReplace(templateText, {}, viewModel);
      });

      list.innerHTML = html;
      panel.classList.remove("hidden");
    });
  }
  function bindSearchUi() {
    var input = document.getElementById("nav-resource-search-input");
    var shell = document.getElementById("nav-resource-search-shell");
    var panel = document.getElementById("nav-resource-search-results");
    var toggleButton = document.getElementById("nav-resource-search-toggle");
    var navContainer = document.getElementById("myDefaultNavbar1");
    var navRoot = toggleButton.closest ? toggleButton.closest(".navbar") : document.querySelector(".navbar");
    if (!navRoot) {
      navRoot = document.querySelector(".navbar");
    }
    if (!input || !shell || !panel || !toggleButton || !navContainer) {
      return;
    }

    function isMobileSearchLayout() {
      return !!window.matchMedia && window.matchMedia("(max-width: 767px)").matches;
    }

    function clearMobileSearchPositioning() {
      shell.style.top = "";
      shell.style.left = "";
      shell.style.right = "";
      panel.style.top = "";
      panel.style.left = "";
      panel.style.right = "";
      panel.style.width = "";
    }

    function positionMobileSearchUi() {
      if (!isMobileSearchLayout()) {
        clearMobileSearchPositioning();
        return;
      }

      var navRect = navContainer.getBoundingClientRect();
      var toggleRect = toggleButton.getBoundingClientRect();
      var shellTop = Math.max(0, Math.round(toggleRect.top - navRect.top));

      shell.style.top = shellTop + "px";
      shell.style.left = "0";
      shell.style.right = "0";

      var panelTop = shellTop + shell.offsetHeight;
      panel.style.top = panelTop + "px";
      panel.style.left = "0";
      panel.style.right = "0";
      panel.style.width = "auto";
    }
    function setBrandOverlayState(isOpen) {
      if (!navRoot) {
        return;
      }
      if (isOpen) {
        navRoot.classList.add("nav-search-overlay-open");
      } else {
        navRoot.classList.remove("nav-search-overlay-open");
      }
    }

    function openSearch() {
      shell.classList.remove("hidden");
      navContainer.classList.add("nav-search-open");
      setBrandOverlayState(true);
      toggleButton.setAttribute("aria-expanded", "true");

      positionMobileSearchUi();

      setTimeout(function () {
        positionMobileSearchUi();
        input.focus();
      }, 0);

      var query = input.value || "";
      if (normalizeText(query).length >= SEARCH_MIN_CHARS) {
        var results = searchResources(resourceIndex, query);
        renderResults(results, query);
      }
    }

    function closeSearch(clearValue) {
      hideResults();
      shell.classList.add("hidden");
      navContainer.classList.remove("nav-search-open");
      setBrandOverlayState(false);
      toggleButton.setAttribute("aria-expanded", "false");
      clearMobileSearchPositioning();
      if (clearValue) {
        input.value = "";
      }
    }

    toggleButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (shell.classList.contains("hidden")) {
        openSearch();
      } else {
        closeSearch(true);
      }
    });

    input.addEventListener("input", function () {
      var query = input.value || "";
      var results = searchResources(resourceIndex, query);
      renderResults(results, query);
    });

    input.addEventListener("focus", function () {
      var query = input.value || "";
      if (normalizeText(query).length >= SEARCH_MIN_CHARS) {
        var results = searchResources(resourceIndex, query);
        renderResults(results, query);
      }
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeSearch(true);
      }
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        if (isMobileSearchLayout()) {
          closeSearch(false);
          return;
        }

        var activeElement = document.activeElement;
        if (
          shell.contains(activeElement) ||
          panel.contains(activeElement) ||
          activeElement === toggleButton
        ) {
          return;
        }
        closeSearch(false);
      }, 120);
    });

    document.addEventListener("click", function (event) {
      if (
        shell.contains(event.target) ||
        panel.contains(event.target) ||
        event.target === toggleButton ||
        toggleButton.contains(event.target)
      ) {
        return;
      }
      closeSearch(false);
    });

    panel.addEventListener("click", function () {
      closeSearch(false);
    });

    window.addEventListener("resize", function () {
      if (!shell.classList.contains("hidden")) {
        positionMobileSearchUi();
      } else {
        clearMobileSearchPositioning();
      }
    });

    var initialQuery = getNavSearchQueryParam();
    if (initialQuery !== null) {
      input.value = initialQuery;
      openSearch();

      var initialResults = searchResources(resourceIndex, initialQuery);
      renderResults(initialResults, initialQuery);

      setTimeout(function () {
        input.focus();
      }, 0);
    }
  }
  function loadResourceIndex(indexPath) {
    return fetch(indexPath)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load resource index: HTTP " + response.status);
        }
        return response.json();
      });
  }

  function bootstrap() {
    var currentPagePath = getCurrentPagePath();
    var indexPath = getResourceIndexPath(currentPagePath);

    loadResourceIndex(indexPath)
      .then(function (data) {
        resourceIndex = prepResources(data);
        bindSearchUi();
      })
      .catch(function () {
        showStatus("Resource index failed to load.", "error");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();







