#!/usr/bin/env node
/* Checks the quest page (quest.html, js/quest.js) loads only its own piece of the quest data, in headless Chromium at
   375x667 (a phone), with the real data files and every request that leaves the machine aborted:
   - /quest.html?id=54869 asks for data/quests/pieces/54.json and data/quests/rewards/54.json, never data/quests.json or
     data/quest-details.json, and shows what the big files say of it (name, objective, sub-objectives, client,
     time limit, money, requirement with its item link, description, files, rewards);
   - an id with no quest (58004: details but no quest file; 2500: a range without a piece) says "Quest not found";
   - a piece that fails (HTTP 500) says "Quest could not be loaded", and Try again loads the quest once it answers;
   - no uncaught page error.
   That the pieces match data/quests.json and data/quest-details.json is dev/make-quest-pieces.py --check
   (run by dev/check-catalog-monsters.js).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-page.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const ID = 54869;
const quest = readJson("data/quests.json").quests.find((q) => q.id === ID);
const details = readJson("data/quest-details.json")[String(ID)];

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
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
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
  await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const open = async (id, tag) => {
    const page = await context.newPage();
    const data = [];
    page.on("pageerror", (e) => check(false, `${tag}: page error: ${e.message}`));
    page.on("request", (r) => { if (r.url().includes("/data/")) data.push(r.url().slice(base.length).split("?")[0]); });
    await page.goto(base + "/quest.html?id=" + id, { waitUntil: "load" });
    return { page, data };
  };

  // ---- the quest from its piece ----
  {
    const { page, data } = await open(ID, "quest " + ID);
    await page.waitForSelector("#quest-view h1");
    await page.waitForFunction(() => !/Loading/.test(document.getElementById("rewards").textContent));
    check(await page.locator("#quest-view h1").textContent() === quest.name, "quest " + ID + ": heading is not " + quest.name);
    const facts = await page.locator(".quest-facts").first().innerText();
    [details.objectiveEn, details.subAEn, details.subAJp, details.subBEn, details.clientEn, details.minutes + " minutes",
      details.rewardMoney.toLocaleString("en-US") + "z", details.requirementItemName + " x" + details.requirementCount,
      quest.variants.join(", ")].forEach((text) => check(facts.includes(text), "quest " + ID + ": facts lack \"" + text + "\""));
    check(await page.locator('.quest-facts a[href="/item.html?id=' + details.requirementItemId + '"]').count() === 1,
      "quest " + ID + ": no requirement item link");
    check((await page.locator(".quest-description").first().textContent()) === details.descriptionEn, "quest " + ID + ": description differs");
    check(await page.locator("#rewards .drop-row").count() > 0, "quest " + ID + ": no reward rows");
    ["/data/quests/pieces/54.json", "/data/quests/rewards/54.json"].forEach((want) =>
      check(data.includes(want), "quest " + ID + ": did not load " + want));
    ["/data/quests.json", "/data/quest-details.json"].forEach((big) =>
      check(!data.includes(big), "quest " + ID + ": still loads " + big));
    await page.close();
  }

  // ---- ids without a quest ----
  for (const id of [58004, 2500]) {
    const { page } = await open(id, "quest " + id);
    await page.waitForSelector("#quest-view h2");
    check(await page.locator("#quest-view h2").first().textContent() === "Quest not found", "quest " + id + ": not \"Quest not found\"");
    await page.close();
  }

  // ---- a piece that fails, then Try again ----
  {
    let failing = true;
    await context.route("**/data/quests/pieces/*", (r) => (failing ? r.fulfill({ status: 500, body: "" }) : r.continue()));
    const { page } = await open(ID, "failed piece");
    await page.waitForSelector("#quest-view h2");
    check(await page.locator("#quest-view h2").first().textContent() === "Quest could not be loaded", "failed piece: no load error heading");
    const again = page.getByRole("button", { name: "Try again" });
    check(await again.count() === 1, "failed piece: no Try again button");
    failing = false;
    await again.click();
    await page.waitForSelector("#quest-view h1");
    check(await page.locator("#quest-view h1").textContent() === quest.name, "failed piece: Try again did not load the quest");
    await page.close();
  }

  await browser.close();
  server.close();
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL: " + p));
    process.exit(1);
  }
  console.log("quest page OK: one piece per visit, not found, load error and Try again");
}

main().catch((error) => { console.error(error); process.exit(1); });
