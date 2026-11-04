/* Admin: the event content editors (Content tab). Festival trials and prizes, Diva rewards, bonus quests and coin
   shop, Speedrun Cup and VS Bracket quests and prizes, campaigns, Sky Corridor rewards, event quests, gachas and
   shops: rows of the game server's own tables, through the API's /api/admin/content. The API sends each table's
   columns, limits and notes (GET /api/admin/content), so this page builds its lists and forms from them and
   holds no rule of its own; the API checks every change and answers with reasons, shown under the form.
   Item names come from the site's own item list (/data/item-ids.json), the list the API checks ids against.
   Times are UTC. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  /* ---------- pure helpers (tested under node by dev/check-admin-content.js) ---------- */

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** "2026-11-23 03:00" in UTC; "" for nothing. */
  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "";
    var d = new Date(t);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + " "
      + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  /** A datetime-local value read as UTC, as ISO; null when empty. */
  function fromInput(value) {
    if (!value) return null;
    var t = Date.parse(value + (value.length === 16 ? ":00" : "") + "Z");
    return isNaN(t) ? null : new Date(t).toISOString().replace(".000Z", "Z");
  }

  function toInput(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 16);
  }

  /**
   * The request body from the form's raw values (strings, and booleans for checkboxes): numbers become numbers,
   * an empty field is left out (the API then uses the column's default, or says it is required), times are
   * read as UTC. Fields the API sets itself (the fixed ones) are never in the spec's list.
   */
  function body(fields, raw) {
    var out = {};
    fields.forEach(function (f) {
      var v = raw[f.name];
      if (f.type === "bool") { out[f.name] = !!v; return; }
      if (v === undefined || v === null || String(v).trim() === "") {
        if (f.type === "text" && !f.nullable && f.dflt === null) out[f.name] = "";
        return;
      }
      if (f.type === "int") out[f.name] = /^-?\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : String(v);
      else if (f.type === "time") out[f.name] = fromInput(String(v));
      else out[f.name] = String(v);
    });
    return out;
  }

  /**
   * Items whose name holds q (any case), names that start with it first, or the item whose number is q. At most
   * limit. items: the site's item list ({"7": "Potion", ...}).
   */
  function searchItems(items, q, limit) {
    var needle = String(q || "").trim().toLowerCase();
    if (!needle) return [];
    if (/^\d+$/.test(needle)) return items[needle] && needle !== "0" ? [{ id: Number(needle), name: items[needle] }] : [];
    var starts = [], has = [];
    Object.keys(items).forEach(function (id) {
      var name = items[id];
      if (id === "0" || !name) return;
      var at = name.toLowerCase().indexOf(needle);
      if (at === 0) starts.push({ id: Number(id), name: name });
      else if (at > 0) has.push({ id: Number(id), name: name });
    });
    var byName = function (a, b) { return a.name.length - b.name.length || a.id - b.id; };
    return starts.sort(byName).concat(has.sort(byName)).slice(0, limit || 8);
  }

  /** A row's value as the list shows it: names next to their numbers, yes/no, UTC times. */
  function cell(field, row) {
    var v = row[field.name];
    if (v === null || v === undefined) return field.nullable ? "-" : "";
    if (field.type === "bool") return v ? "yes" : "no";
    if (field.type === "time") return utc(v);
    var label = row._labels && row._labels[field.name];
    return label ? label + " (" + v + ")" : String(v);
  }

  /** The prizes' shares in a gacha (weight / total of every row's weight, as Erupe sends them), by row id. */
  function shares(rows) {
    var total = 0;
    rows.forEach(function (r) { total += Number(r.weight) || 0; });
    var out = {};
    rows.forEach(function (r) {
      if (r.entry_type === 100) out[r.id] = total > 0 ? Math.round((Number(r.weight) || 0) * 10000 / total) / 100 : 0;
    });
    return out;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { utc: utc, fromInput: fromInput, toInput: toInput, body: body, searchItems: searchItems,
      cell: cell, shares: shares };
  }
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var started = false;
  var specs = null;
  var items = null;   // the site's item list, loaded once
  var state = { table: null, filters: {}, rows: [], editing: null, lock: null, armed: null, trail: [] };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

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

  // A refusal throws with the API's message and its whole answer (the problems).
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("Sign in again: your session has ended.");
        if (r.status === 403) throw new Error("Only admin accounts can change event content.");
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var error = new Error((data && data.message) || "HTTP " + r.status);
            error.data = data;
            throw error;
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

  function list(id, bad, good) {
    var box = $(id);
    clear(box);
    (bad || []).forEach(function (t) { box.appendChild(el("li", null, t)); });
    (good || []).forEach(function (t) { box.appendChild(el("li", "is-ok", t)); });
    box.hidden = !box.firstChild;
  }

  function loadItems() {
    if (items) return Promise.resolve(items);
    return fetch("/data/item-ids.json").then(function (r) { return r.json(); })
      .then(function (data) { items = data; return items; })
      .catch(function () { items = {}; return items; });
  }

  function tableSpec(key) {
    var found = null;
    (specs ? specs.groups : []).forEach(function (g) {
      g.tables.forEach(function (t) { if (t.key === key) found = t; });
    });
    return found;
  }

  /* ---- the group and table pickers ---- */

  function renderNav() {
    var nav = $("content-groups");
    clear(nav);
    specs.groups.forEach(function (g) {
      var b = el("button", "chip", g.title);
      b.type = "button";
      b.setAttribute("data-group", g.key);
      b.addEventListener("click", function () { open(g.tables[0].key, {}, []); });
      nav.appendChild(b);
    });
  }

  function renderTabs() {
    var t = state.table;
    Array.prototype.forEach.call($("content-groups").children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-group") === t.group ? "true" : "false");
    });
    var sub = $("content-tables");
    clear(sub);
    var group = specs.groups.filter(function (g) { return g.key === t.group; })[0];
    group.tables.forEach(function (x) {
      if (x.parent) return; // reached from its parent's rows
      var b = el("button", "chip", x.title);
      b.type = "button";
      b.setAttribute("aria-pressed", x.key === t.key || state.trail.some(function (s) { return s.key === x.key; }) ? "true" : "false");
      b.addEventListener("click", function () { open(x.key, {}, []); });
      sub.appendChild(b);
    });
    // The way back from a child list (a campaign's items, a gacha's rows, a prize's items).
    var back = $("content-trail");
    clear(back);
    state.trail.forEach(function (s) {
      var b = el("button", "link-btn", "Back to " + s.label);
      b.type = "button";
      b.addEventListener("click", function () {
        var at = state.trail.indexOf(s);
        open(s.key, s.filters, state.trail.slice(0, at));
      });
      back.appendChild(b);
    });
    back.hidden = !state.trail.length;
  }

  /** Opens a table; {@code filters} for a child list (campaign_id, gacha_id, entry_id) or a shop. */
  function open(key, filters, trail) {
    state.table = tableSpec(key);
    state.filters = filters || {};
    state.trail = trail || [];
    state.editing = null;
    state.armed = null;
    say("content-alert", "");
    say("content-ok", "");
    list("content-problems", []);
    renderTabs();
    $("content-title").textContent = state.table.title + (state.trail.length ? " of " + state.trail[state.trail.length - 1].label : "");
    $("content-effect").textContent = state.table.effect;
    renderFilters();
    renderForm(null);
    return load();
  }

  function renderFilters() {
    var box = $("content-filters");
    clear(box);
    var t = state.table;
    var free = t.filters.filter(function (f) { return f !== t.parent; });
    free.forEach(function (name) {
      var f = t.fields.filter(function (x) { return x.name === name; })[0];
      var wrap = el("div", "field");
      var label = el("label", null, (f ? f.label : name) + " ");
      var input = el("input");
      input.type = "number";
      input.id = "content-filter-" + name;
      input.value = state.filters[name] !== undefined ? state.filters[name] : "";
      input.addEventListener("change", function () {
        if (input.value === "") delete state.filters[name]; else state.filters[name] = Number(input.value);
        load();
      });
      label.htmlFor = input.id;
      wrap.appendChild(label);
      wrap.appendChild(input);
      box.appendChild(wrap);
    });
    box.hidden = !free.length;
  }

  /* ---- the list ---- */

  function load() {
    var t = state.table;
    var q = Object.keys(state.filters).map(function (k) { return k + "=" + encodeURIComponent(state.filters[k]); }).join("&");
    clear($("content-rows"));
    return request("/api/admin/content/" + t.key + (q ? "?" + q : "")).then(function (res) {
      if (state.table !== t) return;
      state.rows = res.rows || [];
      state.lock = res.lock || null;
      say("content-lock", state.lock ? "Locked: " + state.lock : (res.tableReady === false
        ? "This table is not in the game database yet (it comes with a game server release)." : ""));
      var count = res.count !== undefined ? res.count + " row" + (res.count === 1 ? "" : "s") : "";
      if (res.maxRows) count += " of at most " + res.maxRows;
      if (res.listed !== undefined) count = res.listed + " listed of at most " + res.listedMax
        + " (the game lists 512; the Speedrun Cup adds 2 and the VS Bracket 1)";
      $("content-count").textContent = count;
      if (res.disabledTableMissing) say("content-alert", "Disabling event quests needs db/content-editors.sql on the database (API README).");
      renderRows();
      $("content-save").disabled = !!state.lock;
    }).catch(function (e) {
      say("content-alert", e.message);
      state.rows = [];
      renderRows();
    });
  }

  function columns() {
    var t = state.table;
    return t.fields.filter(function (f) { return f.name !== t.parent; });
  }

  function renderRows() {
    var t = state.table;
    var head = $("content-head");
    clear(head);
    var tr = el("tr");
    tr.appendChild(el("th", null, "#"));
    columns().forEach(function (f) { if (f.name !== t.id || t.idGiven) tr.appendChild(el("th", null, f.label)); });
    if (t.key === "gacha-entries") tr.appendChild(el("th", null, "Share"));
    if (t.key === "gachas") tr.appendChild(el("th", null, "Check"));
    tr.appendChild(el("th", null, ""));
    head.appendChild(tr);

    var body = $("content-rows");
    clear(body);
    var share = t.key === "gacha-entries" ? shares(state.rows.filter(function (r) { return !r._disabled; })) : {};
    if (!state.rows.length) {
      var empty = el("tr");
      var td = el("td", "empty-cell", "No rows.");
      td.colSpan = columns().length + 3;
      empty.appendChild(td);
      body.appendChild(empty);
    }
    state.rows.forEach(function (r) {
      var row = el("tr", r._disabled ? "is-disabled" : null);
      row.appendChild(el("td", null, String(r[t.id])));
      columns().forEach(function (f) { if (f.name !== t.id || t.idGiven) row.appendChild(el("td", null, cell(f, r))); });
      if (t.key === "gacha-entries") row.appendChild(el("td", null, r.entry_type === 100 ? share[r.id] + " %" : ""));
      if (t.key === "gachas") {
        var p = r._problems || [];
        row.appendChild(el("td", p.length ? "content-bad" : null, p.length ? p.join("; ") : "OK"));
      }
      var actions = el("td");
      var box = el("div", "cal-actions");
      if (r._disabled) {
        box.appendChild(el("span", "note-text", "Disabled by " + r._disabledBy + " " + utc(r._disabledAt)));
        box.appendChild(action("Enable", function () { act("/api/admin/content/event-quests/" + r.id + "/enable", "Enabled"); }));
        box.appendChild(confirmAction("Delete", "disabled-" + r.id, function () {
          act("/api/admin/content/event-quests/disabled/" + r.id + "/delete", "Deleted");
        }));
      } else {
        if (!state.lock) {
          box.appendChild(action("Edit", function () { renderForm(r); }));
          box.appendChild(confirmAction("Delete", r[t.id], function () {
            act("/api/admin/content/" + t.key + "/" + r[t.id] + "/delete", "Deleted");
          }));
        }
        if (t.key === "event-quests") {
          box.appendChild(action("Disable", function () { act("/api/admin/content/event-quests/" + r.id + "/disable", "Disabled"); }));
        }
        childLinks(t, r).forEach(function (b) { box.appendChild(b); });
      }
      actions.appendChild(box);
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  /** Buttons to a row's own rows: a campaign's items, a gacha's costs and prizes, a prize's items. */
  function childLinks(t, r) {
    var out = [];
    var child = function (label, key, column, name) {
      out.push(action(label, function () {
        var f = {};
        f[column] = r.id;
        var trail = state.trail.concat([{ key: t.key, filters: state.filters, label: name }]);
        open(key, f, trail);
      }));
    };
    if (t.key === "campaigns") child("Items", "campaign-items", "campaign_id", "campaign " + r.id + " (" + r.title + ")");
    if (t.key === "gachas") {
      child("Costs and prizes", "gacha-entries", "gacha_id", "gacha " + r.id + " (" + r.name + ")");
      out.push(action("Check", function () {
        request("/api/admin/content/gachas/" + r.id + "/check").then(function (c) {
          list("content-problems", c.problems, c.ok ? ["Gacha " + r.id + " passes the check: it can be shown."] : []);
        }).catch(function (e) { say("content-alert", e.message); });
      }));
    }
    // A prize's items, or a cost row's guaranteed items (step-ups).
    if (t.key === "gacha-entries") child("Items", "gacha-items", "entry_id", "row " + r.id);
    return out;
  }

  function action(label, fn) {
    var b = el("button", "ghost-btn small", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  /** A button that acts on its second click only (the first says what it will do). */
  function confirmAction(label, key, fn) {
    var b = action(state.armed === key ? "Click again to " + label.toLowerCase() : label, function () {
      if (state.armed === key) { state.armed = null; fn(); return; }
      state.armed = key;
      renderRows();
    });
    if (state.armed === key) b.classList.add("is-armed");
    return b;
  }

  function act(path, done) {
    say("content-alert", "");
    request(path, { method: "POST" }).then(function (res) {
      say("content-ok", done + ": " + state.table.title + " #" + res.id + ".");
      list("content-problems", [], res.warnings || []);
      return load();
    }).catch(function (e) {
      list("content-problems", (e.data && e.data.problems) || [e.message]);
    });
  }

  /* ---- the form ---- */

  function renderForm(row) {
    var t = state.table;
    state.editing = row;
    $("content-form-title").textContent = row ? "Change #" + row[t.id] : "Add a row";
    $("content-save").textContent = row ? "Save the changes" : "Add";
    $("content-reset").hidden = !row;
    var grid = $("content-fields");
    clear(grid);
    t.fields.forEach(function (f) {
      var wrap = el("div", "field");
      var id = "content-f-" + f.name;
      var label = el("label", null, f.label + " ");
      label.htmlFor = id;
      if (f.nullable) label.appendChild(el("span", "field-optional", "optional"));
      var input;
      var value = row ? row[f.name] : (t.parent === f.name ? state.filters[f.name] : f.dflt);
      if (f.type === "bool") {
        input = el("input");
        input.type = "checkbox";
        input.checked = value === true;
        wrap.classList.add("content-bool");
      } else if (f.type === "choice") {
        input = el("select");
        f.choices.forEach(function (c) {
          var o = el("option", null, c);
          o.value = c;
          input.appendChild(o);
        });
        if (value) input.value = value;
      } else {
        input = el("input");
        input.type = f.type === "int" ? "number" : f.type === "time" ? "datetime-local" : "text";
        if (f.type === "int") {
          if (f.min !== null) input.min = f.min;
          if (f.max !== null) input.max = f.max;
        }
        input.value = value === null || value === undefined ? "" : f.type === "time" ? toInput(value) : value;
      }
      input.id = id;
      input.setAttribute("data-name", f.name);
      if (t.parent === f.name) input.readOnly = true;
      wrap.appendChild(label);
      wrap.appendChild(input);
      if (f.names === "item" || f.names === "item_if_type7") picker(wrap, input, f, row, searchLocal);
      if (f.names === "quest") picker(wrap, input, f, row, searchQuests);
      var help = [f.help, f.type === "time" ? "UTC" : null, f.maxBytes ? "at most " + f.maxBytes + " bytes in the game (a Japanese character takes 2)" : null]
        .filter(Boolean).join(" ");
      if (help) wrap.appendChild(el("p", "note-text", help));
      grid.appendChild(wrap);
    });
    list("content-problems", []);
    if (row) $("content-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function searchLocal(q) {
    return loadItems().then(function (all) {
      return searchItems(all, q, 8).map(function (i) { return { id: i.id, name: i.name }; });
    });
  }

  function searchQuests(q) {
    return request("/api/admin/content/quest-search?q=" + encodeURIComponent(q)).then(function (hits) {
      return hits.map(function (h) { return { id: h.id, name: h.name + (h.category ? " (" + h.category + ")" : "") }; });
    });
  }

  /** Search by name under a number field; picking a hit writes its number. The name shows below. */
  function picker(wrap, input, f, row, search) {
    wrap.classList.add("content-pick");
    var find = el("input", "content-search");
    find.type = "search";
    find.placeholder = "Search by name";
    find.setAttribute("aria-label", f.label + ": search by name");
    var name = el("p", "note-text content-name", row && row._labels && row._labels[f.name] ? row._labels[f.name] : "");
    var suggest = el("ul", "admin-suggest");
    suggest.hidden = true;
    wrap.appendChild(find);
    wrap.appendChild(suggest);
    wrap.appendChild(name);
    var timer = null, seq = 0;
    find.addEventListener("input", function () {
      clearTimeout(timer);
      var q = find.value.trim();
      if (q.length < 2) { suggest.hidden = true; return; }
      timer = setTimeout(function () {
        var mine = ++seq;
        search(q).then(function (hits) {
          if (mine !== seq) return;
          clear(suggest);
          hits.forEach(function (h) {
            var li = el("li");
            var b = el("button", null, h.name + " (" + h.id + ")");
            b.type = "button";
            b.addEventListener("click", function () {
              input.value = String(h.id);
              name.textContent = h.name;
              find.value = "";
              suggest.hidden = true;
            });
            li.appendChild(b);
            suggest.appendChild(li);
          });
          suggest.hidden = !suggest.firstChild;
        }).catch(function () { suggest.hidden = true; });
      }, 200);
    });
    input.addEventListener("input", function () {
      if (f.names === "quest") { name.textContent = ""; return; }
      loadItems().then(function (all) { name.textContent = all[input.value] && input.value !== "0" ? all[input.value] : ""; });
    });
  }

  function save(event) {
    event.preventDefault();
    var t = state.table;
    say("content-alert", "");
    say("content-ok", "");
    var raw = {};
    Array.prototype.forEach.call($("content-fields").querySelectorAll("[data-name]"), function (input) {
      raw[input.getAttribute("data-name")] = input.type === "checkbox" ? input.checked : input.value;
    });
    var row = state.editing;
    var path = "/api/admin/content/" + t.key + (row ? "/" + row[t.id] : "");
    $("content-save").disabled = true;
    request(path, { method: row ? "PUT" : "POST", body: JSON.stringify(body(t.fields, raw)) }).then(function (res) {
      renderForm(null); // first: it clears the form's messages
      say("content-ok", (row ? "Saved" : "Added") + ": " + t.title + " #" + res.id + ". " + t.effect);
      list("content-problems", [], res.warnings || []);
      return load();
    }).catch(function (e) {
      list("content-problems", (e.data && e.data.problems) || [e.message]);
    }).then(function () { $("content-save").disabled = !!state.lock; });
  }

  function wire() {
    $("content-form").addEventListener("submit", save);
    $("content-reset").addEventListener("click", function () { renderForm(null); });
    $("content-refresh").addEventListener("click", load);
  }

  window.startAdminContent = function () {
    if (started) {
      if (state.table) load();
      return;
    }
    started = true;
    wire();
    request("/api/admin/content").then(function (s) {
      specs = s;
      $("content-note").textContent = s.restart || "";
      renderNav();
      return open(s.groups[0].tables[0].key, {}, []);
    }).catch(function (e) {
      started = false;
      say("content-alert", e.message);
    });
  };
})();
