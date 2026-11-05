#!/usr/bin/env node
/* Checks the Road builder's Zenith forms (road.html, js/road.js) in headless Chromium against a fake API with a
   small made-up Road (no game data): table 0 normal (+0x04 10, level 53), table 1 Zenith (+0x04 16, level 64),
   as the live file keeps them.

   - the first monster's picker lists "Zenith Rathalos" (with Rathalos's icon and #11) for the monsters the base
     gives a Zenith form, and no Zenith form of the others; the second monster's picker lists none;
   - choosing "Zenith Rathalos" on a normal table sends {"monster": 11, "zenith": true} and the entry shows level
     64; choosing plain "Rathalos" on the Zenith table sends {"zenith": false}; choosing a monster that comes out
     in the form asked for anyway sends no "zenith" key;
   - "Changes from the base" names the forms ("monster Bravo → Zenith Rathalos");
   - a policy without "zenith" lists the Zenith forms as not choosable;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-road-zenith.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
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

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return b64({ alg: "HS256" }) + "." + b64({ sub: "hunter", exp }) + ".sig";
}
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };

function entry(monster, unk04, level, weight) {
  return { monster, unk04, monster2: 0, unk0c: 0, level, unk14: -1, weight: weight === undefined ? 1 : weight, flags: 0 };
}
// Monsters: 11 Rathalos, 15 Khezu, 76 Tigrex have a Zenith form here; 53 Rajang and 2 Fatalis do not.
function mode() {
  return {
    floors: [{ floor: 1, table: 0, loop: 1, points: 1, points2: 1, bonus: 0 },
             { floor: 2, table: 1, loop: 0, points: 1, points2: 1, bonus: 0 }],
    tables: [
      [entry(2, 10, 53), entry(53, 10, 53), entry(11, 10, 53), entry(15, 10, 53), entry(76, 10, 53)],
      [entry(11, 16, 64), entry(15, 16, 64), entry(76, 16, 64)]
    ]
  };
}
const BASE = { version: 1, unk08: 0, unk10: 0, modes: [mode(), mode()] };
const POLICY = { modes: [0], floorFields: ["table"], entryFields: ["monster", "monster2", "weight", "forced", "zenith"],
  floorCount: false, modeCount: false, maxAddedEntries: 64, maxWeight: 1000, maxPoints: 4 };

// The fake API: answers the page's requests to the public API (page.route).
function fakeApi(policy, sent) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url()).pathname;
    const json = (status, value) => route.fulfill({ status, headers: CORS, contentType: "application/json",
      body: value === undefined ? "" : JSON.stringify(value) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS, body: "" });
    if (url === "/api/road/pool") {
      return json(200, { base: BASE, policy, monsters: [2, 11, 15, 53, 76].map((id) => ({ id, name: "Monster " + id })), extra: [] });
    }
    if (url === "/api/road/check" && req.method() === "POST") {
      sent.push(JSON.parse(req.postData()).edits);
      return json(200, { ok: true, size: 4000, problems: [] });
    }
    if (url === "/api/road/cycle") return json(200, null);
    return json(200, []);
  };
}

async function openPage(browser, port, policy, sent, errors) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((token) => { localStorage.setItem("hvmhfz.token", token); }, TOKEN);
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", fakeApi(policy, sent));
  await page.goto("http://127.0.0.1:" + port + "/road.html");
  await page.waitForSelector("#road-app:not([hidden])", { timeout: 15000 });
  return page;
}

async function openTable(page, t) {
  await page.evaluate((id) => { const d = document.getElementById(id); d.open = true; d.dispatchEvent(new Event("toggle")); }, "road-table-0-" + t);
  await page.waitForSelector("#road-table-0-" + t + " .road-entries tbody tr");
}

// Opens the first monster picker of an entry and returns the options' texts.
async function optionsOf(page, t, e, label) {
  await page.click("#road-table-0-" + t + " [aria-label='" + (label || "Monster of entry ") + e + "']");
  await page.waitForSelector(".bui-pop:not([hidden]) .bui-option");
  const texts = await page.$$eval(".bui-pop .bui-option", (rows) => rows.map((r) => ({
    text: r.textContent, disabled: r.classList.contains("is-disabled"),
    icon: (r.querySelector("img") || {}).src || "" })));
  return texts;
}

async function choose(page, name) {
  const search = await page.$(".bui-pop .bui-search:not([hidden])");
  if (search) await search.fill(name);
  await page.$$eval(".bui-pop .bui-option", (rows, wanted) => {
    const row = rows.find((r) => r.querySelector(".bui-name").textContent === wanted);
    if (!row) throw new Error("no option " + wanted);
    row.click();
  }, name);
  await page.waitForTimeout(400);
}

async function sentEdits(page, sent) {
  const before = sent.length;
  await page.click("#road-check");
  for (let i = 0; i < 50 && sent.length === before; i++) await page.waitForTimeout(100);
  return sent[sent.length - 1];
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  try {
    const sent = [];
    const page = await openPage(browser, port, POLICY, sent, errors);

    await openTable(page, 0);
    const first = await optionsOf(page, 0, 0);
    const names = first.map((o) => o.text);
    const zenith = first.filter((o) => /^Zenith /.test(o.text));
    check("three Zenith forms listed", zenith.length === 3, names.join(" | "));
    check("Zenith Rathalos shows #11", zenith.some((o) => o.text.indexOf("Zenith Rathalos") === 0 && /#11$/.test(o.text)), names.join(" | "));
    const plain = first.find((o) => o.text.indexOf("Rathalos#11") === 0 || o.text === "Rathalos#11");
    const z = zenith.find((o) => o.text.indexOf("Zenith Rathalos") === 0);
    check("Zenith Rathalos has Rathalos's icon", !!plain && !!z && z.icon === plain.icon && !!z.icon, (z || {}).icon);
    check("no Zenith Rajang", !names.some((n) => /^Zenith Rajang/.test(n)));
    await page.keyboard.press("Escape");
    const second = await optionsOf(page, 0, 0, "Second monster of entry ");
    check("second monster lists no Zenith form", !second.some((o) => /^Zenith /.test(o.text)));
    await page.keyboard.press("Escape");

    // Table 0 entry 0 (Fatalis, normal) -> Zenith Rathalos.
    await optionsOf(page, 0, 0);
    await choose(page, "Zenith Rathalos");
    let edits = await sentEdits(page, sent);
    let e0 = edits.modes[0].entries.find((x) => x.table === 0 && x.entry === 0);
    check("Zenith pick sends monster 11 and zenith true", e0 && e0.monster === 11 && e0.zenith === true, JSON.stringify(edits));
    const level = await page.$eval("#road-table-0-0 .road-entries tbody tr:nth-child(1) td.num", (td) => td.textContent);
    check("the entry shows level 64", level === "64", level);
    const shown = await page.$eval("#road-table-0-0 [aria-label='Monster of entry 0'] .bui-value", (s) => s.textContent);
    check("the picker shows Zenith Rathalos", shown === "Zenith Rathalos", shown);
    const changes = await page.$eval("#road-changes", (d) => d.textContent);
    check("changes name the form", changes.indexOf("monster Fatalis → Zenith Rathalos") >= 0, changes);

    // Table 0 entry 2 is normal Rathalos already; picking plain Khezu over Khezu's normal slot changes nothing.
    await optionsOf(page, 0, 3);
    await choose(page, "Khezu");
    edits = await sentEdits(page, sent);
    check("same monster, same form: no edit", !edits.modes[0].entries.some((x) => x.table === 0 && x.entry === 3), JSON.stringify(edits));

    // Table 1 (Zenith): plain Rathalos over Zenith Rathalos sends zenith false; Rajang comes out normal, no key.
    await openTable(page, 1);
    await optionsOf(page, 1, 0);
    await choose(page, "Rathalos");
    await optionsOf(page, 1, 1);
    await choose(page, "Rajang");
    edits = await sentEdits(page, sent);
    const t10 = edits.modes[0].entries.find((x) => x.table === 1 && x.entry === 0);
    const t11 = edits.modes[0].entries.find((x) => x.table === 1 && x.entry === 1);
    check("normal pick on a Zenith entry sends zenith false", t10 && t10.zenith === false && t10.monster === undefined, JSON.stringify(t10));
    check("Rajang sends no zenith key", t11 && t11.monster === 53 && t11.zenith === undefined, JSON.stringify(t11));
    const level10 = await page.$eval("#road-table-0-1 .road-entries tbody tr:nth-child(1) td.num", (td) => td.textContent);
    check("normal Rathalos takes level 53", level10 === "53", level10);
    const problems = await page.$eval("#road-problems", (d) => d.textContent);
    check("no problems listed", /No problems found/.test(problems), problems);
    await page.close();

    // A rotation that does not allow "zenith".
    const narrow = Object.assign({}, POLICY, { entryFields: ["monster", "monster2", "weight", "forced"] });
    const page2 = await openPage(browser, port, narrow, [], errors);
    await openTable(page2, 0);
    const off = (await optionsOf(page2, 0, 0)).filter((o) => /^Zenith /.test(o.text));
    check("without zenith in the policy the forms are listed but not choosable",
      off.length === 3 && off.every((o) => o.disabled && /not in this rotation/.test(o.text)), JSON.stringify(off));
    await page2.close();
  } catch (error) {
    failures.push("run: " + (error && error.stack || error));
  } finally {
    await browser.close();
    server.close();
  }
  errors.forEach((e) => failures.push("page error: " + e));
  if (failures.length) {
    failures.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("Road builder Zenith forms OK");
})();
