/* Hunting Road rules, in the browser. A port of the Go package road (Erupe, cmd/rengoku-build/road:
   edits.go Apply and copyFrom, rules.go Check, ParseEdits/ParseProblem). The API checks the same rules
   (road/RoadRules.java), so rule names, messages and the order of the problems must stay the same as in
   the Go code; dev/check-road-rules.js runs this file against the Go golden outputs.

   Not here: the rule "too-big", which needs the encoded file size. Only the API (POST /api/road/check)
   can say it.

   No game data is in this file. The base Road and the policy come from GET /api/road/pool. The monster
   names below are Erupe's own table (common/mhfmon, MIT), not taken from the client.

   Monsters: any of the 176 the game knows (ids 1 to 176) may go on the Road; the owner chose all 176 on
   2026-10-28. "extra" below is the set of ids allowed besides the base's ({id: true}); checkEdits uses
   all 176 unless told otherwise, as rengoku-build does without -allow-monsters.

   "edits" are a player's Road: only the fields that differ from the base (see edits.go). "base" and
   "road" are whole Roads as `rengoku-build decode` prints them: {modes: [{floors: [...], tables: [[...]]}]}.

   The policy (pool.policy, rule "not-allowed") says what players may change. Every key is optional and
   a missing key means the default below, which is the contract's default:
     modes           [0]                                    modes players may edit
     floorFields     ["table"]                              floor fields: table, loop, points, points2, bonus
     entryFields     ["monster","monster2","weight","forced"]
                                                            entry fields: also level, unk04, unk0c, unk14, flags
     floorCount      false                                  may change a mode's floor count
     modeCount       false                                  may change the mode count
     maxAddedEntries 64                                     entries added over the base, all tables together
     maxWeight       1000                                   a weight may be 0 to this
     maxPoints       4                                      a floor's points multipliers may be up to this
                                                            (the crash rule allows 100; the base uses 0.5 to 4,
                                                            and a higher cap would let one vote inflate
                                                            everyone's Road points)
*/
(function (root) {
  "use strict";

  var FLAG_FORCED = 2;
  var FLAG_LOCKED = 8;
  var MIN_MONSTERS = 3;
  var MAX_POINTS = 100;

  // Erupe common/mhfmon Monsters at 05fb945, index = monster id (0 is no monster). Keep the names the
  // same as there: the API and the game server tool use that table.
  var MONSTER_NAMES = [
    "Mon0", "Rathian", "Fatalis", "Kelbi", "Mosswine", "Bullfango", "Yian Kut-Ku", "Lao-Shan Lung",
    "Cephadrome", "Felyne", "Veggie Elder", "Rathalos", "Aptonoth", "Genprey", "Diablos", "Khezu",
    "Velociprey", "Gravios", "Mon18", "Vespoid", "Gypceros", "Plesioth", "Basarios", "Melynx", "Hornetaur",
    "Apceros", "Monoblos", "Velocidrome", "Gendrome", "Mon29", "Ioprey", "Iodrome", "Mon32", "Kirin",
    "Cephalos", "Giaprey", "Crimson Fatalis", "Pink Rathian", "Blue Yian Kut-Ku", "Purple Gypceros",
    "Yian Garuga", "Silver Rathalos", "Gold Rathian", "Black Diablos", "White Monoblos", "Red Khezu",
    "Green Plesioth", "Black Gravios", "Daimyo Hermitaur", "Azure Rathalos", "Ashen Lao-Shan Lung",
    "Blangonga", "Congalala", "Rajang", "Kushala Daora", "Shen Gaoren", "Great Thunderbug", "Shakalaka",
    "Yama Tsukami", "Chameleos", "Rusted Kushala Daora", "Blango", "Conga", "Remobra", "Lunastra", "Teostra",
    "Hermitaur", "Shogun Ceanataur", "Bulldrome", "Anteka", "Popo", "White Fatalis", "Mon72", "Ceanataur",
    "Hypnocatrice", "Lavasioth", "Tigrex", "Akantor", "Breeding Season Hypnocatrice", "Lavasioth Subspecies",
    "Espinas", "Flaming Espinas", "Silver Hypnocatrice", "Akura Vashimu", "Akura Jebia", "Berukyurosu",
    "Mon86", "Mon87", "Mon88", "Pariapuria", "Espinas Rare Species", "Kamu Orugaron", "Nono Orugaron",
    "Raviente", "Dyuragaua", "Doragyurosu", "Gurenzeburu", "Burukku", "Erupe", "Rukodiora",
    "Unknown (Black Flying Wyvern)", "Gogomoa", "Kokomoa", "Taikun Zamuza", "Abiorugu", "Kuarusepusu",
    "Odibatorasu", "Disufiroa", "Rebidiora", "Anorupatisu", "Hyujikiki", "Midogaron", "Giaorugu", "Mi Ru",
    "Farunokku", "Pokaradon", "Shantien", "Pokara", "Mon118", "Goruganosu", "Aruganosu", "Baruragaru",
    "Zerureusu", "Gougarf", "Uruki", "Forokururu", "Meraginasu", "Diorekkusu", "Garuba Daora", "Inagami",
    "Varusaburosu", "Poborubarumu", "1st Block Duremudira", "Mon133", "Mon134", "Mon135", "Mon136", "Mon137",
    "Mon138", "Gureadomosu", "Harudomerugu", "Toridcless", "Gasurabazura", "Kusubami", "Yama Kurai",
    "2nd Block Duremudira", "Zinogre", "Deviljho", "Brachydios", "Berserk Raviente", "Toa Tesukatora",
    "Barioth", "Uragaan", "Stygian Zinogre", "Guanzorumu", "Savage Deviljho", "Mon156", "Egyurasu", "Voljang",
    "Nargacuga", "Keoaruboru", "Zenaserisu", "Gore Magala", "Blinking Nargacuga", "Shagaru Magala", "Amatsu",
    "Eruzerion", "Arrogant Duremudira", "Mon168", "Seregios", "Bogabadorumu", "Mon171",
    "Bombardier Bogabadorumu", "Costumed Uruki", "Sparkling Zerureusu", "Rappy", "King Shakalaka"
  ];
  var KNOWN_MONSTERS = MONSTER_NAMES.length - 1; // 176

  // Ids 1 to KNOWN_MONSTERS, as extra: every monster the game knows (Go road.AllMonsters).
  function allMonsters() {
    var ids = {};
    for (var id = 1; id <= KNOWN_MONSTERS; id++) ids[id] = true;
    return ids;
  }

  var RULES = {
    tableIndex: "table-index", fewMonsters: "few-monsters", noLoop: "no-loop", forcedTwice: "forced-twice",
    unknownMonster: "unknown-monster", copiedFields: "copied-fields", tooBig: "too-big",
    mode1Missing: "mode1-missing", badEdit: "bad-edit", notAllowed: "not-allowed"
  };

  var DEFAULT_POLICY = {
    modes: [0],
    floorFields: ["table"],
    entryFields: ["monster", "monster2", "weight", "forced"],
    floorCount: false,
    modeCount: false,
    maxAddedEntries: 64,
    maxWeight: 1000,
    maxPoints: 4
  };

  function problem(rule, mode, floor, table, entry, message) {
    return { rule: rule, mode: mode, floor: floor, table: table, entry: entry, message: message };
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  /* ---------- parsing (Go ParseEdits, ParseProblem) ---------- */

  // The JSON types of the edits format, as Go's decoder sees them.
  var SCHEMA = {
    edits: { format: "int", modeCount: "int", modes: ["mode"] },
    mode: { mode: "int", floorCount: "int", floors: ["floor"], entries: ["entry"] },
    floor: { floor: "int", table: "u32", loop: "u32", points: "f32", points2: "f32", bonus: "u32" },
    entry: { table: "int", entry: "int", monster: "u32", monster2: "u32", weight: "u32", forced: "bool",
             level: "u32", unk04: "u32", unk0c: "u32", unk14: "i32", flags: "u32" }
  };

  function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

  function validNumber(type, v) {
    if (typeof v !== "number" || !isFinite(v)) return false;
    if (type === "f32") return true;
    if (!Number.isInteger(v)) return false;
    if (type === "u32") return v >= 0 && v <= 4294967295;
    if (type === "i32") return v >= -2147483648 && v <= 2147483647;
    return Math.abs(v) <= 9007199254740991; // "int"
  }

  // Go matches keys without regard to case, so this does too.
  function keyOf(schema, key) {
    var lower = key.toLowerCase();
    for (var name in schema) {
      if (Object.prototype.hasOwnProperty.call(schema, name) && name.toLowerCase() === lower) return name;
    }
    return null;
  }

  var NOT_VALID = { invalid: true };

  // Reads one object of the schema; returns the cleaned copy (the keys in their canonical spelling),
  // or {unknown: key} / NOT_VALID for the first thing Go's decoder would refuse.
  function readObject(kind, value) {
    if (value === null) value = {}; // Go: null for a struct changes nothing
    if (!isObject(value)) return NOT_VALID;
    var schema = SCHEMA[kind];
    var out = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var name = keyOf(schema, keys[i]);
      if (name === null) return { unknown: keys[i] };
      var v = value[keys[i]];
      var type = schema[name];
      if (v === null) continue; // null leaves the field unset
      if (Array.isArray(type)) {
        if (!Array.isArray(v)) return NOT_VALID;
        var list = [];
        for (var j = 0; j < v.length; j++) {
          var item = readObject(type[0], v[j]);
          if (item === NOT_VALID || item.unknown !== undefined) return item;
          list.push(item);
        }
        out[name] = list;
      } else if (type === "bool") {
        if (typeof v !== "boolean") return NOT_VALID;
        out[name] = v;
      } else {
        if (!validNumber(type, v)) return NOT_VALID;
        out[name] = v;
      }
    }
    return out;
  }

  // The problem for text or an object that is not valid edits (Go ParseProblem). Same wording as the API.
  function parseProblem(unknownKey) {
    var message = unknownKey === undefined
      ? "The Road JSON is not valid."
      : "The Road JSON has an unknown key " + JSON.stringify(unknownKey) + ".";
    return problem(RULES.badEdit, -1, -1, -1, -1, message);
  }

  // value: the edits as text or as a parsed object. Returns {edits} or {problem}.
  function parseEdits(value) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (error) { return { problem: parseProblem() }; }
    }
    var edits = readObject("edits", value);
    if (edits === NOT_VALID) return { problem: parseProblem() };
    if (edits.unknown !== undefined) return { problem: parseProblem(edits.unknown) };
    if (edits.format !== undefined && edits.format !== 0 && edits.format !== 1) return { problem: parseProblem() };
    return { edits: edits };
  }

  /* ---------- Apply and copyFrom (Go edits.go) ---------- */

  function sameFlags(flags) { return (flags & ~FLAG_FORCED) >>> 0; }

  // The base entry a new monster's level and other fields are copied from: the same pair in the same
  // table, else in the same mode at the slot's level, else anywhere in the same mode, else in any mode.
  // A pair the base never uses with a monster from extra copies from the same table: a drawn entry (a
  // monster and weight above 0) at the slot's level and with a second monster or not, as the pair, else
  // the table's first drawn entry. Weight-0 fillers (a forced monster 71 starts some live tables) are
  // skipped. The table's own fields fit the floors that use it, and they pass copied-fields.
  function copyFrom(base, extra, mode, table, monster, monster2, level) {
    function same(e) { return e.monster === monster && e.monster2 === monster2; }
    if (mode < base.modes.length && table < base.modes[mode].tables.length) {
      var own = base.modes[mode].tables[table];
      for (var i = 0; i < own.length; i++) if (same(own[i])) return own[i];
    }
    var modes = [mode];
    for (var m = 0; m < base.modes.length; m++) if (m !== mode) modes.push(m);
    for (var k = 0; k < modes.length; k++) {
      var index = modes[k];
      if (index >= base.modes.length) continue;
      var first = null;
      var tables = base.modes[index].tables;
      for (var t = 0; t < tables.length; t++) {
        for (var j = 0; j < tables[t].length; j++) {
          var e = tables[t][j];
          if (!same(e)) continue;
          if (k === 0 && e.level === level) return e;
          if (first === null) first = e;
        }
      }
      if (first !== null) return first;
    }
    var allowed = (monster !== 0 && !!extra && !!extra[monster]) || (monster2 !== 0 && !!extra && !!extra[monster2]);
    if (!allowed || mode >= base.modes.length || table >= base.modes[mode].tables.length) return null;
    var drawn = null;
    var entries = base.modes[mode].tables[table];
    for (var d = 0; d < entries.length; d++) {
      var c = entries[d];
      if (c.monster === 0 || c.weight === 0) continue;
      if (c.level === level && (c.monster2 !== 0) === (monster2 !== 0)) return c;
      if (drawn === null) drawn = c;
    }
    return drawn;
  }

  function applyEntry(base, extra, mode, table, en, ee) {
    var newPair = (ee.monster !== undefined && ee.monster !== en.monster) ||
      (ee.monster2 !== undefined && ee.monster2 !== en.monster2);
    if (ee.monster !== undefined) en.monster = ee.monster;
    if (ee.monster2 !== undefined) en.monster2 = ee.monster2;
    var given = ee.level !== undefined || ee.unk04 !== undefined || ee.unk0c !== undefined ||
      ee.unk14 !== undefined || ee.flags !== undefined;
    if (newPair && !given) {
      var t = copyFrom(base, extra, mode, table, en.monster, en.monster2, en.level);
      if (t) {
        var forced = (en.flags & FLAG_FORCED) >>> 0;
        en.unk04 = t.unk04;
        en.unk0c = t.unk0c;
        en.level = t.level;
        en.unk14 = t.unk14;
        en.flags = ((sameFlags(t.flags)) | forced) >>> 0;
      }
    }
    if (ee.level !== undefined) en.level = ee.level;
    if (ee.unk04 !== undefined) en.unk04 = ee.unk04;
    if (ee.unk0c !== undefined) en.unk0c = ee.unk0c;
    if (ee.unk14 !== undefined) en.unk14 = ee.unk14;
    if (ee.flags !== undefined) en.flags = ee.flags;
    if (ee.weight !== undefined) en.weight = ee.weight;
    if (ee.forced !== undefined) {
      if (ee.forced) en.flags = (en.flags | FLAG_FORCED) >>> 0;
      else en.flags = (en.flags & ~FLAG_FORCED) >>> 0;
    }
  }

  // The base with the edits made. Edits that point nowhere are reported with the rule "bad-edit" and
  // skipped. edits: as parseEdits returns them; extra: see copyFrom (null for none). Returns {road, problems}.
  function apply(base, edits, extra) {
    var road = clone(base);
    var problems = [];
    function bad(message) { problems.push(problem(RULES.badEdit, -1, -1, -1, -1, message)); }

    (edits.modes || []).forEach(function (me) {
      var mn = me.mode === undefined ? 0 : me.mode;
      if (mn < 0 || mn >= road.modes.length) { bad("Mode " + mn + " does not exist."); return; }
      var mode = road.modes[mn];
      (me.floors || []).forEach(function (fe) {
        var fn = fe.floor === undefined ? 0 : fe.floor;
        if (fn < 1 || fn > mode.floors.length) { bad("Mode " + mn + " has no floor " + fn + "."); return; }
        var f = mode.floors[fn - 1];
        if (fe.table !== undefined) f.table = fe.table;
        if (fe.loop !== undefined) {
          if (fe.loop > 1) { bad("Mode " + mn + " floor " + fn + ": loop must be 0 or 1."); return; }
          f.loop = fe.loop;
        }
        [fe.points, fe.points2].forEach(function (p) {
          if (p !== undefined && !(p > 0 && p <= MAX_POINTS)) {
            bad("Mode " + mn + " floor " + fn + ": points multipliers must be above 0 and at most " + MAX_POINTS + ".");
          }
        });
        if (fe.points !== undefined && fe.points > 0 && fe.points <= MAX_POINTS) f.points = fe.points;
        if (fe.points2 !== undefined && fe.points2 > 0 && fe.points2 <= MAX_POINTS) f.points2 = fe.points2;
        if (fe.bonus !== undefined) f.bonus = fe.bonus;
      });
      (me.entries || []).forEach(function (ee) {
        var tn = ee.table === undefined ? 0 : ee.table;
        var en = ee.entry === undefined ? 0 : ee.entry;
        if (tn < 0 || tn >= mode.tables.length) { bad("Mode " + mn + " has no table " + tn + "."); return; }
        var table = mode.tables[tn];
        if (en < 0 || en > table.length) {
          bad("Mode " + mn + " table " + tn + " has no entry " + en + " (it has " + table.length +
            "; add entries one after another).");
          return;
        }
        if (en === table.length) {
          if (ee.monster === undefined) {
            bad("Mode " + mn + " table " + tn + " entry " + en + ": a new entry needs a monster.");
            return;
          }
          table.push({ monster: 0, unk04: 0, monster2: 0, unk0c: 0, level: 0, unk14: -1, weight: 0, flags: 0 });
        }
        applyEntry(base, extra, mn, tn, table[en], ee);
      });
      if (me.floorCount !== undefined) {
        if (me.floorCount < 0 || me.floorCount > mode.floors.length) {
          bad("Mode " + mn + ": floor count " + me.floorCount + " must be between 0 and " + mode.floors.length + ".");
        } else {
          mode.floors = mode.floors.slice(0, me.floorCount);
        }
      }
    });
    if (edits.modeCount !== undefined) {
      if (edits.modeCount < 1 || edits.modeCount > road.modes.length) {
        bad("Mode count " + edits.modeCount + " must be between 1 and " + road.modes.length + ".");
      } else {
        road.modes = road.modes.slice(0, edits.modeCount);
      }
    }
    return { road: road, problems: problems };
  }

  /* ---------- Check (Go rules.go) ---------- */

  function fieldKey(e) {
    return [e.unk04, e.unk0c, e.level, e.unk14, sameFlags(e.flags), e.monster2 !== 0].join(",");
  }

  // The monster ids the base uses (first and second monsters, 0 left out), sorted.
  function monsters(base) {
    var seen = {};
    base.modes.forEach(function (mode) {
      mode.tables.forEach(function (entries) {
        entries.forEach(function (e) {
          if (e.monster !== 0) seen[e.monster] = true;
          if (e.monster2 !== 0) seen[e.monster2] = true;
        });
      });
    });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  // Every crash rule road breaks except too-big, base being the live file. extra: the monster ids
  // allowed besides the base's ({id: true}, null for none).
  function check(base, road, extra) {
    var problems = [];
    function add(rule, mode, floor, table, entry, message) {
      problems.push(problem(rule, mode, floor, table, entry, message));
    }
    var known = {};
    var knownCount = 0;
    monsters(base).forEach(function (id) { known[id] = true; knownCount++; });
    Object.keys(extra || {}).forEach(function (id) {
      if (extra[id] && !known[id]) { known[id] = true; knownCount++; }
    });
    var copied = {};
    base.modes.forEach(function (mode) {
      mode.tables.forEach(function (entries) {
        entries.forEach(function (e) { copied[fieldKey(e)] = true; });
      });
    });

    if (road.modes.length < 2) {
      add(RULES.mode1Missing, 1, -1, -1, -1, "The solo Road (mode 1) is missing; both modes are needed.");
    } else if (road.modes[1].floors.length === 0 || road.modes[1].tables.length === 0) {
      add(RULES.mode1Missing, 1, -1, -1, -1, "The solo Road (mode 1) has no floors or no tables.");
    }
    road.modes.forEach(function (mode, m) {
      mode.floors.forEach(function (f, i) {
        if (f.table >= mode.tables.length) {
          add(RULES.tableIndex, m, i + 1, f.table, -1,
            "Mode " + m + " floor " + (i + 1) + " uses table " + f.table + ", but the mode has " +
            mode.tables.length + " tables (0 to " + (mode.tables.length - 1) + ").");
        }
      });
      var loop = false;
      for (var i = 0; i + 1 < mode.floors.length; i++) {
        if (mode.floors[i].loop === 1) { loop = true; break; }
      }
      if (!loop) add(RULES.noLoop, m, -1, -1, -1, "Mode " + m + " has no loop start (loop 1) before its last floor.");
      mode.tables.forEach(function (entries, t) {
        var distinct = {};
        var distinctCount = 0;
        var forced = 0;
        entries.forEach(function (en, e) {
          if (en.weight > 0 && (en.flags & FLAG_LOCKED) === 0 && en.monster !== 0 && !distinct[en.monster]) {
            distinct[en.monster] = true;
            distinctCount++;
          }
          if ((en.flags & FLAG_FORCED) !== 0) forced++;
          var unknown = false;
          [en.monster, en.monster2].forEach(function (id) {
            if (id !== 0 && !known[id]) {
              unknown = true;
              add(RULES.unknownMonster, m, -1, t, e,
                "Mode " + m + " table " + t + " entry " + e + ": monster " + id + " is not one of the " +
                knownCount + " allowed monsters.");
            }
          });
          if (!unknown && !copied[fieldKey(en)]) {
            add(RULES.copiedFields, m, -1, t, e,
              "Mode " + m + " table " + t + " entry " + e + ": level " + en.level + " with +0x04 " + en.unk04 +
              ", +0x0c " + en.unk0c + ", +0x14 " + en.unk14 + " and flags " + sameFlags(en.flags) +
              " is not used by any entry of the live Road; copy them from an existing entry.");
          }
        });
        if (distinctCount < MIN_MONSTERS) {
          add(RULES.fewMonsters, m, -1, t, -1,
            "Mode " + m + " table " + t + " offers " + distinctCount + " different monsters with weight above 0 " +
            "(not locked); it needs at least " + MIN_MONSTERS + ".");
        }
        if (forced > 1) {
          add(RULES.forcedTwice, m, -1, t, -1, "Mode " + m + " table " + t + " has " + forced +
            " forced entries; at most 1 is allowed.");
        }
      });
    });
    return problems;
  }

  /* ---------- the policy (rule "not-allowed") ---------- */

  function policyValue(policy, key) {
    return policy && policy[key] !== undefined && policy[key] !== null ? policy[key] : DEFAULT_POLICY[key];
  }

  function notAllowed(mode, floor, table, entry, what) {
    return problem(RULES.notAllowed, mode, floor, table, entry, "Changing " + what + " is not allowed in this rotation.");
  }

  // What the edits change that the policy does not allow. Only fields that are in the edits count, so an
  // edit that is not there never breaks the policy. road: the base with the edits made (apply).
  function policyProblems(base, edits, road, policy) {
    var problems = [];
    var modes = policyValue(policy, "modes");
    var floorFields = policyValue(policy, "floorFields");
    var entryFields = policyValue(policy, "entryFields");
    var maxWeight = policyValue(policy, "maxWeight");
    var maxAdded = policyValue(policy, "maxAddedEntries");
    var maxPoints = policyValue(policy, "maxPoints");

    (edits.modes || []).forEach(function (me) {
      var mn = me.mode === undefined ? 0 : me.mode;
      if (modes.indexOf(mn) < 0) {
        problems.push(notAllowed(mn, -1, -1, -1, "mode " + mn));
        return;
      }
      if (me.floorCount !== undefined && !policyValue(policy, "floorCount")) {
        problems.push(notAllowed(mn, -1, -1, -1, "the number of floors of mode " + mn));
      }
      (me.floors || []).forEach(function (fe) {
        ["table", "loop", "points", "points2", "bonus"].forEach(function (field) {
          if (fe[field] !== undefined && floorFields.indexOf(field) < 0) {
            problems.push(notAllowed(mn, fe.floor === undefined ? 0 : fe.floor, -1, -1, "the " + field + " of a floor"));
          }
        });
        ["points", "points2"].forEach(function (field) {
          if (fe[field] !== undefined && fe[field] > maxPoints) {
            problems.push(notAllowed(mn, fe.floor === undefined ? 0 : fe.floor, -1, -1,
              "the " + (field === "points" ? "" : "second ") + "points multiplier to more than " + maxPoints + "x"));
          }
        });
      });
      (me.entries || []).forEach(function (ee) {
        var tn = ee.table === undefined ? 0 : ee.table;
        var en = ee.entry === undefined ? 0 : ee.entry;
        ["monster", "monster2", "weight", "forced", "level", "unk04", "unk0c", "unk14", "flags"].forEach(function (field) {
          if (ee[field] !== undefined && entryFields.indexOf(field) < 0) {
            problems.push(notAllowed(mn, -1, tn, en, "the " + field + " of an entry"));
          }
        });
        if (ee.weight !== undefined && ee.weight > maxWeight) {
          problems.push(notAllowed(mn, -1, tn, en, "the weight to more than " + maxWeight));
        }
      });
    });
    if (edits.modeCount !== undefined && !policyValue(policy, "modeCount")) {
      problems.push(notAllowed(-1, -1, -1, -1, "the number of modes"));
    }
    var added = 0;
    road.modes.forEach(function (mode, m) {
      if (m >= base.modes.length) return;
      mode.tables.forEach(function (entries, t) {
        if (t < base.modes[m].tables.length) added += Math.max(0, entries.length - base.modes[m].tables[t].length);
      });
    });
    if (added > maxAdded) {
      problems.push(problem(RULES.notAllowed, -1, -1, -1, -1,
        "Adding more than " + maxAdded + " entries is not allowed in this rotation."));
    }
    return problems;
  }

  /* ---------- everything together ---------- */

  // What the page shows while you edit: the crash rules (except too-big) and the policy, in the order
  // the API lists them (parse and apply problems, crash rules, policy). editsValue: edits as text or as a
  // parsed object. pool: {base, policy}; with no policy (null, or opts.ignorePolicy) all edits are allowed.
  // opts.extra: the monsters allowed besides the base's (default all 176, allMonsters).
  // Returns {problems, road}; road is null when the edits could not be read.
  function checkEdits(pool, editsValue, opts) {
    var parsed = parseEdits(editsValue);
    if (parsed.problem) return { problems: [parsed.problem], road: null };
    var extra = opts && opts.extra ? opts.extra : allMonsters();
    var applied = apply(pool.base, parsed.edits, extra);
    var problems = applied.problems.concat(check(pool.base, applied.road, extra));
    var useful = !(opts && opts.ignorePolicy) && pool.policy;
    if (useful) problems = problems.concat(policyProblems(pool.base, parsed.edits, applied.road, pool.policy));
    return { problems: problems, road: applied.road };
  }

  var api = {
    RULES: RULES,
    DEFAULT_POLICY: DEFAULT_POLICY,
    FLAG_FORCED: FLAG_FORCED,
    FLAG_LOCKED: FLAG_LOCKED,
    MIN_MONSTERS: MIN_MONSTERS,
    MAX_POINTS: MAX_POINTS,
    MONSTER_NAMES: MONSTER_NAMES,
    KNOWN_MONSTERS: KNOWN_MONSTERS,
    allMonsters: allMonsters,
    parseEdits: parseEdits,
    parseProblem: parseProblem,
    apply: apply,
    copyFrom: copyFrom,
    monsters: monsters,
    check: check,
    policyProblems: policyProblems,
    policyValue: policyValue,
    checkEdits: checkEdits
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoadRules = api;
})(typeof window !== "undefined" ? window : this);
