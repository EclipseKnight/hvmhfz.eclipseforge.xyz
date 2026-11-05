/* The Road builder's "?" circles (road.html): only on the fields whose meaning isn't plain from the label
   (Checks, the solo Road tick, Second monster, Weight, Forced, Level); the rest is in the "How the Road builder
   works" note at the top of the page. Same markup as the admin Events tab's (css .help-tip, quieter here: css .road-page .help-tip): hover or keyboard focus shows the text, a
   tap or click keeps it open, a second tap, a tap elsewhere or Escape closes it. The text box sits on the
   page (position: fixed), so a table's scroll box never cuts it off.

   Where the circles go: every element with data-help="<key>" in road.html, and the column headers of the
   entry tables js/road.js draws (by their text, COLUMNS below). On a phone those tables become cards with no
   header row, so road.html also has a key of the columns (.road-key-phones) with the same circles.

   What the Road fields mean comes from the client (hvmhfz_re docs/rengoku-data.md and the client's
   mhfemd.bin for the level; see js/road-rules.js levelChoices). HELP is exported for dev/check-road-help.js. */
(function () {
  "use strict";

  var HELP = {
    checks: "The rules a Road must pass. Some keep the game from crashing (every floor's table must exist, every table needs at least 3 different monsters it can draw, at most one forced entry per table); the others are this rotation's limits. A Road with a problem can't be submitted.",
    solo: "The Hunting Road has two modes: the open Road (mode 0), which you can play with others, and the solo Road (mode 1), played alone. Tick this to change the solo Road too; untick it to drop those changes.",
    monster2: "A second large monster in the same fight, or None for one monster. Only a few live entries have one.",
    weight: "How likely the game is to offer this entry: its weight against the total weight of the entries the table can still draw. 0 means never drawn, unless forced. Up to the rotation's maximum weight.",
    forced: "Always offered on the floors that use this table, whatever its weight (it is drawn first). At most one forced entry per table. The live Road forces White Fatalis, at weight 0, on every 10th floor.",
    level: "The monster's strength level: it sets its health, attack and toughness. The live Road uses 53 on the open Road, 77 for some newer monsters there (about 60% of the health), 78 on the solo Road (about 60% again) and 64 to 67 for Zenith monsters (each level hits harder and takes less damage). You can pick any level from 0 to 83; the levels the live Road uses with this monster are listed first, and at another level the game may have no stats for it, so it plays at its base strength, far weaker. Locked when the rotation doesn't allow changing levels."
  };

  // The entry tables' column headers (js/road.js drawTableBody) -> HELP key.
  var COLUMNS = {
    "Second monster": "monster2", "Weight": "weight", "Forced": "forced", "Level": "level"
  };

  var seq = 0;
  var openTip = null; // {button, pop, pinned}

  function place(tip) {
    var r = tip.button.getBoundingClientRect();
    var width = Math.min(320, window.innerWidth - 16);
    var pop = tip.pop;
    pop.style.width = width + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + "px";
    var top = r.bottom + 6;
    var height = pop.offsetHeight;
    if (top + height > window.innerHeight - 8 && r.top - 6 - height >= 8) top = r.top - 6 - height;
    pop.style.top = top + "px";
  }

  function hide() {
    if (!openTip) return;
    openTip.pop.classList.remove("is-open");
    openTip.button.setAttribute("aria-expanded", "false");
    openTip = null;
  }

  function show(tip, pinned) {
    if (openTip && openTip.button !== tip.button) hide();
    tip.pinned = pinned;
    tip.pop.classList.add("is-open");
    tip.button.setAttribute("aria-expanded", String(pinned));
    openTip = tip;
    place(tip);
  }

  // A "?" button for HELP[key], named after the field it explains.
  function makeTip(key, name) {
    var text = HELP[key];
    if (!text) return null;
    var id = "road-help-" + (++seq);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "help-tip";
    button.textContent = "?";
    button.setAttribute("data-help-key", key);
    button.setAttribute("aria-label", "What is \"" + name + "\"?");
    button.setAttribute("aria-describedby", id);
    button.setAttribute("aria-expanded", "false");
    var pop = document.createElement("span");
    pop.className = "help-pop is-fixed";
    pop.id = id;
    pop.setAttribute("role", "tooltip");
    pop.textContent = text;
    document.body.appendChild(pop);
    var tip = { button: button, pop: pop, pinned: false };
    button.addEventListener("mouseenter", function () { if (!(openTip && openTip.pinned)) show(tip, false); });
    button.addEventListener("focus", function () { if (!(openTip && openTip.pinned)) show(tip, false); });
    ["mouseleave", "blur"].forEach(function (type) {
      button.addEventListener(type, function () { if (openTip === tip && !tip.pinned) hide(); });
    });
    button.addEventListener("click", function (event) {
      event.preventDefault(); // inside a <summary> or <label>, the click must not toggle it
      event.stopPropagation();
      if (openTip === tip && tip.pinned) hide(); else show(tip, true);
    });
    return button;
  }

  function nameOf(node) {
    var copy = node.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll("input, select, textarea, .field-optional, .help-tip"), function (n) {
      n.parentNode.removeChild(n);
    });
    return copy.textContent.replace(/\s+/g, " ").trim();
  }

  // Puts the circle next to the element: a label is wrapped with it (the admin tab's .field-head), a button
  // gets it just after, anything else (headings, table headers, key items) gets it inside, at the end.
  function attach(node, key) {
    if (node.getAttribute("data-help-done")) return;
    var tip = makeTip(key, nameOf(node));
    if (!tip) return;
    node.setAttribute("data-help-done", "1");
    if (node.tagName === "LABEL") {
      var head = document.createElement("div");
      head.className = "field-head";
      node.parentNode.insertBefore(head, node);
      head.appendChild(node);
      head.appendChild(tip);
    } else if (node.tagName === "BUTTON") {
      node.parentNode.insertBefore(tip, node.nextSibling);
    } else {
      node.appendChild(tip);
    }
  }

  function decorate(root) {
    Array.prototype.forEach.call(root.querySelectorAll("[data-help]"), function (node) {
      attach(node, node.getAttribute("data-help"));
    });
    Array.prototype.forEach.call(root.querySelectorAll("table.road-entries thead th"), function (th) {
      var key = COLUMNS[th.textContent.trim()];
      if (key) attach(th, key);
    });
  }

  function start() {
    decorate(document);
    var tables = document.getElementById("road-tables");
    if (tables && window.MutationObserver) {
      new MutationObserver(function () { decorate(tables); }).observe(tables, { childList: true, subtree: true });
    }
    document.addEventListener("click", function (event) {
      if (openTip && !openTip.pop.contains(event.target)) hide();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && openTip) hide();
    });
    window.addEventListener("resize", function () { if (openTip) place(openTip); });
    window.addEventListener("scroll", function () { if (openTip) place(openTip); }, true);
  }

  window.RoadHelp = { HELP: HELP, COLUMNS: COLUMNS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
