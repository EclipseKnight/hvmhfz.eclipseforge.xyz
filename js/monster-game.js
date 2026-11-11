/* The game's own data on a monster page (data/monsters/game/<id>.json, dev/make-monster-data.py, from
   hvmhfz_re tools/monsters): hitzones per rank and state, status, drops per rank, attacks and stats, in tabs.
   HvMonsterGame.render(host, game, { communityAttacks }) builds it; HvMonsterGame.summary(game) gives the
   key numbers (also used by dev/check-monster-pages.js). */
(function (root) {
  "use strict";

  var COLS = ["cut", "impact", "shot", "fire", "water", "thunder", "dragon", "ice", "stun"];
  var HEAD = ["Cut", "Impact", "Shot", "Fire", "Water", "Thndr", "Dragon", "Ice", "Stun"];
  var STATUS = [["poison", "Poison"], ["paralysis", "Paralysis"], ["sleep", "Sleep"], ["stun", "Stun (KO)"],
    ["tranq", "Tranquilizer"], ["blast", "Blast"]];
  var TABS = [["hitzones", "Hitzones"], ["status", "Status"], ["drops", "Drops"], ["attacks", "Attacks"], ["stats", "Stats"]];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function num(v) { return v === null || v === undefined ? "-" : Number(v).toLocaleString("en-US"); }
  function secs(v) { return v === null || v === undefined ? "-" : v + "s"; }

  function table(headers, rows, cls) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table " + (cls || ""));
    var tr = el("tr");
    headers.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    t.appendChild(el("thead")).appendChild(tr);
    var body = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (c) {
        var td = el("td");
        if (c && c.nodeType) td.appendChild(c); else td.textContent = c === null || c === undefined ? "-" : c;
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  /* Heat colour of a hitzone value: physical columns run to 100, elements and stun to 50. */
  function heat(value, col) {
    var max = col < 3 ? 100 : 50;
    if (value < 0) return "hsl(205,45%,86%)";
    var f = Math.max(0, Math.min(1, value / max));
    return "hsl(" + Math.round(48 - 40 * f) + "," + Math.round(55 + 30 * f) + "%," + Math.round(93 - 40 * f) + "%)";
  }

  /* The best value of each column in one state's rows (only values above 0). */
  function bestOf(rows) {
    return COLS.map(function (_, c) {
      var best = 0, low = Infinity;
      rows.forEach(function (r) { if (r[c + 2] > best) best = r[c + 2]; if (r[c + 2] < low) low = r[c + 2]; });
      return best > low ? best : 0; // a column with one value everywhere has no best spot
    });
  }

  function hitzoneTable(state) {
    if (!state.rows.length) return el("p", "empty-state", "No hitzones in this state.");
    var best = bestOf(state.rows);
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table hitzone-table mg-heat");
    var tr = el("tr");
    tr.appendChild(el("th", null, "Part"));
    HEAD.forEach(function (h) { tr.appendChild(el("th", null, h)); });
    t.appendChild(el("thead")).appendChild(tr);
    var body = el("tbody");
    state.rows.forEach(function (r) {
      var row = el("tr");
      var name = el("th", "mg-part", r[0]);
      name.scope = "row";
      if (r[1] === 2) { name.textContent = r[0] + "*"; name.title = "Name matched from the community table by its values"; }
      row.appendChild(name);
      COLS.forEach(function (_, c) {
        var v = r[c + 2];
        var td = el("td", "mg-hz" + (v > 0 && v === best[c] ? " mg-best" : ""), String(v));
        td.style.background = heat(v, c);
        if (v > 0 && v === best[c]) td.title = "Best " + HEAD[c].toLowerCase() + " spot";
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  /* "Weak points" line: the best part for cut, impact and shot, and the best element (by its best part). */
  function weakPoints(state) {
    var out = [];
    if (!state || !state.rows.length) return out;
    [0, 1, 2].forEach(function (c) {
      var top = state.rows.slice().sort(function (a, b) { return b[c + 2] - a[c + 2]; })[0];
      if (top[c + 2] > 0) out.push([HEAD[c], top[0], top[c + 2]]);
    });
    var bestEl = null;
    [3, 4, 5, 6, 7].forEach(function (c) {
      state.rows.forEach(function (r) { if (!bestEl || r[c + 2] > bestEl[2]) bestEl = [c, r[0], r[c + 2]]; });
    });
    if (bestEl && bestEl[2] > 0) out.push([["Fire", "Water", "Thunder", "Dragon", "Ice"][bestEl[0] - 3], bestEl[1], bestEl[2]]);
    return out;
  }

  /* Elements in order of the average hitzone over the normal state's parts, best first (ties kept together). */
  function weakElements(state) {
    if (!state || !state.rows.length) return [];
    var names = ["fire", "water", "thunder", "dragon", "ice"];
    var avg = names.map(function (n, i) {
      var s = 0;
      state.rows.forEach(function (r) { s += r[i + 5]; });
      return [n, s / state.rows.length];
    }).sort(function (a, b) { return b[1] - a[1]; });
    if (avg[0][1] <= 0) return [];
    return avg.filter(function (a) { return a[1] >= avg[0][1] - 0.5 && a[1] > 0; }).map(function (a) { return a[0]; });
  }

  function summary(game) {
    var top = game.ranks && game.ranks[game.ranks.length - 1];
    var low = game.ranks && game.ranks[0];
    var state = top && top.hz && top.hz[0];
    return {
      baseHp: game.baseHp,
      weak: weakElements(state),
      weakPoints: weakPoints(state),
      rank: top ? top.label : null,
      firstRank: low ? low.label : null
    };
  }

  function hitzonesTab(rank) {
    var box = el("div");
    if (!rank.hz.length) { box.appendChild(el("p", "empty-state", "No hitzones in the game's data for this rank.")); return box; }
    rank.hz.forEach(function (state) {
      box.appendChild(el("h3", "subhead", state.label));
      var wp = weakPoints(state);
      if (wp.length) {
        var line = el("p", "mg-weak");
        line.appendChild(el("strong", null, "Weak points: "));
        line.appendChild(document.createTextNode(wp.map(function (w) { return w[0] + " " + w[1] + " (" + w[2] + ")"; }).join(" · ")));
        box.appendChild(line);
      }
      box.appendChild(hitzoneTable(state));
    });
    var legend = el("p", "mg-note",
      "Higher is weaker: the share of damage that gets through. The best part of each column is outlined. " +
      "A name with * is matched from the community table by its values; \"Part N\" has no name yet.");
    box.appendChild(legend);
    if (rank.breaks.length) {
      box.appendChild(el("h3", "subhead", "Stagger and break values"));
      box.appendChild(table(["Part", "Value"], rank.breaks.map(function (b) { return [b[0], num(b[1])]; }), "mg-breaks"));
      box.appendChild(el("p", "mg-note", "Damage to the part that staggers it; the game multiplies it by the quest level's part value (Stats tab)."));
    }
    return box;
  }

  function statusTab(rank) {
    var box = el("div");
    var rows = STATUS.filter(function (s) { return s[0] in rank.status; }).map(function (s) {
      var v = rank.status[s[0]];
      if (!v) return [s[1], "Immune", "", "", "", "", ""];
      var max = v.threshold + v.cap * v.increase;
      var extra = s[0] === "poison" ? v.damage + " every " + v.damageEvery + "s"
        : s[0] === "blast" ? v.damage + " damage" : "";
      return [s[1], num(v.threshold), v.increase ? "+" + num(v.increase) + " (×" + v.cap + ")" : "none",
        num(max), v.duration !== undefined ? secs(v.duration) : "-",
        v.recovery !== undefined ? v.recovery + " every " + v.recoveryEvery + "s" : "-", extra || "-"];
    });
    if (!rows.length) { box.appendChild(el("p", "empty-state", "No status data.")); return box; }
    box.appendChild(table(["Status", "Threshold", "Increase", "Most", "Duration", "Recovery", "Damage"], rows, "mg-status"));
    box.appendChild(el("p", "mg-note", "Build-up needed for the first time; each time it wears off the threshold grows by the increase, up to the number of times shown, so \"Most\" is the highest it gets. Recovery is how fast the build-up drains."));
    return box;
  }

  function dropsTab(drops) {
    var box = el("div");
    if (!drops || !drops.length) { box.appendChild(el("p", "empty-state", "No drop tables in the game's data for this monster.")); return box; }
    var tabs = el("div", "chips mg-drop-ranks");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Drop rank");
    var body = el("div", "drops-body");
    var current = 0;
    drops.forEach(function (d, i) { if (/^GR\b|· GR\b/.test(d.rank)) current = i; });
    function show(i) {
      current = i;
      Array.prototype.forEach.call(tabs.children, function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
      body.textContent = "";
      drops[i].sections.forEach(function (sec) {
        body.appendChild(el("h3", "subhead", sec.method + (sec.count ? " (" + sec.count + ")" : "")));
        var list = el("div", "drop-list");
        sec.items.forEach(function (it) {
          var line = el("div", "drop-row");
          var name = el(it[0] ? "a" : "span", "drop-name", it[1]);
          if (it[0]) name.href = "/item.html?id=" + it[0];
          line.appendChild(name);
          line.appendChild(el("span", "drop-qty", "x" + (it[3] || 1)));
          var bar = el("span", "drop-bar");
          var fill = el("span", "drop-fill");
          fill.style.width = Math.max(0, Math.min(100, it[2] || 0)) + "%";
          bar.appendChild(fill);
          line.appendChild(bar);
          line.appendChild(el("span", "drop-pct", it[2] + "%"));
          list.appendChild(line);
        });
        body.appendChild(list);
      });
    }
    drops.forEach(function (d, i) {
      var b = el("button", "chip", d.rank);
      b.type = "button";
      b.addEventListener("click", function () { show(i); });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);
    box.appendChild(body);
    box.appendChild(el("p", "mg-note", "Chance per carve, drop or reward roll. The count after a carve list is how many carves the body gives."));
    show(current);
    return box;
  }

  function badge(text, title, cls) {
    var b = el("span", "badge " + cls, text.trim());
    b.title = title;
    b.style.marginLeft = text.charAt(0) === " " ? "6px" : "0";
    return b;
  }

  /* How sure a line is: 0 = the game's attack file, 1 = a DLL row read the same on HD and SD, 2 = HD only. */
  function sure(n) {
    return n === 0 ? badge("Game file", "Read from the game's attack file (mhfsdt): confirmed", "good")
      : n === 1 ? badge("HD + SD", "Confirmed in the game's code, same row on the HD and the SD client", "good")
        : badge("HD only", "Confirmed in the HD client's code; the SD client was not checked or differs", "");
  }

  function attacksTab(game, community) {
    var box = el("div");
    var levels = game.levels || [];
    if (game.attacks && game.attacks.length) {
      box.appendChild(el("h3", "subhead", "Attack records (from the game's data)"));
      var form = el("div", "mg-dmg-form");
      var lv = el("select");
      levels.forEach(function (l, i) { lv.add(new Option("Level " + i + " (attack ×" + l[1] + ")", String(i))); });
      var def = el("input");
      def.type = "number"; def.min = "1"; def.max = "9999"; def.value = "400";
      [["Quest level", lv], ["Your defence", def]].forEach(function (f) {
        var label = el("label", "field");
        label.appendChild(el("span", null, f[0]));
        label.appendChild(f[1]);
        form.appendChild(label);
      });
      box.appendChild(form);
      var allShared = game.attacks.every(function (r) { return r[6] > 1; }); // the note says it; no badge on each line
      var holder = el("div");
      box.appendChild(holder);
      var draw = function () {
        var a = (levels[Number(lv.value)] || [0, 1])[1];
        var d = Math.max(1, Number(def.value) || 1);
        holder.textContent = "";
        holder.appendChild(table(["Hit", "Certainty", "Power", "KO", "Element", "Damage to you"], game.attacks.map(function (r) {
          var dmg = Math.floor(r[1] * a * 80 / (d * 0.5 + 80));
          var hit = el("span", null, (r[4] ? r[4] + " " : "") + "row " + r[0].slice(0, 2).join(", ") +
            (r[0].length > 2 ? " +" + (r[0].length - 2) : ""));
          hit.title = "Records " + r[0].join(", ");
          var cell = el("span");
          cell.appendChild(hit);
          if (r[4]) cell.appendChild(badge(" guess", "The name is a community match by power: a guess", ""));
          if (r[6] > 1 && !allShared) cell.appendChild(badge(" family", "This row is used by the code of " + r[6] + " monsters of one family, so this monster's family can use it", ""));
          return [cell, sure(r[5] || 0), num(r[1]), num(r[2]), r[3] || "-",
            num(dmg) + (r[3] ? " before resist" : "")];
        }), "mg-attacks"));
      };
      lv.value = String(Math.min(levels.length - 1, 53));
      lv.addEventListener("change", draw);
      def.addEventListener("input", draw);
      draw();
      var shared = game.attacks.some(function (r) { return r[6] > 1; });
      box.appendChild(el("p", "mg-note", "Each line is one hit of the game's attack table (rows with the same numbers and the same certainty together). " +
        "Damage = power × the level's attack × 80 / (defence ÷ 2 + 80); an element hit then loses your resistance in %. " +
        "Move names are not in the records; a name marked guess is the community list's attack with the same power, the element names come from monsters whose element is known (likely)."));
      if (shared) {
        box.appendChild(el("p", "mg-note", (allShared ? "These rows are" : "Rows marked family are") +
          " attack tables that the code of several monsters shares (Rathian, Rathalos and their relatives, for one), " +
          "so this monster's family can use these; which of them this monster itself throws is not told apart."));
      }
    } else {
      box.appendChild(el("p", "empty-state", "Not mapped yet: this monster's attack records are not tied to it in our data."));
    }
    if (community && community.length) {
      var det = el("details", "monster-details");
      det.open = !(game.attacks && game.attacks.length);
      det.appendChild(el("summary", null, "Community attack list (" + community.length + ")"));
      det.appendChild(el("p", "mg-note", "From the Japanese wiki tables via the Ferias project, not translated; \"stun\" is the wiki's scale."));
      det.appendChild(table(["Attack", "Status", "Power", "Stun", "Notes"], community.map(function (a) {
        return [a.name, a.status || "-", num(a.power), num(a.stun), a.notes || ""];
      })));
      box.appendChild(det);
    }
    return box;
  }

  function statsTab(game, rank) {
    var box = el("div");
    box.appendChild(el("p", "mg-key", "Base HP " + num(game.baseHp) + ". A quest's level picks one row: HP is the base times its multiplier."));
    if (rank.mods) {
      var m = rank.mods;
      box.appendChild(el("h3", "subhead", "Class values (" + rank.label + ")"));
      box.appendChild(table(["Attack", "Defence", "Aggro", "Enraged defence", "HP", "Flinch"],
        [[m.attack + "×", m.defence + "×", m.aggro + "×", m.enraged_defence + "×", m.hp + "×", m.flinch + "×"]]));
      box.appendChild(el("p", "mg-note", "The community calls these \"specific values\"; when the game applies them is not traced yet."));
    }
    var det = el("details", "monster-details");
    det.appendChild(el("summary", null, "HP and multipliers by level (" + game.levels.length + ")"));
    det.appendChild(table(["Level", "HP", "Attack", "Defence", "Part"], game.levels.map(function (l, i) {
      return [String(i), num(l[0]), l[1] + "×", l[2] + "×", l[3] + "×"];
    }), "levels-table"));
    box.appendChild(det);
    return box;
  }

  function render(host, game, opts) {
    opts = opts || {};
    var panel = el("section", "panel mg-panel");
    panel.id = "game-data";
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Monster data"));
    head.appendChild(el("span", "panel-note mg-source", "from the game's data"));
    panel.appendChild(head);

    var rankBox = el("div", "chips mg-ranks");
    rankBox.setAttribute("role", "group");
    rankBox.setAttribute("aria-label", "Quest rank");
    var tabs = el("div", "tabs mg-tabs");
    tabs.setAttribute("role", "tablist");
    var body = el("div", "mg-body");
    body.setAttribute("role", "tabpanel");
    var state = { rank: Math.max(0, (game.ranks || []).length - 1), tab: "hitzones" };
    var wanted = (location.hash || "").replace("#", "");
    TABS.forEach(function (t) { if (t[0] === wanted) state.tab = wanted; });

    function draw() {
      Array.prototype.forEach.call(rankBox.children, function (b, i) { b.setAttribute("aria-pressed", i === state.rank ? "true" : "false"); });
      Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute("aria-selected", b.dataset.tab === state.tab ? "true" : "false"); });
      rankBox.hidden = state.tab === "drops" || state.tab === "attacks" || !game.ranks.length;
      body.textContent = "";
      var rank = game.ranks[state.rank] || { hz: [], breaks: [], status: {}, mods: null, label: "" };
      if (state.tab === "hitzones") body.appendChild(hitzonesTab(rank));
      else if (state.tab === "status") body.appendChild(statusTab(rank));
      else if (state.tab === "drops") body.appendChild(dropsTab(game.drops));
      else if (state.tab === "attacks") body.appendChild(attacksTab(game, opts.communityAttacks));
      else body.appendChild(statsTab(game, rank));
    }
    (game.ranks || []).forEach(function (r, i) {
      var b = el("button", "chip", r.label);
      b.type = "button";
      b.addEventListener("click", function () { state.rank = i; draw(); });
      rankBox.appendChild(b);
    });
    TABS.forEach(function (t) {
      var b = el("button", "tab", t[1]);
      b.type = "button";
      b.dataset.tab = t[0];
      b.setAttribute("role", "tab");
      b.addEventListener("click", function () {
        state.tab = t[0];
        if (history.replaceState) history.replaceState(null, "", location.pathname + location.search + "#" + t[0]);
        draw();
      });
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);
    panel.appendChild(rankBox);
    panel.appendChild(body);
    host.appendChild(panel);
    draw();
    // Back/forward or a pasted #drops link switches the tab (a tab click only replaces the hash: no event).
    window.addEventListener("hashchange", function () {
      var tab = (location.hash || "").replace("#", "");
      if (!TABS.some(function (t) { return t[0] === tab; }) || tab === state.tab) return;
      state.tab = tab;
      draw();
      if (panel.scrollIntoView) panel.scrollIntoView({ block: "start" });
    });
    return panel;
  }

  var api = { render: render, summary: summary, weakElements: weakElements, weakPoints: weakPoints, heat: heat };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HvMonsterGame = api;
})(typeof window !== "undefined" ? window : this);
