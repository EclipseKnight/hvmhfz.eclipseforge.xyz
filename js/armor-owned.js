/* The Set builder's "my character" helpers: what the API's character import (GET
   /api/account/characters/{id}/builder, docs/armor-set-builder.md "Character import") means for the builder. No page
   code: js/set-builder-mine.js uses it in the page, node runs it in dev/check-set-builder-mine.js.

   An import piece is [slot, id, level, [decorations], boxIndex]: slot "melee", "ranged" (weapons; level null) or an
   armour slot (level 1-7); a My Set piece that left the box has id null. Items are {item id: quantity} maps (JSON
   keys are strings). Weapon classes come from data/weapons/ids.json: per kind a string whose character at position
   <id> is the class letter ('a' = class 0, the game's order) or '.'. */
(function (root) {
  "use strict";

  var ARMOUR = ["head", "chest", "arms", "waist", "legs"];
  var RANGED = [1, 5, 10];   // Heavy Bowgun, Light Bowgun, Bow: the "ranged" equipment table

  /** "melee" or "ranged" for a weapon class (-1: ""). */
  function kindOfClass(cls) {
    if (cls < 0) return "";
    return RANGED.indexOf(cls) !== -1 ? "ranged" : "melee";
  }

  /** A function (kind, id) -> weapon class or -1, from data/weapons/ids.json. */
  function classFinder(ids) {
    return function (kind, id) {
      var line = ids && ids[kind];
      if (typeof line !== "string" || !(id > 0) || id >= line.length) return -1;
      var ch = line.charAt(id);
      return ch === "." ? -1 : ch.charCodeAt(0) - 97;
    };
  }

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }

  /**
   * A set (the set format of js/armor-calc.js) from import pieces and cuffs: the worn set, the town set or a My Set.
   * Returns {set, lost}: lost = pieces that are no longer in the equipment box (a My Set keeps their place only).
   */
  function setFromPieces(pieces, cuffs, classOf) {
    var set = { v: 1, data: "", weapon: [-1, 0, [], []], armour: ARMOUR.map(function (s) { return [s, 0, 1, []]; }),
                cuffs: (cuffs || []).filter(function (c) { return n(c) > 0; }) };
    var lost = 0;
    (pieces || []).forEach(function (p) {
      if (!Array.isArray(p)) return;
      var slot = p[0], id = n(p[1]), decos = (p[3] || []).filter(function (d) { return n(d) > 0; });
      if (!id) { lost++; return; }
      if (slot === "melee" || slot === "ranged") {
        set.weapon = [classOf(slot, id), id, [], decos];
        return;
      }
      var i = ARMOUR.indexOf(slot);
      if (i !== -1) set.armour[i] = [slot, id, Math.max(1, n(p[2]) || 1), decos];
    });
    return { set: set, lost: lost };
  }

  /**
   * What the character owns, for the pickers: pieces[slot][id] = highest level owned (armour), weapons[class][id] =
   * true, items[id] = {have: in box + pouch + warehouse, inEquipment: set in the equipment box's pieces}.
   */
  function inventory(imp, classOf) {
    var out = { pieces: {}, weapons: {}, items: {} };
    ARMOUR.forEach(function (s) { out.pieces[s] = {}; });
    (imp && imp.owned || []).forEach(function (p) {
      var slot = p[0], id = n(p[1]);
      if (!id) return;
      if (slot === "melee" || slot === "ranged") {
        var cls = classOf(slot, id);
        if (cls < 0) return;
        (out.weapons[cls] || (out.weapons[cls] = {}))[id] = true;
      } else if (out.pieces[slot]) {
        out.pieces[slot][id] = Math.max(out.pieces[slot][id] || 0, n(p[2]) || 1);
      }
    });
    function add(map, key) {
      Object.keys(map || {}).forEach(function (k) {
        var id = n(k);
        if (!id) return;
        var it = out.items[id] || (out.items[id] = { have: 0, inEquipment: 0 });
        it[key] += n(map[k]);
      });
    }
    add(imp && imp.items, "have");
    add(imp && imp.inEquipment, "inEquipment");
    return out;
  }

  /** True when the character has the item in a box or set in some equipment. */
  function ownsItem(inv, id) {
    var it = inv && inv.items[id];
    return !!it && (it.have > 0 || it.inEquipment > 0);
  }

  /** How many times the set uses an item (decorations and sigils in any piece, cuffs). */
  function usesInSet(set, id) {
    var count = 0;
    function each(list) { (list || []).forEach(function (x) { if (x === id) count++; }); }
    each(set.weapon[3]);
    set.armour.forEach(function (a) { each(a[3]); });
    each(set.cuffs);
    return count;
  }

  /**
   * The body of POST .../builder/missing: the set (normalized by the caller), with `data` the first 12 hex digits of
   * the page's mhfdat.bin SHA-256 (the API's dataVersion; data/armor/index.json source.mhfdatSha256) and every
   * armour level capped at the piece's highest (maxLevelOf(slot, id), the API refuses levels above 7). Null when
   * the set has nothing the API can count (no weapon, no piece, no cuff).
   */
  function missingBody(set, mhfdatSha256, maxLevelOf) {
    var body = JSON.parse(JSON.stringify(set));
    body.data = typeof mhfdatSha256 === "string" ? mhfdatSha256.slice(0, 12) : "";
    body.armour.forEach(function (a) {
      if (!a[1]) return;
      var max = maxLevelOf(a[0], a[1]) || 7;
      a[2] = Math.max(1, Math.min(a[2], max, 7));
    });
    var weapon = body.weapon[0] >= 0 && body.weapon[1] > 0;
    var any = weapon || body.armour.some(function (a) { return a[1]; }) || body.cuffs.length;
    return any ? body : null;
  }

  var ArmorOwned = { kindOfClass: kindOfClass, classFinder: classFinder, setFromPieces: setFromPieces,
                     inventory: inventory, ownsItem: ownsItem, usesInSet: usesInSet, missingBody: missingBody };
  if (typeof module !== "undefined" && module.exports) module.exports = ArmorOwned;
  else root.ArmorOwned = ArmorOwned;
})(typeof window !== "undefined" ? window : this);
