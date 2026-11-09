/* "Game options" card on the Account tab: one switch per display-only client feature from
   GET /api/account/qol (the list comes from the API, nothing is hard-coded here). A toggle saves at once with
   PUT /api/account/qol {id: true|false}. The game reads the choice at the next login. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var list = document.getElementById("qol-list");
  var note = document.getElementById("qol-note");
  var alertNode = document.getElementById("qol-alert");
  if (!list) return;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function say(text, bad) {
    note.textContent = text || "";
    alertNode.hidden = !bad;
    alertNode.textContent = bad ? text : "";
    if (bad) note.textContent = "";
  }

  function render(data) {
    list.innerHTML = "";
    (data.features || []).forEach(function (f) {
      var row = el("div", "qol-item");
      var label = el("label", "qol-label");
      var box = el("input");
      box.type = "checkbox";
      box.setAttribute("role", "switch");
      box.id = "qol-" + f.id;
      box.checked = !!f.enabled;
      label.htmlFor = box.id;
      label.appendChild(box);
      label.appendChild(el("span", "qol-name", f.name));
      row.appendChild(label);
      row.appendChild(el("p", "note-text qol-desc", f.description));
      if (f.minPatch) row.appendChild(el("p", "note-text qol-patch", "Needs client patch v" + f.minPatch + " or newer"));
      if (f.revealsHiddenInfo) row.appendChild(el("p", "note-text qol-hidden", "Shows information the game normally hides"));
      box.addEventListener("change", function () { save(f, box); });
      list.appendChild(row);
    });
    if (!(data.features || []).length) list.appendChild(el("p", "note-text", "No options are available yet."));
  }

  function save(feature, box) {
    var body = {};
    body[feature.id] = box.checked;
    box.disabled = true;
    say("Saving.");
    fetch(API + "/api/account/qol", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      render(data);
      say("Saved. " + feature.name + " is " + (box.checked ? "on" : "off") + " from your next login to the game.");
    }).catch(function () {
      box.checked = !box.checked;
      box.disabled = false;
      say("Could not save. Try again in a moment.", true);
    });
  }

  function load() {
    if (!token()) { say("Sign in to change your game options."); list.innerHTML = ""; return; }
    fetch(API + "/api/account/qol", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(render)
      .catch(function () {
        list.innerHTML = "";
        say("Your game options could not be loaded right now.", true);
      });
  }

  load();
})();
