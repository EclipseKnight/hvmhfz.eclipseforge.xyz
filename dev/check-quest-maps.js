#!/usr/bin/env node
/* Checks the quest builder (quest-editor.html, js/quest-editor.js) against a fake API in headless Chromium,
   at 1280x900 and 375x740:
   - the map picker offers only the maps GET /api/account/quests/maps lists; every other map is listed,
     muted, with "not available yet (no template on the server)", and a click on it changes nothing;
   - when that call fails, only map 26 can be chosen and the map section says why;
   - a 400 on save (out of range, a sixth monster in one area, a map without tables) is shown next to the
     field it names, in plain words;
   - the start-area and spawn-area pickers show no "Unnamed area" on an arena, a tower and Raviente;
   - the page does not scroll sideways.
   Needs Playwright with Chromium, which the site itself does not use:

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-maps.js
     SHOTS=dev-shots NODE_PATH=... node dev/check-quest-maps.js   (also saves screenshots)

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
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

/* The maps the fake server has tables for: a field map, an arena, a tower, Raviente and the blank's 26. */
const SERVER_MAPS = [2, 9, 13, 26, 81];
const OFF_MAP = 1; // Fortress (day): in data/map-ids.json, not in SERVER_MAPS

const obj = () => ({ type: 0, target: 0, count: 0 });
function model(mapId, startArea, spawns) {
  return { layout: "QUEST", length: 0, header: { questClass: 0 }, raw: [],
    body: { mapId, questClass: 0, objective0: { type: 1, target: 0, count: 1 }, objective1: obj(), objective2: obj(),
      zenny: 0, rewardMoney: 0, timeLimit: 50 * 1800, maxHunters: 0, iconMonsters: [0, 0, 0, 0, 0], iconLabelId: 0, iconLabelCount: 0 },
    map: { mapId, areaId: startArea }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: startArea })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: "", capacity: c })),
    rewardGroups: [], smallSpawnGroups: [],
    largeSpawnAreas: [{ areaId: 1, reserved: 0, monsterIdsOffset: 0, spawnOffset: 0, spawns }] };
}
const spawn = (monsterId, areaId) => ({ monsterId, count: 1, areaId });

const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };

/** Opens the builder with a fake API. opts: maps ("ok" | "fail"), model, refusal (the 400 message on save). */
async function open(browser, w, h, opts) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800 });
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
    if (url.pathname === "/api/account/quests/maps") {
      return opts.maps === "ok" ? json(200, { maps: SERVER_MAPS }) : json(500, { message: "The server could not answer." });
    }
    if (url.pathname === "/api/account/quests/model") return json(200, opts.model);
    if (url.pathname === "/api/account/quest-drafts" && req.method() === "POST") return json(200, { id: 7, revision: 1 });
    if (url.pathname === "/api/account/quest-drafts") return json(200, []);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "PUT") {
      return opts.refusal ? json(400, { message: opts.refusal }) : json(200, { id: 7, revision: 2 });
    }
    return json(404, { message: "Not in the fake API." });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${w}: page error: ${e.message}`));
  await page.goto(base + "/quest-editor.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".bui-section");
  return { context, page };
}

function mapButton(page) {
  return page.locator(".field", { has: page.locator("label", { hasText: /^Map/ }) }).locator("button.bui-picker-btn").first();
}

/** The rows of the open picker: name, hint, disabled. */
function rows(page) {
  return page.evaluate(() => [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].map((r) => ({
    name: r.querySelector(".bui-name").textContent,
    hint: (r.querySelector(".bui-hint") || {}).textContent || "",
    id: Number(((r.querySelector(".bui-id") || {}).textContent || "").replace("#", "")),
    disabled: r.getAttribute("aria-disabled") === "true",
  })));
}

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + ".png") }); };

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [w, h] of [[1280, 900], [375, 740]]) {
    // 1. maps from the server; a 400 out of range on the time limit
    let { context, page } = await open(browser, w, h, {
      maps: "ok", model: model(26, 224, []), refusal: "Out of range: body.timeLimit is 0; allowed 1800..90000."
    });
    await mapButton(page).scrollIntoViewIfNeeded();
    await mapButton(page).click();
    await page.waitForTimeout(200);
    let list = await rows(page);
    const enabled = list.filter((r) => !r.disabled).map((r) => r.id).sort((a, b) => a - b);
    check(JSON.stringify(enabled) === JSON.stringify(SERVER_MAPS), `${w}: enabled maps are ${enabled}, want ${SERVER_MAPS}`);
    const off = list.find((r) => r.id === OFF_MAP);
    check(off && off.disabled && off.hint === "not available yet (no template on the server)",
      `${w}: map ${OFF_MAP} is not shown disabled with its hint: ${JSON.stringify(off)}`);
    check(!(await sideways(page)), `${w}: page scrolls sideways with the map picker open`);
    await shot(page, w + "-maps-picker");
    await page.locator(".bui-option[aria-disabled='true']").first().scrollIntoViewIfNeeded();
    await page.locator(".bui-option[aria-disabled='true']").first().click({ force: true });
    check(await page.evaluate(() => !document.querySelector(".bui-pop").hidden), `${w}: a click on a disabled map closed the picker`);
    await page.keyboard.press("Escape");
    const chosen = await page.evaluate(() => document.querySelector(".field .bui-picker-btn").textContent);
    check(!/Fortress/.test(chosen), `${w}: a disabled map was chosen`);
    check(!(await page.locator("text=Untested on this map").count()), `${w}: the old untested warning is still shown`);

    await page.click("#editor-save");
    await page.waitForSelector(".bui-server-problem");
    const timeNote = await page.evaluate(() => {
      const n = document.querySelector(".bui-server-problem");
      const field = n.closest(".field");
      return { text: n.textContent, fields: field && (field.querySelector("[data-fields]") || {}).getAttribute("data-fields") };
    });
    check(timeNote.fields === "body.timeLimit", `${w}: the time limit refusal is not next to the time limit: ${JSON.stringify(timeNote)}`);
    check(/Time limit is 0 minutes; the server accepts 1 minute to 50 minutes\./.test(timeNote.text),
      `${w}: the time limit refusal is not in plain words: ${timeNote.text}`);
    check(!(await sideways(page)), `${w}: page scrolls sideways with a refusal shown`);
    await page.locator(".bui-server-problem").scrollIntoViewIfNeeded();
    await shot(page, w + "-refusal-time-limit");
    await context.close();

    // 2. the maps call fails: only map 26; a sixth monster refused, shown under the monsters table
    ({ context, page } = await open(browser, w, h, {
      maps: "fail", model: model(26, 224, [spawn(1, 225), spawn(2, 225), spawn(3, 225), spawn(4, 225), spawn(5, 225), spawn(6, 225)]),
      refusal: "The quest model is not valid: Large monster area 1 has 6 different monsters [1, 2, 3, 4, 5, 6]; a quest lists at most 5 per area. Remove one."
    }));
    check(await page.locator("text=The server's list of maps could not be loaded").count() === 1, `${w}: no message when the maps call fails`);
    await mapButton(page).scrollIntoViewIfNeeded();
    await mapButton(page).click();
    list = await rows(page);
    const only = list.filter((r) => !r.disabled).map((r) => r.id);
    check(JSON.stringify(only) === "[26]", `${w}: with the maps call failing, enabled maps are ${only}`);
    await page.keyboard.press("Escape");
    await page.click("#editor-save");
    await page.waitForSelector(".bui-server-problem");
    const six = await page.evaluate(() => {
      const n = document.querySelector(".bui-server-problem");
      const prev = n.previousElementSibling;
      return { text: n.textContent, after: prev && prev.getAttribute("data-where") };
    });
    check(six.after === "largeSpawnAreas[0]", `${w}: the sixth monster refusal is not under the monsters table: ${JSON.stringify(six)}`);
    check(/can list at most 5 in one area\. Remove one\./.test(six.text) && !/\[/.test(six.text),
      `${w}: the sixth monster refusal is not in plain words: ${six.text}`);
    await page.locator(".bui-server-problem").scrollIntoViewIfNeeded();
    await shot(page, w + "-refusal-sixth-monster");
    await context.close();

    // 3. a map without tables, refused on save; next to the map field
    ({ context, page } = await open(browser, w, h, {
      maps: "ok", model: model(26, 224, []),
      refusal: "The quest model is not valid: Map 1 has no area tables on this server, so a quest on it would make the game read areas that do not exist. Maps that work: [2, 9, 13, 26, 81]."
    }));
    await page.click("#editor-save");
    await page.waitForSelector(".bui-server-problem");
    const mapNote = await page.evaluate(() => {
      const n = document.querySelector(".bui-server-problem");
      const field = n.closest(".field");
      return { text: n.textContent, fields: field && (field.querySelector("[data-fields]") || {}).getAttribute("data-fields") };
    });
    check(mapNote.fields === "body.mapId map.mapId", `${w}: the map refusal is not next to the map: ${JSON.stringify(mapNote)}`);
    check(/no area tables for Fortress \(day\) \(map 1\)/.test(mapNote.text), `${w}: the map refusal is not in plain words: ${mapNote.text}`);
    await context.close();

    // 4. area names on an arena, a tower and Raviente
    for (const [mapId, start, monsterArea] of [[9, 89, 90], [13, 121, 126], [81, 417, 418]]) {
      ({ context, page } = await open(browser, w, h, { maps: "ok", model: model(mapId, start, [spawn(1, monsterArea)]) }));
      const labels = await page.evaluate(() => [...document.querySelectorAll(".bui-picker-btn .bui-value")].map((e) => e.textContent));
      check(!labels.some((l) => /Unnamed area/.test(l)), `${w}: map ${mapId} shows an unnamed area: ${labels.join(" | ")}`);
      const startBtn = page.locator(".field", { has: page.locator("label", { hasText: /^Start area/ }) }).locator("button.bui-picker-btn").first();
      await startBtn.scrollIntoViewIfNeeded();
      await startBtn.click();
      const names = (await rows(page)).map((r) => r.name);
      check(names.length && !names.some((n) => /Unnamed area/.test(n)), `${w}: map ${mapId} start areas: ${names.join(" | ")}`);
      check(!(await sideways(page)), `${w}: map ${mapId}: page scrolls sideways`);
      await shot(page, w + "-start-areas-map-" + mapId);
      await context.close();
    }
  }
  await browser.close();
  server.close();
}

main().then(() => {
  if (problems.length) { console.log(problems.join("\n")); console.log(problems.length + " problem(s)"); process.exit(1); }
  console.log("quest builder maps OK: server map list, fallback, refusals by field, area names, 1280 and 375");
}, (err) => { console.error(err); server.close(); process.exit(1); });
