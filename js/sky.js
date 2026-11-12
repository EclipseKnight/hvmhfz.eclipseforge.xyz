/* Sky Corridor (the Tower): what the Sky Corridor page (js/sky-corridor.js) and the hunter profile's
   Sky Corridor tab (js/hunters.js) share. Data from the public API /api/public/sky/* (overview,
   leaderboard, guilds, rewards, hunter/{charId}); shapes in the API's README, section "Sky Corridor".

   Sky.request(path) answers the JSON, or rejects with error.status (404 while the API has no Sky
   Corridor endpoints yet, or for a hunter it does not show). Sky.hunterHasData(h) says whether a
   hunter answer has anything to show; Sky.hunterPanel(h) builds the tab's content.
   The pure helpers also run under node (dev/check-sky.js). */
(function (root) {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

  // Erupe's names for the six counters a cleared tower quest sends, in words.
  var MISSION_TYPES = {
    floors: "Floors climbed",
    antiques: "Antiques collected",
    chests: "Treasure chests opened",
    cats: "Cats saved",
    trp: "Tower points (TRP)",
    slays: "Monsters slain"
  };

  function missionLabel(typeName) { return MISSION_TYPES[typeName] || "Unknown mission"; }

  function num(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString("en-GB");
  }

  // Whole percent, 0-100, of current toward goal.
  function percent(current, goal) {
    if (!goal || goal <= 0) return 0;
    return Math.max(0, Math.min(100, Math.floor((current || 0) * 100 / goal)));
  }

  // "3 Nov 2026, 15:05 CET" in the visitor's time zone (js/time.js; "3 Nov 2026, 14:05 UTC" without it); "-" for none.
  function when(time) {
    if (!time) return "-";
    var d = new Date(time);
    if (isNaN(d.getTime())) return "-";
    if (typeof window !== "undefined" && window.HvTime) return HvTime.text(d);
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit",
      minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
  }

  function districtName(n) { return "District " + n; }

  // A reward's milestone in words: "1 floor", "25 tower clears".
  function milestone(kind, threshold) {
    if (kind === "clears") return num(threshold) + (threshold === 1 ? " tower clear" : " tower clears");
    return num(threshold) + (threshold === 1 ? " floor" : " floors");
  }

  // Anything to show on a hunter's tab: progress, a reward reached or received, or a share of the
  // guild missions.
  function hunterHasData(h) {
    if (!h || h.tracking === false) return false;
    if ((h.kills || 0) > 0 || (h.clears || 0) > 0 || (h.floors || 0) > 0) return true;
    if ((h.rewards || []).some(function (r) { return r.reached || r.claimedAt; })) return true;
    var gm = h.guildMissions;
    return !!(gm && (gm.missions || []).some(function (m) { return (m.mine || 0) > 0; }));
  }

  function request(path) {
    return fetch(API + path, { cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        var error = new Error("HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    });
  }

  /* ---- DOM helpers (browser only) ---- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function link(text, href) {
    var a = el("a", null, text);
    a.href = href;
    return a;
  }

  function hunterLink(charId, name) { return link(name || "Unknown", "/hunters.html?id=" + charId); }
  function guildLink(guildId, name) { return link(name || "Unknown", "/guilds.html?id=" + guildId); }

  // One bar: label, track filled to pct, and the value text on the right (same look as the weapon bars).
  function bar(label, pct, value, done) {
    var item = el("li", (pct ? "" : "is-zero") + (done ? " is-done" : ""));
    item.appendChild(el("span", "wb-name", label));
    var track = el("span", "wb-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(pct));
    track.setAttribute("aria-label", label);
    var fill = el("span", "wb-fill");
    fill.style.width = pct + "%";
    track.appendChild(fill);
    item.appendChild(track);
    item.appendChild(el("span", "wb-value", value));
    return item;
  }

  function statCard(label, value) {
    var card = el("div", "stat-card");
    card.appendChild(el("span", "stat-label", label));
    card.appendChild(el("span", "stat-value", value));
    return card;
  }

  // A table: heads [[label, class]], rows of cells (string or node), with an empty message.
  function table(heads, rows, empty) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table");
    var thead = el("thead");
    var tr = el("tr");
    heads.forEach(function (h) { tr.appendChild(el("th", h[1] || null, h[0])); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = el("tbody");
    if (!rows.length) {
      var row = el("tr");
      var cell = el("td", "empty-cell", empty);
      cell.colSpan = heads.length;
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    rows.forEach(function (cells) {
      var row = el("tr");
      cells.forEach(function (value, i) {
        var cell = el("td", heads[i][1] || null);
        if (value && value.nodeType) cell.appendChild(value);
        else cell.textContent = value === null || value === undefined ? "-" : String(value);
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function panelHead(title, note) {
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (note) head.appendChild(note.nodeType ? note : el("span", "panel-note", note));
    return head;
  }

  // The hunter profile's Sky Corridor tab.
  function hunterPanel(h) {
    var box = el("div", "sky-hunter");

    var summary = el("section", "panel");
    var more = link("Sky Corridor boards", "/sky-corridor.html#leaderboard");
    more.className = "panel-note";
    summary.appendChild(panelHead("Sky Corridor", more));
    var grid = el("div", "stat-grid");
    var hasKills = h.kills !== undefined && h.kills !== null;
    if (hasKills) grid.appendChild(statCard("Duremudira kills", num(h.kills)));
    grid.appendChild(statCard("Tower clears", num(h.clears)));
    grid.appendChild(statCard("Floors climbed", num(h.floors)));
    if (hasKills) grid.appendChild(statCard("Kills board", h.killsRank ? "#" + num(h.killsRank) : "-"));
    grid.appendChild(statCard("Clears board", h.clearsRank ? "#" + num(h.clearsRank) : "-"));
    grid.appendChild(statCard("Floors board", h.floorsRank ? "#" + num(h.floorsRank) : "-"));
    if (h.tr !== null && h.tr !== undefined) grid.appendChild(statCard("Tower rank", num(h.tr)));
    if (h.trp !== null && h.trp !== undefined) grid.appendChild(statCard("Tower points", num(h.trp)));
    grid.appendChild(statCard("Last clear", when(h.lastAt)));
    summary.appendChild(grid);
    var districtKills = hasKills && (h.districts || []).every(function (d) { return d.kills !== undefined && d.kills !== null; });
    var districtHeads = [["District"]];
    if (districtKills) districtHeads.push(["Duremudira kills", "num"]);
    districtHeads.push(["Tower clears", "num"], ["Floors", "num"], ["Last clear"]);
    summary.appendChild(table(districtHeads,
      (h.districts || []).map(function (d) {
        var row = [districtName(d.district)];
        if (districtKills) row.push(num(d.kills));
        return row.concat([num(d.clears), num(d.floors), when(d.lastAt)]);
      }), "No district progress yet."));
    summary.appendChild(el("p", "note-text", "Ranks are on the all-district, all-time boards. "
      + "A cleared tower quest counts only for hunters in a guild: the game reports it only for them."));
    box.appendChild(summary);

    var rewards = el("section", "panel");
    rewards.appendChild(panelHead("Present box", "rewards for floors and tower clears"));
    rewards.appendChild(table([["Milestone"], ["Reward"], ["Reached"], ["Received"]],
      (h.rewards || []).map(function (r) {
        return [milestone(r.kind, r.threshold), (r.itemName || "Item " + r.itemId) + " x" + num(r.quantity),
          r.reached ? "Yes" : "Not yet", r.claimedAt ? when(r.claimedAt) : (r.reached ? "Waiting in the box" : "-")];
      }), "No present box rewards are set up."));
    box.appendChild(rewards);

    var gm = h.guildMissions;
    var missions = el("section", "panel");
    if (gm) {
      var gl = guildLink(gm.guildId, gm.guildName);
      gl.className = "panel-note";
      missions.appendChild(panelHead("Guild missions", gl));
      missions.appendChild(el("p", "note-text", (gm.guildName || "The guild") + " is on mission page "
        + num(gm.page) + " of 11. This hunter's share is what they added to this page."));
      missions.appendChild(table([["Mission"], ["District"], ["Guild", "num"], ["Goal", "num"], ["This hunter", "num"], ["Share", "num"]],
        (gm.missions || []).map(function (m) {
          var share = m.guildCurrent > 0 ? Math.round((m.mine || 0) * 100 / m.guildCurrent) + "%" : "-";
          return [missionLabel(m.typeName), districtName(m.block), num(m.guildCurrent), num(m.goal), num(m.mine), share];
        }), "No missions on this page."));
    } else {
      missions.appendChild(panelHead("Guild missions"));
      missions.appendChild(el("p", "note-text", "Not in a guild: guild missions need a guild."));
    }
    box.appendChild(missions);
    return box;
  }

  var Sky = {
    API: API,
    MISSION_TYPES: MISSION_TYPES,
    missionLabel: missionLabel,
    num: num,
    percent: percent,
    when: when,
    milestone: milestone,
    districtName: districtName,
    hunterHasData: hunterHasData,
    request: request,
    el: el,
    link: link,
    hunterLink: hunterLink,
    guildLink: guildLink,
    bar: bar,
    statCard: statCard,
    table: table,
    panelHead: panelHead,
    hunterPanel: hunterPanel
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Sky;
  else root.Sky = Sky;
})(this);
