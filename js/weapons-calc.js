/* Damage formula of the weapons page: one melee hit as the game client computes it.
 *
 * Source: hvmhfz_re docs/weapons.md, section 4 (attack build-up) and section 5 (the hit, crits); the
 * constants come from data/weapons/index.json (dev/make-weapons-data.py reads them from the game files).
 * The client works in single-precision floats, so every product goes through Math.fround, in the
 * same order as the reference in dev/make-weapons-data.py (ref_attack, ref_hit, ref_case);
 * dev/check-weapons.js checks the two agree.
 *
 *   true attack  = weapon + flat, × Adrenaline/Worry, × weapon technique, × DS demon (truncated after each),
 *                  × 99/80 with the LS spirit gauge, at most 3000
 *   A            = true attack × 0.01
 *   MV           = record MV + Charge Attack Up bonus; × 1.2 with Fencing+2 on its records
 *   crit MV      = int(MV × 1.25)  (1.35 with Starving Wolf+2, + Ceaseless 0.10/0.15/0.20)
 *   negative     = int(MV × 0.75)
 *   no crit at all below green sharpness (level < 3), negative affinity included
 *   raw          = int(MV × hitzone/100 × sharpness raw × A), at least 1
 *   element      = int(element zone/100 × element × sharpness element × element skill %)
 *   hit          = raw + element
 *
 * Works in the browser (window.HvWeaponsCalc) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  var f = Math.fround;

  /* Attack build-up. c: {attack, flat, attackMult, techMult, demonMult, spirit}; k: index.json constants. */
  function trueAttack(c, k) {
    var total = c.attack + (c.flat || 0);
    [c.attackMult, c.techMult, c.demonMult].forEach(function (m) {
      total = Math.trunc(f(total * f(m === undefined ? 1 : m)));
    });
    if (c.spirit) total = Math.floor(total * k.spiritNum / k.spiritDen);
    return Math.min(total, k.attackCap);
  }

  function critFactor(c, k) {
    var base = c.starvingWolf ? k.critStarvingWolf : k.critBase;
    return c.ceaseless ? f(base + f(k.ceaseless[c.ceaseless])) : f(base);
  }

  /* One hit with record MV `mv` and Charge Attack Up bonus `bonus`.
   * sharpMult: index.json sharpMult (per level: raw, element, bounce). */
  function hit(c, mv, bonus, k, sharpMult) {
    var a = f(trueAttack(c, k) * f(0.01));
    var m = mv + (bonus || 0);
    if (c.fencingHit) m = Math.trunc(f(m * f(k.fencing)));
    var level = c.sharp;
    var canCrit = level >= k.minCritSharpness;
    var critMv = Math.trunc(f(m * critFactor(c, k))) & 0xffff;
    var negMv = Math.trunc(f(m * f(k.critNegative))) & 0xffff;
    var zone = f(c.zone / 100);
    var sr = f(sharpMult[level][0]);
    function raw(x) {
      return Math.max(1, Math.trunc(f(f(f(x * zone) * sr) * a)));
    }
    var elem = 0;
    if (c.elementValue && c.elementZone) {
      var e = f(f(c.elementZone / 100) * c.elementValue);
      e = f(e * f(sharpMult[level][1]));
      elem = Math.trunc(f(e * f((c.elementSkill === undefined ? 100 : c.elementSkill) / 100)));
    }
    var r = raw(m);
    return {
      mv: m, critMv: critMv, raw: r, rawCrit: canCrit ? raw(critMv) : r,
      rawNeg: canCrit ? raw(negMv) : r, element: elem, canCrit: canCrit
    };
  }

  /* A whole move: c.mv and c.bonus are per hit. Returns sums over the hits and the expected value
   * (affinity as the chance; it does nothing below green). */
  function move(c, k, sharpMult) {
    var aff = Math.max(-k.affinityCap, Math.min(k.affinityCap, c.affinity || 0));
    var out = { nonCrit: 0, crit: 0, negCrit: 0, expected: 0, attackTotal: trueAttack(c, k), canCrit: false };
    c.mv.forEach(function (mv, i) {
      var h = hit(c, mv, c.bonus ? c.bonus[i] : 0, k, sharpMult);
      var p = h.canCrit && aff > 0 ? aff / 100 : 0;
      var q = h.canCrit && aff < 0 ? -aff / 100 : 0;
      out.canCrit = h.canCrit;
      out.nonCrit += h.raw + h.element;
      out.crit += h.rawCrit + h.element;
      out.negCrit += h.rawNeg + h.element;
      out.expected += (h.raw + h.element) * (1 - p - q) + (h.rawCrit + h.element) * p + (h.rawNeg + h.element) * q;
    });
    return out;
  }

  /* Weapon technique multiplier for a class and level (0 = none). docs/weapons.md section 4. */
  function techMult(cls, level, k) {
    if (!level) return 1;
    if (cls === 4 && level >= 3) return level === 4 ? k.tech.snsLevel4 : k.tech.snsLevel3;
    if (cls === 13 && level === 4) return k.tech.msLevel4;
    return k.tech[String(level)];
  }

  var api = { trueAttack: trueAttack, critFactor: critFactor, hit: hit, move: move, techMult: techMult };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HvWeaponsCalc = api;
})(this);
