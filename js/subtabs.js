/* Sub-tabs for long pages (docs/subtabs-audit.md). Markup, one tab bar per page:

     <div class="subtabs-bar">
       <nav class="tabs" role="tablist" aria-label="Account sections" data-subtabs="account"
            data-subtabs-aliases='{"qol": "game-options", "game-options-keys": "qol-keys"}'>
         <a class="tab" id="tab-overview" role="tab" aria-controls="panel-overview" href="#overview">Overview</a>
         ...
       </nav>
     </div>
     <section class="tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">...</section>

   - One panel shows at a time. A tab's name is its href without "#"; its panel is aria-controls.
   - The address follows the tab (#name): a click adds a history entry, so Back and Forward step through tabs.
   - A hash names a tab, an alias (to a tab or to an element id), or any element inside a panel ("nested anchor":
     #diag-panel opens the Diagnostics tab and scrolls to it, opening any closed <details> around it). A hash that is
     none of these (#content from the skip link) is left to the browser.
   - Without a hash the page opens the tab last used on it (localStorage "hv.subtabs.<data-subtabs>"), else the tab
     marked aria-selected="true", else the first.
   - Keyboard: arrows, Home and End move between tabs and open them (roving tabindex); roles tablist/tab/tabpanel.
   - The bar is sticky under the site bar. With more than 5 tabs, phones get a "Jump to" select instead of the row.
   - Lazy panels: HvSubtabs.whenOpen(elementOrName, fn) runs fn once, when the panel holding it (or the tab with that
     name) is first shown; at once when it already is, or when the element is not in a sub-tab panel (other pages).
     Each change also fires "hv:subtab" on document ({detail: {name, panel}}).
   Hidden tabs (hidden attribute) are skipped by the keyboard and the select but still open from a link. */
(function () {
  "use strict";

  var JUMP_AT = 5;
  var bars = [];
  var waiting = [];

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function hashName() {
    var h = window.location.hash.replace(/^#/, "");
    try { return decodeURIComponent(h); } catch (e) { return h; }
  }

  function Bar(list) {
    var self = this;
    this.list = list;
    this.key = "hv.subtabs." + (list.getAttribute("data-subtabs") || window.location.pathname);
    this.aliases = {};
    try { this.aliases = JSON.parse(list.getAttribute("data-subtabs-aliases") || "{}") || {}; } catch (e) { /* bad JSON */ }
    this.tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]')).filter(function (tab) {
      return document.getElementById(tab.getAttribute("aria-controls") || "");
    });
    this.byName = {};
    this.tabs.forEach(function (tab) {
      tab.subtabName = (tab.getAttribute("href") || "").replace(/^#/, "");
      tab.subtabPanel = document.getElementById(tab.getAttribute("aria-controls"));
      self.byName[tab.subtabName] = tab;
    });
    this.opened = {};
    this.current = null;
    this.wire();
  }

  // The tab for a name: a tab, an alias (to a tab or an element) or an element inside a panel; with the element to
  // scroll to when it is not the tab itself.
  Bar.prototype.resolve = function (name, depth) {
    if (!name) return null;
    if (this.byName[name]) return { tab: this.byName[name], target: null };
    if (Object.prototype.hasOwnProperty.call(this.aliases, name) && (depth || 0) < 3) {
      return this.resolve(this.aliases[name], (depth || 0) + 1);
    }
    var node = document.getElementById(name);
    if (!node) return null;
    for (var i = 0; i < this.tabs.length; i++) {
      var panel = this.tabs[i].subtabPanel;
      if (panel === node) return { tab: this.tabs[i], target: null };
      if (panel.contains(node)) return { tab: this.tabs[i], target: node };
    }
    return null;
  };

  Bar.prototype.visibleTabs = function () {
    return this.tabs.filter(function (tab) { return !tab.hidden; });
  };

  Bar.prototype.show = function (tab, remember) {
    var changed = this.current !== tab;
    this.current = tab;
    this.tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.setAttribute("tabindex", on ? "0" : "-1");
      t.subtabPanel.hidden = !on;
    });
    if (this.select) this.select.value = tab.subtabName;
    if (remember) storeSet(this.key, tab.subtabName);
    if (tab.offsetParent && tab.scrollIntoView && this.list.scrollWidth > this.list.clientWidth) {
      // keep the chosen tab in view in a row that scrolls sideways, without moving the page
      var row = this.list, left = tab.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + tab.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollLeft = Math.max(0, left - 24);
      }
    }
    var first = !this.opened[tab.subtabName];
    this.opened[tab.subtabName] = true;
    if (changed || first) {
      runWaiting();
      try {
        document.dispatchEvent(new CustomEvent("hv:subtab", { detail: { name: tab.subtabName, panel: tab.subtabPanel } }));
      } catch (e) { /* old browser */ }
    }
  };

  // After a tab change made from below the bar, put the top of the panel back under the bar.
  Bar.prototype.toTop = function () {
    var wrap = this.wrap;
    var stuck = wrap.getBoundingClientRect().top <= this.stickTop() + 1;
    if (!stuck) return;
    jump(window.pageYOffset + this.anchor.getBoundingClientRect().top - this.stickTop());
  };

  Bar.prototype.stickTop = function () {
    var top = parseFloat(window.getComputedStyle(this.wrap).top);
    return isNaN(top) ? 0 : top;
  };

  function jump(y) {
    y = Math.max(0, y);
    try { window.scrollTo({ top: y, left: 0, behavior: "instant" }); } catch (e) { window.scrollTo(0, y); }
  }

  // A target a script fills in later (hidden until its data arrives) is waited for, up to 5 seconds.
  Bar.prototype.scrollTo = function (node, tries) {
    var self = this;
    for (var d = node; d && d !== document.body; d = d.parentNode) {
      if (d.tagName === "DETAILS" && !d.open) d.open = true;
    }
    if (!node.getClientRects().length) {
      if ((tries || 0) < 33 && this.current && this.current.subtabPanel.contains(node)) {
        setTimeout(function () { self.scrollTo(node, (tries || 0) + 1); }, 150);
      }
      return;
    }
    var bar = this.wrap.getBoundingClientRect().height;
    jump(window.pageYOffset + node.getBoundingClientRect().top - this.stickTop() - bar - 12);
  };

  // From the address: true when the hash belonged to this bar.
  Bar.prototype.fromHash = function (initial) {
    var self = this;
    var hit = this.resolve(hashName());
    if (!hit) {
      if (initial) this.initialTab = this.startTab();
      if (!hashName()) {
        // the page opening, or Back to the entry without a hash: the tab the page opened with
        this.show(this.initialTab || this.startTab(), false);
        return true;
      }
      if (initial) this.show(this.initialTab, false);
      return false;
    }
    this.show(hit.tab, true);
    if (hit.target) {
      // after the panel is visible and anything a script renders on show has run
      setTimeout(function () { self.scrollTo(hit.target); }, initial ? 60 : 0);
    }
    return true;
  };

  Bar.prototype.startTab = function () {
    var saved = storeGet(this.key);
    if (saved && this.byName[saved]) return this.byName[saved];
    for (var i = 0; i < this.tabs.length; i++) {
      if (this.tabs[i].getAttribute("aria-selected") === "true") return this.tabs[i];
    }
    return this.tabs[0];
  };

  Bar.prototype.go = function (tab, how) {
    var hash = "#" + tab.subtabName;
    if (window.location.hash !== hash) {
      if (how === "replace") window.history.replaceState(null, "", hash);
      else window.history.pushState(null, "", hash);
    }
    this.show(tab, true);
    this.toTop();
  };

  Bar.prototype.wire = function () {
    var self = this;
    var list = this.list;
    this.wrap = list.closest(".subtabs-bar") || list;
    // where the bar sits when not stuck: an empty marker right before it
    this.anchor = document.createElement("div");
    this.anchor.className = "subtabs-anchor";
    this.anchor.setAttribute("aria-hidden", "true");
    this.wrap.parentNode.insertBefore(this.anchor, this.wrap);
    list.setAttribute("role", "tablist");

    this.tabs.forEach(function (tab) {
      tab.subtabPanel.setAttribute("role", "tabpanel");
      if (!tab.subtabPanel.getAttribute("aria-labelledby") && tab.id) tab.subtabPanel.setAttribute("aria-labelledby", tab.id);
      tab.addEventListener("click", function (event) {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // new tab/window
        event.preventDefault();
        self.go(tab, "push");
      });
    });

    list.addEventListener("keydown", function (event) {
      var tabs = self.visibleTabs();
      var at = tabs.indexOf(event.target);
      if (at === -1) return;
      var next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = tabs[(at + 1) % tabs.length];
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = tabs[(at - 1 + tabs.length) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      next.focus();
      self.go(next, "replace");
    });

    if (this.tabs.length > JUMP_AT) {
      var label = document.createElement("label");
      label.className = "subtabs-jump";
      var text = document.createElement("span");
      text.textContent = "Jump to";
      var select = document.createElement("select");
      select.setAttribute("aria-label", "Jump to: " + (list.getAttribute("aria-label") || "section"));
      label.appendChild(text);
      label.appendChild(select);
      this.select = select;
      this.fillSelect();
      select.addEventListener("change", function () {
        var tab = self.byName[select.value];
        if (tab) self.go(tab, "push");
      });
      this.wrap.classList.add("has-jump");
      this.wrap.insertBefore(label, this.wrap.firstChild);
      // a tab shown or hidden later (a script that unhides it) shows up in the select too
      if (window.MutationObserver) {
        new MutationObserver(function () { self.fillSelect(); }).observe(list, { attributes: true, subtree: true, attributeFilter: ["hidden"] });
      }
    }
  };

  Bar.prototype.fillSelect = function () {
    var select = this.select;
    select.innerHTML = "";
    var current = this.current;
    this.tabs.forEach(function (tab) {
      if (tab.hidden && tab !== current) return;
      var option = document.createElement("option");
      option.value = tab.subtabName;
      option.textContent = tab.getAttribute("data-subtab-label") || tab.textContent.replace(/\s+/g, " ").trim();
      select.appendChild(option);
    });
    if (current) select.value = current.subtabName;
  };

  function panelOf(thing) {
    for (var b = 0; b < bars.length; b++) {
      var bar = bars[b];
      if (typeof thing === "string") {
        if (bar.byName[thing]) return { bar: bar, tab: bar.byName[thing] };
        continue;
      }
      for (var i = 0; i < bar.tabs.length; i++) {
        if (bar.tabs[i].subtabPanel.contains(thing)) return { bar: bar, tab: bar.tabs[i] };
      }
    }
    return null;
  }

  function runWaiting() {
    var still = [];
    var due = [];
    waiting.forEach(function (w) {
      if (w.at.bar.current === w.at.tab) due.push(w.fn);
      else still.push(w);
    });
    waiting = still;
    due.forEach(function (fn) {
      try { fn(); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }

  function whenOpen(thing, fn) {
    var at = thing ? panelOf(thing) : null;
    if (!at || at.bar.current === at.tab) { fn(); return; }
    waiting.push({ at: at, fn: fn });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-subtabs]"), function (list) {
      if (list.subtabsBar) return;
      var bar = new Bar(list);
      if (!bar.tabs.length) return;
      list.subtabsBar = bar;
      bars.push(bar);
      bar.fromHash(true);
    });
  }

  function onAddress() {
    bars.forEach(function (bar) { bar.fromHash(false); });
  }
  window.addEventListener("popstate", onAddress);
  window.addEventListener("hashchange", onAddress);

  window.HvSubtabs = {
    init: init,
    whenOpen: whenOpen,
    // open a tab by name (or the tab of an element) from a script; adds a history entry
    open: function (thing) {
      var at = panelOf(thing);
      if (at) at.bar.go(at.tab, "push");
    }
  };

  // At the end of <body> the markup is already there (readyState is still "loading"): start now, so the page's own
  // scripts after this one can call whenOpen. Again at DOMContentLoaded for a page that loads this in <head>.
  init();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
})();
