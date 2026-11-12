/* Weapons page: the Database / Usage tabs, and the Usage tab itself.
 *
 * Data: GET /api/public/weapons/usage (public, counts only, computed at most once an hour; API README
 * "Weapon usage"):
 *   { generatedAt, playedSince, bands: [5 labels], styles: ["Earth","Heaven","Storm","Extreme"],
 *     windows: [ { days: 7|30, hunters, bands: [5], styles: [4],
 *                  weapons: [ { weaponType, weapon, current, played, bands: [5], styles: [4] } x14 ] } ] }
 * current = hunters active in the window, by the weapon of their last save (bands and styles split it;
 * styles can sum to less); played = hunters seen online with the weapon in the window (one hunter can count
 * under several). Neither played nor styles is split by band, so a band filter hides them.
 * A 404 (endpoint not deployed) or no answer shows a message instead; the Database tab is unaffected.
 *
 * URL: #usage opens the Usage tab; anything else is the Database tab.
 * HvWeaponsUsage.view() is the pure part, tested by dev/check-weapons.js.
 */
(function (root) {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var PATH = "/api/public/weapons/usage";
  // By weaponType (the game's weapon class): the Database tab's type slug and the class icon's name.
  var TYPES = [
    ["great-sword", "great-sword"], ["heavy-bowgun", "heavy-bowgun"], ["hammer", "hammer"], ["lance", "lance"],
    ["sword-and-shield", "sword-and-shield"], ["light-bowgun", "light-bowgun"], ["dual-swords", "dual-blades"],
    ["long-sword", "long-sword"], ["hunting-horn", "hunting-horn"], ["gunlance", "gunlance"], ["bow", "bow"],
    ["tonfa", "tonfa"], ["switch-axe-f", "switch-axe"], ["magnet-spike", "magnet-spike"]
  ];

  function sum(list) { return (list || []).reduce(function (a, b) { return a + (Number(b) || 0); }, 0); }

  /** A share as text: "26%", "<1%" for a small non-zero one, "0%". */
  function pct(n, total) {
    if (!total || !n) return "0%";
    var p = (n / total) * 100;
    return p < 1 ? "<1%" : Math.round(p) + "%";
  }

  /**
   * What the tab shows for one window and band (band -1 = all hunters): the rows most used first, each
   * with current, share, played and styles (played and styles null when a band is picked or not known).
   * Returns null when the answer has no such window.
   */
  function view(data, days, band) {
    var win = ((data && data.windows) || []).filter(function (w) { return w.days === days; })[0];
    if (!win) return null;
    var all = band < 0;
    var rows = (win.weapons || []).map(function (w) {
      return {
        type: w.weaponType, name: w.weapon,
        current: all ? w.current : (w.bands || [])[band] || 0,
        played: all && data.playedSince ? w.played : null,
        styles: all ? w.styles : null
      };
    });
    var total = sum(rows.map(function (r) { return r.current; }));
    rows.forEach(function (r) { r.share = pct(r.current, total); });
    rows.sort(function (a, b) {
      return (b.current - a.current) || ((b.played || 0) - (a.played || 0)) || (a.type - b.type);
    });
    return {
      days: days, band: band,
      hunters: all ? win.hunters : (win.bands || [])[band] || 0,
      total: total,
      max: rows.reduce(function (m, r) { return Math.max(m, r.current); }, 0),
      styles: all ? win.styles : null,
      rows: rows
    };
  }

  var api = { view: view, pct: pct, TYPES: TYPES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvWeaponsUsage = api;
  if (typeof document === "undefined" || !document.getElementById("panel-usage")) return;

  var $ = function (id) { return document.getElementById(id); };
  var STYLE_CLASSES = ["is-earth", "is-heaven", "is-storm", "is-extreme"];
  var data = null, loading = false;
  var state = { days: 7, band: -1 };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function when(iso) {
    var d = new Date(iso);
    if (window.HvTime && !isNaN(d)) return HvTime.text(d);
    return isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function hunters(n) { return n.toLocaleString("en-US") + (n === 1 ? " hunter" : " hunters"); }

  /* ---------- tabs ---------- */

  var tabs = ["database", "usage"];

  function showTab(name, focus) {
    tabs.forEach(function (t) {
      var on = t === name;
      $("tab-" + t).setAttribute("aria-selected", String(on));
      $("tab-" + t).tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
    });
    if (focus) $("tab-" + name).focus();
    if (name === "usage" && !data && !loading) load();
  }

  function fromHash() { showTab(location.hash === "#usage" ? "usage" : "database", false); }

  tabs.forEach(function (t, i) {
    var tab = $("tab-" + t);
    tab.addEventListener("click", function (e) {
      e.preventDefault();
      // Keeps ?type=&w= of the Database tab; #usage makes the Usage tab a link of its own.
      history.replaceState(null, "", location.pathname + location.search + (t === "usage" ? "#usage" : ""));
      showTab(t, false);
    });
    tab.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      $("tab-" + tabs[(i + step + tabs.length) % tabs.length]).click();
      $("tab-" + tabs[(i + step + tabs.length) % tabs.length]).focus();
    });
  });
  window.addEventListener("hashchange", fromHash);

  /* ---------- loading ---------- */

  function message(text, retry) {
    var box = $("wu-msg");
    box.textContent = text;
    if (retry) {
      var b = el("button", "ghost-btn small wu-retry", "Try again");
      b.type = "button";
      b.addEventListener("click", load);
      box.appendChild(document.createTextNode(" "));
      box.appendChild(b);
    }
    box.hidden = false;
    $("wu-body").hidden = true;
  }

  function load() {
    loading = true;
    $("wu-msg").hidden = true;
    $("wu-loading").hidden = false;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    fetch(API + PATH, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      if (r.status === 404) throw { gone: true };
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || !Array.isArray(d.windows) || !d.windows.length) throw new Error("no windows");
      data = d;
      fillBands();
      render();
    }).catch(function (e) {
      message(e && e.gone
        ? "Usage stats are not published yet. They will show here once the server starts counting them."
        : "Usage stats could not be loaded right now: the server did not answer. The weapon list and calculator still work.",
        !(e && e.gone));
    }).then(function () {
      if (timer) clearTimeout(timer);
      loading = false;
      $("wu-loading").hidden = true;
    });
  }

  /* ---------- the tab ---------- */

  function fillBands() {
    var sel = $("wu-band");
    while (sel.options.length > 1) sel.remove(1);
    (data.bands || []).forEach(function (label, i) {
      var o = el("option", null, label);
      o.value = String(i);
      sel.appendChild(o);
    });
    var days = data.windows.map(function (w) { return w.days; });
    if (days.indexOf(state.days) < 0) state.days = days[0];
    Array.prototype.forEach.call(document.querySelectorAll("#wu-days .chip"), function (b) {
      b.hidden = days.indexOf(Number(b.dataset.days)) < 0;
    });
  }

  /** A small stacked bar of the four styles; the part no style was read for stays empty. */
  function styleBar(styles, of) {
    var names = data.styles || [];
    var bar = el("span", "wu-styles");
    var parts = [];
    (styles || []).forEach(function (n, i) {
      if (!n) return;
      var seg = el("span", "wu-seg " + (STYLE_CLASSES[i] || ""));
      seg.style.width = (of ? (n / of) * 100 : 0) + "%";
      bar.appendChild(seg);
      parts.push((names[i] || "Style " + i) + " " + n);
    });
    var unknown = of - sum(styles);
    if (unknown > 0) parts.push("not read " + unknown);
    var text = parts.length ? "Styles: " + parts.join(", ") : "Styles: none";
    bar.title = text;
    var wrap = el("span", "wu-style-cell");
    var hid = el("span", "visually-hidden", text);
    bar.setAttribute("aria-hidden", "true");
    wrap.appendChild(bar);
    wrap.appendChild(hid);
    return wrap;
  }

  function render() {
    var v = view(data, state.days, state.band);
    if (!v) { message("This period is not in the server's answer.", false); return; }
    $("wu-body").hidden = false;
    $("wu-msg").hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll("#wu-days .chip"), function (b) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.days) === v.days));
    });
    $("wu-updated").textContent = data.generatedAt ? "Updated " + when(data.generatedAt) : "";
    var bandName = v.band >= 0 ? (data.bands || [])[v.band] : null;
    var top = v.rows[0] && v.rows[0].current ? v.rows[0] : null;
    $("wu-summary").textContent = hunters(v.hunters) + (bandName ? " in " + bandName : "") +
      " logged in during the last " + v.days + " days. " +
      (top ? "Most used now: " + top.name + " (" + top.current + ", " + top.share + ")." : "No weapon counted yet.");

    var notes = [];
    if (bandName) notes.push("Played and the style split are counted for all hunters, not per band, so they are hidden while a band is picked.");
    else if (!data.playedSince) notes.push("Played counts start once the server records weapons played; until then they show as a dash.");
    else if (new Date(data.playedSince) > new Date(new Date(data.generatedAt || Date.now()).getTime() - v.days * 86400000)) {
      notes.push("Played counts only go back to " + when(data.playedSince) + ", when the server started recording them.");
    }
    $("wu-note").textContent = notes.join(" ");
    $("wu-note").hidden = !notes.length;

    var overall = $("wu-overall");
    overall.textContent = "";
    if (v.styles) {
      overall.appendChild(el("span", "wu-overall-label", "All weapons"));
      overall.appendChild(styleBar(v.styles, v.total));
      var figures = el("span", "wu-overall-text");
      figures.textContent = (data.styles || []).map(function (s, i) { return s + " " + pct(v.styles[i], v.total); }).join(" · ");
      overall.appendChild(figures);
    }
    overall.hidden = !v.styles;
    $("wu-legend").hidden = !v.styles;
    $("wu-body").classList.toggle("is-banded", !v.styles);

    var list = $("wu-list");
    list.textContent = "";
    v.rows.forEach(function (r) {
      var li = el("li", "wu-row" + (r.current ? "" : " is-zero"));
      var name = el("span", "wu-name");
      var t = TYPES[r.type];
      if (t) {
        var icon = document.createElement("img");
        icon.className = "weapon-icon";
        icon.src = "/assets/icons/1x/" + t[1] + "-0.png";
        icon.srcset = "/assets/icons/2x/" + t[1] + "-0.png 2x";
        icon.alt = "";
        icon.width = icon.height = 18;
        name.appendChild(icon);
        var a = el("a", null, r.name);
        a.href = "/weapons.html?type=" + t[0];
        name.appendChild(a);
      } else {
        name.appendChild(document.createTextNode(r.name));
      }
      li.appendChild(name);
      var track = el("span", "wb-track wu-bar");
      track.setAttribute("aria-hidden", "true");
      var fill = el("span", "wb-fill");
      fill.style.width = v.max ? Math.max(r.current ? 1.5 : 0, (r.current / v.max) * 100) + "%" : "0";
      track.appendChild(fill);
      li.appendChild(track);
      var cur = el("span", "wu-current");
      cur.appendChild(el("strong", null, r.current.toLocaleString("en-US")));
      cur.appendChild(document.createTextNode(" · " + r.share));
      cur.appendChild(el("span", "visually-hidden", " of hunters by current weapon"));
      li.appendChild(cur);
      if (v.styles) {
        li.appendChild(el("span", "wu-played", "played " + (r.played === null ? "–" : r.played.toLocaleString("en-US"))));
        li.appendChild(r.current ? styleBar(r.styles, r.current) : el("span", "wu-style-cell"));
      }
      list.appendChild(li);
    });
  }

  $("wu-days").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b || !data) return;
    state.days = Number(b.dataset.days);
    render();
  });
  $("wu-band").addEventListener("change", function () {
    state.band = this.value === "" ? -1 : Number(this.value);
    if (data) render();
  });

  fromHash();
})(typeof window !== "undefined" ? window : this);
