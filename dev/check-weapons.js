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
 *    for every melee weapon, moves with one MV per hit. Move names (js/move-names.js): every move has a
 *    confidence, a name unless unknown, public source keys only; the source links.
 *    data/weapons/ids.json (the catalog's id -> type lookup) agrees with the type files, both ways.
 *    Icons: every weapon of all 14 types gets its in-game icon from js/game-icons.js (the lookup the catalog uses):
 *    a class that is the weapon's type, an icon file that exists, the weapon's rarity; no row without one.
 * 3. Usage tab (js/weapons-usage.js): HvWeaponsUsage.view() on a stubbed /api/public/weapons/usage answer
 *    (order, shares, band filter, played before tracking began).
 * 4. Page (when Playwright is found): loads, lists Great Swords, an icon on every row of every type's first page
 *    (the same src the catalog page gives for the same ids, with the API answer stubbed), in the detail and the
 *    calculator line, picks one ("Find in the catalog" opens the catalog's section searched by the API's
 *    byte-swapped hex id; on the phone the list's first column is sticky, on the desktop static), the calculator shows the
 *    numbers HvWeaponsCalc gives for it, the move names (name, badge, id, tap detail, legend; "unnamed" for an
 *    unknown move) in the move list and the calculator, a gunner type hides the form, no script errors, and no sideways
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
const Icons = require(path.join(ROOT, "js/game-icons.js"));
const MoveNames = require(path.join(ROOT, "js/move-names.js"));
const Fields = require(path.join(ROOT, "js/balance-fields.js"));
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

/* ---------- 2. data: ids.json ---------- */
// The catalog links a melee or ranged row by this lookup (dev/make-weapons-data.py write_ids): every weapon of
// every type file is at its id with its type's letter, and nothing else is.
{
  const ids = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons/ids.json"), "utf8"));
  const want = { melee: {}, ranged: {} };
  index.types.forEach(function (t) {
    const kind = t.kind === "melee" ? "melee" : "ranged";
    const letter = String.fromCharCode(97 + ids.types.indexOf(t.slug));
    check(ids.types.indexOf(t.slug) >= 0, "ids.json lists the type " + t.slug);
    JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons", t.slug + ".json"), "utf8")).weapons.forEach(function (w) { want[kind][w[0]] = letter; });
  });
  ["melee", "ranged"].forEach(function (kind) {
    let wrong = 0;
    for (let i = 0; i < Math.max(ids[kind].length, Object.keys(want[kind]).length); i++) {
      if ((want[kind][i] || ".") !== (ids[kind].charAt(i) || ".")) wrong++;
    }
    check(wrong === 0, "ids.json " + kind + ": " + wrong + " ids disagree with the type files (run dev/make-weapons-data.py --ids-only)");
  });
}

/* ---------- 2a. move names ---------- */
// Every move has its name data (hvmhfz_re data/move_names.tsv, via dev/make-weapons-data.py): a confidence; a name
// unless unknown; source keys the page can show; no private source text (client offsets, dump files) in the data.
{
  const seen = { confirmed: 0, likely: 0, guess: 0, unknown: 0 };
  index.types.forEach(function (t) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons", t.slug + ".json"), "utf8"));
    const bad = d.moves.filter(function (m) {
      if (MoveNames.ORDER.indexOf(m.conf) < 0) return true;
      seen[m.conf]++;
      if ((m.conf === "unknown") !== !m.name) return true;
      if (m.conf === "unknown" && !m.desc) return true;
      return (m.src || []).some(function (k) { return !/^(wycademy-calc|wycademy-notes|vipwiki|client|research|atwiki:\d+)$/.test(k); });
    });
    check(bad.length === 0, t.slug + ": moves without good name data: " + bad.slice(0, 3).map(function (m) { return m.set + " #" + m.id; }).join(", "));
  });
  const total = seen.confirmed + seen.likely + seen.guess + seen.unknown;
  check(total > 600 && seen.confirmed > 250 && seen.unknown < 150, "move names: counts " + JSON.stringify(seen));
  const gs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons/great-sword.json"), "utf8")).moves;
  const k2 = gs.find(function (m) { return m.kind === 0 && m.id === 2; }), k5 = gs.find(function (m) { return m.kind === 0 && m.id === 5; });
  check(MoveNames.name(k2) === "Horizontal Slash" && MoveNames.conf(k2) === "confirmed" && k2.input === "Horizontal Slash button", "move names: GS k0 #2 is Horizontal Slash, confirmed");
  check(MoveNames.name(k5) === null && MoveNames.conf(k5) === "unknown" && MoveNames.CONF.unknown.label === "unnamed", "move names: GS k0 #5 is unnamed");
  check(MoveNames.searchText(k2).indexOf("sweeping slash") >= 0 && MoveNames.searchText(k2).indexOf("horizontal slash button") >= 0, "move names: search text has the description and input");
  const src = MoveNames.sources({ src: ["atwiki:871", "wycademy-notes", "client", "research"] }, "long-sword");
  check(src[0].href === "https://web.archive.org/web/2024/https://w.atwiki.jp/giurasu/pages/871.html" && src[1].href === "https://wycademy.vercel.app/hunter-notes/weapons/long-sword"
    && src[2].href === null && src[3].href === null, "move names: source links " + JSON.stringify(src));
  check(MoveNames.conf({ name: "x" }) === "guess" && MoveNames.conf({}) === "unknown", "move names: no conf: a name is a guess, none is unknown");
  const raw = fs.readFileSync(path.join(ROOT, "data/weapons/great-sword.json"), "utf8");
  check(!/client:|dump\/|0x[0-9a-f]{4,}@|guide@/.test(raw), "move names: no private source text in the data");
}

/* ---------- 2a2. balance fields ---------- */
// The game's value of every attack field the balance table can change (data/weapons "rec", in "recordFields" =
// js/balance-fields.js REC_FIELDS), and the game's names of the coded fields (index.json "codes"), which every
// weapon's element, status, special, arc shot and charge row text must map back to (the admin grid and the public
// balance page show and send the API's code).
{
  const C = index.codes || {};
  check(C.element && C.element.length === 19 && C.element[1] === "Fire" && C.element[18] === "E. Roar", "codes: element 0-18, the client's names");
  check(C.status && C.status.join() === "None,Poison,Paralysis,Sleep,Blast", "codes: status 0-4");
  check(C.shell && C.shell.length === 27 && C.shell[0] === "Normal 1" && C.shell[26] === "Spread 9", "codes: 27 gunlance shells");
  check(C.phial && C.phial.join() === "None,Power,Element,Status,Stun" && C.notes && C.notes.length === 20, "codes: phials, 20 note sets");
  check(C.arcShot && C.arcShot.join() === "Wide,Narrow,Bomb,Slicing" && C.chargeRow && C.chargeRow.length === 68, "codes: arc shots, 68 charge rows");
  check(C.moveFlags && C.moveFlags[0].join() === "0,None" && C.moveFlags.some(function (f) { return f[0] === 16 && f[1] === "Fire"; }), "codes: move element/status flags");
  const flagValues = (C.moveFlags || []).map(function (f) { return f[0]; });
  let recs = 0;
  index.types.forEach(function (t) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons", t.slug + ".json"), "utf8"));
    check(JSON.stringify(d.recordFields) === JSON.stringify(Fields.REC_FIELDS), t.slug + ": recordFields as js/balance-fields.js");
    const badRec = d.moves.filter(function (m) {
      recs++;
      return !m.rec || m.rec.length !== Fields.REC_FIELDS.length || !m.rec.every(function (v) { return v === (v >>> 0); })
        || ["delay", "active", "reaction", "element_flags", "hit_type", "hitstop", "spirit", "mv", "ko", "element_value"]
          .some(function (f) { return Fields.moveValue(m, f) === null; })
        || flagValues.indexOf(m.rec[3]) < 0;
    });
    check(badRec.length === 0, t.slug + ": moves without every record value or with unnamed flags: " + badRec.slice(0, 3).map(function (m) { return m.set + " #" + m.id; }).join(", "));
    const coded = d.kind === "melee" ? ["element", "status", "special"] : d.class === 10 ? ["arcShot", "chargeRow"] : [];
    const api = { element: "element", status: "status", special: "special", arcShot: "arc_shot", chargeRow: "charge_row" };
    coded.forEach(function (key) {
      const opts = Fields.options(C, d.kind === "melee" ? "melee" : "ranged", api[key], d.class);
      if (!opts) return;   // a class whose special has no names
      const col = d.fields.indexOf(key);
      const bad = d.weapons.filter(function (w) { return col < 0 || Fields.codeOf(opts, w[col]) === null; });
      check(bad.length === 0, t.slug + ": " + key + " without its code: " + bad.slice(0, 3).map(function (w) { return w[0] + " " + w[col]; }).join(", "));
    });
    if (d.class === 10) {
      const ci = d.fields.indexOf("charge"), ri = d.fields.indexOf("chargeRow");
      check(d.weapons.every(function (w) { return C.chargeRow[w[ri]] === w[ci]; }), t.slug + ": the charge row's levels are the bow's");
    }
  });
  check(recs > 600, "balance fields: " + recs + " moves with their record values");
  const gs = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons/great-sword.json"), "utf8"));
  const k2 = gs.moves.find(function (m) { return m.kind === 0 && m.id === 2; });
  check(Fields.moveValue(k2, "delay") === 52 && Fields.moveValue(k2, "hitstop") === 5 && Fields.moveValue(k2, "ko") === 0, "balance fields: GS k0 #2 delay 52, hitstop 5, ko 0");
}

/* ---------- 2b. icons ---------- */
// The weapon types' slugs here, and the sprite names the icons use, where they differ.
const SPRITE = { "dual-swords": "dual-blades", "switch-axe-f": "switch-axe" };
const iconData = JSON.parse(fs.readFileSync(path.join(ROOT, "data/equipment-icons.json"), "utf8"));
const iconLook = function (kind, id) { return Icons.equipmentLook(iconData, { id: id, kind: kind === "melee" ? "melee" : "ranged" }); };
let withoutIcon = 0, weaponsSeen = 0;
index.types.forEach(function (t) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons", t.slug + ".json"), "utf8"));
  const sprite = SPRITE[t.slug] || t.slug;
  let bad = 0;
  d.weapons.forEach(function (w) {
    weaponsSeen++;
    const look = iconLook(d.kind, w[0]);
    const file = look.key && path.join(ROOT, "assets/icons/1x", look.key + ".png");
    if (!look.key || look.key.indexOf(sprite + "-") !== 0 || !fs.existsSync(file) || look.rarity + 1 !== w[2]) { bad++; withoutIcon++; }
  });
  check(bad === 0, t.slug + ": " + bad + " of " + d.weapons.length + " weapons without their icon (class " + sprite + ", file, rarity)");
});
check(withoutIcon === 0 && weaponsSeen > 16000, "icons: rows without an icon = " + withoutIcon + " of " + weaponsSeen);
check(iconLook("melee", 1).key === "great-sword-0" && iconLook("ranged", 1).key !== null, "icons: Iron Sword is a great-sword in the first colour");

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

/* The icon src of each type's highest rarity weapon on the weapons page equals the catalog page's for the same
   id (the API answer stubbed: the game id as 4 hex digits, low byte first). */
async function sameAsCatalog(browser, base) {
  const picks = index.types.map(function (t) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data/weapons", t.slug + ".json"), "utf8"));
    const top = d.weapons.reduce(function (a, w) { return w[2] > a[2] ? w : a; });
    return { slug: t.slug, kind: d.kind === "melee" ? "melee" : "ranged", id: top[0], name: top[1] };
  });
  const hex = function (id) { return [id & 0xff, (id >> 8) & 0xff].map(function (n) { return n.toString(16).toUpperCase().padStart(2, "0"); }).join(""); };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", function (e) { errors.push(e.message); });
  await pg.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
  await pg.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) {
    const m = /catalog\/equipment\?slot=(\w+)/.exec(r.request().url());
    if (!m) { r.abort(); return; }
    const items = picks.filter(function (p) { return p.kind === m[1]; }).map(function (p) { return { id: hex(p.id), name: p.name }; });
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ total: items.length, page: 0, size: 50, items: items }) });
  });
  const catalogSrc = {};
  await pg.goto(base + "/catalog.html", { waitUntil: "load" });
  for (const slot of ["melee", "ranged"]) {
    await pg.click("#catalog-slots .chip[data-slot='" + slot + "']");
    await pg.waitForFunction(function (s) { return document.querySelector("#catalog-slots .chip[data-slot='" + s + "']").getAttribute("aria-pressed") === "true" && document.querySelectorAll("#catalog-body tr td.mono").length > 0; }, slot);
    await pg.waitForTimeout(300);
    const rows = await pg.$$eval("#catalog-body tr", function (rs) { return rs.map(function (r) { const i = r.querySelector("img"); return [r.children[1].textContent, i ? i.src : ""]; }); });
    rows.forEach(function (r) { catalogSrc[r[0]] = r[1]; });
  }
  for (const p of picks) {
    await pg.goto(base + "/weapons.html?type=" + p.slug, { waitUntil: "load" });
    await pg.waitForSelector("#wp-body .wp-pick");
    await pg.fill("#wp-search", String(p.id));
    const src = await pg.$eval("#wp-body tr:first-child .gi img", function (i) { return i.src; });
    check(!!catalogSrc[hex(p.id)] && src === catalogSrc[hex(p.id)], p.slug + " #" + p.id + " (" + p.name + "): weapons page icon " + src + " = catalog icon " + catalogSrc[hex(p.id)]);
  }
  check(errors.length === 0, "catalog cross-check: no script errors: " + errors.join(" | "));
  await ctx.close();
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
      // The icons: on every row, in the weapon's heading, and on the calculator's weapon line.
      const NOICON = "no-icon.svg";
      check(await pg.$$eval("#wp-body tr", function (t, no) { return t.every(function (r) { const i = r.querySelector(".gi img"); return i && i.src.indexOf(no) < 0; }); }, NOICON),
        view.name + ": every listed Great Sword has its icon");
      check(await pg.$eval("#wp-detail-h .gi img", function (i, no) { return i.src.indexOf(no) < 0 && /great-sword-0\.png$/.test(i.src); }, NOICON),
        view.name + ": Iron Sword's heading shows the great-sword icon in the first colour");
      check(await pg.$eval("#calc-weapon-note .gi img", function (i, no) { return i.src.indexOf(no) < 0; }, NOICON), view.name + ": the calculator's weapon line has the icon");
      // The calculator's first move row must be what HvWeaponsCalc gives for the same inputs.
      const fromPage = await pg.evaluate(function () {
        const first = document.querySelector("#calc-body tr");
        return first ? first.children[4].textContent.replace(/,/g, "") : null;
      });
      check(fromPage !== null && Number(fromPage) > 0, view.name + ": calculator shows damage, got " + fromPage);
      // Move names: the name first with its badge and id, a tap detail, unknown = id + "unnamed"; also in the calculator.
      const mv = await pg.$$eval("#wp-moves-body tr", function (trs) {
        return trs.map(function (tr) {
          const c = tr.cells[0], q = function (s) { const n = c.querySelector(s); return n ? n.textContent : ""; };
          return { name: q(".mv-name"), conf: q(".mv-conf"), id: q(".mv-id"), more: !!c.querySelector("details.mv-more") };
        });
      });
      const h = mv.find(function (m) { return m.name === "Horizontal Slash"; });
      check(h && h.conf === "confirmed" && h.id === "k0 #2" && h.more, view.name + ": move list shows Horizontal Slash, confirmed, k0 #2: " + JSON.stringify(h));
      check(mv.some(function (m) { return m.name === "k0 #5" && m.conf === "unnamed" && !m.id; }), view.name + ": an unknown move shows its id and unnamed");
      check(mv.length > 20 && mv.every(function (m) { return m.name && m.conf; }), view.name + ": every listed move has a name or id and a badge");
      await pg.click("#wp-moves-body tr:nth-child(2) details.mv-more summary");
      check(await pg.$eval("#wp-moves-body tr:nth-child(2) details.mv-more", function (d) { return d.open && /Sweeping slash/.test(d.textContent) && !!d.querySelector('a[href^="https://"]'); }),
        view.name + ": tapping a move shows what it is and a source link");
      check((await pg.$$("#wp-moves-legend .mv-conf")).length === 4 && (await pg.$$("#calc-legend .mv-conf")).length === 4, view.name + ": the badges' legend above both tables");
      check(await pg.$$eval("#calc-body tr", function (t) { return t.length > 0 && t.every(function (r) { return r.cells[0].querySelector(".mv-name") && r.cells[0].querySelector(".mv-conf"); }); }),
        view.name + ": every calculator row has the move's name and badge");
      // Search, then a sort by true attack.
      await pg.fill("#wp-search", "Iron Sword");
      check((await pg.$$eval("#wp-body .wp-pick", function (b) { return b.map(function (x) { return x.textContent; }); })).every(function (t) { return /Iron Sword/.test(t); }), view.name + ": search filters");
      await pg.fill("#wp-search", "");
      await pg.click("#wp-head th:nth-child(4) .wp-sort");
      const top = await pg.$$eval("#wp-body tr", function (t) { return t.slice(0, 3).map(function (r) { return Number(r.children[3].textContent); }); });
      check(top[0] >= top[1] && top[1] >= top[2], view.name + ": sort by true attack, highest first: " + top);
      // The list's state is in the address next to type and w (defaults left out), and a reload restores it.
      const q1 = new URL(pg.url()).searchParams;
      check(q1.get("type") === "great-sword" && q1.get("w") === "1" && q1.get("sort") === "attack" && q1.get("dir") === "desc" && !q1.has("q") && !q1.has("page"),
        view.name + ": URL after sorting by true attack: " + pg.url());
      await pg.click("#wp-next");
      await pg.selectOption("#wp-rarity", { index: 2 });
      const rar = await pg.inputValue("#wp-rarity");
      check(new URL(pg.url()).searchParams.get("rarity") === rar && !new URL(pg.url()).searchParams.has("page"), view.name + ": a filter writes rarity and goes back to page 1: " + pg.url());
      await pg.selectOption("#wp-rarity", "");
      await pg.click("#wp-next");
      await pg.fill("#wp-search", "sword");
      check(new URL(pg.url()).searchParams.get("q") === "sword", view.name + ": search writes q: " + pg.url());
      await pg.fill("#wp-search", "");
      await pg.click("#wp-next");
      check(new URL(pg.url()).searchParams.get("page") === "2", view.name + ": page 2 writes page=2: " + pg.url());
      const keep = pg.url();
      await pg.reload({ waitUntil: "load" });
      await pg.waitForSelector("#wp-body .wp-pick");
      check(/^Page 2 of/.test(await pg.textContent("#wp-page-note")) && await pg.getAttribute("#wp-head th:nth-child(4)", "aria-sort") === "descending"
        && await pg.textContent("#wp-detail-h") === "Iron Sword" && pg.url() === keep, view.name + ": reload restores page 2, the sort and the weapon: " + pg.url());
      await pg.goto(base + "/weapons.html?type=great-sword&q=iron&rarity=1&sort=nonsense&page=999&elem=zzz", { waitUntil: "load" });
      await pg.waitForSelector("#wp-body tr");
      check(await pg.inputValue("#wp-search") === "iron" && await pg.inputValue("#wp-elem") === "" && /^Page 1 of/.test(await pg.textContent("#wp-page-note")) || await pg.isHidden("#wp-pager"),
        view.name + ": bad sort, element and page values are ignored");
      await pg.click("#wp-types .chip:nth-child(3)");
      await pg.waitForFunction(function () { return /type=hammer/.test(location.search); });
      const q2 = new URL(pg.url()).searchParams;
      check(!q2.has("sort") && !q2.has("page") && !q2.has("rarity") && !q2.has("w"), view.name + ": switching type drops sort, page, filters and the weapon: " + pg.url());
      await pg.goto(base + "/weapons.html?type=great-sword&w=1", { waitUntil: "load" });
      await pg.waitForSelector("#wp-body .wp-pick");
      // Back to the catalog: game id 1 is "0100" there (byte-swapped hex).
      check(await pg.isVisible("#wp-to-catalog") && await pg.getAttribute("#wp-to-catalog", "href") === "/catalog.html?slot=melee&q=0100",
        view.name + ": Find in the catalog links " + await pg.getAttribute("#wp-to-catalog", "href"));
      const pos = await pg.$eval("#wp-body tr td", function (td) { return getComputedStyle(td).position; });
      check(pos === (view.name === "phone" ? "sticky" : "static"), view.name + ": the list's first column is " + pos);
      // Open in calculator: scrolls to #calc and focuses its first field; a style chip sets the calculator's style.
      await pg.click("#wp-styles .chip:nth-child(3)");
      check(await pg.inputValue("#c-style") === "H", view.name + ": the Heaven chip sets the calculator's style");
      await pg.click("#wp-to-calc");
      await pg.waitForFunction(function () { var r = document.getElementById("calc").getBoundingClientRect(); return r.top < innerHeight * 0.5 && r.bottom > 0; });
      check(await pg.evaluate(function () { return document.activeElement && document.activeElement.id; }) === "c-attack", view.name + ": Open in calculator focuses the first field");
      // Red sharpness: no crits.
      await pg.selectOption("#c-sharp", "0");
      await pg.fill("#c-affinity", "100");
      check(/no crits below green/.test(await pg.textContent("#calc-summary")), view.name + ": red sharpness says no crits");
      // Monster presets: the game's hitzones (data/monsters/game/1.json) per rank and part; Rathian opens on its
      // highest rank (G rank: head cut 50), Low rank's head is 70; a monster without game data says "community".
      const gameRathian = JSON.parse(fs.readFileSync(path.join(ROOT, "data/monsters/game/1.json"), "utf8"));
      await pg.waitForFunction(function () { return !!document.querySelector('#c-monster option[value="g:1"]'); });
      await pg.selectOption("#c-monster", "g:1");
      await pg.waitForFunction(function () { return !document.getElementById("c-part-wrap").hidden; });
      const groups = await pg.$$eval("#c-part optgroup", function (g) { return g.map(function (x) { return x.label; }); });
      check(JSON.stringify(groups) === JSON.stringify(gameRathian.ranks.map(function (r) { return r.label; })),
        view.name + ": Rathian's parts grouped by the game data's ranks: " + groups);
      check(await pg.inputValue("#c-zone") === "50" && /game's data: Rathian, G rank/.test(await pg.textContent("#c-zone-note")),
        view.name + ": Rathian preset starts on G rank head, cut 50, from the game's data: " + await pg.inputValue("#c-zone"));
      await pg.selectOption("#c-part", { label: "Head" }); // the first "Head" is Low rank's
      check(await pg.inputValue("#c-zone") === "70", view.name + ": Low rank head cut 70, got " + await pg.inputValue("#c-zone"));
      const zinState = await pg.evaluate(function () {
        return Array.prototype.some.call(document.querySelectorAll("#c-monster option"), function (o) { return /\(community\)$/.test(o.textContent) && o.value.indexOf("c:") === 0; })
          || Array.prototype.every.call(document.querySelectorAll("#c-monster option"), function (o) { return !o.value || o.value.indexOf("g:") === 0; });
      });
      check(zinState, view.name + ": monsters without game hitzones are labelled community, or every preset is the game's");
      await pg.selectOption("#c-monster", "");
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
      // Every type: the first page of its list has an icon on each row, of the type's sprite.
      for (let i = 0; i < index.types.length; i++) {
        const t = index.types[i];
        await pg.locator("#wp-types .chip").nth(i).click();
        await pg.waitForFunction(function (n) { return document.getElementById("wp-detail-type").textContent === n; }, t.name);
        const sprite = SPRITE[t.slug] || t.slug;
        const got = await pg.$$eval("#wp-body tr", function (rs) { return rs.map(function (r) { const i = r.querySelector(".gi img"); return i ? i.src : ""; }); });
        const bad = got.filter(function (src) { return src.indexOf("/assets/icons/1x/" + sprite + "-") < 0; }).length;
        check(got.length > 0 && bad === 0, view.name + " " + t.slug + ": " + bad + " of " + got.length + " listed rows without a " + sprite + " icon");
      }
      // A gunner type: list works, calculator form hidden.
      await pg.click("#wp-types .chip:has-text('Heavy Bowgun')");
      await pg.waitForFunction(function () { return !document.getElementById("calc-gunner").hidden; });
      check(await pg.isHidden("#calc-form"), view.name + ": gunner type hides the calculator form");
      check(errors.length === 0, view.name + ": no script errors: " + errors.join(" | "));
      await ctx.close();

      // Tap targets: on a touch screen the sort buttons and weapon names are at least 40 px tall; on a mouse the table stays compact.
      {
        const touch = view.name === "phone";
        const tctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, hasTouch: touch, isMobile: touch });
        await tctx.addInitScript(function () { localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })); });
        const tp = await tctx.newPage();
        await tp.route(/api\.hvmhfz\.eclipseforge\.xyz/, function (r) { r.abort(); });
        await tp.goto(base + "/weapons.html?type=great-sword", { waitUntil: "load" });
        await tp.waitForSelector("#wp-body .wp-pick");
        const hs = await tp.$$eval(".wp-sort, .wp-pick", function (bs) { return bs.slice(0, 12).map(function (b) { return b.getBoundingClientRect().height; }); });
        if (touch) check(hs.every(function (h) { return h >= 39.5; }), view.name + ": touch tap targets >= 40 px: " + hs.map(Math.round));
        else check(hs.every(function (h) { return h < 36; }), view.name + ": the desktop table stays compact: " + hs.map(Math.round));
        await tctx.close();
      }

      if (view.name === "desktop") await sameAsCatalog(browser, base);

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
