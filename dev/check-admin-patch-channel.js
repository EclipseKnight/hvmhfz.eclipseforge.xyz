#!/usr/bin/env node
/* Checks the "Patch channel" column and the "Pre-release slots" panel on the admin panel's Users tab (js/admin.js)
   in headless Chromium against a fake API (GET /api/admin/users rows with "patchChannel", GET /api/admin/patch-slots,
   POST /api/admin/patch-channel):

   - the Status column shows a "pre: mods" badge for a slot and a dash for stable; the Playtester role is a checkbox in the Manage drawer;
   - each drawer has a Patch channel section with a select (Stable + each published slot + the user's own slot when it is not out)
     and a Set button; Set posts {"username", "channel"}, then the list is read again and the row changed;
   - the panel lists each slot (version, published, release id, notes, users) and "On a slot that is not out
     (they get stable)" with slot and users; "Could not load the pre-releases from the game server." when
     slotsAvailable is false; hidden when the API has no such endpoint;
   - a refusal (400 + message) shows the API's message in the drawer and leaves the row alone;
   - an API without the field has no Patch channel section;
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
      row(3, "player", ["ROLE_USER", "ROLE_PLAYTESTER"], channels.player)],
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
  await page.waitForSelector("#user-rows tr.user-row", { timeout: 5000 });
  return { page, errors };
}

// Opens the Manage drawer of an account (closing another one) and reads its patch channel section.
const manageOf = async (page, name) => {
  await page.keyboard.press("Escape");
  await page.click('#user-rows tr.user-row:has(.cell-name > span:first-child:text-is("' + name + '")) .user-manage');
};
const patchOf = async (page, name) => {
  await manageOf(page, name);
  return page.$$eval("#user-rows .user-drawer .user-patch", (boxes) => {
    const last = boxes[0];
    if (!last) return null;
    return { text: last.textContent.replace(/\s+/g, " ").trim(),
      badge: last.querySelector(".role-pre") ? last.querySelector(".role-pre").textContent : null,
      button: last.querySelector("button") ? last.querySelector("button").textContent : null,
      options: last.querySelector("select") ? Array.from(last.querySelector("select").options).map((o) => o.value + "=" + o.textContent) : null,
      selected: last.querySelector("select") ? last.querySelector("select").value : null };
  });
};
const statusOf = (page, name) => page.$eval('#user-rows tr.user-row:has(.cell-name > span:first-child:text-is("' + name + '")) .status-cell', (c) => c.textContent.trim());
const note = (page) => page.$eval("#user-rows .user-note", (n) => n.hidden ? "" : n.textContent).catch(() => "");

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    const state = { channels: { boss: "pre:mods", tester: "stable", player: "pre:ghost" }, posts: [], reads: 0, refuse: false };
    const { page, errors } = await open(browser, base, state);
    const head = await page.$$eval("#user-rows", (b) => Array.from(b[0].closest("table").querySelectorAll("thead th")).map((t) => t.textContent.trim()));
    check("columns end with Status and Manage", head.length === 8 && head[6] === "Status" && head[7] === "Manage", head.join(","));
    check("status cells: pre badge for a slot, dash for stable", (await statusOf(page, "boss")) === "pre: mods" && (await statusOf(page, "tester")) === "-" && (await statusOf(page, "player")) === "pre: ghost");
    const boss = await patchOf(page, "boss");
    const std = ["stable=Stable", "pre:mods=mods (v1.21-pre2)", "pre:balance=balance (v1.21-pre1)"];
    check("pre row: badge, select, button", boss && boss.badge === "pre: mods" && boss.button === "Set" && boss.selected === "pre:mods"
      && JSON.stringify(boss.options) === JSON.stringify(std), JSON.stringify(boss));
    const tester = await patchOf(page, "tester");
    check("stable row: text, select, button", tester && tester.badge === null && tester.text.includes("stable") && tester.button === "Set"
      && tester.selected === "stable" && JSON.stringify(tester.options) === JSON.stringify(std), JSON.stringify(tester));
    // The Playtester role is a checkbox in the drawer and a badge in the row.
    const pt = async (name) => {
      await manageOf(page, name);
      return { badge: await page.$$eval('#user-rows tr.user-row:has(.cell-name > span:first-child:text-is("' + name + '")) .role-badge.role-playtester', (b) => b.length),
        box: await page.$eval('#user-rows .user-drawer input[value="ROLE_PLAYTESTER"]', (i) => i.checked && !i.disabled), hint: (await page.textContent("#user-rows .user-drawer .role-checks")).includes("may choose a pre-release client patch") };
    };
    const ptPlayer = await pt("player"), ptBoss = await pt("boss");
    check("playtester badge, ticked box and hint", ptPlayer.badge === 1 && ptPlayer.box && ptPlayer.hint, J(ptPlayer));
    check("others: no badge, box not ticked", ptBoss.badge === 0 && ptBoss.box === false, J(ptBoss));
    const player = await patchOf(page, "player");
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
    await manageOf(page, "tester");
    await page.selectOption("#user-rows .user-drawer .user-patch select", "pre:balance");
    await page.click("#user-rows .user-drawer .user-patch button");
    await page.waitForFunction(() => /is on the pre:balance channel/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    check("POST body", J(state.posts) === J([{ username: "tester", channel: "pre:balance" }]), J(state.posts));
    check("message shown in the drawer", /tester is on the pre:balance channel\./.test(await note(page)), await note(page));
    await page.waitForFunction(() => /pre: balance/.test((document.querySelector("#user-rows .user-drawer .user-patch") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    const t2 = await patchOf(page, "tester");
    check("list read again, row now on balance", state.reads > reads && t2.badge === "pre: balance" && t2.selected === "pre:balance" && (await statusOf(page, "tester")) === "pre: balance", J(t2));
    check("panel updated", (await page.textContent("#patch-slots-body")).includes("On it: tester"));

    await manageOf(page, "boss");
    await page.selectOption("#user-rows .user-drawer .user-patch select", "stable");
    await page.click("#user-rows .user-drawer .user-patch button");
    await page.waitForFunction(() => !/pre: mods/.test(document.querySelector("#user-rows tr.user-row .status-cell").textContent), null, { timeout: 5000 }).catch(() => {});
    check("POST stable", J(state.posts[1]) === J({ username: "boss", channel: "stable" }), J(state.posts));
    check("row back to stable", (await statusOf(page, "boss")) === "-");

    state.refuse = true;
    await manageOf(page, "player");
    await page.selectOption("#user-rows .user-drawer .user-patch select", "pre:mods");
    await page.click("#user-rows .user-drawer .user-patch button");
    await page.waitForFunction(() => /cannot use/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    check("refusal message shown", (await note(page)) === "That account cannot use the pre-release patch.", await note(page));
    check("refused row unchanged, button usable", (await statusOf(page, "player")) === "pre: ghost" && !(await page.isDisabled("#user-rows .user-drawer .user-patch button")));
    check("no page errors", !errors.length, errors.join("; "));
    await page.close();

    // An API without the field.
    const old = await open(browser, base, { channels: {}, posts: [], reads: 0, noSlots: true });
    const o = await patchOf(old.page, "tester");
    check("old API: no patch channel section, no select", o === null && (await old.page.$$("#user-rows select")).length === 0 && (await statusOf(old.page, "tester")) === "-", JSON.stringify(o));
    check("old API: no slots panel", !(await old.page.isVisible("#patch-slots-panel")));
    check("old API: no page errors", !old.errors.length, old.errors.join("; "));

    // The slot list cannot be read: the panel says so, the select still has Stable.
    const down = await open(browser, base, { channels: { boss: "stable", tester: "stable", player: "stable" }, posts: [], reads: 0, slotsDown: true });
    check("slots down: panel message", (await down.page.textContent("#patch-slots-body")) === "Could not load the pre-releases from the game server.");
    const d = await patchOf(down.page, "tester");
    check("slots down: select has Stable only", J(d.options) === J(["stable=Stable"]), J(d));
    check("slots down: no page errors", !down.errors.length, down.errors.join("; "));
  } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("admin patch channel OK");
})();
