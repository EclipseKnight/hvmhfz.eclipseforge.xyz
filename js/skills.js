/* Skills: /skills.html, every skill on Hunsterverse from the game's data (data/skills/index.json, from
   dev/make-skill-data.py): the armour skill trees with their levels and how many armour pieces, decorations,
   Road gems and automatic skills give each; the Road skills (Hunting Road / Sky Corridor menu) and the Tower
   sigils. Chips filter by category (?cat=), the box by name or level (?q=); each row links to /skill.html. */
(function () {
  "use strict";

  var view = document.getElementById("skills-view");
  var input = document.getElementById("skills-q");
  var count = document.getElementById("skills-count");
  var chips = document.getElementById("skills-cats");
  var ROAD = "Road skills", SIGILS = "Tower sigils";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }
  function signed(n) { return (n > 0 ? "+" : "") + n; }

  function numCell(n, title) {
    var td = el("td", "num", n ? num(n) : "-");
    td.dataset.sort = n;
    if (title) td.title = title;
    return td;
  }

  function table(heads) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table sticky-first skills-table");
    var tr = el("tr");
    heads.forEach(function (h) { tr.appendChild(el("th", h[1] || null, h[0])); });
    t.appendChild(el("thead")).appendChild(tr);
    var body = t.appendChild(el("tbody"));
    wrap.appendChild(t);
    return { wrap: wrap, body: body };
  }

  function panel(id, title, note, text) {
    var p = el("section", "panel skills-group");
    p.id = id;
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (note) head.appendChild(el("span", "panel-head-note", note));
    p.appendChild(head);
    if (text) p.appendChild(el("p", "note-text", text));
    return p;
  }

  function nameCell(text, href) {
    var td = el("td");
    td.appendChild(el("a", null, text)).href = href;
    return td;
  }

  function render(data) {
    view.textContent = "";
    var rows = [];   // [tr, panel, category]
    var trees = data.trees || [];

    var tp = panel("trees", "Armour skills", num(trees.length) + " skill trees",
      "Add up a tree's points from armour, decorations and Road gems; at a level's points the skill turns on " +
      "(minus points turn on the bad one). Counts: armour pieces players can get, decorations, Road gems " +
      "(Tower Decos) and equipment with it as an automatic skill.");
    var t = table([["Skill tree"], ["Category"], ["Levels"], ["Armour", "num"], ["Decorations", "num"],
                   ["Road gems", "num"], ["Automatic", "num"]]);
    trees.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(nameCell(r[1], "/skill.html?id=" + r[0]));
      tr.appendChild(el("td", null, r[2]));
      var levels = r[3].filter(function (l) { return Math.abs(l[0]) < 1000; })
        .map(function (l) { return signed(l[0]) + " " + l[2]; });
      tr.appendChild(el("td", "skills-levels", levels.join(" · ")));
      tr.appendChild(numCell(r[4], num(r[5]) + " pieces in the game's data, " + num(r[4]) + " that players can get"));
      tr.appendChild(numCell(r[6]));
      tr.appendChild(numCell(r[7]));
      tr.appendChild(numCell(r[8]));
      tr.dataset.hay = (r[1] + " " + r[2] + " " + levels.join(" ")).toLowerCase();
      t.body.appendChild(tr);
      rows.push([tr, tp, r[2]]);
    });
    tp.appendChild(t.wrap);
    view.appendChild(tp);

    var road = data.road || [];
    var rp = panel("road", ROAD, num(road.length) + " skills",
      "The skills bought with Road points in the Hunting Road and Sky Corridor skill menu (not armour skills).");
    t = table([["Skill"], ["Menu tab"], ["Levels", "num"], ["Where it works"], ["What it does"]]);
    road.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(nameCell(r[1], "/skill.html?road=" + r[0]));
      tr.appendChild(el("td", null, r[2] === "-" ? "-" : r[2].charAt(0).toUpperCase() + r[2].slice(1)));
      tr.appendChild(numCell(r[3]));
      tr.appendChild(el("td", null, r[4]));
      tr.appendChild(el("td", null, r[5][0] || ""));
      tr.dataset.hay = (r[1] + " " + r[4] + " " + r[5].join(" ")).toLowerCase();
      t.body.appendChild(tr);
      rows.push([tr, rp, ROAD]);
    });
    rp.appendChild(t.wrap);
    view.appendChild(rp);

    var sig = data.sigils || [];
    var sp = panel("sigils", SIGILS, num(sig.length) + " sigils",
      "Tower sigils give a Tower weapon a special effect (weapon moves, element, status, shots).");
    t = table([["Sigil"], ["Kind"], ["Effect"]]);
    sig.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(nameCell(r[1], "/skill.html?sigil=" + r[0]));
      tr.appendChild(el("td", null, r[3]));
      tr.appendChild(el("td", null, r[4]));
      tr.dataset.hay = (r[1] + " " + r[3] + " " + r[4]).toLowerCase();
      t.body.appendChild(tr);
      rows.push([tr, sp, SIGILS]);
    });
    sp.appendChild(t.wrap);
    view.appendChild(sp);
    view.appendChild(el("p", "note-text", "From the game's own tables (skill names and descriptions as the " +
      "English client shows them). Categories follow the community Armor Skill List."));

    var cats = [""].concat(data.categories || [], [ROAD, SIGILS]);
    chips.textContent = "";
    cats.forEach(function (c) {
      var b = el("button", "chip", c || "All");
      b.type = "button";
      b.dataset.cat = c;
      b.addEventListener("click", function () { cat = c; filter(); });
      chips.appendChild(b);
    });

    var params = new URLSearchParams(location.search);
    var cat = cats.indexOf(params.get("cat") || "") > 0 ? params.get("cat") : "";

    function filter() {
      var q = input.value.trim().toLowerCase();
      var shown = 0, open = {};
      rows.forEach(function (r) {
        var ok = (!cat || r[2] === cat) &&
          (!q || q.split(/\s+/).every(function (w) { return r[0].dataset.hay.indexOf(w) !== -1; }));
        r[0].hidden = !ok;
        if (ok) { shown++; open[r[1].id] = true; }
      });
      [tp, rp, sp].forEach(function (p) { p.hidden = !open[p.id]; });
      Array.prototype.forEach.call(chips.children, function (b) { b.setAttribute("aria-pressed", String(b.dataset.cat === cat)); });
      count.textContent = (q || cat ? num(shown) + " of " : "") + num(rows.length) + " skills";
      var p = new URLSearchParams(location.search);
      if (q) p.set("q", input.value.trim()); else p.delete("q");
      if (cat) p.set("cat", cat); else p.delete("cat");
      var text = p.toString();
      history.replaceState(null, "", location.pathname + (text ? "?" + text : "") + location.hash);
    }
    if (window.enhanceSortableTables) window.enhanceSortableTables(view);
    input.value = params.get("q") || "";
    input.addEventListener("input", filter);
    filter();
  }

  function load() {
    fetch("/data/skills/index.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(render).catch(function () {
      view.textContent = "";
      view.appendChild(el("p", "empty-state", "The list of skills could not be loaded."));
      var b = el("button", "ghost-btn small", "Try again");
      b.type = "button";
      b.addEventListener("click", load);
      view.appendChild(b);
    });
  }
  load();
})();
