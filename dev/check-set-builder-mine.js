#!/usr/bin/env node
/* Checks the Set builder's "my character" part (js/armor-owned.js, js/set-builder-mine.js, its hooks in
   js/set-builder.js) against a fake API whose answers have the exact shapes of the API's DTOs (hvmhfz_rest_api
   branch armor-import, builder/BuilderDtos.java: Import, MySet, OwnedPiece as an array, Missing, PieceNeed, Step,
   Mat, ItemNeed, MaterialNeed, Zenny; errors of /missing are {"error"}). The fake /missing refuses any body the
   API's BuilderSet.parse would refuse (validateSet below is a port of it).

   Under node:
   - cross-check of the set format: ArmorCalc.normalize writes exactly the strings the API's BuilderSetFormatTests
     reads (change both together);
   - ArmorOwned: a worn set, a My Set with a piece that left the box (lost), weapon classes from data/weapons/ids.json,
     owned levels and item counts, the /missing body (data = the page's mhfdat SHA-256 prefix, levels capped, null
     when there is nothing to count).
   In headless Chromium at 1280 and 390 px:
   - signed out: a sign-in link that comes back to the page; no Missing panel; no API call for characters;
   - signed in: the character list, picking one loads its import (with the sign-in header), the facts line, the
     in-game warning; the choice is remembered over a reload; Refresh asks again;
   - Load: the worn set and a My Set land in the address as the set format; the lost-piece note;
   - "Only what I own": the head, chest, weapon, decoration and cuff pickers (sigils only on Tower weapons) list
     only owned things with their counts; picking an owned piece takes its owned level; the owned badge;
   - Missing: the POST body is the set format the API reads, the pieces with status and steps, the item and material
     tables with links to item pages and sources, zenny with the incomplete note, the API's notes; a changed set says
     to check again; the API's {"error"} is shown;
   - no sideways scrolling, no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules [SHOTS=<folder>] node dev/check-set-builder-mine.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const Calc = require("../js/armor-calc.js");
const Owned = require("../js/armor-owned.js");

const ROOT = path.join(__dirname, "..");
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/* ---- real ids from the site's data ---- */
const index = readJson("data/armor/index.json");
const weaponIds = readJson("data/weapons/ids.json");
const SHA12 = index.source.mhfdatSha256.slice(0, 12);
const byName = (slot, name) => readJson("data/armor/" + slot + ".json").pieces.find((p) => p[1] === name);
const HELM = byName("head", "Rathalos Helm");      // 29, max level 7, 2 slots at level 7
const MAIL = byName("chest", "Rathalos Mail");      // 32
const GREAVES = byName("legs", "Rathalos Greaves"); // 33
const deco = (name) => index.decorations.find((d) => d[1] === name);
const ATTACK_G = deco("Attack G")[0];   // 5100, 1 slot
const SNS_G = deco("SnS・G")[0];        // 16161, cuff
const SNS_BASIC = deco("SnS・Basic")[0];
const SIGIL = index.sigils[0][0];
const KATANA = 31;                      // Black Katana Mk.Ⅲ, long sword (class 7), 3 slots

/* ---- cross-check: the same strings as the API's BuilderSetFormatTests ---- */
const SITE_FULL = "{\"v\":1,\"data\":\"v1.29\",\"weapon\":[7,31,[],[5100]],\"armour\":[[\"head\",29,7,[5100]],"
  + "[\"chest\",0,1,[]],[\"arms\",0,1,[]],[\"waist\",0,1,[]],[\"legs\",0,1,[]]],\"cuffs\":[16161]}";
const SITE_ANY_BOW = "{\"v\":1,\"data\":\"\",\"weapon\":[10,0,[],[]],\"armour\":[[\"head\",0,1,[]],"
  + "[\"chest\",0,1,[]],[\"arms\",0,1,[]],[\"waist\",0,1,[]],[\"legs\",1003,3,[]]],\"cuffs\":[]}";
const SITE_HBG = "{\"v\":1,\"data\":\"\",\"weapon\":[1,12,[],[]],\"armour\":[[\"head\",0,1,[]],"
  + "[\"chest\",0,1,[]],[\"arms\",0,1,[]],[\"waist\",0,1,[]],[\"legs\",0,1,[]]],\"cuffs\":[]}";
const SITE_EMPTY = "{\"v\":1,\"data\":\"\",\"weapon\":[-1,0,[],[]],\"armour\":[[\"head\",0,1,[]],"
  + "[\"chest\",0,1,[]],[\"arms\",0,1,[]],[\"waist\",0,1,[]],[\"legs\",0,1,[]]],\"cuffs\":[]}";
check("format: full set as the API test reads it", JSON.stringify(Calc.normalize({ v: 1, data: "v1.29", weapon: [7, 31, [], [5100]],
  armour: [["head", 29, 7, [5100]]], cuffs: [16161] })) === SITE_FULL);
check("format: any bow", JSON.stringify(Calc.normalize({ weapon: [10, 0, [], []], armour: [["legs", 1003, 3, []]] })) === SITE_ANY_BOW);
check("format: heavy bowgun", JSON.stringify(Calc.normalize({ weapon: [1, 12, [], []] })) === SITE_HBG);
check("format: empty", JSON.stringify(Calc.empty()) === SITE_EMPTY);

/* A port of the API's BuilderSet.parse (armor-import, builder/BuilderSet.java): the error it would give, or null. */
function validateSet(body) {
  const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const itemList = (v, max) => v === undefined || v === null || (Array.isArray(v) && v.length <= max && v.every((x) => x === null || x === 0 || whole(x, 1, 0xFFFF)));
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The set must be a JSON object.";
  if (body.v !== undefined && body.v !== null && body.v !== 1) return "v";
  let pieces = 0;
  const w = body.weapon;
  if (w !== undefined && w !== null) {
    if (!Array.isArray(w) || w.length < 2) return "weapon shape";
    const kindOk = w[0] === "melee" || w[0] === "ranged" || whole(w[0], -1, 13);
    if (!kindOk) return "weapon class";
    if (!whole(w[1], 0, 0xFFFF)) return "weapon id";
    if (w.length > 2 && w[2] !== null && !(Array.isArray(w[2]) ? w[2].length <= 16 && w[2].every((x) => whole(x, 0, 999)) : whole(w[2], 0, 999))) return "extra levels";
    if (w.length > 3 && !itemList(w[3], 3)) return "weapon decorations";
    if (w[0] !== -1 && w[1] !== 0) pieces++;
  }
  const armour = body.armour !== undefined ? body.armour : body.pieces;
  if (armour !== undefined && armour !== null) {
    if (!Array.isArray(armour) || armour.length > 5) return "armour shape";
    const seen = {};
    for (const a of armour) {
      if (!Array.isArray(a) || a.length < 2) return "armour piece shape";
      if (["head", "chest", "arms", "waist", "legs"].indexOf(a[0]) === -1) return "armour slot";
      if (seen[a[0]]) return "armour slot twice";
      seen[a[0]] = true;
      if (!whole(a[1], 0, 0xFFFF)) return "armour id";
      if (a.length > 2 && a[2] !== null && !whole(a[2], 1, 7)) return "armour level";
      if (a.length > 3 && !itemList(a[3], 3)) return "armour decorations";
      if (a[1]) pieces++;
    }
  }
  for (const k of ["cuffs", "sigils", "towerDecos"]) if (!itemList(body[k], 10)) return k;
  const items = ["cuffs", "sigils", "towerDecos"].some((k) => Array.isArray(body[k]) && body[k].some((x) => x));
  return pieces || items ? null : "The set is empty.";
}
check("port: the site's sets pass", [SITE_FULL, SITE_ANY_BOW, SITE_HBG].every((s) => validateSet(JSON.parse(s)) === null));
check("port: the empty set is refused", validateSet(JSON.parse(SITE_EMPTY)) === "The set is empty.");

/* ---- the fake API's data: DTO shapes (records as objects, OwnedPiece as an array) ---- */
const CHARS = [{ id: 5, name: "Aldric", hr: 999, gr: 120, weaponType: "Long Sword", female: true, lastLogin: null, gcp: 0,
  kouryouPoints: 0, dailyQuests: 0, guildId: null, guildName: null, guildRank: null },
  { id: 6, name: "Brenna", hr: 5, gr: 0, weaponType: "Bow", female: false, lastLogin: null, gcp: 0, kouryouPoints: 0,
    dailyQuests: 0, guildId: null, guildName: null, guildRank: null }];
function importFor(id, online) {
  // Import(id, name, hr, gr, weaponType, female, hasSave, saveVersion, online, dataVersion, zenny, hunting, town,
  //        townOn, mySets, mySetsNotDecoded, owned, items, box, pouch, warehouse, inEquipment)
  return { id, name: id === 5 ? "Aldric" : "Brenna", hr: 999, gr: 120, weaponType: "Long Sword", female: true, hasSave: true,
    saveVersion: "abc123", online: !!online, dataVersion: "b2e5ef04465b", zenny: 123456,
    hunting: [["melee", KATANA, null, [SIGIL], 0], ["head", HELM[0], 7, [ATTACK_G], 1]],
    town: [],
    townOn: false,
    mySets: [{ number: 1, name: "GOD LS", pieces: [["melee", KATANA, null, [], 0], ["chest", MAIL[0], 3, [], 2], ["legs", null, null, [], 9]],
               cuffs: [SNS_G, 0] }],
    mySetsNotDecoded: null,
    owned: [["melee", KATANA, null, [SIGIL], 0], ["head", HELM[0], 7, [ATTACK_G], 1], ["chest", MAIL[0], 3, [], 2]],
    items: { [ATTACK_G]: 2, [SNS_G]: 1, 216: 10 }, box: { [ATTACK_G]: 2, 216: 10 }, pouch: { [SNS_G]: 1 }, warehouse: {},
    inEquipment: { [ATTACK_G]: 1, [SIGIL]: 1 } };
}
const MISSING = {
  characterId: 5, saveVersion: "abc123", online: false, dataVersion: "b2e5ef04465b", dataMatches: false,
  pieces: [
    { slot: "melee", id: KATANA, name: "Black Katana Mk.Ⅲ", level: 1, status: "owned",
      owned: { slot: "melee", id: KATANA, name: "Black Katana Mk.Ⅲ", level: null, boxIndex: 0 }, from: null, obtainable: true, sources: "craft: create", steps: [] },
    { slot: "chest", id: MAIL[0], name: "Rathalos Mail", level: 7, status: "level-up",
      owned: { slot: "chest", id: MAIL[0], name: "Rathalos Mail", level: 3, boxIndex: 2 }, from: null, obtainable: true, sources: null,
      steps: [{ action: "level", slot: "chest", id: MAIL[0], name: "Rathalos Mail", from: null, fromName: null, fromLevel: 3, toLevel: 4,
                mats: [{ id: 13057, name: "Armour Sphere", qty: 2 }], zenny: null }] },
    { slot: "legs", id: GREAVES[0], name: "Rathalos Greaves", level: 1, status: "craft", owned: null, from: null, obtainable: true,
      sources: "craft: create", steps: [{ action: "create", slot: "legs", id: GREAVES[0], name: "Rathalos Greaves", from: null, fromName: null,
        fromLevel: null, toLevel: null, mats: [{ id: 216, name: "Iron Ore", qty: 12 }, { id: 990, name: "Fire <b>Wyvern</b> Scale", qty: 1 }], zenny: 1500 }] }
  ],
  items: [{ id: ATTACK_G, name: "Attack G", kind: "decoration", need: 3, inPlace: 1, fromBoxes: 1, inOtherEquipment: 0, missing: 1,
            recipe: { system: "deco", price: null, currency: null, mats: [{ id: 700, name: "Gem Stone", qty: 2 }] }, obtainable: true, sources: "quest reward" },
          { id: SNS_BASIC, name: "SnS・Basic", kind: "cuff", need: 1, inPlace: 0, fromBoxes: 0, inOtherEquipment: 0, missing: 1, recipe: null,
            obtainable: true, sources: "shop: Road" }],
  materials: [{ id: 216, name: "Iron Ore", need: 12, have: 10, missing: 2, obtainable: true, sources: "gathering: Mines" },
              { id: 700, name: "Gem Stone", need: 2, have: 0, missing: 2, obtainable: true, sources: "monster: Kelbi carve" },
              { id: 990, name: "Fire <b>Wyvern</b> Scale", need: 1, have: 0, missing: 1, obtainable: false, sources: null },
              { id: 13057, name: "Armour Sphere", need: 2, have: 2, missing: 0, obtainable: true, sources: "quest reward" }],
  zenny: { need: 1500, have: 123456, missing: 0, complete: false },
  notes: ["The set was made with game data " + SHA12 + "; the server has b2e5ef04465b.", "Level-up zenny costs are not in the data: the zenny total leaves them out."]
};

/* ---- ArmorOwned under node ---- */
const classOf = Owned.classFinder(weaponIds);
check("owned: Black Katana is a long sword", classOf("melee", KATANA) === 7);
check("owned: unknown id is -1", classOf("melee", 999999) === -1 && classOf("ranged", 0) === -1);
const imp = importFor(5);
const worn = Owned.setFromPieces(imp.hunting, [], classOf);
check("owned: worn set", same(Calc.normalize(worn.set).weapon, [7, KATANA, [], [SIGIL]]) && same(worn.set.armour[0], ["head", HELM[0], 7, [ATTACK_G]]) && worn.lost === 0);
const my = Owned.setFromPieces(imp.mySets[0].pieces, imp.mySets[0].cuffs, classOf);
check("owned: My Set with a lost piece", my.lost === 1 && same(my.set.armour[1], ["chest", MAIL[0], 3, []]) && same(my.set.cuffs, [SNS_G]) && my.set.armour[4][1] === 0);
const inv = Owned.inventory(imp, classOf);
check("owned: inventory levels", inv.pieces.head[HELM[0]] === 7 && inv.pieces.chest[MAIL[0]] === 3 && inv.weapons[7][KATANA] === true);
check("owned: item counts", inv.items[ATTACK_G].have === 2 && inv.items[ATTACK_G].inEquipment === 1 && Owned.ownsItem(inv, SIGIL) && !Owned.ownsItem(inv, SNS_BASIC));
check("owned: uses in set", Owned.usesInSet(Calc.normalize({ weapon: [7, 31, [], [5100]], armour: [["head", 29, 7, [5100, 5100]]], cuffs: [5100] }), 5100) === 4);
const body = Owned.missingBody(Calc.normalize({ weapon: [7, 31, [], []], armour: [["head", 29, 99, []]] }), index.source.mhfdatSha256, () => 7);
check("owned: missing body", body && body.data === SHA12 && body.armour[0][2] === 7 && validateSet(body) === null, JSON.stringify(body));
check("owned: nothing to count", Owned.missingBody(Calc.empty(), "x", () => 7) === null && Owned.missingBody(Calc.normalize({ weapon: [7, 0, [], []] }), "x", () => 7) === null);

/* ---- the page ---- */
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(ROOT)) { res.writeHead(404); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "HS256" }) + "." + b64({ sub: "hunter1", exp }) + ".sig";
}
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };

function fakeApi(page, api) {
  return page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, b) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: b === undefined ? "" : JSON.stringify(b) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    api.calls.push({ method: req.method(), path: p, body: sent, auth: req.headers().authorization || "" });
    if (p.startsWith("/api/account") && req.headers().authorization !== "Bearer " + TOKEN) return reply(401);
    let m;
    if (p === "/api/account/characters") return reply(200, CHARS);
    if ((m = p.match(/^\/api\/account\/characters\/(\d+)\/builder$/))) {
      const id = Number(m[1]);
      return CHARS.some((c) => c.id === id) ? reply(200, importFor(id, api.online)) : reply(404);
    }
    if ((m = p.match(/^\/api\/account\/characters\/(\d+)\/builder\/missing$/))) {
      const why = validateSet(sent);
      if (why) return reply(400, { error: "fake API refused: " + why });
      if (api.refuse) return reply(400, { error: api.refuse });
      return reply(200, MISSING);
    }
    if (p === "/api/public/armor-sets/options") return reply(200, { bands: [{ key: "hr1", label: "HR1" }], stages: [{ key: "", label: "Any" }], data: index.version, maxTitle: 60, maxNotes: 1000, maxReason: 300 });
    return reply(404, { message: "not in the fake API" });
  });
}

async function run(chromium) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const view of [{ name: "desktop", width: 1280, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
      const V = view.name;
      const api = { calls: [], online: false, refuse: null };

      // signed out
      let ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
      let pg = await ctx.newPage();
      let errors = [];
      pg.on("pageerror", (e) => errors.push(e.message));
      await fakeApi(pg, api);
      await pg.addInitScript(() => { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
      await pg.goto(base + "/set-builder.html", { waitUntil: "load" });
      await pg.waitForSelector("#sb-app[data-ready]");
      await pg.waitForSelector("#sb-mine-signin");
      check(V + " signed out: sign-in link comes back", (await pg.getAttribute("#sb-mine-signin", "href")).indexOf("next=%2Fset-builder.html") !== -1);
      check(V + " signed out: no Missing panel", await pg.isHidden("#sb-missing"));
      check(V + " signed out: no character call", !api.calls.some((c) => c.path === "/api/account/characters"));
      check(V + " signed out: no page errors", !errors.length, errors.join(" | "));
      await ctx.close();

      // signed in
      ctx = await browser.newContext({ viewport: { width: view.width, height: view.height } });
      pg = await ctx.newPage();
      errors = [];
      pg.on("pageerror", (e) => errors.push(e.message));
      await fakeApi(pg, api);
      await pg.addInitScript((t) => {
        localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
        localStorage.setItem("hvmhfz.token", t);
      }, TOKEN);
      async function pick(focusKey, exact) {
        await pg.click('[data-focus="' + focusKey + '"]');
        await pg.waitForSelector(".bui-pop:not([hidden])");
        await pg.click('.bui-pop .bui-option:has(.bui-name:text-is("' + exact + '"))');
        await pg.waitForFunction(() => document.querySelector(".bui-pop").hidden);
      }
      async function optionsOf(focusKey) {
        await pg.click('[data-focus="' + focusKey + '"]');
        await pg.waitForSelector(".bui-pop:not([hidden]) .bui-option");
        const out = await pg.evaluate(() => Array.from(document.querySelectorAll(".bui-pop .bui-option")).map((li) =>
          ({ name: li.querySelector(".bui-name").textContent, hint: (li.querySelector(".bui-hint") || {}).textContent || "" })));
        await pg.keyboard.press("Escape");
        await pg.waitForFunction(() => document.querySelector(".bui-pop").hidden);
        return out;
      }
      const setInAddress = () => pg.evaluate(() => location.hash).then((h) => Calc.decode(/s=([A-Za-z0-9_-]+)/.exec(h)[1]));
      async function noSideways(what) {
        const over = await pg.evaluate(() => {
          const m = document.querySelector("main") || document.body;
          return Math.max(m.scrollWidth - m.clientWidth, Math.ceil(m.getBoundingClientRect().right - document.documentElement.clientWidth));
        });
        check(V + " " + what + ": no sideways scrolling", over <= 0, over + " px");
      }

      await pg.goto(base + "/set-builder.html", { waitUntil: "load" });
      await pg.waitForSelector('[data-focus="mine|char"]');
      check(V + " no character until picked", !api.calls.some((c) => /\/builder$/.test(c.path)));
      api.online = true;
      await pick("mine|char", "Aldric");
      await pg.waitForSelector(".sb-mine-facts");
      const call = api.calls.find((c) => c.path === "/api/account/characters/5/builder");
      check(V + " import asked with sign-in", call && call.auth === "Bearer " + TOKEN);
      check(V + " facts line", /Aldric · GR 120 · 123,456 zenny · 3 pieces/.test(await pg.textContent(".sb-mine-facts")));
      check(V + " in-game warning", await pg.isVisible("#sb-mine-online"));
      check(V + " Missing panel shows", await pg.isVisible("#sb-missing-check"));

      // Load the worn set, then the My Set
      await pick("mine|load", "Worn set");
      await pg.waitForSelector("#sb-mine-loaded");
      let s = await setInAddress();
      check(V + " worn set in the address", same(s.weapon, [7, KATANA, [], [SIGIL]]) && same(s.armour[0], ["head", HELM[0], 7, [ATTACK_G]]), JSON.stringify(s));
      await pick("mine|load", "My Set 1: GOD LS");
      await pg.waitForFunction(() => /no longer in your equipment box/.test(document.getElementById("sb-mine-loaded").textContent));
      s = await setInAddress();
      check(V + " My Set in the address", same(s.armour[1], ["chest", MAIL[0], 3, []]) && s.armour[0][1] === 0 && same(s.cuffs, [SNS_G]), JSON.stringify(s));
      await noSideways("loaded");

      // Only what I own
      await pg.check("#sb-owned-only");
      await pg.waitForSelector("#sb-owned-only:checked");
      let opts = await optionsOf("head|piece");
      check(V + " owned heads only", same(opts.map((o) => o.name), ["Nothing", "Rathalos Helm"]), JSON.stringify(opts.map((o) => o.name)));
      check(V + " owned level in the hint", /yours: Lv 7/.test(opts[1].hint));
      opts = await optionsOf("weapon|id");
      check(V + " owned weapons only", same(opts.map((o) => o.name), ["Any Long Sword", "Black Katana Mk.Ⅲ"]), JSON.stringify(opts.map((o) => o.name)));
      opts = await optionsOf("cuff|0");
      check(V + " owned cuffs only", same(opts.map((o) => o.name), ["No cuff", "SnS・G"]) && /yours: 1 in boxes/.test(opts[1].hint), JSON.stringify(opts));
      opts = await optionsOf("weapon|deco|0");
      const names = opts.map((o) => o.name);
      // a Long Sword is not a Tower weapon: the owned sigil is not offered (Tower sigils go only on Tower weapons)
      check(V + " owned decorations only, no sigils on a non-Tower weapon", same(names, ["Empty slot", "Attack G"]), JSON.stringify(names));
      const ag = opts.find((o) => o.name === "Attack G");
      check(V + " decoration counts with in-use", ag && /yours: 2 in boxes · 1 set in gear/.test(ag.hint), ag && ag.hint);
      // Pick the owned head: its owned level, the owned badge
      await pick("head|piece", "Rathalos Helm");
      await pg.waitForSelector('.sb-slot[data-slot="head"] [data-owned="7"]');
      s = await setInAddress();
      check(V + " owned piece at its level", s.armour[0][2] === 7);
      check(V + " chest kept its level 3 and says yours", (await pg.getAttribute('.sb-slot[data-slot="chest"] [data-owned]', "data-owned")) === "3");

      // Missing
      await pg.click("#sb-missing-check");
      await pg.waitForSelector(".sb-missing-pieces");
      const post = api.calls.filter((c) => /\/missing$/.test(c.path)).pop();
      check(V + " missing body is the set format", post && post.body.data === SHA12 && validateSet(post.body) === null && post.body.weapon[0] === 7, post && JSON.stringify(post.body));
      const shown = await pg.evaluate(() => ({
        pieces: document.querySelectorAll(".sb-missing-pieces tbody tr").length,
        steps: Array.from(document.querySelectorAll(".sb-steps li")).map((li) => li.textContent),
        status: Array.from(document.querySelectorAll(".sb-missing-pieces tbody tr")).map((tr) => tr.children[2].textContent),
        items: document.querySelectorAll(".sb-missing-items tbody tr").length,
        mats: Array.from(document.querySelectorAll(".sb-missing-mats tbody tr")).map((tr) => tr.textContent),
        matLinks: Array.from(document.querySelectorAll(".sb-missing-mats a")).map((a) => a.getAttribute("href")),
        zenny: document.getElementById("sb-missing-zenny").textContent,
        notes: document.getElementById("sb-missing-notes").textContent,
        bold: document.querySelectorAll("#sb-missing b").length
      }));
      check(V + " three pieces", shown.pieces === 3);
      check(V + " statuses", /You have it/.test(shown.status[0]) && /Level up from Lv 3/.test(shown.status[1]) && /Craft/.test(shown.status[2]), JSON.stringify(shown.status));
      check(V + " steps", shown.steps.some((t) => /Level 3 to 4: Armour Sphere x2/.test(t)) && shown.steps.some((t) => /Create Rathalos Greaves: Iron Ore x12, .* x1 · 1,500 zenny/.test(t)), JSON.stringify(shown.steps));
      check(V + " items", shown.items === 2);
      check(V + " materials link item pages with sources", shown.matLinks.indexOf("/item.html?id=216") !== -1 && shown.mats.some((t) => /Iron Ore.*12.*10.*2.*gathering: Mines/.test(t)), JSON.stringify(shown.mats));
      check(V + " unobtainable marked", shown.mats.some((t) => /not obtainable/.test(t)));
      check(V + " markup in names stays text", shown.bold === 0);
      check(V + " zenny with the incomplete note", /1,500 needed, 123,456 held, 0 missing/.test(shown.zenny) && /Not complete/.test(shown.zenny), shown.zenny);
      check(V + " API notes shown", /server has b2e5ef04465b/.test(shown.notes));
      await noSideways("missing");
      if (process.env.SHOTS) {
        fs.mkdirSync(process.env.SHOTS, { recursive: true });
        await pg.screenshot({ path: path.join(process.env.SHOTS, V + "-missing.png"), fullPage: true });
      }

      // A change makes the answer stale
      await pick("chest|piece", "Nothing");
      await pg.waitForSelector("#sb-missing-stale");
      // The API's refusal
      api.refuse = "armour: head is in the set twice.";
      await pg.click("#sb-missing-check");
      await pg.waitForFunction(() => /twice/.test((document.querySelector("#sb-missing .form-alert") || {}).textContent || ""));
      api.refuse = null;

      // Remembered over a reload; Refresh asks again
      const before = api.calls.filter((c) => c.path === "/api/account/characters/5/builder").length;
      await pg.reload({ waitUntil: "load" });
      await pg.waitForSelector(".sb-mine-facts");
      await pg.click("#sb-mine-refresh");
      await pg.waitForSelector(".sb-mine-facts");
      const after = api.calls.filter((c) => c.path === "/api/account/characters/5/builder").length;
      check(V + " remembered and refreshed", after >= before + 2, before + " -> " + after);
      await noSideways("end");
      check(V + " signed in: no page errors", !errors.length, errors.join(" | "));
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

let chromium;
try { chromium = require("playwright").chromium; } catch (e) { console.log("needs playwright (NODE_PATH=/root/work/pw-tools/node_modules)"); process.exit(2); }
run(chromium).then(() => {
  failures.forEach((f) => console.log("FAIL " + f));
  console.log(failures.length ? failures.length + " problem(s)" : "set builder (my character) OK");
  process.exit(failures.length ? 1 : 0);
}).catch((e) => { console.log("FAIL " + e.stack); process.exit(1); });
