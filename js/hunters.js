/* Hunter directory and profile. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var state = { q: "", sort: "hr", page: 0, size: 30 };

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

  function num(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  function request(path) {
    return fetch(API + path, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  function renderList(data) {
    var body = document.getElementById("hunter-body");
    clear(body);

    if (!data.items.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No hunter matches that search.");
      cell.colSpan = 7;
      empty.appendChild(cell);
      body.appendChild(empty);
    }

    data.items.forEach(function (hunter, index) {
      var row = el("tr");
      row.appendChild(el("td", "rank", String(state.page * state.size + index + 1)));

      var nameCell = el("td", "cell-name");
      var link = el("a", null, hunter.name || "Unknown");
      link.href = "/hunters.html?id=" + hunter.id;
      nameCell.appendChild(link);
      if (hunter.female) nameCell.appendChild(el("span", "badge", "F"));
      row.appendChild(nameCell);

      [num(hunter.hr), num(hunter.gr), hunter.weapon || "Unknown",
       hunter.guildName || "-", date(hunter.lastLogin)].forEach(function (value) {
        row.appendChild(el("td", null, value));
      });
      body.appendChild(row);
    });

    var pages = Math.max(1, Math.ceil(data.total / data.size));
    if (!state.q) document.getElementById("hunter-total").textContent = Number(data.total).toLocaleString();
    document.getElementById("hunter-results").textContent = data.total + (data.total === 1 ? " hunter" : " hunters");
    var pager = document.getElementById("hunter-pager");
    pager.hidden = pages <= 1;
    document.getElementById("hunter-page-note").textContent = "Page " + (state.page + 1) + " of " + pages;
    document.getElementById("hunter-prev").disabled = state.page === 0;
    document.getElementById("hunter-next").disabled = state.page >= pages - 1;
  }

  function showError(message) {
    var body = document.getElementById("hunter-body");
    clear(body);
    var row = el("tr");
    var cell = el("td", "empty-cell", message);
    cell.colSpan = 7;
    row.appendChild(cell);
    body.appendChild(row);
    document.getElementById("hunter-results").textContent = "Could not load hunters";
    document.getElementById("hunter-pager").hidden = true;
  }

  // Only the newest request may draw: a slow answer to an older search must not
  // overwrite the results of the one typed after it.
  var latest = 0;

  function loadList() {
    var url = "/api/public/hunters?q=" + encodeURIComponent(state.q) + "&sort=" + state.sort +
      "&page=" + state.page + "&size=" + state.size;
    var ticket = ++latest;
    request(url).then(function (data) {
      if (ticket === latest) renderList(data);
    }).catch(function () {
      if (ticket === latest) showError("The hunter list could not be loaded right now. Try again in a moment.");
    });
  }

  function statCard(label, value) {
    var card = el("div", "stat-card");
    card.appendChild(el("span", "stat-label", label));
    card.appendChild(el("span", "stat-value", value));
    return card;
  }

  function detail(hunter) {
    var view = document.getElementById("detail-view");
    clear(view);
    document.getElementById("list-view").hidden = true;
    view.hidden = false;

    var back = el("a", "back-link", "Back to all hunters");
    back.href = "/hunters.html";
    view.appendChild(back);

    var head = el("header", "page-head");
    head.appendChild(el("p", "kicker", "Hunter"));
    head.appendChild(el("h1", null, hunter.name));
    var badges = el("div", "badge-row");
    badges.appendChild(el("span", "badge", hunter.weapon || "Unknown weapon"));
    badges.appendChild(el("span", "badge", hunter.female ? "Female" : "Male"));
    if (hunter.guildName) {
      var guildBadge = el("a", "badge good", hunter.guildName + (hunter.guildRank ? " · " + hunter.guildRank : ""));
      guildBadge.href = "/guilds.html";
      badges.appendChild(guildBadge);
    }
    head.appendChild(badges);
    view.appendChild(head);

    var actions = el("div", "badge-row hunter-actions");
    var copy = el("button", "ghost-btn small", "Copy profile link");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var url = location.origin + "/hunters.html?id=" + hunter.id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          copy.textContent = "Copied";
          setTimeout(function () { copy.textContent = "Copy profile link"; }, 1800);
        });
      }
    });
    var cardBtn = el("button", "ghost-btn small", "Download hunter card");
    cardBtn.type = "button";
    cardBtn.addEventListener("click", function () { downloadCard(hunter); });
    actions.appendChild(copy);
    actions.appendChild(cardBtn);
    view.appendChild(actions);


    var panel = el("section", "panel");
    panel.appendChild(el("div", "panel-head")).appendChild(el("h2", null, "Record"));
    var stats = el("div", "guild-stats");
    [["Hunter rank", num(hunter.hr)], ["G rank", num(hunter.gr)], ["Titles", num(hunter.titles)],
     ["Hunts logged", num(hunter.totalKills)], ["Last seen", date(hunter.lastLogin)],
     ["Guild joined", hunter.guildJoined ? date(hunter.guildJoined) : "-"]]
      .forEach(function (row) {
        var item = el("div", "guild-stat");
        item.appendChild(el("dt", null, row[0]));
        item.appendChild(el("dd", null, row[1]));
        stats.appendChild(item);
      });
    panel.appendChild(stats);
    view.appendChild(panel);

    if (hunter.rengokuMpStages || hunter.rengokuSpStages || hunter.rengokuMpPoints) {
      var rengoku = el("section", "panel");
      rengoku.appendChild(el("div", "panel-head")).appendChild(el("h2", null, "Rengoku"));
      var grid = el("div", "stat-grid");
      grid.appendChild(statCard("Multiplayer best", num(hunter.rengokuMpStages) + " stages · " + num(hunter.rengokuMpPoints) + " pts"));
      grid.appendChild(statCard("Solo best", num(hunter.rengokuSpStages) + " stages · " + num(hunter.rengokuSpPoints) + " pts"));
      rengoku.appendChild(grid);
      view.appendChild(rengoku);
    }

    if (hunter.topMonsters && hunter.topMonsters.length) {
      var monsters = el("section", "panel");
      var mh = el("div", "panel-head");
      mh.appendChild(el("h2", null, "Most hunted"));
      mh.appendChild(el("span", "panel-note", "from the kill log"));
      monsters.appendChild(mh);

      var wrap = el("div", "table-wrap");
      var table = el("table", "data-table");
      var thead = el("thead");
      var row = el("tr");
      ["Monster", "Hunts"].forEach(function (label, i) { row.appendChild(el("th", i === 1 ? "num" : null, label)); });
      thead.appendChild(row);
      table.appendChild(thead);
      var tbody = el("tbody");
      hunter.topMonsters.forEach(function (monster) {
        var tr = el("tr");
        tr.appendChild(el("td", null, monster.name));
        tr.appendChild(el("td", "num", num(monster.kills)));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      monsters.appendChild(wrap);
      view.appendChild(monsters);
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  var id = new URLSearchParams(window.location.search).get("id");
  if (id) {
    request("/api/public/hunters/" + encodeURIComponent(id)).then(detail).catch(function () {
      document.getElementById("list-view").hidden = false;
      document.getElementById("hunter-results").textContent = "Hunter not found";
    });
    return;
  }

  document.getElementById("hunter-search").addEventListener("input", debounce(function (event) {
    state.q = event.target.value.trim();
    state.page = 0;
    loadList();
  }, 250));

  document.getElementById("hunter-sort").addEventListener("change", function (event) {
    state.sort = event.target.value;
    state.page = 0;
    loadList();
  });

  document.getElementById("hunter-prev").addEventListener("click", function () {
    if (state.page > 0) { state.page -= 1; loadList(); }
  });
  document.getElementById("hunter-next").addEventListener("click", function () {
    state.page += 1;
    loadList();
  });

  loadList();
})();
