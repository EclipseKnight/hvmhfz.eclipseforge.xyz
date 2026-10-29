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


  // The game's own playtime counter, in hours and minutes.
  function playtime(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    return h.toLocaleString() + " h " + (m < 10 ? "0" : "") + m + " m";
  }

  /* ---------- hunter card: a 1200 x 630 PNG drawn on a canvas ---------- */

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function fitText(ctx, text, maxWidth, size, family, weight) {
    var s = size;
    do {
      ctx.font = (weight || "") + " " + s + "px " + family;
      if (ctx.measureText(text).width <= maxWidth) break;
      s -= 2;
    } while (s > 14);
    return s;
  }

  function drawCard(hunter, logo) {
    var W = 1200, H = 630;
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    var serif = "Georgia, 'Palatino Linotype', 'Book Antiqua', serif";
    var sans = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

    // leather background with a warm glow
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1f150e");
    bg.addColorStop(1, "#0b0705");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W * 0.3, -60, 40, W * 0.3, -60, 700);
    glow.addColorStop(0, "rgba(183,138,51,0.35)");
    glow.addColorStop(1, "rgba(183,138,51,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // brass frame
    ctx.strokeStyle = "#6d4f2b";
    ctx.lineWidth = 6;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.strokeStyle = "rgba(232,200,119,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(30, 30, W - 60, H - 60);

    // logo
    if (logo) {
      var lh = 54, lw = logo.width * (lh / logo.height);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(logo, 60, 52, lw, lh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#e8c877";
      ctx.font = "700 30px " + serif;
      ctx.fillText("HUNSTERVERSE", 60, 92);
    }
    ctx.fillStyle = "#c9b993";
    ctx.font = "600 15px " + sans;
    ctx.textAlign = "right";
    ctx.fillText("HUNTER CARD", W - 60, 84);
    ctx.textAlign = "left";

    // name, online dot, weapon and guild
    var nameSize = fitText(ctx, hunter.name, 620, 74, serif, "700");
    ctx.fillStyle = "#f4e7c9";
    ctx.font = "700 " + nameSize + "px " + serif;
    ctx.fillText(hunter.name, 60, 190);
    if (hunter.online) {
      var nw = ctx.measureText(hunter.name).width;
      ctx.fillStyle = "#8fd1b4";
      ctx.beginPath();
      ctx.arc(60 + nw + 26, 190 - nameSize * 0.33, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "600 16px " + sans;
      ctx.fillText("ONLINE", 60 + nw + 44, 190 - nameSize * 0.33 + 6);
    }
    ctx.fillStyle = "#c9b993";
    ctx.font = "500 22px " + sans;
    var sub = [hunter.weapon || "Unknown weapon", hunter.guildName ? hunter.guildName + (hunter.guildRank ? " · " + hunter.guildRank : "") : null]
      .filter(Boolean).join("   ·   ");
    ctx.fillText(sub, 60, 232);

    // stat tiles
    var stats = [
      ["HUNTER RANK", num(hunter.hr)],
      ["G RANK", num(hunter.gr)],
      ["PLAY TIME", playtime(hunter.playtimeSeconds)],
      ["HUNTS LOGGED", num(hunter.totalKills)],
      ["TITLES", num(hunter.titles)],
      ["LAST SEEN", hunter.online ? "Online now" : date(hunter.lastLogin)]
    ];
    var tx = 60, ty = 276, tw = 200, th = 92, gap = 14;
    stats.forEach(function (s, i) {
      var col = i % 3, row = Math.floor(i / 3);
      var x = tx + col * (tw + gap), y = ty + row * (th + gap);
      ctx.fillStyle = "rgba(241,229,200,0.07)";
      ctx.fillRect(x, y, tw, th);
      ctx.strokeStyle = "rgba(232,200,119,0.28)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
      ctx.fillStyle = "#b78a33";
      ctx.fillRect(x, y, 4, th);
      ctx.fillStyle = "#9a8a6d";
      ctx.font = "700 13px " + sans;
      ctx.fillText(s[0], x + 16, y + 30);
      ctx.fillStyle = "#ffe6a8";
      var vs = fitText(ctx, s[1], tw - 30, 30, sans, "700");
      ctx.font = "700 " + vs + "px " + sans;
      ctx.fillText(s[1], x + 16, y + 70);
    });

    // most hunted
    var mx = 740, my = 150, mw = W - 60 - mx;
    ctx.fillStyle = "rgba(241,229,200,0.06)";
    ctx.fillRect(mx, my, mw, 362);
    ctx.strokeStyle = "rgba(232,200,119,0.28)";
    ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, 361);
    ctx.fillStyle = "#e8c877";
    ctx.font = "700 16px " + sans;
    ctx.fillText("MOST HUNTED", mx + 22, my + 36);
    var monsters = (hunter.topMonsters || []).slice(0, 6);
    if (!monsters.length) {
      ctx.fillStyle = "#9a8a6d";
      ctx.font = "italic 18px " + serif;
      ctx.fillText("No hunts logged yet", mx + 22, my + 80);
    }
    var top = monsters.length ? monsters[0].kills : 1;
    monsters.forEach(function (m, i) {
      var y = my + 74 + i * 47;
      ctx.fillStyle = "#eadfc6";
      var ms = fitText(ctx, m.name, mw - 120, 19, sans, "600");
      ctx.font = "600 " + ms + "px " + sans;
      ctx.fillText(m.name, mx + 22, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffe6a8";
      ctx.font = "700 18px " + sans;
      ctx.fillText(num(m.kills), mx + mw - 22, y);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(183,138,51,0.25)";
      ctx.fillRect(mx + 22, y + 10, mw - 44, 6);
      ctx.fillStyle = "#b78a33";
      ctx.fillRect(mx + 22, y + 10, (mw - 44) * (m.kills / top), 6);
    });

    // footer
    ctx.fillStyle = "#9a8a6d";
    ctx.font = "500 17px " + sans;
    ctx.fillText("hvmhfz.eclipseforge.xyz/hunters.html?id=" + hunter.id, 60, H - 62);
    ctx.textAlign = "right";
    ctx.fillText("Monster Hunter Frontier Z · Hunsterverse", W - 60, H - 62);
    ctx.textAlign = "left";
    return canvas;
  }

  function downloadCard(hunter, button) {
    var label = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "Drawing card";
    }
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () { return loadImage("/assets/brand/hunsterverse.gif"); })
      .then(function (logo) {
        var canvas = drawCard(hunter, logo);
        var file = (hunter.name || "hunter").replace(/[^A-Za-z0-9_-]+/g, "_") + "-hunter-card.png";
        return new Promise(function (resolve, reject) {
          if (!canvas.toBlob) {
            resolve({ url: canvas.toDataURL("image/png"), file: file, revoke: false });
            return;
          }
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error("The card could not be drawn.")); return; }
            resolve({ url: URL.createObjectURL(blob), file: file, revoke: true });
          }, "image/png");
        });
      })
      .then(function (out) {
        var link = document.createElement("a");
        link.href = out.url;
        link.download = out.file;
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (out.revoke) setTimeout(function () { URL.revokeObjectURL(out.url); }, 4000);
        if (button) button.textContent = "Card downloaded";
      })
      .catch(function () {
        if (button) button.textContent = "Could not draw the card";
      })
      .then(function () {
        if (!button) return;
        setTimeout(function () {
          button.disabled = false;
          button.textContent = label;
        }, 1800);
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
    if (hunter.online) badges.appendChild(el("span", "badge good", "Online now"));
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
    cardBtn.addEventListener("click", function () { downloadCard(hunter, cardBtn); });
    actions.appendChild(copy);
    actions.appendChild(cardBtn);
    view.appendChild(actions);


    var panel = el("section", "panel");
    panel.appendChild(el("div", "panel-head")).appendChild(el("h2", null, "Record"));
    var stats = el("div", "guild-stats");
    [["Hunter rank", num(hunter.hr)], ["G rank", num(hunter.gr)], ["Play time", playtime(hunter.playtimeSeconds)],
     ["Titles", num(hunter.titles)], ["Hunts logged", num(hunter.totalKills)],
     ["Last seen", hunter.online ? "Online now" : date(hunter.lastLogin)],
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

  // ?q= opens the list already searching for a name (the live board on the Worlds page links here when
  // the API gives it no character id).
  var query = (new URLSearchParams(window.location.search).get("q") || "").trim();
  if (query) {
    state.q = query;
    document.getElementById("hunter-search").value = query;
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
