#!/usr/bin/env node
/* Checks the quest builder's listing options (quest-editor.html, js/quest-editor.js; API README "Custom quest
   listing", docs/quest-builder-gap.md task 1) and the admin's change at publishing (js/admin-quests.js) in headless
   Chromium against a fake API, with a made-up model (no game data):
   - a new quest shows "Quest board listing" with Counter (HR Event; only the 8 counters the API takes), Mark (None),
     Players and Stars (the model's level); Time of day and Season under Map; "Targets required to clear" under
     Objectives, its two-target choices disabled while the sub-targets are not used;
   - picking G Event, New, 3 stars, Night and Cold season saves listing {questType: 28, mark: 2} beside the model, with
     body.level 3, body.seasonFlags 0x14 and body.flags byte 2 equal to it;
   - with sub-target A set, "Main target and sub-target A" saves objectiveMode 3 and seasonFlags bit 6; taking
     sub-target A away lists a problem in the review; "Main target only" clears bit 6;
   - the review shows the quest list row (stars, mark, name, counter) and "Night, cold season";
   - only six quiet "?" buttons (Counter, Season, Targets required, Monsters' Difficulty from task 2, Hardcore and
     Restriction from task 3); a click
     keeps the text open, Escape closes it
     and it stays closed while the button keeps focus (it would cover the picker under it);
   - a draft's stored listing (43, Recommended) is shown; a draft without one (an older API) shows the defaults and
     saves {18, 0};
   - admin: a testing quest shows "Series counter · Recommended"; changing its counter to Interception (46) and
     publishing sends questType 46 and no mark; a row without a listing (an older API) has no selects and sends
     neither;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-listing.js

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
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };

const obj = () => ({ type: 0, target: 0, count: 0 });
/** A made-up new quest: day and warm (0x0a, as the blank), body.flags with that byte, 6 stars, main target only. */
function model() {
  const body = { mapId: 26, questClass: 1, objective0: { type: 1, target: 11, count: 1 }, objective1: obj(), objective2: obj(),
    zenny: 0, rewardMoney: 0, timeLimit: 50 * 1800, maxHunters: 4, iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0,
    iconLabelCount: 0, flags: 0x000a4001, seasonFlags: 0x0a, flagByte: 0, level: 6, objectiveMode: 2 };
  return { layout: "QUEST", length: 0, header: { questClass: 1, monsterLevel: 7 }, raw: [], body,
    map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: i === 0 ? "Night raid" : "", capacity: c })),
    rewardGroups: [], smallSpawnGroups: [], largeSpawnAreas: [] };
}

async function openEditor(browser, base, draft, saved) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("hvmhfz.token", "x");
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  });
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (!/^api\./.test(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/account/quests/maps") return json(200, { maps: [26] });
    if (url.pathname === "/api/account/quests/model") return json(200, model());
    if (url.pathname === "/api/account/quest-drafts" && req.method() === "POST") return json(200, { id: 7, revision: 1 });
    if (url.pathname === "/api/account/quest-drafts") return json(200, []);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "GET") return json(200, draft);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "PUT") {
      saved.push(JSON.parse(req.postData()));
      return json(200, { id: 7, revision: saved.length + 1 });
    }
    return json(404, { message: "Not in the fake API." });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/quest-editor.html" + (draft ? "?draft=7" : ""), { waitUntil: "networkidle" });
  await page.waitForSelector(".bui-section");
  return { context, page, errors };
}

/** The picker button of the field labelled `label` (with " (unconfirmed)" after it for a one-source field). */
function pickerOf(page, label) {
  return page.locator(".field", { has: page.locator("label", { hasText: new RegExp("^" + label + "( \\(unconfirmed\\))?$") }) })
    .locator("button.bui-picker-btn").first();
}

async function options(page, label) {
  const button = pickerOf(page, label);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForSelector(".bui-pop:not([hidden]) .bui-option");
  const list = await page.evaluate(() => [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].map((r) => ({
    name: r.querySelector(".bui-name").textContent,
    disabled: r.getAttribute("aria-disabled") === "true" || r.classList.contains("is-disabled")
  })));
  return list;
}

async function pick(page, label, name) {
  await options(page, label);
  await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")]
      .find((r) => r.querySelector(".bui-name").textContent === wanted);
    if (!row) throw new Error("no option " + wanted);
    row.click();
  }, name);
  await page.waitForTimeout(200);
}

const shown = (page, label) => pickerOf(page, label).locator(".bui-value").textContent();

async function save(page, saved) {
  const before = saved.length;
  await page.click("#editor-save");
  for (let i = 0; i < 50 && saved.length === before; i++) await page.waitForTimeout(100);
  return saved[saved.length - 1] || {};
}

const review = (page) => page.evaluate(() => (document.querySelector("#editor-review") || {}).textContent || "");

async function editor(browser, base) {
  const saved = [];
  const { context, page, errors } = await openEditor(browser, base, null, saved);
  check(await page.locator(".bui-section h2", { hasText: "Quest board listing" }).count() === 1, "a Quest board listing section");
  check(await shown(page, "Counter") === "HR Event", "counter starts at HR Event: " + await shown(page, "Counter"));
  check(await shown(page, "Mark") === "None", "mark starts at None");
  check(await shown(page, "Stars") === "6 stars", "stars from body.level: " + await shown(page, "Stars"));
  check(await shown(page, "Time of day") === "Day", "time of day starts at Day");
  check(await shown(page, "Season") === "Warm season", "season starts at Warm");
  const counters = (await options(page, "Counter")).map((o) => o.name);
  await page.keyboard.press("Escape");
  check(JSON.stringify(counters.slice().sort()) === JSON.stringify(["Daily", "G Event", "G Exotic", "G Urgent", "HR Event",
    "HR Exotic", "Series", "Superior / Zenith"]), "the 8 counters the API takes: " + counters);
  const modes = await options(page, "Targets required to clear");
  await page.keyboard.press("Escape");
  check(modes.length === 3 && !modes[0].disabled && modes[1].disabled && modes[2].disabled,
    "two-target choices disabled without sub-targets: " + JSON.stringify(modes));

  // Exactly four quiet "?" buttons (the fourth is Difficulty, under Monsters), and a click keeps one open until Escape.
  const tips = page.locator(".bui-help .help-tip");
  check(await tips.count() === 6, "six help buttons: " + await tips.count());
  const names = await tips.evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  check(JSON.stringify(names) === JSON.stringify(["What is Counter?", "What is Hardcore?", "What is Restriction?", "What is Season?",
    "What is Targets required to clear?",
    "What is Difficulty?"]), "help buttons on Counter, Hardcore, Restriction, Season, Targets required and Difficulty: " + names);
  await tips.first().scrollIntoViewIfNeeded();
  await tips.first().click();
  check(await page.locator(".help-pop.is-open").count() === 1 && await tips.first().getAttribute("aria-expanded") === "true",
    "a click keeps the help open");
  check(await page.locator(".help-pop.is-open").isVisible(), "the open help is visible");
  await page.keyboard.press("Escape");
  check(await page.locator(".help-pop.is-open").count() === 0, "Escape closes the help");
  check(!(await page.locator(".bui-help .help-pop").first().isVisible()), "the closed help stays hidden while its button has focus");

  await pick(page, "Counter", "G Event");
  await pick(page, "Mark", "New");
  await pick(page, "Stars", "3 stars");
  await pick(page, "Time of day", "Night");
  await pick(page, "Season", "Cold season");
  let sent = await save(page, saved);
  check(JSON.stringify(sent.listing) === JSON.stringify({ questType: 28, mark: 2 }), "saved listing: " + JSON.stringify(sent.listing));
  const b = (sent.model || {}).body || {};
  check(b.level === 3, "body.level 3: " + b.level);
  check(b.seasonFlags === 0x14, "night and cold are 0x14: " + b.seasonFlags);
  check(b.flags === 0x00144001, "body.flags byte 2 follows: 0x" + (b.flags || 0).toString(16));
  let text = await review(page);
  check(/★★★ · New · Night raid — G Event counter, 3 stars, up to 4 hunters/.test(text), "review shows the list row: " + text);
  check(/Night, cold season/.test(text), "review shows time and season");

  // Sub-target A, then both required.
  const typeA = page.locator(".field", { has: page.locator("label", { hasText: /^Type$/ }) }).nth(1).locator("button.bui-picker-btn");
  await typeA.scrollIntoViewIfNeeded();
  await typeA.click();
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].find((r) => r.querySelector(".bui-name").textContent === "Hunt");
    if (!row) throw new Error("no Hunt type");
    row.click();
  });
  await page.waitForTimeout(200);
  const after = await options(page, "Targets required to clear");
  await page.keyboard.press("Escape");
  check(!after[1].disabled && after[2].disabled, "with sub-target A only the two-target choice opens: " + JSON.stringify(after));
  await pick(page, "Targets required to clear", "Main target and sub-target A");
  sent = await save(page, saved);
  check(sent.model.body.objectiveMode === 3, "objectiveMode 3: " + sent.model.body.objectiveMode);
  check(sent.model.body.seasonFlags === 0x54, "bit 6 set with mode 3: 0x" + sent.model.body.seasonFlags.toString(16));
  check(((sent.model.body.flags >>> 16) & 0xff) === 0x54, "body.flags follows bit 6");
  text = await review(page);
  check(/to clear: main target and sub-target a/.test(text), "review says what clears it: " + text);

  // Sub-target A back to Not used: the review says the choice now needs it.
  await typeA.click();
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].find((r) => r.querySelector(".bui-name").textContent === "Not used");
    if (!row) throw new Error("no Not used");
    row.click();
  });
  await page.waitForTimeout(300);
  text = await review(page);
  check(/Targets required to clear: .*needs sub-target A/.test(text), "review lists the missing sub-target: " + text);
  await pick(page, "Targets required to clear", "Main target only");
  sent = await save(page, saved);
  check(sent.model.body.objectiveMode === 2 && sent.model.body.seasonFlags === 0x14, "main only clears bit 6: "
    + sent.model.body.objectiveMode + " 0x" + sent.model.body.seasonFlags.toString(16));
  check(!errors.length, "editor: no page errors: " + errors.join("; "));
  await context.close();
}

async function drafts(browser, base) {
  let saved = [];
  let opened = await openEditor(browser, base, { id: 7, sourceQuestId: 0, variant: "d0", revision: 4, model: model(),
    listing: { questType: 43, mark: 1 } }, saved);
  check(await shown(opened.page, "Counter") === "Superior / Zenith", "stored counter shown: " + await shown(opened.page, "Counter"));
  check(await shown(opened.page, "Mark") === "Recommended", "stored mark shown");
  check(!opened.errors.length, "stored listing: no page errors: " + opened.errors.join("; "));
  await opened.context.close();

  saved = [];
  opened = await openEditor(browser, base, { id: 7, sourceQuestId: 0, variant: "d0", revision: 4, model: model() }, saved);
  check(await shown(opened.page, "Counter") === "HR Event", "no listing: HR Event");
  const sent = await save(opened.page, saved);
  check(JSON.stringify(sent.listing) === JSON.stringify({ questType: 18, mark: 0 }), "no listing saves the defaults: " + JSON.stringify(sent.listing));
  check(!opened.errors.length, "older API: no page errors: " + opened.errors.join("; "));
  await opened.context.close();
}

async function admin(browser, base) {
  const calls = [];
  const rows = [
    { id: 1, title: "Series hunt", status: "testing", note: null, account: "author", size: 4096, submittedAt: "2026-11-09T10:00:00Z",
      reviewedAt: null, questType: 24, mark: 1, expiresAt: "2026-11-23T10:00:00Z" },
    { id: 2, title: "Old row", status: "testing", note: null, account: "author", size: 4096, submittedAt: "2026-11-09T10:00:00Z",
      reviewedAt: null }
  ];
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const token = "e30." + Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url") + ".x";
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), token);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    let m;
    if (p === "/api/admin/quest-submissions") return reply(200, rows);
    if (p === "/api/admin/quest-submissions/event-slots") return reply(200, { used: 10, cap: 512, free: 502 });
    if ((m = p.match(/^\/api\/admin\/quest-submissions\/(\d+)\/decide$/))) {
      calls.push({ id: Number(m[1]), body: JSON.parse(req.postData()) });
      return reply(200, { id: Number(m[1]), status: "approved" });
    }
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
  await page.goto(base + "/admin.html#quests");
  await page.waitForFunction(() => /Series hunt/.test(document.getElementById("quests-body").textContent), null, { timeout: 5000 }).catch(() => {});
  const body = (await page.textContent("#quests-body")).replace(/\s+/g, " ");
  check(/Series hunt\s*Series counter · Recommended/.test(body), "admin row shows the listing: " + body);
  const first = page.locator("#quests-body tr").nth(0);
  check(await first.locator("select").count() === 2, "two selects on a row with a listing");
  check(await page.locator("#quests-body tr").nth(1).locator("select").count() === 0, "no selects without a listing");
  await first.locator("select").first().selectOption("46");
  await first.locator("button", { hasText: "Publish" }).click();
  await page.locator("#quests-body tr").nth(1).locator("button", { hasText: "Publish" }).click().catch(() => {});
  for (let i = 0; i < 30 && calls.length < 2; i++) await page.waitForTimeout(100);
  const one = calls.find((c) => c.id === 1);
  const two = calls.find((c) => c.id === 2);
  check(one && JSON.stringify(one.body) === JSON.stringify({ approve: true, note: "", questType: 46 }), "publish sends the changed counter only: " + JSON.stringify(one));
  check(two && JSON.stringify(two.body) === JSON.stringify({ approve: true, note: "" }), "an old row sends no listing: " + JSON.stringify(two));
  check(!errors.length, "admin: no page errors: " + errors.join("; "));
  await page.close();
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await editor(browser, base);
    await drafts(browser, base);
    await admin(browser, base);
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
  console.log("quest builder listing OK");
}

main();
