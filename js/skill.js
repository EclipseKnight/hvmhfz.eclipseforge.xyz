/* One skill: /skill.html?id=<skill tree> (levels and what each does, then everything that gives the tree's points:
   decorations, Road gems (Tower Decos), equipment with it as an automatic skill and every armour piece, each linked
   to its item or equipment page), ?road=<id> (a Road skill of the Hunting Road / Sky Corridor menu) or
   ?sigil=<item id> (a Tower sigil). Data: data/skills/index.json and data/skills/<tree>.json
   (dev/make-skill-data.py, from the game's tables). */
(function () {
  "use strict";

  var view = document.getElementById("skill-view");
  var SLOTS = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs", melee: "Melee weapon", ranged: "Ranged weapon" };
  var PAGE = 100;
  var NO_DESC = "no description in the client";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }
  function signed(n) { return (n > 0 ? "+" : "") + n; }

  function getJson(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function section(title, note) {
    var panel = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (note) head.appendChild(el("span", "panel-head-note", note));
    panel.appendChild(head);
    return panel;
  }

  function table(heads) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table sticky-first");
    var tr = el("tr");
    heads.forEach(function (h) { tr.appendChild(el("th", h[1] || null, h[0])); });
    t.appendChild(el("thead")).appendChild(tr);
    var body = t.appendChild(el("tbody"));
    wrap.appendChild(t);
    return { wrap: wrap, body: body };
  }

  function fail(message) {
    view.textContent = "";
    view.appendChild(el("p", "empty-state", message));
    var back = el("p", "note-text");
    back.appendChild(el("a", null, "All skills")).href = "/skills.html";
    view.appendChild(back);
  }

  function hero(kicker, name, sub) {
    document.title = name + " · Hunsterverse";
    if (window.HvCrumbs) window.HvCrumbs.item(name);
    var placeholder = document.getElementById("skill-head");
    if (placeholder) placeholder.hidden = true;
    view.textContent = "";
    var head = el("header", "item-hero");
    var info = el("div", "item-hero-info");
    info.appendChild(el("p", "kicker", kicker));
    info.appendChild(el("h1", null, name));
    info.appendChild(el("p", "page-sub", sub));
    head.appendChild(info);
    view.appendChild(head);
  }

  function yesNo(v) { return v ? "Yes" : "No"; }

  function pieceCell(slot, id, name, page) {
    var td = el("td");
    if (page) td.appendChild(el("a", null, name || SLOTS[slot] + " " + id)).href = "/equipment.html?slot=" + slot + "&id=" + id;
    else td.textContent = name || SLOTS[slot] + " " + id;
    return td;
  }

  function itemCell(id, name, icon) {
    var td = el("td");
    var a = el("a", "skill-item");
    a.href = "/item.html?id=" + id;
    if (icon) {
      var img = el("img");
      img.src = "/assets/icons/1x/" + icon + ".png";
      img.alt = "";
      img.width = 24;
      img.height = 24;
      img.loading = "lazy";
      a.appendChild(img);
    }
    a.appendChild(document.createTextNode(name));
    td.appendChild(a);
    return td;
  }

  function levelsPanel(t) {
    var p = section("Levels", t.levels.length + (t.levels.length === 1 ? " level" : " levels"));
    p.appendChild(el("p", "note-text", "A level turns on when the tree's points from armour, decorations and " +
      "Road gems reach it (at or below it for a minus level); the highest level reached wins."));
    var tb = table([["Points", "num"], ["Skill"], ["What it does"]]);
    t.levels.forEach(function (l) {
      var tr = el("tr");
      var unreachable = Math.abs(l[0]) >= 1000;
      tr.appendChild(el("td", "num", unreachable ? num(l[0]) : signed(l[0])));
      tr.appendChild(el("td", null, l[2]));
      tr.appendChild(el("td", null, unreachable ? "Never turns on: no set reaches " + num(l[0]) + " points (the game's way to leave a level unused)." :
        l[3] && l[3] !== NO_DESC ? l[3] : "No description in the game's text."));
      tb.body.appendChild(tr);
    });
    p.appendChild(tb.wrap);
    return p;
  }

  function decoPanel(title, rows, what) {
    var p = section(title, num(rows.length) + " " + what);
    var tb = table([["Name"], ["Points", "num"], ["Slots", "num"], ["Players can get it"]]);
    rows.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(itemCell(r[0], r[1], r[6]));
      tr.appendChild(el("td", "num", signed(r[4])));
      tr.appendChild(el("td", "num", String(r[3])));
      tr.appendChild(el("td", null, yesNo(r[5])));
      tb.body.appendChild(tr);
    });
    p.appendChild(tb.wrap);
    return p;
  }

  function autoPanel(rows, t) {
    var names = {};
    t.levels.forEach(function (l) { names[l[1]] = l[2]; });
    var p = section("Automatic skill", num(rows.length) + " pieces of equipment");
    p.appendChild(el("p", "note-text", "Equipment that has the skill on by itself, without points (the game's " +
      "automatic skill list, shown on the guild card's Automatic Skills page)."));
    var tb = table([["Equipment"], ["Slot"], ["Skill"], ["Players can get it"]]);
    rows.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(pieceCell(r[0], r[1], r[2], r[5]));
      tr.appendChild(el("td", null, SLOTS[r[0]]));
      tr.appendChild(el("td", null, names[r[3]] || "Skill " + r[3]));
      tr.appendChild(el("td", null, yesNo(r[4])));
      tb.body.appendChild(tr);
    });
    p.appendChild(tb.wrap);
    return p;
  }

  /* Every armour piece with the tree's points: a name filter, "only pieces players can get" (on at first),
     100 rows at a time. */
  function armourPanel(rows) {
    var got = rows.filter(function (r) { return r[5]; }).length;
    var p = section("Armour", num(got) + " pieces players can get, " + num(rows.length) + " in the game's data");
    p.id = "armour";
    var tools = el("div", "toolbar");
    var label = el("label", "search");
    label.appendChild(el("span", "search-label", "Find a piece"));
    var q = el("input");
    q.type = "search";
    q.placeholder = "Name, e.g. Zenith or ZP";
    label.appendChild(q);
    tools.appendChild(label);
    var only = el("label", "check-label");
    var box = el("input");
    box.type = "checkbox";
    box.checked = got > 0;
    only.appendChild(box);
    only.appendChild(document.createTextNode(" Only pieces players can get"));
    tools.appendChild(only);
    var note = el("span", "toolbar-note");
    note.setAttribute("aria-live", "polite");
    tools.appendChild(note);
    p.appendChild(tools);
    var tb = table([["Piece"], ["Slot"], ["Rarity", "num"], ["Points", "num"], ["Players can get it"]]);
    p.appendChild(tb.wrap);
    var more = el("button", "ghost-btn small", "Show more");
    more.type = "button";
    p.appendChild(more);
    var list = [], shown = 0;

    function draw() {
      var end = Math.min(list.length, shown + PAGE);
      for (var i = shown; i < end; i++) {
        var r = list[i];
        var tr = el("tr");
        tr.appendChild(pieceCell(r[0], r[1], r[2], r[6]));
        tr.appendChild(el("td", null, SLOTS[r[0]]));
        tr.appendChild(el("td", "num", String(r[3])));
        tr.appendChild(el("td", "num", signed(r[4])));
        tr.appendChild(el("td", null, yesNo(r[5])));
        tb.body.appendChild(tr);
      }
      shown = end;
      more.hidden = shown >= list.length;
      note.textContent = list.length ? "Showing " + num(shown) + " of " + num(list.length) : "";
    }

    function filter() {
      var words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      list = rows.filter(function (r) {
        if (box.checked && !r[5]) return false;
        var name = r[2].toLowerCase();
        return words.every(function (w) { return name.indexOf(w) !== -1; });
      });
      tb.body.textContent = "";
      shown = 0;
      draw();
      if (!list.length) {
        var tr = el("tr");
        var td = el("td", "empty-state", "No piece matches.");
        td.colSpan = 5;
        tr.appendChild(td);
        tb.body.appendChild(tr);
      }
    }
    q.addEventListener("input", filter);
    box.addEventListener("change", filter);
    more.addEventListener("click", draw);
    filter();
    return p;
  }

  function renderTree(t) {
    var decos = t.decorations.filter(function (r) { return r[2] === "d"; });
    var gems = t.decorations.filter(function (r) { return r[2] === "g"; });
    hero(t.category, t.name, "Skill tree " + t.id + " · from the game's data · " + num(t.armour.length) +
      " armour pieces, " + num(decos.length) + " decorations, " + num(gems.length) + " Road gems");
    view.appendChild(levelsPanel(t));
    if (decos.length) view.appendChild(decoPanel("Decorations", decos, "decorations"));
    if (gems.length) {
      var gp = decoPanel("Road gems (Tower Decos)", gems, "gems");
      gp.insertBefore(el("p", "note-text", "Gems for the slots of Tower weapons; they work in any quest."), gp.children[1]);
      view.appendChild(gp);
    }
    if (t.automatic.length) view.appendChild(autoPanel(t.automatic, t));
    if (t.armour.length) view.appendChild(armourPanel(t.armour));
    if (!t.armour.length && !t.decorations.length && !t.automatic.length) {
      view.appendChild(el("p", "empty-state", "Nothing in the game's data gives this skill's points."));
    }
    var back = el("p", "note-text item-more");
    back.appendChild(el("a", null, "All skills")).href = "/skills.html?cat=" + encodeURIComponent(t.category);
    view.appendChild(back);
  }

  function renderRoad(r) {
    hero("Road skill", r[1], "Hunting Road / Sky Corridor skill menu · " + r[4] + (r[6] ? " · put back in the menu by our client patch" : ""));
    var p = section("Levels", r[3] + (r[3] === 1 ? " level" : " levels"));
    var ol = el("ol", "skill-road-levels");
    (r[5].length ? r[5] : ["No description in the game's text."]).forEach(function (text) { ol.appendChild(el("li", null, text)); });
    p.appendChild(ol);
    p.appendChild(el("p", "note-text", "Bought with Road points in the skill menu of the Hunting Road and the Sky Corridor; " +
      "not an armour skill. Guide: "));
    p.lastChild.appendChild(el("a", null, "Hunting Road")).href = "/guide-frontier-hunters-road.html";
    view.appendChild(p);
  }

  function renderSigil(s) {
    hero("Tower sigil", s[1], s[3]);
    var p = section("Effect");
    p.appendChild(el("p", null, s[4]));
    var a = el("p", "note-text");
    a.appendChild(el("a", null, "The sigil's item page: where to get it")).href = "/item.html?id=" + s[0];
    p.appendChild(a);
    view.appendChild(p);
  }

  var params = new URLSearchParams(location.search);
  function digits(v) { return /^\d+$/.test(v || "") ? Number(v) : null; }
  var id = digits(params.get("id")), road = digits(params.get("road")), sigil = digits(params.get("sigil"));
  if (id === null && road === null && sigil === null) {
    fail("No skill chosen.");
    return;
  }
  if (id !== null) {
    getJson("/data/skills/" + id + ".json").then(renderTree).catch(function () { fail("No skill tree " + id + " in the game's data."); });
    return;
  }
  getJson("/data/skills/index.json").then(function (index) {
    var list = road !== null ? index.road : index.sigils;
    var key = road !== null ? road : sigil;
    var row = (list || []).filter(function (r) { return r[0] === key; })[0];
    if (!row) { fail(road !== null ? "No Road skill " + road + "." : "No Tower sigil with item id " + sigil + "."); return; }
    if (road !== null) renderRoad(row); else renderSigil(row);
  }).catch(function () { fail("The list of skills could not be loaded."); });
})();
