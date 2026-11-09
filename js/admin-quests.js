/* Admin: the custom quest approval queue. Players submit a decompressed quest file; nothing becomes
   playable until an admin approves it here. A testing quest shows when it expires (14 days without
   activity, API README "Custom quest expiry"); a published one stays until an admin retires it here.
   Each quest shows where it is listed (counter and mark, API README "Custom quest listing"); before publishing,
   the admin can change both: any counter, not only the ones the quest builder offers authors. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var status = "testing";
  var started = false;

  /* Counters (event_quests.quest_type) by the names in the website's docs/quest-builder-gap.md: first the ones
     authors may pick (the API's QuestListing.AUTHOR_TYPES), then the event systems with rules of their own
     (Raviente counters make Erupe replace the player cap; Campaign, VS, Festa and Interception are event modes) and
     the ones no live row uses. */
  var COUNTERS = [
    [18, "HR Event"], [24, "Series"], [26, "Daily"], [28, "G Event"], [31, "G Urgent"], [38, "HR Exotic"],
    [39, "G Exotic"], [43, "Superior / Zenith"]
  ];
  var OTHER_COUNTERS = [
    [8, "Festa winners"], [9, "Campaign"], [13, "VS"], [16, "Raviente"], [22, "Raviente violent"],
    [40, "Raviente berserk"], [50, "Raviente extreme"], [51, "Raviente small berserk"], [46, "Interception"],
    [47, "Interception branch"], [48, "Interception urgent"], [30, "G Daily (untested)"],
    [52, "Superior (untested)"], [53, "G Superior (untested)"], [54, "G Armor (untested)"]
  ];
  var MARKS = [[0, "No mark"], [1, "Recommended"], [2, "New"]];

  function counterName(type) {
    var hit = COUNTERS.concat(OTHER_COUNTERS).filter(function (c) { return c[0] === type; })[0];
    return hit ? hit[1] : "Counter " + type;
  }

  function markName(mark) {
    var hit = MARKS.filter(function (m) { return m[0] === mark; })[0];
    return hit ? hit[1] : "Mark " + mark;
  }

  /** A select of [value, label] pairs (optgroups: [[label, pairs], ...]) with value chosen. */
  function select(groups, value, label) {
    var s = el("select", "admin-quest-listing");
    s.setAttribute("aria-label", label);
    var known = groups.some(function (g) { return g[1].some(function (pair) { return pair[0] === value; }); });
    // A value no list names (an older row) stays selected, so publishing does not change it by accident.
    if (!known) groups = [[null, [[value, "(as set)"]]]].concat(groups);
    groups.forEach(function (g) {
      var parent = s;
      if (g[0]) { parent = el("optgroup"); parent.label = g[0]; s.appendChild(parent); }
      g[1].forEach(function (pair) {
        var o = el("option", null, pair[0] + " " + pair[1]);
        o.value = String(pair[0]);
        if (pair[0] === value) o.selected = true;
        parent.appendChild(o);
      });
    });
    return s;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function $(id) { return document.getElementById(id); }

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
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          // The API's reason (e.g. the event quest list is full) is shown as it is.
          return r.json().catch(function () { return {}; }).then(function (b) {
            var e = new Error("HTTP " + r.status);
            e.apiMessage = b && b.message;
            throw e;
          });
        }
        return r.json();
      });
  }

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "-" : d.toLocaleString();
  }

  function kb(size) {
    return size ? Math.max(1, Math.round(size / 1024)) + " KB" : "-";
  }

  function row(item) {
    var tr = el("tr");
    var name = el("td", "cell-name", item.title);
    var listed = typeof item.questType === "number";
    if (listed) {
      name.appendChild(el("span", "cell-sub muted", counterName(item.questType) + " counter"
        + (item.mark ? " \u00b7 " + markName(item.mark) : "")));
    }
    tr.appendChild(name);
    tr.appendChild(el("td", null, item.account || "-"));
    tr.appendChild(el("td", "num", kb(item.size)));
    tr.appendChild(el("td", null, when(item.submittedAt)));
    var st = el("td");
    st.appendChild(el("span", "badge " + (item.status === "approved" ? "good" : ""), item.status));
    if (item.status === "testing" && item.expiresAt) {
      st.appendChild(el("span", "cell-sub muted", " expires " + when(item.expiresAt)));
    }
    tr.appendChild(st);
    tr.appendChild(el("td", "cell-sub muted", item.note || "-"));

    var actions = el("td");
    // New submissions are "testing" (the API sets nothing else before a decision); "pending" is older rows.
    if (item.status === "testing" || item.status === "pending") {
      var counter = null;
      var mark = null;
      if (listed) {
        // The author's choice, changeable before publishing; only a changed value is sent.
        counter = select([[null, COUNTERS], ["Event systems and untested", OTHER_COUNTERS]], item.questType,
          "Counter for " + item.title);
        mark = select([[null, MARKS]], item.mark, "Mark for " + item.title);
        actions.appendChild(counter);
        actions.appendChild(document.createTextNode(" "));
        actions.appendChild(mark);
        actions.appendChild(document.createTextNode(" "));
      }
      var approve = el("button", "btn btn-primary btn-small", "Publish");
      approve.type = "button";
      approve.addEventListener("click", function () {
        var listing = {};
        if (counter && Number(counter.value) !== item.questType) listing.questType = Number(counter.value);
        if (mark && Number(mark.value) !== item.mark) listing.mark = Number(mark.value);
        decide(item.id, true, "", listing);
      });
      var reject = el("button", "ghost-btn small", "Reject");
      reject.type = "button";
      reject.addEventListener("click", function () {
        var note = window.prompt("Why is this quest rejected? The player sees this.", "");
        if (note === null) return;
        decide(item.id, false, note);
      });
      actions.appendChild(approve);
      actions.appendChild(document.createTextNode(" "));
      actions.appendChild(reject);
    } else if (item.status === "approved") {
      var retire = el("button", "ghost-btn small", "Retire");
      retire.type = "button";
      retire.addEventListener("click", function () {
        var why = window.prompt("Retire \u201c" + item.title + "\u201d? It leaves the game for everyone. "
          + "Optional note for the player:", "");
        if (why === null) return;
        request("/api/admin/quest-submissions/" + item.id + "/retire", {
          method: "POST",
          body: JSON.stringify({ note: why })
        }).then(function () { load(); })
          .catch(function () { note2("Could not retire that quest."); });
      });
      actions.appendChild(retire);
    } else if (item.status === "retired") {
      actions.appendChild(el("span", "muted", item.retiredAt ? "retired " + when(item.retiredAt) : "retired"));
    } else {
      actions.appendChild(el("span", "muted", item.reviewedAt ? when(item.reviewedAt) : "-"));
    }
    tr.appendChild(actions);
    return tr;
  }

  /** listing: {questType?, mark?}, sent with an approval only when the admin changed them. */
  function decide(id, approve, note, listing) {
    var payload = { approve: approve, note: note };
    if (listing && listing.questType !== undefined) payload.questType = listing.questType;
    if (listing && listing.mark !== undefined) payload.mark = listing.mark;
    request("/api/admin/quest-submissions/" + id + "/decide", {
      method: "POST",
      body: JSON.stringify(payload)
    }).then(function () { load(); })
      .catch(function (e) { note2(e && e.apiMessage ? e.apiMessage : "Could not save that decision."); });
  }

  /** Approved quests share the in-game event quest list with the festival, Cup and VS quests (API: quest.event-list-cap). */
  function loadSlots() {
    var n = $("quests-slots");
    if (!n) return;
    request("/api/admin/quest-submissions/event-slots").then(function (s) {
      n.textContent = s && typeof s.used === "number" && typeof s.cap === "number"
        ? s.used + " of " + s.cap + " event quest slots used" + (s.used >= s.cap ? ". Publishing is blocked until one is freed." : ".")
        : "";
    }).catch(function () { n.textContent = ""; });
  }

  function note2(text) {
    var n = $("quests-note");
    if (n) n.textContent = text;
  }

  function load() {
    var body = $("quests-body");
    if (!body) return;
    loadSlots();
    body.innerHTML = "";
    var placeholder = el("tr");
    var cell = el("td", "empty-cell", "Loading submissions.");
    cell.colSpan = 7;
    placeholder.appendChild(cell);
    body.appendChild(placeholder);

    request("/api/admin/quest-submissions?status=" + encodeURIComponent(status)).then(function (list) {
      body.innerHTML = "";
      if (!list || !list.length) {
        var tr = el("tr");
        var td = el("td", "empty-cell", "Nothing " + status + " right now.");
        td.colSpan = 7;
        tr.appendChild(td);
        body.appendChild(tr);
        note2("0 submissions");
        return;
      }
      list.forEach(function (item) { body.appendChild(row(item)); });
      note2(list.length + " submission" + (list.length === 1 ? "" : "s"));
    }).catch(function () { note2("Could not load the queue."); });
  }

  function wire() {
    var chips = $("quests-filter");
    if (!chips) return;
    chips.addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      status = chip.getAttribute("data-status");
      Array.prototype.forEach.call(chips.querySelectorAll(".chip"), function (c) {
        c.setAttribute("aria-pressed", String(c === chip));
      });
      load();
    });
  }

  window.startQuestSubmissions = function () {
    if (!started) {
      started = true;
      wire();
    }
    load();
  };
})();
