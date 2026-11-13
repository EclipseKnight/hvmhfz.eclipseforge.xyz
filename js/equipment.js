/* Equipment page: /equipment.html?slot=<head|chest|arms|waist|legs|melee|ranged>&id=<the game's id>. The
   piece's name and rarity, its upgrade line (the pieces it is upgraded from, first made one first, and what it
   upgrades into), every way to make it with the materials linked to their item pages, and a Tower weapon's
   upgrade costs. Data and lists: js/equipment-materials.js (dev/make-use-data.py). Weapons link to their stats
   on /weapons.html?type=&w= (data/weapons/ids.json). */
(function () {
  "use strict";

  var view = document.getElementById("equipment-view");
  var SLOTS = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs", melee: "Melee weapon", ranged: "Ranged weapon" };
  var M = window.HvMaterials;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function section(title, note) {
    var panel = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (note) head.appendChild(el("span", "panel-head-note", note));
    panel.appendChild(head);
    return panel;
  }

  function fail(message) {
    view.textContent = "";
    view.appendChild(el("p", "empty-state", message));
    var back = el("p", "note-text");
    back.appendChild(el("a", null, "Search Items")).href = "/items.html";
    view.appendChild(back);
  }

  function title(s) { return s.replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); }); }

  function render(slot, id, data, types) {
    var e = data.names[id];
    var name = e[0];
    document.title = name + " · Hunsterverse";
    if (window.HvCrumbs) window.HvCrumbs.item(name);
    var placeholder = document.getElementById("equipment-head");
    if (placeholder) placeholder.hidden = true;
    view.textContent = "";

    var type = null;
    if (types && types[slot]) {
      var ch = types[slot].charAt(id);
      if (ch && ch !== ".") type = types.types[ch.charCodeAt(0) - 97];
    }
    var head = el("header", "item-hero");
    var info = el("div", "item-hero-info");
    info.appendChild(el("p", "kicker", type ? title(type) : SLOTS[slot]));
    info.appendChild(el("h1", null, name));
    var sub = el("p", "page-sub", "Rarity " + e[1] + " · " + SLOTS[slot] + " id " + id);
    if (type) {
      sub.appendChild(document.createTextNode(" · "));
      sub.appendChild(el("a", null, "Stats and moves on the Weapons page")).href = "/weapons.html?type=" + type + "&w=" + id;
    }
    info.appendChild(sub);
    if (window.HvSkillLinks) info.appendChild(window.HvSkillLinks.piece(slot, id)); // "Skills: ..." (js/skill-links.js)
    head.appendChild(info);
    view.appendChild(head);

    // the line: parents up to the first made piece (names.json keeps the first parent of each)
    var path = [], seen = {}, cur = e[2];
    seen[id] = true;
    while (cur && !seen[cur] && data.names[cur] && path.length < 60) {
      seen[cur] = true;
      path.unshift(cur);
      cur = data.names[cur][2];
    }
    var into = [];
    data.names.forEach(function (n, i) { if (n && n[2] === id) into.push(i); });
    var line = section("Upgrade line", path.length ? "step " + (path.length + 1) : "");
    var ol = el("ol", "eq-line");
    path.forEach(function (p) { ol.appendChild(el("li")).appendChild(M.pieceLink(data, slot, p)); });
    ol.appendChild(el("li", "eq-line-here", name));
    line.appendChild(ol);
    if (into.length) {
      var up = el("p", "eq-into");
      up.appendChild(document.createTextNode("Upgrades into: "));
      into.forEach(function (t, i) {
        if (i) up.appendChild(document.createTextNode(", "));
        up.appendChild(M.pieceLink(data, slot, t));
      });
      line.appendChild(up);
    } else {
      line.appendChild(el("p", "note-text", "No smithy upgrade goes on from this piece."));
    }
    view.appendChild(line);

    var make = (data.entry && data.entry.make) || [];
    var panel = section("Materials", make.length ? make.length + (make.length === 1 ? " way to make it" : " ways to make it") : "");
    panel.id = "materials";
    panel.appendChild(M.list(data, slot, id));
    view.appendChild(panel);

    var tower = (data.entry && data.entry.tower) || [];
    if (tower.length) {
      var tp = section("Tower upgrades", "each stat to its maximum");
      var table = el("table", "data-table");
      table.setAttribute("data-nosort", "");
      var tr = table.appendChild(el("thead")).appendChild(el("tr"));
      ["Stat", "Levels", "Materials in all"].forEach(function (h) { tr.appendChild(el("th", null, h)); });
      var body = table.appendChild(el("tbody"));
      tower.forEach(function (t) {
        var row = body.appendChild(el("tr"));
        row.appendChild(el("td", null, t[0]));
        row.appendChild(el("td", "num", String(t[1])));
        row.appendChild(el("td")).appendChild(M.mats(data, t[2]));
      });
      var wrap = el("div", "table-wrap");
      wrap.appendChild(table);
      tp.appendChild(wrap);
      view.appendChild(tp);
    }
  }

  var params = new URLSearchParams(window.location.search);
  var slot = params.get("slot") || "";
  var id = /^\d+$/.test(params.get("id") || "") ? Number(params.get("id")) : null;
  if (!SLOTS[slot] || id === null) {
    fail("No piece of equipment chosen.");
    return;
  }
  var weapon = slot === "melee" || slot === "ranged";
  Promise.all([
    M.load(slot, id),
    weapon ? fetch("/data/weapons/ids.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : null
  ]).then(function (res) {
    if (!res[0].names[id]) {
      fail("No recipe names " + SLOTS[slot].toLowerCase() + " " + id + ".");
      return;
    }
    render(slot, id, res[0], res[1]);
  }).catch(function () { fail("The equipment list could not be loaded."); });
})();
