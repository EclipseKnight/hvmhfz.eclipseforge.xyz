#!/usr/bin/env node
/* Checks the admin panel's Balance tab (js/admin-balance.js) in headless Chromium against a fake API (the contract
   of /api/admin/balance, see the API's README):

   - the draft rows with names and current values from data/weapons/ (served from the weapon-db worktree when this
     site has no data/weapons folder), the published line, problems per row;
   - the form: attack move (type, style, move picked or typed, any move), melee and ranged weapon by name search,
     the field list from the API, the current value next to the draft value, "multiply" with its result, the
     required reason, nothing sent until the form is right, the body of every POST and PUT;
   - Edit, Delete on the second click, Up and Down (the order sent);
   - the diff; Publish with a required note, the two steps, the fingerprint sent, a 409 shown;
   - versions and Roll back (note required);
   - the publish gate: while the stable patch cannot receive tables the reason shows, Publish is off for a draft
     with rows (on for an empty one) and Roll back is off for a version with rows;
   - a moderator: read only; a missing table; the weapon data missing (numbers typed by hand);
   - markup in a reason stays text; no horizontal overflow at 375 px; no page errors; the pure helpers under node.

   Screenshots go to /srv/devbot/.bot-logs/balance-admin/ (balance-*.png) when that folder exists, else dev-shots/.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-balance.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const B = require("../js/admin-balance.js");

const root = path.join(__dirname, "..");
const LOGS = "/srv/devbot/.bot-logs/balance-admin";
const shots = fs.existsSync(LOGS) ? LOGS : path.join(root, "dev-shots");
const dataRoot = fs.existsSync(path.join(root, "data", "weapons")) ? path.join(root, "data", "weapons") : "/srv/devbot/weapon-db/data/weapons";
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
let serveData = true;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(root, url);
  if (url.startsWith("/data/weapons/")) {
    if (!serveData) { res.writeHead(404); res.end(); return; }
    file = path.join(dataRoot, path.basename(url));
  }
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

const CLASSES = ["GS", "HBG", "Hammer", "Lance", "SnS", "LBG", "DS", "LS", "HH", "GL", "Bow", "Tonfa", "SAF", "MS"];
const F = (kind, name, scale, min, max) => ({ kind, name, offset: 0, size: 2, scale, min, max });
const FIELDS = [F("attack", "delay", true, 0, 65535), F("attack", "mv", true, 0, 65535), F("attack", "reaction", false, 0, 65535),
  F("attack", "element_value", true, 0, 65535), F("attack", "ko", true, 0, 255),
  F("melee", "sharpness", false, 0, 127), F("melee", "attack", true, 1, 1500), F("melee", "affinity", false, -100, 100),
  F("ranged", "attack", true, 1, 1500), F("ranged", "recoil", false, 0, 20), F("ranged", "charge_row", false, 0, 67)];

const row = (id, position, o) => Object.assign({ id, position, kind: "attack", weaponClass: "GS", style: "storm", entry: 0, recordId: 165,
  field: "mv", op: "set", value: 100, reason: "https://discord.example/t/1", author: "boss", updatedAt: "2026-11-10T14:00:00Z" }, o || {});

function newApi(extra) {
  const api = Object.assign({
    calls: [], tableReady: true, moderator: false, nextId: 10, nextVersion: 3, publishFail: null,
    rows: [
      row(3, 1),
      row(4, 2, { weaponClass: "LS", style: null, entry: null, recordId: null, field: "mv", op: "scale", value: 1.05, reason: "<b>all LS</b>" }),
      row(5, 3, { kind: "melee", weaponClass: null, style: null, entry: null, recordId: 1, field: "attack", op: "set", value: 62, reason: "iron sword" }),
      row(6, 4, { entry: 99, recordId: 9999, field: "ko", value: 4, reason: "unknown move" })],
    problems: [{ rowId: 6, message: "ko: no such record" }],
    published: { version: 2, sha256: "ab", rowCount: 4, publishedBy: "boss", publishedAt: "2026-11-10T15:00:00Z", note: "first pass", rollbackOf: null },
    versions: [
      { version: 2, sha256: "ab", rowCount: 4, publishedBy: "boss", publishedAt: "2026-11-10T15:00:00Z", note: "first pass", rollbackOf: null },
      { version: 1, sha256: "cd", rowCount: 2, publishedBy: "boss", publishedAt: "2026-11-09T15:00:00Z", note: "start", rollbackOf: null }],
    publishedRows: [row(3, 1, { value: 90 }), row(5, 2, { kind: "melee", weaponClass: null, style: null, entry: null, recordId: 1, field: "attack", op: "set", value: 62, reason: "iron sword" }),
      row(7, 3, { weaponClass: "SnS", entry: 0, recordId: 22, field: "mv", value: 30, reason: "old" })],
    fingerprint: "f1",
    publishGate: { allowed: true, stablePatch: "v1.21", minimumPatch: "v1.21-pre8", reason: null }
  }, extra || {});
  if (!extra || !extra.problems) api.problems = [{ rowId: 6, message: "ko: no such record" }];
  return api;
}

function overview(api) {
  return { tableReady: api.tableReady, publicEnabled: false, fields: FIELDS, classes: CLASSES, styles: ["earth", "heaven", "storm", "extreme"],
    maxRows: 4096, meleeRecords: 17568, rangedRecords: 4223, rows: api.rows, problems: api.problems, fingerprint: api.fingerprint, published: api.published,
    publishGate: api.publishGate };
}

function diffOf(api) {
  const key = (r) => r.id;
  const pub = new Map(api.publishedRows.map((r) => [key(r), r]));
  const cur = new Map(api.rows.map((r) => [key(r), r]));
  const added = api.rows.filter((r) => !pub.has(key(r)));
  const removed = api.publishedRows.filter((r) => !cur.has(key(r)));
  const changed = api.rows.filter((r) => pub.has(key(r)) && JSON.stringify(Object.assign({}, pub.get(key(r)), { position: 0, updatedAt: 0 })) !== JSON.stringify(Object.assign({}, r, { position: 0, updatedAt: 0 })))
    .map((r) => ({ before: pub.get(key(r)), after: r }));
  return { from: api.published ? api.published.version : null, to: null, added, removed, changed, unchanged: api.rows.length - added.length - changed.length, orderChanged: false };
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
    if (p === "/api/account") return reply(200, { username: "boss", roles: api.moderator ? ["ROLE_MODERATOR"] : ["ROLE_ADMIN"] });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (!p.startsWith("/api/admin/balance")) return reply(404, { message: "Not Found" });
    if (!api.tableReady && !(p === "/api/admin/balance")) return reply(503, { message: "balance tables missing" });
    if (req.method() !== "GET" && api.moderator) return reply(403, { message: "Forbidden" });
    let m;
    if (p === "/api/admin/balance") return reply(200, overview(api));
    if (p === "/api/admin/balance/diff") return reply(200, diffOf(api));
    if (p === "/api/admin/balance/versions") return reply(200, api.versions);
    if (p === "/api/admin/balance/rows" && req.method() === "POST") {
      if (sent.field === "reaction" && sent.op === "scale") return reply(400, { message: "Refused", problems: ["reaction cannot scale (set it)"] });
      const r = Object.assign({ id: api.nextId++, position: api.rows.length + 1, author: "boss", updatedAt: "2026-11-10T16:00:00Z" }, sent);
      api.rows.push(r);
      api.fingerprint = "f" + api.nextId;
      return reply(201, r);
    }
    if (p === "/api/admin/balance/rows/order") {
      api.rows = sent.ids.map((id, i) => Object.assign({}, api.rows.find((r) => r.id === id), { position: i + 1 }));
      api.fingerprint = "f-order";
      return reply(200, { rows: api.rows });
    }
    if ((m = p.match(/^\/api\/admin\/balance\/rows\/(\d+)\/delete$/))) {
      api.rows = api.rows.filter((r) => r.id !== Number(m[1]));
      api.problems = api.problems.filter((x) => x.rowId !== Number(m[1]));
      api.fingerprint = "f-del";
      return reply(200, { deleted: Number(m[1]) });
    }
    if ((m = p.match(/^\/api\/admin\/balance\/rows\/(\d+)$/)) && req.method() === "PUT") {
      const i = api.rows.findIndex((r) => r.id === Number(m[1]));
      api.rows[i] = Object.assign({}, api.rows[i], sent);
      api.fingerprint = "f-put";
      return reply(200, api.rows[i]);
    }
    if (p === "/api/admin/balance/publish") {
      if (api.publishFail) return reply(409, { message: api.publishFail });
      const v = { version: api.nextVersion, sha256: "ee", rowCount: api.rows.length, publishedBy: "boss", publishedAt: "2026-11-10T17:00:00Z", note: sent.note, rollbackOf: null };
      api.versions.unshift(v);
      api.published = v;
      api.publishedRows = api.rows.slice();
      return reply(200, v);
    }
    if ((m = p.match(/^\/api\/admin\/balance\/rollback\/(\d+)$/))) {
      const v = { version: api.nextVersion, sha256: "ff", rowCount: 2, publishedBy: "boss", publishedAt: "2026-11-10T18:00:00Z", note: sent.note, rollbackOf: Number(m[1]) };
      api.versions.unshift(v);
      api.published = v;
      return reply(200, v);
    }
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

async function shot(page, name, selector) {
  fs.mkdirSync(shots, { recursive: true });
  const file = path.join(shots, name);
  if (selector) await (await page.$(selector)).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const last = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).pop();
const count = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).length;
// Elements of the tab (outside the tables, which scroll on their own) that run past the right edge of the screen.
const panelOverflow = (page) => page.evaluate(() => Array.from(document.querySelectorAll("#panel-balance *")).filter((n) => !n.closest(".table-wrap")
  && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5)
  .map((n) => n.tagName + "#" + n.id + "." + n.className + " " + Math.round(n.getBoundingClientRect().right)));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ---- the pure helpers ---- */

function helpers() {
  const data = { index: { types: [{ slug: "great-sword", name: "Great Sword", short: "GS", class: 0, kind: "melee" },
    { slug: "hammer", name: "Hammer", short: "HA", class: 2, kind: "melee" }, { slug: "bow", name: "Bow", short: "BW", class: 10, kind: "bow" }] },
  files: { "great-sword": { fields: ["id", "name", "attack", "affinity", "sharpness"], weapons: [[1, "Iron Sword", 60, 5, 0], [2, "Steel Sword", 70, 0, 3]],
    moves: [{ kind: 0, id: 165, mv: [92], name: "Lv1 charge", styles: "X" }, { kind: 0, id: 2, mv: [46], ko: 7, elementValue: 5, styles: "EHSX" }] } } };
  check("typeFor by class number", (B.typeFor(data, "Hammer", CLASSES) || {}).slug === "hammer" && B.typeFor(data, "SnS", CLASSES) === null);
  check("typeName", B.typeName(data, "GS", CLASSES) === "Great Sword" && B.typeName(data, "SnS", CLASSES) === "SnS" && B.typeName(data, null, CLASSES) === "any type");
  const mv = B.findMove(data, "GS", CLASSES, 0, 165);
  check("findMove and moveValue", mv && mv.name === "Lv1 charge" && B.moveValue(mv, "mv") === 92 && B.moveValue(mv, "ko") === null
    && B.moveValue(B.findMove(data, "GS", CLASSES, 0, 2), "ko") === 7 && B.moveValue(B.findMove(data, "GS", CLASSES, 0, 2), "element_value") === 5
    && B.moveValue(mv, "delay") === null && B.findMove(data, "GS", CLASSES, 5, 5) === null);
  check("moveLabel", B.moveLabel(0, 165, mv) === "Lv1 charge (k0 #165)" && B.moveLabel(6, 7, null) === "k6 #7" && B.moveLabel(null, null, null) === "any move" && B.moveLabel(null, 3, null) === "k* #3");
  const w = B.findWeapon(data, "melee", 2);
  check("findWeapon and weaponValue", w && w.name === "Steel Sword" && B.weaponValue(w, "sharpness") === 3 && B.weaponValue(w, "attack") === 70
    && B.weaponValue(w, "recoil") === null && B.findWeapon(data, "ranged", 2) === null);
  check("searchWeapons", B.searchWeapons(data, "melee", "sword", 10).length === 2 && B.searchWeapons(data, "melee", "steel", 10)[0].id === 2
    && B.searchWeapons(data, "melee", "2", 10).length === 1 && B.searchWeapons(data, "melee", "", 10).length === 0 && B.searchWeapons(data, "melee", "sword", 1).length === 1);
  check("scaled truncates like the client", B.scaled(92, 1.05) === 96 && B.scaled(100, 1.15) === 115 && B.scaled(100, 0.5) === 50 && B.scaled(null, 2) === null && B.scaled("x", 2) === null);
  check("changeText", B.changeText({ op: "scale", value: 1.05 }, 92) === "x 1.05 = 96" && B.changeText({ op: "scale", value: 1.05 }, null) === "x 1.05" && B.changeText({ op: "set", value: 100 }, 92) === "set 100");
  check("whatText", B.whatText(row(1, 1), data, CLASSES) === "Great Sword, Storm, Lv1 charge (k0 #165)"
    && B.whatText(row(1, 1, { weaponClass: null, style: null, entry: null, recordId: null }), data, CLASSES) === "any type, any style, any move"
    && B.whatText(row(1, 1, { kind: "melee", recordId: 1 }), data, CLASSES) === "Iron Sword (Great Sword, #1)"
    && B.whatText(row(1, 1, { kind: "melee", recordId: 99 }), data, CLASSES) === "weapon #99");
  check("currentOf", B.currentOf(row(1, 1), data, CLASSES) === 92 && B.currentOf(row(1, 1, { entry: null }), data, CLASSES) === null
    && B.currentOf(row(1, 1, { kind: "melee", recordId: 1, field: "attack" }), data, CLASSES) === 60);
  check("stylesText", B.stylesText("EHSX") === "Earth, Heaven, Storm, Extreme" && B.stylesText("X") === "Extreme" && B.stylesText("") === "none");
  check("diff words", B.publishQuestion(3, { added: [1], removed: [], changed: [1, 2] }) === "Publish v3: 1 added, 0 removed, 2 changed"
    && B.diffEmpty({ added: [], removed: [], changed: [], orderChanged: false }) && !B.diffEmpty({ added: [], removed: [], changed: [], orderChanged: true }));
  const shut = { publishGate: { allowed: false, reason: "stable is v1.20" } };
  check("publishBlocked", B.publishBlocked(shut, 1) === "stable is v1.20" && B.publishBlocked(shut, 0) === null
    && B.publishBlocked({ publishGate: { allowed: true, reason: null } }, 5) === null && B.publishBlocked({}, 5) === null);
  check("nextVersion", B.nextVersion([{ version: 3 }, { version: 2 }], { version: 3 }) === 4 && B.nextVersion([], null) === 1);
  check("moveIds", JSON.stringify(B.moveIds([{ id: 3 }, { id: 1 }, { id: 2 }], 1, -1)) === "[1,3,2]" && B.moveIds([{ id: 3 }], 0, -1) === null && B.moveIds([{ id: 3 }, { id: 4 }], 1, 1) === null);
  check("parseAny", B.parseAny("*") === null && B.parseAny("") === null && B.parseAny(" 165 ") === 165 && B.parseAny("x") === undefined && B.parseAny("70000") === undefined && B.parseAny("-1") === undefined);
  const ov = { fields: FIELDS, meleeRecords: 17568, rangedRecords: 4223 };
  let r = B.buildRow({ kind: "attack", type: "GS", style: "storm", entry: "0", id: "165", field: "mv", op: "set", value: "100", reason: " t " }, ov);
  check("buildRow attack", r.errors.length === 0 && JSON.stringify(r.body) === JSON.stringify({ kind: "attack", weaponClass: "GS", style: "storm", entry: 0, recordId: 165, field: "mv", op: "set", value: 100, reason: "t" }), JSON.stringify(r));
  r = B.buildRow({ kind: "attack", type: "", style: "", entry: "*", id: "*", field: "mv", op: "scale", value: "1.05", reason: "t" }, ov);
  check("buildRow any move", r.errors.length === 0 && r.body.weaponClass === null && r.body.entry === null && r.body.recordId === null && r.body.value === 1.05, JSON.stringify(r));
  r = B.buildRow({ kind: "melee", id: "1", field: "attack", op: "set", value: "62", reason: "t" }, ov);
  check("buildRow weapon", r.errors.length === 0 && r.body.recordId === 1 && r.body.weaponClass === null && r.body.entry === null, JSON.stringify(r));
  r = B.buildRow({ kind: "melee", id: "99999", field: "attack", op: "set", value: "0", reason: "" }, ov);
  check("buildRow errors", r.errors.length === 3, JSON.stringify(r.errors));
  r = B.buildRow({ kind: "attack", type: "", style: "", entry: "*", id: "*", field: "reaction", op: "scale", value: "1.1", reason: "t" }, ov);
  check("buildRow cannot scale", r.errors.length === 1 && /cannot be multiplied/.test(r.errors[0]), JSON.stringify(r.errors));
  r = B.buildRow({ kind: "attack", type: "", style: "", entry: "*", id: "*", field: "mv", op: "set", value: "70000", reason: "t" }, ov);
  check("buildRow range", r.errors.length === 1 && /0 to 65535/.test(r.errors[0]), JSON.stringify(r.errors));
  check("utc", B.utc("2026-11-10T15:00:00Z") === "2026-11-10 15:00 UTC" && B.utc(null) === "");
}

async function balancePage(browser, base) {
  // ---- the admin, with the data ----
  serveData = true;
  const api = newApi();
  let r = await open(browser, base + "/admin.html#balance", api, 1280);
  let page = r.page;
  await page.waitForSelector("#bal-rows tr td:nth-child(2)", { timeout: 8000 });
  check("tab selected", (await page.getAttribute("#tab-balance", "aria-selected")) === "true" && !(await page.$eval("#panel-balance", (n) => n.hidden)));
  const status = await text(page, "#bal-status");
  check("status line", /Published: v2, 4 rows, by boss, 2026-11-10 15:00 UTC \(first pass\)/.test(status) && /Draft: 4 of at most 4096 rows/.test(status), status);
  const cells = await page.$$eval("#bal-rows tr", (trs) => trs.map((t) => Array.from(t.children).map((c) => c.textContent)));
  check("rows count", cells.length === 4, String(cells.length));
  check("row 1: names, current, change", cells[0][1] === "Great Sword, Storm, Lv1 charge (k0 #165)" && cells[0][2] === "mv" && cells[0][3] === "92" && cells[0][4] === "set 100", JSON.stringify(cells[0]));
  check("row 2: any move scale, no current", /^Long Sword, any style, any move$/.test(cells[1][1]) && cells[1][3] === "unknown" && cells[1][4] === "x 1.05", JSON.stringify(cells[1]));
  check("row 2: markup stays text", cells[1][5] === "<b>all LS</b>" && (await page.$$("#bal-rows b")).length === 0, cells[1][5]);
  check("row 3: weapon name, current", cells[2][1] === "Iron Sword (Great Sword, #1)" && cells[2][3] === "60" && cells[2][4] === "set 62", JSON.stringify(cells[2]));
  check("row 4: unknown move and its problem", cells[3][1] === "Great Sword, Storm, k99 #9999" && cells[3][3] === "unknown" && cells[3][7] === "ko: no such record", JSON.stringify(cells[3]));
  check("problem list above the table", /Row #6: ko: no such record/.test(await text(page, "#bal-draft-problems")));
  check("type names from the data", /Great Sword \(GS\)/.test(await text(page, "#bal-type")) && /Hammer \(Hammer\)/.test(await text(page, "#bal-type")));
  check("field list from the API", (await page.$$eval("#bal-field option", (o) => o.map((x) => x.value))).join() === "delay,mv,reaction,element_value,ko");
  check("no missing-data note, no missing-table note", (await page.$eval("#bal-nodata", (n) => n.hidden)) && (await page.$eval("#bal-notable", (n) => n.hidden)));
  check("nothing of the tab runs past the screen at 1280", (await panelOverflow(page)).length === 0, JSON.stringify(await panelOverflow(page)));
  await shot(page, "balance-1280.png");

  // The form: an attack move.
  await page.selectOption("#bal-type", "GS");
  await page.selectOption("#bal-style", "storm");
  await page.fill("#bal-mfilter", "lv1");
  const picks = await page.$$eval("#bal-move option", (o) => o.map((x) => x.textContent));
  check("move filter keeps the match", picks.some((t) => /^Lv1 charge k0 #165 mv 92 X$/.test(t)) && !picks.some((t) => /Lv2 charge/.test(t)), picks.join("|"));
  await page.selectOption("#bal-move", { label: picks.find((t) => /^Lv1 charge/.test(t)) });
  check("picking a move fills entry and id", (await page.inputValue("#bal-entry")) === "0" && (await page.inputValue("#bal-id")) === "165");
  await page.selectOption("#bal-field", "mv");
  await page.fill("#bal-value", "100");
  check("current value shown", /Current value: 92\. After: 100\./.test(await text(page, "#bal-current")), await text(page, "#bal-current"));
  check("styles that reach the move", /Styles that reach this move: Extreme\. The style picked here is not one of them\./.test(await text(page, "#bal-move-note")), await text(page, "#bal-move-note"));
  await page.selectOption("#bal-op", "scale");
  await page.fill("#bal-value", "1.05");
  check("scale shows the result", /Current value: 92\. After: 96 \(92 x 1\.05/.test(await text(page, "#bal-current")), await text(page, "#bal-current"));
  await page.selectOption("#bal-field", "reaction");
  check("a field that cannot scale turns the op back to set", (await page.inputValue("#bal-op")) === "set" && (await page.$eval("#bal-op option[value=scale]", (o) => o.disabled)));
  await page.selectOption("#bal-field", "mv");
  await page.selectOption("#bal-op", "set");
  await page.fill("#bal-value", "100");
  // Reason missing: nothing is sent.
  const before = api.calls.length;
  await page.click("#bal-save");
  check("reason required", /Write the reason/.test(await text(page, "#bal-problems")) && count(api, "POST", "/rows") === 0 && api.calls.length === before);
  await page.fill("#bal-reason", "https://discord.example/t/42");
  await page.click("#bal-save");
  await page.waitForFunction(() => /added to the draft/.test(document.getElementById("bal-ok").textContent), null, { timeout: 5000 });
  check("add: body", JSON.stringify(last(api, "POST", "/rows").body) === JSON.stringify({ kind: "attack", weaponClass: "GS", style: "storm", entry: 0, recordId: 165, field: "mv", op: "set", value: 100, reason: "https://discord.example/t/42" }), JSON.stringify(last(api, "POST", "/rows").body));
  check("add: five rows now", (await page.$$("#bal-rows tr")).length === 5);

  // Any move, typed by hand.
  await page.selectOption("#bal-type", "");
  await page.selectOption("#bal-style", "");
  await page.fill("#bal-entry", "*");
  await page.fill("#bal-id", "*");
  await page.selectOption("#bal-field", "ko");
  await page.selectOption("#bal-op", "scale");
  await page.fill("#bal-value", "1.5");
  await page.fill("#bal-reason", "thread");
  await page.click("#bal-save");
  await page.waitForFunction(() => document.querySelectorAll("#bal-rows tr").length === 6, null, { timeout: 5000 });
  check("any move: body", JSON.stringify(last(api, "POST", "/rows").body) === JSON.stringify({ kind: "attack", weaponClass: null, style: null, entry: null, recordId: null, field: "ko", op: "scale", value: 1.5, reason: "thread" }), JSON.stringify(last(api, "POST", "/rows").body));

  // The API's refusal.
  await page.selectOption("#bal-field", "reaction").catch(() => {});
  await page.evaluate(() => { const o = document.getElementById("bal-op"); o.querySelector("option[value=scale]").disabled = false; o.value = "scale"; });
  await page.fill("#bal-value", "1.1");
  await page.evaluate(() => { document.getElementById("bal-form").dispatchEvent(new Event("submit", { cancelable: true })); });
  await page.waitForTimeout(400);
  check("a refusal's problems are shown", /cannot be multiplied|cannot scale/.test((await text(page, "#bal-problems")) + (await text(page, "#bal-alert"))), await text(page, "#bal-problems"));

  // A melee weapon found by name.
  await page.selectOption("#bal-kind", "melee");
  check("weapon group shown, attack group hidden", !(await page.$eval("#bal-weapon-group", (n) => n.hidden)) && (await page.$eval("#bal-attack-group", (n) => n.hidden)));
  check("melee fields", (await page.$$eval("#bal-field option", (o) => o.map((x) => x.value))).join() === "sharpness,attack,affinity");
  await page.waitForFunction(() => !/Loading/.test(document.getElementById("bal-weapon-note").textContent), null, { timeout: 8000 });
  await page.fill("#bal-wsearch", "Iron Sword");
  await page.waitForSelector("#bal-wresults button", { timeout: 5000 });
  const found = await page.$$eval("#bal-wresults button", (b) => b.map((x) => x.textContent));
  check("search results", found.length >= 1 && found.some((t) => /^Iron Sword \(Great Sword, #1\)$/.test(t)), found.join("|"));
  await page.click("#bal-wresults button:first-child");
  check("pick fills the id", (await page.inputValue("#bal-wid")) === "1" && /Iron Sword \(Great Sword, attack 60\)/.test(await text(page, "#bal-weapon-note")), await text(page, "#bal-weapon-note"));
  await page.selectOption("#bal-field", "attack");
  await page.selectOption("#bal-op", "set");
  await page.fill("#bal-value", "62");
  check("weapon current value", /Current value: 60\. After: 62\./.test(await text(page, "#bal-current")), await text(page, "#bal-current"));
  await page.fill("#bal-reason", "iron sword thread");
  await page.click("#bal-save");
  await page.waitForFunction(() => document.querySelectorAll("#bal-rows tr").length === 7, null, { timeout: 5000 });
  check("weapon: body", JSON.stringify(last(api, "POST", "/rows").body) === JSON.stringify({ kind: "melee", weaponClass: null, style: null, entry: null, recordId: 1, field: "attack", op: "set", value: 62, reason: "iron sword thread" }), JSON.stringify(last(api, "POST", "/rows").body));
  // A ranged weapon: the heavy bowgun file; the data's text for the charge row.
  await page.selectOption("#bal-kind", "ranged");
  await page.waitForFunction(() => !/Loading/.test(document.getElementById("bal-weapon-note").textContent), null, { timeout: 8000 });
  check("ranged fields", (await page.$$eval("#bal-field option", (o) => o.map((x) => x.value))).join() === "attack,recoil,charge_row");
  await page.fill("#bal-wsearch", "Arbalest");
  await page.waitForSelector("#bal-wresults button", { timeout: 5000 });
  check("ranged search finds a bowgun", /Arbalest \(Heavy Bowgun, #13\)/.test(await text(page, "#bal-wresults")), await text(page, "#bal-wresults"));
  await page.click("#bal-wresults button:first-child");
  await page.selectOption("#bal-field", "recoil");
  check("ranged current value", /Current value: 2\./.test(await text(page, "#bal-current")), await text(page, "#bal-current"));

  // Edit the first row.
  await page.selectOption("#bal-kind", "attack");
  await page.click("#bal-rows tr:nth-child(1) button:nth-child(1)");
  await page.waitForFunction(() => document.getElementById("bal-value").value === "100", null, { timeout: 5000 });
  check("edit fills the form", (await text(page, "#bal-form-title")) === "Edit row #3" && (await page.inputValue("#bal-type")) === "GS" && (await page.inputValue("#bal-style")) === "storm"
    && (await page.inputValue("#bal-entry")) === "0" && (await page.inputValue("#bal-id")) === "165" && (await page.inputValue("#bal-field")) === "mv"
    && (await page.inputValue("#bal-reason")) === "https://discord.example/t/1" && (await text(page, "#bal-save")) === "Save row"
    && /Lv1 charge/.test(await page.$eval("#bal-move", (s) => s.options[s.selectedIndex].textContent)));
  await page.fill("#bal-value", "110");
  await page.click("#bal-save");
  await page.waitForFunction(() => /Row #3 saved/.test(document.getElementById("bal-ok").textContent), null, { timeout: 5000 });
  const put = last(api, "PUT", "/rows/3");
  check("edit: PUT body", put && put.body.value === 110 && put.body.position === 1 && put.body.field === "mv" && put.body.weaponClass === "GS", JSON.stringify(put));
  check("edit ends: add mode", (await text(page, "#bal-form-title")) === "Add a row");

  // Order and delete.
  const idsBefore = (api.rows).map((x) => x.id);
  await page.click("#bal-rows tr:nth-child(2) button:nth-child(3)"); // Up on row 2
  await page.waitForFunction(() => /Order saved/.test(document.getElementById("bal-ok").textContent), null, { timeout: 5000 });
  const order = last(api, "POST", "/rows/order").body.ids;
  check("up: the order sent", order[0] === idsBefore[1] && order[1] === idsBefore[0] && order.length === idsBefore.length, JSON.stringify(order));
  check("first row has Up disabled, last has Down disabled", (await page.$eval("#bal-rows tr:first-child button:nth-child(3)", (b) => b.disabled)) && (await page.$eval("#bal-rows tr:last-child button:nth-child(4)", (b) => b.disabled)));
  await page.click("#bal-rows tr:nth-child(1) button:nth-child(4)"); // Down on row 1
  await page.waitForFunction(() => document.querySelectorAll("#bal-rows tr").length > 0, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  check("down: sent", count(api, "POST", "/rows/order") === 2);
  const victim = api.rows[api.rows.length - 1].id;
  await page.click("#bal-rows tr:last-child button:nth-child(2)");
  check("delete: first click asks", (await page.$eval("#bal-rows tr:last-child button:nth-child(2)", (b) => b.textContent)) === "Click again to delete" && count(api, "POST", "/delete") === 0);
  await page.click("#bal-rows tr:last-child button:nth-child(2)");
  await page.waitForFunction(() => /deleted/.test(document.getElementById("bal-ok").textContent), null, { timeout: 5000 });
  check("delete: second click deletes", last(api, "POST", "/delete").path === "/api/admin/balance/rows/" + victim + "/delete" && (await page.$$("#bal-rows tr")).length === 6);

  // The diff.
  const diffText = await text(page, "#bal-diff");
  check("diff: counts and lines", /Draft against v2: \d+ added, 1 removed, \d+ changed, \d+ unchanged\./.test(diffText) && /Removed \(1\)/.test(diffText) && /Sword and Shield, Storm, Sliding Attack \(sigil\) \? \(k0 #22\): mv set 30/.test(diffText) && /Before: .*set 90.*After: .*set 110/.test(diffText), diffText);
  await shot(page, "balance-diff.png", "#bal-diff");

  check("gate open: no reason, Publish on", (await page.$eval("#bal-gate", (n) => n.hidden)) && !(await page.$eval("#bal-publish-btn", (n) => n.disabled))
    && (await page.$$eval("#bal-versions button", (bs) => bs.every((b) => !b.disabled))));
  // Publish: note first, two steps, the fingerprint.
  await page.click("#bal-publish-btn");
  check("publish: note required", /Write a note/.test(await text(page, "#bal-alert")) && (await page.$eval("#bal-confirm", (n) => n.hidden)));
  // The draft has a problem (row 6): refused before the question.
  await page.fill("#bal-pnote", "pass two");
  await page.click("#bal-publish-btn");
  await page.waitForFunction(() => /fix them first/.test(document.getElementById("bal-alert").textContent), null, { timeout: 5000 });
  check("publish: problems stop it", (await page.$eval("#bal-confirm", (n) => n.hidden)) && count(api, "POST", "/publish") === 0);
  api.problems = [];
  await page.click("#bal-publish-btn");
  await page.waitForFunction(() => !document.getElementById("bal-confirm").hidden, null, { timeout: 5000 });
  const q = await text(page, "#bal-confirm-text");
  const d = diffOf(api);
  check("publish: the question", q.indexOf("Publish v3: " + d.added.length + " added, " + d.removed.length + " removed, " + d.changed.length + " changed") === 0 && count(api, "POST", "/publish") === 0, q);
  await shot(page, "balance-publish-confirm.png");
  const fpShown = api.fingerprint;
  api.fingerprint = "changed-meanwhile";
  api.publishFail = "The draft changed since you looked: refresh and look again.";
  await page.click("#bal-confirm-yes");
  await page.waitForFunction(() => /The draft changed since you looked/.test(document.getElementById("bal-alert").textContent), null, { timeout: 5000 });
  const sent1 = last(api, "POST", "/publish").body;
  check("publish: sends note and the fingerprint shown", sent1.note === "pass two" && sent1.fingerprint === fpShown, JSON.stringify(sent1));
  check("publish: a 409 is shown and confirm closed", (await page.$eval("#bal-confirm", (n) => n.hidden)));
  api.publishFail = null;
  await page.fill("#bal-pnote", "pass two");
  await page.click("#bal-publish-btn");
  await page.waitForFunction(() => !document.getElementById("bal-confirm").hidden, null, { timeout: 5000 });
  await page.click("#bal-confirm-yes");
  await page.waitForFunction(() => /Published v3/.test(document.getElementById("bal-ok").textContent), null, { timeout: 5000 });
  check("publish: v3 in the versions list", /v3 \(latest\)/.test(await text(page, "#bal-versions")) && /pass two/.test(await text(page, "#bal-versions")) && /Nothing is published|equals the published/.test(await text(page, "#bal-diff")));

  // Roll back.
  const rbButtons = await page.$$("#bal-versions button");
  check("roll back buttons: none on the latest", rbButtons.length === 2, String(rbButtons.length));
  await page.click("#bal-versions tr:nth-child(3) button");
  check("roll back: asks", /Roll back to v1: its 2 rows are published again as v4/.test(await text(page, "#bal-rollback-text")) && !(await page.$eval("#bal-rollback", (n) => n.hidden)));
  await page.click("#bal-rollback-yes");
  check("roll back: note required", /Write a note for the roll back/.test(await text(page, "#bal-alert")) && count(api, "POST", "/rollback/") === 0);
  await page.fill("#bal-rnote", "back to start");
  api.nextVersion = 4;
  await page.click("#bal-rollback-yes");
  await page.waitForFunction(() => /Rolled back to v1: published as v4/.test(document.getElementById("bal-ok").textContent), null, { timeout: 5000 });
  const rb = last(api, "POST", "/rollback/1");
  check("roll back: POST", rb && rb.body.note === "back to start");
  check("roll back: shows in the list", /roll back to v1/.test(await text(page, "#bal-versions")));
  check("no errors on the admin page", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- the stable patch cannot receive tables yet ----
  const REASON = "Only an empty table (the game's own values) can be published until the stable patch can receive tables: "
    + "stable is v1.20, tables need v1.21-pre8 or newer.";
  const shutApi = newApi({ problems: [], publishGate: { allowed: false, stablePatch: "v1.20", minimumPatch: "v1.21-pre8", reason: REASON },
    versions: [
      { version: 3, sha256: "ee", rowCount: 0, publishedBy: "boss", publishedAt: "2026-11-10T16:00:00Z", note: "defaults", rollbackOf: null },
      { version: 2, sha256: "ab", rowCount: 4, publishedBy: "boss", publishedAt: "2026-11-10T15:00:00Z", note: "first pass", rollbackOf: null },
      { version: 1, sha256: "cd", rowCount: 0, publishedBy: "boss", publishedAt: "2026-11-09T15:00:00Z", note: "start", rollbackOf: null }] });
  r = await open(browser, base + "/admin.html#balance", shutApi, 1280);
  page = r.page;
  await page.waitForSelector("#bal-rows tr td:nth-child(2)", { timeout: 8000 });
  check("gate shut: the reason shows", !(await page.$eval("#bal-gate", (n) => n.hidden)) && (await text(page, "#bal-gate")) === REASON, await text(page, "#bal-gate"));
  check("gate shut: Publish off for a draft with rows", (await page.$eval("#bal-publish-btn", (n) => n.disabled)) && (await page.getAttribute("#bal-publish-btn", "title")) === REASON);
  const rbState = await page.$$eval("#bal-versions button", (bs) => bs.map((b) => b.disabled));
  check("gate shut: Roll back off for v2 (rows), on for v1 (empty)", JSON.stringify(rbState) === "[true,false]", JSON.stringify(rbState));
  await shot(page, "balance-gate-shut.png", "#bal-publish");
  // An empty draft (back to the game's values) may still be published.
  shutApi.rows = [];
  shutApi.fingerprint = "empty";
  await page.click("#bal-refresh");
  await page.waitForFunction(() => !document.getElementById("bal-publish-btn").disabled, null, { timeout: 5000 });
  check("gate shut: an empty draft can publish, reason still shown", (await text(page, "#bal-gate")) === REASON && (await page.$$("#bal-rows tr td:nth-child(2)")).length === 0);
  await page.fill("#bal-pnote", "defaults");
  await page.click("#bal-publish-btn");
  await page.waitForFunction(() => !document.getElementById("bal-confirm").hidden || document.getElementById("bal-alert").textContent, null, { timeout: 5000 });
  check("gate shut: the empty draft reaches the question", !(await page.$eval("#bal-confirm", (n) => n.hidden)), await text(page, "#bal-alert"));
  check("no errors with the gate shut", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- a moderator: read only ----
  r = await open(browser, base + "/admin.html#balance", newApi({ moderator: true }), 1280);
  page = r.page;
  await page.waitForSelector("#bal-rows tr td:nth-child(2)", { timeout: 8000 });
  check("moderator: no form, no publish, no row buttons", (await page.$eval("#bal-edit", (n) => n.hidden)) && (await page.$eval("#bal-publish", (n) => n.hidden))
    && (await page.$$("#bal-rows button")).length === 0 && (await page.$$("#bal-versions button")).length === 0);
  check("moderator: still sees rows, diff and versions", (await page.$$("#bal-rows tr")).length === 4 && /Draft against v2/.test(await text(page, "#bal-diff")) && /v2 \(latest\)/.test(await text(page, "#bal-versions")));
  await shot(page, "balance-moderator.png");
  check("no errors for a moderator", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- 375 px ----
  r = await open(browser, base + "/admin.html#balance", newApi(), 375);
  page = r.page;
  await page.waitForSelector("#bal-rows tr td:nth-child(2)", { timeout: 8000 });
  check("375 px: nothing of the tab runs past the screen", (await panelOverflow(page)).length === 0, JSON.stringify(await panelOverflow(page)));
  await page.selectOption("#bal-type", "GS");
  await page.waitForSelector("#bal-move option:nth-child(5)", { state: "attached", timeout: 5000 });
  check("375 px: the same with a move list", (await panelOverflow(page)).length === 0, JSON.stringify(await panelOverflow(page)));
  await shot(page, "balance-375.png");
  check("no errors at 375", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- the table is not there ----
  r = await open(browser, base + "/admin.html#balance", newApi({ tableReady: false }), 1280);
  page = r.page;
  await page.waitForFunction(() => !document.getElementById("bal-notable").hidden, null, { timeout: 8000 });
  check("missing table: the message and no forms", /The balance tables are not there yet: the API's db\/balance\.sql must run first\./.test(await text(page, "#bal-notable"))
    && (await page.$eval("#bal-main", (n) => n.hidden)) && !(await page.isVisible("#bal-form")));
  check("no errors without a table", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- the weapon data is missing: numbers by hand ----
  serveData = false;
  const api3 = newApi();
  r = await open(browser, base + "/admin.html#balance", api3, 1280);
  page = r.page;
  await page.waitForSelector("#bal-rows tr td:nth-child(2)", { timeout: 8000 });
  check("no data: the note shows", !(await page.$eval("#bal-nodata", (n) => n.hidden)) && /weapon names are missing/.test(await text(page, "#bal-nodata")));
  const cells3 = await page.$$eval("#bal-rows tr", (trs) => trs.map((t) => Array.from(t.children).map((c) => c.textContent)));
  check("no data: rows by number", cells3[0][1] === "GS, Storm, k0 #165" && cells3[0][3] === "unknown" && cells3[2][1] === "weapon #1", JSON.stringify(cells3.slice(0, 3)));
  check("no data: types from the API's classes", (await page.$$eval("#bal-type option", (o) => o.map((x) => x.value))).join() === "," + CLASSES.join() && (await page.$eval("#bal-move-field", (n) => n.hidden)));
  await page.selectOption("#bal-type", "LS");
  await page.selectOption("#bal-style", "earth");
  await page.fill("#bal-entry", "0");
  await page.fill("#bal-id", "12");
  await page.selectOption("#bal-field", "mv");
  await page.selectOption("#bal-op", "scale");
  await page.fill("#bal-value", "1.1");
  check("no data: current value unknown", /unknown/.test(await text(page, "#bal-current")), await text(page, "#bal-current"));
  await page.fill("#bal-reason", "by hand");
  await page.click("#bal-save");
  await page.waitForFunction(() => document.querySelectorAll("#bal-rows tr").length === 5, null, { timeout: 5000 });
  check("no data: body by number", JSON.stringify(last(api3, "POST", "/rows").body) === JSON.stringify({ kind: "attack", weaponClass: "LS", style: "earth", entry: 0, recordId: 12, field: "mv", op: "scale", value: 1.1, reason: "by hand" }), JSON.stringify(last(api3, "POST", "/rows").body));
  await page.selectOption("#bal-kind", "melee");
  check("no data: weapon search hidden, id by hand", (await page.$eval("#bal-wsearch-field", (n) => n.hidden)) && !(await page.isVisible("#bal-wsearch")));
  await page.fill("#bal-wid", "5");
  await page.selectOption("#bal-field", "attack");
  await page.fill("#bal-value", "70");
  await page.fill("#bal-reason", "by hand");
  await page.click("#bal-save");
  await page.waitForFunction(() => document.querySelectorAll("#bal-rows tr").length === 6, null, { timeout: 5000 });
  check("no data: weapon body", last(api3, "POST", "/rows").body.recordId === 5 && last(api3, "POST", "/rows").body.kind === "melee");
  await shot(page, "balance-no-data.png");
  check("no errors without the data", r.errors.length === 0, r.errors.join("; "));
  await page.close();
  serveData = true;
}

(async () => {
  helpers();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await balancePage(browser, base);
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
  console.log("admin balance OK");
})();
