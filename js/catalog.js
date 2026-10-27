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
      cell.colSpan = 3;
      empty.appendChild(cell);
      body.appendChild(empty);
    }

    data.items.forEach(function (entry) {
      var row = el("tr");
      var iconCell = el("td", "catalog-icon");
      if (entry.icon) {
        var img = document.createElement("img");
        img.src = "/assets/items/" + entry.icon + ".webp";
        img.alt = "";
        img.loading = "lazy";
        iconCell.appendChild(img);
      }
      row.appendChild(iconCell);
      row.appendChild(el("td", "mono", entry.id));
      row.appendChild(el("td", null, entry.name));
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

  function load() {
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

  load();
})();
