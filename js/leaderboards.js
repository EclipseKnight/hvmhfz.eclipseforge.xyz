/* Leaderboards: top hunters by HR and GR, top guilds by RP, most hunted monsters.
   Every board reads an existing public endpoint already sorted by the API; this page only
   picks the board, numbers the rows and shows them. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOP = 100; // the API's largest page size

  function hunterLink(hunter) {
    var link = el("a", null, hunter.name || "Unknown");
    link.href = "/hunters.html?id=" + hunter.id;
    return link;
  }

  function guildLink(guild) {
    var link = el("a", null, guild.name || "Unknown");
    link.href = "/guilds.html?id=" + guild.id;
    return link;
  }

  // Each board: the endpoint, which rows count, the value(s) that decide the order (rows with
  // the same score share a rank, as on in-game boards), and the columns after the rank.
  var BOARDS = {
    hr: {
      title: "Hunter rank",
      note: "ties broken by G rank",
      path: "/api/public/hunters?sort=hr&page=0&size=" + TOP,
      score: function (h) { return [h.hr, h.gr]; },
      columns: [
        ["Hunter", hunterLink],
        ["HR", function (h) { return num(h.hr); }, "num"],
        ["GR", function (h) { return num(h.gr); }, "num"],
        ["Weapon", function (h) { return h.weapon || "Unknown"; }],
        ["Guild", function (h) { return h.guildName || "-"; }]
      ]
    },
    gr: {
      title: "G rank",
      note: "hunters who reached G rank",
      path: "/api/public/hunters?sort=gr&page=0&size=" + TOP,
      keep: function (h) { return h.gr > 0; },
      score: function (h) { return [h.gr, h.hr]; },
      columns: [
        ["Hunter", hunterLink],
        ["GR", function (h) { return num(h.gr); }, "num"],
        ["HR", function (h) { return num(h.hr); }, "num"],
        ["Weapon", function (h) { return h.weapon || "Unknown"; }],
        ["Guild", function (h) { return h.guildName || "-"; }]
      ]
    },
    guilds: {
      title: "Guild RP",
      note: "guild rank points",
      path: "/api/public/guilds?sort=rp&page=0&size=" + TOP,
      keep: function (g) { return g.rankRp > 0; },
      score: function (g) { return [g.rankRp]; },
      columns: [
        ["Guild", guildLink],
        ["RP", function (g) { return num(g.rankRp); }, "num"],
        ["Members", function (g) { return num(g.members); }, "num"],
        ["Leader", function (g) { return g.leader || "Unknown"; }]
      ]
    },
    monsters: {
      title: "Most hunted",
      note: "server wide, from the kill log",
      path: "/api/public/monsters?limit=" + TOP,
      list: true, // this endpoint returns a plain list, not a page
      score: function (m) { return [m.kills]; },
      columns: [
        ["Monster", function (m) { return m.name || "Unknown"; }],
        ["Hunts", function (m) { return num(m.kills); }, "num"]
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

  function message(board, text) {
    var body = document.getElementById("board-body");
    clear(body);
    var row = el("tr");
    var cell = el("td", "empty-cell", text);
    cell.colSpan = board.columns.length + 1;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function render(board, data) {
    var rows = board.list ? data : data.items;
    if (board.keep) rows = rows.filter(board.keep);
    if (!rows.length) {
      message(board, "Nobody on this board yet.");
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

  var current = null;

  function show(name) {
    if (!BOARDS[name]) name = "hr";
    current = name;
    var board = BOARDS[name];

    Array.prototype.forEach.call(document.querySelectorAll("#board-chips .chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute("data-board") === name ? "true" : "false");
    });
    document.getElementById("board-title").textContent = board.title;
    document.getElementById("board-note").textContent = board.note;

    var head = document.getElementById("board-head");
    clear(head);
    var headRow = el("tr");
    headRow.appendChild(el("th", null, "#"));
    board.columns.forEach(function (column) { headRow.appendChild(el("th", column[2] || null, column[0])); });
    head.appendChild(headRow);

    message(board, "Loading");
    request(board.path).then(function (data) {
      if (current === name) render(board, data); // ignore a late answer for a board left already
    }).catch(function () {
      if (current === name) message(board, "Could not load this leaderboard. Try again in a moment.");
    });
  }

  // The board is kept in the address (#gr, #guilds, ...) so it can be linked and survives a reload.
  document.getElementById("board-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (chip) window.location.hash = chip.getAttribute("data-board");
  });
  window.addEventListener("hashchange", function () { show(window.location.hash.slice(1)); });

  show(window.location.hash.slice(1));
})();
