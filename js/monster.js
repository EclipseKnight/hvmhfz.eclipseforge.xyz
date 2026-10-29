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
          name.href = "/catalog.html?q=" + encodeURIComponent(item.item);
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

  function render(detail) {
    document.title = detail.name + " | Hunsterverse monsters";
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
    title.appendChild(document.createTextNode(detail.name));
    info.appendChild(title);
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
      var label = el("label", "select-wrap");
      label.appendChild(el("span", "search-label", "Form"));
      label.appendChild(select);
      info.appendChild(label);
      select.addEventListener("change", function () {
        var index = Number(select.value);
        renderForms(index < 0 ? detail : forms[index]);
      });
    }
    hero.appendChild(info);
    root.appendChild(hero);

    var grid = el("div", "monster-columns");
    var statPanel = el("section", "panel", null);
    statPanel.id = "stat-panel";
    grid.appendChild(statPanel);

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
    hzPanel.appendChild(el("h2", "panel-head", "Hitzones"));
    var hzBody = el("div");
    hzPanel.appendChild(hzBody);
    root.appendChild(hzPanel);

    function renderForms(form) {
      clear(statPanel);
      statPanel.appendChild(el("h2", "panel-head", "Stats"));
      if (form.enrage) statPanel.appendChild(el("p", "monster-enrage", "Enrage: " + form.enrage));
      statPanel.appendChild(el("h3", "subhead", "Status resistance"));
      statPanel.appendChild(statusTable(form.status));
      statPanel.appendChild(el("h3", "subhead", "HP by level"));
      statPanel.appendChild(levelsTable(form.levels));
      var mods = modifiersTable(form.modifiers);
      if (mods) statPanel.appendChild(mods);
      var attacks = attacksTable(form.attacks);
      if (attacks) statPanel.appendChild(attacks);

      clear(hzBody);
      hzBody.appendChild(el("h3", "subhead", "Normal"));
      hzBody.appendChild(hitzonesTable(form.hitzones));
      if (form.hitzonesEnraged && form.hitzonesEnraged.length) {
        hzBody.appendChild(el("h3", "subhead", "Enraged"));
        hzBody.appendChild(hitzonesTable(form.hitzonesEnraged));
      }
      hzBody.appendChild(el("h3", "subhead", "Stagger limits"));
      hzBody.appendChild(staggerTable(form.stagger));
    }
    root.appendChild(dropsPanel(detail.drops));

    var credit = el("p", "panel-note monster-credit");
    credit.appendChild(document.createTextNode("Monster data from the "));
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
    // names the old slug, so the index's oldSlug is checked before giving up.
    load(slug).then(render).catch(function () {
      fetch("/data/monsters/index.json").then(function (r) { return r.json(); }).then(function (list) {
        var hit = (list || []).filter(function (m) { return m.oldSlug === slug || m.slug === slug; })[0];
        if (!hit) throw new Error("unknown");
        return load(hit.slug).then(render);
      }).catch(function () { fail("That monster is not in the database."); });
    });
  }
})();
