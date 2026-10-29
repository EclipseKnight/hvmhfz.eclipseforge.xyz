/* Quest log on the worlds page: how the last day of quests went, and the latest quest stays. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    var s = Math.max(0, Math.round(seconds));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h + "h " + m + "m " + sec + "s";
    if (m) return m + "m " + sec + "s";
    return sec + "s";
  }

  function when(iso) {
    if (!iso) return "-";
    var at = new Date(iso);
    if (isNaN(at)) return "-";
    var mins = Math.round((Date.now() - at.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    if (mins < 1440) return Math.round(mins / 60) + "h ago";
    return at.toLocaleDateString();
  }

  function stat(id, value) {
    var card = document.getElementById(id);
    if (!card) return;
    card.classList.remove("skeleton");
    var v = card.querySelector(".stat-value");
    if (v) v.textContent = value;
  }

  function renderStats(stats) {
    stat("quest-clears", (stats.clears || 0).toLocaleString());
    stat("quest-fails", (stats.fails || 0).toLocaleString());
    stat("quest-avg", duration(stats.avgDurationSeconds));
    stat("quest-clear", duration(stats.avgClearSeconds));
    var note = document.getElementById("quest-stats-note");
    if (note) {
      note.textContent = stats.total
        ? stats.total.toLocaleString() + " quest stays in the last " + stats.range + ", " + (stats.unknown || 0).toLocaleString() + " with no reported outcome."
        : "No quests in the last " + stats.range + ".";
    }

    var list = document.getElementById("quest-top");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    (stats.topQuests || []).forEach(function (q) {
      var item = el("li", "quest-top-item");
      var name = el("a", "quest-top-name", q.quest || ("#" + q.questId));
      name.href = "/quest.html?id=" + q.questId;
      item.appendChild(name);
      item.appendChild(el("span", "quest-top-count", q.clears + " clear" + (q.clears === 1 ? "" : "s") +
        (q.fails ? " · " + q.fails + " fail" + (q.fails === 1 ? "" : "s") : "")));
      list.appendChild(item);
    });
  }

  function renderRecent(rows) {
    var body = document.getElementById("quest-recent-body");
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!rows.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No quests have finished yet.");
      cell.colSpan = 6;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var tr = el("tr");
      var hunter = el("td", "cell-name");
      if (row.hunter) {
        var link = el("a", null, row.hunter);
        link.href = "/hunters.html?name=" + encodeURIComponent(row.hunter);
        hunter.appendChild(link);
      } else {
        hunter.textContent = "-";
      }
      tr.appendChild(hunter);
      var nameCell = el("td");
      if (row.questId) {
        var qlink = el("a", null, row.quest || ("#" + row.questId));
        qlink.href = "/quest.html?id=" + row.questId;
        nameCell.appendChild(qlink);
      } else {
        nameCell.textContent = row.quest || "-";
      }
      tr.appendChild(nameCell);
      var result = el("td");
      var label = row.result === "clear" ? "Cleared" : row.result === "fail" ? "Failed" : "Unknown";
      result.appendChild(el("span", "badge " + (row.result === "clear" ? "good" : row.result === "fail" ? "bad" : ""), label));
      tr.appendChild(result);
      var partyCell = el("td", "quest-party");
      (row.party || []).forEach(function (member, index) {
        if (index) partyCell.appendChild(document.createTextNode(", "));
        partyCell.appendChild(document.createTextNode(member));
      });
      if (!(row.party || []).length) partyCell.textContent = "-";
      tr.appendChild(partyCell);
      tr.appendChild(el("td", "num", duration(row.durationSeconds)));
      tr.appendChild(el("td", "num", row.clearSeconds === null || row.clearSeconds === undefined ? "-" : duration(row.clearSeconds)));
      body.appendChild(tr);
    });
  }

  function fail() {
    ["quest-clears", "quest-fails", "quest-avg", "quest-clear"].forEach(function (id) { stat(id, "-"); });
    var body = document.getElementById("quest-recent-body");
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    var row = el("tr");
    var cell = el("td", "empty-cell", "The quest log is unavailable right now.");
    cell.colSpan = 6;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function load() {
    Promise.all([
      fetch(API + "/api/public/quests/stats?range=24h", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch(API + "/api/public/quests/recent?limit=15", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
    ]).then(function (results) {
      renderStats(results[0]);
      renderRecent(results[1].rows || []);
    }).catch(fail);
  }

  if (document.getElementById("quest-recent-body")) {
    load();
    setInterval(load, 60000);
  }
})();
