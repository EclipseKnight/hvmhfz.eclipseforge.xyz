/* Balance changes page (balance.html): the server-side balance table the game server sends to the clients, as
   published from the admin panel's Balance tab, read from GET /api/public/balance (API README "Server balance":
   {version, publishedAt, note, rows[{kind, weaponClass, style, entry, recordId, field, op, value, reason}],
   versions[{version, publishedAt, note, rowCount, rollbackOf}]}; no staff names). Rows are grouped by weapon type
   and style; each shows the move or weapon (names and the game's own values from data/weapons/), the field, the
   game's value -> the new value (or the factor; js/balance-fields.js: every field's game value, coded fields such as
   element, status, shell or phial by the game's names) and the reason, with http(s) links in it clickable. An empty table
   says the game's own values are in use; a 404 (the owner has not turned the page on) or no published version says
   "not published yet"; no answer offers Try again. Everything from the API stays text (textContent). */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var PATH = "/api/public/balance";
  var DATA_DIR = "/data/weapons";

  /* ---------- pure helpers (tested under node by dev/check-balance-public.js) ---------- */

  // The API's class codes (BalanceTable.CLASSES), in the game's class order = data/weapons/index.json "class".
  var CLASSES = ["GS", "HBG", "Hammer", "Lance", "SnS", "LBG", "DS", "LS", "HH", "GL", "Bow", "Tonfa", "SAF", "MS"];
  var CLASS_NAMES = ["Great Sword", "Heavy Bowgun", "Hammer", "Lance", "Sword and Shield", "Light Bowgun", "Dual Swords",
    "Long Sword", "Hunting Horn", "Gunlance", "Bow", "Tonfa", "Switch Axe F", "Magnet Spike"];
  // Class icon names (assets/icons/1x/<name>-0.png), by class.
  var ICONS = ["great-sword", "heavy-bowgun", "hammer", "lance", "sword-and-shield", "light-bowgun", "dual-blades",
    "long-sword", "hunting-horn", "gunlance", "bow", "tonfa", "switch-axe", "magnet-spike"];
  var STYLES = ["earth", "heaven", "storm", "extreme"];
  var STYLE_NAMES = { earth: "Earth", heaven: "Heaven", storm: "Storm", extreme: "Extreme" };
  var FIELD_NAMES = { mv: "Motion value", ko: "KO", hitstop: "Hitstop", element_value: "Element value",
    element_flags: "Element flags", hit_type: "Hit type", status_value: "Status value", charge_row: "Charge levels",
    arc_shot: "Arc shot" };

  function isNone(v) { return v === null || v === undefined || v === ""; }

  /** "element_value" -> "Element value"; known short names spelled out. */
  function fieldName(field) {
    var f = String(field || "");
    if (FIELD_NAMES[f]) return FIELD_NAMES[f];
    var s = f.replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function classIndex(code) { return CLASSES.indexOf(code); }

  function styleName(style) { return isNone(style) ? "All styles" : STYLE_NAMES[style] || String(style); }

  /** The data index's type entry for a class number, or null. */
  function typeByClass(data, n) {
    var types = (data && data.index && data.index.types) || [];
    for (var i = 0; i < types.length; i++) if (types[i]["class"] === n) return types[i];
    return null;
  }

  function fileOf(data, type) { return type && data && data.files ? data.files[type.slug] || null : null; }

  /** The move of the type file with this entry (kind) and record id, or null. */
  function findMove(data, code, entry, id) {
    var file = fileOf(data, typeByClass(data, classIndex(code)));
    if (!file || isNone(entry) || isNone(id)) return null;
    var moves = file.moves || [];
    for (var i = 0; i < moves.length; i++) if (moves[i].kind === entry && moves[i].id === id) return moves[i];
    return null;
  }

  /** {type, row, fields, name} of the melee or ranged weapon with this record id among the loaded files, or null. */
  function findWeapon(data, group, id) {
    if (!data || !data.files || typeof id !== "number") return null;
    var types = (data.index && data.index.types) || [];
    for (var t = 0; t < types.length; t++) {
      if ((types[t].kind === "melee") !== (group === "melee")) continue;
      var file = data.files[types[t].slug];
      if (!file) continue;
      var idCol = file.fields.indexOf("id"), nameCol = file.fields.indexOf("name");
      var rows = file.weapons || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][idCol] === id) return { type: types[t], row: rows[i], fields: file.fields, name: rows[i][nameCol] };
      }
    }
    return null;
  }

  // Every field's game value and the game's names of coded fields (js/balance-fields.js).
  var BF = typeof module !== "undefined" && module.exports ? require("./balance-fields.js") : window.HvBalanceFields;
  var WEAPON_KEYS = { attack: "attack", affinity: "affinity", element_value: "elementValue", status_value: "statusValue",
    sharpness: "sharpness", recoil: "recoil", reload: "reload", charge_row: "chargeRow", arc_shot: "arcShot",
    element: "element", status: "status", special: "special" };

  /** The game's names of the row's field ([{value, name}]), or null for a plain number (or unknown weapon type). */
  function optionsOf(row, data) {
    var codes = data && data.index && data.index.codes;
    if (row.kind === "attack") return BF.options(codes, "attack", row.field, null);
    var w = findWeapon(data, row.kind, row.recordId);
    return w ? BF.options(codes, row.kind, row.field, w.type["class"]) : null;
  }

  /** The game's own value of the row's field (a number; a code for a named field), or null when not known. */
  function gameValue(row, data) {
    if (row.kind === "attack") return BF.moveValue(findMove(data, row.weaponClass, row.entry, row.recordId), row.field);
    var w = findWeapon(data, row.kind, row.recordId);
    var key = WEAPON_KEYS[row.field];
    if (!w || !key) return null;
    var i = w.fields.indexOf(key);
    if (i < 0) return null;
    var opts = optionsOf(row, data);
    return opts ? BF.codeOf(opts, w.row[i]) : typeof w.row[i] === "number" ? w.row[i] : null;
  }

  /** A value as the page shows it: the game's name for a named field ("Fire"), else the number; "?" when unknown. */
  function valueText(v, opts, field) {
    if (v === null || v === undefined) return "?";
    return opts && typeof v === "number" ? BF.label(opts, v, field) : String(v);
  }

  /** value x factor, truncated as the client does (factor in 1/10000ths); null when unknown. */
  function scaled(value, factor) {
    if (typeof value !== "number" || typeof factor !== "number" || !isFinite(factor)) return null;
    return Math.trunc(value * Math.round(factor * 10000) / 10000);
  }

  /**
   * The change in words: {from, to, factor}. "set": from = the game's value (null if unknown), to = the value.
   * "scale": factor "×1.05", and from/to when the game's value is known.
   */
  function change(row, current) {
    var v = Number(row.value);
    if (row.op === "scale") {
      return { factor: "×" + String(row.value), from: current, to: scaled(current, v) };
    }
    return { factor: null, from: current, to: isFinite(v) ? v : row.value };
  }

  /** A move's reference as the weapons page writes it: "k0 #165" ("k* #3" for any entry). */
  function moveRef(row) {
    return "k" + (isNone(row.entry) ? "*" : row.entry) + " #" + row.recordId;
  }

  /** "Iron Sword" / "Lv1 charge" / "k0 #59" / "Every move" / "Melee weapon #12". */
  function whatText(row, data) {
    if (row.kind === "attack") {
      if (isNone(row.entry) && isNone(row.recordId)) return "Every move";
      if (isNone(row.recordId)) return "Every move in k" + row.entry;
      var move = findMove(data, row.weaponClass, row.entry, row.recordId);
      return move && move.name ? String(move.name) : moveRef(row);
    }
    var w = findWeapon(data, row.kind, row.recordId);
    return w ? String(w.name) : (row.kind === "ranged" ? "Ranged weapon #" : "Melee weapon #") + row.recordId;
  }

  /**
   * The rows grouped by weapon type and style, in the game's class order (all types first), styles in their
   * order (all styles first), weapon stat rows after the moves of their type. Each group:
   * {key, cls (class number or -1), type (name), style (name), rows[]}; the API's row order is kept inside a group.
   */
  function groupRows(rows, data) {
    var groups = {};
    var list = [];
    (rows || []).forEach(function (row) {
      var cls = -1, styleRank = -1, style;
      if (row.kind === "attack") {
        cls = isNone(row.weaponClass) ? -1 : classIndex(row.weaponClass);
        if (!isNone(row.weaponClass) && cls < 0) cls = 99;
        styleRank = isNone(row.style) ? 0 : STYLES.indexOf(row.style) + 1;
        if (!isNone(row.style) && styleRank === 0) styleRank = 9;
        style = styleName(row.style);
      } else {
        var w = findWeapon(data, row.kind, row.recordId);
        cls = w ? w.type["class"] : (row.kind === "ranged" ? 98 : 97);
        styleRank = 10;
        style = "Weapon stats";
      }
      var typeName = cls === -1 ? "All weapon types" : cls < CLASS_NAMES.length ? CLASS_NAMES[cls]
        : cls === 97 ? "Melee weapons" : cls === 98 ? "Ranged weapons" : String(row.weaponClass);
      var key = cls + ":" + styleRank + ":" + (cls === 99 ? row.weaponClass : "") + ":" + style;
      if (!groups[key]) {
        var ft = cls >= 0 && cls < CLASS_NAMES.length ? typeByClass(data, cls) : null;
        groups[key] = { key: key, cls: cls, rank: styleRank, type: typeName, style: style, icon: ICONS[cls] || null,
          slug: ft ? ft.slug : null, rows: [] };
        list.push(groups[key]);
      }
      groups[key].rows.push(row);
    });
    list.sort(function (a, b) { return a.cls - b.cls || a.rank - b.rank; });
    // Anchors: the first group of a weapon type is #<slug> (#great-sword), the others #<slug>-<style>.
    var seen = {};
    list.forEach(function (g) {
      if (!g.slug) return;
      g.id = seen[g.slug] ? g.slug + "-" + g.style.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : g.slug;
      seen[g.slug] = true;
    });
    return list;
  }

  /** Text split into plain parts and http(s) links: [{text}, {href, text}]; Discord links read "Discord thread". */
  function linkParts(text) {
    var s = String(text === null || text === undefined ? "" : text);
    var out = [];
    var re = /https?:\/\/[^\s<>"']+/g;
    var last = 0, m;
    while ((m = re.exec(s))) {
      var url = m[0].replace(/[.,;:!?)\]]+$/, "");
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      var discord = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/channels\//i.test(url);
      out.push({ href: url, text: discord ? "Discord thread" : url });
      last = m.index + url.length;
      re.lastIndex = last;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }

  /** "10 Nov 2026, 15:00 UTC"; "" for nothing. */
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function when(at) {
    var t = typeof at === "number" ? (at < 1e11 ? at * 1000 : at) : Date.parse(at || "");
    if (isNaN(t)) return "";
    var d = new Date(t);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", " + pad(d.getUTCHours()) + ":" +
      pad(d.getUTCMinutes()) + " UTC";
  }

  /** What the page shows for an answer: "off" (404 or no version yet), "empty" (the game's own values) or "rows". */
  function stateOf(status, body) {
    if (status === 404 || !body || isNone(body.version)) return "off";
    return body.rows && body.rows.length ? "rows" : "empty";
  }

  function countText(n) {
    return n ? n + (n === 1 ? " change" : " changes") : "No changes: the game's own values";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { fieldName: fieldName, styleName: styleName, findMove: findMove, findWeapon: findWeapon,
      gameValue: gameValue, optionsOf: optionsOf, valueText: valueText, scaled: scaled, change: change, whatText: whatText, groupRows: groupRows,
      linkParts: linkParts, when: when, stateOf: stateOf, countText: countText, moveRef: moveRef };
  }
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var data = { index: null, files: {} };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function getJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  /** The weapon data the rows need (index, then the type files): names and the game's values; none is fine. */
  function loadData(rows) {
    return getJson(DATA_DIR + "/index.json").then(function (index) {
      if (!index || !index.types) return;
      data.index = index;
      var need = {};
      rows.forEach(function (r) {
        if (r.kind === "attack") {
          var t = typeByClass(data, classIndex(r.weaponClass));
          if (t) need[t.slug] = true;
        } else {
          index.types.forEach(function (t) { if ((t.kind === "melee") === (r.kind === "melee")) need[t.slug] = true; });
        }
      });
      return Promise.all(Object.keys(need).map(function (slug) {
        return getJson(DATA_DIR + "/" + slug + ".json").then(function (f) { if (f) data.files[slug] = f; });
      }));
    });
  }

  function reasonNode(text) {
    var span = el("span", "bal-reason");
    linkParts(text).forEach(function (p) {
      if (!p.href) { span.appendChild(document.createTextNode(p.text)); return; }
      var a = el("a", null, p.text);
      a.href = p.href;
      a.rel = "noopener nofollow ugc";
      a.target = "_blank";
      if (p.text !== p.href) a.title = p.href;
      span.appendChild(a);
    });
    if (!span.firstChild) span.textContent = "—";
    return span;
  }

  function changeNode(row) {
    var cur = gameValue(row, data);
    var c = change(row, cur), opts = c.factor ? null : optionsOf(row, data);
    var cell = el("span", "bal-change");
    if (c.factor) cell.appendChild(el("strong", "bal-factor", c.factor));
    if (c.from !== null || !c.factor) {
      if (c.factor) cell.appendChild(document.createTextNode(" "));
      cell.appendChild(el("span", "bal-from", valueText(c.from, opts, row.field)));
      cell.appendChild(el("span", "bal-arrow", " → "));
      cell.appendChild(el("strong", "bal-to", valueText(c.to, opts, row.field)));
    }
    if (c.from === null && !c.factor) cell.title = "The game's own value is not in the weapon data";
    return cell;
  }

  function whatNode(row) {
    var text = whatText(row, data);
    if (row.kind !== "attack") {
      var w = findWeapon(data, row.kind, row.recordId);
      if (w) {
        var a = el("a", null, text);
        a.href = "/weapons.html?type=" + encodeURIComponent(w.type.slug) + "&w=" + row.recordId;
        return a;
      }
      return document.createTextNode(text);
    }
    var frag = document.createDocumentFragment();
    var move = findMove(data, row.weaponClass, row.entry, row.recordId), MN = window.HvMoveNames;
    var type = isNone(row.weaponClass) ? null : typeByClass(data, classIndex(row.weaponClass));
    if (move && MN) {   // name, how sure, the id small, how it is used, what it is on a tap (js/move-names.js, as the weapons page)
      var pm = /^k(\d+):(\d+)$/.exec(move.use && move.use.parent || "");
      var parent = pm ? findMove(data, row.weaponClass, Number(pm[1]), Number(pm[2])) : null;
      frag.appendChild(MN.fill(el("span", "bal-move"), move, moveRef(row), { slug: type && type.slug, parent: parent }));
    } else {
      frag.appendChild(document.createTextNode(text));
      if (!isNone(row.recordId) && text !== moveRef(row)) frag.appendChild(el("span", "bal-ref", moveRef(row)));
    }
    if (type) { // the move's weapon type in the weapons database
      var open = el("a", "bal-open", "Weapons page");
      open.href = "/weapons.html?type=" + encodeURIComponent(type.slug);
      open.title = "Open " + type.name + " in the weapon database";
      frag.appendChild(open);
    }
    return frag;
  }

  function groupNode(g) {
    var sec = el("section", "bal-group");
    if (g.id) sec.id = g.id;
    var h = el("h3", "bal-group-h");
    if (g.icon) {
      var img = el("img", "weapon-icon");
      img.src = "/assets/icons/1x/" + g.icon + "-0.png";
      img.srcset = "/assets/icons/2x/" + g.icon + "-0.png 2x";
      img.alt = "";
      img.width = img.height = 18;
      h.appendChild(img);
    }
    if (g.slug) { // the type's name opens its weapons page
      var tl = el("a", null, g.type);
      tl.href = "/weapons.html?type=" + encodeURIComponent(g.slug);
      h.appendChild(tl);
    } else {
      h.appendChild(document.createTextNode(g.type));
    }
    h.appendChild(el("span", "bal-style", g.style));
    sec.appendChild(h);
    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table bal-table");
    var head = el("tr");
    ["Move or weapon", "Field", "Game → new", "Reason"].forEach(function (t) { head.appendChild(el("th", null, t)); });
    var thead = el("thead");
    thead.appendChild(head);
    table.appendChild(thead);
    var body = el("tbody");
    g.rows.forEach(function (row) {
      var tr = el("tr");
      var what = el("td", "bal-what");
      what.setAttribute("data-label", "Move or weapon");
      what.appendChild(whatNode(row));
      var field = el("td", null, fieldName(row.field));
      field.setAttribute("data-label", "Field");
      var ch = el("td", "bal-change-cell");
      ch.setAttribute("data-label", "Game → new");
      ch.appendChild(changeNode(row));
      var reason = el("td", "bal-reason-cell");
      reason.setAttribute("data-label", "Reason");
      reason.appendChild(reasonNode(row.reason));
      [what, field, ch, reason].forEach(function (td) { tr.appendChild(td); });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    sec.appendChild(wrap);
    return sec;
  }

  function renderHistory(answer) {
    var list = $("bal-history");
    clear(list);
    var versions = (answer && answer.versions) || [];
    $("bal-history-panel").hidden = !versions.length;
    versions.slice().sort(function (a, b) { return b.version - a.version; }).forEach(function (v) {
      var li = el("li", "bal-version" + (answer && v.version === answer.version ? " is-current" : ""));
      var top = el("p", "bal-version-head");
      top.appendChild(el("strong", null, "Version " + v.version));
      top.appendChild(el("span", "muted", " · " + when(v.publishedAt) + " · " + countText(v.rowCount)));
      if (answer && v.version === answer.version) top.appendChild(el("span", "bal-badge", "Live"));
      li.appendChild(top);
      if (!isNone(v.rollbackOf)) li.appendChild(el("p", "bal-version-meta muted", "Puts back the changes of version " + v.rollbackOf + "."));
      if (!isNone(v.note)) {
        var p = el("p", "bal-version-note");
        p.appendChild(reasonNode(v.note));
        li.appendChild(p);
      }
      list.appendChild(li);
    });
  }

  function show(state) {
    $("bal-loading").hidden = true;
    $("bal-off").hidden = state !== "off";
    $("bal-error").hidden = state !== "error";
    $("bal-current").hidden = state === "off" || state === "error";
    $("bal-empty").hidden = state !== "empty";
    $("bal-changes").hidden = state !== "rows";
  }

  function render(answer) {
    $("bal-version").textContent = "Version " + answer.version;
    $("bal-date").textContent = when(answer.publishedAt);
    var note = $("bal-note");
    clear(note);
    if (!isNone(answer.note)) note.appendChild(reasonNode(answer.note));
    note.hidden = isNone(answer.note);
    var rows = answer.rows || [];
    $("bal-count").textContent = countText(rows.length);
    var box = $("bal-groups");
    clear(box);
    groupRows(rows, data).forEach(function (g) { box.appendChild(groupNode(g)); });
    var legend = $("bal-legend");
    if (legend && window.HvMoveNames) {   // the badges' legend, when a move is listed
      clear(legend);
      if (box.querySelector(".mv-conf")) legend.appendChild(window.HvMoveNames.legend());
    }
    renderHistory(answer);
  }

  function load() {
    $("bal-loading").hidden = false;
    $("bal-error").hidden = true;
    var status = 0;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    fetch(API + PATH, ctrl ? { signal: ctrl.signal, cache: "no-cache" } : { cache: "no-cache" }).then(function (r) {
      status = r.status;
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (answer) {
      var state = stateOf(status, answer);
      if (state === "off") { show("off"); return; }
      return loadData(answer.rows || []).then(function () {
        render(answer);
        show(state);
      });
    }).catch(function () {
      show("error");
    }).then(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function start() {
    $("bal-retry").addEventListener("click", load);
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
