/* Account: submit a custom quest for approval, and watch its status. Nothing here makes a quest
   playable; an admin does that from the admin panel. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var file = document.getElementById("quest-file");
  var title = document.getElementById("quest-title");
  var send = document.getElementById("quest-submit");
  var note = document.getElementById("quest-submit-note");
  var list = document.getElementById("quest-submit-list");
  if (!file || !send || !list) return;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    note.textContent = text;
    note.classList.toggle("bad", !!bad);
  }

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "-" : d.toLocaleDateString();
  }

  function render(rows) {
    list.innerHTML = "";
    if (!rows || !rows.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.className = "empty-cell";
      td.colSpan = 4;
      td.textContent = "No submissions yet.";
      tr.appendChild(td);
      list.appendChild(tr);
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      [row.title, row.status, row.note || "-", when(row.submittedAt)].forEach(function (value, i) {
        var td = document.createElement("td");
        td.textContent = value;
        if (i === 1) td.className = "cell-sub muted";
        tr.appendChild(td);
      });
      list.appendChild(tr);
    });
  }

  function load() {
    if (!token()) return;
    fetch(API + "/api/account/quest-submissions", {
      headers: { Authorization: "Bearer " + token() }, cache: "no-store"
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(render).catch(function () { render([]); });
  }

  send.addEventListener("click", function () {
    var chosen = file.files && file.files[0];
    if (!chosen) { say("Choose a quest file first.", true); return; }
    if (!token()) { say("Sign in to submit a quest.", true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result).split(",")[1] || "";
      send.disabled = true;
      fetch(API + "/api/account/quest-submissions", {
        method: "POST",
        headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.value.trim(), fileBase64: base64 })
      }).then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, body: body }; });
      }).then(function (res) {
        if (!res.ok) throw new Error(res.body && res.body.message ? res.body.message : "The server refused it.");
        say("Submitted. An admin will review it.", false);
        file.value = "";
        title.value = "";
        load();
      }).catch(function (error) { say(error.message || "Could not submit that file.", true); })
        .then(function () { send.disabled = false; });
    };
    reader.readAsDataURL(chosen);
  });

  load();
})();
