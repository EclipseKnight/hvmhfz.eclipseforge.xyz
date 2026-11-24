#!/usr/bin/env node
/* Checks the quests' ranks and forms (data/quests.json "rank", "rankNeed", "form" from dev/make-quest-ranks.py,
   read from the quest files) and the quest catalog's Rank and Form filters:
   - the data: make-quest-ranks.py apply --check passes; every quest has a rank from the game's list (no
     "Unranked"); every Key and Urgent Quest (data/quest-gates.json) is in its own HR band; a table of quests
     checked by hand against their files (class, body+0x04, body+0x4e, condition note, monster variants);
   - in headless Chromium at 375 and 1280 px, with every request leaving the machine aborted: the Rank filter lists
     HR1-HR7 (with the site's HR labels), G★1-8, Zenith★1-4 and the ranks of quests without one, grouped and in
     the game's order; each option lists as many quests as the data has; the Form filter; Rank HR2 + Progression
     "Key & Urgent quests" lists the 11 HR2 gate quests; old links (?rank=Zenith, ?rank=Supremacy, ?rank=G★7)
     still filter; each row and the quest page show the rank line; no sideways scrolling, no page errors.
   SHOTS=<folder> also saves the opened Rank list and a filtered list at each width.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-ranks.js

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

const quests = json("data/quests.json").quests;
const byId = new Map(quests.map((q) => [q.id, q]));
const gates = json("data/quest-gates.json");

const GROUPS = [
  ["Hunter Rank", ["HR1 (HR 1)", "HR2 (HR 2-30)", "HR3 (HR 31-50)", "HR4 (HR 51-99)", "HR5 (HR 100-299)", "HR6 (HR 300-998)", "HR7 (HR 999)"]],
  ["G Rank", ["G★1", "G★2", "G★3", "G★4", "G★5", "G★6", "G★7", "G★8"]],
  ["Zenith", ["Zenith★1", "Zenith★2", "Zenith★3", "Zenith★4"]],
  ["No rank", ["Practice", "Greetings", "Hunting Road"]]
];
const RANKS = GROUPS.flatMap((g) => g[1].map((label) => label.replace(/ \(HR [\d-]+\)$/, "")));
const FORMS = ["Zenith", "Supremacy", "Hardcore", "Musou"];

/* Read by hand from the quest files (hunsterverse, 2026-11-17, the GRP quests 2026-11-24; class header+0x5c, body+0x04, body+0x4e, condition
   note body+0x2c, variants body+0x91..): id -> [rank, rankNeed, form]. */
const SPOT = {
  22013: ["HR1", "HR 1", undefined],          // Key HR1: class 0, need 1
  22030: ["HR1", "HR 1", undefined],          // Urgent HR1
  21974: ["HR2", "HR 30", undefined],         // Urgent HR2: class 1
  26215: ["HR2", "HR 5", undefined],          // Key HR2: class 0, need 5
  22039: ["HR3", "HR 41", undefined],         // Key HR3: class 1
  21976: ["HR4", "HR 99", undefined],         // Urgent HR4: class 3
  21707: ["HR5", "HR 100", "Hardcore"],       // Key HR5: class 3, note 109
  21995: ["HR5", "HR 299", "Supremacy"],      // Urgent HR5: class 3, variant 9
  21984: ["HR6", "HR 300", "Supremacy"],      // Key HR6: class 3, variant 9
  22029: ["HR7", "HR 999", undefined],        // "Beyond the Peak [HR7]": class 3, need 999
  21334: ["HR4", "HR 91", undefined],         // class 1, need 91
  63189: ["HR2", "HR 22", undefined],         // class 0 "[Low Rank]", need 22
  21168: ["HR5", "HR 100", undefined],        // "Hardcore Test": class 3, note 114 (not Hardcore by the file)
  62735: ["HR6", "HR 300", "Hardcore"],       // class 3, note 111, variant 9
  23253: ["G★1", "GR 1", undefined],          // class 7, body+0x04 1, in the client's G★1 list
  23493: ["G★8", "GR 100", undefined],        // class 7, body+0x04 8
  55935: ["G★7", "GR 1", "Musou"],            // class 7, variant 11
  54925: ["G★8", "GR 500", "Musou"],          // class 7, variant 11
  40236: ["Zenith★1", "GR 900", "Zenith"],    // class 9, variant 16; a GRP quest: GR 900 (24 Nov, hvmhfz_re part 263)
  23469: ["Zenith★2", "GR 500", "Zenith"],    // GR 300/500/700/900 since 17 Nov (part 224)
  23470: ["Zenith★3", "GR 700", "Zenith"],
  23471: ["Zenith★4", "GR 900", "Zenith"],
  23352: ["G★1", "GR 900", undefined],        // GRP quests need GR 900 (24 Nov, part 263): built-in "GRP Bonanza ★1"
  55002: ["G★3", "GR 900", undefined],        // event list "Mega GRP: Gogomoa", was GR 1
  101: ["Practice", undefined, undefined],    // class 2, need 0
  50748: ["Greetings", "HR 100", undefined],  // class 5
  21729: ["Hunting Road", "HR 1", undefined], // class 8
  1: ["HR1", undefined, undefined]            // class 0, need 0
};

function staticChecks() {
  try {
    childProcess.execFileSync("python3", [path.join(root, "dev/make-quest-ranks.py"), "apply", "--check"], { stdio: "pipe" });
  } catch (e) {
    check(false, "make-quest-ranks.py apply --check: " + String(e.stdout || e.message).trim());
  }
  const bad = quests.filter((q) => !RANKS.includes(q.rank));
  check(bad.length === 0, bad.length + " quests without a rank of the list, e.g. " + bad.slice(0, 5).map((q) => q.id + " " + q.rank).join());
  const badForm = quests.filter((q) => q.form !== undefined && !FORMS.includes(q.form));
  check(badForm.length === 0, "unknown forms: " + badForm.slice(0, 5).map((q) => q.id + " " + q.form).join());
  for (const [id, g] of Object.entries(gates.quests)) {
    const q = byId.get(Number(id));
    check(q && q.rank === "HR" + g.band, "gate quest " + id + " (" + g.role + " HR" + g.band + ") has rank " + (q && q.rank));
  }
  const hr2 = quests.filter((q) => q.rank === "HR2" && gates.quests[q.id]);
  check(hr2.length === 11, "HR2 gate quests: " + hr2.length + ", not 11");
  for (const [id, want] of Object.entries(SPOT)) {
    const q = byId.get(Number(id));
    const got = q ? [q.rank, q.rankNeed, q.form] : [];
    check(JSON.stringify(got) === JSON.stringify(want), "quest " + id + ": " + JSON.stringify(got) + ", not " + JSON.stringify(want));
  }
}

async function main() {
  staticChecks();
  const counts = {};
  quests.forEach((q) => { counts[q.rank] = (counts[q.rank] || 0) + 1; if (q.form) counts["form:" + q.form] = (counts["form:" + q.form] || 0) + 1; });
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
    const settled = () => page.waitForFunction(() => /^Page \d+ of/.test(document.getElementById("quest-page").textContent));
    const catalog = async (url) => { await page.goto(base + url, { waitUntil: "load" }); await settled(); };
    const count = async () => Number((await page.textContent("#quest-page")).split("·")[1].replace(/[^\d]/g, ""));
    const noSideways = async (what) => {
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(wide <= 1, tag + ": " + what + " scrolls sideways by " + wide + "px");
    };

    // ---- the Rank and Form filters' options
    await catalog("/quests.html");
    const groups = await page.$$eval("#quest-rank optgroup", (gs) => gs.map((g) => [g.label, [...g.children].map((o) => o.textContent)]));
    check(JSON.stringify(groups) === JSON.stringify(GROUPS), tag + ": Rank options are " + JSON.stringify(groups));
    const forms = await page.$$eval("#quest-form option", (os) => os.map((o) => o.value).filter(Boolean));
    check(forms.join() === FORMS.join(), tag + ": Form options are " + forms.join());
    for (const rank of RANKS) {
      await page.selectOption("#quest-rank", rank);
      check(await count() === counts[rank], tag + ": rank " + rank + " lists " + await count() + ", not " + counts[rank]);
      check(new URL(page.url()).searchParams.get("rank") === rank, tag + ": ?rank= is not " + rank);
    }
    await page.selectOption("#quest-rank", { index: 0 });
    for (const form of FORMS) {
      await page.selectOption("#quest-form", form);
      check(await count() === counts["form:" + form], tag + ": form " + form + " lists " + await count());
    }
    await page.selectOption("#quest-form", { index: 0 });
    if (shots) { // a select's list is not drawn in screenshots: show it opened as a list box for the picture
      await page.$eval("#quest-rank", (s) => { s.size = s.options.length + s.querySelectorAll("optgroup").length; s.style.height = "auto"; });
      await page.$eval(".quest-tools", (n) => window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - 70, behavior: "instant" }));
      await page.screenshot({ path: path.join(shots, "rank-options-" + width + ".png") });
      await page.$eval("#quest-rank", (s) => { s.size = 0; s.style.height = ""; });
    }

    // ---- Rank + Progression
    await page.selectOption("#quest-rank", "HR2");
    await page.selectOption("#quest-gate", "all");
    const ids = await page.$$eval("#quest-body tr:not(.quest-band-row) td.cell-name > a", (as) => as.map((a) => Number(a.href.split("id=")[1])));
    const want = [gates.bands[1].urgent].concat(gates.bands[1].keys);
    check(await count() === 11 && JSON.stringify(ids) === JSON.stringify(want), tag + ": HR2 + Key & Urgent lists " + ids.join());
    const lines = await page.$$eval("#quest-body .quest-rank", (ns) => ns.map((n) => n.textContent));
    check(lines.length === 11 && lines.every((t) => /^HR2 · needs HR \d+$/.test(t)), tag + ": rank lines " + lines.join(" | "));
    await noSideways("HR2 + Key & Urgent");
    if (shots) {
      await page.$eval(width < 800 ? ".quest-table" : ".quest-tools", (n) => window.scrollTo({ top: n.getBoundingClientRect().top + window.scrollY - 70, behavior: "instant" }));
      await page.screenshot({ path: path.join(shots, "hr2-key-urgent-" + width + ".png"), fullPage: width >= 800 });
    }

    // ---- old links
    await catalog("/quests.html?rank=Supremacy");
    check(await page.inputValue("#quest-form") === "Supremacy" && await count() === counts["form:Supremacy"], tag + ": ?rank=Supremacy");
    await catalog("/quests.html?rank=Zenith");
    check(await page.inputValue("#quest-form") === "Zenith" && await count() === counts["form:Zenith"], tag + ": ?rank=Zenith");
    await catalog("/quests.html?rank=" + encodeURIComponent("G★7"));
    check(await page.inputValue("#quest-rank") === "G★7" && await count() === counts["G★7"], tag + ": ?rank=G★7");
    await catalog("/quests.html?q=22039");
    check(await page.textContent("#quest-body .quest-rank") === "HR3 · needs HR 41", tag + ": quest 22039's row: " + await page.textContent("#quest-body .quest-rank"));
    await catalog("/quests.html?q=40236");
    check(await page.textContent("#quest-body .quest-rank") === "Zenith★1 · needs GR 900", tag + ": quest 40236's row: " + await page.textContent("#quest-body .quest-rank"));
    await noSideways("the catalog");

    // ---- the quest page
    await page.goto(base + "/quest.html?id=21707", { waitUntil: "load" });
    await page.waitForSelector(".quest-facts");
    const rankRow = await page.$$eval(".quest-facts tr", (trs) => trs.filter((tr) => tr.querySelector("th").textContent === "Rank")
      .map((tr) => [tr.querySelector("td").textContent, tr.querySelector("td a").getAttribute("href")]));
    check(JSON.stringify(rankRow) === JSON.stringify([["HR5 · needs HR 100 · Hardcore", "/quests.html?rank=HR5"]]), tag + ": quest 21707's Rank row: " + JSON.stringify(rankRow));
    await noSideways("quest 21707");
    if (shots) await page.screenshot({ path: path.join(shots, "quest-21707-" + width + ".png"), fullPage: true });

    check(errors.length === 0, tag + ": page errors: " + errors.join(" | "));
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(RANKS.map((r) => r + " " + counts[r]).join(", ") + "; forms " + FORMS.map((f) => f + " " + counts["form:" + f]).join(", "));
}

main().then(() => {
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL " + p));
    process.exit(1);
  }
  console.log("quest ranks OK");
}).catch((e) => {
  console.log("FAIL " + e.stack);
  process.exit(1);
});
