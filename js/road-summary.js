/* Hunting Road: every change a Road makes to the base, in words. Used by road.html (the builder, and an
   entry opened from the vote page) so a Road reads the same wherever it is shown; also runs under node
   (dev/check-road-summary.js).

   It compares two whole Roads, the base and the Road with the edits made (js/road-rules.js apply), so
   what it lists is what the game gets: a level copied for a new monster shows up too. Nothing in this
   file is game data. */
(function (root) {
  "use strict";

  var FLAG_FORCED = 2;
  // +0x04 of a Zenith monster (js/road-rules.js VARIANT_ZENITH): such an entry is named "Zenith <name>".
  var VARIANT_ZENITH = 16;

  var FLOOR_FIELDS = [
    ["table", "table"],
    ["loop", "loop"],
    ["points", "points multiplier"],
    ["points2", "second points multiplier"],
    ["bonus", "bonus"]
  ];

  var ENTRY_FIELDS = [
    ["weight", "weight"],
    ["level", "level"],
    ["unk04", "field unk04"],
    ["unk0c", "field unk0c"],
    ["unk14", "field unk14"]
  ];

  function modeTitle(m) { return m === 0 ? "Mode 0: open Road" : "Mode " + m + ": solo Road"; }

  // "Floors 1 to 9", "Floor 10", "Floor 50 and up": the floors one floor record covers, from the base.
  function floorLabel(floors, index) {
    var from = floors[index].floor;
    var next = floors[index + 1];
    if (!next) return "Floor " + from + " and up";
    return next.floor - 1 > from ? "Floors " + from + " to " + (next.floor - 1) : "Floor " + from;
  }

  function number(v) { return typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v); }

  function floorValue(field, v) {
    if (field === "loop") return v ? "on" : "off";
    if (field === "table") return "table " + v;
    return number(v);
  }

  function change(label, from, to) { return label + " " + from + " → " + to; }

  function floorLines(baseFloors, floors) {
    var lines = [];
    var shared = Math.min(baseFloors.length, floors.length);
    for (var i = 0; i < shared; i++) {
      var parts = [];
      FLOOR_FIELDS.forEach(function (f) {
        var a = baseFloors[i][f[0]];
        var b = floors[i][f[0]];
        if (a !== b) parts.push(f[0] === "table" ? floorValue("table", a) + " → " + b : change(f[1], floorValue(f[0], a), floorValue(f[0], b)));
      });
      if (parts.length) lines.push("Record " + (i + 1) + " (" + floorLabel(baseFloors, i).toLowerCase() + "): " + parts.join(", "));
    }
    if (floors.length < baseFloors.length) {
      lines.push("Floor records " + baseFloors.length + " → " + floors.length + ": " + (floors.length
        ? "the Road ends after record " + floors.length + " (" + floorLabel(baseFloors, floors.length - 1).toLowerCase() + ")."
        : "this mode has no floors left."));
    }
    return lines;
  }

  function named(nameOf, id) { return id ? nameOf(id) : "none"; }

  function zenith(en) { return en.unk04 === VARIANT_ZENITH; }

  // The entry's first monster in its form: "Zenith Rathalos" or "Rathalos".
  function first(en, nameOf) { return en.monster && zenith(en) ? "Zenith " + nameOf(en.monster) : named(nameOf, en.monster); }

  function pair(en, nameOf) {
    return first(en, nameOf) + (en.monster2 ? " with " + nameOf(en.monster2) : "");
  }

  function entryParts(a, b, nameOf) {
    var parts = [];
    var form = zenith(a) !== zenith(b);
    if (a.monster !== b.monster || form) parts.push(change("monster", first(a, nameOf), first(b, nameOf)));
    if (a.monster2 !== b.monster2) parts.push(change("second monster", named(nameOf, a.monster2), named(nameOf, b.monster2)));
    ENTRY_FIELDS.forEach(function (f) {
      // A change of form is the monster line above; its +0x04 (16 or not) says nothing more.
      if (f[0] === "unk04" && form) return;
      if (a[f[0]] !== b[f[0]]) parts.push(change(f[1], number(a[f[0]]), number(b[f[0]])));
    });
    var forcedA = (a.flags & FLAG_FORCED) !== 0;
    var forcedB = (b.flags & FLAG_FORCED) !== 0;
    if (forcedA !== forcedB) parts.push(forcedB ? "now forced" : "no longer forced");
    var restA = (a.flags & ~FLAG_FORCED) >>> 0;
    var restB = (b.flags & ~FLAG_FORCED) >>> 0;
    if (restA !== restB) parts.push(change("flags", restA, restB));
    return parts;
  }

  function newEntry(en, nameOf) {
    var parts = [pair(en, nameOf), "weight " + number(en.weight), "level " + number(en.level)];
    if (en.flags & FLAG_FORCED) parts.push("forced");
    return parts.join(", ");
  }

  function tableLines(baseTables, tables, nameOf) {
    var lines = [];
    tables.forEach(function (list, t) {
      var baseList = baseTables[t] || [];
      list.forEach(function (en, e) {
        if (e >= baseList.length) {
          lines.push("Table " + t + ", new entry " + e + ": " + newEntry(en, nameOf));
          return;
        }
        var parts = entryParts(baseList[e], en, nameOf);
        if (parts.length) lines.push("Table " + t + ", entry " + e + " (" + pair(baseList[e], nameOf) + "): " + parts.join(", "));
      });
    });
    return lines;
  }

  // base, road: whole Roads ({modes: [{floors, tables}]}). nameOf(id): a monster's name.
  // Returns {count, road: [lines about the whole Road], modes: [{mode, title, floors: [lines], tables: [lines]}]};
  // modes lists only the modes that change.
  function summarize(base, road, nameOf) {
    var out = { count: 0, road: [], modes: [] };
    if (road.modes.length < base.modes.length) {
      out.road.push("Modes " + base.modes.length + " → " + road.modes.length + ": " +
        (base.modes.length - road.modes.length === 1 ? "mode " + road.modes.length + " is" : "modes " + road.modes.length + " to " + (base.modes.length - 1) + " are") +
        " left out.");
    }
    road.modes.forEach(function (mode, m) {
      var baseMode = base.modes[m];
      if (!baseMode) return;
      var floors = floorLines(baseMode.floors, mode.floors);
      var tables = tableLines(baseMode.tables, mode.tables, nameOf);
      if (floors.length || tables.length) out.modes.push({ mode: m, title: modeTitle(m), floors: floors, tables: tables });
      out.count += floors.length + tables.length;
    });
    out.count += out.road.length;
    return out;
  }

  var api = { summarize: summarize, floorLabel: floorLabel, modeTitle: modeTitle };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoadSummary = api;
})(typeof window !== "undefined" ? window : this);
