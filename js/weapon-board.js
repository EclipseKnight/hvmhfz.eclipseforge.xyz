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

  function icon(weapon) {
    var slug = weapon.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    var img = document.createElement("img");
    img.className = "weapon-icon";
    img.src = "/assets/weapons/" + slug + ".png";
    img.alt = "";
    img.loading = "lazy";
    return img;
  }

  // Weapon time is credited once a minute, so it is shown in hours and minutes only: seconds would be
  // false precision.
  function time(seconds) {
    if (!seconds) return "0m";
    var s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h.toLocaleString() + "h " + (m < 10 ? "0" : "") + m + "m";
    return Math.max(1, m) + "m";
  }

  fetch(API + "/api/public/weapons/leaderboard", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (data) {
      var weapons = data.weapons || [];
      var total = data.seconds || weapons.reduce(function (n, w) { return n + w.seconds; }, 0);
      while (body.firstChild) body.removeChild(body.firstChild);
      // The bar chart above the table: each weapon's share of all tracked time, longest bar = most used.
      var bars = document.getElementById("weapon-board-bars");
      if (bars) {
        while (bars.firstChild) bars.removeChild(bars.firstChild);
        var most = weapons.reduce(function (m, w) { return Math.max(m, w.seconds || 0); }, 0);
        weapons.forEach(function (weapon) {
          var item = el("li", weapon.seconds ? null : "is-zero");
          var label = el("span", "wb-name");
          label.appendChild(icon(weapon.weapon));
          label.appendChild(document.createTextNode(weapon.weapon));
          item.appendChild(label);
          var track = el("span", "wb-track");
          var fill = el("span", "wb-fill");
          fill.style.width = most ? Math.max(weapon.seconds ? 1.5 : 0, (weapon.seconds / most) * 100) + "%" : "0";
          track.appendChild(fill);
          item.appendChild(track);
          var pct = total ? (100 * weapon.seconds / total).toFixed(1) + "%" : "-";
          var value = el("span", "wb-value", time(weapon.seconds) + " · " + pct);
          value.title = (weapon.hunters || 0) + ((weapon.hunters || 0) === 1 ? " hunter" : " hunters");
          item.appendChild(value);
          bars.appendChild(item);
        });
      }
      weapons.forEach(function (weapon, index) {
        var tr = el("tr");
        tr.appendChild(el("td", "num", String(index + 1)));
        var nameCell = el("td", "cell-name weapon-cell");
        nameCell.appendChild(icon(weapon.weapon));
        nameCell.appendChild(el("span", null, weapon.weapon));
        tr.appendChild(nameCell);
        tr.appendChild(el("td", "num", time(weapon.seconds)));
        tr.appendChild(el("td", "num", (weapon.hunters || 0).toLocaleString()));
        tr.appendChild(el("td", "num", total ? (100 * weapon.seconds / total).toFixed(1) + "%" : "-"));
        var top = el("td");
        (weapon.top || []).forEach(function (hunter, i) {
          if (i) top.appendChild(document.createTextNode(", "));
          var link = el("a", null, hunter.hunter);
          // the exact hunter when the API sends charId (from 5b6d085), else the one hunter of that name
          link.href = typeof hunter.charId === "number" && hunter.charId > 0
            ? "/hunters.html?id=" + hunter.charId
            : "/hunters.html?name=" + encodeURIComponent(hunter.hunter);
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
