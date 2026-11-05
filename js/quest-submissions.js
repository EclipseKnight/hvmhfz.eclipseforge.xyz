/* Account: submit a custom quest for approval, and watch its status. Nothing here makes a quest
   playable; an admin does that from the admin panel.

   Expiry (API README "Custom quest expiry"): a testing quest expires after 14 days without activity (the
   submit, a resubmit, "Keep testing", or starting it in game), a draft is deleted after 90 days untouched.
   The API sends expiresAt for both and remindedAt once the 3-day reminder went out; the reminders show
   at the top of the page (#quest-reminders) whichever tab is open. An expired quest can be resubmitted
   while its file is kept (canResubmit, fileKeptUntil); a deleted draft can be restored for 30 days.
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
  var draftNote = document.getElementById("quest-draft-note");
  var deletedWrap = document.getElementById("quest-deleted-wrap");
  var deletedList = document.getElementById("quest-deleted-list");
  var reminders = document.getElementById("quest-reminders");
  if (!file || !send || !list) return;

  var submissions = [];
  var drafts = [];

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
    return isNaN(d) ? "-" : d.toLocaleDateString();
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

  function keepDraft(id) {
    return call("/api/account/quest-drafts/" + id + "/keep", "POST").then(function (res) {
      say(draftNote, "Kept until " + when(res && res.expiresAt) + ".", false);
      return loadDrafts();
    }).catch(function (error) { say(draftNote, error.message, true); throw error; });
  }

  function restoreDraft(id) {
    return call("/api/account/quest-drafts/" + id + "/restore", "POST").then(function () {
      say(draftNote, "Restored. It is back in the quest builder.", false);
      return loadDrafts();
    }).catch(function (error) { say(draftNote, error.message, true); throw error; });
  }

  // ---- submissions ---------------------------------------------------------------------------

  function expiryCell(row) {
    var td = el("td", "cell-sub");
    if (row.status === "testing" && row.expiresAt) {
      td.appendChild(el("span", row.remindedAt ? "badge bad" : null, when(row.expiresAt)));
      td.appendChild(document.createTextNode(" "));
      td.appendChild(button("Keep testing", false, function () { return keepQuest(row.id); }));
    } else if (row.status === "expired" && row.canResubmit) {
      td.appendChild(el("span", "muted", "File kept until " + when(row.fileKeptUntil) + " "));
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
      [row.title, row.status, row.note || "-", when(row.submittedAt)].forEach(function (value, i) {
        tr.appendChild(el("td", i === 1 ? "cell-sub muted" : null, value));
      });
      tr.appendChild(expiryCell(row));
      list.appendChild(tr);
    });
    renderReminders();
  }

  function load() {
    if (!token()) return Promise.resolve();
    return call("/api/account/quest-submissions").then(render).catch(function () { render([]); });
  }

  // ---- drafts --------------------------------------------------------------------------------

  function renderDrafts(rows) {
    drafts = rows || [];
    draftList.innerHTML = "";
    if (!drafts.length) emptyRow(draftList, 4, "No drafts. Start one in the quest builder.");
    drafts.forEach(function (row) {
      var tr = el("tr");
      var name = el("td");
      var link = el("a", null, row.title || "Untitled quest");
      link.href = "/quest-editor.html?draft=" + row.id;
      name.appendChild(link);
      tr.appendChild(name);
      tr.appendChild(el("td", null, when(row.lastActivity || row.updatedAt)));
      var expires = el("td", "cell-sub");
      expires.appendChild(el("span", row.remindedAt ? "badge bad" : null, when(row.expiresAt)));
      tr.appendChild(expires);
      var actions = el("td");
      if (row.expiresAt) actions.appendChild(button("Keep", false, function () { return keepDraft(row.id); }));
      tr.appendChild(actions);
      draftList.appendChild(tr);
    });
    renderReminders();
  }

  function renderDeleted(rows) {
    if (!deletedWrap || !deletedList) return;
    deletedList.innerHTML = "";
    deletedWrap.hidden = !(rows && rows.length);
    (rows || []).forEach(function (row) {
      var tr = el("tr");
      tr.appendChild(el("td", null, row.title || "Untitled quest"));
      tr.appendChild(el("td", null, when(row.deletedAt)));
      tr.appendChild(el("td", null, when(row.purgeAt)));
      var actions = el("td");
      actions.appendChild(button("Restore", true, function () { return restoreDraft(row.id); }));
      tr.appendChild(actions);
      deletedList.appendChild(tr);
    });
  }

  function loadDrafts() {
    if (!token() || !draftList) return Promise.resolve();
    var live = call("/api/account/quest-drafts").then(renderDrafts).catch(function () {
      draftList.innerHTML = "";
      emptyRow(draftList, 4, "Your drafts could not be loaded.");
    });
    // An API from before the expiry has no deleted list (an error): the section stays hidden.
    var gone = call("/api/account/quest-drafts/deleted").then(renderDeleted).catch(function () { renderDeleted([]); });
    return Promise.all([live, gone]);
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
    drafts.forEach(function (row) {
      if (row.remindedAt) {
        items.push({ text: "Your quest draft “" + (row.title || "Untitled quest") + "” will be deleted on "
          + when(row.expiresAt) + " unless you open or keep it.", label: "Keep",
          run: function () { return keepDraft(row.id); } });
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
