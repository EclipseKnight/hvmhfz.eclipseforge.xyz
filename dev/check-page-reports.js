#!/usr/bin/env node
/* Checks "Report a problem" (js/page-report.js on the data pages) and the admin "Page reports" tab
   (js/admin-reports.js, tab-reports / panel-reports on admin.html) in headless Chromium against a fake API that
   follows the API README "Page reports":

   - the form: the button sits in the breadcrumbs beside "Copy link"; signed out it offers the sign-in back to this
     page and sends nothing; signed in it names the page (kind, id, name from the loaded page, address), offers the
     item wording, finds a quest by name and a monster, counts the description, refuses an empty description, sends
     JSON without pictures and multipart with them (the "report" part as JSON, a picture over 2 MB shrunk to a JPEG
     under 2 MB first), shows the API's refusal as it is, and the thank-you; the kind and id on a quest, monster,
     equipment and weapon page; no sideways scroll at 375 px;
   - the tab: the badge is the new count; status chips with counts, the kind filter; one report with its facts,
     the page link, the pictures (fetched with the sign-in), player text as text; Mark <status> sends {status, note}
     and refreshes; view-only staff get no buttons; staff without the tool get no tab; 390 px; no page errors.
   Screenshots (form and tab, phone and desktop) go to $SHOTS (default /srv/devbot/.bot-logs/page-reports).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-page-reports.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "/srv/devbot/.bot-logs/page-reports";
fs.mkdirSync(SHOTS, { recursive: true });
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
  return b64({ alg: "HS256" }) + "." + b64({ sub: "wren", exp }) + ".sig";
}
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };

/* A PNG of noise, stored without compression so it can be made large (over 2 MB). */
function png(width, height, seed) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let x = seed || 7;
  for (let i = 0; i < raw.length; i++) {
    if (i % (width * 3 + 1) === 0) { raw[i] = 0; continue; }
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = x >> 16;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}
const SMALL = png(64, 48, 3);
const BIG = png(1100, 900, 5); // about 3 MB
const SHOT = png(320, 200, 9);

/* Splits a multipart body into its parts: [{name, filename, type, data}]. */
function parts(body, contentType) {
  const boundary = /boundary=(.+)$/.exec(contentType)[1];
  const out = [];
  const sep = Buffer.from("--" + boundary);
  let at = body.indexOf(sep);
  while (at !== -1) {
    const next = body.indexOf(sep, at + sep.length);
    if (next === -1) break;
    const part = body.slice(at + sep.length + 2, next - 2);
    const headEnd = part.indexOf("\r\n\r\n");
    const head = part.slice(0, headEnd).toString();
    out.push({ name: (/name="([^"]*)"/.exec(head) || [])[1], filename: (/filename="([^"]*)"/.exec(head) || [])[1],
               type: (/Content-Type: (\S+)/i.exec(head) || [])[1], data: part.slice(headEnd + 4) });
    at = next;
  }
  return out;
}

/* ---- fake API ---- */

const BAD = "Kirin <b>Horn</b>";
function report(id, over) {
  return Object.assign({ id, createdAt: "2026-11-23T10:00:00Z", userId: 1, account: "wren", kind: "item", pageId: "1",
    pageName: "Book of Combos 1", pageUrl: "/item.html?id=1", problem: "missing-source", location: "", questId: null,
    monster: null, description: "", files: 0, status: "new", staffNote: "", statusBy: null, statusAt: null }, over || {});
}

function newApi(tools) {
  return {
    calls: [], tools, sendStatus: 201, nextId: 40,
    reports: [
      report(31, { pageName: BAD, pageId: "1234", pageUrl: "/item.html?id=1234", location: "Diva <i>quest</i> reward",
        questId: 1061, monster: "kirin", description: "Got two <u>from</u> the\nsecond line.", files: 1, account: "alder<u>" }),
      report(30, { kind: "quest", pageId: "55", pageName: "Some Quest", pageUrl: "/quest.html?id=55", problem: "wrong-info",
        description: "Time limit is 50 minutes." }),
      report(29, { status: "fixed", description: "Old one", staffNote: "Added the source.", statusBy: "boss", statusAt: "2026-11-22T10:00:00Z" })
    ]
  };
}

function counts(api, kind) {
  const c = { "new": 0, confirmed: 0, fixed: 0, rejected: 0 };
  api.reports.filter((r) => !kind || r.kind === kind).forEach((r) => { c[r.status] += 1; });
  return c;
}

function fakeApi(page, api) {
  return page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const type = req.headers()["content-type"] || "";
    const buf = req.postDataBuffer();
    const call = { method: req.method(), path: p + url.search, type, auth: req.headers().authorization || "" };
    if (buf && type.indexOf("multipart/") === 0) call.parts = parts(buf, type);
    else if (buf) { try { call.body = JSON.parse(buf.toString()); } catch (e) { call.body = buf.toString(); } }
    api.calls.push(call);
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/permissions/mine") return reply(200, { roles: ["ROLE_HELPER"], admin: false, staff: true, tools: api.tools });
    if (p === "/api/account/page-reports" && req.method() === "POST") {
      if (api.sendStatus !== 201) return reply(api.sendStatus, { message: api.sendStatus === 429 ? "Too many reports. Try again later." : "kind <b>bad</b>." });
      return reply(201, { id: api.nextId++, status: "new" });
    }
    let m;
    if (p === "/api/admin/page-reports") {
      const st = url.searchParams.get("status") || "new";
      const kind = url.searchParams.get("kind") || "";
      const list = api.reports.filter((r) => (st === "all" || r.status === st) && (!kind || r.kind === kind));
      const kinds = {};
      api.reports.filter((r) => st === "all" || r.status === st).forEach((r) => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
      return reply(200, { tableReady: true, total: list.length, counts: counts(api, kind), kinds, items: list });
    }
    if ((m = p.match(/^\/api\/admin\/page-reports\/(\d+)\/files\/(\d+)$/))) {
      if (!call.auth) return reply(401, { message: "Sign in" });
      return route.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: SHOT });
    }
    if ((m = p.match(/^\/api\/admin\/page-reports\/(\d+)(\/status)?$/))) {
      const r = api.reports.find((x) => x.id === Number(m[1]));
      if (!r) return reply(404, { message: "No such report." });
      const detail = () => Object.assign({}, r, { pictures: r.files ? [{ n: 1, contentType: "image/png", bytes: SHOT.length }] : [] });
      if (!m[2]) return reply(200, detail());
      if (!api.tools.reports || api.tools.reports.indexOf("act") === -1) return reply(403, { message: "Not allowed." });
      Object.assign(r, { status: call.body.status, statusBy: "boss", statusAt: "2026-11-23T12:00:00Z" });
      if (call.body.note !== undefined && call.body.note !== null) r.staffNote = call.body.note;
      return reply(200, detail());
    }
    return reply(404, { message: "Not Found" });
  });
}

let base = "";
const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const posts = (api) => api.calls.filter((c) => c.method === "POST" && c.path === "/api/account/page-reports");

async function newPage(browser, api, width, signedIn) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => {
    if (t) localStorage.setItem("hvmhfz.token", t);
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  }, signedIn ? TOKEN : "");
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await fakeApi(page, api);
  return { page, errors };
}

async function formChecks(browser) {
  let api = newApi({});
  // ---- signed out ----
  let r = await newPage(browser, api, 1280, false);
  let page = r.page;
  await page.goto(base + "/item.html?id=1");
  await page.waitForSelector("nav.breadcrumbs .pr-open");
  await page.waitForFunction(() => document.title.indexOf("Book of Combos 1") === 0);
  const crumbButtons = await page.$$eval("nav.breadcrumbs button", (b) => b.map((x) => x.textContent));
  check("item page: Report a problem then Copy link in the breadcrumbs", crumbButtons.join("|") === "Report a problem|Copy link", crumbButtons.join("|"));
  await page.click(".pr-open");
  await page.waitForSelector("#page-report[open]");
  check("signed out: sign-in offered, back to this page", (await page.getAttribute(".pr-signin-link", "href")) === "/?next=%2Fitem.html%3Fid%3D1#login-form"
    && await page.$eval(".pr-fields", (f) => f.hidden));
  await page.screenshot({ path: path.join(SHOTS, "form-signed-out-1280.png") });
  check("signed out: nothing sent", posts(api).length === 0);
  await page.keyboard.press("Escape");
  check("Escape closes the form", !(await page.$("#page-report[open]")));
  check("no page errors (signed out)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- signed in, desktop: pictures ----
  r = await newPage(browser, api, 1280, true);
  page = r.page;
  await page.goto(base + "/item.html?id=1");
  await page.waitForFunction(() => document.title.indexOf("Book of Combos 1") === 0);
  await page.click(".pr-open");
  await page.waitForSelector("#page-report[open] .pr-fields:not([hidden])");
  check("signed in: the page is named", (await text(page, ".pr-page")) === "Item: Book of Combos 1", await text(page, ".pr-page"));
  check("signed in: item wording first and chosen", (await text(page, ".pr-choice span")) === "I got this item somewhere the page doesn't list"
    && await page.$eval("input[name=problem][value=missing-source]", (i) => i.checked));
  check("signed in: who it is sent as", (await text(page, ".pr-signer")).indexOf("Sent as wren") === 0);
  await page.waitForFunction(() => document.querySelectorAll("#pr-monster option").length > 100);
  await page.click(".pr-send");
  check("empty description: refused here, nothing sent", (await text(page, ".pr-status")).indexOf("description") !== -1 && posts(api).length === 0);
  await page.fill("#pr-location", "Second reward line of the Diva quest");
  await page.waitForFunction(() => true);
  await page.fill("#pr-quest", "Kirin Racing");
  await page.waitForSelector("#pr-quest-hits:not([hidden]) .pr-hit");
  const hits = await page.$$eval(".pr-hit", (b) => b.map((x) => x.textContent));
  check("quest search by name", hits[0] === "Kirin Racing the Snow #1061", hits.join("|"));
  await page.click(".pr-hit");
  check("quest picked", (await text(page, ".pr-picked")).indexOf("Quest #1061 · Kirin Racing the Snow") === 0 && await page.$eval("#pr-quest", (i) => i.hidden));
  await page.selectOption("#pr-monster", "kirin");
  await page.fill("#pr-description", "I got two from the second reward line.");
  check("description counter", (await text(page, ".pr-count")) === "38 / 2000", await text(page, ".pr-count"));
  await page.setInputFiles("#pr-files", [{ name: "small.png", mimeType: "image/png", buffer: SMALL },
                                          { name: "phone.png", mimeType: "image/png", buffer: BIG }]);
  await page.waitForFunction(() => document.querySelectorAll(".pr-thumbs img").length === 2);
  check("big file is over 2 MB in the test", BIG.length > 2 * 1024 * 1024, String(BIG.length));
  await page.screenshot({ path: path.join(SHOTS, "form-filled-1280.png") });
  await page.click(".pr-send");
  await page.waitForSelector(".pr-done:not([hidden])");
  let sent = posts(api).pop();
  const rep = sent.parts && sent.parts.find((x) => x.name === "report");
  const files = sent.parts ? sent.parts.filter((x) => x.name === "files") : [];
  const json = rep ? JSON.parse(rep.data.toString()) : {};
  check("pictures: multipart with the report as JSON", rep && rep.type === "application/json", rep && rep.type);
  check("pictures: report fields", json.kind === "item" && json.pageId === "1" && json.pageName === "Book of Combos 1"
    && json.pageUrl === "/item.html?id=1" && json.problem === "missing-source" && json.location === "Second reward line of the Diva quest"
    && json.questId === 1061 && json.monster === "kirin" && json.description === "I got two from the second reward line.", JSON.stringify(json));
  check("pictures: the small one as it is", files.length === 2 && files[0].data.length === SMALL.length && files[0].type === "image/png");
  check("pictures: the big one shrunk to a JPEG under 2 MB", files[1] && files[1].type === "image/jpeg" && files[1].data.length <= 2 * 1024 * 1024
    && files[1].data[0] === 0xff && files[1].data[1] === 0xd8, files[1] && files[1].type + " " + files[1].data.length);
  check("sent with the sign-in", sent.auth === "Bearer " + TOKEN);
  check("thank-you with the report number", (await text(page, ".pr-done")).indexOf("report #40") !== -1, await text(page, ".pr-done"));
  await page.screenshot({ path: path.join(SHOTS, "form-sent-1280.png") });
  await page.click(".pr-done button");
  // A second report: no pictures is plain JSON; a refusal is shown as the API says it.
  await page.click(".pr-open");
  await page.waitForSelector(".pr-fields:not([hidden])");
  check("form is empty again", (await page.inputValue("#pr-description")) === "" && (await page.$$(".pr-thumbs img")).length === 0
    && !(await page.$eval("#pr-quest", (i) => i.hidden)));
  await page.check("input[name=problem][value=wrong-info]");
  await page.fill("#pr-description", "Sell price is 30, not 3.");
  api.sendStatus = 429;
  await page.click(".pr-send");
  await page.waitForFunction(() => /Too many/.test(document.querySelector(".pr-status").textContent));
  check("refusal shown as the API says it", (await text(page, ".pr-status")) === "Too many reports. Try again later.");
  api.sendStatus = 400;
  await page.click(".pr-send");
  await page.waitForFunction(() => /kind/.test(document.querySelector(".pr-status").textContent));
  check("API message stays text", (await text(page, ".pr-status")) === "kind <b>bad</b>." && (await page.$$(".pr-status b")).length === 0);
  api.sendStatus = 201;
  await page.click(".pr-send");
  await page.waitForSelector(".pr-done:not([hidden])");
  sent = posts(api).pop();
  check("no pictures: JSON body", sent.type.indexOf("application/json") === 0 && sent.body.problem === "wrong-info" && sent.body.questId === null
    && sent.body.monster === null, JSON.stringify(sent.body));
  check("no page errors (desktop form)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- phone ----
  r = await newPage(browser, api, 375, true);
  page = r.page;
  await page.goto(base + "/item.html?id=1");
  await page.waitForFunction(() => document.title.indexOf("Book of Combos 1") === 0);
  check("phone: no sideways scroll on the item page", (await overflow(page)) <= 0, String(await overflow(page)));
  await page.screenshot({ path: path.join(SHOTS, "item-page-375.png") });
  await page.click(".pr-open");
  await page.waitForSelector(".pr-fields:not([hidden])");
  await page.fill("#pr-location", "Road shop, tab 3");
  await page.fill("#pr-description", "It is in the Road shop for 200 points.");
  await page.setInputFiles("#pr-files", [{ name: "s.png", mimeType: "image/png", buffer: SMALL }]);
  await page.waitForSelector(".pr-thumbs img");
  const box = await page.$eval("#page-report", (d) => { const b = d.getBoundingClientRect(); return [b.left, b.width, d.scrollWidth - d.clientWidth]; });
  check("phone: the form fills the screen width with no sideways scroll", box[0] === 0 && box[1] === 375 && box[2] <= 0, box.join(","));
  await page.screenshot({ path: path.join(SHOTS, "form-filled-375.png") });
  await page.evaluate(() => { document.querySelector(".pr-send").scrollIntoView(); });
  await page.screenshot({ path: path.join(SHOTS, "form-filled-375-bottom.png") });
  check("no page errors (phone form)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- the kind and id on other pages ----
  r = await newPage(browser, api, 1280, true);
  page = r.page;
  const info = async (url) => {
    await page.goto(base + url);
    await page.waitForSelector(".pr-open");
    return page.evaluate(() => window.HvPageReport.info());
  };
  let i = await info("/quest.html?id=1061");
  check("quest page", i.kind === "quest" && i.id === "1061" && i.url === "/quest.html?id=1061", JSON.stringify(i));
  i = await info("/monster.html?m=kirin");
  check("monster page", i.kind === "monster" && i.id === "kirin", JSON.stringify(i));
  i = await info("/equipment.html?slot=head&id=5");
  check("equipment page", i.kind === "equipment" && i.id === "head:5", JSON.stringify(i));
  i = await info("/weapons.html?type=long-sword&w=31");
  check("weapon page", i.kind === "weapon" && i.id === "long-sword:31", JSON.stringify(i));
  i = await info("/sky-corridor.html");
  check("Sky Corridor page", i.kind === "sky" && i.id === "" && i.name === "Sky Corridor", JSON.stringify(i));
  check("no page errors (other pages)", r.errors.length === 0, r.errors.join("; "));
  await page.close();
}

async function tabChecks(browser) {
  // ---- staff who may view and act ----
  let api = newApi({ reports: ["view", "act"] });
  let r = await newPage(browser, api, 1366, true);
  let page = r.page;
  await page.goto(base + "/admin.html#reports");
  await page.waitForSelector("#count-reports:not([hidden])");
  check("badge: the new count", (await text(page, "#count-reports")) === "2");
  await page.waitForSelector('.pr-card[data-id="31"]');
  const ids = () => page.$$eval("#pr-list .pr-card", (n) => n.map((c) => c.getAttribute("data-id")).join(","));
  check("New by default", (await ids()) === "31,30", await ids());
  const chips = await page.$$eval("#pr-status-chips .chip", (c) => c.map((x) => x.textContent).join("|"));
  check("status chips with counts", chips === "New (2)|Confirmed (0)|Fixed (1)|Rejected (0)|All (3)", chips);
  const card = await text(page, '.pr-card[data-id="31"]');
  check("card: page, problem, account, pictures as text", card.indexOf("Item: " + BAD) !== -1 && card.indexOf("Got it somewhere the page doesn't list") !== -1
    && card.indexOf("alder<u>") !== -1 && card.indexOf("1 picture") !== -1, card);
  check("card: markup stays text", (await page.$$("#pr-list b, #pr-list i, #pr-list u")).length === 0);
  await page.screenshot({ path: path.join(SHOTS, "admin-list-1366.png"), fullPage: false });
  await page.selectOption("#pr-kind", "quest");
  await page.waitForFunction(() => document.querySelectorAll("#pr-list .pr-card").length === 1);
  check("kind filter", (await ids()) === "30" && api.calls.some((c) => c.path.indexOf("kind=quest") !== -1));
  await page.selectOption("#pr-kind", "");
  await page.waitForFunction(() => document.querySelectorAll("#pr-list .pr-card").length === 2);
  await page.click('#pr-status-chips [data-status="fixed"]');
  await page.waitForFunction(() => document.querySelectorAll("#pr-list .pr-card").length === 1);
  check("Fixed filter", (await ids()) === "29");
  await page.click('#pr-status-chips [data-status="new"]');
  await page.waitForFunction(() => document.querySelectorAll("#pr-list .pr-card").length === 2);

  await page.click('.pr-card[data-id="31"]');
  await page.waitForSelector(".pr-picture img[src^='blob:']");
  const facts = await text(page, ".pr-facts");
  check("detail: facts as text", facts.indexOf("Diva <i>quest</i> reward") !== -1 && facts.indexOf("Quest #1061") !== -1 && facts.indexOf("kirin") !== -1, facts);
  check("detail: page link", (await page.getAttribute(".pr-facts a", "href")) === "/item.html?id=1234");
  check("detail: description as text", (await text(page, "#pr-detail .cs-notes")) === "Got two <u>from</u> the\nsecond line."
    && (await page.$$("#pr-detail u, #pr-detail i, #pr-detail .pr-detail-title b")).length === 0);
  const pic = api.calls.find((c) => c.path === "/api/admin/page-reports/31/files/1");
  check("picture fetched with the sign-in", pic && pic.auth === "Bearer " + TOKEN);
  check("four status buttons", (await page.$$("[data-set-status]")).length === 4);
  await page.screenshot({ path: path.join(SHOTS, "admin-detail-1366.png"), fullPage: true });
  await page.fill("#pr-note-text", "Seen in game; adding the <b>source</b>.");
  await page.click('[data-set-status="confirmed"]');
  await page.waitForFunction(() => /confirmed/.test(document.getElementById("pr-ok").textContent));
  const post = api.calls.filter((c) => c.method === "POST").pop();
  check("Mark confirmed: POST {status, note}", post.path === "/api/admin/page-reports/31/status"
    && JSON.stringify(post.body) === JSON.stringify({ status: "confirmed", note: "Seen in game; adding the <b>source</b>." }), JSON.stringify(post.body));
  check("detail now confirmed, note as text", (await text(page, "#pr-detail .pr-detail-head .badge")) === "Confirmed"
    && (await text(page, "#pr-detail")).indexOf("Seen in game; adding the <b>source</b>.") !== -1 && (await page.$$("#pr-detail .cs-notes b")).length === 0);
  await page.waitForFunction(() => document.getElementById("count-reports").textContent === "1");
  check("badge follows", (await text(page, "#count-reports")) === "1");
  await page.setViewportSize({ width: 390, height: 800 });
  check("no sideways scroll at 390 px (detail)", (await overflow(page)) <= 0, String(await overflow(page)));
  await page.screenshot({ path: path.join(SHOTS, "admin-detail-390.png"), fullPage: true });
  await page.click("#pr-detail-close");
  await page.waitForFunction(() => document.querySelectorAll("#pr-list .pr-card").length === 1);
  check("back: 31 left the New list", (await ids()) === "30");
  check("no sideways scroll at 390 px (list)", (await overflow(page)) <= 0, String(await overflow(page)));
  await page.screenshot({ path: path.join(SHOTS, "admin-list-390.png"), fullPage: true });
  check("no page errors (staff who may act)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- view only ----
  api = newApi({ reports: ["view"] });
  r = await newPage(browser, api, 1366, true);
  page = r.page;
  await page.goto(base + "/admin.html#reports");
  await page.waitForSelector('.pr-card[data-id="31"]');
  await page.click('.pr-card[data-id="31"]');
  await page.waitForSelector(".pr-facts");
  check("view only: no status buttons, no note box", (await page.$$("[data-set-status], #pr-note-text")).length === 0);
  check("no page errors (view only)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // ---- no tool: no tab ----
  api = newApi({ flags: ["view"] });
  r = await newPage(browser, api, 1366, true);
  page = r.page;
  await page.goto(base + "/admin.html#reports");
  await page.waitForSelector("#tab-flags:not([hidden])");
  check("without the reports tool the tab is hidden and nothing is asked for", (await page.$eval("#tab-reports", (t) => t.hidden))
    && !api.calls.some((c) => c.path.indexOf("/api/admin/page-reports") === 0));
  await page.close();
}

async function run() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  await formChecks(browser);
  await tabChecks(browser);
  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAIL (" + failures.length + ")");
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("page reports OK (screenshots in " + SHOTS + ")");
}

run().catch((e) => { console.log("FAIL " + e.stack); process.exit(1); });
