/* Server events: what is running, event quest pool, festa prizes. */
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

  // The events we run, with their real schedules (Erupe release of 4 Nov 2026). The API's /api/public/events
  // lists only what the old game tables hold (its 2023 "diva" row is stale and is not shown); only the
  // Hunter Festival is read live, from /api/public/festa. Dates are UTC.
  var DAY = 86400000;
  var DIVA_START = Date.UTC(2026, 10, 2, 3, 0);          // Diva Defense cycle 1: Mon 2 Nov, 03:00 UTC
  var CUP_START = Date.UTC(2026, 10, 5, 15, 0);          // Speedrun Cup and VS Bracket: Fri 6 Nov 00:00 JST
  var NEXT_FESTIVAL = Date.UTC(2026, 10, 22, 15, 0);

  function shortDate(ms) {
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  }

  function divaCard(now) {
    var week = Math.floor(((now - DIVA_START) / DAY) / 7) % 3 + 1;
    var names = ["Week 1: personal points, one Prayer Gem a day", "Week 2: guild week", "Week 3: reward lists and the coin shop"];
    return { name: "Diva Defense", badge: "Live", text: names[week - 1] + ". A 3-week cycle, repeating; this one started 2 Nov." };
  }

  function weeklyCard(name, start, now, text) {
    return { name: name, badge: now >= start ? "Live" : "From " + shortDate(start), text: text };
  }

  function festaCard(festa, now) {
    var phases = { entry: "Entry and vote", souls: "Collecting souls", judging: "Judging", rewards: "Prizes open" };
    var phase = festa && festa.festival && festa.festival.phase;
    if (phases[phase]) return { name: "Hunter Festival", badge: "Live", text: phases[phase] + ". Festivals now follow each other back to back." };
    return {
      name: "Hunter Festival",
      badge: now < NEXT_FESTIVAL ? "From " + shortDate(NEXT_FESTIVAL) : "Soon",
      text: "Festivals follow each other back to back: the next one starts when the last one's prizes end."
    };
  }

  function runningEvents(festa) {
    var now = Date.now();
    return [
      divaCard(now),
      { name: "MezFes", badge: "Live", text: "Open every day. Tickets refill each Monday, 00:00 JST." },
      { name: "Conquest", badge: "Live", text: "Every week, all four monsters. Weekly gifts for taking part and for the top guilds and caravan hunters." },
      { name: "Event campaigns", badge: "Live", text: "New & Returning Hunter Pack once per character; Weekly Supply Drop every Monday." },
      weeklyCard("Speedrun Cup", CUP_START, now, "Weekly timed clears of the event quest, no sign-up. Prizes in the gift box."),
      weeklyCard("VS Bracket", CUP_START, now, "Every 14 days, play whenever you like. Sign up with !vs join. Prizes in the gift box."),
      festaCard(festa, now)
    ];
  }

  function eventCard(event) {
    var card = el("article", "tile event-tile");
    card.appendChild(el("p", "kicker", "Server event"));
    card.appendChild(el("h2", null, event.name));
    card.appendChild(el("p", "tile-meta", event.text));
    card.appendChild(el("span", event.badge === "Live" ? "badge event-live" : "badge", event.badge));
    return card;
  }

  function render(data, festa) {
    var root = document.getElementById("events-root");
    clear(root);

    var panel = el("section", "panel");
    panel.appendChild(el("h2", "panel-head", "Running now"));
    panel.appendChild(el("p", "panel-note", "Times are in your own time zone. Details of each event: see the Events entry of 4 Nov 2026 in the changelog."));
    var grid = el("div", "tile-grid event-grid");
    runningEvents(festa).forEach(function (e) { grid.appendChild(eventCard(e)); });
    panel.appendChild(grid);
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
      (data.questCount || quests.length) + " event quests have been loaded on this server. Showing the most recent 40; each id opens the quest's page."));
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
        var link = el("a", null, String(q1.questId)); // the quest catalog has every quest file's page
        link.href = "/quest.html?id=" + encodeURIComponent(q1.questId);
        return [link, "Type " + q1.questType, q1.maxPlayers || "-", date(q1.startTime)];
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

  // The festival is optional: an old API without /api/public/festa still shows the page.
  var festaRequest = fetch(API + "/api/public/festa")
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });

  fetch(API + "/api/public/events")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function (data) {
      return festaRequest.then(function (festa) {
        quests = data.quests || [];
        render(data, festa);
      });
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
