#!/usr/bin/env node
/* Checks the public Balance changes page (balance.html, js/balance-public.js) in headless Chromium against stubbed
   answers of GET /api/public/balance (the API README "Server balance"):

   - rows: the current version, date and note; the changes grouped by weapon type and style (all types and all
     styles first); move and weapon names and the game's own values from data/weapons/; set "game → new", scale
     "×factor" with the result; a Discord link in a reason clickable, markup in a reason kept as text; the history
     (newest first, the live one marked, a roll back said, an empty version "No changes");
   - empty table: "No balance changes: the game's own values";
   - 404 and a body without a version: "not published yet"; no answer: Try again, which loads again;
   - phone (375 px) and desktop: no horizontal overflow, no page errors; the pure helpers under node.

   Screenshots go to $SHOTS when set, else /srv/devbot/.bot-logs/balance-admin/ (public-*.png) when that folder exists, else dev-shots/.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-balance-public.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const B = require("../js/balance-public.js");

const root = path.join(__dirname, "..");
const LOGS = "/srv/devbot/.bot-logs/balance-admin";
const shots = process.env.SHOTS || (fs.existsSync(LOGS) ? LOGS : path.join(root, "dev-shots"));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (file.endsWith(path.sep)) file += "index.html";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const CORS = { "Access-Control-Allow-Origin": "*" };

const THREAD = "https://discord.com/channels/111/222/333";
const ROWS = [
  { kind: "attack", weaponClass: "Hammer", style: null, entry: 0, recordId: 8, field: "ko", op: "set", value: 30, reason: "Hammer KO felt weak: " + THREAD },
  { kind: "attack", weaponClass: "GS", style: "extreme", entry: 0, recordId: 165, field: "mv", op: "scale", value: 1.1, reason: "Charge too slow for its damage" },
  { kind: "attack", weaponClass: null, style: null, entry: null, recordId: null, field: "hitstop", op: "scale", value: 0.9, reason: "<b>less hitstop</b> everywhere" },
  { kind: "attack", weaponClass: "LS", style: "storm", entry: 0, recordId: 59, field: "mv", op: "set", value: 40, reason: "" },
  { kind: "melee", weaponClass: null, style: null, entry: null, recordId: 1, field: "attack", op: "set", value: 80, reason: "Starter sword buff" },
  { kind: "attack", weaponClass: "GS", style: null, entry: 0, recordId: 2, field: "mv", op: "set", value: 50, reason: "Combo" }
];
const VERSIONS = [
  { version: 3, publishedAt: "2026-11-12T18:30:00Z", note: "First pass, see " + THREAD, rowCount: 6, rollbackOf: null },
  { version: 2, publishedAt: "2026-11-11T10:00:00Z", note: "Back to the base", rowCount: 0, rollbackOf: 1 },
  { version: 1, publishedAt: "2026-11-10T15:00:00Z", note: "The game's own values", rowCount: 0, rollbackOf: null }
];
const WITH_ROWS = { version: 3, publishedAt: "2026-11-12T18:30:00Z", note: VERSIONS[0].note, rows: ROWS, versions: VERSIONS };
const EMPTY = { version: 1, publishedAt: "2026-11-10T15:00:00Z", note: "The game's own values", rows: [], versions: [VERSIONS[2]] };
// Every field's game value and the game's names of coded fields (js/balance-fields.js, data/weapons "rec" and "codes").
const CODED_ROWS = [
  { kind: "attack", weaponClass: "GS", style: null, entry: 0, recordId: 2, field: "hitstop", op: "set", value: 3, reason: "a" },
  { kind: "attack", weaponClass: "GS", style: null, entry: 0, recordId: 2, field: "element_flags", op: "set", value: 16, reason: "b" },
  { kind: "melee", weaponClass: null, style: null, entry: null, recordId: 7, field: "element", op: "set", value: 3, reason: "c" },
  { kind: "melee", weaponClass: null, style: null, entry: null, recordId: 110, field: "special", op: "set", value: 4, reason: "d" },
  { kind: "ranged", weaponClass: null, style: null, entry: null, recordId: 78, field: "arc_shot", op: "set", value: 2, reason: "e" }
];
const WITH_CODES = { version: 4, publishedAt: "2026-11-13T18:30:00Z", note: "Codes", rows: CODED_ROWS,
  versions: [{ version: 4, publishedAt: "2026-11-13T18:30:00Z", note: "Codes", rowCount: 5, rollbackOf: null }] };
const NONE = { version: null, publishedAt: null, note: null, rows: [], versions: [] };

function helpers() {
  check("field names", B.fieldName("mv") === "Motion value" && B.fieldName("element_value") === "Element value" && B.fieldName("attack") === "Attack");
  check("scaled truncates", B.scaled(92, 1.1) === 101 && B.scaled(null, 1.1) === null);
  check("state off on 404", B.stateOf(404, null) === "off");
  check("state off without a version", B.stateOf(200, NONE) === "off");
  check("state empty", B.stateOf(200, EMPTY) === "empty");
  check("state rows", B.stateOf(200, WITH_ROWS) === "rows");
  const parts = B.linkParts("see " + THREAD + ". and https://example.org/x, ok");
  check("links found", parts.length === 5 && parts[1].href === THREAD && parts[1].text === "Discord thread" && parts[3].href === "https://example.org/x",
    JSON.stringify(parts));
  check("no javascript links", B.linkParts("javascript:alert(1)").every((p) => !p.href));
  check("date in UTC", B.when("2026-11-10T15:00:00Z") === "10 Nov 2026, 15:00 UTC", B.when("2026-11-10T15:00:00Z"));
  check("count text", B.countText(0) === "No changes: the game's own values" && B.countText(1) === "1 change");
  const g = B.groupRows(ROWS, null);
  check("groups: all types first, then by class and style", g.map((x) => x.type + "/" + x.style).join(",") ===
    "All weapon types/All styles,Great Sword/All styles,Great Sword/Extreme,Hammer/All styles,Long Sword/Storm,Melee weapons/Weapon stats",
    g.map((x) => x.type + "/" + x.style).join(","));
  const data = { index: { codes: { element: ["None", "Fire", "Water", "Thunder"], moveFlags: [[0, "None"], [16, "Fire"]] },
    types: [{ slug: "great-sword", class: 0, kind: "melee" }] },
    files: { "great-sword": { fields: ["id", "name", "element"], weapons: [[7, "Blue Wing", "Fire"]],
      moves: [{ kind: 0, id: 2, mv: [46], rec: [52, 14, 1, 0, 1, 5, 0] }] } } };
  const el = CODED_ROWS[2], fl = CODED_ROWS[1];
  check("game value: a coded weapon field is its code, shown by name", B.gameValue(el, data) === 1 && B.valueText(1, B.optionsOf(el, data), "element") === "Fire"
    && B.valueText(3, B.optionsOf(el, data), "element") === "Thunder" && B.valueText(null, null, "x") === "?");
  check("game value: every move field", B.gameValue(CODED_ROWS[0], data) === 5 && B.gameValue(fl, data) === 0 && B.valueText(16, B.optionsOf(fl, data), fl.field) === "Fire"
    && B.gameValue(Object.assign({}, CODED_ROWS[0], { field: "ko" }), data) === 0);
  check("without data a move is its ref", B.whatText(ROWS[3], null) === "k0 #59" && B.whatText(ROWS[2], null) === "Every move");
}

async function open(browser, base, answer, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  const calls = { n: 0 };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p !== "/api/public/balance") return route.fulfill({ status: 404, headers: CORS, body: "" });
    calls.n++;
    const a = typeof answer === "function" ? answer(calls.n) : answer;
    if (a === "down") return route.abort("connectionrefused");
    if (a === 404) return route.fulfill({ status: 404, contentType: "application/json", headers: CORS, body: JSON.stringify({ message: "Not published." }) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(a) });
  });
  await page.goto(base + "/balance.html");
  await page.waitForFunction(() => document.getElementById("bal-loading").hidden);
  return { page, errors, calls };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const visible = (page, id) => page.$eval("#" + id, (n) => !n.hidden && n.getClientRects().length > 0);
const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
// The page's own content (main#content; the shared header is dev/check-nav-mobile.js's) past the right edge, in px:
// the elements outside a .table-wrap (which scrolls on its own) and the table wraps themselves.
const overflow = (page) => page.evaluate(() => Math.max(0, ...Array.from(document.querySelectorAll("#content *"))
  .filter((n) => !n.parentElement.closest(".table-wrap") && n.getBoundingClientRect().width > 0)
  .map((n) => Math.round(n.getBoundingClientRect().right - document.documentElement.clientWidth))));
// Which elements, for the failure message.
const wide = (page) => page.evaluate(() => Array.from(document.querySelectorAll("#content *")).filter((n) => !n.parentElement.closest(".table-wrap")
  && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5)
  .map((n) => n.tagName + "#" + n.id + "." + n.className + " " + Math.round(n.getBoundingClientRect().right)).join(", "));

async function rows(browser, base) {
  for (const width of [1280, 375]) {
    const { page, errors } = await open(browser, base, WITH_ROWS, width);
    await page.waitForSelector(".bal-group");
    check(width + ": current shown", await visible(page, "bal-current") && !(await visible(page, "bal-off")) && !(await visible(page, "bal-empty")));
    check(width + ": version", (await text(page, "#bal-version")) === "Version 3");
    check(width + ": date", (await text(page, "#bal-date")) === "12 Nov 2026, 18:30 UTC");
    check(width + ": note with its link", (await text(page, "#bal-note")) === "First pass, see Discord thread"
      && (await page.$eval("#bal-note a", (a) => a.href)) === THREAD);
    const heads = await page.$$eval(".bal-group-h", (hs) => hs.map((h) => h.textContent));
    check(width + ": groups", heads.join("|") === "All weapon typesAll styles|Great SwordAll styles|Great SwordExtreme|Great SwordWeapon stats|HammerAll styles|Long SwordStorm",
      heads.join("|"));
    // A move's cell: its name line (name, confidence badge, id; js/move-names.js), not the tap detail under it.
    const cells = await page.$$eval(".bal-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.cells).map((c, i) => {
      const line = i === 0 && c.querySelector(".mv-line");
      return line ? [".mv-name", ".mv-conf", ".mv-id"].map((s) => (line.querySelector(s) || {}).textContent || "").filter(Boolean).join(" ") : c.textContent;
    })));
    const flat = cells.map((c) => c.join(" ; "));
    check(width + ": every move scaled", flat[0] === "Every move ; Hitstop ; ×0.9 ; <b>less hitstop</b> everywhere", flat[0]);
    check(width + ": named move, set", flat[1] === "Horizontal Slash confirmed k0 #2 ; Motion value ; 46 → 50 ; Combo", flat[1]);
    check(width + ": named move with its ref, scaled with the result", flat[2] === "Upswing charge Lv1 confirmed k0 #165 ; Motion value ; ×1.1 92 → 101 ; Charge too slow for its damage", flat[2]);
    check(width + ": KO from the data", flat[4] === "Charge Lv1 / Lv2, first hit confirmed k0 #8 ; KO ; 20 → 30 ; Hammer KO felt weak: Discord thread", flat[4]);
    check(width + ": empty reason", flat[5] === "Back Slash (Cut Down) confirmed k0 #59 ; Motion value ; 36 → 40 ; —", flat[5]);
    check(width + ": weapon by name", flat[3] === "Iron Sword ; Attack ; 60 → 80 ; Starter sword buff", flat[3]);
    check(width + ": a move's detail: what it is, input, linked source", await page.$eval(".bal-what details.mv-more", (d) => /Sweeping slash/.test(d.textContent)
      && /Input: Horizontal Slash button/.test(d.querySelector("summary").textContent) && !!d.querySelector('a[href^="https://wycademy"]')));
    check(width + ": the badges' legend", (await page.$$("#bal-legend .mv-conf")).length === 4);
    // How each move is used (data/weapons "use", js/move-names.js): a line under each move, the kinds in the legend.
    const uses = await page.$$eval(".bal-what .mv-use", (us) => us.map((u) => u.querySelector(".mv-kind").textContent + "|" + u.querySelector(".mv-how").textContent));
    const gs2 = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/weapons/great-sword.json"), "utf8")).moves.find((m) => m.kind === 0 && m.id === 2).use;
    check(width + ": a how-to-use line under each of the 4 moves", uses.length === 4 && uses.indexOf((gs2.kind === "direct" ? "own input" : gs2.kind) + "|" + gs2.how) >= 0, uses.join(" ; "));
    check(width + ": the usage kinds in the legend", (await page.$$("#bal-legend .mv-kind")).length === 6);
    check(width + ": weapon links to the weapons page", (await page.$eval(".bal-what > a:not(.bal-open)", (a) => a.getAttribute("href"))) === "/weapons.html?type=great-sword&w=1");
    const ids = await page.$$eval(".bal-group", (gs) => gs.map((g) => g.id));
    check(width + ": group ids (first group of a type is its slug)", ids.join(",") === ",great-sword,great-sword-extreme,great-sword-weapon-stats,hammer,long-sword", ids.join(","));
    const typeLinks = await page.$$eval(".bal-group-h a", (as) => as.map((a) => a.textContent + "=" + a.getAttribute("href")));
    check(width + ": group headings link to the weapons page", typeLinks.join(",") === "Great Sword=/weapons.html?type=great-sword,Great Sword=/weapons.html?type=great-sword,"
      + "Great Sword=/weapons.html?type=great-sword,Hammer=/weapons.html?type=hammer,Long Sword=/weapons.html?type=long-sword", typeLinks.join(","));
    const moveLinks = await page.$$eval(".bal-what a.bal-open", (as) => as.map((a) => a.getAttribute("href")));
    check(width + ": move rows link to their type", moveLinks.length === 4 && moveLinks.every((h) => /^\/weapons\.html\?type=(great-sword|hammer|long-sword)$/.test(h)), moveLinks.join(","));
    check(width + ": the 'every move' row has no type link", (await page.$$eval(".bal-group:first-child .bal-open", (x) => x.length)) === 0);
    check(width + ": markup stays text", (await page.$$("#bal-groups b")).length === 0);
    const link = await page.$eval(".bal-reason a", (a) => ({ href: a.href, rel: a.rel, target: a.target }));
    check(width + ": reason link", link.href === THREAD && link.rel.indexOf("noopener") !== -1 && link.target === "_blank", JSON.stringify(link));
    const hist = await page.$$eval("#bal-history li", (ls) => ls.map((l) => l.textContent));
    check(width + ": history", hist.length === 3 && /^Version 3 · 12 Nov 2026, 18:30 UTC · 6 changesLive/.test(hist[0])
      && /Puts back the changes of version 1\./.test(hist[1]) && /No changes: the game's own values/.test(hist[2]), JSON.stringify(hist));
    check(width + ": no overflow", (await overflow(page)) <= 0, (await overflow(page)) + " " + (await wide(page)));
    check(width + ": no errors", errors.length === 0, errors.join("; "));
    await shot(page, "public-rows-" + width + ".png");
    await page.close();
  }
}

async function empty(browser, base) {
  for (const width of [1280, 375]) {
    const { page, errors } = await open(browser, base, EMPTY, width);
    check(width + " empty: says so", await visible(page, "bal-empty") && /^No balance changes: the game's own values\./.test(await text(page, "#bal-empty")));
    check(width + " empty: no groups", !(await visible(page, "bal-changes")) && (await page.$$(".bal-group")).length === 0);
    check(width + " empty: version 1 and its note", (await text(page, "#bal-version")) === "Version 1" && (await text(page, "#bal-note")) === "The game's own values");
    check(width + " empty: history", (await page.$$("#bal-history li")).length === 1);
    check(width + " empty: no overflow", (await overflow(page)) <= 0, await wide(page));
    check(width + " empty: no errors", errors.length === 0, errors.join("; "));
    await shot(page, "public-empty-" + width + ".png");
    await page.close();
  }
}

async function off(browser, base) {
  for (const [label, answer] of [["404", 404], ["no version", NONE]]) {
    for (const width of [1280, 375]) {
      const { page, errors } = await open(browser, base, answer, width);
      check(label + " " + width + ": not published yet", await visible(page, "bal-off") && /Not published yet/.test(await text(page, "#bal-off")));
      check(label + " " + width + ": nothing else", !(await visible(page, "bal-current")) && !(await visible(page, "bal-history-panel")) && !(await visible(page, "bal-error")));
      check(label + " " + width + ": no overflow", (await overflow(page)) <= 0, await wide(page));
      check(label + " " + width + ": no errors", errors.length === 0, errors.join("; "));
      if (label === "404") await shot(page, "public-off-" + width + ".png");
      await page.close();
    }
  }
}

async function down(browser, base) {
  const { page, errors, calls } = await open(browser, base, (n) => (n === 1 ? "down" : EMPTY), 375);
  check("down: try again shown", await visible(page, "bal-error") && !(await visible(page, "bal-off")) && !(await visible(page, "bal-current")));
  await shot(page, "public-down-375.png");
  await page.click("#bal-retry");
  await page.waitForFunction(() => !document.getElementById("bal-current").hidden);
  check("down: try again loads", calls.n === 2 && await visible(page, "bal-empty") && !(await visible(page, "bal-error")));
  check("down: no page errors", errors.length === 0, errors.join("; "));
  await page.close();
}

async function coded(browser, base) {
  const { page, errors } = await open(browser, base, WITH_CODES, 1280);
  await page.waitForSelector(".bal-group");
  const flat = await page.$$eval(".bal-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.cells).slice(1, 3).map((c) => c.textContent).join(" ; ")));
  check("coded: the game's values and names", flat.join("|") === "Hitstop ; 5 → 3|Element flags ; None → Fire|Element ; Fire → Thunder|Special ; Normal 1 → Long 2|Arc shot ; Wide → Bomb",
    flat.join("|"));
  check("coded: no errors", errors.length === 0, errors.join("; "));
  await shot(page, "public-coded-1280.png");
  await page.close();
}

async function weaponsLink(browser, base) {
  const page = await browser.newPage();
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => route.abort());
  await page.goto(base + "/weapons.html");
  check("weapons page links here", (await page.$$("main a[href='/balance.html']")).length === 1);
  check("nav: next to Weapons", (await page.$$eval("#nav-database a", (as) => as.map((a) => a.getAttribute("href")))).join(",").indexOf("/weapons.html,/balance.html") !== -1);
  await page.close();
}

(async () => {
  helpers();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await rows(browser, base);
    await empty(browser, base);
    await off(browser, base);
    await down(browser, base);
    await coded(browser, base);
    await weaponsLink(browser, base);
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("FAIL\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("public balance OK");
})();
