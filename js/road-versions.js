/* Every Road the server has run, newest first: dates, status and hash. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var body = document.getElementById("road-versions-body");
  if (!body) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function when(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (window.HvTime && !isNaN(d)) return HvTime.text(d, { time: false });
    return isNaN(d) ? "-" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // The date as a <time> for a cell (UTC time on hover); plain text when empty or without js/time.js.
  function whenNode(iso) {
    if (!window.HvTime || !iso || isNaN(new Date(iso))) return null;
    return HvTime.node(iso, { time: false });
  }

  fetch(API + "/api/public/road/versions", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (list) {
      while (body.firstChild) body.removeChild(body.firstChild);
      (list || []).forEach(function (v) {
        var tr = el("tr");
        tr.appendChild(el("td", "cell-name", v.name || "Road"));
        tr.appendChild(el("td", "num", v.cycle === null || v.cycle === undefined ? "-" : String(v.cycle)));
        var liveCell = el("td");
        var liveAt = whenNode(v.firstLiveAt);
        if (liveAt) liveCell.appendChild(liveAt); else liveCell.textContent = when(v.firstLiveAt);
        tr.appendChild(liveCell);
        var frozen = el("td");
        var frozenAt = v.retiredAt ? whenNode(v.retiredAt) : null;
        if (frozenAt) {
          frozenAt.title += " (when this Road's original board was frozen)";
          frozen.appendChild(frozenAt);
        } else {
          frozen.textContent = v.retiredAt ? when(v.retiredAt) : "-";
        }
        if (v.retiredAt) frozen.title = "when this Road's original board was frozen";
        tr.appendChild(frozen);
        var status = el("td");
        var open = v.live || v.always;
        var label = v.always ? "Always available" : v.live ? "Live" : "Retired";
        status.appendChild(el("span", "badge " + (open ? "good" : ""), label));
        tr.appendChild(status);
        var hash = el("td", "cell-sub muted", (v.sha256 || "").slice(0, 12) + "…");
        hash.title = v.sha256 || "";
        tr.appendChild(hash);
        body.appendChild(tr);
      });
      var note = document.getElementById("road-versions-note");
      if (note) note.textContent = (list || []).length + " roads";
    })
    .catch(function () {
      while (body.firstChild) body.removeChild(body.firstChild);
      var tr = el("tr");
      var cell = el("td", "empty-cell", "The Road archive is unavailable right now.");
      cell.colSpan = 6;
      tr.appendChild(cell); body.appendChild(tr);
    });
})();
