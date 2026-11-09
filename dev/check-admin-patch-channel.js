#!/usr/bin/env node
/* Checks the "Patch channel" column and the "Pre-release slots" panel on the admin panel's Users tab (js/admin.js)
   in headless Chromium against a fake API (GET /api/admin/users rows with "patchChannel", GET /api/admin/patch-slots,
   POST /api/admin/patch-channel):

   - the column follows Tester; a "pre:mods" row shows a "pre: mods" badge, a "stable" row says stable;
   - each row has a select (Stable + each published slot + the user's own slot when it is not out) and a Set button;
     Set posts {"username", "channel"}, then the list is read again and the row changed;
   - the panel lists each slot (version, published, release id, notes, users) and "On a slot that is not out
     (they get stable)" with slot and users; "Could not load the pre-releases from the game server." when
     slotsAvailable is false; hidden when the API has no such endpoint;
   - a refusal (400 + message) shows the API's message and leaves the row alone;
   - an API without the field shows "-" and no select;
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

const J = JSON.stringify;
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const jwt = (exp) => "e30." + Buffer.from(JSON.stringify({ sub: "boss", exp })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
const NOW = "2026-11-20T12:00:00Z";
const slotsReply = (channels) => {
  const on = (slot) => Object.keys(channels).filter((n) => channels[n] === "pre:" + slot).map((n, i) => ({ id: i + 1, username: n }));
  return { slotsAvailable: true,
    slots: [{ slot: "mods", version: "v1.21-pre2", notes: ["Quick retire", "Skip <b>wait</b>"], published: "2026-11-09T21:15:37Z",
      release: "20261109T211537Z-d60ee84fea4b", users: on("mods") },
    { slot: "balance", version: "v1.21-pre1", notes: [], published: "2026-11-09T18:00:00Z", release: "20261109T180000Z-aaaaaaaaaaaa", users: on("balance") }],
    unpublished: on("ghost").length ? [{ slot: "ghost", users: on("ghost") }] : [] };
};

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
    if (p === "/api/admin/patch-slots") {
      if (state.noSlots) return reply(404, { message: "Not found" });
      return reply(200, state.slotsDown ? { slotsAvailable: false, slots: [], unpublished: [] } : slotsReply(state.channels));
    }
    if (p === "/api/admin/patch-channel" && req.method() === "POST") {
      const body = JSON.parse(req.postData());
      state.posts.push(body);
      if (state.refuse) return reply(400, { message: "That account cannot use the pre-release patch." });
      state.channels[body.username] = body.channel;
      return reply(200, { message: body.username + " is on the " + body.channel + " channel." });
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
    badge: last.querySelector(".role-pre") ? last.querySelector(".role-pre").textContent : null,
    button: last.querySelector("button") ? last.querySelector("button").textContent : null,
    options: last.querySelector("select") ? Array.from(last.querySelector("select").options).map((o) => o.value + "=" + o.textContent) : null,
    selected: last.querySelector("select") ? last.querySelector("select").value : null };
}, name);

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    const state = { channels: { boss: "pre:mods", tester: "stable", player: "pre:ghost" }, posts: [], reads: 0, refuse: false };
    const { page, errors } = await open(browser, base, state);
    const head = await page.$$eval("#user-rows", (b) => Array.from(b[0].closest("table").querySelectorAll("thead th")).map((t) => t.textContent));
    check("column after Tester", head.length === 11 && head[9] === "Tester" && head[10] === "Patch channel", head.join(","));
    let boss = await rowOf(page, "boss"), tester = await rowOf(page, "tester"), player = await rowOf(page, "player");
    const std = ["stable=Stable", "pre:mods=mods (v1.21-pre2)", "pre:balance=balance (v1.21-pre1)"];
    check("pre row: badge, select, button", boss.cells === 11 && boss.badge === "pre: mods" && boss.button === "Set" && boss.selected === "pre:mods"
      && JSON.stringify(boss.options) === JSON.stringify(std), JSON.stringify(boss));
    check("stable row: text, select, button", tester.badge === null && tester.text.includes("stable") && tester.button === "Set"
      && tester.selected === "stable" && JSON.stringify(tester.options) === JSON.stringify(std), JSON.stringify(tester));
    check("unpublished slot offered for its user", player.badge === "pre: ghost" && player.selected === "pre:ghost"
      && JSON.stringify(player.options) === JSON.stringify(std.concat(["pre:ghost=ghost (not out)"])), JSON.stringify(player));

    // The slots panel.
    check("panel shown", await page.isVisible("#patch-slots-panel") && (await page.textContent("#patch-slots-panel h2")) === "Pre-release slots");
    const panel = await page.textContent("#patch-slots-body");
    check("panel: mods slot", panel.includes("mods v1.21-pre2") && panel.includes("release 20261109T211537Z-d60ee84fea4b") && /published (9 Nov|Nov 9), 21:15 UTC/.test(panel), panel);
    check("panel: notes", J(await page.$$eval("#patch-slots-body .patch-slot-notes li", (n) => n.map((x) => x.textContent))) === J(["Quick retire", "Skip <b>wait</b>"]));
    check("panel: users on the slot", panel.includes("On it: boss"), panel);
    check("panel: empty slot", panel.includes("balance v1.21-pre1") && panel.includes("On it: nobody"), panel);
    check("panel: unpublished", panel.includes("On a slot that is not out (they get stable)") && panel.includes("ghost: player"), panel);
    check("panel: API text not parsed as HTML", (await page.$$("#patch-slots-body li b")).length === 0);

    // Set a user to a slot, then back to stable.
    const reads = state.reads;
    await page.selectOption("#user-rows tr:nth-child(2) td:last-child select", "pre:balance");
    await page.click("#user-rows tr:nth-child(2) td:last-child button");
    await page.waitForFunction(() => /is on the pre:balance channel/.test(document.getElementById("users-alert").textContent), null, { timeout: 5000 }).catch(() => {});
    check("POST body", J(state.posts) === J([{ username: "tester", channel: "pre:balance" }]), J(state.posts));
    check("message shown", /tester is on the pre:balance channel\./.test(await page.textContent("#users-alert")), await page.textContent("#users-alert"));
    await page.waitForFunction(() => /pre: balance/.test(document.querySelector("#user-rows tr:nth-child(2) td:last-child").textContent), null, { timeout: 5000 }).catch(() => {});
    tester = await rowOf(page, "tester");
    check("list read again, row now on balance", state.reads > reads && tester.badge === "pre: balance" && tester.selected === "pre:balance", J(tester));
    check("panel updated", (await page.textContent("#patch-slots-body")).includes("On it: tester"));

    await page.selectOption("#user-rows tr:nth-child(1) td:last-child select", "stable");
    await page.click("#user-rows tr:nth-child(1) td:last-child button");
    await page.waitForFunction(() => !/pre: mods/.test(document.querySelector("#user-rows tr:nth-child(1) td:last-child").textContent), null, { timeout: 5000 }).catch(() => {});
    check("POST stable", J(state.posts[1]) === J({ username: "boss", channel: "stable" }), J(state.posts));
    check("row back to stable", (await rowOf(page, "boss")).badge === null);

    state.refuse = true;
    await page.selectOption("#user-rows tr:nth-child(3) td:last-child select", "pre:mods");
    await page.click("#user-rows tr:nth-child(3) td:last-child button");
    await page.waitForFunction(() => /cannot use/.test(document.getElementById("users-alert").textContent), null, { timeout: 5000 }).catch(() => {});
    check("refusal message shown", (await page.textContent("#users-alert")) === "That account cannot use the pre-release patch.", await page.textContent("#users-alert"));
    player = await rowOf(page, "player");
    check("refused row unchanged, button usable", player.badge === "pre: ghost"
      && !(await page.isDisabled("#user-rows tr:nth-child(3) td:last-child button")), JSON.stringify(player));
    check("no page errors", !errors.length, errors.join("; "));
    await page.close();

    // An API without the field.
    const old = await open(browser, base, { channels: {}, posts: [], reads: 0, noSlots: true });
    const o = await rowOf(old.page, "tester");
    check("old API: dash and no button", o.cells === 11 && o.text === "-" && o.button === null && o.options === null, JSON.stringify(o));
    check("old API: no slots panel", !(await old.page.isVisible("#patch-slots-panel")));
    check("old API: no page errors", !old.errors.length, old.errors.join("; "));

    // The slot list cannot be read: the panel says so, rows still get Stable.
    const down = await open(browser, base, { channels: { boss: "stable", tester: "stable", player: "stable" }, posts: [], reads: 0, slotsDown: true });
    check("slots down: panel message", (await down.page.textContent("#patch-slots-body")) === "Could not load the pre-releases from the game server.");
    const d = await rowOf(down.page, "tester");
    check("slots down: select has Stable only", J(d.options) === J(["stable=Stable"]), J(d));
    check("slots down: no page errors", !down.errors.length, down.errors.join("; "));
  } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("admin patch channel OK");
})();
