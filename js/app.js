(function () {
  "use strict";

  var book = window.BOOK;
  var app = document.getElementById("app");

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderHome() {
    var items = book.chapters.map(function (c) {
      return (
        '<li><a class="chapter-card" href="#/' + c.no + '">' +
        '<span class="chapter-no">第 ' + c.no + ' 段</span>' +
        '<span class="chapter-title">' + esc(c.title) + "</span>" +
        '<span class="chapter-era">' + esc(c.era) + "</span>" +
        "</a></li>"
      );
    }).join("");

    app.innerHTML =
      '<section class="hero">' +
      "<h1>" + esc(book.title) + "</h1>" +
      '<p class="subtitle">' + esc(book.subtitle) + "</p>" +
      '<p class="author">' + esc(book.author) + "・白話改寫</p>" +
      '<p class="intro">' + esc(book.intro) + "</p>" +
      "</section>" +
      '<ol class="chapter-list">' + items + "</ol>";
    document.title = "KarmaStory・" + book.title;
  }

  function renderChapter(no) {
    var list = book.chapters;
    var idx = list.findIndex(function (c) { return c.no === no; });
    if (idx < 0) { renderHome(); return; }
    var c = list[idx];
    var prev = list[idx - 1];
    var next = list[idx + 1];

    var body = c.paragraphs.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");

    app.innerHTML =
      '<article class="story">' +
      '<a class="back" href="#/">← 回目錄</a>' +
      '<p class="progress">第 ' + c.no + " / " + list.length + " 段・" + esc(c.era) + "</p>" +
      "<h1>" + esc(c.title) + "</h1>" +
      '<div class="story-body">' + body + "</div>" +
      '<aside class="reflect"><span>思惟一下</span><p>' + esc(c.reflect) + "</p></aside>" +
      '<nav class="pager">' +
      (prev ? '<a href="#/' + prev.no + '">← ' + esc(prev.title) + "</a>" : "<span></span>") +
      (next ? '<a href="#/' + next.no + '">' + esc(next.title) + " →</a>" : '<a href="#/">回目錄</a>') +
      "</nav>" +
      "</article>";
    document.title = c.title + "・" + book.title;
  }

  function route() {
    var m = location.hash.match(/^#\/(\d+)$/);
    if (m) renderChapter(parseInt(m[1], 10));
    else renderHome();
    window.scrollTo(0, 0);
  }

  // 深淺色切換
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("theme");
    if (saved) root.setAttribute("data-theme", saved);
  } catch (e) {}
  document.getElementById("themeToggle").addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") === "dark" ||
      (!root.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var t = dark ? "light" : "dark";
    root.setAttribute("data-theme", t);
    try { localStorage.setItem("theme", t); } catch (e) {}
  });

  window.addEventListener("hashchange", route);
  route();
})();
