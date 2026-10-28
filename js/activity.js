/* Live activity board on the Worlds page: who is online, who is on a quest and which one, from
   GET /api/public/activity (refreshed every 30 seconds, the API's own cache time).

   The answer: {generatedAt, totals{online,inTown,inQuest},
   worlds[{serverId,worldName,land,online,inTown,inQuest,players[{characterName,discordName,status,questId}]}]}.
   players is [] when the API is set to counts only. discordName (server nickname, else Discord display
   name) is null when the account is not linked, and missing in answers from before the API had it;
   it is shown as a second line under the character, as text only.

   The pure part (rows, totals, labels) also runs under node: dev/check-activity.js tests it. */
(function (root) {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var PATH = "/api/public/activity";
  var REFRESH_MS = 30000;

  function count(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  /** Totals of the board; missing or broken numbers count as 0. */
  function totals(board) {
    var t = (board && board.totals) || {};
    return { online: count(t.online), inTown: count(t.inTown), inQuest: count(t.inQuest) };
  }

  function worldLabel(world) {
    var name = world.worldName || "World";
    return world.land === null || world.land === undefined ? name : name + " · Land " + world.land;
  }

  /** What the character is doing. A quest whose id is not known yet is still loading. */
  function questLabel(player) {
    if (player.status !== "quest") return "";
    return player.questId === null || player.questId === undefined ? "Departing" : "Quest " + player.questId;
  }

  /** One row per online character, in the API's order (by world, then name). */
  function rows(board) {
    var out = [];
    ((board && board.worlds) || []).forEach(function (world) {
      (world.players || []).forEach(function (player) {
        out.push({
          name: player.characterName || "Unknown hunter",
          discord: typeof player.discordName === "string" ? player.discordName.trim() : "",
          world: worldLabel(world),
          inQuest: player.status === "quest",
          quest: questLabel(player)
        });
      });
    });
    return out;
  }

  /**
   * Which message the list shows instead of rows: "empty" (nobody online), "hidden" (people online
   * but the API sends counts only) or "" (show the rows).
   */
  function listState(board) {
    if (rows(board).length) return "";
    return totals(board).online ? "hidden" : "empty";
  }

  var api = { totals: totals, rows: rows, listState: listState, questLabel: questLabel, worldLabel: worldLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ActivityBoard = api;

  if (typeof document === "undefined" || !document.getElementById("live-board")) return;

  // For local testing only: on localhost, ?api=http://localhost:8099 reads a mock
  // (dev/mock-activity.py). Never honoured on the real site.
  function apiBase() {
    var local = ["localhost", "127.0.0.1"].indexOf(window.location.hostname) >= 0;
    var override = new URLSearchParams(window.location.search).get("api");
    return local && override ? override.replace(/\/+$/, "") : API;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var MESSAGES = {
    empty: "Nobody is online right now.",
    hidden: "Names are hidden for now; only the counts are public.",
    error: "The live board is unavailable right now. It tries again every 30 seconds."
  };

  function message(body, text) {
    clear(body);
    var row = el("tr");
    var cell = el("td", "empty-cell", text);
    cell.colSpan = 4;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function setStat(id, value) {
    var card = document.getElementById(id);
    card.classList.remove("skeleton");
    card.querySelector(".stat-value").textContent = value;
  }

  function render(board) {
    var t = totals(board);
    setStat("live-online", t.online.toLocaleString());
    setStat("live-town", t.inTown.toLocaleString());
    setStat("live-quest", t.inQuest.toLocaleString());

    var body = document.getElementById("live-body");
    var state = listState(board);
    if (state) {
      message(body, MESSAGES[state]);
    } else {
      clear(body);
      rows(board).forEach(function (r) {
        var tr = el("tr");
        var name = el("td", "cell-name");
        name.appendChild(el("span", null, r.name));
        if (r.discord) name.appendChild(el("span", "cell-sub muted", r.discord));
        tr.appendChild(name);
        tr.appendChild(el("td", null, r.world));
        var doing = el("td");
        doing.appendChild(el("span", r.inQuest ? "badge good" : "badge", r.inQuest ? "On a quest" : "In town"));
        tr.appendChild(doing);
        tr.appendChild(el("td", null, r.quest || "-"));
        body.appendChild(tr);
      });
    }
    var at = board && board.generatedAt ? new Date(board.generatedAt) : new Date();
    document.getElementById("live-updated").textContent = "updated " + (isNaN(at) ? new Date() : at).toLocaleTimeString();
  }

  function fail() {
    ["live-online", "live-town", "live-quest"].forEach(function (id) { setStat(id, "-"); });
    message(document.getElementById("live-body"), MESSAGES.error);
    document.getElementById("live-updated").textContent = "";
  }

  function load() {
    fetch(apiBase() + PATH, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(render).catch(fail);
  }

  load();
  setInterval(function () {
    if (document.visibilityState === "visible") load();
  }, REFRESH_MS);
})(typeof window !== "undefined" ? window : this);
