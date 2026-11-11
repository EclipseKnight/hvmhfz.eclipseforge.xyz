/* One quest's page: its title, where and for whom, the monsters and what the quest files say. */
(function () {
  "use strict";

  var id = parseInt(new URLSearchParams(window.location.search).get("id"), 10);
  var main = document.getElementById("quest-view");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    var s = Math.max(0, Math.round(seconds));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h + "h " + m + "m " + sec + "s";
    if (m) return m + "m " + sec + "s";
    return sec + "s";
  }

  function row(label, value) {
    var tr = el("tr");
    tr.appendChild(el("th", null, label));
    tr.appendChild(el("td", null, value));
    return tr;
  }

  function section(title, note) {
    var panel = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (note) head.appendChild(el("span", "panel-note", note));
    panel.appendChild(head);
    return panel;
  }

  // title "Quest not found" for an id the server does not have; a load error gets a Try again button.
  function fail(message, title, retry) {
    main.textContent = "";
    var panel = section(title || "Quest not found");
    panel.appendChild(el("p", "note-text", message));
    if (retry) {
      var again = el("button", "btn", "Try again");
      again.type = "button";
      again.addEventListener("click", retry);
      panel.appendChild(el("p")).appendChild(again);
    }
    main.appendChild(panel);
  }

  function render(quest, details, links) {
    main.textContent = "";
    document.title = quest.name + " · Hunsterverse";
    var placeholder = document.getElementById("quest-head");
    if (placeholder) placeholder.hidden = true; // the quest's own heading follows
    if (window.HvCrumbs) window.HvCrumbs.item(quest.name);

    var head = el("header", "page-head");
    head.appendChild(el("h1", null, quest.name));
    var sub = el("p", "page-sub");
    sub.appendChild(el("a", null, quest.category)).href = "/quests.html?q=" + encodeURIComponent(quest.category);
    if (quest.area) {
      sub.appendChild(document.createTextNode(" · "));
      sub.appendChild(el("span", null, quest.area));
    }
    sub.appendChild(document.createTextNode(" · quest " + quest.id));
    head.appendChild(sub);
    main.appendChild(head);

    // A Speedrun Cup quest is only in the game's event list during a week it is the cup's quest: say whether
    // it is this week's, and how to find it (GET /api/public/tournament/standings, current.quests).
    if (quest.category === "Idaten Cup" || quest.category === "Guild Contest") {
      var cup = section("Speedrun Cup");
      var cupBox = el("div", "cup-enter");
      cupBox.appendChild(el("p", "cup-enter-where", "A Speedrun Cup quest. It is only listed in game during a week it is the cup's quest."));
      cup.appendChild(cupBox);
      main.appendChild(cup);
      fetch("https://api.hvmhfz.eclipseforge.xyz/api/public/tournament/standings")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var cur = data && data.current;
          var mine = cur && (cur.quests || []).filter(function (q) { return q.questId === quest.id; })[0];
          cupBox.textContent = "";
          var live = mine && (cur.phase === "open" || cur.phase === "upcoming");
          cupBox.appendChild(el("p", "cup-enter-head", live ? "This week's cup quest" : "Speedrun Cup quest"));
          if (live) {
            var closes = cur.openEndsAt ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short",
              hour: "2-digit", minute: "2-digit" }).format(new Date(cur.openEndsAt)) : "";
            var kind = mine.kind === "solo" ? "the solo quest, one board per weapon class"
              : "the guild quest, up to " + (mine.maxPlayers || 4) + " hunters, one board for the group";
            cupBox.appendChild(el("p", "cup-enter-where", (cur.quest || "This week's Speedrun Cup") + ": " + kind + "."
              + (cur.phase === "open" ? (closes ? " Clears count until " + closes + "." : "") : " It opens soon.")));
            cupBox.appendChild(el("p", "cup-enter-where", "In game: Quest counter > Limited-Time Quests > Event Quests, listed as "
              + quest.name + "."));
          } else {
            cupBox.appendChild(el("p", "cup-enter-where", "It is only listed in game during a week it is the cup's quest"
              + (cur && cur.quest ? "; this week's cup is " + cur.quest + "." : ".")));
          }
          var more = el("p", "cup-enter-where");
          more.appendChild(el("a", null, live ? "Standings and prizes" : "This week's cup")).href = "/tournaments.html#cup";
          cupBox.appendChild(more);
        })
        .catch(function () {});
    }

    var facts = section("Quest");
    var table = el("table", "data-table quest-facts");
    var body = el("tbody");
    body.appendChild(row("Category", quest.category));
    body.appendChild(row("Area", quest.area || "-"));
    var objective = (details && details.objectiveEn) || quest.objective || quest.objectiveJp || "-";
    var objectiveRow = row("Objective", objective);
    if (details && details.objectiveEn && details.objectiveJp) {
      var sub = document.createElement("div");
      sub.className = "cell-sub muted";
      sub.textContent = details.objectiveJp;
      objectiveRow.lastChild.appendChild(sub);
    }
    body.appendChild(objectiveRow);
    if (details) {
      [["subA", "Sub-objective A"], ["subB", "Sub-objective B"]].forEach(function (s) {
        var en = details[s[0] + "En"], jp = details[s[0] + "Jp"];
        if (!en && !jp) return;
        var subRow = row(s[1], en || jp);
        if (en && jp) {
          var subJp = document.createElement("div");
          subJp.className = "cell-sub muted";
          subJp.textContent = jp;
          subRow.lastChild.appendChild(subJp);
        }
        body.appendChild(subRow);
      });
      if (details.clientEn || details.client) {
      var clientRow = row("Client", details.clientEn || details.client);
      if (details.clientEn && details.client) {
        var csub = document.createElement("div");
        csub.className = "cell-sub muted";
        csub.textContent = details.client;
        clientRow.lastChild.appendChild(csub);
      }
      body.appendChild(clientRow);
    }
      if (details.minutes) body.appendChild(row("Time limit", details.minutes + " minutes"));
      if (details.rewardMoney !== undefined) body.appendChild(row("Reward money", details.rewardMoney.toLocaleString() + "z"));
      if (details.zenny !== undefined) body.appendChild(row("Contract fee", details.zenny.toLocaleString() + "z"));
    }
    if (details && details.requirementItemId) {
      var need = row("Requirement", "");
      var needCell = need.lastChild;
      needCell.textContent = "";
      needCell.appendChild(el("a", null, details.requirementItemName || ("Item " + details.requirementItemId))).href =
        "/item.html?id=" + details.requirementItemId;
      needCell.appendChild(document.createTextNode(" x" + details.requirementCount));
      body.appendChild(need);
    }
    body.appendChild(row("Files", String(quest.variants.length) + " (" + quest.variants.join(", ") + ")"));
    if (quest.nameJp && quest.nameJp !== quest.name) body.appendChild(row("Original title", quest.nameJp));
    table.appendChild(body);
    facts.appendChild(table);
    main.appendChild(facts);

    // What the server has actually seen of this quest: attempts, outcomes and how long a clear takes.
    fetch("https://api.hvmhfz.eclipseforge.xyz/api/public/quests/" + quest.id + "/stats")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (st) {
        if (!st || !st.attempts) return;
        var panel = section("Tracked runs", "recorded by the game server");
        var t = el("table", "data-table quest-facts");
        var b = el("tbody");
        b.appendChild(row("Attempts", String(st.attempts)));
        b.appendChild(row("Cleared", String(st.clears)));
        b.appendChild(row("Failed", String(st.fails)));
        b.appendChild(row("Abandoned", String(st.abandoned)));
        if (st.successRate !== null && st.successRate !== undefined) {
          b.appendChild(row("Clear rate", st.successRate + "%"));
        }
        if (st.avgClearSeconds !== null && st.avgClearSeconds !== undefined) {
          b.appendChild(row("Average clear", duration(st.avgClearSeconds)));
        }
        t.appendChild(b);
        panel.appendChild(t);
        main.appendChild(panel);
      })
      .catch(function () {});

    if (quest.monsters && quest.monsters.length) {
      var mon = section("Monsters", "what the objective names");
      var grid = el("div", "quest-monsters");
      quest.monsters.forEach(function (name) {
        // Every name is the field guide's (dev/make-quest-monsters.py); one without a page is plain text.
        var entry = links.find(name);
        var tile = el(entry ? "a" : "div", "monster-tile");
        if (entry) tile.href = links.href(entry);
        else tile.title = "No field guide page yet";
        if (entry && entry.icon) {
          var img = el("img");
          img.src = "/assets/monsters/icons/" + entry.icon;
          img.alt = name;
          tile.appendChild(img);
        }
        tile.appendChild(el("span", null, name));
        grid.appendChild(tile);
      });
      mon.appendChild(grid);
      main.appendChild(mon);
    }

    if (details && (details.descriptionEn || details.description)) {
      var desc = section("Description", details.descriptionEn ? "translated" : "from the quest file");
      desc.appendChild(el("p", "quest-description", details.descriptionEn || details.description));
      if (details.descriptionJp) {
        var original = el("details", "quest-original");
        original.appendChild(el("summary", null, "Original Japanese"));
        original.appendChild(el("p", "quest-description muted", details.descriptionJp));
        desc.appendChild(original);
      }
      main.appendChild(desc);
    }

    // The quest file's own reward groups and the monsters' HP at this quest (data/quests/rewards/<id/1000>.json,
    // dev/make-monster-data.py from hvmhfz_re tools/monsters/quest_rewards.py). Filled in when the shard loads.
    var rewards = section("Rewards", "from the game's data");
    rewards.id = "rewards";
    rewards.appendChild(el("p", "note-text", "Loading the rewards…"));
    main.appendChild(rewards);
    var hpPanel = section("Monster HP", "from the game's data");
    hpPanel.id = "monster-hp";
    hpPanel.hidden = true;
    main.appendChild(hpPanel);
    rewardsShard()
      .then(function (shard) {
        return fetch("/data/monsters/game/index.json").then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; }).then(function (gindex) { showRewards(shard, gindex); });
      });

    function showRewards(shard, gindex) {
      var failed = shard === "failed";
      var q = !failed && shard && shard.quests && shard.quests[String(quest.id)];
      rewards.textContent = "";
      var head = el("div", "panel-head");
      head.appendChild(el("h2", null, "Rewards"));
      head.appendChild(el("span", "panel-note", "from the game's data"));
      rewards.appendChild(head);
      if (!q || !q.rewards.length) {
        rewards.appendChild(el("p", "note-text", failed ? "The rewards could not be loaded. Reload the page to try again."
          : q ? "This quest file has no reward groups." : "No reward data for this quest."));
      } else {
        q.rewards.forEach(function (g) {
          var box = el("div", "quest-reward-group");
          box.appendChild(el("h3", "subhead", rewardWhen(g)));
          var list = el("div", "drop-list");
          g.items.forEach(function (it) {
            var line = el("div", "drop-row");
            var name = el(it[0] ? "a" : "span", "drop-name", it[0] ? (shard.names[String(it[0])] || "Item " + it[0]) : "Nothing");
            if (it[0]) name.href = "/item.html?id=" + it[0];
            line.appendChild(name);
            line.appendChild(el("span", "drop-qty", "x" + it[1]));
            var bar = el("span", "drop-bar");
            var fill = el("span", "drop-fill");
            fill.style.width = Math.max(0, Math.min(100, it[2] || 0)) + "%";
            bar.appendChild(fill);
            line.appendChild(bar);
            line.appendChild(el("span", "drop-pct", (Math.round((it[2] || 0) * 10) / 10) + "%"));
            list.appendChild(line);
          });
          box.appendChild(list);
          rewards.appendChild(box);
        });
        rewards.appendChild(el("p", "note-text", "Chance of each item on one draw of its group. How many draws a group gives (the reward slots) is not read from the game yet."));
      }
      if (q && q.monsters.length) {
        hpPanel.hidden = false;
        var t = el("table", "data-table quest-hp");
        var thr = el("tr");
        ["Monster", "HP"].forEach(function (h) { thr.appendChild(el("th", null, h)); });
        t.appendChild(el("thead")).appendChild(thr);
        var tb = el("tbody");
        q.monsters.forEach(function (m) {
          var tr = el("tr");
          var info = gindex[String(m[0])];
          var cell = el("td");
          if (info && info[1]) cell.appendChild(el("a", null, info[0] || m[1])).href = "/monster.html?m=" + encodeURIComponent(info[1]);
          else cell.textContent = (info && info[0]) || m[1] || ("Monster " + m[0]);
          tr.appendChild(cell);
          tr.appendChild(el("td", null, m[2] ? Number(m[2]).toLocaleString("en-US") : "-"));
          tb.appendChild(tr);
        });
        t.appendChild(tb);
        hpPanel.appendChild(t);
        hpPanel.appendChild(el("p", "note-text", (q.rank ? q.rank + ", " : "") + "monster level " + q.level +
          ": base HP times that level's multiplier. Some monsters spawn up to 2 levels higher, which this does not add."));
      }
    }

    var back = el("p", "note-text");
    var link = el("a", null, "Back to the quest catalog");
    // From a filtered catalog the way back keeps its search, filters and page (the list writes them to its address).
    var list = "/quests.html";
    try {
      var from = new URL(document.referrer);
      if (from.origin === location.origin && from.pathname === "/quests.html") list += from.search;
    } catch (error) { /* no referrer */ }
    link.href = list;
    back.appendChild(link);
    var crumb = document.querySelector('nav.breadcrumbs a[href="/quests.html"]');
    if (crumb) crumb.href = list;
    main.appendChild(back);
  }

  // What the reward screen pays a group for (hvmhfz_re docs/monsters-data.md section 4).
  function rewardWhen(g) {
    var when = g.when || "";
    if (when === "every clear") return "Every clear";
    if (when === "main target") return "Main target done";
    if (/^sub-target/.test(when)) return "Sub-target " + when.slice(-1) + " done (likely)";
    if (/^extra condition/.test(when)) return "Extra condition " + when.slice(-1) + " (not named yet)";
    return "Condition 0x" + Number(g.g).toString(16) + " (not named yet)";
  }

  if (isNaN(id)) {
    fail("The address needs a quest id, for example /quest.html?id=23250.");
    return;
  }

  // The quest's own piece of the data (data/quests/pieces/<id/1000>.json, dev/make-quest-pieces.py) and its rewards
  // piece, both asked for at once. A missing piece is a quest range the server has no quests in.
  var rewardsLoad = null;
  function rewardsShard() {
    if (!rewardsLoad) {
      rewardsLoad = fetch("/data/quests/rewards/" + Math.floor(id / 1000) + ".json")
        .then(function (r) {
          if (r.status === 404) return null; // no file for this quest range: no reward data
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .catch(function () { rewardsLoad = null; return "failed"; });
    }
    return rewardsLoad;
  }

  function load() {
    main.textContent = "";
    main.appendChild(el("p", "skeleton-line w60"));
    main.appendChild(el("p", "note-text", "Loading the quest…")).setAttribute("role", "status");
    rewardsShard();
    Promise.all([
      fetch("/data/quests/pieces/" + Math.floor(id / 1000) + ".json", { cache: "no-cache" }).then(function (r) {
        if (r.status === 404) return { quests: {} };
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      MonsterLinks.load()
    ]).then(function (results) {
      var quest = (results[0].quests || {})[String(id)];
      if (!quest) { fail("No quest with id " + id + " on this server."); return; }
      render(quest, quest.details, results[1]);
    }).catch(function (error) {
      fail("The quest could not be loaded (" + error.message + "). Check the connection and try again.",
        "Quest could not be loaded", load);
    });
  }
  load();
})();
