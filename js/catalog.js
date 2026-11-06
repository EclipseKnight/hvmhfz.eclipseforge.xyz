/* Item and equipment catalog: section chips, search, paging. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var state = { slot: "items", q: "", page: 0, size: 30 };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function request(path) {
    return fetch(API + path, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function url() {
    if (state.slot === "items") {
      return "/api/public/catalog/items?q=" + encodeURIComponent(state.q) + "&page=" + state.page + "&size=" + state.size;
    }
    return "/api/public/catalog/equipment?slot=" + state.slot + "&q=" + encodeURIComponent(state.q) +
      "&page=" + state.page + "&size=" + state.size;
  }

  function render(data) {
    var body = document.getElementById("catalog-body");
    clear(body);

    if (!data.items.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "Nothing matches that search.");
      cell.colSpan = 4;
      empty.appendChild(cell);
      body.appendChild(empty);
    }

    data.items.forEach(function (entry) {
      var row = el("tr");
      var iconCell = el("td", "catalog-icon");
      if (entry.icon) { // API equipment and data/items both name the file in /assets/items
        var img = document.createElement("img");
        img.src = "/assets/items/" + entry.icon + ".webp";
        img.alt = "";
        img.loading = "lazy";
        iconCell.appendChild(img);
      }
      row.appendChild(iconCell);
      row.appendChild(el("td", "mono", entry.id));
      var nameCell = el("td");
      if (entry.href) {
        nameCell.appendChild(el("a", null, entry.name)).href = entry.href;
        if (entry.aka) nameCell.appendChild(el("span", "catalog-aka", "also " + entry.aka));
      } else {
        nameCell.textContent = entry.name;
      }
      row.appendChild(nameCell);
      var srcCell = el("td", "catalog-src");
      if (state.slot === "items") srcCell.textContent = entry.sources ? String(entry.sources) : "-";
      srcCell.hidden = state.slot !== "items";
      row.appendChild(srcCell);
      body.appendChild(row);
    });

    var pages = Math.max(1, Math.ceil(data.total / data.size));
    document.getElementById("catalog-total").textContent = Number(data.total).toLocaleString() + " to browse.";
    document.getElementById("catalog-results").textContent = Number(data.total).toLocaleString() + " entries";
    var pager = document.getElementById("catalog-pager");
    pager.hidden = pages <= 1;
    document.getElementById("catalog-page-note").textContent = "Page " + (state.page + 1) + " of " + pages;
    document.getElementById("catalog-prev").disabled = state.page === 0;
    document.getElementById("catalog-next").disabled = state.page >= pages - 1;
  }

  /* Items: every item in the game (data/items/index.json, made by dev/make-item-data.py: 16,701 rows of
     [id, name, icon, aka, sources]), searched here by name, the server's own name for it (aka) or id. Each row
     links to its item page. Equipment still comes from the API. */
  var itemRows = null;
  function loadItems() {
    if (itemRows) return Promise.resolve(itemRows);
    return fetch("/data/items/index.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) { itemRows = d.items || []; return itemRows; });
  }

  function itemMatches(rows, q) {
    q = q.toLowerCase();
    if (!q) return rows;
    var asId = /^\d+$/.test(q) ? Number(q) : null;
    var starts = [], contains = [];
    rows.forEach(function (r) {
      if (asId !== null && r[0] === asId) { starts.unshift(r); return; }
      var name = r[1].toLowerCase(), aka = (r[3] || "").toLowerCase();
      if (name === q || aka === q) starts.unshift(r);
      else if (name.indexOf(q) === 0 || aka.indexOf(q) === 0) starts.push(r);
      else if (name.indexOf(q) !== -1 || aka.indexOf(q) !== -1) contains.push(r);
    });
    return starts.concat(contains);
  }

  function renderItems(rows) {
    var found = itemMatches(rows, state.q);
    var start = state.page * state.size;
    render({ total: found.length, size: state.size, items: found.slice(start, start + state.size).map(function (r) {
      return { id: String(r[0]), name: r[1], icon: r[2], aka: r[3], sources: r[4], href: "/item.html?id=" + r[0] };
    }) });
  }

  function load() {
    if (state.slot === "items") {
      loadItems().then(renderItems).catch(function () {
        document.getElementById("catalog-results").textContent = "Could not load the catalog";
      });
      return;
    }
    request(url()).then(render).catch(function () {
      document.getElementById("catalog-results").textContent = "Could not load the catalog";
    });
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  document.querySelectorAll("#catalog-slots .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.slot = chip.dataset.slot;
      state.page = 0;
      document.querySelectorAll("#catalog-slots .chip").forEach(function (other) {
        other.setAttribute("aria-pressed", other === chip ? "true" : "false");
      });
      document.getElementById("catalog-src-head").hidden = state.slot !== "items";
      load();
    });
  });

  document.getElementById("catalog-search").addEventListener("input", debounce(function (event) {
    state.q = event.target.value.trim();
    state.page = 0;
    load();
  }, 250));

  document.getElementById("catalog-prev").addEventListener("click", function () {
    if (state.page > 0) { state.page -= 1; load(); }
  });
  document.getElementById("catalog-next").addEventListener("click", function () {
    state.page += 1;
    load();
  });

  // ?q= opens the catalog searching for an item (a monster page's drop tables and the site search link here).
  state.q = (new URLSearchParams(window.location.search).get("q") || "").trim();
  document.getElementById("catalog-search").value = state.q;

  load();
})();
