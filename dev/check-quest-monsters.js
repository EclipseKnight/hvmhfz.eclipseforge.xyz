#!/usr/bin/env node
/* Checks the quest builder's monster tuning (quest-editor.html, js/quest-editor.js; docs/quest-builder-gap.md task 2,
   API README "Monster tuning") in headless Chromium against a fake API, with a made-up model (no game data):
   - Monsters has "Strength and size": Difficulty (the model's level 7, "7 · Low rank"; 0..78 without the Zenith ranks
     64..67; levels from 53 disabled in a High rank quest), Size (100, 70..150 %) and Size spread ("95–110%");
   - picking 12 · High rank, size 150 and 85–125% saves header.monsterLevel 12, monsterSize 150, sizeClass 4;
   - with the G rank class, 53 · G rank can be picked; back to High rank, the review lists the level;
   - a large monster whose area has a usual spot shows "Usual spot (x 8162, y 0, z 7504)"; "Set exactly" shows x, y
     and z from that spot; typing x 9000.5 saves position [9000.5, 0, 7504]; x 99999 (outside the map's bounds) is
     marked and not saved; a draft with that position opens with the inputs; "Use the usual spot" saves no position;
   - after "Set exactly", a new area, or a new map, saves no position (the server fills the usual spot);
   - a 400 naming the position shows next to the monster's Position cell;
   - four quiet "?" buttons on the page (chunk 1's three and Difficulty);
   - at 375 px the x, y, z inputs stay inside the screen and add no sideways scroll;
   - an older API (maps without spots and bounds): "Usual spot" without numbers, "Set exactly" starts at
     10000, 0, 10000;
   - the review shows "difficulty 12 · High rank, size 150% (85–125%), 1 at an exact spot";
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-monsters.js

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

const SPOT = [8162, 0, 7504];
/* What the API answers: map 26 (Great Forest by day, the blank's) and 6 (Jungle by day); area 226 (Area 1) of map
   26 has a usual spot; the bounds are that spot widened as the API does it. */
const MAPS = { maps: [6, 26], spots: { 6: {}, 26: { 226: SPOT } },
  bounds: { 6: { min: [-50000, -50000, -50000], max: [50000, 50000, 50000] },
    26: { min: [3162, -2000, 2504], max: [13162, 2000, 12504] } } };

const obj = () => ({ type: 0, target: 0, count: 0 });
/** A made-up new quest on map 26, High rank (class 1), level 7, size 100, spread 2; one Rathalos (11) in area 226. */
function model(position) {
  const body = { mapId: 26, questClass: 1, objective0: { type: 1, target: 11, count: 1 }, objective1: obj(), objective2: obj(),
    zenny: 0, rewardMoney: 0, timeLimit: 50 * 1800, maxHunters: 4, iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0,
    iconLabelCount: 0, flags: 0x000a4001, seasonFlags: 0x0a, flagByte: 0, level: 6, objectiveMode: 2,
    monsterVariants: [0, 0, 0, 0, 0], variantFlags3: 0 };
  const spawn = { monsterId: 11, count: 1, areaId: 226 };
  if (position !== undefined) spawn.position = position;
  return { layout: "QUEST", length: 0, header: { questClass: 1, monsterLevel: 7, monsterSize: 100, sizeClass: 2 }, raw: [],
    body, map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: i === 0 ? "Big red" : "", capacity: c })),
    rewardGroups: [], smallSpawnGroups: [],
    largeSpawnAreas: [{ areaId: 1, reserved: 0, monsterIdsOffset: 0, spawnOffset: 0, spawns: [spawn] }] };
}

async function openEditor(browser, base, opts) {
  const o = opts || {};
  const saved = [];
  const context = await browser.newContext({ viewport: { width: o.width || 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("hvmhfz.token", "x");
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  });
  const refuse = { next: null };
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (!/^api\./.test(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/account/quests/maps") return json(200, o.maps || MAPS);
    if (url.pathname === "/api/account/quests/model") return json(200, model());
    if (url.pathname === "/api/account/quest-drafts" && req.method() === "POST") return json(200, { id: 7, revision: 1 });
    if (url.pathname === "/api/account/quest-drafts") return json(200, []);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "GET") return json(200, o.draft);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "PUT") {
      saved.push(JSON.parse(req.postData()));
      if (refuse.next) { const message = refuse.next; refuse.next = null; return json(400, { message }); }
      return json(200, { id: 7, revision: saved.length + 1 });
    }
    return json(404, { message: "Not in the fake API." });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/quest-editor.html" + (o.draft ? "?draft=7" : ""), { waitUntil: "networkidle" });
  await page.waitForSelector(".bui-section");
  return { context, page, errors, saved, refuse };
}

/** The picker button of the field labelled `label` (with " (unconfirmed)" after it for a one-source field). */
function pickerOf(page, label) {
  return page.locator(".field", { has: page.locator("label", { hasText: new RegExp("^" + label + "( \\(unconfirmed\\))?$") }) })
    .locator("button.bui-picker-btn").first();
}

async function openPicker(page, button) {
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForSelector(".bui-pop:not([hidden]) .bui-option");
  return page.evaluate(() => [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].map((r) => ({
    name: r.querySelector(".bui-name").textContent,
    disabled: r.getAttribute("aria-disabled") === "true" || r.classList.contains("is-disabled")
  })));
}

async function choose(page, button, name) {
  await openPicker(page, button);
  await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")]
      .find((r) => r.querySelector(".bui-name").textContent === wanted);
    if (!row) throw new Error("no option " + wanted);
    row.click();
  }, name);
  await page.waitForTimeout(200);
}

const pick = (page, label, name) => choose(page, pickerOf(page, label), name);
const shown = (page, label) => pickerOf(page, label).locator(".bui-value").textContent();
const positionCell = (page) => page.locator('[data-where="largeSpawnAreas[0]"] tbody tr').first()
  .locator('td[data-label^="Position"]');
const review = (page) => page.evaluate(() => (document.querySelector("#editor-review") || {}).textContent || "");

async function save(page, saved) {
  const before = saved.length;
  await page.click("#editor-save");
  for (let i = 0; i < 50 && saved.length === before; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(150);
  return saved[saved.length - 1] || {};
}

const firstSpawn = (sent) => (((sent.model || {}).largeSpawnAreas || [])[0] || { spawns: [] }).spawns[0] || {};

async function typeAxis(page, axis, value) {
  const input = positionCell(page).locator('input[aria-label^="' + axis + ' of"]');
  await input.fill(String(value));
  await input.dispatchEvent("input");
  return input;
}

async function editor(browser, base) {
  const { context, page, errors, saved, refuse } = await openEditor(browser, base);
  check(await page.locator(".bui-section .subhead", { hasText: "Strength and size" }).count() === 1, "a Strength and size block");
  check(await shown(page, "Difficulty") === "7 · Low rank", "difficulty from the model: " + await shown(page, "Difficulty"));
  check(await page.inputValue("#monster-size") === "100", "size from the model");
  check(await shown(page, "Size spread") === "95–110%", "spread from the model: " + await shown(page, "Size spread"));
  const levels = await openPicker(page, pickerOf(page, "Difficulty"));
  await page.keyboard.press("Escape");
  check(levels.length === 75, "levels 0..78 without 64..67: " + levels.length);
  check(!levels.some((l) => /^6[4-7]\b/.test(l.name)), "no Zenith rank in Difficulty");
  check(levels.filter((l) => l.disabled).length === 22 && levels.find((l) => l.name === "53 · G rank").disabled,
    "the 22 G rank levels are disabled in a High rank quest: " + levels.filter((l) => l.disabled).length);

  const tips = await page.locator(".bui-help .help-tip").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  check(JSON.stringify(tips) === JSON.stringify(["What is Counter?", "What is Season?", "What is Targets required to clear?",
    "What is Difficulty?"]), "four help buttons, the last on Difficulty: " + tips);

  await pick(page, "Difficulty", "12 · High rank");
  await page.fill("#monster-size", "150");
  await page.dispatchEvent("#monster-size", "input");
  await pick(page, "Size spread", "85–125%");
  let sent = await save(page, saved);
  const h = (sent.model || {}).header || {};
  check(h.monsterLevel === 12 && h.monsterSize === 150 && h.sizeClass === 4, "header saved: " + JSON.stringify(h));
  await page.fill("#monster-size", "151");
  await page.dispatchEvent("#monster-size", "input");
  check(await page.locator("#monster-size.is-invalid").count() === 1, "size 151 is marked");
  sent = await save(page, saved);
  check(sent.model.header.monsterSize === 150, "size 151 is not saved: " + sent.model.header.monsterSize);

  // The usual spot, then an exact one.
  let cell = positionCell(page);
  check(/Usual spot \(x 8162, y 0, z 7504\)/.test(await cell.textContent()), "usual spot shown: " + await cell.textContent());
  sent = await save(page, saved);
  check(firstSpawn(sent).position === undefined, "untouched: no position sent: " + JSON.stringify(firstSpawn(sent)));
  await cell.locator("button", { hasText: "Set exactly" }).click();
  await page.waitForTimeout(150);
  cell = positionCell(page);
  const values = await cell.locator("input").evaluateAll((ins) => ins.map((i) => i.value));
  check(JSON.stringify(values) === JSON.stringify(["8162", "0", "7504"]), "exact inputs start at the usual spot: " + values);
  check(/Allowed here: x 3162 to 13162, y -2000 to 2000, z 2504 to 12504/.test(await cell.textContent()), "bounds shown");
  await typeAxis(page, "x", 9000.5);
  sent = await save(page, saved);
  check(JSON.stringify(firstSpawn(sent).position) === JSON.stringify([9000.5, 0, 7504]), "exact position saved: "
    + JSON.stringify(firstSpawn(sent).position));
  const wild = await typeAxis(page, "x", 99999);
  check(await wild.evaluate((i) => i.classList.contains("is-invalid")), "x outside the bounds is marked");
  sent = await save(page, saved);
  check(firstSpawn(sent).position[0] === 9000.5, "x outside the bounds is not saved: " + firstSpawn(sent).position);
  let text = await review(page);
  check(/difficulty 12 · High rank, size 150% \(85–125%\), 1 at an exact spot/.test(text), "review: " + text);

  // A refusal naming the position lands in the Position cell.
  refuse.next = "The quest model is not valid: largeSpawnAreas[0].spawns[0].position is 9000.5, 0, 7504 on map 26;"
    + " allowed x 3162..13162, y -2000..2000, z 2504..12504 (around the spots real quests use on this map).";
  await save(page, saved);
  const msg = positionCell(page).locator(".bui-server-problem");
  check(await msg.count() === 1 && /outside what the server allows on this map: x 3162\.\.13162/.test(await msg.textContent()),
    "the refusal shows in the Position cell: " + (await msg.count() ? await msg.textContent() : "none"));

  await positionCell(page).locator("button", { hasText: "Use the usual spot" }).click();
  await page.waitForTimeout(150);
  sent = await save(page, saved);
  check(firstSpawn(sent).position === null, "usual spot sends null: " + JSON.stringify(firstSpawn(sent).position));
  check(/Usual spot/.test(await positionCell(page).textContent()), "back to the usual spot text");

  // Set exactly, then a new area: the spot goes back to empty.
  await positionCell(page).locator("button", { hasText: "Set exactly" }).click();
  await page.waitForTimeout(150);
  await typeAxis(page, "z", 8000);
  const areaButton = page.locator('[data-where="largeSpawnAreas[0]"] tbody tr').first().locator('td[data-label="Area"] button.bui-picker-btn');
  await choose(page, areaButton, "Area 2, Day");
  sent = await save(page, saved);
  check(firstSpawn(sent).areaId === 228 && firstSpawn(sent).position === null, "a new area empties the position: "
    + JSON.stringify(firstSpawn(sent)));
  check(/^Usual spot$/.test((await positionCell(page).locator(".bui-position-text").first().textContent()).trim()),
    "area 228 has no known spot: plain Usual spot");

  // G rank levels follow the quest class.
  await page.click(".bui-more-settings summary");
  await pick(page, "Quest class", "G rank");
  await pick(page, "Difficulty", "53 · G rank");
  sent = await save(page, saved);
  check(sent.model.header.monsterLevel === 53 && sent.model.body.questClass === 7, "G rank level in a G rank quest");
  await pick(page, "Quest class", "High rank");
  text = await review(page);
  check(/Difficulty: Levels from 53 up are G rank levels/.test(text), "review lists a G level in a High rank quest: " + text);

  // A new map: every large monster back to its usual spot.
  await choose(page, page.locator('[data-where="largeSpawnAreas[0]"] tbody tr').first().locator('td[data-label="Area"] button.bui-picker-btn'), "Area 1, Day");
  await positionCell(page).locator("button", { hasText: "Set exactly" }).click();
  await page.waitForTimeout(150);
  await typeAxis(page, "y", 12);
  sent = await save(page, saved);
  check(JSON.stringify(firstSpawn(sent).position) === JSON.stringify([8162, 12, 7504]), "y typed: " + JSON.stringify(firstSpawn(sent).position));
  await pick(page, "Map", "Jungle (day)");
  sent = await save(page, saved);
  check(sent.model.body.mapId === 6 && firstSpawn(sent).position === null, "a new map empties the position: "
    + JSON.stringify(firstSpawn(sent)));
  check(!errors.length, "editor: no page errors: " + errors.join("; "));
  await context.close();
}

async function drafts(browser, base) {
  let opened = await openEditor(browser, base, { draft: { id: 7, sourceQuestId: 0, variant: "d0", revision: 4,
    model: model([9000.5, 0, 7504]), listing: { questType: 18, mark: 0 } } });
  let values = await positionCell(opened.page).locator("input").evaluateAll((ins) => ins.map((i) => i.value));
  check(JSON.stringify(values) === JSON.stringify(["9000.5", "0", "7504"]), "a stored exact position opens as inputs: " + values);
  check(!opened.errors.length, "stored position: no page errors: " + opened.errors.join("; "));
  await opened.context.close();

  opened = await openEditor(browser, base, { draft: { id: 7, sourceQuestId: 0, variant: "d0", revision: 4,
    model: model(SPOT.slice()), listing: { questType: 18, mark: 0 } } });
  check(/Usual spot \(x 8162/.test(await positionCell(opened.page).textContent()), "a stored usual spot shows as the usual spot");
  await opened.context.close();

  // A phone (375 px): the exact position's inputs wrap inside the row and add no sideways scroll. (The site header's
  // menu button already sticks out 17 px at this width, with or without this cell; dev/check-quest-maps.js reports it.)
  opened = await openEditor(browser, base, { width: 375 });
  const sideways = () => opened.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const before = await sideways();
  await positionCell(opened.page).locator("button", { hasText: "Set exactly" }).click();
  await opened.page.waitForTimeout(150);
  const after = await sideways();
  const sticking = await positionCell(opened.page).evaluate((td) => [...td.querySelectorAll("*")]
    .filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
  check(after <= before && sticking === 0, "375 px with x, y, z shown: sideways " + before + " -> " + after + " px, "
    + sticking + " parts of the cell past the screen edge");
  await opened.context.close();

  // An older API: no spots, no bounds.
  opened = await openEditor(browser, base, { maps: { maps: [26] } });
  const cell = positionCell(opened.page);
  check((await cell.locator(".bui-position-text").textContent()).trim() === "Usual spot", "older API: plain Usual spot");
  await cell.locator("button", { hasText: "Set exactly" }).click();
  await opened.page.waitForTimeout(150);
  values = await positionCell(opened.page).locator("input").evaluateAll((ins) => ins.map((i) => i.value));
  check(JSON.stringify(values) === JSON.stringify(["10000", "0", "10000"]), "older API: Set exactly starts at 10000, 0, 10000: " + values);
  const sent = await save(opened.page, opened.saved);
  check(JSON.stringify(firstSpawn(sent).position) === JSON.stringify([10000, 0, 10000]), "older API: saved");
  check(!opened.errors.length, "older API: no page errors: " + opened.errors.join("; "));
  await opened.context.close();
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await editor(browser, base);
    await drafts(browser, base);
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
  console.log("quest builder monsters OK");
}

main();
