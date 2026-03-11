(function () {
  "use strict";

  window.currentArticle = null;

  function makeErrorModel(title, detail) {
    return {
      id: "",
      title: title,
      content: "",
      article_time: "",
      authors: [
        {
          username: "",
          image: ""
        }
      ],
      authorSearchHref: "#",
      publishedIso: "",
      publishedDisplay: "",
      publishedTimestamp: 0,
      contentHtml: "<p>" + detail + "</p>",
      disclaimer: (window.BtcArticleUtils && window.BtcArticleUtils.DEFAULT_DISCLAIMER) || "",
      commentsHref: "#"
    };
  }

  function setPageTitleFromModel(model) {
    var pageTitle = document.getElementById("article-page-title");
    var title = model && model.title ? model.title : "Article";

    document.title = "BTCMaxis.com :: " + title;

    if (pageTitle) {
      pageTitle.textContent = title;
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

  function loadArticleModelSync() {
    var utils = window.BtcArticleUtils;
    if (!utils) {
      return makeErrorModel("Article Error", "Article utilities failed to load.");
    }

    var id = utils.getSearchParam("id");
    if (!id) {
      return makeErrorModel("Missing Article ID", "No id query parameter was provided. Use article.html?id=UUID.");
    }

    if (!utils.isValidUuid(id)) {
      return makeErrorModel("Invalid Article ID", "The id query parameter must be a UUID string.");
    }

    try {
      var rawArticle = syncFetchJson(utils.buildRawArticleUrl(id));
      return utils.buildArticleTemplateModel(rawArticle, id);
    } catch (error) {
      return makeErrorModel("Unable To Load Article", "The requested article could not be loaded from the article repository.");
    }
  }

  window.onArticleTemplateRendered = function () {
    var status = document.getElementById("article-load-status");

    if (status) {
      status.classList.add("hidden");
    }

    setPageTitleFromModel(window.currentArticle);
  };

  window.currentArticle = loadArticleModelSync();
  setPageTitleFromModel(window.currentArticle);
})();


