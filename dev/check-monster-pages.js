#!/usr/bin/env node
/* Checks the game's own monster and quest data (dev/make-monster-data.py, from hvmhfz_re tools/monsters) and the
   pages that show it: monster.html (js/monster.js, js/monster-game.js) and quest.html (js/quest.js).

   1. Data: every index entry with a monster id has data/monsters/game/<id>.json (unless the game has none), each
      with 84 level rows and ranks whose hitzone rows have a name, a name source and 9 values; values the community
      tables also give (the hvmhfz_re lane checked them against the client): Rathian HP at level 3 is 3499, Low
      rank head cut 70, G rank head cut 50, poison 200 (+75, 4 times), Low rank carves (3) with Rathian Scale 37%;
      Zinogre's attack records with thunder hits (from the game's file); Rathian, Tigrex and Akantor's linked DLL rows with the right counts, certainty and family reach; Cephalos with none; every drop and reward item id is in data/item-ids.json; every
      quest of data/quests.json has its rewards shard entry; quest 1065 pays Ioprey Fang 30% for the main target
      and lists Iodrome with 1,000 HP. HvMonsterGame.summary(Rathian) is weak to dragon.
      Items (dev/make-item-data.py): data/items/<id>.json "rewards" holds every quest reward of the shards (quests of
      data/quests.json only), best chance first; Ioprey Fang lists quest 1065, main target, 30%; the index's sources
      count drops, needs and rewards; a drop row from the game's tables ("game": true) never repeats a monster the
      community tables list for that item.
   2. Pages (when Playwright is found), desktop 1280 and phone 375: Rathian shows Key stats, "from the game's
      data", the five tabs and rank chips; the hitzone table is heat-coloured with the best cell of each column
      outlined; Status, Drops (item links to /item.html?id=), Attacks (Rathian: 18 lines with certainty badges and the family note; Cephalos: "Not mapped yet"; Zinogre: damage changes with defence) and
      Stats work; community tables sit in a labelled fold and no community hitzone table shows outside it; a
      monster without game data (Musou Zinogre) keeps its community page; quest 1065 shows Rewards and Monster
      HP linking to the monster page; item 392 (Rathian Scale) shows "Rewarded by" with its best 10 quests, Show all
      lists every one and the rank chips filter it; Claw Fossil (game drop tables only) marks its rows with *; an
      item with no source says so; the item tables' first column is sticky on the phone and static on the desktop;
      no sideways scrolling and no script errors. SHOTS=<dir> saves screenshots.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] node dev/check-monster-pages.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const Game = require(path.join(ROOT, "js/monster-game.js"));
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

/* ---------- 1. data ---------- */
const index = readJson("data/monsters/index.json");
const gindex = readJson("data/monsters/game/index.json");
const items = readJson("data/item-ids.json");
let monsters = 0;
const itemIds = new Set();
index.forEach(function (e) {
  (e.ids || []).forEach(function (id) {
    check(gindex[id], e.slug + ": monster id " + id + " has game data");
  });
});
Object.keys(gindex).forEach(function (id) {
  const g = readJson("data/monsters/game/" + id + ".json");
  monsters++;
  check(g.id === Number(id) && g.levels.length === 84, id + ": id and 84 level rows");
  check(g.ranks.length > 0, id + ": at least one rank");
  g.ranks.forEach(function (r) {
    r.hz.forEach(function (s) {
      s.rows.forEach(function (row) {
        check(typeof row[0] === "string" && row[0] && [0, 1, 2].indexOf(row[1]) >= 0 && row.length === 11 &&
          row.slice(2).every(Number.isInteger), id + " " + r.label + " " + s.label + ": row shape " + JSON.stringify(row));
      });
    });
  });
  (g.drops || []).forEach(function (d) {
    d.sections.forEach(function (sec) { sec.items.forEach(function (it) { if (it[0]) itemIds.add(it[0]); }); });
  });
  check(gindex[id][1] === null || index.some(function (e) { return e.slug === gindex[id][1]; }), id + ": its slug is an index entry");
});
const rath = readJson("data/monsters/game/1.json");
check(rath.levels[3][0] === 3499, "Rathian level 3 HP 3499, got " + rath.levels[3][0]);
const head = function (rank) { return rank.hz[0].rows.filter(function (r) { return r[0] === "Head"; })[0]; };
check(head(rath.ranks[0])[2] === 70, "Rathian Low rank head cut 70");
const g = rath.ranks.filter(function (r) { return /G rank/.test(r.label); })[0];
check(g && head(g)[2] === 50, "Rathian G rank head cut 50");
const poison = rath.ranks[0].status.poison;
check(poison && poison.threshold === 200 && poison.increase === 75 && poison.cap === 4, "Rathian Low rank poison 200 +75 x4: " + JSON.stringify(poison));
const lrCarves = rath.drops[0].sections.filter(function (s) { return s.method === "Carves"; })[0];
check(rath.drops[0].rank === "LR" && lrCarves && lrCarves.count === 3 &&
  lrCarves.items.some(function (it) { return it[0] === 392 && it[2] === 37; }), "Rathian LR carves (3) with Rathian Scale 37%");
const sum = Game.summary(rath);
check(sum.weak[0] === "dragon" && sum.baseHp === 5000, "Rathian summary: weak to dragon, base HP 5000: " + JSON.stringify(sum));
const zin = readJson("data/monsters/game/146.json");
check(zin.attacks && zin.attacks.some(function (a) { return a[3] === "thunder" && a[1] > 0; }), "Zinogre has thunder attack records");
// The older monsters' attacks (hvmhfz_re part 103): a line is [rows, power, ko, element, community name, certainty
// (0 file, 1 HD+SD, 2 HD only), reach (monsters sharing the row)].
const lineRows = function (g) { return g.attacks.reduce(function (n, a) { return n + a[0].length; }, 0); };
[[1, "Rathian", 18, 44, 10], [76, "Tigrex", 25, 38, 3], [77, "Akantor", 29, 41, 3]].forEach(function (c) {
  const m = readJson("data/monsters/game/" + c[0] + ".json");
  check(m.attacks && m.attacks.length === c[2] && lineRows(m) === c[3], c[1] + " has " + c[2] + " attack lines of " + c[3] + " records, got " +
    (m.attacks && m.attacks.length) + " of " + (m.attacks && lineRows(m)));
  check(m.attacks.every(function (a) { return a.length === 7 && a[1] > 0 && (a[5] === 1 || a[5] === 2) && a[6] === c[4]; }), c[1] + "'s lines are DLL rows with a certainty and family reach " + c[4]);
  check(m.attacks.some(function (a) { return a[5] === 1; }) && m.attacks.some(function (a) { return a[5] === 2; }), c[1] + " has both HD+SD and HD-only lines");
});
check(readJson("data/monsters/game/77.json").attacks.filter(function (a) { return a[4]; }).length === 3, "Akantor has 3 community-named lines");
check(zin.attacks.every(function (a) { return a[5] === 0 && a[6] === 0; }), "Zinogre's lines come from the game's attack file (certainty 0)");
check(!readJson("data/monsters/game/34.json").attacks, "Cephalos (no rows mapped) has no attacks list");
const quests = readJson("data/quests.json").quests;
const shards = {};
let missing = 0;
quests.forEach(function (q) {
  const n = Math.floor(q.id / 1000);
  if (!shards[n]) shards[n] = fs.existsSync(path.join(ROOT, "data/quests/rewards/" + n + ".json")) ? readJson("data/quests/rewards/" + n + ".json") : { quests: {}, names: {} };
  if (!shards[n].quests[q.id]) missing++;
});
check(missing === 0, missing + " quests of data/quests.json without a rewards entry");
Object.keys(shards).forEach(function (n) { Object.keys(shards[n].names).forEach(function (id) { itemIds.add(Number(id)); }); });
const unknown = Array.from(itemIds).filter(function (id) { return !(String(id) in items); });
check(unknown.length === 0, unknown.length + " drop/reward item ids not in data/item-ids.json: " + unknown.slice(0, 10));
const q1065 = shards[1].quests["1065"];
check(q1065 && q1065.rewards.some(function (gr) { return gr.when === "main target" && gr.items.some(function (it) { return it[0] === 357 && it[2] === 30; }); }),
  "quest 1065 main target pays Ioprey Fang 30%");
check(q1065 && q1065.monsters[0][0] === 31 && q1065.monsters[0][2] === 1000, "quest 1065 lists Iodrome with 1000 HP");

// Item files: quest rewards and game drop rows.
const questIds = new Set(quests.map(function (q) { return q.id; }));
let wantRewards = 0;
Object.keys(shards).forEach(function (n) {
  Object.keys(shards[n].quests).forEach(function (id) {
    if (!questIds.has(Number(id))) return;
    shards[n].quests[id].rewards.forEach(function (gr) {
      const seen = new Set();
      gr.items.forEach(function (it) { if (it[0] && !seen.has(it[0])) { seen.add(it[0]); wantRewards++; } });
    });
  });
});
const itemIndex = readJson("data/items/index.json").items;
let gotRewards = 0, badOrder = 0, badQuest = 0, badCount = 0, repeated = 0;
itemIndex.forEach(function (row) {
  if (!row[4]) return;
  const d = readJson("data/items/" + row[0] + ".json");
  const r = d.rewards || [];
  gotRewards += r.length;
  r.forEach(function (x, i) { if (i && r[i - 1][5] < x[5]) badOrder++; if (!questIds.has(x[0])) badQuest++; });
  if (row[4] !== d.drops.length + d.quests.length + r.length) badCount++;
  const community = new Set(d.drops.filter(function (x) { return !x.game; }).map(function (x) { return x.slug; }));
  d.drops.forEach(function (x) { if (x.game && x.slug && community.has(x.slug)) repeated++; });
});
check(gotRewards === wantRewards, "item files hold " + gotRewards + " quest reward rows, the shards " + wantRewards);
check(badOrder === 0 && badQuest === 0, badOrder + " reward rows out of chance order, " + badQuest + " for a quest not in data/quests.json");
check(badCount === 0, badCount + " index rows whose sources count is not drops + needs + rewards");
check(repeated === 0, repeated + " game drop rows repeat a monster the community tables list for the item");
const fang = readJson("data/items/357.json").rewards;
check(fang.some(function (x) { return x[0] === 1065 && x[3] === "main target" && x[5] === 30; }), "Ioprey Fang lists quest 1065, main target, 30%");

/* ---------- 2. pages ---------- */
let chromium = null;
try { chromium = require("playwright").chromium; } catch (e) { /* data only */ }

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
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

async function pages() {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;
  try {
    for (const view of [{ name: "desktop", width: 1280, height: 900 }, { name: "phone", width: 375, height: 800 }]) {
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.name === "phone" ? 2 : 1 });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", function (e) { errors.push(e.message); });
      await pg.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) { r.abort(); });
      await pg.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
      async function noSideways(what) {
        const over = await pg.evaluate(function () {
          const m = document.querySelector("main") || document.body;
          return Math.max(m.scrollWidth - m.clientWidth, Math.ceil(m.getBoundingClientRect().right - document.documentElement.clientWidth));
        });
        check(over <= 0, view.name + " " + what + ": no sideways scrolling (" + over + " px)");
      }
      const V = view.name;

      await pg.goto(base + "/monster.html?m=rathian", { waitUntil: "load" });
      await pg.waitForSelector("#game-data .mg-heat");
      check(/Base HP\s*5,000/.test(await pg.textContent("#key-stats")), V + ": Key stats shows base HP 5,000");
      check(/from the game's data/.test(await pg.textContent("#game-data .panel-head")), V + ": game data panel labelled");
      const tabs = await pg.$$eval("#game-data .mg-tabs .tab", function (t) { return t.map(function (x) { return x.textContent; }); });
      check(tabs.join(",") === "Hitzones,Status,Drops,Attacks,Stats", V + ": five tabs: " + tabs);
      const ranks = await pg.$$eval("#game-data .mg-ranks .chip", function (t) { return t.map(function (x) { return x.textContent; }); });
      check(ranks.length === rath.ranks.length && ranks[ranks.length - 1] === rath.ranks[rath.ranks.length - 1].label, V + ": rank chips " + ranks);
      const heat = await pg.$$eval("#game-data .mg-heat td.mg-hz", function (t) {
        return { n: t.length, coloured: t.every(function (x) { return /rgb|hsl/.test(x.style.background); }),
          best: t.filter(function (x) { return x.classList.contains("mg-best"); }).length };
      });
      check(heat.n === 7 * 9 && heat.coloured && heat.best >= 9, V + ": 7 parts × 9 heat-coloured cells, best outlined: " + JSON.stringify(heat));
      check((await pg.$$("#monster-root > section .hitzone-table:not(.mg-heat)")).length === 0, V + ": no community hitzone table outside the fold");
      check(await pg.$eval("#community", function (d) { return d.tagName === "DETAILS" && /Community tables/.test(d.querySelector("summary").textContent); }), V + ": community tables in a labelled fold");
      if (shots) { fs.mkdirSync(shots, { recursive: true }); await pg.screenshot({ path: path.join(shots, V + "-monster-hitzones.png"), fullPage: true }); }
      await pg.click("#game-data .mg-ranks .chip >> nth=0");
      check(/^Head70/.test(await pg.$eval("#game-data .mg-heat tbody tr", function (r) { return r.textContent; })), V + ": Low rank chip shows head cut 70");
      await noSideways("monster hitzones");

      await pg.click("#game-data .tab:has-text('Status')");
      const poisonRow = await pg.$eval("#game-data .mg-status tbody tr", function (r) { return Array.prototype.map.call(r.cells, function (c) { return c.textContent; }); });
      check(poisonRow[0] === "Poison" && poisonRow[1] === "200" && poisonRow[3] === "500", V + ": Low rank poison 200, most 500: " + poisonRow);

      await pg.click("#game-data .tab:has-text('Drops')");
      const firstDrop = await pg.$eval("#game-data .drop-row a", function (a) { return a.getAttribute("href"); });
      check(/^\/item\.html\?id=\d+$/.test(firstDrop), V + ": drop items link the item page: " + firstDrop);
      check(await pg.$eval("#game-data .mg-drop-ranks .chip[aria-pressed=true]", function (b) { return b.textContent; }) === "GR", V + ": drops open on GR");
      if (shots) await pg.locator("#game-data").screenshot({ path: path.join(shots, V + "-monster-drops.png") });

      await pg.click("#game-data .tab:has-text('Stats')");
      check(await pg.$$eval("#game-data .levels-table tbody tr", function (t) { return t.length; }) === 84, V + ": Stats lists 84 levels");
      await noSideways("monster stats");
      check(errors.length === 0, V + ": no script errors on Rathian: " + errors.join(" | "));

      await pg.click("#game-data .tab:has-text('Attacks')");
      await pg.waitForSelector("#game-data .mg-attacks");
      check(await pg.$$eval("#game-data .mg-attacks tbody tr", function (t) { return t.length; }) === 18, V + ": Rathian's Attacks tab lists 18 lines");
      const rb = await pg.$$eval("#game-data .mg-attacks .badge", function (b) { return b.map(function (x) { return x.textContent; }); });
      check(rb.indexOf("HD + SD") >= 0 && rb.indexOf("HD only") >= 0 && rb.indexOf("family") < 0, V + ": Rathian's lines show certainty badges (no family badge: all rows are shared): " + rb.slice(0, 4));
      check(/this monster's family can use these/.test(await pg.textContent("#game-data")), V + ": Rathian's Attacks tab has the family note");
      if (shots) await pg.locator("#game-data").screenshot({ path: path.join(shots, V + "-rathian-attacks.png") });
      await noSideways("old monster attacks");

      await pg.goto(base + "/monster.html?m=cephalos#attacks", { waitUntil: "load" });
      await pg.waitForSelector("#game-data .mg-tabs");
      check(/Not mapped yet/.test(await pg.textContent("#game-data")), V + ": Cephalos's Attacks tab says not mapped yet");

      await pg.goto(base + "/monster.html?m=zinogre#attacks", { waitUntil: "load" });
      await pg.waitForSelector("#game-data .mg-attacks");
      const before = await pg.$eval("#game-data .mg-attacks tbody tr td:last-child", function (c) { return c.textContent; });
      await pg.fill("#game-data .mg-dmg-form input", "1200");
      const after = await pg.$eval("#game-data .mg-attacks tbody tr td:last-child", function (c) { return c.textContent; });
      check(before !== after && parseInt(after.replace(/,/g, ""), 10) < parseInt(before.replace(/,/g, ""), 10), V + ": Zinogre damage drops with more defence: " + before + " → " + after);
      check(/thunder/.test(await pg.textContent("#game-data .mg-attacks")), V + ": Zinogre's attacks show thunder");
      if (shots) await pg.locator("#game-data").screenshot({ path: path.join(shots, V + "-monster-attacks.png") });
      await noSideways("monster attacks");

      await pg.goto(base + "/monster.html?m=musou-zinogre", { waitUntil: "load" });
      await pg.waitForFunction(function () { return document.getElementById("monster-loading").hidden; });
      check((await pg.$$("#game-data")).length === 0 && (await pg.$$("#community")).length === 0, V + ": Musou Zinogre (no id) keeps its community page");

      await pg.goto(base + "/quest.html?id=1065", { waitUntil: "load" });
      await pg.waitForSelector("#rewards .quest-reward-group");
      const groups = await pg.$$eval("#rewards .quest-reward-group h3", function (h) { return h.map(function (x) { return x.textContent; }); });
      check(groups[0] === "Main target done" && groups.length === q1065.rewards.length, V + ": quest 1065 reward groups " + groups);
      check(/Ioprey Fang/.test(await pg.textContent("#rewards")), V + ": quest 1065 rewards name Ioprey Fang");
      const hp = await pg.$eval("#monster-hp tbody tr", function (r) { return [r.cells[0].querySelector("a") && r.cells[0].querySelector("a").getAttribute("href"), r.cells[1].textContent]; });
      check(hp[0] === "/monster.html?m=iodrome" && hp[1] === "1,000", V + ": quest 1065 Iodrome 1,000 HP linked: " + hp);
      await noSideways("quest");
      if (shots) await pg.screenshot({ path: path.join(shots, V + "-quest.png"), fullPage: true });

      // Item page: Rewarded by (best 10, Show all, rank chips), game drop rows, no source, sticky first column.
      await pg.goto(base + "/item.html?id=392", { waitUntil: "load" });
      await pg.waitForSelector(".item-rewards tbody tr");
      const scale = readJson("data/items/392.json").rewards;
      const rewardRows = function () { return pg.$$eval(".item-rewards tbody tr", function (t) { return t.map(function (r) { return [r.cells[0].querySelector("a").getAttribute("href"), r.cells[1].textContent]; }); }); };
      let got = await rewardRows();
      check(got.length === 10 && got[0][0] === "/quest.html?id=" + scale[0][0], V + ": Rathian Scale shows its best 10 rewards first: " + got.length + " " + (got[0] || []));
      await pg.click(".panel:has(.item-rewards) .item-show-all");
      got = await rewardRows();
      check(got.length === scale.length, V + ": Show all lists " + got.length + " of " + scale.length);
      await pg.click(".panel:has(.item-rewards) .chip:text-is('HR')");
      got = await rewardRows();
      check(got.length === scale.filter(function (x) { return x[2] === "HR"; }).length && got.every(function (x) { return x[1] === "HR"; }), V + ": the HR chip keeps only HR rows");
      const firstPos = await pg.$eval(".item-rewards tbody td", function (td) { return getComputedStyle(td).position; });
      check(firstPos === (V === "phone" ? "sticky" : "static"), V + ": the item table's first column is " + firstPos);
      await noSideways("item");
      if (shots) await pg.screenshot({ path: path.join(shots, V + "-item.png"), fullPage: true });
      await pg.goto(base + "/item.html?id=10726", { waitUntil: "load" });
      await pg.waitForSelector(".item-drops tbody tr");
      check(/game's own drop tables/.test(await pg.textContent("#item-view")) && (await pg.$$(".item-drops .item-src")).length > 0, V + ": Claw Fossil marks its game-table drop rows");
      const none = itemIndex.find(function (r) { return !r[4]; });
      await pg.goto(base + "/item.html?id=" + none[0], { waitUntil: "load" });
      await pg.waitForSelector("#item-view .panel");
      check(/No monster drop table, quest reward or quest entry/.test(await pg.textContent("#item-view")), V + ": an item with no source says so");
      check(errors.length === 0, V + ": no script errors: " + errors.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async function () {
  if (chromium) await pages();
  if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
  console.log("monster pages OK: " + monsters + " monsters, " + quests.length + " quests" + (chromium ? ", pages in Chromium" : ""));
})().catch(function (e) { console.log("FAIL " + e.message); process.exit(1); });
