/* The Set builder's calculator: a set in, its skill points, active skills, defence and resistances out. No page
   code: set-builder.html (js/set-builder.js) and node (dev/check-set-builder.js) both run it.

   Two layers:
   - calc(tables, set): the game's whole recompute, step by step as hvmhfz_re tools/items/armor_calc.py (the
     reference calculator, checked against the client's own code under unicorn). Its set is that file's shape
     (hvmhfz_re docs/armor-builder.md "Set"): {"weapon": {"kind": "melee"|"ranged", "id", "decos": [items]},
     "weapon_class", "armour": {slot: {"id", "level", "decos", "plates"}}, "cuffs": [items]}. dev/check-set-builder.js
     runs it on all of hvmhfz_re data/armor_calc_cases.json (the client's answers) and needs every one to match.
   - compute(set, ctx): the page's set format (below) checked (slots, kinds, gender), turned into calc's shape and
     calculated, with names and the parts of every sum for the page.

   The page's set format (docs/armor-set-builder.md "Set format"; one shape for the URL, the API and test fixtures):
     {"v": 1, "data": "v1.29",
      "weapon": [class, id, [extra levels], [decoration or sigil item ids]],   class -1 = none, id 0 = any weapon
      "armour": [["head", id, level, [decoration item ids]], ... chest, arms, waist, legs],   id 0 = empty
      "cuffs": [cuff item ids]}
   In the address it is base64url(JSON) after #s= (encode / decode below).

   The rules that look at one row (activation, weapon gate, Zenith, limit parts, growth) are js/armor-rules.js. */
(function (root) {
  "use strict";

  var VERSION = 1;
  var SLOTS = ["head", "chest", "arms", "waist", "legs"];
  var RES = ["fire", "water", "thunder", "dragon", "ice"];
  var MAX_DECOS = 3;   // an equipment record keeps 3 decoration ids per piece (hvmhfz_re: entry +6)
  // The client's equipment entries: index = type (0 legs, 2 head, 3 chest, 4 arms, 5 waist); the automatic skills
  // take list positions 21-26 in this order and the weapon's 27 (0x10baf6c0, 0x10baf7f0).
  var ENTRY_ORDER = ["legs", null, "head", "chest", "arms", "waist"];
  var AUTO_FIRST = 21, AUTO_WEAPON = 27;
  var TOWER_PLATE_ORDER = [0, 3, 1, 4, 2];

  function int(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? Math.trunc(n) : dflt;
  }

  function ids(list, max) {
    if (!Array.isArray(list)) return [];
    return list.map(function (v) { return int(v, 0); }).filter(function (v) { return v > 0; }).slice(0, max);
  }

  /** A clean set from anything (a decoded URL, an API answer): known slots in order, numbers only. */
  function normalize(obj) {
    var o = obj && typeof obj === "object" ? obj : {};
    var w = Array.isArray(o.weapon) ? o.weapon : [];
    var byslot = {};
    (Array.isArray(o.armour) ? o.armour : []).forEach(function (a) {
      if (Array.isArray(a) && SLOTS.indexOf(a[0]) !== -1) byslot[a[0]] = a;
    });
    return {
      v: VERSION,
      data: typeof o.data === "string" ? o.data.slice(0, 20) : "",
      weapon: [Math.max(-1, Math.min(13, int(w[0], -1))), Math.max(0, int(w[1], 0)),
        Array.isArray(w[2]) ? w[2].slice(0, 16).map(function (v) { return Math.max(0, int(v, 0)); }) : [],
        ids(w[3], MAX_DECOS)],
      armour: SLOTS.map(function (slot) {
        var a = byslot[slot] || [];
        return [slot, Math.max(0, int(a[1], 0)), Math.max(1, int(a[2], 1)), ids(a[3], MAX_DECOS)];
      }),
      cuffs: ids(o.cuffs, 4)
    };
  }

  function empty() { return normalize({}); }

  function b64(text) {
    if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
    return root.btoa(unescape(encodeURIComponent(text)));
  }

  function unb64(text) {
    if (typeof Buffer !== "undefined") return Buffer.from(text, "base64").toString("utf8");
    return decodeURIComponent(escape(root.atob(text)));
  }

  /** The set as the short code after #s= (base64url of its JSON, no padding). */
  function encode(set) {
    return b64(JSON.stringify(normalize(set))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** The set from a #s= code, or null when the code is not one. */
  function decode(code) {
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
    try {
      var text = unb64(code.replace(/-/g, "+").replace(/_/g, "/"));
      var obj = JSON.parse(text);
      return obj && typeof obj === "object" && !Array.isArray(obj) ? normalize(obj) : null;
    } catch (e) {
      return null;
    }
  }

  // ---- calc: the game's recompute (0x10a89cd0), as hvmhfz_re tools/items/armor_calc.py -------------------
  //
  // tables: {R: js/armor-rules.js make(), armour(slot, id), deco(item), weapon(kind, id)}, each lookup null when
  // unknown. Rows use hvmhfz_re's column names:
  //   armour: {defence, def_growth, slots, max_slots, slot_growth, resist, g_piece, z_piece, tower_piece, skills,
  //            zenith, auto}
  //   deco:   {slots (0 = skill cuff), skills (first four pairs), zenith, first_tree, first_points}
  //   weapon: {class, zenith, tower, slots, auto}

  function list(v) { return Array.isArray(v) ? v : []; }

  function piecesOf(T, s) {
    var out = [];
    var armour = s.armour || {};
    SLOTS.forEach(function (slot) {
      var p = armour[slot];
      if (p && p.id) out.push({ slot: slot, p: p, rec: T.armour(slot, p.id) });
    });
    return out;
  }

  function weaponRow(T, s) {
    var w = s.weapon;
    if (!w || !w.id) return null;
    return T.weapon(w.kind, w.id);
  }

  /** Skill points per tree (0x10a89120 -> 0x10a88ac0, 0x10a88a20): the five pieces' pairs, the first four pairs
      of each decoration in them, the weapon's decorations unless it is a Tower weapon, both cuffs. A 16-bit sum.
      Returns {totals: {tree: points}, parts: {tree: [{where, item, points}]}} for the trees of the table. */
  function points(T, s) {
    var sums = {}, parts = {};
    function add(pairs, where, item) {
      list(pairs).forEach(function (pr) {
        sums[pr[0]] = (sums[pr[0]] || 0) + pr[1];
        (parts[pr[0]] || (parts[pr[0]] = [])).push({ where: where, item: item, points: pr[1] });
      });
    }
    function addDeco(item, where) {
      var d = item ? T.deco(item) : null;
      if (d) add(d.skills, where, item);
    }
    piecesOf(T, s).forEach(function (e) {
      if (e.rec) add(e.rec.skills, e.slot, 0);
      list(e.p.decos).slice(0, 3).forEach(function (d) { addDeco(d, e.slot); });
    });
    var w = weaponRow(T, s);
    if (w && !w.tower) list(s.weapon.decos).slice(0, 3).forEach(function (d) { addDeco(d, "weapon"); });
    list(s.cuffs).slice(0, 2).forEach(function (c) { addDeco(c, "cuff"); });
    var totals = {}, kept = {};
    T.R.trees.forEach(function (t) {
      var total = sums[t.id] || 0;
      totals[t.id] = ((total + 0x8000) & 0xFFFF) - 0x8000;
      if (parts[t.id]) kept[t.id] = parts[t.id];
    });
    return { totals: totals, parts: kept };
  }

  /** The seven Zenith sources (0x1033ff50): the weapon (a Tower weapon without one takes the first Zenith skill
      of its sigil places when one has first-pair points 37, 0x10b77180), head, chest, arms, waist, legs, the
      first cuff with a Zenith skill. */
  function zenithSources(T, s) {
    var out = [];
    var w = weaponRow(T, s);
    var zen = w ? w.zenith : 0;
    if (w && !zen && w.tower) {
      var places = list(s.weapon.decos).concat([0, 0, 0, 0, 0, 0, 0, 0]).slice(0, w.slots);
      var gems = places.filter(Boolean).map(function (d) { return T.deco(d); });
      if (gems.some(function (g) { return g && g.first_points === T.R.rules.tower_zenith_marker; })) {
        var hit = gems.filter(function (g) { return g && g.zenith; })[0];
        zen = hit ? hit.zenith : 0;
      }
    }
    out.push(zen);
    SLOTS.forEach(function (slot) {
      var p = (s.armour || {})[slot];
      var rec = p && p.id ? T.armour(slot, p.id) : null;
      out.push(rec ? rec.zenith : 0);
    });
    var cuff = 0;
    list(s.cuffs).slice(0, 2).forEach(function (c) {
      var d = c ? T.deco(c) : null;
      if (d && !cuff) cuff = d.zenith;
    });
    out.push(cuff);
    return out;
  }

  /** For each Tower armour piece in entry order, the first tree of each item in its plate (read 0, 3, 1, 4, 2;
      0x10a897d0 -> 0x10a89500). The page never sets plates (what they are in game is not decoded). */
  function towerPlateValues(T, s) {
    var out = [];
    ENTRY_ORDER.forEach(function (slot) {
      if (!slot) return;
      var p = (s.armour || {})[slot];
      var rec = p && p.id ? T.armour(slot, p.id) : null;
      if (!rec || !rec.tower_piece) return;
      var plates = list(p.plates).concat([0, 0, 0, 0, 0]);
      TOWER_PLATE_ORDER.forEach(function (k) {
        var d = plates[k] ? T.deco(plates[k]) : null;
        if (d) out.push(d.first_tree);
      });
    });
    return out;
  }

  function limitParts(T, s, zen) {
    var g = 0, z = 0;
    piecesOf(T, s).forEach(function (e) {
      if (e.rec) { g += e.rec.g_piece; z += e.rec.z_piece; }
    });
    var tower = towerPlateValues(T, s).slice(0, 15).filter(function (v) { return v === 10; }).length;
    var cuffs = list(s.cuffs).slice(0, 2).filter(function (c) {
      var d = c ? T.deco(c) : null;
      return d && d.slots === 0;
    }).length;
    return T.R.limitParts(g, z, tower, zen, cuffs);
  }

  /** 0x1097b080: the tree is a Tech tree and one of the cuffs gives it. */
  function cuffTech(T, s, tree) {
    if (!T.R.isTechTree(tree)) return false;
    return list(s.cuffs).slice(0, 2).some(function (c) {
      var d = c ? T.deco(c) : null;
      return d && d.slots === 0 && list(d.skills).some(function (pr) { return pr[0] === tree; });
    });
  }

  /** [[skill, tree]]: a Tower weapon's Tower Deco skills (0x10a89260): the decoration places after its `slots`
      sigil places; per tree the best single Tower Deco (0x10a88bd0: the maximum, never below 0), activated by the
      same rows in table order, at most 4, outside the limit. */
  function towerSkills(T, s) {
    var w = weaponRow(T, s);
    if (!w || !w.tower) return [];
    var gems = w.slots < 3 ? list(s.weapon.decos).concat([0, 0, 0]).slice(w.slots, 3).filter(Boolean) : [];
    var out = [];
    for (var i = 0; i < T.R.trees.length && out.length < 4; i++) {
      var t = T.R.trees[i];
      var pts = 0;
      gems.forEach(function (g) {
        var d = T.deco(g);
        var p = 0;
        if (d) list(d.skills).forEach(function (pr) { if (pr[0] === t.id) p += pr[1]; });
        pts = Math.max(pts, p);
      });
      var skill = T.R.skillFor(t.id, pts);
      if (skill) out.push([skill, t.id]);
    }
    return out;
  }

  /** The hunter's weapon class: the set's weapon_class, else the weapon's, else 0 (an empty hunter record's). */
  function weaponClass(T, s) {
    if (s.weapon_class !== undefined && s.weapon_class !== null) return s.weapon_class;
    var w = weaponRow(T, s);
    return w ? w["class"] : 0;
  }

  /** [[position, skill]]: positions 21-26 for the entries legs, -, head, chest, arms, waist, 27 the weapon. */
  function automatic(T, s) {
    var out = [];
    ENTRY_ORDER.forEach(function (slot, i) {
      var p = slot ? (s.armour || {})[slot] : null;
      var rec = p && p.id ? T.armour(slot, p.id) : null;
      if (rec && rec.auto) out.push([AUTO_FIRST + i, rec.auto]);
    });
    var w = s.weapon && s.weapon.id ? weaponRow(T, s) : null;
    if (w && w.auto) out.push([AUTO_WEAPON, w.auto]);
    return out;
  }

  function calc(T, s) {
    var R = T.R;
    var clamp = R.rules.points_clamp;
    var pts = points(T, s);
    var entries = [];                             // [skill, tree byte, points] in activation-table order
    R.trees.forEach(function (t) {
      var skill = R.skillFor(t.id, pts.totals[t.id]);
      if (skill && entries.length < R.maxEntries) {
        entries.push([skill, t.id & 0xFF, Math.max(-clamp, Math.min(clamp, pts.totals[t.id]))]);
      }
    });
    var zen = R.zenithSkills(zenithSources(T, s));
    var parts = limitParts(T, s, zen);
    var limit = parts.limit;
    var cuffs = parts.cuffs;
    if (cuffs) {                                  // a cuff's slot counts only while its Tech skill is on
      var using = entries.filter(function (e) { return e[2] && cuffTech(T, s, e[1]); }).length;
      limit -= Math.min(Math.max(cuffs - using, 0), 2);
    }
    var head = [];
    for (var i = 0; i < Math.max(limit, 0); i++) { // only the first `limit` in table order are kept
      if (i < entries.length) {
        var e = entries[i];
        head.push([e[2] >= 1 ? e[2] + 200 : 100 - e[2], e[1], e[0]]);
      } else {
        head.push([0, 0, 0]);
      }
    }
    head.sort(function (a, b) { return b[0] - a[0] || b[1] - a[1]; });   // stable: positives by points, then negatives
    var keptTech = head.filter(function (h) { return h[2] && cuffTech(T, s, h[1]); }).length;
    var finalLimit = parts.limit;
    if (cuffs) finalLimit -= Math.min(Math.max(cuffs - keptTech, 0), 2);
    var active = head.slice(0, Math.max(finalLimit, 0)).filter(function (h) { return h[2]; }).slice(0, AUTO_FIRST);
    var auto = automatic(T, s);
    var tower = towerSkills(T, s);
    var activeIds = active.map(function (h) { return h[2]; }).concat(auto.map(function (a) { return a[1]; }));
    var wclass = weaponClass(T, s);
    var listed = activeIds.concat(tower.map(function (t) { return t[0]; }));
    var pieces = piecesOf(T, s).filter(function (e) { return e.rec; });
    var defence = {}, slots = {};
    pieces.forEach(function (e) {
      defence[e.slot] = R.defenceAt(e.rec, e.p.level || 1);
      slots[e.slot] = R.slotsAt(e.rec, e.p.level || 1);
    });
    var resist = [0, 0, 0, 0, 0].map(function (_, k) {
      return pieces.reduce(function (sum, e) { return sum + e.rec.resist[k]; }, 0);
    });
    return {
      points: pts.totals, parts: pts.parts,
      reached: entries,
      active: active.map(function (h) { return [h[2], h[1], h[0]]; }),
      automatic: auto,
      dropped: entries.map(function (e) { return e[0]; }).filter(function (sk) { return activeIds.indexOf(sk) === -1; }),
      limit: parts, final_limit: finalLimit,
      tower: tower,
      zenith: zen.map(function (z) { return [z, R.zenithLit(z, listed, wclass)]; }),
      weapon_class: wclass,
      no_effect: activeIds.filter(function (sk) { return R.noEffect(sk, wclass); }),
      defence: defence, slots: slots, resist: resist
    };
  }

  /** Tables for calc from hvmhfz_re's data/armor_builder.json (rows named by its *_columns lists). */
  function tablesFromRe(R, builder) {
    function rows(part, cols) {
      return part.map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; });
    }
    var auto = {};
    builder.automatic.forEach(function (a) { var k = a[0] + ":" + a[1]; if (!(k in auto)) auto[k] = a[2]; });
    var type = { legs: 0, head: 2, chest: 3, arms: 4, waist: 5, melee: 6, ranged: 7 };
    var armour = {}, decos = {}, weapons = {};
    Object.keys(builder.armour).forEach(function (slot) {
      rows(builder.armour[slot], builder.armour_columns).forEach(function (a) {
        a.auto = auto[type[slot] + ":" + a.id] || 0;
        armour[slot + ":" + a.id] = a;
      });
    });
    rows(builder.decorations, builder.decoration_columns).forEach(function (d) { decos[d.item] = d; });
    Object.keys(builder.weapons).forEach(function (kind) {
      rows(builder.weapons[kind], builder.weapon_columns).forEach(function (w) {
        w.auto = auto[type[kind] + ":" + w.id] || 0;
        weapons[kind + ":" + w.id] = w;
      });
    });
    return {
      R: R,
      armour: function (slot, id) { return armour[slot + ":" + id] || null; },
      deco: function (item) { return decos[item] || null; },
      weapon: function (kind, id) { return weapons[kind + ":" + id] || null; }
    };
  }

  // ---- compute: the page's set ------------------------------------------------------------------------

  /** A page piece (data/armor/<slot>.json row as an object) as calc's armour row. */
  function armourRow(p) {
    return { defence: p.defence, def_growth: p.defGrowth, slots: p.slots, max_slots: p.maxSlots,
             slot_growth: p.slotGrowth, resist: p.res, g_piece: p.limitKind & 1, z_piece: (p.limitKind >> 1) & 1,
             tower_piece: (p.limitKind >> 2) & 1, skills: p.skills, zenith: p.zenith, auto: p.auto };
  }

  /** A page item (decoration, Road gem, cuff, sigil) as calc's decoration row. */
  function decoRow(d) {
    return { slots: d.kind === "c" ? 0 : d.slots, skills: d.skills, zenith: d.zenith || 0,
             first_tree: d.firstTree || 0, first_points: d.firstPoints || 0 };
  }

  /**
   * Checks and adds up a page set. ctx:
   *   rules            -> js/armor-rules.js make()
   *   piece(slot, id)  -> {id, name, rarity, defence, slots, maxSlots, res[5], flags, maxLevel, skills, auto,
   *                        obtainable, defGrowth, slotGrowth, limitKind, zenith} | null   (data/armor/<slot>.json)
   *   weapon(cls, id)  -> {id, name, slots, defense, zenith, tower, auto} | null
   *   item(id)         -> {item, name, kind "d"|"g"|"c"|"s" (Tower sigil), slots, skills, zenith, firstTree,
   *                        firstPoints} | null
   *   gender           -> "", "male" or "female" (who wears it)
   * Only what passes the checks goes into the calculation; the rest is listed in `problems`.
   */
  function compute(rawSet, ctx) {
    var set = normalize(rawSet);
    var R = ctx.rules;
    var cls = set.weapon[0];
    var kind = R.weaponKind(cls);
    var problems = [];
    var names = {};       // item id -> name, for the parts of each sum
    var calcSet = { armour: {}, cuffs: [] };
    if (cls >= 0) calcSet.weapon_class = cls;

    function itemOf(id, where) {
      var d = ctx.item(id);
      if (!d) problems.push(where + ": unknown item " + id);
      else names[id] = d.name;
      return d;
    }

    /** Decorations of a piece or non-Tower weapon: the ones that fit, by their slot sizes. */
    function fitDecos(ids, capacity, where, holder) {
      var used = 0, rows = [], kept = [];
      ids.forEach(function (id) {
        var d = itemOf(id, where);
        if (!d) return;
        if (d.kind === "c") { problems.push(d.name + " is a skill cuff: it goes in a cuff slot, not in " + holder); return; }
        if (d.kind === "s") { problems.push(d.name + " is a Tower sigil: it goes only on a Tower weapon"); return; }
        used += d.slots;
        rows.push(d);
        kept.push(id);
      });
      if (used > capacity) problems.push(holder + ": decorations need " + used + " slots, it has " + capacity);
      return { used: used, capacity: capacity, decos: rows, ids: kept };
    }

    /** A Tower weapon's places: its first `slots` hold Tower sigils, the rest (up to 3) Road gems (Tower Decos).
        The set lists them without gaps, so sigils go to the sigil places and gems after them, as in the game. */
    function towerPlaces(ids, sigilPlaces, holder) {
      var sigils = [], gems = [], rows = [];
      ids.forEach(function (id) {
        var d = itemOf(id, "weapon");
        if (!d) return;
        if (d.kind === "s") { sigils.push(id); rows.push(d); }
        else if (d.kind === "g") { gems.push(id); rows.push(d); }
        else problems.push(d.name + " cannot go on " + holder + ": a Tower weapon takes Tower sigils and Road gems");
      });
      var gemPlaces = Math.max(0, MAX_DECOS - sigilPlaces);
      if (sigils.length > sigilPlaces) problems.push(holder + " has " + sigilPlaces + " sigil places, the set has " + sigils.length + " sigils");
      if (gems.length > gemPlaces) problems.push(holder + " has " + gemPlaces + " Road gem places, the set has " + gems.length + " gems");
      var places = sigils.slice(0, sigilPlaces);
      while (places.length < sigilPlaces) places.push(0);
      return { used: Math.min(sigils.length, sigilPlaces) + Math.min(gems.length, gemPlaces), capacity: MAX_DECOS,
               tower: true, sigilPlaces: sigilPlaces, gemPlaces: gemPlaces, decos: rows,
               ids: places.concat(gems.slice(0, gemPlaces)) };
    }

    // weapon
    var weapon = cls >= 0 && set.weapon[1] ? ctx.weapon(cls, set.weapon[1]) : null;
    if (cls >= 0 && set.weapon[1] && !weapon) problems.push("Unknown weapon " + set.weapon[1]);
    var weaponSlots = null;
    if (weapon) {
      weaponSlots = weapon.tower ? towerPlaces(set.weapon[3], weapon.slots, weapon.name)
        : fitDecos(set.weapon[3], weapon.slots, "weapon", weapon.name);
      calcSet.weapon = { kind: kind === "gunner" ? "ranged" : "melee", id: weapon.id, decos: weaponSlots.ids };
    } else if (set.weapon[3].length) {
      problems.push("Decorations on the weapon need a weapon picked");
    }

    // armour
    var pieces = [];
    set.armour.forEach(function (a) {
      var slot = a[0];
      if (!a[1]) { pieces.push({ slot: slot, piece: null }); return; }
      var piece = ctx.piece(slot, a[1]);
      if (!piece) { problems.push("Unknown " + slot + " piece " + a[1]); pieces.push({ slot: slot, piece: null }); return; }
      names["p:" + slot] = piece.name;
      var level = Math.min(Math.max(1, a[2]), piece.maxLevel || 1);
      if (a[2] > level) problems.push(piece.name + " goes up to level " + piece.maxLevel);
      if (!R.canWear(piece.flags, ctx.gender || "")) problems.push(piece.name + " cannot be worn by a " + ctx.gender + " hunter");
      var row = armourRow(piece);
      var slots = R.slotsAt(row, level);
      var deco = fitDecos(a[3], slots, slot, piece.name);
      calcSet.armour[slot] = { id: piece.id, level: level, decos: deco.ids };
      pieces.push({ slot: slot, piece: piece, level: level, defence: { value: R.defenceAt(row, level) },
                    slots: { value: slots }, decos: deco, row: row });
    });

    // cuffs
    var cuffs = [];
    set.cuffs.forEach(function (id, i) {
      if (i >= R.cuffSlots) { problems.push("Only " + R.cuffSlots + " cuff slots"); return; }
      var d = itemOf(id, "cuff");
      if (!d) return;
      if (d.kind !== "c") { problems.push(d.name + " is not a skill cuff"); return; }
      cuffs.push(d);
      calcSet.cuffs.push(id);
    });

    var T = {
      R: R,
      armour: function (slot, id) {
        var p = pieces.filter(function (e) { return e.slot === slot && e.piece && e.piece.id === id; })[0];
        return p ? p.row : null;
      },
      deco: function (item) { var d = ctx.item(item); return d ? decoRow(d) : null; },
      weapon: function (k, id) {
        return weapon && weapon.id === id ? { "class": cls, zenith: weapon.zenith || 0, tower: weapon.tower ? 1 : 0,
                                              slots: weapon.slots, auto: weapon.auto || 0 } : null;
      }
    };
    var c = calc(T, calcSet);

    // the page's lists
    var known = cls >= 0;    // with no class picked, nothing is marked "no effect"
    function where(part) {
      if (part.where === "cuff") return (names[part.item] || "Item " + part.item) + " (cuff)";
      if (!part.item) return names["p:" + part.where] || part.where;
      return (names[part.item] || "Item " + part.item) + " (" + (part.where === "weapon" && weapon ? weapon.name : part.where) + ")";
    }
    function treeName(id) { var t = R.tree(id); return t ? t.name : "Tree " + id; }
    function nextLevel(tree, total) {
      var best = null;
      tree.levels.slice(3).forEach(function (l) {
        if (l[1] && l[0] > total && (!best || l[0] < best[0])) best = l;
      });
      return best ? { points: best[0], skill: best[1], name: R.skillName(best[1]) } : null;
    }
    var trees = Object.keys(c.parts).map(function (k) {
      var id = Number(k);
      var t = R.tree(id);
      var total = c.points[id];
      var reached = R.skillFor(id, total);
      return { tree: id, name: t.name, total: total,
               parts: c.parts[k].map(function (p) { return { from: where(p), points: p.points }; }),
               skill: reached ? { skill: reached, name: R.skillName(reached) } : null, next: nextLevel(t, total) };
    });
    trees.sort(function (a, b) { return Math.abs(b.total) - Math.abs(a.total) || a.name.localeCompare(b.name); });

    var pointsOf = {};
    c.reached.forEach(function (e) { pointsOf[e[0]] = e[2]; });
    function works(skill) { return !known || !R.noEffect(skill, c.weapon_class); }
    var active = c.active.map(function (a) {
      var tree = R.treeOf(a[0]);
      return { skill: a[0], name: R.skillName(a[0]), tree: tree, treeName: treeName(tree), total: pointsOf[a[0]],
               negative: a[2] < 200, from: "points", works: works(a[0]), dropped: false };
    });
    var autoFrom = {};
    pieces.forEach(function (e) { if (e.piece) autoFrom[AUTO_FIRST + ENTRY_ORDER.indexOf(e.slot)] = e.piece.name; });
    if (weapon) autoFrom[AUTO_WEAPON] = weapon.name;
    c.automatic.forEach(function (a) {
      active.push({ skill: a[1], name: R.skillName(a[1]), tree: R.treeOf(a[1]), treeName: "", total: null,
                    negative: false, from: "automatic", source: autoFrom[a[0]] || "", works: works(a[1]), dropped: false });
    });
    c.tower.forEach(function (t) {
      active.push({ skill: t[0], name: R.skillName(t[0]), tree: t[1], treeName: treeName(t[1]), total: null,
                    negative: false, from: "tower", source: weapon ? weapon.name : "", works: works(t[0]), dropped: false });
    });
    c.reached.forEach(function (e) {
      if (c.dropped.indexOf(e[0]) === -1) return;
      var tree = R.treeOf(e[0]);
      active.push({ skill: e[0], name: R.skillName(e[0]), tree: tree, treeName: treeName(tree), total: e[2],
                    negative: e[2] < 1, from: "points", works: works(e[0]), dropped: true });
    });
    var zenith = c.zenith.map(function (z) {
      var need = R.zenithNeeds(z[0]);
      return { id: z[0], name: R.zenithName(z[0]), lit: z[1], needs: need ? treeName(need) : "" };
    });

    var defence = { pieces: 0, weapon: weapon ? weapon.defense || 0 : 0, total: 0 };
    Object.keys(c.defence).forEach(function (slot) { defence.pieces += c.defence[slot]; });
    defence.total = defence.pieces + defence.weapon;
    var res = {};
    RES.forEach(function (name, i) { res[name] = c.resist[i]; });

    return {
      set: set, kind: kind, weapon: weapon, weaponSlots: weaponSlots, pieces: pieces, cuffs: cuffs,
      trees: trees, active: active, zenith: zenith, calc: c,
      limit: { limit: c.final_limit, parts: c.limit, count: c.active.length, over: c.dropped.length > 0 },
      defence: defence, res: res, problems: problems
    };
  }

  var ArmorCalc = { VERSION: VERSION, SLOTS: SLOTS, RES: RES, MAX_DECOS: MAX_DECOS, normalize: normalize,
                    empty: empty, encode: encode, decode: decode, calc: calc, tablesFromRe: tablesFromRe,
                    compute: compute, armourRow: armourRow, decoRow: decoRow };
  if (typeof module !== "undefined" && module.exports) module.exports = ArmorCalc;
  else root.ArmorCalc = ArmorCalc;
})(typeof window !== "undefined" ? window : this);
