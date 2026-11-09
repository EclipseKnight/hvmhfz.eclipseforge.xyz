#!/usr/bin/env node
/* Checks the admin panel's Settings tab (js/admin-settings.js) in headless Chromium against a fake API (shapes as
   the API's README, section "Live settings"):

   - the section list with each section's state, the game server's report, the restart-only switches;
   - a section's form built from the spec: config default boxes, the game server's values, help and limits;
   - Review changes calls the check, shows its problems or the changes, and only then Save (PUT with the version
     edited and the note); a number box left empty is caught before any request;
   - list editors (guild member limits, login notices): add and remove rows;
   - the history with what each change did, and Revert on the second click (POST with the version);
   - the Patch gate section's count of who it would refuse: the stored values (GET) when it opens, the form's
     values (POST) after an edit, a moderator's form falling back to the stored values;
   - the Patch gate's Latest version following the latest release: the switch and its sentence, the field read-only
     while it is on, "Set Current ... now", on (PUT enabled true), off (typed by hand again), a refusal shown, and an
     API without the switch (404) leaving the field as it was;
   - a refused section says why; a missing table says so; markup in a value stays text; no horizontal overflow at
     375 px; no page errors;
   - the pure helpers under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (admin-settings-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-settings.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Set_ = require("../js/admin-settings.js");

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

/* ---- the spec as the API sends it (a part of Erupe's spec.json) ---- */

const f = (key, label, type, extra) => Object.assign({ key, label, type, min: null, max: null, enumValues: [], maxLength: 0,
  minItems: 0, maxItems: 0, pair: [], config: "GameplayOptions." + key, help: "Help for " + label + "." }, extra || {});
const SPEC = {
  mezfes: { name: "mezfes", title: "MezFes", effect: "At the next login", help: "The hub minigames.", rules: [], fields: [
    f("solo_tickets", "Solo tickets per week", "int", { min: 0, max: 100 }),
    f("group_tickets", "Group tickets per week", "int", { min: 0, max: 100 }),
    f("switch_minigame", "Tokotoko Partnya instead of Volpakkun Together", "bool")] },
  sky_corridor: { name: "sky_corridor", title: "Sky Corridor", effect: "At once", help: "The tower.", rules: [], fields: [
    f("floor_rotation", "Floor rotation", "string", { enumValues: ["off", "weekly", "daily"] }),
    f("floor_record_multiplier", "Floor record multiplier", "int", { min: 0, max: 100 })] },
  guild: { name: "guild", title: "Guild", effect: "At once", help: "Guilds.", rules: [{ id: "member_limits_order", text: "Ranks go up." }], fields: [
    f("member_limits", "Members per guild rank", "int_pairs", { minItems: 1, maxItems: 20,
      pair: [{ label: "From guild rank", min: 0, max: 255 }, { label: "Members", min: 1, max: 100 }] })] },
  login_notices: { name: "login_notices", title: "Login notices", effect: "At the next login", help: "MHFML.", rules: [], fields: [
    f("hide", "Hide the notices", "bool"),
    f("notices", "Notices", "strings", { maxItems: 8, maxLength: 4000 })] },
  patch_gate: { name: "patch_gate", title: "Patch gate", effect: "At each login", help: "Which client patches may play.",
    rules: [{ id: "patch_gate_versions", text: "Versions are MAJOR.MINOR." }], fields: [
    f("mode", "Mode", "string", { enumValues: ["off", "latest", "latest_n", "minimum"] }),
    f("current", "Latest version", "string", { maxLength: 6 }),
    f("allow_unknown", "Allow unknown versions", "bool"),
    f("exempt_accounts", "Exempt accounts (ids)", "strings", { maxItems: 50, maxLength: 10 })] }
};

/* The API's count for a gate value (the shape of PatchGateImpact.Impact). */
function impactFor(value) {
  const latest = value && value.mode === "latest";
  const count = (n, refused) => ({ characters: n, refused, exempt: latest ? 1 : 0, noVersion: 1, notRecorded: 1 });
  return { tracking: true, mode: latest ? "latest" : "off", oldestAllowed: latest ? 120 : null, allowUnknown: true,
    describe: latest ? "v1.20 and newer play; clients that send no version (v1.18 or older) play too." : "Off: every client patch plays.",
    problems: [], recentDays: 7, online: count(4, latest ? 1 : 0), recent: count(9, latest ? 3 : 0),
    versions: [{ clientPatch: 120, name: "v1.20", online: 1, recent: 4, refused: false },
      { clientPatch: 119, name: "v1.19", online: 2, recent: 3, refused: latest },
      { clientPatch: 0, name: "v1.18 or older", online: 0, recent: 2, refused: false },
      { clientPatch: null, name: "not recorded", online: 1, recent: 0, refused: false }] };
}

function overview(api) {
  const sections = ["mezfes", "sky_corridor", "guild", "login_notices", "patch_gate"].map((name) => ({
    spec: SPEC[name], stored: api.stored[name] || null,
    defaults: api.report ? { mezfes: { solo_tickets: 5, group_tickets: 1, switch_minigame: true }, sky_corridor: { floor_rotation: "weekly", floor_record_multiplier: 3 },
      guild: { member_limits: [[0, 30], [3, 40]] }, login_notices: { hide: true, notices: ["<BODY>Welcome"] },
      patch_gate: { mode: "off", current: "1.20", allow_unknown: true, exempt_accounts: null } }[name] : null,
    effective: api.report ? { mezfes: { solo_tickets: 9, group_tickets: 1, switch_minigame: true } }[name] || null : null,
    state: api.states[name] || { state: api.report ? "default" : "no-game-server", refusal: null, appliedAt: null, process: null, stale: false }
  }));
  return { now: NOW, tableReady: api.tableReady !== false, sections,
    processes: api.report ? [{ process: "hunsterverse", version: 7, appliedAt: "2026-11-20T11:58:00Z", readAt: "2026-11-20T11:59:30Z", stale: false, errors: { sky_corridor: { version: 8, error: "floor_rotation: must be one of [off weekly daily]" } } }] : [],
    restartOnly: api.report ? { "EventCalendar.Enabled": true, "LiveSettings.Enabled": true, "API.Messages": 2 } : null };
}

const HISTORY = [
  { id: 12, section: "mezfes", before: null, after: { solo_tickets: 9 }, version: 7, updatedBy: "boss", updatedAt: "2026-11-20T11:00:00Z", note: "weekend <b>boost</b>" }
];

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
    if (p === "/api/admin/settings") return reply(200, overview(api));
    if (p === "/api/admin/settings/patch_gate/impact") {
      if (req.method() === "POST" && api.moderator) return reply(403, { message: "Forbidden" });
      return reply(200, impactFor(req.method() === "POST" ? sent.value : (api.stored.patch_gate || {}).value));
    }
    if (p === "/api/admin/settings/patch_gate/auto") {
      if (!api.auto) return reply(404, { message: "Not Found" });
      if (req.method() !== "PUT") return reply(200, api.auto);
      if (api.autoFail) return reply(409, { message: api.autoFail, problems: [api.autoFail] });
      api.auto.enabled = sent.enabled;
      let changes = [];
      if (sent.enabled && api.auto.current !== api.auto.latest) {
        api.auto.current = api.auto.latest;
        api.stored.patch_gate = { value: Object.assign({}, (api.stored.patch_gate || {}).value, { current: api.auto.latest }), version: 5, updatedBy: "boss", updatedAt: NOW, note: "follow the latest release (v" + api.auto.latest + ")" };
        changes = [{ key: "current", label: "Latest version", before: "", after: api.auto.latest, beforeDefault: true, afterDefault: false }];
      }
      api.auto.inSync = api.auto.current === api.auto.latest;
      return reply(200, { auto: api.auto, section: { stored: api.stored.patch_gate || null }, changes });
    }
    let m = p.match(/^\/api\/admin\/settings\/([a-z_]+)\/check$/);
    if (m) {
      if (sent.value.solo_tickets > 100) return reply(200, { problems: ["MezFes: Solo tickets per week (solo_tickets) must be from 0 to 100."], changes: [] });
      return reply(200, { problems: [], changes: [
        { key: "group_tickets", label: "Group tickets per week", before: 1, after: sent.value.group_tickets, beforeDefault: true, afterDefault: false }] });
    }
    m = p.match(/^\/api\/admin\/settings\/([a-z_]+)\/history$/);
    if (m) return reply(200, m[1] === "mezfes" ? HISTORY : []);
    m = p.match(/^\/api\/admin\/settings\/([a-z_]+)\/revert\/(\d+)$/);
    if (m) {
      api.stored.mezfes = { value: {}, version: 9, updatedBy: "boss", updatedAt: NOW, note: "revert of #" + m[2] };
      return reply(200, { section: { stored: api.stored.mezfes }, changes: [] });
    }
    m = p.match(/^\/api\/admin\/settings\/([a-z_]+)$/);
    if (m && req.method() === "PUT") {
      api.stored[m[1]] = { value: sent.value, version: 8, updatedBy: "boss", updatedAt: NOW, note: sent.note };
      api.states[m[1]] = { state: "waiting", refusal: null, appliedAt: null, process: "hunsterverse", stale: false };
      return reply(200, { section: { stored: api.stored[m[1]] }, changes: [] });
    }
    return reply(404, { message: "Not Found" });
  });
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

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const last = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).pop();

/* ---- the pure helpers ---- */

function helpers() {
  check("utc", Set_.utc("2026-11-20T12:00:00Z") === "Fri 20 Nov 2026 12:00 UTC", Set_.utc("2026-11-20T12:00:00Z"));
  check("show", Set_.show(true) === "on" && Set_.show(false) === "off" && Set_.show([[0, 30], [3, 40]]) === "[0, 30] [3, 40]"
    && Set_.show(["a", "b"]) === "2 texts" && Set_.show("weekly") === '"weekly"' && Set_.show(null) === "?" && Set_.show(1.5) === "1.5");
  const sec = SPEC.mezfes;
  let r = Set_.formValue(sec, { solo_tickets: { useDefault: false, raw: "9" }, group_tickets: { useDefault: true, raw: 1 }, switch_minigame: { useDefault: false, raw: false } });
  check("formValue: defaults left out, numbers are numbers", JSON.stringify(r) === JSON.stringify({ value: { solo_tickets: 9, switch_minigame: false }, errors: [] }), JSON.stringify(r));
  r = Set_.formValue(sec, { solo_tickets: { useDefault: false, raw: "" } });
  check("formValue: an empty number box", r.errors.length === 1 && r.errors[0].indexOf("Solo tickets") === 0, JSON.stringify(r));
  r = Set_.formValue(SPEC.guild, { member_limits: { useDefault: false, raw: [["0", "30"], [3, ""]] } });
  check("formValue: pairs", r.errors.length === 1 && /row 2/.test(r.errors[0]), JSON.stringify(r));
  r = Set_.formValue(SPEC.login_notices, { notices: { useDefault: false, raw: ["a"] }, hide: { useDefault: false, raw: true } });
  check("formValue: texts", JSON.stringify(r.value) === '{"hide":true,"notices":["a"]}', JSON.stringify(r));
  const inputs = Set_.formInputs({ spec: sec, stored: { value: { solo_tickets: 9 } }, defaults: { solo_tickets: 5, group_tickets: 1 }, effective: null });
  check("formInputs", inputs.solo_tickets.useDefault === false && inputs.solo_tickets.raw === 9 && inputs.group_tickets.useDefault === true
    && inputs.group_tickets.raw === 1 && inputs.switch_minigame.raw === null, JSON.stringify(inputs));
  check("stateText applied", Set_.stateText({ state: "applied", process: "hv", appliedAt: "2026-11-20T11:58:00Z" }) === "Applied by the game server (hv, Fri 20 Nov 2026 11:58 UTC).");
  check("stateText refused", /^Refused by the game server: x\. It keeps the last good value\.$/.test(Set_.stateText({ state: "refused", refusal: "x" })));
  check("stateText stale", /over 5 minutes/.test(Set_.stateText({ state: "waiting", stale: true })));
  check("stateText no report", /LiveSettings\.Enabled is off/.test(Set_.stateText({ state: "no-game-server" })));
  check("stateBadge", Set_.stateBadge({ state: "default" }) === "config");
  const rows = Set_.diffRows([{ key: "group_tickets", label: "Group tickets", before: 1, after: 2, beforeDefault: true, afterDefault: false }]);
  check("diffRows", JSON.stringify(rows) === JSON.stringify([["Group tickets (group_tickets)", "1 (config default)", "2"]]), JSON.stringify(rows));
  const h = Set_.historyChanges(sec, { solo_tickets: 9, group_tickets: 1 }, { solo_tickets: 9, switch_minigame: true });
  check("historyChanges", JSON.stringify(h) === JSON.stringify(["Group tickets per week: 1 → config default", "Tokotoko Partnya instead of Volpakkun Together: config default → on"]), JSON.stringify(h));
  check("historyChanges deleted", Set_.historyChanges(sec, { solo_tickets: 9 }, null).pop() === "row deleted: every value back to config.json");
  check("limits", Set_.limits(sec.fields[0]) === "0 to 100, whole number" && Set_.limits(SPEC.sky_corridor.fields[0]) === "one of off, weekly, daily"
    && /1 to 20 rows; From guild rank 0-255, Members 1-100/.test(Set_.limits(SPEC.guild.fields[0])), Set_.limits(SPEC.guild.fields[0]));
  const lines = Set_.impactLines(impactFor({ mode: "latest" }));
  check("impactLines", JSON.stringify(lines) === JSON.stringify([
    "v1.20 and newer play; clients that send no version (v1.18 or older) play too.",
    "Online now: 1 of 4 characters would be refused (1 exempt: staff or listed; 1 sent no version (v1.18 or older); 1 not recorded yet, judged at their next login).",
    "Seen in the last 7 days: 3 of 9 characters would be refused (1 exempt: staff or listed; 1 sent no version (v1.18 or older); 1 not recorded yet, judged at their next login)."]), JSON.stringify(lines));
  const A = { tableReady: true, enabled: true, latest: "1.20", current: "1.20", inSync: true };
  check("autoLine on", Set_.autoLine(A) === "Current: follows the latest release (v1.20).", Set_.autoLine(A));
  check("autoLine on, not in step", Set_.autoLine(Object.assign({}, A, { current: "1.19", inSync: false })) === "Current: follows the latest release (v1.20). The stored Current is v1.19, not v1.20 yet."
    && /is empty, not|is empty/.test("is empty") && /stored Current is empty/.test(Set_.autoLine(Object.assign({}, A, { current: "", inSync: false }))));
  check("autoLine on, no release recorded", /no release recorded yet/.test(Set_.autoLine(Object.assign({}, A, { latest: null, inSync: false }))));
  check("autoLine off", Set_.autoLine(Object.assign({}, A, { enabled: false })) === "Current is typed by hand. The latest release recorded is v1.20."
    && Set_.autoLine({ tableReady: true, enabled: false, latest: null }) === "Current is typed by hand.");
  check("autoLine without the table or the API", /needs the patch_gate_auto table/.test(Set_.autoLine({ tableReady: false })) && Set_.autoLine(null) === "");
  check("impactLines without tracking", /does not record client patches yet/.test(Set_.impactLines({ tracking: false, describe: "Off." }).join(" ")));
  const irows = Set_.impactRows(impactFor({ mode: "latest" }));
  check("impactRows", JSON.stringify(irows.map((r) => r[3])) === JSON.stringify(["plays", "refused (unless exempt)", "plays", "judged at next login"])
    && irows[1][0] === "v1.19" && irows[1][1] === "2", JSON.stringify(irows));
}

/* ---- the page ---- */

async function settingsPage(browser, base) {
  const api = { calls: [], report: true, stored: { mezfes: { value: { solo_tickets: 9 }, version: 7, updatedBy: "boss", updatedAt: "2026-11-20T11:00:00Z", note: null } },
    states: { mezfes: { state: "applied", refusal: null, appliedAt: "2026-11-20T11:58:00Z", process: "hunsterverse", stale: false },
      sky_corridor: { state: "refused", refusal: "floor_rotation: must be one of [off weekly daily]", appliedAt: null, process: "hunsterverse", stale: false } } };
  api.auto = { tableReady: true, enabled: true, latest: "1.20", current: "", inSync: false, updatedBy: "schema", updatedAt: NOW };
  api.stored.sky_corridor = { value: { floor_rotation: "hourly" }, version: 8, updatedBy: "boss", updatedAt: NOW, note: null };
  let r = await open(browser, base + "/admin.html#settings", api, 1280);
  const page = r.page;
  await page.waitForSelector("#set-sections .set-tab", { timeout: 5000 });
  check("tab shown", !(await page.$eval("#panel-settings", (n) => n.hidden)));
  const tabs = await page.$$eval("#set-sections .set-tab", (ns) => ns.map((n) => n.textContent));
  check("sections with states", JSON.stringify(tabs) === JSON.stringify(["MezFesapplied", "Sky Corridorrefused", "Guildconfig", "Login noticesconfig", "Patch gateconfig"]), JSON.stringify(tabs));
  const status = await text(page, "#set-status");
  check("game server report", /hunsterverse: runs version 7, .*read the table Fri 20 Nov 2026 11:59 UTC; refused: sky_corridor\./.test(status), status);
  const ro = await page.$$eval("#set-restart li", (ns) => ns.map((n) => n.textContent));
  check("restart only", JSON.stringify(ro) === JSON.stringify(["API.Messages: 2", "EventCalendar.Enabled: on", "LiveSettings.Enabled: on"]), JSON.stringify(ro));
  await page.waitForSelector("#set-history tr td", { timeout: 5000 });

  // The MezFes form: solo stored (9), group and the minigame on config default.
  const solo = await page.$eval("#set-f-solo_tickets", (n) => ({ v: n.value, d: n.disabled, min: n.min, max: n.max }));
  check("stored field", solo.v === "9" && !solo.d && solo.min === "0" && solo.max === "100", JSON.stringify(solo));
  const group = await page.$eval("#set-f-group_tickets", (n) => ({ v: n.value, d: n.disabled }));
  check("config default field", group.v === "1" && group.d, JSON.stringify(group));
  const form = await text(page, "#set-form");
  check("form texts", /Takes effect: At the next login\./.test(form) && /Applied by the game server \(hunsterverse/.test(form)
    && /config default \(1\)/.test(form) && /Game server runs: 9\. Help for Solo tickets per week\./.test(form)
    && /0 to 100, whole number/.test(form), form);

  // A number box left empty: caught before any request.
  await page.fill("#set-f-solo_tickets", "");
  await page.click("#set-check");
  check("empty number caught", /Solo tickets per week: enter a number\./.test(await text(page, "#set-problems")) && !last(api, "POST", "/check"));
  // Out of limits: the API's problem, no Save.
  await page.fill("#set-f-solo_tickets", "500");
  await page.click("#set-check");
  await page.waitForFunction(() => /must be from 0 to 100/.test(document.getElementById("set-problems").textContent), null, { timeout: 5000 });
  check("problems: no review", await page.$eval("#set-review", (n) => n.hidden));
  // A good change: review, then save with the version edited and the note.
  await page.fill("#set-f-solo_tickets", "9");
  const groupBox = await page.$("[data-key=group_tickets] .set-default input");
  await groupBox.uncheck();
  await page.fill("#set-f-group_tickets", "2");
  await page.fill("#set-note-text", "more group play");
  await page.click("#set-check");
  await page.waitForSelector("#set-review:not([hidden])", { timeout: 5000 });
  const sentCheck = last(api, "POST", "/mezfes/check");
  check("check body", sentCheck && JSON.stringify(sentCheck.body) === '{"value":{"solo_tickets":9,"group_tickets":2}}', JSON.stringify(sentCheck && sentCheck.body));
  const diff = await page.$$eval("#set-diff tr", (ns) => ns.map((n) => Array.from(n.children).map((c) => c.textContent).join(" | ")));
  check("diff before save", JSON.stringify(diff) === JSON.stringify(["Group tickets per week (group_tickets) | 1 (config default) | 2"]), JSON.stringify(diff));
  check("no save before review", !last(api, "PUT", "/api/admin/settings/mezfes"));
  await shot(page, "admin-settings-review-1280.png");
  await page.click("#set-save");
  await page.waitForFunction(() => /saved \(version 8\)/.test(document.getElementById("set-ok").textContent), null, { timeout: 5000 });
  const put = last(api, "PUT", "/api/admin/settings/mezfes");
  check("save body", put && JSON.stringify(put.body) === '{"value":{"solo_tickets":9,"group_tickets":2},"expectedVersion":7,"note":"more group play"}', JSON.stringify(put && put.body));
  await page.waitForFunction(() => /waiting for the game server/.test(document.getElementById("set-form").textContent), null, { timeout: 5000 });
  check("an edit hides the review", true);

  // History: what the change did; markup in the note stays text; revert on the second click.
  const hist = await text(page, "#set-history");
  check("history", /#12 v7/.test(hist) && /Solo tickets per week: config default → 9/.test(hist) && /weekend <b>boost<\/b>/.test(hist), hist);
  check("note is text", (await page.$$("#set-history b")).length === 0);
  const revert = await page.$("#set-history button");
  await revert.click();
  check("revert asks first", !last(api, "POST", "/revert/") && /Click again/.test(await revert.textContent()));
  await revert.click();
  await page.waitForFunction(() => /Reverted change #12/.test(document.getElementById("set-ok").textContent), null, { timeout: 5000 });
  const rv = last(api, "POST", "/mezfes/revert/12");
  check("revert body", rv && JSON.stringify(rv.body) === '{"expectedVersion":8}', JSON.stringify(rv && rv.body));

  // A refused section says why; the select holds the stored value.
  await page.click("[data-section=sky_corridor]");
  await page.waitForFunction(() => /Refused by the game server: floor_rotation/.test(document.getElementById("set-form").textContent), null, { timeout: 5000 });

  // The pair editor: add a row, fill it, review sends three rows.
  await page.click("[data-section=guild]");
  await page.waitForSelector("[data-key=member_limits]", { timeout: 5000 });
  await (await page.$("[data-key=member_limits] .set-default input")).uncheck();
  check("pairs from config", (await page.$$("[data-key=member_limits] .set-pair")).length === 2);
  await page.click("[data-key=member_limits] .set-editor > button");
  const inputs = await page.$$("[data-key=member_limits] .set-pair input");
  await inputs[4].fill("7");
  await inputs[5].fill("50");
  await page.click("#set-check");
  await page.waitForSelector("#set-review:not([hidden])", { timeout: 5000 });
  const g = last(api, "POST", "/guild/check");
  check("pairs sent", g && JSON.stringify(g.body.value) === '{"member_limits":[[0,30],[3,40],[7,50]]}', JSON.stringify(g && g.body));

  // Login notices: a notice with markup stays text in the box; remove leaves none.
  await page.click("[data-section=login_notices]");
  await page.waitForSelector("[data-key=notices] textarea", { timeout: 5000 });
  check("notice text", (await page.$eval("[data-key=notices] textarea", (n) => n.value)) === "<BODY>Welcome");
  check("no impact box outside the patch gate", !(await page.$("#set-impact")));

  // Patch gate: the stored values' count when it opens, the form's after an edit (POST with the form's value).
  await page.click("[data-section=patch_gate]");
  await page.waitForFunction(() => /With the stored values\./.test((document.getElementById("set-impact-text") || {}).textContent || ""), null, { timeout: 5000 });
  let imp = await text(page, "#set-impact");
  check("impact of the stored values", /Off: every client patch plays\./.test(imp) && /Online now: 0 of 4 characters would be refused/.test(imp), imp);
  check("impact is a GET first", !!last(api, "GET", "/patch_gate/impact") && !last(api, "POST", "/patch_gate/impact"));
  await (await page.$("[data-key=mode] .set-default input")).uncheck();
  await page.selectOption("#set-f-mode", "latest");
  await page.waitForFunction(() => /not saved yet/.test(document.getElementById("set-impact-text").textContent), null, { timeout: 5000 });
  imp = await text(page, "#set-impact");
  const posted = last(api, "POST", "/patch_gate/impact");
  check("impact of the form", posted && posted.body.value.mode === "latest" && !("current" in posted.body.value)
    && /Online now: 1 of 4 characters would be refused \(1 exempt: staff/.test(imp) && /Seen in the last 7 days: 3 of 9/.test(imp), imp + " " + JSON.stringify(posted && posted.body));
  const impRows = await page.$$eval("#set-impact-rows tr", (ns) => ns.map((n) => Array.from(n.children).map((c) => c.textContent).join(" | ")));
  check("impact table", impRows.length === 4 && impRows[1] === "v1.19 | 2 | 3 | refused (unless exempt)" && impRows[3] === "not recorded | 1 | 0 | judged at next login", JSON.stringify(impRows));
  await shot(page, "admin-settings-patch-gate-1280.png");

  // The switch: on and stored Current empty (the release has not set it yet): the field is read-only.
  check("auto sentence", (await text(page, "#set-auto-text")) === "Current: follows the latest release (v1.20). The stored Current is empty, not v1.20 yet.", await text(page, "#set-auto-text"));
  check("auto: switch on", await page.$eval("#set-auto-on", (n) => n.checked));
  check("auto: Current is read-only, with no config default box", await page.$eval("#set-f-current", (n) => n.disabled) && !(await page.$("[data-key=current] .set-default")));
  check("auto: the field's help says it follows the release", /Current: follows the latest release \(v1\.20\)\./.test(await text(page, "[data-key=current]")));
  check("other fields keep their config default boxes", !!(await page.$("[data-key=mode] .set-default")) && !!(await page.$("[data-key=allow_unknown] .set-default")));
  check("auto: GET before any PUT", !!last(api, "GET", "/patch_gate/auto") && !last(api, "PUT", "/patch_gate/auto"));
  await shot(page, "admin-settings-patch-gate-auto-1280.png");
  // Set Current now: PUT enabled true, the API fills it, the form shows it stored and in step.
  await page.click("#set-auto-now");
  await page.waitForFunction(() => /Current is now v1\.20/.test(document.getElementById("set-ok").textContent), null, { timeout: 5000 });
  check("auto: set now sends enabled true", JSON.stringify(last(api, "PUT", "/patch_gate/auto").body) === '{"enabled":true}');
  await page.waitForFunction(() => document.getElementById("set-f-current") && document.getElementById("set-f-current").value === "1.20", null, { timeout: 5000 });
  check("auto: in step, no Set-now button, field shows the release", (await text(page, "#set-auto-text")) === "Current: follows the latest release (v1.20)." && !(await page.$("#set-auto-now"))
    && await page.$eval("#set-f-current", (n) => n.disabled));
  // Off: typed by hand again, the field is editable.
  await page.uncheck("#set-auto-on");
  await page.waitForFunction(() => /typed by hand again/.test(document.getElementById("set-ok").textContent), null, { timeout: 5000 });
  check("auto: off sends enabled false", JSON.stringify(last(api, "PUT", "/patch_gate/auto").body) === '{"enabled":false}');
  await page.waitForFunction(() => /Current is typed by hand\./.test((document.getElementById("set-auto-text") || {}).textContent || ""), null, { timeout: 5000 });
  check("auto: off sentence and an editable field", (await text(page, "#set-auto-text")) === "Current is typed by hand. The latest release recorded is v1.20."
    && !(await page.$eval("#set-f-current", (n) => n.disabled)) && !(await page.$eval("#set-auto-on", (n) => n.checked)));
  // A refusal (no release recorded): shown, the switch goes back off.
  api.autoFail = "No release is recorded yet (release-patch.sh writes it at each release): type Current by hand once, then it follows the next release.";
  await page.check("#set-auto-on");
  await page.waitForFunction(() => /No release is recorded yet/.test(document.getElementById("set-alert").textContent), null, { timeout: 5000 });
  check("auto: refusal shown, switch back off", !(await page.$eval("#set-auto-on", (n) => n.checked)));
  api.autoFail = null;
  await page.check("#set-auto-on");
  await page.waitForFunction(() => /Latest version follows the latest release\./.test(document.getElementById("set-ok").textContent), null, { timeout: 5000 });
  check("auto: on again (nothing to change)", JSON.stringify(last(api, "PUT", "/patch_gate/auto").body) === '{"enabled":true}');
  check("no errors on the admin page", r.errors.length === 0, r.errors.join("; "));
  await shot(page, "admin-settings-1280.png");
  await page.close();

  // A moderator editing the gate: the count falls back to the stored values.
  r = await open(browser, base + "/admin.html#settings", { calls: [], report: true, moderator: true, stored: {}, states: {} }, 1280);
  await r.page.waitForSelector("[data-section=patch_gate]", { timeout: 5000 });
  await r.page.click("[data-section=patch_gate]");
  await r.page.waitForSelector("#set-f-mode", { timeout: 5000 });
  await (await r.page.$("[data-key=mode] .set-default input")).uncheck();
  await r.page.selectOption("#set-f-mode", "latest");
  await r.page.waitForTimeout(1200);
  const modText = await text(r.page, "#set-impact-text");
  check("moderator: stored values, no error", /With the stored values\./.test(modText) && !/Could not count/.test(modText), modText);
  check("an API without the switch: no switch box, Current editable", !(await r.page.$("#set-auto")) && !!(await r.page.$("[data-key=current] .set-default")));
  check("no errors for a moderator", r.errors.length === 0, r.errors.join("; "));
  // 375 px with the patch gate open: the box adds no overflow of its own (the page's header has some already).
  const before375 = await (async () => {
    const pg = await open(browser, base + "/admin.html#settings", { calls: [], report: true, stored: {}, states: {} }, 375);
    await pg.page.waitForSelector("#set-f-solo_tickets", { timeout: 5000 });
    const o = await pg.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await pg.page.click("[data-section=patch_gate]");
    await pg.page.waitForFunction(() => /With the stored values/.test((document.getElementById("set-impact-text") || {}).textContent || ""), null, { timeout: 5000 });
    const o2 = await pg.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const box = await pg.page.$eval("#set-impact", (n) => n.getBoundingClientRect().right - document.documentElement.clientWidth);
    await shot(pg.page, "admin-settings-patch-gate-375.png");
    await pg.page.close();
    return { o, o2, box };
  })();
  check("patch gate at 375 px adds no overflow", before375.o2 <= before375.o && before375.box <= 0, JSON.stringify(before375));
  await r.page.close();

  // 375 px: no horizontal overflow.
  r = await open(browser, base + "/admin.html#settings", { calls: [], report: true, stored: {}, states: {} }, 375);
  await r.page.waitForSelector("#set-sections .set-tab", { timeout: 5000 });
  await r.page.waitForSelector("#set-f-solo_tickets", { timeout: 5000 });
  const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no overflow at 375 px", overflow <= 0, String(overflow));
  await shot(r.page, "admin-settings-375.png");
  check("no errors at 375", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  // No table, no game server.
  r = await open(browser, base + "/admin.html#settings", { calls: [], report: false, tableReady: false, stored: {}, states: {} }, 1280);
  await r.page.waitForSelector("#set-sections .set-tab", { timeout: 5000 });
  const st = await text(r.page, "#set-status");
  check("table missing", /server_settings table is not in the database yet/.test(st) && /no report yet/.test(st), st);
  check("no report state", /LiveSettings\.Enabled is off/.test(await text(r.page, "#set-form")));
  check("no errors without a table", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();
}

(async () => {
  helpers();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await settingsPage(browser, base);
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
  console.log("admin settings OK");
})();
