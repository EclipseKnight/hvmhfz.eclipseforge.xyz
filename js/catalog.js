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

  var Icons = window.HvGameIcons;

  /* The catalog's equipment sections as the pieces js/game-icons.js knows. */
  var PIECES = { melee: { kind: "melee" }, ranged: { kind: "ranged" }, heads: { slot: "head" },
    chests: { slot: "chest" }, arms: { slot: "arms" }, waists: { slot: "waist" }, legs: { slot: "legs" } };

  /* The API's equipment ids are the game's id as 4 hex digits, byte-swapped ("EB19" is 0x19EB = 6635);
     armour ids come padded with spaces. */
  function gameId(raw) {
    var hex = String(raw || "").trim();
    return /^[0-9a-f]{4}$/i.test(hex) ? parseInt(hex.slice(2, 4) + hex.slice(0, 2), 16) : null;
  }

  /* The icon of an equipment row: its type in its colour, from data/equipment-icons.json (the API's own
     icon names are item pictures and not used). */
  function equipmentKey(data, slot, raw) {
    var id = gameId(raw);
    if (id === null || !PIECES[slot]) return null;
    var piece = { id: id, kind: PIECES[slot].kind || "armour", slot: PIECES[slot].slot || "weapon" };
    return Icons.equipmentLook(data, piece).key;
  }

  /* Melee and ranged rows link to the weapon on the Weapons page (weapons.html?type=<slug>&w=<id>).
     data/weapons/ids.json (dev/make-weapons-data.py write_ids) says which type each game id is; an id it
     doesn't know (the API's "Dummy" rows) stays plain text. */
  var weaponIds = null;
  function loadWeaponIds() {
    if (weaponIds) return Promise.resolve(weaponIds);
    return fetch("/data/weapons/ids.json").then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }).then(function (d) { weaponIds = d || {}; return weaponIds; });
  }
  function weaponHref(ids, slot, raw) {
    var id = gameId(raw), kind = slot === "ranged" ? "ranged" : "melee";
    var letter = id !== null && ids[kind] ? ids[kind].charAt(id) : "";
    if (!letter || letter === ".") return null;
    var slug = (ids.types || [])[letter.charCodeAt(0) - 97];
    return slug ? "/weapons.html?type=" + slug + "&w=" + id : null;
  }

  /* The section, search and page live in the URL (defaults left out): ?slot=melee&q=sword&page=3. */
  var SLOTS = ["items", "melee", "ranged", "heads", "chests", "arms", "waists", "legs"];

  function saveState() {
    var u = new URL(window.location.href);
    if (state.slot !== "items") u.searchParams.set("slot", state.slot); else u.searchParams.delete("slot");
    if (state.q) u.searchParams.set("q", state.q); else u.searchParams.delete("q");
    if (state.page > 0) u.searchParams.set("page", String(state.page + 1)); else u.searchParams.delete("page");
    history.replaceState(null, "", u);
  }

  /* A failed load: one row in the table with a Try again button, not only a note in the toolbar. */
  function showError() {
    var body = document.getElementById("catalog-body");
    clear(body);
    var tr = el("tr", "no-results");
    var td = el("td", "empty-cell", "The catalog could not be loaded. ");
    td.colSpan = 4;
    var retry = el("button", "ghost-btn small", "Try again");
    retry.type = "button";
    retry.addEventListener("click", function () { load(); });
    td.appendChild(retry);
    tr.appendChild(td);
    body.appendChild(tr);
    document.getElementById("catalog-results").textContent = "";
    document.getElementById("catalog-pager").hidden = true;
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
    // A page past the end (an old link, a shorter list) goes to the last page.
    var lastPage = Math.max(0, Math.ceil(data.total / data.size) - 1);
    if (state.page > lastPage && data.items.length === 0 && data.total > 0) { state.page = lastPage; saveState(); load(); return; }

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
      if (entry.key) { // the game's icon (js/game-icons.js): an item's key, or a piece's type and colour
        var img = document.createElement("img");
        Icons.setPicture(img, entry.key, 48);
        img.alt = "";
        img.loading = "lazy";
        iconCell.appendChild(img);
      }
      row.appendChild(iconCell);
      row.appendChild(el("td", "mono", entry.id));
      var nameCell = el("td");
      if (entry.href) {
        nameCell.appendChild(el("a", null, entry.name)).href = entry.href;
        // The space keeps the two names apart even before the stylesheet puts the other name on its own line.
        if (entry.aka) {
          nameCell.appendChild(document.createTextNode(" "));
          nameCell.appendChild(el("span", "catalog-aka", "(also " + entry.aka + ")"));
        }
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
    // The header counts the whole section; the toolbar counts what the search found.
    var whole = state.slot === "items" && itemRows ? itemRows.length : (state.q ? null : data.total);
    if (whole !== null) document.getElementById("catalog-total").textContent = Number(whole).toLocaleString() + " to browse.";
    document.getElementById("catalog-results").textContent = Number(data.total).toLocaleString() +
      (data.total === 1 ? " entry" : " entries");
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
      return { id: String(r[0]), name: r[1], key: r[2], aka: r[3], sources: r[4], href: "/item.html?id=" + r[0] };
    }) });
  }

  function load() {
    if (state.slot === "items") {
      loadItems().then(renderItems).catch(showError);
      return;
    }
    var slot = state.slot;
    var weapons = slot === "melee" || slot === "ranged";
    Promise.all([request(url()), Icons.load(), weapons ? loadWeaponIds() : null]).then(function (results) {
      results[0].items.forEach(function (entry) {
        entry.key = equipmentKey(results[1], slot, entry.id);
        if (weapons) entry.href = weaponHref(results[2], slot, entry.id);
      });
      render(results[0]);
    }).catch(showError);
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
      saveState();
      load();
    });
  });

  document.getElementById("catalog-search").addEventListener("input", debounce(function (event) {
    state.q = event.target.value.trim();
    state.page = 0;
    saveState();
    load();
  }, 250));

  document.getElementById("catalog-prev").addEventListener("click", function () {
    if (state.page > 0) { state.page -= 1; saveState(); load(); }
  });
  document.getElementById("catalog-next").addEventListener("click", function () {
    state.page += 1;
    saveState();
    load();
  });

  // ?q= opens the catalog searching for an item (a monster page's drop tables and the site search link here).
  var params = new URLSearchParams(window.location.search);
  state.q = (params.get("q") || "").trim();
  if (SLOTS.indexOf(params.get("slot")) >= 0) state.slot = params.get("slot");
  if (/^[1-9]\d{0,5}$/.test(params.get("page") || "")) state.page = Number(params.get("page")) - 1;
  document.getElementById("catalog-search").value = state.q;
  document.querySelectorAll("#catalog-slots .chip").forEach(function (chip) {
    chip.setAttribute("aria-pressed", chip.dataset.slot === state.slot ? "true" : "false");
  });
  document.getElementById("catalog-src-head").hidden = state.slot !== "items";

  load();
})();
