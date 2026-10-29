/* Worlds: hours played per weapon by every hunter (GET /api/public/weapons). The play tracker credits
 * each minute online to the weapon the character last saved with; the list shows all 14 weapon types,
 * most played first, with the share of all tracked hours and how many hunters used each. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function hours(seconds) {
    if (!seconds) return "0 h";
    if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + " min";
    var h = seconds / 3600;
    return (h < 10 ? h.toFixed(1) : Math.round(h).toLocaleString()) + " h";
  }

  function render(data) {
    var list = document.getElementById("weapon-bars");
    while (list.firstChild) list.removeChild(list.firstChild);
    var rows = data.weapons || [];
    var top = rows.reduce(function (m, r) { return Math.max(m, r.seconds); }, 0);
    rows.forEach(function (r) {
      var item = el("li", r.seconds ? null : "is-zero");
      var label = el("span", "wb-name");
      var icon = document.createElement("img");
      icon.className = "weapon-icon";
      icon.src = "/assets/weapons/" + r.weapon.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png";
      icon.alt = "";
      icon.loading = "lazy";
      label.appendChild(icon);
      label.appendChild(document.createTextNode(r.weapon));
      item.appendChild(label);
      var track = el("span", "wb-track");
      var fill = el("span", "wb-fill");
      fill.style.width = top ? Math.max(r.seconds ? 1.5 : 0, (r.seconds / top) * 100) + "%" : "0";
      track.appendChild(fill);
      item.appendChild(track);
      var share = data.seconds ? Math.round((r.seconds / data.seconds) * 100) : 0;
      var value = el("span", "wb-value", hours(r.seconds) + (r.seconds ? " · " + share + "%" : ""));
      if (r.hunters) value.title = r.hunters + (r.hunters === 1 ? " hunter" : " hunters");
      item.appendChild(value);
      list.appendChild(item);
    });
    var main = rows.length && rows[0].seconds ? rows[0] : null;
    document.getElementById("weapon-note").textContent = data.since
      ? "Most played: " + (main ? main.weapon + " (" + hours(main.seconds) + ", " + main.hunters + (main.hunters === 1 ? " hunter" : " hunters") + ")" : "none yet")
        + ". " + hours(data.seconds) + " by " + data.hunters + (data.hunters === 1 ? " hunter" : " hunters")
        + ", tracked since " + new Date(data.since).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
        + ". Each minute online counts for the weapon the hunter last saved with."
      : "Weapon hours start with the next minute anyone is online.";
  }

  fetch(API + "/api/public/weapons", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(render)
    .catch(function () {
      document.getElementById("weapon-note").textContent = "Weapon hours could not be loaded right now.";
    });
})();
