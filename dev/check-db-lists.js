#!/usr/bin/env node
/* Checks the state-in-the-address behaviour of the database lists in headless Chromium, at 375x667 (a phone)
   and 1280x800, with the real data files and every request that leaves the machine aborted (so the hunt-count
   API never answers):
   - quests.html: search, Rank and page are written to the address (replaceState) and a reload restores them;
     "Clear filters" shows only while something is set and resets the list and the address; ?monster=Rathalos
     still filters, an unknown ?monster= becomes a search; Next scrolls the table into view; the count is
     aria-live; on a phone the filters sit two to a row and the monster icons are 40px (css/styles.css).
     Sort (?sort=name|id|area, default left out): name order with "？？？？？" names last, lowest id first, a bad
     ?sort= ignored, Clear filters keeps the sort.
   - quest.html: opened from a filtered list its back link and its "Quests" crumb keep that list's query; opened
     with no referrer they go to plain /quests.html; a failed rewards file says so.
   - monsters.html: search also finds a server name; species, size, sort and q are in the address and survive
     a reload; ?q= still works; with the API aborted no card says "0 on the server".
   - monster.html: a hash change (#drops, #attacks) switches the tab, a tab click adds no history entry; the rank
     chip is in the link (?rank=low-rank picks Low rank, a click writes ?rank=, the highest rank drops it).
   - sticky first column (class sticky-first, css/styles.css): on the phone the quest list's and the hitzone
     table's first cells are position: sticky and stay at the table's left edge when it is swiped; on the
     desktop they are static (no layout change).
   - no page scrolls sideways, no uncaught page error.
   Needs Playwright with Chromium, which the site itself does not use:

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-db-lists.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const sizes = [[375, 667, true], [1280, 800, false]];
const index = JSON.parse(fs.readFileSync(path.join(root, "data/monsters/index.json"), "utf8"));
const named = index.find((m) => (m.serverNames || []).some((n) => n.toLowerCase() !== m.name.toLowerCase()));

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

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  for (const [w, h, phone] of sizes) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const open = async (url, tag, options) => {
      const page = await context.newPage();
      page.on("pageerror", (e) => check(false, `${tag}: page error: ${e.message}`));
      await page.goto(base + url, Object.assign({ waitUntil: "load" }, options || {}));
      return page;
    };
    const sideways = async (page, tag) =>
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: page scrolls sideways`);
    const rows = (page) => page.$$eval("#quest-body tr", (trs) => trs.filter((tr) => tr.querySelector("td a")).length);
    const pageText = (page) => page.textContent("#quest-page");
    const settle = (page) => page.waitForFunction(() => /Page \d+ of/.test((document.getElementById("quest-page") || {}).textContent || ""));
    const query = (page) => page.evaluate(() => location.search);
    // The first cell of a table's first body row: sticky on the phone and still at the wrap's left edge after
    // a sideways swipe; static on the desktop.
    const stickyFirst = async (page, table, tag) => {
      const r = await page.$eval(table, (t) => {
        const wrap = t.closest(".table-wrap");
        const cell = t.tBodies[0].rows[0].cells[0];
        const pos = getComputedStyle(cell).position;
        wrap.scrollLeft = 120;
        const scrolled = wrap.scrollLeft;
        const gap = cell.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
        wrap.scrollLeft = 0;
        return { pos, scrolled, gap };
      });
      if (phone) check(r.pos === "sticky" && (r.scrolled === 0 || Math.abs(r.gap) < 3), `${tag}: first column not sticky (${r.pos}, swiped ${r.scrolled}px, ${r.gap}px off)`);
      else check(r.pos === "static", `${tag}: first column is ${r.pos} on the desktop`);
    };

    // ---- quests.html
    let tag = `${w}px quests`;
    let page = await open("/quests.html", tag);
    await settle(page);
    check(await page.getAttribute("#quest-page", "aria-live") === "polite", `${tag}: the count is not aria-live`);
    check(await page.$eval("#quest-clear", (b) => b.hidden), `${tag}: Clear filters shows with nothing set`);
    check((await query(page)) === "", `${tag}: the bare list has a query: ${await query(page)}`);
    await page.selectOption("#quest-rank", "Supremacy");
    await page.fill("#quest-search", "a");
    await page.waitForFunction(() => location.search.includes("q=a"));
    check((await query(page)).includes("rank=Supremacy"), `${tag}: rank not in the address: ${await query(page)}`);
    check(!(await page.$eval("#quest-clear", (b) => b.hidden)), `${tag}: Clear filters hidden with a filter set`);
    check(/Page 1 of ([2-9]|\d\d)/.test(await pageText(page)), `${tag}: expected several pages: ${await pageText(page)}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.click("#quest-next");
    check((await query(page)).includes("page=2"), `${tag}: page 2 not in the address: ${await query(page)}`);
    // the page may scroll smoothly: wait until it has stopped (3 s at most)
    await page.waitForTimeout(300);
    for (let i = 0, last = -1; i < 18; i++) {
      const y = await page.evaluate(() => scrollY);
      if (y === last) break;
      last = y;
      await page.waitForTimeout(150);
    }
    const top = await page.$eval(".quest-table", (t) => t.getBoundingClientRect().top);
    check(top > -2 && top < 300, `${tag}: after Next the table top is at ${Math.round(top)}px`);
    const firstName = await page.$eval("#quest-body td a", (a) => a.textContent);
    const search = await query(page);
    await page.reload({ waitUntil: "load" });
    await settle(page);
    check((await query(page)) === search, `${tag}: reload changed the address: ${await query(page)}`);
    check(await page.inputValue("#quest-rank") === "Supremacy" && await page.inputValue("#quest-search") === "a", `${tag}: reload lost the rank or search`);
    check(/Page 2 of/.test(await pageText(page)), `${tag}: reload lost the page: ${await pageText(page)}`);
    check(await page.$eval("#quest-body td a", (a) => a.textContent) === firstName, `${tag}: reload shows other quests`);
    await sideways(page, tag);

    // the quest page, opened from this list
    const href = await page.$eval("#quest-body td a", (a) => a.getAttribute("href"));
    await page.click("#quest-body td a");
    await page.waitForFunction(() => document.querySelector("#quest-view .page-head h1"));
    const back = await page.waitForSelector("a:text('Back to the quest catalog')");
    check(await back.getAttribute("href") === "/quests.html" + search, `${tag}: back link is ${await back.getAttribute("href")}, not the list's ${search}`);
    check(await page.$eval("nav.breadcrumbs a[href^='/quests.html']", (a) => a.getAttribute("href")) === "/quests.html" + search, `${tag}: the Quests crumb does not keep the list`);
    await sideways(page, `${tag} / quest page`);
    await page.close();

    // no referrer: plain list; a rewards file that fails says so
    const quest = await open(href, `${tag} / quest`);
    await quest.waitForSelector("a:text('Back to the quest catalog')");
    check(await quest.$eval("a:text('Back to the quest catalog')", (a) => a.getAttribute("href")) === "/quests.html", `${tag}: back link without a referrer is not plain`);
    await quest.close();
    await context.route("**/data/quests/rewards/*", (r) => r.fulfill({ status: 500, body: "" }));
    const failed = await open(href, `${tag} / quest, rewards fail`);
    await failed.waitForFunction(() => /could not be loaded|No reward/.test((document.getElementById("rewards") || {}).textContent || ""));
    check(/rewards could not be loaded/.test(await failed.textContent("#rewards")), `${tag}: a failed rewards file does not say so`);
    await failed.close();
    await context.unroute("**/data/quests/rewards/*");

    // Clear filters
    page = await open("/quests.html?rank=Supremacy&area=zzz&page=2&q=a", tag);
    await settle(page);
    check(await page.inputValue("#quest-area") === "", `${tag}: an unknown area was taken`);
    await page.click("#quest-clear");
    check((await query(page)) === "", `${tag}: Clear filters left ${await query(page)}`);
    check(await page.inputValue("#quest-rank") === "" && await page.inputValue("#quest-search") === "", `${tag}: Clear filters left a control set`);
    check(await page.$eval("#quest-clear", (b) => b.hidden), `${tag}: Clear filters still shown after clearing`);
    check(/Page 1 of/.test(await pageText(page)), `${tag}: not on page 1 after clearing`);
    const all = await rows(page);

    // the existing links
    await page.goto(base + "/quests.html?monster=Rathalos", { waitUntil: "load" });
    await settle(page);
    check(await page.inputValue("#quest-monster") === "Rathalos", `${tag}: ?monster=Rathalos did not set the Monster filter`);
    check(await rows(page) > 0 && /^Page 1 of \d+ · [\d,]+ quests/.test(await pageText(page)), `${tag}: ?monster=Rathalos shows no quests`);
    check((await query(page)) === "?monster=Rathalos", `${tag}: ?monster=Rathalos rewritten to ${await query(page)}`);
    await page.goto(base + "/quests.html?monster=Zzzznotamonster", { waitUntil: "load" });
    await settle(page);
    check(await page.inputValue("#quest-search") === "Zzzznotamonster" && await rows(page) === 0, `${tag}: an unknown ?monster= is not a text search with no match`);
    check(await page.$("#quest-body .empty-cell") !== null, `${tag}: no empty message for an unknown monster`);
    await page.goto(base + "/quests.html?q=Rathalos", { waitUntil: "load" });
    await settle(page);
    check(await rows(page) > 0 && all > 0, `${tag}: ?q=Rathalos shows no quests`);
    await stickyFirst(page, ".quest-table", tag);

    // sort
    const names = () => page.$$eval("#quest-body td.cell-name a", (a) => a.map((e) => e.textContent));
    const ids = () => page.$$eval("#quest-body td.cell-name .cell-sub", (a) => a.map((e) => Number(e.textContent.match(/#(\d+)/)[1])));
    await page.goto(base + "/quests.html?sort=name", { waitUntil: "load" });
    await settle(page);
    check(await page.inputValue("#quest-sort") === "name", `${tag}: ?sort=name did not set Sort`);
    const byName = await names();
    check(byName.length > 1 && byName.every((n, i) => i === 0 || byName[i - 1].localeCompare(n) <= 0) && /[A-Za-z0-9]/.test(byName[0]),
      `${tag}: ?sort=name is not in name order: ${byName.slice(0, 3)}`);
    await page.click("#quest-next");
    await page.goto(base + "/quests.html?sort=name&page=" + Math.ceil(9152 / 40), { waitUntil: "load" });
    await settle(page);
    check((await names()).some((n) => !/[A-Za-z0-9]/.test(n)), `${tag}: the "？？？？？" names are not at the end of the name order`);
    await page.selectOption("#quest-sort", "id");
    check((await query(page)) === "?sort=id", `${tag}: picking Id wrote ${await query(page)}`);
    const byId = await ids();
    check(byId.every((n, i) => i === 0 || byId[i - 1] < n), `${tag}: Id, lowest first is not ascending`);
    await page.fill("#quest-search", "rath");
    await page.waitForFunction(() => location.search.includes("q=rath"));
    await page.click("#quest-clear");
    check((await query(page)) === "?sort=id" && await page.inputValue("#quest-sort") === "id", `${tag}: Clear filters dropped the sort: ${await query(page)}`);
    await page.selectOption("#quest-sort", "");
    check((await query(page)) === "", `${tag}: the default sort stays in the address: ${await query(page)}`);
    await page.goto(base + "/quests.html?sort=bogus", { waitUntil: "load" });
    await settle(page);
    check(await page.inputValue("#quest-sort") === "" && (await ids())[0] === 64554, `${tag}: a bad ?sort= is not ignored`);
    if (phone) {
      const layout = await page.evaluate(() => {
        const sel = [...document.querySelectorAll(".quest-filters select")].map((s) => s.getBoundingClientRect());
        const chip = document.querySelector(".monster-chip");
        const c = chip && chip.getBoundingClientRect();
        return { sameRow: Math.abs(sel[0].top - sel[1].top) < 4, w: c && c.width, h: c && c.height, coarse: matchMedia("(pointer: coarse)").matches };
      });
      check(layout.sameRow, `${tag}: the first two filters are not on one row`);
      check(!layout.coarse || (layout.w >= 39.5 && layout.h >= 39.5), `${tag}: monster icon links are ${layout.w}x${layout.h}`);
    }
    await sideways(page, tag);
    await page.close();

    // ---- monsters.html
    tag = `${w}px monsters`;
    page = await open("/monsters.html", tag);
    await page.waitForSelector("#monsters .monster-tile");
    await page.waitForTimeout(300);
    check(await page.getAttribute("#monster-results", "aria-live") === "polite", `${tag}: the count is not aria-live`);
    const stats = await page.$$eval(".tile-stat-line", (l) => l.map((e) => e.textContent));
    check(stats.length > 0 && stats.every((t) => /^-\s*on the server$/.test(t)), `${tag}: with the API aborted a card says ${stats.find((t) => !/^-/.test(t))}`);
    check((await query(page)) === "", `${tag}: the bare list has a query`);
    if (named) {
      const serverName = named.serverNames.find((n) => n.toLowerCase() !== named.name.toLowerCase());
      await page.fill("#monster-search", serverName);
      const names = await page.$$eval("#monsters .monster-name", (n) => n.map((e) => e.textContent));
      check(names.includes(named.name), `${tag}: searching the server name "${serverName}" does not find ${named.name}`);
    }
    await page.fill("#monster-search", "");
    const species = await page.$$eval("#monster-category option", (o) => o.map((e) => e.value).filter(Boolean));
    await page.selectOption("#monster-category", species[0]);
    await page.selectOption("#monster-size", "large");
    await page.selectOption("#monster-sort", "kills");
    const mq = await query(page);
    check(/species=/.test(mq) && /size=large/.test(mq) && /sort=kills/.test(mq), `${tag}: state not in the address: ${mq}`);
    const count = await page.textContent("#monster-results");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#monsters .monster-tile");
    check((await query(page)) === mq, `${tag}: reload changed the address: ${await query(page)}`);
    check(await page.inputValue("#monster-category") === species[0] && await page.inputValue("#monster-size") === "large" && await page.inputValue("#monster-sort") === "kills", `${tag}: reload lost a control`);
    check(await page.textContent("#monster-results") === count, `${tag}: reload shows another list`);
    await page.goto(base + "/monsters.html?q=rath", { waitUntil: "load" });
    await page.waitForSelector("#monsters .monster-tile");
    check(await page.inputValue("#monster-search") === "rath" && (await page.$$("#monsters .monster-tile")).length > 0, `${tag}: ?q=rath does not search`);
    await sideways(page, tag);
    await page.close();

    // ---- monster.html
    tag = `${w}px monster`;
    page = await open("/monster.html?m=rathalos", tag);
    await page.waitForSelector(".mg-tabs .tab");
    const tabNow = () => page.$eval(".mg-tabs .tab[aria-selected=true]", (t) => t.dataset.tab);
    check(await tabNow() === "hitzones", `${tag}: the first tab is ${await tabNow()}`);
    const before = await page.evaluate(() => history.length);
    await page.click(".mg-tabs .tab[data-tab=status]");
    check(await tabNow() === "status" && (await page.evaluate(() => location.hash)) === "#status", `${tag}: a tab click did not set the hash`);
    check(await page.evaluate(() => history.length) === before, `${tag}: a tab click added a history entry`);
    await page.evaluate(() => { location.hash = "#drops"; });
    await page.waitForFunction(() => document.querySelector(".mg-tabs .tab[aria-selected=true]").dataset.tab === "drops");
    await page.evaluate(() => { location.hash = "#attacks"; });
    await page.waitForFunction(() => document.querySelector(".mg-tabs .tab[aria-selected=true]").dataset.tab === "attacks");
    await page.goBack();
    await page.waitForFunction(() => document.querySelector(".mg-tabs .tab[aria-selected=true]").dataset.tab === "drops");
    check(await page.evaluate(() => !!document.querySelector("#game-data .drop-list")), `${tag}: the Drops tab shows no carve list`);
    await sideways(page, tag);
    await page.close();

    // the rank chip in the link
    page = await open("/monster.html?m=rathian&rank=low-rank#hitzones", tag);
    await page.waitForSelector(".mg-ranks .chip");
    const pressed = () => page.$eval(".mg-ranks .chip[aria-pressed=true]", (c) => c.textContent);
    check(await pressed() === "Low rank", `${tag}: ?rank=low-rank picked ${await pressed()}`);
    await stickyFirst(page, ".hitzone-table", `${tag} hitzones`);
    await page.click(".mg-ranks .chip:nth-child(2)");
    check((await query(page)) === "?m=rathian&rank=high-rank" && (await page.evaluate(() => location.hash)) === "#hitzones",
      `${tag}: a rank click wrote ${await query(page)}${await page.evaluate(() => location.hash)}`);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".mg-ranks .chip");
    check(await pressed() === "High rank", `${tag}: a reload lost the rank (${await pressed()})`);
    await page.click(".mg-ranks .chip:last-child");
    check((await query(page)) === "?m=rathian", `${tag}: the highest rank stays in the address: ${await query(page)}`);
    await page.goto(base + "/monster.html?m=rathian&rank=nonsense", { waitUntil: "load" });
    await page.waitForSelector(".mg-ranks .chip");
    check(await page.$eval(".mg-ranks .chip:last-child", (c) => c.getAttribute("aria-pressed")) === "true", `${tag}: a bad ?rank= does not fall back to the highest rank`);
    await page.close();
    await context.close();
  }
  await browser.close();
  server.close();
}

main().then(() => {
  if (problems.length) { console.log(problems.join("\n")); console.log(problems.length + " problem(s)"); process.exit(1); }
  console.log("database lists OK");
}, (err) => { console.error(err); server.close(); process.exit(1); });
