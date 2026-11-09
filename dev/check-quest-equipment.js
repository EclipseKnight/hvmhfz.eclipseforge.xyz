#!/usr/bin/env node
/* Checks the quest builder's forced equipment (quest-editor.html, js/quest-editor.js; docs/quest-builder-gap.md task 4,
   API README "Forced equipment") in headless Chromium against a fake API, with a made-up model and a fake equipment
   catalog (made-up names; ids from data/forced-equipment.json):
   - a "Forced equipment (arena)" section that says it is untested in game, with six rows (Weapon, Head, Chest, Arms,
     Waist, Legs), each "Not forced" with its three decoration pickers disabled;
   - a weapon search lists the catalog's pieces with their game icons, leaves out a placeholder row (melee 1110) and
     says so; picking melee 464 saves equipment[1] = 464, 0x8000 x 3 and flagsAtC0 bit 1 clear;
   - in that blademaster set, a gunner-only legs piece (4) is listed but cannot be picked; blademaster legs 3 can;
   - "Force no piece" on the head saves piece 0 in force, and its decorations stay disabled;
   - chest 3 with decoration "Sleep 2 Deco" (801, the first of the decorations Capcom forces) saves word1 0x8000 | 801;
   - a weapon found by id 16385 saves piece 1 (16385's low 14 bits) and flagsAtC0 bit 1;
   - the review's "Forced equipment" line names the pieces and says "not tested in game";
   - a 400 naming a head piece and a decoration shows next to the Head and Chest rows;
   - Clear on the weapon saves its record as zeros and clears flagsAtC0 bit 1;
   - a draft with a gunner legs piece beside a blademaster weapon and a placeholder head piece: the head row is marked,
     and the review lists both;
   - a draft from before the field existed (no body.equipment) shows six "Not forced" rows and saves without it;
   - at 375 px nothing in the section sticks out past the screen edge, with a search open;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-equipment.js

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

const gear = JSON.parse(fs.readFileSync(path.join(root, "data/forced-equipment.json"), "utf8"));
const ON = 0x8000;
// The ids this check relies on, as data/forced-equipment.json has them.
check(gear.melee[464] === "w" && gear.melee[16385] === "w" && gear.melee[1110] === "-" && gear.legs[3] === "b"
  && gear.legs[4] === "g" && gear.chest[3] === "b" && gear.head[250] === "-" && gear.decorations[0] === 801,
  "data/forced-equipment.json no longer has the ids this check uses");

/** The catalog's id: the game id as 4 hex digits, low byte first (armour padded with spaces, as the API does). */
const key = (id) => [id & 0xff, (id >> 8) & 0xff].map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join("");
const CATALOG = {
  melee: [[464, "Test Blade"], [1110, "Dummy Blade"], [16385, "Zenith Blade"]],
  ranged: [[1, "Test Bowgun"]],
  legs: [[3, "Blade Legs"], [4, "Gun Legs"]],
  chests: [[3, "Blade Mail"]],
  heads: [[250, "Placeholder Helm"]]
};
function catalog(slot, q) {
  const rows = (CATALOG[slot] || []).filter(([id, name]) => name.toLowerCase().includes(q.toLowerCase()) || key(id) === q);
  return { items: rows.map(([id, name]) => ({ id: slot === "melee" || slot === "ranged" ? key(id) : key(id) + " ", name,
    type: null, slot, icon: null })), page: 0, size: 40, total: rows.length };
}

const obj = () => ({ type: 0, target: 0, count: 0 });
const empty = () => ({ piece: 0, word1: 0, word2: 0, word3: 0 });
/** A made-up new quest (High rank). old: from before body.equipment existed. equipment: its records. */
function model(opts) {
  const o = opts || {};
  const body = { mapId: 26, questClass: 1, objective0: { type: 1, target: 11, count: 1 }, objective1: obj(), objective2: obj(),
    zenny: 0, rewardMoney: 9000, faintPenalty: 3000, conditionNote: 0, timeLimit: 50 * 1800, maxHunters: 4,
    iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0, iconLabelCount: 0, flags: 0x000a4001, seasonFlags: 0x0a, flagByte: 0,
    level: 6, objectiveMode: 2, monsterVariants: [0, 0, 0, 0, 0], rank: 31, specialListTab: 0, postRankMin: 31,
    postRankMax: 0, joinRankMax: 0, variantFlags1: 0, variantFlags2: 0, variantFlags3: 0, flagsAtC0: 0 };
  if (!o.old) body.equipment = o.equipment || [0, 1, 2, 3, 4, 5].map(empty);
  return { layout: "QUEST", length: 0, header: { questClass: 1, monsterLevel: 7, monsterSize: 100, sizeClass: 2 }, raw: [],
    body, map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: i === 0 ? "Arena test" : "", capacity: c })),
    rewardGroups: [], smallSpawnGroups: [], largeSpawnAreas: [] };
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
    if (url.pathname === "/api/public/catalog/equipment") {
      return json(200, catalog(url.searchParams.get("slot"), url.searchParams.get("q") || ""));
    }
    if (url.pathname === "/api/account/quests/maps") return json(200, { maps: [26] });
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

const section = (page) => page.locator(".bui-section", { has: page.locator("h2", { hasText: "Forced equipment (arena)" }) });
const row = (page, name) => section(page).locator("tbody tr", { has: page.locator("strong", { hasText: new RegExp("^" + name + "$") }) });
const current = (page, name) => row(page, name).locator(".qe-gear-current").textContent();
const review = (page) => page.evaluate(() => (document.querySelector("#editor-review") || {}).textContent || "");

/** Opens a slot's search, types term and waits for the answer; returns the options shown. */
async function search(page, name, term) {
  const r = row(page, name);
  const panel = r.locator(".qe-gear-search");
  if (await panel.isHidden()) await r.locator(".qe-gear-actions button").first().click();
  await panel.locator("input").fill(term);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const status = await panel.locator(".note-text").first().textContent();
    if (status !== "Searching…") break;
  }
  return panel.locator(".qe-gear-option").evaluateAll((list) => list.map((b) => ({
    name: b.querySelector(".qe-gear-name").textContent, id: b.querySelector(".bui-id").textContent,
    hint: (b.querySelector(".bui-hint") || {}).textContent || "", disabled: b.disabled,
    icon: !!b.querySelector(".gi img")
  })));
}

async function pickResult(page, name, label) {
  await row(page, name).locator(".qe-gear-option", { has: page.locator(".qe-gear-name", { hasText: new RegExp("^" + label + "$") }) }).click();
  await page.waitForTimeout(150);
}

async function chooseDeco(page, name, which, label) {
  const button = row(page, name).locator("button.bui-picker-btn").nth(which - 1);
  await button.click();
  await page.waitForSelector(".bui-pop:not([hidden]) .bui-option");
  await page.fill(".bui-pop:not([hidden]) input", label).catch(() => {});
  await page.waitForTimeout(100);
  await page.evaluate((wanted) => {
    const opt = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")]
      .find((r) => r.querySelector(".bui-name").textContent === wanted);
    if (!opt) throw new Error("no option " + wanted);
    opt.click();
  }, label);
  await page.waitForTimeout(150);
}

async function save(page, saved) {
  const before = saved.length;
  await page.click("#editor-save");
  for (let i = 0; i < 50 && saved.length === before; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(150);
  return saved[saved.length - 1] || {};
}

const rec = (b, i) => ((b.equipment || [])[i]) || {};
const words = (r) => [r.piece, r.word1, r.word2, r.word3].join(",");

async function editor(browser, base) {
  const { context, page, errors, saved, refuse } = await openEditor(browser, base);
  const sec = section(page);
  check(await sec.count() === 1, "no Forced equipment (arena) section");
  check(/Untested in game/.test(await sec.locator(".qe-gear-untested").textContent()), "no untested-in-game warning");
  const names = await sec.locator("tbody tr strong").allTextContents();
  check(names.join(",") === "Weapon,Head,Chest,Arms,Waist,Legs", "rows: " + names);
  const none = await sec.locator(".qe-gear-none").allTextContents();
  check(none.length === 6 && none.every((t) => t === "Not forced"), "not all six Not forced: " + none);
  const disabled = await sec.locator("button.bui-picker-btn").evaluateAll((l) => l.map((b) => b.disabled));
  check(disabled.length === 18 && disabled.every(Boolean), "decoration pickers not all disabled: " + disabled);

  // A weapon by name: the placeholder row is left out.
  let options = await search(page, "Weapon", "Blade");
  check(options.map((x) => x.name + x.id).join(",") === "Test Blade#464,Zenith Blade#16385", "weapon options: " + JSON.stringify(options));
  check(options.every((x) => x.icon && !x.disabled), "weapon options without icons or disabled");
  const status = await row(page, "Weapon").locator(".qe-gear-search .note-text").first().textContent();
  check(/1 placeholder row/.test(status), "placeholder not mentioned: " + status);
  await pickResult(page, "Weapon", "Test Blade");
  check(/Test Blade #?/.test(await current(page, "Weapon")) || /Test Blade/.test(await current(page, "Weapon")),
    "weapon shown: " + await current(page, "Weapon"));
  let b = ((await save(page, saved)).model || {}).body || {};
  check(words(rec(b, 1)) === [464, ON, ON, ON].join(","), "weapon record: " + words(rec(b, 1)));
  check(((b.flagsAtC0 || 0) & 2) === 0, "flagsAtC0 bit 1 set for weapon 464");

  // Legs in a blademaster set: the gunner piece cannot be picked.
  options = await search(page, "Legs", "Legs");
  const gun = options.find((x) => x.name === "Gun Legs") || {};
  const blade = options.find((x) => x.name === "Blade Legs") || {};
  check(gun.disabled && /for gunners; the set is for blademasters/.test(gun.hint), "gunner legs: " + JSON.stringify(gun));
  check(!blade.disabled && /blademasters only/.test(blade.hint), "blade legs: " + JSON.stringify(blade));
  await pickResult(page, "Legs", "Blade Legs");

  // Head forced empty; chest with a decoration.
  await row(page, "Head").locator(".qe-gear-actions button").first().click();
  await row(page, "Head").locator("button.qe-gear-bare").click();
  await page.waitForTimeout(150);
  check(/No piece/.test(await current(page, "Head")), "head: " + await current(page, "Head"));
  check((await row(page, "Head").locator("button.bui-picker-btn").evaluateAll((l) => l.map((x) => x.disabled))).every(Boolean),
    "head decorations enabled for no piece");
  await search(page, "Chest", "Mail");
  await pickResult(page, "Chest", "Blade Mail");
  await chooseDeco(page, "Chest", 1, "Sleep 2 Deco");
  b = ((await save(page, saved)).model || {}).body || {};
  check(words(rec(b, 0)) === [3, ON, ON, ON].join(","), "legs record: " + words(rec(b, 0)));
  check(words(rec(b, 2)) === [0, ON, ON, ON].join(","), "head record: " + words(rec(b, 2)));
  check(words(rec(b, 3)) === [3, ON | 801, ON, ON].join(","), "chest record: " + words(rec(b, 3)));
  check(words(rec(b, 4)) === "0,0,0,0" && words(rec(b, 5)) === "0,0,0,0", "arms or waist not empty");

  // A weapon past id 16,383, found by its id.
  options = await search(page, "Weapon", "16385");
  check(options.length === 1 && options[0].name === "Zenith Blade", "search by id: " + JSON.stringify(options));
  await pickResult(page, "Weapon", "Zenith Blade");
  b = ((await save(page, saved)).model || {}).body || {};
  check(words(rec(b, 1)) === [1, ON, ON, ON].join(","), "high weapon record: " + words(rec(b, 1)));
  check(((b.flagsAtC0 || 0) & 2) === 2, "flagsAtC0 bit 1 not set for weapon 16385: " + b.flagsAtC0);

  await page.waitForTimeout(250);
  const line = await review(page);
  check(/Forced equipment/.test(line) && /Zenith Blade/.test(line) && /head left empty/.test(line)
    && /Blade Mail \(1 decoration\)/.test(line) && /not tested in game/.test(line), "review: " + line);

  // The server's refusal next to the rows.
  refuse.next = "Out of range: body.equipment[2].piece: head piece 250 is not a head piece the server offers; "
    + "body.equipment[3].word1: decoration 1 is not one the server offers.";
  await save(page, saved);
  await page.waitForTimeout(200);
  const headProblem = await row(page, "Head").locator(".bui-server-problem").allTextContents();
  const chestProblem = await row(page, "Chest").locator(".bui-server-problem").allTextContents();
  check(headProblem.some((t) => /does not take this head \(#250\)/.test(t)), "head refusal: " + headProblem);
  check(chestProblem.some((t) => /does not take decoration/.test(t)), "chest refusal: " + chestProblem);

  // Clear the weapon.
  await row(page, "Weapon").locator(".qe-gear-actions button").nth(1).click();
  await page.waitForTimeout(150);
  b = ((await save(page, saved)).model || {}).body || {};
  check(words(rec(b, 1)) === "0,0,0,0" && ((b.flagsAtC0 || 0) & 2) === 0, "weapon not cleared: " + words(rec(b, 1)) + " c0 " + b.flagsAtC0);
  check(!errors.length, "page errors: " + errors.join("; "));
  await context.close();
}

async function badDraft(browser, base) {
  const equipment = [{ piece: 4, word1: ON, word2: ON, word3: ON }, { piece: 464, word1: ON, word2: ON, word3: ON },
    { piece: 250, word1: ON, word2: ON, word3: ON }, empty(), empty(), empty()];
  const draft = { id: 7, revision: 3, model: model({ equipment }), listing: { questType: 18, mark: 0 } };
  const { context, page, errors } = await openEditor(browser, base, { draft });
  await page.waitForTimeout(300);
  check(await row(page, "Head").locator(".qe-gear.is-invalid").count() === 1, "placeholder head not marked");
  const line = await review(page);
  check(/mixes blademaster and gunner/.test(line), "mix not in the review: " + line);
  check(/forced head \(#250\) is not a piece the server takes/.test(line), "head not in the review: " + line);
  check(!errors.length, "page errors (bad draft): " + errors.join("; "));
  await context.close();
}

async function oldDraft(browser, base) {
  const draft = { id: 7, revision: 3, model: model({ old: true }), listing: { questType: 18, mark: 0 } };
  const { context, page, errors, saved } = await openEditor(browser, base, { draft });
  const none = await section(page).locator(".qe-gear-none").allTextContents();
  check(none.length === 6, "old draft rows: " + none);
  const b = ((await save(page, saved)).model || {}).body || {};
  check(!("equipment" in b), "old draft saved with equipment");
  check(!errors.length, "page errors (old draft): " + errors.join("; "));
  await context.close();
}

async function phone(browser, base) {
  const { context, page, errors } = await openEditor(browser, base, { width: 375 });
  await search(page, "Weapon", "Blade");
  await section(page).scrollIntoViewIfNeeded();
  const sticking = await section(page).evaluate((s) => [...s.querySelectorAll("*")]
    .filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
  check(sticking === 0, sticking + " parts of the section stick out at 375 px");
  check(!errors.length, "page errors (375): " + errors.join("; "));
  await context.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await editor(browser, base);
    await badDraft(browser, base);
    await oldDraft(browser, base);
    await phone(browser, base);
  } catch (e) {
    problems.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) {
    problems.forEach((p) => console.log(p));
    console.log(problems.length + " problem(s)");
    process.exit(1);
  }
  console.log("quest builder forced equipment OK");
})();
