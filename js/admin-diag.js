/* Admin: the Diagnostics tab and the Users tab's "Recent logins", both read only, with the admin's token.
   - Diagnostics: GET /api/admin/diagnostics?user=&before=&limit= lists the uploaded reports newest first
     ({id, userId, username, createdAt, kind, fileName, outcome, patchName, problems}); GET /api/admin/diagnostics/{id}
     gives one with its answer ({outcome, findings: [{kind, text}], facts: [[label, value]], summary}) and the file
     ({text}) and its [moves] lines ({moves}: the last 200 own hits while "Show move id" is on, hvmhfz_re part 109),
     shown as a table (time, weapon, style, move id with its name from /data/weapons, MV, damage, crit); an id the
     weapon data has no name for (missing or "unknown") is flagged "unnamed". The API keeps them 90 days.
   - Recent logins: GET /api/admin/users/{id}/logins answers {tracking, logins: [{loginAt, logoutAt, charId,
     charName, land, clientPatchName, qolNames, refusal, disconnect}]} from Erupe's login_history (30 days);
     tracking false: the game server does not write it yet.
   All API text goes in with textContent. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var PAGE = 50;

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

  /** "2026-11-10 01:02" (UTC); "" for nothing. */
  function utc(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 16).replace("T", " ");
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

  /* ---------- Diagnostics tab ---------- */

  var diag = { started: false, user: "", before: null, last: null };

  function renderReports(list) {
    var body = $("diag-rows");
    if (!list.length) {
      emptyRow(body, 8, diag.before ? "No older reports." : "No reports yet.");
      $("diag-older").disabled = true;
      return;
    }
    clear(body);
    list.forEach(function (r) {
      var row = el("tr");
      row.appendChild(el("td", "rank", String(r.id)));
      row.appendChild(el("td", null, utc(r.createdAt)));
      row.appendChild(el("td", "cell-name", (r.username || "?") + " (#" + r.userId + ")"));
      row.appendChild(el("td", null, r.fileName));
      row.appendChild(el("td", null, r.patchName || ""));
      row.appendChild(el("td", null, r.outcome || ""));
      row.appendChild(el("td", null, (r.problems || []).join(", ")));
      var cell = el("td");
      var open = el("button", "ghost-btn small", "View");
      open.type = "button";
      open.addEventListener("click", function () { view(r.id); });
      cell.appendChild(open);
      row.appendChild(cell);
      body.appendChild(row);
    });
    diag.last = list[list.length - 1].id;
    $("diag-older").disabled = list.length < PAGE;
  }

  function loadReports() {
    say($("diag-admin-alert"), "");
    var q = "?limit=" + PAGE + (diag.user ? "&user=" + encodeURIComponent(diag.user) : "")
      + (diag.before ? "&before=" + diag.before : "");
    return request("/api/admin/diagnostics" + q).then(renderReports).catch(function (e) {
      emptyRow($("diag-rows"), 8, "");
      say($("diag-admin-alert"), e.message === "not found" ? "The API has no diagnostics yet." : e.message);
    });
  }

  function view(id) {
    request("/api/admin/diagnostics/" + id).then(function (d) {
      var a = d.answer || {};
      $("diag-view-title").textContent = "#" + d.id + " · " + d.fileName + " · " + (d.username || "?") + " (#"
        + d.userId + ") · " + utc(d.createdAt) + " UTC";
      $("diag-view-outcome").textContent = a.outcome || "";
      var findings = $("diag-view-findings");
      clear(findings);
      (a.findings || []).forEach(function (f) {
        var li = el("li");
        li.appendChild(el("span", "diag-kind", f.kind));
        li.appendChild(document.createTextNode(f.text));
        findings.appendChild(li);
      });
      var facts = $("diag-view-facts");
      clear(facts);
      (a.facts || []).forEach(function (pair) {
        facts.appendChild(el("dt", null, pair[0]));
        facts.appendChild(el("dd", null, pair[1]));
      });
      renderMoves(d.moves || []);
      $("diag-view-raw").textContent = d.text || "";
      $("diag-view-panel").hidden = false;
      $("diag-view-panel").scrollIntoView({ block: "start" });
    }).catch(function (e) {
      say($("diag-admin-alert"), e.message === "not found" ? "That report is gone (older than 90 days?)." : e.message);
    });
  }

  /* ---------- Move hits ([moves], part 109) ---------- */

  // A [moves] line: tools/diag/explain_crash.py MOVE_LINE.
  var MOVE_LINE = /^(\d\d:\d\d:\d\dZ) (class \d+|\S+) (style \d+|\S+) kind (\d+) id (\d+) mv (\d+)(?: \(hit (\d+)\))? damage (\d+)(?: (crit|negative crit))?( \(no copy seen: id from \+6\))?$/;
  // The weapon class numbers as the game's log names them (explain_crash.py MOVE_CLASSES).
  var MOVE_CLASSES = ["GS", "HBG", "Hammer", "Lance", "SnS", "LBG", "DS", "LS", "HH", "GL", "Bow", "Tonfa", "SAF", "MS"];
  var weaponData = { index: null, types: {} };   // promises: /data/weapons/index.json and one file per weapon type
  var movesShown = 0;   // the view the move names belong to (a later View wins)

  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }

  function weaponType(cls) {
    if (!weaponData.index) weaponData.index = getJson("/data/weapons/index.json").catch(function () { weaponData.index = null; return null; });
    return weaponData.index.then(function (idx) {
      var t = idx && (idx.types || []).filter(function (x) { return x.class === cls; })[0];
      if (!t) return null;
      if (!weaponData.types[t.slug]) weaponData.types[t.slug] = getJson("/data/weapons/" + t.slug + ".json").catch(function () { delete weaponData.types[t.slug]; return null; });
      return weaponData.types[t.slug].then(function (data) { return { type: t, data: data }; });
    });
  }

  /** {time, cls, weapon, style, entry, id, mv, hitMv, damage, crit, fromPlus6}, or null for a line this page cannot read. */
  function parseMove(line) {
    var m = MOVE_LINE.exec(line);
    if (!m) return null;
    var cls = /^class (\d+)$/.test(m[2]) ? Number(m[2].slice(6)) : MOVE_CLASSES.indexOf(m[2]);
    var kind = Number(m[4]);
    return { time: m[1], cls: cls, weapon: m[2], style: m[3], kind: kind,
      // the bowgun shots are entry 6 by class (k6v1 HBG, k6v5 LBG); everything else k<kind>
      entry: kind === 6 && cls >= 0 ? "k6v" + cls : "k" + kind,
      id: Number(m[5]), mv: m[6], hitMv: m[7] || "", damage: m[8], crit: m[9] || "", fromPlus6: !!m[10] };
  }

  function renderMoves(lines) {
    var box = $("diag-view-moves");
    var body = $("diag-moves-rows");
    var shown = ++movesShown;
    clear(body);
    box.hidden = !lines.length;
    if (!lines.length) return;
    var hits = lines.map(parseMove);
    var classes = [];
    hits.forEach(function (h) { if (h && h.cls >= 0 && classes.indexOf(h.cls) < 0) classes.push(h.cls); });
    var nameCells = [];
    hits.forEach(function (h, i) {
      var row = el("tr");
      if (!h) {
        var cell = el("td", null, lines[i] + " (a line this page cannot read)");
        cell.colSpan = 7;
        row.appendChild(cell);
        body.appendChild(row);
        return;
      }
      row.appendChild(el("td", null, h.time));
      var weapon = el("td", "diag-move-weapon", h.weapon);
      row.appendChild(weapon);
      row.appendChild(el("td", null, h.style));
      var idCell = el("td", "diag-move-id");
      idCell.appendChild(el("span", null, h.entry + " #" + h.id + (h.fromPlus6 ? " (id from +6)" : "")));
      row.appendChild(idCell);
      row.appendChild(el("td", "num", h.mv + (h.hitMv ? " (hit " + h.hitMv + ")" : "")));
      row.appendChild(el("td", "num", h.damage));
      row.appendChild(el("td", null, h.crit));
      body.appendChild(row);
      nameCells.push({ hit: h, idCell: idCell, weaponCell: weapon });
    });
    $("diag-moves-note").textContent = "· " + lines.length + (lines.length === 1 ? " hit" : " hits") + ", oldest first; looking up the move names";
    Promise.all(classes.map(function (c) { return weaponType(c).then(function (w) { return [c, w]; }); })).then(function (pairs) {
      if (shown !== movesShown) return;
      var byClass = {};
      pairs.forEach(function (p) { byClass[p[0]] = p[1]; });
      var unnamed = {};
      nameCells.forEach(function (n) {
        var w = byClass[n.hit.cls];
        if (w && w.type) n.weaponCell.title = w.type.name;
        var move = w && w.data && (w.data.moves || []).filter(function (mv) { return mv.set === n.hit.entry && mv.id === n.hit.id; })[0];
        if (move && move.name && move.conf !== "unknown") {
          n.idCell.appendChild(document.createTextNode(" " + move.name + (move.conf === "guess" ? " (guess)" : "")));
        } else {
          n.idCell.appendChild(document.createTextNode(" "));
          n.idCell.appendChild(el("span", "badge bad", "unnamed"));
          unnamed[n.hit.weapon + " " + n.hit.entry + " #" + n.hit.id] = 1;
        }
      });
      var list = Object.keys(unnamed);
      $("diag-moves-note").textContent = "· " + lines.length + (lines.length === 1 ? " hit" : " hits") + ", oldest first; "
        + (list.length ? list.length + " unnamed " + (list.length === 1 ? "id" : "ids") + ": " + list.join(", ") : "every id has a name");
    });
  }

  function wireDiag() {
    $("diag-filter").addEventListener("click", function () {
      diag.user = $("diag-user").value.trim();
      diag.before = null;
      loadReports();
    });
    $("diag-user").addEventListener("keydown", function (event) {
      if (event.key === "Enter") $("diag-filter").click();
    });
    $("diag-newest").addEventListener("click", function () {
      diag.before = null;
      loadReports();
    });
    $("diag-older").addEventListener("click", function () {
      diag.before = diag.last;
      loadReports();
    });
    $("diag-view-close").addEventListener("click", function () { $("diag-view-panel").hidden = true; });
  }

  window.startAdminDiag = function () {
    if (!$("panel-diagnostics")) return;
    if (!diag.started) {
      diag.started = true;
      wireDiag();
    }
    loadReports();
  };

  /* ---------- Users tab: Recent logins ---------- */

  var loginsUser = null;

  function showLogins(user) {
    loginsUser = user;
    var panel = $("logins-panel");
    $("logins-account").textContent = "· " + user.username + " (#" + user.id + ")";
    say($("logins-alert"), "");
    emptyRow($("logins-rows"), 8, "Loading");
    panel.hidden = false;
    panel.scrollIntoView({ block: "start" });
    request("/api/admin/users/" + user.id + "/logins").then(function (data) {
      if (!data.tracking) {
        emptyRow($("logins-rows"), 8, "The game server does not record logins yet.");
        return;
      }
      if (!data.logins.length) {
        emptyRow($("logins-rows"), 8, "No login in the last 30 days.");
        return;
      }
      var body = $("logins-rows");
      clear(body);
      data.logins.forEach(function (l) {
        var row = el("tr");
        row.appendChild(el("td", null, utc(l.loginAt)));
        row.appendChild(el("td", null, l.logoutAt ? utc(l.logoutAt) : "-"));
        row.appendChild(el("td", "cell-name", (l.charName || "?") + " (" + l.charId + ")"));
        row.appendChild(el("td", null, l.land));
        row.appendChild(el("td", null, l.clientPatchName));
        row.appendChild(el("td", null, (l.qolNames || []).join(", ") || "none"));
        row.appendChild(el("td", null, l.refusal || ""));
        row.appendChild(el("td", null, l.disconnect || (l.logoutAt ? "" : "on now, or no logout")));
        body.appendChild(row);
      });
    }).catch(function (e) {
      emptyRow($("logins-rows"), 8, "");
      say($("logins-alert"), e.message === "not found" ? "The API has no login history yet." : e.message);
    });
  }

  function wireLogins() {
    var close = $("logins-close");
    if (!close) return;
    close.addEventListener("click", function () { $("logins-panel").hidden = true; });
    $("logins-diag").addEventListener("click", function () {
      if (!loginsUser) return;
      diag.user = String(loginsUser.id);
      diag.before = null;
      $("diag-user").value = diag.user;
      window.location.hash = "diagnostics";
    });
  }

  window.AdminDiag = { showLogins: showLogins, utc: utc };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireLogins);
  else wireLogins();
})();
