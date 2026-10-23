/* Live world status and server wide hunt totals. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

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

  function renderWorlds(worlds) {
    var grid = document.getElementById("worlds");
    clear(grid);
    var online = 0;
    var lands = {};

    worlds.forEach(function (world) {
      online += world.players;
      if (!lands[world.land]) lands[world.land] = [];
      lands[world.land].push(world);
    });

    Object.keys(lands).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (land) {
      grid.appendChild(el("h3", "land-head", "Land " + land));
      lands[land].forEach(function (world) {
        var card = el("article", "world-card");
        var head = el("div", "world-head");
        head.appendChild(el("h3", null, world.name || "World"));
        card.appendChild(head);

        card.appendChild(el("p", "world-count", String(world.players)));
        card.appendChild(el("p", "world-meta", world.players === 1 ? "hunter online" : "hunters online"));
        if (world.description) card.appendChild(el("p", "world-meta", world.description));
        if (world.season) card.appendChild(el("p", "world-meta", "Season " + world.season));
        grid.appendChild(card);
      });
    });

    document.getElementById("worlds-online").textContent = online.toLocaleString() + (online === 1 ? " hunter online" : " hunters online");
    document.getElementById("worlds-updated").textContent = "updated " + new Date().toLocaleTimeString();
  }

  function renderMonsters(monsters) {
    var body = document.getElementById("monster-body");
    clear(body);
    monsters.forEach(function (monster, index) {
      var row = el("tr");
      row.appendChild(el("td", "rank", String(index + 1)));
      row.appendChild(el("td", null, monster.name));
      row.appendChild(el("td", "num", Number(monster.kills).toLocaleString()));
      body.appendChild(row);
    });
    if (!monsters.length) {
      var row = el("tr");
      var cell = el("td", "empty-cell", "No hunts recorded yet.");
      cell.colSpan = 3;
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  function load() {
    request("/api/public/worlds").then(renderWorlds).catch(function () {
      document.getElementById("worlds-online").textContent = "Status unavailable";
    });
  }

  request("/api/public/monsters?limit=10").then(renderMonsters).catch(function () {});
  load();
  setInterval(function () {
    if (document.visibilityState === "visible") load();
  }, 30000);
})();
