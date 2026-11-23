#!/usr/bin/env node
/* Checks the admin Streamers tab (js/admin-streamers.js, tab-streamers / panel-streamers on admin.html) in headless
   Chromium against a fake API that follows /root/work/streamers-briefs/contract.md: games list/add/edit/toggle/delete,
   creators filter/approve/decline/remove, user text stays text, view-only staff get no buttons, tableReady false
   shows the note, staff without the tool get no tab.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-streamers.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".gif": "image/gif" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "HS256" }) + "." + b64({ sub: "wren", exp }) + ".sig";
}
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };

const EVIL = "Evil <b>Name</b>";
function game(id, name, over) {
  return Object.assign({ id, name, aliases: [], titleKeywords: [], twitchGameId: null, kickCategoryId: null, enabled: true,
    sortOrder: 0, updatedAt: "2026-11-23T10:00:00Z", updatedBy: "boss" }, over || {});
}
function creator(id, over) {
  return Object.assign({ id, discordId: "1000" + id, displayName: "Creator " + id, twitch: "twitch" + id, youtube: null, kick: null,
    tiktok: null, about: "", status: "pending", createdAt: "2026-11-22T10:00:00Z", updatedAt: "2026-11-22T10:00:00Z",
    decidedBy: null, decidedAt: null, followers: 0 }, over || {});
}

function newApi(tools, tableReady) {
  return {
    calls: [], tools, tableReady: tableReady !== false, nextId: 10,
    games: [game(1, "Monster Hunter Frontier Z", { aliases: ["MHF-Z"], titleKeywords: ["mhfz"], twitchGameId: "509658", kickCategoryId: "15" }),
      game(2, "Old <i>Game</i>", { enabled: false, sortOrder: 5 })],
    creators: [creator(1, { displayName: EVIL, about: "I <u>stream</u>", youtube: "@chan.nel", kick: "kk1", tiktok: "tt.1" }),
      creator(2, { status: "approved", decidedBy: "boss", decidedAt: "2026-11-22T12:00:00Z", followers: 3, youtube: "UC" + "a".repeat(22), twitch: null }),
      creator(3, { status: "declined" })]
  };
}

function fakeApi(page, api) {
  return page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const buf = req.postDataBuffer();
    const call = { method: req.method(), path: p + url.search, auth: req.headers().authorization || "" };
    if (buf) { try { call.body = JSON.parse(buf.toString()); } catch (e) { call.body = buf.toString(); } }
    api.calls.push(call);
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/permissions/mine") return reply(200, { roles: ["ROLE_MODERATOR"], admin: false, staff: true, tools: api.tools });
    let m;
    if (p === "/api/admin/streamers/games" && req.method() === "GET") {
      return reply(200, { tableReady: api.tableReady, items: api.tableReady ? api.games : [] });
    }
    if (p === "/api/admin/streamers/games" && req.method() === "POST") {
      if (api.games.some((g) => g.name.toLowerCase() === String(call.body.name).toLowerCase())) return reply(409, { message: "A game with that name is already listed." });
      const g = Object.assign(game(api.nextId++, call.body.name), call.body);
      api.games.push(g);
      return reply(200, g);
    }
    if ((m = p.match(/^\/api\/admin\/streamers\/games\/(\d+)$/))) {
      const i = api.games.findIndex((g) => g.id === Number(m[1]));
      if (i < 0) return reply(404, { message: "No such game." });
      if (req.method() === "PUT") { api.games[i] = Object.assign({}, api.games[i], call.body); return reply(200, api.games[i]); }
      if (req.method() === "DELETE") { api.games.splice(i, 1); return reply(200, { message: "Deleted." }); }
    }
    if (p === "/api/admin/streamers/creators" && req.method() === "GET") {
      if (!api.tableReady) return reply(200, { tableReady: false, counts: {}, items: [] });
      const st = url.searchParams.get("status") || "all";
      const counts = { pending: 0, approved: 0, declined: 0 };
      api.creators.forEach((c) => { counts[c.status] += 1; });
      return reply(200, { tableReady: true, counts, items: api.creators.filter((c) => st === "all" || c.status === st) });
    }
    if ((m = p.match(/^\/api\/admin\/streamers\/creators\/(\d+)(\/status)?$/))) {
      const i = api.creators.findIndex((c) => c.id === Number(m[1]));
      if (i < 0) return reply(404, { message: "No such creator." });
      if (m[2]) { api.creators[i].status = call.body.status; return reply(200, api.creators[i]); }
      if (req.method() === "DELETE") { api.creators.splice(i, 1); return reply(200, { message: "Removed." }); }
    }
    return reply(404, { message: "Not Found" });
  });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);

async function open(browser, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { page.__dialogs = (page.__dialogs || []).concat(d.message()); d.accept(); });
  await page.addInitScript((t) => {
    localStorage.setItem("hvmhfz.token", t);
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  }, TOKEN);
  await fakeApi(page, api);
  return { page, errors };
}

const last = (api, method) => api.calls.filter((c) => c.method === method).pop();

async function run() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();

  // ---- staff who may act ----
  let api = newApi({ streamers: ["view", "act"] });
  let r = await open(browser, api);
  let page = r.page;
  await page.goto(base + "/admin.html#streamers");
  await page.waitForSelector('[data-game="1"]');
  check("tab visible", !(await page.$eval("#tab-streamers", (t) => t.hidden)));
  const games = await text(page, "#st-games");
  check("games: names, other names, keywords, ids", games.indexOf("Monster Hunter Frontier Z") !== -1 && games.indexOf("MHF-Z") !== -1
    && games.indexOf("mhfz") !== -1 && games.indexOf("509658") !== -1 && games.indexOf("15") !== -1 && games.indexOf("Old <i>Game</i> (disabled)") !== -1, games);
  check("game markup stays text", (await page.$$("#st-games i, #st-creators b, #st-creators u")).length === 0);
  check("help line", (await text(page, "#streamers-panel")).indexOf("only they get went-live posts and follower DMs") !== -1);

  await page.click("#st-game-add");
  await page.fill("#st-f-name", "New Game");
  await page.fill("#st-f-aliases", "Alt one\n\n  Alt two  \n");
  await page.fill("#st-f-keywords", "kw");
  await page.fill("#st-f-twitch", "123");
  await page.fill("#st-f-order", "7");
  await page.click('#st-game-form button[type="submit"]');
  await page.waitForSelector('[data-game="10"]');
  let post = last(api, "POST");
  check("add: POST body", post.path === "/api/admin/streamers/games" && JSON.stringify(post.body) === JSON.stringify({ name: "New Game",
    aliases: ["Alt one", "Alt two"], titleKeywords: ["kw"], twitchGameId: "123", kickCategoryId: null, enabled: true, sortOrder: 7 }), JSON.stringify(post.body));

  await page.click("#st-game-add");
  await page.fill("#st-f-name", "new game");
  await page.click('#st-game-form button[type="submit"]');
  await page.waitForFunction(() => /already listed/.test(document.getElementById("st-alert").textContent));
  check("API error shown as it is", (await text(page, "#st-alert")) === "A game with that name is already listed.");
  await page.click("#st-game-form .ghost-btn");

  await page.click('[data-edit="1"]');
  check("edit form filled, lists one per line", (await page.inputValue("#st-f-aliases")) === "MHF-Z" && (await page.inputValue("#st-f-name")) === "Monster Hunter Frontier Z");
  await page.fill("#st-f-name", "MHF Z");
  await page.fill("#st-f-kick", "");
  await page.click('#st-game-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[data-game="1"] h3').textContent === "MHF Z");
  const put = last(api, "PUT");
  check("edit: PUT body", put.path === "/api/admin/streamers/games/1" && put.body.name === "MHF Z" && put.body.kickCategoryId === null
    && put.body.twitchGameId === "509658", JSON.stringify(put.body));

  await page.click('[data-toggle="2"]');
  await page.waitForFunction(() => document.querySelector('[data-game="2"] h3').textContent.indexOf("disabled") === -1);
  check("toggle: PUT enabled true", last(api, "PUT").body.enabled === true && last(api, "PUT").path.endsWith("/games/2"));

  await page.click('[data-delete="2"]');
  await page.waitForFunction(() => !document.querySelector('[data-game="2"]'));
  check("delete: confirm then DELETE", (page.__dialogs || []).length === 1 && last(api, "DELETE").path === "/api/admin/streamers/games/2");

  // creators
  await page.waitForSelector('[data-creator="1"]');
  const chips = await page.$$eval("#st-status-chips .chip", (c) => c.map((x) => x.textContent).join("|"));
  check("status chips with counts", chips === "Pending (1)|Approved (1)|Declined (1)|All (3)", chips);
  const card = await text(page, '[data-creator="1"]');
  check("creator: name as text, discord id, about, status", card.indexOf(EVIL) !== -1 && card.indexOf("Discord id 10001") !== -1
    && card.indexOf("I <u>stream</u>") !== -1 && card.indexOf("Pending") !== -1, card);
  const hrefs = await page.$$eval('[data-creator="1"] a', (a) => a.map((x) => x.getAttribute("href")));
  check("creator links", hrefs.join(" ") === "https://www.twitch.tv/twitch1 https://www.youtube.com/@chan.nel https://kick.com/kk1 https://www.tiktok.com/@tt.1", hrefs.join(" "));
  await page.click('#st-status-chips [data-status="approved"]');
  await page.waitForSelector('[data-creator="2"]');
  const yt = await page.$eval('[data-creator="2"] a', (a) => a.getAttribute("href"));
  check("approved filter, youtube channel link", yt === "https://www.youtube.com/channel/UC" + "a".repeat(22) && !(await page.$('[data-creator="1"]')), yt);
  check("decided by shown", (await text(page, '[data-creator="2"]')).indexOf("decided by boss") !== -1);
  await page.click('#st-status-chips [data-status="pending"]');
  await page.waitForSelector('[data-approve="1"]');
  await page.click('[data-approve="1"]');
  await page.waitForFunction(() => !document.querySelector('[data-creator="1"]'));
  post = last(api, "POST");
  check("approve: POST status", post.path === "/api/admin/streamers/creators/1/status" && post.body.status === "approved", JSON.stringify(post.body));
  await page.click('#st-status-chips [data-status="declined"]');
  await page.waitForSelector('[data-remove="3"]');
  await page.click('[data-remove="3"]');
  await page.waitForFunction(() => !document.querySelector('[data-creator="3"]'));
  check("remove: confirm then DELETE", (page.__dialogs || []).length === 2 && last(api, "DELETE").path === "/api/admin/streamers/creators/3");
  check("role note", (await text(page, "#streamers-panel")).indexOf("within a few minutes of a change here") !== -1);
  check("no page errors (act)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- view only ----
  api = newApi({ streamers: ["view"] });
  r = await open(browser, api);
  page = r.page;
  await page.goto(base + "/admin.html#streamers");
  await page.waitForSelector('[data-game="1"]');
  await page.waitForSelector('[data-creator="1"]');
  check("view only: no buttons", (await page.$$("[data-edit], [data-toggle], [data-delete], [data-approve], [data-decline], [data-remove]")).length === 0
    && await page.$eval("#st-game-add", (b) => b.hidden));
  check("no page errors (view)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- tables missing ----
  api = newApi({ streamers: ["view", "act"] }, false);
  r = await open(browser, api);
  page = r.page;
  await page.goto(base + "/admin.html#streamers");
  await page.waitForSelector("#st-games-missing:not([hidden])");
  check("tableReady false: notes", (await text(page, "#st-games-missing")).indexOf("db/streamers.sql") !== -1
    && !(await page.$eval("#st-creators-missing", (n) => n.hidden)));
  await page.close();

  // ---- no tool ----
  api = newApi({ flags: ["view"] });
  r = await open(browser, api);
  page = r.page;
  await page.goto(base + "/admin.html#streamers");
  await page.waitForSelector("#tab-flags:not([hidden])");
  check("without the tool: no tab, nothing asked", (await page.$eval("#tab-streamers", (t) => t.hidden))
    && !api.calls.some((c) => c.path.indexOf("/api/admin/streamers") === 0));
  await page.close();

  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAIL (" + failures.length + ")");
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("admin streamers OK");
}

run().catch((e) => { console.log("FAIL " + e.stack); process.exit(1); });
