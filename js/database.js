/* The Database page (database.html): one search box over monsters, quests, items, weapons, sources and skills, with the results
   grouped by kind as you type, and the section tiles. The search itself is window.HvSearch (js/search.js), over
   the site's small indexes; nothing here loads data/quests.json or the weapon type files.
   URL: ?q=<query> and ?kind=monsters|quests|items|weapons (one kind, up to 50 results) are kept with replaceState.
   Keys: Down from the box moves into the results, Up/Down between them, Up from the first or Esc back to the box,
   Enter in the box opens the first result. */
(function () {
  "use strict";

  var ALL = 6, ONE = 50;
  var S, box, results, status, chips;
  var state = { q: "", kind: "" };
  var loaded = {}, failed = {};
  var timer = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }

  function saveUrl() {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.kind) params.set("kind", state.kind);
    var text = params.toString();
    history.replaceState(null, "", location.pathname + (text ? "?" + text : "") + location.hash);
  }

  function loadAll() {
    S.ORDER.forEach(function (kind) {
      if (loaded[kind]) return;
      S.load(kind).then(function (ok) {
        loaded[kind] = ok;
        failed[kind] = !ok;
        if (ok) {
          var count = document.querySelector('[data-db-count="' + kind + '"]');
          if (count) count.textContent = num(S.KINDS[kind].list.length);
        }
        render();
      });
    });
  }

  function hitLink(row) {
    var a = el("a", "db-hit");
    a.href = row.href;
    a.appendChild(el("span", "db-hit-title", row.title));
    if (row.sub) a.appendChild(el("span", "db-hit-sub", row.sub));
    return a;
  }

  function group(kind, q) {
    var k = S.KINDS[kind], one = !!state.kind;
    var node = el("section", "db-group");
    node.setAttribute("aria-label", k.label);
    var head = el("h3", "db-group-h", k.label);
    node.appendChild(head);
    if (failed[kind]) {
      var p = el("p", "db-group-note", k.label + " could not be loaded. ");
      var retry = el("button", "ghost-btn small", "Try again");
      retry.type = "button";
      retry.addEventListener("click", function () { failed[kind] = false; loaded[kind] = false; loadAll(); render(); });
      p.appendChild(retry);
      node.appendChild(p);
      return { node: node, total: 0, ready: true };
    }
    if (!loaded[kind]) {
      node.appendChild(el("p", "db-group-note", "Loading..."));
      return { node: node, total: 0, ready: false };
    }
    var found = S.find(kind, q, one ? ONE : ALL);
    if (!found.total) return { node: null, total: 0, ready: true };
    head.appendChild(el("span", "db-group-n", num(found.total)));
    var list = el("ul", "db-list");
    found.rows.forEach(function (row) { list.appendChild(el("li")).appendChild(hitLink(row)); });
    node.appendChild(list);
    var foot = el("p", "db-group-foot");
    if (!one && found.total > found.rows.length) {
      var all = el("button", "ghost-btn small", "Show " + (found.total > ONE ? ONE + " of " : "all ") + num(found.total));
      all.type = "button";
      all.addEventListener("click", function () { setKind(kind); });
      foot.appendChild(all);
    }
    if (found.more) {
      var more = el("a", "ghost-btn small", "Search in " + k.label);
      more.href = found.more;
      foot.appendChild(more);
    }
    if (foot.firstChild) node.appendChild(foot);
    return { node: node, total: found.total, ready: true };
  }

  function render() {
    var q = state.q;
    while (results.firstChild) results.removeChild(results.firstChild);
    var counts = {};
    if (!q) {
      status.textContent = "";
      updateChips(counts);
      return;
    }
    var short = S.norm(q).length < 2;
    var total = 0, waiting = false;
    S.ORDER.forEach(function (kind) {
      if (short && S.KINDS[kind].min > 1) return;
      var g = group(kind, q);
      counts[kind] = g.total;
      total += g.total;
      if (!g.ready) waiting = true;
      if (g.node && (!state.kind || state.kind === kind)) results.appendChild(g.node);
    });
    updateChips(counts);
    var shown = state.kind ? counts[state.kind] || 0 : total;
    var label = state.kind ? S.KINDS[state.kind].label.toLowerCase() : "results";
    if (waiting && !shown) status.textContent = "Searching...";
    else if (!shown) status.textContent = "Nothing matches “" + q + "”" + (state.kind ? " in " + S.KINDS[state.kind].label : "") + "." +
      (short ? " Type two letters or more to search quests, items and weapons too." : "");
    else status.textContent = num(shown) + " " + (shown === 1 && !state.kind ? "result" : label) + " for “" + q + "”" +
      (short ? " (monsters only: type two letters or more for the rest)" : "") + ".";
  }

  function updateChips(counts) {
    Array.prototype.forEach.call(chips, function (chip) {
      var kind = chip.getAttribute("data-kind");
      var label = kind ? S.KINDS[kind].label : "All";
      var n = kind ? counts[kind] : null;
      chip.textContent = label + (state.q && n ? " " + num(n) : "");
      chip.setAttribute("aria-pressed", String(kind === state.kind));
    });
  }

  function setKind(kind) {
    state.kind = kind;
    saveUrl();
    render();
  }

  function hits() { return Array.prototype.slice.call(results.querySelectorAll(".db-hit")); }

  function onBoxKey(event) {
    if (event.key === "ArrowDown") {
      var first = hits()[0];
      if (first) { event.preventDefault(); first.focus(); }
    } else if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(timer);
      update();
      var top = hits()[0];
      if (top) location.href = top.href;
    } else if (event.key === "Escape" && box.value) {
      event.preventDefault();
      box.value = "";
      update();
    }
  }

  function onResultsKey(event) {
    if (!event.target.classList || !event.target.classList.contains("db-hit")) return;
    var list = hits(), at = list.indexOf(event.target);
    if (event.key === "ArrowDown" && at < list.length - 1) { event.preventDefault(); list[at + 1].focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); (at > 0 ? list[at - 1] : box).focus(); }
    else if (event.key === "Escape") { event.preventDefault(); box.focus(); }
  }

  function update() {
    state.q = box.value.trim();
    saveUrl();
    render();
  }

  function init() {
    S = window.HvSearch;
    box = $("db-search");
    results = $("db-results");
    status = $("db-status");
    chips = $("db-kinds").querySelectorAll(".chip");
    if (!S || !box) return;

    var params = new URLSearchParams(location.search);
    state.q = (params.get("q") || "").trim();
    if (S.KINDS[params.get("kind")]) state.kind = params.get("kind");
    box.value = state.q;

    $("db-form").addEventListener("submit", function (event) { event.preventDefault(); });
    box.addEventListener("focus", loadAll);
    box.addEventListener("pointerdown", loadAll);
    box.addEventListener("input", function () {
      loadAll();
      clearTimeout(timer);
      timer = setTimeout(update, 60);
    });
    box.addEventListener("keydown", onBoxKey);
    results.addEventListener("keydown", onResultsKey);
    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () { setKind(chip.getAttribute("data-kind")); });
    });
    if (state.q) loadAll();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
