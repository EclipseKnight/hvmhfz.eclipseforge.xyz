/* Hunting Road: this rotation's phase, the entries, voting and the results. Needs the saved sign-in
   (the same JWT as the other pages). Endpoints: /api/road/cycle, /entries, /votes, /results. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var latest = null;      // GET /api/road/cycle: the latest cycle (open for submissions once the next has started)
  var shown = null;       // the cycle the entries below belong to
  var results = null;     // {winnerId} once the vote is over

  var STATES = {
    submitting: "Submissions are open",
    voting: "Voting is open",
    closed: "Voting is closed; an admin approves the winner",
    approved: "The winner is approved and goes live at the time below",
    live: "The winner is live",
    "no-winner": "No valid entry: the current Road stays",
    cancelled: "Cancelled"
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function $(id) { return document.getElementById(id); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (error) {
      return "";
    }
  }

  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (response) {
        if (response.status === 401) throw new Error("signin");
        if (response.status === 204) return null;
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) {
            var error = new Error((data && data.message) || "HTTP " + response.status);
            error.server = true;
            error.status = response.status;
            throw error;
          }
          return data;
        });
      });
  }

  function formatDate(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function alertBox(text) {
    var box = $("vote-alert");
    box.textContent = text || "";
    box.hidden = !text;
  }

  function notice(text) {
    var box = $("vote-notice");
    box.textContent = text || "";
    box.hidden = !text;
  }

  function showError(error) {
    if (error.message === "signin") {
      alertBox("Your sign-in has expired. Sign in again on the home page.");
    } else {
      alertBox(error.server ? error.message : "The API did not answer. Try again in a moment.");
    }
  }

  /* ---------- the phase ---------- */

  function myVotes() { return shown.myVotes || (latest && latest.myVotes) || []; }

  function myEntries() { return shown.myEntries || (latest && latest.myEntries) || []; }

  function renderPhase() {
    $("vote-phase-panel").hidden = false;
    $("vote-phase-head").textContent = "Rotation " + shown.number;
    $("vote-phase-note").textContent = shown.paused ? "paused" : "";
    var text = (STATES[shown.state] || shown.state) + ".";
    if (shown.paused) text += " New rotations are paused for now.";
    if (latest !== shown) {
      text += " Rotation " + latest.number + " is taking submissions until " + formatDate(latest.submitCloses) + ".";
    }
    $("vote-phase-text").textContent = text;

    var phase = $("vote-phase");
    clear(phase);
    [["Submissions open", shown.submitOpens], ["Submissions close, voting starts", shown.submitCloses],
     ["Voting closes", shown.voteCloses], ["Winner goes live", shown.liveFrom || shown.voteCloses]].forEach(function (row) {
      var box = el("div");
      box.appendChild(el("dt", null, row[0]));
      box.appendChild(el("dd", null, formatDate(row[1])));
      phase.appendChild(box);
    });
    var limits = shown.limits || (latest && latest.limits) || {};
    var parts = [];
    if (limits.entriesPerAccount) parts.push("You can submit up to " + limits.entriesPerAccount + (limits.entriesPerAccount === 1 ? " Road" : " Roads") + " per rotation.");
    if (limits.votesPerAccount) {
      parts.push("You have " + limits.votesPerAccount + (limits.votesPerAccount === 1 ? " vote" : " votes") + " per rotation." +
        (shown.state === "voting" ? " Used: " + myVotes().length + " of " + limits.votesPerAccount + "." : ""));
    }
    $("vote-limits").textContent = parts.join(" ");
  }

  /* ---------- the entries ---------- */

  function entryRow(entry, canVote) {
    var mine = !!entry.mine || myEntries().indexOf(entry.id) >= 0;
    var row = el("tr", results && results.winnerId === entry.id ? "is-winner" : (mine ? "is-mine" : null));
    row.appendChild(el("td", "rank", String(entry.id)));
    var name = el("td", "cell-name");
    name.appendChild(el("span", null, entry.name));
    if (mine) name.appendChild(el("span", "badge", "Yours"));
    if (results && results.winnerId === entry.id) name.appendChild(el("span", "badge good", "Winner"));
    if (entry.description) name.appendChild(el("span", "admin-desc", entry.description));
    row.appendChild(name);
    row.appendChild(el("td", null, entry.characterName || "-"));
    row.appendChild(el("td", "num", entry.votes === null || entry.votes === undefined ? "-" : String(entry.votes)));

    var actions = el("td");
    var view = el("a", "ghost-btn small", mine && shown.state === "submitting" ? "Edit" : "View");
    view.href = "/road.html?entry=" + encodeURIComponent(entry.id);
    actions.appendChild(view);
    if (canVote && !mine) {
      var voted = myVotes().indexOf(entry.id) >= 0;
      var button = el("button", voted ? "ghost-btn small" : "btn btn-primary btn-small", voted ? "Take back vote" : "Vote");
      button.type = "button";
      button.style.marginLeft = "8px";
      var limits = shown.limits || (latest && latest.limits) || {};
      var full = !voted && limits.votesPerAccount && myVotes().length >= limits.votesPerAccount;
      if (full) {
        button.disabled = true;
        button.title = "You have used all your votes. Take one back first.";
      }
      button.addEventListener("click", function () { castVote(entry, voted, button); });
      actions.appendChild(button);
    }
    row.appendChild(actions);
    return row;
  }

  function renderEntries(entries) {
    $("vote-entries-panel").hidden = false;
    var voting = shown.state === "voting";
    var over = results !== null;
    $("vote-entries-head").textContent = over ? "Results" : "Entries";
    $("vote-entries-note").textContent = entries.length + (entries.length === 1 ? " Road" : " Roads");
    var body = $("vote-rows");
    clear(body);
    if (!entries.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", shown.state === "submitting" ? "No Road has been submitted yet. Be the first." : "No entries.");
      cell.colSpan = 5;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    var list = entries.slice();
    if (over) list.sort(function (a, b) { return (b.votes || 0) - (a.votes || 0) || a.id - b.id; });
    list.forEach(function (entry) { body.appendChild(entryRow(entry, voting)); });
  }

  function castVote(entry, voted, button) {
    button.disabled = true;
    alertBox("");
    notice("");
    var done = voted
      ? request("/api/road/votes/" + encodeURIComponent(entry.id), { method: "DELETE" })
      : request("/api/road/votes", { method: "POST", body: JSON.stringify({ entryId: entry.id }) });
    done.then(function () {
      notice(voted ? "Your vote for \"" + entry.name + "\" is taken back." : "Voted for \"" + entry.name + "\".");
      return load();
    }).catch(function (error) {
      showError(error);
      button.disabled = false;
    });
  }

  /* ---------- boot ---------- */

  function showResults() {
    return request("/api/road/results?cycle=" + encodeURIComponent(shown.id)).then(function (data) {
      var list = Array.isArray(data) ? data : (data && data.entries) || [];
      var winner = data && !Array.isArray(data) ? (data.winnerId !== undefined ? data.winnerId : data.winnerEntryId !== undefined ? data.winnerEntryId : data.winner) : null;
      if (winner && typeof winner === "object") winner = winner.id;
      results = { winnerId: winner === undefined ? null : winner };
      renderEntries(list);
    });
  }

  function load() {
    results = null;
    return request("/api/road/cycle").then(function (data) {
      if (!data) {
        $("vote-phase-panel").hidden = false;
        $("vote-phase-head").textContent = "No rotation yet";
        $("vote-phase-text").textContent = "The first Hunting Road rotation has not started. Check back soon.";
        $("vote-entries-panel").hidden = true;
        return null;
      }
      latest = data;
      // While the next rotation takes submissions, the previous one may be in its vote. The API can hand
      // it over as "voting" on the latest cycle; without it the page shows the latest rotation only.
      shown = data.state === "submitting" && data.voting ? data.voting : data;
      renderPhase();
      var over = ["closed", "approved", "live", "no-winner"].indexOf(shown.state) >= 0;
      if (over) {
        return showResults().catch(function () {
          return request("/api/road/entries?cycle=" + encodeURIComponent(shown.id)).then(renderEntries);
        });
      }
      return request("/api/road/entries?cycle=" + encodeURIComponent(shown.id)).then(renderEntries);
    }).catch(showError);
  }

  function start() {
    if (!token()) {
      $("vote-signin").hidden = false;
      return;
    }
    load();
  }

  start();
})();
