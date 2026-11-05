#!/usr/bin/env node
/* Checks the quest builder's Zenith forms (quest-editor.html, js/quest-editor.js) against a fake API in headless
   Chromium, with a made-up model (no game data):
   - the first large-monster list's picker offers "Zenith Rathalos" (Rathalos's icon, #11) for the monsters with a
     Zenith form and no "Zenith Rajang"; a second large-monster list and the small monsters offer none;
   - picking "Zenith Rathalos" saves body.monsterVariants with 16 in Rathalos's slot (the list's distinct monsters,
     first appearance first), and every Rathalos row of that list shows "Zenith Rathalos";
   - removing the row before it moves the 16 to Rathalos's new slot; plain "Rathalos" puts it back to 0;
   - with a Zenith monster the quest gets body.variantFlags3 bit 4 and monster level 64 (Zenith rank 1), and a
     "Zenith rank" picker sets 64 to 67; after the last Zenith monster both go back (level 7, bit 4 off);
   - the review names "Zenith Rathalos"; a model without monsterVariants (an older API) offers no Zenith form;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-zenith.js

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

const obj = () => ({ type: 0, target: 0, count: 0 });
const spawn = (monsterId, areaId) => ({ monsterId, count: 1, areaId });
function area(spawns) { return { areaId: 1, reserved: 0, monsterIdsOffset: 0, spawnOffset: 0, spawns }; }
function model(variants, large) {
  const body = { mapId: 26, questClass: 0, objective0: { type: 1, target: 11, count: 1 }, objective1: obj(), objective2: obj(),
    zenny: 0, rewardMoney: 0, timeLimit: 50 * 1800, maxHunters: 0, iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0, iconLabelCount: 0 };
  if (variants) body.monsterVariants = variants;
  body.variantFlags3 = 1;
  return { layout: "QUEST", length: 0, header: { questClass: 0, monsterLevel: 7 }, raw: [], body,
    map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: "", capacity: c })),
    rewardGroups: [], smallSpawnGroups: [{ groupOffset: 0, areas: [area([spawn(3, 224)])] }],
    largeSpawnAreas: large };
}

const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };

async function open(browser, theModel, saved) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("hvmhfz.token", "x");
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (!/^api\./.test(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/account/quests/maps") return json(200, { maps: [26] });
    if (url.pathname === "/api/account/quests/model") return json(200, theModel);
    if (url.pathname === "/api/account/quest-drafts" && req.method() === "POST") return json(200, { id: 7, revision: 1 });
    if (url.pathname === "/api/account/quest-drafts") return json(200, []);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "PUT") {
      saved.push(JSON.parse(req.postData()).model);
      return json(200, { id: 7, revision: saved.length + 1 });
    }
    return json(404, { message: "Not in the fake API." });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push("page error: " + e.message));
  await page.goto(base + "/quest-editor.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".bui-section");
  return { context, page };
}

/** The monster picker buttons of one spawn table (data-where). */
function monsterButtons(page, where) {
  return page.locator("[data-where='" + where + "'] tbody tr td:first-child button.bui-picker-btn");
}

async function optionsOf(page, where, row) {
  const button = monsterButtons(page, where).nth(row);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForSelector(".bui-pop:not([hidden]) .bui-option");
  return page.evaluate(() => [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].map((r) => ({
    name: r.querySelector(".bui-name").textContent,
    id: ((r.querySelector(".bui-id") || {}).textContent || ""),
    icon: (r.querySelector("img") || {}).src || ""
  })));
}

async function choose(page, name) {
  await page.fill(".bui-pop .bui-search", name);
  await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")]
      .find((r) => r.querySelector(".bui-name").textContent === wanted);
    if (!row) throw new Error("no option " + wanted);
    row.click();
  }, name);
  await page.waitForTimeout(250);
}

const shownNames = (page, where) => monsterButtons(page, where).evaluateAll((bs) => bs.map((b) => b.querySelector(".bui-value").textContent));

async function save(page, saved) {
  const before = saved.length;
  await page.click("#editor-save");
  for (let i = 0; i < 50 && saved.length === before; i++) await page.waitForTimeout(100);
  return saved[saved.length - 1];
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    // Rajang, Rathalos, Rathalos again in the first list; Khezu in a second list.
    const saved = [];
    let { context, page } = await open(browser, model([0, 0, 0, 0, 0],
      [area([spawn(53, 224), spawn(11, 224), spawn(11, 224)]), area([spawn(15, 224)])]), saved);
    const first = await optionsOf(page, "largeSpawnAreas[0]", 1);
    const zr = first.find((o) => o.name === "Zenith Rathalos");
    const rath = first.find((o) => o.name === "Rathalos");
    check(zr && zr.id === "#11", "Zenith Rathalos is offered with #11: " + JSON.stringify(zr));
    check(zr && rath && zr.icon && zr.icon === rath.icon, "Zenith Rathalos has Rathalos's icon");
    check(!first.some((o) => o.name === "Zenith Rajang"), "no Zenith Rajang");
    check(first.filter((o) => /^Zenith /.test(o.name)).length === 23, "23 Zenith forms: " + first.filter((o) => /^Zenith /.test(o.name)).length);
    await choose(page, "Zenith Rathalos");
    let names = await shownNames(page, "largeSpawnAreas[0]");
    check(JSON.stringify(names) === JSON.stringify(["Rajang", "Zenith Rathalos", "Zenith Rathalos"]), "rows after the pick: " + names);
    let m = await save(page, saved);
    check(m && JSON.stringify(m.body.monsterVariants) === "[0,16,0,0,0]", "saved variants " + JSON.stringify(m && m.body.monsterVariants));
    check(m && m.largeSpawnAreas[0].spawns[1].monsterId === 11, "saved monster id 11");
    check(m && m.body.variantFlags3 === 0x11, "flags3 bit 4 set, bit 0 kept: " + (m && m.body.variantFlags3));
    check(m && m.header.monsterLevel === 64, "monster level 64: " + (m && m.header.monsterLevel));
    const rankButton = page.locator(".field", { has: page.locator("label", { hasText: /^Zenith rank/ }) }).locator("button.bui-picker-btn");
    check(await rankButton.count() === 1, "one Zenith rank picker");
    await rankButton.click();
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].find((r) => /\u2605\s*3|★3/.test(r.textContent));
      if (!row) throw new Error("no rank 3");
      row.click();
    });
    await page.waitForTimeout(200);
    m = await save(page, saved);
    check(m && m.header.monsterLevel === 66, "Zenith rank 3 is level 66: " + (m && m.header.monsterLevel));
    const review = await page.evaluate(() => (document.querySelector(".bui-review") || {}).textContent || "");
    check(/Zenith Rathalos/.test(review), "review names Zenith Rathalos: " + review);

    const second = await optionsOf(page, "largeSpawnAreas[1]", 0);
    check(!second.some((o) => /^Zenith /.test(o.name)), "the second large list offers no Zenith form");
    await page.keyboard.press("Escape");
    const small = await optionsOf(page, "smallSpawnGroups[0].areas[0]", 0);
    check(!small.some((o) => /^Zenith /.test(o.name)), "small monsters offer no Zenith form");
    await page.keyboard.press("Escape");

    // Remove Rajang (row 0): Rathalos moves to slot 0, and so does its 16.
    await page.locator("[data-where='largeSpawnAreas[0]'] tbody tr").first().locator("button", { hasText: "Remove" }).click();
    await page.waitForTimeout(250);
    m = await save(page, saved);
    check(m && JSON.stringify(m.body.monsterVariants) === "[16,0,0,0,0]", "after removing Rajang: " + JSON.stringify(m && m.body.monsterVariants));

    // Plain Rathalos: back to 0, both rows normal.
    await optionsOf(page, "largeSpawnAreas[0]", 0);
    await choose(page, "Rathalos");
    names = await shownNames(page, "largeSpawnAreas[0]");
    check(JSON.stringify(names) === JSON.stringify(["Rathalos", "Rathalos"]), "rows after plain Rathalos: " + names);
    m = await save(page, saved);
    check(m && JSON.stringify(m.body.monsterVariants) === "[0,0,0,0,0]", "after plain Rathalos: " + JSON.stringify(m && m.body.monsterVariants));
    check(m && m.body.variantFlags3 === 1 && m.header.monsterLevel === 7, "flag and level back: " + (m && [m.body.variantFlags3, m.header.monsterLevel]));
    check(await rankButton.count() === 0, "no Zenith rank picker without a Zenith monster");
    await context.close();

    // An older API: no monsterVariants in the model, no Zenith forms.
    ({ context, page } = await open(browser, model(null, [area([spawn(11, 224)])]), []));
    const old = await optionsOf(page, "largeSpawnAreas[0]", 0);
    check(!old.some((o) => /^Zenith /.test(o.name)), "no Zenith form without monsterVariants");
    await context.close();
  } catch (error) {
    problems.push("run: " + (error && error.stack || error));
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL " + p));
    process.exit(1);
  }
  console.log("quest builder Zenith forms OK");
}

main();
