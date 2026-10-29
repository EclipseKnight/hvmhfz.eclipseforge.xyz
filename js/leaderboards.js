/* Leaderboards: timed hunt boards (top hunters, top guilds, most hunted monsters) for this week, last
   week, this month, last month and all time, plus guild RP. The hunt boards come from one API call per
   period (/api/public/leaderboards/hunts); guild RP from the guild list sorted by RP; the Hunting Road
   clear board from /api/public/road/leaderboard, one board per rotation and per Road (open or solo).
   This page only picks the board, numbers the rows and shows them. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOP = 100; // the API's largest page size

  var PERIODS = {
    week: "this week",
    lastweek: "last week",
    month: "this month",
    lastmonth: "last month",
    all: "all time"
  };

  function hunterLink(hunter) {
    var link = el("a", null, hunter.name || "Unknown");
    link.href = "/hunters.html?id=" + hunter.id;
    return link;
  }

  function roadHunterLink(entry) {
    var link = el("a", null, entry.name || "Unknown");
    link.href = "/hunters.html?id=" + entry.characterId;
    return link;
  }

  // "28 Oct, 14:05 UTC": when the hunter first reached their best floor of the rotation.
  function when(time) {
    return new Date(time).toLocaleString(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC"
    }) + " UTC";
  }

  var MODES = { open: "Open Road", solo: "Solo Road" };

  function guildLink(guild) {
    var link = el("a", null, guild.name || "Unknown");
    link.href = "/guilds.html?id=" + guild.id;
    return link;
  }

  // Each board: where its rows come from, the value(s) that decide the order (rows with the same
  // score share a rank, as on in-game boards), and the columns after the rank.
  var BOARDS = {
    hunters: {
      title: "Top hunters",
      timed: true,
      rows: function (data) { return data.hunters; },
      score: function (h) { return [h.kills]; },
      columns: [
        ["Hunter", hunterLink],
        ["Hunts", function (h) { return num(h.kills); }, "num"],
        ["Monsters", function (h) { return num(h.species); }, "num"],
        ["Guild", function (h) { return h.guildName || "-"; }]
      ]
    },
    guilds: {
      title: "Top guilds",
      timed: true,
      note: "hunts by current members",
      rows: function (data) { return data.guilds; },
      score: function (g) { return [g.kills]; },
      columns: [
        ["Guild", guildLink],
        ["Hunts", function (g) { return num(g.kills); }, "num"],
        ["Hunters", function (g) { return num(g.hunters); }, "num"]
      ]
    },
    monsters: {
      title: "Most hunted",
      timed: true,
      rows: function (data) { return data.monsters; },
      score: function (m) { return [m.kills]; },
      columns: [
        ["Monster", function (m) { return m.name || "Unknown"; }],
        ["Hunts", function (m) { return num(m.kills); }, "num"]
      ]
    },
    rp: {
      title: "Guild RP",
      note: "guild rank points, all time",
      path: "/api/public/guilds?sort=rp&page=0&size=" + TOP,
      rows: function (data) { return data.items.filter(function (g) { return g.rankRp > 0; }); },
      score: function (g) { return [g.rankRp]; },
      columns: [
        ["Guild", guildLink],
        ["RP", function (g) { return num(g.rankRp); }, "num"],
        ["Members", function (g) { return num(g.members); }, "num"],
        ["Leader", function (g) { return g.leader || "Unknown"; }]
      ]
    },
    road: {
      title: "Hunting Road",
      road: true,
      empty: "Nobody has cleared a floor in this rotation yet.",
      rows: function (data) { return data.entries; },
      score: function (e) { return [e.floor, e.reachedAt]; },
      columns: [
        ["Hunter", roadHunterLink],
        ["Floor", function (e) { return num(e.floor); }, "num"],
        ["Reached", function (e) { return when(e.reachedAt); }],
        ["Floors climbed", function (e) {
          // before tracking began only each hunter's best was saved: no floor count to show
          return e.floorsClimbed > 0 ? num(e.floorsClimbed) : "-";
        }, "num"],
        ["Guild", function (e) { return e.guildName || "-"; }]
      ]
    }
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function num(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  function request(path) {
    return fetch(API + path, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  // One request answers all three hunt boards of a period; keep it while the page is open.
  var huntCache = {};
  function huntBoards(period) {
    if (!huntCache[period]) {
      huntCache[period] = request("/api/public/leaderboards/hunts?period=" + period + "&limit=" + TOP)
        .catch(function (error) { delete huntCache[period]; throw error; });
    }
    return huntCache[period];
  }

  function sameScore(a, b) {
    return a.length === b.length && a.every(function (value, i) { return value === b[i]; });
  }

  // Standard competition ranking: 1, 2, 2, 4. Rows arrive already sorted by the API.
  function ranks(rows, score) {
    var result = [];
    rows.forEach(function (row, i) {
      var tied = i > 0 && sameScore(score(row), score(rows[i - 1]));
      result.push(tied ? result[i - 1] : i + 1);
    });
    return result;
  }

  function day(time) {
    return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  }

  // "26 Oct to now, resets in 4d 8h" for a running period, "19 Oct to 25 Oct (UTC)" for a finished one.
  function periodNote(data) {
    if (!data.from) return "all time";
    var text = day(data.from) + " to ";
    if (!data.resetsAt) return text + day(new Date(data.to).getTime() - 1) + " (UTC)";
    var left = Math.max(0, new Date(data.resetsAt).getTime() - Date.now());
    var days = Math.floor(left / 86400000);
    var hours = Math.floor((left % 86400000) / 3600000);
    return text + "now, resets in " + (days ? days + "d " : "") + hours + "h";
  }

  function message(board, text) {
    var body = document.getElementById("board-body");
    clear(body);
    var row = el("tr");
    var cell = el("td", "empty-cell", text);
    cell.colSpan = board.columns.length + 1;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function render(board, rows) {
    if (!rows.length) {
      message(board, board.empty || (board.timed ? "No hunts logged in this period yet." : "Nobody on this board yet."));
      return;
    }
    var body = document.getElementById("board-body");
    clear(body);
    var rowRanks = ranks(rows, board.score);
    rows.forEach(function (entry, i) {
      var row = el("tr");
      row.appendChild(el("td", "rank", String(rowRanks[i])));
      board.columns.forEach(function (column) {
        var cell = el("td", column[2] || null);
        var value = column[1](entry);
        if (typeof value === "string") cell.textContent = value;
        else cell.appendChild(value);
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
  }

  function press(groupId, attribute, value) {
    Array.prototype.forEach.call(document.querySelectorAll("#" + groupId + " .chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute(attribute) === value ? "true" : "false");
    });
  }

  // The address keeps the board and period: #hunters-week, #guilds-month, #monsters-all, #rp; for the
  // Road, the Road and the rotation: #road (open, current), #road-solo, #road-open-2, #road-open-original.
  // Older links (#hr and #gr from the removed rank boards, #guilds from the guild page) still work.
  var LEGACY = { hr: "hunters-week", gr: "hunters-week", guilds: "rp" };
  function parse(hash) {
    hash = LEGACY[hash] || hash;
    var parts = hash.split("-");
    return {
      board: BOARDS[parts[0]] ? parts[0] : "hunters",
      period: PERIODS[parts[1]] ? parts[1] : "week",
      mode: MODES[parts[1]] ? parts[1] : "open",
      rotation: /^(\d+|original)$/.test(parts[2] || "") ? parts[2] : "current"
    };
  }

  function rotationLabel(r) {
    if (r.key === "original") return "Original Road";
    if (r.number !== null && r.number !== undefined && r.number <= 0) return r.name || "Base Road";
    return "Rotation " + r.number + (r.name ? ": " + r.name : "");
  }

  // Fills the rotation picker from the API's list (newest first) and selects the one shown.
  function fillRotations(data) {
    var select = document.getElementById("road-rotation");
    clear(select);
    data.rotations.forEach(function (r) {
      var option = el("option", null, rotationLabel(r) + (r.current ? " (live)" : ""));
      option.value = r.current ? "current" : r.key;
      select.appendChild(option);
    });
    select.value = data.rotation.current ? "current" : data.rotation.key;
  }

  // "Ice Road by Bravo · 27 Oct to now" and, when tracking began inside the rotation, from when.
  function roadNote(data) {
    var r = data.rotation;
    var bits = [];
    if (r.designer) bits.push("designed by " + r.designer);
    var from = r.from ? day(r.from) : null;
    var to = r.to ? day(new Date(r.to).getTime() - 1) : "now";
    if (from) bits.push(from + " to " + to + " (UTC)");
    else if (r.to) bits.push("until " + to + " (UTC)");
    if (data.trackingSince && (!r.from || new Date(data.trackingSince) > new Date(r.from))) {
      bits.push("clears tracked since " + day(data.trackingSince));
    }
    if (data.hunters) bits.push(num(data.hunters) + (data.hunters === 1 ? " hunter" : " hunters"));
    return bits.join(" · ");
  }

  var current = "";

  function show(hash) {
    var choice = parse(hash);
    var board = BOARDS[choice.board];
    var key = board.road
      ? ["road", choice.mode, choice.rotation].join("-")
      : choice.board + "-" + choice.period;
    current = key;

    press("board-chips", "data-board", choice.board);
    press("period-chips", "data-period", choice.period);
    press("mode-chips", "data-mode", choice.mode);
    document.getElementById("period-chips").hidden = !board.timed;
    document.getElementById("road-controls").hidden = !board.road;
    document.getElementById("road-rule").hidden = !board.road;
    document.getElementById("board-title").textContent =
      board.title + (board.timed ? ", " + PERIODS[choice.period] : "") + (board.road ? ", " + MODES[choice.mode] : "");
    document.getElementById("board-note").textContent = board.note || "";

    var head = document.getElementById("board-head");
    clear(head);
    var headRow = el("tr");
    headRow.appendChild(el("th", null, "#"));
    board.columns.forEach(function (column) { headRow.appendChild(el("th", column[2] || null, column[0])); });
    head.appendChild(headRow);

    message(board, "Loading");
    var load = board.timed ? huntBoards(choice.period)
      : board.road ? request("/api/public/road/leaderboard?mode=" + choice.mode + "&rotation=" + choice.rotation + "&limit=" + TOP)
      : request(board.path);
    load.then(function (data) {
      if (current !== key) return; // a late answer for a board left already
      if (board.timed) {
        document.getElementById("board-note").textContent =
          periodNote(data) + (board.note ? " · " + board.note : "");
      }
      if (board.road) {
        fillRotations(data);
        document.getElementById("board-title").textContent =
          rotationLabel(data.rotation) + ", " + MODES[choice.mode];
        document.getElementById("board-note").textContent = roadNote(data);
        if (!data.tracking) {
          message(board, "Hunting Road clears are recorded from the next game server update on. Climb a floor after it and you show up here.");
          return;
        }
      }
      render(board, board.rows(data));
    }).catch(function () {
      if (current === key) message(board, "Could not load this leaderboard. Try again in a moment.");
    });
  }

  function go(board, period) {
    window.location.hash = BOARDS[board].timed ? board + "-" + period : board;
  }

  function goRoad(mode, rotation) {
    window.location.hash = rotation === "current"
      ? (mode === "open" ? "road" : "road-" + mode)
      : "road-" + mode + "-" + rotation;
  }

  document.getElementById("board-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (chip) go(chip.getAttribute("data-board"), parse(window.location.hash.slice(1)).period);
  });
  document.getElementById("period-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (chip) go(parse(window.location.hash.slice(1)).board, chip.getAttribute("data-period"));
  });
  document.getElementById("mode-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (chip) goRoad(chip.getAttribute("data-mode"), parse(window.location.hash.slice(1)).rotation);
  });
  document.getElementById("road-rotation").addEventListener("change", function (event) {
    goRoad(parse(window.location.hash.slice(1)).mode, event.target.value);
  });
  window.addEventListener("hashchange", function () { show(window.location.hash.slice(1)); });

  show(window.location.hash.slice(1));
})();
