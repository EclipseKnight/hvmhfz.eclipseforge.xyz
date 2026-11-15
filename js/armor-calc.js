/* The Set builder's calculator: a set in, its skill points, active skills, defence and resistances out. No page
   code: set-builder.html (js/set-builder.js) and node (dev/check-set-builder.js) both run it.

   The set format (docs/armor-set-builder.md "Set format"; one shape for the URL, the API and test fixtures):
     {"v": 1, "data": "v1.29",
      "weapon": [class, id, [extra levels], [decoration or sigil item ids]],   class -1 = none, id 0 = any weapon
      "armour": [["head", id, level, [decoration item ids]], ... chest, arms, waist, legs],   id 0 = empty
      "cuffs": [cuff item ids]}
   In the address it is base64url(JSON) after #s= (encode / decode below).

   Every game rule (skill limit, weapon gates, Zenith, defence by level, top-level slots, what defence and
   resistance skills add) comes from the rules object of js/armor-rules.js; this file only adds things up. */
(function (root) {
  "use strict";

  var VERSION = 1;
  var SLOTS = ["head", "chest", "arms", "waist", "legs"];
  var RES = ["fire", "water", "thunder", "dragon", "ice"];
  var MAX_DECOS = 3;   // an equipment box record keeps 3 decoration ids per piece (design 2.1)

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

  /** The skill a tree's total reaches: the highest positive threshold met, or the lowest negative one. */
  function activation(levels, total) {
    var hit = null;
    levels.forEach(function (l) {
      var pts = l[0];
      if (pts > 0 && total >= pts && (!hit || pts > hit[0])) hit = l;
      if (pts < 0 && total <= pts && (!hit || pts < hit[0])) hit = l;
    });
    return hit ? { points: hit[0], skill: hit[1], name: hit[2] } : null;
  }

  /** The next threshold above the total (for "3 more points to ..."), or null. */
  function nextLevel(levels, total) {
    var best = null;
    levels.forEach(function (l) {
      if (l[0] > 0 && l[0] > total && (!best || l[0] < best[0])) best = l;
    });
    return best ? { points: best[0], skill: best[1], name: best[2] } : null;
  }

  /**
   * Adds up a set. ctx:
   *   piece(slot, id)  -> {id, name, rarity, defence, slots, topSlots, res[5], flags, maxLevel, skills, auto} | null
   *   weapon(cls, id)  -> {id, name, slots, defense, auto} | null
   *   item(id)         -> {item, name, kind "d"|"g"|"c"|"s" (sigil), slots, skills} | null
   *   tree(id)         -> {id, name, levels: [[points, skill, name]]} | null
   *   skillName(id)    -> string
   *   rules            -> js/armor-rules.js make()
   *   gender           -> "", "male" or "female" (who wears it)
   */
  function compute(rawSet, ctx) {
    var set = normalize(rawSet);
    var rules = ctx.rules;
    var cls = set.weapon[0];
    var kind = rules.weaponKind(cls);
    var points = {};     // tree -> {total, parts}
    var auto = [];       // [{skill, from}]
    var problems = [];
    var pieces = [];
    var defence = { pieces: 0, weapon: 0, skills: 0, total: 0, exact: true };
    var res = [0, 0, 0, 0, 0];

    function addPoints(skills, from) {
      (skills || []).forEach(function (s) {
        var p = points[s[0]] || (points[s[0]] = { total: 0, parts: [] });
        p.total += s[1];
        p.parts.push({ from: from, points: s[1] });
      });
    }

    function addDecos(list, capacity, where, allowSigils) {
      var used = 0;
      var rows = [];
      list.forEach(function (itemId) {
        var d = ctx.item(itemId);
        if (!d) { problems.push(where + ": unknown decoration " + itemId); return; }
        if (d.kind === "c") { problems.push(d.name + " is a skill cuff: it goes in a cuff slot, not in " + where); return; }
        if (d.kind === "s" && !allowSigils) { problems.push(d.name + " is a weapon sigil: it cannot go in " + where); return; }
        used += d.slots;
        rows.push(d);
        addPoints(d.skills, d.name + " (" + where + ")");
      });
      if (used > capacity) problems.push(where + ": decorations need " + used + " slots, it has " + capacity);
      return { used: used, capacity: capacity, decos: rows };
    }

    // weapon
    var weapon = cls >= 0 && set.weapon[1] ? ctx.weapon(cls, set.weapon[1]) : null;
    if (cls >= 0 && set.weapon[1] && !weapon) problems.push("Unknown weapon " + set.weapon[1]);
    var weaponSlots = null;
    if (weapon) {
      weaponSlots = addDecos(set.weapon[3], weapon.slots, weapon.name, true);
      defence.weapon = weapon.defense || 0;
      (weapon.auto || []).forEach(function (s) { auto.push({ skill: s, from: weapon.name }); });
    } else if (set.weapon[3].length) {
      problems.push("Decorations on the weapon need a weapon picked");
    }

    // armour
    set.armour.forEach(function (a) {
      var slot = a[0];
      if (!a[1]) { pieces.push({ slot: slot, piece: null }); return; }
      var piece = ctx.piece(slot, a[1]);
      if (!piece) { problems.push("Unknown " + slot + " piece " + a[1]); pieces.push({ slot: slot, piece: null }); return; }
      var level = Math.min(Math.max(1, a[2]), piece.maxLevel || 1);
      if (a[2] > level) problems.push(piece.name + " goes up to level " + piece.maxLevel);
      if (!rules.canWear(piece.flags, kind, ctx.gender || "")) {
        problems.push(piece.name + " cannot be worn" + (kind ? " by a " + kind : "") +
          (ctx.gender ? " (" + ctx.gender + ")" : ""));
      }
      var def = rules.defenceAt(piece, level);
      if (!def.exact) defence.exact = false;
      defence.pieces += def.value;
      for (var i = 0; i < 5; i++) res[i] += piece.res[i] || 0;
      addPoints(piece.skills, piece.name);
      var slots = rules.slotsAt(piece, level);
      var deco = addDecos(a[3], slots.value, piece.name, false);
      (piece.auto || []).forEach(function (s) { auto.push({ skill: s, from: piece.name }); });
      rules.zenithSkills(slot, piece.id).forEach(function (s) { auto.push({ skill: s, from: piece.name + " (Zenith)" }); });
      pieces.push({ slot: slot, piece: piece, level: level, defence: def, slots: slots, decos: deco });
    });

    // cuffs
    var cuffs = [];
    set.cuffs.forEach(function (itemId, i) {
      var d = ctx.item(itemId);
      if (i >= rules.cuffSlots) { problems.push("Only " + rules.cuffSlots + " cuff slots"); return; }
      if (!d) { problems.push("Unknown cuff " + itemId); return; }
      if (d.kind !== "c") { problems.push(d.name + " is not a skill cuff"); return; }
      cuffs.push(d);
      addPoints(d.skills, d.name + " (cuff)");
    });

    // skill points -> skills
    var trees = Object.keys(points).map(function (k) {
      var id = Number(k);
      var t = ctx.tree(id) || { id: id, name: "Tree " + id, levels: [] };
      var total = points[k].total;
      var works = rules.treeWorks(id, cls);
      return { tree: id, name: t.name, total: total, parts: points[k].parts, skill: activation(t.levels, total),
               next: nextLevel(t.levels, total), works: works.ok, worksExact: works.exact };
    }).filter(function (t) { return t.total !== 0 || t.parts.length; });
    trees.sort(function (a, b) { return Math.abs(b.total) - Math.abs(a.total) || a.name.localeCompare(b.name); });

    var active = [];
    var seen = {};
    trees.forEach(function (t) {
      if (!t.skill) return;
      seen[t.skill.skill] = true;
      active.push({ skill: t.skill.skill, name: t.skill.name, tree: t.tree, treeName: t.name, total: t.total,
                    negative: t.skill.points < 0, from: "points", works: t.works, worksExact: t.worksExact });
    });
    auto.forEach(function (a) {
      if (seen[a.skill]) return;
      seen[a.skill] = true;
      active.push({ skill: a.skill, name: ctx.skillName(a.skill), tree: null, treeName: "", total: null,
                    negative: false, from: "automatic", source: a.from, works: true, worksExact: true });
    });

    var lim = rules.skillLimit(active.map(function (a) { return a.skill; }));
    var dropped = rules.dropped(active, lim.limit);
    active.forEach(function (a) { a.dropped = !!(dropped && dropped.indexOf(a.skill) !== -1); });

    var bonusExact = true;
    active.forEach(function (a) {
      if (a.dropped || !a.works) return;
      var b = rules.bonus(a.skill);
      if (!b) return;
      if (!b.exact) bonusExact = false;
      defence.skills += b.defence;
      for (var i = 0; i < 5; i++) res[i] += b.res[i];
    });
    defence.total = defence.pieces + defence.weapon + defence.skills;

    var resOut = {};
    RES.forEach(function (name, i) { resOut[name] = res[i]; });

    return {
      set: set, kind: kind, weapon: weapon, weaponSlots: weaponSlots, pieces: pieces, cuffs: cuffs,
      trees: trees, active: active,
      limit: { limit: lim.limit, exact: lim.exact, count: active.length, over: active.length > lim.limit,
               dropKnown: dropped !== null },
      defence: defence, res: resOut, bonusExact: bonusExact, problems: problems
    };
  }

  var ArmorCalc = { VERSION: VERSION, SLOTS: SLOTS, RES: RES, MAX_DECOS: MAX_DECOS, normalize: normalize,
                    empty: empty, encode: encode, decode: decode, activation: activation, compute: compute };
  if (typeof module !== "undefined" && module.exports) module.exports = ArmorCalc;
  else root.ArmorCalc = ArmorCalc;
})(typeof window !== "undefined" ? window : this);
