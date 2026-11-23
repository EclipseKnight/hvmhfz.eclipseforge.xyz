/* Admin: the Streamers tab. Two parts, API /api/admin/streamers/** (tool key "streamers": "view" reads, "act"
   changes):
   - Allowed games: the games whose live streams are listed first and highlighted in the Discord #live-now post and
     the only ones that get went-live posts and follower DMs. Add, edit (inline form, other names and title keywords
     one per line), enable/disable, delete (confirm).
   - Content creators: counts and a status filter (Pending, Approved, Declined, All); Approve, Decline, Remove
     (confirm). The Discord bot syncs the Content Creator role within minutes.
   Who may do what comes from window.hvStaff (js/admin.js): with only "view" no buttons are drawn; without hvStaff
   (an older API) they show and the API's 403 decides. API messages are shown as they are. Everything users wrote is
   text (textContent), never innerHTML. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var STATUS_LABELS = { pending: "Pending", approved: "Approved", declined: "Declined", all: "All" };

  var state = { status: "pending", games: [], creators: [], editing: null };
  var started = false;
  var seq = 0;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function can(action) { return !window.hvStaff || window.hvStaff.can("streamers", action); }

  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "";
    if (window.HvTime) return HvTime.text(t) || "";
    return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, cache: "no-store",
                               body: o.body !== undefined ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var fallback = r.status === 401 ? "Sign in again: your session has ended." :
              r.status === 403 ? "You may not use this tool." : "HTTP " + r.status;
            throw Object.assign(new Error((data && data.message) || fallback), { status: r.status });
          }
          return data;
        });
      });
  }

  function say(id, text) {
    var box = $(id);
    box.textContent = text || "";
    box.hidden = !text;
  }

  function ok(text) { say("st-alert", ""); say("st-ok", text); }
  function fail(error) { say("st-ok", ""); say("st-alert", error.message); }

  function lines(text) {
    return String(text || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* --- allowed games --- */

  function gameCard(g) {
    var c = el("article", "as-card st-card" + (g.enabled ? "" : " is-off"));
    c.setAttribute("data-game", g.id);
    var body = el("div");
    body.appendChild(el("h3", null, g.name + (g.enabled ? "" : " (disabled)")));
    if (g.aliases && g.aliases.length) body.appendChild(el("p", "note-text", "Other names: " + g.aliases.join(", ")));
    if (g.titleKeywords && g.titleKeywords.length) body.appendChild(el("p", "note-text", "Title keywords: " + g.titleKeywords.join(", ")));
    body.appendChild(el("p", "note-text", "Twitch game id: " + (g.twitchGameId || "none") + " · Kick category id: " +
      (g.kickCategoryId || "none") + " · order " + (g.sortOrder || 0)));
    var by = g.updatedBy || g.updatedAt ? "Updated " + (g.updatedBy ? "by " + g.updatedBy + " " : "") + utc(g.updatedAt) : "";
    if (by) body.appendChild(el("p", "note-text", by));
    c.appendChild(body);
    if (can("act")) {
      var side = el("div", "st-buttons");
      var edit = el("button", "ghost-btn small", "Edit");
      edit.type = "button";
      edit.setAttribute("data-edit", g.id);
      edit.addEventListener("click", function () { openForm(g); });
      var tog = el("button", "ghost-btn small", g.enabled ? "Disable" : "Enable");
      tog.type = "button";
      tog.setAttribute("data-toggle", g.id);
      tog.addEventListener("click", function () { saveGame(g.id, bodyOf(g, { enabled: !g.enabled })); });
      var del = el("button", "ghost-btn small", "Delete");
      del.type = "button";
      del.setAttribute("data-delete", g.id);
      del.addEventListener("click", function () {
        if (!window.confirm("Delete " + g.name + " from the allowed games?")) return;
        request("/api/admin/streamers/games/" + g.id, { method: "DELETE" })
          .then(function (d) { ok((d && d.message) || "Deleted."); closeForm(); return loadGames(); }, fail);
      });
      side.appendChild(edit);
      side.appendChild(tog);
      side.appendChild(del);
      c.appendChild(side);
    }
    return c;
  }

  function bodyOf(g, over) {
    return Object.assign({ name: g.name, aliases: g.aliases || [], titleKeywords: g.titleKeywords || [],
      twitchGameId: g.twitchGameId || null, kickCategoryId: g.kickCategoryId || null, enabled: g.enabled,
      sortOrder: g.sortOrder || 0 }, over || {});
  }

  function saveGame(id, body) {
    return request("/api/admin/streamers/games" + (id ? "/" + id : ""), { method: id ? "PUT" : "POST", body: body })
      .then(function (g) { ok((g && g.name ? g.name : "Game") + " saved."); closeForm(); return loadGames(); }, fail);
  }

  function field(form, id, label, node) {
    var f = el("div", "field");
    var l = el("label", null, label);
    l.setAttribute("for", id);
    node.id = id;
    f.appendChild(l);
    f.appendChild(node);
    form.appendChild(f);
    return node;
  }

  function input(type, value, max) {
    var i = el("input");
    i.type = type;
    i.value = value === null || value === undefined ? "" : value;
    if (max) i.maxLength = max;
    return i;
  }

  function closeForm() {
    state.editing = null;
    var box = $("st-game-form");
    clear(box);
    box.hidden = true;
  }

  function openForm(g) {
    state.editing = g || null;
    var box = $("st-game-form");
    clear(box);
    var form = el("form", "st-form");
    form.appendChild(el("h4", null, g ? "Edit " + g.name : "Add a game"));
    var name = field(form, "st-f-name", "Name", input("text", g ? g.name : "", 100));
    var aliases = field(form, "st-f-aliases", "Other names (one per line)", el("textarea"));
    aliases.rows = 3;
    aliases.value = g ? (g.aliases || []).join("\n") : "";
    var keywords = field(form, "st-f-keywords", "Title keywords (one per line)", el("textarea"));
    keywords.rows = 3;
    keywords.value = g ? (g.titleKeywords || []).join("\n") : "";
    var twitch = field(form, "st-f-twitch", "Twitch game id", input("text", g && g.twitchGameId, 15));
    var kick = field(form, "st-f-kick", "Kick category id", input("text", g && g.kickCategoryId, 15));
    var order = field(form, "st-f-order", "Sort order", input("number", g ? g.sortOrder || 0 : 0));
    var wrap = el("label", "st-check");
    var enabled = input("checkbox");
    enabled.id = "st-f-enabled";
    enabled.checked = g ? !!g.enabled : true;
    wrap.appendChild(enabled);
    wrap.appendChild(document.createTextNode("Enabled"));
    form.appendChild(wrap);
    var row = el("div", "st-buttons");
    var save = el("button", "btn btn-primary btn-small", "Save");
    save.type = "submit";
    var cancel = el("button", "ghost-btn small", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeForm);
    row.appendChild(save);
    row.appendChild(cancel);
    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      saveGame(g ? g.id : null, {
        name: name.value.trim(), aliases: lines(aliases.value), titleKeywords: lines(keywords.value),
        twitchGameId: twitch.value.trim() || null, kickCategoryId: kick.value.trim() || null,
        enabled: enabled.checked, sortOrder: order.value === "" ? 0 : Number(order.value)
      });
    });
    box.appendChild(form);
    box.hidden = false;
    name.focus();
  }

  function loadGames() {
    return request("/api/admin/streamers/games").then(function (d) {
      state.games = (d && d.items) || [];
      $("st-games-missing").hidden = !(d && d.tableReady === false);
      var box = $("st-games");
      clear(box);
      if (d && d.tableReady !== false && !state.games.length) box.appendChild(el("p", "note-text", "No games listed yet."));
      state.games.forEach(function (g) { box.appendChild(gameCard(g)); });
      $("st-game-add").hidden = !can("act") || (d && d.tableReady === false);
      $("st-note").textContent = state.games.length + (state.games.length === 1 ? " game" : " games");
    }, fail);
  }

  /* --- content creators --- */

  function link(label, url, text) {
    var p = el("span");
    p.appendChild(document.createTextNode(label + ": "));
    var a = el("a", null, text);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    p.appendChild(a);
    return p;
  }

  function creatorLinks(c) {
    var list = el("p", "note-text st-links");
    var parts = [];
    if (c.twitch) parts.push(link("Twitch", "https://www.twitch.tv/" + encodeURIComponent(c.twitch), c.twitch));
    if (c.youtube) {
      var yt = c.youtube.charAt(0) === "@" ? "https://www.youtube.com/" + encodeURIComponent(c.youtube).replace("%40", "@")
        : "https://www.youtube.com/channel/" + encodeURIComponent(c.youtube);
      parts.push(link("YouTube", yt, c.youtube));
    }
    if (c.kick) parts.push(link("Kick", "https://kick.com/" + encodeURIComponent(c.kick), c.kick));
    if (c.tiktok) parts.push(link("TikTok", "https://www.tiktok.com/@" + encodeURIComponent(c.tiktok), c.tiktok));
    parts.forEach(function (p, i) {
      if (i) list.appendChild(document.createTextNode(" · "));
      list.appendChild(p);
    });
    return list;
  }

  function setStatus(c, status) {
    request("/api/admin/streamers/creators/" + c.id + "/status", { method: "POST", body: { status: status, by: null } })
      .then(function () { ok((c.displayName || c.discordId) + ": " + STATUS_LABELS[status].toLowerCase() + "."); return loadCreators(); }, fail);
  }

  function creatorCard(c) {
    var card = el("article", "as-card st-card is-" + c.status);
    card.setAttribute("data-creator", c.id);
    var body = el("div");
    body.appendChild(el("h3", null, c.displayName || "(no name)"));
    body.appendChild(el("p", "note-text", "Discord id " + c.discordId));
    body.appendChild(creatorLinks(c));
    if (c.about) body.appendChild(el("p", "note-text st-about", c.about));
    var meta = (c.followers || 0) + (c.followers === 1 ? " follower" : " followers");
    if (c.decidedBy || c.decidedAt) meta += " · decided " + (c.decidedBy ? "by " + c.decidedBy + " " : "") + utc(c.decidedAt);
    body.appendChild(el("p", "note-text", meta));
    card.appendChild(body);
    var side = el("div");
    side.appendChild(el("span", "badge" + (c.status === "approved" ? " good" : ""), STATUS_LABELS[c.status] || c.status));
    if (can("act")) {
      var row = el("div", "st-buttons");
      var add = function (label, attr, fn) {
        var b = el("button", "ghost-btn small", label);
        b.type = "button";
        b.setAttribute(attr, c.id);
        b.addEventListener("click", fn);
        row.appendChild(b);
      };
      if (c.status !== "approved") add("Approve", "data-approve", function () { setStatus(c, "approved"); });
      if (c.status !== "declined") add("Decline", "data-decline", function () { setStatus(c, "declined"); });
      add("Remove", "data-remove", function () {
        if (!window.confirm("Remove " + (c.displayName || c.discordId) + " as a content creator? Their followers are removed too.")) return;
        request("/api/admin/streamers/creators/" + c.id, { method: "DELETE" })
          .then(function (d) { ok((d && d.message) || "Removed."); return loadCreators(); }, fail);
      });
      side.appendChild(row);
    }
    card.appendChild(side);
    return card;
  }

  function renderChips(counts) {
    Array.prototype.forEach.call($("st-status-chips").querySelectorAll(".chip"), function (chip) {
      var s = chip.getAttribute("data-status");
      chip.setAttribute("aria-pressed", s === state.status ? "true" : "false");
      var n = s === "all" ? ["pending", "approved", "declined"].reduce(function (a, k) { return a + ((counts && counts[k]) || 0); }, 0)
        : (counts && counts[s]) || 0;
      chip.textContent = STATUS_LABELS[s] + " (" + n + ")";
    });
  }

  function loadCreators() {
    var mine = ++seq;
    return request("/api/admin/streamers/creators?status=" + state.status).then(function (d) {
      if (mine !== seq) return;
      state.creators = (d && d.items) || [];
      $("st-creators-missing").hidden = !(d && d.tableReady === false);
      renderChips(d && d.counts);
      var box = $("st-creators");
      clear(box);
      if (d && d.tableReady !== false && !state.creators.length) {
        box.appendChild(el("p", "note-text", state.status === "all" ? "No content creators yet." :
          "No " + STATUS_LABELS[state.status].toLowerCase() + " content creators."));
      }
      state.creators.forEach(function (c) { box.appendChild(creatorCard(c)); });
    }, function (e) { if (mine === seq) fail(e); });
  }

  function wire() {
    $("st-game-add").addEventListener("click", function () { openForm(null); });
    $("st-refresh").addEventListener("click", function () { ok(""); loadGames(); loadCreators(); });
    Array.prototype.forEach.call($("st-status-chips").querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.status = chip.getAttribute("data-status");
        loadCreators();
      });
    });
  }

  window.startAdminStreamers = function () {
    if (started) { if (!state.editing) { loadGames(); } loadCreators(); return; }
    started = true;
    wire();
    loadGames();
    loadCreators();
  };
})();
