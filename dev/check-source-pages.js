#!/usr/bin/env node
/* Checks the Database's item sources in a browser (headless Chromium): the item page's "Where to get it", the
   Sources list (sources.html, js/sources.js), one source (source.html, js/source.js) and the search kind.

   At 1280 px and 390 px: sources.html lists every source of data/sources/index.json under its group and the box
   filters them (?q= kept); the Hunting Road shop's Decorations tab lists every row of its file with prices in RdP,
   its item links open items that exist, the Price header sorts by number, ?q= filters; an unknown source says so;
   an item with a shop and a recipe (found in the data) shows "Where to get it" first, with the shop linked to its
   source page and the materials linked to their items; an item with gathering quests opens the quest list; an
   item with no source says "No known source"; the Database search finds a source; no sideways scrolling and no
   script errors. SHOTS=<dir> saves screenshots of each page at both widths.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=dir] node dev/check-source-pages.js

   The data itself (every link resolves, both ways): python3 dev/check-sources.py. Exit code 0 = all as expected. */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
function check(ok, msg) { if (!ok) { failed++; console.log("FAIL " + msg); } }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

const index = readJson("data/sources/index.json");
const items = new Map(readJson("data/items/index.json").items.map(function (r) { return [r[0], r]; }));
const road = readJson("data/sources/road-shop-4.json");

/* An item with a shop row and a craft row with materials, one with gathering quests, one with no source at all. */
const groupOf = new Map(index.sources.map(function (s) { return [s[0], s[2]]; }));
let both = null, gatherer = null;
for (const file of fs.readdirSync(path.join(ROOT, "data/items"))) {
  if (file === "index.json" || (both && gatherer)) continue;
  const d = readJson("data/items/" + file);
  const w = d.where || [];
  if (!both && w.some(function (e) { return groupOf.get(e[0]) === "shop"; }) &&
      w.some(function (e) { return groupOf.get(e[0]) === "craft" && e[1].mats; })) both = d;
  if (!gatherer && (d.gather || []).length > 2) gatherer = d;
}
const none = [...items.values()].find(function (r) { return r[0] > 0 && !r[4]; });
check(both && gatherer && none, "found test items in the data");

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

      /* sources.html */
      await pg.goto(base + "/sources.html", { waitUntil: "load" });
      await pg.waitForSelector("#sources-view .sources-group");
      const listed = await pg.$$eval("#sources-view tbody a", function (a) { return a.map(function (x) { return x.getAttribute("href"); }); });
      check(listed.length === index.sources.length, V + ": sources.html lists " + listed.length + " of " + index.sources.length);
      check(listed.every(function (h) { return /^\/source\.html\?id=[a-z0-9-]+$/.test(h); }), V + ": every source links its page");
      const groups = await pg.$$eval("#sources-view .sources-group h2", function (h) { return h.map(function (x) { return x.textContent; }); });
      check(groups.join("|") === index.groups.map(function (g) { return g[1]; }).join("|"), V + ": groups in order: " + groups.join(", "));
      await noSideways("sources.html");
      await shot("sources");
      await pg.fill("#sources-q", "road shop");
      const shown = await pg.$$eval("#sources-view tbody tr:not([hidden])", function (r) { return r.length; });
      check(shown === 9 && /q=road\+shop/.test(pg.url()), V + ": the box filters to the 9 Road shop tabs (" + shown + ") and keeps ?q=");

      /* source.html */
      await pg.goto(base + "/source.html?id=road-shop-4", { waitUntil: "load" });
      await pg.waitForSelector(".source-table tbody tr");
      const rows = await pg.$$eval(".source-table tbody tr", function (r) { return r.length; });
      check(rows === road.rows.length, V + ": Decorations tab shows " + rows + " of " + road.rows.length + " rows");
      check(/Hunting Road shop: Decorations/.test(await pg.textContent("#source-view h1")), V + ": source title");
      check(/Decorations/.test(await pg.textContent(".breadcrumbs")) && /Sources/.test(await pg.textContent(".breadcrumbs")), V + ": crumbs Sources › name");
      const hrefs = await pg.$$eval(".source-table tbody td.source-item a", function (a) { return a.map(function (x) { return x.getAttribute("href"); }); });
      check(hrefs.length === rows && hrefs.every(function (h) { const m = /^\/item\.html\?id=(\d+)$/.exec(h); return m && items.has(Number(m[1])); }), V + ": every item link opens an item that exists");
      check(/RdP/.test(await pg.textContent(".source-table tbody")), V + ": prices in RdP");
      await noSideways("source.html");
      await shot("source-road-decorations");
      if (V === "desktop") {
        const priceTh = await pg.$$eval(".source-table thead th", function (t) { return t.map(function (x) { return x.textContent; }).indexOf("Price"); });
        await pg.click(".source-table thead th:nth-child(" + (priceTh + 1) + ")");
        const prices = await pg.$$eval(".source-table tbody tr td:nth-child(" + (priceTh + 1) + ")", function (t) { return t.map(function (x) { return Number(x.dataset.sort); }); });
        const sorted = prices.every(function (p, i) { return !i || prices[i - 1] <= p; }) || prices.every(function (p, i) { return !i || prices[i - 1] >= p; });
        check(sorted, V + ": the Price header sorts by number");
      }
      await pg.goto(base + "/source.html?id=road-shop-4&q=" + encodeURIComponent(items.get(road.rows[0].item)[1]), { waitUntil: "load" });
      await pg.waitForSelector(".source-table tbody tr");
      const visible = await pg.$$eval(".source-table tbody tr:not([hidden])", function (r) { return r.length; });
      check(visible >= 1 && visible < rows, V + ": ?q= filters the rows (" + visible + ")");
      await pg.goto(base + "/source.html?id=no-such-source", { waitUntil: "load" });
      await pg.waitForSelector("#source-view .empty-state");
      check(/There is no source/.test(await pg.textContent("#source-view")), V + ": an unknown source says so");

      /* item.html */
      await pg.goto(base + "/item.html?id=" + both.id, { waitUntil: "load" });
      await pg.waitForSelector("#where");
      const first = await pg.$eval("#item-view .panel", function (p) { return p.id; });
      check(first === "where", V + ": Where to get it comes first (item " + both.id + ")");
      const whereLinks = await pg.$$eval("#where .where-src a", function (a) { return a.map(function (x) { return x.getAttribute("href"); }); });
      const known = new Set(index.sources.map(function (s) { return "/source.html?id=" + s[0]; }));
      check(whereLinks.length > 0 && whereLinks.filter(function (h) { return /source\.html/.test(h); }).every(function (h) { return known.has(h); }), V + ": every source link resolves");
      const heads = await pg.$$eval("#where h3", function (h) { return h.map(function (x) { return x.textContent; }); });
      check(heads.indexOf("Shops") !== -1 && heads.indexOf("Crafting") !== -1, V + ": Shops and Crafting groups: " + heads.join(", "));
      const mats = await pg.$$eval("#where .where-mats a", function (a) { return a.map(function (x) { return x.getAttribute("href"); }); });
      check(mats.length > 0 && mats.every(function (h) { const m = /^\/item\.html\?id=(\d+)$/.exec(h); return m && items.has(Number(m[1])); }), V + ": materials link their items");
      await noSideways("item with sources");
      await shot("item-" + both.id);

      await pg.goto(base + "/item.html?id=" + gatherer.id, { waitUntil: "load" });
      await pg.waitForSelector("#where .where-fold");
      await pg.click("#where .where-fold summary");
      await pg.waitForSelector("#where .where-quests li");
      const ql = await pg.$$eval("#where .where-quests li", function (l) { return l.length; });
      check(ql === gatherer.gather.length, V + ": the gathering list shows " + ql + " of " + gatherer.gather.length + " quests");
      await shot("item-" + gatherer.id + "-gathering");

      await pg.goto(base + "/item.html?id=" + none[0], { waitUntil: "load" });
      await pg.waitForSelector("#where");
      check(/No known source/.test(await pg.textContent("#where")), V + ": an item with no source says No known source");
      await shot("item-" + none[0] + "-none");

      /* the Database search */
      await pg.goto(base + "/database.html?q=" + encodeURIComponent("Diva limited shop"), { waitUntil: "load" });
      await pg.waitForFunction(function () { return /Sources/.test((document.getElementById("db-results") || {}).textContent || ""); }, null, { timeout: 15000 }).catch(function () {});
      const hit = await pg.$$eval("#db-results a", function (a) { return a.map(function (x) { return x.getAttribute("href"); }); });
      check(hit.indexOf("/source.html?id=diva-limited-shop") !== -1, V + ": the Database search finds the Diva limited shop");
      await shot("database-search");

      check(errors.length === 0, V + ": no script errors: " + errors.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async function () {
  let chromium = null;
  try { chromium = require("playwright").chromium; } catch (e) { console.log("Playwright not found: set NODE_PATH"); process.exit(1); }
  await run(chromium);
  if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
  console.log("source pages OK");
})();
