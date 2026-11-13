#!/usr/bin/env node
/* Checks the tower rank and tower points displays in headless Chromium against a fake API:

   - hunters.html?id=: the Record panel shows Tower Rank and Tower Points when the hunter has them
     (towerRank, towerPoints) and hides both when they are null or missing;
   - leaderboards.html#tower: the Sky Corridor board lists the entries (hunter link, guild, Tower Rank,
     Tower Points), shows the empty state for no entries and for tracking: false, and an error line
     when the API fails; its chips switch to the Duremudira kills, floors or tower clears board for all
     districts or one (#tower-kills-3, #tower-floors-2; /api/public/sky/leaderboard);
   - sky-corridor.html: the "How tower points work" note, linking to the board.

   Set SHOTS=/some/folder to also save screenshots there (site-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-tower.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS || "";
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

const failures = [];
function check(name, ok, detail) { if (!ok) failures.push(name + (detail ? ": " + detail : "")); }

const API = /api\.hvmhfz\.eclipseforge\.xyz/;
const json = (route, body, status) => route.fulfill({ status: status || 200, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

const BASE_HUNTER = { gr: 120, hr: 999, weapon: "Bow", topMonsters: [], weaponTime: [], guildName: "Sky Guild" };
const HUNTERS = {
  1: Object.assign({ id: 1, name: "Climber", towerRank: 2, towerPoints: 1234 }, BASE_HUNTER),
  2: Object.assign({ id: 2, name: "Newbie", towerRank: null, towerPoints: null }, BASE_HUNTER),
  3: Object.assign({ id: 3, name: "OldApi" }, BASE_HUNTER)
};
const ENTRIES = [
  { rank: 1, charId: 14, name: "Climber", guildId: 102, guildName: "Sky Guild", towerRank: 2, towerPoints: 1234 },
  { rank: 2, charId: 15, name: "Second", guildId: null, guildName: null, towerRank: 1, towerPoints: 600 },
  { rank: 3, charId: 16, name: "Third", guildId: 102, guildName: "Sky Guild", towerRank: null, towerPoints: 500 }
];

let towerAnswer = { tracking: true, hunters: 3, entries: ENTRIES };
let towerStatus = 200;
// /api/public/sky/leaderboard: two hunters, except District 3 (nobody yet)
const asked = [];
function skyBoardAnswer(q) {
  const board = q.get("board");
  const district = q.get("district");
  const entries = district === "3" ? [] : [
    { rank: 1, charId: 21, name: "Kill Ace", guildId: 102, guildName: "Sky Guild", value: board === "floors" ? 40 : 3, clears: 5, floors: 40, kills: 3, lastAt: "2026-11-12T22:39:33Z" },
    { rank: 2, charId: 22, name: "Wall Runner", guildId: null, guildName: null, value: board === "floors" ? 12 : 1, clears: 2, floors: 12, kills: 1, lastAt: "2026-11-12T17:14:39Z" }];
  return { tracking: true, board, district, period: "all", from: null, hunters: entries.length, entries };
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(API, (route) => {
    const url = new URL(route.request().url());
    const m = /^\/api\/public\/hunters\/(\d+)$/.exec(url.pathname);
    if (m && HUNTERS[m[1]]) return json(route, HUNTERS[m[1]]);
    if (url.pathname === "/api/public/sky/tower-points") return json(route, towerAnswer, towerStatus);
    if (url.pathname === "/api/public/sky/leaderboard") {
      asked.push(url.pathname + url.search);
      return json(route, skyBoardAnswer(url.searchParams));
    }
    if (url.pathname.indexOf("/api/public/sky/") === 0) return json(route, {}, 404);
    return json(route, {});
  });
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name), fullPage: true }); };

  async function record(id) {
    const page = await context.newPage();
    await page.goto(base + "/hunters.html?id=" + id);
    await page.waitForSelector(".guild-stats .guild-stat", { timeout: 5000 }).catch(() => {});
    const text = await page.$$eval(".guild-stats .guild-stat", (cards) => cards.map((c) => c.textContent));
    return { page, text };
  }

  const set = await record(1);
  check("profile shows Tower Rank", set.text.some((t) => /^Tower Rank2$/.test(t)), JSON.stringify(set.text));
  check("profile shows Tower Points", set.text.some((t) => /^Tower Points1,234$/.test(t)), JSON.stringify(set.text));
  await shot(set.page, "site-profile.png");
  await set.page.close();
  for (const id of [2, 3]) {
    const none = await record(id);
    check("profile " + id + " hides tower stats", none.text.length > 0 && !none.text.some((t) => /Tower/.test(t)), JSON.stringify(none.text));
    await none.page.close();
  }

  async function board() {
    const page = await context.newPage();
    await page.goto(base + "/leaderboards.html#tower");
    await page.waitForFunction(() => !/^Loading/.test(document.getElementById("board-body").textContent), null, { timeout: 5000 }).catch(() => {});
    return page;
  }

  let page = await board();
  const head = await page.$$eval("#board-head th", (ths) => ths.map((t) => t.textContent));
  check("board header", JSON.stringify(head) === JSON.stringify(["#", "Hunter", "Guild", "Tower Rank", "Tower Points"]), JSON.stringify(head));
  const rows = await page.$$eval("#board-body tr", (trs) => trs.map((tr) =>
    Array.from(tr.cells).map((c) => c.textContent).concat(tr.querySelector("a") ? tr.querySelector("a").getAttribute("href") : "")));
  check("board rows", JSON.stringify(rows) === JSON.stringify([
    ["1", "Climber", "Sky Guild", "2", "1,234", "/hunters.html?id=14"],
    ["2", "Second", "-", "1", "600", "/hunters.html?id=15"],
    ["3", "Third", "Sky Guild", "-", "500", "/hunters.html?id=16"]]), JSON.stringify(rows));
  check("board chip pressed", await page.$eval('#board-chips [data-board="tower"]', (c) => c.getAttribute("aria-pressed")) === "true");
  check("board title", (await page.textContent("#board-title")) === "Sky Corridor");
  check("period chips hidden", await page.$eval("#period-chips", (e) => e.hidden));
  check("sky board chips shown, tower points pressed", !(await page.$eval("#sky-board-chips", (e) => e.hidden))
    && await page.$eval('#sky-board-chips [data-sky="points"]', (c) => c.getAttribute("aria-pressed")) === "true");
  check("district chips hidden on tower points", await page.$eval("#sky-district-chips", (e) => e.hidden));
  await shot(page, "site-leaderboard.png");

  // per district: Duremudira kills, then District 3, then floors in District 2
  const settle = () => page.waitForFunction(() => !/^Loading/.test(document.getElementById("board-body").textContent), null, { timeout: 5000 });
  await page.click('#sky-board-chips [data-sky="kills"]');
  await page.waitForFunction(() => document.getElementById("board-title").textContent === "Sky Corridor, Duremudira kills, all districts", null, { timeout: 5000 });
  await settle();
  check("kills board address", new URL(page.url()).hash === "#tower-kills-all", page.url());
  check("kills board request", asked[asked.length - 1] === "/api/public/sky/leaderboard?board=kills&district=all&period=all&limit=100", asked.join());
  check("kills board title", (await page.textContent("#board-title")) === "Sky Corridor, Duremudira kills, all districts", await page.textContent("#board-title"));
  check("district chips shown", !(await page.$eval("#sky-district-chips", (e) => e.hidden)));
  const kHead = await page.$$eval("#board-head th", (ths) => ths.map((t) => t.textContent));
  check("kills board header", JSON.stringify(kHead) === JSON.stringify(["#", "Hunter", "Guild", "Duremudira kills", "Tower clears", "Floors"]), JSON.stringify(kHead));
  const kRows = await page.$$eval("#board-body tr", (trs) => trs.map((tr) =>
    Array.from(tr.cells).map((c) => c.textContent).concat(tr.querySelector("a") ? tr.querySelector("a").getAttribute("href") : "")));
  check("kills board rows", JSON.stringify(kRows) === JSON.stringify([
    ["1", "Kill Ace", "Sky Guild", "3", "5", "40", "/hunters.html?id=21"],
    ["2", "Wall Runner", "-", "1", "2", "12", "/hunters.html?id=22"]]), JSON.stringify(kRows));
  await page.click('#sky-district-chips [data-district="3"]');
  await page.waitForFunction(() => document.getElementById("board-title").textContent === "Sky Corridor, Duremudira kills, District 3", null, { timeout: 5000 });
  await settle();
  check("district 3 address", new URL(page.url()).hash === "#tower-kills-3", page.url());
  check("district 3 request", asked[asked.length - 1] === "/api/public/sky/leaderboard?board=kills&district=3&period=all&limit=100", asked.join());
  check("district 3 title", (await page.textContent("#board-title")) === "Sky Corridor, Duremudira kills, District 3");
  check("district 3 empty", (await page.textContent("#board-body")).trim() === "Nobody has killed Duremudira in District 3 yet.", await page.textContent("#board-body"));
  check("district 3 chip pressed", await page.$eval('#sky-district-chips [data-district="3"]', (c) => c.getAttribute("aria-pressed")) === "true");
  await shot(page, "site-leaderboard-district3.png");
  await page.click('#sky-board-chips [data-sky="points"]');
  await page.waitForFunction(() => document.getElementById("board-title").textContent === "Sky Corridor", null, { timeout: 5000 });
  await settle();
  check("back to tower points", (await page.textContent("#board-title")) === "Sky Corridor" && await page.$eval("#sky-district-chips", (e) => e.hidden));
  await page.close();

  page = await context.newPage();
  await page.goto(base + "/leaderboards.html#tower-floors-2");
  await page.waitForFunction(() => !/^Loading/.test(document.getElementById("board-body").textContent), null, { timeout: 5000 }).catch(() => {});
  check("address #tower-floors-2", asked[asked.length - 1] === "/api/public/sky/leaderboard?board=floors&district=2&period=all&limit=100", asked.join());
  check("address #tower-floors-2 title", (await page.textContent("#board-title")) === "Sky Corridor, Floors climbed, District 2");
  check("address #tower-floors-2 chips", await page.$eval('#sky-board-chips [data-sky="floors"]', (c) => c.getAttribute("aria-pressed")) === "true"
    && await page.$eval('#sky-district-chips [data-district="2"]', (c) => c.getAttribute("aria-pressed")) === "true");
  await shot(page, "site-leaderboard-floors2.png");
  await page.close();

  const EMPTY = "No tower points yet. They count from cleared tower quests once the server turns them on.";
  for (const [label, answer] of [["no entries", { tracking: true, hunters: 0, entries: [] }],
    ["tracking off", { tracking: false, hunters: 0, entries: [] }]]) {
    towerAnswer = answer;
    page = await board();
    const text = await page.textContent("#board-body");
    check("empty state, " + label, text.trim() === EMPTY, text);
    if (label === "no entries") await shot(page, "site-leaderboard-empty.png");
    await page.close();
  }
  towerStatus = 500;
  page = await board();
  check("error line", /Could not load this leaderboard/.test(await page.textContent("#board-body")));
  await page.close();

  page = await context.newPage();
  await page.goto(base + "/sky-corridor.html");
  const note = await page.$("#tower-points");
  check("sky page has the tower points note", !!note);
  if (note) {
    const text = await page.evaluate(() => document.getElementById("tower-points").nextElementSibling.textContent);
    ["6", "9", "12", "10", "0.2", "Scale 100", "Head 500", "99,999,999", "999", "500 points", "100,000"].forEach((s) =>
      check("sky note mentions " + s, text.indexOf(s) !== -1));
    check("sky note links the board", !!(await page.$('#tower-points ~ p a[href="/leaderboards.html#tower"]')));
    await note.scrollIntoViewIfNeeded();
    if (shots) await page.screenshot({ path: path.join(shots, "site-sky-note.png") });
  }
  await page.close();

  await browser.close();
  server.close();
  failures.forEach((f) => console.log("FAIL " + f));
  console.log(failures.length ? failures.length + " failure(s)" : "tower display OK");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
