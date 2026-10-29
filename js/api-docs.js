/* API page gate and loader: the account, admin and Road reference is served by
 * GET /api/docs/private, which only answers for a moderator or admin. The sign-in token names the
 * account but carries no roles, so the page cannot tell an admin from a player by itself: it asks the
 * server with whatever token it has and shows what the server allows. Players see the public half and
 * a sign-in note; the private HTML never ships in this page. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  // A token that has not expired yet, or "". Only the expiry is read; roles are the server's call.
  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var payload = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.exp && payload.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (error) {
      return "";
    }
  }

  function setPrivate(visible) {
    var docs = document.getElementById("private-docs");
    if (docs) docs.hidden = !visible;
    Array.prototype.forEach.call(document.querySelectorAll(".private-toc"), function (item) {
      item.hidden = !visible;
    });
  }

  function showGate(text) {
    var gate = document.getElementById("api-gate");
    if (gate) {
      if (text) gate.textContent = text;
      gate.hidden = false;
    }
    setPrivate(false);
  }

  function load() {
    var auth = token();
    if (!auth) {
      showGate();
      return;
    }
    fetch(API + "/api/docs/private", { headers: { Authorization: "Bearer " + auth }, cache: "no-store" })
      .then(function (response) {
        if (response.status === 401) throw new Error("signin");
        if (response.status === 403) throw new Error("forbidden");
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (html) {
        var docs = document.getElementById("private-docs");
        docs.innerHTML = html;
        setPrivate(true);
        var gate = document.getElementById("api-gate");
        if (gate) gate.hidden = true;
        if (window.enhanceSortableTables) window.enhanceSortableTables(docs);
        if (window.markScrollableTables) window.markScrollableTables();
        if (location.hash) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
      })
      .catch(function (error) {
        var reason = error && error.message;
        showGate(reason === "forbidden"
          ? "This account cannot read the private endpoints. They are for moderator and admin accounts."
          : reason === "signin"
            ? "Your sign-in has expired. Sign in again on the account page, then reload."
            : "The private reference could not be loaded. Try reloading in a moment.");
      });
  }

  load();
  window.addEventListener("storage", function (event) {
    if (event.key === TOKEN_KEY) load();
  });
})();
