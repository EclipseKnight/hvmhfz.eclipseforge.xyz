/* Frontier handbook pages: the side column's two lists ("On this page", "All sections") are <details>.
   On a wide screen they start open, beside the text; on a phone they start folded above it. Without
   JavaScript both stay folded and still work by tapping. While reading, the "On this page" entry of the
   section in view is marked, and on a wide screen the sticky side column stays below the site bar to the end. */
(function () {
  "use strict";

  var wide = window.matchMedia("(min-width: 1100px)");
  var panels = document.querySelectorAll(".hb-side details");

  function fit() {
    for (var i = 0; i < panels.length; i++) panels[i].open = wide.matches;
  }
  fit();
  if (wide.addEventListener) wide.addEventListener("change", fit);

  // On a phone, picking a contents entry folds the list again so the text is in view.
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest(".hb-side a");
    if (link && !wide.matches) {
      var box = link.closest("details");
      if (box) box.open = false;
    }
  });

  // Wide screens: the side column sticks under the site bar. Near the end of the page it gets shorter (its lists
  // scroll) rather than sliding up under the bar as the footer comes in.
  var side = document.querySelector(".hb-side");
  var layout = side && side.closest(".hb-layout");
  if (side && layout) {
    var queued = false;
    var fitSide = function () {
      queued = false;
      if (!wide.matches) { side.style.maxHeight = ""; return; }
      var top = parseFloat(window.getComputedStyle(side).top) || 0;
      var room = layout.getBoundingClientRect().bottom - top;
      side.style.maxHeight = room < window.innerHeight - top - 14 ? Math.max(160, room) + "px" : "";
    };
    window.addEventListener("scroll", function () {
      if (!queued) { queued = true; window.requestAnimationFrame(fitSide); }
    }, { passive: true });
    window.addEventListener("resize", fitSide);
    if (wide.addEventListener) wide.addEventListener("change", fitSide);
    fitSide();
  }

  var toc = document.querySelector(".hb-toc");
  if (!toc || !("IntersectionObserver" in window)) return;
  var links = {};
  toc.querySelectorAll("a[href^='#']").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
  var sections = document.querySelectorAll("main section[id]");
  var visible = {};
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
    var current = null;
    for (var i = 0; i < sections.length; i++) {
      if (visible[sections[i].id]) { current = sections[i].id; break; }
    }
    if (!current) return;
    Object.keys(links).forEach(function (id) { links[id].classList.toggle("is-here", id === current); });
  }, { rootMargin: "-80px 0px -55% 0px" });
  sections.forEach(function (s) { observer.observe(s); });
})();
