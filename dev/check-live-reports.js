#!/usr/bin/env node
/* Checks, in headless Chromium against a fake API:

   Account page, Diagnostics tab, "Live reports from your game" (js/account-telemetry.js, section #live-reports):
   - nothing is fetched until the Diagnostics tab is shown; then GET /api/account/telemetry?limit=50 with the token;
   - each report shows its time (a <time>), the type (Health / Crash), the character name, the patch version as text
     (124 -> v1.24, 12403 -> v1.24-pre3, 0 -> no patch version) and the summary; API text goes in as text, not HTML;
   - Show fetches /api/account/telemetry/{id} and shows the report as stored in a <pre>, and for a crash the plain
     answer; Hide closes it; a report that is gone (404) says so;
   - "Load more" shows when there are more than listed and asks with before=<last id>, then goes away;
   - "Delete my reports" asks first (Cancel changes nothing), then sends DELETE and empties the list with
     "Deleted N reports."; the delete button is hidden when there is nothing;
   - the empty state "No reports from your characters in the last 30 days."; a 401 (and a missing token) says to sign in; an API
     without the endpoint (404) says so; a failing delete shows the message and keeps the list;
   - nothing passes 375px, no page errors.
   Page /diagnostics-data.html: every data-field row of the generated list is there (rows must be those of the
   telemetry-fields list; set FIELDS=<fields.html> to check against a file, default /srv/devbot/telemetry-transparency-briefs/fields.html when it
   exists), the sections of the brief have their ids, the two examples are there, and the page does not scroll sideways at 375px.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-live-reports.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (file.endsWith(path.sep)) file += "index.html";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const jwt = (exp) => "e30." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

const item = (id, o) => Object.assign({ id, receivedAt: "2026-11-13T12:00:00Z", kind: "health", charId: 4321, characterName: "Aldra",
  edition: "HD", patch: 124, hvmods: "24", crashAt: null, crashException: null, fps: 30, drawn: 29.8, errors: 0, problems: null,
  summary: "30.0 fps, 29.8 drawn, no errors, no problems" }, o || {});
const FEW = [
  item(30, { kind: "crash", crashAt: "mhfo-hd.dll+0x0089f165", crashException: "0xc0000005", patch: 12403, characterName: "Old<b>Guy</b>",
    summary: "crash 0xc0000005 at mhfo-hd.dll+0x0089f165", fps: null, drawn: null }),
  item(20, { patch: 0, characterName: "Bexo", summary: "30.0 fps, 29.8 drawn, 2 errors, 1 problem" }),
  item(10)
];
const TEXT = { 30: "HVTELEM 1\nkind: crash\n[report]\nHVCRASH 1\nat: mhfo-hd.dll+0x0089f165\n", 20: "HVTELEM 1\nkind: health\n", 10: "HVTELEM 1\nkind: health\n" };

// st: {items (all, newest first), total, mode: "ok"|"401"|"404"|"500", deleteFails, calls: [], gone: [ids]}
async function open(browser, base, st, width, hash) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 }, locale: "en-GB" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => { if (t) localStorage.setItem("hvmhfz.token", t); }, st.noToken ? "" : TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p.startsWith("/api/account/telemetry")) {
      st.calls.push({ method: req.method(), path: p, query: url.search, auth: req.headers()["authorization"] });
      if (st.mode === "401") return reply(401, { message: "Unauthorized" });
      if (st.mode === "404") return reply(404, { message: "Not found" });
      if (st.mode === "500") return reply(500, { message: "boom" });
      if (req.method() === "DELETE") {
        if (st.deleteFails) return reply(500, { message: "Could not delete right now." });
        const n = st.total; st.items = []; st.total = 0;
        return reply(200, { deleted: n });
      }
      const m = p.match(/^\/api\/account\/telemetry\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if ((st.gone || []).includes(id)) return reply(404, { message: "No such report." });
        const it = st.items.find((x) => x.id === id);
        if (!it) return reply(404, { message: "No such report." });
        return reply(200, Object.assign({}, it, { text: TEXT[id] || "HVTELEM 1\n<b>raw</b>\n",
          answer: it.kind === "crash" ? { kind: "crash", outcome: "The game crashed in the game's own code.", findings: [{ kind: "crash", text: "Update the patch <i>now</i>." }], facts: [] } : null }));
      }
      const before = url.searchParams.get("before");
      const limit = Number(url.searchParams.get("limit"));
      const rows = st.items.filter((x) => !before || x.id < Number(before)).slice(0, limit);
      return reply(200, { total: st.total, items: rows });
    }
    if (p === "/api/account") return reply(200, { name: "author", roles: ["ROLE_USER"], characters: 0, lastLogin: null });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, []);
  });
  await page.goto(base + "/account.html" + (hash === undefined ? "#diagnostics" : hash));
  await page.waitForSelector("#live-reports", { state: "attached", timeout: 5000 });
  await page.waitForTimeout(500);
  return { page, errors };
}

const mk = (items, total) => ({ items, total: total === undefined ? items.length : total, calls: [], mode: "ok" });
const visible = (page, sel) => page.isVisible(sel);

async function account(browser, base) {
  // Not fetched before the tab is shown.
  {
    const st = mk(FEW);
    const { page, errors } = await open(browser, base, st, 1280, "#overview");
    check("nothing fetched while the Diagnostics tab is hidden", !st.calls.length, JSON.stringify(st.calls));
    await page.click("#tab-diagnostics");
    await page.waitForSelector("#lr-list .live-report", { timeout: 3000 });
    check("fetched once the tab is shown", st.calls.length === 1 && st.calls[0].query === "?limit=50" && st.calls[0].auth === "Bearer " + TOKEN, JSON.stringify(st.calls));
    check("no page errors (tab)", !errors.length, errors.join("; "));
    await page.close();
  }

  // The list.
  const st = mk(FEW);
  const { page, errors } = await open(browser, base, st);
  check("#live-reports opens its tab and shows the heading", await visible(page, "#live-reports h2"));
  check("link to the diagnostics page", (await page.$$eval("#live-reports a[href='/diagnostics-data.html']", (a) => a.length)) >= 1);
  const rows = await page.$$eval("#lr-list .live-report", (n) => n.map((li) => ({
    kind: li.querySelector(".live-report-kind").textContent, time: !!li.querySelector("time"), meta: li.querySelector(".live-report-meta").textContent,
    summary: li.querySelector(".live-report-summary").textContent, html: li.innerHTML.includes("<b>Guy"), crash: li.classList.contains("is-crash") })));
  check("three reports listed", rows.length === 3, JSON.stringify(rows));
  check("a crash row: type, name as text, v1.24-pre3, summary", rows[0] && rows[0].kind === "Crash" && rows[0].crash && rows[0].meta === "Old<b>Guy</b> · v1.24-pre3"
    && rows[0].summary.startsWith("crash 0xc0000005") && !rows[0].html && rows[0].time, JSON.stringify(rows[0]));
  check("patch 0 reads no patch version", rows[1] && rows[1].meta === "Bexo · no patch version" && rows[1].kind === "Health", JSON.stringify(rows[1]));
  check("patch 124 reads v1.24", rows[2] && rows[2].meta === "Aldra · v1.24", JSON.stringify(rows[2]));
  check("count line", (await page.textContent("#lr-count")).includes("3 reports"));
  check("no Load more when all are listed", !(await visible(page, "#lr-more")));
  check("Delete my reports is shown", await visible(page, "#lr-delete"));
  check("no empty state or alert", !(await visible(page, "#lr-empty")) && !(await visible(page, "#lr-alert")));

  // Show / Hide.
  await page.click("#lr-list li[data-id='30'] button");
  await page.waitForSelector("#lr-list li[data-id='30'] pre", { timeout: 3000 });
  const d = await page.$eval("#lr-list li[data-id='30'] .live-report-detail", (n) => ({ raw: n.querySelector("pre").textContent, outcome: n.querySelector(".diag-outcome").textContent,
    finding: n.querySelector(".diag-findings li").textContent, innerI: !!n.querySelector("i") }));
  check("detail: the raw report in a pre", d.raw === TEXT[30], JSON.stringify(d));
  check("detail: the crash answer, as text", d.outcome.startsWith("The game crashed") && d.finding === "Update the patch <i>now</i>." && !d.innerI, JSON.stringify(d));
  check("detail asked /api/account/telemetry/30", st.calls.some((c) => c.path === "/api/account/telemetry/30" && c.method === "GET"));
  check("button says Hide", (await page.textContent("#lr-list li[data-id='30'] button")) === "Hide");
  await page.click("#lr-list li[data-id='30'] button");
  check("Hide closes the detail", !(await visible(page, "#lr-list li[data-id='30'] .live-report-detail")));
  await page.click("#lr-list li[data-id='30'] button");
  check("Show again does not refetch", st.calls.filter((c) => c.path === "/api/account/telemetry/30").length === 1);
  await page.click("#lr-list li[data-id='10'] button");
  await page.waitForSelector("#lr-list li[data-id='10'] pre", { timeout: 3000 });
  check("a health report's detail has no answer", !(await page.$("#lr-list li[data-id='10'] .diag-outcome")));
  check("raw text with markup stays text", (await page.$eval("#lr-list li[data-id='10'] pre", (n) => n.textContent)) === TEXT[10]);
  st.gone = [20];
  await page.click("#lr-list li[data-id='20'] button");
  await page.waitForTimeout(300);
  check("a gone report says so", (await visible(page, "#lr-alert")) && (await page.textContent("#lr-alert")).includes("gone"));
  check("no page errors (list)", !errors.length, errors.join("; "));

  // Delete: Cancel first.
  await page.click("#lr-delete");
  check("confirmation asks first", (await visible(page, "#lr-confirm")) && (await page.textContent("#lr-confirm-text")).includes("Delete all 3"));
  check("nothing deleted yet", !st.calls.some((c) => c.method === "DELETE"));
  await page.click("#lr-confirm-no");
  check("Cancel closes it and keeps the list", !(await visible(page, "#lr-confirm")) && (await page.$$("#lr-list .live-report")).length === 3 && !st.calls.some((c) => c.method === "DELETE"));
  await page.click("#lr-delete");
  await page.click("#lr-confirm-yes");
  await page.waitForTimeout(400);
  const del = st.calls.filter((c) => c.method === "DELETE");
  check("DELETE /api/account/telemetry once, with the token", del.length === 1 && del[0].path === "/api/account/telemetry" && del[0].query === "" && del[0].auth === "Bearer " + TOKEN, JSON.stringify(del));
  check("the list empties and says how many", (await page.$$("#lr-list .live-report")).length === 0 && (await page.textContent("#lr-done")).trim() === "Deleted 3 reports." && (await visible(page, "#lr-done")));
  check("after deleting: no delete button, no confirm", !(await visible(page, "#lr-delete")) && !(await visible(page, "#lr-confirm")));
  check("no page errors (delete)", !errors.length, errors.join("; "));
  await page.close();

  // A failing delete keeps the list.
  {
    const s = mk(FEW); s.deleteFails = true;
    const o = await open(browser, base, s);
    await o.page.click("#lr-delete");
    await o.page.click("#lr-confirm-yes");
    await o.page.waitForTimeout(400);
    check("a failing delete shows the message and keeps the list", (await o.page.textContent("#lr-alert")).includes("Could not delete") && (await o.page.$$("#lr-list .live-report")).length === 3);
    check("the confirmation closes after a failed delete", !(await visible(o.page, "#lr-confirm")));
    await o.page.close();
  }

  // Load more: 120 reports, pages of 50.
  {
    const all = [];
    for (let id = 120; id >= 1; id--) all.push(item(id));
    const s = mk(all);
    const o = await open(browser, base, s);
    check("first page: 50 reports", (await o.page.$$("#lr-list .live-report")).length === 50 && s.calls[0].query === "?limit=50", JSON.stringify(s.calls[0]));
    check("count line says 120", (await o.page.textContent("#lr-count")).includes("120 reports"));
    check("Load more is shown", await visible(o.page, "#lr-more"));
    await o.page.click("#lr-more");
    await o.page.waitForTimeout(400);
    check("Load more asks before=<last id>", s.calls[1] && s.calls[1].query === "?limit=50&before=71", JSON.stringify(s.calls[1]));
    check("100 listed, newest first", (await o.page.$$("#lr-list .live-report")).length === 100 && (await o.page.$eval("#lr-list li:last-child", (n) => n.dataset.id)) === "21");
    await o.page.click("#lr-more");
    await o.page.waitForTimeout(400);
    check("all 120 listed and Load more gone", (await o.page.$$("#lr-list .live-report")).length === 120 && !(await visible(o.page, "#lr-more")));
    check("delete confirm says 120", (await (async () => { await o.page.click("#lr-delete"); return o.page.textContent("#lr-confirm-text"); })()).includes("Delete all 120"));
    check("no page errors (paging)", !o.errors.length, o.errors.join("; "));
    await o.page.close();
  }

  // Empty, 401, no token, 404, 500.
  {
    const o = await open(browser, base, mk([]));
    check("empty state", (await visible(o.page, "#lr-empty")) && (await page_text(o.page, "#lr-empty")) === "No reports from your characters in the last 30 days." && !(await visible(o.page, "#lr-delete")) && !(await visible(o.page, "#lr-list")));
    await o.page.close();
  }
  for (const [mode, expect] of [["401", "sign-in has expired"], ["404", "not available yet"], ["500", "boom"]]) {
    const s = mk([]); s.mode = mode;
    const o = await open(browser, base, s);
    const msg = (await visible(o.page, "#lr-alert")) ? await o.page.textContent("#lr-alert") : "";
    check("mode " + mode + " says: " + expect, msg.includes(expect), msg);
    check("mode " + mode + ": no list, no delete, no empty state", !(await visible(o.page, "#lr-list")) && !(await visible(o.page, "#lr-delete")) && !(await visible(o.page, "#lr-empty")));
    check("no page errors (" + mode + ")", !o.errors.length, o.errors.join("; "));
    await o.page.close();
  }

  // 375px phone: nothing in the section passes the screen.
  {
    const s = mk(FEW.map((x) => Object.assign({}, x, { summary: "crash 0xc0000005 at " + "x".repeat(150), characterName: "N".repeat(60) })));
    const o = await open(browser, base, s, 375);
    await o.page.click("#lr-list li[data-id='30'] button");
    await o.page.waitForSelector("#lr-list li[data-id='30'] pre");
    await o.page.click("#lr-delete");
    const w = await o.page.evaluate(() => ({ right: document.getElementById("live-reports").getBoundingClientRect().right,
      widest: Math.max.apply(null, Array.from(document.querySelectorAll("#live-reports *")).filter((e) => e.offsetParent && !e.closest("pre")).map((e) => e.getBoundingClientRect().right)) }));
    check("section inside 375px", w.right <= 375 && w.widest <= 375, JSON.stringify(w));
    check("page does not scroll sideways at 375px", await o.page.evaluate(() => document.documentElement.scrollWidth <= 375), String(await o.page.evaluate(() => document.documentElement.scrollWidth)));
    check("no page errors (375px)", !o.errors.length, o.errors.join("; "));
    await o.page.close();
  }
}

async function page_text(page, sel) { return ((await page.textContent(sel)) || "").trim(); }

async function dataPage(browser, base) {
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: "[]" }));
    await page.goto(base + "/diagnostics-data.html");
    await page.waitForSelector("h1");
    check("page heading (" + width + ")", (await page.textContent("h1")).includes("live diagnostics"));
    const ids = ["summary", "when", "fields", "example", "never", "where", "who", "kept", "use", "local", "off", "yours", "changes"];
    const missing = await page.evaluate((list) => list.filter((id) => !document.getElementById(id)), ids);
    check("sections have their ids (" + width + ")", !missing.length, missing.join(", "));
    const onPage = await page.$$eval("tr[data-field]", (n) => n.map((r) => r.getAttribute("data-field")));
    const idRows = await page.$$eval("tr[data-field]", (n) => n.filter((r) => r.id && r.id !== "").length);
    const fieldsFile = process.env.FIELDS || "/srv/devbot/telemetry-transparency-briefs/fields.html";
    if (fs.existsSync(fieldsFile)) {
      const want = Array.from(fs.readFileSync(fieldsFile, "utf8").matchAll(/data-field="([^"]+)"/g)).map((m) => m[1]);
      const lost = want.filter((f) => !onPage.includes(f));
      const extra = onPage.filter((f) => !want.includes(f));
      check("every data-field row is there (" + width + ")", !lost.length && !extra.length && want.length > 30, "missing " + lost.join(", ") + "; extra " + extra.join(", "));
    } else check("fields file for the comparison exists", false, fieldsFile);
    check("field rows are on the page (" + width + ")", onPage.length > 30, String(onPage.length) + " rows " + idRows);
    check("the two examples (" + width + ")", (await page.$("pre[data-example='health']")) && (await page.$("pre[data-example='crash']")) &&
      (await page.textContent("pre[data-example='health']")).startsWith("HVTELEM 1\nkind: health") && (await page.textContent("pre[data-example='crash']")).startsWith("HVTELEM 1\nkind: crash"));
    const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check("no horizontal overflow at " + width + "px", scroll.sw <= scroll.cw, JSON.stringify(scroll));
    if (width === 375) {
      const tables = await page.$$eval("table.fields", (n) => n.map((t) => ({ right: t.getBoundingClientRect().right, over: t.scrollWidth > t.clientWidth + 1 })));
      check("field tables fit 375px and wrap", tables.length === 3 && tables.every((t) => t.right <= 375 && !t.over), JSON.stringify(tables));
    }
    check("links to Account, Privacy", (await page.$("a[href='/account.html#live-reports']")) && (await page.$("a[href='/privacy.html#game-data']")));
    check("no page errors on the page (" + width + ")", !errors.length, errors.join("; "));
    await page.close();
  }
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try { await account(browser, base); await dataPage(browser, base); } catch (e) { failures.push("crashed: " + e.stack); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("live reports OK");
})();
