/* Hunting Road: the past winners, public (GET /api/public/road/history). No sign-in needed. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function messageRow(body, text) {
    clear(body);
    var row = el("tr");
    var cell = el("td", "empty-cell", text);
    cell.colSpan = 7;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function render(list) {
    var body = document.getElementById("history-rows");
    document.getElementById("history-note").textContent = list.length + (list.length === 1 ? " Road" : " Roads");
    if (!list.length) {
      messageRow(body, "No player-made Road has gone live yet.");
      return;
    }
    clear(body);
    list.slice().sort(function (a, b) { return b.number - a.number; }).forEach(function (item) {
      var row = el("tr");
      row.appendChild(el("td", "rank", item.number > 0 ? String(item.number) : "base"));
      row.appendChild(el("td", "cell-name", item.name));
      var map = el("td", "num", item.sha256 ? item.sha256.slice(0, 10) : "-");
      if (item.sha256) map.title = "Road data sha256: " + item.sha256;
      row.appendChild(map);
      row.appendChild(el("td", null, item.characterName || "-"));
      row.appendChild(el("td", "num", item.votes === null || item.votes === undefined ? "-" : String(item.votes)));
      row.appendChild(el("td", null, formatDate(item.liveFrom) || "-"));
      row.appendChild(el("td", null, item.liveUntil ? formatDate(item.liveUntil) : "Live now"));
      body.appendChild(row);
    });
  }

  fetch(API + "/api/public/road/history", { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(render)
    .catch(function () {
      messageRow(document.getElementById("history-rows"), "The list could not be loaded.");
      var alert = document.getElementById("history-alert");
      alert.textContent = "The API did not answer. Try again in a moment.";
      alert.hidden = false;
    });
})();
