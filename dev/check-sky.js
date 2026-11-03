#!/usr/bin/env node
/* Checks the Sky Corridor page (sky-corridor.html) and the hunter profile's Sky Corridor tab in headless
   Chromium against a fake /api/public/sky/* (shapes as the API's README, section "Sky Corridor"):

   - sample data: four district cards with bars at the API's percent, the boards' exact hunter and guild
     links, the board/district/period chips ask the API for that board, the week caveat, the 11 mission
     pages, the guilds' three missions, the present box rows;
   - empty data (tracking on, zeros and []): every section says it is empty, nothing breaks;
   - an API without the endpoints (404) and one without the tables (tracking: false): "coming soon", the
     data panels hidden, no error;
   - hunters.html?id=: the Sky Corridor tab with data, and no tab on a 404 or a hunter with nothing;
   - the pure helpers of js/sky.js under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (sky-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-sky.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Sky = require("../js/sky.js");

const root = path.join(__dirname, "..");
const shots = path.join(root, "dev-shots");
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
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

/* ---- the fake API ---- */

const T = "2026-11-03T12:00:00Z";
const MISSIONS = Array.from({ length: 33 }, (_, i) => ({ page: Math.floor(i / 3) + 1, slot: (i % 3) + 1,
  block: (i % 2) + 1, type: (i % 6) + 1, typeName: ["floors", "antiques", "chests", "cats", "trp", "slays"][i % 6], goal: 10 + i }));
const REWARDS = [
  { id: 1, kind: "floors", threshold: 1, presentType: 7201, itemId: 11167, itemName: "Tower Medal", quantity: 10, reached: 5, claimed: 1 },
  { id: 11, kind: "clears", threshold: 1, presentType: 7201, itemId: 11167, itemName: "Tower Medal", quantity: 10, reached: 3, claimed: 2 },
  { id: 3, kind: "floors", threshold: 10, presentType: 7201, itemId: 11163, itemName: "Ancient Gold Debris", quantity: 1, reached: 2, claimed: 0 }
];
const district = (n, c, f, p) => ({ district: n, shownInGame: n <= 2, clears: c, floors: f, players: p,
  clearsPercent: Math.min(100, Math.floor(c * 100 / 25)), floorsPercent: Math.min(100, Math.floor(f * 100 / 100)),
  clearsGoalReached: c >= 25, floorsGoalReached: f >= 100, lastActivity: c ? T : null });

function sample(p, q) {
  if (p === "/api/public/sky/overview") return { tracking: true, goals: { clears: 25, floors: 100 },
    totals: { clears: 69, floors: 650, players: 5 }, lastActivity: T,
    districts: [district(1, 54, 542, 3), district(2, 10, 60, 2), district(3, 5, 48, 1), district(4, 0, 0, 0)] };
  if (p === "/api/public/sky/leaderboard") {
    const board = q.get("board");
    return { tracking: true, board, district: q.get("district"), period: q.get("period"),
      from: q.get("period") === "week" ? "2026-11-02T00:00:00Z" : null, hunters: 2,
      entries: [{ rank: 1, charId: 11, name: "Floor Fan", guildId: 100, guildName: "Sky Guild", value: board === "clears" ? 4 : 30, clears: 4, floors: 30, lastAt: T },
        { rank: 2, charId: 12, name: "Lone Wolf", guildId: null, guildName: null, value: board === "clears" ? 1 : 5, clears: 1, floors: 5, lastAt: T }] };
  }
  if (p === "/api/public/sky/guilds") return { tracking: true, pages: 11, missions: MISSIONS, total: 1,
    guilds: [{ rank: 1, guildId: 100, name: "Sky Guild", page: 2, allDone: false, members: 2, contributors: 1,
      missions: [{ slot: 1, block: 1, type: 4, typeName: "cats", goal: 6, current: 10, percent: 100 },
        { slot: 2, block: 2, type: 5, typeName: "trp", goal: 20000, current: 5000, percent: 25 },
        { slot: 3, block: 1, type: 5, typeName: "trp", goal: 25000, current: 0, percent: 0 }] }] };
  if (p === "/api/public/sky/rewards") return { tracking: true, rewards: REWARDS };
  if (p === "/api/public/sky/hunter/10") return { tracking: true, charId: 10, name: "Sky Ace", guildId: 100, guildName: "Sky Guild",
    clears: 5, floors: 20, lastAt: T, floorsRank: 2, clearsRank: 1, tr: null, trp: null,
    districts: [1, 2, 3, 4].map((d) => ({ district: d, clears: d === 1 ? 3 : d === 2 ? 2 : 0, floors: d === 1 ? 12 : d === 2 ? 8 : 0, lastAt: d <= 2 ? T : null })),
    rewards: [{ id: 1, kind: "floors", threshold: 1, itemId: 11167, itemName: "Tower Medal", quantity: 10, reached: true, claimedAt: T },
      { id: 2, kind: "floors", threshold: 50, itemId: 11167, itemName: "Tower Medal", quantity: 40, reached: false, claimedAt: null }],
    guildMissions: { guildId: 100, guildName: "Sky Guild", page: 2,
      missions: [{ slot: 1, block: 1, type: 4, typeName: "cats", goal: 6, guildCurrent: 10, mine: 4 }] } };
  return undefined;
}

function empty(p) {
  if (p === "/api/public/sky/overview") return { tracking: true, goals: { clears: 25, floors: 100 },
    totals: { clears: 0, floors: 0, players: 0 }, lastActivity: null, districts: [1, 2, 3, 4].map((n) => district(n, 0, 0, 0)) };
  if (p === "/api/public/sky/leaderboard") return { tracking: true, board: "floors", district: "all", period: "all", from: null, hunters: 0, entries: [] };
  if (p === "/api/public/sky/guilds") return { tracking: true, pages: 11, missions: MISSIONS, total: 0, guilds: [] };
  if (p === "/api/public/sky/rewards") return { tracking: true, rewards: REWARDS.map((r) => Object.assign({}, r, { reached: 0, claimed: 0 })) };
  if (p === "/api/public/sky/hunter/10") return { tracking: true, charId: 10, name: "Sky Ace", guildId: null, guildName: null,
    clears: 0, floors: 0, lastAt: null, floorsRank: null, clearsRank: null, tr: null, trp: null,
    districts: [1, 2, 3, 4].map((d) => ({ district: d, clears: 0, floors: 0, lastAt: null })),
    rewards: REWARDS.map((r) => ({ id: r.id, kind: r.kind, threshold: r.threshold, itemId: r.itemId, itemName: r.itemName, quantity: r.quantity, reached: false, claimedAt: null })),
    guildMissions: null };
  return undefined;
}

const untracked = (p) => (p.startsWith("/api/public/sky/") ? { tracking: false, districts: [], entries: [], guilds: [], missions: [], rewards: [] } : undefined);
const missing = () => undefined; // every /api/public/sky/* answers 404

const HUNTER = { id: 10, name: "Sky Ace", hr: 999, gr: 100, weapon: "Lance", female: false, lastLogin: T,
  guildName: "Sky Guild", guildId: 100, guildRank: "Member", guildJoined: T, weaponTime: [], topMonsters: [] };

async function open(browser, url, sky, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  const asked = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const u = new URL(route.request().url());
    asked.push(u.pathname + u.search);
    let body = u.pathname.startsWith("/api/public/sky/") ? sky(u.pathname, u.searchParams)
      : u.pathname === "/api/public/hunters/10" ? HUNTER : undefined;
    if (body === undefined && !u.pathname.startsWith("/api/public/sky/")) body = u.pathname.includes("/quests/") ? { total: 0, rows: [] } : [];
    route.fulfill({ status: body === undefined ? 404 : 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body === undefined ? { message: "Not Found" } : body) });
  });
  await page.goto(url);
  return { page, errors, asked };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const hidden = (page, sel) => page.$eval(sel, (n) => n.hidden || n.offsetParent === null);

async function samplePage(browser, base) {
  const r = await open(browser, base + "/sky-corridor.html", sample);
  const page = r.page;
  await page.waitForSelector("#sky-districts .sky-district", { timeout: 5000 });
  await page.waitForSelector("#sky-board tbody a", { timeout: 5000 });
  await page.waitForSelector("#sky-guilds tbody a", { timeout: 5000 });
  check("sample: four districts", (await page.$$("#sky-districts .sky-district")).length === 4);
  const widths = await page.$$eval("#sky-districts .wb-fill", (f) => f.map((n) => n.style.width));
  check("sample: bar widths", widths.join() === "100%,100%,40%,60%,20%,48%,0%,0%", widths.join());
  check("sample: district 3 not in town", (await text(page, "#sky-districts .sky-district:nth-child(3)")).includes("Not shown in town"));
  check("sample: totals", (await text(page, "#sky-totals")).includes("650"));
  check("sample: soon hidden", await hidden(page, "#sky-soon"));
  const board = await page.$$eval("#sky-board tbody a", (as) => as.map((a) => a.getAttribute("href")));
  check("sample: board links", board.join() === "/hunters.html?id=11,/guilds.html?id=100,/hunters.html?id=12", board.join());
  check("sample: no guild shows -", (await text(page, "#sky-board tbody tr:nth-child(2) td:nth-child(5)")) === "-");
  await shot(page, "sky-sample-1280.png");

  await page.click('#sky-board-chips [data-board="clears"]');
  await page.click('#sky-district-chips [data-district="2"]');
  await page.click('#sky-period-chips [data-period="week"]');
  await page.waitForFunction(() => document.getElementById("sky-board-note").textContent.includes("since"), null, { timeout: 5000 });
  const last = r.asked.filter((a) => a.startsWith("/api/public/sky/leaderboard")).pop();
  check("sample: board request", last === "/api/public/sky/leaderboard?board=clears&district=2&period=week&limit=50", last);
  check("sample: week caveat shown", !(await hidden(page, "#sky-week-rule")));
  check("sample: board title", (await text(page, "#sky-board-title")) === "Duremudira clears, District 2, this week", await text(page, "#sky-board-title"));
  check("sample: clears column first", (await text(page, "#sky-board thead th:nth-child(3)")) === "Duremudira clears");

  check("sample: 11 mission pages", (await page.$$("#sky-page-chips .chip")).length === 11);
  await page.click('#sky-page-chips [data-page="2"]');
  const pageRows = await page.$$eval("#sky-page tbody tr", (rows) => rows.map((x) => x.textContent));
  check("sample: page 2 missions", pageRows.length === 3 && pageRows[0].includes("Cats saved") && pageRows[0].includes("13"), pageRows.join(" | "));
  const guild = await text(page, "#sky-guilds tbody tr");
  check("sample: guild missions", guild.includes("Cats saved (District 1) 10 / 6 · 100%") && guild.includes("5,000 / 20,000 · 25%"), guild);
  const rewards = await page.$$eval("#sky-rewards tbody tr", (rows) => rows.map((x) => x.textContent));
  check("sample: rewards order", rewards.length === 3 && rewards[0].startsWith("1 floor") && rewards[1].startsWith("10 floors")
    && rewards[2].startsWith("1 Duremudira clear"), rewards.join(" | "));
  check("sample: errors", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  const m = await open(browser, base + "/sky-corridor.html", sample, 375);
  await m.page.waitForSelector("#sky-guilds tbody a", { timeout: 5000 });
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("sample 375: no sideways scroll of the page", overflow <= 0, String(overflow));
  await shot(m.page, "sky-sample-375.png");
  await m.page.close();
}

async function emptyPage(browser, base) {
  for (const width of [1280, 375]) {
    const r = await open(browser, base + "/sky-corridor.html", empty, width);
    await r.page.waitForSelector("#sky-board .empty-cell", { timeout: 5000 });
    await r.page.waitForSelector("#sky-guilds .empty-cell", { timeout: 5000 });
    check("empty: board message", (await text(r.page, "#sky-board .empty-cell")).includes("Nobody has cleared a tower quest yet"));
    check("empty: guilds message", (await text(r.page, "#sky-guilds .empty-cell")).includes("No guild has started"));
    check("empty: last clear none", (await text(r.page, "#sky-totals")).includes("None yet"));
    check("empty: bars at 0", (await r.page.$$eval("#sky-districts .wb-fill", (f) => f.every((n) => n.style.width === "0%"))));
    check("empty: rewards listed", (await r.page.$$("#sky-rewards tbody tr")).length === 3);
    check("empty: errors", r.errors.length === 0, r.errors.join("; "));
    await shot(r.page, "sky-empty-" + width + ".png");
    await r.page.close();
  }
}

async function soonPage(browser, base) {
  for (const [label, api] of [["404", missing], ["tracking false", untracked]]) {
    for (const width of [1280, 375]) {
      const r = await open(browser, base + "/sky-corridor.html", api, width);
      await r.page.waitForFunction(() => !document.getElementById("sky-soon").hidden, null, { timeout: 5000 }).catch(() => {});
      check(`${label}: coming soon`, !(await hidden(r.page, "#sky-soon")) && (await text(r.page, "#sky-soon")).includes("Sky Corridor stats are coming soon"));
      for (const id of ["sky-overview", "leaderboard", "missions", "rewards"]) check(`${label}: #${id} hidden`, await hidden(r.page, "#" + id));
      check(`${label}: about still shown`, !(await hidden(r.page, "#about")));
      check(`${label}: no error text`, !/Could not load/.test(await text(r.page, "main")));
      check(`${label}: errors`, r.errors.length === 0, r.errors.join("; "));
      if (label === "404") await shot(r.page, "sky-404-" + width + ".png");
      await r.page.close();
    }
  }
}

async function hunterTab(browser, base) {
  let r = await open(browser, base + "/hunters.html?id=10#sky", sample);
  await r.page.waitForSelector("#tab-sky:not([hidden])", { timeout: 5000 });
  check("hunter: sky tab selected from #sky", (await r.page.getAttribute("#tab-sky", "aria-selected")) === "true");
  check("hunter: profile hidden", await hidden(r.page, "#panel-profile"));
  const sky = await text(r.page, "#panel-sky");
  check("hunter: ranks", sky.includes("#1") && sky.includes("#2"), sky.slice(0, 200));
  check("hunter: reward received", sky.includes("Tower Medal x10") && sky.includes("Not yet"));
  check("hunter: mission share", sky.includes("Cats saved") && sky.includes("40%"), sky);
  const g = await r.page.$$eval("#panel-sky a", (as) => as.map((a) => a.getAttribute("href")));
  check("hunter: links", g.includes("/guilds.html?id=100") && g.includes("/sky-corridor.html#leaderboard"), g.join());
  check("hunter: errors", r.errors.length === 0, r.errors.join("; "));
  await shot(r.page, "sky-hunter-1280.png");
  await r.page.setViewportSize({ width: 375, height: 900 });
  await shot(r.page, "sky-hunter-375.png");
  await r.page.close();

  for (const [label, api] of [["404", missing], ["nothing", empty], ["tracking false", untracked]]) {
    r = await open(browser, base + "/hunters.html?id=10#sky", api);
    await r.page.waitForSelector("#tab-profile", { timeout: 5000 });
    await r.page.waitForTimeout(400);
    check(`hunter ${label}: no sky tab`, await hidden(r.page, "#tab-sky"));
    check(`hunter ${label}: profile shown`, !(await hidden(r.page, "#panel-profile")));
    check(`hunter ${label}: errors`, r.errors.length === 0, r.errors.join("; "));
    await r.page.close();
  }
}

function helpers() {
  check("percent caps", Sky.percent(54, 25) === 100 && Sky.percent(10, 25) === 40 && Sky.percent(1, 0) === 0);
  check("milestone", Sky.milestone("floors", 1) === "1 floor" && Sky.milestone("clears", 25) === "25 Duremudira clears");
  check("mission labels", Object.keys(Sky.MISSION_TYPES).length === 6 && Sky.missionLabel("x") === "Unknown mission");
  check("hasData", !Sky.hunterHasData(null) && !Sky.hunterHasData({ tracking: false, clears: 3 })
    && !Sky.hunterHasData(empty("/api/public/sky/hunter/10")) && Sky.hunterHasData(sample("/api/public/sky/hunter/10"))
    && Sky.hunterHasData({ clears: 0, floors: 0, rewards: [], guildMissions: { missions: [{ mine: 1 }] } }));
}

(async () => {
  helpers();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await samplePage(browser, base);
    await emptyPage(browser, base);
    await soonPage(browser, base);
    await hunterTab(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    failures.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("sky corridor OK");
})().catch((e) => { console.error(e); process.exit(1); });
