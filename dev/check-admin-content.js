#!/usr/bin/env node
/* Checks the admin Content tab (js/admin-content.js) in headless Chromium against a fake API (shapes as the API's
   README, section "Event content editors"):

   - the groups and tables from GET /api/admin/content; a table's rows with item and quest names;
   - adding a row: the form built from the spec, the item search by name from the site's item list, the request
     body (numbers as numbers, empty fields left to the API, UTC times), the API's reasons under the form;
   - changing a row (PUT, prefilled), deleting only on the second click;
   - a locked table: the reason shown, no Edit or Delete, Save disabled;
   - event quests: Disable and Enable, a quest picked by name (the API's quest search);
   - gachas: the check column, a gacha's costs and prizes with their shares, a prize's items, the way back;
   - text from the API stays text (no markup); no horizontal overflow at 375 px;
   - the pure helpers under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (admin-content-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-content.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const C = require("../js/admin-content.js");

const root = path.join(__dirname, "..");
const shots = path.join(root, "dev-shots");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
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

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "HS256" }) + "." + b64({ sub: "boss", exp }) + ".sig";
}
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };

/* ---- the pure helpers ---- */

const F = (name, label, type, extra) => Object.assign({ name, label, type, nullable: false, min: null, max: null,
  maxBytes: 0, choices: null, names: "none", dflt: null, help: null }, extra || {});

function helpers() {
  const items = JSON.parse(fs.readFileSync(path.join(root, "data", "item-ids.json"), "utf8"));
  const hits = C.searchItems(items, "potion", 8);
  check("searchItems: names that start with it first, shortest first", hits.length === 8 && hits[0].name === "Potion" && hits[0].id === 7,
    JSON.stringify(hits.slice(0, 3)));
  check("searchItems: by number", JSON.stringify(C.searchItems(items, "1520")) === JSON.stringify([{ id: 1520, name: "Festi Ticket" }]));
  check("searchItems: 0 and nothing", C.searchItems(items, "0").length === 0 && C.searchItems(items, " ").length === 0);
  const fields = [F("type", "List", "choice", { choices: ["personal", "guild"] }), F("tier", "Tier", "int"),
    F("max_players", "Max", "int", { nullable: true }), F("title", "Title", "text"), F("note", "Note", "text", { dflt: "" }),
    F("enabled", "On", "bool", { dflt: true }), F("start_time", "Start", "time", { nullable: true })];
  const b = C.body(fields, { type: "guild", tier: " 2 ", max_players: "", title: "", note: "", enabled: false, start_time: "2026-11-23T03:00" });
  check("body", JSON.stringify(b) === JSON.stringify({ type: "guild", tier: 2, title: "", enabled: false, start_time: "2026-11-23T03:00:00Z" }),
    JSON.stringify(b));
  check("body: a non-number stays text for the API to refuse", C.body([F("tier", "Tier", "int")], { tier: "2.5" }).tier === "2.5");
  check("cell: name and number", C.cell(F("item_id", "Item", "int"), { item_id: 7, _labels: { item_id: "Potion" } }) === "Potion (7)");
  check("cell: empty optional", C.cell(F("max_rank", "Up to", "int", { nullable: true }), { max_rank: null }) === "-");
  check("cell: bool and time", C.cell(F("on", "On", "bool"), { on: true }) === "yes"
    && C.cell(F("t", "T", "time"), { t: "2026-11-23T03:00:00Z" }) === "2026-11-23 03:00");
  const s = C.shares([{ id: 1, entry_type: 0, weight: 0 }, { id: 2, entry_type: 100, weight: 600 }, { id: 3, entry_type: 100, weight: 400 }]);
  check("shares", s[2] === 60 && s[3] === 40 && s[1] === undefined, JSON.stringify(s));
  check("fromInput is UTC", C.fromInput("2026-11-23T03:00") === "2026-11-23T03:00:00Z" && C.fromInput("") === null);
}

/* ---- the fake API ---- */

const AT_ONCE = "At once: Erupe reads it at each request (no restart, no cache).";
const T = (key, group, title, fields, extra) => Object.assign({ key, group, title, table: key, id: "id", idGiven: false,
  fixed: {}, filters: [], parent: null, fields, maxRows: 0, effect: AT_ONCE, lockable: false }, extra || {});

const SPECS = {
  items: 16700, eventQuestsMax: 509, restart: "None of these edits needs an Erupe restart: Erupe reads the tables at each request.",
  groups: [
    { key: "festival", title: "Festival", tables: [
      T("festa-trials", "festival", "Festival trials", [F("objective", "Objective", "int", { min: 0, max: 65535 })], { maxRows: 255 }),
      T("festa-prizes", "festival", "Festival prizes", [F("type", "List", "choice", { choices: ["personal", "guild"] }),
        F("tier", "Tier", "int", { min: 1, max: 10 }), F("souls_req", "Souls needed", "int", { min: 0, max: 10000000 }),
        F("item_id", "Item", "int", { min: 1, max: 65535, names: "item" }), F("num_item", "Quantity", "int", { min: 1, max: 999 })],
      { lockable: true })] },
    { key: "diva", title: "Diva Defense", tables: [
      T("diva-rewards", "diva", "Diva rewards", [F("list", "List", "int"), F("quantity", "Quantity", "int")], { filters: ["list"], lockable: true }),
      T("diva-bonus-quests", "diva", "Diva bonus quest pool", [F("quest_id", "Quest", "int", { names: "quest" }),
        F("percent", "Monster points %", "int", { dflt: 200 })], { id: "quest_id", idGiven: true })] },
    { key: "event-quests", title: "Event quests", tables: [
      T("event-quests", "event-quests", "Event quests", [F("quest_id", "Quest", "int", { names: "quest" }), F("quest_type", "Quest type", "int"),
        F("start_time", "Start", "time", { dflt: "now" })])] },
    { key: "gachas", title: "Gachas", tables: [
      T("gachas", "gachas", "Gachas", [F("name", "Name", "text", { maxBytes: 255 }), F("gacha_type", "Kind", "int"), F("hidden", "Hidden", "bool", { dflt: true })]),
      T("gacha-entries", "gachas", "Gacha costs and prizes", [F("gacha_id", "Gacha", "int"), F("entry_type", "Group", "int"),
        F("weight", "Weight", "int", { dflt: 0 })], { filters: ["gacha_id"], parent: "gacha_id" }),
      T("gacha-items", "gachas", "Gacha prize items", [F("entry_id", "Prize row", "int"), F("item_type", "Kind", "int", { dflt: 7 }),
        F("item_id", "Item or amount", "int", { names: "item_if_type7" })], { filters: ["entry_id"], parent: "entry_id" })] }
  ]
};

function rowsOf(api, key, query) {
  if (key === "festa-trials") return { tableReady: true, lock: null, count: 1, maxRows: 255, rows: [{ id: 1, objective: 3, _labels: {} }] };
  if (key === "festa-prizes") return { tableReady: true, lock: null, count: api.prizes.length, maxRows: 0, rows: api.prizes };
  if (key === "diva-rewards") return { tableReady: true, lock: "Diva Defense is in its rewards week: claims point at these rows, so they can't change until it ends.",
    count: 1, rows: [{ id: 4, list: 1, quantity: 500, _labels: {} }] };
  if (key === "diva-bonus-quests") return { tableReady: true, count: 1, maxRows: 200, rows: [{ quest_id: 58043, percent: 200, _labels: { quest_id: "Keoaruboru！" } }] };
  if (key === "event-quests") return { tableReady: true, listed: 1, listedMax: 509, count: 1, rows: [
    { id: 10, quest_id: 58043, quest_type: 46, start_time: "2026-11-01T00:00:00Z", _labels: { quest_id: "Keoaruboru！" } },
    { id: 11, quest_id: 58011, quest_type: 46, start_time: "2026-11-01T00:00:00Z", _labels: { quest_id: "HC Support" }, _disabled: true,
      _disabledBy: "boss", _disabledAt: "2026-11-04T12:00:00Z" }] };
  if (key === "gachas") return { tableReady: true, count: 2, maxRows: 100, rows: [
    { id: 3, name: "<img src=x onerror=alert(1)>Materials", gacha_type: 0, hidden: false, _labels: {}, _problems: [] },
    { id: 4, name: "New", gacha_type: 4, hidden: true, _labels: {}, _problems: ["no prize"] }] };
  if (key === "gacha-entries") return { tableReady: true, count: 3, rows: query.get("gacha_id") === "3" ? [
    { id: 20, gacha_id: 3, entry_type: 0, weight: 0, _labels: {} },
    { id: 21, gacha_id: 3, entry_type: 100, weight: 600, _labels: {} },
    { id: 22, gacha_id: 3, entry_type: 100, weight: 400, _labels: {} }] : [] };
  if (key === "gacha-items") return { tableReady: true, count: 1, rows: [{ id: 30, entry_id: 21, item_type: 7, item_id: 7, _labels: { item_id: "Potion" } }] };
  return null;
}

function fakeApi(page, api) {
  page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    api.calls.push({ method: req.method(), path: p + url.search, body: sent });
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/content") return reply(200, SPECS);
    if (p === "/api/admin/content/quest-search") return reply(200, [{ id: 58043, name: "Keoaruboru！", category: "G Event" }]);
    let m = p.match(/^\/api\/admin\/content\/([a-z-]+)$/);
    if (m && req.method() === "GET") {
      const r = rowsOf(api, m[1], url.searchParams);
      return r ? reply(200, r) : reply(404, { message: "No content table called \"" + m[1] + "\"." });
    }
    if (m && req.method() === "POST") {
      if (sent.souls_req === undefined && m[1] === "festa-prizes") {
        return reply(400, { message: "Souls needed is required.", problems: ["Souls needed is required.", "Item: 16999 is not an item of the item list."] });
      }
      const row = Object.assign({ id: 50 }, sent, { _labels: { item_id: "Potion" } });
      if (m[1] === "festa-prizes") api.prizes.push(row);
      return reply(201, { table: m[1], id: 50, row, warnings: m[1] === "gacha-entries" ? ["Gacha 3 is shown to players and has a problem: prize 50 has 0 items (1-5)"] : [] });
    }
    m = p.match(/^\/api\/admin\/content\/([a-z-]+)\/(\d+)$/);
    if (m && req.method() === "PUT") return reply(200, { table: m[1], id: Number(m[2]), row: sent, warnings: [] });
    m = p.match(/^\/api\/admin\/content\/(.+)\/(\d+)\/(delete|disable|enable)$/);
    if (m) return reply(200, { table: m[1], id: Number(m[2]), row: {}, warnings: [] });
    if (p === "/api/admin/content/gachas/4/check") return reply(200, { id: 4, ok: false, problems: ["no prize"] });
    return reply(404, { message: "Not Found" });
  });
}

async function open(browser, url, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push("dialog: " + d.message()); d.dismiss(); });
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  fakeApi(page, api);
  await page.goto(url);
  return { page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const last = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).pop();
const button = (page, scope, label) => page.locator(scope + " button", { hasText: label });

function prizes() {
  return [{ id: 41, type: "guild", tier: 2, souls_req: 5000, item_id: 1520, num_item: 3, _labels: { item_id: "Festi Ticket" } }];
}

async function adminPage(browser, base) {
  const api = { calls: [], prizes: prizes() };
  const { page, errors } = await open(browser, base + "/admin.html#content", api, 1280);
  await page.waitForSelector("#content-groups .chip");
  check("groups", (await page.$$eval("#content-groups .chip", (n) => n.map((x) => x.textContent))).join() === "Festival,Diva Defense,Event quests,Gachas");
  await page.waitForSelector("#content-rows tr td");
  check("first table opened", (await text(page, "#content-title")) === "Festival trials");
  check("note: no restart", /no.*restart/i.test(await text(page, "#content-note")));
  check("count with the cap", (await text(page, "#content-count")) === "1 row of at most 255");

  // Festival prizes: rows with item names.
  await button(page, "#content-tables", "Festival prizes").click();
  await page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("Festi Ticket (1520)") !== -1);
  check("table chip pressed", (await page.getAttribute("#content-tables .chip:nth-child(2)", "aria-pressed")) === "true");

  // Add: item picked by name from the site's item list.
  await page.selectOption("#content-f-type", "guild");
  await page.fill("#content-f-tier", "2");
  await page.fill("#content-f-souls_req", "6000");
  await page.fill(".content-pick .content-search", "potion");
  await page.waitForSelector(".content-pick .admin-suggest:not([hidden]) button");
  check("item search: Potion first", (await text(page, ".content-pick .admin-suggest button")) === "Potion (7)");
  await page.click(".content-pick .admin-suggest button");
  check("item picked: number", (await page.inputValue("#content-f-item_id")) === "7");
  check("item picked: name shown", (await text(page, ".content-pick .content-name")) === "Potion");
  await page.fill("#content-f-num_item", "3");
  await page.click("#content-save");
  await page.waitForSelector("#content-ok:not([hidden])");
  const add = last(api, "POST", "/api/admin/content/festa-prizes");
  check("add body", add && JSON.stringify(add.body) === JSON.stringify({ type: "guild", tier: 2, souls_req: 6000, item_id: 7, num_item: 3 }),
    add && JSON.stringify(add.body));
  check("add: said, with when it takes effect", /Added: Festival prizes #50\. At once/.test(await text(page, "#content-ok")));

  // A refusal: every reason under the form.
  await page.fill("#content-f-tier", "1");
  await page.fill("#content-f-item_id", "16999");
  await page.click("#content-save");
  await page.waitForSelector("#content-problems:not([hidden])");
  check("refusal: reasons", (await page.$$eval("#content-problems li", (n) => n.map((x) => x.textContent))).length === 2);

  // Change: prefilled, PUT.
  await page.locator("#content-rows tr", { hasText: "Festi Ticket" }).locator("button", { hasText: "Edit" }).click();
  check("edit: prefilled", (await page.inputValue("#content-f-souls_req")) === "5000" && (await text(page, "#content-form-title")) === "Change #41");
  check("edit: item name shown", (await page.$$eval(".content-name", (n) => n.map((x) => x.textContent))).indexOf("Festi Ticket") !== -1);
  await page.fill("#content-f-num_item", "4");
  await page.click("#content-save");
  await page.waitForSelector("#content-ok:not([hidden])");
  const edit = last(api, "PUT", "/api/admin/content/festa-prizes/41");
  check("edit: PUT", edit && edit.body.num_item === 4 && edit.body.item_id === 1520, edit && JSON.stringify(edit.body));

  // Delete: only on the second click.
  const del = () => page.locator("#content-rows tr", { hasText: "Festi Ticket" }).locator("button", { hasText: /Delete|delete/ });
  await del().click();
  check("delete: first click asks", !last(api, "POST", "/festa-prizes/41/delete") && /Click again/.test(await del().textContent()));
  await del().click();
  await page.waitForFunction(() => /Deleted/.test(document.getElementById("content-ok").textContent));
  check("delete: second click deletes", !!last(api, "POST", "/api/admin/content/festa-prizes/41/delete"));
  await shot(page, "admin-content-1280.png");

  // A locked table.
  await button(page, "#content-groups", "Diva Defense").click();
  await page.waitForSelector("#content-lock:not([hidden])");
  check("lock: reason", /^Locked: Diva Defense is in its rewards week/.test(await text(page, "#content-lock")));
  check("lock: no edit or delete", (await page.$$("#content-rows button")).length === 0);
  check("lock: save disabled", await page.isDisabled("#content-save"));
  check("diva: list filter", !!(await page.$("#content-filter-list")));

  // A table keyed by quest: the quest picked by name.
  await button(page, "#content-tables", "Diva bonus quest pool").click();
  await page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("Keoaruboru") !== -1);
  check("quest key shown as a column", (await page.$$eval("#content-head th", (n) => n.map((x) => x.textContent))).indexOf("Quest") !== -1);
  await page.fill(".content-pick .content-search", "keoa");
  await page.waitForSelector(".content-pick .admin-suggest:not([hidden]) button");
  await page.click(".content-pick .admin-suggest button");
  check("quest picked", (await page.inputValue("#content-f-quest_id")) === "58043");
  check("quest search asked the API", !!last(api, "GET", "/api/admin/content/quest-search?q=keoa"));

  // Event quests: disable and enable.
  await button(page, "#content-groups", "Event quests").click();
  await page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("Disabled by boss") !== -1);
  check("event quests: count against the cap", /^1 listed of at most 509/.test(await text(page, "#content-count")));
  await page.locator("#content-rows tr", { hasText: "Keoaruboru" }).locator("button", { hasText: "Disable" }).click();
  await page.waitForFunction(() => /Disabled: Event quests #10/.test(document.getElementById("content-ok").textContent));
  await page.locator("#content-rows tr.is-disabled").locator("button", { hasText: "Enable" }).click();
  await page.waitForFunction(() => /Enabled: Event quests #11/.test(document.getElementById("content-ok").textContent));
  check("event quests: endpoints", !!last(api, "POST", "/event-quests/10/disable") && !!last(api, "POST", "/event-quests/11/enable"));

  // Gachas: the check column, costs and prizes with shares, a prize's items, the way back.
  await button(page, "#content-groups", "Gachas").click();
  await page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("no prize") !== -1);
  check("gacha name stays text", (await page.$$("#content-rows img")).length === 0
    && (await text(page, "#content-rows")).indexOf("<img src=x onerror=alert(1)>Materials") !== -1);
  check("child tables have no chip", (await page.$$eval("#content-tables .chip", (n) => n.map((x) => x.textContent))).join() === "Gachas");
  await page.locator("#content-rows tr", { hasText: "New" }).locator("button", { hasText: "Check" }).click();
  await page.waitForSelector("#content-problems:not([hidden])");
  check("gacha check shown", (await text(page, "#content-problems")) === "no prize");
  await page.locator("#content-rows tr", { hasText: "Materials" }).locator("button", { hasText: "Costs and prizes" }).click();
  await page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("60 %") !== -1);
  check("entries: filtered by the gacha", !!last(api, "GET", "/api/admin/content/gacha-entries?gacha_id=3"));
  check("entries: title says whose", /^Gacha costs and prizes of gacha 3/.test(await text(page, "#content-title")));
  check("entries: shares", (await text(page, "#content-rows")).indexOf("40 %") !== -1);
  check("entries: parent prefilled", (await page.inputValue("#content-f-gacha_id")) === "3");
  await page.fill("#content-f-entry_type", "100");
  await page.click("#content-save");
  await page.waitForSelector("#content-problems:not([hidden]) li.is-ok");
  check("entries: a warning after saving", /shown to players and has a problem/.test(await text(page, "#content-problems")));
  check("entries: body has the gacha", last(api, "POST", "/api/admin/content/gacha-entries").body.gacha_id === 3);
  await page.locator("#content-rows tr", { hasText: "600" }).locator("button", { hasText: "Items" }).click();
  await page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("Potion (7)") !== -1);
  check("items: filtered by the row", !!last(api, "GET", "/api/admin/content/gacha-items?entry_id=21"));
  check("trail: two ways back", (await page.$$eval("#content-trail button", (n) => n.map((x) => x.textContent))).join("|")
    === "Back to gacha 3 (<img src=x onerror=alert(1)>Materials)|Back to row 21", await text(page, "#content-trail"));
  await page.locator("#content-trail button", { hasText: "Back to row 21" }).click();
  await page.waitForFunction(() => document.getElementById("content-title").textContent.indexOf("Gacha costs and prizes") === 0);
  check("trail: back to the gacha's rows", (await page.$$("#content-trail button")).length === 1);

  check("admin: no page errors", errors.length === 0, errors.join(" | "));
  await page.close();

  const small = await open(browser, base + "/admin.html#content", { calls: [], prizes: prizes() }, 375);
  await small.page.waitForSelector("#content-rows tr td");
  await button(small.page, "#content-groups", "Festival").click();
  await button(small.page, "#content-tables", "Festival prizes").click();
  await small.page.waitForFunction(() => document.getElementById("content-rows").textContent.indexOf("Festi Ticket") !== -1);
  const overflow = await small.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("admin 375: no horizontal overflow", overflow <= 0, overflow + " px");
  await shot(small.page, "admin-content-375.png");
  check("admin 375: no page errors", small.errors.length === 0, small.errors.join(" | "));
  await small.page.close();
}

(async () => {
  helpers();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await adminPage(browser, base);
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("FAIL\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("admin content OK");
})();
