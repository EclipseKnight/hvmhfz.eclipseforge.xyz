/* Tower weapons: /tower-weapons.html. Plan a Tower weapon's upgrades at the Tower smithy ("Level GR Weapons"):
   pick a weapon, set each stat line's level and see the stats, the points used against the weapon's budget, the
   materials and what they cost in this server's shops. Then the list of all 63 Tower weapons.

   Data: data/tower-weapons.json (dev/make-tower-weapons.py, from the game's own tables; what each field means: its
   "_about"). The build stays in the address: ?w=<weapon id>&lv=<level per line, in the weapon's line order>
   &st=<Poison|Paralysis|Sleep>&el=<0-4, the element sigil>.

   The calculation (levels -> gains, points, materials, shop prices) runs under node too: module.exports. */
(function (root) {
  "use strict";

  /* ---------- the calculation ---------- */

  function sum(list, n) {
    var s = 0;
    for (var i = 0; i < n && i < list.length; i++) s += list[i];
    return s;
  }

  // The gain and points columns of a line ({gain, points}); Status has one column per status sigil.
  function column(line, status) {
    if (line.status) return line.status[status] || line.status.Poison;
    return line;
  }

  function maxLevel(line, status) {
    return column(line, status).gain.length;
  }

  // Materials {item id: qty} for the first `level` levels of a line.
  function lineMaterials(line, level, out) {
    out = out || {};
    line.cost.forEach(function (row) {
      var n = Math.min(row[1], level - 1) - row[0] + 1;
      if (n <= 0) return;
      row[2].forEach(function (m) { out[m[0]] = (out[m[0]] || 0) + m[1] * n; });
    });
    return out;
  }

  /* A build: levels[i] for weapon.lines[i]. Returns {points, budget, over, gains: {stat: n}, materials: {item:
     qty}, sigilLines: how many lines that need a sigil have levels}. */
  function build(weapon, levels, status) {
    var out = { points: 0, budget: weapon.budget, gains: {}, materials: {}, sigilLines: 0 };
    weapon.lines.forEach(function (line, i) {
      var lv = Math.max(0, Math.min(levels[i] || 0, maxLevel(line, status)));
      var col = column(line, status);
      out.points += sum(col.points, lv);
      out.gains[line.stat] = sum(col.gain, lv);
      lineMaterials(line, lv, out.materials);
      if (line.sigil && lv > 0) out.sigilLines++;
    });
    out.over = out.points > out.budget;
    return out;
  }

  // The highest level line i can take with the other lines as they are (the smithy refuses a level over budget).
  function maxAllowed(weapon, levels, i, status) {
    var line = weapon.lines[i], col = column(line, status);
    var others = 0;
    weapon.lines.forEach(function (l, j) {
      if (j !== i) others += sum(column(l, status).points, Math.min(levels[j] || 0, maxLevel(l, status)));
    });
    var lv = 0, used = others;
    while (lv < col.gain.length && used + col.points[lv] <= weapon.budget) { used += col.points[lv]; lv++; }
    return lv;
  }

  // Attack as the game shows it: true attack x the type's factor.
  function shownAttack(attack, factor) {
    return Math.floor(attack * factor / 100);
  }

  // The whole budget into Attack: its level and gain.
  function maxAttack(weapon) {
    var line = weapon.lines[0], used = 0, lv = 0;
    while (lv < line.gain.length && used + line.points[lv] <= weapon.budget) { used += line.points[lv]; lv++; }
    return { level: lv, gain: sum(line.gain, lv) };
  }

  /* What the materials cost in each shop that sells them: [{shop, currency, total, purchases, items: [ids]}]. A
     material sold in several rows of the same shop and currency takes the cheapest per piece. */
  function shopCost(materials, shops) {
    var by = {};
    Object.keys(materials).forEach(function (id) {
      var best = {};
      (shops[id] || []).forEach(function (r) {
        var shop = r[0].indexOf("road-shop-") === 0 ? "road-shop" : r[0];
        var key = shop + "|" + r[1];
        if (!best[key] || r[2] / r[3] < best[key][2] / best[key][3]) best[key] = r;
      });
      Object.keys(best).forEach(function (key) {
        var r = best[key], n = Math.ceil(materials[id] / r[3]);
        var b = by[key] || (by[key] = { shop: key.split("|")[0], currency: r[1], total: 0, purchases: 0, items: [] });
        b.total += n * r[2];
        b.purchases += n;
        b.items.push(+id);
      });
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  // Tower clears that pay the gems on average in a District: rates = [Courage, Glittering, Divine] a clear.
  function skyClears(materials, gems, rates) {
    var most = 0;
    gems.forEach(function (id, i) {
      if (materials[id] && rates[i]) most = Math.max(most, materials[id] / rates[i]);
    });
    return Math.ceil(most);
  }

  var api = { build: build, maxAllowed: maxAllowed, maxLevel: maxLevel, lineMaterials: lineMaterials,
    shownAttack: shownAttack, maxAttack: maxAttack, shopCost: shopCost, skyClears: skyClears };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvTowerWeapons = api;
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var SHOP_NAMES = { "road-shop": "Hunting Road shop", "gcp-item-shop": "Diva GCP item shop" };
  var SHOP_LINKS = { "road-shop": "/sources.html?q=Hunting%20Road%20shop", "gcp-item-shop": "/source.html?id=gcp-item-shop" };
  var STATUSES = ["Poison", "Paralysis", "Sleep"];
  var $ = function (id) { return document.getElementById(id); };
  var data, types = {}, weapon = null, levels = [], status = "Poison", element = 0, typeSlug = "";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmt(n) { return Number(n).toLocaleString("en-GB"); }

  function itemLink(id, qty) {
    var a = el("a", null, (data.items[id] || "Item " + id) + (qty ? " x" + fmt(qty) : ""));
    a.href = "/item.html?id=" + id;
    return a;
  }

  function sharpBar(ends) {
    var bar = el("span", "sharp-bar big");
    bar.setAttribute("role", "img");
    var parts = [], prev = 0, names = ["Red", "Orange", "Yellow", "Green", "Blue", "White", "Purple", "Sky"];
    ends.forEach(function (end, i) {
      var w = end - prev;
      if (w > 0) {
        var seg = el("span", "sharp-seg");
        seg.style.width = (w / 4) + "%";
        seg.style.background = data.colourRgb[i];
        seg.title = names[i] + ": " + w;
        bar.appendChild(seg);
        parts.push(names[i] + " " + w);
      }
      prev = Math.max(prev, end);
    });
    bar.setAttribute("aria-label", "Sharpness before levels: " + parts.join(", "));
    return bar;
  }

  function sigilName(id) { return (data.items[id] || "").replace(/ Sigil$/, ""); }

  function lineLabel(line) {
    var label = line.stat;
    if (line.sigil === "element") label = "Element (" + sigilName(data.sigils.element[element]) + ")";
    if (line.sigil === "status") label = "Status (" + status + ")";
    return label;
  }

  function sigilItem(line) {
    if (line.sigil === "affinity") return data.sigils.affinity;
    if (line.sigil === "element") return data.sigils.element[element];
    if (line.sigil === "status") return data.sigils.status[status];
    return 0;
  }

  /* ---------- address ---------- */

  function readAddress() {
    var q = new URLSearchParams(location.search);
    var id = +q.get("w");
    if (STATUSES.indexOf(q.get("st")) >= 0) status = q.get("st");
    var e = +q.get("el");
    if (e >= 0 && e < 5) element = e;
    var w = data.weapons.filter(function (x) { return x.id === id; })[0] || data.weapons[0];
    var lv = (q.get("lv") || "").split(",").map(function (x) { return Math.max(0, parseInt(x, 10) || 0); });
    pick(w, w.id === id ? lv : []);
  }

  function writeAddress() {
    var q = new URLSearchParams();
    q.set("w", weapon.id);
    if (levels.some(function (x) { return x > 0; })) q.set("lv", levels.join(","));
    if (status !== "Poison") q.set("st", status);
    if (element) q.set("el", element);
    history.replaceState(null, "", location.pathname + "?" + q.toString() + location.hash);
  }

  /* ---------- planner ---------- */

  function pick(w, lv) {
    weapon = w;
    typeSlug = w.type;
    levels = w.lines.map(function () { return 0; });
    // apply the asked levels line by line, each within what the budget still allows
    w.lines.forEach(function (_l, i) { levels[i] = Math.min(lv[i] || 0, api.maxAllowed(w, levels, i, status)); });
    drawTypes();
    drawWeaponSelect();
    drawPlanner();
  }

  function drawTypes() {
    var box = $("tw-types");
    box.textContent = "";
    data.types.forEach(function (t) {
      var b = el("button", "chip", t.name);
      b.type = "button";
      b.setAttribute("aria-pressed", String(t.slug === typeSlug));
      b.addEventListener("click", function () {
        var first = data.weapons.filter(function (w) { return w.type === t.slug; })[0];
        pick(first, []);
        writeAddress();
      });
      box.appendChild(b);
    });
  }

  function drawWeaponSelect() {
    var sel = $("tw-weapon");
    sel.textContent = "";
    data.weapons.filter(function (w) { return w.type === typeSlug; }).forEach(function (w) {
      var o = el("option", null, w.name + (w.budget === 300 ? "" : " (Zenith, " + w.budget + " points)"));
      o.value = w.id;
      o.selected = w === weapon;
      sel.appendChild(o);
    });
  }

  function setLevel(i, value) {
    levels[i] = Math.max(0, Math.min(value, api.maxAllowed(weapon, levels, i, status)));
    drawPlanner();
    writeAddress();
  }

  function drawPlanner() {
    var w = weapon, t = types[w.type];
    var b = api.build(w, levels, status);
    var base = w.base;

    // the weapon
    var head = $("tw-head");
    head.textContent = "";
    var h = el("h2", null, w.name);
    head.appendChild(h);
    var facts = el("p", "tw-facts");
    var wl = el("a", null, t.name);
    wl.href = "/weapons.html?type=" + w.type + "&w=" + w.id;
    facts.appendChild(wl);
    facts.appendChild(document.createTextNode(" · Rarity " + w.rarity + " · " + w.sigils + " Tower Sigil slot" +
      (w.sigils === 1 ? "" : "s") + ", " + w.decos + " Tower Decoration slot" + (w.decos === 1 ? "" : "s") +
      " · budget " + w.budget + " points · "));
    var ml = el("a", null, "materials and upgrade line");
    ml.href = "/equipment.html?slot=" + w.kind + "&id=" + w.id;
    facts.appendChild(ml);
    head.appendChild(facts);
    var made = el("p", "tw-facts");
    made.appendChild(document.createTextNode("Made at the Tower smithy (Tower Weapons, 0 zenny) from "));
    w.craft.forEach(function (m, i) {
      if (i) made.appendChild(document.createTextNode(" and "));
      made.appendChild(itemLink(m[0], m[1]));
      var shops = data.shops[m[0]];
      if (shops) made.appendChild(document.createTextNode(" (" + shops.map(function (r) {
        return fmt(r[2]) + " " + r[1] + " in the " + SHOP_NAMES[r[0].indexOf("road-shop-") === 0 ? "road-shop" : r[0]];
      }).join(", ") + ")"));
    });
    made.appendChild(document.createTextNode("."));
    head.appendChild(made);

    // the lines
    var tbody = $("tw-lines");
    tbody.textContent = "";
    w.lines.forEach(function (line, i) {
      var tr = el("tr");
      var th = el("th", null, lineLabel(line));
      th.scope = "row";
      var sig = sigilItem(line);
      if (sig) {
        var note = el("span", "tw-needs");
        note.appendChild(document.createTextNode("needs "));
        note.appendChild(itemLink(sig));
        th.appendChild(note);
      }
      tr.appendChild(th);
      var max = api.maxLevel(line, status);
      var allowed = api.maxAllowed(w, levels, i, status);
      var td = el("td", "tw-level");
      var range = el("input");
      range.type = "range";
      range.min = 0;
      range.max = max;
      range.value = levels[i];
      range.setAttribute("aria-label", lineLabel(line) + " level");
      range.addEventListener("input", function () { setLevel(i, +range.value); });
      var num = el("input", "tw-num");
      num.type = "number";
      num.min = 0;
      num.max = max;
      num.value = levels[i];
      num.setAttribute("aria-label", lineLabel(line) + " level, number");
      num.addEventListener("change", function () { setLevel(i, parseInt(num.value, 10) || 0); });
      td.appendChild(range);
      td.appendChild(num);
      td.appendChild(el("span", "tw-of", "/ " + max + (allowed < max && allowed === levels[i] ? " (budget full)" : "")));
      tr.appendChild(td);
      tr.appendChild(el("td", "num", gainText(line, b.gains[line.stat])));
      var col = line.status ? line.status[status] : line;
      var pts = 0;
      for (var k = 0; k < levels[i] && k < col.points.length; k++) pts += col.points[k];
      tr.appendChild(el("td", "num", fmt(pts)));
      var mats = api.lineMaterials(line, Math.min(levels[i], max));
      var mt = el("td", "tw-mats");
      Object.keys(mats).forEach(function (id, j) {
        if (j) mt.appendChild(document.createTextNode(", "));
        mt.appendChild(itemLink(id, mats[id]));
      });
      if (!Object.keys(mats).length) mt.textContent = "-";
      tr.appendChild(mt);
      tbody.appendChild(tr);
    });

    // points
    var pct = Math.min(100, Math.round(b.points / b.budget * 100));
    $("tw-points-bar").style.width = pct + "%";
    $("tw-points").textContent = fmt(b.points) + " of " + fmt(b.budget) + " points used" +
      (b.points < b.budget ? " (" + fmt(b.budget - b.points) + " left)" : "");
    var warn = $("tw-warn");
    warn.hidden = b.sigilLines <= w.sigils;
    warn.textContent = "This build needs " + b.sigilLines + " Tower Sigils (Affinity, Element and Status each need " +
      "their own), but " + w.name + " has " + w.sigils + " sigil slot" + (w.sigils === 1 ? "" : "s") + ".";

    drawStats(b, base, t);
    drawCost(b);
  }

  function gainText(line, g) {
    if (!g) return "-";
    if (line.stat === "Affinity") return "+" + g + "%";
    if (line.stat === "Shelling Level" || line.stat === "Sharpness" || /^(Charge|Reload|Recoil)/.test(line.stat))
      return "+" + (line.stat === "Shelling Level" ? g / 3 : g) + " level" + ((line.stat === "Shelling Level" ? g / 3 : g) === 1 ? "" : "s");
    if (line.stat === "Attack") return "+" + fmt(api.shownAttack(g, types[weapon.type].displayFactor)) + " (true +" + g + ")";
    return "+" + fmt(g);
  }

  function drawStats(b, base, t) {
    var dl = $("tw-stats");
    dl.textContent = "";
    function stat(name, value) {
      dl.appendChild(el("dt", null, name));
      var dd = el("dd");
      if (typeof value === "string") dd.textContent = value; else dd.appendChild(value);
      dl.appendChild(dd);
    }
    var atk = base.attack + (b.gains.Attack || 0);
    stat("Attack", fmt(api.shownAttack(atk, t.displayFactor)) + " (true " + fmt(atk) + ")");
    stat("Affinity", (base.affinity + (b.gains.Affinity || 0)) + "%");
    if ("Element" in b.gains) stat("Element", b.gains.Element ? sigilName(data.sigils.element[element]) + " " + fmt(b.gains.Element) : "None");
    if ("Status" in b.gains) stat("Status", b.gains.Status ? status + " " + fmt(b.gains.Status) : "None");
    if (weapon.sharpness) {
      var box = el("span");
      box.appendChild(sharpBar(weapon.sharpness));
      box.appendChild(el("span", "tw-small", b.gains.Sharpness ? "Sharpness level +" + b.gains.Sharpness +
        ": the game lengthens this bar with each level (the bar shown is before levels)." : "Before levels."));
      stat("Sharpness", box);
    }
    if ("Shelling Level" in b.gains) {
      var shells = data.shells, i = shells.indexOf(base.special);
      var lv = (b.gains["Shelling Level"] || 0);
      stat("Shelling", i >= 0 && shells[i + lv] ? shells[i + lv] : base.special + (lv ? " +" + lv / 3 : ""));
    }
    ["Reload", "Recoil"].forEach(function (s) {
      if (s in b.gains) stat(s, "Stat " + (base[s.toLowerCase()] || 0) + (b.gains[s] ? ", +" + b.gains[s] + " level" + (b.gains[s] === 1 ? "" : "s") : ""));
    });
    if (base.charge) {
      base.charge.split(" / ").forEach(function (c, i) {
        var g = b.gains["Charge " + (i + 1)] || 0;
        stat("Charge " + (i + 1), c + (g ? ", +" + g + " level" + (g === 1 ? "" : "s") : ""));
      });
    }
  }

  function drawCost(b) {
    var box = $("tw-cost");
    box.textContent = "";
    var ids = Object.keys(b.materials);
    if (!ids.length) {
      box.appendChild(el("p", "note-text", "Set a level above to see the materials."));
      return;
    }
    var ul = el("ul", "tw-mat-list");
    ids.sort(function (a, c) { return b.materials[c] - b.materials[a]; }).forEach(function (id) {
      var li = el("li");
      li.appendChild(itemLink(id, b.materials[id]));
      if (!data.shops[id]) li.appendChild(el("span", "tw-small", " · no shop: see where to get it"));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    var costs = api.shopCost(b.materials, data.shops);
    if (costs.length) {
      var p = el("ul", "tw-buy");
      costs.forEach(function (c) {
        var li = el("li");
        var a = el("a", null, SHOP_NAMES[c.shop] || c.shop);
        a.href = SHOP_LINKS[c.shop] || "/sources.html";
        li.appendChild(a);
        li.appendChild(document.createTextNode(": " + fmt(c.total) + " " + c.currency + " in " + fmt(c.purchases) +
          " purchase" + (c.purchases === 1 ? "" : "s") + " (" + c.items.map(function (id) { return data.items[id]; }).join(", ") + ")"));
        p.appendChild(li);
      });
      ["1", "2"].forEach(function (d) {
        var n = data.skyGems[d] && api.skyClears(b.materials, data.gems, data.skyGems[d]);
        if (!n) return;
        var li = el("li");
        var a = el("a", null, "Sky Corridor");
        a.href = "/sky-corridor.html";
        li.appendChild(a);
        li.appendChild(document.createTextNode(", " + (d === "1" ? "1st" : "2nd") + " District: about " + fmt(n) +
          " tower clear" + (n === 1 ? "" : "s") + " for the gems alone (a clear pays about " +
          data.skyGems[d].map(function (x) { return Math.round(x); }).join(" / ") + " Courage / Glittering / Divine on average)"));
        p.appendChild(li);
      });
      box.appendChild(el("h3", "tw-h3", "Where to buy them here"));
      box.appendChild(p);
    }
  }

  /* ---------- list of all Tower weapons ---------- */

  function drawList() {
    var tbody = $("tw-list");
    tbody.textContent = "";
    data.weapons.forEach(function (w) {
      var t = types[w.type], m = api.maxAttack(w);
      var tr = el("tr");
      var td = el("td");
      var btn = el("button", "link-btn", w.name);
      btn.type = "button";
      btn.addEventListener("click", function () {
        pick(w, []);
        writeAddress();
        $("planner").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      td.appendChild(btn);
      tr.appendChild(td);
      tr.appendChild(el("td", null, t.name));
      tr.appendChild(el("td", "num", String(w.rarity)));
      tr.appendChild(el("td", "num", fmt(w.base.shown)));
      tr.appendChild(el("td", "num", fmt(api.shownAttack(w.base.attack + m.gain, t.displayFactor)) + " (Lv " + m.level + ")"));
      tr.appendChild(el("td", "num", String(w.budget)));
      tr.appendChild(el("td", "num", w.sigils + " / " + w.decos));
      var made = el("td");
      w.craft.forEach(function (c, i) {
        if (i) made.appendChild(document.createTextNode(" + "));
        made.appendChild(itemLink(c[0]));
      });
      tr.appendChild(made);
      tbody.appendChild(tr);
    });
  }

  /* ---------- start ---------- */

  function start() {
    $("tw-weapon").addEventListener("change", function () {
      var id = +this.value;
      pick(data.weapons.filter(function (w) { return w.id === id; })[0], []);
      writeAddress();
    });
    $("tw-reset").addEventListener("click", function () {
      levels = weapon.lines.map(function () { return 0; });
      drawPlanner();
      writeAddress();
    });
    $("tw-max-attack").addEventListener("click", function () {
      levels = weapon.lines.map(function () { return 0; });
      levels[0] = api.maxAttack(weapon).level;
      drawPlanner();
      writeAddress();
    });
    var es = $("tw-element"), ss = $("tw-status");
    data.sigils.element.forEach(function (id, i) {
      var o = el("option", null, data.items[id]);
      o.value = i;
      es.appendChild(o);
    });
    STATUSES.forEach(function (s) {
      var o = el("option", null, data.items[data.sigils.status[s]]);
      o.value = s;
      ss.appendChild(o);
    });
    es.addEventListener("change", function () { element = +es.value; drawPlanner(); writeAddress(); });
    ss.addEventListener("change", function () {
      status = ss.value;
      // a different status sigil has its own column: keep the levels within it and the budget
      weapon.lines.forEach(function (_l, i) { levels[i] = Math.min(levels[i], api.maxAllowed(weapon, levels, i, status)); });
      drawPlanner();
      writeAddress();
    });
    readAddress();
    es.value = element;
    ss.value = status;
    drawList();
    $("tw-source").textContent = "Client patch " + data.source.patch;
  }

  fetch("/data/tower-weapons.json?v=1").then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (d) {
    data = d;
    d.types.forEach(function (t) { types[t.slug] = t; });
    $("tw-loading").hidden = true;
    $("tw-app").hidden = false;
    start();
  }).catch(function () {
    $("tw-loading").textContent = "The Tower weapon data did not load. Reload the page to try again.";
  });
})(typeof window !== "undefined" ? window : this);
