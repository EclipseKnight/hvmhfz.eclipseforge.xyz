#!/usr/bin/env node
/* Checks the quest builder's reward and text extras (quest-editor.html, js/quest-editor.js; docs/quest-builder-gap.md
   task 5, API README "Reward extras") in headless Chromium against a fake API, with a made-up model (no game data):
   - Rewards and supplies has "Quest list rewards": Reward 1, 2 and 3 pickers (None), a "Use the main target's
     rewards" button and a "Fixed rewards" picker with Pax's five modes;
   - the button fills Reward 1/2/3 with the main target group's (0x8001) items by weight, shown with the game's item
     icons; a picked item no group pays is listed in the review; Fixed rewards saves body.rewardFlag;
   - Objectives: a used sub-target has its own Reward money (sub-target A 1200 saved as body.objective1Money), an
     unused one has none, and money left on an unused sub-target is listed in the review;
   - Quest text: "Write the target lines" writes "Hunt a ...", "Slay 3 ...", "None"; Undo puts the texts back;
     "Write the clear and fail lines" writes the clear line from the targets required and the fail line from the
     faint rule (money per faint; in G rank the faint count); the texts are saved;
   - the review's Money, Supplies and rewards and Quest list rewards lines;
   - a 400 about body.rewardFlag shows next to Fixed rewards;
   - a draft from before the fields (no previewItems, no rewardFlag) opens with Reward 1/2/3 empty and saves
     previewItems [0, 0, 0] (its raw bytes held the old blank's three items) and no rewardFlag;
   - account, admin, builder and quest list pages no longer say custom quests pay no zenny or no rewards;
   - at 375 px nothing in the rewards or text section sticks out past the screen edge;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-rewards.js

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

const items = JSON.parse(fs.readFileSync(path.join(root, "data/item-ids.json"), "utf8"));
const monsters = JSON.parse(fs.readFileSync(path.join(root, "data/monster-ids.json"), "utf8"));
const icons = JSON.parse(fs.readFileSync(path.join(root, "data/item-icons.json"), "utf8"));
const RATHIAN_SCALE = 393, HARDBONE = 315, WYVERN_FANG = 322, FATALIS_WING = 500, MEGA_NUTRIENTS = 10;

const obj = () => ({ type: 0, target: 0, count: 0 });
/** A made-up new quest: High rank, main target hunt Rathalos (11), sub-target A slay 3 Lao-Shan Lung (7), sub-target B
    unused but holding 300 zenny; a main reward group (0x8001) and a sub-target A group (0x8002). */
function model(old) {
  const body = { mapId: 26, questClass: 1, objective0: { type: 1, target: 11, count: 1 },
    objective1: { type: 513, target: 7, count: 3 }, objective2: obj(),
    zenny: 0, rewardMoney: 9000, faintPenalty: 2000, objective1Money: 0, objective2Money: 300, conditionNote: 0,
    timeLimit: 50 * 1800, maxHunters: 4, iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0, iconLabelCount: 0,
    flags: 0x000a4001, seasonFlags: 0x0a, flagByte: 0, level: 6, objectiveMode: 2, monsterVariants: [0, 0, 0, 0, 0],
    rank: 31, specialListTab: 0, postRankMin: 31, postRankMax: 0, joinRankMax: 0, variantFlags1: 0, variantFlags2: 0,
    variantFlags3: 0 };
  if (!old) Object.assign(body, { rewardFlag: 0, previewItems: [0, 0, 0] });
  return { layout: "QUEST", length: 0, header: { questClass: 1, monsterLevel: 7, monsterSize: 100, sizeClass: 2 }, raw: [],
    body, map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 96, 96, 160, 160, 96, 768].map((c, i) => ({ index: i, text: i === 0 ? "Reward test" : i === 1 ? "My own line" : "", capacity: c })),
    rewardGroups: [
      { groupId: 0x8001, reserved: 0, entryOffset: 0, entries: [
        { weight: 10, itemId: RATHIAN_SCALE, count: 1 }, { weight: 60, itemId: HARDBONE, count: 2 },
        { weight: 30, itemId: WYVERN_FANG, count: 1 }] },
      { groupId: 0x8002, reserved: 0, entryOffset: 0, entries: [{ weight: 100, itemId: FATALIS_WING, count: 1 }] }],
    smallSpawnGroups: [], largeSpawnAreas: [] };
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

const section = (page, title) => page.locator(".bui-section", { has: page.locator("h2", { hasText: title }) });

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
const iconOf = (page, label) => pickerOf(page, label).locator(".bui-icon-slot img").getAttribute("src");
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

const textOf = (sent, index) => ((sent.model || {}).texts || []).filter((t) => t.index === index).map((t) => t.text)[0];

async function editor(browser, base) {
  const { context, page, errors, saved, refuse } = await openEditor(browser, base);
  const rewards = section(page, "Rewards and supplies");
  check(/Quest list rewards/.test(await rewards.textContent()), "a Quest list rewards subhead");
  check(/once an admin approves it, it pays them\. The reward money is paid in both/.test(await rewards.textContent()),
    "the rewards note says testing pays no items, approval pays them, money in both");
  for (const n of [1, 2, 3]) check(await shown(page, "Reward " + n) === "None", "Reward " + n + " starts None");
  const modes = await openPicker(page, pickerOf(page, "Fixed rewards"));
  await page.keyboard.press("Escape");
  check(modes.length === 5 && modes[2].name === "Fixed rewards" && modes[4].name === "No fixed reward",
    "five reward flag modes: " + modes.map((m) => m.name).join(" | "));

  // Fill from the main target's rewards: by weight, Hardbone 60, Fang 30, Scale 10; the sub-target group's Wing left out.
  await page.click("#reward-preview-fill");
  await page.waitForTimeout(200);
  check(await shown(page, "Reward 1") === items[HARDBONE] && await shown(page, "Reward 2") === items[WYVERN_FANG]
    && await shown(page, "Reward 3") === items[RATHIAN_SCALE], "filled by weight: " + [await shown(page, "Reward 1"),
    await shown(page, "Reward 2"), await shown(page, "Reward 3")]);
  const icon = await iconOf(page, "Reward 1");
  check(icon === "/assets/icons/1x/" + icons[HARDBONE] + ".png", "Reward 1 has the game's icon: " + icon);
  check(fs.existsSync(path.join(root, "assets/icons/1x/" + icons[HARDBONE] + ".png")), "the icon file exists");
  await pick(page, "Reward 3", items[MEGA_NUTRIENTS]);
  await pick(page, "Fixed rewards", "Fixed rewards");
  await page.waitForTimeout(250);
  let r = await review(page);
  check(new RegExp("Quest list reward 3 \\(" + items[MEGA_NUTRIENTS] + "\\) is not an item any reward group pays").test(r),
    "the review lists an unpaid list item");
  check(new RegExp("Quest list rewards" + items[HARDBONE] + ", " + items[WYVERN_FANG] + ", " + items[MEGA_NUTRIENTS]
    + " \\(shown once approved; the testing copy lists none\\)").test(r), "review list rewards line: " + r);
  check(/4 rewards \(fixed rewards\); paid once approved, none while testing/.test(r), "review rewards line");

  // Sub-target money: A is used, B is not (and holds 300 zenny).
  check(await page.locator("#obj-1-money").count() === 1 && await page.locator("#obj-2-money").count() === 0,
    "sub-target A has a money field, unused B none");
  await typeNumber(page, "obj-1-money", 1200);
  await page.waitForTimeout(250);
  r = await review(page);
  check(/fee 0 zenny, reward 9,000 zenny, sub-target A 1,200 zenny, sub-target B 300 zenny \(paid in testing too\)/.test(r),
    "review money line: " + r);
  check(/Sub-target B is not used but pays 300 zenny/.test(r), "the review lists money on an unused sub-target");
  await typeNumber(page, "obj-1-money", 1000000);
  check(await page.locator("#obj-1-money.is-invalid").count() === 1, "1,000,000 zenny is marked");
  await typeNumber(page, "obj-1-money", 1200);

  // Text auto-fill.
  await page.click("#text-fill-targets");
  await page.waitForTimeout(150);
  check(await page.inputValue("#slot-1") === "Hunt a " + monsters[11], "main line: " + await page.inputValue("#slot-1"));
  check(await page.inputValue("#slot-2") === "Slay 3 " + monsters[7], "sub A line: " + await page.inputValue("#slot-2"));
  check(await page.inputValue("#slot-3") === "None", "sub B line: " + await page.inputValue("#slot-3"));
  await page.click("#text-fill-undo");
  await page.waitForTimeout(150);
  check(await page.inputValue("#slot-1") === "My own line" && await page.inputValue("#slot-2") === "",
    "Undo puts the texts back: " + await page.inputValue("#slot-1"));
  await page.click("#text-fill-targets");
  await page.click("#text-fill-rules");
  await page.waitForTimeout(150);
  check(await page.inputValue("#slot-4") === "Complete the main target", "clear line: " + await page.inputValue("#slot-4"));
  check(await page.inputValue("#slot-5") === "Reward money hits zero / Time runs out", "fail line: " + await page.inputValue("#slot-5"));

  let sent = await save(page, saved);
  let b = (sent.model || {}).body || {};
  check(JSON.stringify(b.previewItems) === JSON.stringify([HARDBONE, WYVERN_FANG, MEGA_NUTRIENTS]), "list items saved: " + b.previewItems);
  check(b.rewardFlag === 2, "reward flag saved: " + b.rewardFlag);
  check(b.objective1Money === 1200 && b.objective2Money === 300, "sub-target money saved: " + [b.objective1Money, b.objective2Money]);
  check(textOf(sent, 1) === "Hunt a " + monsters[11] && textOf(sent, 3) === "None" && textOf(sent, 5) === "Reward money hits zero / Time runs out",
    "texts saved: " + [textOf(sent, 1), textOf(sent, 3), textOf(sent, 5)]);

  // G rank: the fail line counts faints.
  const more = page.locator("details.bui-more-settings");
  if (!(await more.evaluate((d) => d.open))) await more.locator("summary").click();
  await pick(page, "Quest class", "G rank");
  await page.click("#text-fill-rules");
  await page.waitForTimeout(150);
  check(await page.inputValue("#slot-5") === "Faint 3 times / Time runs out", "G rank fail line: " + await page.inputValue("#slot-5"));

  // A 400 about the reward flag lands next to Fixed rewards.
  refuse.next = "Out of range: body.rewardFlag is 5; allowed 0..4.";
  await save(page, saved);
  check(/Reward flag is 5; the server accepts 0 to 4\./.test(await fieldOf(page, "Fixed rewards").textContent()),
    "the reward flag refusal is shown at Fixed rewards");

  check(!errors.length, "page errors: " + errors.join("; "));
  await context.close();
}

async function oldDraft(browser, base) {
  const draft = { id: 7, revision: 3, model: model(true), listing: { questType: 18, mark: 0 } };
  const { context, page, errors, saved } = await openEditor(browser, base, { draft });
  check(await shown(page, "Reward 1") === "None", "an old draft shows Reward 1 None");
  const sent = await save(page, saved);
  const b = (sent.model || {}).body || {};
  check(JSON.stringify(b.previewItems) === "[0,0,0]", "an old draft saves its list items cleared: " + b.previewItems);
  check(!("rewardFlag" in b), "an old draft saves without a reward flag: " + b.rewardFlag);
  check(!errors.length, "page errors (old draft): " + errors.join("; "));
  await context.close();
}

async function phone(browser, base) {
  const { context, page, errors } = await openEditor(browser, base, { width: 375 });
  for (const title of ["Rewards and supplies", "Quest text"]) {
    await section(page, title).scrollIntoViewIfNeeded();
    const sticking = await section(page, title).evaluate((s) => [...s.querySelectorAll("*")]
      .filter((n) => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
    check(sticking === 0, "375: " + sticking + " parts of " + title + " past the screen edge");
  }
  check(!errors.length, "page errors (375): " + errors.join("; "));
  await context.close();
}

function wording() {
  const pages = { "account.html": /pays its reward money but no item rewards; once approved it pays the rewards you set/,
    "admin.html": /Custom quests pay their reward money; in testing they pay no item rewards/,
    "quest-editor.html": /The testing copy pays the reward money but no\s+item rewards; once an admin approves the quest, it pays the rewards you set/,
    "quests.html": /until then it pays its money but no item rewards/ };
  const stale = /grant no rewards or zenny|no rewards, no zenny|testing copy pays no rewards|rewards are stripped until then/;
  for (const [file, wanted] of Object.entries(pages)) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    check(wanted.test(text), file + ": the new reward wording");
    check(!stale.test(text), file + ": still says custom quests pay nothing");
  }
}

(async () => {
  wording();
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
  console.log("quest builder rewards and text OK");
})();
