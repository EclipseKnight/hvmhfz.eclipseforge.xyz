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

  function fail(message) {
    main.textContent = "";
    var panel = section("Quest not found");
    panel.appendChild(el("p", "note-text", message));
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
      body.appendChild(row("Requirement", (details.requirementItemName || ("Item #" + details.requirementItemId))
        + " x" + details.requirementCount));
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

    var rewards = section("Rewards", "being mapped");
    rewards.appendChild(el("p", "note-text",
      "The reward table in the quest file lists item indices from the game client's own item table, which is not mapped yet, so rewards are not shown rather than shown wrong."));
    main.appendChild(rewards);

    var back = el("p", "note-text");
    var link = el("a", null, "Back to the quest catalog");
    link.href = "/quests.html";
    back.appendChild(link);
    main.appendChild(back);
  }

  if (isNaN(id)) {
    fail("The address needs a quest id, for example /quest.html?id=23250.");
    return;
  }
  Promise.all([
    fetch("/data/quests.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    MonsterLinks.load(),
    fetch("/data/quest-details.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
  ]).then(function (results) {
    var quest = (results[0].quests || []).filter(function (q) { return q.id === id; })[0];
    if (!quest) { fail("No quest with id " + id + " on this server."); return; }
    render(quest, results[2][String(id)], results[1]);
  }).catch(function (error) {
    fail("The quest could not be loaded (" + error.message + ").");
  });
})();
