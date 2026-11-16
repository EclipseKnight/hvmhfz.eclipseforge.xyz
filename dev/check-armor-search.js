#!/usr/bin/env node
/* Checks the Set builder's skill search (js/armor-search.js, js/armor-search-worker.js; docs/armor-set-builder.md
   "Skill search").

   Node:
   - wanted skills: a skill id alone, a skill level (1-7) and a points total (10 or more) give the right need;
     unknown, negative and other-weapon Tech skills are reported as impossible, not searched;
   - known sets: sets made from the data with a fixed seed (random obtainable pieces and decorations); the search
     for their skills finds a set at least as strong (defence), and "only what I own" with a fake character import
     that holds the known set's pieces and decorations plus decoys finds a set made only of what it owns (counts
     and levels respected);
   - the rank rule (js/armor-rank.js, hvmhfz_re part 200 "Site filter"): HR bands from an HR, the band / GR / GSR
     tests, the list texts;
   - common searches (3 to 5 skills, with gender, blademaster / gunner, HR999 without G Rank, HR band 3, GR 50,
     GSR 1, no Zenith, a Tower weapon, a weapon with slots, fixed and excluded pieces): every result is checked on its own with ArmorCalc.compute (no
     problem, every wanted skill active and working with the weapon, defence and free slots as reported), every
     constraint holds, results are ranked, and each search finishes inside the time budget (BUDGET_MS, default
     3000 ms on node) without being truncated;
   - nothing meets every skill: results without one wanted skill, marked as such; a tiny time limit says
     truncated; progress is reported.
   Browser (headless Chromium): the Web Worker loads the data, sends progress and a result that passes the same
   checks inside the browser budget (BROWSER_BUDGET_MS, default 8000 ms, data loading included); "cancel" stops a
   search with no answer for it, and the next search still answers.

     NODE_PATH=/root/work/pw-tools/node_modules [BUDGET_MS=3000] node dev/check-armor-search.js

   Exit code 0 = all as expected. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const Calc = require(path.join(ROOT, "js/armor-calc.js"));
const Search = require(path.join(ROOT, "js/armor-search.js"));
const Rank = require(path.join(ROOT, "js/armor-rank.js"));
const BUDGET_MS = Number(process.env.BUDGET_MS) || 3000;
const BROWSER_BUDGET_MS = Number(process.env.BROWSER_BUDGET_MS) || 8000;
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

const SLOTS = Calc.SLOTS;
const index = readJson("data/armor/index.json");
const weaponTypes = readJson("data/weapons/index.json");
const pieceFiles = {};
SLOTS.forEach(function (s) { pieceFiles[s] = readJson("data/armor/" + s + ".json"); });
const WEAPON_CLASSES = [7, 10, 9];   // Long Sword, Bow, Gunlance
const weaponFiles = {};
WEAPON_CLASSES.forEach(function (cls) {
  weaponFiles[cls] = readJson("data/weapons/" + weaponTypes.types.find(function (t) { return t["class"] === cls; }).slug + ".json");
});
Search.setData({ rules: readJson("data/armor/rules.json"), index: index, pieces: pieceFiles, weaponTypes: weaponTypes,
                 weapons: weaponFiles });
const D = Search.data();
const R = D.R;

function skill(name) {
  const k = Object.keys(R.raw.skills).find(function (id) { return R.raw.skills[id].name === name; });
  if (!k) throw new Error("no skill " + name);
  return Number(k);
}
function ctxWith(gender) {
  return { rules: R, gender: gender || "",
           piece: function (slot, id) { return D.byId[slot][id] || null; },
           weapon: function (cls, id) { return (D.weapons[cls] || {})[id] || null; },
           item: function (id) { return D.items[id] || null; } };
}
function wanted(names) { return names.map(function (n) { return { skill: skill(n) }; }); }

/* ---- an independent check of one result ---- */

/** Problems of a result against its query (empty = fine). need: [{skill, tree, need}] from stats.wanted. */
function problemsOf(res, q, need) {
  const out = [];
  const r = Calc.compute(res.set, ctxWith(q.gender));
  r.problems.forEach(function (p) { out.push("calculator: " + p); });
  const cls = q.weaponClass === undefined ? -1 : q.weaponClass;
  const active = r.active.filter(function (s) { return !s.dropped && s.works; });
  const missing = [];
  need.forEach(function (w) {
    const ok = active.some(function (s) {
      if (s.tree !== w.tree) return false;
      if (s.from === "points") return s.total >= w.need && !s.negative;
      const lv = R.tree(w.tree).levels.find(function (l) { return l[1] === s.skill; });
      return lv && lv[0] >= w.need;
    });
    if (!ok) missing.push(w.skill);
  });
  if (res.met !== (missing.length === 0)) out.push("met says " + res.met + ", missing " + missing.join(","));
  if (JSON.stringify(res.missing) !== JSON.stringify(missing)) out.push("missing " + res.missing + " should be " + missing);
  if (res.defence !== r.defence.total) out.push("defence " + res.defence + " should be " + r.defence.total);
  let free = 0;
  r.pieces.forEach(function (p) { if (p.piece) free += p.slots.value - p.decos.used; });
  if (r.weaponSlots && !r.weaponSlots.tower) free += r.weaponSlots.capacity - r.weaponSlots.used;
  if (res.freeSlots !== free) out.push("free slots " + res.freeSlots + " should be " + free);
  if (res.set.weapon[0] !== cls) out.push("weapon class " + res.set.weapon[0]);
  if ((q.weaponId || 0) !== res.set.weapon[1]) out.push("weapon " + res.set.weapon[1]);
  const kind = q.hunterType === "blade" ? "blademaster" : q.hunterType === "gunner" ? "gunner" : null;
  const exclude = q.exclude || [];
  const hunter = Rank.hunter(q.rankMax, index.rank.bands);
  res.set.armour.forEach(function (a) {
    const fixed = q.fixed && q.fixed[a[0]] !== undefined ? q.fixed[a[0]] : null;
    if (fixed !== null) { if (a[1] !== fixed) out.push(a[0] + " is not the fixed piece"); return; }
    if (!a[1]) return;
    const p = D.byId[a[0]][a[1]];
    if (!q.ownedOnly && !p.obtainable) out.push(p.name + " is not obtainable");
    if (!R.canWear(p.flags, q.gender || "")) out.push(p.name + " not for " + q.gender);
    if (kind && !R.kindFits(p.flags, kind)) out.push(p.name + " not a " + kind + " piece");
    if (q.allowZenith === false && ((p.limitKind & 2) || p.zenith)) out.push(p.name + " is a Zenith piece");
    if (!q.ownedOnly && !Rank.fits(p.craft, hunter)) out.push(p.name + " needs " + (Rank.text(p.craft) || "a smithy that never offers it"));
    if (exclude.indexOf(a[1]) !== -1 || exclude.indexOf(a[0] + ":" + a[1]) !== -1) out.push(p.name + " was excluded");
    a[3].forEach(function (d) {
      const it = D.items[d];
      if (it.kind !== "d") out.push(it.name + " on " + p.name);
      if (!q.ownedOnly && !it.obtainable) out.push(it.name + " is not obtainable");
      if (exclude.indexOf("item:" + d) !== -1) out.push(it.name + " was excluded");
    });
  });
  if (hunter && hunter.band && !hunter.gr && res.set.cuffs.length) out.push("cuffs for an HR hunter");
  if (hunter && hunter.band && !hunter.gr && res.set.armour.some(function (a) { return a[3].some(function (d) { return D.items[d].zenith; }); })) {
    out.push("Zenith decorations for an HR hunter");
  }
  if (res.set.cuffs.length > 2) out.push("more than 2 cuffs");
  if (new Set(res.set.cuffs).size !== res.set.cuffs.length) out.push("the same cuff twice");
  res.set.weapon[3].forEach(function (d) {
    const it = D.items[d];
    if (it.kind === "g" && q.allowTowerDecos === false) out.push("Road gem though Tower decorations are off");
  });
  return out;
}

/** Ranked: met first, then defence, then free slots. */
function ranked(results) {
  for (let i = 1; i < results.length; i++) {
    const a = results[i - 1], b = results[i];
    const ka = [a.met ? 1 : 0, a.defence, a.freeSlots], kb = [b.met ? 1 : 0, b.defence, b.freeSlots];
    for (let k = 0; k < 3; k++) { if (ka[k] > kb[k]) break; if (ka[k] < kb[k]) return false; }
  }
  return true;
}

function run(label, q, opts) {
  opts = opts || {};
  const t0 = Date.now();
  let progress = 0;
  const out = Search.search(q, function (p) { progress++; if (!(p.done <= p.total)) check(false, label + ": progress " + p.done + "/" + p.total); });
  const ms = Date.now() - t0;
  out.ms = ms;
  out.progressCalls = progress;
  check(!out.stats.error, label + ": error " + out.stats.error);
  check(out.stats.invalid === 0, label + ": " + out.stats.invalid + " set(s) the calculator found a problem in");
  if (!opts.slow) {
    check(ms <= BUDGET_MS, label + ": took " + ms + " ms (budget " + BUDGET_MS + ")");
    check(!out.truncated, label + ": truncated");
  }
  if (!opts.empty) check(out.results.length > 0, label + ": no result");
  check(out.results.length <= (q.maxResults || 50), label + ": more results than asked");
  check(ranked(out.results), label + ": results are not ranked");
  const keys = new Set(out.results.map(function (r) { return Calc.encode(r.set); }));
  check(keys.size === out.results.length, label + ": the same set twice");
  out.results.forEach(function (res, i) {
    const p = problemsOf(res, q, out.stats.wanted);
    if (p.length) check(false, label + ": result " + i + ": " + p.slice(0, 3).join("; "));
    if (!opts.partial) check(res.met, label + ": result " + i + " does not meet every wanted skill");
    check(Array.isArray(res.skills) && Array.isArray(res.extraSkills) && typeof res.score === "number" && res.res &&
          typeof res.res.fire === "number", label + ": result " + i + " shape");
  });
  console.log("  " + label + ": " + out.results.length + " results, " + ms + " ms" + (out.truncated ? " (truncated)" : ""));
  return out;
}

/* ---- wanted skills ---- */
const ls = 7;
(function () {
  const health = R.tree(R.treeOf(skill("Health+20")));
  check(health.name === "Health", "Health+20 is in the Health tree");
  const need = function (w, cls) { return Search.resolveWanted(w, cls === undefined ? ls : cls); };
  check(need({ skill: skill("Health+20") }).need === 15, "Health+20 alone needs 15 points");
  check(need({ skill: skill("Health+10"), level: 3 }).need === 20, "Health level 3 = Health+30 = 20 points");
  check(need({ skill: skill("Health+10"), level: 25 }).need === 25, "level 25 = 25 points");
  check(need({ skill: skill("Health+30"), level: 1 }).need === 20, "a lower level never lowers the skill's own need");
  check(!!need({ skill: skill("Health-10") }).problem, "a negative skill is not searched");
  check(!!need({ skill: 999999 }).problem, "an unknown skill is not searched");
  check(!!need({ skill: skill("Bow Tech (Expert)") }, 7).problem, "a Bow Tech skill with a Long Sword is impossible");
  check(!need({ skill: skill("Bow Tech (Expert)") }, 10).problem, "a Bow Tech skill with a Bow is fine");
})();

/* ---- the rank rule ---- */
console.log("rank rule");
(function () {
  const bands = index.rank.bands;
  check(bands.length === 7 && bands[0][0] === 1 && bands[6][0] === 999, "index.json rank.bands are the 7 HR bands");
  check(index.rank.classes[7] === "Long Sword", "index.json rank.classes in the set format's class order");
  const band = function (hr) { return Rank.bandOfHr(hr, bands); };
  check(band(0) === 0 && band(1) === 1 && band(2) === 2 && band(30) === 2 && band(31) === 3 && band(99) === 4 &&
        band(100) === 5 && band(299) === 5 && band(300) === 6 && band(998) === 6 && band(999) === 7, "HR bands from an HR");
  check(Rank.hunter(null, bands) === null && Rank.hunter({ band: 0, gr: "", gsr: "" }, bands) === null, "no rank: no filter");
  check(JSON.stringify(Rank.hunter({ hr: 120, gr: 0 }, bands)) === '{"band":5,"gr":0,"gsr":null}', "the older {hr} query");
  check(JSON.stringify(Rank.hunter({ band: 2, gr: "40", gsr: "" }, bands)) === '{"band":7,"gr":40,"gsr":null}', "a GR means G Rank (band 7)");
  check(JSON.stringify(Rank.hunter({ gsr: "300" }, bands)) === '{"band":0,"gr":0,"gsr":300}', "a GSR alone filters only GSR gates");
  const h = function (b, gr, gsr) { return Rank.hunter({ band: b, gr: gr, gsr: gsr }, bands); };
  check(Rank.fits(["hr", 31, 3, "r"], h(3, 0)) && !Rank.fits(["hr", 31, 3, "r"], h(2, 0)), "an HR row needs its band");
  check(Rank.fits(["hr", 500, 6, "r"], h(7, 0)) && !Rank.fits(["gr", 1, 7, "r"], h(7, 0)) && Rank.fits(["gr", 1, 7, "r"], h(7, 1)),
        "HR999 without G Rank: no GR rows");
  check(!Rank.fits(["gr", 200, 7, "m"], h(7, 199)) && Rank.fits(["gr", 200, 7, "m"], h(7, 200)), "a GR row needs its GR");
  check(!Rank.fits(0, h(7, 999)) && Rank.fits(0, null) && Rank.fits(0, h(0, 0, 5)), "never offered: out with a band, in without one");
  const gsr = ["hr", 1, 1, "g", 7, 300];
  check(Rank.fits(gsr, h(1, 0)) && !Rank.fits(gsr, h(1, 0, 299)) && Rank.fits(gsr, h(1, 0, 300)), "a GSR gate needs the GSR when one is given");
  check(Rank.text(["hr", 100, 5, "u"]) === "HR band 5" && Rank.text(["gr", 100, 7, "r"]) === "GR 100" &&
        Rank.text(gsr, index.rank.classes) === "GSR 300 Long Sword" && Rank.text(0) === "", "the list texts");
  // every piece the client lists for the Create/G/Zenith menus has a rank; never-offered pieces are not obtainable
  let unranked = 0, gsrGates = 0;
  SLOTS.forEach(function (s) { D.pieces[s].forEach(function (p) { if (p.obtainable && !p.craft) unranked++; if (Rank.gsrOf(p.craft)) gsrGates++; }); });
  check(unranked === 0, unranked + " obtainable pieces with no craft rank");
  check(gsrGates > 2000, "GSR gates in the data: " + gsrGates);
})();

/* ---- known sets ---- */
let seed = 20261115;
function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }

/** A random set of obtainable pieces (male, blademaster) at their highest level with random decorations, and up
    to three of its positive skills from points that work with a Long Sword. */
function knownSet() {
  const decos = D.decos.filter(function (d) { return d.kind === "d" && d.obtainable; });
  for (;;) {
    const set = Calc.empty();
    set.weapon = [ls, 0, [], []];
    set.armour.forEach(function (a) {
      const list = D.pieces[a[0]].filter(function (p) {
        return p.obtainable && R.canWear(p.flags, "male") && R.kindFits(p.flags, "blademaster") && p.rarity >= 5;
      });
      const p = list[rnd(list.length)];
      a[1] = p.id;
      a[2] = p.maxLevel;
      let room = R.slotsAt(p.row, p.maxLevel);
      while (room > 0) {
        const d = decos[rnd(decos.length)];
        if (d.slots <= room) { a[3].push(d.item); room -= d.slots; }
      }
    });
    const r = Calc.compute(set, ctxWith("male"));
    const good = r.active.filter(function (s) { return !s.dropped && !s.negative && s.works && s.from === "points"; });
    if (r.problems.length || good.length < 3) continue;
    good.sort(function (a, b) { return b.total - a.total; });
    return { set: set, defence: r.defence.total, wanted: good.slice(0, 3).map(function (s) { return { skill: s.skill, level: s.total }; }) };
  }
}

console.log("known sets");
for (let k = 0; k < 4; k++) {
  const known = knownSet();
  const names = known.wanted.map(function (w) { return R.skillName(w.skill) + " (" + w.level + ")"; }).join(", ");
  const q = { wanted: known.wanted, weaponClass: ls, weaponId: 0, gender: "male", hunterType: "blade", maxResults: 10 };
  const out = run("known set " + k + " [" + names + "]", q);
  check(out.results.length && out.results[0].defence >= known.defence,
        "known set " + k + ": best defence " + (out.results[0] || {}).defence + " is below the known set's " + known.defence);

  // only what I own: the known set's pieces and decorations, plus decoys (other pieces, one of each)
  const owned = [], items = {};
  known.set.armour.forEach(function (a, i) {
    owned.push([a[0], a[1], a[2], [], i]);
    a[3].forEach(function (d) { items[d] = (items[d] || 0) + 1; });
  });
  SLOTS.forEach(function (s, i) {
    for (let j = 0; j < 6; j++) {
      const p = D.pieces[s][rnd(D.pieces[s].length)];
      owned.push([s, p.id, 1 + rnd(p.maxLevel || 1), [], 10 + i * 6 + j]);
    }
  });
  const imp = { hunting: [], town: [], mySets: [], owned: owned, items: items, inEquipment: {}, zenny: 0, online: false, hasSave: true };
  const oq = Object.assign({}, q, { ownedOnly: true, owned: imp });
  const own = run("known set " + k + ", only what I own", oq);
  const level = {};
  owned.forEach(function (o) { level[o[0] + ":" + o[1]] = Math.max(level[o[0] + ":" + o[1]] || 0, o[2]); });
  own.results.forEach(function (res, i) {
    const uses = {};
    res.set.armour.forEach(function (a) {
      if (a[1] && !(level[a[0] + ":" + a[1]] >= a[2])) check(false, "owned search " + k + " result " + i + ": " + a[0] + " " + a[1] + " Lv" + a[2] + " is not owned");
      a[3].forEach(function (d) { uses[d] = (uses[d] || 0) + 1; });
    });
    res.set.cuffs.forEach(function (d) { uses[d] = (uses[d] || 0) + 1; });
    Object.keys(uses).forEach(function (d) {
      if (uses[d] > (items[d] || 0)) check(false, "owned search " + k + " result " + i + ": uses " + uses[d] + " of item " + d + ", owns " + (items[d] || 0));
    });
  });
}

/* ---- common searches and constraints ---- */
console.log("common searches");
const towerLs = Object.keys(index.weapons.melee).map(Number).find(function (id) { return index.weapons.melee[id][1] && D.weapons[ls][id] && D.weapons[ls][id].slots < 3; });
const slotLs = Object.keys(D.weapons[ls]).map(Number).find(function (id) { return D.weapons[ls][id].slots === 3 && !D.weapons[ls][id].tower; });
const COMMON = [
  ["3 skills", { wanted: wanted(["Attack Up Large", "Sharpness+1", "Evasion+2"]), weaponClass: ls, gender: "male", hunterType: "blade" }],
  ["4 skills, female", { wanted: wanted(["Attack Up Large", "Razor Sharp +1", "Evasion+1", "Health+30"]), weaponClass: ls, gender: "female", hunterType: "blade" }],
  ["5 skills", { wanted: wanted(["Health+50", "Attack Up Very Large", "Razor Sharp +1", "Evasion+1", "Guard+2"]), weaponClass: ls, gender: "male", hunterType: "blade" }],
  ["HR999, no G Rank", { wanted: wanted(["Attack Up Large", "Sharpness+1", "Evasion+1"]), weaponClass: ls, gender: "female", hunterType: "blade", rankMax: { hr: 999, gr: 0 } }],
  ["HR band 3", { wanted: wanted(["Attack Up Small", "Evasion+1"]), weaponClass: ls, gender: "male", hunterType: "blade", rankMax: { band: 3, gr: 0 } }],
  ["GR 50", { wanted: wanted(["Attack Up Large", "Sharpness+1", "Evasion+1"]), weaponClass: ls, gender: "male", hunterType: "blade", rankMax: { band: 7, gr: 50 } }],
  ["GSR 1", { wanted: wanted(["Attack Up Large", "Evasion+2"]), weaponClass: 4, gender: "male", hunterType: "blade", rankMax: { gsr: 1 } }],
  ["no Zenith", { wanted: wanted(["Attack Up Large", "Speed Sharpening", "Evasion+2", "Guard+1"]), weaponClass: ls, gender: "male", allowZenith: false }],
  ["Bow, gunner, Tech", { wanted: wanted(["Attack Up Large", "Evasion+2", "Bow Tech (Expert)"]), weaponClass: 10, gender: "male", hunterType: "gunner" }],
  ["Gunlance, any kind", { wanted: wanted(["Artillery Expert", "Guard+2", "Attack Up Medium"]), weaponClass: 9, gender: "", hunterType: "any" }],
  ["Tower weapon with Road gems", { wanted: wanted(["Attack Up Large", "Sharpness+1", "Evasion+2"]), weaponClass: ls, weaponId: towerLs, gender: "male" }],
  ["Tower weapon, Road gems off", { wanted: wanted(["Attack Up Large", "Sharpness+1", "Evasion+2"]), weaponClass: ls, weaponId: towerLs, gender: "male", allowTowerDecos: false }],
  ["weapon with 3 slots", { wanted: wanted(["Attack Up Large", "Sharpness+1", "Evasion+2", "Health+20"]), weaponClass: ls, weaponId: slotLs, gender: "male" }],
  ["fixed head, excluded pieces", { wanted: wanted(["Attack Up Large", "Sharpness+1"]), weaponClass: ls, gender: "male", fixed: { head: 1, legs: 0 }, exclude: ["chest:3592", 9229, "item:5803"], maxResults: 20 }]
];
COMMON.forEach(function (c) {
  const out = run(c[0], c[1]);
  if (c[0].indexOf("Road gems off") !== -1) check(!out.stats.gems.length, c[0] + ": no Road gems");
  if (c[0] === "Tower weapon with Road gems") {
    check(out.stats.gems.length > 0 && out.results.every(function (r) { return r.set.weapon[3].length > 0; }), c[0] + ": Road gems on the weapon");
  }
});

/* ---- limits ---- */
console.log("limits");
const hard = { wanted: wanted(["Attack Up Absolute", "Health+50", "Evasion+2", "Razor Sharp +2", "Guard+2", "Speed Sharpening",
                               "Critical Eye +3", "Auto-Guard"]), weaponClass: ls, gender: "female", rankMax: { hr: 999, gr: 0 },
               timeLimitMs: 6000, maxResults: 10 };
// one fixed piece (Red Piercing: Fire Res 10) and nothing else: Fire Res+10 can be met, Attack Up Absolute (80) not
const noFull = { wanted: wanted(["Fire Res+10", "Attack Up Absolute"]), weaponClass: ls, gender: "male",
                 rankMax: { hr: 999, gr: 0 }, fixed: { head: 53, chest: 0, arms: 0, waist: 0, legs: 0 }, timeLimitMs: 3000 };
const relaxed = run("nothing meets every skill", noFull, { partial: true });
check(relaxed.stats.relaxed, "a search with no full answer searches again without one skill");
check(relaxed.results.length === 1 && !relaxed.results[0].met &&
      JSON.stringify(relaxed.results[0].missing) === JSON.stringify([skill("Attack Up Absolute")]),
      "the partial result says Attack Up Absolute is missing");
const tiny = Search.search(Object.assign({}, COMMON[2][1], { timeLimitMs: 50, wanted: hard.wanted, rankMax: null }));
check(tiny.truncated && tiny.stats.timedOut, "a 50 ms limit on an 8 skill search says truncated");
const imp = Search.search({ wanted: wanted(["Attack Up Large", "Bow Tech (Expert)"]), weaponClass: ls });
check(!imp.results.length && imp.stats.impossible.length === 1 && imp.stats.impossible[0].skill === skill("Bow Tech (Expert)"),
      "a Bow Tech skill with a Long Sword: no result, reported as impossible");
let threw = false;
try { Search.search({ wanted: wanted(["Evasion+1"]), ownedOnly: true, owned: null }); } catch (e) { threw = true; }
check(threw, "\"only what I own\" without a character import is refused");
check(run("progress", COMMON[0][1]).progressCalls >= 1, "progress is reported");
check(Search.failed(new Error("x")).stats.error === "x", "failed() has the search result's shape");

/* ---- the Web Worker in a browser ---- */
function serve() {
  const types = { ".txt": "text/plain", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const srv = http.createServer(function (req, res) {
    const p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) { srv.listen(0, "127.0.0.1", function () { resolve(srv); }); });
}

async function browser(chromium) {
  console.log("browser worker");
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const b = await chromium.launch();
  try {
    const pg = await b.newPage();
    const errors = [];
    pg.on("pageerror", function (e) { errors.push(e.message); });
    await pg.goto(base + "/robots.txt");
    const q = COMMON[2][1];
    const got = await pg.evaluate(function (args) {
      return new Promise(function (resolve) {
        const w = new Worker("/js/armor-search-worker.js");
        const log = [];
        const t0 = performance.now();
        let phase = "cancel";
        w.onerror = function (e) { resolve({ error: e.message }); };
        w.onmessage = function (e) {
          const m = e.data;
          log.push({ type: m.type, phase: phase, done: m.done, total: m.total });
          if (m.type !== "done") return;
          if (phase === "first") {
            phase = "second";
            const ms = performance.now() - t0;
            const first = m.result;
            // cancel: a search cancelled at once sends nothing; the next one answers
            phase = "cancelled";
            w.postMessage({ type: "search", query: args.slow });
            w.postMessage({ type: "cancel" });
            setTimeout(function () {
              phase = "after";
              w.postMessage({ type: "search", query: args.q });
              w.onmessage = function (e2) {
                log.push({ type: e2.data.type, phase: phase });
                if (e2.data.type === "done") resolve({ first: first, ms: ms, log: log, after: e2.data.result.results.length });
              };
            }, 1500);
          }
        };
        phase = "first";
        w.postMessage({ type: "search", query: args.q });
      });
    }, { q: q, slow: Object.assign({}, hard, { timeLimitMs: 1000 }) });
    check(!got.error, "worker: " + got.error);
    if (!got.error) {
      const out = got.first;
      check(!out.stats.error, "worker: " + out.stats.error);
      check(out.results.length > 0 && !out.truncated, "worker: the 5 skill search has results");
      out.results.forEach(function (res, i) {
        const pr = problemsOf(res, q, out.stats.wanted);
        if (pr.length) check(false, "worker result " + i + ": " + pr.slice(0, 3).join("; "));
      });
      check(got.ms <= BROWSER_BUDGET_MS, "worker: data and search took " + Math.round(got.ms) + " ms (budget " + BROWSER_BUDGET_MS + ")");
      check(got.log.some(function (l) { return l.type === "progress" && l.done <= l.total; }), "worker: sends progress");
      check(!got.log.some(function (l) { return l.phase === "cancelled" && l.type === "done"; }), "worker: a cancelled search sends no answer");
      check(got.after > 0, "worker: the search after a cancel answers");
      console.log("  worker: " + out.results.length + " results, " + Math.round(got.ms) + " ms with the data load");
    }
    const bad = await pg.evaluate(function () {
      return new Promise(function (resolve) {
        const w = new Worker("/js/armor-search-worker.js");
        w.onmessage = function (e) { if (e.data.type === "done") resolve(e.data.result); };
        w.postMessage({ type: "search", query: { wanted: [{ skill: 79 }], weaponClass: 7, weaponId: 99999999 } });
      });
    });
    check(bad.results.length === 0 && /Unknown weapon/.test(bad.stats.error || ""), "worker: a bad query answers done with stats.error");
    check(errors.length === 0, "worker: no page errors: " + errors.join("; "));
  } finally {
    await b.close();
    srv.close();
  }
}

let chromium;
try { chromium = require("playwright").chromium; } catch (e) { console.log("needs playwright (NODE_PATH=/root/work/pw-tools/node_modules)"); process.exit(2); }
browser(chromium).then(function () {
  console.log(failed ? failed + " check(s) failed" : "armor search OK");
  process.exit(failed ? 1 : 0);
}, function (e) { console.log("FAIL " + (e && e.stack || e)); process.exit(1); });
