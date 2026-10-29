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

  function render(quest, details, byName) {
    main.textContent = "";
    document.title = "Hunsterverse MHFZ: " + quest.name;

    var head = el("header", "page-head");
    head.appendChild(el("p", "kicker", "Hunsterverse · Quest"));
    head.appendChild(el("h1", null, quest.name));
    var sub = el("p", "page-sub");
    sub.appendChild(el("a", null, quest.category)).href = "/quests.html?category=" + encodeURIComponent(quest.category);
    if (quest.area) {
      sub.appendChild(document.createTextNode(" · "));
      sub.appendChild(el("span", null, quest.area));
    }
    sub.appendChild(document.createTextNode(" · quest " + quest.id));
    head.appendChild(sub);
    main.appendChild(head);

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
    body.appendChild(row("Files", String(quest.variants.length) + " (" + quest.variants.join(", ") + ")"));
    if (quest.nameJp && quest.nameJp !== quest.name) body.appendChild(row("Original title", quest.nameJp));
    table.appendChild(body);
    facts.appendChild(table);
    main.appendChild(facts);

    if (quest.monsters && quest.monsters.length) {
      var mon = section("Monsters", "what the objective names");
      var grid = el("div", "quest-monsters");
      quest.monsters.forEach(function (name) {
        var tile = el("a", "monster-tile");
        var slug = slugFor(name, byName);
        tile.href = slug ? "/monster.html?m=" + encodeURIComponent(slug) : "/monsters.html?q=" + encodeURIComponent(name);
        if (slug) {
          var entry = byName[name] || byName[SYNONYMS[name]] ||
            Object.keys(byName).map(function (k) { return byName[k]; }).filter(function (m) { return m.slug === slug; })[0];
          if (entry && entry.icon) {
            var img = el("img");
            img.src = "/assets/monsters/icons/" + entry.icon;
            img.alt = name;
            tile.appendChild(img);
          }
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
      if (details.descriptionEn && details.description) {
        var original = el("details", "quest-original");
        original.appendChild(el("summary", null, "Original Japanese"));
        original.appendChild(el("p", "quest-description muted", details.description));
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
  var SYNONYMS = { "Fatalis": "Black", "Crimson Fatalis": "Crimson", "White Fatalis": "White",
    "Berserk Laviente": "Berserk lavieG", "Laviente": "Berserk lavieG" };

  function slugFor(name, byName) {
    var hit = byName[name] || byName[SYNONYMS[name]];
    if (hit) return hit.slug;
    var key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    var names = Object.keys(byName);
    for (var i = 0; i < names.length; i++) {
      if (names[i].toLowerCase().replace(/[^a-z0-9]+/g, "") === key) return byName[names[i]].slug;
    }
    return null;
  }

  Promise.all([
    fetch("/data/quests.json", { cache: "no-cache" }).then(function (r) { return r.json(); }),
    fetch("/data/monsters/index.json", { cache: "no-cache" }).then(function (r) { return r.json(); })
      .catch(function () { return []; }),
    fetch("/data/quest-details.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
  ]).then(function (results) {
    var quest = (results[0].quests || []).filter(function (q) { return q.id === id; })[0];
    if (!quest) { fail("No quest with id " + id + " on this server."); return; }
    var byName = {};
    (results[1] || []).forEach(function (m) { byName[m.name] = m; });
    render(quest, results[2][String(id)], byName);
  }).catch(function (error) {
    fail("The quest could not be loaded (" + error.message + ").");
  });
})();
