/* The Road this account plays by default. Erupe pins it when you open a quest room, unless the room
   picks one in game with !road. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var select = document.getElementById("road-pref-select");
  var note = document.getElementById("road-pref-note");
  var button = document.getElementById("road-pref-save");
  if (!select || !button) return;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle("bad", !!bad);
  }

  function loadRoads() {
    return fetch(API + "/api/public/road/versions", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        select.innerHTML = "";
        var live = document.createElement("option");
        live.value = "";
        live.textContent = "Follow the live Road";
        select.appendChild(live);
        (list || []).forEach(function (v) {
          var o = document.createElement("option");
          o.value = v.sha256;
          var state = v.always ? " (always available)" : v.live ? " (live)" : " (retired)";
          o.textContent = (v.name || "Road") + state;
          select.appendChild(o);
        });
      });
  }

  function loadMine() {
    if (!token()) { say("Sign in to save a Road."); button.disabled = true; return; }
    fetch(API + "/api/account/road-preference", {
      headers: { Authorization: "Bearer " + token() },
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      select.value = d.sha || "";
      say("Saved.", false);
    }).catch(function () { say("Could not load your Road right now.", true); });
  }

  button.addEventListener("click", function () {
    if (!token()) return;
    button.disabled = true;
    fetch(API + "/api/account/road-preference", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify({ sha: select.value })
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      say("Saved. New quest rooms you open will use this Road.", false);
    }).catch(function () { say("Could not save. Try again in a moment.", true); })
      .then(function () { button.disabled = false; });
  });

  loadRoads().then(loadMine).catch(function () { say("Could not load the Road list.", true); });
})();
