/* The Road drafts workspace: unfinished builders that survive a closed browser. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var list = document.getElementById("road-drafts-list");
  var save = document.getElementById("road-draft-save");
  var note = document.getElementById("road-drafts-note");
  if (!list || !save) return;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle("bad", !!bad);
  }

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString();
  }

  function row(draft) {
    var tr = document.createElement("tr");
    var name = document.createElement("td");
    var a = document.createElement("a");
    a.href = "/road.html?draft=" + encodeURIComponent(draft.id);
    a.textContent = draft.name || "Untitled Road";
    name.appendChild(a);
    tr.appendChild(name);
    var edited = document.createElement("td");
    edited.className = "muted";
    edited.textContent = when(draft.updatedAt);
    tr.appendChild(edited);
    var actions = document.createElement("td");
    var del = document.createElement("button");
    del.type = "button";
    del.className = "ghost-btn small";
    del.textContent = "Delete";
    del.addEventListener("click", function () {
      if (!window.confirm("Delete the draft \"" + (draft.name || "Untitled Road") + "\"? This cannot be undone.")) return;
      fetch(API + "/api/account/road-drafts/" + draft.id, {
        method: "DELETE", headers: { Authorization: "Bearer " + token() }
      }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); load(); });
    });
    actions.appendChild(del);
    tr.appendChild(actions);
    return tr;
  }

  function load() {
    if (!token()) { list.innerHTML = ""; say("Sign in to keep drafts.", true); return; }
    fetch(API + "/api/account/road-drafts", {
      headers: { Authorization: "Bearer " + token() }, cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (drafts) {
      list.innerHTML = "";
      if (!drafts || !drafts.length) {
        var tr = document.createElement("tr");
        var td = document.createElement("td");
        td.colSpan = 3;
        td.className = "empty-cell";
        td.textContent = "No drafts yet. Save one below and it will be here next time.";
        tr.appendChild(td);
        list.appendChild(tr);
        return;
      }
      drafts.forEach(function (d) { list.appendChild(row(d)); });
      say(drafts.length + " draft" + (drafts.length === 1 ? "" : "s"), false);
    }).catch(function () { say("Could not load your drafts right now.", true); });
  }

  save.addEventListener("click", function () {
    if (!token() || !window.roadDraftState) return;
    var state = window.roadDraftState();
    var id = window.roadDraftId ? window.roadDraftId() : null;
    var body = JSON.stringify({ name: state.name, data: state.edits });
    var url = API + "/api/account/road-drafts" + (id ? "/" + id : "");
    var method = id ? "PUT" : "POST";
    save.disabled = true;
    fetch(url, {
      method: method,
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (window.roadDraftSaved && d.id) window.roadDraftSaved(d.id);
      say("Draft saved.", false);
      load();
    }).catch(function () { say("Could not save the draft. Try again in a moment.", true); })
      .then(function () { save.disabled = false; });
  });


  // Autosave: every 15 seconds, if the builder changed, quietly write it to the same draft. No version is
  // created, nothing is submitted; this is only so a closed tab costs at most a quarter of a minute.
  var lastSent = "";
  function autosave() {
    if (!token() || !window.roadDraftState) return;
    var state = window.roadDraftState();
    var blob = JSON.stringify(state.edits || {});
    if (blob === "{}" || blob === lastSent) return;
    var id = window.roadDraftId ? window.roadDraftId() : null;
    var url = API + "/api/account/road-drafts" + (id ? "/" + id : "");
    fetch(url, {
      method: id ? "PUT" : "POST",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.name, data: state.edits })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      lastSent = blob;
      if (window.roadDraftSaved && d.id) window.roadDraftSaved(d.id);
      say("Saved " + new Date().toLocaleTimeString(), false);
      load();
    }).catch(function () { say("Autosave is waiting for a connection.", true); });
  }
  window.setInterval(autosave, 15000);

  if (window.roadDraftState) load();
  else window.addEventListener("load", load);
})();
