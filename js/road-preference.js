/* The Roads this account plays: the party Road (Erupe pins it when you open a quest room, unless the room
   picks one in game with !road; every Road quest but the solo one) and the solo Road (the solo half of the
   file, played only by the solo Road quest; empty = the same as the party Road). A Road with partyHidden
   (road_version.party_hidden: "Zenith Road (Solo Zenith)", whose solo half is the solo list's Zenith) is
   left out of the party choices unless it is already this account's party Road; an API without the field
   hides nothing.
   The selects and Save stay disabled until both the Road list and the account's saved Roads are loaded, so
   a late answer never replaces a pick and a failed load never saves blanks. Save first re-reads the saved
   Roads: when they changed since the page loaded (another tab, !road solo in game) it shows them and saves
   nothing. After a save it reads them back and says what is saved. */
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
  var saved = null; // { sha, soloSha } as last read from the API

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    if (!note) return;
    note.textContent = text;
    note.classList.toggle("bad", !!bad);
  }

  function lock(locked) {
    select.disabled = locked;
    if (soloSelect) soloSelect.disabled = locked;
    button.disabled = locked;
  }

  function option(parent, value, text) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    parent.appendChild(o);
    return o;
  }

  function road(sha) {
    return roads.filter(function (v) { return v.sha256 === sha; })[0];
  }

  function partyLabel(v) {
    var state = v.always ? " (always available)" : v.live ? " (live)" : " (retired)";
    return (v.name || "Road") + state;
  }

  function partyName(sha) {
    if (!sha) return "the live Road";
    var v = road(sha);
    return v && v.name ? v.name : sha.slice(0, 8);
  }

  function soloName(sha, partySha) {
    if (!sha) {
      var p = partySha ? road(partySha) : null;
      return "same as the party Road" + (p && p.soloName ? " (" + p.soloName + " solo Road)" : "");
    }
    var v = road(sha);
    if (v && v.soloName) return v.soloName + " solo Road";
    return "solo half of " + partyName(sha);
  }

  function describe(s) {
    return "party Road " + partyName(s.sha) + ", solo Road " + soloName(s.soloSha, s.sha);
  }

  // "Same as my party Road" names the solo Road it gives when the party Road has a solo name of its own.
  function labelSoloDefault() {
    if (!soloSelect || !soloSelect.options.length) return;
    var p = road(select.value);
    soloSelect.options[0].textContent = "Same as my party Road" + (p && p.soloName ? " (" + p.soloName + ")" : "");
  }

  // The account's party Road shows even when it is hidden from the choices, so it can be kept.
  function showParty(sha) {
    if (sha && !Array.prototype.some.call(select.options, function (o) { return o.value === sha; })) {
      var v = road(sha);
      option(select, sha, v ? partyLabel(v) : sha.slice(0, 8));
    }
    select.value = sha || "";
  }

  // A saved solo Road that is not in the list (chosen before its name was set) still shows as itself.
  function showSolo(sha) {
    if (!soloSelect) return;
    if (sha && !Array.prototype.some.call(soloSelect.options, function (o) { return o.value === sha; })) {
      var v = road(sha);
      option(soloSelect, sha, "Solo half of " + (v && v.name ? v.name : sha.slice(0, 8)));
    }
    soloSelect.value = sha || "";
  }

  function show(s) {
    saved = s;
    showParty(s.sha);
    showSolo(s.soloSha);
    labelSoloDefault();
  }

  function loadRoads() {
    return fetch(API + "/api/public/road/versions", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
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

  function readMine() {
    return fetch(API + "/api/account/road-preference", {
      headers: { Authorization: "Bearer " + token() },
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      return { sha: (d && d.sha) || "", soloSha: (d && d.soloSha) || "" };
    });
  }

  function same(a, b) {
    return a.sha === b.sha && (!soloSelect || a.soloSha === b.soloSha);
  }

  // The API's own words for a refused save ("That Road is no longer offered as a party Road..."), if any.
  function refusal(r) {
    return r.json().then(function (d) { return (d && d.message) || ""; }, function () { return ""; });
  }

  select.addEventListener("change", labelSoloDefault);

  button.addEventListener("click", function () {
    if (!token() || !saved) return;
    var want = { sha: select.value, soloSha: soloSelect ? soloSelect.value : saved.soloSha };
    var body = { sha: want.sha };
    if (soloSelect) body.soloSha = want.soloSha;
    lock(true);
    say("Saving...", false);
    readMine().then(function (now) {
      if (!same(now, saved)) {
        show(now);
        say("Your Roads were changed somewhere else since this page loaded (another tab, or !road in game). " +
            "Saved now: " + describe(now) + ". Pick again and save if you want to change them.", true);
        return;
      }
      return fetch(API + "/api/account/road-preference", {
        method: "PUT",
        headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) {
          return refusal(r).then(function (why) {
            say("Could not save" + (why ? ": " + why.replace(/\.?$/, ".") : ". Try again in a moment.") +
                " Still saved: " + describe(saved) + ".", true);
          });
        }
        return readMine().then(function (after) {
          show(after);
          if (!same(after, want)) {
            say("Saved, but the server now has " + describe(after) + ".", true);
            return;
          }
          say("Saved: " + describe(after) + ". New quest rooms you open use the party Road. " +
              "The solo Road applies after you go back to town once: if you are in game, the server sends " +
              "you to town once when you next open a quest room alone.", false);
        }, function () {
          say("Saved, but the saved Roads could not be read back. Reload the page to check them.", true);
        });
      });
    }).catch(function () {
      say("Could not save. Try again in a moment." + (saved ? " Last read: " + describe(saved) + "." : ""), true);
    }).then(function () { lock(false); });
  });

  lock(true);
  if (!token()) {
    say("Sign in to save your Roads.");
    return;
  }
  loadRoads().then(function () {
    return readMine().then(function (mine) {
      show(mine);
      lock(false);
      say("Saved now: " + describe(mine) + ".", false);
    }, function () {
      say("Could not load your saved Roads right now. Reload the page to change them.", true);
    });
  }, function () {
    say("Could not load the Road list. Reload the page to change your Roads.", true);
  });
})();
