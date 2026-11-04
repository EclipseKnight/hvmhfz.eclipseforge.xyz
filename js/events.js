/* Server events: what is running, event quest pool, festa prizes. */
(function () {
  "use strict";

  // The text of each card's "how it works" part: js/event-info.js (a script tag in the page, require under node).
  var INFO = typeof HvEventInfo !== "undefined" ? HvEventInfo : require("./event-info.js");

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
    return { key: "diva", name: "Diva Defense", badge: "Live", text: names[week - 1] + ". A 3-week cycle, repeating; this one started 2 Nov." };
  }

  function weeklyCard(key, name, start, now, text) {
    return { key: key, name: name, badge: now >= start ? "Live" : "From " + shortDate(start), text: text };
  }

  function festaCard(festa, now) {
    var phases = { entry: "Entry and vote", souls: "Collecting souls", judging: "Judging", rewards: "Prizes open" };
    var phase = festa && festa.festival && festa.festival.phase;
    if (phases[phase]) return { key: "festival", name: "Hunter Festival", badge: "Live", text: phases[phase] + ". Festivals now follow each other back to back." };
    return {
      key: "festival",
      name: "Hunter Festival",
      badge: now < NEXT_FESTIVAL ? "From " + shortDate(NEXT_FESTIVAL) : "Soon",
      text: "Festivals follow each other back to back: the next one starts when the last one's prizes end."
    };
  }

  var TOURNAMENTS = "/tournaments.html";

  var MEZFES = { key: "mezfes", name: "MezFes", badge: "Live", text: "Open every day. Tickets refill each Monday, 00:00 JST." };

  // Cards for what has no schedule from the game server: always there, whatever the API says.
  function alwaysCards() {
    return [
      { key: "raviente", name: "Raviente", badge: "Live", text: "Open all the time: a server-wide hunt, no set start. Join at Kieru in the Caravan area." },
      { key: "caravan_rankings", name: "Caravan rankings", badge: "Live", text: "Merit points from caravan quests rank hunters and guilds each week. Look for the boards in the Caravan area." },
      { key: "sky_corridor", name: "Sky Corridor", badge: "Live", text: "The Tower is open: climb floors, clear Duremudira and fill the town's goals.", href: "/sky-corridor.html", linkText: "Sky Corridor" },
      { key: "road_vote", name: "Hunting Road vote", badge: "Live", text: "Players design the next Road: submit, vote, and the winner goes live. A new rotation every two weeks.", href: "/road-vote.html", linkText: "Rotation and vote" },
      { key: "event_quests", name: "Event quests", badge: "Live", text: "The event quest list is always full: every loaded quest is listed. See the pool below.", href: "#event-quests", linkText: "Event quest pool" }
    ];
  }

  // Today's static cards: what the page shows while /api/public/events/current is not there (an API
  // from before the schedules, or an error). Each card: name, badge, text, and optionally details
  // (extra lines), note (muted, e.g. a stale schedule) and href/linkText.
  function staticCards(festa, now) {
    var cup = weeklyCard("speedrun_cup", "Speedrun Cup", CUP_START, now, "Weekly timed clears of the event quest, no sign-up. Prizes in the gift box.");
    cup.href = TOURNAMENTS;
    cup.linkText = "Standings";
    var vs = weeklyCard("vs_bracket", "VS Bracket", CUP_START, now, "Every 14 days, play whenever you like. Sign up with !vs join. Prizes in the gift box.");
    vs.href = TOURNAMENTS;
    vs.linkText = "Bracket";
    return [
      divaCard(now),
      MEZFES,
      { key: "campaigns", name: "Event campaigns", badge: "Live", text: "New & Returning Hunter Pack once per character; Weekly Supply Drop every Monday." },
      cup,
      vs,
      festaCard(festa, now)
    ].concat(alwaysCards());
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
    var card = { key: "speedrun_cup", name: "Speedrun Cup", href: TOURNAMENTS, linkText: "Standings" };
    if (row.phase === "upcoming") {
      card.text = "Not open yet." + endsText("Opens", row.phaseEndsAt || row.startsAt);
    } else if (row.phase === "open") {
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
    var card = { key: "vs_bracket", name: "VS Bracket", href: TOURNAMENTS, linkText: "Bracket" };
    var entrants = Number(x.entrants) || 0;
    card.details = [];
    if (row.phase === "signup") {
      var until = ms(x.signup_ends_at || row.phaseEndsAt);
      card.text = "Sign-up open" + (until === null ? "" : " until " + shortDate(until)) + ": type !vs join in chat.";
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
    var card = { key: "diva", name: "Diva Defense" };
    if (weeks[row.phase]) card.text = weeks[row.phase] + "." + endsText("The week ends", row.phaseEndsAt);
    else if (row.phase === "between") card.text = "A short pause between two weeks." + endsText("Next week starts", row.phaseEndsAt);
    else card.text = "The next Diva Defense is coming." + endsText("It starts", row.startsAt);
    return card;
  }

  // A campaign that was not shown before: only the open ones appear; none open means no card.
  function campaignsCard(row) {
    var list = ((row.extra || {}).campaigns || []).map(function (c) { return c.title; }).filter(Boolean);
    if (row.phase !== "open" || !list.length) return null;
    return { key: "campaigns", name: "Event campaigns", text: "Open now: " + list.join(", ") + "." + endsText("Next change", row.phaseEndsAt), details: [] };
  }

  // One schedule row as card data, or null when the row has nothing to show. The badge is "Live" once the
  // cycle has started, else "From <start>".
  function cardFromRow(row, now, bracket) {
    var card = null;
    if (!row) return null;
    if (row.event === "speedrun_cup") card = cupCard(row, now);
    else if (row.event === "vs_bracket") card = vsCard(row, bracket);
    else if (row.event === "diva") card = divaRowCard(row);
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
    cards.push(MEZFES);
    ["campaigns", "speedrun_cup", "vs_bracket"].forEach(function (name) { push(cards, cardFromRow(byEvent[name], now, bracket)); });
    cards.push(festaCard(festa, now));
    return cards.concat(alwaysCards());
  }

  function push(list, item) { if (item) list.push(item); }

  function runningEvents(festa, current, bracket) {
    return eventCards(current, festa, Date.now(), bracket);
  }

  // One titled list or paragraph of the "how it works" part; nothing when the text has none.
  function infoSection(box, id, title, body) {
    if (!body || (Array.isArray(body) && !body.length)) return null;
    var sec = el("div", "event-sec");
    sec.setAttribute("data-sec", id);
    sec.appendChild(el("h3", "event-sec-head", title));
    if (Array.isArray(body)) {
      var list = el(id === "how" ? "ol" : "ul", "event-list");
      body.forEach(function (line) { list.appendChild(el("li", null, line)); });
      sec.appendChild(list);
    } else {
      sec.appendChild(el("p", "event-sec-text", body));
    }
    box.appendChild(sec);
    return sec;
  }

  // The part a card opens: what the event is, how to take part, what you get, when, tips and links. "When"
  // adds what the card says right now (its live dates).
  function infoPanel(event, info, id) {
    var box = el("div", "event-more");
    box.id = id;
    box.hidden = true;
    infoSection(box, "what", "What it is", info.what);
    infoSection(box, "how", "How to take part", info.steps);
    infoSection(box, "gets", "What you get", info.gets);
    var when = infoSection(box, "when", "When", info.when || event.text);
    if (when && info.when) {
      var now = el("p", "event-sec-text event-now");
      now.appendChild(el("b", null, "Right now: "));
      now.appendChild(document.createTextNode([event.text].concat(event.details || []).join(" ")));
      when.appendChild(now);
    }
    infoSection(box, "tips", "Tips", info.tips);
    if ((info.links || []).length) {
      var sec = el("div", "event-sec");
      sec.setAttribute("data-sec", "links");
      sec.appendChild(el("h3", "event-sec-head", "More"));
      var list = el("ul", "event-list event-links");
      info.links.forEach(function (l) {
        var li = el("li");
        var a = el("a", null, l[0]);
        a.href = l[1];
        li.appendChild(a);
        list.appendChild(li);
      });
      sec.appendChild(list);
      box.appendChild(sec);
    }
    return box;
  }

  function setOpen(card, button, open) {
    button.setAttribute("aria-expanded", open ? "true" : "false");
    card.classList.toggle("is-open", open);
    card.querySelector(".event-more").hidden = !open;
  }

  // A card. Its name is a button (Enter and Space work; the tap area is the whole card) that opens the
  // card's "how it works" part below its live text; Escape inside it closes it again.
  function eventCard(event) {
    var card = el("article", "tile event-tile");
    card.appendChild(el("p", "kicker", "Server event"));
    var info = INFO[event.key];
    var head = el("h2");
    var button = null;
    if (info) {
      var id = "event-more-" + event.key;
      button = el("button", "event-toggle", event.name);
      button.type = "button";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", id);
      button.addEventListener("click", function () { setOpen(card, button, button.getAttribute("aria-expanded") !== "true"); });
      head.appendChild(button);
    } else {
      head.textContent = event.name;
    }
    card.appendChild(head);
    card.appendChild(el("p", "tile-meta", event.text));
    (event.details || []).forEach(function (line) { card.appendChild(el("p", "tile-meta", line)); });
    if (event.note) card.appendChild(el("p", "tile-meta muted", event.note));
    if (event.href) {
      var link = el("a", null, event.linkText);
      link.href = event.href;
      var p = el("p", "tile-meta event-link");
      p.appendChild(link);
      card.appendChild(p);
    }
    if (info) {
      var hint = el("span", "event-hint", "How it works");
      hint.setAttribute("aria-hidden", "true");
      card.appendChild(hint);
      var panel = infoPanel(event, info, "event-more-" + event.key);
      panel.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !panel.hidden) { setOpen(card, button, false); button.focus(); }
      });
      card.appendChild(panel);
    }
    card.appendChild(el("span", event.badge === "Live" ? "badge event-live" : "badge", event.badge));
    return card;
  }

  function render(pool, festa, current, bracket) {
    var data = pool || {};
    var root = document.getElementById("events-root");
    clear(root);

    var panel = el("section", "panel");
    panel.appendChild(el("h2", "panel-head", "Running now"));
    var note = el("p", "panel-note", "Tap a card to see what the event is and how to take part. Times are in your own time zone. The 4 Nov 2026 Events entry in the changelog has the details. Speedrun Cup standings and the VS Bracket: ");
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
    prizePanel.id = "festa-prizes";
    prizePanel.appendChild(el("h2", "panel-head", "Festa prizes"));
    var prizes = data.prizes || [];
    if (!prizes.length) {
      prizePanel.appendChild(el("p", "empty-state", pool ? "No prize table loaded." : "The prize table could not be loaded. Try again in a moment."));
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
    questPanel.id = "event-quests";
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
    questPanel.appendChild(el("p", "panel-note", pool
      ? (data.questCount || quests.length) + " event quests have been loaded on this server. Showing the most recent 40; each id opens the quest's page."
      : "The event quest pool could not be loaded. Try again in a moment."));
    var questBody = el("div");
    questPanel.appendChild(questBody);
    root.appendChild(questPanel);
    root.appendChild(prizePanel);

    function renderQuests() {
      clear(questBody);
      if (!pool) return;
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
    module.exports = { staticCards: staticCards, eventCards: eventCards, cardFromRow: cardFromRow, shortDate: shortDate, info: INFO };
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

  // The quest pool and the prize table come from /api/public/events. When it does not answer the cards still
  // show (their text is in js/event-info.js and the static schedule), with a note in place of the pool.
  var poolRequest = optional("/api/public/events");
  Promise.all([poolRequest, festaRequest, currentRequest, bracketRequest]).then(function (all) {
    quests = (all[0] && all[0].quests) || [];
    render(all[0], all[1], all[2], all[3]);
  });
})();
