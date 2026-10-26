/* Global command palette: Ctrl/Cmd+K or "/" searches monsters, guilds, hunters and items. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var overlay, input, list;
  var items = [];
  var active = 0;
  var timer = null;
  var controller = null;
  var monsters = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function norm(value) { return String(value || "").toLowerCase(); }

  function loadMonsters() {
    if (monsters) return Promise.resolve(monsters);
    return fetch("/data/monsters/index.json")
      .then(function (r) { return r.json(); })
      .then(function (data) { monsters = data; return data; })
      .catch(function () { monsters = []; return monsters; });
  }

  function ensureDom() {
    if (overlay) return;
    overlay = el("div", "cmdk");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Search the site");

    var panel = el("div", "cmdk-panel");
    input = el("input", "cmdk-input");
    input.type = "search";
    input.placeholder = "Search monsters, guilds, hunters, items...";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-label", "Search");

    list = el("div", "cmdk-results");
    panel.appendChild(input);
    panel.appendChild(list);
    panel.appendChild(el("p", "cmdk-hint", "Up/Down to move, Enter to open, Esc to close"));
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { run(input.value); }, 160);
    });
    input.addEventListener("keydown", onKey);
  }

  function open() {
    ensureDom();
    overlay.hidden = false;
    document.body.classList.add("cmdk-open");
    input.value = "";
    input.focus();
    run("");
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("cmdk-open");
    if (controller) controller.abort();
  }

  function addGroup(title, rows) {
    if (!rows.length) return;
    list.appendChild(el("p", "cmdk-group", title));
    rows.forEach(function (row) {
      var item = el("a", "cmdk-item");
      item.href = row.href;
      item.appendChild(el("span", "cmdk-title", row.title));
      if (row.sub) item.appendChild(el("span", "cmdk-sub", row.sub));
      list.appendChild(item);
      items.push(item);
    });
  }

  function renderResults(data, q) {
    clear(list);
    items = [];
    active = 0;
    var needle = norm(q);

    var monsterHits = (monsters || []).filter(function (m) {
      return norm(m.name).indexOf(needle) !== -1 || norm(m.category).indexOf(needle) !== -1;
    }).slice(0, 6).map(function (m) {
      return { title: m.name, sub: m.category, href: "/monster.html?m=" + encodeURIComponent(m.slug) };
    });

    addGroup("Monsters", monsterHits);
    if (data) {
      addGroup("Guilds", (data.guilds || []).map(function (g) {
        return { title: g.name, sub: g.members + " members", href: "/guilds.html?id=" + g.id };
      }));
      addGroup("Hunters", (data.hunters || []).map(function (h) {
        return { title: h.name, sub: "HR " + h.hr + " · GR " + h.gr + " · " + h.weapon, href: "/hunters.html?id=" + h.id };
      }));
      addGroup("Items", (data.items || []).map(function (i) {
        return { title: i.name, sub: i.slot === "item" ? "Item" : "Equipment", href: "/catalog.html?q=" + encodeURIComponent(i.name) };
      }));
      addGroup("Monster hunt counts", (data.monsters || []).map(function (m) {
        return { title: m.name, sub: Number(m.kills).toLocaleString() + " hunts", href: "/monsters.html?q=" + encodeURIComponent(m.name) };
      }));
    }

    if (!items.length) {
      list.appendChild(el("p", "cmdk-empty", q ? "Nothing matches \"" + q + "\"." : "Type at least two characters."));
    } else {
      highlight(0);
    }
  }

  function highlight(index) {
    if (!items.length) return;
    active = (index + items.length) % items.length;
    items.forEach(function (item, i) { item.classList.toggle("active", i === active); });
    items[active].scrollIntoView({ block: "nearest" });
  }

  function run(q) {
    ensureDom();
    var query = q.trim();
    if (query.length < 2) {
      return loadMonsters().then(function () {
        if (norm(query)) renderResults(null, query); else renderResults(null, "");
      });
    }
    loadMonsters().then(function () {
      if (controller) controller.abort();
      controller = new AbortController();
      fetch(API + "/api/public/search?q=" + encodeURIComponent(query), { signal: controller.signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { renderResults(data, query); })
        .catch(function () { renderResults(null, query); });
    });
  }

  function onKey(event) {
    if (event.key === "Escape") { close(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); highlight(active + 1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); highlight(active - 1); return; }
    if (event.key === "Enter" && items[active]) { event.preventDefault(); location.href = items[active].href; }
  }

  function isTyping(event) {
    var tag = (event.target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || event.target.isContentEditable;
  }

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      overlay && !overlay.hidden ? close() : open();
    } else if (event.key === "/" && !isTyping(event) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      open();
    }
  });

  // A visible entry point in the nav, injected so no page markup has to change.
  document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector(".site-nav nav");
    if (!nav) return;
    var button = el("button", "navlink nav-search", "Search");
    button.type = "button";
    button.title = "Search (Ctrl+K)";
    button.addEventListener("click", open);
    nav.insertBefore(button, nav.firstChild);

    if (location.hash.indexOf("#search") === 0) {
      open();
      var term = decodeURIComponent(location.hash.split("=")[1] || "");
      if (term) {
        input.value = term;
        run(term);
      }
    }
  });
})();
