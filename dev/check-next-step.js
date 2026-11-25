#!/usr/bin/env node
/* Checks "Your next step" on the account page (js/account-next-step.js) and the progression guide page
   (guide-frontier-progression.html) in headless Chromium, the account page against a fake API:

   - the helpers under node: only site paths become links; the answer's parts as lists;
   - dev/make-progression-guide.py --check (the guide's quest lists match data/quest-gates.json);
   - the panel for the API's own answers (dev/next-step-fixtures.json: HR1, HR4, GR 37, GR 650, HR7, GR 912 and
     GR 999, the end game): summary, "Recommended", every detail line, every link with its path (the guide's stage
     sections #hr1..#hr7, #gr1, #gr50, #gr100, #zenith, #gr900, #end-game and the Game systems sections, each one
     an anchor that exists on its page; ★ shown as is), the "Also in game" line with its Game options link (it
     opens that tab); an answer of the API before the guide window (no "overlay") with a coming game update note:
     the note, no "Also in game" line; it follows the character picker and a list row's View; nothing loads
     before the Characters tab is shown;
     a link that is not a site path is dropped and markup shows as text; a 404 hides the panel; a 500 says so
     with Try again, which loads it again;
   - the guide page: #hr1..#hr7, #g-rank and the G Rank stages (the API's links), each band's Key Quests and Urgent Quest
     linked by id, the new Zenith GR and the coming update stated, links from the Frontier guide home;
   - both at 375 and 1280 px: no sideways scroll and no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-next-step.js
     SHOTS=<folder> ... also saves screenshots there.

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const Helpers = require("../js/account-next-step.js");

const root = path.join(__dirname, "..");
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "next-step-fixtures.json"), "utf8"));
const GATES = JSON.parse(fs.readFileSync(path.join(root, "data", "quest-gates.json"), "utf8"));
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
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

// id -> the fixture it answers; 14 answers a 500 the first time, 15 a 404, 16 a link that is not a site path,
// 20 the API before the guide window (no "overlay") with a coming update note
const BY_ID = { 10: "hr1", 11: "hr4", 12: "gr37", 13: "gr650", 17: "hr7", 18: "gr912", 19: "gr999" };
const STAGES = ["hr1", "hr4", "gr37", "gr650", "hr7", "gr912", "gr999"];
const CHARACTERS = [
  { id: 10, name: "Aldra", hr: 1, gr: 0, weaponType: "Long Sword", female: true, lastLogin: "2026-11-16T10:00:00Z" },
  { id: 11, name: "Bexo", hr: 75, gr: 0, weaponType: "Great Sword", female: false, lastLogin: "2026-11-15T10:00:00Z" },
  { id: 12, name: "Cirra", hr: 999, gr: 37, weaponType: "Lance", female: true, lastLogin: "2026-11-14T10:00:00Z" },
  { id: 13, name: "Dovan", hr: 999, gr: 650, weaponType: "Bow", female: false, lastLogin: "2026-11-13T10:00:00Z" },
  { id: 14, name: "Errant", hr: 1, gr: 0, weaponType: "Sword and Shield", female: false, lastLogin: null },
  { id: 15, name: "Faro", hr: 1, gr: 0, weaponType: "Hammer", female: false, lastLogin: null },
  { id: 16, name: "Gyre", hr: 1, gr: 0, weaponType: "Tonfa", female: true, lastLogin: null },
  { id: 17, name: "Hale", hr: 999, gr: 0, weaponType: "Gunlance", female: false, lastLogin: null },
  { id: 18, name: "Ivo", hr: 999, gr: 912, weaponType: "Switch Axe F", female: false, lastLogin: null },
  { id: 19, name: "Juna", hr: 999, gr: 999, weaponType: "Magnet Spike", female: true, lastLogin: null },
  { id: 20, name: "Kel", hr: 999, gr: 37, weaponType: "Heavy Bowgun", female: false, lastLogin: null }
];
const details = (id) => ({ characterId: id, name: CHARACTERS.find((c) => c.id === id).name, ownCharacter: true, hasSave: false,
  equipment: [], loadouts: { sets: [], notDecoded: null },
  boxes: { equipmentBox: { used: 0, capacity: 4500, pieces: [] }, itemBox: { stacks: 0, quantity: 0 }, pouch: { stacks: 0, quantity: 0 }, warehouse: { stacks: 0, quantity: 0 } },
  stats: { hr: 1, gr: 0, weaponType: "Lance", female: false, playtimeSeconds: 0, zenny: 0, gzenny: 0, cp: 0, huntsLifetime: 0, guild: null, coins: {} } });
const storage = (id) => ({ characterId: id, name: "", zenny: 0, gzenny: 0, cp: 0, itemBox: [], pouch: [], warehouse: [],
  stamps: { hlTotal: 0, hlRedeemed: 0, exTotal: 0, exRedeemed: 0 }, house: null });
const HOSTILE = Object.assign({}, FIX.hr1, { characterId: 16, characterName: "Gyre", summary: "<b>bold</b> summary",
  links: [{ label: "Bad", href: "javascript:alert(1)" }, { label: "Other site", href: "//example.com/x" },
    { label: "Guide", href: "/guide-frontier-progression.html#hr1" }] });
const OLD_NOTE = "A game update moves the Zenith ranks to GR 300, 500, 700 and 900.";
const OLD_API = Object.assign({}, FIX.gr37, { characterId: 20, characterName: "Kel", notes: [OLD_NOTE] });
delete OLD_API.overlay;

async function openAccount(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  let failedOnce = false;
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => {
    localStorage.setItem("hvmhfz.token", t);
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  }, TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS,
      body: body === undefined ? "" : JSON.stringify(body) });
    let m = p.match(/^\/api\/account\/characters\/(\d+)\/next-step$/);
    if (m) {
      const id = Number(m[1]);
      calls.push(id);
      if (BY_ID[id]) return reply(200, FIX[BY_ID[id]]);
      if (id === 14 && !failedOnce) { failedOnce = true; return reply(500, { message: "boom" }); }
      if (id === 14) return reply(200, Object.assign({}, FIX.hr1, { characterId: 14, characterName: "Errant" }));
      if (id === 16) return reply(200, HOSTILE);
      if (id === 20) return reply(200, OLD_API);
      return reply(404, { status: 404, error: "Not Found", path: p });
    }
    if ((m = p.match(/^\/api\/account\/characters\/(\d+)\/details$/))) return reply(200, details(Number(m[1])));
    if ((m = p.match(/^\/api\/account\/characters\/(\d+)\/storage$/))) return reply(200, storage(Number(m[1])));
    if (p === "/api/account") return reply(200, { username: "tester", roles: ["ROLE_USER"], characters: CHARACTERS.length, lastLogin: null, discordLinked: true });
    if (p === "/api/account/characters") return reply(200, CHARACTERS);
    if (p === "/api/account/discord") return reply(200, { linked: true });
    if (p === "/api/account/guilds") return reply(200, []);
    if (p === "/api/account/distributions") return reply(200, { gifts: [] });
    if (/\/hunts$/.test(p)) return reply(200, { totalKills: 0, monsters: [], recent: [] });
    return reply(404, { status: 404, error: "Not Found", path: p });
  });
  await page.goto("http://localhost:" + server.address().port + "/account.html#overview");
  await page.waitForSelector("#characters-body tr", { state: "attached" });
  return { ctx, page, errors, calls };
}

const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name), fullPage: true }); };
const shotOf = async (page, sel, name) => { if (process.env.SHOTS) await page.locator(sel).screenshot({ path: path.join(process.env.SHOTS, name) }); };
/* The document is wider than the screen (sideways scroll). */
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/* The right edge of anything in a box that does not scroll itself. */
const rightEdge = (page, sel) => page.evaluate((s) => {
  let right = 0;
  document.querySelectorAll(s + " *").forEach((n) => {
    for (let up = n.parentElement; up; up = up.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(up).overflowX)) return;
    }
    const box = n.getBoundingClientRect();
    if (box.width) right = Math.max(right, box.right);
  });
  return Math.round(right);
}, sel);

/* The panel as shown: summary, recommended, details, notes, links. */
const panelText = (page) => page.evaluate(() => {
  const body = document.getElementById("next-step-body");
  const all = (sel) => Array.from(body.querySelectorAll(sel)).map((n) => n.textContent);
  return {
    hidden: document.getElementById("next-step-panel").hidden,
    note: document.getElementById("next-step-note").textContent,
    summary: all(".next-step-summary")[0] || "",
    recommended: all(".next-step-rec")[0] || "",
    details: all(".next-step-details li"),
    notes: all(".next-step-note"),
    links: Array.from(body.querySelectorAll(".next-step-links a")).map((a) => [a.textContent, a.getAttribute("href")]),
    alert: all(".form-alert")[0] || "",
    inGame: all(".next-step-ingame")[0] || "",
    inGameLink: (body.querySelector(".next-step-ingame a") || { getAttribute: () => "" }).getAttribute("href"),
    html: body.innerHTML
  };
});

async function waitPanel(page, name) {
  await page.waitForFunction((n) => document.getElementById("next-step-note").textContent === n, name, { timeout: 5000 })
    .catch(() => {});
}

function samePanel(label, shown, answer) {
  check(label + ": summary", shown.summary === answer.summary, shown.summary);
  check(label + ": recommended", shown.recommended === "Recommended: " + answer.recommended, shown.recommended);
  check(label + ": details", JSON.stringify(shown.details) === JSON.stringify(answer.details), JSON.stringify(shown.details));
  check(label + ": notes", JSON.stringify(shown.notes) === JSON.stringify(answer.notes), JSON.stringify(shown.notes));
  check(label + ": links", JSON.stringify(shown.links) === JSON.stringify(answer.links.map((l) => [l.label, l.href])),
    JSON.stringify(shown.links));
  const IN_GAME = "Also in game: the Guide window shows your next step in town. Set it in Game options or with Ctrl+F10.";
  check(label + ": Also in game line", answer.overlay ? shown.inGame === IN_GAME && shown.inGameLink === "#game-options" : shown.inGame === "",
    shown.inGame + " " + shown.inGameLink);
}

async function run() {
  // helpers under node
  check("site path", Helpers.sitePath("/quest.html?id=1") === "/quest.html?id=1");
  check("no other site", Helpers.sitePath("//example.com") === null && Helpers.sitePath("https://x.y/") === null);
  check("no script link", Helpers.sitePath("javascript:alert(1)") === null && Helpers.sitePath("/a b") === null);
  const v = Helpers.view(FIX.gr650);
  check("view keeps every part", v.details.length === FIX.gr650.details.length && v.notes.length === FIX.gr650.notes.length
    && v.links.length === 2 && v.inGame === true);
  check("view of nothing", Helpers.view(null).links.length === 0 && Helpers.view({}).summary === "" && Helpers.view({}).inGame === false);
  check("view of the API before the guide window: no in-game line", Helpers.view(OLD_API).inGame === false && Helpers.view(OLD_API).notes.length === 1);
  check("every answer links its stage's guide section", STAGES.every((k) =>
    FIX[k].links.some((l) => /^\/guide-frontier-progression\.html#(hr[1-7]|gr1|gr50|gr100|zenith|gr900|end-game)$/.test(l.href))
    && FIX[k].links.some((l) => l.href === FIX[k].overlay.guidePath)));
  check("the end game answer", FIX.gr999.overlay.stageId === "end-game" && FIX.gr999.links[0].href === "/guide-frontier-progression.html#end-game"
    && FIX.gr999.links.filter((l) => l.href.startsWith("/guide-frontier-systems.html#")).length === 5);
  // every link of the answers is a page of this site, and its #anchor is an id on that page
  for (const k of STAGES) {
    for (const l of FIX[k].links) {
      const [file, anchor] = l.href.split("?")[0].split("#");
      const page = path.join(root, file);
      if (!fs.existsSync(page)) { check(k + ": link to a missing page", false, l.href); continue; }
      if (anchor) check(k + ": link to a missing anchor", fs.readFileSync(page, "utf8").includes('id="' + anchor + '"'), l.href);
    }
  }

  // the guide's lists match the data
  try {
    execFileSync("python3", [path.join(__dirname, "make-progression-guide.py"), "--check"], { stdio: "pipe" });
  } catch (e) {
    check("make-progression-guide.py --check", false, String(e.stdout || e.message).trim());
  }

  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 375]) {
      const s = await openAccount(browser, width);
      await s.page.waitForTimeout(300);
      check(width + " px: nothing loads before the Characters tab", s.calls.length === 0, s.calls.join(","));
      check(width + " px: panel hidden at first", (await panelText(s.page)).hidden);
      // the tab (on a phone the tab bar is a "Jump to" list: js/subtabs.js follows the address)
      if (width > 600) await s.page.click("#tab-characters");
      else await s.page.evaluate(() => { window.location.hash = "#characters"; });
      await waitPanel(s.page, "Aldra");
      samePanel(width + " px HR1", await panelText(s.page), FIX.hr1);
      check(width + " px: HR1 has no update note", (await panelText(s.page)).notes.length === 0);
      await shotOf(s.page, "#next-step-panel", "panel-hr1-" + width + ".png");

      for (const [id, key, name] of [[11, "hr4", "Bexo"], [12, "gr37", "Cirra"], [13, "gr650", "Dovan"], [17, "hr7", "Hale"],
        [18, "gr912", "Ivo"], [19, "gr999", "Juna"], [20, "old", "Kel"]]) {
        await s.page.selectOption("#details-character", String(id));
        await waitPanel(s.page, name);
        const shown = await panelText(s.page);
        samePanel(width + " px " + key, shown, key === "old" ? OLD_API : FIX[key]);
        await shotOf(s.page, "#next-step-panel", "panel-" + key + "-" + width + ".png");
        check(width + " px " + key + ": no sideways scroll", (await sideways(s.page)) <= 0, String(await sideways(s.page)));
        check(width + " px " + key + ": panel fits", (await rightEdge(s.page, "#next-step-panel")) <= width,
          String(await rightEdge(s.page, "#next-step-panel")));
      }
      await shot(s.page, "account-characters-" + width + ".png");

      // a list row's View opens the character and the panel follows
      await s.page.click('#characters-body [data-details-id="11"]');
      await waitPanel(s.page, "Bexo");
      check(width + " px: View moves the panel", (await panelText(s.page)).summary === FIX.hr4.summary);

      // 500, then Try again
      await s.page.selectOption("#details-character", "14");
      await s.page.waitForSelector("#next-step-body .form-alert");
      check(width + " px: a failure says so", /Could not work out/.test((await panelText(s.page)).alert));
      await s.page.click("#next-step-body button");
      await waitPanel(s.page, "Errant");
      check(width + " px: Try again loads it", (await panelText(s.page)).summary === FIX.hr1.summary);

      // 404 hides the panel
      await s.page.selectOption("#details-character", "15");
      await s.page.waitForFunction(() => document.getElementById("next-step-panel").hidden, null, { timeout: 5000 }).catch(() => {});
      check(width + " px: a 404 hides the panel", (await panelText(s.page)).hidden);

      // only site links, markup as text
      await s.page.selectOption("#details-character", "16");
      await waitPanel(s.page, "Gyre");
      const hostile = await panelText(s.page);
      check(width + " px: only site paths are links", JSON.stringify(hostile.links) === JSON.stringify([["Guide", "/guide-frontier-progression.html#hr1"]]),
        JSON.stringify(hostile.links));
      check(width + " px: markup shows as text", hostile.summary === "<b>bold</b> summary" && !/<b>/.test(hostile.html));

      // "Also in game": its link opens the Game options tab
      await s.page.selectOption("#details-character", "19");
      await waitPanel(s.page, "Juna");
      await s.page.click("#next-step-body .next-step-ingame a");
      await s.page.waitForFunction(() => !document.getElementById("panel-game-options").hidden, null, { timeout: 5000 }).catch(() => {});
      check(width + " px: the Game options link opens that tab", await s.page.evaluate(() => !document.getElementById("panel-game-options").hidden));

      check(width + " px: account page has no page errors", s.errors.length === 0, s.errors.join("; "));
      await s.ctx.close();
    }

    // the guide page
    for (const width of [1280, 375]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
      await page.goto("http://localhost:" + server.address().port + "/guide-frontier-progression.html");
      for (const id of ["hr1", "hr2", "hr3", "hr4", "hr5", "hr6", "hr7", "g-rank", "gr1", "gr50", "gr100", "zenith", "gr900", "end-game"]) {
        check(width + " px guide: #" + id, (await page.locator("section#" + id).count()) === 1);
      }
      for (const band of GATES.bands) {
        // the generated Key/Urgent lists only: the hand-written stage box (.hb-stage) may link other quests
        const hrefs = await page.$$eval("section#hr" + band.band + " a[href^='/quest.html?id=']", (as) => as.filter((a) => !a.closest(".hb-stage")).map((a) => a.getAttribute("href")));
        const want = band.keys.concat(band.urgent ? [band.urgent] : []).map((id) => "/quest.html?id=" + id);
        check(width + " px guide: " + band.label + " quests", JSON.stringify(hrefs.slice().sort()) === JSON.stringify(want.slice().sort()), hrefs.join(","));
        const first = await page.$eval("section#hr" + band.band + " h2", (h) => h.textContent);
        check(width + " px guide: " + band.label + " heading", first === band.label + " (" + band.hr + ")", first);
      }
      const g = await page.$eval("section#g-rank", (n) => n.textContent.replace(/\s+/g, " "));
      check(width + " px guide: new Zenith GR", /GR 200, 400, 600 and 800/.test(g) && /GR 300, 500, 700 and 900/.test(g));
      check(width + " px guide: Exotic materials", /Exotic Gem/.test(g) && /no GR 800 gate/.test(g) && /open at GR 100/.test(g));
      check(width + " px guide: no sideways scroll", (await sideways(page)) <= 0, String(await sideways(page)));
      check(width + " px guide: no page errors", errors.length === 0, errors.join("; "));
      await shot(page, "guide-" + width + ".png");
      await ctx.close();
    }
    const home = fs.readFileSync(path.join(root, "guide-frontier.html"), "utf8");
    check("Frontier guide home links the page", (home.match(/href="\/guide-frontier-progression\.html"/g) || []).length >= 2);
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.log("next step: " + failures.length + " problem(s)");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("next step OK");
}

run().catch((error) => { console.error(error); process.exit(1); });
