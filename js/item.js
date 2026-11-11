/* Item page: /item.html?id=<the game's item id>. Everything comes from static files made by
   dev/make-item-data.py: data/items/index.json (name, icon, the server's other name, how many sources) and,
   for an item with sources, data/items/<id>.json (monster drops, quests that reward it and quests that need it
   to enter). Monster
   icons come from data/monsters/index.json. ?name= (an exact item name) is accepted too, for old links. */
(function () {
  "use strict";

  var view = document.getElementById("item-view");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function json(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function pct(value) {
    if (value === null || value === undefined) return "-";
    return (Math.round(value * 10) / 10) + "%";
  }

  function fail(message) {
    view.textContent = "";
    view.appendChild(el("p", "empty-state", message));
    var back = el("p", "note-text");
    back.appendChild(el("a", null, "Search Items")).href = "/items.html";
    view.appendChild(back);
  }

  function section(title, note) {
    var panel = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (note) head.appendChild(el("span", "panel-head-note", note));
    panel.appendChild(head);
    return panel;
  }

  var TOP = 10; // rows a long list shows before "Show all"

  /* A filterable table that shows its best TOP rows first. opts: title, note, rows (best first), ranks
     (row -> rank, for the rank chips), search (row -> text; a filter box when there are more than 8 rows),
     searchLabel, heads ([label, class]), row (row -> <tr>), noun ("row"/"rows"). The table has no header
     sort (data-nosort): a sort would only reorder the rows on show. */
  function listPanel(opts) {
    var panel = section(opts.title, opts.note);
    if (opts.best) panel.appendChild(el("p", "note-text item-best", opts.best));
    var all = opts.rows;
    var ranks = [];
    all.forEach(function (r) { var k = opts.rank(r); if (k && ranks.indexOf(k) === -1) ranks.push(k); });
    var state = { rank: "", q: "", open: false };

    var tools = el("div", "toolbar item-tools");
    if (ranks.length > 1) {
      var chips = el("div", "chips");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Rank");
      [""].concat(ranks).forEach(function (rank) {
        var chip = el("button", "chip", rank || "All ranks");
        chip.type = "button";
        chip.setAttribute("aria-pressed", rank === "" ? "true" : "false");
        chip.addEventListener("click", function () {
          state.rank = rank;
          Array.prototype.forEach.call(chips.children, function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
          draw();
        });
        chips.appendChild(chip);
      });
      tools.appendChild(chips);
    }
    if (all.length > 8) {
      var search = el("label", "search");
      search.appendChild(el("span", "search-label", opts.searchLabel));
      var input = el("input");
      input.type = "search";
      input.placeholder = "Filter " + opts.searchLabel.toLowerCase() + "s";
      input.addEventListener("input", function () { state.q = input.value.trim().toLowerCase(); draw(); });
      search.appendChild(input);
      tools.appendChild(search);
    }
    if (tools.firstChild) panel.appendChild(tools);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table sticky-first " + opts.cls);
    table.setAttribute("data-nosort", "");
    var head = el("tr");
    opts.heads.forEach(function (h) { head.appendChild(el("th", h[1] || null, h[0])); });
    table.appendChild(el("thead")).appendChild(head);
    var body = el("tbody");
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    var foot = el("p", "note-text item-list-foot");
    var shown = el("span", "item-shown");
    shown.setAttribute("aria-live", "polite");
    foot.appendChild(shown);
    var more = el("button", "ghost-btn small item-show-all");
    more.type = "button";
    more.addEventListener("click", function () { state.open = !state.open; draw(); });
    foot.appendChild(more);
    panel.appendChild(foot);

    function draw() {
      while (body.firstChild) body.removeChild(body.firstChild);
      var rows = all.filter(function (r) {
        return (!state.rank || opts.rank(r) === state.rank) && (!state.q || opts.search(r).toLowerCase().indexOf(state.q) !== -1);
      });
      var cut = state.open ? rows : rows.slice(0, TOP);
      if (!rows.length) {
        var tr = el("tr");
        var td = el("td", "empty-cell", "Nothing matches.");
        td.colSpan = opts.heads.length;
        tr.appendChild(td);
        body.appendChild(tr);
      }
      cut.forEach(function (r) { body.appendChild(opts.row(r)); });
      shown.textContent = cut.length === all.length ? "" : "Showing " + cut.length + " of " + rows.length +
        (rows.length === all.length ? "" : " matching (" + all.length + " in all)") + ". ";
      more.hidden = rows.length <= TOP;
      more.textContent = state.open ? "Show the best " + TOP : "Show all " + rows.length;
    }
    draw();
    return panel;
  }

  function cell(text, cls) { return el("td", cls || null, text); }

  function dropsPanel(drops, monsterIcons) {
    var monsters = {};
    drops.forEach(function (d) { monsters[d.slug || d.monster] = true; });
    var count = Object.keys(monsters).length;
    var rows = drops.slice().sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });
    var best = rows[0];
    var fromGame = drops.some(function (d) { return d.game; });
    var panel = listPanel({
      title: "Dropped by", cls: "item-drops", searchLabel: "Monster",
      note: count + (count === 1 ? " monster" : " monsters") + ", " + drops.length + (drops.length === 1 ? " table row" : " table rows"),
      best: best && best.pct ? "Best chance: " + pct(best.pct) + " from " + best.monster + " (" + best.rank + ", " + best.method + ")." : "",
      rows: rows,
      rank: function (d) { return d.rank; },
      search: function (d) { return d.monster; },
      heads: [["Monster"], ["Rank"], ["How"], ["Qty", "num"], ["Chance", "num"]],
      row: function (d) {
        var tr = el("tr");
        var who = el("td", "item-monster");
        var link = el(d.slug ? "a" : "span");
        if (d.slug) link.href = "/monster.html?m=" + encodeURIComponent(d.slug);
        var icon = d.slug && monsterIcons[d.slug];
        if (icon) {
          var img = el("img");
          img.src = "/assets/monsters/icons/" + icon;
          img.alt = "";
          img.loading = "lazy";
          link.appendChild(img);
        }
        link.appendChild(el("span", null, d.monster));
        who.appendChild(link);
        tr.appendChild(who);
        tr.appendChild(cell(d.rank || "-"));
        var how = cell(d.method || "-");
        if (d.game) how.appendChild(el("span", "item-src", " *"));
        tr.appendChild(how);
        tr.appendChild(cell("x" + (d.qty || 1), "num"));
        tr.appendChild(cell(pct(d.pct), "num"));
        return tr;
      }
    });
    if (fromGame) panel.appendChild(el("p", "note-text", "* From the game's own drop tables, for a monster the community tables don't list with this item."));
    return panel;
  }

  /* The reward group's condition, as the quest page names it (js/quest.js rewardWhen). */
  function rewardWhen(when) {
    if (when === "every clear") return "Every clear";
    if (when === "main target") return "Main target";
    if (/^sub-target/.test(when)) return "Sub-target " + when.slice(-1);
    if (/^extra condition/.test(when)) return "Extra condition " + when.slice(-1);
    return when ? when.charAt(0).toUpperCase() + when.slice(1) : "-";
  }

  /* Quests whose reward groups hold the item (data/items/<id>.json "rewards": [quest id, name, rank, when,
     qty, pct], best chance first; dev/make-item-data.py from data/quests/rewards/). */
  function rewardsPanel(rewards) {
    var quests = {};
    rewards.forEach(function (r) { quests[r[0]] = true; });
    var count = Object.keys(quests).length;
    var best = rewards[0];
    var panel = listPanel({
      title: "Rewarded by", cls: "item-rewards", searchLabel: "Quest",
      note: count + (count === 1 ? " quest" : " quests") + ", from the game's data",
      best: best ? "Best chance: " + pct(best[5]) + " from " + best[1] + " (" + (best[2] ? best[2] + ", " : "") + rewardWhen(best[3]) + ")." : "",
      rows: rewards,
      rank: function (r) { return r[2]; },
      search: function (r) { return r[1] + " " + r[0]; },
      heads: [["Quest"], ["Rank"], ["When"], ["Qty", "num"], ["Chance", "num"]],
      row: function (r) {
        var tr = el("tr");
        var q = el("td", "item-quest");
        q.appendChild(el("a", null, r[1])).href = "/quest.html?id=" + r[0];
        q.appendChild(el("span", "item-quest-id", " #" + r[0]));
        tr.appendChild(q);
        tr.appendChild(cell(r[2] || "-"));
        tr.appendChild(cell(rewardWhen(r[3])));
        tr.appendChild(cell("x" + r[4], "num"));
        tr.appendChild(cell(pct(r[5]), "num"));
        return tr;
      }
    });
    panel.appendChild(el("p", "note-text", "Chance of the item on one draw of that reward group. Sub-target and extra condition names are the game's group order; the quest page says more."));
    return panel;
  }

  function questsPanel(quests) {
    var panel = section("Needed to enter", quests.length + (quests.length === 1 ? " quest" : " quests"));
    panel.appendChild(el("p", "note-text", "These quests take the item from your box when you accept them."));
    var list = el("ul", "item-quests");
    quests.forEach(function (q) {
      var li = el("li");
      li.appendChild(el("a", null, q.name)).href = "/quest.html?id=" + q.id;
      li.appendChild(el("span", "item-quest-count", "x" + (q.count || 1)));
      list.appendChild(li);
    });
    panel.appendChild(list);
    return panel;
  }

  function render(row, detail, monsterIcons) {
    var id = row[0], name = row[1], icon = row[2], aka = row[3];
    document.title = name + " · Hunsterverse";
    if (window.HvCrumbs) window.HvCrumbs.item(name);
    var placeholder = document.getElementById("item-head");
    if (placeholder) placeholder.hidden = true;
    view.textContent = "";

    var head = el("header", "item-hero");
    var art = el("div", "item-hero-art");
    if (icon) {
      var img = el("img");
      img.src = "/assets/icons/1x/" + icon + ".png"; // the game's icon (js/game-icons.js)
      img.srcset = "/assets/icons/1x/" + icon + ".png 32w, /assets/icons/2x/" + icon + ".png 64w";
      img.sizes = "64px";
      img.alt = "";
      art.appendChild(img);
    }
    head.appendChild(art);
    var info = el("div", "item-hero-info");
    info.appendChild(el("p", "kicker", "Item"));
    info.appendChild(el("h1", null, name));
    var sub = el("p", "page-sub");
    sub.appendChild(document.createTextNode("Item id " + id + " (hex " + id.toString(16).toUpperCase().padStart(4, "0") + ")"));
    if (aka) sub.appendChild(document.createTextNode(" · the server's item list calls it " + aka));
    info.appendChild(sub);
    head.appendChild(info);
    view.appendChild(head);

    var drops = (detail && detail.drops) || [];
    var quests = (detail && detail.quests) || [];
    var rewards = (detail && detail.rewards) || [];
    if (drops.length) view.appendChild(dropsPanel(drops, monsterIcons));
    if (rewards.length) view.appendChild(rewardsPanel(rewards));
    if (quests.length) view.appendChild(questsPanel(quests));
    if (!drops.length && !quests.length && !rewards.length) {
      var none = section("Where to get it");
      none.appendChild(el("p", "empty-state", "No monster drop table, quest reward or quest entry on this site names this item yet."));
      none.appendChild(el("p", "note-text", "It may come from gathering, the shops or events, which are not mapped to items here yet."));
      view.appendChild(none);
    }
    var more = el("p", "note-text item-more");
    more.appendChild(el("a", null, "Back to Items")).href = "/items.html?q=" + encodeURIComponent(name);
    view.appendChild(more);
  }

  var params = new URLSearchParams(window.location.search);
  var wantId = /^\d+$/.test(params.get("id") || "") ? Number(params.get("id")) : null;
  var wantName = (params.get("name") || "").trim().toLowerCase();
  if (wantId === null && !wantName) {
    fail("No item chosen.");
    return;
  }

  Promise.all([
    json("/data/items/index.json"),
    json("/data/monsters/index.json").catch(function () { return []; })
  ]).then(function (res) {
    var rows = res[0].items || [];
    var row = rows.filter(function (r) {
      return wantId !== null ? r[0] === wantId : (r[1].toLowerCase() === wantName || (r[3] || "").toLowerCase() === wantName);
    })[0];
    if (!row) {
      fail(wantId !== null ? "There is no item " + wantId + "." : "No item is called that.");
      return;
    }
    var monsterIcons = {};
    (Array.isArray(res[1]) ? res[1] : res[1].monsters || []).forEach(function (m) { if (m.icon) monsterIcons[m.slug] = m.icon; });
    var detail = row[4] ? json("/data/items/" + row[0] + ".json").catch(function () { return null; }) : Promise.resolve(null);
    return detail.then(function (d) { render(row, d, monsterIcons); });
  }).catch(function () { fail("The item list could not be loaded."); });
})();
