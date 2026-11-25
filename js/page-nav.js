/* Page nav: keeps a page's own navigation on screen. Once the page's contents list has scrolled away, a compact bar
   with the same links stays pinned under the site bar (top: --site-nav-h, measured by js/nav.js), with the section
   in view marked. Wide screens get a row of links that scrolls sideways; phones (720px and below) get a "Jump to"
   select, as the sub-tabs do (js/subtabs.js). Without JavaScript the contents list simply stays where it is.

   Markup, on the element that holds the page's contents links:
     data-page-nav                  its a[href^="#"] links are the sections (each link's <strong>, else its text);
     data-page-nav="auto"           (on <main>) the sections are main > section[id] with their <h2>;
     data-page-nav-label="..."      the bar's name for screen readers (default "On this page");
     data-page-nav-below="1100"     the bar only below this width (the Frontier guide's side column already sticks
                                    above it);
     data-page-nav-pages="Guide"    on a list inside it: links to other pages, shown as a select of their own (an
                                    <li> without a link starts a group; the aria-current="page" link is selected).
   A list a script fills in later calls HvPageNav.add(element).
   The bar's height goes into --page-nav-h, which html's scroll-padding-top adds, so #links land below both bars. */
(function () {
  "use strict";

  var root = document.documentElement;
  var bars = [];
  var queued = false;

  function text(node) {
    var strong = node.querySelector && node.querySelector("strong");
    return ((strong || node).textContent || "").replace(/\s+/g, " ").trim();
  }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  // The site bar's height (js/nav.js keeps --site-nav-h up to date).
  function siteNavH() {
    var v = parseFloat(window.getComputedStyle(root).getPropertyValue("--site-nav-h"));
    if (!isNaN(v)) return v;
    var header = document.querySelector("header.site-nav");
    return header ? header.getBoundingClientRect().height : 0;
  }

  function sectionsOf(source) {
    var out = [];
    var seen = {};
    function add(id, label) {
      if (!id || seen[id] || !label) return;
      var target = document.getElementById(id);
      if (!target) return;
      seen[id] = true;
      out.push({ id: id, label: label, target: target });
    }
    if (source.getAttribute("data-page-nav") === "auto") {
      Array.prototype.forEach.call(source.children, function (s) {
        var h = s.tagName === "SECTION" && s.id && s.querySelector("h2");
        if (h) add(s.id, text(h));
      });
      return out;
    }
    Array.prototype.forEach.call(source.querySelectorAll('a[href^="#"]'), function (a) {
      if (a.closest("[data-page-nav-pages]")) return;
      if (!a.getClientRects().length && !a.closest("details")) return; // hidden entries (signed-in only ones)
      var id = a.getAttribute("href").slice(1);
      try { id = decodeURIComponent(id); } catch (e) { /* as written */ }
      add(id, text(a));
    });
    return out;
  }

  function Bar(source) {
    this.source = source;
    this.sections = sectionsOf(source);
    this.below = parseInt(source.getAttribute("data-page-nav-below"), 10) || 0;
    this.current = null;
    this.build();
  }

  Bar.prototype.build = function () {
    var self = this;
    var bar = el("nav", "page-nav");
    bar.setAttribute("aria-label", this.source.getAttribute("data-page-nav-label") || "On this page");
    bar.hidden = true;
    var inner = el("div", "page-nav-in");
    bar.appendChild(inner);

    this.links = {};
    if (this.sections.length) {
      var row = el("div", "tabs page-nav-row");
      this.sections.forEach(function (s) {
        var a = el("a", "tab");
        a.href = "#" + s.id;
        a.textContent = s.label;
        row.appendChild(a);
        self.links[s.id] = a;
      });
      inner.appendChild(row);
      this.row = row;

      var jump = el("label", "page-nav-jump");
      var span = el("span");
      span.textContent = "Jump to";
      var select = el("select");
      select.setAttribute("aria-label", "Jump to a section of this page");
      this.sections.forEach(function (s) {
        var o = el("option");
        o.value = s.id;
        o.textContent = s.label;
        select.appendChild(o);
      });
      select.addEventListener("change", function () { go(select.value); });
      jump.appendChild(span);
      jump.appendChild(select);
      inner.appendChild(jump);
      this.select = select;
    }

    var pagesList = this.source.querySelector("[data-page-nav-pages]");
    if (pagesList) {
      var pages = el("label", "page-nav-pages");
      var name = el("span");
      name.textContent = pagesList.getAttribute("data-page-nav-pages") || "Pages";
      var pick = el("select");
      pick.setAttribute("aria-label", name.textContent + ": go to another page");
      var group = pick;
      Array.prototype.forEach.call(pagesList.querySelectorAll("li"), function (li) {
        var a = li.querySelector("a[href]");
        if (!a) {
          group = el("optgroup");
          group.label = text(li);
          pick.appendChild(group);
          return;
        }
        var o = el("option");
        o.value = a.getAttribute("href");
        o.textContent = text(a);
        if (a.getAttribute("aria-current") === "page") o.selected = true;
        group.appendChild(o);
      });
      pick.addEventListener("change", function () { window.location.href = pick.value; });
      pages.appendChild(name);
      pages.appendChild(pick);
      inner.appendChild(pages);
    }
    if (!this.sections.length && !pagesList) return;

    // Right after the site bar, so the keyboard reaches it next.
    var header = document.querySelector("header.site-nav");
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
    this.bar = bar;
    this.measure();
  };

  Bar.prototype.active = function () {
    return !!this.bar && (!this.below || window.innerWidth < this.below);
  };

  Bar.prototype.measure = function () {
    var was = this.bar.hidden;
    this.bar.hidden = false;
    this.height = this.bar.getBoundingClientRect().height;
    this.bar.hidden = was;
  };

  // Shown once the contents list (for "auto": the top of the first section) has gone up under the site bar.
  Bar.prototype.update = function (line) {
    if (!this.active()) {
      this.bar.hidden = true;
      return false;
    }
    var shown;
    if (this.source.getAttribute("data-page-nav") === "auto") {
      shown = this.sections.length > 0 && this.sections[0].target.getBoundingClientRect().top < line + this.height + 8;
    } else {
      var rects = this.source.getClientRects();
      shown = rects.length > 0 && this.source.getBoundingClientRect().bottom < line;
    }
    this.bar.hidden = !shown;
    if (shown) this.mark(line + this.height);
    return true;
  };

  // The section in view: the last one whose top has reached the bars (plus a little reading room); at the very end of
  // the page, the last one (a short last section never reaches the bars).
  Bar.prototype.mark = function (below) {
    var current = null;
    var end = window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2;
    for (var i = 0; i < this.sections.length; i++) {
      var t = this.sections[i].target;
      if (!t.getClientRects().length) continue;
      if (end || t.getBoundingClientRect().top <= below + 40) current = this.sections[i];
      else break;
    }
    if (!current && this.sections.length) current = this.sections[0];
    if (!current || current === this.current) return;
    if (this.current) {
      this.links[this.current.id].classList.remove("is-here");
      this.links[this.current.id].removeAttribute("aria-current");
    }
    this.current = current;
    var link = this.links[current.id];
    link.classList.add("is-here");
    link.setAttribute("aria-current", "location");
    if (this.select) this.select.value = current.id;
    var row = this.row;
    if (row && row.scrollWidth > row.clientWidth) {
      // keep the marked link in view in the row, without moving the page
      var left = link.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + link.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollLeft = Math.max(0, left - 24);
      }
    }
  };

  function go(id) {
    var target = document.getElementById(id);
    if (!target) return;
    if (window.location.hash === "#" + id) target.scrollIntoView({ block: "start" });
    else window.location.hash = id;
    land(target);
  }

  // Once the (smooth) scroll to a section has stopped, puts it right below the bars if it is not there: something
  // that grew on the way (a picture loading) makes the browser's scroll anchoring push the scroll past the heading.
  // A wheel, touch or key from the reader in the meantime leaves the page where they take it.
  function land(target) {
    var last = null, still = 0, frames = 0, stop = false;
    function cancel() { stop = true; }
    var events = ["wheel", "touchstart", "keydown", "mousedown"];
    events.forEach(function (e) { window.addEventListener(e, cancel, { passive: true }); });
    function done() {
      events.forEach(function (e) { window.removeEventListener(e, cancel, { passive: true }); });
    }
    function tick() {
      if (stop) return done();
      var y = window.pageYOffset;
      still = y === last ? still + 1 : 0;
      last = y;
      if (still < 6 && ++frames < 600) return window.requestAnimationFrame(tick);
      done();
      var want = (parseFloat(window.getComputedStyle(root).scrollPaddingTop) || 0) +
        (parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0);
      var top = target.getBoundingClientRect().top;
      var end = window.innerHeight + y >= root.scrollHeight - 2;
      if (Math.abs(top - want) > 2 && !(end && top > want)) target.scrollIntoView({ block: "start", behavior: "instant" });
    }
    window.requestAnimationFrame(tick);
  }

  function update() {
    queued = false;
    var line = siteNavH();
    var height = null;
    bars = bars.filter(function (b) {
      if (document.contains(b.source)) return true;
      if (b.bar && b.bar.parentNode) b.bar.parentNode.removeChild(b.bar);
      return false;
    });
    bars.forEach(function (b) {
      if (b.update(line) && height === null) height = b.height;
    });
    var value = (height || 0) + "px";
    if (root.style.getPropertyValue("--page-nav-h") !== value) root.style.setProperty("--page-nav-h", value);
  }

  function queue() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(update);
  }

  function add(source) {
    if (!source || source.pageNavBar) return;
    var bar = new Bar(source);
    source.pageNavBar = bar;
    if (bar.bar) bars.push(bar);
    update();
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-page-nav]"), add);
  }

  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", function () {
    bars.forEach(function (b) { b.measure(); });
    queue();
  });
  window.HvPageNav = { add: add, update: queue };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
