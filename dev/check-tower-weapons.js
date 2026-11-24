#!/usr/bin/env node
/* Checks the Tower weapons page (tower-weapons.html, js/tower-weapons.js, data/tower-weapons.json from
   dev/make-tower-weapons.py):
   - the data: 63 weapons (46 with a 300-point budget, 17 Zenith ones with 100), every line's levels with a gain,
     points and exactly one cost row each, every item named, each weapon's shown attack = true attack x its type's
     factor, its Tower smithy recipe as data/equipment says; with the hvmhfz_re checkout here (HVMHFZ_RE, default
     /root/mhfz/hvmhfz_re) every line's level count, points, gain and materials equal its data/tower_upgrades.tsv;
     the shop rows equal what data/items/<id>.json lists now (run dev/make-tower-weapons.py after the sources);
   - the calculation against the original game site's simulator (saved at tenrouz.github.io) and hvmhfz_re
     docs/tower-upgrades.md: Virus Attack 100 = 889 shown for 897 Courage gems, a SnS Soul (Top) and a SnS Ribbon
     High, 27,000 RdP in 90 Road purchases of 10, 5,400 GCP in 30 of 30 (whole bundles: the doc's 26,910 and
     5,382 are per gem), 38 tower clears in the 1st District; Element 280 for
     600 Glittering; Poison 80, Paralysis and Sleep 50; Sharpness 20/40/70/100/120 points; Sacred Worlds Attack 10
     = 966 for 440 Courage gems; the budget holds (a level over it is refused);
   - the page is in the Hunting Road menu, pages.json and the sitemap, and the Sky Corridor page links it;
   - in headless Chromium (when playwright is found) at 1280 and 390 px: a build from the address
     (?w=12685&lv=100) shows 300 of 300 points and attack 889, "All into Attack" and the status sigil switch,
     the list's 63 rows, a list name opening the planner, no sideways scrolling, no script errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-tower-weapons.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const tw = require("../js/tower-weapons.js");

const root = path.join(__dirname, "..");
const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const data = json("data/tower-weapons.json");
const types = Object.fromEntries(data.types.map((t) => [t.slug, t]));
const byName = (n) => data.weapons.find((w) => w.name === n);
const line = (w, stat) => w.lines.find((l) => l.stat === stat);
const levelsFor = (w, map) => w.lines.map((l) => map[l.stat] || 0);

function dataChecks() {
  check(data.weapons.length === 63, "data: " + data.weapons.length + " weapons, not 63");
  check(data.weapons.filter((w) => w.budget === 300).length === 46 && data.weapons.filter((w) => w.budget === 100).length === 17,
    "data: budgets are not 46 x 300 and 17 x 100");
  for (const w of data.weapons) {
    const t = types[w.type];
    check(t, "data: " + w.name + " has type " + w.type + " the data does not list");
    if (!t) continue;
    check(tw.shownAttack(w.base.attack, t.displayFactor) === w.base.shown, "data: " + w.name + " shown attack " + w.base.shown +
      " is not " + w.base.attack + " x " + t.displayFactor + "%");
    check(w.lines[0].stat === "Attack", "data: " + w.name + "'s first line is not Attack");
    for (const l of w.lines) {
      const cols = l.status ? Object.values(l.status) : [l];
      const n = Math.max(...cols.map((c) => c.gain.length));
      check(cols.every((c) => c.gain.length === c.points.length && c.gain.every((g) => g > 0) && c.points.every((p) => p > 0)),
        "data: " + w.name + " " + l.stat + ": a level without gain or points");
      const covered = [];
      l.cost.forEach((r) => { for (let i = r[0]; i <= r[1]; i++) covered.push(i); });
      check(covered.sort((a, b) => a - b).join() === [...Array(n).keys()].join(), "data: " + w.name + " " + l.stat + ": cost rows do not cover each level once");
      l.cost.forEach((r) => r[2].forEach((m) => check(data.items[m[0]], "data: item " + m[0] + " has no name")));
    }
    w.craft.forEach((m) => check(data.items[m[0]], "data: item " + m[0] + " has no name"));
    const eq = json("data/equipment/" + w.kind + "/" + Math.floor(w.id / 1024) + ".json").eq[w.id];
    const make = eq && eq.make.find((r) => r[0] === "c" && /0x940/.test(r[4] || ""));
    check(make && JSON.stringify(make[2]) === JSON.stringify(w.craft), "data: " + w.name + "'s recipe is not data/equipment's");
  }
  // the shop rows as data/items says now
  for (const id of Object.keys(data.items)) {
    let where = [];
    try { where = json("data/items/" + id + ".json").where || []; } catch (e) { /* no sources */ }
    const rows = where.filter(([s, r]) => /^(road-shop-|gcp-item-shop)/.test(s) && r.price);
    const server = new Set(rows.filter(([, r]) => !r.builtin).map(([s]) => s));
    const want = rows.filter(([s, r]) => !(r.builtin && server.has(s))).map(([s, r]) => [s, r.price, r.qty || 1]);
    const got = (data.shops[id] || []).map((r) => [r[0], r[2], r[3]]);
    check(JSON.stringify(got) === JSON.stringify(want), "data: shop rows of item " + id + " differ from data/items (" +
      JSON.stringify(got) + " vs " + JSON.stringify(want) + "): run python3 dev/make-tower-weapons.py");
  }
  // hvmhfz_re's table, when the checkout is here
  const tsv = path.join(process.env.HVMHFZ_RE || "/root/mhfz/hvmhfz_re", "data", "tower_upgrades.tsv");
  if (fs.existsSync(tsv)) {
    const rows = fs.readFileSync(tsv, "utf8").trim().split("\n").map((r) => r.split("\t"));
    const head = rows.shift();
    const col = (r, k) => r[head.indexOf(k)];
    let seen = 0;
    for (const r of rows) {
      const w = data.weapons.find((x) => x.kind === col(r, "kind") && x.id === +col(r, "id"));
      const l = w && line(w, col(r, "stat"));
      if (!l) { check(false, "data: no line " + col(r, "name") + " " + col(r, "stat") + " of hvmhfz_re's table"); continue; }
      seen++;
      const c = l.status ? l.status.Poison : l;
      const mats = tw.lineMaterials(l, c.gain.length);
      const text = Object.keys(mats).map((id) => data.items[id] + " x" + mats[id]).sort().join("; ");
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      check(c.gain.length === +col(r, "max_level") && sum(c.points) === +col(r, "points_to_max") && sum(c.gain) === +col(r, "total_gain") &&
        text === col(r, "materials").split("; ").sort().join("; "),
      "data: " + w.name + " " + l.stat + " differs from hvmhfz_re's table");
    }
    check(seen === data.weapons.reduce((n, w) => n + w.lines.length, 0), "data: " + seen + " lines in hvmhfz_re's table, the data has more");
  }
}

function calcChecks() {
  const virus = byName("Virus"), sw = byName("Sacred Worlds"), sns = types["sword-and-shield"].displayFactor;
  let b = tw.build(virus, levelsFor(virus, { Attack: 100 }), "Poison");
  check(b.points === 300 && !b.over, "calc: Virus Attack 100 uses " + b.points + " points");
  check(tw.shownAttack(virus.base.attack + b.gains.Attack, sns) === 889, "calc: Virus Attack 100 is not 889 shown");
  check(JSON.stringify(b.materials) === JSON.stringify({ 2662: 1, 7236: 1, 11159: 897 }), "calc: Virus Attack 100 materials " + JSON.stringify(b.materials));
  const cost = tw.shopCost(b.materials, data.shops).map((c) => c.shop + " " + c.total + " " + c.currency + " " + c.purchases);
  check(cost.join() === "gcp-item-shop 5400 GCP 30,road-shop 27000 RdP 90", "calc: Virus Attack 100 costs " + cost.join());
  check(tw.skyClears(b.materials, data.gems, data.skyGems["1"]) === 38, "calc: Virus Attack 100 is not 38 clears in the 1st District");
  b = tw.build(virus, levelsFor(virus, { Element: 100 }), "Poison");
  check(b.gains.Element === 280 && b.materials[11160] === 600, "calc: Virus Element 100 is not 280 for 600 Glittering");
  const st = line(virus, "Status").status;
  check(tw.build(virus, levelsFor(virus, { Status: 50 }), "Poison").gains.Status === 80, "calc: Virus Poison max is not 80");
  check(tw.build(virus, levelsFor(virus, { Status: 50 }), "Paralysis").gains.Status === 50 && st.Paralysis.gain.length === 40,
    "calc: Virus Paralysis max is not 50 in 40 levels");
  check(tw.build(virus, levelsFor(virus, { Status: 50 }), "Sleep").gains.Status === 50, "calc: Virus Sleep max is not 50");
  const sharp = line(virus, "Sharpness").points.reduce((a, p) => a.concat((a[a.length - 1] || 0) + p), []);
  check(sharp.join() === "20,40,70,100,120", "calc: Virus Sharpness points " + sharp.join());
  b = tw.build(sw, levelsFor(sw, { Attack: 10 }), "Poison");
  check(b.points === 100 && tw.shownAttack(sw.base.attack + b.gains.Attack, sns) === 966 && b.materials[11159] === 440,
    "calc: Sacred Worlds Attack 10 is not 966 for 440 Courage gems in 100 points");
  // the budget: with Attack 100, nothing else fits; a level over it is refused
  const lv = levelsFor(virus, { Attack: 100 });
  check(virus.lines.every((_l, i) => i === 0 || tw.maxAllowed(virus, lv, i, "Poison") === 0), "calc: a line fits beside Virus Attack 100");
  check(tw.maxAllowed(virus, levelsFor(virus, { Sharpness: 5 }), 0, "Poison") === 76, "calc: Virus with Sharpness 5 does not allow Attack 76");
  check(tw.maxAttack(byName("Wish Master")).level === 50, "calc: Wish Master's Attack at most is not 50");
}

function pageChecks() {
  const nav = read("dev/shell/nav.html");
  check(/<a class="navlink" href="\/sky-corridor.html">Sky Corridor<\/a>\s*<a class="navlink" href="\/tower-weapons.html">Tower weapons<\/a>/.test(nav),
    "page: not in the Hunting Road menu after Sky Corridor");
  check(json("dev/shell/pages.json").some((p) => p.page === "tower-weapons.html" && p.group === "Hunting Road"), "page: not in pages.json");
  check(read("sitemap.xml").includes("/tower-weapons.html</loc>"), "page: not in the sitemap");
  check(read("sky-corridor.html").includes('href="/tower-weapons.html">Tower weapons</a> page'), "page: the Sky Corridor page does not link it");
  const html = read("tower-weapons.html");
  check(html.includes('href="https://tenrouz.github.io/">tenrouz\'s tool</a>'), "page: no credit line to tenrouz's tool");
  check(/Testers only, not on the live server/.test(html), "page: the Test land note is not marked as testers only");
}

async function browserChecks() {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) {
    console.log("(playwright not found: browser checks skipped; set NODE_PATH=/root/work/pw-tools/node_modules)");
    return;
  }
  const typesMime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
    ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
  const server = http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
    if (file.endsWith(path.sep)) file += "index.html";
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": typesMime[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;
  for (const width of [1280, 390]) {
    const tag = width + " px";
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    await page.goto(base + "/tower-weapons.html?w=12685&lv=100");
    await page.waitForSelector("#tw-lines tr");
    const text = (sel) => page.$eval(sel, (n) => n.textContent);
    check((await text("#tw-points")).startsWith("300 of 300 points"), tag + ": Virus Attack 100 shows " + await text("#tw-points"));
    check((await text("#tw-stats")).includes("889 (true 635)"), tag + ": Virus Attack 100 stats " + await text("#tw-stats"));
    check(/Hunting Road shop: 27,000 RdP in 90 purchases/.test(await text("#tw-cost")), tag + ": cost " + await text("#tw-cost"));
    check(await page.$eval("#tw-weapon", (s) => s.value) === "12685", tag + ": the weapon picker is not on Virus");
    // a level over budget is refused
    await page.fill("#tw-lines tr:nth-child(2) .tw-num", "5");
    await page.dispatchEvent("#tw-lines tr:nth-child(2) .tw-num", "change");
    check((await page.$eval("#tw-lines tr:nth-child(2) .tw-num", (n) => n.value)) === "0", tag + ": Sharpness went over the budget");
    // status sigil switch
    await page.click("#tw-reset");
    await page.fill("#tw-lines tr:nth-child(5) .tw-num", "50");
    await page.dispatchEvent("#tw-lines tr:nth-child(5) .tw-num", "change");
    check((await text("#tw-stats")).includes("Poison 80"), tag + ": Poison 50 levels is not 80");
    await page.selectOption("#tw-status", "Sleep");
    check((await text("#tw-stats")).includes("Sleep 50"), tag + ": Sleep after the switch is not 50");
    const q = new URL(page.url()).searchParams;
    check(q.get("st") === "Sleep" && q.get("lv") === "0,0,0,0,40", tag + ": the address is " + page.url());
    check(await page.$eval("#tw-warn", (n) => n.hidden), tag + ": the sigil warning shows for one sigil line");
    // the list, and a name opening the planner
    check((await page.$$("#tw-list tr")).length === 63, tag + ": the list does not have 63 rows");
    await page.click("#tw-list tr:has-text('Sacred Worlds') .link-btn");
    await page.click("#tw-max-attack");
    check((await text("#tw-points")).startsWith("100 of 100 points"), tag + ": Sacred Worlds all into Attack shows " + await text("#tw-points"));
    check((await text("#tw-stats")).includes("966"), tag + ": Sacred Worlds Attack 10 is not 966");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), tag + ": the page scrolls sideways");
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, "tower-weapons-" + width + ".png"), fullPage: true }); }
    check(errors.length === 0, tag + ": script errors: " + errors.join(" | "));
    await context.close();
  }
  await browser.close();
  server.close();
}

dataChecks();
calcChecks();
pageChecks();
browserChecks().then(() => {
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL " + p));
    process.exit(1);
  }
  console.log("tower weapons OK");
}).catch((e) => { console.error(e); process.exit(1); });
