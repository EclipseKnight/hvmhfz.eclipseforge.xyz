/* Guild management on the account page's Guild tab (API README "Guild management"; design 2026-11-15, first batch).
   For each guild card js/account.js draws, decorate() adds a "Manage" part when the API says the account may act
   (the same roles as in game):
   - "Recruiting" switch (canRecruit: leader, sub-leaders, manage right): PUT /api/account/guilds/{id}/recruiting;
   - "Guild comment" box (canEditComment: leader, sub-leaders): PUT .../comment, with a Shift-JIS byte count
     (the API checks the real limit: 96 bytes, no line breaks, only characters the game can show);
   - "Applications" (canRecruit): each applicant with HR, GR, weapon, last login and when they applied, Accept and Deny
     (POST .../applications/{charId}/accept or /deny; the API checks the member limit and sends the game's mail);
   - "Deny older than N days" (canClearStale: leader): POST .../applications/clear-stale {days}.
   After a change the tab reloads (window.HvAccountGuilds.reload) and the API's message shows on that guild's card.
   The "My applications" panel lists the account's own pending applications (GET /api/account/guild-applications)
   with Withdraw (DELETE /api/account/guild-applications/{guildId}/{charId}); it is hidden when there are none. */
(function () {
  "use strict";

  var flash = {};   // guild id -> {text, error}: the last action's message, shown after the reload

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function dateText(value) {
    if (!value) return "-";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "-";
    if (window.HvTime) return HvTime.node(value);
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
  }

  function cell(value) {
    var td = el("td");
    if (value && value.nodeType) td.appendChild(value); else td.textContent = value === null || value === undefined ? "-" : value;
    return td;
  }

  function num(value) {
    return value === null || value === undefined ? "-" : String(value);
  }

  // Bytes in Shift-JIS as the game counts them: ASCII and half-width katakana 1, the rest 2.
  function sjisBytes(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.codePointAt(i);
      if (c > 0xffff) i++;
      n += c < 0x80 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;
    }
    return n;
  }

  var COMMENT_BYTES = 96;

  function api() {
    return window.HvAccountGuilds;
  }

  function send(guildId, path, method, body) {
    var a = api();
    if (!a) return Promise.reject(new Error("not ready"));
    return a.request(path, {
      method: method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (data) {
      flash[guildId] = { text: (data && data.message) || "Saved.", error: false };
    }, function (error) {
      if (error.message === "unauthenticated") throw error;
      flash[guildId] = { text: error.serverMessage || "That did not work. Try again in a moment.", error: true };
    }).then(function () {
      loadOwnApplications();
      return a.reload();
    });
  }

  function busy(root, on) {
    root.querySelectorAll("button, input, select").forEach(function (node) { node.disabled = on; });
  }

  /* ---------- a guild card's Manage part ---------- */

  function decorate(card, guild, before) {
    if (!guild.canRecruit && !guild.canEditComment) return;
    var box = el("section", "guild-manage");
    box.appendChild(el("h4", null, "Manage"));
    box.appendChild(el("p", "note-text", "Changes apply at once. Hunters in game see them after they reopen the guild " +
      "menu; applicants get the game's mail and see it the next time they open their mailbox."));

    var status = el("p", "guild-manage-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var pending = flash[guild.id];
    if (pending) {
      status.textContent = pending.text;
      if (pending.error) status.classList.add("is-error");
      delete flash[guild.id];
    }
    box.appendChild(status);

    if (guild.canRecruit) box.appendChild(recruitingRow(guild, box));
    if (guild.canEditComment) box.appendChild(commentRow(guild, box));
    if (guild.canRecruit) box.appendChild(applications(guild, box));

    card.insertBefore(box, before && before.parentNode === card ? before : null);
  }

  function recruitingRow(guild, box) {
    var row = el("div", "guild-manage-row");
    var label = el("label", "guild-switch");
    var input = el("input");
    input.type = "checkbox";
    input.checked = !!guild.recruiting;
    label.appendChild(input);
    label.appendChild(el("span", null, "Recruiting (hunters can apply in game)"));
    input.addEventListener("change", function () {
      busy(box, true);
      send(guild.id, "/api/account/guilds/" + guild.id + "/recruiting", "PUT", { recruiting: input.checked })
        .catch(function () { busy(box, false); });
    });
    row.appendChild(label);
    return row;
  }

  function commentRow(guild, box) {
    var row = el("div", "guild-manage-row guild-comment-edit");
    var id = "guild-comment-" + guild.id;
    var label = el("label", "search-label", "Guild comment");
    label.htmlFor = id;
    var input = el("input");
    input.type = "text";
    input.id = id;
    input.value = guild.comment || "";
    input.autocomplete = "off";
    var count = el("span", "toolbar-note");
    var save = el("button", "btn btn-secondary btn-small", "Save comment");
    save.type = "button";
    function update() {
      var bytes = sjisBytes(input.value);
      count.textContent = bytes + " / " + COMMENT_BYTES + " bytes";
      count.classList.toggle("is-error", bytes > COMMENT_BYTES);
      save.disabled = bytes > COMMENT_BYTES || input.value === (guild.comment || "");
    }
    input.addEventListener("input", update);
    save.addEventListener("click", function () {
      busy(box, true);
      send(guild.id, "/api/account/guilds/" + guild.id + "/comment", "PUT", { comment: input.value })
        .catch(function () { busy(box, false); });
    });
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(count);
    row.appendChild(save);
    update();
    return row;
  }

  function applications(guild, box) {
    var part = el("div", "guild-apps");
    var list = guild.applications || [];
    var head = el("div", "guild-apps-head");
    head.appendChild(el("h4", null, "Applications" + (list.length ? " (" + list.length + ")" : "")));
    var members = (guild.members || []).length;
    if (guild.memberLimit) {
      head.appendChild(el("span", "toolbar-note", members + " of " + guild.memberLimit + " members at this guild's rank"));
    }
    part.appendChild(head);

    if (!list.length) {
      part.appendChild(el("p", "note-text", "No pending applications."));
      return part;
    }

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table");
    var thead = el("thead");
    var hr = el("tr");
    ["Hunter", "HR", "GR", "Weapon", "Last login", "Applied", ""].forEach(function (text) { hr.appendChild(el("th", null, text)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var body = el("tbody");
    var full = guild.memberLimit && members >= guild.memberLimit;
    list.forEach(function (app) {
      var row = el("tr");
      var name = el("td");
      if (app.online) {
        var dot = el("span", "online-dot");
        dot.title = "Online now";
        dot.appendChild(el("span", "visually-hidden", "Online now"));
        name.appendChild(dot);
      }
      var link = el("a", null, app.name || "Unknown");
      link.href = "/hunters.html?id=" + app.characterId;
      name.appendChild(link);
      row.appendChild(name);
      row.appendChild(cell(num(app.hr)));
      row.appendChild(cell(num(app.gr)));
      row.appendChild(cell(app.weapon || "-"));
      row.appendChild(cell(app.online ? "Online now" : dateText(app.lastLogin)));
      row.appendChild(cell(dateText(app.appliedAt)));

      var actions = el("td", "guild-app-actions");
      var accept = el("button", "btn btn-primary btn-small", "Accept");
      accept.type = "button";
      var deny = el("button", "btn btn-secondary btn-small", "Deny");
      deny.type = "button";
      if (app.inGuild) {
        accept.disabled = true;
        actions.appendChild(el("span", "toolbar-note", "In another guild"));
      } else if (full) {
        accept.disabled = true;
        accept.title = "The guild is full";
      }
      accept.addEventListener("click", function () {
        if (!window.confirm("Accept " + app.name + " into " + guild.name + "? They get the game's \"Accepted!\" mail.")) return;
        busy(box, true);
        send(guild.id, "/api/account/guilds/" + guild.id + "/applications/" + app.characterId + "/accept", "POST")
          .catch(function () { busy(box, false); });
      });
      deny.addEventListener("click", function () {
        if (!window.confirm("Deny " + app.name + "'s application? They get the game's \"Rejected\" mail.")) return;
        busy(box, true);
        send(guild.id, "/api/account/guilds/" + guild.id + "/applications/" + app.characterId + "/deny", "POST")
          .catch(function () { busy(box, false); });
      });
      actions.appendChild(accept);
      actions.appendChild(deny);
      row.appendChild(actions);
      body.appendChild(row);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    part.appendChild(wrap);
    if (full) part.appendChild(el("p", "note-text", "The guild is full: raise its rank or make room before accepting."));

    if (guild.canClearStale) part.appendChild(clearStale(guild, box));
    return part;
  }

  function clearStale(guild, box) {
    var row = el("div", "guild-manage-row");
    var id = "guild-stale-" + guild.id;
    var label = el("label", "search-label", "Deny applications older than");
    label.htmlFor = id;
    var select = el("select");
    select.id = id;
    [14, 30, 60, 90].forEach(function (days) {
      var option = el("option", null, days + " days");
      option.value = String(days);
      select.appendChild(option);
    });
    var go = el("button", "btn btn-secondary btn-small", "Deny old applications");
    go.type = "button";
    go.addEventListener("click", function () {
      var days = Number(select.value);
      if (!window.confirm("Deny every application to " + guild.name + " older than " + days +
        " days? Each applicant gets the game's \"Rejected\" mail.")) return;
      busy(box, true);
      send(guild.id, "/api/account/guilds/" + guild.id + "/applications/clear-stale", "POST", { days: days })
        .catch(function () { busy(box, false); });
    });
    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(go);
    return row;
  }

  /* ---------- My applications ---------- */

  function renderOwn(list) {
    var panel = document.getElementById("guild-apps-panel");
    var body = document.getElementById("guild-apps");
    if (!panel || !body) return;
    clear(body);
    panel.hidden = !list.length;
    if (!list.length) return;
    var ul = el("ul", "guild-own-apps");
    list.forEach(function (app) {
      var li = el("li");
      var text = el("span");
      text.appendChild(document.createTextNode((app.characterName || "Your hunter") + " applied to "));
      var link = el("a", null, app.guildName || "a guild");
      link.href = "/guilds.html?id=" + app.guildId;
      text.appendChild(link);
      text.appendChild(document.createTextNode(" · "));
      var at = dateText(app.appliedAt);
      if (at && at.nodeType) text.appendChild(at); else text.appendChild(document.createTextNode(at));
      if (!app.recruiting) text.appendChild(el("span", "badge", "Not recruiting now"));
      li.appendChild(text);
      var withdraw = el("button", "btn btn-secondary btn-small", "Withdraw");
      withdraw.type = "button";
      withdraw.addEventListener("click", function () {
        if (!window.confirm("Withdraw " + app.characterName + "'s application to " + app.guildName + "?")) return;
        withdraw.disabled = true;
        var a = api();
        a.request("/api/account/guild-applications/" + app.guildId + "/" + app.characterId, { method: "DELETE" })
          .then(function (data) { status((data && data.message) || "Withdrawn.", false); },
            function (error) {
              if (error.message === "unauthenticated") return;
              status(error.serverMessage || "That did not work. Try again in a moment.", true);
            })
          .then(loadOwnApplications);
      });
      li.appendChild(withdraw);
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

  function status(text, error) {
    var node = document.getElementById("guild-apps-status");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-error", !!error);
  }

  function loadOwnApplications() {
    var a = api();
    if (!a || !document.getElementById("guild-apps")) return;
    a.request("/api/account/guild-applications").then(renderOwn, function () {
      // an older API without the list: the panel stays hidden
    });
  }

  window.HvGuildManage = { decorate: decorate, sjisBytes: sjisBytes };

  document.addEventListener("DOMContentLoaded", loadOwnApplications);
})();
