/* Site search. The header's Search button, Ctrl/Cmd+K or "/" open a palette over monsters, quests, items and
   weapons (the site's own small indexes, loaded on first use) and the API's guilds, hunters, equipment and hunt
   counts. The same engine is window.HvSearch, which the Database page's search box (js/database.js) uses:
     HvSearch.load(kind)            -> Promise of true (loaded) or false (could not be loaded)
     HvSearch.find(kind, q, limit)  -> {total, rows: [{title, sub, href}], more: list page href or null}
   kinds in HvSearch.KINDS: monsters, quests, items, weapons, sources. A query matches a row when every word of it is in
   the row's name (or other name, monsters, category); rows whose name starts with the query come first.
   Indexes: data/monsters/index.json, data/items/index.json, data/search/quests.json and data/search/weapons.json
   (dev/make-search-index.py), data/sources/index.json (dev/make-source-data.py). */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

  function norm(value) {
    var s = String(value || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return s.replace(/\s+/g, " ").trim();
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* Each kind: where its index is, how to turn it into rows {name, extra, id, title, sub, href} and its list page. */
  var KINDS = {
    monsters: {
      label: "Monsters", url: "/data/monsters/index.json", min: 1,
      rows: function (data) {
        monsterIds = {};
        return (data || []).map(function (m) {
          (m.ids || []).forEach(function (id) { monsterIds[id] = "/monster.html?m=" + encodeURIComponent(m.slug); });
          return { name: m.name, extra: m.category, title: m.name, sub: m.category,
                   href: "/monster.html?m=" + encodeURIComponent(m.slug) };
        });
      },
      more: function (q) { return "/monsters.html?q=" + encodeURIComponent(q); }
    },
    quests: {
      label: "Quests", url: "/data/search/quests.json", min: 2,
      rows: function (data) {
        var cats = data.categories || [], mons = data.monsters || [];
        return (data.quests || []).map(function (r) {
          var monsters = (r[3] || []).map(function (i) { return mons[i]; });
          var sub = [cats[r[2]], monsters.slice(0, 3).join(", ") + (monsters.length > 3 ? " +" + (monsters.length - 3) : ""),
            "#" + r[0]].filter(Boolean).join(" · "); // the id tells apart quests of the same name
          return { name: r[1] || "Quest " + r[0], extra: monsters.join(" ") + " " + (cats[r[2]] || ""), id: r[0],
                   title: r[1] || "Quest " + r[0], sub: sub, href: "/quest.html?id=" + r[0] };
        });
      },
      more: function (q) { return "/quests.html?q=" + encodeURIComponent(q); }
    },
    items: {
      label: "Items", url: "/data/items/index.json", min: 2,
      rows: function (data) {
        return (data.items || []).filter(function (r) { return r[0] > 0; }).map(function (r) {
          return { name: r[1], extra: r[3], id: r[0], title: r[1], sub: r[3] ? "also " + r[3] : "Item " + r[0],
                   href: "/item.html?id=" + r[0] };
        });
      },
      more: function (q) { return "/items.html?q=" + encodeURIComponent(q); }
    },
    weapons: {
      label: "Weapons", url: "/data/search/weapons.json", min: 2,
      rows: function (data) {
        var types = data.types || [];
        return (data.weapons || []).map(function (r) {
          var t = types[r[0]] || ["", ""];
          return { name: r[2], extra: t[1], title: r[2], sub: t[1] + " · Rarity " + r[3],
                   href: "/weapons.html?type=" + encodeURIComponent(t[0]) + "&w=" + r[1] };
        });
      },
      more: null
    },
    sources: {
      label: "Sources", url: "/data/sources/index.json", min: 2,
      rows: function (data) {
        var groups = {};
        (data.groups || []).forEach(function (g) { groups[g[0]] = g[1]; });
        return (data.sources || []).map(function (s) {
          return { name: s[1], extra: (groups[s[2]] || "") + " " + (s[3] || ""), title: s[1],
                   sub: (groups[s[2]] || "Source") + " · " + s[4] + (s[4] === 1 ? " item" : " items"),
                   href: "/source.html?id=" + encodeURIComponent(s[0]) };
        });
      },
      more: function (q) { return "/sources.html?q=" + encodeURIComponent(q); }
    }
  };
  var ORDER = ["monsters", "quests", "items", "weapons", "sources"];
  var cache = {};
  var monsterIds = {}; // the server's monster id -> its page, from the monster index

  function load(kind) {
    var k = KINDS[kind];
    if (!cache[kind]) {
      cache[kind] = getJson(k.url).then(function (data) {
        k.list = k.rows(data).map(function (row) {
          row.n = norm(row.name);
          row.hay = row.n + " " + norm(row.extra);
          return row;
        });
        return true;
      }).catch(function () {
        k.list = null;
        delete cache[kind]; // try again on the next search
        return false;
      });
    }
    return cache[kind];
  }

  function find(kind, q, limit) {
    var k = KINDS[kind], needle = norm(q), words = needle.split(" ").filter(Boolean);
    var out = { total: 0, rows: [], more: null };
    if (!k.list || needle.length < k.min) return out;
    var asId = /^\d+$/.test(needle) ? Number(needle) : null;
    var hits = [];
    k.list.forEach(function (row, at) {
      var rank;
      if (asId !== null && row.id === asId) rank = 0;
      else if (row.n.indexOf(needle) === 0) rank = 1;
      else if ((" " + row.n).indexOf(" " + needle) !== -1) rank = 2;
      else if (row.n.indexOf(needle) !== -1) rank = 3;
      else if (words.every(function (w) { return row.n.indexOf(w) !== -1; })) rank = 4;
      else if (words.every(function (w) { return row.hay.indexOf(w) !== -1; })) rank = 5;
      else return;
      hits.push([rank, row.n.length, at, row]);
    });
    hits.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
    out.total = hits.length;
    out.rows = hits.slice(0, limit || 6).map(function (h) { return h[3]; });
    out.more = k.more && hits.length > out.rows.length ? k.more(q.trim()) : null;
    return out;
  }

  window.HvSearch = { KINDS: KINDS, ORDER: ORDER, load: load, find: find, norm: norm };

  /* ---- The palette ---- */
  var overlay, input, list;
  var items = [];
  var active = 0;
  var timer = null;
  var controller = null;
  var seq = 0;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

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
    input.placeholder = "Search monsters, quests, items, weapons, hunters...";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-label", "Search");

    list = el("div", "cmdk-results");
    panel.appendChild(input);
    panel.appendChild(list);
    var hint = el("p", "cmdk-hint", "Up/Down to move, Enter to open, Esc to close · ");
    hint.appendChild(el("a", null, "Database search")).href = "/database.html";
    panel.appendChild(hint);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { run(input.value); }, 120);
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

    ORDER.forEach(function (kind) {
      addGroup(KINDS[kind].label, find(kind, q, 5).rows);
    });
    if (data) {
      addGroup("Guilds", (data.guilds || []).map(function (g) {
        return { title: g.name, sub: g.members + " members", href: "/guilds.html?id=" + g.id };
      }));
      addGroup("Hunters", (data.hunters || []).map(function (h) {
        return { title: h.name, sub: (window.HvHr && HvHr.label(h.hr) || "HR " + h.hr) + " · GR " + h.gr + " · " + h.weapon, href: "/hunters.html?id=" + h.id };
      }));
      // Items and weapons come from the site's own indexes (above); the API's hits only add armour.
      addGroup("Equipment", (data.items || []).filter(function (i) {
        return i.slot !== "item" && i.slot !== "melee" && i.slot !== "ranged";
      }).map(function (i) {
        return { title: i.name, sub: "Equipment", href: "/items.html?q=" + encodeURIComponent(i.name) };
      }));
      addGroup("Monster hunt counts", (data.monsters || []).map(function (m) {
        // The server's monster id is in the guide's index ("ids"); a monster without a page opens the guide's search.
        return { title: m.name, sub: Number(m.kills).toLocaleString() + " hunts",
                 href: monsterIds[m.id] || "/monsters.html?q=" + encodeURIComponent(m.name) };
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

  function withHr(needed) {
    if (!needed || window.HvHr) return Promise.resolve();
    return new Promise(function (done) {
      var script = document.createElement("script");
      script.src = "/js/hr.js?v=1";
      script.onload = script.onerror = function () { done(); };
      document.head.appendChild(script);
    });
  }

  function run(q) {
    ensureDom();
    var query = q.trim(), mine = ++seq;
    if (query.length < 2) {
      return load("monsters").then(function () {
        if (mine === seq) renderResults(null, query);
      });
    }
    Promise.all(ORDER.map(load)).then(function () {
      if (mine !== seq) return;
      renderResults(null, query); // the site's own results at once; the API's follow
      if (controller) controller.abort();
      controller = new AbortController();
      fetch(API + "/api/public/search?q=" + encodeURIComponent(query), { signal: controller.signal })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data) return;
          // The hunter rows show HR the game's way (/js/hr.js, loaded here: search.js is on every page).
          return withHr(data.hunters && data.hunters.length).then(function () { if (mine === seq) renderResults(data, query); });
        })
        .catch(function () { /* aborted or no answer: the site's own results stay */ });
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
      var box = document.getElementById("db-search"); // the Database page has its own search box
      if (box) box.focus(); else open();
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
