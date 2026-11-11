/* The balance table's fields as the game has them, shared by the admin Balance grid (js/admin-balance.js,
   js/admin-balance-grid.js) and the public balance page (js/balance-public.js):
   - moveValue: a move's game value for any attack field of the API (BalanceTable / hvmhfz_re balance_table.py
     FIELDS). mv, ko and element_value are the move's own keys; the other fields are its record's raw values in
     "rec", in the order of the type file's "recordFields" (= REC_FIELDS, dev/make-weapons-data.py RECORD_FIELDS).
   - options: the game's names for a coded field (element, status, special by weapon class, arc shot, charge row,
     a move's element/status flags), from data/weapons/index.json "codes", as [{value, name}] with the API's codes;
     null for a plain number. codeOf turns the weapon list's name ("Fire", "Normal 2") back into the code;
     label shows a code by its name. */
(function () {
  "use strict";

  var REC_FIELDS = ["delay", "active", "reaction", "element_flags", "hit_type", "hitstop", "spirit"];

  function norm(name) { return String(name || "").toLowerCase().replace(/[^a-z]/g, ""); }

  /** A move's game value for an API attack field (mv: the first hit's); null when the data has none. */
  function moveValue(move, field) {
    if (!move) return null;
    var key = norm(field), v = null;
    if (key === "mv") v = move.mv ? move.mv[0] : null;
    // ko and elementValue are left out of a move when 0 (known to be 0 when the move has its record, "rec").
    else if (key === "ko" || key === "elementvalue") {
      v = move[key === "ko" ? "ko" : "elementValue"];
      if (v === undefined && move.rec) v = 0;
    } else if (move.rec) {
      for (var i = 0; i < REC_FIELDS.length; i++) if (norm(REC_FIELDS[i]) === key) v = move.rec[i];
    }
    return typeof v === "number" ? v : null;
  }

  function list(names) { return (names || []).map(function (n, i) { return { value: i, name: n }; }); }

  /**
   * The game's names of a coded field: [{value, name}] (value = the API's code), or null when the field is a plain
   * number (or the data has no names). `kind` attack/melee/ranged, `cls` the weapon class number (special and the
   * bow fields depend on it; null when not known).
   */
  function options(codes, kind, field, cls) {
    if (!codes) return null;
    var f = norm(field);
    if (kind === "attack") {
      return f === "elementflags" && codes.moveFlags ? codes.moveFlags.map(function (p) { return { value: p[0], name: p[1] }; }) : null;
    }
    if (kind === "melee") {
      if (f === "element") return list(codes.element);
      if (f === "status") return list(codes.status);
      if (f === "special") {
        var names = { 8: codes.notes, 9: codes.shell, 12: codes.phial }[cls];
        return names ? list(names) : null;
      }
      return null;
    }
    if (kind === "ranged" && cls === 10) {
      if (f === "arcshot") return list(codes.arcShot);
      if (f === "chargerow" && codes.chargeRow) {
        return codes.chargeRow.map(function (n, i) { return { value: i, name: "Row " + i + (n ? ": " + n : "") }; });
      }
    }
    return null;
  }

  /** The code of a value: a number stays; the weapon list's name ("" = none) becomes its code; null if unknown. */
  function codeOf(opts, value) {
    if (typeof value === "number") return value;
    if (!opts || typeof value !== "string") return null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].name === value || (value === "" && opts[i].value === 0 && /^None$/.test(opts[i].name))) return opts[i].value;
    }
    return null;
  }

  /** A code shown by its name ("Fire"); a code without a name stays a number ("0x30" for flags). */
  function label(opts, value, field) {
    if (value === null || value === undefined) return null;
    if (opts) for (var i = 0; i < opts.length; i++) if (opts[i].value === value) return opts[i].name;
    return norm(field) === "elementflags" && typeof value === "number" ? "0x" + value.toString(16) : String(value);
  }

  var api = { REC_FIELDS: REC_FIELDS, moveValue: moveValue, options: options, codeOf: codeOf, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.HvBalanceFields = api;
})();
