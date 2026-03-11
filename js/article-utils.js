(function () {
  "use strict";

  var ARTICLE_REPO_RAW_ROOT = "https://raw.githubusercontent.com/MrRGnome/articles/refs/heads/master/";
  var ARTICLE_BASE_URL = ARTICLE_REPO_RAW_ROOT + "articles/";
  var ARTICLE_LIST_URL = "https://api.github.com/repos/MrRGnome/articles/contents/articles?ref=master";
  var ARTICLE_MANIFEST_URL = ARTICLE_REPO_RAW_ROOT + "articles.json";
  var DEFAULT_DISCLAIMER = "Authors views are their own and BTCMAXI neither as a community nor website holds any responsibility for their contents, which may or may not be copyrighted and have rights reserved.";
  var UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  function getSearchParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (error) {
      return null;
    }
  }

  function isValidUuid(value) {
    return UUID_PATTERN.test(String(value || "").trim());
  }

  function buildRawArticleUrl(id) {
    return ARTICLE_BASE_URL + encodeURIComponent(String(id || "").trim()) + ".json";
  }

  function buildRawArticleFileUrl(filePath) {
    var relativePath = String(filePath || "").trim().replace(/^\.\//, "").replace(/^\/+/, "");
    if (!relativePath) {
      return "";
    }
    return ARTICLE_REPO_RAW_ROOT + relativePath;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeUrl(value) {
    var url = String(value || "").trim();
    if (!url) {
      return "";
    }

    if (/^www\./i.test(url)) {
      return "https://" + url;
    }

    if (/^(https?:)?\/\//i.test(url) || /^\//.test(url) || /^\./.test(url)) {
      return url;
    }

    return "";
  }

  function isImageUrl(url) {
    return /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?|heic|heif)(?:[?#].*)?$/i.test(String(url || ""));
  }

  function parseImageTitle(rawTitle) {
    var title = String(rawTitle || "").trim();
    var width = "";
    var height = "";

    if (title) {
      var sizeMatch = title.match(/(?:^|\s|\|)(\d{2,4})\s*[xX]\s*(\d{2,4})(?:\s|$)/);
      if (sizeMatch) {
        width = sizeMatch[1];
        height = sizeMatch[2];
        title = title.replace(sizeMatch[0], " ").replace(/\s+/g, " ").trim();
        title = title.replace(/^\|\s*|\s*\|$/g, "");
      }
    }

    return {
      title: title,
      width: width,
      height: height
    };
  }

  function buildImageTag(url, alt, title) {
    var safeUrl = sanitizeUrl(url);
    if (!safeUrl) {
      return "";
    }

    var safeAlt = escapeHtml(alt || "");
    var imageMeta = parseImageTitle(title);
    var titleAttr = imageMeta.title ? " title=\"" + escapeHtml(imageMeta.title) + "\"" : "";
    var widthAttr = imageMeta.width ? " width=\"" + imageMeta.width + "\"" : "";
    var heightAttr = imageMeta.height ? " height=\"" + imageMeta.height + "\"" : "";

    return "<img class=\"article-content-image\" src=\"" + safeUrl + "\" alt=\"" + safeAlt + "\"" + titleAttr + widthAttr + heightAttr + " loading=\"lazy\" decoding=\"async\">";
  }

  function buildFigureHtml(url, alt, title, captionOverride) {
    var imgTag = buildImageTag(url, alt, title);
    if (!imgTag) {
      return "";
    }

    var imageMeta = parseImageTitle(title);
    var captionText = captionOverride != null ? String(captionOverride).trim() : imageMeta.title;
    var caption = captionText ? "<figcaption>" + escapeHtml(captionText) + "</figcaption>" : "";

    return "<figure class=\"article-figure\">" + imgTag + caption + "</figure>";
  }

  function normalizeImageUrl(value) {
    var url = String(value || "").trim();
    if (!url) {
      return "";
    }

    if (/^(https?:)?\/\//i.test(url) || /^\//.test(url) || /^data:/i.test(url)) {
      return url;
    }

    return url.replace(/^\.\//, "");
  }


  function formatPublishedDate(value) {
    var raw = String(value || "").trim();
    if (!raw) {
      return {
        iso: "",
        display: "Unknown date",
        sortTimestamp: 0
      };
    }

    var date = new Date(raw);
    if (!isNaN(date.getTime())) {
      return {
        iso: date.toISOString().slice(0, 10),
        display: date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        }),
        sortTimestamp: date.getTime()
      };
    }

    return {
      iso: "",
      display: raw,
      sortTimestamp: 0
    };
  }

  function autoLinkRawUrls(text) {
    return text.replace(/(^|[\s(>])((?:https?:\/\/|www\.)[^\s<]+)/gi, function (match, prefix, urlText) {
      var cleanUrl = urlText;
      var trailing = "";

      while (/[),.!?:;]$/.test(cleanUrl)) {
        if (/&[a-zA-Z0-9#]+;$/.test(cleanUrl)) {
          break;
        }
        trailing = cleanUrl.slice(-1) + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
      }

      var href = sanitizeUrl(cleanUrl);
      if (!href) {
        return match;
      }

      if (isImageUrl(href)) {
        var rawImageTag = buildImageTag(href, "Article image", "");
        return rawImageTag ? (prefix + rawImageTag + trailing) : match;
      }

      return prefix + "<a href=\"" + href + "\" target=\"_blank\" rel=\"noopener\">" + cleanUrl + "</a>" + trailing;
    });
  }

  function applyInlineMarkdown(text) {
    var escaped = escapeHtml(text);
    var codeSpans = [];
    var htmlTokens = [];

    function tokenFor(html) {
      var token = "@@HTML_" + htmlTokens.length + "@@";
      htmlTokens.push(html);
      return token;
    }

    escaped = escaped.replace(/`([^`]+)`/g, function (match, code) {
      var token = "@@CODE_" + codeSpans.length + "@@";
      codeSpans.push("<code>" + code + "</code>");
      return token;
    });

    escaped = escaped.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)/g, function (match, alt, url, title) {
      var imageTag = buildImageTag(url, alt, title);
      if (!imageTag) {
        return "";
      }
      return tokenFor(imageTag);
    });

    escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)/g, function (match, label, url, title) {
      if (isImageUrl(url)) {
        var linkedImageTag = buildImageTag(url, label, title);
        if (linkedImageTag) {
          return tokenFor(linkedImageTag);
        }
      }

      var safeUrl = sanitizeUrl(url);
      if (!safeUrl) {
        return escapeHtml(label);
      }
      var safeLabel = label;
      var safeTitle = title ? " title=\"" + escapeHtml(title) + "\"" : "";
      return tokenFor("<a href=\"" + safeUrl + "\" target=\"_blank\" rel=\"noopener\"" + safeTitle + ">" + safeLabel + "</a>");
    });

    escaped = autoLinkRawUrls(escaped);

    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    escaped = escaped.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    escaped = escaped.replace(/@@HTML_(\d+)@@/g, function (match, index) {
      return htmlTokens[Number(index)] || "";
    });

    escaped = escaped.replace(/@@CODE_(\d+)@@/g, function (match, index) {
      return codeSpans[Number(index)] || "";
    });

    return escaped;
  }

  function isMarkdownBlockStart(line) {
    var trimmed = String(line || "").trim();
    return (
      /^```/.test(trimmed) ||
      /^#{1,6}\s+/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^\s*[-*+]\s+/.test(trimmed) ||
      /^\s*\d+\.\s+/.test(trimmed) ||
      /^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed) ||
      /^!\[[^\]]*\]\(([^)]+)\)$/.test(trimmed) ||
      (/^\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]+\")?\)$/.test(trimmed) && isImageUrl(trimmed.replace(/^\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]+\")?\)$/, "$1"))) ||
      (/^(https?:\/\/[^\s]+|www\.[^\s]+)$/i.test(trimmed) && isImageUrl(trimmed))
    );
  }

  function parseList(lines, startIndex) {
    var ordered = /^\s*\d+\.\s+/.test(lines[startIndex]);
    var tag = ordered ? "ol" : "ul";
    var html = ["<" + tag + ">"];
    var i = startIndex;

    while (i < lines.length) {
      var line = lines[i];
      var match = ordered
        ? line.match(/^\s*\d+\.\s+(.*)$/)
        : line.match(/^\s*[-*+]\s+(.*)$/);

      if (!match) {
        break;
      }

      html.push("<li>" + applyInlineMarkdown(match[1].trim()) + "</li>");
      i++;
    }

    html.push("</" + tag + ">");

    return {
      html: html.join(""),
      nextIndex: i
    };
  }

  function parseImageLine(line) {
    var trimmed = String(line || "").trim();
    var markdownImageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)$/);
    if (markdownImageMatch) {
      return buildFigureHtml(markdownImageMatch[2], markdownImageMatch[1], markdownImageMatch[3], null);
    }

    var markdownLinkMatch = trimmed.match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]+)\")?\)$/);
    if (markdownLinkMatch && isImageUrl(markdownLinkMatch[2])) {
      return buildFigureHtml(markdownLinkMatch[2], markdownLinkMatch[1], markdownLinkMatch[3], null);
    }

    var rawUrl = trimmed.match(/^(https?:\/\/[^\s]+|www\.[^\s]+)$/i);
    if (rawUrl) {
      var cleanRawUrl = rawUrl[1];
      while (/[),.!?:;]$/.test(cleanRawUrl)) {
        if (/&[a-zA-Z0-9#]+;$/.test(cleanRawUrl)) {
          break;
        }
        cleanRawUrl = cleanRawUrl.slice(0, -1);
      }
      if (isImageUrl(cleanRawUrl)) {
        return buildFigureHtml(cleanRawUrl, "Article image", "", "");
      }
    }

    return "";
  }

  function markdownToHtml(markdownText) {
    var markdown = String(markdownText || "").replace(/\r\n/g, "\n");
    var lines = markdown.split("\n");
    var html = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      if (/^```/.test(trimmed)) {
        var language = trimmed.replace(/^```\s*/, "");
        var codeLines = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length && /^```/.test(lines[i].trim())) {
          i++;
        }

        var className = language ? " class=\"language-" + escapeHtml(language) + "\"" : "";
        html.push("<pre><code" + className + ">" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
        continue;
      }

      var heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        var level = heading[1].length;
        html.push("<h" + level + ">" + applyInlineMarkdown(heading[2]) + "</h" + level + ">");
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
        html.push("<hr>");
        i++;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        html.push("<blockquote class=\"article-blockquote\">" + markdownToHtml(quoteLines.join("\n")) + "</blockquote>");
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        var listResult = parseList(lines, i);
        html.push(listResult.html);
        i = listResult.nextIndex;
        continue;
      }

      var imageHtml = parseImageLine(trimmed);
      if (imageHtml) {
        html.push(imageHtml);
        i++;
        continue;
      }

      var paragraphParts = [trimmed];
      i++;
      while (i < lines.length) {
        var nextLine = lines[i];
        var nextTrimmed = nextLine.trim();
        if (!nextTrimmed || isMarkdownBlockStart(nextTrimmed)) {
          break;
        }
        paragraphParts.push(nextTrimmed);
        i++;
      }

      html.push("<p>" + applyInlineMarkdown(paragraphParts.join(" ")) + "</p>");
    }

    return html.join("\n");
  }

    function appendReadMoreToPreview(previewHtml, articleHref) {
    var base = String(previewHtml || "").trim();
    var href = sanitizeUrl(articleHref) || articleHref;
    var suffix = "... <a href=\"" + href + "\">Read More</a>";

    if (!base) {
      return "<p>" + suffix + "</p>";
    }

    var tags = ["p", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"];
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var re = new RegExp("</" + tag + ">\\s*$", "i");
      if (re.test(base)) {
        return base.replace(re, suffix + "</" + tag + ">");
      }
    }

    return base + suffix;
  }
  function cloneObject(source) {
    var output = {};
    if (!source || typeof source !== "object") {
      return output;
    }

    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        output[key] = source[key];
      }
    }

    return output;
  }

  function normalizeAuthorsList(sourceAuthors) {
    var normalized = [];
    var authors = Array.isArray(sourceAuthors) ? sourceAuthors : [];

    for (var i = 0; i < authors.length; i++) {
      var author = authors[i];
      if (!author || typeof author !== "object") {
        continue;
      }

      normalized.push({
        username: String(author.username || "").trim(),
        image: normalizeImageUrl(author.image)
      });
    }

    if (!normalized.length) {
      normalized.push({
        username: "",
        image: ""
      });
    }

    return normalized;
  }

  function buildArticleTemplateModel(source, fallbackId) {
    var article = cloneObject(source);
    article.id = String(article.id || fallbackId || "").trim();
    article.title = String(article.title || "").trim();
    article.content = typeof article.content === "string" ? article.content : "";
    article.article_time = String(article.article_time || "").trim();
    article.authors = normalizeAuthorsList(article.authors);
    article.authorSearchHref = "/?s=" + encodeURIComponent(article.authors[0].username);
    article.forum_post_url = sanitizeUrl(article.forum_post_url);

    var published = formatPublishedDate(article.article_time);
    article.publishedIso = published.iso;
    article.publishedDisplay = published.display;
    article.publishedTimestamp = published.sortTimestamp;
    article.contentHtml = markdownToHtml(article.content);

    article.disclaimer = DEFAULT_DISCLAIMER;
    article.commentsHref = article.forum_post_url || "#";
    return article;
  }

  function buildArticleFeedModel(source, fallbackId, subdirectory) {
    var article = buildArticleTemplateModel(source, fallbackId);
    var previewSource = article.content ? article.content.slice(0, 1000).trim() : "Open this article to read the full post.";
    var basePath = String(subdirectory || "");
    article.articleHref = basePath + "/article.html?id=" + encodeURIComponent(article.id || fallbackId || "");
    article.previewHtml = appendReadMoreToPreview(markdownToHtml(previewSource), article.articleHref);
    return article;
  }

  window.BtcArticleUtils = {
    ARTICLE_REPO_RAW_ROOT: ARTICLE_REPO_RAW_ROOT,
    ARTICLE_LIST_URL: ARTICLE_LIST_URL,
    ARTICLE_MANIFEST_URL: ARTICLE_MANIFEST_URL,
    DEFAULT_DISCLAIMER: DEFAULT_DISCLAIMER,
    getSearchParam: getSearchParam,
    isValidUuid: isValidUuid,
    buildRawArticleUrl: buildRawArticleUrl,
    buildRawArticleFileUrl: buildRawArticleFileUrl,
    buildArticleTemplateModel: buildArticleTemplateModel,
    buildArticleFeedModel: buildArticleFeedModel,
    markdownToHtml: markdownToHtml
  };
})();

































