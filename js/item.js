/* Item page: /item.html?id=<the game's item id>. Everything comes from static files made by
   dev/make-item-data.py: data/items/index.json (name, icon, the server's other name, how many sources) and,
   for an item with sources, data/items/<id>.json (monster drops, quests that reward it and quests that need it
   to enter, and from dev/make-source-data.py "where", "gather", "offered" and "unlisted": every way to get it,
   shown first under "Where to get it", each source linked to its page /source.html?id=, named from
   data/sources/index.json), then "Used for" (data/uses/<id>.json from dev/make-use-data.py: recipes, weapons
   and armour, decorations, the Tower, exchanges and quests that take it, and what the item's own data says:
   item pouch, ammo, decoration slots, trade-ins, gacha costs). The description and facts under the name come
   from data/uses/info/<id // 512>.json (dev/make-use-data.py, from hvmhfz_re item_info.json); an item with no
   use and no source says so plainly. Monster icons and the game's monster ids come from data/monsters/index.json.
   ?name= (an exact item name) is accepted too, for old links. An item that is itself a currency (listed under
   "items" in data/currencies.json) links to its entry on /currencies.html under the facts. */
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

  /* "Where to get it": every source of the item (data/items/<id>.json "where", "gather", "fish", "supply", "offered",
     "unlisted"), grouped as data/sources/index.json's groups, each line linked to its source page. */
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
    var fish = (detail && detail.fish) || [];
    var supply = (detail && detail.supply) || [];
    var unlisted = (detail && detail.unlisted) || [0, 0];
    /* The quest lists of the Quests group: gathering, fishing (part 208) and the supply box (part 208). */
    var questKinds = [[gather, "gathering", "Gathering in quests", ""],
                      [fish, "fishing", "Fishing in quests", ""],
                      [supply, "quest-supply-box", "Quest supply box", "in that quest only: taken back when it ends"]]
      .filter(function (k) { return k[0].length; });
    var groups = {};
    where.forEach(function (e) {
      var g = e[0] === "monster" ? "monster" : (sources[e[0]] || {}).group || "exchange";
      (groups[g] = groups[g] || []).push(e);
    });
    var ways = where.length + (offered.length ? 1 : 0) + questKinds.length;
    var panel = section("Where to get it", ways ? ways + (ways === 1 ? " way" : " ways") : "");
    panel.id = "where";
    panel.classList.add("where-panel");
    if (!ways) {
      panel.appendChild(el("p", "empty-state", "No source on this server yet: no shop, quest, monster, event, gacha, craft or exchange on Hunsterverse gives this item right now."));
      if (unlisted[0] || unlisted[1]) {
        panel.appendChild(el("p", "note-text", "It is in " + num(unlisted[0] + unlisted[1]) + " quest files that no quest list offers, so players can't get it from them."));
      }
      return panel;
    }
    GROUP_ORDER.forEach(function (g) {
      var rows = groups[g];
      if (g === "quest") {
        if (!offered.length && !questKinds.length) return;
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
        questKinds.forEach(function (k) {
          var ids = k[0];
          var gl = el("li", "where-line where-" + k[1]);
          var ga = el("a", null, k[2]);
          ga.href = "/source.html?id=" + k[1];
          gl.appendChild(el("span", "where-src")).appendChild(ga);
          gl.appendChild(el("span", "where-facts", num(ids.length) + (ids.length === 1 ? " quest" : " quests") + " players can start" + (k[3] ? " · " + k[3] : "")));
          var fold = el("details", "where-fold");
          fold.appendChild(el("summary", null, "Show the quests"));
          var box = el("div");
          fold.appendChild(box);
          fold.addEventListener("toggle", function () { if (fold.open && !box.firstChild) questLinks(ids, box); });
          gl.appendChild(fold);
          list.appendChild(gl);
        });
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

  /* "Used for": every recipe, piece of equipment, Tower upgrade, exchange and quest that takes the item
     (data/uses/<id>.json, dev/make-use-data.py). Equipment rows are [slot, id, qty, kind], named from
     data/equipment/<slot>/names.json ([name, rarity, parent id] by id) and linked to /equipment.html. */
  var USE_GROUPS = [["use", "What it does"], ["craft", "Crafting"], ["weapon", "Weapons"], ["armour", "Armour"],
                    ["deco", "Decorations"], ["tower", "Tower"], ["exchange", "Exchanges"],
                    ["trade", "Trade-ins and gacha"], ["quest", "Quests"]];
  /* The "What it does" lines (hvmhfz_re item_info.py): [title, what to do with it]. Items whose effect the
     client's item-use code shows (hvmhfz_re item_effects.py, info "fx") list it under the pouch line instead
     of pointing at the description. */
  var OWN_USES = { pouch: ["Item pouch", "use it from the item pouch during a quest (what it does: the description above)"],
                   carry: ["Item pouch", "works while it is in your item pouch"],
                   ammo: ["Bowgun ammo", "load it into a bowgun"],
                   coating: ["Bow coating", "load it onto a bow's arrows"],
                   crystal: ["S.Crystal", "load it into a weapon that takes S.Crystals (the description above says which)"],
                   cooking: ["Cooking ingredient", "the game marks it as a cooking item"],
                   deco: ["Decoration", "set it into a decoration slot for the skill points above"],
                   gem: ["Road gem (Tower Deco)", "set it into a Tower weapon for the skill points above"],
                   jewel: ["Partnya decoration", "set it into your Partnya's (partner Felyne's) gear"],
                   sigil: ["Sigil", "gives a weapon a special effect (the description above says which)"] };
  var USE_SYS = { combining: ["Item combining", "combining"], combiner: ["Combiner", "combiner"],
                  deco: ["Smithy decoration", "smithy-decorations"], cuff: ["Skill cuff workshop", "cuff-workshop"],
                  tower: ["Tower smithy", "tower-smithy"], "tower-gem": ["Tower Decos", "tower-gems"],
                  "gem-mixer": ["Gem mixer", "gem-mixer"], "tower-up": ["Tower weapon upgrade", null],
                  series: ["Series Quests exchange", "series-exchange"] };
  var SLOT_NAMES = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs", melee: "Melee", ranged: "Ranged" };
  var USE_TOP = 8, USE_PAGE = 200;

  function eqName(names, slot, id) {
    var e = names[slot] && names[slot][id];
    return e ? e[0] : SLOT_NAMES[slot] + " " + id;
  }

  function eqLink(names, slot, id) {
    var a = el("a", null, eqName(names, slot, id));
    a.href = "/equipment.html?slot=" + slot + "&id=" + id;
    return a;
  }

  /* One "Used for" line and its filter text. */
  function useLine(r, ctx) {
    var li = el("li", "where-line"), head = el("span", "where-src"), facts = [], text, fx = null;
    li.appendChild(head);
    if (Array.isArray(r)) { // [slot, id, qty, kind]
      var slot = r[0], id = r[1], e = ctx.names[slot] && ctx.names[slot][id];
      head.appendChild(eqLink(ctx.names, slot, id));
      var type = slot === "melee" || slot === "ranged" ? ctx.weaponType(slot, id) : SLOT_NAMES[slot];
      facts.push("x" + num(r[2]));
      if (r[3] === "t") facts.push("transmog unlock");
      else if (r[3] === "u") facts.push(e && e[2] ? "upgrade from " + eqName(ctx.names, slot, e[2]) : "upgrade");
      else facts.push("to make it");
      if (type) facts.push(type);
      if (e && e[1]) facts.push("rarity " + e[1]);
      text = eqName(ctx.names, slot, id) + " " + facts.join(" ");
    } else if (r.g === "quest") {
      var q = el("a", null, r.name);
      q.href = "/quest.html?id=" + r.quest;
      head.appendChild(q);
      facts.push("deliver x" + num(r.qty), r.obj + " objective");
      text = r.name + " " + r.quest;
    } else if (r.s === "tower-up") {
      head.appendChild(eqLink(ctx.names, r.eq[0], r.eq[1]));
      facts.push(r.stat + " to its maximum (" + r.levels + (r.levels === 1 ? " level" : " levels") + ")", "x" + num(r.qty) + " in all");
      text = eqName(ctx.names, r.eq[0], r.eq[1]) + " " + r.stat;
    } else if (r.g === "use") {
      var own = OWN_USES[r.s] || [r.s, ""];
      fx = (r.s === "pouch" || r.s === "carry") && ctx.info && ctx.info.fx || null;
      head.appendChild(el("span", null, own[0]));
      if (own[1]) facts.push(fx && r.s === "pouch" ? "use it from the item pouch during a quest" : own[1]);
      if ((r.s === "deco" || r.s === "gem") && ctx.info && ctx.info.slots) facts.push(ctx.info.slots + (ctx.info.slots === 1 ? " slot" : " slots"));
      text = own.join(" ") + (fx ? " " + fx.join(" ") : "");
    } else if (r.s === "fp-trade" || r.s === "gcp-sell") {
      head.appendChild(el("span", null, r.s === "fp-trade" ? "Frontier Point exchange" : "GCP sell list"));
      facts.push("trade in x" + num(r.qty) + " for " + num(r.s === "fp-trade" ? r.fp : r.gcp) + (r.s === "fp-trade" ? " Frontier Points" : " GCP"));
      text = r.s === "fp-trade" ? "frontier point exchange trade in" : "gcp sell";
    } else if (r.s === "gacha") {
      var gsrc = ctx.sources && ctx.sources["gacha-" + r.gacha];
      var g = el(gsrc ? "a" : "span", null, r.name || "Gacha " + r.gacha);
      if (gsrc) g.href = "/source.html?id=" + encodeURIComponent("gacha-" + r.gacha);
      head.appendChild(g);
      facts.push("gacha cost: x" + num(r.qty) + " for " + num(r.rolls) + (r.rolls === 1 ? " draw" : " draws"));
      text = (r.name || "") + " gacha";
    } else if (r.s === "gem-mixer") {
      head.appendChild(el("span", null, "Any " + r.any + "+ Tower gems"));
      facts.push("a random gem, " + r.made.length + (r.made.length === 1 ? " possible result" : " possible results"));
      text = "gem mixer";
    } else {
      head.appendChild(itemLink(r.item, ctx.itemRows, r.n > 1 ? r.n : 0));
      facts.push("x" + num(r.qty));
      if (r.price !== undefined) facts.push(num(r.price) + (r.cur ? " " + r.cur : ""));
      if (r.note) facts.push(r.note);
      text = (ctx.itemRows[r.item] ? ctx.itemRows[r.item][1] : "") + " " + (r.note || "");
    }
    var sys = r.s && USE_SYS[r.s];
    var factsEl = el("span", "where-facts");
    if (sys) {
      var src = sys[1] && ctx.sources && ctx.sources[sys[1]];
      var s = el(src ? "a" : "span", null, sys[0]);
      if (src) s.href = "/source.html?id=" + encodeURIComponent(sys[1]);
      factsEl.appendChild(s);
      factsEl.appendChild(document.createTextNode(" · "));
      text += " " + sys[0];
    }
    factsEl.appendChild(document.createTextNode(facts.join(" · ")));
    li.appendChild(factsEl);
    if (fx) { // what it does, with the numbers
      var fxList = el("ul", "item-fx");
      fx.forEach(function (line) { fxList.appendChild(el("li", null, line)); });
      li.appendChild(fxList);
    }
    if (!Array.isArray(r) && r.with && r.with.length) { // (arrays have a .with method)
      var w = el("span", "where-mats");
      w.appendChild(document.createTextNode("with "));
      r.with.forEach(function (m, i) {
        if (i) w.appendChild(document.createTextNode(", "));
        w.appendChild(itemLink(m[0], ctx.itemRows, m[1]));
        text += " " + (ctx.itemRows[m[0]] ? ctx.itemRows[m[0]][1] : "");
      });
      li.appendChild(w);
    }
    return { li: li, text: text.toLowerCase() };
  }

  function useGroup(title, rows, ctx) {
    var block = el("div", "where-group");
    block.appendChild(el("h3", null, title + " · " + num(rows.length)));
    var state = { q: "", limit: USE_TOP }, lines = rows.map(function (r) { return { r: r, line: null }; });
    var list = el("ul", "where-list");
    var more = el("button", "ghost-btn small");
    more.type = "button";
    if (rows.length > USE_TOP) {
      var input = el("input", "use-filter");
      input.type = "search";
      input.placeholder = "Filter " + num(rows.length) + " " + title.toLowerCase();
      input.setAttribute("aria-label", "Filter " + title.toLowerCase());
      input.addEventListener("input", function () { state.q = input.value.trim().toLowerCase(); state.limit = USE_PAGE; drawUses(); });
      block.appendChild(input);
    }
    block.appendChild(list);
    block.appendChild(more);
    more.addEventListener("click", function () { state.limit = state.limit < USE_PAGE ? USE_PAGE : state.limit + USE_PAGE; drawUses(); });
    function drawUses() {
      list.textContent = "";
      var shown = 0, matched = 0;
      lines.forEach(function (x) {
        if (state.q) {
          if (!x.line) x.line = useLine(x.r, ctx);
          if (x.line.text.indexOf(state.q) === -1) return;
        }
        matched++;
        if (shown >= state.limit) return;
        if (!x.line) x.line = useLine(x.r, ctx);
        list.appendChild(x.line.li);
        shown++;
      });
      if (!matched) list.appendChild(el("li", "where-line note-text", "Nothing matches."));
      more.hidden = matched <= shown;
      more.textContent = state.limit < USE_PAGE && !state.q ? "Show all " + num(matched)
        : "Show " + num(Math.min(USE_PAGE, matched - shown)) + " more of " + num(matched - shown);
    }
    drawUses();
    return block;
  }

  /* The line an item with no use shows: an unused slot of the game's list, or what it sells for. */
  function noUseText(info) {
    if (info && info.status) {
      return "Unreleased content: this is an unused " + (info.status === "dev" ? "development" : info.status) +
        " entry of the game's item list. Nothing in the game or on this server uses it.";
    }
    var sell = info && info.sell ? "sells for " + num(info.sell) + " z" : info ? "it can't be sold for zenny" : "";
    return "No known use" + (sell ? ": " + sell + "." : ".") +
      " No recipe, piece of equipment, Tower upgrade, exchange, trade-in or quest takes it, and its game data marks no other use.";
  }

  function usesPanel(uses, needs, ctx) {
    var rows = (uses && uses.rows) || [];
    var groups = {};
    rows.forEach(function (r) {
      var g = Array.isArray(r) ? (r[0] === "melee" || r[0] === "ranged" ? "weapon" : "armour") : r.g;
      (groups[g] = groups[g] || []).push(r);
    });
    var total = rows.length + (needs.length ? 1 : 0);
    var panel = section("Used for", total ? num(rows.length + needs.length) + (rows.length + needs.length === 1 ? " use" : " uses") : "");
    panel.id = "uses";
    panel.classList.add("where-panel");
    if (!total) {
      panel.appendChild(el("p", "empty-state", noUseText(ctx && ctx.info)));
      return panel;
    }
    USE_GROUPS.forEach(function (g) {
      var list = groups[g[0]] || [];
      if (g[0] === "quest" && needs.length) {
        list = list.concat([{ g: "quest", needs: needs.length }]);
      }
      if (!list.length) return;
      if (g[0] === "quest" && needs.length) {
        var deliver = list.filter(function (r) { return !r.needs; });
        var block = deliver.length ? useGroup(g[1], deliver, ctx) : el("div", "where-group");
        if (!deliver.length) block.appendChild(el("h3", null, g[1]));
        var li = el("li", "where-line");
        var a = el("a", null, "Needed to enter");
        a.href = "#needs";
        li.appendChild(el("span", "where-src")).appendChild(a);
        li.appendChild(el("span", "where-facts", num(needs.length) + (needs.length === 1 ? " quest takes it" : " quests take it") + " from your box when you accept them"));
        var ul = block.querySelector(".where-list") || block.appendChild(el("ul", "where-list"));
        ul.insertBefore(li, ul.firstChild);
        panel.appendChild(block);
        return;
      }
      panel.appendChild(useGroup(g[1], list, ctx));
    });
    return panel;
  }

  /* The names files of the equipment slots the rows name, and the weapon types (data/weapons/ids.json). */
  function useContext(uses, itemRows, sources, info) {
    var slots = {}, weapons = false;
    ((uses && uses.rows) || []).forEach(function (r) {
      var s = Array.isArray(r) ? r[0] : r.eq && r.eq[0];
      if (s) { slots[s] = true; if (s === "melee" || s === "ranged") weapons = true; }
    });
    var names = {}, ids = null;
    var jobs = Object.keys(slots).map(function (s) {
      return json("/data/equipment/" + s + "/names.json").then(function (d) { names[s] = d.names; }).catch(function () {});
    });
    if (weapons) jobs.push(json("/data/weapons/ids.json").then(function (d) { ids = d; }).catch(function () {}));
    return Promise.all(jobs).then(function () {
      return {
        names: names, itemRows: itemRows, sources: sources, info: info,
        weaponType: function (slot, id) {
          var ch = ids && ids[slot] && ids[slot].charAt(id);
          if (!ch || ch === ".") return SLOT_NAMES[slot];
          return ids.types[ch.charCodeAt(0) - 97].replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
        }
      };
    });
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
    panel.id = "needs";
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

  var KINDS = { material: "Material", consumable: "Consumable", tool: "Tool", ammo: "Ammo", book: "Book",
                "ticket-proof": "Ticket or proof", coin: "Coin", decoration: "Decoration", "road-gem": "Road gem (Tower Deco)",
                "felyne-jewel": "Partnya jewel", "skill-scroll": "Sigil", sigil: "Sigil", "armor-sphere": "Armour sphere",
                "special-material": "Special material", poogie: "Poogie item", house: "House item", pot: "Pot", song: "Song",
                placeholder: "Unused slot" };

  /* The description and the basic facts under the name (data/uses/info, from the game's item table). */
  function aboutItem(box, f) {
    if (f.desc) {
      var d = el("p", "item-desc", f.desc);
      box.appendChild(d);
      if (f.from === "site") box.appendChild(el("p", "note-text item-desc-note", "Translated for this site: the game still shows this description in Japanese."));
    } else if (f.status) {
      box.appendChild(el("p", "item-desc", "An unused " + (f.status === "dev" ? "development" : f.status) + " entry of the game's item list: it has no real description."));
    } else {
      box.appendChild(el("p", "item-desc", "The game gives this item no description."));
    }
    var list = el("ul", "item-facts");
    function fact(label, value) {
      var li = el("li");
      li.appendChild(el("span", "item-fact-label", label));
      li.appendChild(document.createTextNode(" " + value));
      list.appendChild(li);
    }
    if (f.kind) fact("Type", KINDS[f.kind] || f.kind);
    if (f.r) fact("Rarity", f.r);
    if (f.stack) fact("Carry limit", num(f.stack));
    if (f.buy) fact("Buy", num(f.buy) + " z");
    fact("Sell", f.sell ? num(f.sell) + " z" : "can't be sold");
    box.appendChild(list);
  }

  function render(row, detail, monsterIcons, sources, itemRows, monsterPages, uses, facts, currency) {
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
    if (facts) aboutItem(info, facts);
    if (currency) {
      var cur = el("p", "note-text item-currency");
      cur.appendChild(document.createTextNode("A currency: "));
      cur.appendChild(el("a", null, "how to get " + currency.name + " and what it buys")).href = "/currencies.html#" + encodeURIComponent(currency.id);
      info.appendChild(cur);
    }
    if (window.HvSkillLinks) info.appendChild(window.HvSkillLinks.item(id)); // "Skills: ..." (js/skill-links.js)
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
    if (uses) view.appendChild(usesPanel(uses.data, quests, uses.ctx));
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
    json("/data/sources/index.json").catch(function () { return null; }),
    json("/data/currencies.json").catch(function () { return null; })
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
    var currency = null; // the currency this item is, if any (data/currencies.json "items")
    ((res[3] && res[3].currencies) || []).forEach(function (c) {
      if ((c.items || []).indexOf(row[0]) !== -1) currency = c;
    });
    var detail = row[4] ? json("/data/items/" + row[0] + ".json").catch(function () { return null; }) : Promise.resolve(null);
    // the description and facts: one file per 512 ids (dev/make-use-data.py)
    var facts = json("/data/uses/info/" + Math.floor(row[0] / 512) + ".json").then(function (d) {
      return (d.items || {})[row[0]] || null;
    }).catch(function () { return null; });
    // data/uses/<id>.json exists only for an item with a use: a 404 is "no known use"
    var uses = Promise.all([fetch("/data/uses/" + row[0] + ".json").then(function (r) {
      return r.status === 404 ? { rows: [] } : r.ok ? r.json() : null;
    }).catch(function () { return null; }), facts]).then(function (got) {
      var u = got[0];
      return u ? useContext(u, itemRows, sources, got[1]).then(function (ctx) { return { data: u, ctx: ctx }; }) : null;
    });
    return Promise.all([detail, uses, facts]).then(function (res) { render(row, res[0], monsterIcons, sources, itemRows, monsterPages, res[1], res[2], currency); });
  }).catch(function () { fail("The item list could not be loaded."); });
})();
