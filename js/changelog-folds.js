/* Changelog: every day and every older month is a <details>. A link to a day, a topic or a month (the contents, the launcher news,
   the Discord feed, a shared link) opens the folds around its target and scrolls to it, on load, on a hash change and on a click
   (a click on a link to the page's current hash fires no hashchange). Also adds Expand all / Collapse all.
   Without JavaScript the folds still open and close by themselves, and the newest days start open. */
(function () {
  "use strict";

  var folds = document.querySelectorAll("details.cl-fold");
  if (!folds.length) return;

  function target() {
    var id = decodeURIComponent((location.hash || "").slice(1));
    return id ? document.getElementById(id) : null;
  }

  function reveal(el) {
    var opened = false;
    for (var n = el; n; n = n.parentElement) {
      if (n.tagName === "DETAILS" && !n.open) { n.open = true; opened = true; }
    }
    return opened;
  }

  function show() {
    var el = target();
    if (el && reveal(el)) el.scrollIntoView();
  }

  show();
  window.addEventListener("hashchange", show);
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a || e.defaultPrevented) return;
    var el = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    if (el) reveal(el); // the browser then scrolls to it, now that it is visible
  });

  var live = document.getElementById("live");
  if (!live) return;
  var bar = document.createElement("p");
  bar.className = "cl-fold-all";
  [["Expand all", true], ["Collapse all", false]].forEach(function (b) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = b[0];
    btn.addEventListener("click", function () {
      Array.prototype.forEach.call(folds, function (d) { d.open = b[1]; });
    });
    bar.appendChild(btn);
  });
  live.parentNode.insertBefore(bar, live.nextSibling);
})();
