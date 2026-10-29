/* All-time weapon usage: totals per weapon type and the hunters with the most time on each. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var body = document.getElementById("weapon-board-body");
  if (!body) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function time(seconds) {
    if (!seconds) return "0s";
    var s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h) return h.toLocaleString() + "h " + (m < 10 ? "0" : "") + m + "m " + (sec < 10 ? "0" : "") + sec + "s";
    if (m) return m + "m " + (sec < 10 ? "0" : "") + sec + "s";
    return sec + "s";
  }

  fetch(API + "/api/public/weapons/leaderboard", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (data) {
      var weapons = data.weapons || [];
      var total = data.seconds || weapons.reduce(function (n, w) { return n + w.seconds; }, 0);
      while (body.firstChild) body.removeChild(body.firstChild);
      weapons.forEach(function (weapon, index) {
        var tr = el("tr");
        tr.appendChild(el("td", "num", String(index + 1)));
        tr.appendChild(el("td", "cell-name", weapon.weapon));
        tr.appendChild(el("td", "num", time(weapon.seconds)));
        tr.appendChild(el("td", "num", (weapon.hunters || 0).toLocaleString()));
        tr.appendChild(el("td", "num", total ? (100 * weapon.seconds / total).toFixed(1) + "%" : "-"));
        var top = el("td");
        (weapon.top || []).forEach(function (hunter, i) {
          if (i) top.appendChild(document.createTextNode(", "));
          var link = el("a", null, hunter.hunter);
          link.href = "/hunters.html?name=" + encodeURIComponent(hunter.hunter);
          link.title = time(hunter.seconds);
          top.appendChild(link);
        });
        if (!(weapon.top || []).length) top.textContent = "-";
        tr.appendChild(top);
        body.appendChild(tr);
      });
      var note = document.getElementById("weapon-board-note");
      if (note) note.textContent = "every hunter · " + time(total) + " tracked in total";
    })
    .catch(function () {
      while (body.firstChild) body.removeChild(body.firstChild);
      var tr = el("tr");
      var cell = el("td", "empty-cell", "The weapon board is unavailable right now.");
      cell.colSpan = 6;
      tr.appendChild(cell); body.appendChild(tr);
    });
})();
