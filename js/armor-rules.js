/* The Set builder's skill rules: the game's own rules, decoded from the client by hvmhfz_re (part 199, its
   docs/armor-builder.md "The rules, step by step"; reference calculator tools/items/armor_calc.py). This file
   holds the rules that look at one table row at a time (which skill a total reaches, the weapon-class gate, Zenith
   skills and whether they are lit, the skill limit's parts, defence and slots by level, who can wear a piece);
   js/armor-calc.js walks a whole set with them. Each function names the client function it mirrors
   (mhfo-hd.dll addresses).

   It reads data/armor/rules.json (hvmhfz_re data/armor_rules.json as it is, dev/make-armor-data.py).

   Runs in the browser (window.ArmorRules) and under node (module.exports) for dev/check-set-builder.js. */
(function (root) {
  "use strict";

  var FLAG = { male: 1, female: 2, blademaster: 4, gunner: 8 };

  /** float32 rounding: the client keeps the defence in a 32-bit float. */
  var f32 = Math.fround;

  function make(json) {
    if (!json || !json.rules || !Array.isArray(json.trees)) throw new Error("data/armor/rules.json is not a rules file");
    var r = json.rules;
    var trees = json.trees;
    var treeById = {};
    var skillRow = {};        // skill -> the first activation row (table order) that has it in its levels
    trees.forEach(function (t) {
      treeById[t.id] = t;
      t.levels.forEach(function (l) { if (!(l[1] in skillRow)) skillRow[l[1]] = t; });
    });
    var techTrees = numKeys(r.tech_trees);
    var techSkills = numKeys(r.tech_skills);
    var includes = numKeys(json.skill_includes || {});
    var zenSkills = json.zenith.skills;
    var zenGroups = json.zenith.groups;
    var growth = json.growth;

    function numKeys(obj) {
      var out = {};
      Object.keys(obj).forEach(function (k) { out[Number(k)] = obj[k]; });
      return out;
    }

    /** The skill a total reaches in one activation row (0x10a89cd0 loop): levels 0-2 are negative (at most the
        points), 3-7 positive (at least); the first match from level 0, 1, 2, then 7 down to 3. The all-positive
        tree (0xa1, Strong Attack) reads every level as positive. 0 = none. */
    function skillFor(treeId, pts) {
      var levels = treeById[treeId].levels;
      var k;
      if (treeId === r.all_positive_tree) {
        for (k = 7; k >= 0; k--) if (pts >= levels[k][0]) return levels[k][1];
        return 0;
      }
      for (k = 0; k < 3; k++) if (pts <= levels[k][0]) return levels[k][1];
      for (k = 7; k > 2; k--) if (pts >= levels[k][0]) return levels[k][1];
      return 0;
    }

    function treeOf(skill) { var row = skillRow[skill]; return row ? row.id : null; }

    /** 0x10b42090 / 0x103ba660: a skill of a Tech tree, or one of the Tech skill ids, gives no effect unless the
        weapon class is its own (it still takes its place in the list). */
    function noEffect(skill, weaponClass) {
      var t = techTrees[treeOf(skill)];
      var k = techSkills[skill];
      return (t !== undefined && t !== weaponClass) || (k !== undefined && k !== weaponClass);
    }

    /** The Zenith skill ids of the seven sources (weapon, head, chest, arms, waist, legs, first cuff with one) in
        the client's order (0x1033ff50, 0x10340190, 0x1033fbf0): points add up per group (groups in first-seen
        order); the group's row gives the skill for 1-7 points. */
    function zenithSkills(sources) {
      var groups = [];
      sources.forEach(function (z) {
        if (!(z >= 1 && z <= 0x34 && z < zenSkills.length)) return;
        var g = zenSkills[z].group, p = zenSkills[z].points;
        if (!g) return;
        for (var i = 0; i < groups.length; i++) if (groups[i][0] === g) { groups[i][1] += p; return; }
        groups.push([g, p]);
      });
      return groups.map(function (e) {
        var g = e[0], p = e[1];
        if (!(g >= 1 && g <= 26) || g >= zenGroups.length) return 0;
        return zenGroups[g][Math.min(Math.max(p - 1, 0), 6)];
      });
    }

    /** Whether a Zenith skill takes effect (0x1033f270 -> 0x1033f770, 0x1033f640): no required tree, or one of the
        listed skills (active, automatic, Tower Deco) is a positive level of that tree or includes a skill of it;
        Tech skills of another weapon class are skipped. Guard Up / Reflect Up need a weapon that guards, Stylish
        Up a blademaster weapon; Soul Up is also lit by Red Soul. */
    function zenithLit(zid, listed, weaponClass) {
      if (!(zid >= 1 && zid < zenSkills.length)) return false;
      var need = zenSkills[zid].requires_tree;
      if (!need) return true;
      if (r.zenith_guard_skills.indexOf(zid) !== -1 && r.guard_classes.indexOf(weaponClass) === -1) return false;
      if (r.zenith_blademaster_skills.indexOf(zid) !== -1 &&
          (weaponClass === null || weaponClass === undefined || r.class_kind[weaponClass] & 2)) return false;
      var extra = r.zenith_extra_requirement[String(zid)] || [];
      for (var i = 0; i < listed.length; i++) {
        var skill = listed[i];
        if (noEffect(skill, weaponClass)) continue;
        if (extra.indexOf(skill) !== -1) return true;
        var row = skillRow[skill];
        if (row && row.id === need) {
          var k = row.levels.map(function (l) { return l[1]; }).indexOf(skill);
          if (k >= 3 || row.id === r.all_positive_tree) return true;
          continue;
        }
        var inc = includes[skill] || [];
        for (var j = 0; j < inc.length; j++) {
          var incRow = skillRow[inc[j]];
          if (incRow && incRow.id === need) {
            var levels = row ? row.levels.map(function (l) { return l[1]; }) : [];
            var at = levels.indexOf(inc[j]);
            if (at === -1) at = 8;
            if (at >= 3 || (row && row.id === r.all_positive_tree)) return true;
            break;
          }
        }
      }
      return false;
    }

    /** The skill limit before cuffs lose their slot (0x10a7fe00): 10; +1 for 3-4 and +2 for 5 or more counted
        pieces (G-rank pieces at most 5, Tower plate items of tree 10, Zenith pieces at most 5); plus the highest
        Zenith Skill Slots Up; plus one per skill cuff (at most 2); at most 28. */
    function limitParts(gPieces, zPieces, towerPlates, zenith, cuffs) {
      var total = Math.min(gPieces, 5) + towerPlates + Math.min(zPieces, 5);
      var bonus = 0;
      for (var i = 0; i < r.rank_bonus.length; i++) {
        if (total >= r.rank_bonus[i][0]) { bonus = r.rank_bonus[i][1]; break; }
      }
      var up = 0;
      Object.keys(r.zenith_slot_skills).forEach(function (k) {
        if (zenith.indexOf(Number(k)) !== -1) up = Math.max(up, r.zenith_slot_skills[k]);
      });
      var c = Math.min(cuffs, 2);
      return { rank_pieces: Math.min(gPieces, 5), tower_plates: towerPlates, zenith_pieces: Math.min(zPieces, 5),
               rank_bonus: bonus, skill_slots_up: up, cuffs: c,
               limit: Math.min(r.max_active, r.base_active + bonus + up + c) };
    }

    /** Defence at a level (0x10baaca0): the level 1 value as a float32, multiplied for each level above 1 by its
        growth row's factor, rounded up after each step. rec: {defence, def_growth}. */
    function defenceAt(rec, level) {
      var d = f32(rec.defence);
      var row = growth.defence[Math.min(rec.def_growth, 31)];
      for (var k = 1; k < Math.max(level, 1); k++) {
        d = f32(f32(row[k]) * d);
        var fl = Math.floor(d);
        if (fl < d) d = f32(fl + 1);
      }
      return Math.trunc(d);
    }

    /** Slots at a level (0x10bab0f0): min(max slots, slots + the growth row's extra at that level).
        rec: {slots, max_slots, slot_growth}. */
    function slotsAt(rec, level) {
      var row = growth.slots[Math.min(rec.slot_growth, 15)];
      return Math.min(rec.max_slots, row[Math.min(Math.max(level, 1) - 1, 6)] + rec.slots);
    }

    return {
      raw: json,
      rules: r,
      trees: trees,
      version: json.version || "",
      dataVersion: json.data_version || "",
      cuffSlots: r.max_cuffs,
      maxEntries: 28,
      tree: function (id) { return treeById[id] || null; },
      skillName: function (id) { var s = json.skills[String(id)]; return s ? s.name : "Skill " + id; },
      zenithName: function (id) { return zenSkills[id] ? zenSkills[id].name : "Zenith skill " + id; },
      zenithNeeds: function (id) { return zenSkills[id] ? zenSkills[id].requires_tree : 0; },
      isTechTree: function (tree) { return tree in techTrees; },
      skillFor: skillFor, treeOf: treeOf, noEffect: noEffect, zenithSkills: zenithSkills, zenithLit: zenithLit,
      limitParts: limitParts, defenceAt: defenceAt, slotsAt: slotsAt,

      /** "blademaster" or "gunner" for a weapon class (class_kind bit 1 = gunner), or null when none is picked. */
      weaponKind: function (cls) {
        if (cls === null || cls === undefined || cls < 0) return null;
        return r.class_kind[cls] & 2 ? "gunner" : "blademaster";
      },

      /** The hard rule: a male hunter wears only pieces with the male bit, a female one the female bit (the
          client's equip checks test the record's +4 bits 0 and 1). gender "" = not known: anything. */
      canWear: function (flags, gender) {
        if (gender === "male" && !(flags & FLAG.male)) return false;
        if (gender === "female" && !(flags & FLAG.female)) return false;
        return true;
      },

      /** The list filter only: a piece marked for blademasters or gunners (record +4 bits 2 and 3). No client code
          refuses a piece by these bits (hvmhfz_re docs/armor-builder.md), so the calculator never does. */
      kindFits: function (flags, kind) {
        if (kind === "blademaster") return !!(flags & FLAG.blademaster);
        if (kind === "gunner") return !!(flags & FLAG.gunner);
        return true;
      }
    };
  }

  var ArmorRules = { make: make, FLAG: FLAG };
  if (typeof module !== "undefined" && module.exports) module.exports = ArmorRules;
  else root.ArmorRules = ArmorRules;
})(typeof window !== "undefined" ? window : this);
