#!/usr/bin/env node
/* Checks the admin panel's Flags tab (js/admin-flags.js) in headless Chromium against a fake API (the contract of
   /api/admin/flags, see the API's README):

   - the badge on the tab button (open count, critical count) from /api/admin/flags/summary when the page opens;
   - the queue: severity, name and ids, account, rule, numbers, why, dates, source, status, reviewer, note, the
     "online" marker; the status and rule filters (query sent); markup in names and notes stays text;
   - a flag's detail: history, other flags of the account;
   - Approve and Cheat with the confirm dialog (old -> new, the value prefilled with the suggested value and
     editable, a rule without a currency only marks), the bodies sent, a refusal (409 online) shown as it is;
   - Undo on an undoable entry, a 409 with canForce offering "Undo anyway";
   - bulk: select all, Approve selected, Cheat selected (one value, or empty = suggested values), the count in the
     confirm, the per-id results;
   - the rules table: a PUT with only the changed fields; Scan now; the last scan line;
   - a moderator: read only (no checkboxes, no action buttons, no Scan now, no rule inputs);
   - tableReady false and a 503: "The flags tables are not installed yet"; the pure helpers under node;
   - no horizontal overflow at 390 px; no page errors.

   Screenshots go to $SHOTS when set, else /srv/devbot/.bot-logs/account-flags/ when that folder exists, else dev-shots/.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-flags.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const FL = require("../js/admin-flags.js");

const root = path.join(__dirname, "..");
const LOGS = "/srv/devbot/.bot-logs/account-flags";
const shots = process.env.SHOTS || (fs.existsSync(LOGS) ? LOGS : path.join(root, "dev-shots"));
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

/* ---- fixtures (made-up names) ---- */

// The 12 rules as the API ships them (FlagRules.DEFAULTS); calibration is the live check text.
const R = (key, label, subject, kind, threshold, cap, direction, severity, ceiling, currency, blocksImport, description, calibration) =>
  ({ key, label, subject, kind, threshold, cap, direction, severity, ceiling, currency, blocksImport, enabled: true, description, calibration });
const RULES = [
  R("gcp", "GCP far over what play earns", "character", "currency", 200000, 9999999, "above", "high", 102000, "gcp", false,
    "Guild contribution points (characters.gcp). Play pays about 20,000 an hour of Diva Defense and at most about 102,000 per 3-week event; the game's counter stops at 9,999,999.",
    "live 2026-11-11: median 20, 99th percentile 103,289; 55 over 200,000 (1 over 9,999,999)"),
  R("netcafe_points", "Cafe points far over normal", "character", "currency", 100000, 500000, "above", "medium", 30000, "netcafe_points", false,
    "Net cafe points (characters.netcafe_points). Erupe caps what it adds at MaximumNP (500,000 on live).", "live: 99th percentile 27,430, most 105,110; 2 over 100,000"),
  R("frontier_points", "Frontier points far over income", "account", "currency", 50000, 1200000, "above", "high", 25000, "frontier_points", false,
    "Frontier points (users.frontier_points). Income: shop trade-ins (1-3 a item), gacha steps, gifts; Erupe's MaximumFP is 1,200,000 on live.",
    "live: 99th percentile 24,510 of 162 accounts with points, most 118,899; 1 over 50,000"),
  R("gacha_premium", "Premium gacha coins far over prizes", "account", "currency", 2000, null, "above", "medium", 500, "gacha_premium", false,
    "Premium coins (users.gacha_premium). Earned from Road prizes (10-50 every 14 days for the top 10) and event gifts.", "live: no account holds premium coins in users.gacha_premium yet; 0 flagged"),
  R("road_points_per_floor", "Road points per floor too high", "character", "road", 20000, null, "above", "high", null, null, false,
    "Best Hunting Road points divided by the best floor (rengoku_score, multiplayer or solo, the higher). A real run earns a few thousand points a floor.",
    "live: 99th percentile 5,919 (multi) and 3,387 (solo) a floor; 2 over 20,000"),
  R("zenny_over_cap", "Zenny over the game's cap", "character", "save", 9999999, 9999999, "above", "critical", null, null, true,
    "Zenny in the save. The game clamps every change to 0-9,999,999 (hvmhfz_re docs/save-data.md), so more is an edited save.", "live: 0 of 3,576 played saves (most 9,999,999)"),
  R("hunt_count_over_cap", "Hunt count over the game's cap", "character", "save", 9999, 9999, "above", "critical", null, null, true,
    "The most slain or captured of one monster in the save's Monster List. The game stops each count at 9,999 (hvmhfz_re docs/save-hunt-counts.md).", "live: 0 (most 7,964)"),
  R("gr_below_hr999", "G Rank points below HR 999", "character", "save", 0, null, "above", "critical", null, null, false,
    "G Rank points in a save whose HR is under 999: G Rank opens only at HR 999.", "live: 0"),
  R("item_stack_over_999", "Item stack over 999", "character", "save", 999, null, "above", "high", null, null, false,
    "The biggest stack in the item box or pouch. No live save holds more than 999 of an item but one (the box's limit, measured; the client's own check is not read yet).", "live: 1 of 3,576 saves"),
  R("unknown_item", "Item the game doesn't have", "character", "save", 0, null, "above", "high", null, null, false,
    "Stacks in the item box or pouch with an item id over 16700 (0x413c), the last item in the game's item table.", "live: 0"),
  R("fast_progress", "HR 999 in very little playtime", "character", "save", 36000, null, "below", "medium", null, null, false,
    "Seconds played (the save's own counter) of a character at HR 999 or more; under the threshold (10 hours) is very fast. A save from a server whose counter was reset trips it too.",
    "live: 8 of 926 HR 999 saves under 10 hours (1st percentile 10 hours, median 98)"),
  R("few_hunts", "HR 999 with almost no hunts", "character", "save", 10, null, "below", "medium", null, null, false,
    "Monsters slain plus captured in the save's Monster List at HR 999 or more.", "live: 0 (fewest 83)")];
const rule = (key) => RULES.find((r) => r.key === key);

// A flag as the API builds it: why = detail + " " + the rule's description.
const flag = (id, o) => {
  const r = rule((o && o.rule) || "gcp");
  const base = { id, characterId: 1000 + id, characterName: "Aldric Vane", userId: 50 + id, username: "aldric" + id,
    rule: r.key, ruleLabel: r.label, severity: r.severity, value: 450000, threshold: r.threshold, cap: r.cap, direction: r.direction,
    detail: "450,000 GCP is over 200,000.", currency: r.currency, currentValue: 450000, suggestedValue: r.currency ? r.ceiling : null,
    source: "daily", importId: null, firstSeen: "2026-11-09T03:00:00Z", lastSeen: "2026-11-11T03:00:00Z", status: "open",
    reviewer: null, reviewedAt: null, note: null, approvedValue: null, online: false };
  const f = Object.assign(base, o || {});
  f.why = f.detail + " " + r.description;
  delete f.detail;
  return f;
};

function newApi(extra) {
  const api = Object.assign({
    calls: [], tableReady: true, moderator: false, nextAction: 100, cheatRefuse: null, undoFail: null, bulkFail: [],
    flags: [
      flag(1, { characterName: "Mira Oakheart", severity: "critical", value: 999999999, currentValue: 999999999, suggestedValue: 102000, online: true,
        detail: "999,999,999 GCP is over the cap of 9,999,999." }),
      flag(2, { characterName: "Tobias Reed" }),
      flag(3, { rule: "zenny_over_cap", characterName: "<b>Wren</b> Ashdown", severity: "critical", value: 12500000, currentValue: null, source: "import-blocked", importId: 7,
        detail: "Zenny 12,500,000 is over the game's cap of 9,999,999." }),
      flag(4, { rule: "frontier_points", characterId: null, characterName: null, value: 118899, currentValue: 118899, suggestedValue: 25000,
        detail: "118,899 frontier points is over 50,000." }),
      flag(5, { rule: "fast_progress", characterName: "Sable Quinn", status: "approved", value: 28800, currentValue: null, reviewer: "boss", reviewedAt: "2026-11-10T12:00:00Z",
        note: "Saved up on purpose <i>ok</i>", approvedValue: 28800, detail: "HR 999 after 8.0 hours of play (threshold 10.0 hours)." }),
      flag(6, { characterName: "Edda Marsh", status: "cheat", reviewer: "boss", reviewedAt: "2026-11-10T13:00:00Z", note: "clear", currentValue: 102000 }),
      flag(7, { rule: "item_stack_over_999", characterName: "Corin Hale", value: 3200, currentValue: null,
        detail: "A stack of 3,200 of one item; normal saves hold at most 999." })],
    lastScan: { at: "2026-11-11T03:00:00Z", kind: "daily", characters: 1840, flagged: 7, newFlags: 2 },
    rules: RULES.map((r) => Object.assign({}, r)),
    history: {
      2: [{ id: 21, at: "2026-11-09T03:00:00Z", action: "flagged", actor: "scan", oldValue: null, newValue: null, note: null, undoneAt: null, undoneBy: null, undoable: false }],
      6: [{ id: 30, at: "2026-11-10T13:00:00Z", action: "cheat", actor: "boss", oldValue: 450000, newValue: 102000, note: "clear", undoneAt: null, undoneBy: null, undoable: true },
        { id: 29, at: "2026-11-09T03:00:00Z", action: "flagged", actor: "scan", oldValue: null, newValue: null, note: null, undoneAt: null, undoneBy: null, undoable: false }]
    }
  }, extra || {});
  return api;
}

const countsOf = (api) => ({ open: api.flags.filter((f) => f.status === "open").length,
  critical: api.flags.filter((f) => f.status === "open" && f.severity === "critical").length,
  approved: api.flags.filter((f) => f.status === "approved").length, cheat: api.flags.filter((f) => f.status === "cheat").length });

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
    if (p === "/api/admin/distributions/options") return reply(200, { lists: { 1: "Hunter" }, itemTypes: { 7: "Item" }, itemTypesWithId: [7], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (!p.startsWith("/api/admin/flags")) return reply(404, { message: "Not Found" });
    if (api.table503) return reply(503, { message: "flags tables missing" });
    if (req.method() !== "GET" && api.moderator) return reply(403, { message: "Only admins can change flags." });
    let m;
    if (p === "/api/admin/flags/summary") { const c = countsOf(api); return reply(200, { tableReady: api.tableReady, open: c.open, critical: c.critical }); }
    if (p === "/api/admin/flags/rules" && req.method() === "GET") return reply(200, { rules: api.rules });
    if ((m = p.match(/^\/api\/admin\/flags\/rules\/([a-z0-9_-]+)$/)) && req.method() === "PUT") {
      const i = api.rules.findIndex((r) => r.key === m[1]);
      // The API keeps the current ceiling when none (or null) is sent, and refuses one for a rule without a currency.
      if (sent.ceiling !== undefined && sent.ceiling !== null && !api.rules[i].currency) return reply(400, { message: "This rule has no currency, so no ceiling." });
      const change = Object.assign({}, sent);
      if (change.ceiling === null) delete change.ceiling;
      api.rules[i] = Object.assign({}, api.rules[i], change);
      return reply(200, api.rules[i]);
    }
    if (p === "/api/admin/flags/scan") return reply(200, { at: "2026-11-11T09:00:00Z", kind: "manual", characters: 1845, flagged: 7, newFlags: 1 });
    if (p === "/api/admin/flags/bulk") {
      const results = sent.ids.map((id) => api.bulkFail.indexOf(id) !== -1 ? { id, ok: false, message: "Character is online." } : { id, ok: true, message: "" });
      results.forEach((r) => { if (r.ok) { const f = api.flags.find((x) => x.id === r.id); f.status = sent.action === "cheat" ? "cheat" : "approved"; } });
      return reply(200, { done: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
    }
    if ((m = p.match(/^\/api\/admin\/flags\/(\d+)\/(approve|cheat)$/)) && req.method() === "POST") {
      const f = api.flags.find((x) => x.id === Number(m[1]));
      if (!f) return reply(404, { message: "No flag " + m[1] + "." });
      // Approve only works on an open flag; Cheat on an open or an approved one.
      if (m[2] === "approve" && f.status !== "open") return reply(409, { message: "Flag " + f.id + " is already " + f.status + (f.status === "cheat" ? ": undo the Cheat action first." : ".") });
      if (m[2] === "cheat" && f.status === "cheat") return reply(409, { message: "Flag " + f.id + " is already marked cheat." });
      if (m[2] === "cheat" && api.cheatRefuse) return reply(409, { message: api.cheatRefuse });
      const oldV = f.currentValue;
      f.status = m[2] === "cheat" ? "cheat" : "approved"; f.reviewer = "boss"; f.note = sent.note;
      if (m[2] === "cheat" && f.currency) f.currentValue = sent.value !== undefined ? sent.value : f.suggestedValue;
      return reply(200, { flag: f, action: { id: api.nextAction++, action: m[2], oldValue: oldV, newValue: f.currentValue } });
    }
    if ((m = p.match(/^\/api\/admin\/flags\/actions\/(\d+)\/undo$/))) {
      if (api.undoFail && !(sent && sent.force)) return reply(409, { message: api.undoFail, canForce: true });
      const f = api.flags.find((x) => x.id === 6);
      f.status = "open";
      return reply(200, { flag: f, action: { id: api.nextAction++, action: "undo" } });
    }
    if ((m = p.match(/^\/api\/admin\/flags\/(\d+)$/))) {
      const f = api.flags.find((x) => x.id === Number(m[1]));
      if (!f) return reply(404, { message: "No such flag." });
      return reply(200, { flag: f, history: api.history[f.id] || [], others: api.flags.filter((x) => x.userId === f.userId && x.id !== f.id).concat(f.id === 2 ? [flag(9, { characterName: "Tobias Reed", userId: f.userId, rule: "frontier_points", currentValue: 118899, value: 118899 })] : []) });
    }
    if (p === "/api/admin/flags") {
      const st = url.searchParams.get("status") || "open", rule = url.searchParams.get("rule");
      let list = api.flags.filter((f) => (st === "all" || f.status === st) && (!rule || f.rule === rule));
      const rank = { critical: 0, high: 1, medium: 2 };
      list = list.slice().sort((a, b) => rank[a.severity] - rank[b.severity] || a.id - b.id);
      return reply(200, { tableReady: api.tableReady, canWrite: !api.moderator, counts: countsOf(api), lastScan: api.lastScan, flags: list });
    }
    return reply(404, { message: "Not Found" });
  });
}

async function open(browser, url, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1366, height: 900 } });
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
  // The sticky header would float in the middle of a full-page capture.
  await page.addStyleTag({ content: ".site-nav{position:static !important}" });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const last = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).pop();
const count = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).length;
const visible = (page, sel) => page.$eval(sel, (n) => !n.hidden && n.getBoundingClientRect().width > 0).catch(() => false);
const cardOf = (id) => '#fl-list .fl-card[data-id="' + id + '"]';
const panelOverflow = (page) => page.evaluate(() => Array.from(document.querySelectorAll("#panel-flags *")).filter((n) => !n.closest(".table-wrap")
  && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5)
  .map((n) => n.tagName + "#" + n.id + "." + n.className + " " + Math.round(n.getBoundingClientRect().right)));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ---- the pure helpers ---- */

function helpers() {
  check("num", FL.num(1200000) === "1,200,000" && FL.num(null) === "unknown" && FL.num(0) === "0");
  check("parseValue", FL.parseValue("").value === null && FL.parseValue(" 5,000 ").value === 5000 && FL.parseValue("12a").error && FL.parseValue("-4").error && FL.parseValue("0").value === 0);
  check("numbersText", FL.numbersText(flag(2)) === "value 450,000, threshold above 200,000, cap 9,999,999, now 450,000"
    && FL.numbersText(flag(3, { rule: "fast_progress", currentValue: null })).indexOf("threshold below 36,000") !== -1
    && FL.numbersText(flag(3, { rule: "item_stack_over_999", currentValue: null })).indexOf("cap") === -1);
  check("changeLine", FL.changeLine(flag(2), "cheat", null) === "Aldric Vane (GCP far over what play earns): GCP 450,000 -> 102,000"
    && FL.changeLine(flag(2), "cheat", 100) === "Aldric Vane (GCP far over what play earns): GCP 450,000 -> 100"
    && /no suggested value/.test(FL.changeLine(flag(3, { suggestedValue: null }), "cheat", null))
    && /only marked/.test(FL.changeLine(flag(4, { rule: "zenny_over_cap" }), "cheat", null))
    && /stays at 450,000/.test(FL.changeLine(flag(2), "approve", null)));
  check("bulkBody", JSON.stringify(FL.bulkBody([1, 2], "cheat", null, "n")) === '{"ids":[1,2],"action":"cheat","note":"n"}'
    && FL.bulkBody([1], "cheat", 50, "").value === 50 && FL.bulkBody([1], "approve", 50, "x").value === undefined);
  check("badgeOf", FL.badgeOf({ open: 0, critical: 0 }) === null && FL.badgeOf({ open: 3, critical: 1 }).critical === "1" && FL.badgeOf({ open: 1, critical: 0 }).title === "1 open flag");
  check("lastScanText", /^Last scan: 2026-11-11 03:00 UTC \(daily\), 1,840 characters checked, 7 flagged, 2 new\.$/.test(FL.lastScanText(newApi().lastScan)) && FL.lastScanText(null) === "No scan yet.");
}

/* ---- the page ---- */

async function run() {
  helpers();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  let r, page, api, t;

  // ---- admin: the badge, the queue ----
  api = newApi();
  r = await open(browser, base + "/admin.html", api);
  page = r.page;
  await page.waitForSelector("#count-flags:not([hidden])");
  check("badge: open count", (await text(page, "#count-flags")) === "5", await text(page, "#count-flags"));
  check("badge: critical count", (await visible(page, "#count-flags-critical")) && (await text(page, "#count-flags-critical")) === "2");
  check("badge: summary asked once, before the tab opens", count(api, "GET", "/api/admin/flags/summary") === 1 && count(api, "GET", "/api/admin/flags?") === 0);
  await page.click("#tab-flags");
  await page.waitForSelector("#fl-list .fl-card");
  check("queue: 5 open cards, critical first", (await page.$$eval("#fl-list .fl-card", (n) => n.map((c) => c.getAttribute("data-id")).join(","))) === "1,3,2,4,7");
  check("default query is open, limit 200", /status=open/.test(last(api, "GET", "/api/admin/flags?").path) && /limit=200/.test(last(api, "GET", "/api/admin/flags?").path));
  t = await text(page, cardOf(1));
  check("card 1: name, ids, account, rule, numbers, why, source", /Critical/.test(t) && /Mira Oakheart/.test(t) && /char #1001/.test(t) && /account aldric1 #51/.test(t)
    && /GCP far over what play earns/.test(t) && /value 999,999,999, threshold above 200,000, cap 9,999,999, now 999,999,999/.test(t)
    && /999,999,999 GCP is over the cap of 9,999,999\. Guild contribution points/.test(t) && /source: daily scan/.test(t) && /first seen 9 Nov 2026, 03:00 UTC/.test(t) && /last seen 11 Nov 2026, 03:00 UTC/.test(t) && /Open/.test(t), t);
  check("card 1: online marker, card 2: none", (await page.$$(cardOf(1) + " .fl-online")).length === 1 && (await page.$$(cardOf(2) + " .fl-online")).length === 0);
  check("card 3: markup in a name stays text", (await text(page, cardOf(3))).indexOf("<b>Wren</b> Ashdown") !== -1 && (await page.$$(cardOf(3) + " b")).length === 0);
  t = await text(page, cardOf(3));
  check("card 3: import-blocked zenny, no currency, no 'now'", /Zenny over the game's cap/.test(t) && /source: import \(blocked\) #7/.test(t) && !/now /.test(t) && /Zenny 12,500,000 is over the game's cap/.test(t), t);
  check("card 4: an account rule", /\(account rule\)/.test(await text(page, cardOf(4))) && !/char #/.test(await text(page, cardOf(4))) && /Frontier points far over income/.test(await text(page, cardOf(4))));
  check("card 7: an item stack rule", /Item stack over 999/.test(await text(page, cardOf(7))) && /3,200 of one item/.test(await text(page, cardOf(7))));
  check("scan line and counts", /Last scan: 11 Nov 2026, 03:00 UTC \(daily\), 1,840 characters checked, 7 flagged, 2 new/.test(await text(page, "#fl-scanline"))
    && /Open 5 \(critical 2\), approved 1, cheat 1/.test(await text(page, "#fl-counts")));
  check("admin: actions, checkboxes, scan button", (await page.$$("#fl-list .fl-check")).length === 5 && (await visible(page, "#fl-scan")) && (await visible(page, "#fl-bulkbar")));
  await shot(page, "flags-desktop.png");

  // ---- filters ----
  await page.click('#fl-status [data-status="approved"]');
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 1);
  t = await text(page, cardOf(5));
  check("approved filter: reviewer, note as text", /reviewed by boss 10 Nov 2026, 12:00 UTC/.test(t) && t.indexOf("Saved up on purpose <i>ok</i>") !== -1 && /status=approved/.test(last(api, "GET", "/api/admin/flags?").path));
  check("approved flag: Cheat offered, Approve not", (await page.$$(cardOf(5) + " .fl-actions button")).length === 3 - 1 - 0 - 0 && !/Approve/.test(await text(page, cardOf(5) + " .fl-actions")));
  await page.click('#fl-status [data-status="all"]');
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 7);
  await page.click('#fl-status [data-status="cheat"]');
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 1);
  check("cheat card has no action buttons but Details", (await page.$$eval(cardOf(6) + " .fl-actions button", (b) => b.map((x) => x.textContent).join(","))) === "Details");
  await page.click('#fl-status [data-status="open"]');
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 5);
  check("rule filter lists the 12 rules", (await page.$$("#fl-rule option")).length === 13);
  await page.selectOption("#fl-rule", "gcp");
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 2);
  check("rule filter sends rule=", /rule=gcp&/.test(last(api, "GET", "/api/admin/flags?").path));
  await page.selectOption("#fl-rule", "");
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 5);

  // ---- detail ----
  await page.click(cardOf(2) + " .fl-body");
  await page.waitForSelector("#fl-detail:not([hidden]) .fl-history");
  check("detail asked", !!last(api, "GET", "/api/admin/flags/2"));
  t = await text(page, "#fl-detail");
  check("detail: history and other flags", /Flag #2: Tobias Reed/.test(t) && /9 Nov 2026, 03:00 UTC/.test(t) && /Flagged/.test(t) && /Other flags of this account/.test(t) && /#9 Tobias Reed: Frontier points far over income \(Open\)/.test(t), t);
  check("detail: no Undo on a history entry that is not undoable", (await page.$$("#fl-detail .fl-history button")).length === 0);
  await shot(page, "flags-detail.png");
  await page.click("#fl-detail-close");
  check("detail closes", !(await visible(page, "#fl-detail")));

  // ---- approve is refused (409) on a flag that is not open: the API's message as it is ----
  api.flags.find((f) => f.id === 7).status = "cheat";
  await page.click(cardOf(7) + " .fl-actions >> text=Approve");
  await page.click("#fl-confirm-yes");
  await page.waitForSelector("#fl-confirm-msg:not([hidden])");
  check("approve on a flag that is not open: 409 message shown, dialog stays", (await text(page, "#fl-confirm-msg")) === "Flag 7 is already cheat: undo the Cheat action first." && (await visible(page, "#fl-confirm")));
  await page.click("#fl-confirm-no");
  api.flags.find((f) => f.id === 7).status = "open";
  await page.click("#fl-refresh");
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 5);

  // ---- approve with confirm ----
  await page.click(cardOf(2) + " .fl-actions >> text=Approve");
  check("approve: confirm shows the old value", (await visible(page, "#fl-confirm")) && /Approve flag #2/.test(await text(page, "#fl-confirm-text")) && /GCP stays at 450,000/.test(await text(page, "#fl-confirm-lines"))
    && !(await visible(page, "#fl-value-field")));
  check("approve: nothing sent before Confirm", count(api, "POST", "/approve") === 1);
  await page.fill("#fl-cnote", "Saved on purpose");
  await page.click("#fl-confirm-yes");
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 4);
  check("approve: body sent", JSON.stringify(last(api, "POST", "/flags/2/approve").body) === '{"note":"Saved on purpose"}');
  check("approve: message, badge down, list reloaded", /Approved flag #2/.test(await text(page, "#fl-ok")) && (await text(page, "#count-flags")) === "4" && !(await visible(page, "#fl-confirm")));

  // ---- cheat with confirm: prefilled, editable, refusal, then done ----
  api.cheatRefuse = "Character is online: log out first.";
  await page.click(cardOf(1) + " .fl-actions >> text=Cheat");
  check("cheat: value prefilled with the suggested value, old -> new", (await page.inputValue("#fl-value")) === "102000" && /GCP 999,999,999 -> 102,000/.test(await text(page, "#fl-confirm-lines")));
  await page.fill("#fl-value", "1,000,000,000");
  await page.click("#fl-confirm-yes");
  check("cheat only lowers: a higher value is refused before sending", /Cheat only lowers the value: 0 to 999,999,999/.test(await text(page, "#fl-confirm-msg")) && count(api, "POST", "/flags/1/cheat") === 0);
  await page.fill("#fl-value", "1,500,000");
  check("cheat: the line follows the edited value", /999,999,999 -> 1,500,000/.test(await text(page, "#fl-confirm-lines")));
  await shot(page, "flags-confirm.png");
  await page.click("#fl-confirm-yes");
  await page.waitForSelector("#fl-confirm-msg:not([hidden])");
  check("cheat refused: the API's message as it is, dialog stays", (await text(page, "#fl-confirm-msg")) === "Character is online: log out first." && (await visible(page, "#fl-confirm")));
  check("cheat body: value as a number", JSON.stringify(last(api, "POST", "/flags/1/cheat").body) === '{"note":"","value":1500000}');
  api.cheatRefuse = null;
  await page.fill("#fl-value", "abc");
  await page.click("#fl-confirm-yes");
  check("cheat: a bad value is refused before sending", /whole number/.test(await text(page, "#fl-confirm-msg")) && count(api, "POST", "/flags/1/cheat") === 1);
  await page.fill("#fl-value", "");
  await page.click("#fl-confirm-yes");
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 3);
  check("cheat with an empty value sends no value (the API uses the suggested one)", JSON.stringify(last(api, "POST", "/flags/1/cheat").body) === '{"note":""}');
  check("cheat: result message old -> new", /Cheat on flag #1: GCP 999,999,999 -> 102,000/.test(await text(page, "#fl-ok")), await text(page, "#fl-ok"));

  // a rule without a currency only marks
  await page.click(cardOf(3) + " .fl-actions >> text=Cheat");
  check("no-currency rule: no value box, says it only marks", !(await visible(page, "#fl-value-field")) && /only marked/.test(await text(page, "#fl-confirm-text")) && /only marked/.test(await text(page, "#fl-confirm-lines")));
  await page.click("#fl-confirm-no");
  check("cancel closes and sends nothing", !(await visible(page, "#fl-confirm")) && count(api, "POST", "/flags/3/") === 0);
  // an account rule (frontier points): the suggested value is the rule's ceiling
  await page.click(cardOf(4) + " .fl-actions >> text=Cheat");
  check("account rule: prefilled with the ceiling, old -> new", (await page.inputValue("#fl-value")) === "25000" && /\(account rule\) \(Frontier points far over income\): Frontier points 118,899 -> 25,000/.test(await text(page, "#fl-confirm-lines")), await text(page, "#fl-confirm-lines"));
  await page.click("#fl-confirm-no");

  // ---- undo with 409 canForce ----
  api.undoFail = "The character's GCP changed since the cheat.";
  await page.click('#fl-status [data-status="cheat"]');
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 2);
  await page.click(cardOf(6) + " .fl-actions >> text=Details");
  await page.waitForSelector("#fl-detail .fl-history button");
  check("detail: Undo only on the undoable entry", (await page.$$("#fl-detail .fl-history button")).length === 1);
  await page.click("#fl-detail .fl-history button");
  check("undo: confirm says old -> new", /GCP goes from 102,000 back to 450,000/.test(await text(page, "#fl-confirm-text")));
  await page.click("#fl-confirm-yes");
  await page.waitForSelector("#fl-confirm-msg:not([hidden])");
  check("undo 409: message and Undo anyway", (await text(page, "#fl-confirm-msg")) === "The character's GCP changed since the cheat." && (await text(page, "#fl-confirm-yes")) === "Undo anyway"
    && JSON.stringify(last(api, "POST", "/undo").body) === "{}");
  await page.click("#fl-confirm-yes");
  await page.waitForFunction(() => !document.querySelector("#fl-confirm") || document.querySelector("#fl-confirm").hidden);
  check("undo anyway: force sent", JSON.stringify(last(api, "POST", "/undo").body) === '{"force":true}' && count(api, "POST", "/undo") === 2);
  await page.waitForFunction(() => /Undone/.test(document.getElementById("fl-ok").textContent));

  await page.close();

  // ---- bulk ----
  api = newApi();
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-list .fl-card");
  check("bulk buttons off with nothing selected", await page.$eval("#fl-bulk-approve", (b) => b.disabled) && await page.$eval("#fl-bulk-cheat", (b) => b.disabled));
  await page.check("#fl-select-all");
  check("select all selects the view", (await page.$$eval("#fl-list .fl-check input:checked", (n) => n.length)) === 5 && /5 selected/.test(await text(page, "#fl-bulk-count")));
  await page.uncheck(cardOf(7) + " .fl-check input");
  check("a box off: 4 selected, select all partial", /4 selected/.test(await text(page, "#fl-bulk-count")) && await page.$eval("#fl-select-all", (c) => c.indeterminate));
  api.bulkFail = [3];
  await page.click("#fl-bulk-cheat");
  check("bulk cheat: the count in the confirm, one line per flag, empty value = suggested", /Cheat 4 flags/.test(await text(page, "#fl-confirm-text")) && (await page.$$("#fl-confirm-lines li")).length === 4
    && (await page.inputValue("#fl-value")) === "" && /GCP 999,999,999 -> 102,000/.test(await text(page, "#fl-confirm-lines")) && /Frontier points 118,899 -> 25,000/.test(await text(page, "#fl-confirm-lines")) && /only marked/.test(await text(page, "#fl-confirm-lines")));
  await page.fill("#fl-value", "100");
  check("bulk cheat: one value for all shown", (await page.$$eval("#fl-confirm-lines li", (n) => n.filter((x) => /-> 100$/.test(x.textContent)).length)) === 3 && /only marked/.test(await text(page, "#fl-confirm-lines")));
  await page.fill("#fl-value", "");
  await page.fill("#fl-cnote", "mass review");
  await page.click("#fl-confirm-yes");
  await page.waitForSelector("#fl-results:not([hidden])");
  check("bulk body", JSON.stringify(last(api, "POST", "/bulk").body) === '{"ids":[1,3,2,4],"action":"cheat","note":"mass review"}', JSON.stringify(last(api, "POST", "/bulk").body));
  t = await text(page, "#fl-results");
  check("bulk results per id", /3 done, 1 failed/.test(t) && /#3 .*failed \(Character is online\.\)/.test(t) && /#1 .*done/.test(t), t);
  await shot(page, "flags-bulk.png");
  await page.close();

  // ---- bulk approve and the one-value body, on a fresh page ----
  api = newApi();
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-list .fl-card");
  await page.check(cardOf(2) + " .fl-check input");
  await page.check(cardOf(3) + " .fl-check input");
  await page.click("#fl-bulk-approve");
  check("bulk approve: confirm with the count, no value box", /Approve 2 flags/.test(await text(page, "#fl-confirm-text")) && !(await visible(page, "#fl-value-field")));
  await page.click("#fl-confirm-yes");
  await page.waitForSelector("#fl-results:not([hidden])");
  check("bulk approve body", JSON.stringify(last(api, "POST", "/bulk").body) === '{"ids":[3,2],"action":"approve","note":""}');
  await page.check(cardOf(1) + " .fl-check input");
  await page.click("#fl-bulk-cheat");
  await page.fill("#fl-value", "777");
  await page.click("#fl-confirm-yes");
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 2);
  check("bulk cheat one value body", JSON.stringify(last(api, "POST", "/bulk").body) === '{"ids":[1],"action":"cheat","note":"","value":777}');

  // ---- rules, scan ----
  await page.click("#fl-rules summary");
  check("rules table", (await page.$$("#fl-rules-body tr")).length === 12 && /GCP far over what play earns/.test(await text(page, "#fl-rules-body")) && /Live check: live 2026-11-11: median 20/.test(await text(page, "#fl-rules-body")));
  const zen = '#fl-rules-body tr[data-rule="zenny_over_cap"]';
  check("rules: refuses imports shown, no ceiling box for a rule without a currency", /refuses imports/.test(await text(page, zen)) && (await page.$$(zen + ' input[aria-label^="Ceiling"]')).length === 0 && /no currency/.test(await text(page, zen))
    && !/refuses imports/.test(await text(page, '#fl-rules-body tr[data-rule="gcp"]')) && (await page.$$('#fl-rules-body tr[data-rule="gcp"] input[aria-label^="Ceiling"]')).length === 1);
  await shot(page, "flags-rules.png");
  const row = '#fl-rules-body tr[data-rule="gcp"]';
  await page.click(row + " button");
  check("rules: nothing changed sends nothing", count(api, "PUT", "/rules/") === 0 && /Nothing changed/.test(await text(page, "#fl-ok")));
  await page.fill(row + ' input[aria-label^="Threshold"]', "600000");
  await page.selectOption(row + " select", "critical");
  await page.uncheck(row + ' input[type="checkbox"]');
  await page.fill(row + ' input[aria-label^="Ceiling"]', "");
  await page.click(row + " button");
  await page.waitForFunction(() => /Saved GCP far over what play earns/.test(document.getElementById("fl-ok").textContent));
  check("rules: PUT with only the changed fields; an empty ceiling is not sent (the API keeps it)", JSON.stringify(last(api, "PUT", "/rules/gcp").body) === '{"enabled":false,"threshold":600000,"severity":"critical"}', JSON.stringify(last(api, "PUT", "/rules/gcp").body));
  check("rules: the ceiling stays 102000 after the save", (await page.inputValue(row + ' input[aria-label^="Ceiling"]')) === "102000");
  await page.fill(row + ' input[aria-label^="Ceiling"]', "90000");
  await page.click(row + " button");
  await page.waitForFunction(() => /Saved/.test(document.getElementById("fl-ok").textContent));
  await new Promise((res) => setTimeout(res, 300));
  check("rules: a new ceiling is sent alone", count(api, "PUT", "/rules/gcp") === 2 && JSON.stringify(last(api, "PUT", "/rules/gcp").body) === '{"ceiling":90000}', JSON.stringify(last(api, "PUT", "/rules/gcp").body));
  await page.click("#fl-scan");
  await page.waitForFunction(() => /Scan done: 1,845 characters, 7 flagged, 1 new/.test(document.getElementById("fl-ok").textContent));
  check("scan: POST sent", count(api, "POST", "/flags/scan") === 1);
  check("no page errors (admin)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- moderator: read only ----
  api = newApi({ moderator: true });
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-list .fl-card");
  check("moderator: badge shows", (await text(page, "#count-flags")) === "5");
  check("moderator: no checkboxes, buttons, bulk bar or Scan now", (await page.$$("#fl-list .fl-check")).length === 0 && (await page.$$eval("#fl-list .fl-actions button", (b) => b.map((x) => x.textContent).filter((x) => x !== "Details").length)) === 0
    && !(await visible(page, "#fl-bulkbar")) && !(await visible(page, "#fl-scan")));
  await page.click('#fl-status [data-status="cheat"]');
  await page.waitForFunction(() => document.querySelectorAll("#fl-list .fl-card").length === 1);
  await page.click(cardOf(6) + " .fl-body");
  await page.waitForSelector("#fl-detail .fl-history");
  check("moderator: no Undo in history", (await page.$$("#fl-detail .fl-history button")).length === 0);
  await page.click("#fl-rules summary");
  check("moderator: rules are text", (await page.$$("#fl-rules-body input, #fl-rules-body select, #fl-rules-body button")).length === 0 && /GCP far over what play earns/.test(await text(page, "#fl-rules-body")) && /refuses imports/.test(await text(page, "#fl-rules-body")));
  check("moderator: no writes sent", api.calls.filter((c) => c.method !== "GET").length === 0);
  await page.close();

  // ---- the tables are not there ----
  api = newApi({ tableReady: false });
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-notable:not([hidden])");
  check("tableReady false: the notice, no badge", /The flags tables are not installed yet/.test(await text(page, "#fl-notable")) && !(await visible(page, "#fl-main")) && !(await visible(page, "#count-flags")));
  await page.close();
  api = newApi({ table503: true });
  r = await open(browser, base + "/admin.html#flags", api);
  page = r.page;
  await page.waitForSelector("#fl-notable:not([hidden])");
  check("503: the same notice", !(await visible(page, "#fl-main")));
  await page.close();

  // ---- phone ----
  api = newApi();
  r = await open(browser, base + "/admin.html#flags", api, 390);
  page = r.page;
  await page.waitForSelector("#fl-list .fl-card");
  check("390 px: nothing of the tab runs past the screen", (await panelOverflow(page)).length === 0, JSON.stringify(await panelOverflow(page)));
  check("390 px: the page does not scroll sideways", (await overflow(page)) <= 0, String(await overflow(page)));
  await page.click(cardOf(2) + " .fl-actions >> text=Cheat");
  check("390 px: the confirm fits", (await panelOverflow(page)).length === 0, JSON.stringify(await panelOverflow(page)));
  await page.click("#fl-confirm-no");
  await shot(page, "flags-phone.png");
  await page.click(cardOf(2) + " .fl-body");
  await page.waitForSelector("#fl-detail .fl-history");
  await page.click("#fl-rules summary");
  check("390 px: with detail and rules open", (await panelOverflow(page)).length === 0, JSON.stringify(await panelOverflow(page)));
  check("no page errors (phone)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAIL: " + failures.length);
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("admin flags OK");
}

run().catch((e) => { console.error(e); try { server.close(); } catch (x) { /* ignore */ } process.exit(1); });
