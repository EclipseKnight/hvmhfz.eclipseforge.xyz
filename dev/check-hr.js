#!/usr/bin/env node
/* Checks that HR is shown the way the game shows it (js/hr.js):

   - under node: the stored-HR -> game-rank table at its edges (1, 29 | 30, 49 | 50, 98 | 99, 298 | 299, 997 |
     998 | 999), "HR100 (HR4)" and "HR999 (HR7)", and nothing for 0, a missing or an invalid HR;
   - in headless Chromium against a fake API: the hunter list (the label in the HR column, the header still
     sorts by the stored number: the cell's data-sort), the hunter profile's Record panel, and the site
     search's hunter row (search.js loads hr.js itself on a page that does not).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-hr.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Hr = require("../js/hr.js");

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

const failures = [];
function check(name, ok, detail) { if (!ok) failures.push(name + (detail ? ": " + detail : "")); }

// The owner's table: stored HR -> the game's rank.
const TABLE = [[1, 1], [29, 1], [30, 2], [49, 2], [50, 3], [98, 3], [99, 4], [100, 4], [298, 4], [299, 5], [997, 5],
  [998, 6], [999, 7]];
TABLE.forEach(([hr, rank]) => {
  check("rank(" + hr + ")", Hr.rank(hr) === rank, "got " + Hr.rank(hr));
  check("label(" + hr + ")", Hr.label(hr) === "HR" + hr + " (HR" + rank + ")", "got " + Hr.label(hr));
});
check("label(100)", Hr.label(100) === "HR100 (HR4)");
check("label(999)", Hr.label(999) === "HR999 (HR7)");
[0, null, undefined, "", "abc", NaN, -5].forEach((v) => {
  check("no rank for " + String(v), Hr.rank(v) === 0 && Hr.label(v) === "", Hr.label(v));
});
check("a numeric string works", Hr.label("100") === "HR100 (HR4)");

const HUNTERS = [
  { id: 1, name: "Low", hr: 29, gr: 0, weapon: "Lance", guildName: "G", lastLogin: "2026-11-01T10:00:00Z" },
  { id: 2, name: "Mid", hr: 100, gr: 5, weapon: "Bow", guildName: null, lastLogin: "2026-11-01T10:00:00Z" },
  { id: 3, name: "Top", hr: 999, gr: 300, weapon: "Sword", guildName: "G", lastLogin: "2026-11-01T10:00:00Z" }
];
const API = /api\.hvmhfz\.eclipseforge\.xyz/;
const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.route(API, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/public/hunters") return json(route, { items: HUNTERS, total: 3, page: 0, size: 30 });
    if (/^\/api\/public\/hunters\/2$/.test(url.pathname)) {
      return json(route, { id: 2, name: "Mid", hr: 100, gr: 5, weapon: "Bow", topMonsters: [], weaponTime: [] });
    }
    if (url.pathname === "/api/public/search") {
      return json(route, { guilds: [], items: [], monsters: [], hunters: [{ id: 3, name: "Top", hr: 999, gr: 300, weapon: "Sword" }] });
    }
    return json(route, {});
  });

  const list = await context.newPage();
  await list.goto(base + "/hunters.html");
  await list.waitForSelector("#hunter-body tr td.cell-name", { timeout: 5000 }).catch(() => {});
  const cells = await list.$$eval("#hunter-body tr", (trs) => trs.map((tr) => [tr.cells[2].textContent, tr.cells[2].dataset.sort]));
  check("hunter list HR column", JSON.stringify(cells) === JSON.stringify([["HR29 (HR1)", "29"], ["HR100 (HR4)", "100"], ["HR999 (HR7)", "999"]]),
    JSON.stringify(cells));

  const profile = await context.newPage();
  await profile.goto(base + "/hunters.html?id=2");
  await profile.waitForSelector(".guild-stats .guild-stat", { timeout: 5000 }).catch(() => {});
  const record = await profile.$$eval(".guild-stats .guild-stat", (cards) => cards.map((c) => c.textContent).join("|"));
  check("hunter profile Record", /Hunter rank.*HR100 \(HR4\)/.test(record), record);

  // search on a page that does not load hr.js (search.js fetches it for the hunter rows)
  const home = await context.newPage();
  await home.goto(base + "/guilds.html");
  check("guilds page has no hr.js of its own", (await home.evaluate(() => typeof window.HvHr)) === "undefined");
  await home.keyboard.press("Control+k");
  await home.keyboard.type("top");
  await home.waitForFunction(() => /HR999 \(HR7\)/.test(document.body.textContent), null, { timeout: 5000 }).catch(() => {});
  const row = await home.evaluate(() => (document.querySelector(".cmdk-list, .cmdk") || document.body).textContent);
  check("search hunter row", /HR999 \(HR7\) · GR 300 · Sword/.test(row), row.slice(0, 200));

  await browser.close();
  server.close();
  failures.forEach((f) => console.log("FAIL " + f));
  console.log(failures.length ? failures.length + " failure(s)" : "HR display OK");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
