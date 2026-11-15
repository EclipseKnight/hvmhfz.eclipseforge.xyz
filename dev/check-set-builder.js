#!/usr/bin/env node
/* Checks the Set builder: the calculator and rules (js/armor-calc.js, js/armor-rules.js) under node, the data
   files (data/armor/, dev/make-armor-data.py) and the page (set-builder.html, js/set-builder.js) in a browser
   (headless Chromium).

   Calculator: a set's code survives #s= encode/decode and junk codes are refused; a tree's total reaches the
   right skill (highest positive threshold, lowest negative one); a real set's skill points, defence and
   resistances equal the sums of its rows in the data files, added up here independently; too many decorations
   for a piece's slots, a cuff in an armour slot and a sigil on armour are reported; a Hiden cuff of another
   weapon does nothing and a Gunner tree does nothing with a blade; defence and resistance skills add to the
   totals; over the limit nothing is dropped while the rule is unknown, and the known-order rule drops the last.
   Data: every tree a piece, decoration or cuff gives exists in data/skills/index.json; rules.json has every part
   js/armor-rules.js reads.

   Page, at 1280 px and 390 px: pick a weapon class and weapon, a head piece (its slot's list loads on the first
   open), a decoration and a cuff; the summary shows the skills, the points table, the defence and resistances the
   calculator gives for that set; the address holds the set and a reload restores it; a shared link with a cuff
   for another weapon marks the skill "no effect"; a broken link says so; the summary sits beside the set on a wide
   screen and under it on a phone; no sideways scrolling and no script errors. SHOTS=<dir> saves screenshots.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] node dev/check-set-builder.js

   Exit code 0 = all as expected. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const Calc = require(path.join(ROOT, "js/armor-calc.js"));
const Rules = require(path.join(ROOT, "js/armor-rules.js"));
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const SLOTS = ["head", "chest", "arms", "waist", "legs"];
const index = readJson("data/armor/index.json");
const rulesJson = readJson("data/armor/rules.json");
const skills = readJson("data/skills/index.json");
const pieces = {};
SLOTS.forEach(function (s) { pieces[s] = readJson("data/armor/" + s + ".json"); });
const trees = {};
skills.trees.forEach(function (t) { trees[t[0]] = { id: t[0], name: t[1], category: t[2], levels: t[3] }; });
const items = {};
index.decorations.forEach(function (d) { items[d[0]] = { item: d[0], name: d[1], kind: d[2], slots: d[3], skills: d[4] }; });
index.sigils.forEach(function (s) { items[s[0]] = { item: s[0], name: s[1], kind: "s", slots: 1, skills: [] }; });
const lsData = readJson("data/weapons/long-sword.json");
const LS = lsData.fields;

function pieceRow(slot, id) { return pieces[slot].pieces.find(function (p) { return p[0] === id; }); }
function pieceObj(row) {
  return row && { id: row[0], name: row[1], rarity: row[2], defence: row[3], slots: row[4], topSlots: row[5],
                  res: row[6], flags: row[7], maxLevel: row[8], skills: row[9], auto: row[10] };
}
function weaponObj(cls, id) {
  if (cls !== 7) return null;
  const w = lsData.weapons.find(function (r) { return r[LS.indexOf("id")] === id; });
  return w && { id: id, name: w[LS.indexOf("name")], slots: w[LS.indexOf("slots")], defense: w[LS.indexOf("defense")],
                auto: index.weaponAuto.melee[id] || [] };
}
function ctxWith(rules, gender) {
  return { rules: rules, gender: gender || "",
           piece: function (slot, id) { return pieceObj(pieceRow(slot, id)); },
           weapon: weaponObj, item: function (id) { return items[id] || null; },
           tree: function (id) { return trees[id] || null; },
           skillName: function (id) { return index.skillNames[id] || "Skill " + id; } };
}
const rules = Rules.make(rulesJson);
const byName = function (list, name) { return list.find(function (r) { return r[1] === name; }); };

/* ---- data ---- */
check(pieces.head.pieces.length > 10000 && index.decorations.length > 5000, "data/armor has pieces and decorations");
let unknownTree = 0;
SLOTS.forEach(function (s) { pieces[s].pieces.forEach(function (p) { p[9].forEach(function (x) { if (!trees[x[0]]) unknownTree++; }); }); });
index.decorations.forEach(function (d) { d[4].forEach(function (x) { if (!trees[x[0]]) unknownTree++; }); });
check(unknownTree === 0, "every tree in data/armor is in data/skills/index.json (" + unknownTree + " unknown)");
["version", "exact", "source", "skillLimit", "overLimit", "weapon", "zenith", "levels", "cuffSlots", "bonuses"]
  .forEach(function (k) { check(k in rulesJson, "rules.json has " + k); });
check(Object.keys(rulesJson.weapon.treeClasses).length === 14, "rules.json maps the 14 Hiden trees to a weapon");

/* ---- the set format ---- */
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

/* ---- activation ---- */
const lv = [[-15, 1, "Bad"], [-10, 2, "Worse?"], [10, 3, "Good"], [20, 4, "Better"]];
check(Calc.activation(lv, 9) === null && Calc.activation(lv, 10).skill === 3 && Calc.activation(lv, 25).skill === 4 &&
      Calc.activation(lv, -10).skill === 2 && Calc.activation(lv, -16).skill === 1, "thresholds pick the right skill");

/* ---- a real set, summed here independently ---- */
const r = Calc.compute(set, ctxWith(rules));
const want = {};
[helm[9], attackG[4], snsCuff[4]].forEach(function (list) {
  list.forEach(function (x) { want[x[0]] = (want[x[0]] || 0) + x[1]; });
});
const got = {};
r.trees.forEach(function (t) { got[t.tree] = t.total; });
check(same(Object.keys(want).sort(), Object.keys(got).sort()) &&
      Object.keys(want).every(function (k) { return want[k] === got[k]; }), "skill points = the rows' sums " + JSON.stringify(got));
let bonusDef = 0;
const bonusRes = [0, 0, 0, 0, 0];
r.active.forEach(function (a) {
  const b = rulesJson.bonuses.skills[a.skill];
  if (b && a.works) { bonusDef += b.defence || 0; (b.res || []).forEach(function (v, i) { bonusRes[i] += v; }); }
});
check(r.defence.total === helm[3] + katana[LS.indexOf("defense")] + bonusDef,
      "defence = piece + weapon + skills (" + r.defence.total + ")");
check(Calc.RES.every(function (name, i) { return r.res[name] === helm[6][i] + bonusRes[i]; }), "resistances = the piece's + skills");
check(r.pieces[0].slots.value === helm[5] && r.pieces[0].decos.used === attackG[3], "max level opens the top-level slots");
const sns = r.trees.find(function (t) { return t.tree === 129; });
check(sns && sns.skill && !sns.works, "SnS Tech from a cuff does nothing with a Long Sword");
check(r.problems.length === 0, "the test set has no problems: " + r.problems.join("; "));
const r1 = Calc.compute({ armour: [["head", helm[0], 1, [attackG[0]]]] }, ctxWith(rules));
check(r1.problems.some(function (p) { return /slots/.test(p); }), "level 1 has no slots for a decoration");
const r2 = Calc.compute({ armour: [["head", helm[0], 7, [snsCuff[0], index.sigils[0][0]]]] }, ctxWith(rules));
check(r2.problems.length === 2, "a cuff and a sigil in an armour slot are refused");
const gunTree = rulesJson.weapon.gunnerTrees[0];
check(!rules.treeWorks(gunTree, 7).ok && rules.treeWorks(gunTree, 10).ok && rules.treeWorks(gunTree, -1).ok,
      "a Gunner tree works with a bow, not a blade");
const fireSkill = trees[53].levels.find(function (l) { return l[0] === 10; })[1];
check(rules.bonus(fireSkill) && rules.bonus(fireSkill).res[0] === 10, "Fire Res+10 adds 10 fire resistance");

/* ---- the limit ---- */
const many = [];
for (let i = 0; i < 12; i++) many.push({ tree: 100 + i, skill: 500 + i });
check(rules.dropped(many, 10) === null, "fallback: over the limit nothing is dropped (rule unknown)");
const known = Rules.make(Object.assign({}, rulesJson, { overLimit: { known: true, order: many.map(function (a) { return a.tree; }) } }));
check(same(known.dropped(many, 10), [510, 511]), "known order: the last ones over the limit drop");
const raised = Rules.make(Object.assign({}, rulesJson, { skillLimit: { base: 10, max: 15, exact: true, raises: [{ skill: 7, add: 3 }, { skill: 8, add: 9 }] } }));
check(raised.skillLimit([7]).limit === 13 && raised.skillLimit([7, 8]).limit === 15, "limit raises are capped");
check(Rules.make(null).skillLimit([]).limit === 10 && !Rules.make(null).exact, "no rules file: the built-in fallback");

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
