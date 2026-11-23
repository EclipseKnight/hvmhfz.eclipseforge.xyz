/* Admin: the Page reports tab. Players send "Report a problem" from the data pages (js/page-report.js): an item they
   got somewhere the page does not list, wrong info, or something else, with where, a description and screenshots.
   Staff read them here: filter by status (New, the default; Confirmed, Fixed, Rejected, All) and page kind, open one
   (the page link, the quest and monster it names, the pictures), then set its status with a staff note. The API is
   /api/admin/page-reports/** (tool key "reports": "view" reads, "act" sets the status; API README "Page reports").
   Who may do what comes from window.hvStaff (js/admin.js): with only "view" no status buttons are drawn; without
   hvStaff (an older API) they show and the API's 403 decides. The badge on the tab is the number of new reports
   (window.hvReportsBadge, called by js/admin.js). Pictures need the sign-in header, so they are fetched as blobs and
   shown from object URLs. Everything players wrote stays text (textContent). */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var PAGE_SIZE = 50;
  var MAX_NOTE = 1000;
  var STATUSES = ["new", "confirmed", "fixed", "rejected"];
  var STATUS_LABELS = { "new": "New", confirmed: "Confirmed", fixed: "Fixed", rejected: "Rejected", all: "All" };
  var PROBLEMS = {
    "missing-source": "Got it somewhere the page doesn't list",
    "wrong-info": "Wrong info",
    other: "Other"
  };
  var KIND_LABELS = {
    item: "Item", equipment: "Equipment", quest: "Quest", monster: "Monster", weapon: "Weapon", skill: "Skill",
    source: "Source", currency: "Currency", sky: "Sky Corridor", armor: "Set builder", page: "Other page"
  };

  var state = { status: "new", kind: "", page: 0, items: [], total: 0, openId: null, urls: [] };
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

  function can(action) { return !window.hvStaff || window.hvStaff.can("reports", action); }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

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

  function failure(r, data) {
    if (r.status === 401) return Object.assign(new Error("Sign in again: your session has ended."), { status: 401 });
    var fallback = r.status === 403 ? "You may not use this tool." : "HTTP " + r.status;
    return Object.assign(new Error((data && data.message) || fallback), { status: r.status });
  }

  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, cache: "no-store",
                               body: o.body !== undefined ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) throw failure(r, data);
          return data;
        });
      });
  }

  function picture(path) {
    return fetch(API + path, { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw failure(r, null);
        return r.blob();
      });
  }

  function say(id, text) {
    var box = $(id);
    box.textContent = text || "";
    box.hidden = !text;
  }

  function ok(text) { say("pr-alert", ""); say("pr-ok", text); }
  function fail(error) { say("pr-ok", ""); say("pr-alert", error.message); }

  /* --- the badge on the tab button --- */

  function setBadge(count) {
    var badge = $("count-reports");
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count || "";
    badge.parentNode.title = count ? plural(count, "new report", "new reports") : "";
  }

  window.hvReportsBadge = function () {
    if (!token() || !$("count-reports")) return Promise.resolve();
    return request("/api/admin/page-reports?status=new&page=0&size=1").then(function (d) {
      setBadge(d && d.counts && d.counts["new"]);
    }).catch(function () { /* no badge without the answer */ });
  };

  /* --- the list --- */

  function kindLabel(kind) { return KIND_LABELS[kind] || kind; }

  function pageTitle(it) {
    return kindLabel(it.kind) + ": " + (it.pageName || it.pageId || it.pageUrl);
  }

  function short(text, n) {
    var t = (text || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  function statusBadge(status) {
    var b = el("span", "badge pr-status-" + status, STATUS_LABELS[status] || status);
    if (status === "fixed" || status === "confirmed") b.className += " good";
    return b;
  }

  function card(it) {
    var c = el("article", "as-card pr-card is-" + it.status);
    c.setAttribute("data-id", it.id);
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    var body = el("div");
    body.appendChild(el("h3", null, pageTitle(it)));
    body.appendChild(el("p", "pr-problem-line", PROBLEMS[it.problem] || it.problem));
    body.appendChild(el("p", "note-text", short(it.description, 160)));
    body.appendChild(el("p", "note-text", "#" + it.id + " · by " + (it.account || "unknown account") + " · " +
      utc(it.createdAt) + (it.files ? " · " + plural(it.files, "picture", "pictures") : "")));
    c.appendChild(body);
    var side = el("div");
    side.appendChild(statusBadge(it.status));
    c.appendChild(side);
    var open = function () { openDetail(it.id); };
    c.addEventListener("click", open);
    c.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    return c;
  }

  function renderChips(counts) {
    var chips = $("pr-status-chips");
    Array.prototype.forEach.call(chips.querySelectorAll(".chip"), function (chip) {
      var s = chip.getAttribute("data-status");
      chip.setAttribute("aria-pressed", s === state.status ? "true" : "false");
      var n = s === "all" ? STATUSES.reduce(function (a, k) { return a + ((counts && counts[k]) || 0); }, 0)
        : (counts && counts[s]) || 0;
      chip.textContent = STATUS_LABELS[s] + " (" + n + ")";
    });
  }

  function renderKinds(kinds) {
    var select = $("pr-kind");
    var keep = state.kind;
    clear(select);
    var all = el("option", null, "Every page kind");
    all.value = "";
    select.appendChild(all);
    var keys = Object.keys(kinds || {});
    if (keep && keys.indexOf(keep) === -1) keys.push(keep);
    keys.sort().forEach(function (k) {
      var o = el("option", null, kindLabel(k) + (kinds && kinds[k] !== undefined ? " (" + kinds[k] + ")" : ""));
      o.value = k;
      select.appendChild(o);
    });
    select.value = keep;
  }

  function renderList(d) {
    var box = $("pr-list");
    clear(box);
    if (d && d.tableReady === false) {
      box.appendChild(el("p", "note-text", "Page reports are not set up yet: the database tables are missing (API db/page-reports.sql)."));
    } else if (!state.items.length) {
      box.appendChild(el("p", "note-text", state.status === "all" ? "No reports yet." :
        "No " + STATUS_LABELS[state.status].toLowerCase() + " reports" + (state.kind ? " for this kind of page." : ".")));
    }
    state.items.forEach(function (it) { box.appendChild(card(it)); });
    $("pr-note").textContent = plural(state.total, "report", "reports");
    var pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    $("pr-pager").hidden = pages <= 1;
    $("pr-page-note").textContent = "Page " + (state.page + 1) + " of " + pages;
    $("pr-prev").disabled = state.page <= 0;
    $("pr-next").disabled = state.page + 1 >= pages;
  }

  function load() {
    var mine = ++seq;
    var q = "?status=" + state.status + "&page=" + state.page + "&size=" + PAGE_SIZE +
      (state.kind ? "&kind=" + encodeURIComponent(state.kind) : "");
    return request("/api/admin/page-reports" + q).then(function (d) {
      if (mine !== seq) return;
      state.items = (d && d.items) || [];
      state.total = (d && d.total) || 0;
      if (!state.kind) setBadge(d && d.counts && d.counts["new"]);
      renderChips(d && d.counts);
      renderKinds(d && d.kinds);
      say("pr-alert", "");
      renderList(d);
    }, fail);
  }

  /* --- one report --- */

  function freeUrls() {
    state.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.urls = [];
  }

  function factRow(dl, label, value) {
    if (value === null || value === undefined || value === "") return;
    dl.appendChild(el("dt", null, label));
    var dd = el("dd");
    if (value.nodeType) dd.appendChild(value); else dd.textContent = value;
    dl.appendChild(dd);
  }

  function link(href, text) {
    var a = el("a", null, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function statusForm(d) {
    var box = el("div", "cs-actions pr-actions");
    if (!can("act")) return box;
    var f = el("div", "field");
    var label = el("label", null, "Staff note (optional, up to " + MAX_NOTE + " characters; staff only)");
    label.setAttribute("for", "pr-note-text");
    var note = el("textarea", "as-reason");
    note.id = "pr-note-text";
    note.rows = 2;
    note.maxLength = MAX_NOTE;
    note.value = d.staffNote || "";
    f.appendChild(label);
    f.appendChild(note);
    box.appendChild(f);
    var row = el("div", "pr-status-buttons");
    STATUSES.forEach(function (s) {
      var b = el("button", s === d.status ? "ghost-btn small" : "btn btn-primary btn-small", "Mark " + STATUS_LABELS[s].toLowerCase());
      b.type = "button";
      b.setAttribute("data-set-status", s);
      if (s === d.status) b.title = "Already " + STATUS_LABELS[s].toLowerCase() + "; saves the note";
      b.addEventListener("click", function () {
        say("pr-alert", "");
        request("/api/admin/page-reports/" + d.id + "/status", { method: "POST", body: { status: s, note: note.value } })
          .then(function (nd) {
            showDetail(nd);
            ok("Report #" + nd.id + ": " + STATUS_LABELS[nd.status].toLowerCase() + ".");
            window.hvReportsBadge();
          }, fail);
      });
      row.appendChild(b);
    });
    box.appendChild(row);
    return box;
  }

  function showDetail(d) {
    state.openId = d.id;
    freeUrls();
    $("pr-main").hidden = true;
    var box = $("pr-detail");
    box.hidden = false;
    clear(box);
    box.className = "as-detail pr-detail";

    var back = el("button", "ghost-btn small", "Back to the list");
    back.type = "button";
    back.id = "pr-detail-close";
    back.addEventListener("click", function () {
      state.openId = null;
      freeUrls();
      box.hidden = true;
      $("pr-main").hidden = false;
      say("pr-ok", "");
      load();
    });
    box.appendChild(back);

    var head = el("div", "pr-detail-head");
    head.appendChild(el("h3", "pr-detail-title", "#" + d.id + " · " + pageTitle(d)));
    head.appendChild(statusBadge(d.status));
    box.appendChild(head);

    var dl = el("dl", "pr-facts");
    factRow(dl, "Problem", PROBLEMS[d.problem] || d.problem);
    var page = el("span");
    page.appendChild(link(d.pageUrl, d.pageUrl));
    factRow(dl, "Page", page);
    factRow(dl, "Where", d.location);
    if (d.questId) factRow(dl, "Quest", link("/quest.html?id=" + d.questId, "Quest #" + d.questId));
    if (d.monster) factRow(dl, "Monster", link("/monster.html?m=" + encodeURIComponent(d.monster), d.monster));
    var by = el("span");
    if (d.account) {
      var who = link("/admin.html#users?q=" + encodeURIComponent(d.account), d.account);
      who.target = "";
      by.appendChild(who);
    } else {
      by.textContent = "account " + d.userId;
    }
    by.appendChild(document.createTextNode(" · " + utc(d.createdAt)));
    factRow(dl, "Sent by", by);
    if (d.statusBy) factRow(dl, "Status", STATUS_LABELS[d.status] + " by " + d.statusBy + " · " + utc(d.statusAt));
    box.appendChild(dl);

    box.appendChild(el("h4", "cs-sub", "Description"));
    box.appendChild(el("p", "cs-notes", d.description));
    if (d.staffNote) {
      box.appendChild(el("h4", "cs-sub", "Staff note"));
      box.appendChild(el("p", "cs-notes", d.staffNote));
    }

    var pics = d.pictures || [];
    box.appendChild(el("h4", "cs-sub", "Pictures (" + pics.length + ")"));
    if (!pics.length) box.appendChild(el("p", "note-text", "No pictures."));
    var grid = el("div", "pr-pictures");
    pics.forEach(function (p) {
      var a = el("a", "pr-picture");
      a.target = "_blank";
      a.rel = "noopener";
      var img = el("img");
      img.alt = "Picture " + p.n + " of report #" + d.id;
      a.appendChild(img);
      a.appendChild(el("span", "note-text", "Picture " + p.n + " · " + Math.round((p.bytes || 0) / 1024) + " KB"));
      grid.appendChild(a);
      var id = d.id;
      picture("/api/admin/page-reports/" + id + "/files/" + p.n).then(function (blob) {
        if (state.openId !== id) return;
        var url = URL.createObjectURL(blob);
        state.urls.push(url);
        img.src = url;
        a.href = url;
      }, function (error) {
        img.replaceWith(el("span", "form-alert", error.message));
      });
    });
    box.appendChild(grid);

    box.appendChild(statusForm(d));
  }

  function openDetail(id) {
    say("pr-ok", "");
    return request("/api/admin/page-reports/" + id).then(function (d) { say("pr-alert", ""); showDetail(d); }, fail);
  }

  /* --- wiring --- */

  function wire() {
    var chips = $("pr-status-chips");
    Array.prototype.forEach.call(chips.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.status = chip.getAttribute("data-status");
        state.page = 0;
        load();
      });
    });
    $("pr-kind").addEventListener("change", function () {
      state.kind = $("pr-kind").value;
      state.page = 0;
      load();
    });
    $("pr-refresh").addEventListener("click", function () { load(); });
    $("pr-prev").addEventListener("click", function () { if (state.page > 0) { state.page -= 1; load(); } });
    $("pr-next").addEventListener("click", function () { state.page += 1; load(); });
  }

  window.startAdminReports = function () {
    if (started) { if (!state.openId) load(); return; }
    started = true;
    wire();
    load();
  };
})();
