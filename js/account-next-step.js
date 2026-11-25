/* Account page, Characters tab: "Your next step" for the character shown in the character view
   (js/account-details.js tells this script which one with the "hv:character" event).

   GET /api/account/characters/{id}/next-step (API README "Next step"; the account's own characters, admins
   any) answers the words the Discord bot's /next shows too: summary, recommended, details, notes (the coming
   game update) and links (website paths). This script only lays them out; it never words anything itself,
   so the panel and the bot always say the same.

   An answer with "overlay" (the API that also feeds the in-game guide window) ends with one line of the site's
   own, "Also in game: ..." (above the links), pointing at the Guide window option (Game options tab or Ctrl+F10).

   A 404 hides the panel (an API without the endpoint, or a character this account cannot see); other
   failures say so with Try again. The helpers at the top also run under node (dev/check-next-step.js). */
(function (root) {
  "use strict";

  /* Only paths on this site become links: "/quest.html?id=1" yes, "//host", "https:" or "javascript:" no. */
  function sitePath(href) {
    var text = String(href || "");
    return /^\/(?!\/)[^\s\\]*$/.test(text) ? text : null;
  }

  /* The answer as the panel shows it: every part a list of plain strings or {label, href}, missing ones empty. */
  function view(answer) {
    var a = answer || {};
    var list = function (value) { return Array.isArray(value) ? value.filter(function (x) { return x; }) : []; };
    return {
      name: a.characterName || "",
      summary: a.summary || "",
      recommended: a.recommended || "",
      details: list(a.details).map(String),
      notes: list(a.notes).map(String),
      links: list(a.links).map(function (link) {
        return { label: String(link.label || link.href || ""), href: sitePath(link.href) };
      }).filter(function (link) { return link.href && link.label; }),
      inGame: !!(a.overlay && typeof a.overlay === "object")
    };
  }

  var Helpers = { sitePath: sitePath, view: view };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = Helpers;
    return;
  }
  root.HvNextStep = Helpers;

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("next-step-panel");
  if (!panel) return;
  var note = $("next-step-note");
  var body = $("next-step-body");
  var loading = 0;
  var currentId = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function render(answer) {
    var v = view(answer);
    clear(body);
    note.textContent = v.name;
    if (v.summary) body.appendChild(el("p", "next-step-summary", v.summary));
    if (v.recommended) {
      var rec = el("p", "next-step-rec");
      rec.appendChild(el("strong", null, "Recommended: "));
      rec.appendChild(document.createTextNode(v.recommended));
      body.appendChild(rec);
    }
    if (v.details.length) {
      var ul = el("ul", "next-step-details");
      v.details.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      body.appendChild(ul);
    }
    v.notes.forEach(function (line) { body.appendChild(el("p", "next-step-note", line)); });
    if (v.inGame) {
      var game = el("p", "note-text next-step-ingame", "Also in game: the Guide window shows your next step in town. Set it in ");
      var options = el("a", null, "Game options");
      options.href = "#game-options";
      game.appendChild(options);
      game.appendChild(document.createTextNode(" or with Ctrl+F10."));
      body.appendChild(game);
    }
    if (v.links.length) {
      var links = el("ul", "next-step-links");
      v.links.forEach(function (link) {
        var li = el("li");
        var a = el("a", null, link.label);
        a.href = link.href;
        li.appendChild(a);
        links.appendChild(li);
      });
      body.appendChild(links);
    }
  }

  function failed(text, retry) {
    clear(body);
    note.textContent = "";
    body.appendChild(el("p", "form-alert", text));
    if (retry) {
      var button = el("button", "ghost-btn small", "Try again");
      button.type = "button";
      button.addEventListener("click", function () { load(currentId); });
      body.appendChild(button);
    }
  }

  function load(id) {
    if (!id) return;
    var token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    var ticket = ++loading;
    currentId = String(id);
    panel.hidden = false;
    note.textContent = "loading";
    clear(body);
    body.appendChild(el("span", "skeleton-line w80"));
    fetch(API + "/api/account/characters/" + encodeURIComponent(id) + "/next-step",
      { headers: { Authorization: "Bearer " + token } })
      .then(function (response) {
        if (ticket !== loading) return;
        if (response.status === 404) { panel.hidden = true; return; }
        if (response.status === 401) { failed("Your sign-in ran out. Sign in again to see your next step."); return; }
        if (!response.ok) { failed("Could not work out the next step right now.", true); return; }
        return response.json().then(function (answer) { if (ticket === loading) render(answer); });
      })
      .catch(function () {
        if (ticket === loading) failed("Could not work out the next step right now.", true);
      });
  }

  document.addEventListener("hv:character", function (event) { load(event.detail && event.detail.id); });
})(typeof window !== "undefined" ? window : this);
