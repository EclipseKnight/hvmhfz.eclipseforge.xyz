/* Worlds: player count over time and who played (GET /api/public/worlds/history).
 *
 * The line is the number of players online (sampled every minute, averaged per bucket, with the
 * bucket's peak as a dashed line). The bars are hunters active in the hunt log per day or week, which
 * reaches back much further than the minute samples. Below the graph: every player seen in the range
 * with playtime (the game's own counter), sessions, time online in the range, last seen and status.
 * Drawn as inline SVG, no libraries. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var RANGES = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]];
  var SVGNS = "http://www.w3.org/2000/svg";
  var state = { range: "24h", data: null, query: "" };

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    var s = Math.max(0, Math.round(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h >= 1) return h.toLocaleString() + " h " + (m < 10 ? "0" : "") + m + " m";
    if (m >= 1) return m + " m";
    return s + " s";
  }

  function ago(iso) {
    if (!iso) return "-";
    var then = new Date(iso).getTime();
    var diff = Math.max(0, (Date.now() - then) / 1000);
    if (diff < 90) return "just now";
    if (diff < 3600) return Math.round(diff / 60) + " min ago";
    if (diff < 86400) return Math.round(diff / 3600) + " h ago";
    if (diff < 86400 * 30) return Math.round(diff / 86400) + " days ago";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function stamp(iso, bucket) {
    var d = new Date(iso);
    if (bucket < 86400) {
      return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: bucket >= 604800 ? "numeric" : undefined });
  }

  // A whole-number tick step that gives at most about five gridlines.
  function niceStep(max) {
    var raw = Math.max(1, max / 5);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] * pow >= raw) return Math.max(1, steps[i] * pow);
    }
    return 10 * pow;
  }

  /* ---------- graph ---------- */

  function drawChart() {
    var data = state.data;
    var box = $("history-chart");
    clear(box);
    if (!data) return;

    var width = Math.max(300, box.clientWidth || 600);
    var height = width < 520 ? 220 : 280;
    var pad = { left: 38, right: 12, top: 14, bottom: 30 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var from = new Date(data.from).getTime();
    var to = new Date(data.to).getTime();
    if (!(to > from)) to = from + 1;
    var maxValue = 0;
    data.points.forEach(function (p) { maxValue = Math.max(maxValue, p.peak); });
    data.active.forEach(function (a) { maxValue = Math.max(maxValue, a.hunters); });
    var step = niceStep(Math.max(1, maxValue));
    var top = Math.max(step, Math.ceil(Math.max(1, maxValue) / step) * step);

    function x(iso) { return pad.left + ((new Date(iso).getTime() - from) / (to - from)) * plotW; }
    function y(v) { return pad.top + plotH - (v / top) * plotH; }

    var chart = svg("svg", { viewBox: "0 0 " + width + " " + height, width: width, height: height,
      role: "img", "aria-label": "Players online over the selected range" });

    // grid and y labels
    for (var v = 0; v <= top + 1e-9; v += step) {
      var gy = y(v);
      chart.appendChild(svg("line", { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy, class: "hc-grid" }));
      var label = svg("text", { x: pad.left - 6, y: gy + 4, class: "hc-axis", "text-anchor": "end" });
      label.textContent = v.toLocaleString();
      chart.appendChild(label);
    }

    // x labels: about five across
    var ticks = width < 520 ? 3 : 5;
    for (var t = 0; t <= ticks; t++) {
      var at = new Date(from + ((to - from) * t) / ticks).toISOString();
      var tx = svg("text", { x: x(at), y: height - 8, class: "hc-axis",
        "text-anchor": t === 0 ? "start" : t === ticks ? "end" : "middle" });
      var span = to - from;
      tx.textContent = span > 300 * 86400000
        ? new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" })
        : stamp(at, span > 3 * 86400000 ? 86400 : 3600);
      chart.appendChild(tx);
    }

    // active hunters: bars
    var barW = Math.max(1.5, (data.activeBucketSeconds * 1000 / (to - from)) * plotW - 2);
    data.active.forEach(function (a) {
      var bx = x(a.at);
      // a bucket can start before the range or run past its end: draw only the part inside
      var x0 = Math.max(pad.left, bx + 1);
      var x1 = Math.min(width - pad.right, bx + 1 + barW);
      if (x1 - x0 < 1) return;
      var by = y(a.hunters);
      chart.appendChild(svg("rect", { x: x0, y: by, width: x1 - x0,
        height: Math.max(0, pad.top + plotH - by), class: "hc-active" }));
    });

    // online: area, average line, peak line
    if (data.points.length) {
      var avgPath = "", peakPath = "", area = "";
      data.points.forEach(function (p, idx) {
        var px = x(p.at) + ((data.bucketSeconds * 1000 / (to - from)) * plotW) / 2;
        avgPath += (idx ? " L" : "M") + px.toFixed(1) + " " + y(p.average).toFixed(1);
        peakPath += (idx ? " L" : "M") + px.toFixed(1) + " " + y(p.peak).toFixed(1);
        area += (idx ? " L" : "M") + px.toFixed(1) + " " + y(p.average).toFixed(1);
        if (idx === data.points.length - 1) {
          var first = x(data.points[0].at) + ((data.bucketSeconds * 1000 / (to - from)) * plotW) / 2;
          area += " L" + px.toFixed(1) + " " + y(0) + " L" + first.toFixed(1) + " " + y(0) + " Z";
        }
      });
      chart.appendChild(svg("path", { d: area, class: "hc-area" }));
      chart.appendChild(svg("path", { d: peakPath, class: "hc-peak" }));
      chart.appendChild(svg("path", { d: avgPath, class: "hc-line" }));
      if (data.points.length === 1) {
        var only = data.points[0];
        chart.appendChild(svg("circle", { cx: x(only.at), cy: y(only.average), r: 3.5, class: "hc-dot" }));
      }
    }

    // hover
    var cursor = svg("line", { x1: 0, x2: 0, y1: pad.top, y2: pad.top + plotH, class: "hc-cursor", visibility: "hidden" });
    chart.appendChild(cursor);
    var hit = svg("rect", { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: "transparent" });
    chart.appendChild(hit);
    box.appendChild(chart);

    var tip = el("div", "hc-tip");
    tip.hidden = true;
    box.appendChild(tip);

    // The bucket that contains this moment, or nothing (no sample there).
    function within(list, when, bucketSeconds) {
      var size = bucketSeconds * 1000;
      for (var i = 0; i < list.length; i++) {
        var start = new Date(list[i].at).getTime();
        if (when >= start && when < start + size) return list[i];
      }
      return null;
    }

    function move(clientX) {
      var rect = chart.getBoundingClientRect();
      var px = ((clientX - rect.left) / rect.width) * width;
      px = Math.min(width - pad.right, Math.max(pad.left, px));
      var when = from + ((px - pad.left) / plotW) * (to - from);
      var p = within(data.points, when, data.bucketSeconds);
      var a = within(data.active, when, data.activeBucketSeconds);
      cursor.setAttribute("x1", px);
      cursor.setAttribute("x2", px);
      cursor.setAttribute("visibility", "visible");
      clear(tip);
      tip.appendChild(el("strong", null, stamp(new Date(when).toISOString(),
        Math.max(data.bucketSeconds, data.activeBucketSeconds))));
      if (!p && !a) tip.appendChild(el("span", null, "No data for this time"));
      if (p) {
        tip.appendChild(el("span", null, "Online: " + p.average + " average, " + p.peak + " peak"));
      }
      if (a) {
        tip.appendChild(el("span", null, "Active hunters (" + (data.activeBucketSeconds >= 604800 ? "week" :
          data.activeBucketSeconds >= 86400 ? "day" : "hour") + "): " + a.hunters));
      }
      tip.hidden = false;
      var left = (px / width) * rect.width;
      tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 10)) + "px";
    }

    hit.addEventListener("mousemove", function (e) { move(e.clientX); });
    hit.addEventListener("touchstart", function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    hit.addEventListener("touchmove", function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    hit.addEventListener("mouseleave", function () { tip.hidden = true; cursor.setAttribute("visibility", "hidden"); });
  }

  /* ---------- summary and table ---------- */

  function renderSummary() {
    var d = state.data;
    var cards = [
      ["Online now", d.onlineNow],
      ["Peak online", d.peak],
      ["Average online", d.average],
      ["Players in range", d.playerTotal]
    ];
    var grid = $("history-stats");
    clear(grid);
    cards.forEach(function (c) {
      var card = el("div", "stat-card");
      card.appendChild(el("span", "stat-label", c[0]));
      card.appendChild(el("span", "stat-value", Number(c[1]).toLocaleString()));
      grid.appendChild(card);
    });

    var since = d.trackingSince ? new Date(d.trackingSince).toLocaleString(undefined,
      { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
    var note = since
      ? "Online counts are sampled every minute since " + since + ". Bars: hunters active in the hunt log."
      : "Online counts start with the first sample, within a minute of this update. Bars: hunters active in the hunt log.";
    $("history-note").textContent = note;
    $("players-note").textContent = (d.playerTotal > d.players.length
      ? "Showing the " + d.players.length + " most recent of " + d.playerTotal.toLocaleString() + " players. "
      : "") + "Play time is the game's own counter. Sessions and time online are counted since " +
      (since || "tracking began") + "; a dash means the player was not seen since then.";
  }

  function renderPlayers() {
    var body = $("history-players");
    clear(body);
    var q = state.query;
    var rows = state.data.players.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1; });
    if (!rows.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", q ? "No player matches that name." : "Nobody played in this range.");
      cell.colSpan = 6;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    rows.forEach(function (p) {
      var row = el("tr");
      var nameCell = el("td", "cell-name");
      var link = el("a", null, p.name);
      link.href = "/hunters.html?id=" + p.characterId;
      nameCell.appendChild(link);
      nameCell.appendChild(el("span", "cell-sub", "HR " + p.hr + (p.gr ? " · GR " + p.gr : "")));
      row.appendChild(nameCell);

      var play = el("td", "num", duration(p.playtimeSeconds));
      play.setAttribute("data-sort", p.playtimeSeconds === null ? "-1" : String(p.playtimeSeconds));
      row.appendChild(play);

      var sessions = el("td", "num", p.sessions === null || p.sessions === undefined ? "-" : String(p.sessions));
      sessions.setAttribute("data-sort", p.sessions === null || p.sessions === undefined ? "-1" : String(p.sessions));
      row.appendChild(sessions);

      var inRange = el("td", "num", p.secondsInRange === null || p.secondsInRange === undefined ? "-" : duration(p.secondsInRange));
      inRange.setAttribute("data-sort", p.secondsInRange === null || p.secondsInRange === undefined ? "-1" : String(p.secondsInRange));
      row.appendChild(inRange);

      var seen = el("td", null, p.online ? "Now" : ago(p.lastSeen));
      seen.setAttribute("data-sort", p.lastSeen || "");
      if (p.lastSeen) seen.title = new Date(p.lastSeen).toLocaleString();
      row.appendChild(seen);

      var status = el("td");
      status.appendChild(el("span", p.online ? "badge good" : "badge", p.online ? "Online" : "Offline"));
      status.setAttribute("data-sort", p.online ? "1" : "0");
      row.appendChild(status);
      body.appendChild(row);
    });
  }

  /* ---------- loading ---------- */

  function setRange(range) {
    state.range = range;
    Array.prototype.forEach.call(document.querySelectorAll("#history-ranges .chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute("data-range") === range ? "true" : "false");
    });
    if (history.replaceState) history.replaceState(null, "", "#history=" + range);
    load();
  }

  function load() {
    var range = state.range;
    $("history-chart").classList.add("is-loading");
    fetch(API + "/api/public/worlds/history?range=" + encodeURIComponent(range), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        if (range !== state.range) return;
        state.data = data;
        $("history-alert").hidden = true;
        $("history-chart").classList.remove("is-loading");
        renderSummary();
        drawChart();
        renderPlayers();
        $("history-updated").textContent = "updated " + new Date().toLocaleTimeString();
      })
      .catch(function () {
        $("history-chart").classList.remove("is-loading");
        var alert = $("history-alert");
        alert.textContent = "The player history could not be loaded right now. Try again in a moment.";
        alert.hidden = false;
      });
  }

  function init() {
    var chips = $("history-ranges");
    RANGES.forEach(function (r) {
      var chip = el("button", "chip", r[1]);
      chip.type = "button";
      chip.setAttribute("data-range", r[0]);
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", function () { setRange(r[0]); });
      chips.appendChild(chip);
    });
    var timer = null;
    $("history-search").addEventListener("input", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        state.query = $("history-search").value.trim().toLowerCase();
        if (state.data) renderPlayers();
      }, 120);
    });
    var resize = null;
    window.addEventListener("resize", function () {
      if (resize) clearTimeout(resize);
      resize = setTimeout(drawChart, 150);
    });
    var match = /history=(24h|7d|30d|90d|all)/.exec(location.hash);
    setRange(match ? match[1] : "24h");
    setInterval(function () {
      if (document.visibilityState === "visible" && state.range === "24h") load();
    }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
