/* Server events: active events, event quest pool, festa prizes. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var state = { q: "" };
  var quests = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function date(value) {
    if (!value) return "Unknown";
    var d = new Date(value);
    return isNaN(d.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
  }

  function titleCase(value) {
    return String(value || "").split(/\s+/).map(function (word) {
      return word ? word.charAt(0).toUpperCase() + word.slice(1) : "";
    }).join(" ");
  }

  function table(headers, rows) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table");
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

  function eventCard(event) {
    var card = el("article", "tile event-tile");
    card.appendChild(el("p", "kicker", "Server event"));
    card.appendChild(el("h2", null, titleCase(event.type)));
    card.appendChild(el("p", "tile-meta", "Started " + date(event.startTime)));
    var stat = el("div", "tile-stat");
    stat.appendChild(el("span", "tile-stat-value", event.daysRunning + "d"));
    stat.appendChild(el("span", "tile-stat-label", "running"));
    card.appendChild(stat);
    card.appendChild(el("span", "badge event-live", "Live"));
    return card;
  }

  function render(data) {
    var root = document.getElementById("events-root");
    clear(root);

    var events = data.events || [];
    var panel = el("section", "panel");
    panel.appendChild(el("h2", "panel-head", "Live events"));
    if (!events.length) {
      panel.appendChild(el("p", "empty-state", "No events recorded yet."));
    } else {
      var grid = el("div", "tile-grid event-grid");
      events.forEach(function (e) { grid.appendChild(eventCard(e)); });
      panel.appendChild(grid);
    }
    root.appendChild(panel);

    var prizePanel = el("section", "panel");
    prizePanel.appendChild(el("h2", "panel-head", "Festa prizes"));
    var prizes = data.prizes || [];
    if (!prizes.length) {
      prizePanel.appendChild(el("p", "empty-state", "No prize table loaded."));
    } else {
      prizePanel.appendChild(el("p", "panel-note", "Rewards exchangeable with Festa souls, grouped by tier."));
      var byTier = {};
      prizes.forEach(function (p) {
        if (!byTier[p.tier]) byTier[p.tier] = [];
        byTier[p.tier].push(p);
      });
      var tiers = Object.keys(byTier).sort(function (a, b) { return Number(a) - Number(b); });
      var tabs = el("div", "tabs");
      var prizeBody = el("div");
      var currentTier = tiers[0];

      function renderTier(tier) {
        clear(prizeBody);
        var rows = byTier[tier].map(function (p) {
          var name = el("span", "prize-name");
          if (p.icon) {
            var img = el("img", "item-img");
            img.src = "/assets/items/" + p.icon + ".webp";
            img.alt = "";
            img.loading = "lazy";
            img.width = 28;
            img.height = 28;
            name.appendChild(img);
          }
          name.appendChild(document.createTextNode(p.itemName || ("Item " + p.itemId)));
          return [p.type, Number(p.soulsReq).toLocaleString(), name, "x" + p.quantity];
        });
        prizeBody.appendChild(table(["Type", "Souls", "Item", "Qty"], rows));
      }

      tiers.forEach(function (tier) {
        var tab = el("button", "tab", "Tier " + tier);
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", tier === currentTier ? "true" : "false");
        tab.addEventListener("click", function () {
          currentTier = tier;
          Array.prototype.forEach.call(tabs.children, function (other) {
            other.setAttribute("aria-selected", other === tab ? "true" : "false");
          });
          renderTier(tier);
        });
        tabs.appendChild(tab);
      });
      prizePanel.appendChild(tabs);
      prizePanel.appendChild(prizeBody);
      renderTier(currentTier);
    }
    var questPanel = el("section", "panel");
    var head = el("div", "panel-head-row");
    head.appendChild(el("h2", "panel-head", "Event quest pool"));
    var search = el("label", "search");
    search.appendChild(el("span", "search-label", "Filter"));
    var input = el("input");
    input.type = "search";
    input.placeholder = "Quest id or type";
    input.value = state.q;
    search.appendChild(input);
    head.appendChild(search);
    questPanel.appendChild(head);
    questPanel.appendChild(el("p", "panel-note",
      (data.questCount || quests.length) + " event quests have been loaded on this server. Showing the most recent 40; quest names live in the client, so ids are listed as the server sees them."));
    var questBody = el("div");
    questPanel.appendChild(questBody);
    root.appendChild(questPanel);
    root.appendChild(prizePanel);

    function renderQuests() {
      clear(questBody);
      var q = state.q.trim().toLowerCase();
      var rows = quests.filter(function (q1) {
        return !q || String(q1.questId).indexOf(q) !== -1 || String(q1.questType).indexOf(q) !== -1;
      }).slice(0, 40).map(function (q1) {
        return [String(q1.questId), "Type " + q1.questType, q1.maxPlayers || "-", date(q1.startTime)];
      });
      if (!rows.length) {
        questBody.appendChild(el("p", "empty-state", "No event quest matches that filter."));
        return;
      }
      questBody.appendChild(table(["Quest", "Type", "Players", "Added"], rows));
    }
    input.addEventListener("input", function (event) {
      state.q = event.target.value;
      renderQuests();
    });
    renderQuests();
  }

  fetch(API + "/api/public/events")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function (data) {
      quests = data.quests || [];
      render(data);
    })
    .catch(function () {
      var root = document.getElementById("events-root");
      clear(root);
      var panel = el("section", "panel");
      panel.appendChild(el("h2", null, "Events unavailable"));
      panel.appendChild(el("p", "page-sub", "The API did not answer. Try again in a moment."));
      root.appendChild(panel);
    });
})();
