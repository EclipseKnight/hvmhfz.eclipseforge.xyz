/* Admin: the Flags tab. The server flags odd accounts (a lot of GCP or other points, a save that cannot be real);
   an admin reviews each flag here and marks it approved (the account is fine) or cheat (the currency is set down;
   an Undo puts it back). The API is /api/admin/flags/** (the flag queue is sorted by severity by the API).
   Who may do what comes from window.hvStaff (js/admin.js, GET /api/admin/permissions/mine): Approve, Cheat, Undo, the
   bulk buttons, the rules table and Scan now each need their own flags permission (approve, cheat, undo, act), the
   notes form needs "notes". Without hvStaff (an older API) the queue's canWrite is used for all of them: admins
   write, moderators read.
   A flag's detail also loads the Character panel (GET /api/admin/flags/subject/{userId}?character={characterId}):
   the character, its account, currencies against their caps, quests, every flag with its history, imports, logins,
   other characters, past admin actions and staff notes (POST /api/admin/flags/notes). Never an IP address.
   The badge on the tab button (open count, critical count in red) comes from GET /api/admin/flags/summary and is
   loaded when the admin page opens (window.hvFlagsBadge, called by js/admin.js).
   Markup from the API (names, notes, reasons) stays text (textContent). Errors show the API's message as it is. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var MISSING = "The flags tables are not installed yet.";

  /* ---------- pure helpers (tested under node by dev/check-admin-flags.js) ---------- */

  var CURRENCIES = { gcp: "GCP", netcafe_points: "Net cafe points", frontier_points: "Frontier points", gacha_premium: "Premium gacha coins" };
  var SEVERITIES = { critical: "Critical", high: "High", medium: "Medium" };
  var STATUSES = { open: "Open", approved: "Approved", cheat: "Cheat" };
  var SOURCES = { daily: "daily scan", "import": "import", "import-blocked": "import (blocked)" };
  var ACTIONS = { flagged: "Flagged", reopened: "Reopened", approve: "Approved", cheat: "Cheat", undo: "Undo" };

  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "";
    if (typeof window !== "undefined" && window.HvTime) return HvTime.text(t) || "";
    return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  /** 1200000 -> "1,200,000"; null / undefined -> "unknown". */
  function num(v) {
    if (v === null || v === undefined || v === "") return "unknown";
    return typeof v === "number" && isFinite(v) ? v.toLocaleString("en-US") : String(v);
  }

  function currencyName(c) { return c ? CURRENCIES[c] || c : "no currency"; }

  /** A value typed in a box: "" -> {value: null}; whole numbers 0 and up -> {value}; else {error}. */
  function parseValue(text) {
    var t = String(text === null || text === undefined ? "" : text).trim().replace(/[,\s_]/g, "");
    if (t === "") return { value: null };
    if (!/^\d{1,12}$/.test(t)) return { error: "The value must be a whole number, 0 or more." };
    return { value: Number(t) };
  }

  /** "Value 1,200,000, threshold above 500,000, cap 600,000, now 1,150,000". */
  function numbersText(f) {
    var parts = ["value " + num(f.value), "threshold " + (f.direction === "below" ? "below " : "above ") + num(f.threshold)];
    if (f.cap !== null && f.cap !== undefined) parts.push("cap " + num(f.cap));
    if (f.currentValue !== null && f.currentValue !== undefined) parts.push("now " + num(f.currentValue));
    return parts.join(", ");
  }

  function whoText(f) { return f.characterName ? f.characterName : "(account rule)"; }

  /** What a cheat would set for this flag: the typed value, else the flag's suggested value; null when neither. */
  function cheatTarget(f, typed) {
    if (!f.currency) return null;
    if (typed !== null && typed !== undefined) return typed;
    return f.suggestedValue === undefined ? null : f.suggestedValue;
  }

  /** The line a confirm shows for one flag: old -> new. */
  function changeLine(f, kind, typed) {
    var name = whoText(f) + " (" + f.ruleLabel + ")";
    if (kind === "approve") {
      return name + ": " + (f.currency ? currencyName(f.currency) + " stays at " + num(f.currentValue) : "approved, nothing else changes");
    }
    if (!f.currency) return name + ": this rule has no currency, the flag is only marked";
    var to = cheatTarget(f, typed);
    return name + ": " + currencyName(f.currency) + " " + num(f.currentValue) + " -> " + (to === null ? "no suggested value" : num(to));
  }

  /** The body of POST /api/admin/flags/bulk. */
  function bulkBody(ids, action, typed, note) {
    var body = { ids: ids.slice(), action: action, note: note || "" };
    if (action === "cheat" && typed !== null && typed !== undefined) body.value = typed;
    return body;
  }

  /** {open, critical} -> the badge's texts; null when there is nothing open. */
  function badgeOf(s) {
    if (!s || !s.open) return null;
    return { open: String(s.open), critical: s.critical ? String(s.critical) : "",
      title: s.open + " open flag" + (s.open === 1 ? "" : "s") + (s.critical ? ", " + s.critical + " critical" : "") };
  }

  function lastScanText(s) {
    if (!s) return "No scan yet.";
    return "Last scan: " + utc(s.at) + " (" + (s.kind || "scan") + "), " + num(s.characters) + " characters checked, "
      + num(s.flagged) + " flagged, " + num(s.newFlags) + " new.";
  }

  /* HR shown the game's way: "HR100 (HR4)". Swap for the shared helper when the hr-display work lands. */
  function hrLabel(hr) {
    var n = Number(hr);
    if (hr === null || hr === undefined || hr === "" || !isFinite(n)) return "HR unknown";
    if (n < 1) return "HR" + n;
    var rank = n >= 999 ? 7 : n >= 998 ? 6 : n >= 299 ? 5 : n >= 99 ? 4 : n >= 50 ? 3 : n >= 30 ? 2 : 1;
    return "HR" + n + " (HR" + rank + ")";
  }

  /** "GR50 · HR999 (HR7)"; the GR part only when gr > 0. */
  function levelLabel(hr, gr) { return (gr > 0 ? "GR" + gr + " \u00b7 " : "") + hrLabel(hr); }

  /** 45000 seconds -> "12 h 30 m"; null -> "not known". */
  function playtimeText(seconds) {
    if (seconds === null || seconds === undefined || !isFinite(Number(seconds))) return "not known";
    var m = Math.floor(Number(seconds) / 60);
    return Math.floor(m / 60) + " h " + (m % 60) + " m";
  }

  var helpers = { hrLabel: hrLabel, levelLabel: levelLabel, playtimeText: playtimeText, utc: utc, num: num, currencyName: currencyName, parseValue: parseValue, numbersText: numbersText, whoText: whoText,
    cheatTarget: cheatTarget, changeLine: changeLine, bulkBody: bulkBody, badgeOf: badgeOf, lastScanText: lastScanText };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var started = false;
  var state = {
    status: "open", rule: "", flags: [], counts: {}, lastScan: null, canWrite: true, rules: [],
    selected: {}, detail: null, confirm: null, busy: false,
    subject: null   // the Character panel: {userId, characterId, loading, error, data}
  };

  // One flags permission (view, approve, cheat, undo, notes, act). Without hvStaff the queue's canWrite decides.
  function can(action) { return window.hvStaff ? window.hvStaff.can("flags", action) : state.canWrite; }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /** A table cell holding a time: a <time> in the viewer's zone, UTC on hover. */
  function tcell(iso) {
    var td = el("td", null, "");
    if (typeof window !== "undefined" && window.HvTime && utc(iso)) td.appendChild(HvTime.node(iso));
    else td.textContent = utc(iso);
    return td;
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

  // A refusal throws with the API's message, the status and the whole answer.
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw Object.assign(new Error("Sign in again: your session has ended."), { status: 401 });
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var fallback = r.status === 403 ? "Only admins and moderators can see the flags." : "HTTP " + r.status;
            throw Object.assign(new Error((data && data.message) || fallback), { status: r.status, data: data });
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

  function ok(text) { say("fl-alert", ""); say("fl-ok", text); }

  function fail(error) {
    say("fl-ok", "");
    say("fl-alert", error.status === 503 ? MISSING : error.message);
  }

  function showMissing() {
    $("fl-main").hidden = true;
    say("fl-alert", "");
    $("fl-notable").hidden = false;
  }

  /* --- the badge on the tab button --- */

  function setBadge(s) {
    var b = badgeOf(s), open = $("count-flags"), crit = $("count-flags-critical");
    if (!open || !crit) return;
    open.hidden = !b;
    crit.hidden = !b || !b.critical;
    if (b) {
      open.textContent = b.open;
      crit.textContent = b.critical;
      open.parentNode.title = b.title;
    } else {
      open.parentNode.removeAttribute("title");
    }
  }

  window.hvFlagsBadge = function () {
    if (!token() || !$("count-flags")) return Promise.resolve();
    return request("/api/admin/flags/summary").then(function (s) {
      setBadge(s && s.tableReady === false ? null : s);
    }).catch(function () { /* no badge without the summary */ });
  };

  /* --- loading --- */

  function listPath() {
    return "/api/admin/flags?status=" + encodeURIComponent(state.status)
      + (state.rule ? "&rule=" + encodeURIComponent(state.rule) : "") + "&limit=200";
  }

  function load() {
    return request(listPath()).then(function (d) {
      if (d.tableReady === false) { setBadge(null); showMissing(); return false; }
      $("fl-notable").hidden = true;
      state.canWrite = d.canWrite !== false;
      state.flags = d.flags || [];
      state.counts = d.counts || {};
      state.lastScan = d.lastScan || null;
      var keep = {};
      state.flags.forEach(function (f) { if (state.selected[f.id]) keep[f.id] = true; });
      state.selected = keep;
      say("fl-alert", "");
      $("fl-main").hidden = false;
      renderAll();
      setBadge({ open: state.counts.open || 0, critical: state.counts.critical || 0 });
      return true;
    }).catch(function (e) {
      if (e.status === 503) { setBadge(null); showMissing(); } else fail(e);
      return false;
    });
  }

  function loadRules() {
    return request("/api/admin/flags/rules").then(function (d) {
      state.rules = (d && d.rules) || [];
      renderRuleFilter();
      renderRules();
    }).catch(function (e) { if (e.status !== 503) fail(e); });
  }

  function refresh() {
    var again = state.detail ? openDetail(state.detail.flag.id, true) : Promise.resolve();
    return Promise.all([load(), again]);
  }

  /* --- render: filters, counts, list --- */

  function renderAll() {
    var c = state.counts;
    $("fl-note").textContent = (c.open || 0) + " open" + (c.critical ? ", " + c.critical + " critical" : "");
    $("fl-counts").textContent = "Open " + (c.open || 0) + " (critical " + (c.critical || 0) + "), approved " + (c.approved || 0) + ", cheat " + (c.cheat || 0) + ".";
    $("fl-scanline").textContent = lastScanText(state.lastScan);
    $("fl-scan").hidden = !can("act");
    $("fl-bulkbar").hidden = !can("approve") && !can("cheat");
    $("fl-bulk-approve").hidden = !can("approve");
    $("fl-bulk-cheat").hidden = !can("cheat");
    Array.prototype.forEach.call($("fl-status").children, function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-status") === state.status ? "true" : "false"); });
    renderList();
    renderBulk();
    renderRules();
    if (state.detail) renderDetail();
  }

  function renderRuleFilter() {
    var sel = $("fl-rule");
    clear(sel);
    var all = el("option", null, "All rules");
    all.value = "";
    sel.appendChild(all);
    state.rules.forEach(function (r) {
      var o = el("option", null, r.label);
      o.value = r.key;
      sel.appendChild(o);
    });
    sel.value = state.rule;
  }

  function chip(text, cls) { return el("span", "badge " + (cls || ""), text); }

  function flagCard(f, opts) {
    var o = opts || {};
    var card = el("div", "fl-card sev-" + f.severity);
    card.setAttribute("data-id", String(f.id));
    if (o.selectable) {
      var lab = el("label", "fl-check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!state.selected[f.id];
      cb.setAttribute("aria-label", "Select flag " + f.id + " (" + whoText(f) + ")");
      cb.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", function () {
        if (cb.checked) state.selected[f.id] = true; else delete state.selected[f.id];
        renderBulk();
      });
      lab.appendChild(cb);
      lab.addEventListener("click", function (e) { e.stopPropagation(); });
      card.appendChild(lab);
    } else {
      card.classList.add("no-check");
    }
    var body = el("div", "fl-body");
    var top = el("div", "fl-top");
    top.appendChild(chip(SEVERITIES[f.severity] || f.severity, "fl-sev sev-" + f.severity));
    top.appendChild(el("strong", "fl-name", whoText(f)));
    if (f.characterId !== null && f.characterId !== undefined) top.appendChild(el("span", "fl-id", "char #" + f.characterId));
    top.appendChild(el("span", "fl-acct", "account " + f.username + " #" + f.userId));
    if (f.online) {
      var on = chip("online", "fl-online");
      on.title = "Online now: a cheat will be refused until the character logs out.";
      top.appendChild(on);
    }
    body.appendChild(top);
    body.appendChild(el("div", "fl-rule", f.ruleLabel));
    body.appendChild(el("div", "fl-nums", numbersText(f) + (f.currency ? " (" + currencyName(f.currency) + ")" : "")));
    if (f.why) body.appendChild(el("p", "fl-why", f.why));
    var meta = el("div", "fl-meta");
    meta.appendChild(chip(STATUSES[f.status] || f.status, "fl-status st-" + f.status));
    meta.appendChild(el("span", null, "first seen " + utc(f.firstSeen)));
    meta.appendChild(el("span", null, "last seen " + utc(f.lastSeen)));
    meta.appendChild(el("span", null, "source: " + (SOURCES[f.source] || f.source) + (f.importId ? " #" + f.importId : "")));
    if (f.reviewer) meta.appendChild(el("span", null, "reviewed by " + f.reviewer + (f.reviewedAt ? " " + utc(f.reviewedAt) : "")));
    body.appendChild(meta);
    if (f.note) body.appendChild(el("div", "fl-note-line", "Note: " + f.note));
    card.appendChild(body);

    var act = el("div", "fl-actions");
    if (o.details) {
      var d = el("button", "ghost-btn small", "Details");
      d.type = "button";
      d.addEventListener("click", function (e) { e.stopPropagation(); openDetail(f.id); });
      act.appendChild(d);
    }
    if (f.status !== "cheat") {
      if (f.status === "open" && can("approve")) {
        var a = el("button", "ghost-btn small", "Approve");
        a.type = "button";
        a.addEventListener("click", function (e) { e.stopPropagation(); askSingle("approve", f); });
        act.appendChild(a);
      }
      if (can("cheat")) {
        var c = el("button", "btn btn-primary btn-small", "Cheat");
        c.type = "button";
        c.addEventListener("click", function (e) { e.stopPropagation(); askSingle("cheat", f); });
        act.appendChild(c);
      }
    }
    card.appendChild(act);
    if (o.details) card.addEventListener("click", function () { openDetail(f.id); });
    return card;
  }

  function renderList() {
    var box = $("fl-list");
    clear(box);
    if (!state.flags.length) {
      box.appendChild(el("p", "empty-cell", "No " + (state.status === "all" ? "" : STATUSES[state.status].toLowerCase() + " ") + "flags" + (state.rule ? " for this rule" : "") + "."));
      return;
    }
    state.flags.forEach(function (f) { box.appendChild(flagCard(f, { selectable: can("approve") || can("cheat"), details: true })); });
  }

  /* --- bulk bar --- */

  function selectedFlags() { return state.flags.filter(function (f) { return state.selected[f.id]; }); }

  function renderBulk() {
    var n = selectedFlags().length;
    $("fl-bulk-count").textContent = n ? n + " selected" : "none selected";
    $("fl-bulk-approve").disabled = !n;
    $("fl-bulk-cheat").disabled = !n;
    var all = $("fl-select-all");
    all.checked = n > 0 && n === state.flags.length;
    all.indeterminate = n > 0 && n < state.flags.length;
    all.disabled = !state.flags.length;
    Array.prototype.forEach.call($("fl-list").querySelectorAll(".fl-card"), function (card) {
      var cb = card.querySelector("input[type=checkbox]");
      if (cb) cb.checked = !!state.selected[card.getAttribute("data-id")];
    });
  }

  /* --- the confirm dialog: one for approve, cheat, undo and the bulk actions --- */

  function openConfirm(c) {
    ok("");
    state.confirm = c;
    $("fl-confirm-msg").hidden = true;
    $("fl-confirm-text").textContent = c.text;
    $("fl-value-field").hidden = !c.value;
    $("fl-note-field").hidden = !c.note;
    $("fl-value").value = c.value && c.preset !== null && c.preset !== undefined ? String(c.preset) : "";
    $("fl-cnote").value = "";
    $("fl-confirm-yes").textContent = c.yes;
    $("fl-value-hint").textContent = c.valueHint || "";
    renderConfirmLines();
    $("fl-confirm").hidden = false;
    $("fl-confirm").scrollIntoView({ block: "center" });
    ($("fl-value-field").hidden ? $("fl-confirm-yes") : $("fl-value")).focus();
  }

  function closeConfirm() { state.confirm = null; $("fl-confirm").hidden = true; }

  function typedValue() {
    if (!state.confirm || !state.confirm.value) return { value: null };
    return parseValue($("fl-value").value);
  }

  function renderConfirmLines() {
    var c = state.confirm, box = $("fl-confirm-lines");
    clear(box);
    if (!c || !c.flags) return;
    var typed = typedValue();
    var v = typed.error ? null : typed.value;
    c.flags.slice(0, 12).forEach(function (f) { box.appendChild(el("li", null, changeLine(f, c.kind, v))); });
    if (c.flags.length > 12) box.appendChild(el("li", null, "and " + (c.flags.length - 12) + " more"));
    box.hidden = !c.flags.length;
  }

  function askSingle(kind, f) {
    if (kind === "approve") {
      openConfirm({ kind: "approve", flags: [f], text: "Approve flag #" + f.id + ": the account is fine, the flag is closed and nothing is changed.",
        note: true, value: false, yes: "Approve" });
      return;
    }
    var t = f.currency
      ? "Cheat flag #" + f.id + ": " + currencyName(f.currency) + " is set down to the value below. You can undo it later."
      : "Cheat flag #" + f.id + ": this rule has no currency, so the flag is only marked as cheat and no value is changed.";
    openConfirm({ kind: "cheat", flags: [f], text: t, note: true, value: !!f.currency, preset: f.suggestedValue,
      valueHint: f.suggestedValue === null || f.suggestedValue === undefined ? "No suggested value: type one." : "Prefilled with the suggested value.", yes: "Cheat" });
  }

  function askBulk(kind) {
    var list = selectedFlags();
    if (!list.length) return;
    var n = list.length, what = n + " flag" + (n === 1 ? "" : "s");
    if (kind === "approve") {
      openConfirm({ kind: "approve", bulk: true, flags: list, text: "Approve " + what + "? Nothing is changed in the accounts.", note: true, value: false, yes: "Approve " + what });
      return;
    }
    openConfirm({ kind: "cheat", bulk: true, flags: list, note: true, value: true, preset: null, yes: "Cheat " + what,
      text: "Cheat " + what + "? One value is set for all of them, or leave it empty to use each flag's suggested value. Flags of rules without a currency are only marked.",
      valueHint: "Empty = each flag's suggested value." });
  }

  function askUndo(h, f) {
    openConfirm({ kind: "undo", actionId: h.id, force: false, flags: null, note: false, value: false, yes: "Undo",
      text: "Undo the " + (ACTIONS[h.action] || h.action).toLowerCase() + " of " + utc(h.at) + " on " + whoText(f) + ": "
        + (f.currency ? currencyName(f.currency) + " goes from " + num(h.newValue) + " back to " + num(h.oldValue) + "." : "the flag is opened again.") });
  }

  function doConfirm() {
    var c = state.confirm;
    if (!c || state.busy) return;
    var note = $("fl-cnote").value.trim(), typed = typedValue();
    if (typed.error) { say("fl-confirm-msg", typed.error); return; }
    if (c.kind === "cheat" && !c.bulk && typed.value !== null && c.flags[0].currency && typeof c.flags[0].currentValue === "number" && typed.value > c.flags[0].currentValue) {
      say("fl-confirm-msg", "Cheat only lowers the value: 0 to " + num(c.flags[0].currentValue) + ".");
      return;
    }
    var req, done;
    if (c.kind === "undo") {
      req = request("/api/admin/flags/actions/" + c.actionId + "/undo", { method: "POST", body: JSON.stringify(c.force ? { force: true } : {}) });
      done = function () { return "Undone."; };
    } else if (c.bulk) {
      var ids = c.flags.map(function (f) { return f.id; });
      req = request("/api/admin/flags/bulk", { method: "POST", body: JSON.stringify(bulkBody(ids, c.kind, typed.value, note)) });
      done = function (r) { return (c.kind === "approve" ? "Approved " : "Cheat on ") + r.done + " flag" + (r.done === 1 ? "" : "s") + (r.failed ? ", " + r.failed + " failed" : "") + "."; };
    } else {
      var f = c.flags[0], body = { note: note };
      if (c.kind === "cheat" && f.currency && typed.value !== null) body.value = typed.value;
      req = request("/api/admin/flags/" + f.id + "/" + c.kind, { method: "POST", body: JSON.stringify(body) });
      done = function (r) {
        var a = r && r.action;
        if (c.kind === "approve") return "Approved flag #" + f.id + ".";
        return a && f.currency ? "Cheat on flag #" + f.id + ": " + currencyName(f.currency) + " " + num(a.oldValue) + " -> " + num(a.newValue) + "." : "Flag #" + f.id + " marked as cheat.";
      };
    }
    state.busy = true;
    $("fl-confirm-yes").disabled = true;
    req.then(function (r) {
      state.busy = false;
      $("fl-confirm-yes").disabled = false;
      closeConfirm();
      if (c.bulk) showResults(r, c.flags);
      else showResults(null);
      return refresh().then(function () { ok(done(r)); });
    }).catch(function (e) {
      state.busy = false;
      $("fl-confirm-yes").disabled = false;
      say("fl-confirm-msg", e.message);
      if (c.kind === "undo" && e.status === 409 && e.data && e.data.canForce) {
        c.force = true;
        $("fl-confirm-yes").textContent = "Undo anyway";
      }
    });
  }

  function showResults(r, flags) {
    var box = $("fl-results"), list = $("fl-results-list");
    clear(list);
    if (!r || !r.results) { box.hidden = true; return; }
    var names = {};
    (flags || []).forEach(function (f) { names[f.id] = whoText(f); });
    r.results.forEach(function (x) {
      var li = el("li", x.ok ? "is-ok" : "is-bad", "#" + x.id + " " + (names[x.id] || "") + ": " + (x.ok ? "done" : "failed") + (x.message ? " (" + x.message + ")" : ""));
      list.appendChild(li);
    });
    $("fl-results-head").textContent = "Bulk result: " + r.done + " done, " + r.failed + " failed.";
    box.hidden = false;
    state.selected = {};
  }

  /* --- detail --- */

  function openDetail(id, quiet) {
    return request("/api/admin/flags/" + id).then(function (d) {
      state.detail = d;
      loadSubject(d.flag.userId, d.flag.characterId);
      renderDetail();
      if (!quiet) $("fl-detail").scrollIntoView({ block: "start" });
    }).catch(function (e) { if (quiet) state.detail = null; fail(e); renderDetailGone(); });
  }

  function renderDetailGone() { if (!state.detail) $("fl-detail").hidden = true; }

  function renderDetail() {
    var d = state.detail, box = $("fl-detail-body");
    clear(box);
    $("fl-detail").hidden = !d;
    if (!d) return;
    var f = d.flag;
    $("fl-detail-title").textContent = "Flag #" + f.id + ": " + whoText(f);
    box.appendChild(flagCard(f, { selectable: false, details: false }));

    var subject = el("div", "fl-subject");
    subject.id = "fl-subject";
    box.appendChild(subject);
    renderSubject();

    box.appendChild(el("h4", "subhead", "History"));
    var wrap = el("div", "table-wrap"), table = el("table", "data-table admin-table fl-history");
    table.setAttribute("data-nosort", "");
    var head = el("thead"), hr = el("tr");
    ["When", "Action", "Who", "Old", "New", "Note", ""].forEach(function (t) { hr.appendChild(el("th", null, t)); });
    head.appendChild(hr);
    table.appendChild(head);
    var tb = el("tbody");
    var hist = d.history || [];
    if (!hist.length) {
      var er = el("tr"), ec = el("td", "empty-cell", "No history.");
      ec.colSpan = 7;
      er.appendChild(ec);
      tb.appendChild(er);
    }
    hist.forEach(function (h) {
      var tr = el("tr");
      tr.appendChild(tcell(h.at));
      tr.appendChild(el("td", null, ACTIONS[h.action] || h.action));
      tr.appendChild(el("td", null, h.actor || ""));
      tr.appendChild(el("td", "num", h.oldValue === null || h.oldValue === undefined ? "" : num(h.oldValue)));
      tr.appendChild(el("td", "num", h.newValue === null || h.newValue === undefined ? "" : num(h.newValue)));
      var n = el("td", null, (h.note || "") + (h.undoneAt ? (h.note ? " " : "") + "(undone by " + (h.undoneBy || "?") + " " + utc(h.undoneAt) + ")" : ""));
      tr.appendChild(n);
      var a = el("td");
      if (can("undo") && h.undoable) {
        var b = el("button", "ghost-btn small", "Undo");
        b.type = "button";
        b.addEventListener("click", function () { askUndo(h, f); });
        a.appendChild(b);
      }
      tr.appendChild(a);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    box.appendChild(wrap);

    var others = d.others || [];
    box.appendChild(el("h4", "subhead", "Other flags of this account"));
    if (!others.length) box.appendChild(el("p", "note-text", "None."));
    var ul = el("ul", "fl-others");
    others.forEach(function (o) {
      var li = el("li"), b = el("button", "ghost-btn small");
      b.type = "button";
      b.textContent = "#" + o.id + " " + whoText(o) + ": " + o.ruleLabel + " (" + (STATUSES[o.status] || o.status) + ")";
      b.addEventListener("click", function () { openDetail(o.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* --- the Character panel --- */

  function plain(v) { return v === null || v === undefined || v === "" ? "not known" : String(v); }

  function ago(iso) { return iso ? utc(iso) || "not known" : "not known"; }

  function loadSubject(userId, characterId) {
    var target = { userId: userId, characterId: characterId === undefined ? null : characterId, loading: true, error: null, data: null };
    state.subject = target;
    var path = "/api/admin/flags/subject/" + encodeURIComponent(userId)
      + (target.characterId !== null ? "?character=" + encodeURIComponent(target.characterId) : "");
    request(path).then(function (d) {
      if (state.subject !== target) return;
      target.loading = false;
      target.data = d && typeof d === "object" ? d : null;
      if (!target.data) target.error = "The answer was empty.";
      renderSubject();
    }).catch(function (e) {
      if (state.subject !== target) return;
      target.loading = false;
      target.error = e.message;
      renderSubject();
    });
  }

  // A definition list from [label, value] pairs; a value may be a text or a node.
  function dl(pairs) {
    var list = el("dl", "fl-dl");
    pairs.forEach(function (p) {
      list.appendChild(el("dt", null, p[0]));
      var dd = el("dd");
      if (p[1] && p[1].nodeType) dd.appendChild(p[1]); else dd.textContent = p[1];
      list.appendChild(dd);
    });
    return list;
  }

  function block(title, open, count) {
    var d = el("details", "fl-block");
    d.open = !!open;
    d.appendChild(el("summary", null, title + (count !== undefined && count !== null ? " (" + count + ")" : "")));
    return d;
  }

  function miniTable(headers, rows) {
    var wrap = el("div", "table-wrap"), table = el("table", "data-table admin-table");
    table.setAttribute("data-nosort", "");
    var head = el("thead"), hr = el("tr");
    headers.forEach(function (t) { hr.appendChild(el("th", null, t)); });
    head.appendChild(hr);
    table.appendChild(head);
    var tb = el("tbody");
    rows.forEach(function (cells) {
      var tr = el("tr");
      cells.forEach(function (c) { tr.appendChild(el("td", null, c === null || c === undefined ? "" : String(c))); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    return wrap;
  }

  function unavailable(what) { return el("p", "note-text", what + ": not available."); }

  function link(href, text, newTab) {
    var a = el("a", "fl-link", text);
    a.href = href;
    if (newTab) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  }

  function currencyRow(c) {
    var row = el("div", "fl-cur");
    var top = el("div", "fl-cur-top");
    top.appendChild(el("strong", null, c.label || c.key));
    var cap = c.cap === null || c.cap === undefined ? "no cap" : num(c.cap);
    top.appendChild(el("span", "fl-cur-val", num(c.value) + " / " + cap));
    row.appendChild(top);
    if (typeof c.cap === "number" && c.cap > 0 && typeof c.value === "number") {
      var bar = el("div", "fl-bar");
      var fill = el("span", "fl-bar-fill");
      fill.style.width = Math.max(0, Math.min(100, c.value / c.cap * 100)) + "%";
      if (typeof c.flagThreshold === "number" && c.flagThreshold <= c.value) fill.classList.add("is-over");
      bar.appendChild(fill);
      if (typeof c.flagThreshold === "number" && c.flagThreshold <= c.cap) {
        var mark = el("span", "fl-bar-mark");
        mark.style.left = Math.max(0, Math.min(100, c.flagThreshold / c.cap * 100)) + "%";
        mark.title = "flag threshold " + num(c.flagThreshold);
        bar.appendChild(mark);
      }
      row.appendChild(bar);
    }
    var info = [];
    if (c.flagThreshold !== null && c.flagThreshold !== undefined) info.push("flagged above " + num(c.flagThreshold));
    if (c.earnable) info.push(String(c.earnable));
    if (info.length) row.appendChild(el("div", "fl-cur-note", info.join(". ")));
    return row;
  }

  function subjectFlag(item) {
    var f = item && item.flag;
    if (!f) return null;
    var wrap = el("div", "fl-sflag sev-" + f.severity);
    var top = el("div", "fl-top");
    top.appendChild(chip(SEVERITIES[f.severity] || f.severity, "fl-sev sev-" + f.severity));
    top.appendChild(chip(STATUSES[f.status] || f.status, "fl-status st-" + f.status));
    top.appendChild(el("strong", null, f.ruleLabel));
    top.appendChild(el("span", "fl-id", whoText(f) + " #" + f.id));
    wrap.appendChild(top);
    wrap.appendChild(el("div", "fl-nums", numbersText(f) + " · first seen " + utc(f.firstSeen) + ", last seen " + utc(f.lastSeen)));
    var hist = item.history || [];
    if (hist.length) {
      var ul = el("ul", "fl-hist");
      hist.forEach(function (h) {
        ul.appendChild(el("li", null, utc(h.at) + " " + (ACTIONS[h.action] || h.action) + (h.actor ? " by " + h.actor : "")
          + (h.oldValue !== null && h.oldValue !== undefined ? ", " + num(h.oldValue) + " -> " + num(h.newValue) : "")
          + (h.note ? " (" + h.note + ")" : "") + (h.undoneAt ? " [undone by " + (h.undoneBy || "?") + "]" : "")));
      });
      wrap.appendChild(ul);
    }
    return wrap;
  }

  function renderNotes(box, d) {
    clear(box);
    var ch = d.character;
    var notes = Array.isArray(d.notes) ? d.notes : null;
    if (!notes) box.appendChild(unavailable("Staff notes"));
    else if (!notes.length) box.appendChild(el("p", "note-text", "No notes yet."));
    else {
      var ul = el("ul", "fl-notes");
      notes.forEach(function (n) {
        var li = el("li");
        li.appendChild(el("span", "fl-note-meta", ago(n.at) + " · " + plain(n.author) + (n.characterId === null || n.characterId === undefined ? " · account note" : "")));
        li.appendChild(el("div", "fl-note-text", n.note));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (!can("notes")) return;
    var form = el("form", "fl-note-form");
    var label = el("label", null, "Add note");
    label.setAttribute("for", "fl-subject-note");
    var area = el("textarea");
    area.id = "fl-subject-note";
    area.rows = 2;
    area.maxLength = 1000;
    var msg = el("p", "form-alert");
    msg.hidden = true;
    var add = el("button", "ghost-btn small", "Add note");
    add.type = "submit";
    form.appendChild(label);
    form.appendChild(area);
    form.appendChild(msg);
    form.appendChild(add);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = area.value.trim();
      if (!text) { msg.textContent = "Write the note first."; msg.hidden = false; return; }
      add.disabled = true;
      msg.hidden = true;
      var body = { userId: state.subject.userId, characterId: ch && ch.id !== undefined ? ch.id : null, note: text };
      request("/api/admin/flags/notes", { method: "POST", body: JSON.stringify(body) }).then(function (note) {
        if (!Array.isArray(d.notes)) d.notes = [];
        d.notes.unshift(note);
        renderNotes(box, d);
      }).catch(function (err) {
        add.disabled = false;
        msg.textContent = err.message;
        msg.hidden = false;
      });
    });
    box.appendChild(form);
  }

  function buildSubject(box, target) {
    var d = target.data, ch = d.character, ac = d.account;
    var head = el("div", "fl-subject-head");
    head.appendChild(el("h4", "subhead", "Character"));
    var links = el("span", "fl-links");
    if (ch && ch.id !== null && ch.id !== undefined && !ch.deleted) links.appendChild(link("/hunters.html?id=" + encodeURIComponent(ch.id), "Hunter profile", true));
    if (ac && ac.username) links.appendChild(link("#users?q=" + encodeURIComponent(ac.username), "Admin Users tab"));
    head.appendChild(links);
    box.appendChild(head);
    var flagTarget = state.detail && state.detail.flag;
    if (flagTarget && (flagTarget.characterId === undefined ? null : flagTarget.characterId) !== target.characterId) {
      var back = el("button", "ghost-btn small", "Back to this flag's character");
      back.type = "button";
      back.addEventListener("click", function () { loadSubject(flagTarget.userId, flagTarget.characterId); renderSubject(); });
      box.appendChild(back);
    }

    var two = el("div", "fl-two");
    if (ch) {
      var w = ch.mainWeapon;
      two.appendChild(dl([
        ["Name", plain(ch.name) + (ch.deleted ? " (deleted)" : "")],
        ["Character id", plain(ch.id)],
        ["Level", levelLabel(ch.hr, ch.gr)],
        ["Main weapon", w ? plain(w.name || w.weaponType) + (w.quests !== null && w.quests !== undefined ? " · " + num(w.quests) + " quests" : "") + (w.basis ? " (" + w.basis + ")" : "") : "not known"],
        ["Playtime", playtimeText(ch.playtimeSeconds)],
        ["Created", ago(ch.createdAt)],
        ["Last login", ago(ch.lastLogin)],
        ["Guild", ch.guild ? plain(ch.guild.name) + " (#" + plain(ch.guild.id) + ")" : "no guild"],
        ["Client version", ch.clientPatch !== null && ch.clientPatch !== undefined || ch.clientPatchName
          ? plain(ch.clientPatchName || ch.clientPatch) + (ch.clientPatchSeenAt ? ", seen " + ago(ch.clientPatchSeenAt) : "") : "not known"]
      ]));
    } else {
      two.appendChild(el("p", "note-text", "Account flag: no character. The character section is not available."));
    }
    if (ac) {
      var discord = ac.discord ? plain(ac.discord.name) + " (" + plain(ac.discord.id) + ")" : "not linked";
      two.appendChild(dl([
        ["Account", plain(ac.username) + " #" + plain(ac.id)],
        ["Created", ago(ac.createdAt)],
        ["Last login", ago(ac.lastLogin)],
        ["Account age", ac.ageDays === null || ac.ageDays === undefined ? "not known" : num(ac.ageDays) + " days"],
        ["Roles", (ac.roles || []).map(function (r) { return String(r).replace("ROLE_", ""); }).join(", ") || "none"],
        ["Discord", discord],
        ["Patch channel", plain(ac.patchChannel)]
      ]));
    } else {
      two.appendChild(unavailable("Account"));
    }
    box.appendChild(two);

    box.appendChild(el("h5", "fl-sub", "Currencies"));
    if (!Array.isArray(d.currencies)) box.appendChild(unavailable("Currencies"));
    else if (!d.currencies.length) box.appendChild(el("p", "note-text", "No currencies to show."));
    else d.currencies.forEach(function (c) { box.appendChild(currencyRow(c)); });

    box.appendChild(el("h5", "fl-sub", "Quests"));
    var q = d.quests;
    if (!q) box.appendChild(unavailable("Quest history"));
    else {
      box.appendChild(dl([["Total", num(q.total)], ["Last 7 days", num(q.last7Days)], ["Last 30 days", num(q.last30Days)], ["Last quest", ago(q.lastQuestAt)]]));
      if ((q.top || []).length) {
        var top = block("Most played quests", false, q.top.length);
        top.appendChild(miniTable(["Quest", "Times"], q.top.map(function (t) { return [t.name, num(t.count)]; })));
        box.appendChild(top);
      }
    }

    box.appendChild(el("h5", "fl-sub", "Flags of this character and account"));
    var shown = Array.isArray(d.flags) ? d.flags.map(subjectFlag).filter(Boolean) : null;
    if (!shown) box.appendChild(unavailable("Flags"));
    else if (!shown.length) box.appendChild(el("p", "note-text", "No flags."));
    else shown.forEach(function (n) { box.appendChild(n); });

    var imports = Array.isArray(d.imports) ? d.imports : null;
    if (!imports) { box.appendChild(el("h5", "fl-sub", "Imports")); box.appendChild(unavailable("Imports")); }
    else {
      var ib = block("Imports", false, imports.length);
      ib.appendChild(imports.length ? miniTable(["When", "From", "By", "Scan", "Undone"], imports.map(function (i) {
        return [ago(i.at), i.source, i.by, i.scan, i.undone ? "yes" : "no"];
      })) : el("p", "note-text", "No imports."));
      box.appendChild(ib);
    }

    var lg = d.logins;
    if (!lg) { box.appendChild(el("h5", "fl-sub", "Logins")); box.appendChild(unavailable("Logins")); }
    else {
      var recent = Array.isArray(lg.recent) ? lg.recent : [];
      var lb = block("Recent logins", false, lg.tracking === false ? "tracking off" : recent.length);
      if (lg.tracking === false) lb.appendChild(el("p", "note-text", "Login tracking is off."));
      else lb.appendChild(recent.length ? miniTable(["When", "World", "Character"], recent.map(function (r) { return [ago(r.at), r.world, r.character]; })) : el("p", "note-text", "No logins recorded."));
      box.appendChild(lb);
      var ip = lg.sharedIp, line;
      if (!ip || ip.available === false) line = "IP data not available.";
      else if (!ip.accounts) line = "Shares an IP with no other account.";
      else line = "Shares an IP with " + ip.accounts + " other account" + (ip.accounts === 1 ? "" : "s") + ((ip.names || []).length ? ": " + ip.names.join(", ") : "") + ".";
      box.appendChild(el("p", "fl-shared", line));
    }

    box.appendChild(el("h5", "fl-sub", "Other characters of the account"));
    var others = d.otherCharacters;
    if (!Array.isArray(others)) box.appendChild(unavailable("Other characters"));
    else if (!others.length) box.appendChild(el("p", "note-text", "None."));
    else {
      var ul = el("ul", "fl-others");
      others.forEach(function (o) {
        var li = el("li"), b = el("button", "ghost-btn small");
        b.type = "button";
        b.textContent = plain(o.name) + " · " + levelLabel(o.hr, o.gr) + (o.lastLogin ? " · last " + ago(o.lastLogin) : "") + (o.deleted ? " (deleted)" : "");
        b.addEventListener("click", function () { loadSubject(target.userId, o.id); renderSubject(); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var actions = Array.isArray(d.adminActions) ? d.adminActions : null;
    if (!actions) { box.appendChild(el("h5", "fl-sub", "Past admin actions")); box.appendChild(unavailable("Admin actions")); }
    else {
      var ab = block("Past admin actions", false, actions.length);
      ab.appendChild(actions.length ? miniTable(["When", "Who", "Action", "Target", "Result"], actions.map(function (a) {
        return [ago(a.at), a.actor, a.action, a.target, a.result];
      })) : el("p", "note-text", "None."));
      box.appendChild(ab);
    }

    box.appendChild(el("h5", "fl-sub", "Staff notes"));
    var notesBox = el("div", "fl-notes-box");
    notesBox.id = "fl-subject-notes";
    box.appendChild(notesBox);
    renderNotes(notesBox, d);
  }

  function renderSubject() {
    var box = $("fl-subject"), t = state.subject;
    if (!box) return;
    clear(box);
    if (!t) return;
    if (t.loading) { box.appendChild(el("h4", "subhead", "Character")); box.appendChild(el("p", "note-text", "Loading the character...")); return; }
    if (t.error || !t.data) {
      box.appendChild(el("h4", "subhead", "Character"));
      box.appendChild(el("p", "note-text", "The character panel is not available: " + (t.error || "no answer") + "."));
      return;
    }
    try {
      buildSubject(box, t);
    } catch (e) {
      clear(box);
      box.appendChild(el("h4", "subhead", "Character"));
      box.appendChild(el("p", "note-text", "The character panel could not be shown."));
    }
  }

  /* --- rules --- */

  function renderRules() {
    var body = $("fl-rules-body");
    clear(body);
    $("fl-rules-note").textContent = state.rules.length ? state.rules.length + " rules" : "";
    if (!state.rules.length) {
      var er = el("tr"), ec = el("td", "empty-cell", "No rules.");
      ec.colSpan = 8;
      er.appendChild(ec);
      body.appendChild(er);
      return;
    }
    state.rules.forEach(function (r) {
      var tr = el("tr");
      tr.setAttribute("data-rule", r.key);
      var name = el("td");
      name.appendChild(el("strong", null, r.label));
      name.appendChild(el("div", "fl-rule-key", r.key + " (" + r.subject + (r.blocksImport ? ", refuses imports" : "") + ")"));
      if (r.description) name.appendChild(el("div", "fl-rule-desc", r.description));
      if (r.calibration) name.appendChild(el("div", "fl-rule-desc fl-rule-cal", "Live check: " + r.calibration));
      tr.appendChild(name);
      tr.appendChild(el("td", null, currencyName(r.currency) + ", " + (r.direction === "below" ? "below" : "above")));
      if (can("act")) {
        var en = el("input");
        en.type = "checkbox";
        en.checked = !!r.enabled;
        en.setAttribute("aria-label", "Enabled: " + r.label);
        var enTd = el("td"); enTd.appendChild(en);
        var th = el("input");
        th.type = "text"; th.inputMode = "numeric"; th.value = r.threshold === null || r.threshold === undefined ? "" : String(r.threshold);
        th.setAttribute("aria-label", "Threshold: " + r.label);
        var thTd = el("td"); thTd.appendChild(th);
        var sv = el("select");
        Object.keys(SEVERITIES).forEach(function (k) { var o = el("option", null, SEVERITIES[k]); o.value = k; sv.appendChild(o); });
        sv.value = r.severity;
        sv.setAttribute("aria-label", "Severity: " + r.label);
        var svTd = el("td"); svTd.appendChild(sv);
        // A rule without a currency has no ceiling (the API refuses one); an empty box keeps the current ceiling.
        var ce = null, ceTd = el("td");
        if (r.currency) {
          ce = el("input");
          ce.type = "text"; ce.inputMode = "numeric"; ce.value = r.ceiling === null || r.ceiling === undefined ? "" : String(r.ceiling);
          ce.placeholder = "none";
          ce.setAttribute("aria-label", "Ceiling: " + r.label);
          ceTd.appendChild(ce);
        } else {
          ceTd.appendChild(el("span", "fl-rule-key", "no currency"));
        }
        tr.appendChild(enTd); tr.appendChild(thTd); tr.appendChild(svTd); tr.appendChild(ceTd);
        var sTd = el("td"), save = el("button", "ghost-btn small", "Save");
        save.type = "button";
        save.addEventListener("click", function () { saveRule(r, en, th, sv, ce); });
        sTd.appendChild(save);
        tr.appendChild(sTd);
      } else {
        tr.appendChild(el("td", null, r.enabled ? "on" : "off"));
        tr.appendChild(el("td", "num", num(r.threshold)));
        tr.appendChild(el("td", null, SEVERITIES[r.severity] || r.severity));
        tr.appendChild(el("td", "num", !r.currency ? "no currency" : r.ceiling === null || r.ceiling === undefined ? "none" : num(r.ceiling)));
        tr.appendChild(el("td"));
      }
      body.appendChild(tr);
    });
  }

  function saveRule(r, en, th, sv, ce) {
    var body = {}, t = parseValue(th.value), c = ce ? parseValue(ce.value) : { value: null };
    if (t.error || t.value === null) { say("fl-alert", "The threshold must be a whole number, 0 or more."); return; }
    if (c.error) { say("fl-alert", "The ceiling must be a whole number, 0 or more."); return; }
    if (en.checked !== !!r.enabled) body.enabled = en.checked;
    if (t.value !== r.threshold) body.threshold = t.value;
    if (sv.value !== r.severity) body.severity = sv.value;
    // The API keeps the current ceiling when none is sent (null cannot clear it), so an empty box sends nothing.
    if (c.value !== null && c.value !== r.ceiling) body.ceiling = c.value;
    if (!Object.keys(body).length) { ok("Nothing changed for " + r.label + "."); return; }
    request("/api/admin/flags/rules/" + encodeURIComponent(r.key), { method: "PUT", body: JSON.stringify(body) }).then(function (nr) {
      state.rules = state.rules.map(function (x) { return x.key === r.key ? Object.assign({}, x, nr) : x; });
      renderRules();
      ok("Saved " + r.label + ". It applies from the next scan.");
    }).catch(fail);
  }

  /* --- scan --- */

  function scanNow() {
    if (state.busy) return;
    state.busy = true;
    $("fl-scan").disabled = true;
    ok("");
    request("/api/admin/flags/scan", { method: "POST", body: "{}" }).then(function (s) {
      state.busy = false;
      $("fl-scan").disabled = false;
      return load().then(function () { ok("Scan done: " + num(s.characters) + " characters, " + num(s.flagged) + " flagged, " + num(s.newFlags) + " new."); });
    }).catch(function (e) { state.busy = false; $("fl-scan").disabled = false; fail(e); });
  }

  /* --- wiring --- */

  function wire() {
    Array.prototype.forEach.call($("fl-status").children, function (b) {
      b.addEventListener("click", function () { state.status = b.getAttribute("data-status"); state.selected = {}; closeConfirm(); load(); });
    });
    $("fl-rule").addEventListener("change", function () { state.rule = $("fl-rule").value; state.selected = {}; load(); });
    $("fl-refresh").addEventListener("click", function () { ok(""); refresh(); loadRules(); });
    $("fl-select-all").addEventListener("change", function () {
      state.selected = {};
      if ($("fl-select-all").checked) state.flags.forEach(function (f) { state.selected[f.id] = true; });
      renderBulk();
    });
    $("fl-bulk-approve").addEventListener("click", function () { askBulk("approve"); });
    $("fl-bulk-cheat").addEventListener("click", function () { askBulk("cheat"); });
    $("fl-value").addEventListener("input", function () { say("fl-confirm-msg", ""); renderConfirmLines(); });
    $("fl-confirm-yes").addEventListener("click", doConfirm);
    $("fl-confirm-no").addEventListener("click", closeConfirm);
    $("fl-detail-close").addEventListener("click", function () { state.detail = null; renderDetail(); });
    $("fl-results-close").addEventListener("click", function () { $("fl-results").hidden = true; });
    $("fl-scan").addEventListener("click", scanNow);
  }

  window.startAdminFlags = function () {
    if (started) { load(); return; }
    started = true;
    wire();
    load().then(function (good) { if (good) loadRules(); });
  };
})();
