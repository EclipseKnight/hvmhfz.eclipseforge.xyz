/* Admin: the Diagnostics tab and the Users tab's "Recent logins", both read only, with the admin's token.
   - Diagnostics: GET /api/admin/diagnostics?user=&before=&limit= lists the uploaded reports newest first
     ({id, userId, username, createdAt, kind, fileName, outcome, patchName, problems}); GET /api/admin/diagnostics/{id}
     gives one with its answer ({outcome, findings: [{kind, text}], facts: [[label, value]], summary}) and the file
     ({text}). The API keeps them 90 days.
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
      $("diag-view-raw").textContent = d.text || "";
      $("diag-view-panel").hidden = false;
      $("diag-view-panel").scrollIntoView({ block: "start" });
    }).catch(function (e) {
      say($("diag-admin-alert"), e.message === "not found" ? "That report is gone (older than 90 days?)." : e.message);
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
