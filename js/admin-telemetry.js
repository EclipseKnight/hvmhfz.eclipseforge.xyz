/* Admin: Diagnostics tab, second part "Live telemetry" (read only, with the admin's token).
   GET /api/admin/telemetry?kind=&patch=&character=&crashAt=&session=&user=&before=&limit= lists newest first
   ({id, receivedAt, kind, sessionId, seq, charId, userId, username, edition, patch, hvmods, crashAt,
   crashException, fps, drawn, flags, problems ("\n" joined or null), errors}); GET /api/admin/telemetry/{id} adds
   {text} and, for a crash, {answer: {kind, outcome, findings: [{kind, text}], facts: [[k, v]]}} (the same shape as
   the uploads' answer); GET /api/admin/telemetry/summary?days=7 gives {days, perPatch: [{patch, reports, sessions,
   avgFps, avgDrawn}], crashes: [{crashAt, count, lastSeen, patches}], healthWithErrors}.
   Everything comes from players' PCs: all of it goes in with textContent. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var PAGE = 50;
  var FILTERS = [["kind", "tel-kind"], ["patch", "tel-patch"], ["character", "tel-character"],
    ["crashAt", "tel-crashat"], ["session", "tel-session"], ["user", "tel-user"]];

  var tel = { started: false, filters: {}, before: null, last: null, viewed: null };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function request(path) {
    return fetch(API + path, { headers: { "Authorization": "Bearer " + token() } }).then(function (r) {
      if (r.status === 401) throw new Error("Your sign-in has expired. Sign in again on the home page.");
      if (r.status === 403) throw new Error("This account is not an admin.");
      if (r.status === 404) throw new Error("not found");
      if (!r.ok) throw new Error("The server answered " + r.status + ".");
      return r.json();
    });
  }

  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    if (window.HvTime) return HvTime.text(d) || "";
    return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  function tcell(iso) {
    var td = el("td", null, "");
    if (window.HvTime && when(iso)) td.appendChild(HvTime.node(iso));
    else td.textContent = when(iso);
    return td;
  }

  function say(node, text) {
    node.textContent = text || "";
    node.hidden = !text;
  }

  function emptyRow(body, cols, text) {
    clear(body);
    var row = el("tr");
    var cell = el("td", "empty-cell", text);
    cell.colSpan = cols;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function num(v, digits) {
    return typeof v === "number" && isFinite(v) ? v.toFixed(digits) : "";
  }

  function lines(v) {
    return v === null || v === undefined ? [] : Array.isArray(v) ? v.map(String) : String(v).split("\n").filter(Boolean);
  }

  // The list sends the error count as a number; a report's detail sends the lines.
  function errorCount(v) {
    return typeof v === "number" ? v : lines(v).length;
  }

  function character(r) {
    var who = r.charId ? "char " + r.charId : "not logged in";
    return r.username ? r.username + " (#" + r.userId + ") · " + who : who;
  }

  /* ---------- summary ---------- */

  function renderSummary(s) {
    var crashes = s.crashes || [];
    var patches = s.perPatch || [];
    $("tel-summary-line").textContent = "Last " + s.days + " days: " + crashes.reduce(function (n, c) { return n + (c.count || 0); }, 0)
      + " crash reports at " + crashes.length + " addresses; " + (s.healthWithErrors || 0) + " health reports with errors.";
    var body = $("tel-crash-rows");
    if (!crashes.length) emptyRow(body, 4, "No crash reports.");
    else {
      clear(body);
      crashes.forEach(function (c) {
        var row = el("tr");
        var cell = el("td");
        var b = el("button", "ghost-btn small", c.crashAt || "(unknown)");
        b.type = "button";
        b.addEventListener("click", function () { setFilters({ crashAt: c.crashAt || "" }); });
        cell.appendChild(b);
        row.appendChild(cell);
        row.appendChild(el("td", "num", String(c.count)));
        row.appendChild(tcell(c.lastSeen));
        row.appendChild(el("td", null, (c.patches || []).join(", ")));
        body.appendChild(row);
      });
    }
    body = $("tel-patch-rows");
    if (!patches.length) emptyRow(body, 5, "No reports.");
    else {
      clear(body);
      patches.forEach(function (p) {
        var row = el("tr");
        var cell = el("td");
        var b = el("button", "ghost-btn small", String(p.patch));
        b.type = "button";
        b.addEventListener("click", function () { setFilters({ patch: String(p.patch) }); });
        cell.appendChild(b);
        row.appendChild(cell);
        row.appendChild(el("td", "num", String(p.reports)));
        row.appendChild(el("td", "num", String(p.sessions)));
        row.appendChild(el("td", "num", num(p.avgFps, 1)));
        row.appendChild(el("td", "num", num(p.avgDrawn, 1)));
        body.appendChild(row);
      });
    }
  }

  function loadSummary() {
    return request("/api/admin/telemetry/summary?days=7").then(renderSummary).catch(function (e) {
      emptyRow($("tel-crash-rows"), 4, "");
      emptyRow($("tel-patch-rows"), 5, "");
      $("tel-summary-line").textContent = "";
      say($("tel-alert"), e.message === "not found" ? "The API has no telemetry yet." : e.message);
    });
  }

  /* ---------- list ---------- */

  function renderList(list) {
    var body = $("tel-rows");
    if (!list.length) {
      emptyRow(body, 9, tel.before ? "No older reports." : "No telemetry reports.");
      $("tel-older").disabled = true;
      return;
    }
    clear(body);
    list.forEach(function (r) {
      var row = el("tr");
      row.appendChild(el("td", "rank", String(r.id)));
      row.appendChild(tcell(r.receivedAt));
      row.appendChild(el("td", null, r.kind));
      row.appendChild(el("td", "cell-name", character(r)));
      row.appendChild(el("td", null, (r.edition ? r.edition + " " : "") + (r.patch === null || r.patch === undefined ? "" : r.patch)));
      row.appendChild(el("td", null, r.hvmods === null || r.hvmods === undefined ? "" : String(r.hvmods)));
      var what = r.kind === "crash" ? [r.crashAt, r.crashException].filter(Boolean).join(" ")
        : lines(r.problems).concat(errorCount(r.errors) ? [errorCount(r.errors) + (errorCount(r.errors) === 1 ? " error" : " errors")] : []).join(", ");
      var cell = el("td", "diag-note-cell", what.length > 100 ? what.slice(0, 100) + "…" : what);
      if (what) cell.title = what;
      row.appendChild(cell);
      row.appendChild(el("td", "num", num(r.fps, 1)));
      var act = el("td");
      var open = el("button", "ghost-btn small", "View");
      open.type = "button";
      open.addEventListener("click", function () { view(r.id); });
      act.appendChild(open);
      row.appendChild(act);
      body.appendChild(row);
    });
    tel.last = list[list.length - 1].id;
    $("tel-older").disabled = list.length < PAGE;
  }

  function loadList() {
    var q = "?limit=" + PAGE;
    Object.keys(tel.filters).forEach(function (k) {
      if (tel.filters[k] !== "") q += "&" + k + "=" + encodeURIComponent(tel.filters[k]);
    });
    if (tel.before) q += "&before=" + tel.before;
    return request("/api/admin/telemetry" + q).then(renderList).catch(function (e) {
      emptyRow($("tel-rows"), 9, "");
      say($("tel-alert"), e.message === "not found" ? "The API has no telemetry yet." : e.message);
    });
  }

  function readFilters() {
    var f = {};
    FILTERS.forEach(function (p) {
      var v = $(p[1]).value.trim();
      if (v !== "") f[p[0]] = v;
    });
    tel.filters = f;
    tel.before = null;
  }

  // Put these filter values in the boxes (every other box empty) and show the list.
  function setFilters(values) {
    FILTERS.forEach(function (p) { $(p[1]).value = values[p[0]] !== undefined ? values[p[0]] : ""; });
    readFilters();
    say($("tel-alert"), "");
    loadList();
    $("tel-list-panel").scrollIntoView({ block: "start" });
  }

  /* ---------- detail ---------- */

  function view(id) {
    say($("tel-alert"), "");
    request("/api/admin/telemetry/" + id).then(function (d) {
      tel.viewed = d;
      $("tel-view-title").textContent = "#" + d.id + " · " + d.kind + " · " + character(d) + " · " + when(d.receivedAt);
      var a = d.answer || {};
      $("tel-view-outcome").textContent = a.outcome || "";
      var findings = $("tel-view-findings");
      clear(findings);
      (a.findings || []).forEach(function (f) {
        var li = el("li");
        li.appendChild(el("span", "diag-kind", f.kind));
        li.appendChild(document.createTextNode(f.text));
        findings.appendChild(li);
      });
      var facts = $("tel-view-answer-facts");
      clear(facts);
      (a.facts || []).forEach(function (pair) {
        facts.appendChild(el("dt", null, pair[0]));
        facts.appendChild(el("dd", null, pair[1]));
      });
      var fields = $("tel-view-fields");
      clear(fields);
      [["Session", d.sessionId + " (report " + d.seq + ")"], ["Character", character(d)], ["Edition", d.edition],
        ["Patch", d.patch], ["hvmods", d.hvmods], ["Flags", d.flags], ["fps / drawn", num(d.fps, 1) + " / " + num(d.drawn, 1)],
        ["Crash address", d.crashAt], ["Exception", d.crashException],
        ["Problems", lines(d.problems).join(", ")], ["Errors", lines(d.errors).join("\n")]].forEach(function (p) {
        if (p[1] === null || p[1] === undefined || p[1] === "") return;
        fields.appendChild(el("dt", null, p[0]));
        fields.appendChild(el("dd", null, String(p[1])));
      });
      $("tel-same-crash").hidden = !d.crashAt;
      $("tel-this-char").hidden = !d.charId;
      $("tel-view-raw").textContent = d.text || "";
      $("tel-view-panel").hidden = false;
      $("tel-view-panel").scrollIntoView({ block: "start" });
    }).catch(function (e) {
      say($("tel-alert"), e.message === "not found" ? "That report is gone (older than 30 days?)." : e.message);
    });
  }

  function wire() {
    $("tel-filter").addEventListener("click", function () { readFilters(); loadList(); });
    $("tel-clear").addEventListener("click", function () { setFilters({}); });
    FILTERS.forEach(function (p) {
      $(p[1]).addEventListener("keydown", function (event) { if (event.key === "Enter") $("tel-filter").click(); });
    });
    $("tel-newest").addEventListener("click", function () { tel.before = null; loadList(); });
    $("tel-older").addEventListener("click", function () { tel.before = tel.last; loadList(); });
    $("tel-view-close").addEventListener("click", function () { $("tel-view-panel").hidden = true; });
    $("tel-same-crash").addEventListener("click", function () {
      if (tel.viewed && tel.viewed.crashAt) setFilters({ crashAt: tel.viewed.crashAt });
    });
    $("tel-this-char").addEventListener("click", function () {
      if (tel.viewed && tel.viewed.charId) setFilters({ character: String(tel.viewed.charId) });
    });
  }

  function start() {
    if (!$("tel-list-panel")) return;
    if (!tel.started) {
      tel.started = true;
      wire();
    }
    loadSummary();
    loadList();
  }

  // admin.js calls startAdminDiag when the Diagnostics tab opens: the telemetry part starts with it.
  var uploads = window.startAdminDiag;
  window.startAdminDiag = function () {
    if (uploads) uploads();
    start();
  };
})();
