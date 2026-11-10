/* Admin Balance tab: the grid. A table of the game's values with one cell per value that can be tapped and edited,
   in two modes:
   - Move sets: a weapon type and a style; one row per move of the type file (data/weapons/<type>.json moves[]),
     one column per attack field of the API; a first row "All moves" holds the multipliers of the type and style
     (the API's scale rows with entry and record "any").
   - Weapons: a weapon type; one row per weapon of the file, one column per melee or ranged field of the API.
   A cell maps to exactly one draft row (same kind, type, style, move or weapon, field): typing a value creates or
   updates that row, typing the game's value or nothing (or the reset button) deletes it, so the draft only holds what
   differs. "x1.05" in a cell multiplies instead of setting. Each change is saved to the draft at once (the draft is
   not live; Publish is). New rows take the session reason (asked once when empty); a row's reason can be changed in
   the Changes table. Rows the grid cannot show (any type, any style for one move, ...) stay in the Changes table and
   the form under "Other rows".
   The page part needs js/admin-balance.js (window.hvBalance, window.hvBalanceHelpers). */
(function () {
  "use strict";

  var PAGE_SIZE = 50;
  var STYLES = ["earth", "heaven", "storm", "extreme"];
  var STYLE_LETTER = { earth: "E", heaven: "H", storm: "S", extreme: "X" };

  /* ---------- pure helpers (tested under node by dev/check-admin-balance.js) ---------- */

  function nul(v) { return v === undefined || v === "" ? null : v; }

  /** The draft rows that are exactly this cell: same kind, type, style, entry, record and field. */
  function cellRows(rows, key) {
    return (rows || []).filter(function (r) {
      return r.kind === key.kind && nul(r.weaponClass) === nul(key.weaponClass) && nul(r.style) === nul(key.style)
        && nul(r.entry) === nul(key.entry) && nul(r.recordId) === nul(key.recordId) && r.field === key.field;
    });
  }

  /**
   * What the text typed in a cell means: {clear: true} (back to the game's value), {op, value}, or {error}.
   * "x1.05" (also "*1.05" or "×1.05") multiplies; in a multiplier cell (`factorOnly`) a plain number is a factor
   * and 1 is no change. A whole number sets, in the field's range; the game's own value is no change.
   */
  function parseCell(text, spec, current, factorOnly) {
    var s = String(text === undefined || text === null ? "" : text).trim().replace(/,/g, ".");
    if (s === "") return { clear: true };
    var scale = factorOnly || /^[x*×]/i.test(s);
    if (/^[x*×]/i.test(s)) s = s.slice(1).trim();
    var n = Number(s);
    if (s === "" || !isFinite(n)) return { error: "Enter a number" + (spec.scale ? ", or x1.05 to multiply." : ".") };
    if (scale) {
      if (!spec.scale) return { error: spec.name + " cannot be multiplied: set a whole number." };
      if (n <= 0 || n > 100) return { error: "A factor above 0 and at most 100, like 1.05." };
      if (Math.round(n * 10000) / 10000 !== n) return { error: "A factor has at most 4 decimals." };
      if (factorOnly && n === 1) return { clear: true };
      return { op: "scale", value: n };
    }
    if (Math.floor(n) !== n) return { error: "A whole number (or x" + s + " to multiply)." };
    if (n < spec.min || n > spec.max) return { error: spec.name + " goes from " + spec.min + " to " + spec.max + "." };
    if (typeof current === "number" && n === current) return { clear: true };
    return { op: "set", value: n };
  }

  /**
   * The API calls that make the draft match the cell: [{action: "create", body} | {action: "update", id, body} |
   * {action: "delete", id}]. `existing` = cellRows(...); the last one is the one that applies.
   */
  function planCell(existing, parsed, key, reason) {
    if (parsed.error) return [];
    if (parsed.clear) return existing.map(function (r) { return { action: "delete", id: r.id }; });
    var last = existing[existing.length - 1];
    if (!last) {
      return [{ action: "create", body: { kind: key.kind, weaponClass: nul(key.weaponClass), style: nul(key.style),
        entry: nul(key.entry), recordId: nul(key.recordId), field: key.field, op: parsed.op, value: parsed.value,
        reason: String(reason || "").trim() } }];
    }
    if (last.op === parsed.op && Number(last.value) === parsed.value) return [];
    return [{ action: "update", id: last.id, body: { kind: last.kind, weaponClass: nul(last.weaponClass), style: nul(last.style),
      entry: nul(last.entry), recordId: nul(last.recordId), field: last.field, op: parsed.op, value: parsed.value,
      reason: last.reason, position: last.position } }];
  }

  /** The text a cell's editor starts with: the row's value ("x1.05" for a multiplier), else the game's number. */
  function editText(row, current, factorOnly) {
    if (row) return row.op === "scale" && !factorOnly ? "x" + row.value : String(row.value);
    return !factorOnly && typeof current === "number" ? String(current) : "";
  }

  /**
   * What a cell shows: {text, was, own, note}. `was` is the game's value when a change replaces it (struck through);
   * `mult` is the type's multiplier row for the field, shown as an inherited result when the cell has no row.
   */
  function cellView(row, current, mult, scaled) {
    var cur = current === null || current === undefined ? null : current;
    if (row) {
      if (row.op === "scale") {
        var r = scaled(cur, Number(row.value));
        return { own: true, was: cur, text: r === null ? "x" + row.value : String(r), note: "x" + row.value };
      }
      return { own: true, was: cur, text: String(row.value), note: "" };
    }
    if (mult && typeof cur === "number") {
      return { own: false, was: cur, text: String(scaled(cur, Number(mult.value))), note: "x" + mult.value + " (all moves)" };
    }
    return { own: false, was: null, text: cur === null ? "–" : String(cur), note: "" };
  }

  /** The page `page` (from 0) of a list: {items, page, pages}; the page is kept inside the list. */
  function pageOf(list, page, size) {
    var pages = Math.max(1, Math.ceil(list.length / size));
    var p = Math.min(Math.max(0, page || 0), pages - 1);
    return { items: list.slice(p * size, p * size + size), page: p, pages: pages };
  }

  /** Whether a move with these style letters ("EHSX", "" = not known) is reached in a style (null = any). */
  function inStyle(letters, style) {
    return !style || !letters || String(letters).indexOf(STYLE_LETTER[style]) !== -1;
  }

  /** The search text matches a name (any part, any case) or is the id. */
  function matches(q, name, id, extra) {
    var s = String(q || "").trim().toLowerCase();
    if (!s) return true;
    if (/^\d+$/.test(s) && String(id) === s) return true;
    return (String(name || "") + " " + String(extra || "")).toLowerCase().indexOf(s) !== -1;
  }

  var pure = { cellRows: cellRows, parseCell: parseCell, planCell: planCell, editText: editText, cellView: cellView,
    pageOf: pageOf, inStyle: inStyle, matches: matches, PAGE_SIZE: PAGE_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = pure;
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var view = { mode: "moves", type: null, style: null, page: 0, filter: "", changedOnly: false };
  var built = null;      // the signature of the table on screen, so a reload only refreshes the cells
  var cells = [];        // {td, key, current, spec, factorOnly}
  var editing = null;    // the cell being edited
  var queue = Promise.resolve(), queued = 0;
  var asking = null;     // a change waiting for the session reason

  function C() { return window.hvBalance; }
  function H() { return window.hvBalanceHelpers; }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function types() { var d = C().state.data; return (d.index && d.index.types) || []; }
  function typeBySlug(slug) { return types().filter(function (t) { return t.slug === slug; })[0] || null; }
  function codeOf(type) { return C().classes()[type["class"]] || type.short; }
  function weaponKind(type) { return type.kind === "melee" ? "melee" : "ranged"; }
  function fieldsOf(kind) { return (C().state.overview.fields || []).filter(function (f) { return f.kind === kind; }); }

  function chip(text, pressed, onClick, short, title) {
    var b = el("button", "chip");
    b.type = "button";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    if (short) {
      b.appendChild(el("span", "bal-long", text));
      b.appendChild(el("span", "bal-short", short));
    } else b.textContent = text;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  function setView(change) {
    if (editing) closeEditor(true);
    Object.keys(change).forEach(function (k) { view[k] = change[k]; });
    render();
  }

  function renderPickers() {
    var mode = $("bal-gmode");
    clear(mode);
    mode.appendChild(chip("Move sets", view.mode === "moves", function () { setView({ mode: "moves", page: 0 }); }));
    mode.appendChild(chip("Weapons", view.mode === "weapons", function () { setView({ mode: "weapons", page: 0 }); }));
    var tl = $("bal-gtypes");
    clear(tl);
    types().forEach(function (t) {
      tl.appendChild(chip(t.name, view.type === t.slug, function () { setView({ type: t.slug, page: 0 }); }, t.short, t.name));
    });
    var sl = $("bal-gstyles");
    clear(sl);
    sl.hidden = view.mode !== "moves";
    var names = H().STYLE_NAMES;
    [null].concat(STYLES).forEach(function (s) {
      sl.appendChild(chip(s ? names[s] : "Any style", view.style === s, function () { setView({ style: s }); }));
    });
    $("bal-gfilter").placeholder = view.mode === "moves" ? "move name, entry or id" : "weapon name or id";
  }

  /* --- the lines of the table: moves or weapons, filtered and paged --- */

  function lines(type, file) {
    var out = [];
    if (view.mode === "moves") {
      var code = codeOf(type);
      (file.moves || []).forEach(function (m) {
        var ref = "k" + m.kind + " #" + m.id;
        if (!matches(view.filter, m.name, m.id, ref)) return;
        out.push({ name: m.name || ref, sub: (m.name ? ref : "") + (m.name && m.styles ? " · " : "") + (m.styles ? (m.styles === "EHSX" ? "all styles" : "styles " + H().stylesText(m.styles)) : ""),
          off: !inStyle(m.styles, view.style), ref: m.kind + ":" + m.id,
          key: function (f) { return { kind: "attack", weaponClass: code, style: view.style, entry: m.kind, recordId: m.id, field: f }; },
          current: function (f) { return H().moveValue(m, f); } });
      });
    } else {
      var kind = weaponKind(type), F = file.fields;
      var idCol = F.indexOf("id"), nameCol = F.indexOf("name"), rarCol = F.indexOf("rarity");
      (file.weapons || []).forEach(function (w) {
        if (!matches(view.filter, w[nameCol], w[idCol])) return;
        var weapon = { row: w, fields: F };
        out.push({ name: w[nameCol], sub: "#" + w[idCol] + (rarCol >= 0 ? " · rarity " + w[rarCol] : ""), off: false, ref: String(w[idCol]),
          key: function (f) { return { kind: kind, weaponClass: null, style: null, entry: null, recordId: w[idCol], field: f }; },
          current: function (f) { return H().weaponValue(weapon, f); } });
      });
    }
    if (view.changedOnly) {
      var rows = C().state.rows, fields = fieldsOf(view.mode === "moves" ? "attack" : weaponKind(type));
      out = out.filter(function (l) { return fields.some(function (f) { return cellRows(rows, l.key(f.name)).length > 0; }); });
    }
    return out;
  }

  function render() {
    var ctx = C();
    if (!ctx || !ctx.state.overview) return;
    var box = $("bal-grid-box");
    box.hidden = ctx.state.data.ok === false;
    if (box.hidden) return;
    if (!view.type || !typeBySlug(view.type)) view.type = types()[0] ? types()[0].slug : null;
    renderPickers();
    var type = typeBySlug(view.type);
    if (!type) return;
    var file = ctx.state.data.files[type.slug];
    if (!file) {
      $("bal-gcount").textContent = "Loading " + type.name + "...";
      ctx.loadFile(type).then(function () { if (ctx.state.data.files[type.slug]) render(); });
      return;
    }
    var all = lines(type, file);
    var paged = pageOf(all, view.page, PAGE_SIZE);
    view.page = paged.page;
    var kind = view.mode === "moves" ? "attack" : weaponKind(type);
    var sig = [view.mode, view.type, view.style, view.page, view.filter, view.changedOnly, all.length, ctx.state.canWrite].join("|");
    if (sig !== built) { build(type, kind, paged.items); built = sig; }
    else refresh();
    var what = view.mode === "moves" ? "moves" : "weapons";
    $("bal-gcount").textContent = all.length + " " + what + (view.filter || view.changedOnly ? " found" : "") + " (" + type.name
      + (view.mode === "moves" ? ", " + (view.style ? H().STYLE_NAMES[view.style] : "any style") : "") + ")"
      + (paged.pages > 1 ? ", page " + (paged.page + 1) + " of " + paged.pages : "") + ".";
    $("bal-gpager").hidden = paged.pages < 2;
    $("bal-gprev").disabled = paged.page === 0;
    $("bal-gnext").disabled = paged.page >= paged.pages - 1;
  }

  function build(type, kind, items) {
    var ctx = C(), fields = fieldsOf(kind);
    editing = null;
    cells = [];
    var head = $("bal-ghead"), body = $("bal-gbody");
    clear(head);
    clear(body);
    var tr = el("tr");
    tr.appendChild(el("th", "bal-gname", view.mode === "moves" ? "Move" : "Weapon"));
    fields.forEach(function (f) {
      var th = el("th", "num", f.name.replace(/_/g, " "));
      th.title = f.name + ": " + f.min + " to " + f.max + (f.scale ? ", can multiply" : ", set only");
      tr.appendChild(th);
    });
    head.appendChild(tr);
    if (view.mode === "moves") {
      var code = codeOf(type);
      var mr = el("tr", "bal-gmult");
      mr.dataset.ref = "all";
      var th0 = el("th", "bal-gname");
      th0.scope = "row";
      th0.appendChild(el("span", "bal-gtitle", "All moves"));
      th0.appendChild(el("span", "bal-gsub", "multiplier, " + (view.style ? H().STYLE_NAMES[view.style] : "any style")));
      mr.appendChild(th0);
      fields.forEach(function (f, col) {
        var td = el("td", "num bal-cell");
        mr.appendChild(td);
        if (!f.scale) { td.classList.add("is-na"); td.title = f.name + " cannot be multiplied"; return; }
        addCell(td, { kind: "attack", weaponClass: code, style: view.style, entry: null, recordId: null, field: f.name }, null, f, true, col);
      });
      body.appendChild(mr);
    }
    if (!items.length) {
      var e = el("tr"), td = el("td", "empty-cell", view.filter || view.changedOnly ? "Nothing found." : "No entries in the data.");
      td.colSpan = fields.length + 1;
      e.appendChild(td);
      body.appendChild(e);
    }
    items.forEach(function (l) {
      var row = el("tr", l.off ? "is-off" : "");
      row.dataset.ref = l.ref;
      var th = el("th", "bal-gname");
      th.scope = "row";
      th.appendChild(el("span", "bal-gtitle", l.name));
      th.appendChild(el("span", "bal-gsub", l.sub));
      if (l.off) th.title = "Not reached in this style (by the data)";
      row.appendChild(th);
      fields.forEach(function (f, col) {
        var td = el("td", "num bal-cell");
        row.appendChild(td);
        addCell(td, l.key(f.name), l.current(f.name), f, false, col);
      });
      body.appendChild(row);
    });
    refresh();
  }

  function addCell(td, key, current, spec, factorOnly, col) {
    var c = { td: td, key: key, current: current, spec: spec, factorOnly: factorOnly, col: col };
    td.dataset.col = String(col);
    td.dataset.field = key.field;
    cells.push(c);
  }

  function multFor(key) {
    if (key.kind !== "attack" || key.entry === null) return null;
    var m = cellRows(C().state.rows, { kind: "attack", weaponClass: key.weaponClass, style: key.style, entry: null, recordId: null, field: key.field });
    return m.length && m[m.length - 1].op === "scale" ? m[m.length - 1] : null;
  }

  // Redraws the cells from the draft rows, except the one being edited.
  function refresh() {
    cells.forEach(function (c) { if (c !== editing) drawCell(c); });
  }

  var problemsOf = { list: null, byRow: {} };
  function problemsFor(id) {
    var list = C().state.problems || [];
    if (problemsOf.list !== list) {
      problemsOf = { list: list, byRow: {} };
      list.forEach(function (p) { (problemsOf.byRow[p.rowId] = problemsOf.byRow[p.rowId] || []).push(p.message); });
    }
    return problemsOf.byRow[id] || [];
  }

  // A cell is only redrawn when what it shows changed, so a reload does not replace a button under a finger.
  function drawCell(c) {
    var ctx = C(), td = c.td;
    var own = cellRows(ctx.state.rows, c.key);
    var row = own[own.length - 1] || null;
    var mult = c.factorOnly ? null : multFor(c.key);
    var probs = row ? problemsFor(row.id) : [];
    var sig = JSON.stringify([row && [row.id, row.op, row.value, row.reason], mult && mult.value, probs, ctx.state.canWrite, td.classList.contains("is-failed")]);
    if (c.drawn === sig) return;
    c.drawn = sig;
    var v = cellView(row, c.factorOnly ? null : c.current, mult, H().scaled);
    if (c.factorOnly && !row) v = { own: false, was: null, text: "x1", note: "" };
    clear(td);
    td.classList.toggle("is-changed", v.own);
    td.classList.toggle("is-inherited", !v.own && !!v.note);
    td.classList.toggle("is-problem", probs.length > 0 || td.classList.contains("is-failed"));
    var label = (c.spec.name) + (v.was !== null && v.was !== undefined ? ", game " + v.was : "") + ", now " + v.text + (v.note ? " " + v.note : "");
    var shown = ctx.state.canWrite ? el("button", "bal-cell-btn") : el("span", "bal-cell-val");
    if (ctx.state.canWrite) {
      shown.type = "button";
      shown.setAttribute("aria-label", label + ". Edit");
      shown.addEventListener("click", function () { openEditor(c); });
    }
    if (v.was !== null && v.was !== undefined && String(v.was) !== v.text) shown.appendChild(el("s", "bal-was", String(v.was)));
    shown.appendChild(el("span", "bal-now", v.text));
    if (v.note && !(row && row.op === "scale" && v.text.charAt(0) === "x")) shown.appendChild(el("span", "bal-cnote", v.note));
    td.title = c.failed || (probs.length ? probs.join(" ") : row ? "Reason: " + row.reason : "");
    td.appendChild(shown);
    if (row && ctx.state.canWrite) {
      var reset = el("button", "bal-cell-reset", "↺");
      reset.type = "button";
      reset.title = "Back to the game's value";
      reset.setAttribute("aria-label", c.spec.name + ": back to the game's value");
      reset.addEventListener("click", function () { commit(c, { clear: true }); });
      td.appendChild(reset);
    }
  }

  /* --- editing --- */

  function openEditor(c) {
    if (editing && editing !== c) { if (!closeEditor(false)) return; }
    if (editing === c) return;
    editing = c;
    c.drawn = null;
    var own = cellRows(C().state.rows, c.key);
    var td = c.td;
    clear(td);
    var input = el("input", "bal-cell-input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.setAttribute("aria-label", c.spec.name + " (" + c.spec.min + " to " + c.spec.max + (c.spec.scale ? ", x1.05 multiplies" : "") + ")");
    input.value = editText(own[own.length - 1] || null, c.current, c.factorOnly);
    td.appendChild(input);
    var err = el("span", "bal-cell-err");
    err.hidden = true;
    err.setAttribute("role", "alert");
    td.appendChild(err);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      // No move while the reason is asked for: the reason box keeps the focus.
      else if (e.key === "Enter") { e.preventDefault(); if (closeEditor(false) && !asking) go(c, "down"); }
      else if (e.key === "Tab") { e.preventDefault(); if (closeEditor(false) && !asking) go(c, e.shiftKey ? "left" : "right"); }
    });
    input.addEventListener("input", function () { err.hidden = true; input.removeAttribute("aria-invalid"); });
    input.addEventListener("blur", function () { if (editing === c && !c.leaving) closeEditor(false); });
    input.focus();
    input.select();
  }

  function cancel() {
    var c = editing;
    if (!c) return;
    c.leaving = true;
    editing = null;
    drawCell(c);
    c.leaving = false;
    focusCell(c);
  }

  // Ends the edit: true when the value was taken (or dropped with `discard`), false when it is wrong (shown).
  function closeEditor(discard) {
    var c = editing;
    if (!c) return true;
    var input = c.td.querySelector("input");
    if (discard || !input) { editing = null; drawCell(c); return true; }
    var parsed = parseCell(input.value, c.spec, c.factorOnly ? null : c.current, c.factorOnly);
    if (parsed.error) {
      var err = c.td.querySelector(".bal-cell-err");
      err.textContent = parsed.error;
      err.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return false;
    }
    c.leaving = true;
    editing = null;
    drawCell(c);
    c.leaving = false;
    commit(c, parsed);
    return true;
  }

  function editable(c) { return c && c.td.querySelector(".bal-cell-btn"); }

  function go(c, dir) {
    var i = cells.indexOf(c), next = null;
    if (dir === "right" || dir === "left") {
      var step = dir === "right" ? 1 : -1;
      for (var j = i + step; j >= 0 && j < cells.length; j += step) if (editable(cells[j])) { next = cells[j]; break; }
    } else {
      var tr = c.td.parentNode.nextElementSibling;
      while (tr && !next) {
        var td = tr.querySelector('td.bal-cell[data-col="' + c.col + '"]');
        var n = td ? cells.filter(function (x) { return x.td === td; })[0] : null;
        if (editable(n)) next = n;
        tr = tr.nextElementSibling;
      }
    }
    if (next) openEditor(next);
    else focusCell(c);
  }

  function focusCell(c) { var b = c.td.querySelector(".bal-cell-btn"); if (b) b.focus(); }

  /* --- saving --- */

  function sessionReason() { return $("bal-greason").value.trim(); }

  function commit(c, parsed) {
    var plan = planCell(cellRows(C().state.rows, c.key), parsed, c.key, sessionReason());
    if (!plan.length) return;
    if (plan.some(function (p) { return p.action === "create"; }) && !sessionReason()) {
      asking = { c: c, parsed: parsed };
      $("bal-gask-reason").value = "";
      $("bal-gask-err").hidden = true;
      $("bal-gask-what").textContent = c.spec.name + " " + (parsed.op === "scale" ? "x" : "") + parsed.value;
      $("bal-gask").hidden = false;
      $("bal-gask-reason").focus();
      return;
    }
    enqueue(c, parsed);
  }

  function answerAsk(save) {
    var a = asking;
    if (!a) return;
    if (save) {
      var r = $("bal-gask-reason").value.trim();
      if (!r) { $("bal-gask-err").hidden = false; return; }
      $("bal-greason").value = r;
    }
    asking = null;
    $("bal-gask").hidden = true;
    if (save) enqueue(a.c, a.parsed);
  }

  // One change at a time, planned against the rows as they are when it runs.
  function enqueue(c, parsed) {
    var ctx = C();
    queued++;
    c.td.classList.add("is-saving");
    c.td.classList.remove("is-failed");
    c.failed = "";
    queue = queue.then(function () {
      var plan = planCell(cellRows(ctx.state.rows, c.key), parsed, c.key, sessionReason());
      return plan.reduce(function (p, step) { return p.then(function () { return send(step); }); }, Promise.resolve())
        .then(function () { if (editing !== c) drawCell(c); })
        .catch(function (e) {
          // The API's refusal stays on the cell (red edge, the message as its title) until the next change.
          ctx.fail(e);
          c.failed = e.message;
          c.td.classList.add("is-failed");
          if (editing !== c) drawCell(c);
        });
    }).then(function () {
      c.td.classList.remove("is-saving");
      if (--queued === 0) {
        return ctx.reload().then(function (good) { if (good) ctx.ok("Saved to the draft (" + ctx.state.rows.length + " rows)."); });
      }
    });
  }

  function send(step) {
    // The rows of the state when the answer comes (a reload may have replaced the list meanwhile).
    var ctx = C();
    if (step.action === "create") {
      return ctx.request("/api/admin/balance/rows", { method: "POST", body: JSON.stringify(step.body) })
        .then(function (row) { ctx.state.rows.push(row); });
    }
    if (step.action === "update") {
      return ctx.request("/api/admin/balance/rows/" + step.id, { method: "PUT", body: JSON.stringify(step.body) })
        .then(function (row) { ctx.state.rows = ctx.state.rows.map(function (r) { return r.id === step.id ? row : r; }); });
    }
    return ctx.request("/api/admin/balance/rows/" + step.id + "/delete", { method: "POST", body: "{}" })
      .then(function () { ctx.state.rows = ctx.state.rows.filter(function (r) { return r.id !== step.id; }); });
  }

  var wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    var t = null;
    $("bal-gfilter").addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { setView({ filter: $("bal-gfilter").value, page: 0 }); }, 150);
    });
    $("bal-gchanged").addEventListener("change", function () { setView({ changedOnly: $("bal-gchanged").checked, page: 0 }); });
    $("bal-gprev").addEventListener("click", function () { setView({ page: view.page - 1 }); });
    $("bal-gnext").addEventListener("click", function () { setView({ page: view.page + 1 }); });
    $("bal-gask-yes").addEventListener("click", function () { answerAsk(true); });
    $("bal-gask-no").addEventListener("click", function () { answerAsk(false); });
    $("bal-gask-reason").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); answerAsk(true); }
      if (e.key === "Escape") { e.preventDefault(); answerAsk(false); }
    });
  }

  /** Called by admin-balance.js after every load: builds the table once, then only redraws the cells. */
  window.hvBalanceGrid = {
    render: function () { wire(); render(); },
    busy: function () { return queued > 0 || !!editing; }
  };
})();
