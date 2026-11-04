#!/usr/bin/env node
/* Checks the admin panel's Notices tab (js/admin-notices.js) in headless Chromium against a fake API (shapes as the
   API's README, sections "Notices" and "Live settings"):

   - login notices: the pages from the live settings section login_notices (config.json's when nothing is stored),
     the MHFML preview (colours, centre, line breaks, an unknown tag kept as text), add a page, Save = the
     settings check then PUT with the version edited;
   - Send now: the counter (bytes in game, characters on Discord), the API's check on the first click, the send on
     the second, a target that fails said plainly;
   - scheduled notices: Schedule sends the UTC time typed, the planned and past lists, Cancel on the second click, a
     missing table says so;
   - markup in a notice stays text; no horizontal overflow at 375 px; no page errors;
   - the pure helpers under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (admin-notices-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-notices.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const N = require("../js/admin-notices.js");

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
const NOW = "2026-11-20T12:00:00Z";
const SAMPLE = "<BODY><CENTER><SIZE_3><C_4>Welcome to Hunsterverse!<BR><BODY><LEFT><SIZE_2><C_5>Read the rules<C_7> please<BR><BODY><WAT>";

function loginView(api) {
  return { spec: { name: "login_notices", title: "Login notices", effect: "At the next login", help: "MHFML.", rules: [],
    fields: [] }, stored: api.loginStored, defaults: { hide: false, notices: [SAMPLE] }, effective: null,
    state: { state: api.loginStored ? "waiting" : "default" } };
}

function row(id, at, text, status, extra) {
  return Object.assign({ id, sendAt: at, text, toGame: true, toDiscord: false, status, result: null, claimedAt: null,
    doneAt: null, createdBy: "boss", createdAt: NOW, cancelledBy: null }, extra || {});
}

function fakeApi(page, api) {
  page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    api.calls.push({ method: req.method(), path: p, body: sent });
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/settings/login_notices" && req.method() === "GET") return reply(200, loginView(api));
    if (p === "/api/admin/settings/login_notices/check") return reply(200, { problems: [], changes: [] });
    if (p === "/api/admin/settings/login_notices" && req.method() === "PUT") {
      api.loginStored = { value: sent.value, version: 5, updatedBy: "boss", updatedAt: NOW, note: sent.note };
      return reply(200, { section: { stored: api.loginStored }, changes: [] });
    }
    if (p === "/api/admin/notices/check") {
      const problems = /🎉/.test(sent.text) && sent.game ? ["The game can't show these characters: 🎉"] : [];
      return reply(200, { problems });
    }
    if (p === "/api/admin/notices/send") {
      if (sent.discord) return reply(502, { ok: false, outcomes: [], summary: "game: sent=12; discord: FAILED (HTTP 403)" });
      return reply(200, { ok: true, outcomes: [{ target: "game", ok: true, detail: "sent=12" }], summary: "game: sent=12" });
    }
    if (p === "/api/admin/notices/scheduled" && req.method() === "GET") {
      if (api.noTable) return reply(200, { now: NOW, tableReady: false, planned: [], recent: [] });
      return reply(200, { now: NOW, tableReady: true, planned: api.planned, recent: api.recent });
    }
    if (p === "/api/admin/notices/scheduled" && req.method() === "POST") {
      const n = row(7, sent.sendAt, sent.text, "planned", { toGame: sent.game, toDiscord: sent.discord });
      api.planned.push(n);
      return reply(200, n);
    }
    const m = p.match(/^\/api\/admin\/notices\/scheduled\/(\d+)\/cancel$/);
    if (m) {
      const n = api.planned.find((x) => x.id === Number(m[1]));
      api.planned = api.planned.filter((x) => x !== n);
      n.status = "cancelled"; n.cancelledBy = "boss";
      api.recent.unshift(n);
      return reply(200, n);
    }
    return reply(404, { message: "Not Found" });
  });
}

function freshApi(extra) {
  return Object.assign({ calls: [], loginStored: null,
    planned: [row(3, "2026-11-20T15:00:00Z", "Festival in 1 hour <b>bold?</b>", "planned")],
    recent: [row(2, "2026-11-19T15:00:00Z", "Cup opens", "sent", { result: "game: sent=12" }),
      row(1, "2026-11-18T15:00:00Z", "Old", "missed", { result: "missed: due ..." })] }, extra || {});
}

async function open(browser, url, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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

function pure() {
  check("utf8Bytes ascii", N.utf8Bytes("abc") === 3);
  check("utf8Bytes é", N.utf8Bytes("é") === 2);
  check("utf8Bytes kanji", N.utf8Bytes("祭") === 3);
  check("utf8Bytes emoji", N.utf8Bytes("🎉") === 4);
  check("counter in game over 240", N.counter("x".repeat(241), true, false).over);
  check("counter at 240 ok", !N.counter("x".repeat(240), true, false).over);
  check("counter line break", N.counter("a\nb", true, false).over);
  check("counter Discord takes line breaks", !N.counter("a\nb", false, true).over);
  check("counter text", N.counter("hey", true, true).text === "In game: 3/240 bytes · Discord: 3/2000", N.counter("hey", true, true).text);
  check("utcFromBox", N.utcFromBox("2026-11-20T14:05") === "2026-11-20T14:05:00Z");
  check("utcFromBox empty", N.utcFromBox("") === null);
  const lines = N.parseMhfml(SAMPLE);
  check("mhfml lines", lines.length === 3, JSON.stringify(lines));
  check("mhfml centre", lines[0].align === "center");
  check("mhfml colour C_4", lines[0].spans[0].colour === "#ffd75e" && lines[0].spans[0].size === 3);
  check("mhfml back to C_7", lines[1].spans[1].text === " please" && lines[1].spans[1].colour === "#f2f2f2");
  check("mhfml unknown tag kept", lines[2].spans[0].text === "<WAT>" && lines[2].spans[0].unknown);
  check("utc", N.utc("2026-11-20T15:00:00Z") === "Fri 20 Nov 2026 15:00 UTC");
}

async function main() {
  pure();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    const api = freshApi();
    const { page, errors } = await open(browser, base + "/admin.html#notices", api);
    await page.waitForSelector("#not-login-list textarea");
    check("tab selected", await page.getAttribute("#tab-notices", "aria-selected") === "true");

    // Login notices from config.json, with the preview.
    check("login state says config", (await page.textContent("#not-login-state")).includes("config.json"));
    const prev = page.locator(".mhfml-preview").first();
    check("preview text", (await prev.textContent()).includes("Welcome to Hunsterverse!"));
    const colour = await prev.locator("span").first().evaluate((s) => getComputedStyle(s).color);
    check("preview colour C_4", colour === "rgb(255, 215, 94)", colour);
    const bg = await prev.evaluate((d) => getComputedStyle(d).backgroundColor);
    check("preview is dark", bg === "rgb(20, 17, 12)", bg);
    check("preview lines", await prev.locator(".mhfml-line").count() === 3);
    check("preview unknown tag", (await prev.locator(".mhfml-unknown").textContent()) === "<WAT>");
    await page.fill("#not-login-0", "<BODY><C_5>Maintenance Tuesday");
    check("preview follows typing", (await prev.textContent()) === "Maintenance Tuesday");
    await page.click("#not-login-add");
    check("page added", await page.locator("#not-login-list textarea").count() === 2);
    await page.fill("#not-login-1", "<BODY>Second page");
    await page.click("#not-login-save");
    await page.waitForSelector("#not-ok:not([hidden])");
    const put = api.calls.find((c) => c.method === "PUT");
    check("login save PUT", put && put.body.expectedVersion === 0 && put.body.value.hide === false
      && put.body.value.notices.length === 2 && put.body.value.notices[0] === "<BODY><C_5>Maintenance Tuesday", JSON.stringify(put));
    check("login check before save", api.calls.findIndex((c) => c.path.endsWith("/login_notices/check")) < api.calls.indexOf(put));
    await page.waitForFunction(() => document.getElementById("not-login-state").textContent.includes("version 5"));

    // Send now: counter, two clicks.
    await page.fill("#not-send-text", "x".repeat(241));
    check("counter over", await page.locator("#not-send-count.over").count() === 1);
    await page.fill("#not-send-text", "Event at 20:00 UTC");
    check("counter ok", (await page.textContent("#not-send-count")) === "In game: 18/240 bytes");
    await page.click("#not-send-btn");
    await page.waitForFunction(() => document.getElementById("not-send-btn").textContent.startsWith("Click again"));
    check("nothing sent on the first click", !api.calls.some((c) => c.path === "/api/admin/notices/send"));
    await page.click("#not-send-btn");
    await page.waitForFunction(() => document.getElementById("not-ok").textContent.startsWith("Sent."));
    const send = api.calls.find((c) => c.path === "/api/admin/notices/send");
    check("send body", send && send.body.text === "Event at 20:00 UTC" && send.body.game === true && send.body.discord === false,
      JSON.stringify(send && send.body));
    // A refused text shows the problems; a failed target says so.
    await page.fill("#not-send-text", "Party 🎉");
    await page.click("#not-send-btn");
    await page.waitForSelector("#not-send-problems:not([hidden])");
    check("check problem shown", (await page.textContent("#not-send-problems")).includes("can't show"));
    await page.fill("#not-send-text", "Both");
    await page.check("#not-send-discord");
    await page.click("#not-send-btn");
    await page.waitForFunction(() => document.getElementById("not-send-btn").textContent.startsWith("Click again"));
    await page.click("#not-send-btn");
    await page.waitForSelector("#not-alert:not([hidden])");
    check("failed target said", (await page.textContent("#not-alert")).includes("discord: FAILED"));

    // Scheduled: lists, markup stays text, schedule, cancel.
    check("planned listed", (await page.textContent("#not-planned")).includes("Fri 20 Nov 2026 15:00 UTC"));
    check("markup stays text", await page.locator("#not-planned b").count() === 0
      && (await page.textContent("#not-planned")).includes("<b>bold?</b>"));
    check("recent statuses", (await page.textContent("#not-recent")).includes("missed"));
    await page.fill("#not-sched-text", "Cup opens in 1 hour");
    await page.fill("#not-sched-at", "2026-11-20T14:00");
    await page.click("#not-sched-btn");
    await page.waitForFunction(() => document.getElementById("not-ok").textContent.includes("#7 planned"));
    const sch = api.calls.find((c) => c.path === "/api/admin/notices/scheduled" && c.method === "POST");
    check("schedule body", sch && sch.body.sendAt === "2026-11-20T14:00:00Z" && sch.body.text === "Cup opens in 1 hour", JSON.stringify(sch && sch.body));
    await page.waitForFunction(() => document.getElementById("not-planned").textContent.includes("Cup opens in 1 hour"));
    const cancelBtn = page.locator("#not-planned button").first();
    await cancelBtn.click();
    check("cancel asks first", (await cancelBtn.textContent()).startsWith("Click again"));
    check("nothing cancelled on the first click", !api.calls.some((c) => c.path.endsWith("/cancel")));
    await cancelBtn.click();
    await page.waitForFunction(() => document.getElementById("not-recent").textContent.includes("cancelled"));
    await shot(page, "admin-notices-1280.png");
    check("no page errors", errors.length === 0, errors.join("; "));
    await page.close();

    // Missing table; 375 px.
    const r = await open(browser, base + "/admin.html#notices", freshApi({ noTable: true }), 375);
    await r.page.waitForSelector("#not-sched-missing:not([hidden])");
    check("form hidden without the table", await r.page.locator("#not-sched-form").isHidden());
    await r.page.waitForSelector("#not-login-list textarea");
    const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("no overflow at 375 px", overflow <= 0, String(overflow));
    await shot(r.page, "admin-notices-375.png");
    check("no page errors at 375", r.errors.length === 0, r.errors.join("; "));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("FAIL\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("admin notices OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
