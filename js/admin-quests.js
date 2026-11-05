/* Admin: the custom quest approval queue. Players submit a decompressed quest file; nothing becomes
   playable until an admin approves it here. A testing quest shows when it expires (14 days without
   activity, API README "Custom quest expiry"); a published one stays until an admin retires it here. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var status = "testing";
  var started = false;

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
    tr.appendChild(el("td", "cell-name", item.title));
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
      var approve = el("button", "btn btn-primary btn-small", "Publish");
      approve.type = "button";
      approve.addEventListener("click", function () { decide(item.id, true, ""); });
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

  function decide(id, approve, note) {
    request("/api/admin/quest-submissions/" + id + "/decide", {
      method: "POST",
      body: JSON.stringify({ approve: approve, note: note })
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
