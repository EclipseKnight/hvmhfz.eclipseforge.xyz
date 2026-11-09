#!/usr/bin/env node
/* Checks the account page's character view (js/account-details.js, on the Characters tab) and its icons
   (js/game-icons.js, data/equipment-icons.json) in headless Chromium against a fake API with
   GET /api/account/characters/{id}/details (API README "Character details") and /storage:

   - the helpers under node (names for unknown ids, type, rarity and level, playtime, filters, searches)
     and the icon lookups on the real data files (weapon class, rarity and the client's colour rules, armour
     slot and rarity, unknown ids, item keys) and that every icon they name exists (assets/icons/1x and 2x);
   - the page's tabs: no Storage or Details tab any more; old #storage and #details links land on Characters
     (#storage on the item box);
   - the character list: each name links to its hunter card (/hunters.html?id=), each row has View;
   - nothing asks for details or storage until the Characters tab is shown, then both load once;
   - the seven sections: Overview (ranks, playtime, money, stamps, guild, coins, house, hunter card link),
     Equipment (six slots, names, ids for unknown pieces, armour level, decorations, the game's type icon in
     its rarity colour on every piece, 1x and 2x files, an empty frame for an empty slot), Loadouts (named sets, a piece no longer in the box,
     cuffs), Item box (the grid with pages, icons, counts, search that jumps to the page; the list),
     Pouch and Warehouse (icon, name, count, search), Equipment box (icons, class, rarity, filter chips,
     search); counts on the section chips; an item without a picture or with a missing file gets the
     placeholder; the gift list's icons;
   - a character without a save, an API without /details ("coming soon" there, the boxes still shown), and
     the admin box (shown to admins only; another account's character opens without item lists, an unknown
     id says so);
   - a 375 px phone: the item box opens as a list, and nothing in the view reaches past the screen (tables
     and chip rows scroll in their own box).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-details.js
     SHOTS=<folder> ... also saves screenshots there (1280 and 375 px wide).

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Helpers = require("../js/account-details.js");
const Icons = require("../js/game-icons.js");

const root = path.join(__dirname, "..");
const EQUIP_DATA = JSON.parse(fs.readFileSync(path.join(root, "data", "equipment-icons.json"), "utf8"));
const ITEM_KEYS = JSON.parse(fs.readFileSync(path.join(root, "data", "item-icons.json"), "utf8"));
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

const deco = (id, name, icon) => ({ id, name, icon: icon || null });
const DETAILS = {
  characterId: 10, name: "Aldra", ownCharacter: true, hasSave: true,
  equipment: [
    { slot: "weapon", kind: "melee", id: 10, name: "Iron Katana", level: null, upgrade: [100, 0], decorations: [deco(11019, "Poison Sigil", "Jewel1")], boxIndex: null },
    { slot: "head", kind: "armour", id: 1, name: "Leather Helm", level: 1, upgrade: null, decorations: [], boxIndex: null },
    { slot: "chest", kind: "armour", id: 515, name: null, level: 3, upgrade: null, decorations: [deco(910, "Gallery Atk Deco")], boxIndex: null },
    { slot: "arms", kind: "armour", id: 516, name: "Test Arms", level: 1, upgrade: null, decorations: [], boxIndex: null },
    { slot: "legs", kind: "armour", id: 261, name: "Test Greaves", level: 7, upgrade: null, decorations: [deco(883, "Attack 2 Deco", "Jewel4"), deco(883, "Attack 2 Deco", "Jewel4")], boxIndex: null }
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
    equipmentBox: { used: 5, capacity: 4500, pieces: [
      { slot: "weapon", kind: "melee", id: 10, name: "Iron Katana", level: null, upgrade: [100, 0], decorations: [deco(11019, "Poison Sigil", "Jewel1")], boxIndex: 0 },
      { slot: "weapon", kind: "ranged", id: 4073, name: "Remnant Boltgun", level: null, upgrade: [32, 100], decorations: [], boxIndex: 1 },
      { slot: "head", kind: "armour", id: 1, name: "Leather Helm", level: 1, upgrade: null, decorations: [], boxIndex: 2 },
      { slot: "waist", kind: "armour", id: 768, name: null, level: 5, upgrade: null, decorations: [], boxIndex: 7 },
      { slot: "weapon", kind: "ranged", id: 4096, name: "Harine Ray", level: null, upgrade: [0, 0], decorations: [], boxIndex: 8 }
    ] },
    itemBox: { stacks: 4, quantity: 125 }, pouch: { stacks: 2, quantity: 15 }, warehouse: { stacks: 1, quantity: 3 }
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

const item = (slot, id, name, quantity, icon) => ({ slot, id, name, quantity, icon });
const STORAGE = { characterId: 10, name: "Aldra", zenny: 3392, gzenny: 120000, cp: 50,
  itemBox: [item(0, 7, "Potion", 10, "Drink6"), item(1, 8, "Mega Potion", 10, "Drink2"),
    item(5, 99999, null, 5, null), item(250, 1000, "Akantor Spike", 100, "Nope7")], // its icon file 404s here
  pouch: [item(0, 7, "Potion", 10, "Drink6"), item(3, 13, "Dash Juice", 5, "Drink1")],
  warehouse: [item(null, 13, "Dash Juice", 3, "Drink1")],
  stamps: { hlTotal: 4, hlRedeemed: 0, exTotal: 9, exRedeemed: 0 },
  house: { state: 2, galleryBytes: 0, bookshelfBytes: 64, toreBytes: 0, gardenBytes: 0 } };
const EMPTY_STORAGE = { characterId: 11, name: "Bexo", zenny: 0, gzenny: 0, cp: 0, itemBox: [], pouch: [], warehouse: [],
  stamps: { hlTotal: 0, hlRedeemed: 0, exTotal: 0, exRedeemed: 0 }, house: null };
const GIFTS = { gifts: [{ eventName: "Welcome", listName: "Gifts", description: "", timesAcceptable: 1, targeted: false,
  acceptedBy: [], ended: false, items: [
    { itemType: 7, itemTypeLabel: "Item", itemId: 7, name: "Potion", icon: "Drink6", quantity: 5 },
    { itemType: 10, itemTypeLabel: "Zenny", itemId: null, name: null, icon: null, quantity: 1000 }] }] };

/* A signed-in account page with the fake API. o.missing: no details endpoint (Spring's 404); o.admin: the
   account has ROLE_ADMIN. Records the details and storage calls. */
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
  await page.route("**/assets/icons/*/item-31-10.png", (route) => route.fulfill({ status: 404, body: "" })); // Akantor Spike's
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS,
      body: body === undefined ? "" : JSON.stringify(body) });
    const details = p.match(/^\/api\/account\/characters\/(\d+)\/details$/);
    if (details) {
      calls.push("details " + details[1]);
      if (o.missing) return reply(404, { status: 404, error: "Not Found", path: p });
      if (details[1] === "10") return reply(200, DETAILS);
      if (details[1] === "11") return reply(200, NO_SAVE);
      if (details[1] === "20" && o.admin) return reply(200, STRANGER);
      return reply(404, { status: 404, error: "Not Found", path: p });
    }
    const storage = p.match(/^\/api\/account\/characters\/(\d+)\/storage$/);
    if (storage) {
      calls.push("storage " + storage[1]);
      if (storage[1] === "10") return reply(200, STORAGE);
      if (storage[1] === "11") return reply(200, EMPTY_STORAGE);
      return reply(404, { status: 404, error: "Not Found", path: p });
    }
    if (p === "/api/account") return reply(200, { username: "tester", roles: o.admin ? ["ROLE_ADMIN", "ROLE_USER"] : ["ROLE_USER"], characters: 2, lastLogin: null, discordLinked: true });
    if (p === "/api/account/characters") return reply(200, CHARACTERS);
    if (p === "/api/account/discord") return reply(200, { linked: true });
    if (p === "/api/account/guilds") return reply(200, []);
    if (p === "/api/account/distributions") return reply(200, GIFTS);
    if (/\/hunts$/.test(p)) return reply(200, { totalKills: 0, monsters: [], recent: [] });
    return reply(404, { status: 404, error: "Not Found", path: p });
  });
  await page.goto("http://localhost:" + server.address().port + "/account.html" + (hash || ""));
  await page.waitForSelector("#characters-body tr", { state: "attached" });
  return { ctx, page, errors, calls };
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => "");
const count = (page, sel) => page.$$eval(sel, (n) => n.length);
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name), fullPage: true }); };
const section = async (page, name, waitFor) => {
  await page.click('#details-sections [data-section="' + name + '"]');
  if (waitFor) await page.waitForSelector(waitFor);
};
/* Every picture in the view has loaded (a missing file has been swapped for the placeholder). */
const brokenImages = (page) => page.evaluate(async () => {
  const imgs = Array.from(document.querySelectorAll("#details-body img, #gifts-body img"));
  await Promise.all(imgs.map((img) => img.complete ? null : new Promise((r) => { img.addEventListener("load", r); img.addEventListener("error", r); })));
  await new Promise((r) => setTimeout(r, 150)); // the fallback's own load
  return imgs.filter((img) => !img.naturalWidth).map((img) => img.getAttribute("src"));
});

async function run() {
  // helpers under node
  check("unknown armour name", Helpers.pieceName({ kind: "armour", slot: "chest", id: 515 }) === "Chest piece #515");
  check("unknown weapon name", Helpers.pieceName({ kind: "ranged", slot: "weapon", id: 4 }) === "Ranged weapon #4");
  check("armour meta", Helpers.pieceMeta({ kind: "armour", slot: "legs", id: 261, level: 7 }) === "Legs · Lv 7 · id 261");
  check("weapon meta has no level", Helpers.pieceMeta({ kind: "melee", slot: "weapon", id: 10, level: null }) === "Melee weapon · id 10");
  const katana = { kind: "melee", slot: "weapon", id: 10, level: null };
  check("weapon meta with its look", Helpers.pieceMeta(katana, Icons.equipmentLook(EQUIP_DATA, katana)) === "Long Sword · Rare 1 · id 10",
    Helpers.pieceMeta(katana, Icons.equipmentLook(EQUIP_DATA, katana)));
  check("playtime", Helpers.playtime(4707602) === "1,307 h 40 min", Helpers.playtime(4707602));
  check("box filter", Helpers.boxFilter(DETAILS.boxes.equipmentBox.pieces, "weapon").length === 3);
  check("hunter card url", Helpers.hunterCardUrl(10) === "/hunters.html?id=10");
  check("item search by name", Helpers.itemMatches(STORAGE.itemBox, "potion").length === 2);
  check("item search by id", Helpers.itemMatches(STORAGE.itemBox, "1000").length === 1);
  check("item search unnamed", Helpers.itemMatches(STORAGE.itemBox, "item #99999").length === 1);
  check("#storage opens the item box", Helpers.sectionForHash("#storage") === "itembox" && Helpers.sectionForHash("#details") === "overview");

  // icon lookups on the real data file (ids checked against the server's tables: dev/make-equipment-icons.py)
  const lookOf = (piece, data) => Icons.equipmentLook(data === undefined ? EQUIP_DATA : data, piece);
  const icon = (key) => "/assets/icons/1x/" + key + ".png";
  let l = lookOf(katana);
  check("melee 10 is a long sword, rare 1", l.sprite === icon("long-sword-0") && l.rarity === 0 && l.colour === Icons.EQUIP_COLOURS[0], JSON.stringify(l));
  l = lookOf({ kind: "ranged", slot: "weapon", id: 4096 });
  check("ranged 4096 is a bow, rare 4: the client's second colour", l.sprite === icon("bow-1") && l.rarity === 3 && l.weaponClass === "Bow" && l.colour === "#73cb8d", JSON.stringify(l));
  l = lookOf({ kind: "ranged", slot: "weapon", id: 1000 });
  check("ranged 1000 is a heavy bowgun", l.weaponClass === "Heavy Bowgun", JSON.stringify(l));
  l = lookOf({ kind: "armour", slot: "head", id: 1000 });
  check("head 1000 rare 7", l.sprite === icon("head-4") && l.rarity === 6, JSON.stringify(l));
  l = lookOf({ kind: "armour", slot: "legs", id: 999999 });
  check("unknown armour id: slot sprite, first colour, no rarity", l.sprite === icon("legs-0") && l.colour === null && l.rarity === null, JSON.stringify(l));
  l = lookOf({ kind: "melee", slot: "weapon", id: 999999 });
  check("unknown weapon id: placeholder", l.sprite === Icons.FALLBACK && l.colour === null, JSON.stringify(l));
  l = lookOf({ kind: "armour", slot: "arms", id: 5 }, null);
  check("no data: armour still has its slot", l.sprite === icon("arms-0") && l.colour === null, JSON.stringify(l));
  check("RARE 1-3 share the first colour, RARE 12 the last", [0, 1, 2].every((r) => Icons.RANK_COLOUR[r] === 0) && Icons.RANK_COLOUR[11] === 9);
  // the client's weapon colour rules (mhfo-hd.dll 0x10a9cac0): fixed series, by level, by the level table
  check("weapon rank: rarity", Icons.weaponRank("-", 4, 80) === 4);
  check("weapon rank: fixed series", Icons.weaponRank("h", 4, 0) === 6 && Icons.weaponRank("i", 4, 0) === 8 && Icons.weaponRank("b", 4, 0) === 11);
  check("weapon rank: level set a", [[1, 2], [6, 3], [16, 4], [26, 5], [36, 6], [46, 7], [56, 8], [66, 9], [76, 10], [86, 11], [100, 11]].every((c) => Icons.weaponRank("a", 0, c[0]) === c[1]));
  check("weapon rank: level set c", [[5, 3], [6, 4], [26, 6], [76, 11]].every((c) => Icons.weaponRank("c", 0, c[0]) === c[1]));
  check("weapon rank: level set e", [[15, 4], [16, 5], [31, 6], [91, 10], [100, 11]].every((c) => Icons.weaponRank("e", 0, c[0]) === c[1]));
  check("weapon rank: level outside 1-100 is the rarity", Icons.weaponRank("a", 7, 0) === 7 && Icons.weaponRank("e", 7, 101) === 7);
  check("weapon rank: level table", [[1, 2], [9, 2], [10, 3], [21, 4], [30, 5], [40, 6], [50, 7]].every((c) => Icons.weaponRank("t", 0, c[0]) === c[1]) && Icons.weaponRank("t", 3, 51) === 3);
  const ruled = (rule) => EQUIP_DATA.meleeTint.indexOf(rule);
  check("every rule letter is used", ["a", "c", "e", "h", "i", "b", "t"].every((r) => ruled(r) > 0 || EQUIP_DATA.rangedTint.indexOf(r) > 0));
  l = lookOf({ kind: "melee", slot: "weapon", id: ruled("a"), upgrade: [86, 0] });
  check("a level weapon at level 86 takes the last colour", l.colour === Icons.EQUIP_COLOURS[9], JSON.stringify(l));
  l = lookOf({ kind: "melee", slot: "weapon", id: ruled("h") });
  check("a series weapon takes its own colour", l.colour === Icons.EQUIP_COLOURS[Icons.RANK_COLOUR[6]], JSON.stringify(l));
  let gun = -1; // a bowgun on the level table: its level is the second upgrade byte (a bow's the first)
  for (let i = 1; i < EQUIP_DATA.rangedTint.length && gun < 0; i++) {
    if (EQUIP_DATA.rangedTint[i] === "t" && /bowgun/.test(EQUIP_DATA.classes[parseInt(EQUIP_DATA.ranged[i * 2], 36)])) gun = i;
  }
  const gunRarity = parseInt(EQUIP_DATA.ranged[gun * 2 + 1], 36);
  check("a bowgun's level is its second upgrade byte", gun > 0
    && lookOf({ kind: "ranged", slot: "weapon", id: gun, upgrade: [0, 50] }).colour === Icons.EQUIP_COLOURS[Icons.RANK_COLOUR[7]]
    && lookOf({ kind: "ranged", slot: "weapon", id: gun, upgrade: [50, 0] }).colour === Icons.EQUIP_COLOURS[Icons.RANK_COLOUR[gunRarity]], String(gun));
  check("tint rules cover every weapon id", EQUIP_DATA.meleeTint.length === EQUIP_DATA.melee.length / 2 && EQUIP_DATA.rangedTint.length === EQUIP_DATA.ranged.length / 2);
  check("rarity label", Icons.rarityLabel(6) === "Rare 7" && Icons.rarityLabel(null) === "");
  check("icon urls", Icons.iconUrl("item-24-2") === "/assets/icons/1x/item-24-2.png" && Icons.iconUrl("item-24-2", 2) === "/assets/icons/2x/item-24-2.png" && Icons.iconUrl(null) === Icons.FALLBACK);
  check("item keys by id", Icons.itemKey(ITEM_KEYS, { id: 7 }) === "item-24-2" && Icons.itemKey(ITEM_KEYS, 7) === "item-24-2"
    && Icons.itemKey(ITEM_KEYS, { itemType: 7, itemId: 7 }) === "item-24-2" && Icons.itemKey(ITEM_KEYS, { itemType: 10, itemId: 7 }) === null
    && Icons.itemKey(ITEM_KEYS, { id: 99999 }) === null && Icons.itemKey(null, { id: 7 }) === null);
  const iconFile = (key, size) => path.join(root, "assets", "icons", size, key + ".png");
  const equipKeys = [];
  EQUIP_DATA.classes.concat(["head", "chest", "arms", "waist", "legs"]).forEach((t) => Icons.EQUIP_COLOURS.forEach((c, i) => equipKeys.push(t + "-" + i)));
  const missing = equipKeys.concat(Object.values(ITEM_KEYS)).filter((k) => !fs.existsSync(iconFile(k, "1x")) || !fs.existsSync(iconFile(k, "2x")));
  check("every equipment and item icon has its 1x and 2x file", missing.length === 0, missing.slice(0, 5).join(","));
  check("data covers the server's ids", EQUIP_DATA.head.length >= 14595 && EQUIP_DATA.melee.length / 2 >= 15334 && EQUIP_DATA.ranged.length / 2 >= 4224);

  await new Promise((resolve) => server.listen(0, resolve));
  const browser = await chromium.launch();
  try {
    // page tabs; nothing loads before the Characters tab is shown
    let s = await open(browser, {}, 1280, "#overview");
    check("no Storage tab", (await count(s.page, "#tab-storage, #panel-storage")) === 0);
    check("no Details tab", (await count(s.page, "#tab-details, #panel-details")) === 0);
    await s.page.waitForTimeout(300);
    check("no character calls before the tab opens", s.calls.length === 0, s.calls.join(","));
    await s.page.waitForSelector("#gifts-body .gift-row");
    check("gift rows have icons", (await count(s.page, "#gifts-body .gift-row .gi img")) === 2);
    check("gift without a picture: placeholder", (await s.page.$$eval("#gifts-body .gi img", (n) => n.map((i) => i.getAttribute("src"))))[1] === Icons.FALLBACK);
    await s.page.click("#tab-characters");
    await s.page.waitForSelector("#details-body .stat-grid");
    check("both load once", s.calls.slice().sort().join(",") === "details 10,storage 10", s.calls.join(","));
    const cardHref = await s.page.$eval("#characters-body tr .cell-name a", (a) => a.getAttribute("href"));
    check("name links to the hunter card", cardHref === "/hunters.html?id=10", cardHref);
    check("each row has View", (await count(s.page, "#characters-body [data-details-id]")) === 2);
    check("card link", (await s.page.$eval("#details-card-link", (a) => a.getAttribute("href"))) === "/hunters.html?id=10");
    check("section counts", (await text(s.page, '#details-sections [data-count="itembox"]')) === "4"
      && (await text(s.page, '#details-sections [data-count="equipbox"]')) === "5");

    // Overview
    const overview = await text(s.page, "#details-body");
    ["1,307 h 40 min", "3,392", "14,312", "Test Guild (Leader)", "5,600", "Female", "HL 4 / EX 9", "64 bytes stored"]
      .forEach((v) => check("overview shows " + v, overview.includes(v)));
    check("overview hunter card link", (await s.page.$eval("#details-body a[href^='/hunters.html']", (a) => a.getAttribute("href"))) === "/hunters.html?id=10");
    check("admin box hidden for players", await s.page.$eval("#details-admin-form", (n) => n.hidden));
    await shot(s.page, "character-overview-1280.png");

    // Equipment
    await section(s.page, "equipment", "#details-body .detail-piece");
    check("six slots", (await count(s.page, "#details-body .detail-piece")) === 6);
    const names = await s.page.$$eval("#details-body .detail-name", (n) => n.map((x) => x.textContent));
    check("names in slot order", JSON.stringify(names) === JSON.stringify(["Iron Katana", "Leather Helm", "Chest piece #515", "Test Arms", "Empty", "Test Greaves"]), JSON.stringify(names));
    const equipment = await text(s.page, "#details-body");
    check("armour level shown", equipment.includes("Lv 7"));
    check("sigil shown", equipment.includes("Poison Sigil"));
    check("weapon class and rarity", equipment.includes("Long Sword · Rare 1"));
    check("weapon upgrade not shown as a level", !equipment.includes("Lv 100"));
    const pieceIcons = await s.page.$$eval("#details-body .detail-piece-head .gi", (n) => n.map((g) => g.querySelector("img")
      ? g.querySelector("img").getAttribute("src") : g.className));
    check("piece icons", JSON.stringify(pieceIcons) === JSON.stringify([icon("long-sword-0"), icon("head-0"), icon("chest-4"), icon("arms-4"),
      "gi gi-empty", icon("legs-4")]), JSON.stringify(pieceIcons));
    check("1x and 2x files in srcset, shown at 40 px", (await s.page.$eval("#details-body .detail-piece .gi img", (i) => i.getAttribute("srcset") + " " + i.getAttribute("sizes")))
      === "/assets/icons/1x/long-sword-0.png 32w, /assets/icons/2x/long-sword-0.png 64w 40px");
    check("decoration icons", (await count(s.page, "#details-body .detail-decos .gi img")) === 4);
    check("equipment: pictures load", (await brokenImages(s.page)).length === 0, (await brokenImages(s.page)).join(","));
    await shot(s.page, "character-equipment-1280.png");

    // Loadouts
    await section(s.page, "loadouts", "#details-body .detail-set");
    check("two sets", (await count(s.page, "#details-body .detail-set")) === 2);
    check("set name", (await s.page.$$eval("#details-body .detail-set-name", (n) => n.map((x) => x.textContent))).includes("GOD LS"));
    check("set weapon icon", (await count(s.page, "#details-body .detail-set-weapon .gi")) === 2);
    await s.page.$$eval("#details-body details", (n) => n.forEach((d) => { d.open = true; }));
    const sets = await text(s.page, "#details-body");
    check("piece gone from the box", sets.includes("No longer in the box"));
    check("cuffs", sets.includes("Skill Slots Up PZ51"));
    check("set decoration", sets.includes("Attack 2 Deco"));
    check("heavy bowgun rare 12", sets.includes("Heavy Bowgun · Rare 12"));

    // Item box: the grid
    await section(s.page, "itembox", "#details-body .mbox-grid");
    check("100 slots", (await count(s.page, "#details-body .mbox-grid .slot")) === 100);
    check("10 pages", (await count(s.page, "#details-body .mbox-tab")) === 10);
    check("filled slots", (await count(s.page, "#details-body .mbox-grid .slot.filled")) === 3);
    check("slot icon and count", (await s.page.$eval("#details-body .slot.filled", (n) => n.querySelector("img").getAttribute("src") + " " + n.querySelector(".qty").textContent)) === icon("item-24-2") + " 10");
    await s.page.click("#details-body .slot.filled");
    check("preview", (await text(s.page, "#details-body .preview")).includes("Potion") && (await text(s.page, "#details-body .preview")).includes("x10"));
    await s.page.fill("#char-search-itembox", "akantor");
    await s.page.waitForFunction(() => document.querySelector('#details-body .mbox-tab[aria-pressed="true"]').textContent.startsWith("3"));
    check("search jumps to the page", (await count(s.page, "#details-body .slot.match")) === 1);
    check("missing picture file: placeholder", (await s.page.$eval("#details-body .slot.match img", (i) => new Promise((r) => setTimeout(() => r(i.getAttribute("src")), 300)))) === Icons.FALLBACK);
    await s.page.fill("#char-search-itembox", "");
    await shot(s.page, "character-itembox-1280.png");
    // the list
    await s.page.click('#details-body [data-view="list"]');
    await s.page.waitForSelector("#details-body .char-items");
    check("list rows", (await count(s.page, "#details-body .char-item")) === 4);
    const firstRow = await text(s.page, "#details-body .char-item");
    check("list row: name, place, count", firstRow.includes("Potion") && firstRow.includes("page 1, slot 1") && firstRow.includes("x10"), firstRow);
    check("unnamed item", (await text(s.page, "#details-body .char-items")).includes("Item #99999"));
    await s.page.fill("#char-search-itembox", "mega");
    check("list search", (await count(s.page, "#details-body .char-item")) === 1);
    await s.page.fill("#char-search-itembox", "");
    check("item box: pictures load", (await brokenImages(s.page)).length === 0, (await brokenImages(s.page)).join(","));

    // Pouch and Warehouse
    await section(s.page, "pouch", "#details-body .char-item");
    check("pouch rows", (await count(s.page, "#details-body .char-item")) === 2);
    check("pouch slot", (await text(s.page, "#details-body .char-items")).includes("slot 4 of 40"));
    await s.page.fill("#char-search-pouch", "dash");
    check("pouch search", (await count(s.page, "#details-body .char-item")) === 1);
    await section(s.page, "warehouse", "#details-body .char-item");
    check("warehouse row", (await text(s.page, "#details-body .char-item")).includes("Dash Juice"));
    check("warehouse icon", (await s.page.$eval("#details-body .char-item img", (i) => i.getAttribute("src"))) === icon("item-24-4"));

    // Equipment box
    await section(s.page, "equipbox", ".detail-box-table tbody tr");
    check("box rows", (await count(s.page, ".detail-box-table tbody tr")) === 5);
    check("box row icons", (await count(s.page, ".detail-box-table tbody .gi-equip")) === 5);
    const boxText = await text(s.page, ".detail-box-table tbody");
    check("box class and rarity", boxText.includes("Long Sword") && boxText.includes("Bow") && boxText.includes("Rare 4"), boxText);
    await s.page.click('#details-body .chip[data-filter="head"]');
    check("head filter", (await count(s.page, ".detail-box-table tbody tr")) === 1);
    await s.page.click('#details-body .chip[data-filter="all"]');
    await s.page.fill("#details-box-search", "poison");
    check("search by decoration", (await count(s.page, ".detail-box-table tbody tr")) === 1);
    await s.page.fill("#details-box-search", "waist piece #768");
    check("search unknown name", (await count(s.page, ".detail-box-table tbody tr")) === 1);
    await s.page.fill("#details-box-search", "bow");
    check("search by class", (await count(s.page, ".detail-box-table tbody tr")) === 2); // Bow and Heavy Bowgun
    await s.page.fill("#details-box-search", "");
    await shot(s.page, "character-equipbox-1280.png");

    // View on the second row: the character without a save
    await s.page.click('#characters-body [data-details-id="11"]');
    await s.page.waitForFunction(() => document.getElementById("details-note").textContent === "Bexo");
    check("view link picks the character", (await s.page.$eval("#details-character", (n) => n.value)) === "11");
    await section(s.page, "equipment");
    check("no save note", (await text(s.page, "#details-body")).includes("no save yet"));
    await section(s.page, "pouch");
    check("empty pouch", (await text(s.page, "#details-body")).includes("Nothing here."));
    check("no page errors", s.errors.length === 0, s.errors.join("; "));
    await s.ctx.close();

    // old addresses
    s = await open(browser, {}, 1280, "#storage");
    await s.page.waitForSelector("#details-body .mbox-grid, #details-body .char-items");
    check("#storage lands on the item box", !(await s.page.$eval("#panel-characters", (n) => n.hidden))
      && (await s.page.$eval('#details-sections [data-section="itembox"]', (n) => n.getAttribute("aria-pressed"))) === "true");
    await s.ctx.close();
    s = await open(browser, {}, 1280, "#details");
    await s.page.waitForSelector("#details-body .stat-grid");
    check("#details lands on the overview", s.calls.slice().sort().join(",") === "details 10,storage 10", s.calls.join(","));
    await s.ctx.close();

    // API without /details: the boxes still work
    s = await open(browser, { missing: true }, 1280, "#characters");
    await s.page.waitForSelector("#details-sections:not([hidden])");
    check("missing: no alert", await s.page.$eval("#details-alert", (n) => n.hidden));
    check("missing: overview from the list and storage", (await text(s.page, "#details-body")).includes("coming soon")
      && (await text(s.page, "#details-body")).includes("3,392"));
    await section(s.page, "equipment");
    check("missing: equipment coming soon", (await text(s.page, "#details-body")).includes("coming soon"));
    await section(s.page, "itembox", "#details-body .slot.filled, #details-body .char-item");
    check("missing: no page errors", s.errors.length === 0, s.errors.join("; "));
    await s.ctx.close();

    // admin
    s = await open(browser, { admin: true }, 1280, "#characters");
    await s.page.waitForSelector("#details-admin-form:not([hidden])");
    await s.page.fill("#details-admin-id", "20");
    await s.page.click("#details-admin-form button");
    await s.page.waitForFunction(() => document.getElementById("details-note").textContent.includes("Stranger"));
    check("admin view marked", (await text(s.page, "#details-note")).includes("admin view"));
    check("no storage call for another account", !s.calls.includes("storage 20"), s.calls.join(","));
    await section(s.page, "itembox");
    check("admin: item lists for own characters only", (await text(s.page, "#details-body")).includes("your own characters only"));
    await s.page.fill("#details-admin-id", "99");
    await s.page.click("#details-admin-form button");
    await s.page.waitForSelector("#details-alert:not([hidden])");
    check("unknown id", (await text(s.page, "#details-alert")).includes("No character with id 99"));
    await s.ctx.close();

    // phone
    s = await open(browser, {}, 375, "#characters");
    await s.page.waitForSelector("#details-body .stat-grid");
    for (const name of Helpers.SECTIONS) {
      await section(s.page, name);
      await s.page.waitForTimeout(150);
      if (name === "itembox") check("phone: item box opens as a list", (await count(s.page, "#details-body .char-items")) === 1);
      // The character view: nothing in it reaches past the screen (tables and chip rows scroll inside
      // their own box). The whole page is not measured: the site nav's Menu button is 17 px too wide at
      // 375 px on every page (not this view's doing; check-account-transfer.js reports it too).
      const wide = await s.page.evaluate(() => {
        let right = 0;
        document.querySelectorAll("#details-live *, #details-body *").forEach((n) => {
          for (let up = n.parentElement; up && up.id !== "panel-characters"; up = up.parentElement) {
            if (/auto|scroll/.test(getComputedStyle(up).overflowX)) return;
          }
          const box = n.getBoundingClientRect();
          if (box.width) right = Math.max(right, box.right);
        });
        return Math.round(right);
      });
      check("375 px " + name + " fits", wide <= 375, String(wide));
      await shot(s.page, "character-" + name + "-375.png");
    }
    check("phone: no page errors", s.errors.length === 0, s.errors.join("; "));
    check("no page error box", await s.page.$eval("#account-error", (n) => n.hidden));
    await s.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length) {
    console.log("account character view: " + failures.length + " problem(s)");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("account character view OK");
}

run().catch((error) => { console.error(error); process.exit(1); });
