#!/usr/bin/env node
/* Checks the account page's Details tab (js/account-details.js) and the Characters tab's links in
   headless Chromium against a fake API with GET /api/account/characters/{id}/details (API README
   "Character details"):

   - the helpers under node (names for unknown ids, armour level, playtime, box filter);
   - the Characters tab: each name links to its hunter card (/hunters.html?id=), each row has Details;
   - nothing asks for details until the tab is opened;
   - Details on a row opens the tab for that character: Equipment (six slots, names, ids for unknown
     pieces, armour level, decorations), Loadouts (named sets, a piece no longer in the box, cuffs),
     Boxes (counts; the equipment box table, its filter chips and search), Stats (ranks, playtime, money,
     guild, coins, the hunter card link);
   - a character without a save, an API without the endpoint ("coming soon"), and the admin box (shown to
     admins only; another account's character opens, an unknown id says so);
   - a 375 px phone: nothing in the tab reaches past the screen (tables and chip rows scroll in their own box).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-details.js
     SHOTS=<folder> ... also saves screenshots there (1280 and 375 px wide).

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Helpers = require("../js/account-details.js");

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
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

const CHARACTERS = [
  { id: 10, name: "Aldra", hr: 999, gr: 120, weaponType: "Long Sword", female: true, lastLogin: "2026-11-02T10:00:00Z", guildName: "Test Guild", guildRank: "Leader" },
  { id: 11, name: "Bexo", hr: 7, gr: 0, weaponType: "Great Sword", female: false, lastLogin: null }
];

const deco = (id, name) => ({ id, name, icon: null });
const DETAILS = {
  characterId: 10, name: "Aldra", ownCharacter: true, hasSave: true,
  equipment: [
    { slot: "weapon", kind: "melee", id: 10, name: "Iron Katana", level: null, upgrade: [100, 0], decorations: [deco(11019, "Poison Sigil")], boxIndex: null },
    { slot: "head", kind: "armour", id: 1, name: "Leather Helm", level: 1, upgrade: null, decorations: [], boxIndex: null },
    { slot: "chest", kind: "armour", id: 515, name: null, level: 3, upgrade: null, decorations: [deco(910, "Gallery Atk Deco")], boxIndex: null },
    { slot: "arms", kind: "armour", id: 516, name: "Test Arms", level: 1, upgrade: null, decorations: [], boxIndex: null },
    { slot: "legs", kind: "armour", id: 261, name: "Test Greaves", level: 7, upgrade: null, decorations: [deco(883, "Attack 2 Deco"), deco(883, "Attack 2 Deco")], boxIndex: null }
  ],
  loadouts: { notDecoded: null, sets: [
    { number: 1, name: "Set 1", cuffs: [], slots: [
      { slot: "weapon", boxIndex: 1, piece: { slot: "weapon", kind: "ranged", id: 4073, name: "Remnant Boltgun", level: null, upgrade: [32, 100], decorations: [], boxIndex: 1 }, decorations: [] }] },
    { number: 2, name: "GOD LS", cuffs: [deco(15617, "Skill Slots Up PZ51")], slots: [
      { slot: "weapon", boxIndex: 0, piece: { slot: "weapon", kind: "melee", id: 10, name: "Iron Katana", level: null, upgrade: [100, 0], decorations: [], boxIndex: 0 }, decorations: [deco(11019, "Poison Sigil")] },
      { slot: "head", boxIndex: 2, piece: { slot: "head", kind: "armour", id: 1, name: "Leather Helm", level: 1, upgrade: null, decorations: [], boxIndex: 2 }, decorations: [deco(883, "Attack 2 Deco")] },
      { slot: "waist", boxIndex: 9, piece: null, decorations: [] }] }
  ] },
  boxes: {
    equipmentBox: { used: 4, capacity: 4500, pieces: [
      { slot: "weapon", kind: "melee", id: 10, name: "Iron Katana", level: null, upgrade: [100, 0], decorations: [deco(11019, "Poison Sigil")], boxIndex: 0 },
      { slot: "weapon", kind: "ranged", id: 4073, name: "Remnant Boltgun", level: null, upgrade: [32, 100], decorations: [], boxIndex: 1 },
      { slot: "head", kind: "armour", id: 1, name: "Leather Helm", level: 1, upgrade: null, decorations: [], boxIndex: 2 },
      { slot: "waist", kind: "armour", id: 768, name: null, level: 5, upgrade: null, decorations: [], boxIndex: 7 }
    ] },
    itemBox: { stacks: 120, quantity: 4321 }, pouch: { stacks: 3, quantity: 30 }, warehouse: { stacks: 0, quantity: 0 }
  },
  stats: { hr: 999, gr: 120, weaponType: "Long Sword", female: true, lastLogin: "2026-11-02T10:00:00Z", playtimeSeconds: 4707602,
    zenny: 3392, gzenny: 120000, cp: 50, gcp: 7, kouryouPoints: 1200, huntsLifetime: 14312,
    guild: { id: 100, name: "Test Guild", rank: "Leader" }, coins: { gachaPremium: 12, gachaTrial: 34, frontierPoints: 5600 } }
};
const NO_SAVE = { characterId: 11, name: "Bexo", ownCharacter: true, hasSave: false, equipment: [],
  loadouts: { sets: [], notDecoded: null },
  boxes: { equipmentBox: { used: 0, capacity: 4500, pieces: [] }, itemBox: { stacks: 0, quantity: 0 }, pouch: { stacks: 0, quantity: 0 }, warehouse: { stacks: 0, quantity: 0 } },
  stats: { hr: 7, gr: 0, weaponType: "Great Sword", female: false, playtimeSeconds: 0, zenny: 0, gzenny: 0, cp: 0, huntsLifetime: 0, guild: null, coins: {} } };
const STRANGER = Object.assign({}, DETAILS, { characterId: 20, name: "Stranger", ownCharacter: false });

/* A signed-in account page with the fake API. o.missing: no details endpoint (Spring's 404); o.admin: the
   account has ROLE_ADMIN. Records the details calls. */
async function open(browser, o, width, hash) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
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
    const details = p.match(/^\/api\/account\/characters\/(\d+)\/details$/);
    if (details) {
      calls.push(details[1]);
      if (o.missing) return reply(404, { status: 404, error: "Not Found", path: p });
      if (details[1] === "10") return reply(200, DETAILS);
      if (details[1] === "11") return reply(200, NO_SAVE);
      if (details[1] === "20" && o.admin) return reply(200, STRANGER);
      return reply(404, { status: 404, error: "Not Found", path: p });
    }
    if (p === "/api/account") return reply(200, { username: "tester", roles: o.admin ? ["ROLE_ADMIN", "ROLE_USER"] : ["ROLE_USER"], characters: 2, lastLogin: null, discordLinked: true });
    if (p === "/api/account/characters") return reply(200, CHARACTERS);
    if (p === "/api/account/discord") return reply(200, { linked: true });
    if (p === "/api/account/guilds") return reply(200, []);
    if (p === "/api/account/distributions") return reply(200, { gifts: [] });
    if (/\/hunts$/.test(p)) return reply(200, { totalKills: 0, monsters: [], recent: [] });
    if (/\/storage$/.test(p)) return reply(200, { characterId: 10, name: "Aldra", zenny: 0, gzenny: 0, cp: 0, itemBox: [], pouch: [],
      warehouse: [], stamps: { hlTotal: 0, hlRedeemed: 0, exTotal: 0, exRedeemed: 0 }, house: null });
    return reply(404, { status: 404, error: "Not Found", path: p });
  });
  await page.goto("http://localhost:" + server.address().port + "/account.html" + (hash || ""));
  await page.waitForSelector("#characters-body tr", { state: "attached" });
  return { ctx, page, errors, calls };
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => "");
const count = (page, sel) => page.$$eval(sel, (n) => n.length);
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name), fullPage: true }); };

async function run() {
  // helpers under node
  check("unknown armour name", Helpers.pieceName({ kind: "armour", slot: "chest", id: 515 }) === "Chest piece #515");
  check("unknown weapon name", Helpers.pieceName({ kind: "ranged", slot: "weapon", id: 4 }) === "Ranged weapon #4");
  check("armour meta", Helpers.pieceMeta({ kind: "armour", slot: "legs", id: 261, level: 7 }) === "Legs · Lv 7 · id 261");
  check("weapon meta has no level", Helpers.pieceMeta({ kind: "melee", slot: "weapon", id: 10, level: null }) === "Melee weapon · id 10");
  check("playtime", Helpers.playtime(4707602) === "1,307 h 40 min", Helpers.playtime(4707602));
  check("box filter", Helpers.boxFilter(DETAILS.boxes.equipmentBox.pieces, "weapon").length === 2);
  check("hunter card url", Helpers.hunterCardUrl(10) === "/hunters.html?id=10");

  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await chromium.launch();
  try {
    // characters tab and lazy loading
    let s = await open(browser, {}, 1280, "#characters");
    const cardHref = await s.page.$eval("#characters-body tr .cell-name a", (a) => a.getAttribute("href"));
    check("name links to the hunter card", cardHref === "/hunters.html?id=10", cardHref);
    check("each row has Details", (await count(s.page, "#characters-body [data-details-id]")) === 2);
    await s.page.waitForTimeout(300);
    check("no details call before the tab opens", s.calls.length === 0, s.calls.join(","));

    // Details on the first row: Equipment
    await s.page.click('#characters-body [data-details-id="10"]');
    await s.page.waitForSelector("#details-body .detail-piece");
    check("tab shown", !(await s.page.$eval("#panel-details", (n) => n.hidden)));
    check("one details call", s.calls.join(",") === "10", s.calls.join(","));
    check("six slots", (await count(s.page, "#details-body .detail-piece")) === 6);
    const names = await s.page.$$eval("#details-body .detail-name", (n) => n.map((x) => x.textContent));
    check("names in slot order", JSON.stringify(names) === JSON.stringify(["Iron Katana", "Leather Helm", "Chest piece #515", "Test Arms", "Empty", "Test Greaves"]), JSON.stringify(names));
    const body = await text(s.page, "#details-body");
    check("armour level shown", body.includes("Lv 7"));
    check("sigil shown", body.includes("Poison Sigil"));
    check("weapon upgrade not shown as a level", !body.includes("Lv 100"));
    check("card link", (await s.page.$eval("#details-card-link", (a) => a.getAttribute("href"))) === "/hunters.html?id=10");
    await shot(s.page, "details-equipment-1280.png");

    // Loadouts
    await s.page.click('#details-sections [data-section="loadouts"]');
    await s.page.waitForSelector("#details-body .detail-set");
    check("two sets", (await count(s.page, "#details-body .detail-set")) === 2);
    check("set name", (await text(s.page, "#details-body .detail-set:nth-of-type(2) .detail-set-name")) === "GOD LS"
      || (await s.page.$$eval("#details-body .detail-set-name", (n) => n.map((x) => x.textContent))).includes("GOD LS"));
    await s.page.$$eval("#details-body details", (n) => n.forEach((d) => { d.open = true; }));
    const sets = await text(s.page, "#details-body");
    check("piece gone from the box", sets.includes("No longer in the box"));
    check("cuffs", sets.includes("Skill Slots Up PZ51"));
    check("set decoration", sets.includes("Attack 2 Deco"));
    await shot(s.page, "details-loadouts-1280.png");

    // Boxes
    await s.page.click('#details-sections [data-section="boxes"]');
    await s.page.waitForSelector(".detail-box-table tbody tr");
    check("box rows", (await count(s.page, ".detail-box-table tbody tr")) === 4);
    check("item box count", (await text(s.page, "#details-body")).includes("4,321 items"));
    await s.page.click('#details-body .chip[data-filter="head"]');
    check("head filter", (await count(s.page, ".detail-box-table tbody tr")) === 1);
    await s.page.click('#details-body .chip[data-filter="all"]');
    await s.page.fill("#details-box-search", "poison");
    check("search by decoration", (await count(s.page, ".detail-box-table tbody tr")) === 1);
    await s.page.fill("#details-box-search", "waist piece #768");
    check("search unknown name", (await count(s.page, ".detail-box-table tbody tr")) === 1);
    await s.page.fill("#details-box-search", "");

    // Stats
    await s.page.click('#details-sections [data-section="stats"]');
    await s.page.waitForSelector("#details-body .detail-list");
    const stats = await text(s.page, "#details-body");
    ["1,307 h 40 min", "3,392", "14,312", "Test Guild (Leader)", "5,600", "Female"].forEach((v) => check("stats show " + v, stats.includes(v)));
    check("stats hunter card link", (await s.page.$eval("#details-body a[href^='/hunters.html']", (a) => a.getAttribute("href"))) === "/hunters.html?id=10");
    check("admin box hidden for players", await s.page.$eval("#details-admin-form", (n) => n.hidden));

    // the other character, without a save
    await s.page.selectOption("#details-character", "11");
    await s.page.click('#details-sections [data-section="equipment"]');
    await s.page.waitForFunction(() => document.getElementById("details-note").textContent === "Bexo");
    check("no save note", (await text(s.page, "#details-body")).includes("no save yet"));
    check("no page errors", s.errors.length === 0, s.errors.join("; "));
    await s.ctx.close();

    // straight to #details: loads the first character
    s = await open(browser, {}, 1280, "#details");
    await s.page.waitForSelector("#details-body .detail-piece");
    check("opens on #details", s.calls.join(",") === "10", s.calls.join(","));
    await s.ctx.close();

    // API without the endpoint
    s = await open(browser, { missing: true }, 1280, "#details");
    await s.page.waitForSelector("#details-soon:not([hidden])");
    check("coming soon, no alert", await s.page.$eval("#details-alert", (n) => n.hidden));
    check("missing: no page errors", s.errors.length === 0, s.errors.join("; "));
    await s.ctx.close();

    // admin
    s = await open(browser, { admin: true }, 1280, "#details");
    await s.page.waitForSelector("#details-admin-form:not([hidden])");
    await s.page.fill("#details-admin-id", "20");
    await s.page.click("#details-admin-form button");
    await s.page.waitForFunction(() => document.getElementById("details-note").textContent.includes("Stranger"));
    check("admin view marked", (await text(s.page, "#details-note")).includes("admin view"));
    await s.page.fill("#details-admin-id", "99");
    await s.page.click("#details-admin-form button");
    await s.page.waitForSelector("#details-alert:not([hidden])");
    check("unknown id", (await text(s.page, "#details-alert")).includes("No character with id 99"));
    await s.ctx.close();

    // phone
    s = await open(browser, {}, 375, "#details");
    await s.page.waitForSelector("#details-body .detail-piece");
    for (const section of ["equipment", "loadouts", "boxes", "stats"]) {
      await s.page.click('#details-sections [data-section="' + section + '"]');
      await s.page.waitForTimeout(100);
      // The Details panel itself: nothing in it reaches past the screen (tables and chip rows scroll
      // inside their own box). The whole page is not measured: the site nav's Menu button is 17 px too wide at
      // 375 px on every page (not this tab's doing; check-account-transfer.js reports it too).
      const wide = await s.page.evaluate(() => {
        let right = 0;
        document.querySelectorAll("#panel-details *").forEach((n) => {
          // inside a box that scrolls sideways itself (tables, the site's chip rows on phones)
          for (let up = n.parentElement; up && up.id !== "panel-details"; up = up.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(up).overflowX)) return;
          }
          const box = n.getBoundingClientRect();
          if (box.width) right = Math.max(right, box.right);
        });
        return Math.round(right);
      });
      check("375 px " + section + " fits", wide <= 375, String(wide));
      await shot(s.page, "details-" + section + "-375.png");
    }
    check("phone: no page errors", s.errors.length === 0, s.errors.join("; "));
    check("no page error box", await s.page.$eval("#account-error", (n) => n.hidden));
    await s.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.log("account details: " + failures.length + " problem(s)");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("account details OK");
}

run().catch((error) => { console.error(error); process.exit(1); });
