#!/usr/bin/env node
/* Checks what items are used for in a browser (headless Chromium): the item page's "Used for", the equipment
   page (equipment.html, js/equipment.js), the Weapons page's materials and the Items page's armour links.

   At 1280 px and 390 px: an item with weapon, armour, decoration and Tower uses (found in data/uses/index.json)
   shows "Used for" right after "Where to get it", its groups in order with their counts, each line linked (pieces
   to /equipment.html, items to /item.html); a long group shows 8 lines, "Show all" more, and its filter narrows
   the lines; an item with deliver quests lists them under Quests with "Needed to enter" first when the item has
   entry quests; an item with no use says "No known use"; the equipment page of an upgraded piece shows its line,
   what it upgrades into and the materials of each way to make it, linked; a weapon on the Weapons page lists its
   materials; an unknown piece says so; no sideways scrolling and no script errors. SHOTS=<dir> saves screenshots.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] node dev/check-uses.js

   The data itself (every link resolves): python3 dev/check-uses.py. Exit code 0 = all as expected. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

const uses = readJson("data/uses/index.json").items;
const items = new Map(readJson("data/items/index.json").items.map(function (r) { return [r[0], r]; }));
const ids = Object.keys(uses).map(Number);
const big = ids.filter(function (i) { const g = uses[i][1]; return ["weapon", "armour", "deco", "tower"].every(function (x) { return g.indexOf(x) !== -1; }); })
  .sort(function (a, b) { return uses[b][0] - uses[a][0]; })[0];
const needs = ids.find(function (i) {
  if (uses[i][1].indexOf("quest") === -1) return false;
  const f = path.join(ROOT, "data/items/" + i + ".json");
  return fs.existsSync(f) && (readJson("data/items/" + i + ".json").quests || []).length > 0;
});
const none = [...items.keys()].find(function (i) { return i > 0 && !uses[i]; });
/* an upgraded melee weapon that has a type on the Weapons page and upgrades on */
const melee = readJson("data/equipment/melee/names.json").names;
const wtypes = readJson("data/weapons/ids.json");
const weapon = melee.findIndex(function (n, i) {
  return n && n[2] && wtypes.melee.charAt(i) !== "." && melee.some(function (m) { return m && m[2] === i; });
});
check(big && needs && none && weapon > 0, "found test items in the data (" + [big, needs, none, weapon] + ")");
const GROUPS = ["Crafting", "Weapons", "Armour", "Decorations", "Tower", "Exchanges", "Quests"];

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
      async function shot(name) { if (shots) await pg.screenshot({ path: path.join(shots, name + "-" + V + ".png"), fullPage: true }); }
      const hrefs = async function (sel) { return pg.$$eval(sel, function (a) { return a.map(function (x) { return x.getAttribute("href"); }); }); };

      /* item with many uses */
      await pg.goto(base + "/item.html?id=" + big, { waitUntil: "load" });
      await pg.waitForSelector("#uses");
      const order = await pg.$$eval("#item-view > .panel", function (p) { return p.map(function (x) { return x.id; }); });
      check(order[0] === "where" && order[1] === "uses", V + ": Used for right after Where to get it: " + order.join(","));
      const heads = await pg.$$eval("#uses h3", function (h) { return h.map(function (x) { return x.textContent.split(" · ")[0]; }); });
      check(heads.join() === GROUPS.filter(function (g) { return heads.indexOf(g) !== -1; }).join() && heads.length >= 4, V + ": groups in order: " + heads.join(", "));
      const note = await pg.textContent("#uses .panel-head-note");
      check(note.replace(/,/g, "").indexOf(String(uses[big][0])) === 0, V + ": count " + note + " = " + uses[big][0]);
      const links = await hrefs("#uses .where-src a");
      check(links.length > 0 && links.every(function (h) { return /^\/(equipment\.html\?slot=[a-z]+&id=\d+|item\.html\?id=\d+|quest\.html\?id=\d+)$/.test(h) || h === "#needs"; }), V + ": every line linked");
      const weaponsBlock = (await pg.$$("#uses .where-group"))[heads.indexOf("Weapons")];
      const before = await weaponsBlock.$$eval(".where-line", function (l) { return l.length; });
      const total = Number((await weaponsBlock.$eval("h3", function (h) { return h.textContent; })).split(" · ")[1].replace(/,/g, ""));
      check(before === Math.min(8, total), V + ": Weapons shows " + before + " of " + total + " first");
      await noSideways("item with uses");
      await shot("item-uses-" + big);
      if (total > 8) {
        await weaponsBlock.$eval("button", function (b) { b.click(); });
        const after = await weaponsBlock.$$eval(".where-line", function (l) { return l.length; });
        check(after === Math.min(200, total), V + ": Show all shows " + after);
        const first = await weaponsBlock.$eval(".where-src a", function (a) { return a.textContent; });
        await weaponsBlock.$eval("input", function (i, v) { i.value = v; i.dispatchEvent(new Event("input")); }, first);
        const filtered = await weaponsBlock.$$eval(".where-line", function (l) { return l.map(function (x) { return x.textContent; }); });
        check(filtered.length >= 1 && filtered.length < after && filtered.every(function (t) { return t.indexOf(first) !== -1; }), V + ": the filter narrows to " + filtered.length);
      }

      /* item with deliver quests and entry quests */
      await pg.goto(base + "/item.html?id=" + needs, { waitUntil: "load" });
      await pg.waitForSelector("#uses");
      const qBlock = (await pg.$$("#uses .where-group")).pop();
      check((await qBlock.$eval("h3", function (h) { return h.textContent; })).indexOf("Quests") === 0, V + ": Quests group last");
      check((await qBlock.$eval(".where-src a", function (a) { return a.getAttribute("href"); })) === "#needs" && await pg.$("#needs"), V + ": Needed to enter first, linked to its panel");
      await shot("item-quests-" + needs);

      /* item with no use */
      await pg.goto(base + "/item.html?id=" + none, { waitUntil: "load" });
      await pg.waitForSelector("#uses");
      check(/No known use/.test(await pg.textContent("#uses")), V + ": an item with no use says so");

      /* equipment page */
      await pg.goto(base + "/equipment.html?slot=melee&id=" + weapon, { waitUntil: "load" });
      await pg.waitForSelector("#materials");
      check((await pg.textContent("#equipment-view h1")) === melee[weapon][0], V + ": equipment name");
      check(/Upgrade from/.test(await pg.textContent("#materials")), V + ": upgrade step shown");
      const matLinks = await hrefs("#materials .mat-list a");
      check(matLinks.length > 0 && matLinks.every(function (h) { const m = /^\/item\.html\?id=(\d+)$/.exec(h); return m && items.has(Number(m[1])); }), V + ": materials link their items");
      check((await hrefs(".eq-line a")).length >= 1 && (await hrefs(".eq-into a")).length >= 1, V + ": the line and what it upgrades into");
      check((await hrefs("#equipment-view .page-sub a"))[0].indexOf("/weapons.html?type=") === 0, V + ": link to the Weapons page");
      check(/Equipment|Items/.test(await pg.textContent(".breadcrumbs")) && (await pg.textContent(".breadcrumbs")).indexOf(melee[weapon][0]) !== -1, V + ": crumbs end with the name");
      await noSideways("equipment page");
      await shot("equipment-melee-" + weapon);
      await pg.goto(base + "/equipment.html?slot=head&id=999999", { waitUntil: "load" });
      await pg.waitForSelector("#equipment-view .empty-state");
      check(/No recipe names/.test(await pg.textContent("#equipment-view")), V + ": an unknown piece says so");

      /* Weapons page */
      const type = wtypes.types[wtypes.melee.charCodeAt(weapon) - 97];
      await pg.goto(base + "/weapons.html?type=" + type + "&w=" + weapon, { waitUntil: "load" });
      await pg.waitForSelector("#wp-materials .mat-way");
      check((await hrefs("#wp-materials .mat-list a")).length > 0 && (await hrefs("#wp-materials a")).indexOf("/equipment.html?slot=melee&id=" + weapon) !== -1, V + ": weapon detail lists the materials and links the equipment page");
      await noSideways("weapons page");
      if (shots) await (await pg.$("#wp-detail")).screenshot({ path: path.join(shots, "weapon-detail-" + V + ".png") });

      check(!errors.length, V + ": no script errors: " + errors.join(" | "));
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
  console.log(failed ? failed + " checks failed" : "uses pages OK");
  process.exit(failed ? 1 : 0);
}).catch(function (e) { console.log("FAIL " + e.stack); process.exit(1); });
