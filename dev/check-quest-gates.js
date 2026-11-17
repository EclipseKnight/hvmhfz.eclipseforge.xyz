#!/usr/bin/env node
/* Checks the Key Quests and Urgent Quests (data/quest-gates.json from dev/make-quest-gates.py) and where the site
   shows them:
   - the data: dev/make-quest-gates.py --check passes; 6 bands, 63 quests, bands HR1-HR5 each with one Urgent Quest
     that unlocks HR 30, 50, 99, 299 and 998, HR6 with 5 Key Quests and no Urgent Quest; every quest is in
     data/quests.json under the same name; the form the site's quest data gives agrees with the lead's list
     (docs/research/2026-11-17-key-urgent-quests.md in the project repo): no gate quest is Zenith, and the Hardcore
     ones are exactly 21 of HR5's 22 Key Quests; data/search/quests.json carries each one's role ("Urgent Quest HR2");
   - in headless Chromium at 375 and 1280 px, with every request leaving the machine aborted:
     quests.html?gate=all lists the 63 by band (a heading row per band, the Urgent Quest first, then the Key Quests),
     each with its badge and the note, keeps ?gate= in the address, its page 2 starts with a band heading;
     ?gate=HR6 lists the 5 Key Quests and says there is no Urgent Quest; Clear filters resets it; a plain search
     (?q=22045) still shows the badge; quest.html?id=22013 (Key) and ?id=21995 (Urgent) show the HR progression
     panel with the right text and links to the band's other gate quests, a quest that is neither shows none;
     database.html?q=key quest hr2&kind=quests finds the 10 Key Quests of HR2; no sideways scrolling, no errors.
   SHOTS=<folder> also saves the catalog filter and a quest page at each width.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-gates.js

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
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const gates = json("data/quest-gates.json");
const quests = new Map(json("data/quests.json").quests.map((q) => [q.id, q]));

function staticChecks() {
  const gen = childProcess.spawnSync("python3", [path.join(root, "dev/make-quest-gates.py"), "--check"], { encoding: "utf8" });
  check(gen.status === 0, (gen.stdout || gen.stderr || "dev/make-quest-gates.py --check failed").trim());
  const ids = Object.keys(gates.quests).map(Number);
  check(ids.length === 63, "data/quest-gates.json: " + ids.length + " quests, not 63");
  check(gates.bands.map((b) => b.label).join() === "HR1,HR2,HR3,HR4,HR5,HR6", "bands are " + gates.bands.map((b) => b.label).join());
  check(gates.bands.map((b) => b.unlocksHr).join() === "30,50,99,299,998,", "Urgent Quests unlock " + gates.bands.map((b) => b.unlocksHr).join());
  check(gates.bands.every((b) => (b.band === 6) === (b.urgent === null)), "only HR6 should have no Urgent Quest");
  check(gates.bands[5].keys.length === 5, "HR6 has " + gates.bands[5].keys.length + " Key Quests, not 5");
  const listed = gates.bands.flatMap((b) => (b.urgent ? [b.urgent] : []).concat(b.keys)).sort().join();
  check(listed === ids.slice().sort().join(), "the bands' lists and the quests differ");
  for (const id of ids) {
    const q = quests.get(id), g = gates.quests[id];
    check(q && q.name === g.name, "quest " + id + ": not in data/quests.json under the name " + g.name);
    check(g.role === "urgent" ? gates.bands[g.band - 1].urgent === id : gates.bands[g.band - 1].keys.includes(id),
      "quest " + id + ": its band does not list it");
  }
  // The form comes from the site's quest data; it must agree with the lead's list (read from the live files).
  const zenith = ids.filter((id) => /Zenith/i.test(quests.get(id).category));
  check(zenith.length === 0, "gate quests the site calls Zenith: " + zenith.join());
  const hardcore = ids.filter((id) => /Hardcore/i.test(quests.get(id).category));
  check(hardcore.length === 21 && hardcore.every((id) => gates.quests[id].band === 5 && gates.quests[id].role === "key"),
    "the site's Hardcore gate quests are " + hardcore.join() + ", not 21 of HR5's Key Quests");
  const search = new Map(json("data/search/quests.json").quests.map((r) => [r[0], r[4]]));
  for (const id of ids) {
    const g = gates.quests[id];
    const want = (g.role === "urgent" ? "Urgent" : "Key") + " Quest HR" + g.band;
    check(search.get(id) === want, "data/search/quests.json: quest " + id + " says " + search.get(id) + ", not " + want);
  }
  check([...search.values()].filter(Boolean).length === 63, "data/search/quests.json: a role on a quest that is not a gate quest");
}

async function main() {
  staticChecks();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const width of [375, 1280]) {
    const tag = width + " px";
    const context = await browser.newContext({ viewport: { width, height: width < 800 ? 812 : 900 }, hasTouch: width < 800 });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const open = async (url) => {
      await page.goto(base + url, { waitUntil: "load" });
    };
    const catalog = async (url) => {
      await open(url);
      await page.waitForFunction(() => /^Page \d+ of/.test(document.getElementById("quest-page").textContent));
      return page.$$eval("#quest-body tr", (trs) => trs.map((tr) => tr.classList.contains("quest-band-row")
        ? { band: tr.textContent }
        : { id: Number(((tr.querySelector("td a") || {}).href || "").split("id=")[1]),
            badge: (tr.querySelector(".quest-gate") || {}).textContent || "" }));
    };
    const noSideways = async (what) => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(wide <= 1, tag + ": " + what + " scrolls sideways by " + wide + "px");
    };

    // ---- the catalog's Progression filter
    let rows = await catalog("/quests.html?gate=all");
    const order = gates.bands.flatMap((b) => [{ band: b.label }].concat((b.urgent ? [b.urgent] : []).concat(b.keys).map((id) => ({ id }))));
    const shown = rows.map((r) => (r.band ? { band: r.band.split(" ")[0] } : { id: r.id }));
    check(JSON.stringify(shown) === JSON.stringify(order.slice(0, shown.length)), tag + ": ?gate=all is not by band, Urgent Quest first: " +
      JSON.stringify(shown.slice(0, 10)));
    check(rows.filter((r) => r.id).length === 40, tag + ": ?gate=all page 1 has " + rows.filter((r) => r.id).length + " quests, not 40");
    check(/63 quests$/.test(await page.textContent("#quest-page")), tag + ": ?gate=all count: " + await page.textContent("#quest-page"));
    check(rows[0].band && rows[0].band.startsWith("HR1 (HR 1): 6 Key Quests, then the Urgent Quest unlocks HR 30 (HR2)."), tag + ": first band row: " + rows[0].band);
    check(rows[1].badge === "Urgent Quest · HR1" && rows[2].badge === "Key Quest · HR1", tag + ": badges " + rows[1].badge + " / " + rows[2].badge);
    check(rows.filter((r) => r.id).every((r) => /^(Key|Urgent) Quest · HR\d$/.test(r.badge)), tag + ": a listed quest without a badge");
    check(await page.inputValue("#quest-gate") === "all", tag + ": the Progression filter is not set from ?gate=all");
    check(await page.isVisible("#quest-gate-note"), tag + ": the note on Key and Urgent Quests is hidden");
    check(!(await page.$eval("#quest-clear", (b) => b.hidden)), tag + ": Clear filters hidden with ?gate=all");
    await noSideways("the catalog");
    if (shots) {
      if (width < 800) await page.$eval(".quest-tools", (n) => window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - 70, behavior: "instant" }));
      await page.screenshot({ path: path.join(shots, "catalog-key-urgent-" + width + ".png"), fullPage: width >= 800 });
      if (width < 800) {
        await page.$eval(".quest-table", (n) => window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - 70, behavior: "instant" }));
        await page.screenshot({ path: path.join(shots, "catalog-key-urgent-" + width + "-table.png") });
      }
    }
    await page.click("#quest-next");
    await page.waitForFunction(() => /^Page 2 of 2/.test(document.getElementById("quest-page").textContent));
    check(await page.$eval("#quest-body tr", (tr) => tr.classList.contains("quest-band-row")), tag + ": page 2 does not start with a band heading");
    check(new URL(page.url()).searchParams.get("gate") === "all" && new URL(page.url()).searchParams.get("page") === "2",
      tag + ": the address lost ?gate= or ?page=: " + page.url());
    await page.click("#quest-clear");
    check(await page.inputValue("#quest-gate") === "" && !new URL(page.url()).searchParams.has("gate"), tag + ": Clear filters left the Progression filter");
    check(await page.isHidden("#quest-gate-note"), tag + ": the note stays after Clear filters");

    rows = await catalog("/quests.html?gate=HR6");
    check(rows.length === 6 && /no Urgent Quest\.$/.test(rows[0].band || "") && rows.slice(1).every((r) => r.badge === "Key Quest · HR6"),
      tag + ": ?gate=HR6: " + JSON.stringify(rows));
    rows = await catalog("/quests.html?gate=zzz");
    check(await page.inputValue("#quest-gate") === "" && rows.length === 40, tag + ": an unknown ?gate= is not ignored");
    rows = await catalog("/quests.html?q=22045");
    check(rows.some((r) => r.id === 22045 && r.badge === "Urgent Quest · HR3"), tag + ": a search does not show the Urgent badge");
    check(!rows.some((r) => r.band), tag + ": a band row without the Progression filter");
    rows = await catalog("/quests.html?q=urgent quest hr5");
    check(rows.length === 1 && rows[0].id === 21995, tag + ": the search \"urgent quest hr5\" finds " + JSON.stringify(rows));

    // ---- the quest page
    await open("/quest.html?id=22013");
    await page.waitForSelector("#hr-gate");
    let text = await page.textContent("#hr-gate");
    check(text.includes("Key Quest for HR1: clear all 6 Key Quests of HR1 (HR 1) to unlock the Urgent Quest " + gates.quests[22030].name +
      ", which raises your HR cap to HR 30 (HR2)."), tag + ": quest 22013 panel: " + text);
    let links = await page.$$eval("#hr-gate a[href^='/quest.html']", (as) => as.map((a) => a.getAttribute("href")));
    check(links.includes("/quest.html?id=22030") && !links.includes("/quest.html?id=22013") &&
      gates.bands[0].keys.filter((id) => id !== 22013).every((id) => links.includes("/quest.html?id=" + id)),
      tag + ": quest 22013 does not link its band's other gate quests: " + links.join());
    check(await page.textContent("#quest-view .page-head .quest-gate") === "Key Quest · HR1", tag + ": no Key badge in the quest's heading");
    await noSideways("quest 22013");
    if (shots) await page.screenshot({ path: path.join(shots, "quest-key-" + width + ".png"), fullPage: true });

    await open("/quest.html?id=21995");
    await page.waitForSelector("#hr-gate");
    text = await page.textContent("#hr-gate");
    check(text.includes("Urgent Quest: unlocks HR 998 (HR6).") && text.includes("all 22 Key Quests of HR5 (HR 100-299)"), tag + ": quest 21995 panel: " + text);
    check(await page.$$eval("#hr-gate .quest-gate-list a", (as) => as.length) === 22, tag + ": quest 21995 does not link the 22 Key Quests");
    if (shots) await page.screenshot({ path: path.join(shots, "quest-urgent-" + width + ".png"), fullPage: true });

    await open("/quest.html?id=54869");
    await page.waitForSelector("#quest-view h1");
    await page.waitForTimeout(200);
    check(await page.$("#hr-gate") === null, tag + ": a quest that is neither Key nor Urgent shows the panel");

    // ---- the Database page's search
    await open("/database.html?q=" + encodeURIComponent("key quest hr2") + "&kind=quests");
    await page.waitForFunction(() => document.querySelectorAll("#db-results .db-hit").length > 0 ||
      /No /.test(document.getElementById("db-status").textContent), null, { timeout: 10000 }).catch(() => {});
    const hits = await page.$$eval("#db-results .db-hit", (as) => as.map((a) => Number(a.getAttribute("href").split("id=")[1])));
    check(hits.length === 10 && gates.bands[1].keys.every((id) => hits.includes(id)), tag + ": Database search \"key quest hr2\" finds " + hits.join());

    check(errors.length === 0, tag + ": page errors: " + errors.join(" | "));
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
  console.log("quest gates OK");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
