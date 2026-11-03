#!/usr/bin/env node
/* Checks, in headless Chromium against a fake API, that hunter and guild names link the exact page when the
   API sends the ids (API 5b6d085: charId, partyMembers, guildId) and fall back to the name when it does not
   (an older API), and that a refused quest upload or Road draft save shows the API's reason:

   - worlds.html, recent quests: the hunter and each party member (partyMembers) link /hunters.html?id=;
   - hunters.html?id=: the quest log's party and the guild badge (guildId -> /guilds.html?id=);
   - leaderboards.html, weapon board: top hunters link /hunters.html?id=;
   - the same pages against answers without those fields: the old ?name= links, nothing broken;
   - account.html#quests: a refused upload shows the message (400, 413, 409, a bare 401 from an older API,
     an answer that is not JSON), never "Unexpected end of JSON input";
   - the Road drafts panel (js/road-drafts.js): the same for a refused save.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-exact-links.js

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

/* The fake API's answers; withIds = false drops every field the API added in 5b6d085. */
function answers(withIds) {
  const row = (extra) => Object.assign({ hunter: "Aldra", quest: "Slay it", questId: 23051, result: "clear",
    party: ["Bexo", "Bexo"], durationSeconds: 600, clearSeconds: 500, endedAt: "2026-11-03T00:00:00Z" }, extra);
  const ids = withIds ? { charId: 101, partyMembers: [{ charId: 102, name: "Bexo" }, { charId: 202, name: "Bexo" }] } : {};
  const profile = Object.assign({ id: 101, name: "Aldra", hr: 999, gr: 100, weapon: "Sword", female: false,
    lastLogin: "2026-11-03T00:00:00Z", guildName: "Moon", guildRank: "Master", guildJoined: "2026-01-01T00:00:00Z" },
  withIds ? { guildId: 55 } : {});
  return {
    "/api/public/quests/stats": { clears: 1, fails: 0, total: 1, unknown: 0, range: "24h", topQuests: [] },
    "/api/public/quests/recent": { rows: [row(ids)] },
    "/api/public/quests/hunter/101": { total: 1, rows: [row(ids)] },
    "/api/public/hunters/101": profile,
    "/api/public/weapons/leaderboard": { seconds: 7200, weapons: [{ weapon: "Sword", seconds: 7200, hunters: 1,
      top: [Object.assign({ hunter: "Aldra", seconds: 7200 }, withIds ? { charId: 101 } : {})] }] }
  };
}

/* A token that has not expired (the account page redirects to the sign-in page on one that has). */
const TOKEN = "e30." + Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url") + ".x";
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

async function open(browser, url, table) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const body = table[p];
    route.fulfill({ status: body === undefined ? 404 : 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body === undefined ? {} : body) });
  });
  await page.goto(url);
  return { page, errors };
}

async function hrefs(page, selector) {
  await page.waitForSelector(selector, { timeout: 5000 });
  return page.$$eval(selector, (as) => as.map((a) => a.getAttribute("href")));
}

async function links(browser, base, withIds) {
  const tag = withIds ? "with ids" : "without ids";
  const table = answers(withIds);
  let r = await open(browser, base + "/worlds.html", table);
  const worlds = await hrefs(r.page, "#quest-recent-body td.cell-name a");
  check(`worlds hunter (${tag})`, worlds[0] === (withIds ? "/hunters.html?id=101" : "/hunters.html?name=Aldra"), String(worlds));
  const party = await r.page.$$eval("#quest-recent-body td.quest-party a", (as) => as.map((a) => a.getAttribute("href")));
  check(`worlds party (${tag})`, withIds ? party.join() === "/hunters.html?id=102,/hunters.html?id=202" : party.length === 0, String(party));
  check(`worlds party text (${tag})`, (await r.page.textContent("#quest-recent-body td.quest-party")) === "Bexo, Bexo");
  check(`worlds errors (${tag})`, r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  r = await open(browser, base + "/hunters.html?id=101", table);
  const log = await hrefs(r.page, "td.quest-party a");
  check(`quest log party (${tag})`, log.join() === (withIds ? "/hunters.html?id=102,/hunters.html?id=202"
    : "/hunters.html?name=Bexo,/hunters.html?name=Bexo"), String(log));
  const guild = await hrefs(r.page, "a.badge.good");
  check(`guild badge (${tag})`, guild[0] === (withIds ? "/guilds.html?id=55" : "/guilds.html?name=Moon"), String(guild));
  check(`hunter errors (${tag})`, r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  r = await open(browser, base + "/leaderboards.html", table);
  const weapons = await hrefs(r.page, "#weapon-board-body a");
  check(`weapon board (${tag})`, weapons[0] === (withIds ? "/hunters.html?id=101" : "/hunters.html?name=Aldra"), String(weapons));
  check(`weapon board errors (${tag})`, r.errors.length === 0, r.errors.join("; "));
  await r.page.close();
}

/* One refused POST: status and raw body; the page must show shown. */
const REFUSALS = [
  { label: "400 with message", status: 400, body: JSON.stringify({ message: "Not a quest file: bad header" }), shown: "Not a quest file: bad header" },
  { label: "413 with message", status: 413, body: JSON.stringify({ message: "That file is bigger than 64 KB" }), shown: "That file is bigger than 64 KB" },
  { label: "409 with message", status: 409, body: JSON.stringify({ message: "You already have 5 submissions waiting" }), shown: "You already have 5 submissions waiting" },
  { label: "bare 401", status: 401, body: "", shown: "sign-in has run out" },
  { label: "bare 413", status: 413, body: "", shown: "too big" },
  { label: "502 not JSON", status: 502, body: "<html>Bad gateway</html>", shown: "HTTP 502" }
];

async function submissions(browser, base) {
  for (const refusal of REFUSALS) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
    await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname;
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (p === "/api/account/quest-submissions" && req.method() === "POST") {
        return route.fulfill({ status: refusal.status, contentType: "application/json", headers: cors, body: refusal.body });
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: p === "/api/account" ? "{}" : "[]" });
    });
    await page.goto(base + "/account.html#quests");
    await page.setInputFiles("#quest-file", { name: "q.mhf", mimeType: "application/octet-stream", buffer: Buffer.from("abc") });
    await page.evaluate(() => { document.getElementById("quest-submit").click(); });
    await page.waitForFunction(() => document.getElementById("quest-submit-note").textContent !== "", null, { timeout: 5000 });
    const text = await page.textContent("#quest-submit-note");
    check(`quest upload refused: ${refusal.label}`, text.includes(refusal.shown) && !/JSON/.test(text), text);
    check(`quest upload errors: ${refusal.label}`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}

async function drafts(browser, base) {
  for (const refusal of REFUSALS) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
    const html = '<!doctype html><body><table><tbody id="road-drafts-list"></tbody></table><button id="road-draft-save">Save</button>'
      + '<p id="road-drafts-note"></p><script>window.roadDraftState=function(){return {name:"X",edits:{a:1}}};'
      + 'window.roadDraftId=function(){return null};</script><script src="/js/road-drafts.js"></script></body>';
    await page.route(base + "/__drafts.html", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
    await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
      const req = route.request();
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (req.method() === "POST") return route.fulfill({ status: refusal.status, contentType: "application/json", headers: cors, body: refusal.body });
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "[]" });
    });
    await page.goto(base + "/__drafts.html");
    await page.evaluate(() => { document.getElementById("road-draft-save").click(); });
    // the shown text, as the Save button words it (autosave only repeats it after 15 s)
    const wanted = refusal.status === 502 ? "HTTP 502" : refusal.shown;
    await page.waitForFunction((w) => document.getElementById("road-drafts-note").textContent.includes(w), wanted, { timeout: 5000 })
      .catch(() => {});
    const text = await page.textContent("#road-drafts-note");
    check(`road draft refused: ${refusal.label}`, text.includes(wanted) && !/JSON/.test(text), text);
    check(`road draft errors: ${refusal.label}`, errors.length === 0, errors.join("; "));
    await page.close();
  }
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await links(browser, base, true);
    await links(browser, base, false);
    await submissions(browser, base);
    await drafts(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("exact links and refusal messages OK");
})().catch((e) => { console.error(e); process.exit(1); });
