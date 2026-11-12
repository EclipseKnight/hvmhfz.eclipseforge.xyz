/* Account: submit a custom quest for approval, and watch its status. Nothing here makes a quest
   playable; an admin does that from the admin panel.

   Expiry (API README "Custom quest expiry"): a testing quest expires after 14 days without activity (the
   submit, a resubmit, "Keep testing", or starting it in game). The API sends expiresAt and remindedAt once
   the 3-day reminder went out; the reminder shows at the top of the page (#quest-reminders) whichever tab is
   open. An expired quest can be resubmitted at any time (canResubmit). Drafts never expire.
   An API without these fields simply shows "-" and no buttons. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var file = document.getElementById("quest-file");
  var title = document.getElementById("quest-title");
  var send = document.getElementById("quest-submit");
  var note = document.getElementById("quest-submit-note");
  var list = document.getElementById("quest-submit-list");
  var draftList = document.getElementById("quest-draft-list");
  var reminders = document.getElementById("quest-reminders");
  if (!file || !send || !list) return;

  var submissions = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function say(target, text, bad) {
    if (!target) return;
    target.textContent = text;
    target.classList.toggle("bad", !!bad);
  }

  // The API's own reason when it sends one ({"message": ...}, from API 5b6d085 on: 400 bad file, 413 too
  // big, 409 duplicate ...), else a plain sentence for the status. A 401 here means the sign-in ran out.
  function refusal(status, body) {
    if (body && typeof body.message === "string" && body.message) return body.message;
    if (status === 401) return "Your sign-in has run out. Sign in again and retry.";
    if (status === 413) return "That file is too big.";
    return "The server refused it (HTTP " + status + ").";
  }

  function call(path, method, payload) {
    var headers = { Authorization: "Bearer " + token() };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    return fetch(API + path, {
      method: method || "GET", headers: headers, cache: "no-store",
      body: payload === undefined ? undefined : JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) throw new Error(refusal(r.status, body));
        return body;
      });
    });
  }

  function when(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (window.HvTime && !isNaN(d)) return HvTime.text(d, { time: false });
    return isNaN(d) ? "-" : d.toLocaleDateString();
  }

  // The date as an element of that tag (a <time> with the UTC time on hover); plain text when empty.
  function whenEl(tag, cls, iso) {
    if (!window.HvTime || !iso || isNaN(new Date(iso))) return el(tag, cls, when(iso));
    var n = HvTime.node(iso, { time: false }, tag);
    if (cls) n.className = cls;
    return n;
  }

  function button(text, primary, onClick) {
    var b = el("button", primary ? "btn btn-primary btn-small" : "ghost-btn small", text);
    b.type = "button";
    b.addEventListener("click", function () {
      b.disabled = true;
      onClick().catch(function () {}).then(function () { b.disabled = false; });
    });
    return b;
  }

  function emptyRow(body, cols, text) {
    var tr = el("tr");
    var td = el("td", "empty-cell", text);
    td.colSpan = cols;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  // ---- actions -------------------------------------------------------------------------------

  function keepQuest(id) {
    return call("/api/account/quest-submissions/" + id + "/keep", "POST").then(function (res) {
      say(note, "Kept: in testing until " + when(res && res.expiresAt) + ".", false);
      return load();
    }).catch(function (error) { say(note, error.message, true); throw error; });
  }

  function resubmit(id) {
    return call("/api/account/quest-submissions/" + id + "/resubmit", "POST").then(function () {
      say(note, "Back in testing for 14 days. Find it in game under Event.", false);
      return load();
    }).catch(function (error) { say(note, error.message, true); throw error; });
  }

  // ---- submissions ---------------------------------------------------------------------------

  function expiryCell(row) {
    var td = el("td", "cell-sub");
    if (row.status === "testing" && row.expiresAt) {
      td.appendChild(whenEl("span", row.remindedAt ? "badge bad" : null, row.expiresAt));
      td.appendChild(document.createTextNode(" "));
      td.appendChild(button("Keep testing", false, function () { return keepQuest(row.id); }));
    } else if (row.status === "expired" && row.canResubmit) {
      td.appendChild(el("span", "muted", "Expired " + when(row.expiredAt) + " "));
      td.appendChild(button("Resubmit", true, function () { return resubmit(row.id); }));
    } else if (row.status === "expired") {
      td.appendChild(el("span", "muted", "File removed"));
    } else {
      td.appendChild(el("span", "muted", "-"));
    }
    return td;
  }

  function render(rows) {
    submissions = rows || [];
    list.innerHTML = "";
    if (!submissions.length) emptyRow(list, 5, "No submissions yet.");
    submissions.forEach(function (row) {
      var tr = el("tr");
      [row.title, row.status, row.note || "-"].forEach(function (value, i) {
        tr.appendChild(el("td", i === 1 ? "cell-sub muted" : null, value));
      });
      var submittedCell = el("td");
      submittedCell.appendChild(whenEl("time", null, row.submittedAt));
      tr.appendChild(submittedCell);
      tr.appendChild(expiryCell(row));
      list.appendChild(tr);
    });
    renderReminders();
  }

  function load() {
    if (!token()) return Promise.resolve();
    return call("/api/account/quest-submissions").then(render).catch(function () { render([]); });
  }

  // ---- drafts (never expire) ----------------------------------------------------------

  function renderDrafts(rows) {
    rows = rows || [];
    draftList.innerHTML = "";
    if (!rows.length) emptyRow(draftList, 2, "No drafts. Start one in the quest builder.");
    rows.forEach(function (row) {
      var tr = el("tr");
      var name = el("td");
      var link = el("a", null, row.title || "Untitled quest");
      link.href = "/quest-editor.html?draft=" + row.id;
      name.appendChild(link);
      tr.appendChild(name);
      var activityCell = el("td");
      activityCell.appendChild(whenEl("time", null, row.lastActivity || row.updatedAt));
      tr.appendChild(activityCell);
      draftList.appendChild(tr);
    });
  }

  function loadDrafts() {
    if (!token() || !draftList) return Promise.resolve();
    return call("/api/account/quest-drafts").then(renderDrafts).catch(function () {
      draftList.innerHTML = "";
      emptyRow(draftList, 2, "Your drafts could not be loaded.");
    });
  }

  // ---- the reminder at the top of the page ---------------------------------------------------

  function renderReminders() {
    if (!reminders) return;
    reminders.innerHTML = "";
    var items = [];
    submissions.forEach(function (row) {
      if (row.status === "testing" && row.remindedAt) {
        items.push({ text: "Your testing quest “" + row.title + "” expires on " + when(row.expiresAt)
          + " unless you play it or keep it.", label: "Keep testing", run: function () { return keepQuest(row.id); } });
      }
    });
    reminders.hidden = !items.length;
    if (!items.length) return;
    var ul = el("ul", "quest-reminder-list");
    items.forEach(function (item) {
      var li = el("li", null, item.text + " ");
      li.appendChild(button(item.label, false, item.run));
      ul.appendChild(li);
    });
    reminders.appendChild(ul);
    var more = el("a", null, "See your custom quests");
    more.href = "#quests";
    reminders.appendChild(more);
  }

  // ---- submit --------------------------------------------------------------------------------

  send.addEventListener("click", function () {
    var chosen = file.files && file.files[0];
    if (!chosen) { say(note, "Choose a quest file first.", true); return; }
    if (!token()) { say(note, "Sign in to submit a quest.", true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result).split(",")[1] || "";
      send.disabled = true;
      call("/api/account/quest-submissions", "POST", { title: title.value.trim(), fileBase64: base64 })
        .then(function () {
          say(note, "Submitted. An admin will review it.", false);
          file.value = "";
          title.value = "";
          load();
        }).catch(function (error) { say(note, error.message || "Could not submit that file.", true); })
        .then(function () { send.disabled = false; });
    };
    reader.readAsDataURL(chosen);
  });

  load();
  loadDrafts();
})();
