/* Hunsterverse account portal: tabs, search, characters, guild and Discord linking. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  /* The Storage and Details tabs became the character view on the Characters tab (9 Nov 2026); old links
     to them land there (alias in account.html; js/account-details.js opens the matching section). */

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
        window.HvNext.toSignin(); // back here after sign-in (js/signin-next.js)
        throw new Error("unauthenticated");
      }
      if (!response.ok) {
        // the API's own message (when it sends one) is kept for blocks that show it, e.g. the Road rewards
        return response.json().catch(function () { return null; }).then(function (data) {
          var error = new Error("HTTP " + response.status);
          error.status = response.status;
          error.serverMessage = data && data.message;
          throw error;
        });
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
    if (window.HvTime) return HvTime.text(date);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  // A date as a <time> (viewer zone, UTC on hover) for a table cell or value; plain text when it is
  // missing or invalid, or when js/time.js is not loaded. cls: optional class name.
  function whenNode(value, cls) {
    if (!window.HvTime || !value || isNaN(new Date(value).getTime())) return el("time", cls, formatDate(value));
    var node = HvTime.node(value);
    if (cls) node.className = cls;
    return node;
  }

  // A cell/value element whose content is text or a node.
  function cellOf(tag, cls, value) {
    var node = el(tag, cls);
    if (value && value.nodeType) node.appendChild(value); else if (value !== undefined && value !== null) node.textContent = value;
    return node;
  }

  function when(value) {
    return window.HvTime && value && !isNaN(new Date(value).getTime()) ? HvTime.node(value) : formatDate(value);
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

  // Stored HR as the game shows it: "HR100 (HR4)" (js/hr.js); the plain number when hr.js is missing.
  function hrText(value) {
    return window.HvHr && HvHr.label(value) || number(value);
  }

  function showError(message) {
    var node = document.getElementById("account-error");
    node.textContent = message;
    node.hidden = false;
  }

  /* ---------- tabs ----------
     js/subtabs.js runs the tab bar (deep links, Back/Forward, keyboard, the old #storage/#details/#qol/#patch/#diag
     links: data-subtabs-aliases in account.html). */

  /* ---------- rendering ---------- */

  function stat(id, label, value, tone) {
    var card = document.getElementById(id);
    if (!card) return;
    card.classList.remove("skeleton");
    card.className = "stat-card" + (tone ? " " + tone : "");
    card.querySelector(".stat-label").textContent = label;
    var out = card.querySelector(".stat-value");
    if (value && value.nodeType) { clear(out); out.appendChild(value); } else out.textContent = value;
  }

  function renderAccount(account) {
    document.getElementById("account-name").textContent = account.username;
    var sub = "Hunsterverse hunter account";
    if (account.lastLogin) sub += " · last login " + relative(account.lastLogin);
    document.getElementById("account-sub").textContent = sub;

    stat("stat-discord", "Discord", account.discordLinked ? "Linked" : "Not linked", account.discordLinked ? "good" : "muted");
    stat("stat-characters", "Characters", String(account.characters));
    stat("stat-lastlogin", "Last login", when(account.lastLogin));
    stat("stat-roles", "Roles", (account.roles || []).map(function (role) {
      return role.replace(/^ROLE_/, "");
    }).join(", ") || "None");

    document.getElementById("count-characters").textContent = account.characters ? "(" + account.characters + ")" : "";

    // Admins get a link to the admin panel (the API checks the role again on every admin request).
    if ((account.roles || []).indexOf("ROLE_ADMIN") >= 0 && !document.getElementById("admin-link")) {
      var link = el("a", "ghost-btn", "Admin panel");
      link.id = "admin-link";
      link.href = "/admin.html";
      var signout = document.getElementById("signout");
      signout.parentNode.insertBefore(link, signout);
    }

    var details = document.getElementById("account-details");
    clear(details);
    [["Username", account.username],
     ["Discord", account.discordLinked ? "Linked" : "Not linked"],
     ["Roles", (account.roles || []).map(function (r) { return r.replace(/^ROLE_/, ""); }).join(", ") || "None"],
     ["Last login", when(account.lastLogin)],
     ["Characters", String(account.characters)]
    ].forEach(function (row) {
      details.appendChild(el("dt", null, row[0]));
      details.appendChild(cellOf("dd", null, row[1]));
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
    body.appendChild(el("p", "discord-state", "In the Hunsterverse Discord, type /link and paste the code into the code box (or enter this command) to link your account:"));

    var box = el("div", "command-box");
    box.appendChild(el("code", "command", window.HvLinkCommand.command(discord)));
    var copy = el("button", "ghost-btn small", "Copy code");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var value = window.HvLinkCommand.code(discord);
      function done() {
        copy.textContent = "Copied";
        setTimeout(function () { copy.textContent = "Copy code"; }, 1800);
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

    // The name opens the public hunter card (the page the leaderboards and Worlds link to); "View" opens
    // this character in the character view below the list (js/account-details.js).
    var nameCell = el("td", "cell-name");
    var card = el("a", null, character.name || "Unnamed");
    card.href = "/hunters.html?id=" + encodeURIComponent(character.id);
    card.title = "Hunter card";
    nameCell.appendChild(card);
    if (character.guildRank) nameCell.appendChild(el("span", "badge", character.guildRank));
    var details = el("a", "char-details-link", "View");
    details.href = "#characters";
    details.setAttribute("data-details-id", String(character.id));
    nameCell.appendChild(details);
    row.appendChild(nameCell);

    [hrText(character.hr), number(character.gr), character.weaponType || "Unknown",
     character.female ? "Female" : "Male", number(character.gcp), number(character.kouryouPoints),
     number(character.dailyQuests), character.guildName || "-", when(character.lastLogin)]
      .forEach(function (value, i) {
        var cell = cellOf("td", null, value);
        if (i === 0) cell.dataset.sort = String(character.hr || 0); // the header sorts by the stored number
        row.appendChild(cell);
      });

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
       ["Created", when(guild.createdAt)],
       ["Room expires", guild.roomExpiry ? when(guild.roomExpiry) : "none"]
      ].forEach(function (row) {
        var item = el("div", "guild-stat");
        item.appendChild(el("dt", null, row[0]));
        item.appendChild(cellOf("dd", null, row[1]));
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
         when(member.joinedAt), number(member.rpToday), number(member.rpYesterday),
         when(member.lastLogin)].forEach(function (value) {
          row.appendChild(cellOf("td", null, value));
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
      item.appendChild(whenNode(event.when, "activity-when"));
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


  /* ---------- hunts ---------- */
  /* (the item box, pouch and warehouse are in the character view, js/account-details.js) */

  function money(value) {
    return Number(value || 0).toLocaleString();
  }

  function amount(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
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
        var nameCell = el("td");
        nameCell.appendChild(MonsterLinks.anchor(monster));
        row.appendChild(nameCell);
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
        item.appendChild(whenNode(kill.at, "activity-when"));
        recent.appendChild(item);
      });
    }

    document.getElementById("hunts-note").textContent = data.totalKills ? "lifetime numbers are your in-game Monster List counts (slain and captured); recent kills come from the server kill log" : "";
  }

  function loadHunts(characterId) {
    var questBox = document.getElementById("hunts-quests");
    if (questBox) questBox.innerHTML = "";
    if (questBox && window.QuestLog) window.QuestLog.mount(questBox, characterId);
    if (!characterId) return;
    request("/api/account/characters/" + encodeURIComponent(characterId) + "/hunts")
      .then(renderHunts)
      .catch(function (error) {
        if (error.message === "unauthenticated") return;
        showError("Could not read that character's hunt log.");
      });
  }

  function wireCharacters(characters) {
    ["hunts-character"].forEach(function (id) {
      var select = document.getElementById(id);
      if (!select) return;
      clear(select);
      characters.forEach(function (character) {
        var option = document.createElement("option");
        option.value = character.id;
        option.textContent = character.name + (character.hr ? " · " + hrText(character.hr) : "");
        select.appendChild(option);
      });
    });

    var huntsSelect = document.getElementById("hunts-character");
    if (huntsSelect) huntsSelect.addEventListener("change", function () { loadHunts(huntsSelect.value); });

    if (characters.length) {
      loadHunts(characters[0].id);
    } else {
      renderHunts({ totalKills: 0, monsters: [], recent: [] }); // the hunt log's own "nothing recorded" rows
      document.getElementById("hunts-note").textContent = "no characters";
    }
  }

  /* ---------- Gifts ---------- */

  function giftQuantity(quantity) {
    return Number(quantity).toLocaleString();
  }

  function giftRow(item) {
    var row = el("li", "gift-row");
    var iconCell = el("span", "gift-icon");
    iconCell.appendChild(window.HvGameIcons.itemIcon(item)); // the neutral placeholder when it has none
    row.appendChild(iconCell);
    var label = item.name || item.itemTypeLabel;
    var text = giftQuantity(item.quantity) + " " + label;
    if (label !== item.itemTypeLabel) text += " (" + item.itemTypeLabel + ")";
    row.appendChild(el("span", "gift-label", text));
    return row;
  }

  function giftCard(gift) {
    var item = el("div", "guild-card");
    var head = el("p", "subhead", gift.eventName);
    if (gift.ended) head.appendChild(el("span", "tab-count", "ended"));
    item.appendChild(head);
    if (gift.description) {
      item.appendChild(el("p", "note-text", gift.description.replace(/~C\d+/g, "")));
    }
    var tags = ["Gift list: " + gift.listName,
      "up to " + gift.timesAcceptable + " take" + (gift.timesAcceptable === 1 ? "" : "s") + " each"];
    if (gift.targeted) tags.push("only for " + gift.targetedTo);
    item.appendChild(el("p", "note-text", tags.join(" · ")));
    if (gift.items.length) {
      var list = el("ul", "gift-list");
      gift.items.forEach(function (giftItem) { list.appendChild(giftRow(giftItem)); });
      item.appendChild(list);
    }
    gift.acceptedBy.forEach(function (accept) {
      item.appendChild(el("p", "note-text", accept.characterName + ": accepted " +
        accept.timesAccepted + " of " + gift.timesAcceptable));
    });
    if (!gift.ended && !gift.acceptedBy.length && !gift.targeted) {
      item.appendChild(el("p", "note-text", "None of your characters has picked this one up."));
    }
    return item;
  }

  function renderGifts(list) {
    var body = document.getElementById("gifts-body");
    clear(body);
    var open = list.filter(function (gift) { return !gift.ended; });
    document.getElementById("gifts-note").textContent =
      !list.length ? "none" : open.length + " open" + (list.length > open.length ? ", " + (list.length - open.length) + " ended" : "");
    if (!list.length) {
      body.appendChild(el("p", "note-text", "No gifts on the server right now."));
      return;
    }
    var ended = list.filter(function (gift) { return gift.ended; });
    open.forEach(function (gift) { body.appendChild(giftCard(gift)); });
    if (!open.length) {
      body.appendChild(el("p", "note-text", "No open gifts right now."));
    }
    if (ended.length) {
      var box = el("details", "ended-group");
      box.appendChild(el("summary", null, "Ended gifts (" + ended.length + ")"));
      ended.forEach(function (gift) { box.appendChild(giftCard(gift)); });
      body.appendChild(box);
    }
  }

  function loadGifts() {
    return request("/api/account/distributions").then(function (data) {
      renderGifts(data.gifts || []);
    }).catch(function (error) {
      if (error.message === "unauthenticated") return;
      document.getElementById("gifts-note").textContent = error.message === "unauthenticated" ? "unavailable" : "unavailable (" + (error.serverMessage || error.message) + ")";
      clear(document.getElementById("gifts-body"));
      document.getElementById("gifts-body").appendChild(el("p", "note-text", "The gift lists could not be loaded right now."));
    });
  }

  /* ---------- Hunting Road rewards ---------- */

  function roadRewardAlert(text, ok) {
    var alertNode = document.getElementById("road-rewards-alert");
    var okNode = document.getElementById("road-rewards-ok");
    alertNode.textContent = ok ? "" : text || "";
    alertNode.hidden = ok || !text;
    okNode.textContent = ok ? text : "";
    okNode.hidden = !ok;
  }

  function rewardCard(reward) {
    var item = el("div", "guild-card");
    item.appendChild(el("p", "subhead", RoadRewards.title(reward)));
    var details = RoadRewards.details(reward);
    if (details) item.appendChild(el("p", null, details));
    var claimed = reward.claimed;
    if (claimed) {
      item.appendChild(el("p", "note-text", "Claimed by " + (claimed.characterName || "a character") + " on " +
        formatDate(claimed.claimedAt) + ". Look in the gift list in the game."));
      return item;
    }
    if (!reward.claimable) {
      item.appendChild(el("p", "note-text", reward.reason || "You can't claim this reward."));
      return item;
    }
    var row = el("div", "road-claim");
    var select = el("select");
    select.setAttribute("aria-label", "Character that gets the reward: " + RoadRewards.title(reward));
    state.characters.forEach(function (character) {
      var option = document.createElement("option");
      option.value = character.id;
      option.textContent = character.name;
      select.appendChild(option);
    });
    var button = el("button", "btn btn-primary btn-small", "Claim");
    button.type = "button";
    button.disabled = !state.characters.length;
    button.addEventListener("click", function () {
      button.disabled = true;
      roadRewardAlert("");
      request("/api/road/rewards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(RoadRewards.claimBody(reward, select.value))
      }).then(function () {
        roadRewardAlert("Claimed. It is in the gift list of that character in the game.", true);
        return loadRoadRewards();
      }).catch(function (error) {
        if (error.message === "unauthenticated") return;
        roadRewardAlert(error.serverMessage || "The reward could not be claimed. Try again in a moment.");
        button.disabled = false;
      });
    });
    row.appendChild(select);
    row.appendChild(button);
    item.appendChild(row);
    return item;
  }

  function renderRoadRewards(list) {
    var body = document.getElementById("road-rewards-body");
    clear(body);
    var open = list.filter(function (reward) { return !reward.claimed; });
    document.getElementById("road-rewards-note").textContent =
      !list.length ? "none yet" : open.filter(function (r) { return r.claimable; }).length + " to claim";
    if (!list.length) {
      body.appendChild(el("p", "note-text", "No Hunting Road rewards yet."));
      return;
    }
    // to claim first, then the ones already claimed
    open.concat(list.filter(function (reward) { return reward.claimed; })).forEach(function (reward) {
      body.appendChild(rewardCard(reward));
    });
  }

  function loadRoadRewards() {
    return request("/api/road/rewards").then(renderRoadRewards).catch(function (error) {
      if (error.message === "unauthenticated") return;
      // the Road is optional: a server without it just hides the block's content
      document.getElementById("road-rewards-note").textContent = "unavailable";
      clear(document.getElementById("road-rewards-body"));
      document.getElementById("road-rewards-body").appendChild(el("p", "note-text", "The rewards could not be loaded right now."));
    });
  }

  /* ---------- boot ---------- */

  function signOut() {
    clearToken();
    window.location.replace("/");
  }

  function load() {
    if (!sessionValid()) {
      clearToken();
      window.HvNext.toSignin();
      return;
    }

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
      loadRoadRewards();
      loadGifts();

    }).catch(function (error) {
      if (error.message === "unauthenticated") return;
      showError("Could not load your account right now. Try again in a moment.");
    });
  }

  load();
})();
