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

  /* The sharpness the game's weapon panel shows (mhfo-hd.dll 0x1098f740): the whole bar, covered in black from
     view.base + view.step x the level, the level being the weapon's sharpStart plus its Sharpness levels' gain;
     nothing covered from view.full up. Returns the shown end on the bar's 0-view.scale scale, null for a weapon
     without sharpness. */
  function sharpShown(weapon, gain, view) {
    if (!weapon.sharpness || weapon.sharpStart === null || weapon.sharpStart === undefined) return null;
    var level = Math.min(view.full, weapon.sharpStart + (gain || 0));
    return Math.min(view.scale, view.base + view.step * level);
  }

  // The bar's colour lengths up to `shown`: [{colour index, length}], empty colours left out.
  function sharpSegments(ends, shown) {
    var out = [], prev = 0;
    ends.forEach(function (end, i) {
      var to = Math.min(end, shown);
      if (to > prev) out.push({ colour: i, length: to - prev });
      prev = Math.max(prev, to);
    });
    return out;
  }

  // All materials a line can cost, in the order of its cost rows: [item id].
  function lineItems(line) {
    var out = [];
    line.cost.forEach(function (row) {
      row[2].forEach(function (m) { if (out.indexOf(m[0]) < 0) out.push(m[0]); });
    });
    return out;
  }

  var api = { build: build, maxAllowed: maxAllowed, maxLevel: maxLevel, lineMaterials: lineMaterials,
    shownAttack: shownAttack, maxAttack: maxAttack, shopCost: shopCost, skyClears: skyClears,
    sharpShown: sharpShown, sharpSegments: sharpSegments, lineItems: lineItems };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvTowerWeapons = api;
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var SHOP_NAMES = { "road-shop": "Hunting Road shop", "gcp-item-shop": "Diva GCP item shop" };
  var SHOP_LINKS = { "road-shop": "/sources.html?q=Hunting%20Road%20shop", "gcp-item-shop": "/source.html?id=gcp-item-shop" };
  var STATUSES = ["Poison", "Paralysis", "Sleep"];
  var $ = function (id) { return document.getElementById(id); };
  var data, types = {}, weapon = null, levels = [], status = "Poison", element = 0, typeSlug = "";
  var rows = [];   // the planner's rows: {line, range, num, of, full, adds, pts, qty: {item: span}} (drawPlanner)

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

  var SHARP_NAMES = ["Red", "Orange", "Yellow", "Green", "Blue", "White", "Purple", "Sky"];

  /* One sharpness bar as the game's weapon panel draws it: the colours up to `shown`, the rest of the 0-400 bar
     covered (dark, with a tick at each step a level uncovers). `from` > 0 outlines the part uncovered since it. */
  function sharpBar(ends, shown, from, label) {
    var view = data.sharpView, scale = view.scale;
    var bar = el("span", "sharp-bar big tw-sharp-bar");
    bar.setAttribute("role", "img");
    var parts = [];
    api.sharpSegments(ends, shown).forEach(function (s) {
      var seg = el("span", "sharp-seg");
      seg.style.width = (s.length / scale * 100) + "%";
      seg.style.background = data.colourRgb[s.colour];
      seg.title = SHARP_NAMES[s.colour] + ": " + s.length;
      bar.appendChild(seg);
      parts.push(SHARP_NAMES[s.colour] + " " + s.length);
    });
    if (shown < scale) {
      var cover = el("span", "tw-sharp-cover");
      cover.style.width = ((scale - shown) / scale * 100) + "%";
      cover.style.setProperty("--tw-step", (view.step / (scale - shown) * 100) + "%");
      cover.title = "Not shown yet: " + (scale - shown);
      bar.appendChild(cover);
    }
    if (from && from < shown) {
      var gained = el("span", "tw-sharp-gained");
      gained.style.left = (from / scale * 100) + "%";
      gained.style.width = ((shown - from) / scale * 100) + "%";
      bar.appendChild(gained);
    }
    bar.setAttribute("aria-label", label + ": " + parts.join(", ") + (shown < scale ? ", " + (scale - shown) + " not shown" : ""));
    return bar;
  }

  // The colour the shown part ends in.
  function topColour(ends, shown) {
    var segs = api.sharpSegments(ends, shown);
    return segs.length ? SHARP_NAMES[segs[segs.length - 1].colour] : "none";
  }

  // Before and after the Sharpness levels, with what each shows.
  function sharpBox(gain) {
    var w = weapon, view = data.sharpView;
    var before = api.sharpShown(w, 0, view), after = api.sharpShown(w, gain, view);
    var box = el("div", "tw-sharp");
    function row(name, shown, from) {
      var r = el("div", "tw-sharp-row");
      r.appendChild(el("span", "tw-sharp-name", name));
      r.appendChild(sharpBar(w.sharpness, shown, from, name));
      r.appendChild(el("span", "tw-sharp-text", shown + " of " + view.scale + ", to " + topColour(w.sharpness, shown)));
      box.appendChild(r);
    }
    row("Before levels", before, 0);
    row(gain ? "Sharpness +" + gain : "With levels", after, before);
    var lines = w.lines.filter(function (l) { return l.stat === "Sharpness"; })[0];
    var most = lines ? api.sharpShown(w, api.maxLevel(lines, status), view) : before;
    box.appendChild(el("p", "tw-small", "The game shows " + view.base + " of the bar's " + view.scale +
      " before levels and covers the rest; each Sharpness level shows " + view.step + " more" +
      (most < view.scale ? ", up to " + most + " for this weapon." : ", the whole bar at " +
      Math.max(0, view.full - w.sharpStart) + " levels.")));
    return box;
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
    updatePlanner();
    writeAddress();
  }

  /* The Sharpness row's control: a slider (role=slider) drawn as the weapon's sharpness bar on the game panel's
     0-400 scale, split into the panel's steps (the part shown before levels, then one step of view.step a level
     up to view.full). The part the chosen level shows is in colour, the rest covered dark; steps past this
     weapon's last level are hatched. A click, a drag (mouse, pen or touch) or the arrow / Page / Home / End keys
     set the level through setLevel, which refuses what the budget does not allow, as the other rows do. The steps
     are always all drawn, so the control's size never changes. Returns {node, update(level, max, allowed)}. */
  function sharpControl(i, line) {
    var w = weapon, view = data.sharpView, scale = view.scale;
    var gainTo = function (lv) { return line.gain.slice(0, lv).reduce(function (a, g) { return a + g; }, 0); };
    var shownAt = function (lv) { return api.sharpShown(w, gainTo(lv), view); };
    // the steps: [{from, to, level}], level null for a step this weapon's levels never reach
    var steps = [];
    for (var k = 0; k <= view.full; k++) {
      var to = Math.min(scale, view.base + view.step * k), from = k ? steps[k - 1].to : 0, lv = null;
      for (var l = 0; l <= line.gain.length; l++) if (shownAt(l) >= to) { lv = l; break; }
      steps.push({ from: from, to: to, level: lv });
    }
    var node = el("div", "tw-sc");
    node.tabIndex = 0;
    node.setAttribute("role", "slider");
    node.setAttribute("aria-label", lineLabel(line) + " level");
    node.setAttribute("aria-valuemin", "0");
    var bar = el("span", "sharp-bar big tw-sc-bar");
    bar.setAttribute("aria-hidden", "true");
    api.sharpSegments(w.sharpness, scale).forEach(function (s) {
      var seg = el("span", "sharp-seg");
      seg.style.width = (s.length / scale * 100) + "%";
      seg.style.background = data.colourRgb[s.colour];
      bar.appendChild(seg);
    });
    var cells = steps.map(function (s, k) {
      var c = el("span", "tw-sc-step", k ? "+" + (s.level === null ? k : s.level) : "");
      c.style.left = (s.from / scale * 100) + "%";
      c.style.width = ((s.to - s.from) / scale * 100) + "%";
      bar.appendChild(c);
      return c;
    });
    node.appendChild(bar);
    var cur = 0, most = 0;
    // the level a point on the bar (clientX) picks: its step's level, the last level past the weapon's steps
    function levelAt(x) {
      var r = bar.getBoundingClientRect();
      var at = Math.max(0, Math.min(1, (x - r.left) / r.width)) * scale;
      for (var k = 0; k < steps.length; k++) if (at <= steps[k].to || k === steps.length - 1) return steps[k].level === null ? most : steps[k].level;
      return most;
    }
    function set(lv) { if (lv !== cur) setLevel(i, lv); }
    var dragging = false;
    node.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      dragging = true;
      node.focus();
      if (node.setPointerCapture) node.setPointerCapture(e.pointerId);
      set(levelAt(e.clientX));
      e.preventDefault();
    });
    node.addEventListener("pointermove", function (e) { if (dragging) set(levelAt(e.clientX)); });
    var stop = function () { dragging = false; };
    node.addEventListener("pointerup", stop);
    node.addEventListener("pointercancel", stop);
    node.addEventListener("keydown", function (e) {
      var to = { ArrowRight: cur + 1, ArrowUp: cur + 1, PageUp: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur - 1,
        PageDown: cur - 1, Home: 0, End: most }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      set(Math.max(0, Math.min(most, to)));
    });
    function update(level, max, allowed) {
      cur = level;
      most = max;
      var shown = shownAt(level);
      node.setAttribute("aria-valuemax", String(max));
      node.setAttribute("aria-valuenow", String(level));
      node.setAttribute("aria-valuetext", "Sharpness +" + level + ", shows " + shown + " of " + scale);
      node.title = "Sharpness +" + level + ": shows " + shown + " of " + scale + (allowed < max ? "; the budget allows +" + allowed : "");
      steps.forEach(function (s, k) {
        var c = cells[k];
        c.classList.toggle("tw-sc-off", s.to > shown);
        c.classList.toggle("tw-sc-none", s.level === null || s.level > max);
        c.classList.toggle("tw-sc-budget", s.level !== null && s.level <= max && s.level > allowed);
      });
    }
    return { node: node, update: update };
  }

  /* The most materials any line at this place costs among the weapons of this type: every row keeps that many
     material lines, so switching weapons of a type keeps each row's height (and the sliders where they are). */
  function materialLines(i) {
    var n = 1;
    data.weapons.forEach(function (w) {
      if (w.type === weapon.type && w.lines[i]) n = Math.max(n, api.lineItems(w.lines[i]).length);
    });
    return n;
  }

  /* Draws the planner for a weapon, element or status: the head, the rows (built here once; a level change only
     updates their values, updatePlanner, so a slider being dragged stays the same element in the same place). */
  function drawPlanner() {
    var w = weapon;
    drawHead();
    var tbody = $("tw-lines");
    tbody.textContent = "";
    rows = w.lines.map(function (line, i) {
      var tr = el("tr");
      var th = el("th");
      th.scope = "row";
      th.appendChild(el("span", "tw-stat", line.stat));
      var sig = sigilItem(line);
      if (sig) {
        var note = el("span", "tw-needs");
        note.appendChild(document.createTextNode("needs "));
        note.appendChild(itemLink(sig));
        th.appendChild(note);
      }
      tr.appendChild(th);
      var td = el("td");
      var box = el("div", "tw-level");
      td.appendChild(box);
      var sharp = line.stat === "Sharpness" && api.sharpShown(w, 0, data.sharpView) !== null ? sharpControl(i, line) : null;
      var range = sharp ? sharp.node : el("input");
      if (!sharp) {
        range.type = "range";
        range.min = 0;
        range.setAttribute("aria-label", lineLabel(line) + " level");
        range.addEventListener("input", function () { setLevel(i, +range.value); });
      }
      var num = el("input", "tw-num");
      num.type = "number";
      num.min = 0;
      num.setAttribute("aria-label", lineLabel(line) + " level, number");
      num.addEventListener("change", function () { setLevel(i, parseInt(num.value, 10) || 0); });
      var of = el("span", "tw-of");
      var full = el("span", "tw-full", "budget full");
      box.appendChild(range);
      box.appendChild(num);
      box.appendChild(of);
      box.appendChild(full);
      tr.appendChild(td);
      var adds = el("td", "num tw-adds");
      var pts = el("td", "num tw-pts");
      tr.appendChild(adds);
      tr.appendChild(pts);
      var mt = el("td");
      var mbox = el("div", "tw-mats");
      mt.appendChild(mbox);
      var items = api.lineItems(line), qty = {};
      mbox.style.setProperty("--tw-mat-lines", materialLines(i));
      items.forEach(function (id) {
        var m = el("span", "tw-mat");
        qty[id] = el("span", "tw-q");
        m.appendChild(qty[id]);
        m.appendChild(document.createTextNode(" × "));
        var a = itemLink(id);
        a.title = data.items[id] || "";
        m.appendChild(a);
        mbox.appendChild(m);
      });
      tr.appendChild(mt);
      tbody.appendChild(tr);
      if (sharp) box.classList.add("tw-level-sharp");
      return { line: line, range: range, sharp: sharp, num: num, of: of, full: full, adds: adds, pts: pts, qty: qty };
    });
    updatePlanner();
  }

  // The values of a build: every row's level, max, gain, points and materials, the points, the stats and costs.
  function updatePlanner() {
    var w = weapon, t = types[w.type];
    var b = api.build(w, levels, status);
    rows.forEach(function (r, i) {
      var line = r.line, max = api.maxLevel(line, status);
      var allowed = api.maxAllowed(w, levels, i, status);
      r.num.max = max;
      if (r.sharp) r.sharp.update(levels[i], max, allowed);
      else { r.range.max = max; r.range.value = levels[i]; }
      if (document.activeElement !== r.num || +r.num.value !== levels[i]) r.num.value = levels[i];
      r.of.textContent = "/ " + max;
      r.full.style.visibility = allowed < max && allowed === levels[i] ? "visible" : "hidden";
      r.adds.textContent = gainText(line, b.gains[line.stat]);
      var col = line.status ? line.status[status] : line;
      var pts = 0;
      for (var k = 0; k < levels[i] && k < col.points.length; k++) pts += col.points[k];
      r.pts.textContent = fmt(pts);
      var mats = api.lineMaterials(line, Math.min(levels[i], max));
      Object.keys(r.qty).forEach(function (id) {
        r.qty[id].textContent = fmt(mats[id] || 0);
        r.qty[id].parentNode.classList.toggle("tw-zero", !mats[id]);
      });
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

    drawStats(b, w.base, t);
    drawCost(b);
  }

  // The weapon's name and facts, above the stats (below the sliders, so a weapon's longer text moves no slider).
  function drawHead() {
    var w = weapon, t = types[w.type];
    $("tw-name").textContent = w.name;
    var head = $("tw-head");
    head.textContent = "";
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
  }

  function gainText(line, g) {
    if (!g) return "-";
    if (line.stat === "Affinity") return "+" + g + "%";
    if (line.stat === "Sharpness" && api.sharpShown(weapon, g, data.sharpView) !== null)
      return "+" + g + " (shows " + api.sharpShown(weapon, g, data.sharpView) + ")";
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
    if (weapon.sharpness && api.sharpShown(weapon, 0, data.sharpView) !== null) stat("Sharpness", sharpBox(b.gains.Sharpness || 0));
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
      updatePlanner();
      writeAddress();
    });
    $("tw-max-attack").addEventListener("click", function () {
      levels = weapon.lines.map(function () { return 0; });
      levels[0] = api.maxAttack(weapon).level;
      updatePlanner();
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
      drawPlanner();   // the labels and sigil links change
      writeAddress();
    });
    readAddress();
    es.value = element;
    ss.value = status;
    drawList();
    $("tw-source").textContent = "Client patch " + data.source.patch;
  }

  fetch("/data/tower-weapons.json?v=2").then(function (r) {
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
