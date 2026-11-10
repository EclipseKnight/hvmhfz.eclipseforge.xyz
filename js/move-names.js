/* Move names: the plain name, how sure it is, what the move is, its input and where the name comes from.
 * Shared by the weapons page (move list and calculator), the admin Balance grid and the public balance page.
 * The data is per move in data/weapons/<type>.json (dev/make-weapons-data.py, from hvmhfz_re
 * data/move_names.tsv): name, desc, input, conf (confirmed / likely / guess / unknown), src (source keys).
 * An unknown move has no name: it shows its id and "unnamed". Also runs under node (the pure part). */
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

  var pure = { CONF: CONF, ORDER: ORDER, conf: conf, name: name, source: source, sources: sources, searchText: searchText, title: title };
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
    var d = opts.detail === false ? null : detail(m, opts.slug);
    if (d) box.appendChild(d);
    return box;
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
    return p;
  }

  window.HvMoveNames = Object.assign({ badge: badge, detail: detail, fill: fill, legend: legend }, pure);
})();
