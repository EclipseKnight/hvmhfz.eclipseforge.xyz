#!/usr/bin/env node
/* Checks the "Patch channel" column on the admin panel's Users tab (js/admin.js) in headless Chromium against a
   fake API (GET /api/admin/users rows with "patchChannel", POST /api/admin/patch-channel):

   - the column follows Tester; a "pre" row shows a pre-release badge, a "stable" row says stable;
   - the button posts {"username", "channel"} (the other channel), then the list is read again and the row changed;
   - a refusal (400 + message) shows the API's message and leaves the row alone;
   - an API without the field shows "-" and no button;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-patch-channel.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
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
const jwt = (exp) => "e30." + Buffer.from(JSON.stringify({ sub: "boss", exp })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
const NOW = "2026-11-20T12:00:00Z";

function usersReply(channels) {
  const row = (id, username, roles, ch) => {
    const u = { id, username, roles, characters: 0, lastLogin: NOW, discordLinked: false, discordId: null, op: false,
      timer: false, characterList: [] };
    if (ch !== undefined) u.patchChannel = ch;
    return u;
  };
  return { total: 3, page: 0, size: 25, summary: { accounts: 3, admins: 1, moderators: 0, linked: 0 },
    users: [row(1, "boss", ["ROLE_ADMIN"], channels.boss), row(2, "tester", ["ROLE_TESTER"], channels.tester),
      row(3, "player", ["ROLE_USER"], channels.player)],
    patchTracking: false, patches: [] };
}

async function open(browser, base, state) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/users") { state.reads++; return reply(200, usersReply(state.channels)); }
    if (p === "/api/admin/patch-channel" && req.method() === "POST") {
      const body = JSON.parse(req.postData());
      state.posts.push(body);
      if (state.refuse) return reply(400, { message: "That account cannot use the pre-release patch." });
      state.channels[body.username] = body.channel;
      return reply(200, { message: body.username + " is on the " + body.channel + " patch." });
    }
    return reply(404, { message: "not in this check" });
  });
  await page.goto(base + "/admin.html#users");
  await page.waitForSelector("#user-rows tr td.cell-name", { timeout: 5000 });
  return { page, errors };
}

const rowOf = (page, name) => page.$$eval("#user-rows tr", (rows, n) => {
  const r = rows.find((x) => x.querySelector(".cell-name") && x.querySelector(".cell-name").textContent.startsWith(n));
  const cells = r.querySelectorAll("td");
  const last = cells[cells.length - 1];
  return { cells: cells.length, text: last.textContent.replace(/\s+/g, " ").trim(),
    badge: !!last.querySelector(".role-pre"), button: last.querySelector("button") ? last.querySelector("button").textContent : null };
}, name);

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    const state = { channels: { boss: "pre", tester: "stable", player: "stable" }, posts: [], reads: 0, refuse: false };
    const { page, errors } = await open(browser, base, state);
    const head = await page.$$eval("#user-rows", (b) => Array.from(b[0].closest("table").querySelectorAll("thead th")).map((t) => t.textContent));
    check("column after Tester", head.length === 11 && head[9] === "Tester" && head[10] === "Patch channel", head.join(","));
    let boss = await rowOf(page, "boss"), tester = await rowOf(page, "tester");
    check("pre row: badge and button", boss.cells === 11 && boss.badge && boss.text.includes("pre-release") && boss.button === "Make stable", JSON.stringify(boss));
    check("stable row: text and button", !tester.badge && tester.text.includes("stable") && tester.button === "Make pre-release", JSON.stringify(tester));

    const reads = state.reads;
    await page.click("#user-rows tr:nth-child(2) td:last-child button");
    await page.waitForFunction(() => /is on the pre patch/.test(document.getElementById("users-alert").textContent), null, { timeout: 5000 }).catch(() => {});
    check("POST body", JSON.stringify(state.posts) === JSON.stringify([{ username: "tester", channel: "pre" }]), JSON.stringify(state.posts));
    check("message shown", /tester is on the pre patch\./.test(await page.textContent("#users-alert")), await page.textContent("#users-alert"));
    await page.waitForFunction(() => document.querySelector("#user-rows tr:nth-child(2) .role-pre"), null, { timeout: 5000 }).catch(() => {});
    tester = await rowOf(page, "tester");
    check("list read again, row now pre-release", state.reads > reads && tester.badge && tester.button === "Make stable", JSON.stringify(tester));

    await page.click("#user-rows tr:nth-child(1) td:last-child button");
    await page.waitForFunction(() => !document.querySelector("#user-rows tr:nth-child(1) .role-pre"), null, { timeout: 5000 }).catch(() => {});
    check("POST stable", JSON.stringify(state.posts[1]) === JSON.stringify({ username: "boss", channel: "stable" }), JSON.stringify(state.posts));
    check("row back to stable", !(await rowOf(page, "boss")).badge);

    state.refuse = true;
    await page.click("#user-rows tr:nth-child(3) td:last-child button");
    await page.waitForFunction(() => /cannot use/.test(document.getElementById("users-alert").textContent), null, { timeout: 5000 }).catch(() => {});
    check("refusal message shown", (await page.textContent("#users-alert")) === "That account cannot use the pre-release patch.", await page.textContent("#users-alert"));
    const player = await rowOf(page, "player");
    check("refused row unchanged, button usable", !player.badge && player.button === "Make pre-release"
      && !(await page.isDisabled("#user-rows tr:nth-child(3) td:last-child button")), JSON.stringify(player));
    check("no page errors", !errors.length, errors.join("; "));
    await page.close();

    // An API without the field.
    const old = await open(browser, base, { channels: {}, posts: [], reads: 0 });
    const o = await rowOf(old.page, "tester");
    check("old API: dash and no button", o.cells === 11 && o.text === "-" && o.button === null, JSON.stringify(o));
    check("old API: no page errors", !old.errors.length, old.errors.join("; "));
  } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("admin patch channel OK");
})();
