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
    var m = Math.floor(s / 60);
    return m ? m + "m" : s + "s";
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

  function render(quest, details) {
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
    body.appendChild(row("Objective", quest.objective || quest.objectiveJp || "-"));
    if (details) {
      if (details.client) body.appendChild(row("Client", details.client));
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
        var link = el("a", "monster-tile");
        var slug = quest.monsterSlugs && quest.monsterSlugs[name];
        link.href = slug ? "/monster.html?m=" + encodeURIComponent(slug) : "/monsters.html?q=" + encodeURIComponent(name);
        link.appendChild(el("span", null, name));
        grid.appendChild(link);
      });
      mon.appendChild(grid);
      main.appendChild(mon);
    }

    if (details && details.description) {
      var desc = section("Description", "from the quest file");
      desc.appendChild(el("p", "quest-description", details.description));
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
    fetch("/data/quest-details.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
  ]).then(function (results) {
    var quest = (results[0].quests || []).filter(function (q) { return q.id === id; })[0];
    if (!quest) { fail("No quest with id " + id + " on this server."); return; }
    render(quest, results[1][String(id)]);
  }).catch(function (error) {
    fail("The quest could not be loaded (" + error.message + ").");
  });
})();
