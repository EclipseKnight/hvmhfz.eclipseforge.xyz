#!/usr/bin/env node
/* Checks the Currencies page (currencies.html, js/currencies.js, data/currencies.json):
   - the data: every currency has a unique id, a name, a group of "groups", a "what" line and at least one way
     to get it; every way and every "not_here" line has a "basis" (where it was checked; not shown); every link
     points at a page of the site (and a /source.html?id= at a source of data/sources/index.json, an
     /item.html?id= at an item); every "items" id is an item;
   - in headless Chromium at 375 and 1280 px: one panel per currency with its anchor, the contents links them,
     no basis text on the page, ?q= filters (and a reload keeps it), #<id> opens on that panel, no sideways
     scrolling, no script errors; an item listed under a currency's "items" links to its entry from item.html;
     the Database search finds a currency by name and links /currencies.html#<id>.
   SHOTS=<folder> saves the page at each width.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-currencies.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS;
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

const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const data = json("data/currencies.json");
const sourceIds = new Set(json("data/sources/index.json").sources.map((s) => s[0]));
const itemIds = new Set(json("data/items/index.json").items.map((r) => r[0]));

function checkLink(where, pair) {
  if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || typeof pair[1] !== "string") {
    check(false, where + ": a link is not [label, href]: " + JSON.stringify(pair));
    return;
  }
  const href = pair[1];
  if (href.startsWith("#")) {
    check(data.currencies.some((c) => "#" + c.id === href), where + ": " + href + " is no currency on the page");
    return;
  }
  check(href.startsWith("/"), where + ": " + href + " is not a page of the site");
  const url = new URL(href, "http://x");
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  check(fs.existsSync(path.join(root, file)), where + ": " + href + ": no file " + file);
  if (url.pathname === "/source.html") check(sourceIds.has(url.searchParams.get("id")), where + ": " + href + ": no such source");
  if (url.pathname === "/item.html") check(itemIds.has(Number(url.searchParams.get("id"))), where + ": " + href + ": no such item");
  if (url.hash && file.endsWith(".html")) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    check(html.includes('id="' + url.hash.slice(1) + '"'), where + ": " + href + ": no " + url.hash + " on " + file);
  }
}

function staticChecks() {
  check(typeof data._about === "string" && data._about.length > 40, "data/currencies.json: _about says how to edit it");
  const groups = new Set((data.groups || []).map((g) => g[0]));
  const seen = new Set();
  check(Array.isArray(data.currencies) && data.currencies.length > 5, "data: too few currencies");
  for (const c of data.currencies) {
    const at = "currency " + (c.id || JSON.stringify(c.name));
    check(/^[a-z0-9-]+$/.test(c.id || "") && !seen.has(c.id), at + ": id missing, not a slug or used twice");
    seen.add(c.id);
    check(c.name && c.what, at + ": needs a name and a what");
    check(groups.has(c.group), at + ": group " + c.group + " is not in groups");
    check(Array.isArray(c.ways) && c.ways.length > 0, at + ": no way to get it");
    (c.ways || []).forEach((w, i) => {
      check(w.how && w.basis, at + ": way " + (i + 1) + " needs how and basis");
      if (w.link) checkLink(at + " way " + (i + 1), w.link);
    });
    (c.not_here || []).forEach((n, i) => check(n.what && n.basis, at + ": not_here " + (i + 1) + " needs what and basis"));
    (c.spend || []).forEach((pair) => checkLink(at + " spend", pair));
    (c.items || []).forEach((id) => check(itemIds.has(id), at + ": item " + id + " is not an item"));
  }
  (data.not_currencies || []).forEach((n) => { if (n.link) checkLink("not_currencies " + n.name, n.link); });
}

async function main() {
  staticChecks();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const bases = data.currencies.flatMap((c) => c.ways.map((w) => w.basis)).filter((b) => b.length > 12);
  const withItem = data.currencies.find((c) => (c.items || []).length);
  const n = data.currencies.length;
  for (const width of [1280, 375]) {
    const tag = width + " px";
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 800 });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });

    await page.goto(base + "/currencies.html", { waitUntil: "load" });
    await page.waitForSelector(".cur-panel");
    const ids = await page.$$eval("section.cur-panel[id]", (s) => s.map((x) => x.id).filter((id) => id !== "not-currencies"));
    check(ids.join() === data.currencies.map((c) => c.id).join() || ids.length === n, tag + ": " + ids.length + " panels for " + n + " currencies");
    const tocLinks = await page.$$eval(".cur-toc a", (as) => as.map((a) => a.getAttribute("href")));
    check(tocLinks.length === n, tag + ": the contents links " + tocLinks.length + " of " + n);
    const text = await page.textContent("#cur-view");
    const leaked = bases.filter((b) => text.includes(b));
    check(leaked.length === 0, tag + ": basis notes shown on the page: " + leaked.slice(0, 2).join(" | "));
    check(await page.textContent("#cur-count") === n + " currencies", tag + ": count says " + await page.textContent("#cur-count"));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), tag + ": sideways scrolling");
    check(await page.$eval(".breadcrumbs ol", (o) => o.textContent) === "HomeDatabaseCurrencies", tag + ": crumbs Home › Database › Currencies");
    if (shots) await page.screenshot({ path: path.join(shots, "currencies-" + width + ".png"), fullPage: true });

    const first = data.currencies[0];
    await page.fill("#cur-q", first.name);
    const shown = await page.$$eval("section.cur-panel[id]", (s) => s.filter((x) => !x.hidden).map((x) => x.id));
    check(shown.includes(first.id) && shown.length < n, tag + ": filtering by " + first.name + " shows " + shown.join());
    check(new URL(page.url()).searchParams.get("q") === first.name, tag + ": ?q= in the address");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".cur-panel");
    check(await page.inputValue("#cur-q") === first.name, tag + ": a reload keeps the filter");

    const last = data.currencies[n - 1];
    await page.goto(base + "/currencies.html#" + last.id, { waitUntil: "load" });
    await page.waitForSelector(".cur-panel");
    // the site scrolls smoothly: wait for the panel to arrive (or 3 s)
    await page.waitForFunction((id) => Math.abs(document.getElementById(id).getBoundingClientRect().top) < 300, last.id, { timeout: 3000 }).catch(() => {});
    const top = await page.$eval("#" + last.id, (s) => s.getBoundingClientRect().top);
    check(top >= -2 && top < 300, tag + ": #" + last.id + " opens on its panel (top " + top + ")");

    if (withItem) {
      await page.goto(base + "/item.html?id=" + withItem.items[0], { waitUntil: "load" });
      await page.waitForSelector(".item-hero-info h1");
      const href = await page.$eval(".item-currency a", (a) => a.getAttribute("href")).catch(() => null);
      check(href === "/currencies.html#" + withItem.id, tag + ": item " + withItem.items[0] + " links its currency: " + href);
    }

    await page.goto(base + "/database.html", { waitUntil: "load" });
    await page.fill("#db-search", first.name);
    await page.waitForFunction(() => document.querySelector('#db-results .db-group[aria-label="Currencies"] .db-hit'));
    const hit = await page.$eval('#db-results .db-group[aria-label="Currencies"] .db-hit', (a) => a.getAttribute("href"));
    check(hit === "/currencies.html#" + first.id, tag + ": the Database search finds " + first.name + ": " + hit);

    check(errors.length === 0, tag + ": script errors: " + errors.join(" | "));
    await context.close();
  }
  await browser.close();
  server.close();
}

main().then(() => {
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL " + p));
    process.exit(1);
  }
  console.log("currencies OK");
}).catch((e) => { console.error(e); process.exit(1); });
