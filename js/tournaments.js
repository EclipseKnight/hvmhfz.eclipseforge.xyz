/* Tournaments page: the Speedrun Cup standings (/api/public/tournament/standings) and the VS Bracket
   (/api/public/vs-bracket/current). Shapes: the API's README, section "Event schedules". Both are optional:
   an API without them (404, error) or with null data shows a calm "not running yet" note per section.
   Names are player-chosen, so everything goes in with textContent. The pure helpers also run under node
   (dev/check-tournaments.js). */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

  function shortDate(value) {
    var t = value ? Date.parse(value) : NaN;
    if (isNaN(t)) return "";
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---- pure helpers ---- */

  // The cup week's state in words: what it is, and when it closes or what comes next.
  function cupStatus(cycle) {
    if (!cycle) return "";
    var ends = function (label, value) { var d = shortDate(value); return d ? " " + label + " " + d + "." : ""; };
    if (cycle.phase === "upcoming") return "Not open yet." + ends("Opens", cycle.phaseEndsAt || cycle.startsAt);
    if (cycle.phase === "open") return "Open: clears count." + ends("Closes", cycle.openEndsAt);
    // The tally takes an hour after the close (Erupe Tournament.TallyHours); endsAt is the next cup's start.
    if (cycle.phase === "tallying") return "Closed: the results are being tallied, within the hour.";
    if (cycle.phase === "results") return "Results are in." + ends("Next cup starts", cycle.endsAt);
    if (cycle.phase === "over") return "Final results." + ends("It ended", cycle.endsAt);
    return "No quest in the cup's pool this week.";
  }

  // The bracket's state in words.
  function bracketStatus(b) {
    if (!b) return "";
    var d = shortDate(b.signupEndsAt);
    if (b.phase === "signup") return "Sign-up open" + (d ? " until " + d : "") + ": type !vs join in chat.";
    if (b.phase === "drawing") return "Sign-up is over; the bracket is being drawn.";
    if (b.phase === "no_bracket") return "Fewer than two hunters signed up, so there is no bracket this time.";
    if (b.phase === "round") return "Round " + b.round + " of " + b.roundCount + " is open.";
    if (b.finished || b.phase === "results") return "Finished.";
    return "";
  }

  // A player's label: a name, "Bye" for a bye, "Hidden hunter" when the API leaves the name out.
  function playerLabel(name, bye) {
    if (name) return name;
    return bye ? "Bye" : "Hidden hunter";
  }

  // One match as two display rows. The winner is the side whose name is the match's winner (a hidden
  // hunter has no name to compare, so nobody is highlighted then).
  function matchRows(m) {
    var winnerSide = null;
    if (m.decided) {
      if (m.winner && m.playerA === m.winner && m.playerB !== m.winner) winnerSide = "A";
      else if (m.winner && m.playerB === m.winner && m.playerA !== m.winner) winnerSide = "B";
    }
    function side(s) {
      var bye = !!m["bye" + s];
      return {
        label: playerLabel(m["player" + s], bye),
        bye: bye,
        cleared: !!m["cleared" + s],
        time: m.decided && m["time" + s] ? m["time" + s] : null,
        winner: winnerSide === s
      };
    }
    return [side("A"), side("B")];
  }

  // The class board to show first: the first one with entries, else the first.
  function firstBoard(cycle) {
    var boards = ((cycle && cycle.classes) || []).slice();
    if (cycle && cycle.guild) boards.push(cycle.guild);
    for (var i = 0; i < boards.length; i++) if (boards[i].entries && boards[i].entries.length) return i;
    return 0;
  }

  // The week's quests as players find them in game (the cup's own title is not a quest name there):
  // [{kind, name, questId, href, who, board}], solo first. Empty when the API does not know them.
  function cupQuests(cycle) {
    return ((cycle && cycle.quests) || []).filter(function (q) { return q && q.questId > 0; }).map(function (q) {
      var solo = q.kind === "solo";
      return {
        kind: q.kind,
        name: q.name || "Quest " + q.questId,
        questId: q.questId,
        href: "/quest.html?id=" + encodeURIComponent(q.questId),
        who: solo ? "Solo, 1 hunter" : "Guild, up to " + (q.maxPlayers || 4) + " hunters",
        board: solo ? "one board per weapon class: the weapon you take in counts" : "one board for the group"
      };
    });
  }

  // Where the quests are in game, for the cup's phase.
  function cupWhere(cycle) {
    if (!cycle) return "";
    var path = "Quest counter > Limited-Time Quests > Event Quests";
    if (cycle.phase === "open") return "In game: " + path + ". Look for the quest names above; the cup's own name does not appear in game.";
    if (cycle.phase === "upcoming") return "They appear in " + path + " when the cup opens.";
    return "The cup's quests are only listed while clears count.";
  }

  function boardsOf(cycle) {
    var boards = ((cycle && cycle.classes) || []).slice();
    if (cycle && cycle.guild) boards.push(cycle.guild);
    return boards;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cupStatus: cupStatus, bracketStatus: bracketStatus, playerLabel: playerLabel, matchRows: matchRows,
      boardsOf: boardsOf, firstBoard: firstBoard, cupQuests: cupQuests, cupWhere: cupWhere };
  }
  if (typeof document === "undefined") return;

  /* ---- DOM ---- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function get(path) {
    return fetch(API + path, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function soon(root, text) {
    clear(root);
    root.appendChild(el("p", "empty-state", text));
  }

  function boardTable(board) {
    var entries = (board && board.entries) || [];
    if (!entries.length) return el("p", "empty-state", "No clears yet");
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table");
    var head = el("tr");
    ["Rank", "Hunter", "Guild", "Time"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    var thead = el("thead");
    thead.appendChild(head);
    t.appendChild(thead);
    var tbody = el("tbody");
    entries.forEach(function (e) {
      var tr = el("tr");
      tr.appendChild(el("td", null, String(e.rank)));
      tr.appendChild(el("td", null, e.name || "Hidden hunter"));
      tr.appendChild(el("td", null, e.guild || "-"));
      tr.appendChild(el("td", null, e.time || "-"));
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function renderCup(data) {
    var root = document.getElementById("cup-body");
    var current = data && data.current;
    var last = data && data.last;
    if (!current && !last) {
      soon(root, "The Speedrun Cup is not running yet. Its standings appear here once the first cup opens.");
      return;
    }
    clear(root);
    var cycles = [];
    if (current) cycles.push({ key: "current", label: "This week", cycle: current });
    if (last) cycles.push({ key: "last", label: "Last week", cycle: last });
    var picked = cycles[0];
    var boardIndex = firstBoard(picked.cycle);

    var periodChips = el("div", "chips");
    periodChips.setAttribute("role", "group");
    periodChips.setAttribute("aria-label", "Week");
    var classChips = el("div", "chips");
    classChips.setAttribute("role", "group");
    classChips.setAttribute("aria-label", "Weapon class");
    var status = el("p", "note-text");
    var quest = el("h3", "cup-quest");
    var enter = el("div", "cup-enter");
    var note = el("p", "note-text");
    var table = el("div");

    function pressed(group, which) {
      Array.prototype.forEach.call(group.children, function (chip, i) { chip.setAttribute("aria-pressed", i === which ? "true" : "false"); });
    }

    function draw() {
      var cycle = picked.cycle;
      var boards = boardsOf(cycle);
      if (boardIndex >= boards.length) boardIndex = 0;
      quest.textContent = cycle.quest || "No quest this week";
      status.textContent = cupStatus(cycle);
      drawEnter(cycle);
      var board = boards[boardIndex];
      clear(table);
      if (!board) {
        table.appendChild(el("p", "empty-state", "No clears yet"));
        note.textContent = "";
        return;
      }
      table.appendChild(boardTable(board));
      note.textContent = board.total ? plural(board.total, "clear", "clears") + " on this board; the fastest " + Math.min(100, board.total) + " at most are listed." : "";
    }

    // "How to enter": each quest with its in-game name, a link to its quest page, and where it is in game.
    function drawEnter(cycle) {
      clear(enter);
      var quests = cupQuests(cycle);
      enter.hidden = !quests.length;
      if (!quests.length) return;
      var current = cycle.phase === "open" || cycle.phase === "upcoming";
      enter.appendChild(el("p", "cup-enter-head", current ? "How to enter" : "The quests that week"));
      var list = el("ul", "cup-enter-list");
      quests.forEach(function (q) {
        var li = el("li");
        var link = el("a", "cup-enter-name", q.name);
        link.href = q.href;
        li.appendChild(link);
        li.appendChild(el("span", "cup-enter-who", q.who));
        li.appendChild(el("span", "cup-enter-board", q.board));
        list.appendChild(li);
      });
      enter.appendChild(list);
      if (current) enter.appendChild(el("p", "cup-enter-where", cupWhere(cycle)));
    }

    function drawClassChips() {
      clear(classChips);
      boardsOf(picked.cycle).forEach(function (board, i) {
        var chip = el("button", "chip", board.name || "Board");
        chip.type = "button";
        chip.setAttribute("aria-pressed", i === boardIndex ? "true" : "false");
        chip.addEventListener("click", function () { boardIndex = i; pressed(classChips, i); draw(); });
        classChips.appendChild(chip);
      });
    }

    if (cycles.length > 1) {
      cycles.forEach(function (c, i) {
        var chip = el("button", "chip", c.label);
        chip.type = "button";
        chip.setAttribute("aria-pressed", i === 0 ? "true" : "false");
        chip.addEventListener("click", function () {
          picked = c;
          boardIndex = firstBoard(c.cycle);
          pressed(periodChips, i);
          drawClassChips();
          draw();
        });
        periodChips.appendChild(chip);
      });
      root.appendChild(periodChips);
    } else if (!current) {
      root.appendChild(el("p", "note-text", "No cup is running right now."));
    }
    root.appendChild(quest);
    root.appendChild(status);
    root.appendChild(enter);
    drawClassChips();
    root.appendChild(classChips);
    root.appendChild(table);
    root.appendChild(note);
    draw();
  }

  function playerRow(p) {
    var row = el("div", "bracket-player" + (p.winner ? " is-winner" : "") + (p.bye ? " is-bye" : ""));
    row.appendChild(el("span", "bracket-name", p.label));
    var tick = el("span", "bracket-tick", p.cleared ? "✓" : "");
    if (p.cleared) tick.title = "Cleared the round's quest";
    row.appendChild(tick);
    row.appendChild(el("span", "bracket-time", p.time || ""));
    return row;
  }

  function renderBracket(data) {
    var root = document.getElementById("bracket-body");
    var b = data && data.bracket;
    if (!b) {
      soon(root, "The VS Bracket is not running yet. The bracket appears here when sign-up opens.");
      return;
    }
    clear(root);
    root.appendChild(el("p", "note-text", bracketStatus(b)));
    var facts = [];
    facts.push(plural(b.entrants || 0, "hunter", "hunters") + " entered");
    if (b.phase === "signup" && b.signupEndsAt) facts.push("sign-up ends " + shortDate(b.signupEndsAt));
    root.appendChild(el("p", "note-text", facts.join(", ") + "."));
    if (b.champion) root.appendChild(el("p", "bracket-champion", "Champion: " + b.champion));
    if (!b.drawn || !(b.rounds || []).length) {
      if (b.phase === "signup" || b.phase === "drawing") root.appendChild(el("p", "empty-state", "The bracket is drawn when sign-up ends."));
      return;
    }
    var grid = el("div", "bracket");
    b.rounds.forEach(function (r) {
      var col = el("section", "bracket-round");
      var title = "Round " + r.round + (r.round === b.roundCount ? " (final)" : "");
      col.appendChild(el("h3", null, title));
      var sub = r.decided ? "Decided" : (r.endsAt ? "Ends " + shortDate(r.endsAt) : "");
      if (sub) col.appendChild(el("p", "bracket-sub", sub));
      (r.matches || []).forEach(function (m) {
        var box = el("div", "bracket-match");
        matchRows(m).forEach(function (p) { box.appendChild(playerRow(p)); });
        col.appendChild(box);
      });
      grid.appendChild(col);
    });
    root.appendChild(grid);
  }

  get("/api/public/tournament/standings").then(renderCup);
  get("/api/public/vs-bracket/current").then(renderBracket);
})();
