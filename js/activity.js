/* Live activity board on the Worlds page: who is online, who is on a quest and which one, from
   GET /api/public/activity (refreshed every 30 seconds, the API's own cache time).

   The answer: {generatedAt, totals{online,inTown,inQuest},
   worlds[{serverId,worldName,land,online,inTown,inQuest,players[{characterName,charId,discordName,status,questId,questName}],
   parties[{questId,members[characterName]}]}]}.
   players is [] when the API is set to counts only. parties (hunters questing together, 2 or more) is
   missing in answers from before the API had it; the board then shows no parties and no "in party" tags. discordName (server nickname, else Discord display
   name) is null when the account is not linked, and missing in answers from before the API had it;
   it is shown as a second line under the character, as text only.

   Each character name (in the rows and in the parties) links to its hunter profile,
   /hunters.html?id=<charId>. charId is missing in answers from before the API had it; the name then
   links to the Hunters page searching for it (/hunters.html?q=) instead. A party lists names only, so
   a member takes the charId of the player with that name in the same world.

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

  /**
   * What the character is doing. The quest's own name when the API knows it (from the game's quest
   * files), else its number; nothing yet while the quest is still loading.
   */
  function questLabel(player) {
    if (player.status !== "quest") return "";
    if (player.questId === null || player.questId === undefined) return "Departing";
    var name = typeof player.questName === "string" ? player.questName.trim() : "";
    return name || "Quest " + player.questId;
  }

  /** A usable character id: a whole number above 0, else null. */
  function charIdOf(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value > 0 ? value : null;
  }

  /**
   * Where a character name links to: the hunter profile when the character id is known, else the
   * Hunters page searching for the name, else "" (no link) for a missing or blank name. Names reach
   * the page only as text and through encodeURIComponent here.
   */
  function hunterHref(name, charId) {
    var id = charIdOf(charId);
    if (id !== null) return "/hunters.html?id=" + id;
    if (typeof name !== "string" || name.trim() === "") return "";
    return "/hunters.html?q=" + encodeURIComponent(name.trim());
  }

  /**
   * Character ids of a world's players by name, for the party members (who come as names only). A
   * name held by two different ids is left out, so it falls back to the name search.
   */
  function worldCharIds(world) {
    var ids = Object.create(null); // no inherited keys: a hunter named "constructor" has no id
    (world.players || []).forEach(function (player) {
      var name = player && player.characterName, id = charIdOf(player && player.charId);
      if (typeof name !== "string" || id === null) return;
      ids[name] = name in ids && ids[name] !== id ? null : id;
    });
    return ids;
  }

  /** A party's quest: its name when known, else its number; null while the quest is still loading. */
  function partyQuestLabel(party) {
    var id = party && party.questId;
    if (!(typeof id === "number" && isFinite(id))) return "Quest loading\u2026";
    var name = party && typeof party.questName === "string" ? party.questName.trim() : "";
    return name || "Quest #" + id;
  }

  /**
   * A world's parties, cleaned up: member names as text (hrefs: their links, same order), and only
   * groups of 2 or more (the API sends
   * only those; a broken entry is skipped rather than shown). None when the world lists no players,
   * so a counts-only API never shows names through its parties.
   */
  function worldParties(world) {
    if (!world || !Array.isArray(world.parties) || !(world.players || []).length) return [];
    var out = [], ids = worldCharIds(world);
    world.parties.forEach(function (party) {
      var members = ((party && Array.isArray(party.members)) ? party.members : []).filter(function (name) {
        return typeof name === "string" && name.trim() !== "";
      });
      if (members.length >= 2) {
        out.push({ quest: partyQuestLabel(party), members: members,
                   hrefs: members.map(function (name) { return hunterHref(name, ids[name]); }) });
      }
    });
    return out;
  }

  /** One block per world that has a party, in the API's world order; [] shows no Parties block. */
  function parties(board) {
    var out = [];
    ((board && board.worlds) || []).forEach(function (world) {
      var list = worldParties(world);
      if (list.length) out.push({ world: worldLabel(world), parties: list });
    });
    return out;
  }

  /** One row per online character, in the API's order (by world, then name). */
  function rows(board) {
    var out = [];
    ((board && board.worlds) || []).forEach(function (world) {
      var partyMembers = Object.create(null); // no inherited keys: a hunter named "constructor" is no member
      worldParties(world).forEach(function (party) {
        party.members.forEach(function (name) { partyMembers[name] = true; });
      });
      (world.players || []).forEach(function (player) {
        out.push({
          name: player.characterName || "Unknown hunter",
          discord: typeof player.discordName === "string" ? player.discordName.trim() : "",
          world: worldLabel(world),
          inQuest: player.status === "quest",
          quest: questLabel(player),
          inParty: partyMembers[player.characterName] === true,
          href: hunterHref(player.characterName, player.charId)
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

  var api = {
    totals: totals, rows: rows, listState: listState, questLabel: questLabel, worldLabel: worldLabel,
    parties: parties, partyQuestLabel: partyQuestLabel, hunterHref: hunterHref
  };
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

  /** A character name: a link to its profile or search when it has one, else plain text. */
  function hunterName(name, href) {
    if (!href) return el("span", null, name);
    var link = el("a", null, name);
    link.href = href;
    return link;
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
    cell.colSpan = 5;
    row.appendChild(cell);
    body.appendChild(row);
  }

  /** How long a player has been on the quest, e.g. "12m" or "1h 4m"; "-" off a quest. */
  function questTime(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    var s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
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
        name.appendChild(hunterName(r.name, r.href));
        if (r.inParty) name.appendChild(el("span", "badge party-tag", "In party"));
        if (r.discord) name.appendChild(el("span", "cell-sub muted", r.discord));
        tr.appendChild(name);
        tr.appendChild(el("td", null, r.world));
        var doing = el("td");
        doing.appendChild(el("span", r.inQuest ? "badge good" : "badge", r.inQuest ? "On a quest" : "In town"));
        tr.appendChild(doing);
        tr.appendChild(el("td", null, r.quest || "-"));
        tr.appendChild(el("td", "num", questTime(r.questSeconds)));
        body.appendChild(tr);
      });
    }
    renderParties(parties(board));
    var at = board && board.generatedAt ? new Date(board.generatedAt) : new Date();
    document.getElementById("live-updated").textContent = "updated " + (isNaN(at) ? new Date() : at).toLocaleTimeString();
  }

  /** The Parties block under the list: one part per world with a party, hidden when there are none. */
  function renderParties(blocks) {
    var box = document.getElementById("live-parties");
    if (!box) return;
    var body = document.getElementById("live-parties-body");
    clear(body);
    blocks.forEach(function (block) {
      var part = el("div", "party-world");
      part.appendChild(el("h3", null, "Parties · " + block.world));
      var list = el("ul", "party-list");
      block.parties.forEach(function (party) {
        var item = el("li");
        item.appendChild(el("span", "party-quest", party.quest));
        var members = el("span", "party-members");
        party.members.forEach(function (member, i) {
          if (i) members.appendChild(document.createTextNode(", "));
          members.appendChild(hunterName(member, party.hrefs[i]));
        });
        item.appendChild(members);
        list.appendChild(item);
      });
      part.appendChild(list);
      body.appendChild(part);
    });
    box.hidden = !blocks.length;
  }

  function fail() {
    renderParties([]);
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
