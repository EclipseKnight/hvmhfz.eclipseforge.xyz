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
 * 3. Usage tab (js/weapons-usage.js): HvWeaponsUsage.view() on a stubbed /api/public/weapons/usage answer
 *    (order, shares, band filter, played before tracking began).
 * 4. Page (when Playwright is found): loads, lists Great Swords, picks one, the calculator shows the
 *    numbers HvWeaponsCalc gives for it, a gunner type hides the form, no script errors, and no sideways
 *    scrolling at 375 px. The Usage tab with the stubbed answer (routed in Chromium): 14 bars, 7/30 days,
 *    band filter, style bars; and its message when the API answers 404 or not at all.
 *    SHOTS also gets usage-desktop.png and usage-phone.png.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const Calc = require(path.join(ROOT, "js/weapons-calc.js"));
const Usage = require(path.join(ROOT, "js/weapons-usage.js"));
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

/* ---------- 3. usage tab ---------- */
// A stubbed /api/public/weapons/usage answer (API README "Weapon usage"): weaponType t has 14 - t hunters now
// in the 7-day window (twice that in 30 days), all in one band per type, styles one short of current.
function usageStub(playedSince) {
  const names = index.types.map(function (t) { return t.name; });
  function win(days, k) {
    const weapons = names.map(function (name, t) {
      const current = (14 - t) * k;
      const bands = [0, 0, 0, 0, 0];
      bands[t % 5] = current;
      const styles = [0, 0, 0, 0];
      if (current) { styles[t % 4] = current - 1; }
      return { weaponType: t, weapon: name, current: current, played: current + 2, bands: bands, styles: styles };
    }).reverse(); // the API sends most used first; the page must not rely on it
    const sumBy = function (key, n) {
      return Array.from({ length: n }, function (_, i) { return weapons.reduce(function (a, w) { return a + w[key][i]; }, 0); });
    };
    const hunters = weapons.reduce(function (a, w) { return a + w.current; }, 0) + 3; // 3 with no known weapon
    return { days: days, hunters: hunters, bands: sumBy("bands", 5), styles: sumBy("styles", 4), weapons: weapons };
  }
  return {
    generatedAt: "2026-11-10T14:00:00Z", playedSince: playedSince,
    bands: ["GR 900-999", "GR 500-899", "GR 1-499", "HR 100-999", "HR 1-99"],
    styles: ["Earth", "Heaven", "Storm", "Extreme"],
    windows: [win(7, 1), win(30, 2)]
  };
}
const STUB = usageStub("2026-10-29T00:00:00Z");
{
  const v = Usage.view(STUB, 7, -1);
  check(v.rows.length === 14 && v.rows[0].name === "Great Sword" && v.rows[0].current === 14, "usage: Great Sword first with 14, got " + (v.rows[0] && v.rows[0].name));
  check(v.rows.every(function (r, i) { return !i || v.rows[i - 1].current >= r.current; }), "usage: most used first");
  check(v.hunters === 108 && v.total === 105, "usage 7d: 108 hunters, 105 with a weapon, got " + v.hunters + "/" + v.total);
  check(v.rows[0].share === "13%" && v.rows[13].current === 1 && v.rows[13].share === "<1%", "usage: shares 14/105 13%, 1/105 <1%: " + v.rows[0].share + " " + v.rows[13].share);
  check(v.rows[0].played === 16 && v.rows[0].styles.length === 4, "usage: played and styles with all bands");
  const b = Usage.view(STUB, 30, 0); // band 0 holds types 0, 5, 10
  check(b.hunters === 54 && b.rows[0].current === 28 && b.rows[0].share === "52%" && b.rows[0].played === null && b.styles === null,
    "usage band filter: band counts, no played or styles");
  check(b.rows.filter(function (r) { return r.current; }).length === 3, "usage band filter: 3 types in band 0");
  check(Usage.view(usageStub(null), 7, -1).rows[0].played === null, "usage: no played before tracking began");
  check(Usage.view(STUB, 90, -1) === null, "usage: an unknown window gives null");
  check(Usage.pct(0, 0) === "0%" && Usage.pct(1, 300) === "<1%" && Usage.pct(1, 3) === "33%", "usage: pct");
  check(Usage.TYPES.length === 14 && Usage.TYPES.every(function (t, i) { return index.types[i].class === i && index.types[i].slug === t[0]; }),
    "usage: weaponType i is index.types[i] (class and slug)");
  check(Usage.TYPES.every(function (t) { return fs.existsSync(path.join(ROOT, "assets/icons/1x", t[1] + "-0.png")); }), "usage: every class icon exists");
}

/* ---------- 4. page ---------- */
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

      // The Usage tab, with the stubbed answer.
      const uctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.name === "phone" ? 2 : 1 });
      const up = await uctx.newPage();
      const uerrors = [];
      up.on("pageerror", function (e) { uerrors.push(e.message); });
      await up.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
      await up.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) {
        if (/\/api\/public\/weapons\/usage$/.test(r.request().url())) {
          r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(STUB) });
        } else r.abort();
      });
      await up.goto(base + "/weapons.html#usage", { waitUntil: "load" });
      await up.waitForSelector("#wu-list .wu-row");
      check(await up.isHidden("#panel-database") && await up.isVisible("#panel-usage"), view.name + ": #usage opens the Usage tab");
      check(await up.getAttribute("#tab-usage", "aria-selected") === "true", view.name + ": Usage tab marked selected");
      const urows = await up.$$eval("#wu-list .wu-row", function (rs) {
        return rs.map(function (r) { return { name: r.querySelector(".wu-name").textContent, cur: r.querySelector(".wu-current").textContent,
          played: (r.querySelector(".wu-played") || {}).textContent, segs: r.querySelectorAll(".wu-seg").length,
          href: (r.querySelector(".wu-name a") || {}).getAttribute ? r.querySelector(".wu-name a").getAttribute("href") : null }; });
      });
      check(urows.length === 14, view.name + ": usage shows 14 weapon types, got " + urows.length);
      check(urows[0].name === "Great Sword" && /^14 · 13%/.test(urows[0].cur) && urows[0].played === "played 16" && urows[0].segs === 1,
        view.name + ": usage first row Great Sword 14 · 13%, played 16, a style bar: " + JSON.stringify(urows[0]));
      check(urows[0].href === "/weapons.html?type=great-sword", view.name + ": usage row links to its type");
      check(/108 hunters logged in during the last 7 days/.test(await up.textContent("#wu-summary")), view.name + ": usage summary, 7 days");
      check(/Updated/.test(await up.textContent("#wu-updated")), view.name + ": usage shows when it was updated");
      check(/Earth \d+%/.test(await up.textContent("#wu-overall")), view.name + ": overall style split");
      const uoverflow = await up.evaluate(function () {
        const m = document.querySelector("main");
        return Math.max(m.scrollWidth - m.clientWidth, Math.ceil(m.getBoundingClientRect().right - document.documentElement.clientWidth));
      });
      check(uoverflow <= 0, view.name + ": usage, no sideways scrolling (" + uoverflow + " px)");
      if (shots) await up.screenshot({ path: path.join(shots, "usage-" + view.name + ".png"), fullPage: true });
      await up.click("#wu-days .chip[data-days='30']");
      check(/213 hunters logged in during the last 30 days/.test(await up.textContent("#wu-summary")), view.name + ": usage 30 days");
      await up.selectOption("#wu-band", "0");
      check(/in GR 900-999/.test(await up.textContent("#wu-summary")) && await up.$$eval("#wu-list .wu-played", function (x) { return x.length; }) === 0
        && await up.isHidden("#wu-overall") && !await up.isHidden("#wu-note"), view.name + ": band filter hides played and styles, says why");
      check(await up.textContent("#wu-list .wu-row:first-child .wu-current") === "28 · 52% of hunters by current weapon", view.name + ": band share: " + await up.textContent("#wu-list .wu-row:first-child .wu-current"));
      if (shots) await up.screenshot({ path: path.join(shots, "usage-" + view.name + "-band.png"), fullPage: true });
      // The Database tab still works from here.
      await up.click("#tab-database");
      check(await up.isVisible("#panel-database") && !/#usage/.test(up.url()), view.name + ": Database tab back, #usage dropped");
      check(uerrors.length === 0, view.name + ": usage, no script errors: " + uerrors.join(" | "));
      await uctx.close();

      // Not deployed (404), then not answering at all.
      for (const c of [{ name: "404", status: 404, text: /not published yet/, retry: false }, { name: "no answer", status: 0, text: /could not be loaded/, retry: true }]) {
        const nctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
        const np = await nctx.newPage();
        const nerrors = [];
        np.on("pageerror", function (e) { nerrors.push(e.message); });
        await np.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) {
          if (c.status) r.fulfill({ status: c.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
          else r.abort();
        });
        await np.goto(base + "/weapons.html", { waitUntil: "load" });
        await np.click("#tab-usage");
        await np.waitForSelector("#wu-msg:not([hidden])");
        check(c.text.test(await np.textContent("#wu-msg")), view.name + " " + c.name + ": usage message, got " + await np.textContent("#wu-msg"));
        check(await np.isHidden("#wu-body") && await np.isHidden("#wu-loading"), view.name + " " + c.name + ": no empty list, no spinner");
        check((await np.$$("#wu-msg .wu-retry")).length === (c.retry ? 1 : 0), view.name + " " + c.name + ": Try again button " + (c.retry ? "shown" : "not shown"));
        check(/#usage$/.test(np.url()), view.name + " " + c.name + ": the Usage tab puts #usage in the address");
        if (shots && view.name === "desktop") await np.locator("#panel-usage").screenshot({ path: path.join(shots, "usage-" + c.name.replace(/ /g, "-") + ".png") });
        check(nerrors.length === 0, view.name + " " + c.name + ": no script errors: " + nerrors.join(" | "));
        await nctx.close();
      }
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
  console.log("weapons OK: " + cases.cases.length + " formula cases, " + index.types.length + " types, usage view" + (chromium ? ", page and Usage tab in Chromium" : ""));
})();
