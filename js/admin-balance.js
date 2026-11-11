/* Admin: the Balance tab. Every balance value the game uses (a move's damage, a weapon's attack, ...) can be
   changed from the server: the draft rows live in the API (/api/admin/balance), the published versions are what the
   game server sends to the clients (docs/server-balance.md in the research repo). A row says what to change (an
   attack move: weapon type, style, entry and record id, each possibly "any"; or a melee / ranged weapon by its
   record id), which field, and set or multiply, with a required reason.
   Names and the game's current values come from data/weapons/ (index.json and one file per weapon type); when
   that folder is not on the site (the weapon database is on its own branch until merged) the tab still works with
   numbers typed by hand and says so. Most edits go through the grid (js/admin-balance-grid.js: one cell per value
   of a move set or a weapon type); the form below it ("Other rows") is for rows the grid cannot show, like any
   weapon type or a record by number. The draft rows table is the Changes list, with each row's reason editable. Markup from the API stays text (textContent). Draft rows, a diff against
   the published version, publishing (two steps, with the draft's fingerprint) and versions with a roll back.
   Until the stable client patch can receive tables (the API's publishGate) only an empty table can be published:
   the reason shows above Publish, which is off for a draft with rows (and Roll back for a version with rows).
   Moderators can look; only admins can change (the API answers 403 anyway). */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  // Not on this site until the weapon database branch is merged: the tab works without it.
  var DATA_DIR = "/data/weapons";

  /* ---------- pure helpers (tested under node by dev/check-admin-balance.js) ---------- */

  var STYLE_NAMES = { earth: "Earth", heaven: "Heaven", storm: "Storm", extreme: "Extreme" };
  var LETTER_STYLE = { E: "earth", H: "heaven", S: "storm", X: "extreme" };

  function styleName(style) { return style ? (STYLE_NAMES[style] || style) : "any style"; }

  /** "EHS" -> "Earth, Heaven, Storm"; "" -> "none". */
  function stylesText(letters) {
    var out = [];
    String(letters || "").split("").forEach(function (l) { if (LETTER_STYLE[l]) out.push(STYLE_NAMES[LETTER_STYLE[l]]); });
    return out.length ? out.join(", ") : "none";
  }

  /** The data-file key of an API field name; "element_value" -> "elementvalue". */
  function norm(name) { return String(name || "").toLowerCase().replace(/[^a-z]/g, ""); }

  // The game's values and names of every field (js/balance-fields.js, also used by the public balance page).
  var BF = typeof module !== "undefined" && module.exports ? require("./balance-fields.js") : window.HvBalanceFields;
  var WEAPON_KEYS = { attack: "attack", affinity: "affinity", elementvalue: "elementValue", statusvalue: "statusValue",
    sharpness: "sharpness", recoil: "recoil", reload: "reload", chargerow: "chargeRow", arcshot: "arcShot",
    element: "element", status: "status", special: "special" };

  /** A move's current value for an API field (mv is the first number of mv); null when the data has none. */
  function moveValue(move, field) { return BF.moveValue(move, field); }

  /** A weapon's current value; the weapon is {row, fields} (a weapons[] row and its file's fields[]). */
  function weaponValue(weapon, field) {
    if (!weapon) return null;
    var k = WEAPON_KEYS[norm(field)];
    if (!k) return null;
    var i = weapon.fields.indexOf(k);
    if (i < 0) return null;
    var v = weapon.row[i];
    if (typeof v === "number") return v;
    return typeof v === "string" && v !== "" ? v : null;
  }

  /** A weapon's value of a coded field as the API's code (opts: its names; "" in the list = none = 0); null if unknown. */
  function weaponCode(weapon, field, opts) {
    if (!opts) return weaponValue(weapon, field);
    var k = weapon ? WEAPON_KEYS[norm(field)] : null, i = k ? weapon.fields.indexOf(k) : -1;
    return i < 0 ? null : BF.codeOf(opts, weapon.row[i]);
  }

  /** current x factor, truncated, the way the client does it (value / 10000 in whole numbers); null when unknown. */
  function scaled(current, factor) {
    if (typeof current !== "number" || typeof factor !== "number" || !isFinite(factor)) return null;
    return Math.trunc(current * Math.round(factor * 10000) / 10000);
  }

  function showValue(v, opts, field) {
    return v === null || v === undefined ? "unknown" : opts ? BF.label(opts, v, field) : String(v);
  }

  /** The data's type entry (index.json types[]) for a class code of the API ("GS") or null. */
  function typeFor(data, code, classes) {
    if (!data || !data.index || code === null || code === undefined || code === "") return null;
    var n = (classes || []).indexOf(code);
    var types = data.index.types || [];
    for (var i = 0; i < types.length; i++) if (n >= 0 && types[i]["class"] === n) return types[i];
    for (var j = 0; j < types.length; j++) if (types[j].short === code) return types[j];
    return null;
  }

  function typeName(data, code, classes) {
    if (code === null || code === undefined || code === "") return "any type";
    var t = typeFor(data, code, classes);
    return t ? t.name : code;
  }

  function loadedFile(data, type) { return type && data && data.files ? data.files[type.slug] || null : null; }

  /** The move of a type file with this entry (kind) and record id; null when not found. */
  function findMove(data, code, classes, entry, id) {
    var file = loadedFile(data, typeFor(data, code, classes));
    if (!file || entry === null || id === null || entry === undefined || id === undefined) return null;
    var moves = file.moves || [];
    for (var i = 0; i < moves.length; i++) if (moves[i].kind === entry && moves[i].id === id) return moves[i];
    return null;
  }

  function moveLabel(entry, id, move) {
    var ref = "k" + (entry === null || entry === undefined ? "*" : entry) + " #" + (id === null || id === undefined ? "*" : id);
    if (entry === null && id === null) return "any move";
    return move && move.name ? move.name + " (" + ref + ")" : ref;
  }

  /** The weapon types of a group ("melee" or "ranged") from the data index. */
  function groupTypes(data, group) {
    return ((data && data.index && data.index.types) || []).filter(function (t) {
      return (t.kind === "melee") === (group === "melee");
    });
  }

  /** {type, row, fields, name} of the weapon with this record id among the loaded files of the group; null if none. */
  function findWeapon(data, group, id) {
    if (!data || !data.files || typeof id !== "number") return null;
    var types = groupTypes(data, group);
    for (var t = 0; t < types.length; t++) {
      var file = data.files[types[t].slug];
      if (!file) continue;
      var rows = file.weapons || [];
      var idCol = file.fields.indexOf("id"), nameCol = file.fields.indexOf("name");
      for (var i = 0; i < rows.length; i++) {
        if (rows[i][idCol] === id) return { type: types[t], row: rows[i], fields: file.fields, name: rows[i][nameCol] };
      }
    }
    return null;
  }

  /** Weapons whose name holds the text (or whose id is the number), at most `limit`. */
  function searchWeapons(data, group, query, limit) {
    var q = String(query || "").trim().toLowerCase();
    var out = [];
    if (!q || !data || !data.files) return out;
    var isId = /^\d+$/.test(q);
    var types = groupTypes(data, group);
    for (var t = 0; t < types.length && out.length < limit; t++) {
      var file = data.files[types[t].slug];
      if (!file) continue;
      var idCol = file.fields.indexOf("id"), nameCol = file.fields.indexOf("name");
      var rows = file.weapons || [];
      for (var i = 0; i < rows.length && out.length < limit; i++) {
        var name = String(rows[i][nameCol]);
        if (name.toLowerCase().indexOf(q) !== -1 || (isId && String(rows[i][idCol]) === q)) {
          out.push({ type: types[t], row: rows[i], fields: file.fields, name: name, id: rows[i][idCol] });
        }
      }
    }
    return out;
  }

  /** What a draft row changes, in words: "Great Sword, Storm, Lv1 charge (k0 #165)" or "Iron Sword (Great Sword, #1)". */
  function whatText(row, data, classes) {
    if (row.kind === "attack") {
      var move = findMove(data, row.weaponClass, classes, row.entry, row.recordId);
      return typeName(data, row.weaponClass, classes) + ", " + styleName(row.style) + ", " + moveLabel(row.entry, row.recordId, move);
    }
    var w = findWeapon(data, row.kind, row.recordId);
    return w ? w.name + " (" + w.type.name + ", #" + row.recordId + ")" : "weapon #" + row.recordId;
  }

  /** The game's names for the row's field ([{value, name}], js/balance-fields.js), or null for a plain number. */
  function optionsOf(row, data, classes) {
    var codes = data && data.index && data.index.codes;
    if (row.kind === "attack") return BF.options(codes, "attack", row.field, null);
    var w = findWeapon(data, row.kind, row.recordId);
    return BF.options(codes, row.kind, row.field, w ? w.type["class"] : null);
  }

  /** The game's current value of the row's field: a number (a code for a named field), or null when not known. */
  function currentOf(row, data, classes) {
    if (row.kind === "attack") {
      if (row.entry === null || row.recordId === null) return null;
      return moveValue(findMove(data, row.weaponClass, classes, row.entry, row.recordId), row.field);
    }
    return weaponCode(findWeapon(data, row.kind, row.recordId), row.field, optionsOf(row, data, classes));
  }

  /** "set 100" ("set 3 (Thunder)" for a named field), "x 1.05" and, when the current value is known, " = 105". */
  function changeText(row, current, opts) {
    if (row.op === "scale") {
      var r = scaled(current, Number(row.value));
      return "x " + row.value + (r === null ? "" : " = " + r);
    }
    var name = opts ? BF.label(opts, Number(row.value), row.field) : null;
    return "set " + row.value + (name !== null && name !== String(row.value) ? " (" + name + ")" : "");
  }

  /** One row on one line, for the diff. */
  function rowLine(row, data, classes) {
    var opts = optionsOf(row, data, classes), cur = currentOf(row, data, classes);
    return whatText(row, data, classes) + ": " + row.field + " " + changeText(row, cur, opts);
  }

  /** "Published v2 -> draft": the counts. */
  function diffCounts(diff) {
    return { added: (diff.added || []).length, removed: (diff.removed || []).length, changed: (diff.changed || []).length };
  }

  function diffEmpty(diff) {
    var c = diffCounts(diff);
    return !c.added && !c.removed && !c.changed && !diff.orderChanged;
  }

  /** "Publish v3: 1 added, 0 removed, 2 changed". */
  function publishQuestion(version, diff) {
    var c = diffCounts(diff);
    return "Publish v" + version + ": " + c.added + " added, " + c.removed + " removed, " + c.changed + " changed";
  }

  /**
   * Why a table with `rowCount` rows cannot be published now (the API's publishGate: the stable client patch cannot
   * receive tables yet), null when it can. An empty table (the game's own values) always can; an API without
   * publishGate decides on its own.
   */
  function publishBlocked(overview, rowCount) {
    var g = overview && overview.publishGate;
    return g && !g.allowed && rowCount > 0 ? (g.reason || "The stable patch cannot receive tables yet.") : null;
  }

  /** The next version number: one above the newest known. */
  function nextVersion(versions, published) {
    var top = published && published.version ? published.version : 0;
    (versions || []).forEach(function (v) { if (v.version > top) top = v.version; });
    return top + 1;
  }

  /** The ids in the new order after moving the row at `index` by `dir` (-1 up, 1 down); null when it cannot move. */
  function moveIds(rows, index, dir) {
    var j = index + dir;
    if (index < 0 || index >= rows.length || j < 0 || j >= rows.length) return null;
    var ids = rows.map(function (r) { return r.id; });
    var t = ids[index];
    ids[index] = ids[j];
    ids[j] = t;
    return ids;
  }

  /** "*" or "" is any (null); a whole number 0-65535 a number; anything else is not valid (undefined). */
  function parseAny(text) {
    var s = String(text === undefined || text === null ? "" : text).trim();
    if (s === "" || s === "*") return null;
    if (!/^\d+$/.test(s)) return undefined;
    var n = Number(s);
    return n > 65535 ? undefined : n;
  }

  /**
   * The API body for a form: form = {kind, type, style, entry, id, field, op, value, reason} (strings from the
   * boxes), overview = the API's lists (fields, meleeRecords, rangedRecords). Returns {body, errors}.
   */
  function buildRow(form, overview) {
    var errors = [];
    var body = { kind: form.kind, weaponClass: null, style: null, entry: null, recordId: null, field: form.field, op: form.op, value: null, reason: String(form.reason || "").trim() };
    if (form.kind === "attack") {
      body.weaponClass = form.type || null;
      body.style = form.style || null;
      var entry = parseAny(form.entry), id = parseAny(form.id);
      if (entry === undefined) errors.push("Entry: a number from 0 to 65535, or * for any.");
      else body.entry = entry;
      if (id === undefined) errors.push("Record id: a number from 0 to 65535, or * for any.");
      else body.recordId = id;
    } else {
      var w = String(form.id === undefined || form.id === null ? "" : form.id).trim();
      var max = form.kind === "melee" ? overview.meleeRecords : overview.rangedRecords;
      if (!/^\d+$/.test(w)) errors.push("Weapon id: a whole number.");
      else if (max && Number(w) >= max) errors.push("Weapon id: below " + max + ".");
      else body.recordId = Number(w);
    }
    var spec = null;
    (overview.fields || []).forEach(function (f) { if (f.kind === form.kind && f.name === form.field) spec = f; });
    if (!spec) errors.push("Pick a field.");
    var text = String(form.value === undefined || form.value === null ? "" : form.value).trim();
    var n = Number(text);
    if (text === "" || !isFinite(n)) errors.push("Value: enter a number.");
    else if (form.op === "scale") {
      if (spec && !spec.scale) errors.push(spec.name + " cannot be multiplied: set it.");
      else if (n <= 0) errors.push("Value: a factor above 0, like 1.05.");
      else if (Math.round(n * 10000) / 10000 !== n) errors.push("Value: at most 4 decimals.");
      else body.value = n;
    } else {
      if (Math.floor(n) !== n) errors.push("Value: a whole number to set.");
      else if (spec && (n < spec.min || n > spec.max)) errors.push(spec.name + " goes from " + spec.min + " to " + spec.max + ".");
      else body.value = n;
    }
    if (!body.reason) errors.push("Write the reason (the #weapon-balancing thread link).");
    return { body: body, errors: errors };
  }

  /** "2026-11-10 15:00 UTC"; "" for nothing. */
  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "";
    return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  var helpers = { stylesText: stylesText, norm: norm, moveValue: moveValue, weaponValue: weaponValue, weaponCode: weaponCode, scaled: scaled,
      typeFor: typeFor, typeName: typeName, findMove: findMove, moveLabel: moveLabel, findWeapon: findWeapon,
      searchWeapons: searchWeapons, whatText: whatText, optionsOf: optionsOf, currentOf: currentOf, changeText: changeText, rowLine: rowLine,
      diffCounts: diffCounts, diffEmpty: diffEmpty, publishQuestion: publishQuestion, publishBlocked: publishBlocked, nextVersion: nextVersion,
      moveIds: moveIds, parseAny: parseAny, buildRow: buildRow, utc: utc, showValue: showValue, STYLE_NAMES: STYLE_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  if (typeof document === "undefined") return;
  // For the grid (js/admin-balance-grid.js).
  window.hvBalanceHelpers = helpers;

  /* ---------- the page ---------- */

  var started = false;
  var state = {
    overview: null, rows: [], problems: [], diff: null, versions: [],
    canWrite: true, editing: null, confirmDelete: null, pending: null, rollbackTo: null,
    data: { ok: null, index: null, files: {} }, filesP: {}, indexP: null, busy: false
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function $(id) { return document.getElementById(id); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  // A refusal throws with the API's message, the status and the whole answer (problems).
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw Object.assign(new Error("Sign in again: your session has ended."), { status: 401 });
        if (r.status === 403) {
          throw Object.assign(new Error(o.method && o.method !== "GET" ? "Only admin accounts can change the balance." : "Only admins and moderators can see the balance."), { status: 403 });
        }
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            throw Object.assign(new Error((data && data.message) || "HTTP " + r.status), { status: r.status, data: data });
          }
          return data;
        });
      });
  }

  function say(id, text) {
    var box = $(id);
    box.textContent = text || "";
    box.hidden = !text;
  }

  function ok(text) { say("bal-alert", ""); say("bal-ok", text); }

  function fail(error) {
    say("bal-ok", "");
    say("bal-alert", error.message);
    if (error.data && error.data.problems && error.data.problems.length) problemList("bal-problems", error.data.problems);
  }

  function problemList(id, list) {
    var box = $(id);
    clear(box);
    (list || []).forEach(function (p) { box.appendChild(el("li", null, p)); });
    box.hidden = !(list && list.length);
  }

  function classes() { return (state.overview && state.overview.classes) || []; }

  /* --- the weapon data (names and current values) --- */

  function loadIndex() {
    if (!state.indexP) {
      state.indexP = fetch(DATA_DIR + "/index.json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error("missing"); return r.json(); })
        .then(function (j) { state.data.index = j; state.data.ok = true; })
        .catch(function () { state.data.ok = false; });
    }
    return state.indexP;
  }

  function loadFile(type) {
    if (!type) return Promise.resolve();
    if (!state.filesP[type.slug]) {
      state.filesP[type.slug] = fetch(DATA_DIR + "/" + type.slug + ".json", { cache: "no-cache" })
        .then(function (r) { if (!r.ok) throw new Error("missing"); return r.json(); })
        .then(function (j) { state.data.files[type.slug] = j; })
        .catch(function () { /* that type stays unnamed */ });
    }
    return state.filesP[type.slug];
  }

  // Loads what these rows need to show names: the type file of an attack row, every file of the group for a weapon row.
  function loadFor(rows) {
    return loadIndex().then(function () {
      if (!state.data.ok) return;
      var want = {}, list = [];
      rows.forEach(function (r) {
        if (r.kind === "attack") {
          var t = typeFor(state.data, r.weaponClass, classes());
          if (t) want[t.slug] = t;
        } else {
          groupTypes(state.data, r.kind).forEach(function (t) { want[t.slug] = t; });
        }
      });
      Object.keys(want).forEach(function (k) { list.push(loadFile(want[k])); });
      return Promise.all(list);
    });
  }

  function loadGroup(group) {
    return loadIndex().then(function () {
      if (!state.data.ok) return;
      return Promise.all(groupTypes(state.data, group).map(loadFile));
    });
  }

  /* --- loading the tab --- */

  function showMissing() {
    $("bal-main").hidden = true;
    say("bal-alert", "");
    $("bal-notable").hidden = false;
  }

  function load() {
    return request("/api/admin/balance").then(function (ov) {
      state.overview = ov;
      if (!ov.tableReady) { showMissing(); return false; }
      $("bal-notable").hidden = true;
      return Promise.all([request("/api/admin/balance/diff"), request("/api/admin/balance/versions")]).then(function (both) {
        state.diff = both[0];
        state.versions = both[1] || [];
        state.rows = ov.rows || [];
        state.problems = ov.problems || [];
        var rows = state.rows.concat(state.diff.added || [], state.diff.removed || []);
        (state.diff.changed || []).forEach(function (c) { rows.push(c.before, c.after); });
        return loadFor(rows);
      }).then(function () {
        say("bal-alert", "");
        $("bal-main").hidden = false;
        $("bal-nodata").hidden = state.data.ok !== false;
        renderAll();
        return true;
      });
    }).catch(function (e) {
      if (e.status === 503) showMissing();
      else fail(e);
      return false;
    });
  }

  function renderAll() {
    renderStatus();
    renderForm();
    renderRows();
    renderDiff();
    renderVersions();
    // Without the weapon data there is no grid: the form is the only way in, so it starts open.
    if (state.data.ok === false) $("bal-advanced").open = true;
    if (window.hvBalanceGrid) window.hvBalanceGrid.render();
    $("bal-edit").hidden = !state.canWrite;
    $("bal-publish").hidden = !state.canWrite;
    var g = state.overview.publishGate, blocked = publishBlocked(state.overview, state.rows.length);
    $("bal-gate").textContent = g && !g.allowed ? g.reason || "" : "";
    $("bal-gate").hidden = !(g && !g.allowed);
    $("bal-publish-btn").disabled = !!blocked;
    $("bal-publish-btn").title = blocked || "";
  }

  function renderStatus() {
    var ov = state.overview, p = ov.published;
    var box = $("bal-status");
    clear(box);
    box.appendChild(el("div", null, p
      ? "Published: v" + p.version + ", " + p.rowCount + " rows, by " + p.publishedBy + ", " + utc(p.publishedAt) + (p.note ? " (" + p.note + ")" : "") + "."
      : "Nothing is published yet."));
    box.appendChild(el("div", null, "Draft: " + state.rows.length + " of at most " + ov.maxRows + " rows. The public table is " + (ov.publicEnabled ? "on" : "off") + "."));
    $("bal-note").textContent = p ? "v" + p.version + " published" : "nothing published";
  }

  /* --- the form --- */

  function fieldsOf(kind) { return (state.overview.fields || []).filter(function (f) { return f.kind === kind; }); }

  function option(select, value, text) {
    var o = el("option", null, text);
    o.value = value;
    select.appendChild(o);
  }

  function formKind() { return $("bal-kind").value; }
  function formGroup() { return formKind() === "attack" ? null : formKind(); }

  function fillTypes() {
    var sel = $("bal-type"), keep = sel.value;
    clear(sel);
    option(sel, "", "Any weapon type");
    classes().forEach(function (code) {
      var t = typeFor(state.data, code, classes());
      option(sel, code, t ? t.name + " (" + code + ")" : code);
    });
    sel.value = keep;
  }

  function fillStyles() {
    var sel = $("bal-style"), keep = sel.value;
    clear(sel);
    option(sel, "", "Any style");
    ((state.overview && state.overview.styles) || ["earth", "heaven", "storm", "extreme"]).forEach(function (s) { option(sel, s, STYLE_NAMES[s] || s); });
    sel.value = keep;
  }

  function fillFields() {
    var sel = $("bal-field"), keep = sel.value;
    clear(sel);
    fieldsOf(formKind()).forEach(function (f) {
      option(sel, f.name, f.name + " (" + f.min + " to " + f.max + (f.scale ? "" : ", set only") + ")");
    });
    if (keep) sel.value = keep;
    syncOp();
  }

  // A field that cannot scale: "Multiply by" is off.
  function syncOp() {
    var spec = fieldSpec();
    var scaleOpt = $("bal-op").querySelector("option[value=scale]");
    scaleOpt.disabled = !!spec && !spec.scale;
    if (scaleOpt.disabled && $("bal-op").value === "scale") $("bal-op").value = "set";
  }

  function fieldSpec() {
    var name = $("bal-field").value, found = null;
    fieldsOf(formKind()).forEach(function (f) { if (f.name === name) found = f; });
    return found;
  }

  function currentType() { return typeFor(state.data, $("bal-type").value, classes()); }

  function fillMoves() {
    var sel = $("bal-move"), keep = sel.value;
    var type = currentType(), file = loadedFile(state.data, type);
    var show = !!file;
    $("bal-move-field").hidden = !show;
    $("bal-mfilter-field").hidden = !show;
    clear(sel);
    if (!show) return;
    var q = $("bal-mfilter").value.trim().toLowerCase();
    option(sel, "", "Pick a move");
    option(sel, "*", "Any move (entry and record *)");
    option(sel, "hand", "Another entry and record (typed below)");
    (file.moves || []).forEach(function (m, i) {
      var label = (m.name ? m.name + " " : "") + "k" + m.kind + " #" + m.id + (m.set && m.set !== "k" + m.kind ? " [" + m.set + "]" : "")
        + (typeof m.mv[0] === "number" ? " mv " + m.mv[0] : "") + (m.styles ? " " + m.styles : "");
      if (q && label.toLowerCase().indexOf(q) === -1 && i !== Number(keep)) return;
      option(sel, String(i), label);
    });
    sel.value = keep;
    if (sel.value !== keep) sel.value = "";
  }

  // The move box follows the entry and record boxes (typed or picked).
  function syncMoveSelect() {
    var sel = $("bal-move");
    var type = currentType(), file = loadedFile(state.data, type);
    if (!file) return;
    var e = parseAny($("bal-entry").value), i = parseAny($("bal-id").value);
    var idx = "";
    if (e === null && i === null && $("bal-entry").value.trim() === "*" && $("bal-id").value.trim() === "*") idx = "*";
    else if (e !== undefined && i !== undefined && e !== null && i !== null) {
      (file.moves || []).forEach(function (m, n) { if (idx === "" && m.kind === e && m.id === i) idx = String(n); });
      if (idx === "") idx = "hand";
    } else idx = $("bal-entry").value.trim() || $("bal-id").value.trim() ? "hand" : "";
    var has = false;
    Array.prototype.forEach.call(sel.options, function (o) { if (o.value === idx) has = true; });
    sel.value = has ? idx : "";
  }

  function onMovePick() {
    var v = $("bal-move").value, file = loadedFile(state.data, currentType());
    if (v === "*") { $("bal-entry").value = "*"; $("bal-id").value = "*"; }
    else if (v === "hand") { $("bal-entry").focus(); }
    else if (v !== "" && file) {
      var m = file.moves[Number(v)];
      $("bal-entry").value = String(m.kind);
      $("bal-id").value = String(m.id);
    }
    updateCurrent();
  }

  function showGroups() {
    var attack = formKind() === "attack";
    $("bal-attack-group").hidden = !attack;
    $("bal-weapon-group").hidden = attack;
    $("bal-wsearch-field").hidden = state.data.ok === false;
    if (state.data.ok === false) $("bal-wresults").hidden = true;
  }

  function renderForm() {
    fillTypes();
    fillStyles();
    fillFields();
    showGroups();
    fillMoves();
    updateCurrent();
    $("bal-form-title").textContent = state.editing ? "Edit row #" + state.editing.id : "Add a row";
    $("bal-save").textContent = state.editing ? "Save row" : "Add row";
    $("bal-cancel").hidden = !state.editing;
  }

  function formValues() {
    return { kind: formKind(), type: $("bal-type").value, style: $("bal-style").value, entry: $("bal-entry").value,
      id: formKind() === "attack" ? $("bal-id").value : $("bal-wid").value, field: $("bal-field").value, op: $("bal-op").value,
      value: $("bal-value").value, reason: $("bal-reason").value };
  }

  // The current game value next to the draft value, and the move's styles.
  function updateCurrent() {
    var f = formValues(), box = $("bal-current"), note = $("bal-move-note"), wnote = $("bal-weapon-note");
    var cur = null, what = "";
    note.textContent = "";
    wnote.textContent = "";
    if (state.data.ok === false) {
      what = "The game's current value is unknown: the weapon data is missing.";
    } else if (f.kind === "attack") {
      var e = parseAny(f.entry), i = parseAny(f.id);
      var move = findMove(state.data, f.type, classes(), e, i);
      if (f.type === "") what = "Current value: unknown (any weapon type).";
      else if (e === undefined || i === undefined) what = "";
      else if (e === null || i === null) what = "Current value: many records, so no single value.";
      else if (!move) what = "Current value: unknown (the data has no such move).";
      else {
        cur = moveValue(move, f.field);
        if (move.styles !== undefined) {
          note.textContent = "Styles that reach this move: " + stylesText(move.styles) + "."
            + (f.style && move.styles.indexOf(Object.keys(LETTER_STYLE).filter(function (l) { return LETTER_STYLE[l] === f.style; })[0]) === -1
              ? " The style picked here is not one of them." : "");
        }
      }
    } else {
      var id = /^\d+$/.test(f.id.trim()) ? Number(f.id.trim()) : null;
      var w = id === null ? null : findWeapon(state.data, f.kind, id);
      if (id !== null && w) {
        wnote.textContent = w.name + " (" + w.type.name + ", attack " + w.row[w.fields.indexOf("attack")] + ").";
        cur = weaponValue(w, f.field);
      } else if (id !== null) wnote.textContent = "No weapon with that id in the data.";
    }
    var text = what;
    if (!what) {
      text = "Current value: " + showValue(cur) + ".";
      var n = Number(f.value.trim());
      if (f.value.trim() !== "" && isFinite(n)) {
        if (f.op === "scale") {
          var r = scaled(cur, n);
          text += r === null ? " After: " + (typeof cur === "number" ? "?" : "unknown") + "." : " After: " + r + " (" + cur + " x " + n + ", cut to a whole number).";
        } else text += " After: " + n + ".";
      }
    } else if (f.value.trim() !== "" && f.op === "scale") {
      text += " A multiplier shows its result when the current value is known.";
    }
    box.textContent = text;
  }

  function wireForm() {
    $("bal-kind").addEventListener("change", function () {
      fillFields();
      showGroups();
      $("bal-wresults").hidden = true;
      var g = formGroup();
      if (g) $("bal-weapon-note").textContent = "Loading the weapon names...";
      (g ? loadGroup(g) : Promise.resolve()).then(updateCurrent);
      updateCurrent();
    });
    $("bal-type").addEventListener("change", function () {
      var t = currentType();
      loadFile(t).then(function () { fillMoves(); syncMoveSelect(); updateCurrent(); });
      fillMoves();
      updateCurrent();
    });
    $("bal-style").addEventListener("change", updateCurrent);
    $("bal-mfilter").addEventListener("input", function () { fillMoves(); });
    $("bal-move").addEventListener("change", onMovePick);
    ["bal-entry", "bal-id"].forEach(function (id) {
      $(id).addEventListener("input", function () { syncMoveSelect(); updateCurrent(); });
    });
    $("bal-wid").addEventListener("input", updateCurrent);
    $("bal-wsearch").addEventListener("input", weaponSearch);
    $("bal-field").addEventListener("change", function () { syncOp(); updateCurrent(); });
    $("bal-op").addEventListener("change", updateCurrent);
    $("bal-value").addEventListener("input", updateCurrent);
    $("bal-form").addEventListener("submit", submitRow);
    $("bal-cancel").addEventListener("click", function () { stopEdit(); });
  }

  function weaponSearch() {
    var list = $("bal-wresults"), q = $("bal-wsearch").value;
    clear(list);
    var found = searchWeapons(state.data, formGroup(), q, 30);
    if (!q.trim()) { list.hidden = true; return; }
    if (!found.length) {
      list.appendChild(el("li", "bal-none", "No weapon found."));
    }
    found.forEach(function (w) {
      var li = el("li");
      var b = el("button", "ghost-btn small", w.name + " (" + w.type.name + ", #" + w.id + ")");
      b.type = "button";
      b.addEventListener("click", function () {
        $("bal-wid").value = String(w.id);
        list.hidden = true;
        updateCurrent();
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function stopEdit() {
    state.editing = null;
    $("bal-value").value = "";
    problemList("bal-problems", []);
    renderForm();
  }

  function startEdit(row) {
    state.editing = row;
    state.confirmDelete = null;
    ok("");
    $("bal-kind").value = row.kind;
    fillFields();
    showGroups();
    var group = row.kind === "attack" ? null : row.kind;
    var t = row.kind === "attack" ? typeFor(state.data, row.weaponClass, classes()) : null;
    (group ? loadGroup(group) : loadFile(t)).then(function () {
      $("bal-type").value = row.weaponClass || "";
      $("bal-style").value = row.style || "";
      $("bal-entry").value = row.entry === null ? "*" : String(row.entry);
      $("bal-id").value = row.recordId === null ? "*" : String(row.recordId);
      $("bal-wid").value = row.recordId === null ? "" : String(row.recordId);
      fillMoves();
      $("bal-field").value = row.field;
      $("bal-op").value = row.op;
      syncOp();
      $("bal-value").value = String(row.value);
      $("bal-reason").value = row.reason || "";
      syncMoveSelect();
      updateCurrent();
    });
    $("bal-form-title").textContent = "Edit row #" + row.id;
    $("bal-save").textContent = "Save row";
    $("bal-cancel").hidden = false;
    problemList("bal-problems", []);
    renderRows();
    $("bal-advanced").open = true;
    $("bal-edit").scrollIntoView({ block: "start" });
  }

  function submitRow(event) {
    event.preventDefault();
    if (state.busy) return;
    var built = buildRow(formValues(), state.overview);
    if (built.errors.length) { problemList("bal-problems", built.errors); return; }
    problemList("bal-problems", []);
    var editing = state.editing;
    var body = built.body;
    if (editing) body.position = editing.position;
    state.busy = true;
    request(editing ? "/api/admin/balance/rows/" + editing.id : "/api/admin/balance/rows",
      { method: editing ? "PUT" : "POST", body: JSON.stringify(body) })
      .then(function (row) {
        state.busy = false;
        state.editing = null;
        $("bal-value").value = "";
        return load().then(function (good) { if (good) ok(editing ? "Row #" + row.id + " saved." : "Row #" + row.id + " added to the draft."); });
      })
      .catch(function (e) { state.busy = false; fail(e); });
  }

  /* --- the draft rows --- */

  function emptyRow(body, cols, text) {
    var tr = el("tr"), td = el("td", "empty-cell", text);
    td.colSpan = cols;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  function renderRows() {
    var body = $("bal-rows"), cl = classes();
    clear(body);
    var byRow = {};
    state.problems.forEach(function (p) { (byRow[p.rowId] = byRow[p.rowId] || []).push(p.message); });
    problemList("bal-draft-problems", state.problems.map(function (p) { return "Row #" + p.rowId + ": " + p.message; }));
    if (!state.rows.length) { emptyRow(body, 9, "The draft has no rows."); return; }
    state.rows.forEach(function (r, i) {
      var tr = el("tr");
      var cur = currentOf(r, state.data, cl), opts = optionsOf(r, state.data, cl);
      tr.appendChild(el("td", null, String(i + 1)));
      tr.appendChild(el("td", null, whatText(r, state.data, cl)));
      tr.appendChild(el("td", null, r.field));
      tr.appendChild(el("td", null, showValue(cur, opts, r.field)));
      tr.appendChild(el("td", null, changeText(r, cur, opts)));
      tr.appendChild(reasonCell(r));
      tr.appendChild(el("td", null, r.author));
      tr.appendChild(el("td", null, (byRow[r.id] || []).join(" ")));
      var act = el("td");
      if (state.canWrite) {
        act.className = "bal-actions";
        var edit = el("button", "ghost-btn small", "Edit");
        edit.type = "button";
        edit.addEventListener("click", function () { startEdit(r); });
        var del = el("button", "ghost-btn small", state.confirmDelete === r.id ? "Click again to delete" : "Delete");
        del.type = "button";
        if (state.confirmDelete === r.id) del.classList.add("is-armed");
        del.addEventListener("click", function () { deleteRow(r); });
        var up = el("button", "ghost-btn small", "Up");
        up.type = "button";
        up.disabled = i === 0;
        up.addEventListener("click", function () { reorder(i, -1); });
        var down = el("button", "ghost-btn small", "Down");
        down.type = "button";
        down.disabled = i === state.rows.length - 1;
        down.addEventListener("click", function () { reorder(i, 1); });
        [edit, del, up, down].forEach(function (b) { act.appendChild(b); });
      }
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }

  // The reason of a row, editable in place for admins (the grid gives new rows the session reason).
  function reasonCell(r) {
    var td = el("td", "bal-reason-edit");
    if (!state.canWrite) { td.textContent = r.reason; return td; }
    var input = el("input", "bal-reason-input");
    input.type = "text";
    input.maxLength = 500;
    input.value = r.reason || "";
    input.setAttribute("aria-label", "Reason of row " + r.id);
    var save = el("button", "ghost-btn small", "Save reason");
    save.type = "button";
    save.disabled = true;
    input.addEventListener("input", function () { save.disabled = !input.value.trim() || input.value.trim() === r.reason; });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !save.disabled) { e.preventDefault(); saveReason(r, input.value.trim()); } });
    save.addEventListener("click", function () { saveReason(r, input.value.trim()); });
    td.appendChild(input);
    td.appendChild(save);
    return td;
  }

  function saveReason(r, reason) {
    var body = { kind: r.kind, weaponClass: r.weaponClass, style: r.style, entry: r.entry, recordId: r.recordId, field: r.field,
      op: r.op, value: r.value, reason: reason, position: r.position };
    request("/api/admin/balance/rows/" + r.id, { method: "PUT", body: JSON.stringify(body) })
      .then(function () { return load().then(function (good) { if (good) ok("Row #" + r.id + ": reason saved."); }); })
      .catch(fail);
  }

  // Two clicks, like the other tabs: the first asks, the second does it.
  function deleteRow(r) {
    if (state.confirmDelete !== r.id) {
      state.confirmDelete = r.id;
      renderRows();
      return;
    }
    state.confirmDelete = null;
    request("/api/admin/balance/rows/" + r.id + "/delete", { method: "POST", body: "{}" })
      .then(function () {
        if (state.editing && state.editing.id === r.id) state.editing = null;
        return load().then(function (good) { if (good) ok("Row #" + r.id + " deleted."); });
      })
      .catch(fail);
  }

  function reorder(index, dir) {
    var ids = moveIds(state.rows, index, dir);
    if (!ids) return;
    state.confirmDelete = null;
    request("/api/admin/balance/rows/order", { method: "POST", body: JSON.stringify({ ids: ids }) })
      .then(function () { return load().then(function (good) { if (good) ok("Order saved."); }); })
      .catch(fail);
  }

  /* --- diff --- */

  function diffList(box, title, cls, lines) {
    if (!lines.length) return;
    box.appendChild(el("h4", "subhead", title + " (" + lines.length + ")"));
    var ul = el("ul", "bal-diff-list " + cls);
    lines.forEach(function (l) { ul.appendChild(el("li", null, l)); });
    box.appendChild(ul);
  }

  function renderDiff() {
    var box = $("bal-diff"), d = state.diff, cl = classes();
    clear(box);
    var from = d.from === null || d.from === undefined ? null : d.from;
    var c = diffCounts(d);
    box.appendChild(el("p", "note-text", (from === null ? "Nothing is published yet: every row is new. " : "Draft against v" + from + ": ")
      + c.added + " added, " + c.removed + " removed, " + c.changed + " changed, " + (d.unchanged || 0) + " unchanged."
      + (d.orderChanged ? " The order changed." : "")));
    diffList(box, "Added", "is-added", (d.added || []).map(function (r) { return rowLine(r, state.data, cl) + " (" + r.reason + ")"; }));
    diffList(box, "Removed", "is-removed", (d.removed || []).map(function (r) { return rowLine(r, state.data, cl) + " (" + r.reason + ")"; }));
    diffList(box, "Changed", "is-changed", (d.changed || []).map(function (x) {
      return "Before: " + rowLine(x.before, state.data, cl) + " (" + x.before.reason + "). After: " + rowLine(x.after, state.data, cl) + " (" + x.after.reason + ")";
    }));
    if (diffEmpty(d)) box.appendChild(el("p", "note-text", "The draft equals the published version: nothing to publish."));
  }

  /* --- publish --- */

  function askPublish() {
    ok("");
    var note = $("bal-pnote").value.trim();
    if (!note) { say("bal-alert", "Write a note for the version first."); return; }
    // Fresh answers, so the question and the fingerprint are the ones shown now.
    Promise.all([request("/api/admin/balance"), request("/api/admin/balance/diff"), request("/api/admin/balance/versions")]).then(function (all) {
      state.overview = all[0];
      state.diff = all[1];
      state.versions = all[2] || [];
      state.rows = all[0].rows || [];
      state.problems = all[0].problems || [];
      renderAll();
      if (state.problems.length) {
        say("bal-alert", "The draft has " + state.problems.length + " problem" + (state.problems.length === 1 ? "" : "s") + ": fix them first (see Draft rows).");
        return;
      }
      if (diffEmpty(state.diff)) { say("bal-alert", "Nothing to publish: the draft equals the published version."); return; }
      var blocked = publishBlocked(state.overview, state.rows.length);
      if (blocked) { say("bal-alert", blocked); return; }
      var next = nextVersion(state.versions, state.overview.published);
      state.pending = { fingerprint: all[0].fingerprint };
      $("bal-confirm-text").textContent = publishQuestion(next, state.diff) + ". Players get it at their next login.";
      $("bal-confirm").hidden = false;
      $("bal-confirm-yes").focus();
    }).catch(fail);
  }

  function doPublish() {
    var note = $("bal-pnote").value.trim();
    if (!state.pending) return;
    if (!note) { say("bal-alert", "Write a note for the version first."); return; }
    var fp = state.pending.fingerprint;
    state.pending = null;
    $("bal-confirm").hidden = true;
    request("/api/admin/balance/publish", { method: "POST", body: JSON.stringify({ note: note, fingerprint: fp }) })
      .then(function (v) {
        $("bal-pnote").value = "";
        return load().then(function (good) { if (good) ok("Published v" + v.version + " (" + v.rowCount + " rows)."); });
      })
      .catch(function (e) { load().then(function () { fail(e); }); });
  }

  /* --- versions --- */

  function renderVersions() {
    var body = $("bal-versions");
    clear(body);
    if (!state.versions.length) { emptyRow(body, 6, "Nothing published yet."); return; }
    state.versions.forEach(function (v, i) {
      var tr = el("tr");
      tr.appendChild(el("td", null, "v" + v.version + (i === 0 ? " (latest)" : "")));
      tr.appendChild(el("td", null, utc(v.publishedAt)));
      tr.appendChild(el("td", null, v.publishedBy));
      tr.appendChild(el("td", null, String(v.rowCount)));
      tr.appendChild(el("td", null, (v.note || "") + (v.rollbackOf ? " (roll back to v" + v.rollbackOf + ")" : "")));
      var act = el("td");
      if (state.canWrite && i > 0) {
        var b = el("button", "ghost-btn small", "Roll back");
        b.type = "button";
        var blocked = publishBlocked(state.overview, v.rowCount);
        b.disabled = !!blocked;
        b.title = blocked || "";
        b.addEventListener("click", function () { askRollback(v); });
        act.appendChild(b);
      }
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }

  function askRollback(v) {
    ok("");
    state.rollbackTo = v.version;
    $("bal-rollback-text").textContent = "Roll back to v" + v.version + ": its " + v.rowCount + " rows are published again as v"
      + nextVersion(state.versions, state.overview.published) + ", and the draft is replaced by them.";
    $("bal-rnote").value = "";
    $("bal-rollback").hidden = false;
    $("bal-rnote").focus();
  }

  function doRollback() {
    var note = $("bal-rnote").value.trim();
    if (!note) { say("bal-alert", "Write a note for the roll back first."); return; }
    var v = state.rollbackTo;
    if (!v) return;
    state.rollbackTo = null;
    $("bal-rollback").hidden = true;
    request("/api/admin/balance/rollback/" + v, { method: "POST", body: JSON.stringify({ note: note }) })
      .then(function (r) { return load().then(function (good) { if (good) ok("Rolled back to v" + v + ": published as v" + r.version + "."); }); })
      .catch(function (e) { load().then(function () { fail(e); }); });
  }

  function wire() {
    wireForm();
    $("bal-refresh").addEventListener("click", function () { state.confirmDelete = null; load(); });
    $("bal-publish-btn").addEventListener("click", askPublish);
    $("bal-confirm-yes").addEventListener("click", doPublish);
    $("bal-confirm-no").addEventListener("click", function () { state.pending = null; $("bal-confirm").hidden = true; });
    $("bal-rollback-yes").addEventListener("click", doRollback);
    $("bal-rollback-no").addEventListener("click", function () { state.rollbackTo = null; $("bal-rollback").hidden = true; });
    $("bal-pnote").addEventListener("input", function () { say("bal-alert", ""); });
  }

  // What the grid (js/admin-balance-grid.js) uses of this tab.
  window.hvBalance = { state: state, request: request, reload: load, ok: ok, fail: fail, classes: classes, loadFile: loadFile };

  window.startAdminBalance = function () {
    if (started) { load(); return; }
    started = true;
    wire();
    // Moderators look only. If the roles cannot be read the buttons stay and the API's 403 explains.
    request("/api/account").then(function (a) {
      if (a && a.roles && a.roles.indexOf("ROLE_ADMIN") === -1) state.canWrite = false;
    }).catch(function () { /* keep the buttons */ }).then(load);
  };
})();
