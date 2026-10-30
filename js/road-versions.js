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
    return isNaN(d) ? "-" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  fetch(API + "/api/public/road/versions", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (list) {
      while (body.firstChild) body.removeChild(body.firstChild);
      (list || []).forEach(function (v) {
        var tr = el("tr");
        tr.appendChild(el("td", "cell-name", v.name || "Road"));
        tr.appendChild(el("td", "num", v.cycle === null || v.cycle === undefined ? "-" : String(v.cycle)));
        tr.appendChild(el("td", null, when(v.firstLiveAt)));
        var frozen = el("td", null, v.retiredAt ? when(v.retiredAt) : "-");
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
