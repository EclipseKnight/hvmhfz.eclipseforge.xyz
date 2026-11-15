#!/usr/bin/env node
/* Checks the admin "Community sets" tab (js/admin-sets.js, tab-sets / panel-sets on admin.html) in headless Chromium
   against a fake API that follows the contract in docs/armor-set-builder.md "Community sets":

   - the badge on the tab is the API's open report count; the queue lists Reported (default), Hidden and All;
   - one set: its reports, its log, the account and the character that posted it; markup in titles, notes, names and
     reasons stays text;
   - Hide needs a reason (nothing is sent without one) and sends {"reason"}; Unhide and Dismiss send {}; each shows the
     answer and refreshes the queue and the badge; an API refusal is shown as it is;
   - staff with only "view" see every list and detail but no reason box and no action button; staff without the
     "sets" tool do not see the tab; no sideways scroll at 390 px; no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-sets.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Calc = require("../js/armor-calc.js");

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

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "HS256" }) + "." + b64({ sub: "boss", exp }) + ".sig";
}
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };

/* ---- fixtures (made-up names) ---- */

const SET = Calc.empty();
SET.weapon = [7, 0, [], []];
const BAD = "Bad <b>set</b>";

function adminItem(id, over) {
  return Object.assign({ id, title: "Set " + id, notes: "", set: SET, data: "v1.29", weaponClass: 7, weaponId: 0, band: "hr4", stage: "zenith",
    skills: [1], votes: 2, author: null, createdAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z", voted: false, mine: false,
    hidden: false, hiddenAt: null, hiddenBy: null, hiddenReason: null, openReports: 0, account: "alder", characterName: "Wren", showAuthor: false, charId: null }, over || {});
}

function newApi(tools, extra) {
  return Object.assign({
    calls: [], tools, admin: false, nextLog: 100,
    sets: [adminItem(21, { title: BAD, notes: "Notes <i>here</i>", openReports: 2, account: "alder<u>", characterName: "Wren <i>X</i>" }),
           adminItem(22, { title: "Already hidden", hidden: true, hiddenAt: "2026-11-14T09:00:00Z", hiddenBy: "boss", hiddenReason: "Not a set <b>really</b>" }),
           adminItem(23, { title: "One report", openReports: 1, account: "birch", characterName: "Fern" })],
    reports: { 21: [{ id: 1, at: "2026-11-15T11:00:00Z", account: "pia", reason: "spam <u>x</u>", resolvedAt: null, resolvedBy: null, resolution: null },
                    { id: 2, at: "2026-11-14T11:00:00Z", account: "quill", reason: "old one", resolvedAt: "2026-11-14T12:00:00Z", resolvedBy: "boss", resolution: "dismissed" }],
               22: [], 23: [{ id: 3, at: "2026-11-15T12:00:00Z", account: "rue", reason: "copy of another", resolvedAt: null, resolvedBy: null, resolution: null }] },
    log: { 21: [{ at: "2026-11-15T10:00:00Z", account: "alder<u>", action: "posted", detail: "" }], 22: [{ at: "2026-11-14T09:00:00Z", account: "boss", action: "hid", detail: "Not a set" }], 23: [] },
    hideRefuse: null
  }, extra || {});
}

const totalOpen = (api) => api.sets.reduce((n, s) => n + s.openReports, 0);
function detail(api, s) { return Object.assign({}, s, { reports: api.reports[s.id], log: api.log[s.id] }); }

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
    if (p === "/api/admin/permissions/mine") return reply(200, { roles: [api.admin ? "ROLE_ADMIN" : "ROLE_MODERATOR"], admin: api.admin, staff: true, tools: api.tools });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, itemTypes: {}, itemTypesWithId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (!p.startsWith("/api/admin/armor-sets")) return reply(404, { message: "Not Found" });
    let m;
    if (p === "/api/admin/armor-sets") {
      const st = url.searchParams.get("status") || "reported";
      const list = api.sets.filter((s) => st === "all" || (st === "hidden" ? s.hidden : s.openReports > 0 && !s.hidden));
      return reply(200, { total: list.length, openReports: totalOpen(api), items: list });
    }
    if ((m = p.match(/^\/api\/admin\/armor-sets\/(\d+)(?:\/(hide|unhide|dismiss))?$/))) {
      const s = api.sets.find((x) => x.id === Number(m[1]));
      if (!s) return reply(404, { message: "No such set." });
      if (!m[2]) return reply(200, detail(api, s));
      if (req.method() !== "POST") return reply(405, { message: "Method not allowed." });
      if (!api.tools.sets || api.tools.sets.indexOf("act") === -1) return reply(403, { message: "Not allowed." });
      if (m[2] === "hide") {
        if (api.hideRefuse) return reply(409, { message: api.hideRefuse });
        if (!sent || !sent.reason) return reply(400, { message: "A reason is required." });
        Object.assign(s, { hidden: true, hiddenBy: "boss", hiddenAt: "2026-11-15T13:00:00Z", hiddenReason: sent.reason, openReports: 0 });
        api.log[s.id].push({ at: "2026-11-15T13:00:00Z", account: "boss", action: "hid", detail: sent.reason });
      } else if (m[2] === "unhide") {
        Object.assign(s, { hidden: false, hiddenBy: null, hiddenAt: null, hiddenReason: null });
        api.log[s.id].push({ at: "2026-11-15T13:05:00Z", account: "boss", action: "unhid", detail: "" });
      } else {
        s.openReports = 0;
        api.reports[s.id].forEach((r) => { if (!r.resolvedAt) Object.assign(r, { resolvedAt: "2026-11-15T13:10:00Z", resolvedBy: "boss", resolution: "dismissed" }); });
        api.log[s.id].push({ at: "2026-11-15T13:10:00Z", account: "boss", action: "dismissed", detail: "" });
      }
      return reply(200, detail(api, s));
    }
    return reply(404, { message: "Not Found" });
  });
}

async function open(browser, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1366, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => { localStorage.setItem("hvmhfz.token", t); localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); }, TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  fakeApi(page, api);
  await page.goto(base + "/admin.html#sets");
  return { page, errors };
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const lastPost = (api, part) => api.calls.filter((c) => c.method === "POST" && c.path.indexOf(part) !== -1).pop();
const ids = (page) => page.$$eval("#as-list .as-card", (n) => n.map((c) => c.getAttribute("data-id")).join(","));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
let base = "";

async function waitIds(page, want) {
  await page.waitForFunction((w) => Array.from(document.querySelectorAll("#as-list .as-card")).map((c) => c.getAttribute("data-id")).join(",") === w, want, { timeout: 5000 }).catch(() => {});
}

async function run() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  let r, page, api;

  // ---- a moderator who may view and act ----
  api = newApi({ sets: ["view", "act"] });
  r = await open(browser, api, 1366);
  page = r.page;
  await page.waitForSelector("#count-sets:not([hidden])");
  check("badge: the open report count", (await text(page, "#count-sets")) === "3", await text(page, "#count-sets"));
  check("the tab is shown and opens on #sets", (await page.$eval("#tab-sets", (t) => !t.hidden && t.getAttribute("aria-selected") === "true")));
  await waitIds(page, "21,23");
  check("queue: Reported by default", (await ids(page)) === "21,23", await ids(page));
  check("queue: asked for status=reported", api.calls.some((c) => c.path.indexOf("/api/admin/armor-sets?status=reported&page=0&size=50") === 0));
  const c21 = await text(page, '.as-card[data-id="21"]');
  check("card: title, account, character, open reports as text", c21.indexOf(BAD) !== -1 && c21.indexOf("alder<u>") !== -1 && c21.indexOf("Wren <i>X</i>") !== -1 && c21.indexOf("2 open reports") !== -1, c21);
  check("card: markup stays text", (await page.$$("#as-list b, #as-list i, #as-list u")).length === 0);
  await page.click('#as-status [data-status="hidden"]');
  await waitIds(page, "22");
  check("Hidden filter", (await ids(page)) === "22" && (await text(page, '.as-card[data-id="22"]')).indexOf("Hidden") !== -1);
  await page.click('#as-status [data-status="all"]');
  await waitIds(page, "21,22,23");
  check("All filter lists the three", (await ids(page)) === "21,22,23" && api.calls.some((c) => c.path.indexOf("status=all") !== -1));
  await page.click('#as-status [data-status="reported"]');
  await waitIds(page, "21,23");

  // detail
  await page.click('.as-card[data-id="21"]');
  await page.waitForSelector("#as-detail .as-title");
  check("detail: title, notes and names as text", (await text(page, ".as-title")) === BAD && (await text(page, "#as-detail .cs-notes")) === "Notes <i>here</i>"
    && (await text(page, "#as-detail")).indexOf("alder<u> (Wren <i>X</i>)") !== -1 && (await page.$$("#as-detail i, #as-detail u, #as-detail .as-title b, #as-detail .cs-notes *")).length === 0);
  const reports = await page.$$eval("#as-detail .as-list:nth-of-type(1) li, #as-detail ul.as-list li", (n) => n.map((x) => x.textContent));
  check("detail: both reports with reasons as text, one open one closed", reports.some((t) => t.indexOf("pia") === 0 && t.indexOf("spam <u>x</u>") !== -1 && /open$/.test(t))
    && reports.some((t) => t.indexOf("quill") === 0 && t.indexOf("closed") !== -1 && t.indexOf("by boss (dismissed)") !== -1), reports.join(" | "));
  check("detail: the log", reports.some((t) => t.indexOf("alder<u>") !== -1 && t.indexOf("posted") !== -1));
  check("detail: builder link holds the set", (await page.getAttribute("#as-detail a", "href")) === "/set-builder.html#s=" + Calc.encode(SET));
  check("detail: Hide, Dismiss, reason box shown; Unhide not", (await page.$$(".as-hide, .as-dismiss, #as-reason")).length === 3 && (await page.$$(".as-unhide")).length === 0);
  check("reason box limit is 300", (await page.getAttribute("#as-reason", "maxlength")) === "300");

  await page.click(".as-hide");
  check("Hide without a reason: refused, nothing sent", (await text(page, "#as-alert")).indexOf("Give a reason") !== -1 && !lastPost(api, "/hide"));
  api.hideRefuse = "Set 21 is already hidden.";
  await page.fill("#as-reason", "Not a set");
  await page.click(".as-hide");
  await page.waitForFunction(() => /already hidden/.test(document.getElementById("as-alert").textContent));
  check("Hide: the API's refusal as it is", (await text(page, "#as-alert")) === "Set 21 is already hidden." && lastPost(api, "/hide").body.reason === "Not a set");
  api.hideRefuse = null;
  await page.click(".as-hide");
  await page.waitForSelector(".as-unhide");
  check("Hide: POST {reason}, detail now hidden with who and why", JSON.stringify(lastPost(api, "/21/hide").body) === '{"reason":"Not a set"}'
    && (await text(page, "#as-detail .form-alert")).indexOf("Hidden by boss") !== -1 && (await text(page, "#as-detail .form-alert")).indexOf("Not a set") !== -1);
  check("Hide: ok message, Hide button gone, log has the entry", (await text(page, "#as-ok")).indexOf("Hidden") === 0 && (await page.$$(".as-hide")).length === 0
    && (await text(page, "#as-detail")).indexOf("hid: Not a set") !== -1);
  await page.waitForFunction(() => document.getElementById("count-sets").textContent === "1");
  check("badge dropped to 1 after the hide", (await text(page, "#count-sets")) === "1");
  await page.click(".as-unhide");
  await page.waitForSelector(".as-hide");
  check("Unhide: POST {}, hide box is back", JSON.stringify(lastPost(api, "/21/unhide").body) === "{}" && (await page.$$(".as-unhide")).length === 0);
  await page.click("#as-detail-close");
  await waitIds(page, "23");
  check("back to the queue: 21 left it (its reports closed), 23 stays", (await ids(page)) === "23", await ids(page));
  await page.click('.as-card[data-id="23"]');
  await page.waitForSelector(".as-dismiss");
  await page.click(".as-dismiss");
  await page.waitForFunction(() => document.querySelectorAll(".as-dismiss").length === 0);
  check("Dismiss: POST {}, set stays shown", JSON.stringify(lastPost(api, "/23/dismiss").body) === "{}" && (await page.$$(".as-hide")).length === 1 && (await text(page, "#as-ok")).indexOf("dismissed") !== -1);
  await page.waitForFunction(() => document.getElementById("count-sets").hidden);
  check("badge is gone with no open reports", await page.$eval("#count-sets", (b) => b.hidden));
  await page.click("#as-detail-close");
  await waitIds(page, "");
  check("empty Reported queue says so", (await text(page, "#as-list")).indexOf("No sets with open reports") !== -1);
  await page.setViewportSize({ width: 390, height: 800 });
  check("no sideways scroll at 390 px", (await overflow(page)) <= 0, String(await overflow(page)));
  check("no page errors (staff who may act)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- view only ----
  api = newApi({ sets: ["view"] });
  r = await open(browser, api, 1366);
  page = r.page;
  await waitIds(page, "21,23");
  await page.click('.as-card[data-id="21"]');
  await page.waitForSelector("#as-detail .as-title");
  check("view only: reports and log shown", (await page.$$("#as-detail ul.as-list li")).length >= 3);
  check("view only: no action button, no reason box", (await page.$$(".as-hide, .as-unhide, .as-dismiss, #as-reason")).length === 0);
  await page.click("#as-detail-close");
  await page.click('#as-status [data-status="hidden"]');
  await waitIds(page, "22");
  await page.click('.as-card[data-id="22"]');
  await page.waitForSelector("#as-detail .as-title");
  check("view only: a hidden set has no Unhide", (await page.$$(".as-unhide")).length === 0 && (await text(page, "#as-detail .form-alert")).indexOf("Hidden by boss") !== -1);
  check("no page errors (view only)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- no sets permission: no tab ----
  api = newApi({ flags: ["view"] });
  r = await open(browser, api, 1366);
  page = r.page;
  await page.waitForSelector("#tab-flags:not([hidden])");
  check("without the sets tool the tab is hidden and no list is asked for", (await page.$eval("#tab-sets", (t) => t.hidden)) && !api.calls.some((c) => c.path.indexOf("/api/admin/armor-sets") === 0));
  await page.close();

  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAIL (" + failures.length + ")");
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("admin sets OK");
}

run().catch((e) => { console.log("FAIL " + e.stack); process.exit(1); });
