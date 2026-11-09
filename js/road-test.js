/* Test in game: the Road builder's design served to the player's own account (and the quest rooms they
   host) for a while, before the vote. The API builds it with the submission rules (PUT
   /api/account/road-test); the game server serves it and saves nothing of those runs. The panel stays
   hidden while the live setting road_test is off. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var panel = document.getElementById("road-test-panel");
  var start = document.getElementById("road-test-start");
  var stop = document.getElementById("road-test-stop");
  var note = document.getElementById("road-test-note");
  var state = document.getElementById("road-test-state");
  var hours = document.getElementById("road-test-hours");
  if (!panel || !start || !stop) return;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    note.textContent = text;
    note.classList.toggle("bad", !!bad);
  }

  // The API's reason, with the rule problems it lists for a Road that does not pass.
  function refusal(status, body) {
    if (body && typeof body.message === "string" && body.message) {
      var problems = (body.problems || []).map(function (p) { return p && p.message; }).filter(Boolean);
      return body.message + (problems.length ? " " + problems.slice(0, 3).join(" ") : "");
    }
    if (status === 401) return "Your sign-in has run out. Sign in again and retry.";
    return "The test could not be started (HTTP " + status + "). Try again in a moment.";
  }

  function call(method, body) {
    return fetch(API + "/api/account/road-test", {
      method: method,
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.json().catch(function () { return null; }).then(function (data) {
        var error = new Error(refusal(r.status, data));
        error.refused = true;
        throw error;
      });
    });
  }

  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString();
  }

  function show(view) {
    // Hidden while the switch is off, unless a test from before is still running (so it can be stopped).
    panel.hidden = !view || (!view.enabled && !view.test);
    if (panel.hidden) return;
    if (hours) hours.textContent = String(view.hours || 24);
    start.disabled = !view.enabled;
    stop.hidden = !view.test;
    state.textContent = view.test
      ? "testing \"" + view.test.name + "\" until " + when(view.test.expiresAt)
      : "no test running";
  }

  function load() {
    if (!token()) return;
    call("GET").then(show).catch(function () { panel.hidden = true; });
  }

  start.addEventListener("click", function () {
    if (!window.roadDraftState) return;
    var design = window.roadDraftState();
    var name = (design.name || "").trim();
    if (name.length < 3) { say("Give the Road a name first (3 to 40 characters): it is shown in game chat.", true); return; }
    start.disabled = true;
    say("Building the test Road...", false);
    call("PUT", { name: name, edits: design.edits || {} }).then(function (view) {
      show(view);
      say("Ready. Log in to the game again (or log in now), then go to the Hunting Road. Your quest rooms use this Road; anyone who joins plays it too.", false);
    }).catch(function (error) {
      say(error.refused ? error.message : "The test could not be started. Try again in a moment.", true);
      start.disabled = false;
    });
  });

  stop.addEventListener("click", function () {
    stop.disabled = true;
    call("DELETE").then(function (view) {
      show(view);
      say("Stopped. Log in again to go back to the live Road; until then the game keeps your session as practice.", false);
    }).catch(function (error) {
      say(error.refused ? error.message : "Could not stop the test. Try again in a moment.", true);
    }).then(function () { stop.disabled = false; });
  });

  if (window.roadDraftState) load();
  else window.addEventListener("load", load);
})();
