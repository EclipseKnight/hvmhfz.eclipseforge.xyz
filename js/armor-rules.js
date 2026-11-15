/* The Set builder's skill rules: the one place that knows how the game limits and gates skills, so the
   calculator (js/armor-calc.js) and the page never hard-code a rule.

   It reads data/armor/rules.json (format: docs/armor-set-builder.md "Rules file"). Today that file is the
   FALLBACK written by dev/make-armor-data.py ("exact": false): the game's own rules are being decoded from the
   client by hvmhfz_re (lane A of the armour builder design). Every answer says whether it is exact, so the
   page can mark the parts that are not.

   TODO(lane A): when hvmhfz_re data/armor_builder.json lands, regenerate rules.json from it
   (python3 dev/make-armor-data.py --rules <file>). If its rules need a shape this module cannot express
   (for example a skill limit that depends on something other than active skills), extend the functions here
   and nothing else.

   Runs in the browser (window.ArmorRules) and under node (module.exports) for dev/check-set-builder.js. */
(function (root) {
  "use strict";

  /* Used when rules.json cannot be loaded at all: nothing is known beyond a limit of 10. */
  var FALLBACK = {
    version: "", exact: false, source: "built-in fallback (data/armor/rules.json did not load)",
    skillLimit: { base: 10, exact: false, note: "Skill limit not decoded yet." },
    overLimit: { known: false, note: "Which skills drop over the limit is not decoded yet." },
    weapon: { exact: false, treeClasses: {}, blademasterTrees: [], gunnerTrees: [], gunnerClasses: [1, 5, 10] },
    zenith: { known: false, skills: [], note: "Zenith skills are not decoded yet." },
    levels: { exact: false, defencePerLevel: null, topSlotsAt: "max", note: "Defence growth by level not decoded." },
    cuffSlots: 2,
    bonuses: { exact: false, skills: {} }
  };

  var FLAG = { male: 1, female: 2, blademaster: 4, gunner: 8 };

  function make(json) {
    var r = json && typeof json === "object" ? json : FALLBACK;
    function part(name) { return r[name] || FALLBACK[name]; }
    var weapon = part("weapon");
    var blade = {}, gun = {}, gunnerClasses = {};
    (weapon.blademasterTrees || []).forEach(function (t) { blade[t] = true; });
    (weapon.gunnerTrees || []).forEach(function (t) { gun[t] = true; });
    (weapon.gunnerClasses || [1, 5, 10]).forEach(function (c) { gunnerClasses[c] = true; });
    var limit = part("skillLimit");
    var over = part("overLimit");
    var levels = part("levels");
    var bonuses = part("bonuses");
    var zenith = part("zenith");

    var api = {
      raw: r,
      exact: !!r.exact,
      version: r.version || "",
      source: r.source || "",
      cuffSlots: typeof r.cuffSlots === "number" ? r.cuffSlots : FALLBACK.cuffSlots,
      notes: {
        skillLimit: limit.exact ? "" : (limit.note || "not yet exact"),
        overLimit: over.known ? "" : (over.note || "not yet exact"),
        weapon: weapon.exact ? "" : (weapon.note || "not yet exact"),
        zenith: zenith.known ? "" : (zenith.note || "not yet exact"),
        levels: levels.exact ? "" : (levels.note || "not yet exact"),
        bonuses: bonuses.exact ? "" : (bonuses.note || "not yet exact")
      },

      /** "blademaster" or "gunner" for a weapon class, or null when no class is picked. */
      weaponKind: function (cls) {
        if (cls === null || cls === undefined || cls < 0) return null;
        return gunnerClasses[cls] ? "gunner" : "blademaster";
      },

      /** Whether a piece with these flag bits can be worn with this weapon kind and gender ("" = any). */
      canWear: function (flags, kind, gender) {
        if (kind === "blademaster" && !(flags & FLAG.blademaster)) return false;
        if (kind === "gunner" && !(flags & FLAG.gunner)) return false;
        if (gender === "male" && !(flags & FLAG.male)) return false;
        if (gender === "female" && !(flags & FLAG.female)) return false;
        return true;
      },

      /** Does a skill tree work with this weapon class? {ok, exact}; ok is true when no class is picked. */
      treeWorks: function (tree, cls) {
        var exact = !!weapon.exact;
        if (cls === null || cls === undefined || cls < 0) return { ok: true, exact: exact };
        var only = weapon.treeClasses && weapon.treeClasses[tree];
        if (only) return { ok: only.indexOf(cls) !== -1, exact: exact };
        if (blade[tree]) return { ok: !gunnerClasses[cls], exact: exact };
        if (gun[tree]) return { ok: !!gunnerClasses[cls], exact: exact };
        return { ok: true, exact: exact };
      },

      /** The active skill limit for this list of active skill ids: {limit, exact}. Raises (Zenith Skill Slots
          Up and the like) come from skillLimit.raises: [{skill, add}], capped at skillLimit.max. */
      skillLimit: function (activeSkillIds) {
        var n = limit.base || 10;
        (limit.raises || []).forEach(function (raise) {
          if (activeSkillIds.indexOf(raise.skill) !== -1) n += raise.add || 0;
        });
        if (limit.max) n = Math.min(n, limit.max);
        return { limit: n, exact: !!limit.exact };
      },

      /** Which active skills the game drops when there are more than the limit. active: [{tree, skill}].
          Returns the skill ids dropped, or null when the rule is not known (then nothing is dropped and the
          page only warns). Known rule: overLimit.order, the tree order the game fills the list in. */
      dropped: function (active, max) {
        if (active.length <= max) return [];
        if (!over.known || !over.order) return null;
        var rank = {};
        over.order.forEach(function (tree, i) { rank[tree] = i; });
        var sorted = active.slice().sort(function (a, b) {
          var ra = rank[a.tree] === undefined ? 1e9 : rank[a.tree];
          var rb = rank[b.tree] === undefined ? 1e9 : rank[b.tree];
          return ra - rb;
        });
        return sorted.slice(max).map(function (a) { return a.skill; });
      },

      /** Extra skills a piece gives through Zenith rules: zenith.pieceSkills {"slot:id": [skill ids]}. */
      zenithSkills: function (slot, id) {
        var map = zenith.pieceSkills || {};
        return (map[slot + ":" + id] || []).slice();
      },

      /** Defence of a piece at a level: {value, exact}. levels.defencePerLevel: {"<rarity>": [added at level
          1, 2, ...]} when decoded; until then the level 1 defence. */
      defenceAt: function (piece, level) {
        var table = levels.defencePerLevel && levels.defencePerLevel[piece.rarity];
        if (table && level >= 1 && level <= table.length) return { value: piece.defence + table[level - 1], exact: true };
        return { value: piece.defence, exact: level <= 1 };
      },

      /** Slots of a piece at a level: {value, exact}. */
      slotsAt: function (piece, level) {
        if (piece.topSlots > piece.slots && levels.topSlotsAt === "max") {
          return { value: level >= piece.maxLevel ? piece.topSlots : piece.slots, exact: !!levels.exact };
        }
        return { value: piece.slots, exact: true };
      },

      /** What an active skill adds to defence and resistances: {defence, res: [5]} or null. */
      bonus: function (skill) {
        var b = bonuses.skills && bonuses.skills[skill];
        return b ? { defence: b.defence || 0, res: b.res || [0, 0, 0, 0, 0], exact: !!bonuses.exact } : null;
      }
    };
    return api;
  }

  var ArmorRules = { make: make, FALLBACK: FALLBACK, FLAG: FLAG };
  if (typeof module !== "undefined" && module.exports) module.exports = ArmorRules;
  else root.ArmorRules = ArmorRules;
})(typeof window !== "undefined" ? window : this);
