/* Times in the viewer's own time zone (HvTime). Every page that shows a time loads this before its own
   scripts and formats through it: "12 Nov 2026, 15:12 CET" in the browser's zone, or in UTC when the
   visitor picks "Times: UTC" in the footer (remembered in localStorage "hv-times"). A <time> made here
   carries the instant in datetime and the UTC time in its title, and follows the footer choice at once;
   plain text made here follows it the next time the page draws it.

   HvTime.text(value, opts)   the time as text. value: ISO text, Date or ms. opts (all optional):
                              date (true; "weekday": the weekday only), time (true), year (true; "auto": only when not this year),
                              weekday (false), zone (true: the short zone name after the time).
   HvTime.utc(value, opts)    the same, always in UTC ("12 Nov 2026, 14:12 UTC").
   HvTime.node(value, opts, tag)  a <time datetime title> with that text (tag: another element name).
   HvTime.set(node, value, opts)  makes an existing element such a time.
   HvTime.relative(value, now)    "in 3 h", "5 min ago", "just now".
   HvTime.boundary(value, label, offsetHours)  a moment defined in a fixed zone, said both ways:
                              "09:00 your time (00:00 JST)"; 4th argument: opts as text() (default
                              { date: false }; date: "weekday" gives "Sun 16:00 your time (Mon 00:00 JST)").
   HvTime.mode() / setMode("local" | "utc"), HvTime.zoneName(value), HvTime.refresh(root). */
(function () {
  "use strict";

  var KEY = "hv-times";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var cache = {};

  function mode() {
    try { return localStorage.getItem(KEY) === "utc" ? "utc" : "local"; } catch (e) { return "local"; }
  }

  // The zone the page shows: undefined = the browser's own.
  function zone(forceUtc) {
    return forceUtc || mode() === "utc" ? "UTC" : undefined;
  }

  function parse(value) {
    if (value === null || value === undefined || value === "") return NaN;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    return Date.parse(value);
  }

  function formatter(locale, options) {
    var key = locale + JSON.stringify(options);
    if (!cache[key]) cache[key] = new Intl.DateTimeFormat(locale, options);
    return cache[key];
  }

  function parts(ms, tz) {
    var out = {};
    formatter("en-GB", { year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit",
      minute: "2-digit", hourCycle: "h23", timeZone: tz }).formatToParts(new Date(ms)).forEach(function (p) {
      out[p.type] = p.value;
    });
    return out;
  }

  // "CET", "PST" for a zone (undefined: the browser's own); "GMT+9" only when no locale knows a better name.
  function nameOf(ms, tz) {
    if (tz === "UTC") return "UTC";
    var locales = [], first = "";
    if (typeof navigator !== "undefined" && navigator.language) locales.push(navigator.language);
    locales.push("en-US", "en-GB");
    for (var i = 0; i < locales.length; i++) {
      var name = "";
      try {
        formatter(locales[i], { timeZoneName: "short", timeZone: tz }).formatToParts(new Date(ms)).forEach(function (p) {
          if (p.type === "timeZoneName") name = p.value;
        });
      } catch (e) { continue; }
      if (!first) first = name;
      if (name && !/^(GMT|UTC)[+\-\u2212]/.test(name)) return name;
    }
    return first.replace("\u2212", "-") || "local time";
  }

  function zoneName(value, forceUtc) {
    var ms = parse(value);
    return nameOf(isNaN(ms) ? Date.now() : ms, zone(forceUtc));
  }

  function text(value, opts, forceUtc) {
    var ms = parse(value);
    if (isNaN(ms)) return "";
    opts = opts || {};
    var p = parts(ms, zone(forceUtc));
    var bits = [];
    if (opts.date === "weekday") bits.push(p.weekday);
    else if (opts.date !== false) {
      var d = (opts.weekday ? p.weekday + " " : "") + Number(p.day) + " " + MONTHS[Number(p.month) - 1];
      var year = opts.year === undefined ? true : opts.year;
      if (year === "auto") year = p.year !== parts(Date.now(), zone(forceUtc)).year;
      if (year) d += " " + p.year;
      bits.push(d);
    }
    if (opts.time !== false) {
      var t = (p.hour === "24" ? "00" : p.hour) + ":" + p.minute;
      if (opts.zone !== false) t += " " + zoneName(ms, forceUtc);
      bits.push(t);
    }
    return bits.join(opts.date === "weekday" ? " " : ", ");
  }

  function utc(value, opts) { return text(value, opts, true); }

  function set(node, value, opts) {
    var ms = parse(value);
    if (isNaN(ms)) { node.textContent = "-"; return node; }
    opts = opts || {};
    node.setAttribute("data-hv-time", JSON.stringify(opts));
    if (node.tagName === "TIME") {
      // keep a datetime the page wrote that already names this moment (the changelog's "...T19:36Z")
      if (parse(node.getAttribute("datetime")) !== ms) node.setAttribute("datetime", new Date(ms).toISOString());
    }
    else node.setAttribute("data-time", new Date(ms).toISOString());
    node.textContent = text(ms, opts);
    node.title = utc(ms, { weekday: opts.weekday }); // the full UTC date and time, whatever the text leaves out
    return node;
  }

  function node(value, opts, tag) {
    return set(document.createElement(tag || "time"), value, opts);
  }

  function relative(value, now) {
    var ms = parse(value);
    if (isNaN(ms)) return "";
    var diff = ms - (now === undefined ? Date.now() : parse(now));
    var s = Math.abs(diff) / 1000;
    if (s < 60) return "just now";
    var amount = s < 3600 ? Math.round(s / 60) + " min" : s < 172800 ? Math.round(s / 3600) + " h"
      : Math.round(s / 86400) + " days";
    return diff > 0 ? "in " + amount : amount + " ago";
  }

  // A moment defined in a fixed zone (label, offset in hours from UTC), e.g. a reset at 00:00 JST:
  // "09:00 your time (00:00 JST)", or with the date: "Fri 6 Nov, 01:00 your time (Fri 6 Nov, 00:00 JST)".
  function boundary(value, label, offsetHours, opts) {
    var ms = parse(value);
    if (isNaN(ms)) return "";
    opts = opts || { date: false };
    var fixed = parts(ms + offsetHours * 3600000, "UTC");
    var there = (fixed.hour === "24" ? "00" : fixed.hour) + ":" + fixed.minute + " " + label;
    if (opts.date === "weekday") there = fixed.weekday + " " + there;
    else if (opts.date !== false) {
      there = (opts.weekday ? fixed.weekday + " " : "") + Number(fixed.day) + " " + MONTHS[Number(fixed.month) - 1] +
        (opts.year ? " " + fixed.year : "") + ", " + there;
    }
    var o = { date: opts.date, weekday: opts.weekday, year: opts.year || false, zone: false };
    var here = text(ms, o) + (mode() === "utc" ? " UTC" : " your time");
    if (label === "UTC" && mode() === "utc") return here;
    return here + " (" + there + ")";
  }

  function refresh(root) {
    var list = (root || document).querySelectorAll("[data-hv-time]");
    Array.prototype.forEach.call(list, function (n) {
      var opts = {};
      try { opts = JSON.parse(n.getAttribute("data-hv-time")) || {}; } catch (e) { /* keep {} */ }
      set(n, n.getAttribute("datetime") || n.getAttribute("data-time"), opts);
    });
  }

  function setMode(value) {
    try {
      if (value === "utc") localStorage.setItem(KEY, "utc"); else localStorage.removeItem(KEY);
    } catch (e) { /* private mode: this page only */ }
    refresh(document);
    try { document.dispatchEvent(new CustomEvent("hv-times", { detail: { mode: mode() } })); } catch (e) { /* old browser */ }
  }

  // The footer setting: "Times: my timezone (CET) / UTC".
  function addSetting() {
    var foot = document.querySelector("footer.site-foot .wrap");
    if (!foot || document.getElementById("hv-times")) return;
    var p = document.createElement("p");
    p.className = "foot-times";
    var label = document.createElement("label");
    label.htmlFor = "hv-times";
    label.textContent = "Times: ";
    var select = document.createElement("select");
    select.id = "hv-times";
    [["local", "my timezone (" + nameOf(Date.now(), undefined) + ")"], ["utc", "UTC"]].forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o[0];
      opt.textContent = o[1];
      select.appendChild(opt);
    });
    select.value = mode();
    select.addEventListener("change", function () { setMode(select.value); });
    p.appendChild(label);
    p.appendChild(select);
    foot.appendChild(p);
  }

  var api = { text: text, utc: utc, node: node, set: set, relative: relative, boundary: boundary, mode: mode,
    setMode: setMode, zoneName: zoneName, refresh: refresh, parse: parse };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined") return;
  window.HvTime = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addSetting);
  else addSetting();
})();
