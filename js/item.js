/* Item page: /item.html?id=<the game's item id>. Everything comes from static files made by
   dev/make-item-data.py: data/items/index.json (name, icon, the server's other name, how many sources) and,
   for an item with sources, data/items/<id>.json (monster drops, quests that reward it and quests that need it
   to enter, and from dev/make-source-data.py "where", "gather", "offered" and "unlisted": every way to get it,
   shown first under "Where to get it", each source linked to its page /source.html?id=, named from
   data/sources/index.json). Monster icons and the game's monster ids come from data/monsters/index.json.
   ?name= (an exact item name) is accepted too, for old links. */
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

  function num(n) { return Number(n).toLocaleString("en-US"); }

  /* "Where to get it": every source of the item (data/items/<id>.json "where", "gather", "offered", "unlisted"),
     grouped as data/sources/index.json's groups, each line linked to its source page. */
  var WHERE_TOP = 8;
  var GROUP_NAMES = { shop: "Shops", gacha: "Gacha", event: "Events and gifts", sky: "Sky Corridor", craft: "Crafting",
                      exchange: "Exchanges and other rewards", monster: "Monsters", quest: "Quests" };
  var GROUP_ORDER = ["shop", "gacha", "event", "sky", "craft", "exchange", "monster", "quest"];

  /* The plain-text details of one source row: quantity, price, chance, limits and conditions. */
  function rowFacts(r, cur) {
    var parts = [];
    var c = r.cur || cur || "";
    if (r.price !== undefined) parts.push((r.qty > 1 ? "x" + r.qty + " for " : "") + num(r.price) + (c ? " " + c : ""));
    else if (r.qty > 1) parts.push("x" + r.qty);
    if (r.chance !== undefined) parts.push(pct(r.chance) + (r.mats || r.note && /gems/.test(r.note) ? " chance" : " a draw"));
    if (r.when) parts.push(r.when);
    if (r.gate) parts.push(r.gate);
    if (r.limit) parts.push("limit " + r.limit);
    if (r.builtin) parts.push("the game's own row");
    if (r.note) parts.push(r.note);
    return parts;
  }

  function itemLink(id, itemRows, qty) {
    var row = itemRows[id];
    var a = el("a", "src-mat");
    a.href = "/item.html?id=" + id;
    if (row && row[2]) {
      var img = el("img");
      img.src = "/assets/icons/1x/" + row[2] + ".png";
      img.alt = "";
      img.loading = "lazy";
      a.appendChild(img);
    }
    a.appendChild(el("span", null, (row ? row[1] : "Item " + id) + (qty ? " x" + qty : "")));
    return a;
  }

  function whereLine(entry, sources, itemRows, monsterPages) {
    var sid = entry[0], r = entry[1], li = el("li", "where-line");
    var head = el("span", "where-src");
    if (sid === "monster") {
      var page = monsterPages[r.monster];
      var m = el(page ? "a" : "span", null, r.name);
      if (page) m.href = page;
      head.appendChild(m);
      li.appendChild(head);
      li.appendChild(el("span", "where-facts", [r.when, (r.methods || []).join(", "), r.note].filter(Boolean).join(" · ")));
      return li;
    }
    var s = sources[sid] || { name: sid, cur: "" };
    var a = el("a", null, s.name);
    a.href = "/source.html?id=" + encodeURIComponent(sid);
    head.appendChild(a);
    li.appendChild(head);
    var facts = rowFacts(r, s.cur);
    if (facts.length) li.appendChild(el("span", "where-facts", facts.join(" · ")));
    if ((r.mats && r.mats.length) || (r.pieces && r.pieces.length)) {
      var from = el("span", "where-mats");
      from.appendChild(document.createTextNode("from "));
      (r.mats || []).forEach(function (m, i) {
        if (i) from.appendChild(document.createTextNode(", "));
        from.appendChild(itemLink(m[0], itemRows, m[1]));
      });
      (r.pieces || []).forEach(function (p, i) {
        if (i || (r.mats && r.mats.length)) from.appendChild(document.createTextNode(", "));
        from.appendChild(el("span", "where-piece", (p[2] || "piece " + p[1]) + " (" + p[0] + ")"));
      });
      li.appendChild(from);
    }
    return li;
  }

  function questLinks(ids, box) {
    box.textContent = "Loading the quest names...";
    json("/data/search/quests.json").then(function (data) {
      var names = {};
      (data.quests || []).forEach(function (q) { names[q[0]] = q[1]; });
      box.textContent = "";
      var list = el("ul", "item-quests where-quests");
      ids.forEach(function (id) {
        var li = el("li");
        if (names[id]) li.appendChild(el("a", null, names[id])).href = "/quest.html?id=" + id;
        else li.appendChild(el("span", null, "Quest " + id + " (no page yet)"));
        li.appendChild(el("span", "item-quest-count", "#" + id));
        list.appendChild(li);
      });
      box.appendChild(list);
    }).catch(function () { box.textContent = "The quest names could not be loaded."; });
  }

  function wherePanel(detail, sources, itemRows, monsterPages) {
    var where = (detail && detail.where) || [];
    var offered = (detail && detail.offered) || [];
    var gather = (detail && detail.gather) || [];
    var unlisted = (detail && detail.unlisted) || [0, 0];
    var groups = {};
    where.forEach(function (e) {
      var g = e[0] === "monster" ? "monster" : (sources[e[0]] || {}).group || "exchange";
      (groups[g] = groups[g] || []).push(e);
    });
    var ways = where.length + (offered.length ? 1 : 0) + (gather.length ? 1 : 0);
    var panel = section("Where to get it", ways ? ways + (ways === 1 ? " way" : " ways") : "");
    panel.id = "where";
    panel.classList.add("where-panel");
    if (!ways) {
      panel.appendChild(el("p", "empty-state", "No known source: no shop, quest, monster, event, gacha, craft or exchange on Hunsterverse gives this item right now."));
      if (unlisted[0] || unlisted[1]) {
        panel.appendChild(el("p", "note-text", "It is in " + num(unlisted[0] + unlisted[1]) + " quest files that no quest list offers, so players can't get it from them."));
      }
      return panel;
    }
    GROUP_ORDER.forEach(function (g) {
      var rows = groups[g];
      if (g === "quest") {
        if (!offered.length && !gather.length) return;
        rows = [];
      } else if (!rows) return;
      var block = el("div", "where-group");
      block.appendChild(el("h3", null, GROUP_NAMES[g] || g));
      var list = el("ul", "where-list");
      if (g === "quest") {
        if (offered.length) {
          var li = el("li", "where-line");
          var a = el("a", null, "Quest rewards");
          a.href = "/source.html?id=quest-rewards";
          li.appendChild(el("span", "where-src")).appendChild(a);
          var facts = el("span", "where-facts", num(offered.length) + (offered.length === 1 ? " quest" : " quests") + " players can start · ");
          var jump = el("a", null, "see Rewarded by");
          jump.href = "#rewards";
          facts.appendChild(jump);
          li.appendChild(facts);
          list.appendChild(li);
        }
        if (gather.length) {
          var gl = el("li", "where-line");
          var ga = el("a", null, "Gathering in quests");
          ga.href = "/source.html?id=gathering";
          gl.appendChild(el("span", "where-src")).appendChild(ga);
          gl.appendChild(el("span", "where-facts", num(gather.length) + (gather.length === 1 ? " quest" : " quests") + " players can start"));
          var fold = el("details", "where-fold");
          fold.appendChild(el("summary", null, "Show the quests"));
          var box = el("div");
          fold.appendChild(box);
          fold.addEventListener("toggle", function () { if (fold.open && !box.firstChild) questLinks(gather, box); });
          gl.appendChild(fold);
          list.appendChild(gl);
        }
      } else {
        rows.forEach(function (e, i) {
          var line = whereLine(e, sources, itemRows, monsterPages);
          if (i >= WHERE_TOP) line.hidden = true;
          list.appendChild(line);
        });
      }
      block.appendChild(list);
      if (rows.length > WHERE_TOP) {
        var more = el("button", "ghost-btn small", "Show all " + rows.length);
        more.type = "button";
        more.addEventListener("click", function () {
          Array.prototype.forEach.call(list.children, function (c) { c.hidden = false; });
          more.remove();
        });
        block.appendChild(more);
      }
      panel.appendChild(block);
    });
    if (unlisted[0] || unlisted[1]) {
      panel.appendChild(el("p", "note-text", "Also in " + num(unlisted[0] + unlisted[1]) + " quest files that no quest list offers (not counted)."));
    }
    return panel;
  }

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
  function rewardsPanel(rewards, offered) {
    var open = {};
    (offered || []).forEach(function (q) { open[q] = true; });
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
        if (offered && !open[r[0]]) q.appendChild(el("span", "badge src-unlisted", "not offered"));
        tr.appendChild(q);
        tr.appendChild(cell(r[2] || "-"));
        tr.appendChild(cell(rewardWhen(r[3])));
        tr.appendChild(cell("x" + r[4], "num"));
        tr.appendChild(cell(pct(r[5]), "num"));
        return tr;
      }
    });
    panel.appendChild(el("p", "note-text", "Chance of the item on one draw of that reward group. Sub-target and extra condition names are the game's group order; the quest page says more." +
      (offered ? " \"Not offered\": no quest list on Hunsterverse offers that quest file right now." : "")));
    panel.id = "rewards";
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

  function render(row, detail, monsterIcons, sources, itemRows, monsterPages) {
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
    if (sources) view.appendChild(wherePanel(detail, sources, itemRows, monsterPages));
    else {
      var none = section("Where to get it");
      none.appendChild(el("p", "empty-state", "The list of sources could not be loaded."));
      view.appendChild(none);
    }
    if (drops.length) view.appendChild(dropsPanel(drops, monsterIcons));
    if (rewards.length) view.appendChild(rewardsPanel(rewards, detail && detail.offered));
    if (quests.length) view.appendChild(questsPanel(quests));
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
    json("/data/monsters/index.json").catch(function () { return []; }),
    json("/data/sources/index.json").catch(function () { return null; })
  ]).then(function (res) {
    var rows = res[0].items || [];
    var row = rows.filter(function (r) {
      return wantId !== null ? r[0] === wantId : (r[1].toLowerCase() === wantName || (r[3] || "").toLowerCase() === wantName);
    })[0];
    if (!row) {
      fail(wantId !== null ? "There is no item " + wantId + "." : "No item is called that.");
      return;
    }
    var monsterIcons = {}, monsterPages = {}, itemRows = {}, sources = null;
    (Array.isArray(res[1]) ? res[1] : res[1].monsters || []).forEach(function (m) {
      if (m.icon) monsterIcons[m.slug] = m.icon;
      (m.ids || []).forEach(function (id) { if (!monsterPages[id]) monsterPages[id] = "/monster.html?m=" + encodeURIComponent(m.slug); });
    });
    rows.forEach(function (r) { itemRows[r[0]] = r; });
    if (res[2]) {
      sources = {};
      (res[2].sources || []).forEach(function (s) { sources[s[0]] = { name: s[1], group: s[2], cur: s[3] }; });
    }
    var detail = row[4] ? json("/data/items/" + row[0] + ".json").catch(function () { return null; }) : Promise.resolve(null);
    return detail.then(function (d) { render(row, d, monsterIcons, sources, itemRows, monsterPages); });
  }).catch(function () { fail("The item list could not be loaded."); });
})();
