/* API page gate and loader: the account, admin and Road reference is served by
 * GET /api/docs/private, which only answers for a moderator or admin token. Players see the public
 * half and a sign-in note; the private HTML never ships in this page. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var payload = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.exp || payload.exp * 1000 <= Date.now() + 30000) return "";
      return { raw: value, roles: payload.roles || [] };
    } catch (error) {
      return "";
    }
  }

  function showGate(text) {
    var gate = document.getElementById("api-gate");
    if (gate) {
      gate.textContent = text || gate.textContent;
      gate.hidden = false;
    }
    var docs = document.getElementById("private-docs");
    if (docs) docs.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll(".private-toc"), function (item) {
      item.hidden = true;
    });
  }

  function load() {
    var auth = token();
    var allowed = auth && (auth.roles.indexOf("ROLE_ADMIN") >= 0 || auth.roles.indexOf("ROLE_MODERATOR") >= 0);
    if (!allowed) {
      showGate();
      return;
    }
    fetch(API + "/api/docs/private", { headers: { Authorization: "Bearer " + auth.raw }, cache: "no-store" })
      .then(function (response) {
        if (response.status === 401 || response.status === 403) throw new Error("forbidden");
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(function (html) {
        var docs = document.getElementById("private-docs");
        docs.innerHTML = html;
        docs.hidden = false;
        var gate = document.getElementById("api-gate");
        if (gate) gate.hidden = true;
        Array.prototype.forEach.call(document.querySelectorAll(".private-toc"), function (item) {
          item.hidden = false;
        });
        if (window.enhanceSortableTables) window.enhanceSortableTables(docs);
        if (window.markScrollableTables) window.markScrollableTables();
      })
      .catch(function (error) {
        showGate(error && error.message === "forbidden"
          ? "This account cannot read the private endpoints. Sign in with a moderator or admin account to see them."
          : "The private reference could not be loaded. Try reloading in a moment.");
      });
  }

  load();
  window.addEventListener("storage", load);
  window.addEventListener("pageshow", load);
})();
