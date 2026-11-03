/* Sky Corridor page: the town's Duremudira progress per district, the hunter boards (floors or clears,
   per district, all time or this week), the guild missions and the present box, from
   /api/public/sky/* (js/sky.js). While the API has no Sky Corridor endpoints yet (404) or its
   database has no Sky Corridor tables (tracking: false) the page says the stats are coming soon. */
(function () {
  "use strict";

  var S = window.Sky;
  var el = S.el, num = S.num;
  var TOP = 50;

  function byId(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var DATA_PANELS = ["sky-overview", "leaderboard", "missions", "rewards"];
  var soonShown = false;

  function soon() {
    if (soonShown) return;
    soonShown = true;
    byId("sky-soon").hidden = false;
    DATA_PANELS.forEach(function (id) { byId(id).hidden = true; });
  }

  function failed(error) {
    if (error && error.status === 404) { soon(); return true; }
    return false;
  }

  function placeholder(node, text) {
    clear(node);
    node.appendChild(el("p", "note-text", text));
  }

  /* ---- Overview ---- */

  function overview(data) {
    if (!data.tracking) { soon(); return; }
    var goals = data.goals || {};
    var totals = data.totals || {};
    var grid = byId("sky-totals");
    clear(grid);
    grid.appendChild(S.statCard("Duremudira clears", num(totals.clears)));
    grid.appendChild(S.statCard("Floors climbed", num(totals.floors)));
    grid.appendChild(S.statCard("Hunters with a clear", num(totals.players)));
    grid.appendChild(S.statCard("Last clear", data.lastActivity ? S.when(data.lastActivity) : "None yet"));
    byId("sky-goals-note").textContent = "goals per district: " + num(goals.clears) + " clears, " + num(goals.floors) + " floors";

    var list = byId("sky-districts");
    clear(list);
    (data.districts || []).forEach(function (d) {
      var card = el("div", "sky-district");
      var head = el("div", "sky-district-head");
      head.appendChild(el("h3", null, S.districtName(d.district)));
      head.appendChild(el("span", "badge" + (d.shownInGame ? " good" : ""), d.shownInGame ? "Shown in town" : "Not shown in town"));
      card.appendChild(head);
      var bars = el("ol", "weapon-bars sky-bars");
      bars.appendChild(S.bar("Duremudira clears", d.clearsPercent || 0,
        num(d.clears) + " / " + num(goals.clears) + (d.clearsGoalReached ? " · done" : ""), d.clearsGoalReached));
      bars.appendChild(S.bar("Floors", d.floorsPercent || 0,
        num(d.floors) + " / " + num(goals.floors) + (d.floorsGoalReached ? " · done" : ""), d.floorsGoalReached));
      card.appendChild(bars);
      card.appendChild(el("p", "note-text", num(d.players) + (d.players === 1 ? " hunter" : " hunters")
        + " · last clear " + (d.lastActivity ? S.when(d.lastActivity) : "none yet")));
      list.appendChild(card);
    });
  }

  /* ---- Leaderboard ---- */

  var BOARDS = { floors: "Floors climbed", clears: "Duremudira clears" };
  var state = { board: "floors", district: "all", period: "all" };
  var boardKey = "";

  function press(groupId, attribute, value) {
    Array.prototype.forEach.call(byId(groupId).querySelectorAll(".chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute(attribute) === value ? "true" : "false");
    });
  }

  function showBoard() {
    press("sky-board-chips", "data-board", state.board);
    press("sky-district-chips", "data-district", state.district);
    press("sky-period-chips", "data-period", state.period);
    byId("sky-week-rule").hidden = state.period !== "week";
    byId("sky-board-title").textContent = BOARDS[state.board]
      + (state.district === "all" ? ", all districts" : ", " + S.districtName(state.district))
      + (state.period === "week" ? ", this week" : ", all time");
    var key = state.board + "-" + state.district + "-" + state.period;
    boardKey = key;
    var holder = byId("sky-board");
    placeholder(holder, "Loading");
    S.request("/api/public/sky/leaderboard?board=" + state.board + "&district=" + state.district
      + "&period=" + state.period + "&limit=" + TOP).then(function (data) {
      if (boardKey !== key) return;
      if (!data.tracking) { soon(); return; }
      var other = state.board === "floors" ? "clears" : "floors";
      byId("sky-board-note").textContent = num(data.hunters) + (data.hunters === 1 ? " hunter" : " hunters")
        + (data.from ? " · since " + S.when(data.from) : "");
      clear(holder);
      holder.appendChild(S.table(
        [["#", "rank"], ["Hunter"], [BOARDS[state.board], "num"], [BOARDS[other], "num"], ["Guild"], ["Last clear"]],
        (data.entries || []).map(function (e) {
          return [String(e.rank), S.hunterLink(e.charId, e.name), num(e.value), num(e[other]),
            e.guildId ? S.guildLink(e.guildId, e.guildName) : (e.guildName || "-"), S.when(e.lastAt)];
        }),
        state.period === "week" ? "Nobody has cleared a tower quest this week yet."
          : "Nobody has cleared a tower quest yet. Be the first!"));
    }).catch(function (error) {
      if (boardKey !== key || failed(error)) return;
      placeholder(holder, "Could not load this board. Try again in a moment.");
    });
  }

  function chipGroup(id, attribute, field) {
    byId(id).addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      state[field] = chip.getAttribute(attribute);
      showBoard();
    });
  }

  /* ---- Guild missions ---- */

  var missionList = [];
  var missionPage = 1;

  function showMissionPage() {
    press("sky-page-chips", "data-page", String(missionPage));
    var holder = byId("sky-page");
    clear(holder);
    var rows = missionList.filter(function (m) { return m.page === missionPage; }).map(function (m) {
      return [String(m.slot), S.missionLabel(m.typeName), S.districtName(m.block), num(m.goal)];
    });
    holder.appendChild(S.table([["#", "rank"], ["Mission"], ["District"], ["Goal", "num"]], rows,
      "No missions on this page."));
  }

  function missionCell(missions) {
    var list = el("ul", "sky-mission-list");
    (missions || []).forEach(function (m) {
      var item = el("li", m.percent >= 100 ? "is-done" : null);
      item.appendChild(el("span", null, S.missionLabel(m.typeName) + " (" + S.districtName(m.block) + ")"));
      item.appendChild(el("strong", null, " " + num(m.current) + " / " + num(m.goal) + " · " + (m.percent || 0) + "%"));
      list.appendChild(item);
    });
    return list;
  }

  function guilds(data) {
    if (!data.tracking) { soon(); return; }
    missionList = data.missions || [];
    var pages = data.pages || Math.ceil(missionList.length / 3);
    var chips = byId("sky-page-chips");
    clear(chips);
    for (var p = 1; p <= pages; p++) {
      var chip = el("button", "chip", "Page " + p);
      chip.type = "button";
      chip.setAttribute("data-page", String(p));
      chip.setAttribute("aria-pressed", "false");
      chips.appendChild(chip);
    }
    byId("sky-missions-note").textContent = num(missionList.length) + " missions on " + num(pages) + " pages";
    showMissionPage();

    byId("sky-guilds-note").textContent = num(data.total) + (data.total === 1 ? " guild" : " guilds");
    var holder = byId("sky-guilds");
    clear(holder);
    holder.appendChild(S.table(
      [["#", "rank"], ["Guild"], ["Page", "num"], ["This page's missions"], ["Members", "num"], ["Helped", "num"]],
      (data.guilds || []).map(function (g) {
        return [String(g.rank), S.guildLink(g.guildId, g.name), g.allDone ? num(g.page) + " (all done)" : num(g.page),
          missionCell(g.missions), num(g.members), num(g.contributors)];
      }),
      "No guild has started the tower missions yet."));
  }

  /* ---- Present box ---- */

  function rewards(data) {
    if (!data.tracking) { soon(); return; }
    var holder = byId("sky-rewards");
    clear(holder);
    var list = (data.rewards || []).slice().sort(function (a, b) {
      return a.kind === b.kind ? a.threshold - b.threshold : (a.kind === "floors" ? -1 : 1);
    });
    holder.appendChild(S.table(
      [["Milestone"], ["Reward"], ["Hunters there", "num"], ["Received", "num"]],
      list.map(function (r) {
        return [S.milestone(r.kind, r.threshold), (r.itemName || "Item " + r.itemId) + " x" + num(r.quantity),
          num(r.reached), num(r.claimed)];
      }),
      "No present box rewards are set up."));
  }

  function load(path, render, holderId) {
    S.request(path).then(render).catch(function (error) {
      if (failed(error)) return;
      if (holderId) placeholder(byId(holderId), "Could not load this. Try again in a moment.");
    });
  }

  chipGroup("sky-board-chips", "data-board", "board");
  chipGroup("sky-district-chips", "data-district", "district");
  chipGroup("sky-period-chips", "data-period", "period");
  byId("sky-page-chips").addEventListener("click", function (event) {
    var chip = event.target.closest(".chip");
    if (!chip) return;
    missionPage = Number(chip.getAttribute("data-page"));
    showMissionPage();
  });

  load("/api/public/sky/overview", overview, "sky-districts");
  showBoard();
  load("/api/public/sky/guilds?limit=" + TOP, guilds, "sky-guilds");
  load("/api/public/sky/rewards", rewards, "sky-rewards");
})();
