/* Monster detail page: hitzones, HP, stagger, drops. */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var slug = params.get("m");
  var root = document.getElementById("monster-root");

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function num(value) {
    return value === null || value === undefined || value === "" ? "-" : Number(value).toLocaleString();
  }

  function pct(value) {
    return value === null || value === undefined ? "-" : value + "%";
  }

  function hzClass(value) {
    if (value === null || value === undefined || value === 0) return "hz-none";
    if (value < 15) return "hz-low";
    if (value < 30) return "hz-mid";
    if (value < 50) return "hz-high";
    return "hz-top";
  }

  function table(headers, rows, className) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table " + (className || ""));
    var thead = el("thead");
    var hr = el("tr");
    headers.forEach(function (h) { hr.appendChild(el("th", null, h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tbody = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr");
      r.forEach(function (cell) {
        if (cell && cell.nodeType) {
          var td = el("td");
          td.appendChild(cell);
          tr.appendChild(td);
        } else {
          tr.appendChild(el("td", null, cell));
        }
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  function hitzonesTable(rows) {
    if (!rows || !rows.length) return el("p", "empty-state", "No hitzone data for this form.");
    var head = ["Part", "Cut", "Impact", "Shot", "Fire", "Water", "Thndr", "Dragon", "Ice", "Stun"];
    var body = rows.map(function (r) {
      var cells = [r.part];
      ["cut", "impact", "shot", "fire", "water", "thunder", "dragon", "ice", "stun"].forEach(function (key) {
        var span = el("span", "hz " + hzClass(r[key]), r[key] === null || r[key] === undefined ? "-" : String(r[key]));
        cells.push(span);
      });
      return cells;
    });
    return table(head, body, "hitzone-table");
  }

  function statusTable(status) {
    var keys = Object.keys(status || {});
    if (!keys.length) return el("p", "empty-state", "No status data.");
    var rows = keys.map(function (key) {
      var s = status[key];
      return [key, s.value || "-", s.tolerance || "-", s.recovery || "-", s.duration || "-"];
    });
    return table(["Status", "Res", "Tolerance", "Recovery", "Duration"], rows);
  }

  function levelsTable(levels) {
    if (!levels || !levels.length) return el("p", "empty-state", "No HP table for this form.");
    var rows = levels.map(function (l) {
      return [num(l.no), l.label || "", num(l.hp), l.attack === null ? "-" : l.attack + "x",
              l.defense === null ? "-" : l.defense + "x", l.stagger === null ? "-" : l.stagger + "x"];
    });
    return table(["No", "", "HP", "Attack", "Defense", "Stagger"], rows, "levels-table");
  }

  function staggerTable(stagger) {
    if (!stagger || !stagger.length) return el("p", "empty-state", "No stagger data.");
    var rows = stagger.map(function (s) {
      return [s.part, num(s.tolerance), s.info || "-"];
    });
    return table(["Part", "Tolerance", "Part break"], rows);
  }

  function attacksTable(attacks) {
    if (!attacks || !attacks.length) return null;
    var rows = attacks.map(function (a) {
      return [a.name, a.status || "-", num(a.power), num(a.stun), a.notes || ""];
    });
    var details = el("details", "monster-details");
    details.appendChild(el("summary", null, "Attack list (" + attacks.length + ")"));
    details.appendChild(el("p", "panel-note", "Attack names come from the Japanese wiki tables and are not translated."));
    details.appendChild(table(["Attack", "Status", "Power", "Stun", "Notes"], rows));
    return details;
  }

  function modifiersTable(modifiers) {
    var keys = Object.keys(modifiers || {});
    if (!keys.length) return null;
    var details = el("details", "monster-details");
    details.appendChild(el("summary", null, "Modifiers"));
    keys.forEach(function (key) {
      details.appendChild(el("h3", "subhead", key));
      var values = modifiers[key] || {};
      var rows = Object.keys(values).map(function (k) { return [k, values[k]]; });
      details.appendChild(table(["Stat", "Value"], rows));
    });
    return details;
  }

  function dropsPanel(drops) {
    var panel = el("section", "panel");
    panel.appendChild(el("h2", "panel-head", "Drops and carves"));
    if (!drops || !drops.sections || !drops.sections.length) {
      panel.appendChild(el("p", "empty-state", "No carve table for this monster."));
      return panel;
    }
    var ranks = drops.ranks.slice();
    var tabs = el("div", "tabs mbox-tabs");
    var body = el("div", "drops-body");
    var current = ranks.indexOf("GR") !== -1 ? "GR" : ranks[ranks.length - 1];

    function render(rank) {
      clear(body);
      drops.sections.forEach(function (section) {
        var row = (section.drops || []).filter(function (d) { return d.rank === rank; })[0];
        if (!row || !row.items.length) return;
        body.appendChild(el("h3", "subhead", section.method));
        var list = el("div", "drop-list");
        row.items.forEach(function (item) {
          var line = el("div", "drop-row");
          var name = el("a", "drop-name", item.item);
          // Every drop row carries the item's id as 4 hex digits: link its item page, not a name search
          // (the server's item list names many items differently, so a search by this name can miss).
          name.href = item.hex ? "/item.html?id=" + parseInt(item.hex, 16) : "/items.html?q=" + encodeURIComponent(item.item);
          line.appendChild(name);
          line.appendChild(el("span", "drop-qty", "x" + (item.qty || 1)));
          var bar = el("span", "drop-bar");
          var fill = el("span", "drop-fill");
          fill.style.width = Math.max(0, Math.min(100, item.pct || 0)) + "%";
          bar.appendChild(fill);
          line.appendChild(bar);
          line.appendChild(el("span", "drop-pct", pct(item.pct)));
          list.appendChild(line);
        });
        body.appendChild(list);
      });
      if (!body.firstChild) body.appendChild(el("p", "empty-state", "No drops listed for this rank."));
    }

    ranks.forEach(function (rank) {
      var tab = el("button", "tab", rank);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", rank === current ? "true" : "false");
      tab.addEventListener("click", function () {
        current = rank;
        Array.prototype.forEach.call(tabs.children, function (other) {
          other.setAttribute("aria-selected", other === tab ? "true" : "false");
        });
        render(rank);
      });
      tabs.appendChild(tab);
    });

    panel.appendChild(tabs);
    panel.appendChild(body);
    render(current);
    return panel;
  }

  function keyStats(panel, game) {
    var sum = window.HvMonsterGame.summary(game);
    panel.appendChild(el("h2", "panel-head", "Key stats"));
    var list = el("dl", "mg-keystats");
    function item(label, value) {
      list.appendChild(el("dt", null, label));
      list.appendChild(el("dd", null, value));
    }
    item("Base HP", num(game.baseHp));
    var hps = (game.levels || []).map(function (l) { return l[0]; }).filter(function (v) { return v > 0; });
    if (hps.length) item("HP range", num(Math.min.apply(null, hps)) + " to " + num(Math.max.apply(null, hps)));
    if (sum.weak.length) item("Weak to", sum.weak.map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(", ") + " (" + sum.rank + ")");
    sum.weakPoints.forEach(function (w) { item("Best " + w[0].toLowerCase(), w[1] + " (" + w[2] + ")"); });
    panel.appendChild(list);
    panel.appendChild(el("p", "panel-note", "From the game's data (" + sum.rank + ", normal state). The tabs below have every rank."));
  }

  function render(detail, game) {
    document.title = detail.name + " · Hunsterverse";
    document.getElementById("monster-head").hidden = true; // the monster's own heading follows
    if (window.HvCrumbs) window.HvCrumbs.item(detail.name);
    clear(root);

    var hero = el("header", "monster-hero");
    var art = el("div", "monster-hero-art");
    if (detail.icon) {
      var img = el("img");
      img.src = "/assets/monsters/icons/" + detail.icon;
      img.alt = detail.name;
      img.width = 140;
      img.height = 140;
      art.appendChild(img);
    } else {
      art.appendChild(el("span", "monster-initial large", detail.name.charAt(0).toUpperCase()));
    }
    hero.appendChild(art);

    var info = el("div", "monster-hero-info");
    info.appendChild(el("p", "kicker", detail.category || "Monster"));
    var title = el("h1", "monster-title");
    if (detail.icon) {
      var badge = document.createElement("img");
      badge.className = "monster-icon-badge";
      badge.src = "/assets/monsters/icons/" + detail.icon;
      badge.alt = "";
      title.appendChild(badge);
    }
    if (detail.render) {
      var render = document.createElement("img");
      render.className = "monster-render-mini";
      render.src = "/assets/monsters/icons/" + detail.render;
      render.alt = detail.name + " render";
      title.appendChild(render);
    }
    title.appendChild(document.createTextNode(detail.name));
    info.appendChild(title);
    // The quest catalog lists monsters by the guide's names (dev/make-quest-monsters.py).
    // An entry may set its own link and label (a Musou version: the quests list the normal monster's name).
    var quests = el("a", "ghost-btn small", detail.questsLabel || ("Quests with " + detail.name));
    quests.href = detail.questsHref || ("/quests.html?monster=" + encodeURIComponent(detail.name));
    // The quests link and the Form picker share one row, bottoms aligned, at the same height.
    var actions = el("div", "monster-hero-actions");
    actions.appendChild(quests);
    // A short note for an entry made from our own data, not the field guide's tables (e.g. Shagaru Magala).
    if (detail.about) info.appendChild(el("p", "panel-note monster-about", detail.about));
    var forms = [];
    if (detail.variantStats) detail.variantStats.forEach(function (v) { forms.push(v); });
    if (forms.length) {
      var select = el("select", "variant-select");
      var base = el("option", null, "Base" + (detail.sourceLabel ? " (" + detail.sourceLabel + ")" : ""));
      base.value = "-1";
      select.appendChild(base);
      forms.forEach(function (v, i) {
        var option = el("option", null, v.label || ("Form " + (i + 1)));
        option.value = String(i);
        select.appendChild(option);
      });
      var label = el("label", "monster-form-pick");
      label.appendChild(el("span", "monster-form-label", "Form"));
      label.appendChild(select);
      if (!game) actions.appendChild(label);
      select.addEventListener("change", function () {
        var index = Number(select.value);
        renderForms(index < 0 ? detail : forms[index]);
      });
    }
    info.appendChild(actions);
    hero.appendChild(info);
    root.appendChild(hero);

    var grid = el("div", "monster-columns");
    var statPanel = el("section", "panel", null);
    statPanel.id = "stat-panel";
    var keyPanel = statPanel;
    if (game) { // the game's numbers lead; the community tables move to a labelled fold below
      keyPanel = el("section", "panel");
      keyPanel.id = "key-stats";
      keyStats(keyPanel, game);
    }
    grid.appendChild(keyPanel);

    var zonePanel = el("aside", "panel monster-zone-panel");
    zonePanel.appendChild(el("h2", "panel-head", "Map"));
    if (detail.zone) {
      var zoneLink = el("a");
      zoneLink.href = "/assets/monsters/zones/" + detail.zone;
      zoneLink.target = "_blank";
      zoneLink.rel = "noopener";
      var zone = el("img", "monster-zone");
      zone.src = "/assets/monsters/zones/" + detail.zone;
      zone.alt = detail.name + " map";
      zone.loading = "lazy";
      zoneLink.appendChild(zone);
      zonePanel.appendChild(zoneLink);
      zonePanel.appendChild(el("p", "panel-note", "Open full size to see the area layout."));
    } else {
      zonePanel.appendChild(el("p", "empty-state", "No map for this monster."));
    }
    grid.appendChild(zonePanel);
    root.appendChild(grid);

    var hzPanel = el("section", "panel");
    hzPanel.appendChild(el("h2", "panel-head", game ? "Community stagger notes" : "Hitzones"));
    var hzBody = el("div");
    hzPanel.appendChild(hzBody);
    var fold = null;
    if (game) {
      window.HvMonsterGame.render(root, game, { communityAttacks: detail.attacks });
      fold = el("details", "panel monster-details mg-community");
      fold.id = "community";
      fold.appendChild(el("summary", null, "Community tables (Ferias project): status text, HP labels, stagger notes"));
      fold.appendChild(el("p", "panel-note", "Kept for the notes the game's data does not have (break requirements, level labels). Where the numbers differ, the game's data above is what the game uses."));
      if (forms.length) fold.appendChild(label);
      statPanel.className = "";
      fold.appendChild(statPanel);
      fold.appendChild(hzPanel);
      hzPanel.className = "";
      root.appendChild(fold);
    } else {
      root.appendChild(hzPanel);
    }

    function renderForms(form) {
      clear(statPanel);
      statPanel.appendChild(el("h2", "panel-head", game ? "Community stats" : "Stats"));
      if (form.enrage) statPanel.appendChild(el("p", "monster-enrage", "Enrage: " + form.enrage));
      statPanel.appendChild(el("h3", "subhead", "Status resistance"));
      statPanel.appendChild(statusTable(form.status));
      statPanel.appendChild(el("h3", "subhead", "HP by level"));
      statPanel.appendChild(levelsTable(form.levels));
      var mods = modifiersTable(form.modifiers);
      if (mods) statPanel.appendChild(mods);
      var attacks = game ? null : attacksTable(form.attacks); // with game data: in the Attacks tab
      if (attacks) statPanel.appendChild(attacks);

      clear(hzBody);
      if (!game) hzBody.appendChild(el("h3", "subhead", "Normal"));
      if (!game) hzBody.appendChild(hitzonesTable(form.hitzones));
      if (!game && form.hitzonesEnraged && form.hitzonesEnraged.length) {
        hzBody.appendChild(el("h3", "subhead", "Enraged"));
        hzBody.appendChild(hitzonesTable(form.hitzonesEnraged));
      }
      hzBody.appendChild(el("h3", "subhead", "Stagger limits"));
      hzBody.appendChild(staggerTable(form.stagger));
    }
    // The game's drop tables replace the community's; those stay where the game's data has none.
    if (!game || !game.drops || !game.drops.length) {
      var dp = dropsPanel(detail.drops);
      if (game) dp.querySelector(".panel-head").textContent = "Drops and carves (community tables)";
      root.appendChild(dp);
    }

    if (detail.ferias === false) { // not from the Ferias tables: no credit line for them
      renderForms(detail);
      document.getElementById("monster-loading").hidden = true;
      return;
    }
    var credit = el("p", "panel-note monster-credit");
    credit.appendChild(document.createTextNode(game ? "Community tables from the " : "Monster data from the "));
    var link = el("a", null, "MHF-Z Ferias English Project");
    link.href = "https://xl3lackout.github.io/MHFZ-Ferias-English-Project/";
    credit.appendChild(link);
    credit.appendChild(document.createTextNode(", maintained by Deerby, Supream and the MHFZ community."));
    root.appendChild(credit);

    renderForms(detail);
    document.getElementById("monster-loading").hidden = true;
  }

  function fail(message) {
    var loading = document.getElementById("monster-loading");
    if (loading) loading.hidden = true;
    document.getElementById("monster-head").hidden = true;
    clear(root);
    var panel = el("section", "panel");
    panel.appendChild(el("h1", null, "Monster not found"));
    panel.appendChild(el("p", "page-sub", message));
    var back = el("a", "ghost-btn", "Back to the field guide");
    back.href = "/monsters.html";
    panel.appendChild(back);
    root.appendChild(panel);
  }

  if (!slug) {
    fail("No monster was named in the link.");
  } else {
    function load(candidate) {
      return fetch("/data/monsters/" + encodeURIComponent(candidate) + ".json").then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
    }

    // Slugs are the English names now. An older link (or a Discord post from before the rename) still
    // names the old slug (oldSlug), or the short English one used from 28 to 29 Oct 2026 (formerSlugs),
    // so the index is checked before giving up.
    var index = fetch("/data/monsters/index.json").then(function (r) { return r.json(); });
    // The game's own data (data/monsters/game/<id>.json) by the entry's first monster id; none: community only.
    function withGame(detail, entry) {
      var id = entry && entry.ids && entry.ids[0];
      if (!id || !window.HvMonsterGame) return render(detail, null);
      return fetch("/data/monsters/game/" + id + ".json").then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (game) { render(detail, game && game.ranks ? game : null); });
    }
    function entryOf(list, s) { return (list || []).filter(function (m) { return m.slug === s; })[0]; }
    load(slug).then(function (detail) {
      return index.catch(function () { return []; }).then(function (list) { return withGame(detail, entryOf(list, slug)); });
    }, function () {
      return index.then(function (list) {
        var hit = (list || []).filter(function (m) {
          return m.oldSlug === slug || (m.formerSlugs || []).indexOf(slug) !== -1;
        })[0];
        if (!hit) throw new Error("unknown");
        return load(hit.slug).then(function (detail) { return withGame(detail, hit); });
      });
    }).catch(function () { fail("That monster is not in the database."); });
  }
})();
