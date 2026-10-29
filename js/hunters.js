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

  /* ---------- Hunting Road standings ---------- */

  // The hunter's place on the live Road's boards and on the Original Road's (open and solo), at any
  // rank, from GET /api/public/road/hunter/{id}. Resolves to {current: {name, open, solo}, original:
  // {...}}; open/solo are {rank, of, floor, points}, or null when the hunter has no clear on that board.
  // Never rejects: when the call fails both are null and the page says the boards are not available.
  var standingsCache = {};
  function roadStandings(id) {
    if (standingsCache[id]) return standingsCache[id];
    function place(p) { return p && p.rank ? p : null; }
    standingsCache[id] = request("/api/public/road/hunter/" + id)
      .then(function (list) {
        var out = { current: null, original: null };
        (list || []).forEach(function (s) {
          var item = { name: s.name, open: place(s.open), solo: place(s.solo),
                       hunters: Math.max(s.open ? s.open.of : 0, s.solo ? s.solo.of : 0) };
          if (s.current) out.current = item;
          if (s.key === "original") out.original = out.original || item;
        });
        return out;
      })
      .catch(function () { return { current: null, original: null }; });
    return standingsCache[id];
  }

  // "#3 of 6 open (floor 10) · #1 of 2 solo (floor 22)", or "" with no clear on either board.
  function standingText(s) {
    if (!s) return "";
    var bits = [];
    if (s.open) bits.push("#" + num(s.open.rank) + " of " + num(s.open.of) + " open (floor " + num(s.open.floor) + ")");
    if (s.solo) bits.push("#" + num(s.solo.rank) + " of " + num(s.solo.of) + " solo (floor " + num(s.solo.floor) + ")");
    return bits.join(" · ");
  }

  /* ---------- hunter card: a 1200 x 820 PNG drawn on a canvas ---------- */

  // Card frames. Each one is a palette plus a border painter; the rest of the card reads only the
  // palette, so a new frame is one entry here (owner, 2026-10-29: custom borders later). The key is
  // kept in the address (#card-frost) and in localStorage, so a chosen frame sticks.
  var FRAMES = {
    brass: {
      name: "Brass",
      bg: ["#1f150e", "#0b0705"], glow: "rgba(183,138,51,0.35)",
      accent: "#b78a33", second: "#5f8f7c", heading: "#e8c877", label: "#9a8a6d", value: "#ffe6a8",
      text: "#f4e7c9", soft: "#c9b993", tile: "rgba(241,229,200,0.07)", line: "rgba(232,200,119,0.28)",
      border: function (ctx, W, H) {
        ctx.strokeStyle = "#6d4f2b";
        ctx.lineWidth = 6;
        ctx.strokeRect(18, 18, W - 36, H - 36);
        ctx.strokeStyle = "rgba(232,200,119,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(30, 30, W - 60, H - 60);
      }
    },
    frost: {
      name: "Frost",
      bg: ["#101824", "#05080d"], glow: "rgba(120,170,220,0.30)",
      accent: "#7fb0d8", second: "#b9c7d6", heading: "#cfe3f5", label: "#8496a8", value: "#eaf4ff",
      text: "#eef5fb", soft: "#a9bccd", tile: "rgba(200,225,250,0.06)", line: "rgba(160,200,235,0.30)",
      border: function (ctx, W, H) {
        ctx.strokeStyle = "#4b6a86";
        ctx.lineWidth = 4;
        ctx.strokeRect(18, 18, W - 36, H - 36);
        // corner brackets
        ctx.strokeStyle = "#cfe3f5";
        ctx.lineWidth = 3;
        [[30, 30, 1, 1], [W - 30, 30, -1, 1], [30, H - 30, 1, -1], [W - 30, H - 30, -1, -1]].forEach(function (c) {
          ctx.beginPath();
          ctx.moveTo(c[0], c[1] + 46 * c[3]);
          ctx.lineTo(c[0], c[1]);
          ctx.lineTo(c[0] + 46 * c[2], c[1]);
          ctx.stroke();
        });
      }
    },
    ember: {
      name: "Ember",
      bg: ["#22090a", "#0a0303"], glow: "rgba(220,80,40,0.32)",
      accent: "#d0552d", second: "#e0a040", heading: "#ffb36b", label: "#a8806c", value: "#ffd9b0",
      text: "#fbe7d6", soft: "#d6ab8f", tile: "rgba(255,200,170,0.06)", line: "rgba(255,150,100,0.30)",
      border: function (ctx, W, H) {
        var g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, "#8a2a17");
        g.addColorStop(0.5, "#e0703a");
        g.addColorStop(1, "#8a2a17");
        ctx.strokeStyle = g;
        ctx.lineWidth = 8;
        ctx.strokeRect(16, 16, W - 32, H - 32);
        ctx.strokeStyle = "rgba(255,170,110,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(32, 32, W - 64, H - 64);
      }
    }
  };
  var FRAME_KEY = "hvmhfz.cardFrame";

  function chosenFrame() {
    var fromHash = /^#card-(\w+)$/.exec(location.hash);
    if (fromHash && FRAMES[fromHash[1]]) return fromHash[1];
    try {
      var saved = localStorage.getItem(FRAME_KEY);
      if (saved && FRAMES[saved]) return saved;
    } catch (error) { /* storage off: the default frame */ }
    return "brass";
  }

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
    } while (s > 12);
    return s;
  }

  // Hours as "12 h" or "45 min" for the card and the weapon chart.
  function hours(seconds) {
    if (!seconds) return "0 h";
    if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + " min";
    var h = seconds / 3600;
    return (h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()) + " h";
  }

  // The most played weapon from the tracked hours, or null before any were tracked.
  function mainWeapon(hunter) {
    var list = hunter.weaponTime || [];
    return list.length ? list[0] : null;
  }

  var CARD_W = 1200, CARD_H = 820;

  // Draws the card on `canvas` (sized 1200 x 820). `road` is roadStandings(), or null while loading.
  function drawCard(canvas, hunter, logo, road, frameKey) {
    var f = FRAMES[frameKey] || FRAMES.brass;
    var W = CARD_W, H = CARD_H;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    var serif = "Georgia, 'Palatino Linotype', 'Book Antiqua', serif";
    var sans = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, f.bg[0]);
    bg.addColorStop(1, f.bg[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W * 0.3, -60, 40, W * 0.3, -60, 700);
    glow.addColorStop(0, f.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    f.border(ctx, W, H);

    if (logo) {
      var lh = 54, lw = logo.width * (lh / logo.height);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(logo, 60, 52, lw, lh);
      ctx.restore();
    } else {
      ctx.fillStyle = f.heading;
      ctx.font = "700 30px " + serif;
      ctx.fillText("HUNSTERVERSE", 60, 92);
    }
    ctx.fillStyle = f.soft;
    ctx.font = "600 15px " + sans;
    ctx.textAlign = "right";
    ctx.fillText("HUNTER CARD", W - 60, 84);
    ctx.textAlign = "left";

    // name, weapon and guild (no online status: a card is kept and shared long after it is drawn)
    var nameSize = fitText(ctx, hunter.name, 620, 74, serif, "700");
    ctx.fillStyle = f.text;
    ctx.font = "700 " + nameSize + "px " + serif;
    ctx.fillText(hunter.name, 60, 190);
    ctx.fillStyle = f.soft;
    ctx.font = "500 22px " + sans;
    var sub = [hunter.weapon || "Unknown weapon", hunter.guildName ? hunter.guildName + (hunter.guildRank ? " · " + hunter.guildRank : "") : null]
      .filter(Boolean).join("   ·   ");
    ctx.fillText(sub, 60, 232);

    function tile(x, y, w, h, label, value, note, bar) {
      ctx.fillStyle = f.tile;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = f.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = bar || f.accent;
      ctx.fillRect(x, y, 4, h);
      ctx.fillStyle = f.label;
      var ls = fitText(ctx, label, w - 30, 13, sans, "700");
      ctx.font = "700 " + ls + "px " + sans;
      ctx.fillText(label, x + 16, y + 30);
      ctx.fillStyle = f.value;
      var vs = fitText(ctx, value, w - 30, note ? 34 : 30, sans, "700");
      ctx.font = "700 " + vs + "px " + sans;
      ctx.fillText(value, x + 16, y + (note ? 76 : 70));
      if (note) {
        ctx.fillStyle = f.soft;
        var ns = fitText(ctx, note, w - 30, 16, sans, "500");
        ctx.font = "500 " + ns + "px " + sans;
        ctx.fillText(note, x + 16, y + 108);
      }
    }

    var main = mainWeapon(hunter);
    var stats = [
      ["HUNTER RANK", num(hunter.hr)],
      ["G RANK", num(hunter.gr)],
      ["PLAY TIME", playtime(hunter.playtimeSeconds)],
      ["HUNTS LOGGED", num(hunter.totalKills)],
      ["MAIN WEAPON", main ? main.weapon + " · " + hours(main.seconds) : "Not tracked yet"],
      ["LAST SEEN", date(hunter.lastLogin)]
    ];
    var tw = 200, th = 92, gap = 14;
    stats.forEach(function (s, i) {
      tile(60 + (i % 3) * (tw + gap), 276 + Math.floor(i / 3) * (th + gap), tw, th, s[0], s[1]);
    });

    // most hunted
    var mx = 740, my = 150, mw = W - 60 - mx;
    ctx.fillStyle = f.tile;
    ctx.fillRect(mx, my, mw, 362);
    ctx.strokeStyle = f.line;
    ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, 361);
    ctx.fillStyle = f.heading;
    ctx.font = "700 16px " + sans;
    ctx.fillText("MOST HUNTED", mx + 22, my + 36);
    var monsters = (hunter.topMonsters || []).slice(0, 6);
    if (!monsters.length) {
      ctx.fillStyle = f.label;
      ctx.font = "italic 18px " + serif;
      ctx.fillText("No hunts logged yet", mx + 22, my + 80);
    }
    var top = monsters.length ? monsters[0].kills : 1;
    monsters.forEach(function (m, i) {
      var y = my + 74 + i * 47;
      ctx.fillStyle = f.text;
      var ms = fitText(ctx, m.name, mw - 120, 19, sans, "600");
      ctx.font = "600 " + ms + "px " + sans;
      ctx.fillText(m.name, mx + 22, y);
      ctx.textAlign = "right";
      ctx.fillStyle = f.value;
      ctx.font = "700 18px " + sans;
      ctx.fillText(num(m.kills), mx + mw - 22, y);
      ctx.textAlign = "left";
      ctx.fillStyle = f.line;
      ctx.fillRect(mx + 22, y + 10, mw - 44, 6);
      ctx.fillStyle = f.accent;
      ctx.fillRect(mx + 22, y + 10, (mw - 44) * (m.kills / top), 6);
    });

    // Hunting Road (Rengoku): lifetime bests from the save, then the board standings
    var ry = 548;
    ctx.fillStyle = f.heading;
    ctx.font = "700 16px " + sans;
    ctx.fillText("HUNTING ROAD (RENGOKU)", 60, ry);
    ctx.strokeStyle = f.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60 + ctx.measureText("HUNTING ROAD (RENGOKU)").width + 16, ry - 6);
    ctx.lineTo(W - 60, ry - 6);
    ctx.stroke();

    function standing(s, fallbackName) {
      if (road === null) return [fallbackName, "...", "loading the boards"];
      if (!s) return [fallbackName, "-", "board not available"];
      var best = s.open && s.solo ? (s.open.rank <= s.solo.rank ? s.open : s.solo) : (s.open || s.solo);
      return [s.name || fallbackName, best ? "#" + num(best.rank) : "-", best ? standingText(s) : "no clears on this Road"];
    }
    var cur = standing(road && road.current, "Live Road");
    var orig = standing(road && road.original, "Original Road");
    var roadTiles = [
      ["OPEN ROAD BEST", hunter.rengokuMpStages ? "Floor " + num(hunter.rengokuMpStages) : "-",
       hunter.rengokuMpPoints ? num(hunter.rengokuMpPoints) + " points" : "no clear saved", f.accent],
      ["SOLO ROAD BEST", hunter.rengokuSpStages ? "Floor " + num(hunter.rengokuSpStages) : "-",
       hunter.rengokuSpPoints ? num(hunter.rengokuSpPoints) + " points" : "no clear saved", f.accent],
      [cur[0].toUpperCase() + " (LIVE)", cur[1], cur[2], f.second],
      [orig[0].toUpperCase(), orig[1], orig[2], f.second]
    ];
    var rgap = 14, rw = (W - 120 - rgap * 3) / 4;
    roadTiles.forEach(function (s, i) {
      tile(60 + i * (rw + rgap), ry + 22, rw, 128, s[0], s[1], s[2], s[3]);
    });

    ctx.fillStyle = f.label;
    ctx.font = "500 17px " + sans;
    ctx.fillText("hvmhfz.eclipseforge.xyz/hunters.html?id=" + hunter.id, 60, H - 62);
    ctx.textAlign = "right";
    ctx.fillText("Monster Hunter Frontier Z · Hunsterverse", W - 60, H - 62);
    ctx.textAlign = "left";
    return canvas;
  }

  function downloadCanvas(canvas, hunter, frameKey) {
    var file = (hunter.name || "hunter").replace(/[^A-Za-z0-9_-]+/g, "_") + "-hunter-card-" + frameKey + ".png";
    return new Promise(function (resolve, reject) {
      if (!canvas.toBlob) {
        resolve({ url: canvas.toDataURL("image/png"), file: file, revoke: false });
        return;
      }
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error("The card could not be drawn.")); return; }
        resolve({ url: URL.createObjectURL(blob), file: file, revoke: true });
      }, "image/png");
    }).then(function (out) {
      var link = document.createElement("a");
      link.href = out.url;
      link.download = out.file;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (out.revoke) setTimeout(function () { URL.revokeObjectURL(out.url); }, 4000);
    });
  }

  // The Hunter card tab: a frame picker, the live preview (the very canvas that is downloaded) and
  // the download button. The boards load after the first draw; the card redraws when they arrive.
  function cardTab(panel, hunter) {
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Hunter card"));
    head.appendChild(el("span", "panel-note", "1200 x 820 PNG"));
    panel.appendChild(head);

    var frame = chosenFrame();
    var picker = el("div", "chips");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Card frame");
    var canvas = document.createElement("canvas");
    canvas.className = "card-preview";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Hunter card preview for " + hunter.name);
    var logo = null, road = null;

    function redraw() { drawCard(canvas, hunter, logo, road, frame); }

    Object.keys(FRAMES).forEach(function (key) {
      var chip = el("button", "chip", FRAMES[key].name);
      chip.type = "button";
      chip.setAttribute("data-frame", key);
      chip.setAttribute("aria-pressed", key === frame ? "true" : "false");
      chip.addEventListener("click", function () {
        frame = key;
        try { localStorage.setItem(FRAME_KEY, key); } catch (error) { /* not kept */ }
        if (history.replaceState) history.replaceState(null, "", "#card-" + key);
        Array.prototype.forEach.call(picker.children, function (c) {
          c.setAttribute("aria-pressed", c.getAttribute("data-frame") === key ? "true" : "false");
        });
        redraw();
      });
      picker.appendChild(chip);
    });
    panel.appendChild(picker);

    var stage = el("div", "card-stage");
    stage.appendChild(canvas);
    panel.appendChild(stage);

    var bar = el("div", "badge-row card-actions");
    var download = el("button", "btn", "Download card");
    download.type = "button";
    download.addEventListener("click", function () {
      download.disabled = true;
      downloadCanvas(canvas, hunter, frame)
        .then(function () { download.textContent = "Downloaded"; })
        .catch(function () { download.textContent = "Could not save the card"; })
        .then(function () {
          setTimeout(function () { download.disabled = false; download.textContent = "Download card"; }, 1800);
        });
    });
    bar.appendChild(download);
    bar.appendChild(el("span", "note-text", "More frames are on the way. Your choice is remembered on this device."));
    panel.appendChild(bar);

    redraw();
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () { return loadImage("/assets/brand/hunsterverse.gif"); })
      .then(function (img) { logo = img; redraw(); return roadStandings(hunter.id); })
      .then(function (standings) { road = standings; redraw(); });
  }

  // Weapons: the most played weapon and hours on every weapon, from the play tracker (it credits
  // each minute online to the weapon the character last saved with).
  var WEAPON_NAMES = ["Great Sword", "Heavy Bowgun", "Hammer", "Lance", "Sword and Shield", "Light Bowgun",
    "Dual Blades", "Long Sword", "Hunting Horn", "Gunlance", "Bow", "Tonfa", "Switch Axe", "Magnet Spike"];

  function weaponBars(rows, total) {
    var list = el("ol", "weapon-bars");
    var top = rows.length ? Math.max.apply(null, rows.map(function (r) { return r.seconds; })) : 0;
    rows.forEach(function (r) {
      var item = el("li", r.seconds ? null : "is-zero");
      item.appendChild(el("span", "wb-name", r.weapon));
      var track = el("span", "wb-track");
      var fill = el("span", "wb-fill");
      fill.style.width = top ? Math.max(r.seconds ? 1.5 : 0, (r.seconds / top) * 100) + "%" : "0";
      track.appendChild(fill);
      item.appendChild(track);
      var share = total ? Math.round((r.seconds / total) * 100) : 0;
      item.appendChild(el("span", "wb-value", hours(r.seconds) + (r.seconds && total ? " · " + share + "%" : "")));
      list.appendChild(item);
    });
    return list;
  }

  function weaponPanel(hunter) {
    var panel = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Weapons"));
    head.appendChild(el("span", "panel-note", hunter.weaponTimeSince
      ? "hours tracked since " + date(hunter.weaponTimeSince) : "tracking starts with the next minute online"));
    panel.appendChild(head);
    var used = {};
    (hunter.weaponTime || []).forEach(function (w) { used[w.weaponType] = w.seconds; });
    var rows = WEAPON_NAMES.map(function (name, type) { return { weapon: name, seconds: used[type] || 0 }; })
      .sort(function (a, b) { return b.seconds - a.seconds; });
    var total = rows.reduce(function (s, r) { return s + r.seconds; }, 0);
    var main = mainWeapon(hunter);
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard("Most used weapon", main ? main.weapon : "Not tracked yet"));
    grid.appendChild(statCard("Hours with it", main ? hours(main.seconds) : "-"));
    grid.appendChild(statCard("Weapons used", String((hunter.weaponTime || []).length)));
    grid.appendChild(statCard("Hours tracked", hours(total)));
    panel.appendChild(grid);
    panel.appendChild(weaponBars(rows, total));
    panel.appendChild(el("p", "note-text", "Each minute online counts for the weapon the hunter last saved with. "
      + "Hours before tracking began are not known, so this fills in from " + (hunter.weaponTimeSince ? date(hunter.weaponTimeSince) : "now") + " on."));
    return panel;
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
    actions.appendChild(copy);
    view.appendChild(actions);

    // Tabs: the profile and the hunter card (#card, or #card-<frame>).
    var tabs = el("div", "tabs");
    tabs.setAttribute("role", "tablist");
    var profilePanel = el("div", "tab-panel");
    var cardPanel = el("section", "panel tab-panel");
    var cardBuilt = false;
    [["profile", "Profile", profilePanel], ["card", "Hunter card", cardPanel]].forEach(function (def) {
      var tab = el("a", "tab", def[1]);
      tab.id = "tab-" + def[0];
      tab.href = "#" + def[0];
      tab.setAttribute("role", "tab");
      def[2].id = "panel-" + def[0];
      def[2].setAttribute("role", "tabpanel");
      tab.setAttribute("aria-controls", def[2].id);
      tabs.appendChild(tab);
    });
    view.appendChild(tabs);
    view.appendChild(profilePanel);
    view.appendChild(cardPanel);
    function showTab() {
      var card = /^#card/.test(location.hash);
      profilePanel.hidden = card;
      cardPanel.hidden = !card;
      document.getElementById("tab-profile").setAttribute("aria-selected", card ? "false" : "true");
      document.getElementById("tab-card").setAttribute("aria-selected", card ? "true" : "false");
      if (card && !cardBuilt) {
        cardBuilt = true;
        cardTab(cardPanel, hunter);
      }
    }
    window.addEventListener("hashchange", showTab);
    showTab();
    view = profilePanel; // the profile sections below go in the Profile tab

    var panel = el("section", "panel");
    panel.appendChild(el("div", "panel-head")).appendChild(el("h2", null, "Record"));
    var stats = el("div", "guild-stats");
    [["Hunter rank", num(hunter.hr)], ["G rank", num(hunter.gr)], ["Play time", playtime(hunter.playtimeSeconds)],
     ["Titles", num(hunter.titles)], ["Hunts logged", num(hunter.totalKills)],
     ["Last seen", date(hunter.lastLogin)],
     ["Guild joined", hunter.guildJoined ? date(hunter.guildJoined) : "-"]]
      .forEach(function (row) {
        var item = el("div", "guild-stat");
        item.appendChild(el("dt", null, row[0]));
        item.appendChild(el("dd", null, row[1]));
        stats.appendChild(item);
      });
    panel.appendChild(stats);
    view.appendChild(panel);

    // Hunting Road (Rengoku): the save's lifetime bests, then the hunter's place on the boards.
    var rengoku = el("section", "panel");
    var rhead = el("div", "panel-head");
    rhead.appendChild(el("h2", null, "Hunting Road (Rengoku)"));
    var rlink = el("a", "panel-note", "Road leaderboards");
    rlink.href = "/leaderboards.html#road";
    rhead.appendChild(rlink);
    rengoku.appendChild(rhead);
    var grid = el("div", "stat-grid");
    grid.appendChild(statCard("Open Road best", hunter.rengokuMpStages
      ? "Floor " + num(hunter.rengokuMpStages) + " · " + num(hunter.rengokuMpPoints) + " pts" : "-"));
    grid.appendChild(statCard("Solo Road best", hunter.rengokuSpStages
      ? "Floor " + num(hunter.rengokuSpStages) + " · " + num(hunter.rengokuSpPoints) + " pts" : "-"));
    var liveCard = statCard("Live Road board", "Loading");
    var originalCard = statCard("Original Road board", "Loading");
    liveCard.classList.add("skeleton");
    originalCard.classList.add("skeleton");
    grid.appendChild(liveCard);
    grid.appendChild(originalCard);
    rengoku.appendChild(grid);
    rengoku.appendChild(el("p", "note-text",
      "Bests are the game's own lifetime record, on any Road. Board places count every hunter with a clear on that Road's open or solo board."));
    view.appendChild(rengoku);
    roadStandings(hunter.id).then(function (road) {
      [[liveCard, road.current, "Live Road board"], [originalCard, road.original, "Original Road board"]]
        .forEach(function (pair) {
          var card = pair[0], s = pair[1];
          card.classList.remove("skeleton");
          card.querySelector(".stat-label").textContent = s && s.name ? s.name + (pair[2].indexOf("Live") === 0 ? " (live)" : "") : pair[2];
          card.querySelector(".stat-value").textContent = !s ? "Not available" : standingText(s) || "No clears on this Road";
        });
    });

    view.appendChild(weaponPanel(hunter));

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
