#!/usr/bin/env node
/* Checks the Skills database in a browser (headless Chromium): skills.html (js/skills.js), skill.html (js/skill.js)
   and the "Skills" line of the item and equipment pages (js/skill-links.js).

   At 1280 px and 390 px: the list shows every skill tree, Road skill and Tower sigil of data/skills/index.json; a
   category chip narrows it and stays in the address (?cat=), the box too (?q=); a skill tree's page lists its
   levels with the game's points, its decorations linked to /item.html, and its armour (only pieces players can
   get at first, 100 rows, "Show more" adds 100, the box filters by name, unticking shows every piece) linked to
   /equipment.html; a tree with automatic skills lists that equipment; a Road skill and a Tower sigil open; an
   unknown id says so; a decoration's item page and an armour piece's equipment page show "Skills:" linked to
   the tree; an item without skills shows no line; no sideways scrolling and no script errors.
   SHOTS=<dir> saves screenshots.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] node dev/check-skills.js

   The data itself: python3 dev/check-skills.py. Exit code 0 = all as expected. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

const index = readJson("data/skills/index.json");
const total = index.trees.length + index.road.length + index.sigils.length;
/* the tree with the most armour pieces players can get, and one with automatic skills */
const big = index.trees.slice().sort(function (a, b) { return b[4] - a[4]; })[0];
const auto = index.trees.find(function (t) { return t[8] > 0; });
const bigData = readJson("data/skills/" + big[0] + ".json");
const deco = bigData.decorations.find(function (r) { return r[2] === "d"; });
const piece = bigData.armour.find(function (r) { return r[6]; });
const items = readJson("data/items/index.json").items;
const noSkill = items.find(function (r) {
  const c = path.join(ROOT, "data/skills/items/" + Math.floor(r[0] / 1024) + ".json");
  if (r[0] < 1) return false;
  if (!fs.existsSync(c)) return true;
  const d = readJson("data/skills/items/" + Math.floor(r[0] / 1024) + ".json");
  return !d.d[r[0]] && d.s[r[0]] === undefined;
});
check(big && auto && deco && piece && noSkill, "found test skills in the data");

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
      await pg.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) { r.abort(); });
      await pg.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
      async function noSideways(what) {
        const over = await pg.evaluate(function () {
          const m = document.querySelector("main") || document.body;
          return Math.max(m.scrollWidth - m.clientWidth, Math.ceil(m.getBoundingClientRect().right - document.documentElement.clientWidth));
        });
        check(over <= 0, V + " " + what + ": no sideways scrolling (" + over + " px)");
      }
      async function shot(name, full) {
        if (shots) await pg.screenshot({ path: path.join(shots, name + "-" + V + ".png"), fullPage: full !== false });
      }
      const visibleRows = function (sel) { return pg.$$eval(sel, function (r) { return r.filter(function (x) { return !x.hidden; }).length; }); };

      /* the list */
      await pg.goto(base + "/skills.html", { waitUntil: "load" });
      await pg.waitForSelector("#skills-view .skills-table", { state: "attached" });
      check(await visibleRows("#skills-view tbody tr") === total, V + " list: every skill (" + total + ")");
      check((await pg.textContent("#skills-count")).indexOf(String(total)) !== -1 || (await pg.textContent("#skills-count")).indexOf(total.toLocaleString("en-US")) !== -1, V + " list: count");
      await shot("skills", false);
      await noSideways("list");
      await pg.click('#skills-cats .chip[data-cat="Gunner"]');
      const gunners = index.trees.filter(function (t) { return t[2] === "Gunner"; }).length;
      check(await visibleRows("#skills-view tbody tr") === gunners, V + " list: Gunner chip shows " + gunners);
      check(pg.url().indexOf("cat=Gunner") !== -1, V + " list: ?cat= in the address");
      await pg.click('#skills-cats .chip[data-cat=""]');
      await pg.fill("#skills-q", big[1]);
      check(await visibleRows("#skills-view tbody tr") >= 1 && pg.url().indexOf("q=") !== -1, V + " list: search");
      await pg.goto(base + "/skills.html?cat=" + encodeURIComponent("Road skills"), { waitUntil: "load" });
      await pg.waitForSelector("#skills-view .skills-table", { state: "attached" });
      check(await visibleRows("#skills-view tbody tr") === index.road.length, V + " list: ?cat=Road skills");

      /* one tree */
      await pg.goto(base + "/skill.html?id=" + big[0], { waitUntil: "load" });
      await pg.waitForSelector("#armour tbody tr");
      check((await pg.textContent("#skill-view h1")) === big[1], V + " tree: name");
      const levels = await pg.$$eval("#skill-view section:first-of-type tbody tr td:first-child", function (t) { return t.map(function (x) { return x.textContent; }); });
      check(levels.length === big[3].length && levels[levels.length - 1].indexOf(String(big[3][big[3].length - 1][0])) !== -1, V + " tree: levels " + levels);
      check(await pg.$('a[href="/item.html?id=' + deco[0] + '"]') !== null, V + " tree: decoration linked");
      check(await visibleRows("#armour tbody tr") === Math.min(100, big[4]), V + " tree: 100 armour rows");
      await shot("skill-tree", false);
      await noSideways("tree");
      await pg.click("#armour .ghost-btn");
      check(await visibleRows("#armour tbody tr") === Math.min(200, big[4]), V + " tree: Show more");
      await pg.fill("#armour input[type=search]", piece[2]);
      check(await pg.$('#armour a[href="/equipment.html?slot=' + piece[0] + "&id=" + piece[1] + '"]') !== null || !piece[5], V + " tree: filter finds " + piece[2]);
      await pg.fill("#armour input[type=search]", "");
      await pg.uncheck("#armour input[type=checkbox]");
      check((await pg.textContent("#armour .toolbar-note")).indexOf(big[5].toLocaleString("en-US")) !== -1, V + " tree: every piece when unticked");

      /* automatic skills, a Road skill, a sigil, an unknown id */
      await pg.goto(base + "/skill.html?id=" + auto[0], { waitUntil: "load" });
      await pg.waitForSelector("#skill-view .item-hero");
      check((await pg.textContent("#skill-view")).indexOf("Automatic skill") !== -1, V + " tree with automatic skills lists them");
      await shot("skill-automatic", false);
      await pg.goto(base + "/skill.html?road=" + index.road[0][0], { waitUntil: "load" });
      await pg.waitForSelector("#skill-view .item-hero");
      check((await pg.textContent("#skill-view h1")) === index.road[0][1], V + " Road skill opens");
      await pg.goto(base + "/skill.html?sigil=" + index.sigils[0][0], { waitUntil: "load" });
      await pg.waitForSelector("#skill-view .item-hero");
      check((await pg.textContent("#skill-view h1")) === index.sigils[0][1], V + " sigil opens");
      await pg.goto(base + "/skill.html?id=99999", { waitUntil: "load" });
      await pg.waitForSelector("#skill-view .empty-state");
      check((await pg.textContent("#skill-view")).indexOf("No skill tree 99999") !== -1, V + " unknown tree says so");

      /* the Skills line */
      await pg.goto(base + "/item.html?id=" + deco[0], { waitUntil: "load" });
      await pg.waitForSelector(".skill-line:not([hidden]) a");
      check(await pg.$('.skill-line a[href="/skill.html?id=' + big[0] + '"]') !== null, V + " item page: Skills line links the tree");
      await shot("item-skills", false);
      await pg.goto(base + "/equipment.html?slot=" + piece[0] + "&id=" + piece[1], { waitUntil: "load" });
      await pg.waitForSelector(".skill-line:not([hidden]) a");
      check(await pg.$('.skill-line a[href="/skill.html?id=' + big[0] + '"]') !== null, V + " equipment page: Skills line links the tree");
      await shot("equipment-skills", false);
      await noSideways("equipment");
      await pg.goto(base + "/item.html?id=" + noSkill[0], { waitUntil: "load" });
      await pg.waitForSelector(".item-hero");
      await pg.waitForTimeout(300);
      check(await pg.$(".skill-line:not([hidden])") === null, V + " item without skills: no line");

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
  console.log(failed ? failed + " problem(s)" : "skills pages OK");
  process.exit(failed ? 1 : 0);
}).catch(function (e) { console.log("FAIL " + e.stack); process.exit(1); });
