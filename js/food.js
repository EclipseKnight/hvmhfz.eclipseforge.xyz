/* Food and Bentos: /food.html. Every Hunter Bento the game can make, from data/food-recipes.json (copied from the
   game's data by dev/copy-food-data.py; what each field means: the "about" line in it and README "Pages").

   Tabs (js/subtabs.js): #bentos, #sr, #ingredients, #how.
   - Bentos: a season switch (the game's Warm, Cold and Breeding Season), a recommended strip for that season, then
     every pair of two different normal ingredients (990) with health, stamina, attack and defence, filtered by an
     ingredient or dish search (English or Japanese; "A + B" for one pair), where to buy, and each stat (any,
     raised, lowered, not lowered, at least N), sorted by "best overall" (score() below) or one stat, 50 rows at a
     time. The season, search, filters and sort stay in the address (?season=&q=&buy=&sort=&health=...).
   - SR bentos: the 4 x 4 grid of the 16 fixed SR bentos (same in every season).
   - Ingredients: the 53 ingredients with where to buy them here and the shop's full price.
   Item links go to /item.html?id=; the game's icons come from data/item-icons.json when it loads. */
(function () {
  "use strict";

  var STATS = ["health", "stamina", "attack", "defence"];
  var STAT_LABELS = { health: "Health", stamina: "Stamina", attack: "Attack", defence: "Defence" };
  // "At least" steps per stat: the values a bento can reach (health 10-50, stamina 25 or 50, attack 3 or 5, defence 10 or 20).
  var MINIMUMS = { health: [20, 30, 40, 50], stamina: [25, 50], attack: [3, 5], defence: [10, 20] };
  var KIND_LABELS = { vegetable: "Vegetable", grain: "Grain", meat: "Meat", fish: "Fish", bug: "Bug", oil: "Oil and fat",
    dairy: "Dairy", drink: "Drink", egg: "Egg", special: "Special", sr: "SR" };
  // How easy an ingredient is to buy, easiest first: used for the short label and to break ties between equal bentos.
  var BUY = ["food", "cat", "foodsome", "course", "none"];
  var BUY_SHORT = { food: "Food shop", foodsome: "Food shop, some days", cat: "Guild store cat", course: "Course shop",
    none: "No shop", sr: "Food shop at GR 999" };
  var PAGE = 50;

  var $ = function (id) { return document.getElementById(id); };
  var view = $("food-view"), count = $("food-count"), qInput = $("food-q"), buySel = $("food-buy"), sortSel = $("food-sort");
  var statSel = { health: $("food-health"), stamina: $("food-stamina"), attack: $("food-attack"), defence: $("food-defence") };

  var data, ing = {}, icons = null, season = "warm", limit = PAGE;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function norm(s) {
    s = String(s || "");
    if (s.normalize) s = s.normalize("NFKC");
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function signed(n) { return n > 0 ? "+" + n : n < 0 ? "−" + (-n) : "–"; }

  /* ---------- ingredients ---------- */

  function buyClasses(i) {
    var out = {};
    (i.sellers || []).forEach(function (s) {
      if (s.shop === "food_shop" && s.when === "always") out.food = true;
      else if (s.shop === "food_shop" && s.when === "gr_cap") out.sr = true;
      else if (s.shop === "food_shop") out.foodsome = true;
      else if (s.shop === "guild_store_cat") out.cat = true;
      else out.course = true;
    });
    return out;
  }

  // The places an ingredient no shop sells comes from, in plain words, from the server's source list.
  var SOURCE_WORDS = { "fishing": "fishing", "gathering": "gathering", "quest reward": "quest rewards", "monster": "monsters",
    "guild": "guild treasure hunts", "shop": "the Hunting Road shop", "quest supply": "quest supplies" };
  function otherPlaces(i) {
    var seen = [];
    String(i.server_sources || "").split(" | ").forEach(function (part) {
      var word = SOURCE_WORDS[part.split(":")[0]];
      if (word && seen.indexOf(word) === -1) seen.push(word);
    });
    return seen;
  }

  function whereLong(i) {
    var out = [];
    (i.sellers || []).forEach(function (s) {
      var t;
      if (s.shop === "food_shop") t = s.when === "always" ? "Food shop, every day" : s.when === "gr_cap" ? "Food shop, GR 999 hunters only" : "Food shop, on its extra-stock days";
      else if (s.shop === "guild_store_cat") {
        t = "Guild store cat (guild rank 4 or more)";
        if (s.hr && s.hr.length && s.hr.length < 3) t += ", HR " + s.hr.join(", ");
      } else t = "Course shop";
      if (out.indexOf(t) === -1) out.push(t);
    });
    if (!out.length) {
      var places = otherPlaces(i);
      out.push("No shop" + (places.length ? ": " + places.join(", ") : ""));
    }
    return out;
  }

  function prepare(d) {
    data = d;
    d.ingredients.forEach(function (i) {
      i.buy = buyClasses(i);
      i.ease = i.sr ? 0 : BUY.indexOf(BUY.filter(function (b) { return i.buy[b]; })[0] || "none");
      i.short = i.sr ? BUY_SHORT.sr : BUY_SHORT[BUY[i.ease]];
      i.n = [norm(i.en), norm(i.ja)];
      ing[i.id] = i;
    });
    d.bentos.forEach(function (b) {
      var A = ing[b.a], B = ing[b.b];
      b.hay = [A.en, A.ja, B.en, B.ja, b.name.en, b.name.ja].map(norm).join(" ");
      b.ease = Math.max(A.ease, B.ease);
    });
  }

  function itemLink(id, withIcon) {
    var i = ing[id];
    var a = el("a", "food-ing");
    a.href = "/item.html?id=" + id;
    if (withIcon !== false && icons && icons[String(id)]) {
      var img = el("img", "food-icon");
      var key = encodeURIComponent(icons[String(id)]);
      img.src = "/assets/icons/1x/" + key + ".png";
      img.srcset = "/assets/icons/1x/" + key + ".png 1x, /assets/icons/2x/" + key + ".png 2x";
      img.width = 20; img.height = 20; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
      a.appendChild(img);
    }
    a.appendChild(el("span", null, i ? i.en : "Item " + id));
    return a;
  }

  /* ---------- scores, filters ---------- */

  /* Best overall: health first, then attack, stamina and defence. With Health on "Lowered" (Adrenaline) a lower health
     counts as better. The page's legend says the same formula in words. */
  function score(v, lowered) {
    return (lowered ? -1.5 : 1.5) * v.health + v.stamina + 10 * v.attack + v.defence / 2;
  }

  function byBest(lowered) {
    return function (x, y) {
      return score(y[season], lowered) - score(x[season], lowered) || x.ease - y.ease ||
        x.name.en.localeCompare(y.name.en) || x.a - y.a || x.b - y.b;
    };
  }

  function statOk(v, rule) {
    if (!rule) return true;
    if (rule === "up") return v > 0;
    if (rule === "down") return v < 0;
    if (rule === "notdown") return v >= 0;
    var m = /^min(\d+)$/.exec(rule);
    return m ? v >= Number(m[1]) : true;
  }

  function buyOk(b, rule) {
    if (!rule) return true;
    var A = ing[b.a], B = ing[b.b];
    function shop(i) { return i.buy.food || i.buy.foodsome || i.buy.cat; }
    function any(i) { return shop(i) || i.buy.course; }
    if (rule === "food") return !!(A.buy.food && B.buy.food);
    if (rule === "shop") return !!(shop(A) && shop(B));
    if (rule === "anyshop") return !!(any(A) && any(B));
    if (rule === "noshop") return !any(A) || !any(B);
    return true;
  }

  /* The search: parts split on "+" or ","; a part that is an ingredient's whole name (English or Japanese) must be
     one of the pair, any other part must have each of its words in the pair's names or the dish name. */
  function matcher(q) {
    var parts = norm(q).split(/[+,、＋]/).map(function (p) { return p.trim(); }).filter(Boolean);
    var tests = parts.map(function (p) {
      var exact = data.ingredients.filter(function (i) { return i.n.indexOf(p) !== -1; })[0];
      if (exact) return function (b) { return b.a === exact.id || b.b === exact.id; };
      var words = p.split(" ");
      return function (b) { return words.every(function (w) { return b.hay.indexOf(w) !== -1; }); };
    });
    return function (b) { return tests.every(function (t) { return t(b); }); };
  }

  function filtered() {
    var rules = {};
    STATS.forEach(function (s) { rules[s] = statSel[s].value; });
    var match = matcher(qInput.value), buy = buySel.value;
    var rows = data.bentos.filter(function (b) {
      var v = b[season];
      return match(b) && buyOk(b, buy) && STATS.every(function (s) { return statOk(v[s], rules[s]); });
    });
    var sort = sortSel.value, lowered = rules.health === "down";
    var best = byBest(lowered);
    if (STATS.indexOf(sort) !== -1) rows.sort(function (x, y) { return y[season][sort] - x[season][sort] || best(x, y); });
    else if (sort === "dish") rows.sort(function (x, y) { return x.name.en.localeCompare(y.name.en) || best(x, y); });
    else rows.sort(best);
    return rows;
  }

  /* ---------- drawing ---------- */

  function statCell(v, stat) {
    var td = el("td", "num food-stat" + (v > 0 ? " is-up" : v < 0 ? " is-down" : " is-zero"), signed(v));
    td.setAttribute("data-label", STAT_LABELS[stat]);
    return td;
  }

  function pairCell(b) {
    var td = el("td", "food-pair");
    [b.a, b.b].forEach(function (id, n) {
      var line = el("span", "food-pair-line");
      if (n) line.appendChild(el("span", "food-plus", "+ "));
      line.appendChild(itemLink(id));
      var where = el("span", "food-where", ing[id].short);
      where.title = whereLong(ing[id]).join("; ");
      line.appendChild(where);
      td.appendChild(line);
    });
    return td;
  }

  function dishCell(name) {
    var td = el("td", "food-dish");
    td.appendChild(el("span", "food-dish-en", name.en));
    if (name.ja) {
      var ja = el("span", "food-ja", name.ja);
      ja.lang = "ja";
      td.appendChild(ja);
    }
    return td;
  }

  function drawTable() {
    var rows = filtered();
    view.textContent = "";
    count.textContent = (rows.length === data.bentos.length ? "" : rows.length + " of ") + data.bentos.length + " bentos in the " +
      seasonName(season);
    if (!rows.length) {
      view.appendChild(el("p", "empty-state", "No bento matches these filters in the " + seasonName(season) + ". Try another season or clear a filter."));
      return;
    }
    var wrap = el("div", "table-wrap food-table-wrap");
    var t = el("table", "data-table food-table");
    var cap = el("caption", "visually-hidden", "Bentos in the " + seasonName(season));
    t.appendChild(cap);
    var tr = el("tr");
    [["Dish"], ["Ingredients"], ["Health", "num"], ["Stamina", "num"], ["Attack", "num"], ["Defence", "num"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.scope = "col";
      tr.appendChild(th);
    });
    t.appendChild(el("thead")).appendChild(tr);
    var body = t.appendChild(el("tbody"));
    rows.slice(0, limit).forEach(function (b) {
      var v = b[season], row = el("tr");
      row.appendChild(dishCell(b.name));
      row.appendChild(pairCell(b));
      STATS.forEach(function (s) { row.appendChild(statCell(v[s], s)); });
      body.appendChild(row);
    });
    wrap.appendChild(t);
    view.appendChild(wrap);
    if (rows.length > limit) {
      var more = el("div", "food-more");
      var next = Math.min(PAGE, rows.length - limit);
      var b1 = el("button", "ghost-btn small", "Show " + next + " more");
      b1.type = "button";
      b1.addEventListener("click", function () { limit += PAGE; drawTable(); });
      var b2 = el("button", "ghost-btn small", "Show all " + rows.length);
      b2.type = "button";
      b2.addEventListener("click", function () { limit = rows.length; drawTable(); });
      more.appendChild(b1);
      more.appendChild(b2);
      more.appendChild(el("span", "toolbar-note", "Showing " + limit + " of " + rows.length));
      view.appendChild(more);
    }
  }

  function seasonName(key) {
    var s = data.seasons.filter(function (x) { return x.key === key; })[0];
    return s ? s.en : key;
  }

  /* The recommended strip: for this season the best bento of each kind; equal ones go to the easier to buy. */
  function picks() {
    var all = data.bentos.slice();
    var best = byBest(false);
    var out = [];
    var round = all.slice().sort(best)[0];
    out.push(["All round", round]);
    out.push(["Most health and stamina", all.slice().sort(function (x, y) {
      return (y[season].health + y[season].stamina) - (x[season].health + x[season].stamina) || best(x, y);
    })[0]]);
    out.push(["Most defence", all.filter(function (b) { return b[season].health >= 0; }).sort(function (x, y) {
      return y[season].defence - x[season].defence || best(x, y);
    })[0]]);
    out.push(["Adrenaline (health lowered)", all.filter(function (b) { return b[season].health < 0; }).sort(byBest(true))[0]]);
    return out.filter(function (p) { return p[1]; });
  }

  function drawRecommended() {
    var box = $("food-rec");
    box.textContent = "";
    $("food-rec-season").textContent = "the " + seasonName(season);
    picks().forEach(function (p) {
      var b = p[1], v = b[season];
      var card = el("article", "food-card");
      card.appendChild(el("p", "food-card-kind", p[0]));
      card.appendChild(el("h3", "food-card-dish", b.name.en));
      var pair = el("p", "food-card-pair");
      pair.appendChild(itemLink(b.a));
      pair.appendChild(el("span", "food-plus", " + "));
      pair.appendChild(itemLink(b.b));
      card.appendChild(pair);
      var stats = el("p", "food-card-stats");
      STATS.forEach(function (s) {
        if (!v[s]) return;
        stats.appendChild(el("span", "food-badge " + (v[s] > 0 ? "is-up" : "is-down"), STAT_LABELS[s] + " " + signed(v[s])));
      });
      card.appendChild(stats);
      card.appendChild(el("p", "food-card-where", "Buy: " + ing[b.a].en + ", " + ing[b.a].short.toLowerCase() + "; " +
        ing[b.b].en + ", " + ing[b.b].short.toLowerCase() + "."));
      box.appendChild(card);
    });
  }

  function drawSeasons() {
    var box = $("food-seasons");
    box.textContent = "";
    data.seasons.forEach(function (s) {
      var b = el("button", "chip", s.en);
      b.type = "button";
      b.dataset.season = s.key;
      b.setAttribute("aria-pressed", String(s.key === season));
      b.addEventListener("click", function () {
        season = s.key;
        limit = PAGE;
        update();
      });
      box.appendChild(b);
    });
  }

  // "Attack +15 · Defence +80": the stats of a bento that are not 0.
  function gives(b, stats) {
    return stats.filter(function (k) { return b[k]; }).map(function (k) { return STAT_LABELS[k] + " " + signed(b[k]); }).join(" · ");
  }

  function drawSr() {
    var box = $("food-sr");
    box.textContent = "";
    var tops = [], sides = [], cell = {};
    data.sr_bentos.forEach(function (b) {
      if (tops.indexOf(b.a) === -1) tops.push(b.a);
      if (sides.indexOf(b.b) === -1) sides.push(b.b);
      cell[b.a + ":" + b.b] = b;
    });
    var wrap = el("div", "table-wrap food-sr-wrap");
    var t = el("table", "data-table sticky-first food-sr-table");
    t.appendChild(el("caption", "visually-hidden", "The 16 SR bentos: an SR ingredient on top with one on the side"));
    var tr = el("tr");
    var corner = el("th", "food-sr-corner", "Side ↓ · top →");
    corner.scope = "col";
    tr.appendChild(corner);
    tops.forEach(function (a) {
      var th = el("th");
      th.scope = "col";
      th.appendChild(itemLink(a));
      th.appendChild(el("span", "food-sr-gives", gives(cell[a + ":" + sides[0]], ["attack", "defence"])));
      tr.appendChild(th);
    });
    t.appendChild(el("thead")).appendChild(tr);
    var body = t.appendChild(el("tbody"));
    sides.forEach(function (s) {
      var row = el("tr");
      var th = el("th");
      th.scope = "row";
      th.appendChild(itemLink(s));
      var any = cell[tops[0] + ":" + s];
      th.appendChild(el("span", "food-sr-gives", gives(any, ["health", "stamina"]) + (any.health < 0 ? " (Adrenaline)" : "")));
      row.appendChild(th);
      tops.forEach(function (a) {
        var b = cell[a + ":" + s];
        var td = el("td", "food-sr-cell");
        td.setAttribute("data-label", "With " + ing[a].en);
        if (b) {
          td.appendChild(el("span", "food-dish-en", b.name.en));
          if (b.name.ja) { var ja = el("span", "food-ja", b.name.ja); ja.lang = "ja"; td.appendChild(ja); }
          var st = el("span", "food-sr-stats");
          STATS.forEach(function (k) {
            if (b[k]) st.appendChild(el("span", "food-badge " + (b[k] > 0 ? "is-up" : "is-down"), STAT_LABELS[k] + " " + signed(b[k])));
          });
          td.appendChild(st);
          if (b.taste) td.title = "After eating: “" + b.taste + "”";
        } else td.textContent = "–";
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    wrap.appendChild(t);
    box.appendChild(wrap);
    box.appendChild(el("p", "note-text", "The numbers mean the same as in the Bentos tab. An SR ingredient only makes a bento with one from the other group; it does not mix with normal ingredients. Point at a dish to see what the game says after eating it."));

    var links = $("food-sr-links");
    links.textContent = "";
    data.ingredients.filter(function (i) { return i.sr; }).forEach(function (i, n, list) {
      if (n) links.appendChild(document.createTextNode(n === list.length - 1 ? " and " : ", "));
      links.appendChild(itemLink(i.id, false));
    });
  }

  function drawIngredients() {
    var box = $("food-ings");
    box.textContent = "";
    var wrap = el("div", "table-wrap food-ing-wrap");
    var t = el("table", "data-table sticky-first food-ing-table");
    t.appendChild(el("caption", "visually-hidden", "Bento ingredients and where to buy them"));
    var tr = el("tr");
    [["Ingredient"], ["Kind"], ["Where to buy here"], ["Full price", "num"], ["Bentos"]].forEach(function (h) {
      var th = el("th", h[1] || null, h[0]);
      th.scope = "col";
      tr.appendChild(th);
    });
    t.appendChild(el("thead")).appendChild(tr);
    var body = t.appendChild(el("tbody"));
    var list = data.ingredients.slice().sort(function (x, y) {
      return (x.sr - y.sr) || x.ease - y.ease || x.en.localeCompare(y.en);
    });
    list.forEach(function (i) {
      var row = el("tr");
      var name = el("td", "food-ing-name");
      name.appendChild(itemLink(i.id));
      var ja = el("span", "food-ja", i.ja);
      ja.lang = "ja";
      name.appendChild(ja);
      row.appendChild(name);
      var kind = el("td", "food-ing-kind", KIND_LABELS[i.category] || i.category);
      kind.setAttribute("data-label", "Kind");
      row.appendChild(kind);
      var where = el("td", "food-where-long");
      where.setAttribute("data-label", "Where to buy here");
      whereLong(i).forEach(function (w) { where.appendChild(el("span", "food-where-line", w)); });
      row.appendChild(where);
      var price = el("td", "num food-ing-price", i.list_price ? i.list_price.toLocaleString("en-US") + " z" : "–");
      price.setAttribute("data-label", "Full price");
      row.appendChild(price);
      var go = el("td", "food-ing-go");
      var a = el("a", null, i.sr ? "SR bentos" : "Bentos with it");
      a.href = i.sr ? "#sr" : "/food.html?q=" + encodeURIComponent(i.en) + "#bentos";
      go.appendChild(a);
      row.appendChild(go);
      body.appendChild(row);
    });
    wrap.appendChild(t);
    box.appendChild(wrap);
  }

  /* ---------- state in the address ---------- */

  function fillStatSelects() {
    STATS.forEach(function (s) {
      var sel = statSel[s];
      var opts = [["", "Any"], ["up", "Raised"], ["notdown", "Not lowered"], ["down", s === "health" ? "Lowered (Adrenaline)" : "Lowered"]];
      MINIMUMS[s].forEach(function (n) { opts.push(["min" + n, "+" + n + (n === MINIMUMS[s][MINIMUMS[s].length - 1] ? "" : " or more")]); });
      opts.forEach(function (o) {
        var op = el("option", null, o[1]);
        op.value = o[0];
        sel.appendChild(op);
      });
    });
    var dl = $("food-ing-list");
    data.ingredients.filter(function (i) { return !i.sr; }).forEach(function (i) {
      var op = el("option", null, i.ja);
      op.value = i.en;
      dl.appendChild(op);
    });
  }

  function setSelect(sel, value) {
    var ok = Array.prototype.some.call(sel.options, function (o) { return o.value === value; });
    sel.value = ok ? value : "";
  }

  function readAddress() {
    var params = new URLSearchParams(location.search);
    var s = params.get("season");
    season = data.seasons.some(function (x) { return x.key === s; }) ? s : "warm";
    qInput.value = params.get("q") || "";
    setSelect(buySel, params.get("buy") || "");
    setSelect(sortSel, params.get("sort") || "best");
    if (!sortSel.value) sortSel.value = "best";
    STATS.forEach(function (k) { setSelect(statSel[k], params.get(k) || ""); });
  }

  function writeAddress() {
    var p = new URLSearchParams(location.search);
    function put(k, v, dflt) { if (v && v !== dflt) p.set(k, v); else p.delete(k); }
    put("season", season, "warm");
    put("q", qInput.value.trim(), "");
    put("buy", buySel.value, "");
    put("sort", sortSel.value, "best");
    STATS.forEach(function (k) { put(k, statSel[k].value, ""); });
    var text = p.toString();
    history.replaceState(history.state, "", location.pathname + (text ? "?" + text : "") + location.hash);
  }

  function update() {
    Array.prototype.forEach.call($("food-seasons").children, function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.season === season));
    });
    drawRecommended();
    drawTable();
    writeAddress();
  }

  function wire() {
    var timer;
    qInput.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { limit = PAGE; update(); }, 120);
    });
    [buySel, sortSel].concat(STATS.map(function (s) { return statSel[s]; })).forEach(function (sel) {
      sel.addEventListener("change", function () { limit = PAGE; update(); });
    });
    $("food-filters").addEventListener("submit", function (e) { e.preventDefault(); });
    $("food-reset").addEventListener("click", function () {
      qInput.value = "";
      buySel.value = "";
      sortSel.value = "best";
      STATS.forEach(function (s) { statSel[s].value = ""; });
      limit = PAGE;
      update();
    });
  }

  function failed() {
    view.textContent = "";
    view.appendChild(el("p", "empty-state", "The bento list could not be loaded."));
    var b = el("button", "ghost-btn small", "Try again");
    b.type = "button";
    b.addEventListener("click", load);
    view.appendChild(b);
  }

  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  var started = false;
  function load() {
    var iconsP = getJson("/data/item-icons.json").catch(function () { return null; });
    getJson("/data/food-recipes.json").then(function (d) {
      return iconsP.then(function (ic) { icons = ic; return d; });
    }).then(function (d) {
      if (!started) {
        prepare(d);
        fillStatSelects();
        readAddress();
        drawSeasons();
        wire();
        started = true;
      }
      update();
      drawSr();
      drawIngredients();
    }).catch(failed);
  }
  load();
})();
