/* Admin: the event calendar (Events tab). The runs of the Hunter Festival, Diva Defense, the Speedrun Cup and
   the VS Bracket come from the API's /api/admin/events/calendar, which reads Erupe's event_calendar table; the
   game server reads the same table every minute and writes each run's status and phases back. This page never
   computes phases: it shows Erupe's. The API checks every change (the same rules as the game server and the
   table) and answers with reasons, which the form shows while you type. All times here are UTC, because every
   boundary of the rotation is a Monday 03:00 UTC. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var DAY = 86400000;
  var WEEKS = 12;

  var EVENTS = ["festa", "vs_bracket", "diva", "speedrun_cup"];
  var NAMES = { festa: "Hunter Festival", vs_bracket: "VS Bracket", diva: "Diva Defense", speedrun_cup: "Speedrun Cup" };
  // The settings of each event, as Erupe needs them (all of them), with the form's labels.
  var FIELDS = {
    festa: [["entry_hours", "Entry (hours)"], ["souls_hours", "Souls (hours)"], ["judging_hours", "Judging (hours)"], ["rewards_hours", "Rewards (hours)"]],
    diva: [],
    speedrun_cup: [["first_cycle", "First cycle"], ["cycles", "Cycles"], ["cycle_days", "Cycle (days)"], ["open_days", "Open (days)"], ["tally_hours", "Tally (hours)"]],
    vs_bracket: [["first_cycle", "First cycle"], ["cycles", "Cycles"], ["cycle_days", "Cycle (days)"], ["registration_days", "Sign-up (days)"], ["round_days", "Round (days)"], ["max_rounds", "Rounds (1-6)"]]
  };
  var STATUS = { planned: "Planned", running: "Running", settling: "Settling", done: "Done", cancelled: "Cancelled" };

  /* ---------- pure helpers (tested under node by dev/check-admin-events.js) ---------- */

  function ms(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? null : t;
  }

  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** "Mon 23 Nov 2026 03:00" in UTC; "-" for nothing. */
  function utc(iso) {
    var t = ms(iso);
    if (t === null) return "-";
    var d = new Date(t);
    return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MO[d.getUTCMonth()] + " " + d.getUTCFullYear() + " "
      + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  /** An ISO time as a datetime-local value in UTC ("2026-11-23T03:00"). */
  function toInput(iso) {
    var t = ms(iso);
    return t === null ? "" : new Date(t).toISOString().slice(0, 16);
  }

  /** A datetime-local value read as UTC, as ISO; null when empty. */
  function fromInput(value) {
    if (!value) return null;
    var t = Date.parse(value + (value.length === 16 ? ":00" : "") + "Z");
    return isNaN(t) ? null : new Date(t).toISOString().replace(".000Z", "Z");
  }

  /** The Monday 03:00 UTC at or before t (the rotation's boundary). */
  function weekStart(t) {
    var d = new Date(t);
    var base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0);
    var back = (d.getUTCDay() + 6) % 7; // days since Monday
    var start = base - back * DAY;
    return start > t ? start - 7 * DAY : start;
  }

  /**
   * The strip's geometry: weeks from the Monday before now, a bar per run in [from, to) with the core and the
   * tail as percents, and the now line. Background runs get their own lane.
   */
  function timeline(runs, now, weeks) {
    var from = weekStart(now), to = from + weeks * 7 * DAY, span = to - from;
    function pct(t) { return Math.max(0, Math.min(100, (t - from) / span * 100)); }
    var ticks = [];
    for (var w = 0; w < weeks; w++) {
      var t = from + w * 7 * DAY, d = new Date(t);
      ticks.push({ left: pct(t), label: d.getUTCDate() + " " + MO[d.getUTCMonth()] });
    }
    var bars = [];
    (runs || []).slice().sort(function (a, b) { return ms(a.startsAt) - ms(b.startsAt); }).forEach(function (r) {
      var s = ms(r.startsAt), c = ms(r.coreEndsAt), e = ms(r.endsAt);
      if (s === null || e === null || e <= from || s >= to || r.status === "cancelled") return;
      bars.push({ id: r.id, event: r.event, name: r.name || NAMES[r.event] || r.event,
        lane: r.lane === "background" ? "background" : "featured", status: r.status,
        left: pct(s), core: pct(c) - pct(s), tail: pct(e) - pct(c) });
    });
    // Runs that overlap in one lane (a tail beside the next core, the transition's background runs) get
    // their own row, so no bar hides another.
    var ends = { featured: [], background: [] };
    bars.forEach(function (b) {
      var rows = ends[b.lane], i = 0;
      while (i < rows.length && rows[i] > b.left + 1e-9) i++;
      rows[i] = b.left + b.core + b.tail;
      b.row = i;
    });
    return { from: from, to: to, ticks: ticks, bars: bars, now: pct(now),
      rows: { featured: Math.max(1, ends.featured.length), background: Math.max(1, ends.background.length) } };
  }

  /** What changes in the next 7 days: starts, core ends and ends, by time. */
  function soon(runs, now) {
    var out = [];
    (runs || []).forEach(function (r) {
      if (r.status === "cancelled") return;
      var name = r.name || NAMES[r.event] || r.event;
      [["startsAt", "starts"], ["coreEndsAt", "core ends (the next event may start)"], ["endsAt", "ends"]].forEach(function (k) {
        var t = ms(r[k[0]]);
        if (t === null || t <= now || t > now + 7 * DAY) return;
        if (k[0] === "coreEndsAt" && r.coreEndsAt === r.endsAt) return; // said once by "ends"
        out.push({ t: t, text: utc(r[k[0]]) + ": " + name + " #" + r.id + " " + k[1] });
      });
    });
    return out.sort(function (a, b) { return a.t - b.t; }).map(function (x) { return x.text; });
  }

  /** The request body of the form's values. Numbers stay numbers; an empty first cycle is left to the API. */
  function body(values) {
    var settings = {};
    (FIELDS[values.event] || []).forEach(function (f) {
      var v = values.settings[f[0]];
      if (v === "" || v === undefined || v === null) return;
      settings[f[0]] = Number(v);
    });
    return { event: values.event, lane: values.lane, startsAt: fromInput(values.start), coreEndsAt: fromInput(values.core),
      settings: settings, note: values.note || null, allowAnyTime: !!values.anyTime };
  }

  /** The phases Erupe wrote, as lines; null when it has not yet. */
  function phaseLines(run) {
    if (!Array.isArray(run.phases)) return null;
    return run.phases.map(function (p) {
      var extra = [];
      Object.keys(p).forEach(function (k) {
        if (k === "name" || k === "starts_at" || k === "ends_at") return;
        var v = p[k];
        extra.push(k.replace(/_/g, " ") + " " + (typeof v === "string" && ms(v) !== null ? utc(v) : v));
      });
      return p.name + ": " + utc(p.starts_at) + " to " + utc(p.ends_at) + (extra.length ? " (" + extra.join(", ") + ")" : "");
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { utc: utc, toInput: toInput, fromInput: fromInput, weekStart: weekStart, timeline: timeline,
      soon: soon, body: body, phaseLines: phaseLines };
  }
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var started = false;
  var rules = null;
  var state = { runs: [], now: Date.now(), editing: null, checkTimer: null, checkSeq: 0, generated: null };

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

  // Like admin.js's: a refusal throws with the API's message and the whole answer (problems, preview).
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("Sign in again: your session has ended.");
        if (r.status === 403) throw new Error("Only admin accounts can change the calendar.");
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

  function list(id, items, okItems) {
    var ul = $(id);
    clear(ul);
    (items || []).forEach(function (t) { ul.appendChild(el("li", null, t)); });
    (okItems || []).forEach(function (t) { ul.appendChild(el("li", "is-ok", t)); });
    ul.hidden = !ul.firstChild;
  }

  /* ---- loading ---- */

  function load() {
    var q = $("cal-cancelled").checked ? "?cancelled=true" : "";
    return request("/api/admin/events/calendar" + q).then(function (cal) {
      state.runs = cal.runs || [];
      state.now = ms(cal.now) || Date.now();
      say("cal-alert", cal.tableReady ? "" : "The event_calendar table is not in the database yet: apply Erupe's "
        + "schemas/hvmhfz/2026-11-event-calendar.sql (and a seed) first. Until then nothing here can be saved.");
      $("cal-note").textContent = state.runs.length + (state.runs.length === 1 ? " run" : " runs") + " shown";
      list("cal-warnings", cal.warnings);
      if (cal.loopNext && !$("cal-gen-from").value) {
        $("cal-gen-from").value = cal.loopNext.from;
        $("cal-gen-first").value = cal.loopNext.first;
      }
      $("cal-always").textContent = "Always on, not in the calendar: " + (cal.alwaysOn || []).join(", ") + ".";
      renderStrip();
      renderSoon();
      renderRows();
    }).catch(function (e) { say("cal-alert", e.message); });
  }

  /* ---- the strip ---- */

  function renderStrip() {
    var g = timeline(state.runs, state.now, WEEKS);
    var outer = $("cal-strip");
    clear(outer);
    var strip = el("div", "cal-body");
    outer.appendChild(strip);
    var head = el("div", "cal-ticks");
    g.ticks.forEach(function (t) {
      var tick = el("span", "cal-tick", t.label);
      tick.style.left = t.left + "%";
      head.appendChild(tick);
    });
    strip.appendChild(head);
    ["featured", "background"].forEach(function (lane) {
      var row = el("div", "cal-lane");
      row.style.height = (g.rows[lane] * 34) + "px";
      row.appendChild(el("span", "cal-lane-name", lane === "featured" ? "Featured" : "Background"));
      g.bars.filter(function (b) { return b.lane === lane; }).forEach(function (b) {
        var bar = el("button", "cal-bar cal-" + b.event);
        bar.type = "button";
        bar.style.left = b.left + "%";
        bar.style.top = (2 + b.row * 34) + "px";
        bar.style.width = (b.core + b.tail) + "%";
        bar.title = b.name + " #" + b.id + " (" + (STATUS[b.status] || b.status) + ")";
        var core = el("span", "cal-core", b.name);
        core.style.width = (b.core + b.tail > 0 ? b.core / (b.core + b.tail) * 100 : 100) + "%";
        bar.appendChild(core);
        bar.addEventListener("click", function () { showDetail(b.id); });
        row.appendChild(bar);
      });
      strip.appendChild(row);
    });
    var now = el("span", "cal-now");
    now.style.left = g.now + "%";
    now.title = "Now";
    strip.appendChild(now);
  }

  function renderSoon() {
    var ul = $("cal-soon");
    clear(ul);
    var items = soon(state.runs, state.now);
    if (!items.length) items = ["Nothing starts or ends."];
    items.forEach(function (t) { ul.appendChild(el("li", null, t)); });
  }

  function find(id) {
    for (var i = 0; i < state.runs.length; i++) if (state.runs[i].id === id) return state.runs[i];
    return null;
  }

  function showDetail(id) {
    var r = find(id), box = $("cal-detail");
    clear(box);
    if (!r) { box.hidden = true; return; }
    box.appendChild(el("h3", "subhead", r.name + " #" + r.id));
    var meta = el("p", "note-text");
    meta.appendChild(el("span", "badge" + (r.status === "running" ? " good" : ""), STATUS[r.status] || r.status));
    meta.appendChild(document.createTextNode(" " + (r.lane === "background" ? "Background" : "Featured") + ". Starts "
      + utc(r.startsAt) + ", core to " + utc(r.coreEndsAt) + ", ends " + utc(r.endsAt) + "."));
    box.appendChild(meta);
    var keys = Object.keys(r.settings || {});
    if (keys.length) {
      box.appendChild(el("p", "note-text", "Settings: " + keys.map(function (k) { return k + " " + r.settings[k]; }).join(", ") + "."));
    }
    var lines = phaseLines(r);
    if (!lines) {
      box.appendChild(el("p", "note-text", "Waiting for the game server: Erupe writes this run's phases within a minute once it reads it (config EventCalendar on)."));
    } else {
      var ul = el("ul", "cal-phases");
      lines.forEach(function (t) { ul.appendChild(el("li", null, t)); });
      box.appendChild(ul);
    }
    if (r.note) box.appendChild(el("p", "note-text", "Note: " + r.note));
    box.appendChild(el("p", "note-text muted", "Added by " + (r.createdBy || "a script") + (r.updatedBy ? ", last changed by " + r.updatedBy : "") + "."));
    box.hidden = false;
  }

  /* ---- the list ---- */

  // Two clicks for anything that changes the calendar at once.
  function confirmButton(label, confirmLabel, action) {
    var b = el("button", "ghost-btn small", label);
    b.type = "button";
    var armed = false, timer = null;
    b.addEventListener("click", function () {
      if (!armed) {
        armed = true;
        b.textContent = confirmLabel;
        timer = setTimeout(function () { armed = false; b.textContent = label; }, 5000);
        return;
      }
      clearTimeout(timer);
      b.disabled = true;
      action().then(function () { b.disabled = false; }, function () { b.disabled = false; });
    });
    return b;
  }

  function act(path, okText) {
    say("cal-alert", "");
    return request(path, { method: "POST" }).then(function () {
      say("cal-ok", okText);
      return load();
    }).catch(function (e) { say("cal-alert", e.message); });
  }

  function renderRows() {
    var body = $("cal-rows");
    clear(body);
    if (!state.runs.length) {
      var tr = el("tr"), td = el("td", "empty-cell", "No runs. Add one below, or extend the loop.");
      td.colSpan = 9;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    state.runs.forEach(function (r) {
      var tr = el("tr", r.status === "cancelled" || r.status === "done" ? "is-ended" : null);
      tr.appendChild(el("td", "rank", String(r.id)));
      var name = el("td", "cell-name");
      var link = el("button", "link-btn", r.name);
      link.type = "button";
      link.addEventListener("click", function () { showDetail(r.id); });
      name.appendChild(link);
      tr.appendChild(name);
      tr.appendChild(el("td", null, r.lane));
      tr.appendChild(el("td", null, utc(r.startsAt)));
      tr.appendChild(el("td", null, utc(r.coreEndsAt)));
      tr.appendChild(el("td", null, utc(r.endsAt)));
      var st = el("td");
      st.appendChild(el("span", "badge" + (r.status === "running" ? " good" : ""), STATUS[r.status] || r.status));
      if (!Array.isArray(r.phases) && r.status !== "cancelled") st.appendChild(el("span", "admin-desc", "waiting for the game server"));
      tr.appendChild(st);
      tr.appendChild(el("td", "cell-sub muted", r.note || "-"));
      var actions = el("td", "cal-actions");
      if (r.editable) {
        var edit = el("button", "ghost-btn small", "Edit");
        edit.type = "button";
        edit.addEventListener("click", function () { startEdit(r); });
        actions.appendChild(edit);
        actions.appendChild(confirmButton("Delete", "Confirm delete #" + r.id, function () {
          return act("/api/admin/events/calendar/" + r.id + "/cancel", "Run #" + r.id + " is cancelled; the game server drops it within a minute.");
        }));
      } else if (r.status !== "cancelled") {
        var note = el("button", "ghost-btn small", "Edit note");
        note.type = "button";
        note.addEventListener("click", function () { editNote(r); });
        actions.appendChild(note);
        var cycled = r.event === "speedrun_cup" || r.event === "vs_bracket";
        if (cycled && r.started && ms(r.endsAt) > state.now && r.settings && r.settings.cycles > 1) {
          actions.appendChild(confirmButton("Stop after current cycle", "Confirm stop #" + r.id, function () {
            return act("/api/admin/events/calendar/" + r.id + "/stop-after-current", "Run #" + r.id + " ends with its current cycle.");
          }));
        }
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
  }

  function editNote(r) {
    var note = window.prompt("Note for " + r.name + " #" + r.id + " (it has started: only the note can change)", r.note || "");
    if (note === null) return;
    request("/api/admin/events/calendar/" + r.id, { method: "PUT", body: JSON.stringify({ note: note }) })
      .then(function () { say("cal-ok", "Note saved."); return load(); })
      .catch(function (e) { say("cal-alert", e.message); });
  }

  /* ---- the form ---- */

  function loopSettings(event) {
    var e = rules && (rules.events || []).filter(function (x) { return x.event === event; })[0];
    return (e && e.loopSettings) || {};
  }

  function renderSettings(event, values) {
    var box = $("cal-settings");
    clear(box);
    var defaults = values || loopSettings(event);
    (FIELDS[event] || []).forEach(function (f) {
      var field = el("div", "field");
      var label = el("label", null, f[1]);
      label.htmlFor = "cal-s-" + f[0];
      field.appendChild(label);
      var input = el("input");
      input.type = "number";
      input.id = "cal-s-" + f[0];
      input.min = "0";
      input.step = event === "festa" ? "0.5" : "1";
      if (f[0] === "first_cycle") input.placeholder = "next free";
      var v = defaults[f[0]];
      input.value = v === undefined || v === null ? "" : String(v);
      input.addEventListener("input", scheduleCheck);
      field.appendChild(input);
      box.appendChild(field);
    });
    if (event === "diva") box.appendChild(el("p", "note-text admin-wide", "Diva Defense always lasts 21 days: weeks 1-2 are its core, week 3 (rewards and the coin shop) runs beside the next event."));
  }

  function values() {
    var event = $("cal-event").value, settings = {};
    (FIELDS[event] || []).forEach(function (f) { settings[f[0]] = $("cal-s-" + f[0]).value; });
    return { event: event, lane: $("cal-lane").value, start: $("cal-start").value, core: $("cal-core").value,
      settings: settings, note: $("cal-note-text").value.trim(), anyTime: $("cal-anytime").checked };
  }

  function scheduleCheck() {
    clearTimeout(state.checkTimer);
    state.checkTimer = setTimeout(runCheck, 400);
  }

  function runCheck() {
    var v = values();
    if (!v.start) { list("cal-problems", []); $("cal-computed").textContent = ""; return; }
    var seq = ++state.checkSeq;
    var q = state.editing ? "?id=" + state.editing : "";
    request("/api/admin/events/calendar/check" + q, { method: "POST", body: JSON.stringify(body(v)) }).then(function (c) {
      if (seq !== state.checkSeq) return;
      $("cal-computed").textContent = c.endsAt ? "Core to " + utc(c.coreEndsAt) + " UTC, ends " + utc(c.endsAt) + " UTC"
        + (c.settings && c.settings.first_cycle !== undefined ? ", cycles from " + c.settings.first_cycle : "") + "." : "";
      list("cal-problems", c.problems, c.problems && c.problems.length ? [] : ["The checks pass."].concat(c.warnings || []));
    }).catch(function (e) {
      if (seq === state.checkSeq) list("cal-problems", [e.message]);
    });
  }

  function resetForm() {
    state.editing = null;
    $("cal-form").reset();
    $("cal-form-title").textContent = "Add a run";
    $("cal-save").textContent = "Add the run";
    $("cal-reset").hidden = true;
    renderSettings($("cal-event").value);
    list("cal-problems", []);
    $("cal-computed").textContent = "";
  }

  function startEdit(r) {
    state.editing = r.id;
    $("cal-event").value = r.event;
    $("cal-lane").value = r.lane;
    $("cal-start").value = toInput(r.startsAt);
    $("cal-core").value = toInput(r.coreEndsAt);
    $("cal-note-text").value = r.note || "";
    $("cal-anytime").checked = false;
    renderSettings(r.event, r.settings || {});
    $("cal-form-title").textContent = "Change run #" + r.id + " (" + r.name + ")";
    $("cal-save").textContent = "Save the changes";
    $("cal-reset").hidden = false;
    $("cal-form").scrollIntoView({ behavior: "smooth", block: "start" });
    runCheck();
  }

  function save(event) {
    event.preventDefault();
    say("cal-alert", "");
    say("cal-ok", "");
    var v = values();
    if (!v.start) { list("cal-problems", ["Pick a start."]); return; }
    var id = state.editing;
    var path = "/api/admin/events/calendar" + (id ? "/" + id : "");
    $("cal-save").disabled = true;
    request(path, { method: id ? "PUT" : "POST", body: JSON.stringify(body(v)) }).then(function (r) {
      say("cal-ok", (id ? "Run #" + id + " saved" : NAMES[r.event] + " #" + r.id + " added") + ": from " + utc(r.startsAt)
        + " UTC to " + utc(r.endsAt) + " UTC. The game server reads it within a minute.");
      resetForm();
      return load();
    }).catch(function (e) {
      list("cal-problems", (e.data && e.data.problems) || [e.message]);
    }).then(function () { $("cal-save").disabled = false; });
  }

  /* ---- extend the loop ---- */

  function genRequest(dry) {
    return { from: $("cal-gen-from").value || null, weeks: Number($("cal-gen-weeks").value) || null,
      first: $("cal-gen-first").value, dryRun: dry };
  }

  function showGenerated(res) {
    var bad = [], ok = [];
    (res.runs || []).forEach(function (r) {
      var line = r.name + ": " + utc(r.startsAt) + " to " + utc(r.endsAt) + " UTC"
        + (r.settings && r.settings.first_cycle !== undefined ? ", cycle " + r.settings.first_cycle : "");
      if (r.exists) ok.push(line + " (already there, skipped)");
      else if (r.problems && r.problems.length) bad.push(line + ": " + r.problems.join(" "));
      else ok.push(line + " (new)");
    });
    if (!(res.runs || []).length) bad.push("No run of the loop starts in those weeks.");
    list("cal-gen-list", bad, ok.concat(res.warnings || []));
    var fresh = (res.runs || []).filter(function (r) { return !r.exists; }).length;
    $("cal-gen-save").hidden = !(fresh && !(res.problems || []).length);
    $("cal-gen-save").textContent = "Add these " + fresh + (fresh === 1 ? " run" : " runs");
  }

  function preview(event) {
    event.preventDefault();
    say("cal-alert", "");
    $("cal-gen-save").hidden = true;
    request("/api/admin/events/calendar/generate", { method: "POST", body: JSON.stringify(genRequest(true)) })
      .then(showGenerated)
      .catch(function (e) { list("cal-gen-list", (e.data && e.data.problems) || [e.message]); });
  }

  function generate() {
    $("cal-gen-save").disabled = true;
    request("/api/admin/events/calendar/generate", { method: "POST", body: JSON.stringify(genRequest(false)) })
      .then(function (res) {
        say("cal-ok", res.saved + (res.saved === 1 ? " run" : " runs") + " added to the calendar.");
        list("cal-gen-list", []);
        $("cal-gen-save").hidden = true;
        $("cal-gen-from").value = "";
        return load();
      })
      .catch(function (e) { if (e.data && e.data.runs) showGenerated(e.data); else list("cal-gen-list", [e.message]); })
      .then(function () { $("cal-gen-save").disabled = false; });
  }

  function wire() {
    $("cal-refresh").addEventListener("click", load);
    $("cal-cancelled").addEventListener("change", load);
    $("cal-event").addEventListener("change", function () { renderSettings($("cal-event").value); scheduleCheck(); });
    ["cal-lane", "cal-start", "cal-core", "cal-anytime", "cal-note-text"].forEach(function (id) {
      $(id).addEventListener("input", scheduleCheck);
      $(id).addEventListener("change", scheduleCheck);
    });
    $("cal-form").addEventListener("submit", save);
    $("cal-reset").addEventListener("click", resetForm);
    $("cal-gen").addEventListener("submit", preview);
    $("cal-gen-save").addEventListener("click", generate);
  }

  window.startAdminEvents = function () {
    if (!started) {
      started = true;
      wire();
      request("/api/admin/events/rules").then(function (r) { rules = r; }).catch(function () { rules = null; })
        .then(function () { renderSettings($("cal-event").value); });
    }
    load();
  };
})();
