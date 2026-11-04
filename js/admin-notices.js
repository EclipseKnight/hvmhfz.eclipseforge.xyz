/* Admin: Notices tab. Three parts, all with the admin's token:
   - Login notices: the live settings section login_notices (/api/admin/settings/login_notices, the same row the
     Settings tab edits), with a preview of the MHFML tags (<BODY>, <BR>, <CENTER>, <SIZE_n>, <C_n>). The preview's
     colours are close, not exact: the game draws them.
   - Send now: one notice in game (a chat line to every player) and/or on Discord (a post by the bot user in
     #mhfrontier), /api/admin/notices/send. Two clicks, like the Server tab's restart.
   - Scheduled notices: /api/admin/notices/scheduled; the API's job sends each at its time (never late: one due over
     15 minutes ago is marked missed). Times are UTC.
   The API checks every text; the counts here only help while typing. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var GAME_MAX_BYTES = 240;
  var DISCORD_MAX_CHARS = 2000;

  /* ---------- pure helpers (tested under node by dev/check-admin-notices.js) ---------- */

  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** "Fri 20 Nov 2026 12:00 UTC"; "-" for nothing. */
  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "-";
    var d = new Date(t);
    return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MO[d.getUTCMonth()] + " " + d.getUTCFullYear() + " "
      + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " UTC";
  }

  /** UTF-8 length of a text (the game's limit is in bytes). */
  function utf8Bytes(text) {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  /** What the counter under the text says, and whether it is over a limit. */
  function counter(text, game, discord) {
    var parts = [], over = false;
    if (game) {
      var b = utf8Bytes(text);
      parts.push("In game: " + b + "/" + GAME_MAX_BYTES + " bytes");
      if (b > GAME_MAX_BYTES) over = true;
      if (/[\r\n\t]/.test(text)) { parts.push("one line only"); over = true; }
    }
    if (discord) {
      parts.push("Discord: " + text.length + "/" + DISCORD_MAX_CHARS);
      if (text.length > DISCORD_MAX_CHARS) over = true;
    }
    return { text: parts.join(" · "), over: over };
  }

  /** "2026-11-20T14:00" (a datetime-local box read as UTC) → "2026-11-20T14:00:00Z"; null when empty or wrong. */
  function utcFromBox(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
    return m ? m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":00Z" : null;
  }

  // Colours of <C_n>, close to the game's: C_4 highlight, C_5 warning, C_7 normal text (Erupe's sample notice).
  var COLOURS = { 0: "#9a9a9a", 1: "#6fa8ff", 2: "#ff7f7f", 3: "#ff9fe0", 4: "#ffd75e", 5: "#ff5a5a",
    6: "#7fe07f", 7: "#f2f2f2", 8: "#ffb35a", 9: "#7fe0e0" };

  /**
   * One notice's MHFML as lines for the preview: [{align, spans: [{text, colour, size, unknown}]}]. <BODY> starts
   * a line's settings, <BR> ends a line, <CENTER>/<LEFT>/<RIGHT> align it, <SIZE_n> and <C_n> last until changed.
   * An unknown tag is kept as text (marked unknown), so a typo shows.
   */
  function parseMhfml(text) {
    var lines = [], line = { align: "left", spans: [] }, colour = COLOURS[7], size = 2;
    var re = /<([A-Z]+)(?:_(\d+))?>/g, last = 0, m;
    function push(t, unknown) {
      if (t) line.spans.push({ text: t, colour: unknown ? "#888" : colour, size: size, unknown: !!unknown });
    }
    while ((m = re.exec(text)) !== null) {
      push(text.slice(last, m.index));
      last = re.lastIndex;
      var tag = m[1], n = m[2] === undefined ? null : Number(m[2]);
      if (tag === "BR") { lines.push(line); line = { align: line.align, spans: [] }; }
      else if (tag === "BODY") { /* paragraph start: nothing to draw */ }
      else if (tag === "CENTER" || tag === "LEFT" || tag === "RIGHT") line.align = tag.toLowerCase();
      else if (tag === "SIZE" && n !== null) size = n;
      else if (tag === "C" && n !== null) colour = COLOURS[n] || COLOURS[7];
      else push(m[0], true);
    }
    push(text.slice(last));
    if (line.spans.length || !lines.length) lines.push(line);
    return lines;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { utc: utc, utf8Bytes: utf8Bytes, counter: counter, utcFromBox: utcFromBox, parseMhfml: parseMhfml };
  }
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var started = false;
  var state = { login: null, notices: [], hide: false, confirmSend: false, confirmCancel: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function $(id) { return document.getElementById(id); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  // Like admin-settings.js's: a refusal throws with the API's message and the whole answer.
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("Sign in again: your session has ended.");
        if (r.status === 403) throw new Error("Only admin accounts can use the Notices tab.");
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var error = new Error((data && data.message) || "HTTP " + r.status);
            error.data = data;
            throw error;
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

  function problems(id, list) {
    var box = $(id);
    clear(box);
    (list || []).forEach(function (p) { box.appendChild(el("li", null, p)); });
    box.hidden = !(list && list.length);
  }

  function fail(error) {
    say("not-ok", "");
    say("not-alert", error.message);
    if (error.data && error.data.problems && error.data.problems.length > 1) problems("not-problems", error.data.problems);
  }

  /* --- login notices --- */

  function loadLogin() {
    return request("/api/admin/settings/login_notices").then(function (view) {
      state.login = view;
      var stored = view.stored ? view.stored.value || {} : {};
      var defaults = view.defaults || {};
      state.hide = "hide" in stored ? !!stored.hide : !!defaults.hide;
      state.notices = ("notices" in stored ? stored.notices : defaults.notices || []).slice();
      var where = view.stored ? "Stored version " + view.stored.version + " by " + view.stored.updatedBy + ", "
        + utc(view.stored.updatedAt) + "." : "Nothing stored: the game server uses its config.json notices"
        + (view.defaults ? " (shown here)." : "; it has not reported them yet.");
      $("not-login-state").textContent = where + " Players see a change at their next login.";
      $("not-hide").checked = state.hide;
      drawLogin();
    });
  }

  function drawLogin() {
    var wrap = $("not-login-list");
    clear(wrap);
    state.notices.forEach(function (text, i) {
      var row = el("div", "notice-row");
      var id = "not-login-" + i;
      var label = el("label", null, "Page " + (i + 1));
      label.htmlFor = id;
      var ta = el("textarea");
      ta.id = id;
      ta.rows = 4;
      ta.maxLength = 4000;
      ta.value = text;
      var preview = el("div", "mhfml-preview");
      preview.setAttribute("aria-label", "Preview of page " + (i + 1));
      ta.addEventListener("input", function () { state.notices[i] = ta.value; drawPreview(preview, ta.value); });
      drawPreview(preview, text);
      var rm = el("button", "ghost-btn small", "Remove page");
      rm.type = "button";
      rm.addEventListener("click", function () { state.notices.splice(i, 1); drawLogin(); });
      row.appendChild(label);
      row.appendChild(ta);
      row.appendChild(preview);
      row.appendChild(rm);
      wrap.appendChild(row);
    });
    $("not-login-add").disabled = state.notices.length >= 8;
  }

  function drawPreview(box, text) {
    clear(box);
    parseMhfml(text).forEach(function (line) {
      var p = el("div", "mhfml-line");
      p.style.textAlign = line.align;
      if (!line.spans.length) p.appendChild(el("span", null, " "));
      line.spans.forEach(function (s) {
        var span = el("span", s.unknown ? "mhfml-unknown" : null, s.text);
        span.style.color = s.colour;
        span.style.fontSize = Math.max(0.7, Math.min(1.6, 0.6 + s.size * 0.2)) + "em";
        p.appendChild(span);
      });
      box.appendChild(p);
    });
  }

  function saveLogin(event) {
    event.preventDefault();
    var view = state.login;
    if (!view) return;
    var value = { hide: $("not-hide").checked, notices: state.notices.slice() };
    problems("not-login-problems", []);
    request("/api/admin/settings/login_notices/check", { method: "POST", body: JSON.stringify({ value: value }) })
      .then(function (checked) {
        if (checked.problems && checked.problems.length) { problems("not-login-problems", checked.problems); return null; }
        return request("/api/admin/settings/login_notices", { method: "PUT", body: JSON.stringify({
          value: value, expectedVersion: view.stored ? view.stored.version : 0, note: "Notices tab" }) })
          .then(function (result) {
            say("not-alert", "");
            say("not-ok", "Login notices saved (version " + result.section.stored.version + "). Players see them at their next login.");
            return loadLogin();
          });
      })
      .catch(fail);
  }

  /* --- send now --- */

  function targets(prefix) {
    return { game: $(prefix + "-game").checked, discord: $(prefix + "-discord").checked };
  }

  function updateCounter(prefix) {
    var t = targets(prefix);
    var c = counter($(prefix + "-text").value, t.game, t.discord);
    var box = $(prefix + "-count");
    box.textContent = c.text;
    box.classList.toggle("over", c.over);
    if (prefix === "not-send") {
      state.confirmSend = false;
      $("not-send-btn").textContent = "Send now";
    }
  }

  function sendNow(event) {
    event.preventDefault();
    var t = targets("not-send");
    var body = { text: $("not-send-text").value, game: t.game, discord: t.discord };
    if (!state.confirmSend) {
      // First click: the API's checks, then ask for the second click.
      request("/api/admin/notices/check", { method: "POST", body: JSON.stringify(body) }).then(function (checked) {
        problems("not-send-problems", checked.problems);
        if (checked.problems.length) return;
        state.confirmSend = true;
        $("not-send-btn").textContent = "Click again to send " + (t.game && t.discord ? "in game and on Discord"
          : t.game ? "in game" : "on Discord");
      }).catch(fail);
      return;
    }
    state.confirmSend = false;
    $("not-send-btn").textContent = "Send now";
    request("/api/admin/notices/send", { method: "POST", body: JSON.stringify(body) })
      .then(function (sent) {
        say("not-alert", "");
        say("not-ok", "Sent. " + sent.summary);
        $("not-send-text").value = "";
        updateCounter("not-send");
      })
      .catch(function (e) {
        if (e.data && e.data.summary) { say("not-ok", ""); say("not-alert", "Not sent everywhere: " + e.data.summary); return; }
        fail(e);
      });
  }

  /* --- scheduled --- */

  function loadScheduled() {
    return request("/api/admin/notices/scheduled?recent=50").then(function (data) {
      $("not-sched-missing").hidden = data.tableReady;
      $("not-sched-form").hidden = !data.tableReady;
      drawRows($("not-planned"), data.planned, true);
      drawRows($("not-recent"), data.recent, false);
    });
  }

  function where(n) {
    return n.toGame && n.toDiscord ? "In game + Discord" : n.toGame ? "In game" : "Discord";
  }

  function drawRows(body, rows, planned) {
    clear(body);
    if (!rows.length) {
      var tr = el("tr");
      var td = el("td", "empty-cell", planned ? "Nothing planned." : "None yet.");
      td.colSpan = 5;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    rows.forEach(function (n) {
      var tr = el("tr");
      tr.appendChild(el("td", null, utc(n.sendAt)));
      tr.appendChild(el("td", null, where(n)));
      tr.appendChild(el("td", "notice-text", n.text));
      tr.appendChild(el("td", null, n.createdBy));
      var last = el("td");
      if (planned) {
        var b = el("button", "ghost-btn small", "Cancel");
        b.type = "button";
        b.addEventListener("click", function () { cancel(n, b); });
        last.appendChild(b);
      } else {
        last.appendChild(el("div", "notice-status notice-" + n.status, n.status));
        if (n.result) last.appendChild(el("div", "notice-result", n.result));
        if (n.cancelledBy) last.appendChild(el("div", "notice-result", "by " + n.cancelledBy));
      }
      tr.appendChild(last);
      body.appendChild(tr);
    });
  }

  function schedule(event) {
    event.preventDefault();
    var t = targets("not-sched");
    var at = utcFromBox($("not-sched-at").value);
    var body = { text: $("not-sched-text").value, game: t.game, discord: t.discord, sendAt: at };
    problems("not-sched-problems", []);
    request("/api/admin/notices/scheduled", { method: "POST", body: JSON.stringify(body) })
      .then(function (n) {
        say("not-alert", "");
        say("not-ok", "Notice #" + n.id + " planned for " + utc(n.sendAt) + ".");
        $("not-sched-text").value = "";
        updateCounter("not-sched");
        return loadScheduled();
      })
      .catch(function (e) {
        if (e.data && e.data.problems) { problems("not-sched-problems", e.data.problems); return; }
        fail(e);
      });
  }

  // Two clicks, like the Events tab's delete.
  function cancel(n, button) {
    if (state.confirmCancel !== n.id) {
      state.confirmCancel = n.id;
      button.textContent = "Click again to cancel #" + n.id;
      return;
    }
    state.confirmCancel = null;
    request("/api/admin/notices/scheduled/" + n.id + "/cancel", { method: "POST" })
      .then(function () {
        say("not-ok", "Notice #" + n.id + " cancelled.");
        return loadScheduled();
      })
      .catch(fail);
  }

  function load() {
    say("not-alert", "");
    return Promise.all([loadLogin(), loadScheduled()]).catch(fail);
  }

  function wire() {
    $("not-login-form").addEventListener("submit", saveLogin);
    $("not-login-add").addEventListener("click", function () {
      if (state.notices.length < 8) { state.notices.push("<BODY>"); drawLogin(); }
    });
    ["not-send", "not-sched"].forEach(function (prefix) {
      ["-text", "-game", "-discord"].forEach(function (s) {
        $(prefix + s).addEventListener("input", function () { updateCounter(prefix); });
        $(prefix + s).addEventListener("change", function () { updateCounter(prefix); });
      });
      updateCounter(prefix);
    });
    $("not-send-form").addEventListener("submit", sendNow);
    $("not-sched-form").addEventListener("submit", schedule);
    $("not-refresh").addEventListener("click", function () { load(); });
  }

  window.startAdminNotices = function () {
    if (!started) {
      started = true;
      wire();
    }
    load();
  };
})();
