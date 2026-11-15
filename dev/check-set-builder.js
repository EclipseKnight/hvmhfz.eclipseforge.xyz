#!/usr/bin/env node
/* Checks the Set builder: the calculator and rules (js/armor-calc.js, js/armor-rules.js) under node, the data
   files (data/armor/, dev/make-armor-data.py) and the page (set-builder.html, js/set-builder.js) in a browser
   (headless Chromium).

   The client's answers: every set of hvmhfz_re data/armor_calc_cases.json (3,000 sets run through the client's own
   code under unicorn) must come out of ArmorCalc.calc exactly: the active skills in the client's order with their
   sort keys, the automatic skills, the Tower Deco skills, the Zenith skills and whether each is lit, the skill
   limit, each piece's defence and slots. The tables are hvmhfz_re's own files; then every row of data/armor
   (pieces, decorations, sigils, weapon Zenith skills and Tower flags, automatic skills, the rules) must equal the
   row it was made from, and every case the page's set format can hold must give the same answer through
   ArmorCalc.compute on the site's files. HVMHFZ_RE (default /root/mhfz/hvmhfz_re) names the hvmhfz_re checkout;
   its files must be the data version of data/armor/rules.json.

   Calculator: a set's code survives #s= encode/decode and junk codes are refused; a real set's skill points equal
   the sums of its rows, its defence the level growth plus the weapon; too many decorations for a piece's slots, a
   cuff in an armour slot and a sigil on armour or a non-Tower weapon are reported; a Tech cuff of another weapon
   does nothing; gender is a hard rule, blademaster/gunner only a list filter; a Tower weapon's Road gem gives its
   skill outside the limit and sigils go to the sigil places.

   Page, at 1280 px and 390 px: pick a weapon class and weapon, a head piece (its slot's list loads on the first
   open), a decoration and a cuff; the summary shows the skills, the points table, the defence and resistances the
   calculator gives for that set; the address holds the set and a reload restores it; a shared link with a cuff
   for another weapon marks the skill "no effect"; a broken link says so; the summary sits beside the set on a wide
   screen and under it on a phone; no sideways scrolling and no script errors. SHOTS=<dir> saves screenshots.

   One data version: the API's crafting data (HVMHFZ_API, default /root/mhfz/hvmhfz_rest_api) names the page's
   mhfdat.bin and its community-sets catalog the page's version, and offers every piece and item the page does.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] [HVMHFZ_RE=dir] [HVMHFZ_API=dir] node dev/check-set-builder.js

   Exit code 0 = all as expected. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const RE = process.env.HVMHFZ_RE || "/root/mhfz/hvmhfz_re";
const Calc = require(path.join(ROOT, "js/armor-calc.js"));
const Rules = require(path.join(ROOT, "js/armor-rules.js"));
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function sorted(o) { const r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = o[k]; }); return JSON.stringify(r); }

const SLOTS = ["head", "chest", "arms", "waist", "legs"];
const index = readJson("data/armor/index.json");
const rulesJson = readJson("data/armor/rules.json");
const rules = Rules.make(rulesJson);
const pieces = {};
SLOTS.forEach(function (s) { pieces[s] = readJson("data/armor/" + s + ".json"); });

/* The page's objects (js/set-builder.js pieceObject, loadWeapons and the items it builds). */
function pieceObj(row) {
  return row && { id: row[0], name: row[1], rarity: row[2], defence: row[3], slots: row[4], maxSlots: row[5],
                  res: row[6], flags: row[7], maxLevel: row[8], skills: row[9], auto: row[10], obtainable: !!row[11],
                  defGrowth: row[12], slotGrowth: row[13], limitKind: row[14], zenith: row[15] };
}
const pieceById = {};
SLOTS.forEach(function (s) { pieceById[s] = {}; pieces[s].pieces.forEach(function (p) { pieceById[s][p[0]] = p; }); });
const items = {};
index.decorations.forEach(function (d) {
  items[d[0]] = { item: d[0], name: d[1], kind: d[2], slots: d[3], skills: d[4], obtainable: !!d[5], zenith: d[6],
                  firstTree: d[7], firstPoints: d[8] };
});
index.sigils.forEach(function (s) {
  items[s[0]] = { item: s[0], name: s[1], kind: "s", slots: 1, skills: s[3], effect: s[2], zenith: s[4],
                  firstTree: s[5], firstPoints: s[6] };
});
const weaponTypes = readJson("data/weapons/index.json").types;
const weaponLists = {};
function weapons(cls) {
  if (weaponLists[cls]) return weaponLists[cls];
  const type = weaponTypes.find(function (t) { return t.class === cls; });
  const json = readJson("data/weapons/" + type.slug + ".json");
  const f = {};
  json.fields.forEach(function (n, i) { f[n] = i; });
  const table = json.kind === "melee" ? "melee" : "ranged";
  const byId = {};
  json.weapons.forEach(function (w) {
    const x = index.weapons[table][w[f.id]] || [0, 0];
    byId[w[f.id]] = { id: w[f.id], name: w[f.name], slots: w[f.slots] || 0, defense: w[f.defense] || 0,
                      auto: index.weaponAuto[table][w[f.id]] || 0, zenith: x[0], tower: !!x[1] };
  });
  return (weaponLists[cls] = byId);
}
function ctxWith(gender) {
  return { rules: rules, gender: gender || "",
           piece: function (slot, id) { return pieceObj(pieceById[slot][id]); },
           weapon: function (cls, id) { return weapons(cls)[id] || null; },
           item: function (id) { return items[id] || null; } };
}
const byName = function (list, name) { return list.find(function (r) { return r[1] === name; }); };

/* ---- data ---- */
check(pieces.head.pieces.length > 10000 && index.decorations.length > 5000, "data/armor has pieces and decorations");
let unknownTree = 0;
SLOTS.forEach(function (s) { pieces[s].pieces.forEach(function (p) { p[9].forEach(function (x) { if (!rules.tree(x[0])) unknownTree++; }); }); });
index.decorations.forEach(function (d) { d[4].forEach(function (x) { if (!rules.tree(x[0])) unknownTree++; }); });
check(unknownTree === 0, "every tree of a piece or decoration has an activation row (" + unknownTree + " unknown)");
check(rulesJson.data_version === index.source.mhfdatSha256.slice(0, 12),
      "rules.json comes from the same mhfdat.bin as the pieces (" + rulesJson.data_version + ")");
check(rulesJson.trees.length === 213 && rulesJson.rules.base_active === 10 && rulesJson.rules.max_active === 28,
      "rules.json: 213 activation rows, limit 10 to 28");
check(!/\*/.test(fs.readFileSync(path.join(ROOT, "set-builder.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").split("<main")[1] || ""),
      "set-builder.html has no * markers");

/* ---- the client's answers (hvmhfz_re data/armor_calc_cases.json) ---- */
const reFiles = ["armor_rules.json", "armor_builder.json", "armor_calc_cases.json"].map(function (f) { return path.join(RE, "data", f); });
if (!reFiles.every(fs.existsSync)) {
  check(false, "hvmhfz_re's armour files are not in " + RE + "/data (set HVMHFZ_RE)");
} else {
  const reRules = JSON.parse(fs.readFileSync(reFiles[0], "utf8"));
  const builder = JSON.parse(fs.readFileSync(reFiles[1], "utf8"));
  const cases = JSON.parse(fs.readFileSync(reFiles[2], "utf8"));
  [reRules, builder, cases].forEach(function (doc, i) {
    check(doc.data_version === rulesJson.data_version, path.basename(reFiles[i]) + " is data " + doc.data_version +
          ", the site's " + rulesJson.data_version + " (HVMHFZ_RE=" + RE + ")");
  });
  const reR = Rules.make(reRules);
  const T = Calc.tablesFromRe(reR, builder);
  const diffs = {};
  let bad = 0;
  function compare(mine, client) {
    const d = [];
    if (!same(mine.active, client.active)) d.push("active");
    if (!same(mine.automatic, client.automatic)) d.push("automatic");
    if (!same(mine.tower, client.tower)) d.push("tower");
    if (!same(mine.zenith, client.zenith)) d.push("zenith");
    if (mine.limit.limit !== client.limit) d.push("limit");
    if (sorted(mine.defence) !== sorted(client.defence)) d.push("defence");
    if (sorted(mine.slots) !== sorted(client.slots)) d.push("slots");
    return d;
  }
  cases.cases.forEach(function (c, i) {
    const d = compare(Calc.calc(T, c.set), c.client);
    if (d.length) {
      if (bad < 3) console.log("case " + i + " differs in " + d.join(", ") + ": " + JSON.stringify(c.set));
      bad++;
      d.forEach(function (k) { diffs[k] = (diffs[k] || 0) + 1; });
    }
  });
  check(cases.cases.length === 3000 && bad === 0, "ArmorCalc.calc matches the client on all " + cases.cases.length +
        " sets (" + bad + " differ " + JSON.stringify(diffs) + ")");

  // the site's rows = hvmhfz_re's
  const site = Object.assign({}, rulesJson);
  ["_about", "version", "source"].forEach(function (k) { delete site[k]; });
  const reCopy = Object.assign({}, reRules);
  delete reCopy._about;
  check(sorted(site) === sorted(reCopy), "data/armor/rules.json = hvmhfz_re data/armor_rules.json");
  let rowBad = 0, rowFirst = "";
  function merged(pairs) {
    const m = {};
    pairs.forEach(function (p) { m[p[0]] = (m[p[0]] || 0) + p[1]; });
    return Object.keys(m).filter(function (k) { return m[k]; }).map(function (k) { return Number(k) + ":" + m[k]; }).sort().join(",");
  }
  function rowCheck(ok, what) { if (!ok) { rowBad++; if (!rowFirst) rowFirst = what; } }
  SLOTS.forEach(function (slot) {
    pieces[slot].pieces.forEach(function (row) {
      const p = pieceObj(row), r = T.armour(slot, p.id);
      rowCheck(r && p.name === r.name && p.defence === r.defence && p.defGrowth === r.def_growth && p.slots === r.slots &&
               p.maxSlots === r.max_slots && p.slotGrowth === r.slot_growth && same(p.res, r.resist) &&
               p.flags === (r.flags & 15) && p.maxLevel === Math.max(1, r.max_level) && p.zenith === r.zenith &&
               p.auto === r.auto && (p.limitKind & 1) === r.g_piece && ((p.limitKind >> 1) & 1) === r.z_piece &&
               ((p.limitKind >> 2) & 1) === r.tower_piece && merged(p.skills) === merged(r.skills) &&
               p.obtainable === !!r.obtainable, slot + " " + p.id);
    });
  });
  Object.keys(items).forEach(function (id) {
    const d = items[id], r = T.deco(Number(id));
    rowCheck(r && d.name === r.name && (d.kind === "c" ? r.slots === 0 : d.slots === r.slots) && d.zenith === r.zenith &&
             d.firstTree === r.first_tree && d.firstPoints === r.first_points && merged(d.skills) === merged(r.skills),
             "item " + id);
  });
  weaponTypes.forEach(function (t) {
    const list = weapons(t.class);
    const kind = rulesJson.rules.class_kind[t.class] & 2 ? "ranged" : "melee";
    Object.keys(list).forEach(function (id) {
      const w = list[id], r = T.weapon(kind, Number(id));
      rowCheck(r && r["class"] === t.class && r.slots === w.slots && r.zenith === w.zenith && !!r.tower === w.tower &&
               r.auto === w.auto, kind + " weapon " + id);
    });
  });
  check(rowBad === 0, "every data/armor row equals hvmhfz_re's (" + rowBad + " differ, first " + rowFirst + ")");

  // the page's path: every case its set format can hold, through compute on the site's files
  let held = 0, pageBad = 0;
  cases.cases.forEach(function (c, i) {
    const s = c.set;
    let ok = true;
    const set = { weapon: [-1, 0, [], []], armour: [], cuffs: (s.cuffs || []).slice() };
    if (s.cuffs && s.cuffs.some(function (x) { return !items[x] || items[x].kind !== "c"; })) ok = false;
    SLOTS.forEach(function (slot) {
      const p = s.armour[slot];
      if (!p) return;
      if (p.plates || !pieceById[slot][p.id] || p.level > pieceById[slot][p.id][8]) ok = false;
      (p.decos || []).forEach(function (x) { if (!items[x] || (items[x].kind !== "d" && items[x].kind !== "g")) ok = false; });
      set.armour.push([slot, p.id, p.level, p.decos || []]);
    });
    if (s.weapon) {
      const row = T.weapon(s.weapon.kind, s.weapon.id);
      const w = row && weapons(row["class"])[s.weapon.id];
      if (!w || (s.weapon_class !== undefined && s.weapon_class !== row["class"])) ok = false;
      else {
        const decos = s.weapon.decos || [];
        decos.forEach(function (x, k) {
          const it = items[x];
          const want = w.tower ? (k < w.slots ? "s" : "g") : null;
          if (!it || (want ? it.kind !== want : it.kind !== "d" && it.kind !== "g")) ok = false;
        });
        set.weapon = [row["class"], s.weapon.id, [], decos];
      }
    } else if (s.weapon_class !== undefined) {
      set.weapon = [s.weapon_class, 0, [], []];
    }
    if (!ok) return;
    held++;
    const d = compare(Calc.compute(set, ctxWith("")).calc, c.client);
    if (d.length) {
      if (pageBad < 3) console.log("page path, case " + i + " differs in " + d.join(", "));
      pageBad++;
    }
  });
  check(held > 300 && pageBad === 0, "ArmorCalc.compute on the site's files matches the client on the " + held +
        " sets the page can hold (" + pageBad + " differ)");
}

/* ---- one data version: the API's crafting data and community-sets catalog (HVMHFZ_API) ---- */
const API = process.env.HVMHFZ_API || "/root/mhfz/hvmhfz_rest_api";
const crafting = path.join(API, "src/main/resources/builder/crafting.tsv.gz");
const catalogFile = path.join(API, "src/main/resources/armor-sets/catalog.json");
if (!fs.existsSync(crafting) || !fs.existsSync(catalogFile)) {
  check(false, "the API's builder data is not in " + API + " (set HVMHFZ_API)");
} else {
  const first = require("zlib").gunzipSync(fs.readFileSync(crafting)).toString("utf8").split("\n", 1)[0];
  check(first === "V\t" + index.source.mhfdatSha256.slice(0, 12), "the API's crafting data is the page's game data (" +
        first.replace("\t", " ") + " vs " + index.source.mhfdatSha256.slice(0, 12) + "): no \"made with game data\" note");
  const apiCatalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  check(apiCatalog.data === index.version, "the API's community-sets catalog is " + apiCatalog.data + ", the page " + index.version);
  let offered = 0;
  SLOTS.forEach(function (slot) {
    pieces[slot].pieces.forEach(function (p) { if (apiCatalog.armour[slot][p[0]] !== "1") offered++; });
  });
  Object.keys(items).forEach(function (id) { if ((apiCatalog.items[id] || "-") !== items[id].kind) offered++; });
  check(offered === 0, "the API's catalog offers every piece and item the page offers (" + offered + " missing)");
}

/* ---- the set format ---- */
const lsData = readJson("data/weapons/long-sword.json");
const LS = lsData.fields;
const helm = byName(pieces.head.pieces, "Rathalos Helm");
const katana = lsData.weapons.find(function (r) { return r[LS.indexOf("name")] === "Black Katana Mk.Ⅲ"; });
const attackG = byName(index.decorations, "Attack G");
const snsCuff = byName(index.decorations, "SnS・G");
check(helm && katana && attackG && snsCuff, "found the test pieces in the data");
const set = { v: 1, data: index.version, weapon: [7, katana[0], [], []],
  armour: [["head", helm[0], helm[8], [attackG[0]]]], cuffs: [snsCuff[0]] };
const code = Calc.encode(set);
check(/^[A-Za-z0-9_-]+$/.test(code), "the code is URL-safe");
const back = Calc.decode(code);
check(back && back.armour.length === 5 && back.armour[0][1] === helm[0] && same(back.cuffs, [snsCuff[0]]) &&
      back.armour[1][1] === 0, "encode/decode keeps the set and fills the empty slots");
check(Calc.decode("not a code!") === null && Calc.decode("e30") !== null && Calc.decode("WzFd") === null,
      "decode refuses junk and arrays, accepts {}");
check(same(Calc.normalize({ armour: [["legs", 5, 99, [1, 2, 3, 4, 5]]] }).armour[4][3], [1, 2, 3]), "at most 3 decorations a piece");

/* ---- a real set, summed here independently ---- */
const r = Calc.compute(set, ctxWith());
const want = {};
[helm[9], attackG[4], snsCuff[4]].forEach(function (list) {
  list.forEach(function (x) { want[x[0]] = (want[x[0]] || 0) + x[1]; });
});
const got = {};
r.trees.forEach(function (t) { got[t.tree] = t.total; });
check(same(Object.keys(want).sort(), Object.keys(got).sort()) &&
      Object.keys(want).every(function (k) { return want[k] === got[k]; }), "skill points = the rows' sums " + JSON.stringify(got));
const helmObj = pieceObj(helm);
const helmDef = r.pieces[0].defence.value;
check(helmDef > helm[3] && helmDef === rules.defenceAt({ defence: helm[3], def_growth: helm[12] }, helm[8]),
      "defence grows with the level (Rathalos Helm " + helm[3] + " -> " + helmDef + ")");
check(r.defence.total === helmDef + katana[LS.indexOf("defense")], "defence = piece + weapon (" + r.defence.total + ")");
check(Calc.RES.every(function (name, i) { return r.res[name] === helm[6][i]; }), "resistances = the piece's");
check(r.pieces[0].slots.value === rules.slotsAt({ slots: helm[4], max_slots: helm[5], slot_growth: helm[13] }, helm[8]) &&
      r.pieces[0].decos.used === attackG[3], "slots grow with the level");
const snsTree = rulesJson.trees.find(function (t) { return t.name === "SnS Tech"; }).id;
const sns = r.active.find(function (a) { return a.tree === snsTree; });
check(sns && !sns.works, "SnS Tech from a cuff does nothing with a Long Sword");
check(r.problems.length === 0, "the test set has no problems: " + r.problems.join("; "));
check(r.limit.limit === 11 && r.limit.parts.cuffs === 1, "a cuff whose Tech skill is reached keeps its slot, even " +
      "when the skill does nothing with this weapon: limit 11 " + JSON.stringify(r.limit));
const basicCuff = byName(index.decorations, "SnS・Basic");   // 6 SnS Tech points: not enough for the skill
const noTech = Calc.compute({ weapon: [4, 0, [], []], cuffs: [basicCuff[0]] }, ctxWith());
check(noTech.limit.parts.cuffs === 1 && noTech.limit.limit === 10 && !noTech.active.length,
      "a cuff whose Tech skill is not on adds no slot (" + JSON.stringify(noTech.limit) + ")");
const r1 = Calc.compute({ armour: [["head", helm[0], 1, [attackG[0]]]] }, ctxWith());
check(r1.problems.some(function (p) { return /slots/.test(p); }), "level 1 has no slots for a decoration");
const r2 = Calc.compute({ armour: [["head", helm[0], 7, [snsCuff[0], index.sigils[0][0]]]] }, ctxWith());
check(r2.problems.length === 2, "a cuff and a sigil in an armour slot are refused");
const r3 = Calc.compute({ weapon: [7, katana[0], [], [index.sigils[0][0]]] }, ctxWith());
check(r3.problems.some(function (p) { return /Tower weapon/.test(p); }), "a sigil on a non-Tower weapon is refused");
const maleOnly = pieces.head.pieces.find(function (p) { return (p[7] & 3) === 1; });
check(Calc.compute({ armour: [["head", maleOnly[0], 1, []]] }, ctxWith("female")).problems.length === 1 &&
      Calc.compute({ armour: [["head", maleOnly[0], 1, []]] }, ctxWith("male")).problems.length === 0,
      "gender is a hard rule (" + maleOnly[1] + ")");
const gunnerOnly = pieces.head.pieces.find(function (p) { return (p[7] & 12) === 8 && (p[7] & 3) === 3; });
check(Calc.compute({ weapon: [7, katana[0], [], []], armour: [["head", gunnerOnly[0], 1, []]] }, ctxWith()).problems.length === 0 &&
      !rules.kindFits(gunnerOnly[7], "blademaster") && rules.kindFits(gunnerOnly[7], "gunner"),
      "blademaster / gunner is a list filter, not a rule (" + gunnerOnly[1] + ")");
check(rules.weaponKind(10) === "gunner" && rules.weaponKind(7) === "blademaster" && rules.weaponKind(-1) === null,
      "weapon kinds from class_kind");

/* ---- a Tower weapon: sigils in the sigil places, the best Road gem of a tree gives its skill ---- */
let towerCls = -1, towerW = null;
weaponTypes.some(function (t) {
  const list = weapons(t.class);
  const id = Object.keys(list).find(function (k) { return list[k].tower && list[k].slots < 3 && !list[k].zenith; });
  if (id) { towerCls = t.class; towerW = list[id]; return true; }
  return false;
});
const gem = index.decorations.find(function (d) {
  if (d[2] !== "g" || !d[4].length) return false;
  return rules.skillFor(d[4][0][0], d[4][0][1]) > 0;
});
check(towerW && gem, "found a Tower weapon and a Road gem that reaches a skill alone");
if (towerW && gem) {
  const sigil = index.sigils.find(function (s) { return s[6] !== rulesJson.rules.tower_zenith_marker; });
  const rt = Calc.compute({ weapon: [towerCls, towerW.id, [], [gem[0], sigil[0]]] }, ctxWith());
  const towerSkill = rules.skillFor(gem[4][0][0], gem[4][0][1]);
  check(rt.problems.length === 0 && same(rt.weaponSlots.ids.slice(0, towerW.slots).filter(Boolean), [sigil[0]]),
        "the sigil goes to a sigil place, the gem after it: " + JSON.stringify(rt.weaponSlots.ids) + " " + rt.problems.join("; "));
  check(rt.active.some(function (a) { return a.from === "tower" && a.skill === towerSkill; }) && rt.limit.count === 0 &&
        !rt.trees.length, "the Road gem's skill is on, outside the limit, and its points are not skill points");
}

/* ---- the page ---- */
function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".gif": "image/gif" };
  const srv = http.createServer(function (req, res) {
    let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) { srv.listen(0, "127.0.0.1", function () { resolve(srv); }); });
}

async function run(chromium) {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    for (const view of [{ name: "desktop", width: 1280, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
      const V = view.name;
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: V === "phone" ? 2 : 1 });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", function (e) { errors.push(e.message); });
      await pg.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (rt) { rt.abort(); });
      await pg.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
      async function noSideways(what) {
        const over = await pg.evaluate(function () {
          const m = document.querySelector("main") || document.body;
          return Math.max(m.scrollWidth - m.clientWidth, Math.ceil(m.getBoundingClientRect().right - document.documentElement.clientWidth));
        });
        check(over <= 0, V + " " + what + ": no sideways scrolling (" + over + " px)");
      }
      async function shot(name) { if (shots) await pg.screenshot({ path: path.join(shots, V + "-" + name + ".png"), fullPage: true }); }
      async function pick(focusKey, typed, exact) {
        await pg.click('[data-focus="' + focusKey + '"]');
        await pg.waitForSelector(".bui-pop:not([hidden])");
        if (typed && await pg.isVisible(".bui-pop .bui-search")) await pg.fill(".bui-pop .bui-search", typed);
        await pg.click('.bui-pop .bui-option:has(.bui-name:text-is("' + exact + '"))');
        await pg.waitForFunction(function () { return document.querySelector(".bui-pop").hidden; });
      }
      const loaded = [];
      pg.on("request", function (req) { if (/\/data\/armor\/\w+\.json/.test(req.url())) loaded.push(req.url().split("/").pop()); });

      await pg.goto(base + "/set-builder.html", { waitUntil: "load" });
      await pg.waitForSelector("#sb-app[data-ready]");
      check(!loaded.some(function (f) { return SLOTS.indexOf(f.replace(".json", "")) !== -1; }), V + " no slot list loads before it is opened");
      check((await pg.textContent("#sb-data")).indexOf(index.version) !== -1, V + " names the data version");
      check(await pg.$('a[href="https://d0t-execute.github.io/frontier-set-searcher/"]') !== null && await pg.$("iframe") === null,
            V + " the searcher is a link, not embedded");
      await pick("weapon|class", "", "Long Sword");
      await pg.waitForSelector('[data-focus="weapon|id"]');
      await pick("weapon|id", "Black Katana", "Black Katana Mk.Ⅲ");
      await pick("head|piece", "Rathalos Helm", "Rathalos Helm");
      check(loaded.indexOf("head.json") !== -1 && loaded.indexOf("legs.json") === -1, V + " only the opened slot's list loaded");
      await pg.waitForSelector('[data-focus="head|deco|0"]');
      await pick("head|deco|0", "Attack G", "Attack G");
      await pick("cuff|0", "SnS", "SnS・G");
      await pg.waitForFunction(function () { return /#s=/.test(location.hash); });
      const hash = await pg.evaluate(function () { return location.hash; });
      const fromPage = Calc.decode(hash.replace("#s=", ""));
      check(fromPage && same(fromPage.armour[0], ["head", helm[0], helm[8], [attackG[0]]]) &&
            fromPage.weapon[1] === katana[0] && same(fromPage.cuffs, [snsCuff[0]]), V + " the address holds the set");
      const shown = await pg.evaluate(function () {
        return { def: document.querySelector(".sb-stats").getAttribute("data-defence"),
                 skills: Array.from(document.querySelectorAll("#sb-active .sb-skill")).map(function (li) { return Number(li.getAttribute("data-skill")); }),
                 idle: Array.from(document.querySelectorAll("#sb-active .sb-skill.is-idle")).map(function (li) { return li.textContent; }),
                 rows: document.querySelectorAll(".sb-points tbody tr").length };
      });
      check(Number(shown.def) === r.defence.total, V + " defence shown = calculator (" + shown.def + ")");
      check(same(shown.skills, r.active.map(function (a) { return a.skill; })), V + " active skills shown = calculator");
      check(shown.rows === r.trees.length, V + " one points row per tree");
      check(shown.idle.some(function (t) { return /no effect with Long Sword/.test(t); }), V + " SnS Tech marked no effect");
      await shot("set");
      await noSideways("set");
      const layout = await pg.evaluate(function () {
        const e = document.getElementById("sb-editor").getBoundingClientRect();
        const s = document.getElementById("sb-summary").getBoundingClientRect();
        return { beside: s.left >= e.right - 1, under: s.top >= e.bottom - 1 };
      });
      check(V === "desktop" ? layout.beside : layout.under, V + " summary " + (V === "desktop" ? "beside" : "under") + " the set");

      await pg.reload({ waitUntil: "load" });
      await pg.waitForSelector("#sb-app[data-ready]");
      await pg.waitForSelector(".sb-skill");
      const again = await pg.evaluate(function () { return document.querySelector(".sb-stats").getAttribute("data-defence"); });
      check(Number(again) === r.defence.total, V + " a reload restores the set");
      check((await pg.textContent('[data-focus="head|piece"]')).indexOf("Rathalos Helm") !== -1, V + " the piece's name is back");

      await pg.goto(base + "/set-builder.html#s=bm90IGpzb24", { waitUntil: "load" });
      await pg.waitForSelector("#sb-app[data-ready]");
      check(await pg.isVisible("#sb-status"), V + " a broken link says so");
      await noSideways("empty");
      check(!errors.length, V + ": no script errors " + errors.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

let chromium;
try { chromium = require("playwright").chromium; } catch (e) { console.log("needs playwright (NODE_PATH=/root/work/pw-tools/node_modules)"); process.exit(2); }
run(chromium).then(function () {
  console.log(failed ? failed + " problem(s)" : "set builder OK");
  process.exit(failed ? 1 : 0);
}).catch(function (e) { console.log("FAIL " + e.stack); process.exit(1); });
