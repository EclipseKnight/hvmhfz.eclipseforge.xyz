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
  var NEXT_FESTIVAL = Date.UTC(2026, 10, 17, 15, 0);

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

  var TOURNAMENTS = "/tournaments.html";

  // Today's static cards: what the page shows while /api/public/events/current is not there (an API
  // from before the schedules, or an error). Each card: name, badge, text, and optionally details
  // (extra lines), note (muted, e.g. a stale schedule) and href/linkText.
  function staticCards(festa, now) {
    var cup = weeklyCard("Speedrun Cup", CUP_START, now, "Weekly timed clears of the event quest, no sign-up. Prizes in the gift box.");
    cup.href = TOURNAMENTS;
    cup.linkText = "Standings";
    var vs = weeklyCard("VS Bracket", CUP_START, now, "Every 14 days, play whenever you like. Sign up with !vs join. Prizes in the gift box.");
    vs.href = TOURNAMENTS;
    vs.linkText = "Bracket";
    return [
      divaCard(now),
      { name: "MezFes", badge: "Live", text: "Open every day. Tickets refill each Monday, 00:00 JST." },
      { name: "Conquest", badge: "Live", text: "Every week, all four monsters. Weekly gifts for taking part and for the top guilds and caravan hunters." },
      { name: "Event campaigns", badge: "Live", text: "New & Returning Hunter Pack once per character; Weekly Supply Drop every Monday." },
      cup,
      vs,
      festaCard(festa, now)
    ];
  }

  /* ---- cards from the API's schedule rows (/api/public/events/current) ---- */

  function ms(value) {
    var t = value ? Date.parse(value) : NaN;
    return isNaN(t) ? null : t;
  }

  function endsText(label, value) {
    var t = ms(value);
    return t === null ? "" : " " + label + " " + shortDate(t) + ".";
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  // The cup's phase in words, and the quest it is about.
  function cupCard(row, now) {
    var x = row.extra || {};
    var title = x.quest && x.quest.title;
    var card = { name: "Speedrun Cup", href: TOURNAMENTS, linkText: "Standings" };
    if (row.phase === "open") {
      card.text = "Open: clear the quest as fast as you can, no sign-up." + endsText("Clears count until", row.phaseEndsAt);
    } else if (row.phase === "tallying") {
      card.text = "Clears are closed and the results are being tallied." + endsText("Results at", row.phaseEndsAt);
    } else if (row.phase === "results") {
      card.text = "Results are in; prizes are in the gift box." + endsText("Next cup starts", row.phaseEndsAt || row.endsAt);
    } else {
      card.text = "No quest in the cup's pool this week.";
    }
    card.details = [];
    if (title) card.details.push("Quest: " + title);
    return card;
  }

  // bracket is optional: /api/public/vs-bracket/current, only used to name the winner on the results.
  function vsCard(row, bracket) {
    var x = row.extra || {};
    var card = { name: "VS Bracket", href: TOURNAMENTS, linkText: "Bracket" };
    var entrants = Number(x.entrants) || 0;
    card.details = [];
    if (row.phase === "signup") {
      card.text = "Sign-up is open: join with !vs join." + endsText("Sign-up ends", x.signup_ends_at || row.phaseEndsAt);
    } else if (row.phase === "drawing") {
      card.text = "Sign-up is over; the bracket is being drawn.";
    } else if (row.phase === "no_bracket") {
      card.text = "Fewer than two hunters signed up, so there is no bracket this time.";
    } else if (row.phase === "round") {
      card.text = "Round " + x.round + " of " + x.rounds + " is open." + endsText("It ends", row.phaseEndsAt);
      if (x.quest && x.quest.title) card.details.push("Quest: " + x.quest.title);
    } else {
      card.text = "Finished; prizes are in the gift box.";
      var champion = bracket && bracket.bracket && bracket.bracket.champion;
      if (champion) card.details.push("Winner: " + champion);
    }
    if (entrants && row.phase !== "no_bracket") card.details.push(plural(entrants, "hunter", "hunters") + " entered");
    return card;
  }

  function divaRowCard(row) {
    var weeks = { personal: "Week 1: personal points, one Prayer Gem a day", tactics: "Week 2: guild week", rewards: "Week 3: reward lists and the coin shop" };
    var card = { name: "Diva Defense" };
    if (weeks[row.phase]) card.text = weeks[row.phase] + "." + endsText("The week ends", row.phaseEndsAt);
    else if (row.phase === "between") card.text = "A short pause between two weeks." + endsText("Next week starts", row.phaseEndsAt);
    else card.text = "The next Diva Defense is coming." + endsText("It starts", row.startsAt);
    return card;
  }

  function conquestCard(row) {
    var monsters = ((row.extra || {}).monsters || []).map(function (m) { return m.name; }).filter(Boolean);
    return {
      name: "Conquest",
      text: "This week's monsters: " + (monsters.length ? monsters.join(", ") : "to be announced") + "." + endsText("The week ends", row.phaseEndsAt),
      details: []
    };
  }

  // A campaign that was not shown before: only the open ones appear; none open means no card.
  function campaignsCard(row) {
    var list = ((row.extra || {}).campaigns || []).map(function (c) { return c.title; }).filter(Boolean);
    if (row.phase !== "open" || !list.length) return null;
    return { name: "Event campaigns", text: "Open now: " + list.join(", ") + "." + endsText("Next change", row.phaseEndsAt), details: [] };
  }

  // One schedule row as card data, or null when the row has nothing to show. The badge is "Live" once the
  // cycle has started, else "From <start>".
  function cardFromRow(row, now, bracket) {
    var card = null;
    if (!row) return null;
    if (row.event === "speedrun_cup") card = cupCard(row, now);
    else if (row.event === "vs_bracket") card = vsCard(row, bracket);
    else if (row.event === "diva") card = divaRowCard(row);
    else if (row.event === "conquest") card = conquestCard(row);
    else if (row.event === "campaigns") card = campaignsCard(row);
    if (!card) return null;
    var start = ms(row.startsAt);
    card.badge = start !== null && start > now ? "From " + shortDate(start) : "Live";
    if (row.stale) card.note = "Schedule may be out of date";
    return card;
  }

  // All cards: from the API's rows when it answered with any, else the static ones. An event with no row is
  // off and leaves its card out; MezFes (no schedule) and the festival stay as they were.
  function eventCards(current, festa, now, bracket) {
    var rows = current && Array.isArray(current.events) ? current.events : [];
    if (!rows.length) return staticCards(festa, now);
    var byEvent = {};
    rows.forEach(function (row) { byEvent[row.event] = row; });
    var cards = [];
    push(cards, cardFromRow(byEvent.diva, now, bracket));
    cards.push({ name: "MezFes", badge: "Live", text: "Open every day. Tickets refill each Monday, 00:00 JST." });
    ["conquest", "campaigns", "speedrun_cup", "vs_bracket"].forEach(function (name) { push(cards, cardFromRow(byEvent[name], now, bracket)); });
    cards.push(festaCard(festa, now));
    return cards;
  }

  function push(list, item) { if (item) list.push(item); }

  function runningEvents(festa, current, bracket) {
    return eventCards(current, festa, Date.now(), bracket);
  }

  function eventCard(event) {
    var card = el("article", "tile event-tile");
    card.appendChild(el("p", "kicker", "Server event"));
    card.appendChild(el("h2", null, event.name));
    card.appendChild(el("p", "tile-meta", event.text));
    (event.details || []).forEach(function (line) { card.appendChild(el("p", "tile-meta", line)); });
    if (event.note) card.appendChild(el("p", "tile-meta muted", event.note));
    if (event.href) {
      var link = el("a", null, event.linkText);
      link.href = event.href;
      var p = el("p", "tile-meta");
      p.appendChild(link);
      card.appendChild(p);
    }
    card.appendChild(el("span", event.badge === "Live" ? "badge event-live" : "badge", event.badge));
    return card;
  }

  function render(data, festa, current, bracket) {
    var root = document.getElementById("events-root");
    clear(root);

    var panel = el("section", "panel");
    panel.appendChild(el("h2", "panel-head", "Running now"));
    var note = el("p", "panel-note", "Times are in your own time zone. Details of each event: see the Events entry of 4 Nov 2026 in the changelog. Speedrun Cup standings and the VS Bracket: ");
    var tournaments = el("a", null, "Tournaments");
    tournaments.href = TOURNAMENTS;
    note.appendChild(tournaments);
    note.appendChild(document.createTextNode("."));
    panel.appendChild(note);
    var grid = el("div", "tile-grid event-grid");
    runningEvents(festa, current, bracket).forEach(function (e) { grid.appendChild(eventCard(e)); });
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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { staticCards: staticCards, eventCards: eventCards, cardFromRow: cardFromRow, shortDate: shortDate };
  }
  if (typeof document === "undefined") return;

  // The festival, the schedules and the VS bracket are optional: an API without them (404, error) still
  // shows the page, with today's static cards.
  function optional(path) {
    return fetch(API + path)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  var festaRequest = optional("/api/public/festa");
  var currentRequest = optional("/api/public/events/current");
  var bracketRequest = optional("/api/public/vs-bracket/current");

  fetch(API + "/api/public/events")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function (data) {
      return Promise.all([festaRequest, currentRequest, bracketRequest]).then(function (extra) {
        quests = data.quests || [];
        render(data, extra[0], extra[1], extra[2]);
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
