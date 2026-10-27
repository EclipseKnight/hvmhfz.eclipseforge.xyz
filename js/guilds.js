/* Guild directory: search, sort, paging and a detail view with roster and board. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var state = { q: "", sort: "rp", page: 0, size: 24 };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

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

  /* ---------- list ---------- */

  function tile(guild) {
    var link = el("a", "tile");
    link.href = "/guilds.html?id=" + guild.id;

    var head = el("div", "tile-head");
    head.appendChild(el("h3", null, guild.name || "Unnamed guild"));
    if (guild.recruiting) head.appendChild(el("span", "badge good", "Recruiting"));
    link.appendChild(head);

    link.appendChild(el("p", "tile-meta", (guild.members === 1 ? "1 member" : guild.members + " members") +
      " · led by " + (guild.leader || "unknown")));
    link.appendChild(el("p", "tile-stat", num(guild.rankRp) + " guild RP" + (guild.eventRp ? " · " + num(guild.eventRp) + " event RP" : "")));
    link.appendChild(el("p", "tile-meta", "Founded " + date(guild.createdAt)));
    return link;
  }

  function renderList(data) {
    var grid = document.getElementById("guilds");
    clear(grid);
    if (!data.items.length) {
      grid.appendChild(el("p", "empty-state", "No guild matches that search."));
    } else {
      data.items.forEach(function (guild) { grid.appendChild(tile(guild)); });
    }

    var pages = Math.max(1, Math.ceil(data.total / data.size));
    document.getElementById("guild-total").textContent = Number(data.total).toLocaleString();
    document.getElementById("guild-results").textContent = data.total + (data.total === 1 ? " guild" : " guilds");
    var pager = document.getElementById("guild-pager");
    pager.hidden = pages <= 1;
    document.getElementById("guild-page-note").textContent = "Page " + (state.page + 1) + " of " + pages;
    document.getElementById("guild-prev").disabled = state.page === 0;
    document.getElementById("guild-next").disabled = state.page >= pages - 1;
  }

  function loadList() {
    var url = "/api/public/guilds?q=" + encodeURIComponent(state.q) + "&sort=" + state.sort +
      "&page=" + state.page + "&size=" + state.size;
    request(url).then(renderList).catch(function () {
      document.getElementById("guild-results").textContent = "Could not load guilds";
    });
  }

  /* ---------- detail ---------- */

  function detail(guild) {
    var view = document.getElementById("detail-view");
    clear(view);
    document.getElementById("list-view").hidden = true;
    view.hidden = false;

    var back = el("a", "back-link", "Back to all guilds");
    back.href = "/guilds.html";
    view.appendChild(back);

    var head = el("header", "page-head");
    head.appendChild(el("p", "kicker", "Guild"));
    head.appendChild(el("h1", null, guild.name));

    var badges = el("div", "badge-row");
    badges.appendChild(el("span", "badge", guild.members + " members"));
    if (guild.recruiting) badges.appendChild(el("span", "badge good", "Recruiting"));
    if (guild.leader) badges.appendChild(el("span", "badge", "Leader: " + guild.leader));
    head.appendChild(badges);
    view.appendChild(head);

    if (guild.comment) {
      var panel = el("section", "panel");
      panel.appendChild(el("div", "panel-head")).appendChild(el("h2", null, "Motto"));
      panel.appendChild(el("p", "guild-comment", guild.comment));
      view.appendChild(panel);
    }

    var statsPanel = el("section", "panel");
    statsPanel.appendChild(el("div", "panel-head")).appendChild(el("h2", null, "Guild record"));
    var stats = el("div", "guild-stats");
    [["Guild RP", num(guild.rankRp)], ["Event RP", num(guild.eventRp)],
     ["Tower RP", num(guild.towerRp)], ["Room RP", num(guild.roomRp)],
     ["Founded", date(guild.createdAt)], ["Room expires", guild.roomExpiry ? date(guild.roomExpiry) : "None"]]
      .forEach(function (row) {
        var item = el("div", "guild-stat");
        item.appendChild(el("dt", null, row[0]));
        item.appendChild(el("dd", null, row[1]));
        stats.appendChild(item);
      });
    statsPanel.appendChild(stats);
    view.appendChild(statsPanel);

    var rosterPanel = el("section", "panel");
    var rosterHead = el("div", "panel-head");
    rosterHead.appendChild(el("h2", null, "Roster"));
    rosterHead.appendChild(el("span", "panel-note", guild.members + (guild.members === 1 ? " hunter" : " hunters")));
    rosterPanel.appendChild(rosterHead);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table");
    var thead = el("thead");
    var headRow = el("tr");
    ["Hunter", "Rank", "Joined", "RP today", "RP yesterday", "Last seen"].forEach(function (label) {
      headRow.appendChild(el("th", null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = el("tbody");
    guild.roster.forEach(function (member) {
      var row = el("tr");
      var nameCell = el("td", "cell-name");
      var link = el("a", null, member.name || "Unknown");
      link.href = "/hunters.html?id=" + member.characterId;
      nameCell.appendChild(link);
      if (member.recruiter) nameCell.appendChild(el("span", "badge", "Recruiter"));
      row.appendChild(nameCell);
      [member.rank || "Member", date(member.joinedAt), num(member.rpToday), num(member.rpYesterday),
       date(member.lastLogin)].forEach(function (value) { row.appendChild(el("td", null, value)); });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    rosterPanel.appendChild(wrap);
    view.appendChild(rosterPanel);

    if (guild.posts && guild.posts.length) {
      var postsPanel = el("section", "panel");
      var postHead = el("div", "panel-head");
      postHead.appendChild(el("h2", null, "Guild board"));
      postHead.appendChild(el("span", "panel-note", guild.posts.length + " posts"));
      postsPanel.appendChild(postHead);

      guild.posts.forEach(function (post) {
        var item = el("article", "post");
        var meta = el("div", "post-meta");
        meta.appendChild(el("strong", null, post.title || "Untitled"));
        meta.appendChild(el("span", "muted", (post.author || "Unknown") + " · " + date(post.createdAt)));
        item.appendChild(meta);
        if (post.body) item.appendChild(el("p", "post-body", post.body));
        postsPanel.appendChild(item);
      });
      view.appendChild(postsPanel);
    }
  }

  /* ---------- boot ---------- */

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
    request("/api/public/guilds/" + encodeURIComponent(id)).then(detail).catch(function () {
      document.getElementById("list-view").hidden = false;
      document.getElementById("guild-results").textContent = "Guild not found";
    });
    return;
  }

  document.getElementById("guild-search").addEventListener("input", debounce(function (event) {
    state.q = event.target.value.trim();
    state.page = 0;
    loadList();
  }, 250));

  document.getElementById("guild-sort").addEventListener("change", function (event) {
    state.sort = event.target.value;
    state.page = 0;
    loadList();
  });

  document.getElementById("guild-prev").addEventListener("click", function () {
    if (state.page > 0) { state.page -= 1; loadList(); }
  });
  document.getElementById("guild-next").addEventListener("click", function () {
    state.page += 1;
    loadList();
  });

  loadList();
})();
