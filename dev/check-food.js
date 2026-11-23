#!/usr/bin/env node
/* Checks the Food and Bentos page (food.html, js/food.js, data/food-recipes.json from dev/copy-food-data.py):
   - the data: format 1, the three seasons, every pair of two different normal ingredients once (990), 16 SR bentos
     whose top ingredient sets attack and defence and side one health and stamina, every ingredient an item of the
     site; dev/copy-food-data.py --check (the copy is the same as hvmhfz_re's, when that checkout is here);
   - the Frontier guide's bento tables (guide-frontier-quests-food.html #bentos) say what the data says, use the
     game's ingredient names (no "Spirit Mushrooms", "Pugi Crackers", "Hot Oil", "Millenium" ...), and link the page;
   - the SR tab's "how to get" lines still hold: the Road shop tabs, guild treasure hunts and the daily quest give
     what the page says, and the GCP shop and festival prizes no ingredient;
   - the page is in the Database menu, pages.json, the sitemap and the Database page's tiles and chips;
   - in headless Chromium at 1280 and 390 px: the recommended picks per season (the best all-round bento is the
     guide's: warm Fist Rice + Predator Honey, cold Ancient Beans + Gold Extract, breeding Pepper Bug + Predator
     Honey), the season switch, search (English, Japanese, "A + B"), the stat, Adrenaline and where-to-buy filters,
     the address keeping them over a reload, Show more, item links, the SR grid, the Ingredients tab, no sideways
     scrolling on any tab, no script errors, and the site search's "Food and Bentos" hits.
   SHOTS=<folder> saves each tab at each width.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-food.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
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
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const data = json("data/food-recipes.json");
const ing = new Map(data.ingredients.map((i) => [i.id, i]));
const byName = new Map(data.ingredients.map((i) => [i.en.toLowerCase(), i]));
const SEASONS = ["warm", "cold", "breeding"];
const pairKey = (a, b) => Math.min(a, b) + ":" + Math.max(a, b);
const bentoOf = new Map(data.bentos.map((b) => [pairKey(b.a, b.b), b]));
const sign = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + -n : "–");

function dataChecks() {
  check(data.format === 1, "data: format " + data.format + ", the page reads 1");
  check(data.seasons.map((s) => s.key).join() === SEASONS.join(), "data: seasons are not warm, cold, breeding");
  check(data.seasons.map((s) => s.en).join() === "Warm Season,Cold Season,Breeding Season", "data: season names are not the game's");
  const normal = data.ingredients.filter((i) => !i.sr), sr = data.ingredients.filter((i) => i.sr);
  check(normal.length === 45 && sr.length === 8, "data: " + normal.length + " normal and " + sr.length + " SR ingredients, not 45 and 8");
  check(data.bentos.length === normal.length * (normal.length - 1) / 2 && bentoOf.size === data.bentos.length,
    "data: " + data.bentos.length + " bentos, " + bentoOf.size + " different pairs, for " + normal.length + " ingredients");
  for (const b of data.bentos) {
    if (!(ing.get(b.a) && ing.get(b.b) && !ing.get(b.a).sr && !ing.get(b.b).sr && b.a !== b.b)) { check(false, "data: bad pair " + b.a + "+" + b.b); break; }
    if (!SEASONS.every((s) => b[s] && ["health", "stamina", "attack", "defence"].every((k) => Number.isInteger(b[s][k])))) {
      check(false, "data: bento " + b.a + "+" + b.b + " lacks a season's numbers"); break;
    }
  }
  check(data.sr_bentos.length === 16, "data: " + data.sr_bentos.length + " SR bentos, not 16");
  const tops = {}, sides = {};
  for (const b of data.sr_bentos) {
    const t = b.attack + "/" + b.defence, s = b.health + "/" + b.stamina;
    check(!tops[b.a] || tops[b.a] === t, "data: SR top ingredient " + b.a + " gives different attack/defence (" + tops[b.a] + ", " + t + ")");
    check(!sides[b.b] || sides[b.b] === s, "data: SR side ingredient " + b.b + " gives different health/stamina");
    tops[b.a] = t; sides[b.b] = s;
  }
  check(Object.keys(tops).length === 4 && Object.keys(sides).length === 4, "data: SR bentos are not 4 tops x 4 sides");
  const items = new Set(json("data/items/index.json").items.map((r) => r[0]));
  data.ingredients.forEach((i) => check(items.has(i.id), "data: ingredient " + i.id + " " + i.en + " is not an item of the site"));

  const copy = childProcess.spawnSync("python3", [path.join(root, "dev/copy-food-data.py"), "--check"], { encoding: "utf8" });
  check(copy.status === 0, (copy.stdout || copy.stderr || "dev/copy-food-data.py --check failed").trim());
}

/* The guide's two bento tables: every row's pair and effect, against the data. */
function guideChecks() {
  const html = read("guide-frontier-quests-food.html");
  const sec = html.slice(html.indexOf('<section id="bentos">'), html.indexOf("</section>", html.indexOf('<section id="bentos">')));
  check(sec.includes('href="/food.html"'), "guide: the Bentos section does not link /food.html");
  for (const old of ["Spirit Mushroom", "Frost Tomato", "Pugi Cracker", "Hot Oil", "Ancient Bean,", "Ancient Bean ", "Millenium", "Great Puffer", "Dragon Filet"]) {
    check(!sec.includes(old), "guide: the Bentos section still says \"" + old + "\"");
  }
  const combos = sec.slice(sec.indexOf('id="bento-combinations"'), sec.indexOf('id="bento-ingredients"'));
  let season = null, rows = 0;
  for (const m of combos.matchAll(/<tr>(.*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").replace(/&minus;/g, "−"));
    if (cells.length === 3) season = cells.shift();
    if (cells.length !== 2) continue;
    rows++;
    const seasons = season.toLowerCase().split(/ or /).map((s) => s.trim());
    const names = cells[0].split("+").map((s) => s.trim().toLowerCase());
    const a = byName.get(names[0]), b = byName.get(names[1]);
    if (!a || !b) { check(false, "guide: \"" + cells[0] + "\" names an ingredient the data does not have"); continue; }
    const bento = bentoOf.get(pairKey(a.id, b.id));
    const said = { health: 0, stamina: 0, attack: 0, defence: 0 };
    const effect = cells[1].split(":")[0];
    for (const e of effect.matchAll(/([+−-]\d+)\s*(HP|Stamina|Attack|Defense)/g)) {
      said[{ HP: "health", Stamina: "stamina", Attack: "attack", Defense: "defence" }[e[2]]] = Number(e[1].replace("−", "-"));
    }
    const small = /Small Attack \(\+(\d+)\)/.exec(effect);
    if (small) said.attack = Number(small[1]);
    for (const s of seasons) {
      const v = bento && bento[s];
      check(v && ["health", "stamina", "attack", "defence"].every((k) => v[k] === said[k]),
        "guide: " + season + " " + cells[0] + " says " + JSON.stringify(said) + ", the game gives " + JSON.stringify(v));
    }
  }
  check(rows === 11, "guide: read " + rows + " bento rows, expected 11");
  const fix = bentoOf.get(pairKey(byName.get("fist rice").id, byName.get("gold extract").id));
  check(fix.breeding.health === -40 && fix.breeding.attack === -5, "data: Fist Rice + Gold Extract in breeding is not -40 health, -5 attack");
}

/* What the SR tab says about getting SR ingredients. */
function srSourceChecks() {
  const has = (src, ids) => {
    const rows = new Set(json("data/sources/" + src + ".json").rows.map((r) => r.item));
    ids.forEach((id) => check(rows.has(id), "SR tab: source " + src + " no longer has item " + id + " (" + ing.get(id).en + ")"));
  };
  has("road-shop-5", [5763, 5764, 5765, 5766]);
  has("road-shop-8", [5765, 5767, 5768]);
  has("guild-treasure-0", [5763, 5764, 5765, 5766]);
  const q = json("data/quests/rewards/22.json").quests["22163"];
  const rewarded = new Set((q ? q.rewards : []).flatMap((g) => g.items.map((i) => i[0])));
  data.ingredients.filter((i) => i.sr).forEach((i) => check(rewarded.has(i.id), "SR tab: quest 22163 does not reward " + i.en));
  for (const src of ["gcp-item-shop", "festa-personal", "festa-guild"]) {
    const rows = json("data/sources/" + src + ".json").rows.filter((r) => ing.has(r.item));
    check(rows.length === 0, "SR tab: " + src + " sells a bento ingredient now: " + rows.map((r) => r.item).join());
  }
  const page = read("food.html");
  check(page.includes("/quest.html?id=22163") && page.includes("/source.html?id=road-shop-5") && page.includes("/source.html?id=road-shop-8"),
    "food.html: the SR tab's source links are missing");
}

function siteChecks() {
  check(read("dev/shell/nav.html").includes('<a class="navlink" href="/food.html">Food and Bentos</a>'), "nav: no Food and Bentos in the Database menu");
  check(json("dev/shell/pages.json").some((p) => p.page === "food.html" && p.group === "Database"), "pages.json: no food.html in Database");
  check(read("sitemap.xml").includes("/food.html</loc>"), "sitemap: no food.html");
  const db = read("database.html");
  check(db.includes('href="/food.html"') && db.includes('data-kind="food"'), "database.html: no Food and Bentos tile or chip");
}

async function main() {
  dataChecks();
  guideChecks();
  srSourceChecks();
  siteChecks();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const best = { warm: ["Fist Rice", "Predator Honey"], cold: ["Ancient Beans", "Gold Extract"], breeding: ["Pepper Bug", "Predator Honey"] };

  for (const width of [1280, 390]) {
    const tag = width + " px";
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 800 });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    const rows = () => page.$$eval(".food-table tbody tr", (trs) => trs.map((tr) => ({
      dish: tr.querySelector(".food-dish-en").textContent,
      ings: [...tr.querySelectorAll(".food-ing span")].map((s) => s.textContent),
      hrefs: [...tr.querySelectorAll("a.food-ing")].map((a) => a.getAttribute("href")),
      where: [...tr.querySelectorAll(".food-where")].map((s) => s.textContent),
      stats: [...tr.querySelectorAll(".food-stat")].map((td) => td.textContent)
    })));
    const ready = () => page.waitForSelector(".food-table tbody tr, #food-view .empty-state");
    const noSideways = async (what) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      tag + ": " + what + " scrolls sideways");

    await page.goto(base + "/food.html#bentos", { waitUntil: "load" });
    await ready();
    check(await page.$eval(".breadcrumbs ol", (o) => o.textContent) === "HomeDatabaseFood and Bentos", tag + ": crumbs Home › Database › Food and Bentos");
    check(await page.textContent("#food-count") === "990 bentos in the Warm Season", tag + ": count says " + await page.textContent("#food-count"));
    let r = await rows();
    check(r.length === 50, tag + ": " + r.length + " rows at first, not 50");
    check(r[0].ings.join(" + ") === "Fist Rice + Predator Honey" && r[0].stats.join(" ") === "+50 +25 +5 –",
      tag + ": the best warm bento is " + JSON.stringify(r[0]));
    check(r.every((x) => x.hrefs.every((h) => /^\/item\.html\?id=\d+$/.test(h))), tag + ": an ingredient does not link its item page");
    const svgIcons = await page.$$eval(".food-table img.food-icon", (imgs) => imgs.length);
    check(svgIcons >= 90, tag + ": only " + svgIcons + " ingredient icons in the table");
    await noSideways("the Bentos tab");
    if (shots) await page.screenshot({ path: path.join(shots, "food-bentos-" + width + ".png"), fullPage: true });

    for (const s of SEASONS) {
      await page.click('#food-seasons .chip[data-season="' + s + '"]');
      await ready();
      const card = await page.$eval("#food-rec .food-card", (c) => [...c.querySelectorAll(".food-card-pair .food-ing span")].map((x) => x.textContent));
      check(card.join(" + ") === best[s].join(" + "), tag + ": " + s + " all round pick is " + card.join(" + "));
      check(await page.$$eval("#food-rec .food-card", (c) => c.length) === 4, tag + ": " + s + ": not 4 recommended cards");
      const adr = await page.$eval("#food-rec .food-card:last-child .food-badge", (b) => b.textContent);
      check(/^Health −/.test(adr), tag + ": " + s + " Adrenaline pick does not lower health: " + adr);
      check((new URL(page.url()).searchParams.get("season") || "warm") === s, tag + ": ?season= is not " + s);
    }

    // breeding is on: one pair by "A + B"
    await page.fill("#food-q", "Fist Rice + Gold Extract");
    await page.waitForFunction(() => document.querySelectorAll(".food-table tbody tr").length === 1).catch(() => {});
    r = await rows();
    check(r.length === 1 && r[0].stats.join(" ") === "−40 – −5 –", tag + ": breeding Fist Rice + Gold Extract: " + JSON.stringify(r));
    await page.reload({ waitUntil: "load" });
    await ready();
    check(await page.inputValue("#food-q") === "Fist Rice + Gold Extract" && (await rows()).length === 1 &&
      await page.getAttribute('#food-seasons .chip[data-season="breeding"]', "aria-pressed") === "true", tag + ": a reload loses the season or search");

    // Japanese name: every pair with Fist Rice (44)
    await page.click("#food-reset");
    await page.click('#food-seasons .chip[data-season="warm"]');
    await page.fill("#food-q", "ゲンコツ米");
    await page.waitForFunction(() => /^44 of/.test(document.getElementById("food-count").textContent)).catch(() => {});
    check(/^44 of 990/.test(await page.textContent("#food-count")), tag + ": ゲンコツ米 finds " + await page.textContent("#food-count"));
    r = await rows();
    check(r.every((x) => x.ings.includes("Fist Rice")), tag + ": ゲンコツ米 finds a pair without Fist Rice");

    // Adrenaline: health lowered, best first
    await page.click("#food-reset");
    await page.selectOption("#food-health", "down");
    await ready();
    r = await rows();
    check(r.length > 0 && r.every((x) => x.stats[0].startsWith("−")), tag + ": Health Lowered shows a row without lowered health");
    check(r[0].ings.join(" + ") === "Poogie Crackers + Fist Rice" || r[0].ings.join(" + ") === "Fist Rice + Poogie Crackers",
      tag + ": the best warm Adrenaline bento is " + r[0].ings.join(" + "));
    check(new URL(page.url()).searchParams.get("health") === "down", tag + ": ?health=down not in the address");

    // at least +50 health and +50 stamina
    await page.click("#food-reset");
    await page.selectOption("#food-health", "min50");
    await page.selectOption("#food-stamina", "min50");
    await ready();
    r = await rows();
    const fiftyFifty = data.bentos.filter((b) => b.warm.health >= 50 && b.warm.stamina >= 50).length;
    check(r.length === fiftyFifty && r.every((x) => x.stats[0] === "+50" && x.stats[1] === "+50"), tag + ": +50/+50 shows " + r.length + ", data has " + fiftyFifty);

    // where to buy
    await page.click("#food-reset");
    await page.selectOption("#food-buy", "food");
    await ready();
    r = await rows();
    check(r.length && r.every((x) => x.where.every((w) => w === "Food shop")), tag + ": 'food shop every day' shows another shop");
    await page.selectOption("#food-buy", "noshop");
    await ready();
    r = await rows();
    check(r.length && r.every((x) => x.where.includes("No shop")), tag + ": 'no shop' shows a pair both from shops");

    // Show more
    await page.click("#food-reset");
    await ready();
    await page.click(".food-more button");
    check((await rows()).length === 100, tag + ": Show 50 more does not show 100");
    check(await page.evaluate(() => location.search) === "", tag + ": Clear filters leaves " + await page.evaluate(() => location.search));

    // SR tab
    await page.click("#tab-sr");
    await page.waitForSelector(".food-sr-cell");
    const cells = await page.$$eval(".food-sr-cell .food-dish-en", (c) => c.map((x) => x.textContent));
    check(cells.length === 16 && cells[0] === "Starburst Risotto", tag + ": SR grid has " + cells.length + " dishes, first " + cells[0]);
    check(await page.isVisible("#sr-ingredients"), tag + ": no 'how to get SR ingredients' on the SR tab");
    await noSideways("the SR tab");
    if (shots) await page.screenshot({ path: path.join(shots, "food-sr-" + width + ".png"), fullPage: true });

    await page.click("#tab-ingredients");
    await page.waitForSelector(".food-ing-table tbody tr");
    check(await page.$$eval(".food-ing-table tbody tr", (t) => t.length) === 53, tag + ": the Ingredients tab does not list 53");
    const goHref = await page.$eval(".food-ing-table tbody tr a[href^='/food.html']", (a) => a.getAttribute("href"));
    check(/^\/food\.html\?q=[^#]+#bentos$/.test(goHref), tag + ": 'Bentos with it' links " + goHref);
    const shown = await page.textContent("#panel-ingredients");
    check(!/mhfdat|0x[0-9a-f]{3}|unlisted/.test(shown), tag + ": internal words on the Ingredients tab");
    await noSideways("the Ingredients tab");
    if (shots) await page.screenshot({ path: path.join(shots, "food-ingredients-" + width + ".png"), fullPage: true });

    await page.click("#tab-how");
    await noSideways("the How it works tab");
    if (shots) await page.screenshot({ path: path.join(shots, "food-how-" + width + ".png"), fullPage: true });

    // A guide link to the SR how-to opens its tab
    await page.goto(base + "/food.html#sr-ingredients", { waitUntil: "load" });
    await page.waitForSelector(".food-sr-cell");
    check(await page.isVisible("#sr-ingredients"), tag + ": /food.html#sr-ingredients does not open the SR tab");

    // The site search
    const hits = await page.evaluate(async () => {
      await window.HvSearch.load("food");
      return ["fist rice", "starburst", "bento", "ゲンコツ"].map((q) => window.HvSearch.find("food", q, 3).rows.map((x) => x.href));
    });
    check(hits[0][0] === "/food.html?q=Fist%20Rice#bentos", tag + ": search 'fist rice' gives " + hits[0][0]);
    check(hits[1][0] === "/food.html#sr", tag + ": search 'starburst' gives " + hits[1][0]);
    check(hits[2][0] === "/food.html", tag + ": search 'bento' gives " + hits[2][0]);
    check(hits[3].length > 0, tag + ": search 'ゲンコツ' finds nothing");

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
  console.log("food OK");
}).catch((e) => { console.error(e); process.exit(1); });
