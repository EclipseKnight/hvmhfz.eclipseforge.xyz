#!/usr/bin/env node
/* Checks the Items page (items.html, js/catalog.js; called Catalog until 2026-11-11) in headless Chromium at 375 and
   1280 px: the page is titled Items; the old address /catalog.html (js/page-moved.js) forwards to /items.html with its
   query and #anchor, and says noindex with a meta refresh to /items.html for a browser without JavaScript; the paged
   table has no sort headers (a sort would only reorder one page); the section, the search and the page live in
   the address (?slot=, ?q=, ?page=, defaults left out) and a reload restores them; ?q= alone still opens the
   catalog searching; a bad ?slot= or ?page= is ignored; with data/items/index.json failing the table shows an
   error row with a Try again button that works once the file answers; the results count is a polite live
   region; with a stubbed equipment answer, melee and ranged rows link to the weapon on the Weapons page
   (weapons.html?type=<slug>&w=<game id>, from data/weapons/ids.json; the API's id byte-swapped) and an id with
   no weapon ("Dummy") stays plain text; armour rows link to equipment.html?slot=&id= when
   data/equipment/<slot>/names.json names the piece; on the phone the icon and name columns are sticky (the name at the icon
   column's right edge, still there after a sideways swipe), on the desktop they are static; no sideways
   scrolling and no script errors. Needs Playwright with Chromium:

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-db-catalog.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
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

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  for (const width of [1280, 375]) {
    const tag = width + " px";
    const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 800 });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    let itemsFail = false;
    let equipment = null; // a stubbed /api/public/catalog/equipment answer, else the API is blocked
    await context.route("**/*", (r) => {
      const url = r.request().url();
      if (equipment && /\/api\/public\/catalog\/equipment\?/.test(url)) {
        return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(equipment(new URL(url).searchParams.get("slot"))) });
      }
      if (!url.startsWith(base)) return r.abort();
      if (itemsFail && /\/data\/items\/index\.json/.test(url)) return r.abort();
      return r.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    const params = () => new URL(page.url()).searchParams;
    const rowsShown = () => page.$$eval("#catalog-body tr", (t) => t.length);
    const open = async (query) => {
      await page.goto(base + "/items.html" + query, { waitUntil: "load" });
      await page.waitForSelector("#catalog-body a, #catalog-body .no-results, #catalog-body .empty-cell");
    };

    // The old address forwards, query and anchor kept.
    await page.goto(base + "/catalog.html?slot=melee&q=potion#top", { waitUntil: "load" });
    await page.waitForURL(/\/items\.html/);
    check(page.url() === base + "/items.html?slot=melee&q=potion#top", tag + ": /catalog.html forwards to " + page.url());
    if (width === 1280) {
      const moved = fs.readFileSync(path.join(root, "catalog.html"), "utf8");
      check(/<meta name="robots" content="noindex" \/>/.test(moved) && /<meta http-equiv="refresh" content="0; url=\/items\.html" \/>/.test(moved),
        "catalog.html: noindex and a meta refresh to /items.html");
    }

    await open("");
    check((await page.title()) === "Items · Hunsterverse" && (await page.textContent("h1")) === "Items", tag + ": the page is called Items");
    check((await rowsShown()) === 30, tag + ": first page lists 30 items");
    check(await page.$$eval(".data-table thead th", (ths) => ths.every((th) => th.getAttribute("role") !== "button" && !th.hasAttribute("aria-sort"))),
      tag + ": the header cells are not sort buttons");
    const before = await page.$$eval("#catalog-body tr td:nth-child(2)", (t) => t.map((c) => c.textContent).join());
    await page.click("thead th:nth-child(3)");
    await page.waitForTimeout(150);
    check(before === await page.$$eval("#catalog-body tr td:nth-child(2)", (t) => t.map((c) => c.textContent).join()), tag + ": a header click does not reorder the page");
    check((await page.getAttribute("#catalog-results", "aria-live")) === "polite", tag + ": the results count is a polite live region");
    check(page.url() === base + "/items.html", tag + ": no state in the address by default: " + page.url());

    await page.click("#catalog-next");
    check(params().get("page") === "2" && !params().has("slot") && !params().has("q"), tag + ": page 2 writes ?page=2: " + page.url());
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#catalog-body a");
    check(/^Page 2 of/.test(await page.textContent("#catalog-page-note")), tag + ": a reload restores page 2");
    await page.click("#catalog-prev");
    check(!params().has("page"), tag + ": back on page 1 drops ?page");

    await page.fill("#catalog-search", "potion");
    await page.waitForFunction(() => /q=potion/.test(location.search));
    check(!params().has("page"), tag + ": a search starts at page 1");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#catalog-body a");
    check((await page.inputValue("#catalog-search")) === "potion" && /entr/.test(await page.textContent("#catalog-results")), tag + ": a reload restores the search");

    await page.click('#catalog-slots .chip[data-slot="melee"]');
    await page.waitForFunction(() => /slot=melee/.test(location.search));
    check(params().get("q") === "potion", tag + ": the search stays when the section changes: " + page.url());
    // The API is blocked here, so the equipment sections show the error row; the chip must still be restored on reload.
    await page.waitForSelector("#catalog-body .no-results");
    check((await page.$$("#catalog-body .no-results .ghost-btn")).length === 1, tag + ": a failed equipment load shows an error row with Try again");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#catalog-body .no-results");
    check((await page.getAttribute('#catalog-slots .chip[data-slot="melee"]', "aria-pressed")) === "true"
      && (await page.getAttribute('#catalog-slots .chip[data-slot="items"]', "aria-pressed")) === "false", tag + ": a reload restores the section chip");
    await page.click('#catalog-slots .chip[data-slot="items"]');
    await page.waitForFunction(() => !/slot=/.test(location.search));
    check(params().get("q") === "potion", tag + ": the default section is left out of the address: " + page.url());

    await open("?q=sword");
    check((await page.inputValue("#catalog-search")) === "sword" && (await rowsShown()) > 0 && await page.$("#catalog-body a") !== null, tag + ": ?q= alone opens the Items page searching");
    await open("?slot=nonsense&page=abc");
    check((await rowsShown()) === 30 && (await page.getAttribute('#catalog-slots .chip[data-slot="items"]', "aria-pressed")) === "true", tag + ": a bad ?slot= and ?page= are ignored");
    await open("?page=99999");
    await page.waitForFunction(() => /^Page \d+ of/.test(document.getElementById("catalog-page-note").textContent));
    check((await rowsShown()) > 0 && await page.$("#catalog-body a") !== null, tag + ": a page past the end lands on the last page");
    await open("?q=zzzzzzqqq");
    check(/Nothing matches/.test(await page.textContent("#catalog-body")), tag + ": a search with no match says so");

    itemsFail = true;
    await page.goto(base + "/items.html", { waitUntil: "load" });
    await page.waitForSelector("#catalog-body .no-results");
    check(/could not be loaded/.test(await page.textContent("#catalog-body")) && (await page.$$("#catalog-body .no-results button")).length === 1,
      tag + ": data/items/index.json failing shows an error row with Try again");
    itemsFail = false;
    await page.click("#catalog-body .no-results button");
    await page.waitForSelector("#catalog-body a");
    check((await rowsShown()) === 30, tag + ": Try again loads the list");

    // Equipment rows link to the Weapons page. 0100 = game id 1 (Iron Sword, Great Sword), 7D04 = 1149 (a Heavy
    // Bowgun), 1808 = 2072 (a Bow); FFFF has no weapon.
    equipment = (slot) => ({ page: 0, size: 30, total: 3, items: slot === "melee"
      ? [{ id: "0100", name: "Iron Sword", slot: "melee" }, { id: "FFFF", name: "Dummy", slot: "melee" }, { id: "0200", name: "Iron Sword α", slot: "melee" }]
      : [{ id: "7D04", name: "2nd Type Heavy Bowgun", slot: "ranged" }, { id: "1808", name: "Adret Wreath Bow", slot: "ranged" }, { id: "FFFF", name: "Dummy", slot: "ranged" }] });
    const links = () => page.$$eval("#catalog-body tr", (t) => t.map((r) => { const a = r.cells[2].querySelector("a"); return a ? a.getAttribute("href") : null; }));
    await open("?slot=melee");
    let got = await links();
    check(got[0] === "/weapons.html?type=great-sword&w=1" && got[1] === null && got[2] === "/weapons.html?type=great-sword&w=2",
      tag + ": melee rows link to the weapon: " + got.join(" "));
    await open("?slot=ranged");
    got = await links();
    check(got[0] === "/weapons.html?type=heavy-bowgun&w=1149" && got[1] === "/weapons.html?type=bow&w=2072" && got[2] === null,
      tag + ": ranged rows link to the weapon: " + got.join(" "));
    // Armour rows link to the equipment page when a recipe names the piece (data/equipment/head/names.json):
    // 0100 = head 1 (Leather Helm); FFFF has none.
    equipment = () => ({ page: 0, size: 30, total: 2, items: [{ id: "0100", name: "Leather Helm", slot: "head" }, { id: "FFFF", name: "Dummy", slot: "head" }] });
    await open("?slot=heads");
    got = await links();
    check(got[0] === "/equipment.html?slot=head&id=1" && got[1] === null, tag + ": armour rows link to the equipment page: " + got.join(" "));
    equipment = null;

    // Sticky icon and name columns on the phone, static on the desktop.
    await open("?q=scale");
    const stick = await page.evaluate(() => {
      const wrap = document.querySelector("#catalog-body").closest(".table-wrap");
      const row = document.querySelector("#catalog-body tr");
      const pos = [0, 2].map((i) => getComputedStyle(row.cells[i]).position);
      const iconRight = row.cells[0].getBoundingClientRect().right;
      wrap.style.maxWidth = "200px"; // force a sideways scroll at any width
      wrap.scrollLeft = 80;
      const swiped = wrap.scrollLeft;
      const gap = row.cells[2].getBoundingClientRect().left - row.cells[0].getBoundingClientRect().right;
      wrap.style.maxWidth = ""; wrap.scrollLeft = 0;
      return { pos, swiped, gap: Math.round(gap), iconRight };
    });
    if (width < 800) check(stick.pos.join() === "sticky,sticky" && stick.swiped > 0 && Math.abs(stick.gap) <= 1,
      tag + ": icon and name columns not sticky together: " + JSON.stringify(stick));
    else check(stick.pos.join() === "static,static", tag + ": sticky columns on the desktop: " + stick.pos);

    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tag + ": the page scrolls sideways");
    check(errors.length === 0, tag + ": script errors: " + errors.join(" | "));
    await context.close();
  }
  await browser.close();
  server.close();
  if (problems.length) { console.log("FAIL\n- " + problems.join("\n- ")); process.exit(1); }
  console.log("db items OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
