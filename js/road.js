/* Hunting Road builder: edit which monsters each floor can pick, check the rules live (js/road-rules.js),
   and submit the Road for the vote. Everything about the Road itself (the base, the monsters, the tables,
   the policy) comes from GET /api/road/pool at run time; nothing about it is stored in this site.

   The page keeps one object, `edits`: only what differs from the base, in the format the API stores
   (see js/road-rules.js). The Road shown is the base with those edits applied.
   ?entry=<id> opens an entry: yours to edit during the submission window, anyone else's read-only. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var Rules = window.RoadRules;

  var pool = null;          // GET /api/road/pool
  var cycle = null;         // GET /api/road/cycle (null: none)
  var characters = [];      // the account's characters
  var entry = null;         // the opened entry (GET /api/road/entries/{id}), or null for a new one
  var edits = {};           // the player's Road, changes only
  var road = null;          // the base with the edits made
  var problems = [];        // from the rules, for the current edits
  var serverProblems = null;// the server's verdict, after "Check with the server"
  var shownMode = 0;
  var soloOn = false;       // the "Also change the solo Road" box; off until ticked or the edits change mode 1
  var readOnly = false;
  var refreshers = [];      // one function per drawn row; each updates its row from `road` and `problems`
  var openTables = {};      // "mode:table" -> true while its <details> is open
  var monsterSelect = null; // a prebuilt <select> of the monsters, cloned for each row
  var timer = null;

  /* ---------- helpers ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function $(id) { return document.getElementById(id); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (error) {
      return "";
    }
  }

  // Resolves to the JSON body (null for 204). Errors carry .status and .data (the body, with .problems).
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (response) {
        if (response.status === 401) throw new Error("signin");
        if (response.status === 204) return null;
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) {
            var error = new Error((data && data.message) || "HTTP " + response.status);
            error.server = true;
            error.status = response.status;
            error.data = data;
            throw error;
          }
          return data;
        });
      });
  }

  function formatDate(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function alertBox(text) {
    var box = $("road-alert");
    box.textContent = text || "";
    box.hidden = !text;
  }

  function notice(text) {
    var box = $("road-notice");
    box.textContent = text || "";
    box.hidden = !text;
  }

  function showError(error) {
    if (error.message === "signin") {
      alertBox("Your sign-in has expired. Sign in again on the home page.");
    } else if (error.status === 503) {
      alertBox("The Hunting Road is not set up on the server yet. Try again later.");
    } else {
      alertBox(error.server ? error.message : "The API did not answer. Try again in a moment.");
    }
  }

  function policyList(key) { return Rules.policyValue(pool.policy, key); }

  function monsterName(id) {
    var found = pool.monsters.filter(function (m) { return m.id === id; })[0];
    return found ? found.name : "Unknown monster " + id;
  }

  /* ---------- the edits ---------- */

  function baseMode(m) { return pool.base.modes[m]; }

  function findIndex(list, test) {
    for (var i = 0; i < list.length; i++) if (test(list[i])) return i;
    return -1;
  }

  function modeEdit(m, create) {
    edits.modes = edits.modes || [];
    var i = findIndex(edits.modes, function (x) { return x.mode === m; });
    if (i >= 0) return edits.modes[i];
    if (!create) return null;
    var made = { mode: m, floors: [], entries: [] };
    edits.modes.push(made);
    edits.modes.sort(function (a, b) { return a.mode - b.mode; });
    return made;
  }

  // Drops edits that say nothing, so "changes only" stays true after a value goes back to the base.
  function prune() {
    (edits.modes || []).forEach(function (me) {
      me.floors = (me.floors || []).filter(function (f) { return Object.keys(f).some(function (k) { return k !== "floor"; }); });
      me.entries = (me.entries || []).filter(function (e) {
        return Object.keys(e).some(function (k) { return k !== "table" && k !== "entry"; });
      });
      if (!me.floors.length) delete me.floors;
      if (!me.entries.length) delete me.entries;
    });
    edits.modes = (edits.modes || []).filter(function (me) {
      return me.floors || me.entries || me.floorCount !== undefined;
    });
    if (!edits.modes.length) delete edits.modes;
  }

  // field: "table", "points" or "points2". A value equal to the base drops the edit.
  function setFloorField(m, floor, field, value) {
    var me = modeEdit(m, true);
    me.floors = me.floors || [];
    var i = findIndex(me.floors, function (f) { return f.floor === floor; });
    var fe = i >= 0 ? me.floors[i] : null;
    if (!fe) {
      fe = { floor: floor };
      me.floors.push(fe);
      me.floors.sort(function (a, b) { return a.floor - b.floor; });
    }
    if (value === baseMode(m).floors[floor - 1][field]) delete fe[field]; else fe[field] = value;
    prune();
  }

  function sortEntries(me) {
    me.entries.sort(function (a, b) { return (a.table - b.table) || (a.entry - b.entry); });
  }

  function entryEdit(m, t, e, create) {
    var me = modeEdit(m, create);
    if (!me) return null;
    me.entries = me.entries || [];
    var i = findIndex(me.entries, function (x) { return x.table === t && x.entry === e; });
    if (i >= 0) return me.entries[i];
    if (!create) return null;
    var made = { table: t, entry: e };
    me.entries.push(made);
    sortEntries(me);
    return made;
  }

  function baseEntry(m, t, e) {
    var table = baseMode(m).tables[t];
    return table && e < table.length ? table[e] : null;
  }

  function setEntryField(m, t, e, field, value) {
    var ee = entryEdit(m, t, e, true);
    var base = baseEntry(m, t, e);
    var same;
    if (base) same = field === "forced" ? value === ((base.flags & Rules.FLAG_FORCED) !== 0) : value === base[field];
    else same = (field === "monster2" && value === 0) || (field === "forced" && value === false);
    if (same) delete ee[field]; else ee[field] = value;
    prune();
  }

  function tableLength(m, t) { return road.modes[m].tables[t].length; }

  function addEntry(m, t) {
    var len = tableLength(m, t);
    var first = road.modes[m].tables[t][0];
    var monster = first && first.monster ? first.monster : pool.monsters[0].id;
    var ee = entryEdit(m, t, len, true);
    ee.monster = monster;
    ee.weight = 1;
    prune();
  }

  function removeLastAdded(m, t) {
    var len = tableLength(m, t);
    var me = modeEdit(m, false);
    if (!me || len <= baseMode(m).tables[t].length) return;
    me.entries = (me.entries || []).filter(function (x) { return !(x.table === t && x.entry === len - 1); });
    prune();
  }

  function resetTable(m, t) {
    var me = modeEdit(m, false);
    if (!me) return;
    me.entries = (me.entries || []).filter(function (x) { return x.table !== t; });
    prune();
  }

  function addedCount() {
    var added = 0;
    road.modes.forEach(function (mode, m) {
      mode.tables.forEach(function (entries, t) {
        added += Math.max(0, entries.length - baseMode(m).tables[t].length);
      });
    });
    return added;
  }

  /* ---------- checking ---------- */

  function recompute() {
    var result = Rules.checkEdits(pool, edits);
    problems = result.problems;
    road = result.road || Rules.apply(pool.base, {}).road;
  }

  function problemHere(test) { return problems.some(test); }

  function renderProblems() {
    var list = $("road-problems");
    clear(list);
    var all = problems.concat(serverProblems || []);
    var seen = {};
    all = all.filter(function (p) {
      var key = p.rule + "|" + p.mode + "|" + p.floor + "|" + p.table + "|" + p.entry + "|" + p.message;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    all.forEach(function (p) {
      var item = el("li");
      item.appendChild(el("span", "badge", p.rule));
      item.appendChild(document.createTextNode(p.message));
      list.appendChild(item);
    });
    $("road-problems-note").textContent = all.length ? all.length + (all.length === 1 ? " problem" : " problems") : "no problems found";
    if (!all.length) {
      var ok = el("li", "empty-state", "No problems found. The server also checks the file size when you submit.");
      ok.style.borderLeftColor = "var(--teal)";
      ok.style.background = "rgba(46,91,78,.08)";
      ok.style.borderColor = "rgba(46,91,78,.4)";
      list.appendChild(ok);
    }
    $("road-json").textContent = JSON.stringify(edits, null, 2);
    function count(me) { return me ? (me.floors || []).length + (me.entries || []).length : 0; }
    var changes = (edits.modes || []).reduce(function (n, me) { return n + count(me); }, 0);
    var solo = count(modeEdit(1, false));
    $("road-entry-note").textContent = !changes ? "same as the base" :
      changes + (changes === 1 ? " change" : " changes") + " from the base" +
      (solo ? " (open Road " + (changes - solo) + ", solo Road " + solo + ")" : "");
  }

  // Called after every edit: re-check, then let every drawn row catch up.
  function refresh() {
    serverProblems = null;
    $("road-server-note").textContent = "";
    notice("");
    recompute();
    refreshers.forEach(function (fn) { fn(); });
    renderProblems();
    renderNotes();
  }

  function refreshSoon() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 120);
  }

  /* ---------- floors ---------- */

  function tableCount(m) { return baseMode(m).tables.length; }

  function floorLabel(m, index) {
    var floors = baseMode(m).floors;
    var from = floors[index].floor;
    var next = floors[index + 1];
    if (!next) return "Floor " + from + " and up";
    return next.floor - 1 > from ? "Floors " + from + " to " + (next.floor - 1) : "Floor " + from;
  }

  // The two Road points multipliers of a floor record. Any number is kept in the edits, so a value over
  // the rotation's cap (policy maxPoints) shows up as a problem instead of being dropped silently.
  function pointsInputs(m, number, modeAllowed) {
    var box = el("div", "road-floor-points");
    var inputs = [["points", "Points ×"], ["points2", "Second points ×"]].map(function (pair) {
      var field = pair[0];
      var label = el("label", null, pair[1] + " ");
      var input = el("input");
      input.type = "number";
      input.min = "0";
      input.max = String(policyList("maxPoints"));
      input.step = "any";
      input.setAttribute("aria-label", pair[1].replace(" ×", " multiplier") + " for record " + number);
      input.disabled = !modeAllowed || policyList("floorFields").indexOf(field) < 0;
      input.addEventListener("input", function () {
        var n = Number(input.value);
        if (input.value === "" || !isFinite(n)) return;
        setFloorField(m, number, field, n);
        refreshSoon();
      });
      label.appendChild(input);
      box.appendChild(label);
      return { field: field, input: input };
    });
    return {
      box: box,
      // Shows the value in the edits even when the rules refused it (0, or over 100), so it can be fixed.
      refresh: function (f) {
        var me = modeEdit(m, false);
        var fe = me ? (me.floors || []).filter(function (x) { return x.floor === number; })[0] : null;
        var changed = false;
        inputs.forEach(function (x) {
          var value = fe && fe[x.field] !== undefined ? fe[x.field] : f[x.field];
          if (value !== f[x.field]) changed = true;
          if (document.activeElement !== x.input) x.input.value = String(value);
        });
        return changed;
      }
    };
  }

  function renderFloors() {
    var box = $("road-floors");
    clear(box);
    var m = shownMode;
    var mode = baseMode(m);
    var modeAllowed = !readOnly && policyList("modes").indexOf(m) >= 0;
    var allowed = modeAllowed && policyList("floorFields").indexOf("table") >= 0;
    $("road-floors-note").textContent = mode.floors.length + " floor records, " + mode.tables.length + " tables";
    $("road-points-cap").textContent = String(policyList("maxPoints"));
    mode.floors.forEach(function (base, index) {
      var number = index + 1;
      var row = el("div", "road-floor");
      row.appendChild(el("span", "road-floor-name", "Record " + number + ": " + floorLabel(m, index).toLowerCase()));
      var select = el("select");
      select.setAttribute("aria-label", "Table for record " + number);
      select.disabled = !allowed;
      select.addEventListener("change", function () {
        setFloorField(m, number, "table", Number(select.value));
        refreshSoon();
        // the row's own class and the selected value follow `road` in refresh
      });
      row.appendChild(select);
      var open = el("button", "ghost-btn small", "Open");
      open.type = "button";
      open.title = "Open this floor's table below";
      open.addEventListener("click", function () {
        var t = road.modes[m].floors[index].table;
        var details = $("road-table-" + m + "-" + t);
        if (!details) return;
        details.open = true;
        details.scrollIntoView({ block: "start" });
      });
      row.appendChild(open);
      var points = pointsInputs(m, number, modeAllowed);
      row.appendChild(points.box);
      box.appendChild(row);

      refreshers.push(function () {
        var f = road.modes[m].floors[index];
        var count = Math.max(tableCount(m), f ? f.table + 1 : 0);
        if (select.options.length !== count) {
          clear(select);
          for (var t = 0; t < count; t++) select.appendChild(new Option("Table " + t, String(t)));
        }
        select.value = String(f.table);
        var refused = points.refresh(f);
        row.classList.toggle("is-changed", refused || f.table !== base.table || f.points !== base.points || f.points2 !== base.points2);
        row.classList.toggle("has-problem", problemHere(function (p) { return p.mode === m && p.floor === number; }));
      });
    });
  }

  /* ---------- tables ---------- */

  function buildMonsterSelect() {
    monsterSelect = el("select");
    monsterSelect.appendChild(new Option("None", "0"));
    pool.monsters.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (monster) {
      monsterSelect.appendChild(new Option(monster.name + " (" + monster.id + ")", String(monster.id)));
    });
  }

  // A copy of the monster list (setMonsterValue picks the value; an id the list does not know stays visible).
  function monsterSelectFor(withNone, label) {
    var select = monsterSelect.cloneNode(true);
    if (!withNone) select.removeChild(select.firstChild);
    select.setAttribute("aria-label", label);
    return select;
  }

  function setMonsterValue(select, id) {
    var value = String(id);
    var known = false;
    for (var i = 0; i < select.options.length; i++) if (select.options[i].value === value) known = true;
    if (!known) select.appendChild(new Option(monsterName(id) + " (" + id + ")", value));
    select.value = value;
  }

  function entryRow(m, t, e) {
    var row = el("tr");
    var editable = !readOnly && policyList("modes").indexOf(m) >= 0;
    var fields = policyList("entryFields");
    function can(field) { return editable && fields.indexOf(field) >= 0; }

    row.appendChild(el("td", "rank", String(e)));
    var monsterCell = el("td");
    var monster = monsterSelectFor(false, "Monster of entry " + e);
    monster.disabled = !can("monster");
    monster.addEventListener("change", function () { setEntryField(m, t, e, "monster", Number(monster.value)); refreshSoon(); });
    monsterCell.appendChild(monster);
    row.appendChild(monsterCell);

    var secondCell = el("td");
    var second = monsterSelectFor(true, "Second monster of entry " + e);
    second.disabled = !can("monster2");
    second.addEventListener("change", function () { setEntryField(m, t, e, "monster2", Number(second.value)); refreshSoon(); });
    secondCell.appendChild(second);
    row.appendChild(secondCell);

    var weightCell = el("td");
    var weight = el("input");
    weight.type = "number";
    weight.min = "0";
    weight.max = String(policyList("maxWeight"));
    weight.step = "1";
    weight.setAttribute("aria-label", "Weight of entry " + e);
    weight.disabled = !can("weight");
    weight.addEventListener("input", function () {
      var n = Number(weight.value);
      if (weight.value === "" || !Number.isInteger(n) || n < 0) return;
      setEntryField(m, t, e, "weight", n);
      refreshSoon();
    });
    weightCell.appendChild(weight);
    row.appendChild(weightCell);

    var forcedCell = el("td");
    var forced = el("input");
    forced.type = "checkbox";
    forced.setAttribute("aria-label", "Forced entry " + e);
    forced.disabled = !can("forced");
    forced.addEventListener("change", function () { setEntryField(m, t, e, "forced", forced.checked); refreshSoon(); });
    forcedCell.appendChild(forced);
    row.appendChild(forcedCell);

    var level = el("td", "num");
    row.appendChild(level);

    refreshers.push(function () {
      var en = road.modes[m].tables[t][e];
      if (!en) { row.hidden = true; return; }
      row.hidden = false;
      setMonsterValue(monster, en.monster);
      setMonsterValue(second, en.monster2);
      if (document.activeElement !== weight) weight.value = String(en.weight);
      forced.checked = (en.flags & Rules.FLAG_FORCED) !== 0;
      level.textContent = String(en.level);
      var base = baseEntry(m, t, e);
      var changed = !base || base.monster !== en.monster || base.monster2 !== en.monster2 ||
        base.weight !== en.weight || ((base.flags ^ en.flags) & Rules.FLAG_FORCED) !== 0;
      row.classList.toggle("is-changed", changed);
      row.classList.toggle("has-problem", problemHere(function (p) { return p.mode === m && p.table === t && p.entry === e; }));
    });
    return row;
  }

  function drawTableBody(m, t, body) {
    clear(body);
    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table road-entries");
    var head = el("thead");
    var tr = el("tr");
    ["#", "Monster", "Second monster", "Weight", "Forced", "Level"].forEach(function (label, i) {
      tr.appendChild(el("th", i === 5 ? "num" : null, label));
    });
    head.appendChild(tr);
    table.appendChild(head);
    var rows = el("tbody");
    table.appendChild(rows);
    wrap.appendChild(table);
    body.appendChild(wrap);

    var actions = el("div", "admin-actions");
    var add = el("button", "ghost-btn small", "Add an entry");
    add.type = "button";
    var remove = el("button", "ghost-btn small", "Remove the last added entry");
    remove.type = "button";
    var reset = el("button", "ghost-btn small", "Reset this table to the base");
    reset.type = "button";
    actions.appendChild(add);
    actions.appendChild(remove);
    actions.appendChild(reset);
    body.appendChild(actions);

    var allowed = !readOnly && policyList("modes").indexOf(m) >= 0;
    var drawn = 0;
    // Rows for the entries the table has now; later additions draw their own row.
    function drawRows() {
      var len = tableLength(m, t);
      for (; drawn < len; drawn++) rows.appendChild(entryRow(m, t, drawn));
    }
    drawRows();
    refreshers.push(function () {
      var before = refreshers.length;
      drawRows();
      for (var i = before; i < refreshers.length; i++) refreshers[i](); // rows drawn just now
      var len = tableLength(m, t);
      var extra = len - baseMode(m).tables[t].length;
      add.disabled = !allowed || addedCount() >= policyList("maxAddedEntries");
      remove.disabled = !allowed || extra <= 0;
      reset.disabled = !allowed;
    });
    add.addEventListener("click", function () { addEntry(m, t); refresh(); });
    remove.addEventListener("click", function () { removeLastAdded(m, t); refresh(); });
    reset.addEventListener("click", function () { resetTable(m, t); refresh(); });
    refreshers.forEach(function (fn) { fn(); }); // fill the rows just drawn from the current Road
  }

  function renderTables() {
    var box = $("road-tables");
    clear(box);
    var m = shownMode;
    var mode = baseMode(m);
    $("road-tables-note").textContent = mode.tables.length + " tables";
    mode.tables.forEach(function (entries, t) {
      var details = el("details", "road-table");
      details.id = "road-table-" + m + "-" + t;
      var summary = el("summary", null, "Table " + t);
      var meta = el("span", "muted");
      summary.appendChild(meta);
      details.appendChild(summary);
      var body = el("div", "road-table-body");
      details.appendChild(body);
      box.appendChild(details);

      refreshers.push(function () {
        var list = road.modes[m].tables[t];
        var ids = {};
        list.forEach(function (en) {
          if (en.weight > 0 && (en.flags & Rules.FLAG_LOCKED) === 0 && en.monster !== 0) ids[en.monster] = true;
        });
        meta.textContent = list.length + (list.length === 1 ? " entry, " : " entries, ") + Object.keys(ids).length + " different monsters";
        details.classList.toggle("has-problem", problemHere(function (p) { return p.mode === m && p.table === t; }));
      });

      var key = m + ":" + t;
      function draw() {
        if (body.firstChild) return;
        drawTableBody(m, t, body);
      }
      details.addEventListener("toggle", function () {
        if (details.open) { openTables[key] = true; draw(); } else { delete openTables[key]; }
      });
      if (openTables[key]) { details.open = true; draw(); }
    });
  }

  function renderBuilder() {
    refreshers = [];
    renderFloors();
    renderTables();
    refresh();
  }

  // The "Also change the solo Road" box. Off by default, so a Road changes the open Road only; ticking it
  // shows the solo Road (mode 1) to edit, when the rotation allows it. Unticking drops its changes.
  function renderSolo() {
    var box = $("road-solo");
    var check = $("road-solo-check");
    var note = $("road-solo-note");
    var exists = pool.base.modes.length > 1;
    var allowed = exists && policyList("modes").indexOf(1) >= 0;
    if (modeEdit(1, false)) soloOn = true;
    box.hidden = !exists;
    check.checked = soloOn;
    check.disabled = readOnly || !allowed;
    note.textContent = readOnly
      ? (soloOn ? "This Road changes the solo Road too." : "This Road leaves the solo Road as it is.")
      : !allowed ? "The solo Road can't be changed in this rotation."
      : soloOn ? "On: pick \"Mode 1: solo Road\" below to change it. Untick to drop those changes."
      : "Off: the solo Road stays as it is.";
  }

  function onSoloChange() {
    var check = $("road-solo-check");
    if (!check.checked && modeEdit(1, false) &&
        !window.confirm("Drop all your changes to the solo Road?")) {
      check.checked = true;
      return;
    }
    soloOn = check.checked;
    if (!soloOn) {
      edits.modes = (edits.modes || []).filter(function (me) { return me.mode !== 1; });
      prune();
    }
    shownMode = soloOn ? 1 : 0;
    renderModes();
    renderBuilder();
  }

  function renderModes() {
    renderSolo();
    var box = $("road-modes");
    clear(box);
    var modes = policyList("modes").slice();
    (edits.modes || []).forEach(function (me) { if (modes.indexOf(me.mode) < 0) modes.push(me.mode); });
    if (soloOn && modes.indexOf(1) < 0) modes.push(1);
    modes = modes.filter(function (m) { return m < pool.base.modes.length && (m !== 1 || soloOn); })
      .sort(function (a, b) { return a - b; });
    if (modes.indexOf(shownMode) < 0) shownMode = modes[0] === undefined ? 0 : modes[0];
    if (modes.length < 2) {
      var only = modes.length ? modes[0] : 0;
      box.appendChild(el("span", "note-text", only === 0 ? "Mode 0: the open Road" : "Mode " + only + ": the solo Road"));
      return;
    }
    modes.forEach(function (m) {
      var button = el("button", "chip", m === 0 ? "Mode 0: open Road" : "Mode " + m + ": solo Road");
      button.type = "button";
      button.setAttribute("aria-pressed", m === shownMode ? "true" : "false");
      button.addEventListener("click", function () {
        shownMode = m;
        renderModes();
        renderBuilder();
      });
      box.appendChild(button);
    });
  }

  /* ---------- the entry form ---------- */

  function submissionOpen() {
    return !!cycle && cycle.state === "submitting";
  }

  function isMine() { return !!entry && !!entry.mine; }

  function renderNotes() {
    var note = $("road-window-note");
    var submit = $("road-submit");
    var text;
    var can = false;
    if (readOnly) {
      text = isMine()
        ? "This is your entry, but submissions are closed, so it can no longer be changed."
        : "This is another player's entry. You can look at it but not change it.";
    } else if (!cycle) {
      text = "There is no rotation yet. You can build a Road here, but it can only be submitted once a rotation opens.";
    } else if (!submissionOpen()) {
      text = "Submissions are closed right now (the rotation is in state \"" + cycle.state + "\"). You can build a Road here, but not submit it.";
    } else if (!entry && cycle.limits && (cycle.myEntries || []).length >= cycle.limits.entriesPerAccount) {
      text = "You already have " + (cycle.myEntries || []).length + " of the " + cycle.limits.entriesPerAccount +
        " Roads you can submit this rotation. Open one of yours from the vote page to change it.";
    } else {
      can = true;
      text = "Submissions close " + formatDate(cycle.submitCloses) + ". " +
        (entry ? "Saving replaces your entry." : "Submitting creates your entry; you can change it until then.");
    }
    if (!characters.length && !readOnly) {
      can = false;
      text += " You need a character on your account to be credited.";
    }
    note.textContent = text;
    submit.hidden = readOnly;
    submit.disabled = !can;
    submit.textContent = entry ? "Save changes" : "Submit";
    $("road-reset").hidden = readOnly;
    $("road-check").hidden = readOnly;
  }

  function fillCharacters(selectedName) {
    var select = $("road-character");
    clear(select);
    characters.forEach(function (character) {
      var option = new Option(character.name + (character.hr ? " (HR " + character.hr + ")" : ""), String(character.id));
      if (selectedName && character.name === selectedName) option.selected = true;
      select.appendChild(option);
    });
    if (readOnly && selectedName && !characters.some(function (c) { return c.name === selectedName; })) {
      select.appendChild(new Option(selectedName, "", true, true));
    }
  }

  function readForm() {
    return {
      name: $("road-name").value.trim(),
      description: $("road-description").value.trim(),
      characterId: Number($("road-character").value),
      edits: edits
    };
  }

  function formProblem(body) {
    if (body.name.length < 3 || body.name.length > 40) return "The name must be 3 to 40 characters.";
    if (body.description.length > 300) return "The description can be up to 300 characters.";
    if (/[\u0000-\u001f\u007f]/.test(body.name + body.description.replace(/\n/g, ""))) return "The name and description can't contain control characters.";
    if (!body.characterId) return "Pick the character to credit.";
    return null;
  }

  function showServerVerdict(report) {
    serverProblems = report.problems || [];
    var note = $("road-server-note");
    var limit = pool.maxFileSize;
    note.textContent = "Server check: " + (report.ok ? "passed" : "not passed") + (report.size ? ". File size " + report.size + " bytes" +
      (limit ? " (it must be under " + limit + ")" : "") : "") + ".";
    renderProblems();
  }

  function serverCheck() {
    alertBox("");
    return request("/api/road/check", { method: "POST", body: JSON.stringify({ edits: edits }) }).then(function (report) {
      showServerVerdict(report);
      return report;
    });
  }

  function onCheckClick() {
    var button = $("road-check");
    button.disabled = true;
    serverCheck().catch(showError).then(function () { button.disabled = false; });
  }

  function onSubmit(event) {
    event.preventDefault();
    alertBox("");
    notice("");
    var body = readForm();
    var wrong = formProblem(body);
    if (!wrong && problems.length) wrong = "Fix the problems listed under Checks first.";
    if (wrong) { alertBox(wrong); return; }
    var button = $("road-submit");
    button.disabled = true;
    serverCheck().then(function (report) {
      if (!report.ok) {
        alertBox("The server found problems with this Road. Fix them, then submit again.");
        return null;
      }
      var saving = !!entry;
      return request(saving ? "/api/road/entries/" + encodeURIComponent(entry.id) : "/api/road/entries",
        { method: saving ? "PUT" : "POST", body: JSON.stringify(body) }).then(function (saved) {
        if (saved && saved.id) {
          entry = saved;
          entry.mine = true;
          if (window.history && history.replaceState) history.replaceState(null, "", "/road.html?entry=" + encodeURIComponent(saved.id));
          if (cycle && (cycle.myEntries || []).indexOf(saved.id) < 0) cycle.myEntries = (cycle.myEntries || []).concat([saved.id]);
          renderHead();
        }
        notice(saving ? "Saved. Your changes are in the vote." : "Submitted. Your Road is in the vote; you can change it until submissions close.");
        return null;
      });
    }).catch(function (error) {
      if (error.data && error.data.problems && error.data.problems.length) {
        serverProblems = error.data.problems;
        renderProblems();
      }
      showError(error);
    }).then(function () {
      renderNotes();
    });
  }

  function renderHead() {
    $("road-title").textContent = entry ? entry.name || "Road entry" : "Road builder";
    $("road-entry-head").textContent = readOnly ? "Entry" : entry ? "Your entry" : "Your Road";
  }

  /* ---------- boot ---------- */

  function sessionOk() {
    return !!token();
  }

  function load() {
    var id = new URLSearchParams(window.location.search).get("entry");
    var jobs = [
      request("/api/road/pool"),
      request("/api/road/cycle"),
      request("/api/account/characters").catch(function (error) { if (error.message === "signin") throw error; return []; }),
      id ? request("/api/road/entries/" + encodeURIComponent(id)) : Promise.resolve(null)
    ];
    return Promise.all(jobs).then(function (data) {
      pool = data[0];
      cycle = data[1];
      characters = data[2] || [];
      entry = data[3];
      if (!pool || !pool.base || !pool.monsters) throw Object.assign(new Error("The Road data is not available."), { server: true });

      var parsed = Rules.parseEdits(entry ? entry.edits || {} : {});
      edits = parsed.edits || {};
      if (parsed.problem) alertBox("This entry's changes could not be read: " + parsed.problem.message);
      readOnly = !!entry && !(entry.mine && cycle && cycle.state === "submitting" && cycle.id === entry.cycleId);

      buildMonsterSelect();
      $("road-name").value = entry ? entry.name || "" : "";
      $("road-description").value = entry ? entry.description || "" : "";
      $("road-name").disabled = readOnly;
      $("road-description").disabled = readOnly;
      $("road-character").disabled = readOnly;
      fillCharacters(entry ? entry.characterName : null);
      renderHead();
      if (readOnly) {
        $("road-sub").textContent = "A Road entry, shown as the changes it makes to the base Hunting Road.";
      }
      $("road-app").hidden = false;
      renderModes();
      renderBuilder();
    });
  }

  function start() {
    if (!sessionOk()) {
      window.location.replace("/");
      return;
    }
    $("road-form").addEventListener("submit", onSubmit);
    $("road-check").addEventListener("click", onCheckClick);
    $("road-solo-check").addEventListener("change", onSoloChange);
    var armed = null;
    $("road-reset").addEventListener("click", function () {
      var button = $("road-reset");
      if (!armed) {
        armed = setTimeout(function () { armed = null; button.textContent = "Reset everything to the base"; }, 5000);
        button.textContent = "Click again to drop all your changes";
        return;
      }
      clearTimeout(armed);
      armed = null;
      button.textContent = "Reset everything to the base";
      edits = {};
      soloOn = false;
      renderModes();
      renderBuilder();
    });
    load().catch(function (error) {
      $("road-app").hidden = true;
      if (error.message === "signin") {
        window.location.replace("/");
      } else if (error.status === 404) {
        alertBox("That entry does not exist, or it was hidden.");
      } else {
        showError(error);
      }
    });
  }

  start();
})();
