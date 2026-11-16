/* The Roads this account plays: the party Road (Erupe pins it when you open a quest room, unless the room
   picks one in game with !road; every Road quest but the solo one) and the solo Road (the solo half of the
   file, played only by the solo Road quest; empty = the same as the party Road). A Road with partyHidden
   (road_version.party_hidden: "Zenith Road (Solo Zenith)", whose solo half is the solo list's Zenith) is
   left out of the party choices unless it is already this account's party Road; an API without the field
   hides nothing. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var select = document.getElementById("road-pref-select");
  var soloSelect = document.getElementById("road-pref-solo-select");
  var note = document.getElementById("road-pref-note");
  var button = document.getElementById("road-pref-save");
  if (!select || !button) return;

  var roads = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle("bad", !!bad);
  }

  function option(parent, value, text) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    parent.appendChild(o);
    return o;
  }

  function partyLabel(v) {
    var state = v.always ? " (always available)" : v.live ? " (live)" : " (retired)";
    return (v.name || "Road") + state;
  }

  // The account's party Road shows even when it is hidden from the choices, so it can be kept.
  function showParty(sha) {
    if (sha && !Array.prototype.some.call(select.options, function (o) { return o.value === sha; })) {
      var road = roads.filter(function (v) { return v.sha256 === sha; })[0];
      option(select, sha, road ? partyLabel(road) : sha.slice(0, 8));
    }
    select.value = sha || "";
  }

  function loadRoads() {
    return fetch(API + "/api/public/road/versions", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        roads = list || [];
        select.innerHTML = "";
        option(select, "", "Follow the live Road");
        roads.filter(function (v) { return !v.partyHidden; }).forEach(function (v) {
          option(select, v.sha256, partyLabel(v));
        });
        if (!soloSelect) return;
        // Each different solo half once: the Roads with a solo name, oldest first like the game's !road solo.
        soloSelect.innerHTML = "";
        option(soloSelect, "", "Same as my party Road");
        roads.filter(function (v) { return v.soloName; }).reverse().forEach(function (v) {
          option(soloSelect, v.sha256, v.soloName + " solo Road");
        });
      });
  }

  // A saved solo Road that is not in the list (chosen before its name was set) still shows as itself.
  function showSolo(sha) {
    if (!soloSelect) return;
    if (sha && !Array.prototype.some.call(soloSelect.options, function (o) { return o.value === sha; })) {
      var road = roads.filter(function (v) { return v.sha256 === sha; })[0];
      option(soloSelect, sha, "Solo half of " + (road && road.name ? road.name : sha.slice(0, 8)));
    }
    soloSelect.value = sha || "";
  }

  function loadMine() {
    if (!token()) { say("Sign in to save your Roads."); button.disabled = true; return; }
    fetch(API + "/api/account/road-preference", {
      headers: { Authorization: "Bearer " + token() },
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      showParty(d.sha || "");
      showSolo(d.soloSha || "");
      say("Saved.", false);
    }).catch(function () { say("Could not load your Roads right now.", true); });
  }

  button.addEventListener("click", function () {
    if (!token()) return;
    button.disabled = true;
    var body = { sha: select.value };
    if (soloSelect) body.soloSha = soloSelect.value;
    fetch(API + "/api/account/road-preference", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      say("Saved. New quest rooms you open use the party Road; the solo Road applies from your next Road quest.", false);
    }).catch(function () { say("Could not save. Try again in a moment.", true); })
      .then(function () { button.disabled = false; });
  });

  loadRoads().then(loadMine).catch(function () { say("Could not load the Road list.", true); });
})();
