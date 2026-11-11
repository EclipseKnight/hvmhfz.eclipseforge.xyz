/* Weapons page: weapon list per type, weapon detail with its moves, and the damage calculator.
 *
 * Data: data/weapons/index.json (types, sharpness multipliers, formula constants, skill names) and one
 * data/weapons/<type>.json per weapon type, both written by dev/make-weapons-data.py from the game files.
 * The formula itself is js/weapons-calc.js (HvWeaponsCalc), tested by dev/check-weapons.js.
 * Monster hitzone presets come from the game's data (data/monsters/game/<id>.json), per rank, state and part;
 * monsters without it use their page's community table (data/monsters/<slug>.json).
 *
 * URL: ?type=<slug>&w=<weapon id> opens a type and a weapon; q, elem, rarity, sort, dir=desc and page (from 2) keep
 * the list's search, filters, sort and page (defaults left out; syncUrl).
 */
(function () {
  "use strict";

  var Calc = window.HvWeaponsCalc;
  var Icons = window.HvGameIcons;
  var PAGE_SIZE = 100;
  var STYLE_NAMES = { E: "Earth", H: "Heaven", S: "Storm", X: "Extreme" };
  var ELEMENT_ZONE = { Fire: "fire", Water: "water", Thunder: "thunder", Dragon: "dragon", Ice: "ice" };
  var IMPACT_CLASSES = [2, 8, 11]; // Hammer, Hunting Horn, Tonfa deal impact damage; the rest cut by default

  var $ = function (id) { return document.getElementById(id); };
  var index = null;         // data/weapons/index.json
  var doc = null;           // the open type's file
  var cache = {};
  var state = { sort: "id", dir: 1, page: 0, weapon: null, style: "", rows: [] };
  var monsterCache = {};
  var iconData = null;      // data/equipment-icons.json (null until loaded, or when it cannot be): placeholders then

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }

  /* A weapon's in-game icon, its type in its rank colour (js/game-icons.js, the same lookup as the catalog), as
     a <span class="gi">. extra: the size class (gi-small 20 px, gi-large 48 px). null when the helper is missing. */
  function weaponIcon(w, extra) {
    return Icons ? Icons.equipmentIcon(iconData, { id: field(w, "id"), kind: isMelee() ? "melee" : "ranged" }, extra) : null;
  }

  function field(w, name) { return w[doc.fields.indexOf(name)]; }

  function isMelee() { return doc && doc.kind === "melee"; }

  /* ---------- sharpness ---------- */

  function maxLevel(ends) {
    var top = 0;
    for (var i = 0; i < ends.length; i++) if (ends[i] > (i ? ends[i - 1] : 0)) top = i;
    return top;
  }

  function sharpBar(ends, big) {
    var bar = el("span", "sharp-bar" + (big ? " big" : ""));
    bar.setAttribute("role", "img");
    var parts = [];
    var prev = 0;
    ends.forEach(function (end, i) {
      var w = end - prev;
      if (w > 0) {
        var seg = el("span", "sharp-seg");
        seg.style.width = (w / 4) + "%";
        seg.style.background = index.colourRgb[i];
        seg.title = index.colours[i] + ": " + w;
        bar.appendChild(seg);
        parts.push(index.colours[i] + " " + w);
      }
      prev = Math.max(prev, end);
    });
    bar.setAttribute("aria-label", "Sharpness: " + parts.join(", "));
    return bar;
  }

  /* ---------- list ---------- */

  function columns() {
    var base = [
      { key: "name", label: "Name" }, { key: "rarity", label: "Rarity", num: true },
      { key: "shown", label: "Attack", num: true, title: "As the game shows it (true attack × the type's factor)" },
      { key: "attack", label: "True", num: true, title: "True attack: what the damage formula uses" },
      { key: "affinity", label: "Affinity", num: true }
    ];
    if (doc.kind === "melee") {
      base.push({ key: "element", label: "Element" }, { key: "status", label: "Status" },
        { key: "slots", label: "Slots", num: true }, { key: "sharpness", label: "Sharpness", nosort: true });
      if (doc.class === 8 || doc.class === 9 || doc.class === 12) {
        base.push({ key: "special", label: { 8: "Notes", 9: "Shelling", 12: "Phial" }[doc.class] });
      }
    } else if (doc.kind === "bow") {
      base.push({ key: "element", label: "Element" },
        { key: "slots", label: "Slots", num: true }, { key: "charge", label: "Charge levels" },
        { key: "arcShot", label: "Arc shot" });
    } else {
      base.push({ key: "slots", label: "Slots", num: true }, { key: "recoil", label: "Recoil", num: true },
        { key: "reload", label: "Reload", num: true });
    }
    return base;
  }

  function elemText(w, kind) {
    var name = field(w, kind), v = field(w, kind + "Value");
    return name ? name + " " + v * 10 : "";
  }

  function sortValue(w, key) {
    if (key === "element" || key === "status") return field(w, key) ? field(w, key) + String(1000 + field(w, key + "Value")) : "";
    return field(w, key);
  }

  function renderHead() {
    var tr = el("tr");
    columns().forEach(function (c) {
      var th = el("th", c.num ? "num" : "");
      th.scope = "col";
      if (c.nosort) { th.textContent = c.label; tr.appendChild(th); return; }
      var b = el("button", "wp-sort", c.label);
      b.type = "button";
      if (c.title) b.title = c.title;
      b.addEventListener("click", function () {
        state.dir = state.sort === c.key ? -state.dir : (c.num ? -1 : 1);
        state.sort = c.key;
        state.page = 0;
        renderList();
      });
      th.setAttribute("aria-sort", state.sort === c.key ? (state.dir > 0 ? "ascending" : "descending") : "none");
      th.appendChild(b);
      tr.appendChild(th);
    });
    var head = $("wp-head");
    head.textContent = "";
    head.appendChild(tr);
  }

  function filtered() {
    var q = $("wp-search").value.trim().toLowerCase();
    var elem = $("wp-elem").value, rarity = $("wp-rarity").value;
    var rows = doc.weapons.filter(function (w) {
      if (q && String(field(w, "id")) !== q && field(w, "name").toLowerCase().indexOf(q) < 0) return false;
      if (rarity && String(field(w, "rarity")) !== rarity) return false;
      if (elem === "none" && (field(w, "element") || field(w, "status"))) return false;
      if (elem && elem !== "none" && field(w, "element") !== elem && field(w, "status") !== elem) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var x = sortValue(a, key), y = sortValue(b, key);
      if (x === y) return field(a, "id") - field(b, "id");
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      if (x === "") return 1;
      if (y === "") return -1;
      return String(x).localeCompare(String(y)) * dir;
    });
    return rows;
  }

  function renderList() {
    renderHead();
    var rows = state.rows = filtered();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    var body = $("wp-body");
    body.textContent = "";
    var cols = columns();
    if (!rows.length) {
      var tr0 = el("tr", "no-results"), td0 = el("td", "", "No weapon matches.");
      td0.colSpan = cols.length;
      tr0.appendChild(td0);
      body.appendChild(tr0);
    }
    rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).forEach(function (w) {
      var tr = el("tr");
      if (state.weapon && field(state.weapon, "id") === field(w, "id")) tr.className = "is-picked";
      cols.forEach(function (c) {
        var td = el("td", c.num ? "num" : "");
        if (c.key === "name") {
          var ic = weaponIcon(w, "gi-small");
          if (ic) td.appendChild(ic);
          var b = el("button", "wp-pick", field(w, "name"));
          b.type = "button";
          b.addEventListener("click", function () { pick(w, true); });
          td.appendChild(b);
          td.appendChild(el("span", "wp-id", "#" + field(w, "id")));
        } else if (c.key === "sharpness") {
          td.appendChild(sharpBar(doc.bars[field(w, "sharpness")]));
        } else if (c.key === "element" || c.key === "status") {
          td.textContent = elemText(w, c.key);
        } else if (c.key === "affinity") {
          var a = field(w, "affinity");
          td.textContent = a ? (a > 0 ? "+" : "") + a + "%" : "0%";
        } else {
          td.textContent = field(w, c.key);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $("wp-results").textContent = rows.length === doc.weapons.length ? "" : rows.length + " of " + doc.weapons.length;
    $("wp-pager").hidden = pages < 2;
    $("wp-page-note").textContent = "Page " + (state.page + 1) + " of " + pages;
    $("wp-prev").disabled = state.page === 0;
    $("wp-next").disabled = state.page >= pages - 1;
    syncUrl();
  }

  /* The URL mirrors the open type, weapon and the list's search, filters, sort and page (defaults left out),
     so a reload or a shared link shows the same list. Replaces the entry; no history is added. */
  function syncUrl() {
    if (!doc) return;
    var u = new URL(location.href), sp = u.searchParams;
    function put(name, value) { if (value) sp.set(name, value); else sp.delete(name); }
    sp.set("type", doc.type);
    put("w", state.weapon ? String(field(state.weapon, "id")) : "");
    put("q", $("wp-search").value.trim());
    put("elem", $("wp-elem").value);
    put("rarity", $("wp-rarity").value);
    put("sort", state.sort !== "id" || state.dir < 0 ? state.sort : "");
    put("dir", state.dir < 0 ? "desc" : "");
    put("page", state.page > 0 ? String(state.page + 1) : "");
    history.replaceState(null, "", u);
  }

  /* The list state from the URL (after the type's filters are filled): only values that exist are taken. */
  function applyUrlState(params) {
    var q = (params.get("q") || "").trim();
    if (q) $("wp-search").value = q;
    ["elem", "rarity"].forEach(function (name) {
      var sel = $("wp-" + name), v = params.get(name);
      if (v && Array.prototype.some.call(sel.options, function (o) { return o.value === v; })) sel.value = v;
    });
    var col = columns().filter(function (c) { return c.key === params.get("sort") && !c.nosort; })[0];
    if (col) state.sort = col.key;
    if (params.get("dir") === "desc") state.dir = -1;
    if (/^[1-9]\d{0,4}$/.test(params.get("page") || "")) state.page = Number(params.get("page")) - 1;
  }

  function fillFilters() {
    var elemSel = $("wp-elem"), rar = $("wp-rarity");
    $("wp-elem-wrap").hidden = !isMelee();
    elemSel.length = 1;
    rar.length = 1;
    if (isMelee()) {
      var seen = {};
      doc.weapons.forEach(function (w) {
        if (field(w, "element")) seen[field(w, "element")] = 1;
        if (field(w, "status")) seen[field(w, "status")] = 2;
      });
      elemSel.add(new Option("None", "none"));
      Object.keys(seen).sort().forEach(function (k) { elemSel.add(new Option(k, k)); });
    }
    var rs = {};
    doc.weapons.forEach(function (w) { rs[field(w, "rarity")] = 1; });
    Object.keys(rs).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) { rar.add(new Option(String(r), String(r))); });
  }

  /* ---------- detail ---------- */

  function styleText(s) { return s || "?"; }

  // Name first, the confidence badge, the id small; how it is used under it; what it is, input and sources in a tap
  // detail (js/move-names.js).
  function moveCell(m) {
    return window.HvMoveNames.fill(el("td", "mv-cell"), m, m.set + " #" + m.id, { slug: doc.type, parent: parentOf(m) });
  }

  // The move a later hit belongs to (its "use".parent), or null.
  function parentOf(m) {
    var p = m.use && m.use.parent, MN = window.HvMoveNames;
    return p ? doc.moves.filter(function (x) { return MN.ref(x) === p; })[0] || null : null;
  }

  // Both move tables (list and calculator): the moves of a style the toggle lets through, later hits folded under
  // their parent (js/move-names.js fold). row(m) makes a move's row; a parent row gets the "+N later hits" button,
  // its later hits follow it, hidden until opened (kept open across redraws). A never-used move, shown when the
  // toggle is on, is dimmed. Returns the number of rows; the toggles say how many moves the toggle hides.
  var openFolds = {};
  function moveRows(body, list, row, legendId) {
    var MN = window.HvMoveNames, all = MN.showAll(), n = 0;
    var kept = list.filter(function (m) { return !MN.hidden(m, all); });
    var toggle = $(legendId).querySelector(".mv-toggle");
    if (toggle) toggle.setCount(list.length - kept.length);
    MN.fold(kept).forEach(function (g) {
      var tr = row(g.item);
      if (g.item.show === "hide") tr.classList.add("mv-unused");
      body.appendChild(tr);
      n++;
      var later = g.later.map(function (m) {
        var r = row(m);
        r.classList.add("mv-later");
        body.appendChild(r);
        n++;
        return r;
      });
      if (later.length) {
        var key = doc.type + ":" + MN.ref(g.item);
        tr.cells[0].appendChild(MN.foldButton(later, openFolds[key], function (o) { openFolds[key] = o; }));
      }
    });
    return n;
  }

  function mvText(m) { return m.mv.join(" + ") + (m.repeats ? " (repeats)" : ""); }

  function bonusOf(kind, id) { return doc.mvBonus[kind + ":" + id] || null; }

  function renderMoves() {
    var body = $("wp-moves-body");
    body.textContent = "";
    var style = state.style;
    moveRows(body, doc.moves.filter(function (m) { return !style || !m.styles || m.styles.indexOf(style) >= 0; }), function (m) {
      var tr = el("tr");
      tr.appendChild(moveCell(m));
      tr.appendChild(el("td", "", styleText(m.styles)));
      tr.appendChild(el("td", "num", String(m.mv.length)));
      tr.appendChild(el("td", "", mvText(m)));
      var es = [];
      if (m.element) es.push(m.element + (m.elementValue ? " " + m.elementValue : ""));
      if (m.status) es.push(m.status);
      tr.appendChild(el("td", "", es.join(", ")));
      tr.appendChild(el("td", "num", m.ko ? String(m.ko) : ""));
      var bon = m.chain.map(function (id) { return bonusOf(m.kind, id); }).filter(Boolean);
      tr.appendChild(el("td", "", bon.length ? bon.map(function (b) { return "+" + b[0] + " / +" + b[1]; }).join(", ") : ""));
      return tr;
    }, "wp-moves-legend");
  }

  function renderStyleChips() {
    var box = $("wp-styles");
    box.textContent = "";
    [["", "All styles"], ["E", "Earth"], ["H", "Heaven"], ["S", "Storm"], ["X", "Extreme"]].forEach(function (s) {
      var b = el("button", "chip", s[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.style === s[0]));
      b.addEventListener("click", function () {
        state.style = s[0];
        if (s[0] && isMelee()) { $("c-style").value = s[0]; renderCalc(); } // the calculator follows the style picked
        renderStyleChips();
        renderMoves();
      });
      box.appendChild(b);
    });
  }

  function stat(dl, label, value) {
    if (value === "" || value === null || value === undefined) return;
    var d = el("div", "wp-stat");
    d.appendChild(el("dt", "", label));
    d.appendChild(el("dd", "", String(value)));
    dl.appendChild(d);
  }

  function renderDetail() {
    var w = state.weapon;
    $("wp-detail").hidden = false;
    $("wp-to-calc").hidden = !isMelee();
    // Back to the Items page's melee or ranged section, searched by the id the API uses there: the game id as
    // 4 hex digits, byte-swapped (6635 = 0x19EB -> "EB19"; js/catalog.js gameId does the reverse).
    var toCatalog = $("wp-to-catalog");
    toCatalog.hidden = !w;
    if (w) {
      var hex = function (n) { return ("0" + n.toString(16).toUpperCase()).slice(-2); };
      var wid = field(w, "id");
      toCatalog.href = "/items.html?slot=" + (doc.kind === "melee" ? "melee" : "ranged") + "&q=" + hex(wid & 255) + hex(wid >> 8);
    }
    $("wp-detail-type").textContent = doc.name;
    var head = $("wp-detail-h");
    head.textContent = w ? field(w, "name") : doc.name + " moves";
    var big = w && weaponIcon(w, "gi-large");
    if (big) head.insertBefore(big, head.firstChild);
    var dl = $("wp-stats");
    dl.textContent = "";
    var bar = $("wp-detail-bar");
    bar.textContent = "";
    if (w) {
      stat(dl, "Id", field(w, "id"));
      stat(dl, "Rarity", field(w, "rarity"));
      stat(dl, "Attack", field(w, "shown") + " (true " + field(w, "attack") + ")");
      stat(dl, "Affinity", field(w, "affinity") + "%");
      stat(dl, "Slots", field(w, "slots"));
      if (field(w, "defense")) stat(dl, "Defence", (field(w, "defense") > 0 ? "+" : "") + field(w, "defense"));
      if (isMelee()) {
        stat(dl, "Element", elemText(w, "element"));
        stat(dl, "Status", elemText(w, "status"));
        stat(dl, { 8: "Notes", 9: "Shelling", 12: "Phial" }[doc.class] || "", field(w, "special"));
        var ends = doc.bars[field(w, "sharpness")];
        bar.appendChild(el("h3", "wp-sub", "Sharpness"));
        bar.appendChild(sharpBar(ends, true));
        bar.appendChild(el("p", "wp-help", "Bar row " + field(w, "sharpness") + ", gauge 0-400. Top colour: " + index.colours[maxLevel(ends)] + "."));
      } else if (doc.kind === "bow") {
        stat(dl, "Element", elemText(w, "element"));
        stat(dl, "Charge levels", field(w, "charge"));
        stat(dl, "Arc shot", field(w, "arcShot"));
      } else {
        stat(dl, "Recoil stat", field(w, "recoil"));
        stat(dl, "Reload stat", field(w, "reload"));
      }
    }
    renderStyleChips();
    renderMoves();
  }

  /* ---------- calculator ---------- */

  function fillCalcControls() {
    var k = index.constants;
    var eye = $("c-crit-eye");
    eye.length = 1;
    index.skills.critEye.forEach(function (n, i) { eye.add(new Option(n + " (+" + k.critEye[i] + "%)", String(k.critEye[i]))); });
    var ch = $("c-charge");
    ch.length = 1;
    index.skills.chargeUp.forEach(function (n, i) { ch.add(new Option(n, String(i + 1))); });
    var mult = $("c-mult");
    mult.length = 1;
    mult.add(new Option(index.skills.adrenaline + " (×" + k.adrenaline + ")", String(k.adrenaline)));
    mult.add(new Option(index.skills.worry + " (×" + k.worry + ")", String(k.worry)));
    var demon = $("c-demon");
    demon.length = 0;
    k.demon.forEach(function (m, i) { demon.add(new Option(i ? "Level " + i + " (×" + m + ")" : "Off", String(i))); });
    $("c-wolf-label").textContent = index.skills.starvingWolf + " (crit ×" + Math.round(k.critStarvingWolf * 100) / 100 + ")";
    $("c-fencing-label").textContent = index.skills.fencing + " (×" + k.fencing + " on some moves)";
    var sharp = $("c-sharp");
    sharp.length = 0;
    index.colours.forEach(function (c, i) { sharp.add(new Option(c + " (×" + index.sharpMult[i][0] + ")", String(i))); });
    sharp.value = "5"; // white until a weapon is picked
  }

  function setupTypeCalc() {
    var melee = isMelee();
    $("calc-gunner").hidden = melee;
    $("calc-form").hidden = !melee;
    $("calc-summary").hidden = !melee;
    $("calc-body").closest(".table-wrap").hidden = !melee;
    document.querySelectorAll(".wp-only").forEach(function (n) { n.hidden = String(doc.class) !== n.dataset.only; });
    var tech = $("c-tech");
    tech.length = 1;
    (doc.tech || []).forEach(function (t) {
      tech.add(new Option(t.name + " (×" + Calc.techMult(doc.class, t.level, index.constants) + ")", String(t.level)));
    });
    $("c-type").value = IMPACT_CLASSES.indexOf(doc.class) >= 0 ? "impact" : "cut";
    applyPart();
  }

  function num(id, lo, hi) {
    var v = Number($(id).value);
    if (!isFinite(v)) v = 0;
    return Math.max(lo, Math.min(hi, Math.trunc(v)));
  }

  function inputs() {
    var k = index.constants;
    return {
      attack: num("c-attack", 0, 3000), flat: num("c-flat", 0, 1000),
      attackMult: Number($("c-mult").value), techMult: Calc.techMult(doc.class, Number($("c-tech").value), k),
      demonMult: doc.class === 6 ? k.demon[Number($("c-demon").value)] : 1,
      spirit: doc.class === 7 && $("c-spirit").checked,
      sharp: Number($("c-sharp").value), zone: num("c-zone", 0, 200),
      elementValue: num("c-element", 0, 255), elementZone: num("c-ezone", 0, 200), elementSkill: num("c-elem-skill", 0, 300),
      affinity: num("c-affinity", -100, 100) + Number($("c-crit-eye").value) + num("c-aff-extra", -100, 100),
      starvingWolf: $("c-wolf").checked, ceaseless: Number($("c-ceaseless").value)
    };
  }

  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

  function renderCalc() {
    if (!isMelee()) return;
    var k = index.constants, base = inputs(), style = $("c-style").value;
    var charge = Number($("c-charge").value), fencing = $("c-fencing").checked && doc.fencing;
    var body = $("calc-body");
    body.textContent = "";
    // A later hit shows its own damage when its parent is opened; it is not added to the parent's numbers (the
    // data does not say every later hit lands: Lv1 and Lv2 charges share a first hit, Rotation repeats its middle).
    var shown = moveRows(body, doc.moves.filter(function (m) {
      return !(m.styles && m.styles.indexOf(style) < 0) && m.mv.some(function (x) { return x > 0; });
    }), function (m) {
      var c = Object.assign({}, base, { mv: m.mv });
      c.bonus = m.chain.map(function (id) { var b = bonusOf(m.kind, id); return b && charge ? b[charge - 1] : 0; });
      var fenceHit = fencing && m.kind === doc.fencing.kind && doc.fencing.styles.indexOf(style) >= 0;
      // Fencing applies per record; when only some hits of a chain are listed, split by hit.
      var r = { nonCrit: 0, crit: 0, expected: 0, canCrit: false };
      m.mv.forEach(function (mv, i) {
        var one = Object.assign({}, c, { mv: [mv], bonus: [c.bonus[i]],
          fencingHit: !!(fenceHit && doc.fencing.ids.indexOf(m.chain[i]) >= 0) });
        var h = Calc.move(one, k, index.sharpMult);
        r.nonCrit += h.nonCrit; r.crit += h.crit; r.expected += h.expected; r.canCrit = h.canCrit;
      });
      var tr = el("tr");
      tr.appendChild(moveCell(m));
      tr.appendChild(el("td", "wp-wide", styleText(m.styles)));
      tr.appendChild(el("td", "num wp-wide", String(m.mv.length)));
      var mvs = m.mv.map(function (x, i) { return x + (c.bonus[i] ? "+" + c.bonus[i] : ""); }).join(" + ");
      tr.appendChild(el("td", "wp-wide", mvs + (m.repeats ? " (repeats)" : "")));
      tr.appendChild(el("td", "num", fmt(r.nonCrit)));
      tr.appendChild(el("td", "num", r.canCrit ? fmt(r.crit) : "no crit"));
      tr.appendChild(el("td", "num wp-expected", (Math.round(r.expected * 10) / 10).toFixed(1)));
      return tr;
    }, "calc-legend");
    if (!shown) {
      var tr0 = el("tr", "no-results"), td0 = el("td", "", "No move of this weapon type is known for this style.");
      td0.colSpan = 7;
      tr0.appendChild(td0);
      body.appendChild(tr0);
    }
    var aff = Math.max(-100, Math.min(100, base.affinity));
    var canCrit = base.sharp >= k.minCritSharpness;
    var critNote = !aff ? "no crits" : canCrit
      ? (aff > 0 ? aff + "% crit chance (MV × " + (Math.round(Calc.critFactor(base, k) * 100) / 100) + ")" : -aff + "% chance of a weak hit (MV × 0.75)")
      : "no crits below green sharpness";
    $("calc-summary").textContent = "True attack " + Calc.trueAttack(base, k) + " · affinity " + aff + "%: " + critNote +
      " · " + index.colours[base.sharp] + " sharpness (raw ×" + index.sharpMult[base.sharp][0] + ") · " + STYLE_NAMES[style] +
      " style, " + shown + " moves.";
  }

  /* ---------- monster presets ---------- */

  // Presets: the game's own hitzones (data/monsters/game/<id>.json, dev/make-monster-data.py) per rank, state and
  // part; a monster without them falls back to its page's community table ("c:<slug>"), labelled as such.
  var GAME_COLS = ["cut", "impact", "shot", "fire", "water", "thunder", "dragon", "ice", "stun"];

  function loadMonsters() {
    Promise.all([getJson("/data/monsters/index.json"),
      getJson("/data/monsters/game/index.json").catch(function () { return {}; })]).then(function (res) {
      var list = res[0], game = res[1], seen = {}, opts = [];
      list.forEach(function (m) {
        var id = (m.ids || []).filter(function (i) { return game[i] && game[i][2]; })[0];
        if (id && !seen[id]) { seen[id] = true; opts.push([m.name, "g:" + id]); }
        else if (!id && m.hasHitzones) opts.push([m.name + " (community)", "c:" + m.slug]);
      });
      Object.keys(game).forEach(function (id) {
        if (!seen[id] && game[id][2] && !game[id][1]) opts.push([game[id][0], "g:" + id]);
      });
      var sel = $("c-monster");
      opts.sort(function (a, b) { return a[0].localeCompare(b[0]); })
        .forEach(function (o) { sel.add(new Option(o[0], o[1])); });
    }).catch(function () { $("c-zone-note").textContent = "Monster hitzones could not be loaded; type them in."; });
  }

  function partRows(m) {
    var out = [], count = {};
    if (m.ranks) { // the game's data: one group per rank, a line per state and part
      m.ranks.forEach(function (rank) {
        rank.hz.forEach(function (state) {
          state.rows.forEach(function (r) {
            var row = {};
            GAME_COLS.forEach(function (c, i) { row[c] = r[i + 2]; });
            out.push({ group: rank.label, rank: rank.label, row: row,
              label: r[0] + (state.label === "Normal" ? "" : " (" + state.label.toLowerCase() + ")") });
          });
        });
      });
      return out;
    }
    function add(rows, suffix) {
      (rows || []).forEach(function (r) {
        var key = r.part + suffix;
        count[key] = (count[key] || 0) + 1;
        out.push({ label: r.part + suffix + (count[key] > 1 ? " (" + count[key] + ")" : ""), row: r });
      });
    }
    add(m.hitzones, "");
    add(m.hitzonesEnraged, " (enraged)");
    return out;
  }

  function monsterUrl(key) {
    return key.slice(0, 2) === "g:" ? "/data/monsters/game/" + key.slice(2) + ".json" : "/data/monsters/" + key.slice(2) + ".json";
  }

  function pickMonster() {
    var key = $("c-monster").value;
    var wrap = $("c-part-wrap"), part = $("c-part");
    if (!key) { wrap.hidden = true; return; }
    var p = monsterCache[key] ? Promise.resolve(monsterCache[key]) : getJson(monsterUrl(key));
    p.then(function (m) {
      monsterCache[key] = m;
      part.textContent = "";
      var groups = {}, last = null;
      partRows(m).forEach(function (r, i) {
        var opt = new Option(r.label, String(i));
        if (r.group) {
          if (!groups[r.group]) {
            groups[r.group] = document.createElement("optgroup");
            groups[r.group].label = r.group;
            part.appendChild(groups[r.group]);
          }
          groups[r.group].appendChild(opt);
          if (!last || last.group !== r.group) last = { group: r.group, index: i };
        } else part.appendChild(opt);
      });
      if (last) part.value = String(last.index); // the highest rank's first part
      wrap.hidden = false;
      applyPart();
    });
  }

  function applyPart() {
    var key = $("c-monster").value;
    if (!key || !monsterCache[key]) { renderCalc(); return; }
    var rows = partRows(monsterCache[key]);
    var r = rows[Number($("c-part").value)] || rows[0];
    if (!r) { renderCalc(); return; }
    $("c-zone").value = r.row[$("c-type").value];
    var w = state.weapon, ekey = w && isMelee() ? ELEMENT_ZONE[field(w, "element")] : null;
    var note = r.rank ? "Hitzones from the game's data: " + monsterCache[key].name + ", " + r.rank + "."
      : "Hitzones from the " + monsterCache[key].name + " page (community data).";
    if (ekey && r.row[ekey] !== undefined) $("c-ezone").value = r.row[ekey];
    else if (w && isMelee() && field(w, "element")) note += " " + field(w, "element") + " has no column there: type its hitzone in.";
    $("c-zone-note").textContent = note;
    renderCalc();
  }

  /* ---------- picking ---------- */

  function pick(w, scroll) {
    state.weapon = w;
    if (w && isMelee()) {
      $("c-attack").value = field(w, "attack");
      $("c-affinity").value = field(w, "affinity");
      $("c-element").value = field(w, "elementValue");
      var ends = doc.bars[field(w, "sharpness")];
      $("c-sharp").value = String(maxLevel(ends));
      var note = $("calc-weapon-note");
      note.textContent = "Weapon: " + field(w, "name") + " (true attack " + field(w, "attack") +
        (field(w, "element") ? ", " + elemText(w, "element") : "") + "). Sharpness is set to its top colour; change any number to try other values.";
      var small = weaponIcon(w, "gi-small");
      if (small) note.insertBefore(small, note.firstChild);
    }
    renderList(); // also writes ?type=&w= and the list state to the URL (syncUrl)
    renderDetail();
    applyPart();
    if (scroll) $("wp-detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderTypeChips() {
    var box = $("wp-types");
    box.textContent = "";
    index.types.forEach(function (t) {
      var b = el("button", "chip", t.name);
      b.type = "button";
      b.setAttribute("aria-pressed", String(doc && doc.type === t.slug));
      b.addEventListener("click", function () { openType(t.slug, null); });
      box.appendChild(b);
    });
  }

  function openType(slug, weaponId, urlState) {
    var t = index.types.filter(function (x) { return x.slug === slug; })[0] || index.types[0];
    var p = cache[t.slug] ? Promise.resolve(cache[t.slug]) : getJson("/data/weapons/" + t.slug + ".json");
    return p.then(function (d) {
      cache[t.slug] = doc = d;
      state.page = 0;
      state.sort = "id";
      state.dir = 1;
      state.style = "";
      renderTypeChips();
      fillFilters();
      $("wp-count").textContent = d.weapons.length.toLocaleString("en-US") + " weapons · " + d.moves.length + " attack records";
      setupTypeCalc();
      if (urlState) applyUrlState(urlState);
      var w = null;
      if (weaponId !== null && weaponId !== undefined) {
        w = d.weapons.filter(function (x) { return String(field(x, "id")) === String(weaponId); })[0] || null;
      }
      pick(w, false);
      // The menu's Damage calculator link (/weapons.html#calc): the list above it fills in only now, so the
      // browser's own jump to the anchor landed too high; go there again, once, after the page's load event
      // (the browser may jump to the anchor again then).
      if (location.hash === "#calc" && !calcShown) {
        calcShown = true;
        // Then keep it there for 1.5 s while late layout (icons, fonts) settles, until the reader scrolls.
        var toCalc = function () {
          var calc = $("calc"), until = Date.now() + 1500, want, stop = false;
          var quit = function () { stop = true; };
          ["wheel", "touchstart", "keydown", "pointerdown"].forEach(function (t) {
            window.addEventListener(t, quit, { once: true, passive: true });
          });
          calc.scrollIntoView({ block: "start", behavior: "instant" });
          want = calc.getBoundingClientRect().top;
          (function pin() {
            if (stop || Date.now() > until) return;
            if (Math.abs(calc.getBoundingClientRect().top - want) > 2) calc.scrollIntoView({ block: "start", behavior: "instant" });
            requestAnimationFrame(pin);
          })();
        };
        if (document.readyState === "complete") toCalc();
        else window.addEventListener("load", function () { setTimeout(toCalc, 0); }, { once: true });
      }
    });
  }

  var calcShown = false;

  function init() {
    ["wp-moves-legend", "calc-legend"].forEach(function (id) {
      $(id).appendChild(window.HvMoveNames.legend());
      $(id).appendChild(window.HvMoveNames.toggle(function () { if (doc) { renderMoves(); renderCalc(); } }));
    });
    getJson("/data/weapons/index.json").then(function (ix) {
      index = ix;
      $("wp-source").textContent = "client patch " + ix.source.patch + ", " + ix.source.zip;
      fillCalcControls();
      var params = new URLSearchParams(location.search);
      loadMonsters();
      // The icon data first, so the first list already has its icons; without it the placeholder shows.
      return getJson("/data/equipment-icons.json").catch(function () { return null; }).then(function (data) {
        iconData = data;
        return openType(params.get("type") || "great-sword", params.get("w"), params);
      });
    }).catch(function (e) {
      $("wp-body").innerHTML = "";
      var tr = el("tr", "no-results"), td = el("td", "", "The weapon data could not be loaded (" + e.message + ").");
      td.colSpan = 9;
      tr.appendChild(td);
      $("wp-body").appendChild(tr);
    });

    var redraw = function () { state.page = 0; renderList(); };
    $("wp-search").addEventListener("input", redraw);
    $("wp-elem").addEventListener("change", redraw);
    $("wp-rarity").addEventListener("change", redraw);
    $("wp-prev").addEventListener("click", function () { state.page--; renderList(); });
    $("wp-next").addEventListener("click", function () { state.page++; renderList(); });
    $("calc-form").addEventListener("input", function (e) {
      if (e.target.id === "c-monster") return;
      if (e.target.id === "c-part" || e.target.id === "c-type") applyPart(); else renderCalc();
    });
    $("c-monster").addEventListener("change", pickMonster);
    $("wp-to-calc").addEventListener("click", function () {
      $("calc").scrollIntoView({ behavior: "smooth", block: "start" });
      $("c-attack").focus({ preventScroll: true });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
