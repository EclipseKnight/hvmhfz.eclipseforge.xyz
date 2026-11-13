/* Sources: /sources.html, every place items come from on Hunsterverse (data/sources/index.json, from
   dev/make-source-data.py), grouped (shops, gacha, events and gifts, Sky Corridor, crafting, exchanges, quests),
   each with how many items it gives and linking to its page /source.html?id=. The box filters by name as you type
   (?q= stays in the address). */
(function () {
  "use strict";

  var view = document.getElementById("sources-view");
  var input = document.getElementById("sources-q");
  var count = document.getElementById("sources-count");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }

  function render(data) {
    view.textContent = "";
    var rows = [];
    (data.groups || []).forEach(function (g) {
      var mine = (data.sources || []).filter(function (s) { return s[2] === g[0]; });
      if (!mine.length) return;
      var panel = el("section", "panel sources-group");
      panel.id = "group-" + g[0];
      var head = el("div", "panel-head");
      head.appendChild(el("h2", null, g[1]));
      head.appendChild(el("span", "panel-head-note", mine.length + (mine.length === 1 ? " source" : " sources")));
      panel.appendChild(head);
      panel.appendChild(el("p", "note-text", g[2]));
      var wrap = el("div", "table-wrap");
      var table = el("table", "data-table sticky-first sources-table");
      var tr = el("tr");
      [["Source"], ["Items", "num"], ["Currency"], ["What it is"]].forEach(function (h) { tr.appendChild(el("th", h[1] || null, h[0])); });
      table.appendChild(el("thead")).appendChild(tr);
      var body = el("tbody");
      mine.forEach(function (s) {
        var row = el("tr");
        var name = el("td");
        name.appendChild(el("a", null, s[1])).href = "/source.html?id=" + encodeURIComponent(s[0]);
        row.appendChild(name);
        var n = el("td", "num", num(s[4]));
        n.dataset.sort = s[4];
        row.appendChild(n);
        row.appendChild(el("td", null, s[3] || "-"));
        row.appendChild(el("td", null, s[5] || ""));
        row.dataset.hay = (s[1] + " " + g[1] + " " + (s[3] || "")).toLowerCase();
        body.appendChild(row);
        rows.push([row, panel]);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      panel.appendChild(wrap);
      view.appendChild(panel);
    });
    if (data.taken) {
      view.appendChild(el("p", "note-text", "From the server's shops, events and quest lists as of " + data.taken +
        ", and the game's own tables. An item's page lists every way to get it."));
    }

    function filter() {
      var q = input.value.trim().toLowerCase();
      var shown = 0, open = {};
      rows.forEach(function (r) {
        var ok = !q || q.split(/\s+/).every(function (w) { return r[0].dataset.hay.indexOf(w) !== -1; });
        r[0].hidden = !ok;
        if (ok) { shown++; open[r[1].id] = true; }
      });
      rows.forEach(function (r) { r[1].hidden = !open[r[1].id]; });
      count.textContent = (q ? shown + " of " : "") + rows.length + " sources";
      var p = new URLSearchParams(location.search);
      if (q) p.set("q", input.value.trim()); else p.delete("q");
      var text = p.toString();
      history.replaceState(null, "", location.pathname + (text ? "?" + text : "") + location.hash);
    }
    if (window.enhanceSortableTables) window.enhanceSortableTables(view);
    input.value = new URLSearchParams(location.search).get("q") || "";
    input.addEventListener("input", filter);
    filter();
  }

  function load() {
    fetch("/data/sources/index.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(render).catch(function () {
      view.textContent = "";
      view.appendChild(el("p", "empty-state", "The list of sources could not be loaded."));
      var b = el("button", "ghost-btn small", "Try again");
      b.type = "button";
      b.addEventListener("click", load);
      view.appendChild(b);
    });
  }
  load();
})();
