#!/usr/bin/env node
/* Checks the admin panel's Users tab (js/admin.js, #panel-users) in headless Chromium against a fake API
   (GET /api/admin/users, GET /api/admin/roles/available, PUT /api/admin/roles/users/{id}, POST /api/admin/roles,
   POST /api/admin/users/{id}/discord, GET /api/admin/patch-slots, GET /api/admin/permissions/mine):

   - one row per account with no button but Manage (and Copy id when a Discord account is linked);
   - the Discord cell: the name with @username, the id in the title, only the id when the API has no name, "not linked";
     the search sends query and match (all, discord) and highlights the match;
   - Manage (or a click on the row) opens one drawer at a time; Esc and Close shut it; it shows every role as a
     checkbox with the current ones ticked, the own admin box disabled, Save disabled until something changed;
   - Save sends one PUT with the full set of editable roles; removing a staff role takes a second click ("Confirm save");
     a 400 message is shown; the drawer stays open after the list reloads; a 404 on the PUT falls back to one
     POST /api/admin/roles per changed role;
   - Discord Unlink takes two clicks; a moderator (not an admin) sees the roles read only, no Save;
   - on a 390 px screen the page does not scroll sideways outside the table wrap.

   Screenshots go to /srv/devbot/.bot-logs/users-tab/ (SHOTS=<dir> to change): after-users-1280.png,
   after-users-390.png, after-drawer-1280.png.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-users.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS || "/srv/devbot/.bot-logs/users-tab";
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
const jwt = (exp) => "e30." + Buffer.from(J({ sub: "boss", exp })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
const NOW = "2026-11-20T12:00:00Z";
const EDITABLE = ["ROLE_HELPER", "ROLE_MODERATOR", "ROLE_ADMIN", "ROLE_TESTER", "ROLE_PLAYTESTER"];
const AVAILABLE = { roles: [{ role: "ROLE_USER", editable: false }].concat(EDITABLE.map((role) => ({ role, editable: true })), [{ role: "ROLE_BOT", editable: false }]) };

const chars = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id * 10 + i, name: "Hunter" + id + "x" + i, hr: 100 + i, gr: 0, weapon: "Sword",
  deleted: false, isNew: false, lastLogin: NOW }));
function newState(extra) {
  const row = (id, username, roles, discord, n) => Object.assign({ id, username, roles, characters: n, lastLogin: NOW, discordLinked: !!(discord && discord.discordId),
    discordId: null, op: false, timer: false, patchChannel: "stable", characterList: chars(id, n) }, discord || {});
  return Object.assign({
    users: [
      row(1, "boss", ["ROLE_USER", "ROLE_ADMIN"], { discordId: "123456789012345678", discordName: "Boss Man", discordUsername: "bossman", discordNameFetchedAt: NOW }, 5),
      row(2, "tester", ["ROLE_USER", "ROLE_TESTER"], { discordId: "223456789012345678" }, 2),
      row(3, "player", ["ROLE_USER"], null, 0),
      row(4, "helper1", ["ROLE_USER", "ROLE_HELPER"], { discordId: "323456789012345678", discordName: "Zed", discordUsername: "zed_99" }, 1),
      row(5, "modeo", ["ROLE_USER", "ROLE_MODERATOR"], null, 3)],
    gets: [], puts: [], posts: [], discordPosts: [], putStatus: null, putMessage: null, mine: null, available: AVAILABLE
  }, extra || {});
}

async function open(browser, base, state, width, hash) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => { localStorage.setItem("hvmhfz.token", t); localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); }, TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: J(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    let m;
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/permissions/mine") return state.mine ? reply(200, state.mine) : reply(404, { message: "Not Found" });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/patch-slots") return reply(200, { slotsAvailable: true, slots: [{ slot: "mods", version: "v1.21-pre2", notes: [], published: NOW, release: "r", users: [] }], unpublished: [] });
    if (p === "/api/admin/roles/available") return state.available ? reply(200, state.available) : reply(404, { message: "Not Found" });
    if (p === "/api/admin/users") {
      state.gets.push({ query: url.searchParams.get("query"), match: url.searchParams.get("match") });
      return reply(200, { total: state.users.length, page: 0, size: 25, summary: { accounts: state.users.length, admins: 1, moderators: 1, linked: 3 },
        users: state.users, patchTracking: false, patches: [] });
    }
    if ((m = p.match(/^\/api\/admin\/roles\/users\/(\d+)$/)) && req.method() === "PUT") {
      state.puts.push({ id: Number(m[1]), body: sent });
      if (state.putStatus) return reply(state.putStatus, { message: state.putMessage || "Not found" });
      const u = state.users.find((x) => x.id === Number(m[1]));
      u.roles = u.roles.filter((r) => EDITABLE.indexOf(r) === -1).concat(sent.roles);
      return reply(200, { message: "Roles of " + u.username + " saved.", roles: u.roles });
    }
    if (p === "/api/admin/roles" && req.method() === "POST") {
      state.posts.push(sent);
      const u = state.users.find((x) => x.username === sent.username);
      u.roles = sent.grant ? u.roles.concat(sent.role) : u.roles.filter((r) => r !== sent.role);
      return reply(200, { message: "ok" });
    }
    if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/discord$/))) {
      state.discordPosts.push({ id: Number(m[1]), body: sent });
      state.users.find((x) => x.id === Number(m[1])).discordId = sent.discordId || null;
      return reply(200, { message: sent.discordId ? "Linked." : "Unlinked." });
    }
    return reply(404, { message: "not in this check" });
  });
  await page.goto(base + "/admin.html#" + (hash || "users"));
  await page.waitForSelector("#user-rows tr.user-row", { timeout: 5000 });
  return { page, errors };
}

const rowSel = (name) => '#user-rows tr.user-row:has(.cell-name > span:first-child:text-is("' + name + '"))';
const manage = (page, name) => page.click(rowSel(name) + " .user-manage");
const drawers = (page) => page.$$eval("#user-rows .user-drawer", (d) => d.length);
const checks = (page) => page.$$eval("#user-rows .user-drawer .role-check input", (c) => c.map((x) => x.value + (x.checked ? "+" : "-") + (x.disabled ? "!" : "")));
const text = (page, sel) => page.$eval(sel, (n) => n.textContent.replace(/\s+/g, " ").trim());
const shot = async (page, name) => { fs.mkdirSync(shots, { recursive: true }); await page.addStyleTag({ content: ".site-nav{position:static !important}" }); await page.screenshot({ path: path.join(shots, name), fullPage: true }); };
const settle = (page) => page.waitForTimeout(250);

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---- rows ----
    let state = newState();
    let { page, errors } = await open(browser, base, state);
    const head = await page.$$eval("#users-panel .users-table thead th", (h) => h.map((x) => x.textContent.trim()));
    check("columns", J(head) === J(["#", "Account", "Discord", "Roles", "Characters", "Last login", "Status", "Manage"]), J(head));
    const buttons = await page.$$eval("#user-rows tr.user-row", (rows) => rows.map((r) => Array.from(r.querySelectorAll("button")).map((b) => b.textContent)));
    check("rows: only Manage (and Copy id)", buttons.every((b) => b.filter((x) => x !== "Copy id").join() === "Manage" && b.length <= 2), J(buttons));
    check("rows: Copy id only with a Discord account", J(buttons.map((b) => b.length)) === J([2, 2, 1, 2, 1]), J(buttons));
    check("rank cells kept", (await page.$$eval("#user-rows td.rank", (c) => c.map((x) => x.textContent))).join() === "1,2,3,4,5");
    check("you marker", (await text(page, rowSel("boss") + " .cell-name")).includes("you"));
    const disc = await page.$eval(rowSel("boss") + " .discord-cell", (c) => ({ name: c.querySelector(".discord-name").textContent, user: c.querySelector(".discord-user").textContent,
      title: c.querySelector(".discord-line").title, hasId: !!c.querySelector(".discord-id") }));
    check("discord name, @username and id in the title", disc.name === "Boss Man" && disc.user === "@bossman" && disc.title.includes("123456789012345678") && !disc.hasId, J(disc));
    check("no name: the id as today", (await text(page, rowSel("tester") + " .discord-cell .discord-id")) === "223456789012345678");
    check("not linked", (await text(page, rowSel("player") + " .discord-cell")) === "not linked");
    check("characters: count and at most 3 chips", (await page.$$eval(rowSel("boss") + " .char-chip", (c) => c.length)) === 3
      && (await text(page, rowSel("boss") + " .char-cell")).includes("5") && (await text(page, rowSel("boss") + " .char-rest")) === "+2 more in Manage");
    check("status badges", (await text(page, rowSel("boss") + " .status-cell")) === "-" && (await text(page, rowSel("modeo") + " .status-cell")) === "-");
    check("search placeholder and option", (await page.getAttribute("#user-search", "placeholder")) === "Search account, character, Discord name or id"
      && (await page.$$eval("#user-match option", (o) => o.map((x) => x.value))).join() === "all,account,character,discord");
    check("table cells are 8", (await page.$$eval("#user-rows tr.user-row", (r) => r.every((x) => x.cells.length === 8))));
    await shot(page, "after-users-1280.png");

    // ---- search ----
    await page.fill("#user-search", "bossman");
    await page.waitForFunction(() => document.querySelector("#user-rows .discord-user.is-match"), null, { timeout: 4000 }).catch(() => {});
    check("search sends query and match=all", J(state.gets[state.gets.length - 1]) === J({ query: "bossman", match: "all" }), J(state.gets));
    check("matching @username highlighted", (await page.$$eval("#user-rows .discord-user.is-match", (n) => n.map((x) => x.textContent))).join() === "@bossman");
    await page.selectOption("#user-match", "discord");
    await page.waitForFunction(() => true);
    await settle(page);
    check("search sends match=discord", J(state.gets[state.gets.length - 1]) === J({ query: "bossman", match: "discord" }), J(state.gets));
    await page.fill("#user-search", "2234567");
    await settle(page);
    await page.waitForFunction(() => document.querySelector("#user-rows .discord-id.is-match"), null, { timeout: 4000 }).catch(() => {});
    check("matching id highlighted", (await page.$$eval("#user-rows .discord-id.is-match", (n) => n.length)) === 1 && J(state.gets[state.gets.length - 1]) === J({ query: "2234567", match: "discord" }), J(state.gets[state.gets.length - 1]));
    await page.fill("#user-search", "");
    await settle(page);

    // ---- the drawer ----
    await manage(page, "tester");
    check("drawer opens under the row", (await drawers(page)) === 1 && (await page.$eval(rowSel("tester"), (r) => r.nextElementSibling.classList.contains("user-drawer") && r.nextElementSibling.cells.length === 1
      && r.nextElementSibling.cells[0].colSpan === 8)));
    check("every role is a checkbox, current ticked", J(await checks(page)) === J(["ROLE_USER+!", "ROLE_HELPER-", "ROLE_MODERATOR-", "ROLE_ADMIN-", "ROLE_TESTER+", "ROLE_PLAYTESTER-", "ROLE_BOT-!"]), J(await checks(page)));
    check("hints on the role boxes", (await text(page, "#user-rows .user-drawer .role-checks")).includes("Custom quest and road tester"));
    check("Save disabled until a change", await page.isDisabled("#user-rows .user-drawer .role-actions .btn"));
    check("sections: discord, chat, patch channel, characters, logins", J(await page.$$eval("#user-rows .user-drawer .user-sec-title", (t) => t.map((x) => x.textContent))) === J(["Roles", "Discord", "Chat", "Patch channel", "Characters (2)", "Logins"]));
    await shot(page, "after-drawer-1280.png");
    await manage(page, "helper1");
    check("only one drawer open", (await drawers(page)) === 1 && (await text(page, "#user-rows .user-drawer .user-drawer-title")) === "Manage helper1");
    await page.keyboard.press("Escape");
    check("Esc closes", (await drawers(page)) === 0);
    await page.click(rowSel("modeo") + " .cell-name");
    check("a click on the row opens it", (await drawers(page)) === 1);
    await page.click("#user-rows .user-drawer .user-drawer-head button");
    check("Close closes", (await drawers(page)) === 0);
    await page.click(rowSel("boss") + " .copy-id");
    check("a click on a button in the row does not open the drawer", (await drawers(page)) === 0);
    await manage(page, "boss");
    check("own admin checkbox disabled with a title", (await page.$eval('#user-rows .user-drawer input[value="ROLE_ADMIN"]', (i) => i.disabled && i.checked && i.closest("label").title === "You can't remove your own admin role.")));
    await page.keyboard.press("Escape");

    // ---- save: one PUT with the full set ----
    await manage(page, "tester");
    await page.check('#user-rows .user-drawer input[value="ROLE_HELPER"]');
    check("Save enabled after a tick", !(await page.isDisabled("#user-rows .user-drawer .role-actions .btn")));
    await page.click('#user-rows .user-drawer .role-actions .ghost-btn'); // Reset
    check("Reset unticks and disables Save", J(await checks(page)).includes("ROLE_HELPER-") && (await page.isDisabled("#user-rows .user-drawer .role-actions .btn")));
    await page.check('#user-rows .user-drawer input[value="ROLE_HELPER"]');
    await page.click("#user-rows .user-drawer .role-actions .btn");
    await page.waitForFunction(() => /saved/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 4000 }).catch(() => {});
    check("one PUT with the full set of editable roles", J(state.puts) === J([{ id: 2, body: { roles: ["ROLE_HELPER", "ROLE_TESTER"] } }]) && state.posts.length === 0, J(state.puts));
    check("message shown, drawer re-opened for the same account", (await text(page, "#user-rows .user-note")) === "Roles of tester saved." && (await text(page, "#user-rows .user-drawer .user-drawer-title")) === "Manage tester");
    check("roles reloaded into the row and the drawer", (await text(page, rowSel("tester") + " .role-cell")).includes("HELPER") && J(await checks(page)).includes("ROLE_HELPER+"), J(await checks(page)));

    // ---- removing a staff role takes a second click ----
    await page.keyboard.press("Escape");
    await manage(page, "helper1");
    await page.uncheck('#user-rows .user-drawer input[value="ROLE_HELPER"]');
    await page.click("#user-rows .user-drawer .role-actions .btn");
    check("first click only arms", state.puts.length === 1 && (await text(page, "#user-rows .user-drawer .role-actions .btn")) === "Confirm save"
      && (await text(page, "#user-rows .user-drawer .role-warn")) === "Confirm: remove helper from helper1", J(state.puts.length));
    await page.click("#user-rows .user-drawer .role-actions .btn");
    await page.waitForFunction(() => /saved/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 4000 }).catch(() => {});
    check("second click sends the PUT", J(state.puts[1]) === J({ id: 4, body: { roles: [] } }), J(state.puts));
    await page.keyboard.press("Escape");
    await manage(page, "player");
    await page.check('#user-rows .user-drawer input[value="ROLE_TESTER"]');
    await page.click("#user-rows .user-drawer .role-actions .btn");
    await page.waitForFunction(() => /saved/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 4000 }).catch(() => {});
    check("adding a role: one click", J(state.puts[2]) === J({ id: 3, body: { roles: ["ROLE_TESTER"] } }), J(state.puts));
    // the arming times out after 5 s
    await page.keyboard.press("Escape");
    await manage(page, "modeo");
    await page.uncheck('#user-rows .user-drawer input[value="ROLE_MODERATOR"]');
    await page.click("#user-rows .user-drawer .role-actions .btn");
    check("armed", (await text(page, "#user-rows .user-drawer .role-actions .btn")) === "Confirm save");
    await page.uncheck('#user-rows .user-drawer input[value="ROLE_USER"]').catch(() => {});
    await page.check('#user-rows .user-drawer input[value="ROLE_MODERATOR"]');
    check("a change disarms", (await text(page, "#user-rows .user-drawer .role-actions .btn")) === "Save");
    await page.keyboard.press("Escape");

    // ---- a refusal ----
    state.putStatus = 400;
    state.putMessage = "You can't remove the last admin.";
    await manage(page, "player");
    await page.check('#user-rows .user-drawer input[value="ROLE_ADMIN"]');
    await page.click("#user-rows .user-drawer .role-actions .btn");
    await page.waitForFunction(() => /last admin/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 4000 }).catch(() => {});
    check("a 400 message is shown", (await text(page, "#user-rows .user-note")) === "You can't remove the last admin." && (await page.$eval("#user-rows .user-note", (n) => n.classList.contains("is-bad"))));
    check("Save usable again, nothing posted", !(await page.isDisabled("#user-rows .user-drawer .role-actions .btn")) && state.posts.length === 0);
    await page.keyboard.press("Escape");

    // ---- older API: the PUT answers 404, one POST per changed role ----
    state.putStatus = 404;
    state.putMessage = "Not Found";
    await manage(page, "player");
    await page.check('#user-rows .user-drawer input[value="ROLE_MODERATOR"]');
    await page.uncheck('#user-rows .user-drawer input[value="ROLE_TESTER"]');
    await page.click("#user-rows .user-drawer .role-actions .btn");
    await page.waitForFunction(() => document.querySelector("#user-rows .user-note") && !document.querySelector("#user-rows .user-note").hidden, null, { timeout: 4000 }).catch(() => {});
    await settle(page);
    check("fallback: POST /api/admin/roles once per changed role", J(state.posts) === J([{ username: "player", role: "ROLE_MODERATOR", grant: true }, { username: "player", role: "ROLE_TESTER", grant: false }]), J(state.posts));
    check("fallback: list reloaded", (await text(page, rowSel("player") + " .role-cell")).includes("MODERATOR"));
    await page.keyboard.press("Escape");

    // ---- Discord: Unlink takes two clicks ----
    await manage(page, "tester");
    await page.click('#user-rows .user-drawer .discord-view button:text-is("Unlink")');
    check("Unlink: first click arms", state.discordPosts.length === 0 && (await page.$$eval("#user-rows .user-drawer .discord-view button", (b) => b.some((x) => x.textContent === "Confirm unlink"))));
    await page.click('#user-rows .user-drawer .discord-view button:text-is("Confirm unlink")');
    await page.waitForFunction(() => /Unlinked/.test((document.querySelector("#user-rows .user-note") || {}).textContent || ""), null, { timeout: 4000 }).catch(() => {});
    check("Unlink: second click posts", J(state.discordPosts) === J([{ id: 2, body: { discordId: "" } }]), J(state.discordPosts));
    await settle(page);
    check("Unlink: row says not linked, drawer still open", (await text(page, rowSel("tester") + " .discord-cell")) === "not linked" && (await drawers(page)) === 1);
    await page.click('#user-rows .user-drawer .discord-view button:text-is("Link")');
    await page.fill('#user-rows .user-drawer .discord-form input', "12345");
    await page.click('#user-rows .user-drawer .discord-form button[type=submit]');
    check("Link: id must be 17 to 20 digits", /17 to 20 digits/.test(await text(page, "#user-rows .user-note")) && state.discordPosts.length === 1);
    check("no page errors", errors.length === 0, errors.join("; "));
    await page.close();

    // ---- 390 px ----
    state = newState();
    ({ page, errors } = await open(browser, base, state, 390));
    const over = () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    let o = await over();
    check("390 px: no horizontal page overflow", o.doc <= o.win, J(o));
    await shot(page, "after-users-390.png");
    await manage(page, "boss");
    o = await over();
    check("390 px: no overflow with the drawer open", o.doc <= o.win, J(o));
    const box = await page.$eval("#user-rows .user-drawer-body", (b) => { const r = b.getBoundingClientRect(); return { right: r.right, left: r.left }; });
    check("390 px: the drawer fits the screen", box.right <= 390 + 1, J(box));
    await shot(page, "after-drawer-390.png");
    check("390 px: no page errors", errors.length === 0, errors.join("; "));
    await page.close();

    // ---- a moderator (not an admin): roles read only ----
    state = newState({ mine: { roles: ["ROLE_MODERATOR"], admin: false, staff: true, tools: { users: ["view"], patches: ["view"], diagnostics: ["view"] } } });
    ({ page, errors } = await open(browser, base, state));
    await manage(page, "tester");
    check("moderator: no checkboxes, no Save", (await page.$$("#user-rows .user-drawer .role-check")).length === 0 && (await page.$$("#user-rows .user-drawer .role-actions")).length === 0
      && (await text(page, "#user-rows .user-drawer .user-sec")).includes("TESTER"));
    check("moderator: no Discord section, chat toggles disabled, no patch Set", (await page.$$eval("#user-rows .user-drawer .user-sec-title", (t) => t.map((x) => x.textContent))).indexOf("Discord") === -1
      && (await page.$$eval("#user-rows .user-drawer .admin-flags button", (b) => b.every((x) => x.disabled))) && (await page.$$("#user-rows .user-drawer .patch-channel-select")).length === 0);
    check("moderator: no page errors", errors.length === 0, errors.join("; "));
    await page.close();

    // ---- an API without /roles/available falls back to the fixed list ----
    state = newState({ available: null });
    ({ page, errors } = await open(browser, base, state));
    await manage(page, "tester");
    check("fallback role list", J(await checks(page)) === J(["ROLE_USER+!", "ROLE_HELPER-", "ROLE_MODERATOR-", "ROLE_ADMIN-", "ROLE_TESTER+", "ROLE_PLAYTESTER-"]), J(await checks(page)));
    check("no page errors (old API)", errors.length === 0, errors.join("; "));
    await page.close();
  } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("admin users OK");
})();
