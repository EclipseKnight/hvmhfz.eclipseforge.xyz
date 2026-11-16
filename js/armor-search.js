/* The Set builder's skill search: the skills a hunter wants in, armour sets that give them out. No page code: the
   browser runs it in a Web Worker (js/armor-search-worker.js), node runs it in dev/check-armor-search.js.

   Every set it returns is checked with the game's own rules (js/armor-calc.js, js/armor-rules.js): the wanted
   skills are active (not dropped by the skill limit), work with the weapon class, and the set has no problem
   (gender, slots, kinds). docs/armor-set-builder.md "Skill search" has the query, the result and the method.

   Method, in short:
   1. Pieces per slot: the ones the query allows (gender, blademaster/gunner, Zenith, rank, owned, excluded), at
      their highest level (or the owned level), cut to those no other piece beats (dominance: at least the points
      in every wanted tree, as many slots, as many limit pieces, as much defence).
   2. Branch and bound over the five slots, pieces in order of defence: a branch stops when even the best pieces
      left and the best decorations in every free slot cannot reach a wanted total, or when its defence cannot
      reach the worst kept result.
   3. Each complete set gets the fewest decoration slots and cuffs that reach every wanted total (an exact small
      search over the best decorations per tree and size; cached by what is missing and the free slots), then the
      game's calculator decides. A Tower weapon takes Road gems for wanted skills a single gem reaches.
   4. Ranked: all wanted skills met, then defence, free slots, fewer negative skills, more other skills.
   When nothing meets every wanted skill, it searches again without one wanted skill at a time and says which is
   missing. A search that hits its time limit says so (truncated). */
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var Calc = node ? require("./armor-calc.js") : root.ArmorCalc;
  var Rules = node ? require("./armor-rules.js") : root.ArmorRules;
  var Owned = node ? require("./armor-owned.js") : root.ArmorOwned;

  var SLOTS = Calc.SLOTS;
  var MAX_WANTED = 10;
  var DEFAULT_RESULTS = 50, MAX_RESULTS = 200;
  var DEFAULT_TIME_MS = 8000;
  var FILL_NODE_LIMIT = 20000;     // per decoration search; beyond it the answer may not be the cheapest
  var SLOT_COST = 16;              // a decoration slot costs more than a cuff (cuffs take no slot)
  var ITEMS_PER_TREE = 3;          // decorations kept per wanted tree and size (6 for "only what I own")

  var D = null;                    // the game data (setData)

  function now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function int(v, dflt) { var n = Number(v); return isFinite(n) ? Math.trunc(n) : dflt; }

  // ---- data ----------------------------------------------------------------------------------------------

  /** Takes the site's files as parsed JSON: {rules: data/armor/rules.json, index: data/armor/index.json,
      pieces: {head: data/armor/head.json, ...}, weaponTypes: data/weapons/index.json (optional),
      weapons: {class: data/weapons/<type>.json} (optional, needed for a query with a weapon id)}. */
  function setData(src) {
    var R = Rules.make(src.rules);
    var pieces = {}, byId = {};
    SLOTS.forEach(function (slot) {
      var f = {};
      src.pieces[slot].fields.forEach(function (n, i) { f[n] = i; });
      pieces[slot] = [];
      byId[slot] = {};
      src.pieces[slot].pieces.forEach(function (r) {
        var p = { slot: slot, id: r[f.id], name: r[f.name], rarity: r[f.rarity], defence: r[f.defence],
                  slots: r[f.slots], maxSlots: r[f.maxSlots], res: r[f.res], flags: r[f.flags],
                  maxLevel: r[f.maxLevel], skills: r[f.skills], auto: r[f.auto], obtainable: !!r[f.obtainable],
                  defGrowth: r[f.defGrowth], slotGrowth: r[f.slotGrowth], limitKind: r[f.limitKind],
                  zenith: r[f.zenith] };
        p.row = Calc.armourRow(p);
        pieces[slot].push(p);
        byId[slot][p.id] = p;
      });
    });
    var items = {}, decos = [];
    src.index.decorations.forEach(function (d) {
      var it = { item: d[0], name: d[1], kind: d[2], slots: d[3], skills: d[4], obtainable: !!d[5], zenith: d[6],
                 firstTree: d[7], firstPoints: d[8] };
      it.row = Calc.decoRow(it);
      items[it.item] = it;
      decos.push(it);
    });
    src.index.sigils.forEach(function (s) {
      var it = { item: s[0], name: s[1], kind: "s", slots: 1, skills: s[3], effect: s[2], zenith: s[4],
                 firstTree: s[5], firstPoints: s[6] };
      it.row = Calc.decoRow(it);
      items[it.item] = it;
    });
    D = { R: R, index: src.index, version: src.index.version || "", pieces: pieces, byId: byId, items: items,
          decos: decos, types: src.weaponTypes ? src.weaponTypes.types : null, weapons: {} };
    Object.keys(src.weapons || {}).forEach(function (cls) { addWeapons(Number(cls), src.weapons[cls]); });
    return D;
  }

  /** One class's weapons (data/weapons/<type>.json), as js/set-builder.js loadWeapons reads them. */
  function addWeapons(cls, json) {
    var f = {};
    json.fields.forEach(function (n, i) { f[n] = i; });
    var table = json.kind === "melee" ? "melee" : "ranged";
    var auto = D.index.weaponAuto[table] || {}, extra = D.index.weapons[table] || {};
    var byId = {};
    json.weapons.forEach(function (w) {
      var x = extra[w[f.id]] || [0, 0];
      byId[w[f.id]] = { id: w[f.id], name: w[f.name], rarity: w[f.rarity], slots: w[f.slots] || 0,
                        defense: w[f.defense] || 0, auto: auto[w[f.id]] || 0, zenith: x[0], tower: !!x[1] };
    });
    D.weapons[cls] = byId;
  }

  /** Loads what a query needs with getJson(path relative to the site root) -> Promise of parsed JSON. */
  function loadData(getJson, query) {
    var base = D ? Promise.resolve(D) : Promise.all([
      getJson("data/armor/rules.json"), getJson("data/armor/index.json"), getJson("data/weapons/index.json")
    ].concat(SLOTS.map(function (s) { return getJson("data/armor/" + s + ".json"); }))).then(function (all) {
      var pieces = {};
      SLOTS.forEach(function (s, i) { pieces[s] = all[3 + i]; });
      return setData({ rules: all[0], index: all[1], weaponTypes: all[2], pieces: pieces });
    });
    return base.then(function () {
      var cls = query ? int(query.weaponClass, -1) : -1;
      if (cls < 0 || !int(query.weaponId, 0) || D.weapons[cls]) return D;
      var type = (D.types || []).filter(function (t) { return t["class"] === cls; })[0];
      if (!type) throw new Error("Unknown weapon class " + cls);
      return getJson("data/weapons/" + type.slug + ".json").then(function (json) { addWeapons(cls, json); return D; });
    });
  }

  /** The page calculator's ctx (js/armor-calc.js compute) on the loaded data. */
  function ctxFor(gender) {
    return {
      rules: D.R, gender: gender || "",
      piece: function (slot, id) { return (D.byId[slot] || {})[id] || null; },
      weapon: function (cls, id) { return (D.weapons[cls] || {})[id] || null; },
      item: function (id) { return D.items[id] || null; }
    };
  }

  // ---- the query -----------------------------------------------------------------------------------------

  /** A tree's positive skills, lowest points first: [{points, skill}], each skill once (its lowest points). */
  function positiveLevels(tree) {
    var allPos = tree.id === D.R.rules.all_positive_tree;
    var out = [];
    tree.levels.forEach(function (l, k) {
      if (!l[1] || l[0] <= 0 || (!allPos && k < 3)) return;
      if (out.some(function (o) { return o.skill === l[1]; })) return;
      out.push({ points: l[0], skill: l[1] });
    });
    out.sort(function (a, b) { return a.points - b.points; });
    return out;
  }

  /** {skill, level} -> {skill, tree, need} or {skill, problem}. level up to 7 = the tree's n-th positive skill
      (1 = the lowest), 10 or more = a points total (no positive skill needs fewer than 10 points). */
  function resolveWanted(w, cls) {
    var skill = int(w && w.skill, 0);
    var tree = D.R.tree(D.R.treeOf(skill));
    if (!skill || !tree) return { skill: skill, problem: "unknown skill" };
    var levels = positiveLevels(tree);
    var base = levels.filter(function (l) { return l.skill === skill; })[0];
    if (!base) return { skill: skill, problem: "not a positive skill" };
    var need = base.points;
    var level = int(w.level, 0);
    if (level >= 1 && level <= 7) need = Math.max(need, levels[Math.min(level, levels.length) - 1].points);
    else if (level >= 10) need = Math.max(need, level);
    var reached = D.R.skillFor(tree.id, need);
    if (cls >= 0 && reached && D.R.noEffect(reached, cls)) {
      return { skill: skill, problem: "works only with another weapon class" };
    }
    return { skill: skill, tree: tree.id, need: need };
  }

  function readQuery(q) {
    q = q || {};
    var cls = q.weaponClass === null || q.weaponClass === undefined ? -1 : int(q.weaponClass, -1);
    var Q = {
      cls: cls, weapon: null, gender: q.gender === "male" || q.gender === "female" ? q.gender : "",
      kind: q.hunterType === "blade" || q.hunterType === "blademaster" ? "blademaster"
        : q.hunterType === "gunner" ? "gunner" : null,
      noGRank: !!(q.rankMax && int(q.rankMax.gr, 0) <= 0),
      ownedOnly: !!q.ownedOnly, inv: null,
      allowZenith: q.allowZenith !== false, allowTowerDecos: q.allowTowerDecos !== false,
      fixed: {}, exPiece: {}, exItem: {},
      maxResults: Math.max(1, Math.min(MAX_RESULTS, int(q.maxResults, DEFAULT_RESULTS))),
      timeLimitMs: Math.max(50, int(q.timeLimitMs, DEFAULT_TIME_MS)),
      wanted: [], impossible: [], notes: []
    };
    if (Q.noGRank) Q.allowZenith = false;
    var weaponId = int(q.weaponId, 0);
    if (cls >= 0 && weaponId) {
      Q.weapon = (D.weapons[cls] || {})[weaponId] || null;
      if (!Q.weapon) throw new Error("Unknown weapon " + weaponId + " of class " + cls + " (or its data is not loaded)");
    }
    if (Q.ownedOnly) {
      if (!q.owned) throw new Error("\"Only what I own\" needs the character import (owned)");
      Q.inv = Owned.inventory(q.owned, function () { return -1; });
    }
    Object.keys(q.fixed || {}).forEach(function (slot) {
      if (SLOTS.indexOf(slot) === -1) return;
      var id = int(q.fixed[slot], -1);
      if (id === 0) { Q.fixed[slot] = 0; return; }
      if (id > 0 && D.byId[slot][id]) Q.fixed[slot] = id;
      else Q.notes.push("Fixed " + slot + " piece " + q.fixed[slot] + " is unknown and was left free");
    });
    (q.exclude || []).forEach(function (x) {
      if (typeof x === "number") { SLOTS.forEach(function (s) { Q.exPiece[s + ":" + x] = true; }); return; }
      var m = /^(head|chest|arms|waist|legs|item):(\d+)$/.exec(String(x));
      if (!m) return;
      if (m[1] === "item") Q.exItem[Number(m[2])] = true;
      else Q.exPiece[m[1] + ":" + m[2]] = true;
    });
    var byTree = {};
    (q.wanted || []).slice(0, MAX_WANTED).forEach(function (w) {
      var r = resolveWanted(w, cls);
      if (r.problem) { Q.impossible.push(r); return; }
      if (byTree[r.tree]) { byTree[r.tree].need = Math.max(byTree[r.tree].need, r.need); return; }
      byTree[r.tree] = r;
      Q.wanted.push(r);
    });
    if ((q.wanted || []).length > MAX_WANTED) Q.notes.push("Only the first " + MAX_WANTED + " wanted skills are searched");
    return Q;
  }

  /** How many of an item the query may use: Infinity, or what the character has for "only what I own". */
  function itemCount(Q, it) {
    if (Q.exItem[it.item]) return 0;
    if (!Q.allowZenith && it.zenith) return 0;
    if (Q.ownedOnly) {
      var own = Q.inv.items[it.item];
      return own ? Math.max(0, own.have) + Math.max(0, own.inEquipment) : 0;
    }
    return it.obtainable ? Infinity : 0;
  }

  // ---- pieces --------------------------------------------------------------------------------------------

  /** Every allowed piece of a slot at the level the search uses: [{p, level, def, slots, rank}]. */
  function allowedPieces(Q, slot) {
    var R = D.R;
    if (Q.fixed[slot] !== undefined) {
      if (!Q.fixed[slot]) return [emptyPiece(slot)];
      var fp = D.byId[slot][Q.fixed[slot]];
      return [pieceAt(fp, Q.ownedOnly && Q.inv.pieces[slot][fp.id] ? Q.inv.pieces[slot][fp.id] : fp.maxLevel)];
    }
    var out = [];
    D.pieces[slot].forEach(function (p) {
      if (Q.exPiece[slot + ":" + p.id]) return;
      var level = p.maxLevel || 1;
      if (Q.ownedOnly) {
        var own = Q.inv.pieces[slot][p.id];
        if (!own) return;
        level = Math.min(own, level);
      } else if (!p.obtainable) return;
      if (!R.canWear(p.flags, Q.gender)) return;
      if (Q.kind && !R.kindFits(p.flags, Q.kind)) return;
      if (!Q.allowZenith && ((p.limitKind & 2) || p.zenith)) return;
      if (Q.noGRank && (p.limitKind & 1)) return;
      out.push(pieceAt(p, level));
    });
    if (!out.length) out.push(emptyPiece(slot));
    return out;
  }

  function pieceAt(p, level) {
    return { slot: p.slot, p: p, level: level, def: D.R.defenceAt(p.row, level), slots: D.R.slotsAt(p.row, level),
             rank: (p.limitKind & 1) + ((p.limitKind >> 1) & 1) };
  }

  function emptyPiece(slot) { return { slot: slot, p: null, level: 1, def: 0, slots: 0, rank: 0 }; }

  /** Points of a piece (or item) in the wanted trees, and the sum of its negative points elsewhere. */
  function wantedPoints(skills, wanted) {
    var pts = new Int32Array(wanted.length), neg = 0;
    (skills || []).forEach(function (pr) {
      var hit = false;
      for (var i = 0; i < wanted.length; i++) if (wanted[i].tree === pr[0]) { pts[i] += pr[1]; hit = true; }
      if (!hit && pr[1] < 0) neg += pr[1];
    });
    return { pts: pts, neg: neg };
  }

  /** The pieces of a slot no other one beats for this search. A piece beats another when it has at least its
      points in every wanted tree (points above a tree's need count as the need), as many slots, as many skill
      limit pieces (G-rank / Zenith) and as much defence. Sorted by defence, highest first. */
  function bestPieces(list, wanted) {
    var groups = {};
    list.forEach(function (c) {
      var wp = c.p ? wantedPoints(c.p.skills, wanted) : { pts: new Int32Array(wanted.length), neg: 0 };
      c.pts = wp.pts;
      c.neg = wp.neg;
      c.cap = new Int32Array(wanted.length);
      for (var i = 0; i < wanted.length; i++) c.cap[i] = Math.min(c.pts[i], wanted[i].need);
      var key = Array.prototype.join.call(c.cap, ",") + "|" + c.slots + "|" + c.rank;
      var g = groups[key];
      if (!g || c.def > g.def || (c.def === g.def && c.neg > g.neg)) groups[key] = c;
    });
    var keys = Object.keys(groups);
    var cands = keys.map(function (k) { return groups[k]; });
    cands.sort(function (a, b) { return b.def - a.def; });
    var kept = [];
    var W = wanted.length;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i], beaten = false;
      for (var j = 0; j < kept.length && !beaten; j++) {
        var k = kept[j];   // kept ones have at least c's defence (sorted)
        if (k.slots < c.slots || k.rank < c.rank) continue;
        var ok = true;
        for (var t = 0; t < W; t++) if (k.cap[t] < c.cap[t]) { ok = false; break; }
        beaten = ok;
      }
      if (!beaten) kept.push(c);
    }
    return kept;
  }

  // ---- decorations ---------------------------------------------------------------------------------------

  /** The decorations and cuffs worth trying: per wanted tree and size (cuffs are size 0) the best few, plus any
      that help two or more wanted trees; one that another beats (no bigger, at least its points in every
      wanted tree) is left out unless the character's counts matter. */
  function decoCandidates(Q, wanted, cuffMax) {
    var W = wanted.length, useful = [];
    D.decos.forEach(function (it) {
      if (it.kind === "g") return;
      if (it.kind === "c" ? !cuffMax : it.slots < 1 || it.slots > 3) return;
      var count = itemCount(Q, it);
      if (!count) return;
      var wp = wantedPoints(it.skills, wanted);
      var helps = 0;
      for (var i = 0; i < W; i++) if (wp.pts[i] > 0) helps++;
      if (!helps) return;
      useful.push({ it: it, size: it.kind === "c" ? 0 : it.slots, pts: wp.pts, neg: wp.neg, helps: helps,
                    max: it.kind === "c" ? 1 : count });
    });
    if (!Q.ownedOnly) {
      useful = useful.filter(function (a) {
        return !useful.some(function (b) {
          if (b === a || (b.size === 0) !== (a.size === 0) || b.size > a.size) return false;
          var strict = b.size < a.size || b.neg > a.neg;
          for (var i = 0; i < W; i++) {
            if (b.pts[i] < a.pts[i]) return false;
            if (b.pts[i] > a.pts[i]) strict = true;
          }
          return strict || (b.it.item < a.it.item && b.neg === a.neg);
        });
      });
    }
    var keep = {};
    var per = Q.ownedOnly ? 2 * ITEMS_PER_TREE : ITEMS_PER_TREE;
    for (var t = 0; t < W; t++) {
      [0, 1, 2, 3].forEach(function (size) {
        useful.filter(function (c) { return c.size === size && c.pts[t] > 0; })
          .sort(function (a, b) { return b.pts[t] - a.pts[t] || b.helps - a.helps || b.neg - a.neg || a.it.item - b.it.item; })
          .slice(0, per).forEach(function (c) { keep[c.it.item] = c; });
      });
    }
    useful.forEach(function (c) { if (c.helps >= 2) keep[c.it.item] = c; });
    var out = Object.keys(keep).map(function (k) { return keep[k]; });
    out.sort(function (a, b) { return a.it.item - b.it.item; });
    out.forEach(function (c, i) { c.i = i; });
    return out;
  }

  /**
   * The cheapest decorations and cuffs that reach every wanted total: fill(missing points per wanted tree, bins
   * of 3, 2 and 1 slots) -> {cost, slotsUsed, picks: [candidate]} or null. Cheapest = fewest slots, then fewest
   * cuffs. Answers are cached by the arguments.
   */
  function makeFiller(cands, W, cuffMax, limited) {
    var byTree = [], rate = [], cuffBest = [];
    for (var t = 0; t < W; t++) {
      byTree.push(cands.filter(function (c) { return c.pts[t] > 0; })
        .sort(function (a, b) { return (b.pts[t] / (b.size || 0.5)) - (a.pts[t] / (a.size || 0.5)); }));
      rate.push(0);
      var cuffs = [];
      cands.forEach(function (c) {
        if (c.pts[t] <= 0) return;
        if (c.size) rate[t] = Math.max(rate[t], c.pts[t] / c.size);
        else cuffs.push(c.pts[t]);
      });
      cuffs.sort(function (a, b) { return b - a; });
      cuffBest.push(cuffs.slice(0, cuffMax).reduce(function (s, v) { return s + v; }, 0));
    }
    // How many "slot-equivalents" one decoration slot can give across the wanted trees (1 unless a decoration
    // helps two trees): the branch and bound's sum test.
    var multi = 1;
    cands.forEach(function (c) {
      if (!c.size) return;
      var s = 0;
      for (var t = 0; t < W; t++) if (c.pts[t] > 0 && rate[t] > 0) s += c.pts[t] / rate[t];
      multi = Math.max(multi, s / c.size);
    });
    var cache = new Map();
    var stats = { calls: 0, hits: 0, nodes: 0, overflow: 0 };

    function fill(miss, A, B, C) {
      var key = Array.prototype.join.call(miss, ",") + "|" + A + "," + B + "," + C;
      stats.calls++;
      if (cache.has(key)) { stats.hits++; return cache.get(key); }
      var d = Array.prototype.slice.call(miss);
      var best = Infinity, bestPick = null, pick = [], seen = new Map(), used = new Int32Array(cands.length);
      var nodes = 0, over = false;
      function fits(n1, n2, n3) {
        return n3 <= A && n2 <= A - n3 + B && n1 <= 3 * (A - n3) + 2 * B + C - 2 * n2;
      }
      function rec(n1, n2, n3, cu, cost, cuffKey) {
        if (++nodes > FILL_NODE_LIMIT) { over = true; return; }
        var t = -1, lb = 0, i;
        for (i = 0; i < W; i++) {
          if (d[i] <= 0) continue;
          if (t < 0) t = i;
          var r = d[i] - (cu ? cuffBestLeft(i, cu) : cuffBest[i]);
          if (r > 0) {
            if (!rate[i]) return;
            lb = Math.max(lb, Math.ceil(r / rate[i] - 1e-9));
          }
        }
        if (t < 0) {
          if (cost < best) { best = cost; bestPick = pick.slice(); }
          return;
        }
        if (cost + lb * SLOT_COST >= best) return;
        var key = d.join(",") + "|" + n1 + "," + n2 + "," + n3 + "|" + cuffKey + (limited ? "|" + used.join(",") : "");
        var was = seen.get(key);
        if (was !== undefined && was <= cost) return;
        seen.set(key, cost);
        var list = byTree[t];
        for (var k = 0; k < list.length && !over; k++) {
          var c = list[k];
          if (used[c.i] >= c.max) continue;
          var m1 = n1, m2 = n2, m3 = n3, cu2 = cu;
          if (!c.size) { if (cu >= cuffMax) continue; cu2++; }
          else {
            if (c.size === 1) m1++; else if (c.size === 2) m2++; else m3++;
            if (!fits(m1, m2, m3)) continue;
          }
          for (i = 0; i < W; i++) d[i] -= c.pts[i];
          used[c.i]++;
          pick.push(c);
          rec(m1, m2, m3, cu2, cost + (c.size ? c.size * SLOT_COST : 1), c.size ? cuffKey : cuffKey + c.i + ".");
          pick.pop();
          used[c.i]--;
          for (i = 0; i < W; i++) d[i] += c.pts[i];
        }
      }
      function cuffBestLeft(i, cu) { return cu >= cuffMax ? 0 : cuffBest[i]; }
      rec(0, 0, 0, 0, 0, "");
      stats.nodes += nodes;
      if (over) stats.overflow++;
      var out = null;
      if (bestPick) {
        var slotsUsed = 0;
        bestPick.forEach(function (c) { slotsUsed += c.size; });
        out = { cost: best, slotsUsed: slotsUsed, picks: bestPick };
      }
      cache.set(key, out);
      return out;
    }
    return { fill: fill, rate: rate, cuffBest: cuffBest, multi: multi, stats: stats };
  }

  /** Puts decorations into bins ([{owner, cap}]): 3-slot ones in 3-slot bins, 2-slot ones in 2-slot bins first,
      1-slot ones anywhere left. Returns owner -> [item ids]. */
  function placeDecos(picks, bins) {
    var room = bins.map(function (b) { return b.cap; });
    var out = {};
    bins.forEach(function (b) { out[b.owner] = []; });
    function put(item, size, order) {
      for (var k = 0; k < order.length; k++) {
        var i = order[k];
        if (room[i] >= size) { room[i] -= size; out[bins[i].owner].push(item); return true; }
      }
      return false;
    }
    var idx = bins.map(function (_, i) { return i; });
    var byCap = function (cap) { return idx.filter(function (i) { return bins[i].cap === cap; }); };
    var order3 = byCap(3), order2 = byCap(2).concat(byCap(3)), order1 = idx;
    var ok = true;
    picks.filter(function (c) { return c.size === 3; }).forEach(function (c) { ok = put(c.it.item, 3, order3) && ok; });
    picks.filter(function (c) { return c.size === 2; }).forEach(function (c) { ok = put(c.it.item, 2, order2) && ok; });
    picks.filter(function (c) { return c.size === 1; }).forEach(function (c) { ok = put(c.it.item, 1, order1) && ok; });
    return ok ? out : null;
  }

  // ---- checking a set ------------------------------------------------------------------------------------

  /** calc's tables on the loaded data with the query's weapon. */
  function tablesFor(Q) {
    var w = Q.weapon;
    var wrow = w ? { "class": Q.cls, zenith: w.zenith || 0, tower: w.tower ? 1 : 0, slots: w.slots, auto: w.auto || 0 } : null;
    return {
      R: D.R,
      armour: function (slot, id) { var p = D.byId[slot][id]; return p ? p.row : null; },
      deco: function (item) { var it = D.items[item]; return it ? it.row : null; },
      weapon: function (kind, id) { return w && w.id === id ? wrow : null; }
    };
  }

  /** The skill ids a calc result lists that take effect (active, automatic, Tower Deco). */
  function listed(c, cls) {
    var out = c.active.map(function (a) { return a[0]; })
      .concat(c.automatic.map(function (a) { return a[1]; }), c.tower.map(function (t) { return t[0]; }));
    return out.filter(function (s) { return cls < 0 || !D.R.noEffect(s, cls); });
  }

  /** Whether a calc result meets one wanted skill: the tree's skill from points is active with at least the
      wanted points, or an automatic or Tower Deco skill of the tree is at least the wanted level. */
  function meets(c, w, cls) {
    var R = D.R;
    var ids = listed(c, cls);
    var fromPoints = R.skillFor(w.tree, c.points[w.tree] || 0);
    if (fromPoints && (c.points[w.tree] || 0) >= w.need && c.active.some(function (a) { return a[0] === fromPoints; }) &&
        ids.indexOf(fromPoints) !== -1) return true;
    var levels = positiveLevels(R.tree(w.tree));
    var others = c.automatic.map(function (a) { return a[1]; }).concat(c.tower.map(function (t) { return t[0]; }));
    return others.some(function (s) {
      if (ids.indexOf(s) === -1 || R.treeOf(s) !== w.tree) return false;
      var l = levels.filter(function (x) { return x.skill === s; })[0];
      return !!l && l.points >= w.need;
    });
  }

  /** Negative skills and other positive skills (from points) of a calc result. */
  function sideSkills(c, wanted) {
    var neg = 0, extra = 0;
    c.active.forEach(function (a) {
      if (a[2] < 200) { neg++; return; }
      var tree = D.R.treeOf(a[0]);
      if (!wanted.some(function (w) { return w.tree === tree; })) extra++;
    });
    return { negatives: neg, extras: extra + c.automatic.length };
  }

  function rank(a, b) {
    return (b.metCount - a.metCount) || (b.defence - a.defence) || (b.freeSlots - a.freeSlots) ||
      (a.negatives - b.negatives) || (b.extras - a.extras) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }

  // ---- the search ----------------------------------------------------------------------------------------

  /**
   * One branch and bound over the armour for a list of wanted skills (armourWanted; gems already chose theirs).
   * Pausable: step(deadline) runs until the deadline (true = finished).
   */
  function makePass(Q, allowed, armourWanted, gems, keep) {
    var W = armourWanted.length;
    var cuffMax = Q.noGRank ? 0 : D.R.cuffSlots;
    var cands = decoCandidates(Q, armourWanted, cuffMax);
    var filler = makeFiller(cands, W, cuffMax, Q.ownedOnly);
    var need = armourWanted.map(function (w) { return w.need; });
    var lists = SLOTS.map(function (slot) { return bestPieces(allowed[slot], armourWanted); });
    var order = SLOTS.map(function (_, i) { return i; }).sort(function (a, b) { return lists[a].length - lists[b].length; });
    var N = SLOTS.length;
    var L = order.map(function (i) { return lists[i]; });
    // suffix bounds: from depth d on, the most points per tree, slots and defence the pieces left can add
    var sufPts = [], sufCap = new Int32Array(N + 1), sufDef = new Float64Array(N + 1);
    sufPts[N] = new Int32Array(W);
    for (var d = N - 1; d >= 0; d--) {
      sufPts[d] = new Int32Array(W);
      var mc = 0, md = 0;
      for (var t = 0; t < W; t++) {
        var m = -1e9;
        L[d].forEach(function (c) { if (c.cap[t] > m) m = c.cap[t]; });
        sufPts[d][t] = sufPts[d + 1][t] + m;
      }
      L[d].forEach(function (c) { if (c.slots > mc) mc = c.slots; if (c.def > md) md = c.def; });
      sufCap[d] = sufCap[d + 1] + mc;
      sufDef[d] = sufDef[d + 1] + md;
    }
    var weapon = Q.weapon;
    var wCap = weapon && !weapon.tower ? weapon.slots : 0;
    var wDef = weapon ? weapon.defense || 0 : 0;
    var T = tablesFor(Q);

    var pts = [], bins = [], def = new Float64Array(N + 1), chosen = new Array(N), idx = new Int32Array(N + 1);
    for (d = 0; d <= N; d++) { pts.push(new Int32Array(W)); bins.push(new Int32Array(4)); }
    var depth = 0, finished = false;
    var stats = { nodes: 0, leaves: 0, filled: 0, checked: 0, rejected: 0 };

    function feasible(dd) {
      var cap = bins[dd][1] + 2 * bins[dd][2] + 3 * bins[dd][3] + sufCap[dd] + wCap;
      var maxS = 0, sumS = 0;
      for (var t = 0; t < W; t++) {
        var rem = need[t] - pts[dd][t] - sufPts[dd][t] - filler.cuffBest[t];
        if (rem <= 0) continue;
        if (!filler.rate[t]) return false;
        var s = rem / filler.rate[t];
        if (s > maxS) maxS = s;
        sumS += s;
      }
      return maxS <= cap + 1e-9 && sumS <= cap * filler.multi + 1e-9;
    }

    function worst() { return keep.list.length >= keep.max ? keep.list[keep.list.length - 1] : null; }

    function leaf() {
      stats.leaves++;
      var b = bins[N];
      var A = b[3] + (wCap === 3 ? 1 : 0), B = b[2] + (wCap === 2 ? 1 : 0), C = b[1] + (wCap === 1 ? 1 : 0);
      var miss = new Int32Array(W);
      for (var t = 0; t < W; t++) miss[t] = Math.max(0, need[t] - pts[N][t]);
      var f = filler.fill(miss, A, B, C);
      if (!f) return;
      stats.filled++;
      var defence = def[N] + wDef;
      var free = 3 * A + 2 * B + C - f.slotsUsed;
      var w = worst();
      if (w && (defence < w.defence || (defence === w.defence && free < w.freeSlots))) return;
      // the set
      var binList = [];
      var pieces = {};
      for (var k = 0; k < N; k++) {
        var c = chosen[k];
        pieces[c.slot] = c;
        if (c.p && c.slots > 0) binList.push({ owner: c.slot, cap: c.slots });
      }
      if (wCap) binList.push({ owner: "weapon", cap: wCap });
      var placed = placeDecos(f.picks.filter(function (c) { return c.size; }), binList);
      if (!placed) return;
      var cuffs = f.picks.filter(function (c) { return !c.size; }).map(function (c) { return c.it.item; });
      var set = {
        v: Calc.VERSION, data: D.version,
        weapon: [Q.cls, weapon ? weapon.id : 0, [], weapon && weapon.tower ? gems.slice() : (placed.weapon || [])],
        armour: SLOTS.map(function (slot) {
          var c = pieces[slot];
          return [slot, c.p ? c.p.id : 0, c.p ? c.level : 1, c.p ? placed[slot] || [] : []];
        }),
        cuffs: cuffs
      };
      stats.checked++;
      var calcSet = { armour: {}, cuffs: cuffs };
      if (Q.cls >= 0) calcSet.weapon_class = Q.cls;
      if (weapon) {
        calcSet.weapon = { kind: D.R.weaponKind(Q.cls) === "gunner" ? "ranged" : "melee", id: weapon.id,
                           decos: weapon.tower ? new Array(weapon.slots).fill(0).concat(gems) : set.weapon[3] };
      }
      set.armour.forEach(function (a) { if (a[1]) calcSet.armour[a[0]] = { id: a[1], level: a[2], decos: a[3] }; });
      var res = Calc.calc(T, calcSet);
      var metCount = 0;
      Q.wanted.forEach(function (wt) { if (meets(res, wt, Q.cls)) metCount++; });
      if (metCount < keep.needMet) { stats.rejected++; return; }
      var side = sideSkills(res, Q.wanted);
      var entry = { set: set, metCount: metCount, defence: defence, freeSlots: free, negatives: side.negatives,
                    extras: side.extras, key: set.armour.map(function (a) { return a[1]; }).join(",") + "|" + set.cuffs.join(",") };
      keep.add(entry);
    }

    function step(deadline) {
      if (finished) return true;
      while (depth >= 0) {
        if ((++stats.nodes & 511) === 0 && now() > deadline) return false;
        if (depth === N) { leaf(); depth--; continue; }
        var list = L[depth];
        var i = idx[depth]++;
        if (i >= list.length) { depth--; continue; }
        var c = list[i];
        var w = worst();
        // pieces are in order of defence: once one cannot reach the worst kept result, none after it can
        if (w && def[depth] + c.def + sufDef[depth + 1] + wDef < w.defence) { idx[depth] = list.length; continue; }
        var nd = depth + 1;
        for (var t = 0; t < W; t++) pts[nd][t] = pts[depth][t] + c.pts[t];
        for (t = 0; t < 4; t++) bins[nd][t] = bins[depth][t];
        if (c.slots > 0) bins[nd][c.slots]++;
        def[nd] = def[depth] + c.def;
        if (!feasible(nd)) continue;
        chosen[depth] = c;
        depth = nd;
        idx[depth] = 0;
      }
      finished = true;
      return true;
    }

    return {
      step: step,
      progress: function () { return { done: Math.min(idx[0], L[0].length), total: L[0].length }; },
      stats: function () {
        var s = Object.assign({}, stats);
        s.pieces = {};
        order.forEach(function (i, k) { s.pieces[SLOTS[i]] = L[k].length; });
        s.decorations = cands.length;
        s.fill = Object.assign({}, filler.stats);
        return s;
      }
    };
  }

  /** The kept results, best first, at most max. needMet = how many wanted skills a result must meet. */
  function makeKeep(max, needMet) {
    var keep = { list: [], max: max, needMet: needMet, seen: {} };
    keep.add = function (e) {
      if (keep.seen[e.key]) return;
      var list = keep.list;
      if (list.length >= max && rank(e, list[list.length - 1]) >= 0) return;
      var lo = 0, hi = list.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (rank(list[mid], e) <= 0) lo = mid + 1; else hi = mid; }
      list.splice(lo, 0, e);
      keep.seen[e.key] = true;
      if (list.length > max) delete keep.seen[list.pop().key];
    };
    return keep;
  }

  /** Road gems on a Tower weapon: wanted skills that one gem reaches on its own, the hardest first, as many as
      the weapon has gem places. Returns {gems: [item], covered: {tree: true}}. */
  function chooseGems(Q) {
    var out = { gems: [], covered: {} };
    var w = Q.weapon;
    if (!w || !w.tower || !Q.allowTowerDecos) return out;
    var places = Math.max(0, Calc.MAX_DECOS - w.slots);
    var gems = D.decos.filter(function (it) { return it.kind === "g" && itemCount(Q, it) > 0; });
    Q.wanted.slice().sort(function (a, b) { return b.need - a.need; }).forEach(function (wt) {
      if (out.gems.length >= places) return;
      var best = null, bestPts = 0;
      gems.forEach(function (g) {
        var p = 0;
        g.skills.forEach(function (pr) { if (pr[0] === wt.tree) p += pr[1]; });
        if (p >= wt.need && (!best || p < bestPts)) { best = g; bestPts = p; }
      });
      if (best && out.gems.filter(function (x) { return x === best.item; }).length < itemCount(Q, best)) {
        out.gems.push(best.item);
        out.covered[wt.tree] = true;
      }
    });
    return out;
  }

  /** A result for the caller: the set checked by the page's calculator, with its skills and numbers. */
  function finishResult(Q, e) {
    var r = Calc.compute(e.set, ctxFor(Q.gender));
    var c = r.calc;
    var missing = Q.wanted.filter(function (w) { return !meets(c, w, Q.cls); }).map(function (w) { return w.skill; });
    var skills = r.active.filter(function (s) { return !s.dropped; });
    var wantedTrees = Q.wanted.map(function (w) { return w.tree; });
    var extraSkills = skills.filter(function (s) {
      return !s.negative && s.works && wantedTrees.indexOf(s.tree) === -1;
    });
    var side = sideSkills(c, Q.wanted);
    var score = (Q.wanted.length - missing.length) * 1e8 + r.defence.total * 1e3 + e.freeSlots * 20 -
      side.negatives * 5 + side.extras;
    return { set: r.set, skills: skills, extraSkills: extraSkills, defence: r.defence.total, res: r.res,
             freeSlots: e.freeSlots, score: score, met: missing.length === 0, missing: missing,
             problems: r.problems };
  }

  /**
   * Starts a search: start(query, onProgress) -> {step(budgetMs) -> true when done, result(), cancel()}. The Web
   * Worker runs it in short steps so it can hear "cancel"; search() runs it to the end.
   */
  function start(query, onProgress) {
    if (!D) throw new Error("ArmorSearch: load the data first (loadData or setData)");
    var t0 = now();
    var Q = readQuery(query);
    var deadline = t0 + Q.timeLimitMs;
    var allowed = {};
    SLOTS.forEach(function (slot) { allowed[slot] = allowedPieces(Q, slot); });
    var gem = chooseGems(Q);
    var armourWanted = Q.wanted.filter(function (w) { return !gem.covered[w.tree]; });
    var passes = [], passIndex = 0, timedOut = false, relaxed = false, cancelled = false, done = false;
    var keep = makeKeep(Q.maxResults, Q.wanted.length);
    var lastProgress = 0;
    var allStats = [];

    if (Q.wanted.length && !Q.impossible.length) passes.push(makePass(Q, allowed, armourWanted, gem.gems, keep));

    function relax() {
      // nothing meets every wanted skill: once more without each wanted skill in turn
      relaxed = true;
      keep = makeKeep(Q.maxResults, Q.wanted.length - 1);
      Q.wanted.forEach(function (w) {
        var rest = armourWanted.filter(function (x) { return x !== w; });
        passes.push(makePass(Q, allowed, rest, gem.gems, keep));
      });
    }

    function runSteps(budgetMs) {
      if (done) return true;
      var stopAt = Math.min(deadline, now() + (budgetMs === undefined ? Infinity : budgetMs));
      while (passIndex < passes.length) {
        var p = passes[passIndex];
        // relaxed passes share the time left: each gets its part when it starts
        if (relaxed && !p.deadline) p.deadline = now() + (deadline - now()) / (passes.length - passIndex);
        var fin = p.step(Math.min(stopAt, p.deadline || Infinity));
        if (onProgress && now() - lastProgress > 50) {
          lastProgress = now();
          var pr = p.progress();
          onProgress({ done: passIndex * pr.total + pr.done, total: passes.length * pr.total });
        }
        if (!fin) {
          if (now() >= deadline) { timedOut = true; break; }
          if (p.deadline && now() >= p.deadline) { allStats.push(p.stats()); passIndex++; timedOut = true; continue; }
          return false;   // the caller's step is over; the next step goes on
        }
        allStats.push(p.stats());
        passIndex++;
        if (passIndex === passes.length && !relaxed && !keep.list.length && Q.wanted.length > 1 && now() < deadline) relax();
      }
      done = true;
      return true;
    }

    function result() {
      var results = keep.list.map(function (e) { return finishResult(Q, e); });
      // the page's calculator has the last word; a set it finds a problem in is a bug here, counted in stats
      var invalid = results.filter(function (r) { return r.problems.length; }).length;
      results = results.filter(function (r) { return !r.problems.length; });
      results.forEach(function (r) { delete r.problems; });
      return {
        results: results,
        stats: {
          ms: Math.round(now() - t0), wanted: Q.wanted.map(function (w) { return { skill: w.skill, tree: w.tree, need: w.need }; }),
          impossible: Q.impossible, notes: Q.notes, relaxed: relaxed, timedOut: timedOut, cancelled: cancelled,
          gems: gem.gems, invalid: invalid, passes: allStats
        },
        truncated: timedOut || cancelled || allStats.some(function (s) { return s.fill.overflow > 0; })
      };
    }

    return { step: runSteps, result: result, cancel: function () { cancelled = true; done = true; } };
  }

  /** Runs a whole search: {results, stats, truncated}. */
  function search(query, onProgress) {
    var job = start(query, onProgress);
    job.step();
    return job.result();
  }

  /** The answer for a search that could not run (an error), in the shape of a search result. */
  function failed(err) {
    return { results: [], stats: { error: String(err && err.message || err) }, truncated: false };
  }

  var ArmorSearch = { setData: setData, loadData: loadData, addWeapons: addWeapons, start: start, search: search,
                      failed: failed, resolveWanted: function (w, cls) { return resolveWanted(w, int(cls, -1)); },
                      data: function () { return D; } };
  if (node) module.exports = ArmorSearch;
  else root.ArmorSearch = ArmorSearch;
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : this);
