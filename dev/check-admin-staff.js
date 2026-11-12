#!/usr/bin/env node
/* Checks the admin page's staff permissions and the flag Character panel in headless Chromium against a fake API
   (the contract of /api/admin/permissions/mine, /api/admin/permissions, /api/admin/flags/subject and /notes):

   - for each role (admin, moderator, helper, player) with the default grants: which tabs show, that Gifts is not
     asked for without "gifts view", the first allowed tab opens, a player gets the "not an admin" message, the
     Permissions tab is for admins only;
   - the Flags buttons by permission (helper: view + the notes form; moderator: Approve, notes, no Cheat / Undo / bulk
     Cheat / rules / Scan now, even when the queue says canWrite; admin: all);
   - the Users tab: the Helper role button and its badge (POST body), no role buttons without "users act";
   - an old API (no /mine): every tab but Permissions, as before;
   - the Permissions editor: one row per action, ROLE_ADMIN fixed, a tick PUTs at once (Saving, Saved, a dot marking
     a change from the default), a refusal shown and the tick put back, Reset to defaults (two clicks), tableReady
     false (the notice, disabled boxes);
   - the flag Character panel: every block, null sections ("not available", no crash), markup as text, no IP, the
     links (hunter profile, Users tab with the name searched), another character, a note added and a refused note;
   - 390 px: nothing runs past the screen; no page errors.

   Screenshots go to /srv/devbot/.bot-logs/staff-tools/ (SHOTS=<dir> to change): staff-character-{desktop,phone}.png and
   staff-permissions-{desktop,phone}.png.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-staff.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const FL = require("../js/admin-flags.js");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS || "/srv/devbot/.bot-logs/staff-tools";
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(root, url);
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
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };

/* ---- permissions fixtures: the default grants ---- */

const TABS = ["gifts", "events", "settings", "notices", "content", "balance", "road", "quests", "users", "flags", "diagnostics", "server", "audit"];
const FLAG_ACTIONS = ["view", "approve", "cheat", "undo", "notes", "act"];
const ACTION_ROWS_OF = (tools) => tools.reduce((n, t) => n + t.actions.length, 0);
/* The API's tool list (StaffTools.TOOLS), in its order and with its labels. */
const VIEW_ACT = [{ key: "view", label: "View" }, { key: "act", label: "Change" }];
const TOOLS = [["gifts", "Gifts"], ["events", "Events"], ["settings", "Settings"], ["notices", "Notices"],
  ["content", "Content"], ["balance", "Balance"], ["road", "Hunting Road"], ["quests", "Custom quests"], ["users", "Users"],
  ["patches", "Patch channels"], ["flags", "Flags"], ["diagnostics", "Diagnostics"], ["server", "Server"], ["audit", "Audit"]]
  .map(([key, label]) => ({ key: key, label: label,
    actions: key === "flags" ? [["view", "View"], ["approve", "Approve"], ["cheat", "Cheat"], ["undo", "Undo"], ["notes", "Add notes"], ["act", "Rules and scan"]].map(([k, l]) => ({ key: k, label: l }))
      : key === "audit" ? [VIEW_ACT[0]] : VIEW_ACT }));
const everything = () => {
  const all = {};
  TABS.forEach((t) => { all[t] = t === "flags" ? FLAG_ACTIONS.slice() : ["view", "act"]; });
  all.patches = ["view", "act"];
  return all;
};
const DEFAULTS = {
  ROLE_HELPER: { flags: ["view", "notes"], diagnostics: ["view"] },
  ROLE_MODERATOR: (() => {
    const m = {};
    TABS.forEach((t) => { m[t] = ["view"]; });
    m.flags = ["view", "approve", "notes"];
    m.patches = ["view"];
    m.server = ["view", "act"]; // the API keeps moderators' restart (StaffTools.DEFAULTS)
    return m;
  })(),
  ROLE_ADMIN: everything()
};
const copy = (o) => JSON.parse(JSON.stringify(o));

function mineOf(role) {
  if (role === "player") return { roles: [], admin: false, staff: false, tools: {} };
  const r = "ROLE_" + role.toUpperCase();
  return { roles: [r], admin: role === "admin", staff: true, tools: copy(DEFAULTS[r]) };
}

/* ---- flag and subject fixtures (made-up names) ---- */

const FLAGS = [
  { id: 2, characterId: 1002, characterName: "Tobias Reed", userId: 52, username: "aldric2", rule: "gcp", ruleLabel: "GCP far over what play earns", severity: "high",
    value: 450000, threshold: 200000, cap: 9999999, direction: "above", why: "450,000 GCP is over 200,000.", currency: "gcp", currentValue: 450000, suggestedValue: 102000,
    source: "daily", importId: null, firstSeen: "2026-11-09T03:00:00Z", lastSeen: "2026-11-11T03:00:00Z", status: "open", reviewer: null, reviewedAt: null, note: null, online: false },
  { id: 4, characterId: null, characterName: null, userId: 54, username: "aldric4", rule: "frontier_points", ruleLabel: "Frontier points far over income", severity: "high",
    value: 118899, threshold: 50000, cap: 1200000, direction: "above", why: "118,899 frontier points.", currency: "frontier_points", currentValue: 118899, suggestedValue: 25000,
    source: "daily", importId: null, firstSeen: "2026-11-09T03:00:00Z", lastSeen: "2026-11-11T03:00:00Z", status: "open", reviewer: null, reviewedAt: null, note: null, online: false },
  { id: 6, characterId: 1006, characterName: "Edda Marsh", userId: 56, username: "aldric6", rule: "gcp", ruleLabel: "GCP far over what play earns", severity: "high",
    value: 450000, threshold: 200000, cap: 9999999, direction: "above", why: "450,000 GCP.", currency: "gcp", currentValue: 102000, suggestedValue: 102000,
    source: "daily", importId: null, firstSeen: "2026-11-09T03:00:00Z", lastSeen: "2026-11-11T03:00:00Z", status: "cheat", reviewer: "boss", reviewedAt: "2026-11-10T13:00:00Z", note: "clear", online: false }];
const HISTORY = { 6: [{ id: 30, at: "2026-11-10T13:00:00Z", action: "cheat", actor: "boss", oldValue: 450000, newValue: 102000, note: "clear", undoneAt: null, undoneBy: null, undoable: true }] };

const SUBJECT = {
  character: { id: 1002, name: "Tobias <b>Reed</b>", hr: 100, gr: 50, weaponType: 3, deleted: false,
    mainWeapon: { weaponType: 3, name: "Long Sword", quests: 412, basis: "most quests cleared" }, playtimeSeconds: 45000,
    createdAt: "2026-10-01T10:00:00Z", lastLogin: "2026-11-11T08:30:00Z", guild: { id: 77, name: "Brass Lanterns" },
    clientPatch: 19, clientPatchName: "v1.19", clientPatchSeenAt: "2026-11-11T08:30:00Z" },
  account: { id: 52, username: "aldric2", createdAt: "2026-09-20T10:00:00Z", lastLogin: "2026-11-11T08:30:00Z", ageDays: 52, patchChannel: "stable",
    roles: ["ROLE_HELPER"], discord: { id: "123456789012345678", name: "tobias#0001" } },
  currencies: [
    { key: "gcp", label: "GCP", value: 450000, cap: 9999999, flagThreshold: 200000, earnable: "Play pays about 20,000 an hour of Diva Defense." },
    { key: "frontier_points", label: "Frontier points", value: 800, cap: 1200000, flagThreshold: 50000, earnable: "Shop trade-ins and gacha steps." }],
  quests: { total: 1500, last7Days: 40, last30Days: 210, lastQuestAt: "2026-11-11T08:00:00Z", top: [{ name: "Ancient <i>Dragon</i> Hunt", count: 90 }, { name: "Dundorma Siege", count: 33 }] },
  flags: [{ flag: Object.assign({}, FLAGS[0]), history: [{ id: 21, at: "2026-11-09T03:00:00Z", action: "flagged", actor: "scan", oldValue: null, newValue: null, note: null, undoneAt: null, undoneBy: null }] },
    { flag: Object.assign({}, FLAGS[1], { characterId: null, characterName: null, userId: 52 }), history: [] }],
  imports: [{ id: 7, at: "2026-10-02T09:00:00Z", source: "old server save", by: "aldric2", scan: "clean", undone: false }],
  logins: { tracking: true, recent: [{ at: "2026-11-11T08:30:00Z", world: "Mezeporta", character: "Tobias Reed" }],
    sharedIp: { available: true, accounts: 2, names: ["sibling_a", "sibling_b"], ip: "203.0.113.9" } },
  otherCharacters: [{ id: 1003, name: "Other Hunter", hr: 30, gr: 0, lastLogin: "2026-11-01T08:30:00Z", deleted: false }],
  adminActions: [{ at: "2026-11-10T12:00:00Z", actor: "boss", action: "flags.approve", target: "flag 5", result: "ok" }],
  notes: [{ id: 3, at: "2026-11-10T12:30:00Z", author: "boss", note: "Asked in Discord <u>no reply</u>", characterId: 1002 }]
};
const SUBJECT_OTHER = Object.assign(copy(SUBJECT), { character: { id: 1003, name: "Other Hunter", hr: 30, gr: 0, deleted: false, mainWeapon: null, playtimeSeconds: null,
  createdAt: null, lastLogin: null, guild: null, clientPatch: null, clientPatchName: null, clientPatchSeenAt: null }, notes: [] });
// Everything optional is null: the panel must say "not available", not crash.
const SUBJECT_EMPTY = { character: null, account: { id: 54, username: "aldric4", createdAt: null, lastLogin: null, ageDays: null, patchChannel: null, roles: [], discord: null },
  currencies: null, quests: null, flags: null, imports: null, logins: { tracking: false, recent: null, sharedIp: { available: false } }, otherCharacters: null, adminActions: null, notes: null };

function newApi(role, extra) {
  return Object.assign({
    calls: [], role, mine: mineOf(role), tableReady: true, canWrite: true, putStatus: null, noteFail: false,
    grants: copy(DEFAULTS), defaults: copy(DEFAULTS),
    user: { id: 52, username: "aldric2", roles: ["ROLE_HELPER"], characterList: [], lastLogin: null, discordId: null, op: false, timer: false, patchChannel: "stable" }
  }, extra || {});
}

const ACTION_ROWS = ACTION_ROWS_OF(TOOLS);
const permsBody = (api) => ({ tableReady: api.tableReady, roles: ["ROLE_HELPER", "ROLE_MODERATOR", "ROLE_ADMIN"], tools: TOOLS, grants: api.grants,
  defaults: api.defaults, fixed: ["ROLE_ADMIN"] });

function fakeApi(page, api) {
  page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    api.calls.push({ method: req.method(), path: p + url.search, body: sent });
    if (p === "/api/admin/permissions/mine") return api.noMine === 404 ? reply(404, { message: "Not Found" }) : api.noMine === "plain" ? reply(200, []) : reply(200, api.mine);
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/account") return reply(200, { username: "boss", roles: api.mine.roles });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: { 1: "Hunter" }, itemTypes: { 7: "Item" }, itemTypesWithId: [7], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/permissions" && req.method() === "GET") return reply(200, permsBody(api));
    if (p === "/api/admin/permissions" && req.method() === "PUT") {
      if (api.putStatus) return reply(api.putStatus, { message: api.putStatus === 503 ? "Run db/staff-tools.sql first." : "That role cannot be changed." });
      const list = api.grants[sent.role][sent.tool] || (api.grants[sent.role][sent.tool] = []);
      const i = list.indexOf(sent.action);
      if (sent.allowed && i === -1) list.push(sent.action);
      if (!sent.allowed && i !== -1) list.splice(i, 1);
      return reply(200, permsBody(api));
    }
    if (p === "/api/admin/permissions/reset") { api.grants[sent.role] = copy(api.defaults[sent.role]); return reply(200, permsBody(api)); }
    if (p === "/api/admin/roles") return reply(200, { message: "Saved." });
    if (p === "/api/admin/patch-slots") return reply(200, { slotsAvailable: true, slots: [] });
    if (p === "/api/admin/users") {
      return reply(200, { summary: { accounts: 1, admins: 0, moderators: 0, linked: 0 }, users: [api.user], total: 1, page: 0, size: 25, patchTracking: false });
    }
    if (p === "/api/admin/flags/summary") return reply(200, { tableReady: true, open: 2, critical: 0 });
    if (p === "/api/admin/flags/rules") return reply(200, { rules: [{ key: "gcp", label: "GCP far over what play earns", subject: "character", threshold: 200000, severity: "high", ceiling: 102000,
      currency: "gcp", direction: "above", enabled: true, blocksImport: false, description: "d", calibration: null }] });
    let m;
    if (p === "/api/admin/flags/notes") {
      if (api.noteFail) return reply(503, { message: "The notes table is missing." });
      return reply(201, { id: 99, at: "2026-11-12T10:00:00Z", author: "boss", note: sent.note, characterId: sent.characterId });
    }
    if ((m = p.match(/^\/api\/admin\/flags\/subject\/(\d+)$/))) {
      const c = url.searchParams.get("character");
      if (m[1] === "54") return reply(200, SUBJECT_EMPTY);
      return reply(200, c === "1003" ? SUBJECT_OTHER : SUBJECT);
    }
    if ((m = p.match(/^\/api\/admin\/flags\/(\d+)$/))) {
      const f = FLAGS.find((x) => x.id === Number(m[1]));
      return f ? reply(200, { flag: f, history: HISTORY[f.id] || [], others: [] }) : reply(404, { message: "No such flag." });
    }
    if (p === "/api/admin/flags") return reply(200, { tableReady: true, canWrite: api.canWrite, counts: { open: 2, critical: 0, approved: 0, cheat: 1 }, lastScan: null,
      flags: FLAGS.filter((f) => url.searchParams.get("status") === "all" || f.status === (url.searchParams.get("status") || "open")) });
    return reply(404, { message: "Not Found" });
  });
}

async function open(browser, url, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => { localStorage.setItem("hvmhfz.token", t); localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); }, TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  fakeApi(page, api);
  await page.goto(url);
  return { page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.addStyleTag({ content: ".site-nav{position:static !important}" });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const visible = (page, sel) => page.$eval(sel, (n) => !n.hidden && n.getBoundingClientRect().width > 0).catch(() => false);
const count = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).length;
const last = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).pop();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const settle = (page) => page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"]:not([hidden])')
  || !document.getElementById("admin-alert").hidden);
const shownTabs = (page) => page.$$eval(".tabs .tab", (t) => t.filter((n) => !n.hidden && n.getBoundingClientRect().width > 0).map((n) => n.id.replace("tab-", "")));
const activeTab = (page) => page.$$eval('.tab[aria-selected="true"]', (t) => t.map((n) => n.id.replace("tab-", "")).join(","));
const cardOf = (id) => '#fl-list .fl-card[data-id="' + id + '"]';
const btnLabels = (page, sel) => page.$$eval(sel, (b) => b.filter((x) => !x.hidden && x.getBoundingClientRect().width > 0).map((x) => x.textContent));

/* ---- the pure helpers ---- */

function helpers() {
  check("hrLabel", FL.hrLabel(100) === "HR100 (HR4)" && FL.hrLabel(1) === "HR1 (HR1)" && FL.hrLabel(29) === "HR29 (HR1)" && FL.hrLabel(30) === "HR30 (HR2)"
    && FL.hrLabel(50) === "HR50 (HR3)" && FL.hrLabel(98) === "HR98 (HR3)" && FL.hrLabel(99) === "HR99 (HR4)" && FL.hrLabel(298) === "HR298 (HR4)"
    && FL.hrLabel(299) === "HR299 (HR5)" && FL.hrLabel(997) === "HR997 (HR5)" && FL.hrLabel(998) === "HR998 (HR6)" && FL.hrLabel(999) === "HR999 (HR7)");
  check("levelLabel", FL.levelLabel(999, 50) === "GR50 · HR999 (HR7)" && FL.levelLabel(100, 0) === "HR100 (HR4)");
  check("playtimeText", FL.playtimeText(45000) === "12 h 30 m" && FL.playtimeText(null) === "not known" && FL.playtimeText(59) === "0 h 0 m");
}

/* ---- the page ---- */

async function run() {
  helpers();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  let r, page, api, t;

  // ---- tabs by role ----
  const EXPECT = {
    admin: TABS.concat(["permissions"]),
    moderator: TABS,
    helper: ["flags", "diagnostics"],
    player: []
  };
  for (const role of ["admin", "moderator", "helper", "player"]) {
    api = newApi(role);
    r = await open(browser, base + "/admin.html", api);
    page = r.page;
    await settle(page);
    await page.waitForTimeout(150);
    const tabs = await shownTabs(page);
    check(role + ": tabs shown", JSON.stringify(tabs) === JSON.stringify(EXPECT[role]), tabs.join(","));
    check(role + ": Permissions tab only for admin", tabs.indexOf("permissions") !== -1 === (role === "admin"));
    check(role + ": gifts options asked only with gifts view", (count(api, "GET", "/api/admin/distributions/options") === 1) === (role === "admin" || role === "moderator"));
    check(role + ": the first allowed tab is open", role === "player" || (await activeTab(page)) === EXPECT[role][0], await activeTab(page));
    if (role === "player") check("player: the not-an-admin message, no tab", /not an admin/.test(await text(page, "#admin-alert")) && !(await visible(page, ".tabs")));
    if (role === "helper") {
      check("helper: other panels hidden", (await page.$$eval(".tab-panel", (p) => p.filter((n) => !n.hidden).map((n) => n.id).join(","))) === "panel-flags");
      await page.goto(base + "/admin.html#gifts");
      await page.reload();
      await settle(page);
      check("helper: a hash to a closed tab opens the first allowed one", (await activeTab(page)) === "flags", await activeTab(page));
    }
    check(role + ": no page errors", r.errors.length === 0, r.errors.join("; "));
    await page.close();
  }

  // ---- an older API: no /mine ----
  for (const kind of [404, "plain"]) {
    api = newApi("admin", { noMine: kind });
    r = await open(browser, base + "/admin.html", api);
    page = r.page;
    await settle(page);
    const tabs = await shownTabs(page);
    check("old API (" + kind + "): every tab but Permissions", JSON.stringify(tabs) === JSON.stringify(TABS), tabs.join(","));
    check("old API (" + kind + "): gifts loaded as before, no hvStaff", count(api, "GET", "/api/admin/distributions/options") === 1 && (await page.evaluate(() => typeof window.hvStaff)) === "undefined");
    await page.close();
  }

  // ---- Flags buttons by role ----
  for (const role of ["helper", "moderator", "admin"]) {
    api = newApi(role); // the queue says canWrite for everyone: the permissions decide
    r = await open(browser, base + "/admin.html#flags", api);
    page = r.page;
    await page.waitForSelector("#fl-list .fl-card");
    const buttons = await btnLabels(page, "#fl-list .fl-actions button");
    const has = (label) => buttons.indexOf(label) !== -1;
    check(role + ": queue Approve", has("Approve") === (role !== "helper"), buttons.join(","));
    check(role + ": queue Cheat", has("Cheat") === (role === "admin"), buttons.join(","));
    check(role + ": Details always", has("Details"));
    check(role + ": checkboxes and bulk bar", ((await page.$$("#fl-list .fl-check")).length > 0) === (role !== "helper") && (await visible(page, "#fl-bulkbar")) === (role !== "helper"));
    check(role + ": bulk buttons", (await visible(page, "#fl-bulk-approve")) === (role !== "helper") && (await visible(page, "#fl-bulk-cheat")) === (role === "admin"));
    check(role + ": Scan now", (await visible(page, "#fl-scan")) === (role === "admin"));
    await page.click("#fl-rules summary");
    await page.waitForSelector("#fl-rules-body tr[data-rule]");
    check(role + ": rules editable only with flags act", ((await page.$$("#fl-rules-body input, #fl-rules-body select, #fl-rules-body button")).length > 0) === (role === "admin"));
    await page.click('#fl-status [data-status="cheat"]');
    await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 1);
    await page.click(cardOf(6) + " .fl-body");
    await page.waitForSelector("#fl-detail .fl-history");
    check(role + ": Undo only with flags undo", ((await page.$$("#fl-detail .fl-history button")).length > 0) === (role === "admin"));
    await page.waitForSelector("#fl-subject .fl-dl");
    check(role + ": notes form shown (flags notes)", (await page.$$("#fl-subject .fl-note-form")).length === 1);
    check(role + ": no page errors", r.errors.length === 0, r.errors.join("; "));
    await page.close();
  }
  // Without the notes permission there is no form.
  api = newApi("helper");
  api.mine.tools.flags = ["view"];
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-list .fl-card");
  await page.click(cardOf(2) + " .fl-body");
  await page.waitForSelector("#fl-subject .fl-dl");
  check("flags view only: the notes are listed, no form", (await page.$$("#fl-subject .fl-note-form")).length === 0 && /no reply/.test(await text(page, "#fl-subject")));
  await page.close();

  // ---- the Users tab: Helper role ----
  api = newApi("admin");
  r = await open(browser, base + "/admin.html#users", api);
  page = r.page;
  await page.waitForSelector("#user-rows tr td.rank");
  check("users: a Helper column with a Make/Remove helper button", (await page.$$eval("#panel-users thead th", (h) => h.map((x) => x.textContent)))
    .indexOf("Helper") !== -1 && (await btnLabels(page, "#user-rows button")).indexOf("Remove helper") !== -1);
  check("users: role-helper badge", (await page.$$("#user-rows .role-badge.role-helper")).length === 1 && /HELPER/.test(await text(page, "#user-rows .role-badge.role-helper")));
  await page.click('#user-rows button:text("Remove helper")');
  await page.waitForFunction(() => document.querySelector("#users-alert") && !document.getElementById("users-alert").hidden);
  check("users: the POST body", JSON.stringify(last(api, "POST", "/api/admin/roles").body) === '{"username":"aldric2","role":"ROLE_HELPER","grant":false}', JSON.stringify(last(api, "POST", "/api/admin/roles").body));
  await page.close();
  api = newApi("moderator"); // users view, no users act, patches view
  r = await open(browser, base + "/admin.html#users", api);
  page = r.page;
  await page.waitForSelector("#user-rows tr td.rank");
  check("users (moderator): no role, Discord or patch buttons; flags toggles disabled", (await btnLabels(page, "#user-rows button")).filter((b) => b !== "Logins").length === 2
    && (await page.$$eval("#user-rows .admin-flags button", (b) => b.every((x) => x.disabled))) && (await page.$$("#patch-slots-panel:not([hidden])")).length === 1);
  check("users (moderator): no page errors", r.errors.length === 0, r.errors.join("; "));
  await page.close();
  api = newApi("moderator");
  api.mine.tools.patches = [];
  r = await open(browser, base + "/admin.html#users", api);
  page = r.page;
  await page.waitForSelector("#user-rows tr td.rank");
  check("users (no patches view): the slots panel hidden and not asked", !(await visible(page, "#patch-slots-panel")) && count(api, "GET", "/api/admin/patch-slots") === 0);
  await page.close();

  // ---- the Character panel ----
  api = newApi("admin");
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-list .fl-card");
  await page.click(cardOf(2) + " .fl-body");
  await page.waitForSelector("#fl-subject .fl-dl");
  check("panel: asked with the character", /\/api\/admin\/flags\/subject\/52\?character=1002$/.test(last(api, "GET", "/subject/").path), last(api, "GET", "/subject/").path);
  t = await text(page, "#fl-subject");
  const need = [["name as text", "Tobias <b>Reed</b>"], ["character id", "1002"], ["account", "aldric2 #52"], ["level", "GR50 · HR100 (HR4)"], ["weapon", "Long Sword · 412 quests (most quests cleared)"],
    ["playtime", "12 h 30 m"], ["created", "2026-10-01 10:00 UTC"], ["last login", "2026-11-11 08:30 UTC"], ["account age", "52 days"], ["guild", "Brass Lanterns (#77)"],
    ["discord", "tobias#0001 (123456789012345678)"], ["patch channel", "stable"], ["client", "v1.19, seen 2026-11-11 08:30 UTC"],
    ["currency value / cap", "450,000 / 9,999,999"], ["threshold", "flagged above 200,000"], ["earnable", "Play pays about 20,000 an hour"], ["second currency", "800 / 1,200,000"],
    ["quests", "1,500"], ["quests 7 days", "40"], ["flag", "GCP far over what play earns"], ["account flag", "Frontier points far over income"], ["flag history", "Flagged by scan"],
    ["import", "old server save"], ["login", "Mezeporta"], ["shared IP", "Shares an IP with 2 other accounts: sibling_a, sibling_b."], ["other character", "Other Hunter · HR30 (HR2)"],
    ["admin action", "flags.approve"], ["note", "Asked in Discord <u>no reply</u>"], ["top quest", "Ancient <i>Dragon</i> Hunt"]];
  need.forEach(([label, part]) => check("panel: " + label, t.indexOf(part) !== -1, part));
  check("panel: a bar per capped currency", (await page.$$("#fl-subject .fl-bar")).length === 2 && (await page.$$("#fl-subject .fl-bar-mark")).length === 2);
  check("panel: markup stays text", (await page.$$("#fl-subject b, #fl-subject i, #fl-subject u")).length === 0);
  check("panel: no IP address shown", !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t) && t.indexOf("203.0.113") === -1);
  check("panel: links", (await page.$eval('#fl-subject a[href^="/hunters.html"]', (a) => a.getAttribute("href"))) === "/hunters.html?id=1002"
    && (await page.$eval('#fl-subject a[href^="#users"]', (a) => a.getAttribute("href"))) === "#users?q=aldric2");
  await shot(page, "staff-character-desktop.png");
  // a note
  await page.fill("#fl-subject-note", "Spoke to them <b>today</b>");
  await page.click("#fl-subject .fl-note-form button");
  await page.waitForFunction(() => document.querySelectorAll("#fl-subject-notes .fl-notes li").length === 2);
  check("note: body", JSON.stringify(last(api, "POST", "/api/admin/flags/notes").body) === '{"userId":52,"characterId":1002,"note":"Spoke to them <b>today</b>"}', JSON.stringify(last(api, "POST", "/api/admin/flags/notes").body));
  check("note: prepended, as text", /^.*Spoke to them <b>today<\/b>/.test(await text(page, "#fl-subject-notes .fl-notes li:first-child")) && (await page.$$("#fl-subject-notes b")).length === 0);
  api.noteFail = true;
  await page.fill("#fl-subject-note", "again");
  await page.click("#fl-subject .fl-note-form button");
  await page.waitForFunction(() => { const m = document.querySelector("#fl-subject .fl-note-form .form-alert"); return m && !m.hidden; });
  check("note: a 503 message shown, list unchanged", /The notes table is missing/.test(await text(page, "#fl-subject .fl-note-form .form-alert")) && (await page.$$("#fl-subject-notes .fl-notes li")).length === 2);
  // another character
  await page.click('#fl-subject .fl-others button');
  await page.waitForFunction(() => /Other Hunter/.test((document.querySelector("#fl-subject .fl-dl dd") || {}).textContent || ""));
  check("other character: its own request, a way back", /\/subject\/52\?character=1003$/.test(last(api, "GET", "/subject/").path) && (await btnLabels(page, "#fl-subject button")).indexOf("Back to this flag's character") !== -1);
  check("other character: null weapon and playtime shown as not known", /Main weapon\s*not known/.test(await text(page, "#fl-subject .fl-dl")) || (await text(page, "#fl-subject")).indexOf("not known") !== -1);
  await page.click("#fl-subject >> text=Back to this flag's character");
  await page.waitForFunction(() => /Tobias/.test((document.querySelector("#fl-subject .fl-dl dd") || {}).textContent || ""));
  // the Users tab link
  await page.click('#fl-subject a[href^="#users"]');
  await page.waitForSelector("#user-rows tr td.rank");
  check("link: the Users tab opens searching the name", (await activeTab(page)) === "users" && (await page.$eval("#user-search", (i) => i.value)) === "aldric2"
    && /query=aldric2/.test(last(api, "GET", "/api/admin/users").path), last(api, "GET", "/api/admin/users").path);
  // an account flag: no character
  await page.goto(base + "/admin.html#flags");
  await page.reload();
  await page.waitForSelector("#fl-list .fl-card");
  await page.click(cardOf(4) + " .fl-body");
  await page.waitForSelector("#fl-subject .fl-dl");
  t = await text(page, "#fl-subject");
  check("account flag: asked without character", /\/subject\/54$/.test(last(api, "GET", "/subject/").path), last(api, "GET", "/subject/").path);
  check("account flag: null sections say not available, no crash", /Account flag: no character/.test(t) && /Currencies: not available/.test(t) && /Quest history: not available/.test(t)
    && /Flags: not available/.test(t) && /Imports: not available/.test(t) && /IP data not available/.test(t) && /Login tracking is off/.test(t) && /Other characters: not available/.test(t)
    && /Admin actions: not available/.test(t) && /Staff notes: not available/.test(t) && /not linked/.test(t), t);
  check("account flag: no hunter link, Users link", (await page.$$('#fl-subject a[href^="/hunters.html"]')).length === 0 && (await page.$$('#fl-subject a[href^="#users"]')).length === 1);
  check("no page errors (panel)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- the Permissions editor ----
  api = newApi("admin");
  r = await open(browser, base + "/admin.html#permissions", api);
  page = r.page;
  await page.waitForSelector("#perm-body td.perm-cell");
  check("editor: a header per role, a group per tool, a row per action", (await page.$$eval("#perm-head th", (h) => h.length)) === 4
    && (await page.$$("#perm-body tr.perm-group")).length === TOOLS.length && (await page.$$("#perm-body tr[data-tool]")).length === ACTION_ROWS);
  check("editor: labels from the API", /Approve/.test(await text(page, "#perm-body")) && /Diagnostics/.test(await text(page, "#perm-body")));
  check("editor: ROLE_ADMIN column ticked, disabled, always", (await page.$$eval('#perm-body input[data-cell^="ROLE_ADMIN"]', (b, n) => b.length === n && b.every((x) => x.checked && x.disabled), ACTION_ROWS))
    && /always/.test(await text(page, "#perm-head")));
  check("editor: helper flags view ticked, approve not", (await page.$eval('input[data-cell="ROLE_HELPER|flags|view"]', (b) => b.checked))
    && !(await page.$eval('input[data-cell="ROLE_HELPER|flags|approve"]', (b) => b.checked)));
  check("editor: no dot on the defaults", (await page.$$("#perm-body .perm-dot")).length === 0);
  await page.check('input[data-cell="ROLE_MODERATOR|flags|cheat"]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById("perm-body").textContent));
  check("editor: the PUT body", JSON.stringify(last(api, "PUT", "/api/admin/permissions").body) === '{"role":"ROLE_MODERATOR","tool":"flags","action":"cheat","allowed":true}',
    JSON.stringify(last(api, "PUT", "/api/admin/permissions").body));
  check("editor: Saved, ticked, a dot titled 'changed from the default'", (await page.$eval('input[data-cell="ROLE_MODERATOR|flags|cheat"]', (b) => b.checked))
    && (await page.$$eval("#perm-body .perm-dot", (d) => d.length === 1 && d[0].title === "changed from the default")));
  await page.uncheck('input[data-cell="ROLE_HELPER|flags|notes"]');
  await page.waitForFunction(() => document.querySelectorAll("#perm-body .perm-dot").length === 2);
  check("editor: a removed default also gets a dot", JSON.stringify(last(api, "PUT", "/api/admin/permissions").body) === '{"role":"ROLE_HELPER","tool":"flags","action":"notes","allowed":false}');
  await shot(page, "staff-permissions-desktop.png");
  // refusal
  api.putStatus = 400;
  await page.click('input[data-cell="ROLE_HELPER|flags|act"]');
  await page.waitForFunction(() => /cannot be changed/.test(document.getElementById("perm-alert").textContent));
  check("editor: a 400 message shown and the tick put back", !(await page.$eval('input[data-cell="ROLE_HELPER|flags|act"]', (b) => b.checked)) && !(await page.$eval("#perm-alert", (n) => n.hidden)));
  api.putStatus = null;
  // reset
  await page.click('button[data-reset="ROLE_MODERATOR"]');
  check("editor: reset needs a second click", /Click again/.test(await text(page, 'button[data-reset="ROLE_MODERATOR"]')) && count(api, "POST", "/api/admin/permissions/reset") === 0);
  await page.click('button[data-reset="ROLE_MODERATOR"]');
  await page.waitForFunction(() => /back to the defaults/.test(document.getElementById("perm-ok").textContent));
  check("editor: reset body, the dot is gone", JSON.stringify(last(api, "POST", "/api/admin/permissions/reset").body) === '{"role":"ROLE_MODERATOR"}'
    && !(await page.$eval('input[data-cell="ROLE_MODERATOR|flags|cheat"]', (b) => b.checked)) && (await page.$$("#perm-body .perm-dot")).length === 1);
  check("editor: no page errors", r.errors.length === 0, r.errors.join("; "));
  await page.close();
  // tableReady false
  api = newApi("admin", { tableReady: false });
  r = await open(browser, base + "/admin.html#permissions", api);
  page = r.page;
  await page.waitForSelector("#perm-body td.perm-cell");
  check("editor: tableReady false: the notice, every box disabled", /Run db\/staff-tools\.sql on the database to change permissions; these are the defaults/.test(await text(page, "#perm-notable"))
    && (await visible(page, "#perm-notable")) && (await page.$$eval("#perm-body input", (b) => b.every((x) => x.disabled))));
  await page.close();

  // ---- phone ----
  api = newApi("admin");
  r = await open(browser, base + "/admin.html#permissions", api, 390);
  page = r.page;
  await page.waitForSelector("#perm-body td.perm-cell");
  await page.check('input[data-cell="ROLE_MODERATOR|flags|cheat"]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById("perm-body").textContent));
  check("390 px: the editor scrolls inside its box only", (await overflow(page)) <= 0, String(await overflow(page)));
  await shot(page, "staff-permissions-phone.png");
  await page.goto(base + "/admin.html#flags");
  await page.reload();
  await page.waitForSelector("#fl-list .fl-card");
  await page.click(cardOf(2) + " .fl-body");
  await page.waitForSelector("#fl-subject .fl-dl");
  await page.click("#fl-subject .fl-block > summary");
  check("390 px: the character panel fits", (await overflow(page)) <= 0, String(await overflow(page)));
  check("390 px: nothing of the panel runs past the screen outside a scroll box", (await page.evaluate(() => Array.from(document.querySelectorAll("#fl-subject *"))
    .filter((n) => !n.closest(".table-wrap") && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length)) === 0);
  await shot(page, "staff-character-phone.png");
  check("no page errors (phone)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAIL: " + failures.length);
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("admin staff OK");
}

run().catch((e) => { console.error(e); try { server.close(); } catch (x) { /* ignore */ } process.exit(1); });
