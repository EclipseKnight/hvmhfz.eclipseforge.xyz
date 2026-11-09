/* Item page: /item.html?id=<the game's item id>. Everything comes from static files made by
   dev/make-item-data.py: data/items/index.json (name, icon, the server's other name, how many sources) and,
   for an item with sources, data/items/<id>.json (monster drops and quests that need it to enter). Monster
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
    back.appendChild(el("a", null, "Search the catalog")).href = "/catalog.html";
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

  function dropsPanel(drops, monsterIcons) {
    var monsters = {};
    drops.forEach(function (d) { monsters[d.slug] = true; });
    var count = Object.keys(monsters).length;
    var panel = section("Dropped by", count + (count === 1 ? " monster" : " monsters") + ", " + drops.length +
      (drops.length === 1 ? " table row" : " table rows"));

    var best = drops.slice().sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); })[0];
    if (best && best.pct) {
      panel.appendChild(el("p", "note-text item-best", "Best chance: " + pct(best.pct) + " from " + best.monster +
        " (" + best.rank + ", " + best.method + ")."));
    }

    var ranks = [];
    drops.forEach(function (d) { if (d.rank && ranks.indexOf(d.rank) === -1) ranks.push(d.rank); });
    var state = { rank: "", q: "" };

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
    if (count > 8) {
      var search = el("label", "search");
      search.appendChild(el("span", "search-label", "Monster"));
      var input = el("input");
      input.type = "search";
      input.placeholder = "Filter monsters";
      input.addEventListener("input", function () { state.q = input.value.trim().toLowerCase(); draw(); });
      search.appendChild(input);
      tools.appendChild(search);
    }
    if (tools.firstChild) panel.appendChild(tools);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table item-drops");
    var head = el("tr");
    [["Monster"], ["Rank"], ["How"], ["Qty", "num"], ["Chance", "num"]].forEach(function (h) {
      head.appendChild(el("th", h[1] || null, h[0]));
    });
    var thead = el("thead");
    thead.appendChild(head);
    table.appendChild(thead);
    var body = el("tbody");
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    var shown = el("p", "note-text");
    panel.appendChild(shown);

    function draw() {
      while (body.firstChild) body.removeChild(body.firstChild);
      var rows = drops.filter(function (d) {
        return (!state.rank || d.rank === state.rank) && (!state.q || d.monster.toLowerCase().indexOf(state.q) !== -1);
      });
      if (!rows.length) {
        var tr = el("tr");
        var td = el("td", "empty-cell", "No drops match.");
        td.colSpan = 5;
        tr.appendChild(td);
        body.appendChild(tr);
      }
      rows.forEach(function (d) {
        var tr = el("tr");
        var who = el("td", "item-monster");
        var link = el("a");
        link.href = "/monster.html?m=" + encodeURIComponent(d.slug);
        var icon = monsterIcons[d.slug];
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
        tr.appendChild(el("td", null, d.rank || "-"));
        tr.appendChild(el("td", null, d.method || "-"));
        tr.appendChild(el("td", "num", "x" + (d.qty || 1)));
        var chance = el("td", "num", pct(d.pct));
        chance.setAttribute("data-sort", String(d.pct || 0));
        tr.appendChild(chance);
        body.appendChild(tr);
      });
      shown.textContent = rows.length === drops.length ? "" : "Showing " + rows.length + " of " + drops.length + " rows.";
    }
    draw();
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
    if (drops.length) view.appendChild(dropsPanel(drops, monsterIcons));
    if (quests.length) view.appendChild(questsPanel(quests));
    if (!drops.length && !quests.length) {
      var none = section("Where to get it");
      none.appendChild(el("p", "empty-state", "No monster drop table or quest entry on this site names this item yet."));
      none.appendChild(el("p", "note-text", "It may come from quest rewards, gathering, the shops or events, which are not mapped to items here yet."));
      view.appendChild(none);
    }
    var more = el("p", "note-text item-more");
    more.appendChild(el("a", null, "Back to the catalog")).href = "/catalog.html?q=" + encodeURIComponent(name);
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
