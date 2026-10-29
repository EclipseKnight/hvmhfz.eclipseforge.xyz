/* API page gate: the account, admin and Road sections exist in the page but stay hidden unless the
 * visitor is signed in with a moderator or admin account. The server checks every route anyway; this
 * only keeps the private half of the documentation out of sight for players. Sign out in another
 * tab (or the account page) and this hides again on reload. */
(function () {
  "use strict";

  var TOKEN_KEY = "hvmhfz.token";

  function roles() {
    try {
      var token = localStorage.getItem(TOKEN_KEY) || "";
      var payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload.exp || payload.exp * 1000 <= Date.now() + 30000) return [];
      return payload.roles || [];
    } catch (error) {
      return [];
    }
  }

  function apply() {
    var list = roles();
    var allowed = list.indexOf("ROLE_ADMIN") >= 0 || list.indexOf("ROLE_MODERATOR") >= 0;
    var privateDocs = document.getElementById("private-docs");
    var gate = document.getElementById("api-gate");
    if (privateDocs) privateDocs.hidden = !allowed;
    if (gate) gate.hidden = allowed;
    Array.prototype.forEach.call(document.querySelectorAll(".private-toc"), function (item) {
      item.hidden = !allowed;
    });
    var toc = document.querySelector(".toc");
    if (toc) toc.hidden = false;
  }

  apply();
  window.addEventListener("storage", apply);
  window.addEventListener("pageshow", apply);
})();
