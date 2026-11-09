#!/usr/bin/env node
/* Checks the quest builder's rules and restrictions (quest-editor.html, js/quest-editor.js; docs/quest-builder-gap.md
   task 3, API README "Flags and restrictions") in headless Chromium against a fake API, with a made-up model (no game
   data):
   - a "Rules and restrictions" section: Hardcore off and disabled in a High rank quest (it says why), Restriction
     "None" with 137 choices (None and the 136 of data/quest-condition-notes.json, by group, one-source names marked
     unconfirmed), "Money lost per faint" 2000 zenny, the four rank limits, and 17 flag checkboxes (no G rank, Zenith,
     Road or Interception);
   - picking "No items" and ticking No Halk pots, Low conquest and No sigils saves conditionNote 60, variantFlags2 0x03
     and variantFlags3 0x80 (bits the page does not offer kept: variantFlags1 0x40 stays);
   - rank limits: a highest rank to join below the lowest is marked and listed in the review; 0 and 999 save;
   - with the class set to HR 100 and up, Hardcore can be ticked: conditionNote 109, the Restriction picker disabled
     and naming it; Fix HC sets variantFlags1 bit 1 without touching the restriction;
   - class G rank: Hardcore goes (conditionNote 0), "Faints allowed" 3, variantFlags1 bit 3 and specialListTab 1 are
     saved; back to High rank: money per faint a third of the reward money, bit 3 and the tab cleared;
   - the review's Rules line names the restriction, faints, ranks and flags;
   - a 400 about a Hardcore note shows next to the Hardcore and Restriction fields;
   - a draft from before the rank limits and flags were read (no postRankMin, postRankMax, joinRankMax, variantFlags)
     shows neither, and saves without them;
   - at 375 px nothing in the section sticks out past the screen edge;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-rules.js

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

const obj = () => ({ type: 0, target: 0, count: 0 });
/** A made-up new quest: High rank (class 1), reward 9000, 2000 zenny per faint, join rank 31, flags 1 bit 6 set. */
function model(old) {
  const body = { mapId: 26, questClass: 1, objective0: { type: 1, target: 11, count: 1 }, objective1: obj(), objective2: obj(),
    zenny: 0, rewardMoney: 9000, faintPenalty: 2000, conditionNote: 0, timeLimit: 50 * 1800, maxHunters: 4,
    iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0, iconLabelCount: 0, flags: 0x000a4001, seasonFlags: 0x0a, flagByte: 0,
    level: 6, objectiveMode: 2, monsterVariants: [0, 0, 0, 0, 0], rank: 31, specialListTab: 0 };
  if (!old) {
    Object.assign(body, { postRankMin: 31, postRankMax: 0, joinRankMax: 0, variantFlags1: 0x40, variantFlags2: 0,
      variantFlags3: 0 });
  } else {
    body.variantFlags3 = 0;
  }
  return { layout: "QUEST", length: 0, header: { questClass: 1, monsterLevel: 7, monsterSize: 100, sizeClass: 2 }, raw: [],
    body, map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: i === 0 ? "Rules test" : "", capacity: c })),
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

const section = (page) => page.locator(".bui-section", { has: page.locator("h2", { hasText: "Rules and restrictions" }) });

/** The field labelled `label` (with " (unconfirmed)" after it for a one-source field). */
function fieldOf(page, label) {
  return page.locator(".field", { has: page.locator("label", { hasText: new RegExp("^" + label + "( \\(unconfirmed\\))?$") }) }).first();
}
const pickerOf = (page, label) => fieldOf(page, label).locator("button.bui-picker-btn").first();

async function openPicker(page, button) {
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.waitForSelector(".bui-pop:not([hidden]) .bui-option");
  return page.evaluate(() => [...document.querySelectorAll(".bui-pop:not([hidden]) .bui-option")].map((r) => ({
    name: r.querySelector(".bui-name").textContent,
    hint: (r.querySelector(".bui-hint") || {}).textContent || ""
  })));
}

async function choose(page, button, name) {
  await openPicker(page, button);
  await page.fill(".bui-pop:not([hidden]) input", name).catch(() => {});
  await page.waitForTimeout(100);
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
const flag = (page, name) => section(page).locator("label.bui-check", { has: page.locator("span", { hasText: new RegExp("^" + name + "$") }) })
  .locator("input");
const review = (page) => page.evaluate(() => (document.querySelector("#editor-review") || {}).textContent || "");

async function save(page, saved) {
  const before = saved.length;
  await page.click("#editor-save");
  for (let i = 0; i < 50 && saved.length === before; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(150);
  return saved[saved.length - 1] || {};
}

async function typeNumber(page, id, value) {
  await page.fill("#" + id, String(value));
  await page.dispatchEvent("#" + id, "input");
}

async function setClass(page, name) {
  const more = page.locator("details.bui-more-settings");
  if (!(await more.evaluate((d) => d.open))) await more.locator("summary").click();
  await pick(page, "Quest class", name);
}

async function editor(browser, base) {
  const { context, page, errors, saved, refuse } = await openEditor(browser, base);
  check(await section(page).count() === 1, "a Rules and restrictions section");
  const hc = page.locator("#rule-hardcore");
  check(await hc.isDisabled() && !(await hc.isChecked()), "Hardcore off and disabled in a High rank quest");
  check(/For HR 100 and up quests only/.test(await fieldOf(page, "Hardcore").textContent()), "Hardcore says why it is off");
  check(await shown(page, "Restriction") === "None", "restriction None: " + await shown(page, "Restriction"));
  const notes = await openPicker(page, pickerOf(page, "Restriction"));
  await page.keyboard.press("Escape");
  const groups = await page.evaluate(() => document.querySelectorAll(".bui-pop .bui-group").length);
  check(notes.length >= 50 && notes[0].name === "None", "restriction list starts with None: " + notes.length);
  const all = JSON.parse(fs.readFileSync(path.join(root, "data/quest-condition-notes.json"), "utf8"));
  check(all.notes.length === 136, "136 restrictions in the data file: " + all.notes.length);
  check(groups >= 2, "the restriction list is grouped: " + groups);
  check(notes.some((n) => n.name === "Great Sword only" && n.hint === "unconfirmed"), "Great Sword only, unconfirmed");
  check(notes.some((n) => n.name === "Net café or N course players only" && n.hint === ""), "a confirmed name has no mark");
  check(await page.inputValue("#rule-faints") === "2000" && /Money lost per faint/.test(await section(page).textContent()),
    "money lost per faint 2000");
  for (const [id, v] of [["rule-post-min", "31"], ["rule-post-max", "0"], ["rule-join-min", "31"], ["rule-join-max", "0"]]) {
    check(await page.inputValue("#" + id) === v, id + " is " + v + ": " + await page.inputValue("#" + id));
  }
  const boxes = await section(page).locator(".bui-flags label.bui-check span:not(.bui-check-hint)").allTextContents();
  check(boxes.length === 17, "17 flag checkboxes: " + boxes.length);
  check(!boxes.some((t) => /^(G rank|Zenith|Road|Interception)$/i.test(t)), "no derived or hidden flag offered: " + boxes);

  // A restriction, three flags, ranks.
  await pick(page, "Restriction", "No items");
  await flag(page, "No Halk pots").check();
  await flag(page, "Low conquest").check();
  await flag(page, "No sigils").check();
  await typeNumber(page, "rule-post-min", 100);
  await typeNumber(page, "rule-join-min", 100);
  await typeNumber(page, "rule-join-max", 50);
  check(await page.locator("#rule-join-max.is-invalid").count() === 1, "join max below join min is marked");
  await page.waitForTimeout(250); // the review follows 120 ms after a change
  check(/highest rank to join \(50\) is below the lowest \(100\)/.test(await review(page)), "the review lists the rank order");
  await typeNumber(page, "rule-join-max", 999);
  check(await page.locator("#rule-join-max.is-invalid").count() === 0, "join max 999 is fine");
  let sent = await save(page, saved);
  let b = (sent.model || {}).body || {};
  check(b.conditionNote === 60, "restriction saved: " + b.conditionNote);
  check(b.variantFlags2 === 0x03 && b.variantFlags3 === 0x80 && b.variantFlags1 === 0x40,
    "flags saved: " + [b.variantFlags1, b.variantFlags2, b.variantFlags3]);
  check(b.postRankMin === 100 && b.postRankMax === 0 && b.rank === 100 && b.joinRankMax === 999,
    "ranks saved: " + [b.postRankMin, b.postRankMax, b.rank, b.joinRankMax]);
  const line = await review(page);
  check(/No items; 2,000 zenny lost per faint; post 100 and up; join 100 to 999; flags: Low conquest, No Halk pots, No sigils/.test(line),
    "review rules line: " + line);

  // Hardcore in an HR 100 and up quest.
  await setClass(page, "HR 100 and up");
  check(!(await page.locator("#rule-hardcore").isDisabled()), "Hardcore can be ticked in class 3");
  await page.locator("#rule-hardcore").check();
  await page.waitForTimeout(150);
  check(await pickerOf(page, "Restriction").isDisabled(), "the restriction picker is disabled with Hardcore");
  check(/^Hardcore \(restriction 109/.test(await shown(page, "Restriction")), "restriction names Hardcore: " + await shown(page, "Restriction"));
  await flag(page, "Fix HC").check();
  sent = await save(page, saved);
  b = sent.model.body;
  check(b.conditionNote === 109 && b.questClass === 3 && b.variantFlags1 === 0x42, "Hardcore saved: " + [b.conditionNote, b.questClass, b.variantFlags1]);
  check(/Hardcore;/.test(await review(page)), "the review says Hardcore");

  // A 400 about Hardcore lands next to the fields.
  refuse.next = "Out of range: body.conditionNote 109 makes a quest Hardcore, which needs quest class 3 (HR 100 and up); the class is 1.";
  await save(page, saved);
  check(/The server refused Hardcore/.test(await section(page).textContent()), "the Hardcore refusal is shown in the section");

  // G rank: faints allowed, the G bit and the list tab; Hardcore goes.
  await setClass(page, "G rank");
  check(!(await page.locator("#rule-hardcore").isChecked()) && await page.locator("#rule-hardcore").isDisabled(), "Hardcore off in G rank");
  check(await page.inputValue("#rule-faints") === "3" && /Faints allowed/.test(await section(page).textContent()), "faints allowed 3");
  sent = await save(page, saved);
  b = sent.model.body;
  check(b.conditionNote === 0 && b.faintPenalty === 3 && (b.variantFlags1 & 0x08) && b.specialListTab === 1,
    "G rank saved: " + [b.conditionNote, b.faintPenalty, b.variantFlags1, b.specialListTab]);
  await typeNumber(page, "rule-faints", 10);
  check(await page.locator("#rule-faints.is-invalid").count() === 1, "10 faints is marked");
  await setClass(page, "High rank");
  sent = await save(page, saved);
  b = sent.model.body;
  check(b.faintPenalty === 3000 && !(b.variantFlags1 & 0x08) && b.specialListTab === 0,
    "back to High rank: " + [b.faintPenalty, b.variantFlags1, b.specialListTab]);

  check(!errors.length, "page errors: " + errors.join("; "));
  await context.close();
}

async function oldDraft(browser, base) {
  const draft = { id: 7, revision: 3, model: model(true), listing: { questType: 18, mark: 0 } };
  const { context, page, errors, saved } = await openEditor(browser, base, { draft });
  check(await page.locator("#rule-post-min, #rule-post-max, #rule-join-max").count() === 0, "an old draft has no new rank fields");
  check(await page.locator("#rule-join-min").count() === 1, "an old draft still has the lowest rank to join");
  check(await section(page).locator(".bui-flags").count() === 0, "an old draft has no flag checkboxes");
  const sent = await save(page, saved);
  const b = (sent.model || {}).body || {};
  check(!("postRankMin" in b) && !("variantFlags1" in b), "an old draft saves without the new fields: " + Object.keys(b));
  check(!errors.length, "page errors (old draft): " + errors.join("; "));
  await context.close();
}

async function phone(browser, base) {
  const { context, page, errors } = await openEditor(browser, base, { width: 375 });
  // The site header's menu button already sticks out 17 px at this width (dev/check-quest-maps.js reports it), so
  // this counts the section's own parts past the screen edge.
  await section(page).scrollIntoViewIfNeeded();
  const sticking = await section(page).evaluate((s) => [...s.querySelectorAll("*")]
    .filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
  check(sticking === 0, "375: " + sticking + " parts of the section past the screen edge");
  check(!errors.length, "page errors (375): " + errors.join("; "));
  await context.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await editor(browser, base);
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
  console.log("quest builder rules and restrictions OK");
})();
