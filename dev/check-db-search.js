#!/usr/bin/env node
/* Checks the Database page (database.html, js/database.js) and the site search (js/search.js), which share one
   search engine (window.HvSearch):
   - data/search/ is what dev/make-search-index.py writes (--check), and the counts on the page's tiles are the
     data's (data/monsters/index.json, data/quests.json, data/items/index.json without id 0, data/weapons/*.json);
   - in headless Chromium at 375, 768 and 1280 px, with the API blocked: the crumbs read Home › Database; a search
     shows results grouped as Monsters, Quests, Items, Weapons, each hit linking its page (monster.html?m=,
     quest.html?id=, item.html?id=, weapons.html?type=&w=); a quest id finds that quest first; the query and the
     kind chip live in the address (?q=, ?kind=) and a reload restores them; the Quests chip shows up to 50 quests;
     Down from the box moves into the results, Up from the first goes back, Enter in the box opens the first hit;
     no match says so; one index failing shows "could not be loaded" with Try again, which works; nothing loads
     data/quests.json, data/quest-details.json or a weapon type file; hits are 44px tall at least on touch screens;
     no sideways scrolling, no script errors;
   - another page's breadcrumb links "Database" to /database.html, and the header search (Ctrl+K) lists quests and
     weapons too, from the site's own indexes with the API not answering.
   SHOTS=<folder> also saves the page (empty and with results) and the open menu at each width.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-db-search.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (file.endsWith(path.sep)) file += "index.html";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

function staticChecks() {
  const index = childProcess.spawnSync("python3", [path.join(root, "dev/make-search-index.py"), "--check"], { encoding: "utf8" });
  check(index.status === 0, (index.stdout || index.stderr || "dev/make-search-index.py --check failed").trim());
  const counts = {
    monsters: json("data/monsters/index.json").length,
    quests: json("data/quests.json").quests.length,
    items: json("data/items/index.json").items.filter((r) => r[0] > 0).length,
    weapons: json("data/weapons/index.json").types.reduce((n, t) => {
      const file = path.join(root, "data/weapons", t.slug + ".json");
      return n + (fs.existsSync(file) ? json("data/weapons/" + t.slug + ".json").weapons.length : 0);
    }, 0)
  };
  const page = fs.readFileSync(path.join(root, "database.html"), "utf8");
  for (const [kind, n] of Object.entries(counts)) {
    const m = new RegExp('data-db-count="' + kind + '">([\\d,]+)<').exec(page);
    check(m && Number(m[1].replace(/,/g, "")) === n,
      "database.html: the " + kind + " tile says " + (m ? m[1] : "nothing") + ", the data has " + n.toLocaleString("en-US"));
  }
}

async function main() {
  staticChecks();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const width of [1280, 768, 375]) {
    const tag = width + " px";
    const touch = width < 800;
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    let failQuests = false;
    const big = [];
    await context.route("**/*", (r) => {
      const url = r.request().url();
      if (!url.startsWith(base)) return r.abort();
      if (/\/data\/quests\.json|\/data\/quest-details\.json|\/data\/weapons\/(?!index)[a-z-]+\.json/.test(url)) big.push(url.slice(base.length));
      if (failQuests && /\/data\/search\/quests\.json/.test(url)) return r.abort();
      return r.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    const params = () => new URL(page.url()).searchParams;
    const groups = () => page.$$eval("#db-results .db-group", (gs) => gs.map((g) => ({
      label: g.getAttribute("aria-label"), n: (g.querySelector(".db-group-n") || {}).textContent || "",
      hrefs: Array.from(g.querySelectorAll(".db-hit")).map((a) => a.getAttribute("href")),
      titles: Array.from(g.querySelectorAll(".db-hit-title")).map((a) => a.textContent) })));
    const search = async (q) => {
      await page.fill("#db-search", q);
      await page.waitForFunction((v) => new URLSearchParams(location.search).get("q") === v
        && !/Searching|Loading/.test(document.getElementById("db-results").textContent + document.getElementById("db-status").textContent), q);
    };

    await page.goto(base + "/database.html", { waitUntil: "load" });
    check(await page.$eval(".breadcrumbs ol", (o) => o.textContent) === "HomeDatabase"
      && await page.$eval(".breadcrumbs li:last-child", (li) => li.getAttribute("aria-current")) === "page", tag + ": crumbs are Home › Database");
    check(await page.$eval("#db-results", (r) => r.children.length) === 0 && await page.textContent("#db-status") === "", tag + ": empty box, no results");
    if (shots) await page.screenshot({ path: path.join(shots, "database-" + width + ".png"), fullPage: true });

    await search("rathalos");
    let got = await groups();
    check(got.map((g) => g.label).join() === "Monsters,Quests,Items,Weapons" || got.map((g) => g.label).join() === "Monsters,Quests,Items",
      tag + ": rathalos: groups " + got.map((g) => g.label).join());
    const mon = got.find((g) => g.label === "Monsters"), quests = got.find((g) => g.label === "Quests"), items = got.find((g) => g.label === "Items");
    check(mon && mon.titles[0] === "Rathalos" && mon.hrefs[0] === "/monster.html?m=rathalos", tag + ": rathalos: first monster " + (mon && mon.hrefs[0]));
    check(quests && quests.hrefs.length === 6 && quests.hrefs.every((h) => /^\/quest\.html\?id=\d+$/.test(h)), tag + ": rathalos: six quest hits linking quest.html?id=");
    check(items && items.hrefs.every((h) => /^\/item\.html\?id=\d+$/.test(h)), tag + ": rathalos: item hits link item.html?id=");
    check(/^[\d,]+ results for “rathalos”\.$/.test(await page.textContent("#db-status")), tag + ": status line: " + await page.textContent("#db-status"));
    if (touch) {
      const low = await page.$$eval(".db-hit", (as) => as.filter((a) => a.getBoundingClientRect().height < 44).length);
      check(low === 0, tag + ": " + low + " result links under 44px tall");
    }
    if (shots) await page.screenshot({ path: path.join(shots, "database-search-" + width + ".png"), fullPage: true });

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("#db-results .db-hit").length > 6 && !/Loading/.test(document.getElementById("db-results").textContent));
    check(await page.inputValue("#db-search") === "rathalos", tag + ": a reload restores the search");

    // keys
    await page.focus("#db-search");
    await page.keyboard.press("ArrowDown");
    check(await page.evaluate(() => document.activeElement === document.querySelector(".db-hit")), tag + ": Down moves into the results");
    await page.keyboard.press("ArrowDown");
    check(await page.evaluate(() => document.activeElement === document.querySelectorAll(".db-hit")[1]), tag + ": Down moves to the next result");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    check(await page.evaluate(() => document.activeElement.id === "db-search"), tag + ": Up from the first result goes back to the box");

    // one kind
    await page.click('#db-kinds .chip[data-kind="quests"]');
    await page.waitForFunction(() => /kind=quests/.test(location.search));
    got = await groups();
    check(got.length === 1 && got[0].label === "Quests" && got[0].hrefs.length > 6 && got[0].hrefs.length <= 50, tag + ": the Quests chip shows only quests, up to 50");
    check(await page.getAttribute('#db-kinds .chip[data-kind="quests"]', "aria-pressed") === "true", tag + ": the Quests chip is pressed");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("#db-results .db-group").length === 1 && document.querySelectorAll(".db-hit").length > 6);
    check(params().get("kind") === "quests" && await page.getAttribute('#db-kinds .chip[data-kind="quests"]', "aria-pressed") === "true", tag + ": a reload keeps the kind");
    await page.click('#db-kinds .chip[data-kind=""]');
    await page.waitForFunction(() => !/kind=/.test(location.search));

    // a quest by id, a weapon by name
    const firstQuest = json("data/search/quests.json").quests.find((q) => q[0] >= 10000 && q[1]);
    await search(String(firstQuest[0]));
    got = await groups();
    const byId = got.find((g) => g.label === "Quests");
    check(byId && byId.hrefs[0] === "/quest.html?id=" + firstQuest[0], tag + ": a quest id finds that quest first: " + (byId && byId.hrefs[0]));
    await search("iron sword");
    got = await groups();
    const weapons = got.find((g) => g.label === "Weapons");
    check(weapons && weapons.hrefs.length > 0 && weapons.hrefs.every((h) => /^\/weapons\.html\?type=[a-z-]+&w=\d+$/.test(h))
      && /iron sword/i.test(weapons.titles[0]), tag + ": iron sword: weapon hits " + (weapons ? weapons.hrefs[0] + " " + weapons.titles[0] : "none"));

    await search("zzzqqqxx");
    check(/^Nothing matches “zzzqqqxx”\./.test(await page.textContent("#db-status")) && (await groups()).length === 0, tag + ": no match says so");

    // Enter opens the first hit
    await search("rathalos");
    const first = await page.$eval(".db-hit", (a) => a.href);
    await page.focus("#db-search");
    await Promise.all([page.waitForURL(first), page.keyboard.press("Enter")]);
    check(page.url() === first, tag + ": Enter opens the first result");
    if (width === 1280) {
      check(await page.$eval('.breadcrumbs a[href="/database.html"]', (a) => a.textContent).catch(() => null) === "Database",
        "monster.html: the Database crumb links /database.html");
    }

    // an index failing
    failQuests = true;
    await page.goto(base + "/database.html?q=rathalos", { waitUntil: "load" });
    await page.waitForFunction(() => /could not be loaded/.test(document.getElementById("db-results").textContent));
    check((await page.$$('#db-results .db-group[aria-label="Quests"] button')).length === 1, tag + ": a failed index shows Try again");
    failQuests = false;
    await page.click('#db-results .db-group[aria-label="Quests"] button');
    await page.waitForFunction(() => document.querySelectorAll('#db-results .db-group[aria-label="Quests"] .db-hit').length > 0);

    check(big.length === 0, tag + ": big files loaded: " + big.join(" "));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tag + ": the page scrolls sideways");

    // the header search on another page
    await page.goto(base + "/worlds.html", { waitUntil: "load" });
    await page.waitForSelector(".nav-search", { state: "attached" });
    await page.keyboard.press("Control+k");
    await page.fill(".cmdk-input", "rathalos");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".cmdk-group")).some((g) => g.textContent === "Quests"));
    const cmdk = await page.$$eval(".cmdk-group", (gs) => gs.map((g) => g.textContent));
    check(cmdk.slice(0, 3).join() === "Monsters,Quests,Items", tag + ": header search groups for rathalos: " + cmdk.join());
    check(await page.$eval(".cmdk-item", (a) => a.getAttribute("href")) === "/monster.html?m=rathalos", tag + ": header search: Rathalos first");
    await page.fill(".cmdk-input", "iron sword");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".cmdk-group")).some((g) => g.textContent === "Weapons"));
    check(await page.$$eval(".cmdk-item", (as) => as.some((a) => /^\/weapons\.html\?type=/.test(a.getAttribute("href")))), tag + ": header search lists weapons");
    await page.keyboard.press("Escape");
    check(big.length === 0, tag + ": header search loaded big files: " + big.join(" "));

    // the open menu, for the screenshots
    if (shots) {
      await page.goto(base + "/database.html", { waitUntil: "load" });
      await page.waitForTimeout(300);
      if (await page.isVisible(".nav-toggle")) {
        await page.click(".nav-toggle");
      } else {
        await page.click('.nav-group-toggle[aria-controls="nav-database"]');
      }
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shots, "menu-" + width + ".png") });
      if (!(await page.isVisible(".nav-toggle"))) {
        await page.click('.nav-group-toggle[aria-controls="nav-tools"]');
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(shots, "menu-tools-" + width + ".png") });
      }
    }
    check(errors.length === 0, tag + ": script errors: " + errors.join(" | "));
    await context.close();
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("FAIL\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("db search OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
