/* "Live reports from your game" on the Diagnostics tab of the account page (section #live-reports): the player sees the
   crash and usage reports the game sent for their own characters, reads one in full, and deletes them.
   GET /api/account/telemetry?limit=50&before=<id> -> {total, items: [{id, receivedAt, kind: "health"|"crash", charId,
   characterName, edition, patch, hvmods, crashAt, crashException, fps, drawn, errors, problems, summary}]}, newest
   first; GET /api/account/telemetry/{id} -> the item plus {text} (the report as stored) and, for a crash,
   {answer: {outcome, findings: [{kind, text}], facts: [[label, value]]}}; DELETE /api/account/telemetry (?id=<id> for
   one) -> {deleted}. Signed in only; a 401 says so, 404 on the list means the API has no such endpoint yet. The list is
   fetched when the Diagnostics tab is first shown. Everything from the API goes in with textContent. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var PAGE = 50;

  var section = document.getElementById("live-reports");
  if (!section) return;
  var $ = function (id) { return document.getElementById(id); };
  var list = $("lr-list");
  var state = { loaded: false, loading: false, items: [], total: 0 };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function say(text) {
    $("lr-alert").textContent = text || "";
    $("lr-alert").hidden = !text;
  }

  function request(path, method) {
    return fetch(API + path, { method: method || "GET", headers: { "Authorization": "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) { var e = new Error("Your sign-in has expired. Sign in again to see your reports."); e.status = 401; throw e; }
        if (!r.ok) {
          return r.json().catch(function () { return null; }).then(function (body) {
            var e = new Error(r.status === 404 ? "not found" : (body && body.message) || "The server answered " + r.status + ".");
            e.status = r.status;
            throw e;
          });
        }
        return r.json();
      }, function () { throw new Error("Could not reach the server. Try again in a moment."); });
  }

  // 124 -> "v1.24", 12403 -> "v1.24-pre3", 0 or missing -> "no patch version".
  function patchText(p) {
    if (typeof p !== "number" || !isFinite(p) || p <= 0) return "no patch version";
    var pre = p >= 10000 ? p % 100 : 0;
    var base = p >= 10000 ? Math.floor(p / 100) : p;
    var minor = base % 100;
    return "v" + Math.floor(base / 100) + "." + (minor < 10 ? "0" : "") + minor + (pre ? "-pre" + pre : "");
  }

  function when(node, iso) {
    if (window.HvTime) { node.appendChild(HvTime.node(iso)); return; }
    node.textContent = String(iso || "");
  }

  function kindText(r) { return r.kind === "crash" ? "Crash" : "Health"; }

  function refresh() {
    var n = state.items.length;
    $("lr-count").textContent = state.total ? state.total + (state.total === 1 ? " report" : " reports") + " (newest first)." : "";
    list.hidden = !n;
    $("lr-empty").hidden = !(state.loaded && !state.failed && !n && !$("lr-done").textContent);
    $("lr-more").hidden = !(n && n < state.total);
    $("lr-delete").hidden = !(state.total || n);
  }

  function renderItem(r) {
    var li = el("li", "live-report" + (r.kind === "crash" ? " is-crash" : ""));
    li.dataset.id = String(r.id);
    var head = el("div", "live-report-head");
    head.appendChild(el("span", "live-report-kind", kindText(r)));
    var time = el("span", "live-report-time");
    when(time, r.receivedAt);
    head.appendChild(time);
    li.appendChild(head);
    li.appendChild(el("p", "live-report-meta", [r.characterName || ("character " + r.charId), patchText(r.patch)].join(" · ")));
    li.appendChild(el("p", "live-report-summary", r.summary || ""));
    var show = el("button", "ghost-btn small", "Show");
    show.type = "button";
    show.setAttribute("aria-expanded", "false");
    var detail = el("div", "live-report-detail");
    detail.hidden = true;
    show.addEventListener("click", function () { toggle(r, show, detail); });
    li.appendChild(show);
    li.appendChild(detail);
    return li;
  }

  function toggle(r, button, box) {
    if (!box.hidden) { box.hidden = true; button.textContent = "Show"; button.setAttribute("aria-expanded", "false"); return; }
    if (box.dataset.loaded) { box.hidden = false; button.textContent = "Hide"; button.setAttribute("aria-expanded", "true"); return; }
    button.disabled = true;
    say("");
    request("/api/account/telemetry/" + encodeURIComponent(r.id)).then(function (d) {
      clear(box);
      var a = d.answer;
      if (a) {
        if (a.outcome) box.appendChild(el("p", "diag-outcome", a.outcome));
        if ((a.findings || []).length) {
          var ul = el("ul", "diag-findings");
          a.findings.forEach(function (f) { ul.appendChild(el("li", null, f.text)); });
          box.appendChild(ul);
        }
      }
      box.appendChild(el("p", "note-text", "The report exactly as we stored it:"));
      box.appendChild(el("pre", "diag-raw", d.text || ""));
      box.dataset.loaded = "1";
      box.hidden = false;
      button.textContent = "Hide";
      button.setAttribute("aria-expanded", "true");
    }).catch(function (e) {
      say(e.status === 404 ? "That report is gone (reports are deleted after 30 days)." : e.message);
    }).then(function () { button.disabled = false; });
  }

  function load(more) {
    if (state.loading) return;
    state.loading = true;
    say("");
    var q = "?limit=" + PAGE;
    if (more && state.items.length) q += "&before=" + state.items[state.items.length - 1].id;
    request("/api/account/telemetry" + q).then(function (page) {
      var items = Array.isArray(page.items) ? page.items : [];
      if (!more) { state.items = []; clear(list); }
      items.forEach(function (r) { state.items.push(r); list.appendChild(renderItem(r)); });
      state.total = typeof page.total === "number" ? page.total : state.items.length;
      state.loaded = true;
      refresh();
    }).catch(function (e) {
      state.loaded = true;
      state.failed = !state.items.length;
      say(e.status === 404 ? "Your reports are not available yet." : e.message);
      refresh();
    }).then(function () { state.loading = false; });
  }

  function askDelete() {
    $("lr-confirm-text").textContent = "Delete all " + (state.total || state.items.length) + " of your reports? This cannot be undone.";
    $("lr-confirm").hidden = false;
    $("lr-confirm-yes").focus();
  }

  function doDelete() {
    var yes = $("lr-confirm-yes");
    yes.disabled = true;
    say("");
    request("/api/account/telemetry", "DELETE").then(function (r) {
      var n = r && typeof r.deleted === "number" ? r.deleted : 0;
      state.items = [];
      state.total = 0;
      clear(list);
      $("lr-done").textContent = n === 0 ? "There were no reports to delete." : "Deleted " + n + (n === 1 ? " report." : " reports.");
      $("lr-done").hidden = false;
      refresh();
    }).catch(function (e) { say(e.message); }).then(function () {
      yes.disabled = false;
      $("lr-confirm").hidden = true;
    });
  }

  $("lr-more").addEventListener("click", function () { load(true); });
  $("lr-delete").addEventListener("click", askDelete);
  $("lr-confirm-no").addEventListener("click", function () { $("lr-confirm").hidden = true; $("lr-delete").focus(); });
  $("lr-confirm-yes").addEventListener("click", doDelete);

  function start() {
    if (!token()) { say("Sign in to see your reports."); state.loaded = true; state.failed = true; refresh(); return; }
    load(false);
  }

  // Fetched when the Diagnostics tab is first shown (at once on a page without tabs).
  if (window.HvSubtabs && HvSubtabs.whenOpen) HvSubtabs.whenOpen(section, start);
  else start();
})();
