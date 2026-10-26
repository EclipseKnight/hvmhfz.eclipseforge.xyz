/* Hunsterverse account portal: tabs, search, characters, guild and Discord linking. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var TABS = ["overview", "characters", "storage", "hunts", "guild", "account"];

  var state = {
    account: null,
    characters: [],
    guilds: [],
    discord: null
  };

  /* ---------- session ---------- */

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function tokenExpiry(value) {
    try {
      var payload = value.split(".")[1];
      var claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp ? claims.exp * 1000 : 0;
    } catch (error) {
      return 0;
    }
  }

  function sessionValid() {
    var value = token();
    return !!value && tokenExpiry(value) > Date.now() + 30000;
  }

  function request(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: Object.assign({ Authorization: "Bearer " + token() }, opts.headers || {}),
      body: opts.body,
      cache: "no-store"
    }).then(function (response) {
      if (response.status === 401) {
        clearToken();
        window.location.replace("/");
        throw new Error("unauthenticated");
      }
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      return response.json();
    });
  }

  /* ---------- helpers ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function formatDate(value) {
    if (!value) return "Never";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function relative(value) {
    if (!value) return "";
    var minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 60) return minutes <= 1 ? "just now" : minutes + " minutes ago";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + (hours === 1 ? " hour ago" : " hours ago");
    return Math.round(hours / 24) + " days ago";
  }

  function number(value) {
    return value === null || value === undefined ? "-" : String(value);
  }

  function showError(message) {
    var node = document.getElementById("account-error");
    node.textContent = message;
    node.hidden = false;
  }

  /* ---------- tabs ---------- */

  function activateTab(name) {
    var target = TABS.indexOf(name) === -1 ? "overview" : name;
    TABS.forEach(function (tab) {
      var panel = document.getElementById("panel-" + tab);
      var link = document.getElementById("tab-" + tab);
      var active = tab === target;
      if (panel) panel.hidden = !active;
      if (link) link.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function wireTabs() {
    TABS.forEach(function (tab) {
      var link = document.getElementById("tab-" + tab);
      if (!link) return;
      link.addEventListener("click", function (event) {
        event.preventDefault();
        if (window.location.hash !== "#" + tab) {
          window.history.pushState(null, "", "#" + tab);
        }
        activateTab(tab);
      });
    });
    window.addEventListener("hashchange", function () {
      activateTab(window.location.hash.replace("#", ""));
    });
    window.addEventListener("popstate", function () {
      activateTab(window.location.hash.replace("#", ""));
    });
  }

  /* ---------- rendering ---------- */

  function stat(id, label, value, tone) {
    var card = document.getElementById(id);
    if (!card) return;
    card.classList.remove("skeleton");
    card.className = "stat-card" + (tone ? " " + tone : "");
    card.querySelector(".stat-label").textContent = label;
    card.querySelector(".stat-value").textContent = value;
  }

  function renderAccount(account) {
    document.getElementById("account-name").textContent = account.username;
    var sub = "Hunsterverse hunter account";
    if (account.lastLogin) sub += " · last login " + relative(account.lastLogin);
    document.getElementById("account-sub").textContent = sub;

    stat("stat-discord", "Discord", account.discordLinked ? "Linked" : "Not linked", account.discordLinked ? "good" : "muted");
    stat("stat-characters", "Characters", String(account.characters));
    stat("stat-lastlogin", "Last login", formatDate(account.lastLogin));
    stat("stat-roles", "Roles", (account.roles || []).map(function (role) {
      return role.replace(/^ROLE_/, "");
    }).join(", ") || "None");

    document.getElementById("count-characters").textContent = account.characters ? "(" + account.characters + ")" : "";

    var details = document.getElementById("account-details");
    clear(details);
    [["Username", account.username],
     ["Discord", account.discordLinked ? "Linked" : "Not linked"],
     ["Roles", (account.roles || []).map(function (r) { return r.replace(/^ROLE_/, ""); }).join(", ") || "None"],
     ["Last login", formatDate(account.lastLogin)],
     ["Characters", String(account.characters)]
    ].forEach(function (row) {
      details.appendChild(el("dt", null, row[0]));
      details.appendChild(el("dd", null, row[1]));
    });
  }

  function renderDiscord(discord) {
    var body = document.getElementById("discord-body");
    var note = document.getElementById("discord-note");
    clear(body);

    if (discord.linked) {
      note.textContent = "linked";
      body.appendChild(el("p", "discord-state good", "Your Discord account is linked. Character backups and bot commands are available in the server."));
      return;
    }

    note.textContent = "not linked";
    body.appendChild(el("p", "discord-state", "Run this command in the #mhfrontier channel of the Hunsterverse Discord to link your account:"));

    var box = el("div", "command-box");
    box.appendChild(el("code", "command", discord.command || "!f link ..."));
    var copy = el("button", "ghost-btn small", "Copy");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var value = discord.command || "";
      function done() {
        copy.textContent = "Copied";
        setTimeout(function () { copy.textContent = "Copy"; }, 1800);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(done, done);
      } else {
        var area = document.createElement("textarea");
        area.value = value;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand("copy"); } catch (error) { /* ignore */ }
        document.body.removeChild(area);
        done();
      }
    });
    box.appendChild(copy);
    body.appendChild(box);

    var actions = el("div", "discord-actions");
    var check = el("button", "ghost-btn small dark", "Check again");
    check.type = "button";
    check.addEventListener("click", function () {
      check.disabled = true;
      request("/api/account/discord").then(function (fresh) {
        state.discord = fresh;
        renderDiscord(fresh);
        if (fresh.linked) {
          stat("stat-discord", "Discord", "Linked", "good");
          state.account.discordLinked = true;
          renderAccount(state.account);
        }
      }).catch(function () {
        showError("Could not refresh the Discord status. Try again in a moment.");
      }).finally(function () {
        check.disabled = false;
      });
    });
    actions.appendChild(check);
    body.appendChild(actions);

    body.appendChild(el("p", "note-text", "The command is valid for 24 hours. Linking lets the bot back up and restore your characters."));
  }

  function characterRow(character) {
    var row = el("tr");
    row.dataset.search = [character.name, character.weaponType, character.guildName, character.guildRank]
      .filter(Boolean).join(" ").toLowerCase();

    var nameCell = el("td", "cell-name");
    nameCell.appendChild(el("span", null, character.name || "Unnamed"));
    if (character.guildRank) nameCell.appendChild(el("span", "badge", character.guildRank));
    row.appendChild(nameCell);

    [number(character.hr), number(character.gr), character.weaponType || "Unknown",
     character.female ? "Female" : "Male", number(character.gcp), number(character.kouryouPoints),
     number(character.dailyQuests), character.guildName || "-", formatDate(character.lastLogin)]
      .forEach(function (value) { row.appendChild(el("td", null, value)); });

    return row;
  }

  function renderCharacters(list) {
    var body = document.getElementById("characters-body");
    clear(body);

    if (!list.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No characters on this account yet.");
      cell.colSpan = 10;
      empty.appendChild(cell);
      body.appendChild(empty);
      document.getElementById("characters-note").textContent = "none";
      document.getElementById("character-results").textContent = "";
      return;
    }

    list.forEach(function (character) { body.appendChild(characterRow(character)); });
    document.getElementById("characters-note").textContent = list.length + (list.length === 1 ? " hunter" : " hunters");
    document.getElementById("character-results").textContent = list.length + " shown";
  }

  function renderGuilds(guilds) {
    var container = document.getElementById("guilds");
    clear(container);

    if (!guilds.length) {
      container.appendChild(el("p", "empty-state", "No guild yet. Your characters are not in a guild."));
      document.getElementById("guild-note").textContent = "none";
      document.getElementById("count-guild").textContent = "";
      return;
    }

    document.getElementById("count-guild").textContent = "(" + guilds.length + ")";
    document.getElementById("guild-note").textContent = guilds.length === 1 ? "1 guild" : guilds.length + " guilds";

    var totalMembers = 0;

    guilds.forEach(function (guild) {
      totalMembers += (guild.members || []).length;
      var card = el("article", "guild-card");

      var head = el("div", "guild-head");
      head.appendChild(el("h3", null, guild.name || "Unnamed guild"));
      var badges = el("div", "badge-row");
      if (guild.recruiting) badges.appendChild(el("span", "badge good", "Recruiting"));
      badges.appendChild(el("span", "badge", (guild.members || []).length + " members"));
      head.appendChild(badges);
      card.appendChild(head);

      if (guild.comment) card.appendChild(el("p", "guild-comment", guild.comment));

      var stats = el("div", "guild-stats");
      [["Rank RP", number(guild.rankRp)],
       ["Event RP", number(guild.eventRp)],
       ["Tower RP", number(guild.towerRp)],
       ["Room RP", number(guild.roomRp)],
       ["Leader", guild.leaderName || "unknown"],
       ["Created", formatDate(guild.createdAt)],
       ["Room expires", guild.roomExpiry ? formatDate(guild.roomExpiry) : "none"]
      ].forEach(function (row) {
        var item = el("div", "guild-stat");
        item.appendChild(el("dt", null, row[0]));
        item.appendChild(el("dd", null, row[1]));
        stats.appendChild(item);
      });
      card.appendChild(stats);

      var wrap = el("div", "table-wrap");
      var table = el("table", "data-table member-table");
      var thead = el("thead");
      var headRow = el("tr");
      ["Hunter", "Rank", "Recruiter", "Joined", "RP today", "RP yesterday", "Last login"].forEach(function (label) {
        headRow.appendChild(el("th", null, label));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      var tbody = el("tbody");
      (guild.members || []).forEach(function (member) {
        var row = el("tr");
        row.dataset.search = [member.name, member.rank].filter(Boolean).join(" ").toLowerCase();
        [member.name || "Unknown", member.rank || "Member", member.recruiter ? "Yes" : "-",
         formatDate(member.joinedAt), number(member.rpToday), number(member.rpYesterday),
         formatDate(member.lastLogin)].forEach(function (value) {
          row.appendChild(el("td", null, value));
        });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);

      card.dataset.guild = String(guild.id);
      container.appendChild(card);
    });

    document.getElementById("guild-results").textContent = totalMembers + " members";
  }

  function renderActivity(characters, guilds) {
    var list = document.getElementById("activity");
    clear(list);

    var events = [];
    characters.forEach(function (character) {
      if (character.lastLogin) {
        events.push({ when: character.lastLogin, text: (character.name || "A hunter") + " last logged in" });
      }
    });
    guilds.forEach(function (guild) {
      (guild.members || []).forEach(function (member) {
        if (member.joinedAt) {
          events.push({ when: member.joinedAt, text: (member.name || "A hunter") + " joined " + (guild.name || "the guild") });
        }
      });
    });

    events.sort(function (a, b) { return new Date(b.when) - new Date(a.when); });

    if (!events.length) {
      list.appendChild(el("li", "empty-state", "Nothing recorded yet."));
      return;
    }

    events.slice(0, 6).forEach(function (event) {
      var item = el("li");
      item.appendChild(el("span", "activity-text", event.text));
      item.appendChild(el("time", "activity-when", formatDate(event.when)));
      list.appendChild(item);
    });
  }

  /* ---------- search ---------- */

  function wireSearch(inputId, resultsId, filterFn) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("input", function () {
      filterFn(input.value.trim().toLowerCase(), resultsId);
    });
  }

  function filterRows(containerSelector, term, resultsId, emptyText) {
    var containers = document.querySelectorAll(containerSelector);
    var shown = 0;
    containers.forEach(function (container) {
      var rows = container.querySelectorAll("tbody tr[data-search]");
      var visible = 0;
      rows.forEach(function (row) {
        var match = !term || row.dataset.search.indexOf(term) !== -1;
        row.hidden = !match;
        if (match) visible++;
      });
      shown += visible;
      var card = container.closest(".guild-card");
      if (card) card.hidden = term !== "" && visible === 0;
      var existing = container.querySelector(".no-results");
      if (existing) existing.remove();
      if (term && visible === 0 && container.tagName === "TBODY") {
        var row = el("tr", "no-results");
        var cell = el("td", "empty-cell", emptyText || "No matches.");
        cell.colSpan = 10;
        row.appendChild(cell);
        container.appendChild(row);
      }
    });
    var results = document.getElementById(resultsId);
    if (results) results.textContent = term ? shown + " matching" : "";
  }


  /* ---------- storage and hunts ---------- */

  function money(value) {
    return Number(value || 0).toLocaleString();
  }

  function amount(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  var BOX_PAGES = 10;
  var BOX_SIZE = 100;
  var box = { page: 0, items: [], bySlot: {}, selected: null, query: "" };

  var ICONS = {
    flask: { color: "#7fc4e6", d: "M10 3h4v2l-1 1v3.1l3.4 6.6A2.8 2.8 0 0 1 13.8 20h-3.6a2.8 2.8 0 0 1-2.6-4.3L11 9.1V6l-1-1V3z" },
    leaf: { color: "#86c46e", d: "M20 4C11 4 5 9 4 18c9-1 16-6 16-14z" },
    book: { color: "#c39a63", d: "M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1 3v12h9V6H7z" },
    meat: { color: "#c96f5a", d: "M16.5 5.5a5 5 0 0 0-7 7L6 16a1.8 1.8 0 1 0 2.5 2.5l3.5-3.5a5 5 0 0 0 4.5-9.5z" },
    gem: { color: "#b98ad8", d: "M12 3l6 6-6 12L6 9l6-6z" },
    ticket: { color: "#e8c877", d: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7z" },
    ore: { color: "#c9a45c", d: "M4 16l4-9 4 3 4-5 4 11-8 4-8-4z" },
    bone: { color: "#d9cfba", d: "M5.5 8.5a2 2 0 1 1 2.8-2.8l8 8a2 2 0 1 1-2.8 2.8l-8-8z" },
    sack: { color: "#a9b4c0", d: "M8 8h8l2 5-3 7H9l-3-7 2-5z" }
  };

  function iconKind(name) {
    var n = String(name || "").toLowerCase();
    if (/potion|juice|drink|medicine|antidote|immunizer|nutrient|drug|elixir|extract/.test(n)) return "flask";
    if (/herb|leaf|mushroom|seed|berry|plant|fruit|nectar|honey|bug|worm|web|moss|grass/.test(n)) return "leaf";
    if (/book|combo|map|scroll|tome|note/.test(n)) return "book";
    if (/meat|fish|steak|jerky|sushi/.test(n)) return "meat";
    if (/gem|jewel|orb|pearl|crystal/.test(n)) return "gem";
    if (/ticket|tkt|cheque|coin|pass|receipt|coupon|badge/.test(n)) return "ticket";
    if (/ore|stone|iron|machalite|dragonite|carbalite|mineral/.test(n)) return "ore";
    if (/bone|fang|claw|scale|shell|carapace|hide|pelt|wing|tail|horn|sacle|fin|tooth/.test(n)) return "bone";
    return "sack";
  }

  function iconNode(item) {
    var name = typeof item === "string" ? item : (item && item.name);
    var file = item && typeof item === "object" ? item.icon : null;

    if (file) {
      var img = document.createElement("img");
      img.className = "item-img";
      img.src = "/assets/items/" + file + ".webp";
      img.alt = "";
      img.loading = "lazy";
      return img;
    }

    var kind = ICONS[iconKind(name)];
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", kind.d);
    path.setAttribute("fill", kind.color);
    svg.appendChild(path);
    return svg;
  }

  function wallet(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function pageCount(page) {
    var count = 0;
    for (var slot = page * BOX_SIZE; slot < (page + 1) * BOX_SIZE; slot++) {
      if (box.bySlot[slot]) count++;
    }
    return count;
  }

  function renderTabs() {
    var tabs = document.getElementById("box-tabs");
    clear(tabs);
    for (var page = 0; page < BOX_PAGES; page++) {
      var button = el("button", "mbox-tab", String(page + 1));
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-pressed", page === box.page ? "true" : "false");
      var count = pageCount(page);
      if (count) {
        button.appendChild(el("span", "tab-dot"));
        button.title = count + (count === 1 ? " item" : " items");
      }
      button.addEventListener("click", (function (target) {
        return function () {
          box.page = target;
          renderTabs();
          renderGrid();
        };
      })(page));
      tabs.appendChild(button);
    }
  }

  function renderGrid() {
    var grid = document.getElementById("box-grid");
    clear(grid);
    var start = box.page * BOX_SIZE;
    for (var i = 0; i < BOX_SIZE; i++) {
      var slot = start + i;
      var item = box.bySlot[slot];
      var cell = el("div", "slot" + (item ? " filled" : ""));
      cell.setAttribute("role", "gridcell");
      if (item) {
        cell.title = item.name + " x" + item.quantity;
        if (box.query && item.name.toLowerCase().indexOf(box.query) !== -1) {
          cell.classList.add("match");
        } else if (box.query) {
          cell.classList.add("dim");
        }
        if (box.selected === item.slot) cell.classList.add("sel");
        cell.appendChild(iconNode(item));
        cell.appendChild(el("span", "qty", amount(item.quantity)));
        cell.addEventListener("click", (function (entry) {
          return function () { selectItem(entry); };
        })(item));
      }
      grid.appendChild(cell);
    }
  }

  function showPreview(item, meta) {
    document.getElementById("preview-name").textContent = item.name;
    document.getElementById("preview-meta").textContent = meta;
    var icon = document.getElementById("preview-icon");
    clear(icon);
    icon.appendChild(iconNode(item));
  }

  function selectItem(item) {
    box.selected = item.slot;
    renderGrid();
    showPreview(item, "x" + amount(item.quantity) + " · id " + item.id +
      " · slot " + ((item.slot % BOX_SIZE) + 1));
  }

  function searchBox(term) {
    box.query = term;
    if (term) {
      var matches = box.items.filter(function (item) {
        return item.name.toLowerCase().indexOf(term) !== -1;
      });
      if (matches.length) box.page = Math.floor(matches[0].slot / BOX_SIZE);
      document.getElementById("storage-box-note").textContent =
        matches.length + (matches.length === 1 ? " matching item" : " matching items");
    } else {
      document.getElementById("storage-box-note").textContent = box.items.length + " items";
    }
    renderTabs();
    renderGrid();
  }

  function renderPouch(pouch) {
    var grid = document.getElementById("pouch-grid");
    clear(grid);
    var bySlot = {};
    pouch.forEach(function (item) {
      if (item.slot !== null && item.slot !== undefined) bySlot[item.slot] = item;
    });
    for (var i = 0; i < 40; i++) {
      var item = bySlot[i];
      var cell = el("div", "slot" + (item ? " filled" : ""));
      cell.setAttribute("role", "gridcell");
      if (item) {
        cell.title = item.name + " x" + item.quantity;
        cell.appendChild(iconNode(item));
        cell.appendChild(el("span", "qty", amount(item.quantity)));
        cell.addEventListener("click", (function (entry, index) {
          return function () {
            showPreview(entry, "x" + amount(entry.quantity) + " · pouch slot " + (index + 1));
          };
        })(item, i));
      }
      grid.appendChild(cell);
    }
  }

  function renderHouse(house) {
    var list = document.getElementById("storage-house");
    clear(list);
    var rows = house
      ? [["House state", house.state === null || house.state === undefined ? "not set" : String(house.state)],
         ["Gallery record", house.galleryBytes ? house.galleryBytes + " bytes stored" : "none"],
         ["Bookshelf", house.bookshelfBytes ? house.bookshelfBytes + " bytes stored" : "none"],
         ["Tore record", house.toreBytes ? house.toreBytes + " bytes stored" : "none"],
         ["Garden", house.gardenBytes ? house.gardenBytes + " bytes stored" : "none"]]
      : [["House", "no house data"]];
    rows.forEach(function (row) {
      list.appendChild(el("dt", null, row[0]));
      list.appendChild(el("dd", null, row[1]));
    });
  }

  function renderStorage(data) {
    box.items = data.itemBox || [];
    box.bySlot = {};
    box.items.forEach(function (item) {
      if (item.slot !== null && item.slot !== undefined) box.bySlot[item.slot] = item;
    });
    box.page = 0;
    box.selected = null;
    box.query = "";
    var search = document.getElementById("storage-search");
    if (search) search.value = "";

    document.getElementById("storage-note").textContent = data.name || "";
    wallet("stat-zenny", money(data.zenny));
    wallet("stat-gzenny", money(data.gzenny));
    wallet("stat-cp", money(data.cp));
    var stamps = data.stamps || {};
    wallet("stat-stamps", "HL " + amount(stamps.hlTotal) + " / EX " + amount(stamps.exTotal));
    document.getElementById("mbox-cap").textContent = box.items.length + " / " + (BOX_PAGES * BOX_SIZE);

    document.getElementById("preview-name").textContent = "No item selected";
    document.getElementById("preview-meta").textContent = "Click a slot to inspect it";
    clear(document.getElementById("preview-icon"));

    renderTabs();
    renderGrid();
    renderPouch(data.pouch || []);
    renderHouse(data.house);

    var warehouse = document.getElementById("storage-warehouse");
    clear(warehouse);
    if (data.warehouse && data.warehouse.length) {
      data.warehouse.forEach(function (item) {
        warehouse.appendChild(el("span", "badge", item.name + " x" + item.quantity));
      });
    } else {
      warehouse.appendChild(el("span", "muted", "Empty"));
    }

    document.getElementById("storage-box-note").textContent = box.items.length + " items";
  }

  function loadStorage(characterId) {
    if (!characterId) return;
    document.getElementById("storage-note").textContent = "loading";
    request("/api/account/characters/" + encodeURIComponent(characterId) + "/storage")
      .then(renderStorage)
      .catch(function (error) {
        if (error.message === "unauthenticated") return;
        showError("Could not read that character's storage.");
      });
  }

  function renderHunts(data) {
    stat("stat-kills", "Hunts logged", money(data.totalKills));
    stat("stat-species", "Species hunted", String((data.monsters || []).length));

    var body = document.getElementById("hunts-monsters");
    clear(body);
    if (!data.monsters || !data.monsters.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No hunts recorded for this character.");
      cell.colSpan = 2;
      empty.appendChild(cell);
      body.appendChild(empty);
    } else {
      data.monsters.forEach(function (monster) {
        var row = el("tr");
        row.appendChild(el("td", null, monster.name));
        row.appendChild(el("td", "num", amount(monster.kills)));
        body.appendChild(row);
      });
    }

    var recent = document.getElementById("hunts-recent");
    clear(recent);
    if (!data.recent || !data.recent.length) {
      recent.appendChild(el("li", "empty-state", "Nothing logged yet."));
    } else {
      data.recent.forEach(function (kill) {
        var item = el("li");
        item.appendChild(el("span", "activity-text", kill.monster + (kill.quantity > 1 ? " x" + kill.quantity : "")));
        item.appendChild(el("time", "activity-when", formatDate(kill.at)));
        recent.appendChild(item);
      });
    }

    document.getElementById("hunts-note").textContent = data.totalKills ? "from the server kill log" : "";
  }

  function loadHunts(characterId) {
    if (!characterId) return;
    request("/api/account/characters/" + encodeURIComponent(characterId) + "/hunts")
      .then(renderHunts)
      .catch(function (error) {
        if (error.message === "unauthenticated") return;
        showError("Could not read that character's hunt log.");
      });
  }

  function wireCharacters(characters) {
    ["storage-character", "hunts-character"].forEach(function (id) {
      var select = document.getElementById(id);
      if (!select) return;
      clear(select);
      characters.forEach(function (character) {
        var option = document.createElement("option");
        option.value = character.id;
        option.textContent = character.name + (character.hr ? " · HR " + character.hr : "");
        select.appendChild(option);
      });
    });

    var storageSelect = document.getElementById("storage-character");
    var huntsSelect = document.getElementById("hunts-character");
    if (storageSelect) storageSelect.addEventListener("change", function () { loadStorage(storageSelect.value); });
    if (huntsSelect) huntsSelect.addEventListener("change", function () { loadHunts(huntsSelect.value); });

    if (characters.length) {
      loadStorage(characters[0].id);
      loadHunts(characters[0].id);
    } else {
      document.getElementById("storage-note").textContent = "no characters";
      wallet("stat-zenny", "-");
      wallet("stat-gzenny", "-");
      wallet("stat-cp", "-");
      wallet("stat-stamps", "-");
    }

    var storageSearch = document.getElementById("storage-search");
    if (storageSearch) {
      var timer = null;
      storageSearch.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          searchBox(storageSearch.value.trim().toLowerCase());
        }, 180);
      });
    }
  }

  /* ---------- boot ---------- */

  function signOut() {
    clearToken();
    window.location.replace("/");
  }

  function load() {
    if (!sessionValid()) {
      clearToken();
      window.location.replace("/");
      return;
    }

    wireTabs();
    activateTab(window.location.hash.replace("#", "") || "overview");

    document.getElementById("signout").addEventListener("click", signOut);
    var second = document.getElementById("signout-2");
    if (second) second.addEventListener("click", signOut);

    wireSearch("character-search", "character-results", function (term, resultsId) {
      filterRows("#characters-body", term, resultsId, "No characters match that search.");
    });
    wireSearch("guild-search", "guild-results", function (term, resultsId) {
      filterRows("#guilds", term, resultsId, "No members match that search.");
    });

    Promise.all([
      request("/api/account"),
      request("/api/account/characters"),
      request("/api/account/guilds"),
      request("/api/account/discord")
    ]).then(function (results) {
      state.account = results[0];
      state.characters = results[1];
      state.guilds = results[2];
      state.discord = results[3];

      renderAccount(state.account);
      renderDiscord(state.discord);
      renderCharacters(state.characters);
      renderGuilds(state.guilds);
      renderActivity(state.characters, state.guilds);
      wireCharacters(state.characters);
    }).catch(function (error) {
      if (error.message === "unauthenticated") return;
      showError("Could not load your account right now. Try again in a moment.");
    });
  }

  load();
})();
