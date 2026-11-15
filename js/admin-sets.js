/* Admin: the Community sets tab. Players post armour sets from the Set builder and they show at once; players report
   the ones that do not belong. Staff look at the queue here: Reported (sets with open reports, the default), Hidden
   or All, open one set to read its reports and its log, then Hide (a reason is required and the author sees it),
   Unhide, or Dismiss the reports (closes them, the set stays shown). The API is /api/admin/armor-sets/** (tool key
   "sets": "view" reads, "act" changes). Who may do what comes from window.hvStaff (js/admin.js, GET
   /api/admin/permissions/mine): with only "view" no action button and no reason box is drawn. Without hvStaff (an older
   API) the buttons show and the API's 403 decides. The badge on the tab button is the number of open reports
   (window.hvSetsBadge, called by js/admin.js, and refreshed after every list and action).
   Titles, notes, account names and reasons come from players: they stay text (textContent). Errors show the API's
   message as it is. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var PAGE_SIZE = 50;
  var MAX_REASON = 300;
  var WEAPONS = ["Great Sword", "Heavy Bowgun", "Hammer", "Lance", "Sword and Shield", "Light Bowgun", "Dual Swords",
                 "Long Sword", "Hunting Horn", "Gunlance", "Bow", "Tonfa", "Switch Axe F", "Magnet Spike"];

  var state = { status: "reported", page: 0, items: [], total: 0, openId: null };
  var started = false;
  var seq = 0;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function can(action) { return !window.hvStaff || window.hvStaff.can("sets", action); }

  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "";
    if (window.HvTime) return HvTime.text(t) || "";
    return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, cache: "no-store",
                               body: o.body !== undefined ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        if (r.status === 401) throw Object.assign(new Error("Sign in again: your session has ended."), { status: 401 });
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var fallback = r.status === 403 ? "You may not use this tool." : "HTTP " + r.status;
            throw Object.assign(new Error((data && data.message) || fallback), { status: r.status });
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

  function ok(text) { say("as-alert", ""); say("as-ok", text); }
  function fail(error) { say("as-ok", ""); say("as-alert", error.message); }

  /* --- the badge on the tab button --- */

  function setBadge(count) {
    var badge = $("count-sets");
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count || "";
    badge.parentNode.title = count ? plural(count, "open report", "open reports") : "";
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  window.hvSetsBadge = function () {
    if (!token() || !$("count-sets")) return Promise.resolve();
    return request("/api/admin/armor-sets?status=reported&page=0&size=1").then(function (d) {
      setBadge(d && d.openReports);
    }).catch(function () { /* no badge without the answer */ });
  };

  /* --- the queue --- */

  function metaText(it) {
    var parts = [WEAPONS[it.weaponClass] || "Any weapon", it.band];
    if (it.stage) parts.push(it.stage);
    parts.push(plural(it.votes || 0, "vote", "votes"));
    return parts.join(" · ");
  }

  function who(it) {
    var text = it.account || "unknown account";
    if (it.characterName) text += " (" + it.characterName + ")";
    return text;
  }

  function card(it) {
    var c = el("article", "as-card" + (it.hidden ? " is-hidden" : ""));
    c.setAttribute("data-id", it.id);
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    var body = el("div");
    body.appendChild(el("h3", null, it.title));
    body.appendChild(el("p", "note-text", "by " + who(it) + " · " + metaText(it) + " · " + utc(it.createdAt)));
    c.appendChild(body);
    var side = el("div");
    if (it.openReports) side.appendChild(el("p", "as-reports", plural(it.openReports, "open report", "open reports")));
    if (it.hidden) side.appendChild(el("span", "badge", "Hidden"));
    c.appendChild(side);
    var open = function () { openDetail(it.id); };
    c.addEventListener("click", open);
    c.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    return c;
  }

  function renderList() {
    var box = $("as-list");
    clear(box);
    if (!state.items.length) {
      box.appendChild(el("p", "note-text", state.status === "reported" ? "No sets with open reports."
        : state.status === "hidden" ? "No hidden sets." : "No sets yet."));
    }
    state.items.forEach(function (it) { box.appendChild(card(it)); });
    $("as-note").textContent = plural(state.total, "set", "sets");
    var pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    $("as-pager").hidden = pages <= 1;
    $("as-page-note").textContent = "Page " + (state.page + 1) + " of " + pages;
    $("as-prev").disabled = state.page <= 0;
    $("as-next").disabled = state.page + 1 >= pages;
  }

  function load() {
    var mine = ++seq;
    return request("/api/admin/armor-sets?status=" + state.status + "&page=" + state.page + "&size=" + PAGE_SIZE).then(function (d) {
      if (mine !== seq) return;
      state.items = (d && d.items) || [];
      state.total = (d && d.total) || 0;
      setBadge(d && d.openReports);
      say("as-alert", "");
      renderList();
    }, fail);
  }

  /* --- one set --- */

  function list(items, build) {
    var ul = el("ul", "as-list");
    items.forEach(function (x) { ul.appendChild(build(x)); });
    return ul;
  }

  function reportLine(r) {
    var li = el("li");
    li.appendChild(el("b", null, r.account || "unknown"));
    li.appendChild(document.createTextNode(" · " + utc(r.at) + ": "));
    li.appendChild(document.createTextNode(r.reason || ""));
    var status = r.resolvedAt ? "closed " + utc(r.resolvedAt) + (r.resolvedBy ? " by " + r.resolvedBy : "") +
      (r.resolution ? " (" + r.resolution + ")" : "") : "open";
    li.appendChild(el("br"));
    li.appendChild(el("span", "note-text", status));
    return li;
  }

  function logLine(l) {
    var li = el("li");
    li.appendChild(document.createTextNode(utc(l.at) + " · "));
    li.appendChild(el("b", null, l.account || "system"));
    li.appendChild(document.createTextNode(" " + (l.action || "") + (l.detail ? ": " + l.detail : "")));
    return li;
  }

  function act(path, body, done) {
    say("as-alert", "");
    return request(path, { method: "POST", body: body }).then(function (d) {
      showDetail(d);
      ok(done);
      load();
    }, fail);
  }

  function actions(d) {
    var box = el("div", "cs-actions");
    if (!can("act")) return box;
    var id = d.id;
    if (d.hidden) {
      var unhide = el("button", "btn btn-primary btn-small as-unhide", "Unhide");
      unhide.type = "button";
      unhide.addEventListener("click", function () {
        act("/api/admin/armor-sets/" + id + "/unhide", {}, "Unhidden: the set shows again.");
      });
      box.appendChild(unhide);
    } else {
      var field = el("div", "field");
      var label = el("label", null, "Reason for hiding (required, up to " + MAX_REASON + " characters; the author sees it)");
      label.setAttribute("for", "as-reason");
      var reason = el("textarea", "as-reason");
      reason.id = "as-reason";
      reason.rows = 2;
      reason.maxLength = MAX_REASON;
      field.appendChild(label);
      field.appendChild(reason);
      box.appendChild(field);
      var hide = el("button", "btn btn-primary btn-small as-hide", "Hide this set");
      hide.type = "button";
      hide.addEventListener("click", function () {
        var text = reason.value.trim();
        if (!text) { fail(new Error("Give a reason: the author is shown it.")); reason.focus(); return; }
        act("/api/admin/armor-sets/" + id + "/hide", { reason: text }, "Hidden: the set no longer shows.");
      });
      box.appendChild(hide);
    }
    if (d.openReports) {
      var dismiss = el("button", "ghost-btn small as-dismiss", "Dismiss the reports");
      dismiss.type = "button";
      dismiss.title = "Closes the open reports and keeps the set shown";
      dismiss.addEventListener("click", function () {
        act("/api/admin/armor-sets/" + id + "/dismiss", {}, "Reports dismissed: the set stays as it is.");
      });
      box.appendChild(dismiss);
    }
    return box;
  }

  function showDetail(d) {
    state.openId = d.id;
    $("as-main").hidden = true;
    var box = $("as-detail");
    box.hidden = false;
    clear(box);
    box.className = "as-detail";

    var back = el("button", "ghost-btn small", "Back to the list");
    back.type = "button";
    back.id = "as-detail-close";
    back.addEventListener("click", function () {
      state.openId = null;
      box.hidden = true;
      $("as-main").hidden = false;
      say("as-ok", "");
      load();
    });
    box.appendChild(back);

    var head = el("div", "panel-head");
    head.appendChild(el("h3", "as-title", d.title));
    head.appendChild(d.hidden ? el("span", "badge", "Hidden") : el("span", "panel-note", "Shown"));
    box.appendChild(head);
    box.appendChild(el("p", "note-text", "by " + who(d) + " · " + metaText(d) + " · posted " + utc(d.createdAt) +
      (d.showAuthor ? " · shows the hunter name" : "")));
    if (d.hidden) {
      box.appendChild(el("p", "form-alert", "Hidden" + (d.hiddenBy ? " by " + d.hiddenBy : "") +
        (d.hiddenAt ? " " + utc(d.hiddenAt) : "") + (d.hiddenReason ? ": " + d.hiddenReason : "") + "."));
    }
    if (d.notes) box.appendChild(el("p", "cs-notes", d.notes));
    var links = el("p", "note-text");
    if (window.ArmorCalc && d.set) {
      var a = el("a", null, "Open in the Set builder");
      a.href = "/set-builder.html#s=" + ArmorCalc.encode(d.set);
      links.appendChild(a);
    }
    if (!d.hidden) {
      if (links.firstChild) links.appendChild(document.createTextNode(" · "));
      var pub = el("a", null, "Public page");
      pub.href = "/community-sets.html?id=" + d.id;
      links.appendChild(pub);
    }
    box.appendChild(links);

    box.appendChild(actions(d));

    box.appendChild(el("h4", "cs-sub", "Reports (" + (d.reports || []).length + ")"));
    box.appendChild((d.reports || []).length ? list(d.reports, reportLine) : el("p", "note-text", "No reports."));
    box.appendChild(el("h4", "cs-sub", "Log"));
    box.appendChild((d.log || []).length ? list(d.log, logLine) : el("p", "note-text", "Nothing logged yet."));
  }

  function openDetail(id) {
    say("as-ok", "");
    return request("/api/admin/armor-sets/" + id).then(function (d) { say("as-alert", ""); showDetail(d); }, fail);
  }

  /* --- wiring --- */

  function wire() {
    var chips = $("as-status");
    Array.prototype.forEach.call(chips.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.status = chip.getAttribute("data-status");
        state.page = 0;
        Array.prototype.forEach.call(chips.querySelectorAll(".chip"), function (c) {
          c.setAttribute("aria-pressed", c === chip ? "true" : "false");
        });
        load();
      });
    });
    $("as-refresh").addEventListener("click", function () { load(); });
    $("as-prev").addEventListener("click", function () { if (state.page > 0) { state.page -= 1; load(); } });
    $("as-next").addEventListener("click", function () { state.page += 1; load(); });
  }

  window.startAdminSets = function () {
    if (started) { if (!state.openId) load(); return; }
    started = true;
    wire();
    load();
  };

})();
