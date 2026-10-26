/* Monster field guide: index page. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var state = { q: "", category: "", sort: "name" };
  var all = [];
  var kills = {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function norm(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function num(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  function iconFor(monster) {
    if (monster.icon) {
      var img = el("img");
      img.src = "/assets/monsters/icons/" + monster.icon;
      img.alt = "";
      img.loading = "lazy";
      img.width = 96;
      img.height = 96;
      return img;
    }
    var fallback = el("span", "monster-initial", (monster.name || "?").charAt(0).toUpperCase());
    return fallback;
  }

  function card(monster) {
    var tile = el("article", "tile monster-tile");

    var link = el("a", "monster-link");
    link.href = "/monster.html?m=" + encodeURIComponent(monster.slug);

    var art = el("div", "monster-art");
    art.appendChild(iconFor(monster));
    link.appendChild(art);

    var body = el("div", "monster-body");
    body.appendChild(el("h2", "monster-name", monster.name));
    body.appendChild(el("p", "tile-meta", monster.category));
    if (monster.variants && monster.variants.length) {
      var chips = el("div", "chip-list");
      monster.variants.forEach(function (label) { chips.appendChild(el("span", "chip", label)); });
      body.appendChild(chips);
    }
    link.appendChild(body);

    var count = kills[norm(monster.name)];
    var stat = el("div", "tile-stat");
    stat.appendChild(el("span", "tile-stat-value", count ? num(count) : "0"));
    stat.appendChild(el("span", "tile-stat-label", "hunts logged"));
    tile.appendChild(link);
    tile.appendChild(stat);
    return tile;
  }

  function render() {
    var box = document.getElementById("monsters");
    clear(box);
    var q = state.q.trim().toLowerCase();
    var rows = all.filter(function (m) {
      if (state.category && m.category !== state.category) return false;
      if (!q) return true;
      return (m.name + " " + m.category).toLowerCase().indexOf(q) !== -1;
    });
    rows.sort(function (a, b) {
      if (state.sort === "kills") {
        var ka = kills[norm(a.name)] || 0;
        var kb = kills[norm(b.name)] || 0;
        if (ka !== kb) return kb - ka;
      }
      return a.name.localeCompare(b.name);
    });
    rows.forEach(function (m) { box.appendChild(card(m)); });
    document.getElementById("monster-results").textContent = rows.length + (rows.length === 1 ? " monster" : " monsters");
    if (!rows.length) box.appendChild(el("p", "empty-state", "No monster matches that search."));
  }

  function fillCategories() {
    var select = document.getElementById("monster-category");
    var cats = {};
    all.forEach(function (m) { cats[m.category] = true; });
    Object.keys(cats).sort().forEach(function (c) {
      var option = el("option", null, c);
      option.value = c;
      select.appendChild(option);
    });
  }

  function load() {
    fetch("/data/monsters/index.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        all = data;
        document.getElementById("monster-total").textContent = data.length;
        fillCategories();
        render();
      })
      .catch(function () {
        document.getElementById("monsters").appendChild(el("p", "empty-state", "Could not load the monster database."));
      });

    fetch(API + "/api/public/monsters?limit=300")
      .then(function (r) { return r.json(); })
      .then(function (list) {
        list.forEach(function (m) { kills[norm(m.name)] = m.kills; });
        render();
      })
      .catch(function () { /* counts are optional */ });
  }

  document.getElementById("monster-search").addEventListener("input", function (event) {
    state.q = event.target.value;
    render();
  });
  document.getElementById("monster-category").addEventListener("change", function (event) {
    state.category = event.target.value;
    render();
  });
  document.getElementById("monster-sort").addEventListener("change", function (event) {
    state.sort = event.target.value;
    render();
  });

  load();
})();
