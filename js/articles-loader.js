(function () {
  "use strict";

  window.articleFeedItems = [];
  window.articleFeedErrorMessage = "";

  function setStatus(message) {
    var statusNode = document.getElementById("article-feed-status");
    if (statusNode) {
      statusNode.textContent = message;
      statusNode.classList.remove("hidden");
    }
  }

  function hideStatus() {
    var statusNode = document.getElementById("article-feed-status");
    if (statusNode) {
      statusNode.classList.add("hidden");
    }
  }

  function setCount(count) {
    var countNode = document.getElementById("article-feed-count");
    if (countNode) {
      countNode.textContent = String(count);
    }
  }

  function syncFetchJson(url) {
    var request = new XMLHttpRequest();
    request.open("GET", url + (url.indexOf("?") === -1 ? "?" : "&") + "_ts=" + Date.now(), false);
    request.send(null);

    if (request.status < 200 || request.status >= 300) {
      throw new Error("status=" + request.status);
    }

    return JSON.parse(request.responseText);
  }

  function normalizeManifestEntries(manifest) {
    if (!manifest || typeof manifest !== "object" || !manifest.articles || typeof manifest.articles !== "object") {
      return [];
    }

    var entries = [];
    for (var id in manifest.articles) {
      if (!Object.prototype.hasOwnProperty.call(manifest.articles, id)) {
        continue;
      }

      var item = manifest.articles[id];
      if (!item || typeof item !== "object") {
        continue;
      }

      var filename = String(item.filename || "").trim();
      if (!filename) {
        continue;
      }

      entries.push({
        id: String(id || "").trim(),
        filename: filename,
        timestamp: String(item.timestamp || "").trim()
      });
    }

    return entries;
  }

  function parsePostedTimestamp(value) {
    if (value == null) {
      return 0;
    }

    var date = new Date(value);
    var timestamp = date.getTime();
    return isNaN(timestamp) ? 0 : timestamp;
  }

  function loadFeedItemsSync(utils, subdirectory) {
    var manifest = syncFetchJson(utils.ARTICLE_MANIFEST_URL);
    var entries = normalizeManifestEntries(manifest);
    var items = [];
    var byId = {};

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var sourceUrl = utils.buildRawArticleFileUrl(entry.filename);
      if (!sourceUrl) {
        continue;
      }

      try {
        var articleJson = syncFetchJson(sourceUrl);
        var model = utils.buildArticleFeedModel(articleJson, entry.id, subdirectory);
        if (!model || !model.id || !utils.isValidUuid(model.id) || byId[model.id]) {
          continue;
        }

        if (!model.publishedTimestamp) {
          model.publishedTimestamp = parsePostedTimestamp(model.article_time || entry.timestamp);
        }

        byId[model.id] = true;
        items.push(model);
      } catch (error) {
      }
    }

    items.sort(function (a, b) {
      return Number(b.publishedTimestamp || 0) - Number(a.publishedTimestamp || 0);
    });

    return items;
  }

  function initializeFeedDataSync() {
    var utils = window.BtcArticleUtils;
    if (!utils) {
      window.articleFeedItems = [];
      window.articleFeedErrorMessage = "Unable to load article utilities.";
      return;
    }

    try {
      var subdirectory = (window.TemplateEngine && TemplateEngine.settings && TemplateEngine.settings.SUBDIRECTORY) || "";
      window.articleFeedItems = loadFeedItemsSync(utils, subdirectory);

      window.TemplateEngine.ParseAndReplace("{{foreach articleFeedItems loadtemplate article-feed-item-template.html at article-feed-list callback onArticleFeedRendered}}");

      if (!window.articleFeedItems.length) {
        window.articleFeedErrorMessage = "No articles were found in the article repository.";
      }
    } catch (error) {
      window.articleFeedItems = [];
      window.articleFeedErrorMessage = "Unable to load articles from the repository.";
    }
  }

  window.onArticleFeedRendered = function () {
    var listNode = document.getElementById("article-feed-list");
    var count = Array.isArray(window.articleFeedItems) ? window.articleFeedItems.length : 0;
    setCount(count);

    if (!count) {
      if (listNode) {
        listNode.classList.add("hidden");
      }
      setStatus(window.articleFeedErrorMessage || "No articles were found in the article repository.");
      return;
    }

    hideStatus();
  };

  initializeFeedDataSync();
})();
