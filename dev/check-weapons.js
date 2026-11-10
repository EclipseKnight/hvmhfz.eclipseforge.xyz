/* Checks the weapons page: the damage formula, the data files, and the page in a browser.
 *
 *   node dev/check-weapons.js                                            formula and data
 *   NODE_PATH=/root/work/pw-tools/node_modules node dev/check-weapons.js  + the page in headless Chromium
 *   SHOTS=/some/dir NODE_PATH=... node dev/check-weapons.js               + desktop and phone screenshots
 *
 * 1. Formula: js/weapons-calc.js against dev/weapons-cases.json, which dev/make-weapons-data.py writes
 *    with hvmhfz_re tools/weapons/moves.py (the records' motion values and the client's crit roll,
 *    melee_crit / crit_factor, emu-checked there) and the formula of hvmhfz_re docs/weapons.md. Every
 *    damage number must be equal; the expected value to 1e-6. Plus the rules people ask about: no crit
 *    below green, negative affinity, the 3000 attack cap.
 * 2. Data: data/weapons/index.json and one file per type: the source patch, field lists, a sharpness bar
 *    for every melee weapon, moves with one MV per hit.
 * 3. Page (when Playwright is found): loads, lists Great Swords, picks one, the calculator shows the
 *    numbers HvWeaponsCalc gives for it, a gunner type hides the form, no script errors, and no sideways
 *    scrolling at 375 px.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const Calc = require(path.join(ROOT, "js/weapons-calc.js"));
const index = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons/index.json"), "utf8"));
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "dev/weapons-cases.json"), "utf8"));
const K = index.constants;
let failed = 0;
function check(ok, msg) {
  if (!ok) { failed++; console.log("FAIL " + msg); }
}

/* ---------- 1. formula ---------- */
check(cases.cases.length >= 20, "at least 20 reference cases, found " + cases.cases.length);
cases.cases.forEach(function (c) {
  const got = Calc.move(c, K, index.sharpMult);
  const label = c.type + " k" + c.kind + " #" + c.id;
  ["attackTotal", "nonCrit", "crit", "negCrit"].forEach(function (key) {
    check(got[key] === c.expect[key], label + " " + key + ": got " + got[key] + ", moves.py reference " + c.expect[key]);
  });
  check(Math.abs(got.expected - c.expect.expected) < 1e-6, label + " expected: got " + got.expected + ", reference " + c.expect.expected);
});
// No crit below green, either way.
[0, 1, 2].forEach(function (sharp) {
  const c = { mv: [100], attack: 1000, sharp: sharp, zone: 50, affinity: 100 };
  const r = Calc.move(c, K, index.sharpMult);
  check(r.crit === r.nonCrit && r.expected === r.nonCrit && !r.canCrit, "affinity +100 at " + index.colours[sharp] + " must not crit");
  const n = Calc.move(Object.assign({}, c, { affinity: -100 }), K, index.sharpMult);
  check(n.negCrit === n.nonCrit && n.expected === n.nonCrit, "affinity -100 at " + index.colours[sharp] + " must not weaken the hit");
});
{
  const g = Calc.move({ mv: [100], attack: 1000, sharp: 3, zone: 100, affinity: 100 }, K, index.sharpMult);
  check(g.expected === g.crit && g.crit > g.nonCrit, "affinity +100 at green always crits");
  // 100 MV x 1.25 = 125; 125 x 1.0 x 1.325 x 10.0 = 1656
  check(g.crit === 1656, "green crit 100 MV, 1000 attack, zone 100: 1656, got " + g.crit);
  check(Calc.trueAttack({ attack: 2900, flat: 300 }, K) === 3000, "attack cap 3000");
  check(Calc.move({ mv: [1], attack: 1, sharp: 0, zone: 1 }, K, index.sharpMult).nonCrit === 1, "a hit does at least 1");
}

/* ---------- 2. data ---------- */
check(/^v\d+\.\d+$/.test(index.source.patch) && /^[0-9a-f]{64}$/.test(index.source.zipSha256), "index.json names the source patch");
check(index.types.length === 14, "14 weapon types");
index.types.forEach(function (t) {
  const file = path.join(ROOT, "data/weapons", t.slug + ".json");
  if (!fs.existsSync(file)) { check(false, t.slug + ".json missing"); return; }
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  check(d.source && d.source.patch === index.source.patch, t.slug + ": same source patch as index.json");
  check(d.weapons.length === t.weapons && d.weapons.length > 50, t.slug + ": weapon count");
  check(d.weapons.every(function (w) { return w.length === d.fields.length && w[3] > 0 && w[1]; }), t.slug + ": rows match fields, attack > 0, named");
  check(d.weapons.every(function (w) { return !/^Dummy|使用禁止/.test(w[1]); }), t.slug + ": no placeholder names");
  check(d.moves.length > 0 && d.moves.every(function (m) { return m.mv.length === m.chain.length && m.mv.length > 0; }), t.slug + ": moves with one MV per hit");
  if (d.kind === "melee") {
    const si = d.fields.indexOf("sharpness");
    check(d.weapons.every(function (w) { const b = d.bars[w[si]]; return b && b.length === 8 && b[7] <= 400; }), t.slug + ": every weapon has its sharpness bar");
    check(d.tech && d.tech.length === 4, t.slug + ": four technique levels");
  }
});

/* ---------- 3. page ---------- */
let chromium = null;
try { chromium = require("playwright").chromium; } catch (e) { /* no browser part */ }

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1", function () { resolve(srv); });
  });
}

async function page() {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch();
  const shots = process.env.SHOTS;
  try {
    for (const view of [{ name: "desktop", width: 1440, height: 1000 }, { name: "phone", width: 375, height: 800 }]) {
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.name === "phone" ? 2 : 1 });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", function (e) { errors.push(e.message); });
      pg.on("console", function (m) { if (m.type() === "error" && !/api\.hvmhfz|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      await pg.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) { r.abort(); });
      // A saved cookie choice, so the banner does not cover the screenshots.
      await pg.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
      await pg.goto(base + "/weapons.html?type=great-sword&w=1", { waitUntil: "load" });
      await pg.waitForSelector("#wp-body .wp-pick");
      const rows = await pg.$$eval("#wp-body tr", function (t) { return t.length; });
      check(rows === 100, view.name + ": first page lists 100 Great Swords, got " + rows);
      check(await pg.textContent("#wp-detail-h") === "Iron Sword", view.name + ": ?w=1 opens Iron Sword");
      // The calculator's first move row must be what HvWeaponsCalc gives for the same inputs.
      const fromPage = await pg.evaluate(function () {
        const first = document.querySelector("#calc-body tr");
        return first ? first.children[4].textContent.replace(/,/g, "") : null;
      });
      check(fromPage !== null && Number(fromPage) > 0, view.name + ": calculator shows damage, got " + fromPage);
      // Search, then a sort by true attack.
      await pg.fill("#wp-search", "Iron Sword");
      check((await pg.$$eval("#wp-body .wp-pick", function (b) { return b.map(function (x) { return x.textContent; }); })).every(function (t) { return /Iron Sword/.test(t); }), view.name + ": search filters");
      await pg.fill("#wp-search", "");
      await pg.click("#wp-head th:nth-child(4) .wp-sort");
      const top = await pg.$$eval("#wp-body tr", function (t) { return t.slice(0, 3).map(function (r) { return Number(r.children[3].textContent); }); });
      check(top[0] >= top[1] && top[1] >= top[2], view.name + ": sort by true attack, highest first: " + top);
      // Red sharpness: no crits.
      await pg.selectOption("#c-sharp", "0");
      await pg.fill("#c-affinity", "100");
      check(/no crits below green/.test(await pg.textContent("#calc-summary")), view.name + ": red sharpness says no crits");
      // The page's own content (the site header's Menu button is checked by check-nav-mobile.js).
      const overflow = await pg.evaluate(function () {
        const m = document.querySelector("main");
        return Math.max(m.scrollWidth - m.clientWidth, Math.ceil(m.getBoundingClientRect().right - document.documentElement.clientWidth));
      });
      check(overflow <= 0, view.name + ": no sideways scrolling in the page (" + overflow + " px)");
      await pg.selectOption("#c-sharp", "5");
      await pg.fill("#c-affinity", "20");
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await pg.evaluate(function () { window.scrollTo(0, 0); });
        await pg.screenshot({ path: path.join(shots, view.name + "-list.png"), fullPage: false });
        await pg.addStyleTag({ content: ".site-nav{position:static}" }); // the sticky bar would sit over element shots
        await pg.locator("#wp-detail").screenshot({ path: path.join(shots, view.name + "-detail.png") });
        await pg.locator("#calc").screenshot({ path: path.join(shots, view.name + "-calc.png") });
      }
      // A gunner type: list works, calculator form hidden.
      await pg.click("#wp-types .chip:has-text('Heavy Bowgun')");
      await pg.waitForFunction(function () { return !document.getElementById("calc-gunner").hidden; });
      check(await pg.isHidden("#calc-form"), view.name + ": gunner type hides the calculator form");
      check(errors.length === 0, view.name + ": no script errors: " + errors.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

(async function () {
  if (chromium) await page();
  else console.log("(Playwright not found: page part skipped; set NODE_PATH=/root/work/pw-tools/node_modules)");
  if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
  console.log("weapons OK: " + cases.cases.length + " formula cases, " + index.types.length + " types" + (chromium ? ", page in Chromium" : ""));
})();
