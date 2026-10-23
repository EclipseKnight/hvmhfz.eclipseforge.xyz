/* Hunsterverse account page. Reads the JWT saved at login and renders account, characters and guild. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function tokenExpiry(value) {
    try {
      var payload = value.split(".")[1];
      var json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
      var claims = JSON.parse(json);
      return claims.exp ? claims.exp * 1000 : 0;
    } catch (error) {
      return 0;
    }
  }

  function sessionValid() {
    var value = token();
    if (!value) return false;
    var expiry = tokenExpiry(value);
    return expiry > Date.now() + 30000;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    if (!value) return "Never";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function relative(value) {
    if (!value) return "";
    var diff = Date.now() - new Date(value).getTime();
    var minutes = Math.round(diff / 60000);
    if (minutes < 60) return minutes <= 1 ? "just now" : minutes + " minutes ago";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hours / 24);
    return days + " days ago";
  }

  function request(path) {
    return fetch(API + path, {
      headers: { Authorization: "Bearer " + token() },
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

  function showError(message) {
    var node = document.getElementById("account-error");
    node.textContent = message;
    node.hidden = false;
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function renderAccount(account) {
    document.getElementById("account-name").textContent = account.username;
    var sub = "Hunsterverse hunter account";
    if (account.lastLogin) sub += " · last login " + relative(account.lastLogin);
    document.getElementById("account-sub").textContent = sub;

    var discord = document.getElementById("stat-discord");
    discord.classList.remove("skeleton");
    discord.querySelector(".stat-label").textContent = "Discord";
    discord.querySelector(".stat-value").textContent = account.discordLinked ? "Linked" : "Not linked";
    discord.classList.add(account.discordLinked ? "good" : "muted");

    var characters = document.getElementById("stat-characters");
    characters.classList.remove("skeleton");
    characters.querySelector(".stat-value").textContent = String(account.characters);

    var lastLogin = document.getElementById("stat-lastlogin");
    lastLogin.classList.remove("skeleton");
    lastLogin.querySelector(".stat-value").textContent = formatDate(account.lastLogin);

    var roles = document.getElementById("stat-roles");
    roles.classList.remove("skeleton");
    roles.querySelector(".stat-value").textContent = (account.roles && account.roles.length)
      ? account.roles.map(function (role) { return role.replace(/^ROLE_/, ""); }).join(", ")
      : "None";

    setText("characters-note", account.characters === 1 ? "1 hunter" : account.characters + " hunters");
  }

  function renderCharacters(list) {
    var container = document.getElementById("characters");
    container.textContent = "";

    if (!Array.isArray(list) || list.length === 0) {
      container.appendChild(el("p", "empty-state", "No characters on this account yet. Create one in game, then come back."));
      return;
    }

    list.forEach(function (character) {
      var card = el("article", "character-card");

      var head = el("div", "character-head");
      head.appendChild(el("h3", null, character.name || "Unnamed hunter"));
      if (character.guildRank) head.appendChild(el("span", "badge", character.guildRank));
      card.appendChild(head);

      var ranks = el("div", "rank-row");
      ranks.appendChild(el("span", "rank-pill", "HR " + (character.hr === null ? "-" : character.hr)));
      ranks.appendChild(el("span", "rank-pill", "GR " + (character.gr === null ? "-" : character.gr)));
      card.appendChild(ranks);

      var meta = el("dl", "meta-list");
      function metaRow(label, value) {
        meta.appendChild(el("dt", null, label));
        meta.appendChild(el("dd", null, value));
      }
      metaRow("Weapon", character.weaponType || "Unknown");
      metaRow("Sex", character.female ? "Female" : "Male");
      metaRow("Last login", formatDate(character.lastLogin));
      metaRow("Guild", character.guildName || "None");
      card.appendChild(meta);

      container.appendChild(card);
    });
  }

  function renderGuilds(list) {
    var container = document.getElementById("guilds");
    container.textContent = "";

    if (!Array.isArray(list) || list.length === 0) {
      setText("guild-note", "none");
      container.appendChild(el("p", "empty-state", "No guild yet. Your characters are not in a guild."));
      return;
    }

    setText("guild-note", list.length === 1 ? "1 guild" : list.length + " guilds");

    list.forEach(function (guild) {
      var card = el("article", "guild-card");

      var head = el("div", "guild-head");
      head.appendChild(el("h3", null, guild.name || "Unnamed guild"));
      if (guild.recruiting) head.appendChild(el("span", "badge good", "Recruiting"));
      card.appendChild(head);

      if (guild.comment) card.appendChild(el("p", "guild-comment", guild.comment));

      var facts = el("div", "guild-facts");
      facts.appendChild(el("span", null, "Rank RP " + guild.rankRp));
      facts.appendChild(el("span", null, "Leader " + (guild.leaderName || "unknown")));
      facts.appendChild(el("span", null, (guild.members ? guild.members.length : 0) + " members"));
      card.appendChild(facts);

      var table = el("table", "member-table");
      var thead = el("thead");
      var headRow = el("tr");
      ["Hunter", "Rank", "Joined", "RP today", "Last login"].forEach(function (label) {
        headRow.appendChild(el("th", null, label));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      var tbody = el("tbody");
      (guild.members || []).forEach(function (member) {
        var row = el("tr");
        row.appendChild(el("td", null, member.name || "Unknown"));
        row.appendChild(el("td", null, member.rank || "Member"));
        row.appendChild(el("td", null, formatDate(member.joinedAt)));
        row.appendChild(el("td", null, String(member.rpToday === null ? 0 : member.rpToday)));
        row.appendChild(el("td", null, formatDate(member.lastLogin)));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      card.appendChild(table);

      container.appendChild(card);
    });
  }

  function renderActivity(characters, guilds) {
    var list = document.getElementById("activity");
    list.textContent = "";

    var events = [];
    (characters || []).forEach(function (character) {
      if (character.lastLogin) {
        events.push({ when: character.lastLogin, text: (character.name || "A hunter") + " last logged in" });
      }
    });
    (guilds || []).forEach(function (guild) {
      (guild.members || []).forEach(function (member) {
        if (member.joinedAt) {
          events.push({ when: member.joinedAt, text: (member.name || "A hunter") + " joined " + (guild.name || "the guild") });
        }
      });
    });

    events.sort(function (a, b) { return new Date(b.when) - new Date(a.when); });

    if (events.length === 0) {
      list.appendChild(el("li", "empty-state", "Nothing recorded yet."));
      return;
    }

    events.slice(0, 8).forEach(function (event) {
      var item = el("li");
      item.appendChild(el("span", "activity-text", event.text));
      item.appendChild(el("time", "activity-when", formatDate(event.when)));
      list.appendChild(item);
    });
  }

  function start() {
    if (!sessionValid()) {
      clearToken();
      window.location.replace("/");
      return;
    }

    document.getElementById("signout").addEventListener("click", function () {
      clearToken();
      window.location.replace("/");
    });

    Promise.all([request("/api/account"), request("/api/account/characters"), request("/api/account/guilds")])
      .then(function (results) {
        renderAccount(results[0]);
        renderCharacters(results[1]);
        renderGuilds(results[2]);
        renderActivity(results[1], results[2]);
      })
      .catch(function (error) {
        if (error.message === "unauthenticated") return;
        showError("Could not load your account right now. Try again in a moment.");
      });
  }

  start();
})();
