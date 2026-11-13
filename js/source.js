/* One item source: /source.html?id=<source id> (a shop tab, a gacha, an event, a Sky Corridor district, a crafting
   table...). Data from dev/make-source-data.py: data/sources/index.json (names, groups) and data/sources/<id>.json
   (every item it gives with quantity, price, chance, limits and materials); item names and icons from
   data/items/index.json. The table filters as you type (?q= stays in the address) and sorts by any column
   (js/tablesort.js). Each item links to its page, whose "Where to get it" links back here. */
(function () {
  "use strict";

  var view = document.getElementById("source-view");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function json(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }
  function pct(v) { return (Math.round(v * 1000) / 1000) + "%"; }

  function fail(message, retry) {
    view.textContent = "";
    view.appendChild(el("p", "empty-state", message));
    var p = el("p", "note-text");
    if (retry) {
      var b = el("button", "ghost-btn small", "Try again");
      b.type = "button";
      b.addEventListener("click", function () { location.reload(); });
      p.appendChild(b);
      p.appendChild(document.createTextNode(" "));
    }
    p.appendChild(el("a", null, "All sources")).href = "/sources.html";
    view.appendChild(p);
  }

  function itemCell(id, items, qty) {
    var row = items[id];
    var a = el("a", "src-mat");
    a.href = "/item.html?id=" + id;
    if (row && row[2]) {
      var img = el("img");
      img.src = "/assets/icons/1x/" + row[2] + ".png";
      img.alt = "";
      img.loading = "lazy";
      a.appendChild(img);
    }
    a.appendChild(el("span", null, (row ? row[1] : "Item " + id) + (qty ? " x" + qty : "")));
    return a;
  }

  /* The columns a source's rows use, in this order; a column shows only when a row has a value for it. */
  var COLUMNS = [
    ["qty", "Qty", "num"], ["price", "Price", "num"], ["chance", "Chance", "num"], ["quests", "Quests", "num"],
    ["when", "When"], ["gate", "Rank"], ["limit", "Limit", "num"], ["mats", "Made from"], ["note", "Note"]
  ];

  function render(src, groups, items) {
    document.title = src.name + " · Hunsterverse";
    if (window.HvCrumbs) window.HvCrumbs.item(src.name);
    var placeholder = document.getElementById("source-head");
    if (placeholder) placeholder.hidden = true;
    view.textContent = "";
    var head = el("header", "page-head");
    head.appendChild(el("p", "kicker", groups[src.group] || "Source"));
    head.appendChild(el("h1", null, src.name));
    var distinct = {};
    src.rows.forEach(function (r) { distinct[r.item] = true; });
    var n = Object.keys(distinct).length;
    head.appendChild(el("p", "page-sub", (src.about ? src.about + " " : "") + num(n) + (n === 1 ? " item" : " items") +
      (src.cur ? ", prices in " + src.cur : "") + "."));
    view.appendChild(head);

    var cols = COLUMNS.filter(function (c) {
      return src.rows.some(function (r) {
        if (c[0] === "mats") return (r.mats && r.mats.length) || (r.pieces && r.pieces.length);
        if (c[0] === "qty") return r.qty > 1;
        return r[c[0]] !== undefined && r[c[0]] !== "";
      });
    });
    var hasBuiltin = src.rows.some(function (r) { return r.builtin; });

    var panel = el("section", "panel");
    var tools = el("div", "toolbar");
    var label = el("label", "search");
    label.appendChild(el("span", "search-label", "Find an item"));
    var input = el("input");
    input.type = "search";
    input.placeholder = "Item name or id";
    var params = new URLSearchParams(location.search);
    input.value = params.get("q") || "";
    label.appendChild(input);
    tools.appendChild(label);
    var count = el("span", "toolbar-note");
    count.setAttribute("aria-live", "polite");
    tools.appendChild(count);
    panel.appendChild(tools);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table sticky-first source-table");
    var tr = el("tr");
    tr.appendChild(el("th", null, "Item"));
    cols.forEach(function (c) { tr.appendChild(el("th", c[2] || null, c[1])); });
    table.appendChild(el("thead")).appendChild(tr);
    var body = el("tbody");
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    if (hasBuiltin) panel.appendChild(el("p", "note-text", "* A row of the game's own Road shop list (the client's), shown next to the server's rows."));
    view.appendChild(panel);

    var trs = src.rows.map(function (r) {
      var row = el("tr");
      var name = el("td", "source-item");
      name.appendChild(itemCell(r.item, items));
      if (r.builtin) name.appendChild(el("span", "item-src", " *"));
      row.appendChild(name);
      cols.forEach(function (c) {
        var k = c[0], td = el("td", c[2] || null);
        if (k === "mats") {
          (r.mats || []).forEach(function (m, i) {
            if (i) td.appendChild(document.createTextNode(", "));
            td.appendChild(itemCell(m[0], items, m[1]));
          });
          (r.pieces || []).forEach(function (p, i) {
            if (i || (r.mats && r.mats.length)) td.appendChild(document.createTextNode(", "));
            td.appendChild(document.createTextNode((p[2] || "piece " + p[1]) + " (" + p[0] + ")"));
          });
        } else if (k === "price" && r.price !== undefined) {
          td.textContent = num(r.price) + ((r.cur || src.cur) ? " " + (r.cur || src.cur) : "");
          td.dataset.sort = r.price;
        } else if (k === "chance" && r.chance !== undefined) {
          td.textContent = pct(r.chance);
          td.dataset.sort = r.chance;
        } else if (k === "qty") {
          td.textContent = "x" + (r.qty || 1);
          td.dataset.sort = r.qty || 1;
        } else if (r[k] !== undefined) {
          td.textContent = typeof r[k] === "number" ? num(r[k]) : r[k];
          if (typeof r[k] === "number") td.dataset.sort = r[k];
        } else {
          td.textContent = "-";
        }
        row.appendChild(td);
      });
      var it = items[r.item];
      row.dataset.hay = ((it ? it[1] + " " + (it[3] || "") : "") + " " + r.item).toLowerCase();
      body.appendChild(row);
      return row;
    });

    function filter() {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      trs.forEach(function (row) {
        var ok = !q || q.split(/\s+/).every(function (w) { return row.dataset.hay.indexOf(w) !== -1; });
        row.hidden = !ok;
        if (ok) shown++;
      });
      count.textContent = q ? shown + " of " + trs.length + " rows" : trs.length + (trs.length === 1 ? " row" : " rows");
      var p = new URLSearchParams(location.search);
      if (q) p.set("q", input.value.trim()); else p.delete("q");
      history.replaceState(null, "", location.pathname + "?" + p.toString() + location.hash);
    }
    input.addEventListener("input", filter);
    filter();
    if (window.enhanceSortableTables) window.enhanceSortableTables(panel);

    var back = el("p", "note-text item-more");
    back.appendChild(el("a", null, "All sources")).href = "/sources.html";
    view.appendChild(back);
  }

  var id = new URLSearchParams(location.search).get("id") || "";
  if (!/^[a-z0-9-]+$/.test(id)) {
    fail("No source chosen.");
    return;
  }
  Promise.all([json("/data/sources/index.json"), json("/data/items/index.json")]).then(function (res) {
    var known = (res[0].sources || []).some(function (s) { return s[0] === id; });
    if (!known) {
      fail("There is no source called " + id + ".");
      return;
    }
    var groups = {};
    (res[0].groups || []).forEach(function (g) { groups[g[0]] = g[1]; });
    var items = {};
    (res[1].items || []).forEach(function (r) { items[r[0]] = r; });
    return json("/data/sources/" + id + ".json").then(function (src) { render(src, groups, items); });
  }).catch(function () { fail("The source could not be loaded.", true); });
})();
