/* Move names: the plain name, how sure it is, what the move is, its input and where the name comes from.
 * Shared by the weapons page (move list and calculator), the admin Balance grid and the public balance page.
 * The data is per move in data/weapons/<type>.json (dev/make-weapons-data.py, from hvmhfz_re
 * data/move_names.tsv): name, desc, input, conf (confirmed / likely / guess / unknown), src (source keys).
 * An unknown move has no name: it shows its id and "unnamed". Also runs under node (the pure part).
 * How each move is used (hvmhfz_re data/move_usage.tsv, docs/weapons.md 7.8; per move "use": {kind, how, sure,
 * parent} and "show"): a line under the move (kind badge, how, how sure); "show": "hide" moves the game never uses
 * are left out unless "Show unused and unknown moves" is on (?unused=1 in the URL, else localStorage hv-moves-unused;
 * off by default; moves not identified yet always show, marked), "fold" moves (later hits of their parent, no
 * input of their own) sit under their parent, behind a "+N later hits" button. */
(function () {
  "use strict";

  var CONF = {
    confirmed: { label: "confirmed", text: "the community's motion values match this move and the game's own data agrees" },
    likely: { label: "likely", text: "one clear match in the community's move lists, nothing in the game's data against it" },
    guess: { label: "guess", text: "a weak or partial match, or a name from the move's shape only" },
    unknown: { label: "unnamed", text: "not identified yet: the id is the game's own record" }
  };
  var ORDER = ["confirmed", "likely", "guess", "unknown"];

  /** How sure a move's name is: one of ORDER ("unknown" when the data says nothing). */
  function conf(m) {
    var c = m && m.conf;
    if (CONF[c]) return c;
    return m && m.name ? "guess" : "unknown";
  }

  /** The move's plain name, or null when it has none (unknown). */
  function name(m) {
    return m && m.name && conf(m) !== "unknown" ? String(m.name) : null;
  }

  /** A source key of the data as {label, href} (href null when there is nothing public to link). */
  function source(key, slug) {
    var at = /^atwiki:(\d+)$/.exec(key);
    if (at) return { label: "MHF-Z @ wiki (Japanese)", href: "https://web.archive.org/web/2024/https://w.atwiki.jp/giurasu/pages/" + at[1] + ".html" };
    if (key === "wycademy-calc") return { label: "Wycademy damage calculator", href: "https://wycademy.vercel.app/tools/calculator/damage" };
    if (key === "wycademy-notes") return { label: "Wycademy hunter notes", href: "https://wycademy.vercel.app/hunter-notes/weapons/" + (slug || "") };
    if (key === "vipwiki") return { label: "VIP stoic wiki (Japanese)", href: "https://wikiwiki.jp/vip-st/" };
    if (key === "client") return { label: "the game's own data (action table, in-game action guide)", href: null };
    return { label: "our study of the move records", href: null };
  }

  function sources(m, slug) {
    return (m && m.src || []).map(function (k) { return source(k, slug); });
  }

  /** Name, description and input in one lower-case string, for a search box. */
  function searchText(m) {
    return [name(m) || "", m && m.desc || "", m && m.input || ""].join(" ").toLowerCase();
  }

  /** The hover text: name, how sure, what it is, input. */
  function title(m) {
    var c = conf(m), parts = [];
    parts.push((name(m) || "Unnamed move") + " (" + CONF[c].label + ": " + CONF[c].text + ")");
    if (m && m.desc) parts.push(m.desc);
    if (m && m.input) parts.push("Input: " + m.input);
    return parts.join("\n");
  }

  // How a move is reached (move_usage.tsv "kind"): the badge and its hover text.
  var USE = {
    direct: { label: "own input", text: "started by its own button or input (from neutral, walking or a draw)" },
    combo: { label: "combo", text: "only reached from another move: the button pressed after it" },
    continuation: { label: "part of", text: "a later hit of another move: it comes with that move, no input of its own" },
    conditional: { label: "charge/state", text: "released by a charge level or a weapon state" },
    unreachable: { label: "not used", text: "the game never uses this record (an empty slot, or nothing in the game names it)" },
    unknown: { label: "not identified", text: "how the game reaches this record is not found yet" }
  };
  var USE_ORDER = ["direct", "combo", "continuation", "conditional", "unknown", "unreachable"];
  var SHOW_PARAM = "unused", SHOW_KEY = "hv-moves-unused";

  /** The move's usage ({kind, how, sure, parent}), or null when the data has none. */
  function usage(m) { return m && m.use && USE[m.use.kind] ? m.use : null; }

  /** The move's reference as the data's "parent" writes it: "k0:8". */
  function ref(m) { return (m.set || "k" + m.kind) + ":" + m.id; }

  /** Whether a move is left out: never used by the game ("show": "hide") and the toggle off. */
  function hidden(m, showAll) { return !showAll && !!m && m.show === "hide"; }

  /** The toggle's state: ?unused=1 / ?unused=0 in the URL first, else the stored choice; off by default. */
  function readShowAll(search, stored) {
    var v = /[?&]unused=([^&#]*)/.exec(search || "");
    if (v) return v[1] === "1";
    return stored === "1";
  }

  /** Groups a list in order: each later hit ("show": "fold") whose parent is in the list goes under that parent,
   * in the list's order; the rest (a later hit whose parent is not listed too) stand alone. moveOf(item) gives
   * the move of an item (default: the item is the move). Returns [{item, later: [item, ...]}]. */
  function fold(items, moveOf) {
    moveOf = moveOf || function (x) { return x; };
    var heads = {}, groups = [], by = {};
    items.forEach(function (it) { var m = moveOf(it); if (m && m.show !== "fold") heads[ref(m)] = true; });
    var under = items.map(function (it) {
      var m = moveOf(it), u = usage(m);
      return !!(m && m.show === "fold" && u && u.parent && heads[u.parent]);
    });
    items.forEach(function (it, i) {
      if (under[i]) return;
      var g = { item: it, later: [] };
      groups.push(g);
      var m = moveOf(it);
      if (m && !by[ref(m)]) by[ref(m)] = g;
    });
    items.forEach(function (it, i) { if (under[i]) by[usage(moveOf(it)).parent].later.push(it); });
    return groups;
  }

  var pure = { CONF: CONF, ORDER: ORDER, conf: conf, name: name, source: source, sources: sources, searchText: searchText, title: title,
    USE: USE, USE_ORDER: USE_ORDER, usage: usage, ref: ref, hidden: hidden, readShowAll: readShowAll, fold: fold };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /** The small confidence badge. */
  function badge(m) {
    var c = conf(m);
    var b = el("span", "badge mv-conf mv-" + c, CONF[c].label);
    b.title = CONF[c].label.charAt(0).toUpperCase() + CONF[c].label.slice(1) + ": " + CONF[c].text;
    return b;
  }

  /** The tap detail: what it is, the input, the sources (linked). Null when there is nothing to show. */
  function detail(m, slug) {
    var src = sources(m, slug);
    if (!m || (!m.desc && !m.input && !src.length)) return null;
    var d = el("details", "mv-more");
    d.appendChild(el("summary", "", m.input ? "Input: " + m.input : "What it is"));
    if (m.desc) d.appendChild(el("p", "mv-desc", m.desc));
    if (src.length) {
      var p = el("p", "mv-src");
      p.appendChild(document.createTextNode("Source: "));
      src.forEach(function (s, i) {
        if (i) p.appendChild(document.createTextNode(", "));
        if (s.href) {
          var a = el("a", "", s.label);
          a.href = s.href;
          a.target = "_blank";
          a.rel = "noopener";
          p.appendChild(a);
        } else p.appendChild(document.createTextNode(s.label));
      });
      d.appendChild(p);
    }
    return d;
  }

  /** The move as shown in a list: the name first (or the id), the badge, the id small, then the detail. */
  function fill(box, m, ref, opts) {
    opts = opts || {};
    var n = name(m);
    var line = el("span", "mv-line");
    line.appendChild(el("span", "mv-name" + (n ? "" : " is-unnamed"), n || ref));
    line.appendChild(document.createTextNode(" "));
    line.appendChild(badge(m));
    if (n) line.appendChild(el("span", "mv-id", ref));
    line.title = title(m);
    box.appendChild(line);
    var u = opts.use === false ? null : useLine(m, opts.parent);
    if (u) box.appendChild(u);
    var d = opts.detail === false ? null : detail(m, opts.slug);
    if (d) box.appendChild(d);
    return box;
  }

  /** The line under a move: how it is used (kind badge, how, how sure). parent: the move a later hit belongs to
   * (for "part of <name>"), when known. A long text shows two lines; a tap shows all of it. Null without data. */
  function useLine(m, parent) {
    var u = usage(m);
    if (!u) return null;
    var box = el("div", "mv-use");
    var label = u.kind === "continuation" ? "part of " + (parent ? name(parent) || ref(parent) : u.parent || "another move") : USE[u.kind].label;
    var b = el("span", "badge mv-kind mv-kind-" + u.kind, label);
    b.title = USE[u.kind].label.charAt(0).toUpperCase() + USE[u.kind].label.slice(1) + ": " + USE[u.kind].text;
    box.appendChild(b);
    box.appendChild(document.createTextNode(" "));
    box.appendChild(el("span", "mv-how", u.how || ""));
    if (u.sure) box.appendChild(el("span", "mv-sure", " (" + u.sure + ")"));
    if ((u.how || "").length > 110) {
      box.classList.add("is-long");
      box.tabIndex = 0;
      box.setAttribute("role", "button");
      box.setAttribute("aria-expanded", "false");
      box.title = "Tap for the whole text";
      var flip = function () { box.setAttribute("aria-expanded", String(box.classList.toggle("is-open"))); };
      box.addEventListener("click", function (e) { if (e.target === b) return; flip(); });
      box.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    }
    return box;
  }

  /** The toggle's state on this page (URL, then localStorage). */
  function showAll() {
    var stored = null;
    try { stored = window.localStorage.getItem(SHOW_KEY); } catch (e) { /* storage off */ }
    return readShowAll(window.location.search, stored);
  }

  /** Remembers the toggle: localStorage, and ?unused=1 in the URL when on (nothing when off). */
  function setShowAll(on) {
    try { window.localStorage.setItem(SHOW_KEY, on ? "1" : "0"); } catch (e) { /* storage off */ }
    var u = new URL(window.location.href);
    if (on) u.searchParams.set(SHOW_PARAM, "1"); else u.searchParams.delete(SHOW_PARAM);
    window.history.replaceState(window.history.state, "", u);
  }

  /** The "Show unused and unknown moves" checkbox. onChange(on) redraws the page's lists; every toggle on the
   * page follows. setCount(n) says how many moves it hides now. */
  function toggle(onChange) {
    var lab = el("label", "mv-toggle");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = showAll();
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(" Show unused and unknown moves"));
    var hint = el("span", "mv-toggle-hint");
    lab.appendChild(hint);
    lab.title = "Off: the moves the game never uses are left out. Moves not identified yet always show, marked \"not identified\".";
    cb.addEventListener("change", function () {
      setShowAll(cb.checked);
      document.querySelectorAll(".mv-toggle input").forEach(function (o) { o.checked = cb.checked; });
      onChange(cb.checked);
    });
    lab.setCount = function (n) {
      hint.textContent = n ? " (" + n + " never used " + (n === 1 ? "move" : "moves") + " hidden)" : "";
    };
    return lab;
  }

  /** The "+N later hits" button of a parent row: shows or hides `rows` (its later hits). onChange(open). */
  function foldButton(rows, open, onChange) {
    var b = el("button", "mv-fold");
    b.type = "button";
    var set = function (o) {
      b.setAttribute("aria-expanded", String(o));
      b.textContent = (o ? "Hide " : "+") + rows.length + " later " + (rows.length === 1 ? "hit" : "hits");
      rows.forEach(function (r) { r.hidden = !o; });
    };
    set(!!open);
    b.title = "Later hits of this move: they come with it, no input of their own";
    b.addEventListener("click", function () { open = !open; set(open); if (onChange) onChange(open); });
    return b;
  }

  /** The legend of the badges, one line. */
  function legend() {
    var p = el("p", "mv-legend");
    p.appendChild(el("span", "mv-legend-h", "How sure a name is:"));
    ORDER.forEach(function (c) {
      var item = el("span", "mv-legend-item");
      item.appendChild(badge({ conf: c, name: c === "unknown" ? "" : "x" }));
      item.appendChild(document.createTextNode(" " + CONF[c].text));
      p.appendChild(item);
    });
    p.appendChild(el("span", "mv-legend-item", "Nothing here was checked in game. Tap a move for what it is, its input and where the name comes from."));
    p.appendChild(el("span", "mv-legend-h", "How it is used:"));
    USE_ORDER.forEach(function (k) {
      var item = el("span", "mv-legend-item"), b = el("span", "badge mv-kind mv-kind-" + k, USE[k].label);
      item.appendChild(b);
      item.appendChild(document.createTextNode(" " + USE[k].text));
      p.appendChild(item);
    });
    return p;
  }

  window.HvMoveNames = Object.assign({ badge: badge, detail: detail, fill: fill, legend: legend, useLine: useLine,
    showAll: showAll, setShowAll: setShowAll, toggle: toggle, foldButton: foldButton }, pure);
})();
