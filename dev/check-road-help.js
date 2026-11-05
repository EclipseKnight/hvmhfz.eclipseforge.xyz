#!/usr/bin/env node
/* Checks the Road builder page (road.html, js/road.js, js/road-help.js) in headless Chromium on a fake API
   with a small made-up Road (no game data):
   - every element with data-help gets one "?" circle with its HELP text, named after its field and
     described by its text box; the entry tables' column headers get one each (Entry ... Level);
   - at 1280x800 hovering a header's circle shows its text box whole on screen (not cut by the table's
     scroll box), and leaving hides it; at 375x667 the tables become cards, the column key above them shows,
     a tap keeps the box open inside the screen, a second tap, a tap elsewhere and Escape close it;
   - the Level column: a picker of every level 0 to 83 (the ones the base uses with the monster first, the
     others under the "may play at base strength" warning), any of them passes the checks; enabled when the policy allows "level"; choosing one puts it in the edits and marks the row;
     a level picked for a new monster stays, and a later monster change drops it; with a policy that leaves
     "level" out the picker is disabled;
   - no script errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-road-help.js
     SHOTS=dev-shots NODE_PATH=... node dev/check-road-help.js   (also saves screenshots with a box open)

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS;
async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, "road-help-" + name + ".png") });
}
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

function entry(monster, level, unk04, weight) {
  return { monster: monster, unk04: unk04 || 10, monster2: 0, unk0c: 0, level: level, unk14: -1,
    weight: weight === undefined ? 10 : weight, flags: 0 };
}

// Mode 0 at level 53 with one monster at 77, a Zenith-like table at 64-67; mode 1 at 78.
function mode(level) {
  return {
    floors: [
      { floor: 1, table: 0, bonus: 0, points: 1, points2: 1, loop: 1 },
      { floor: 2, table: 1, bonus: 0, points: 2, points2: 2, loop: 0 }
    ],
    tables: [
      [entry(1, level), entry(11, level), entry(51, level), entry(146, 77)],
      [entry(11, 64, 16), entry(17, 65, 16), entry(95, 66, 16), entry(15, 67, 16)]
    ]
  };
}
const BASE = { modes: [mode(53), mode(78)] };
const LEVEL_POLICY = { modes: [0], floorFields: ["table"], entryFields: ["monster", "monster2", "weight", "forced", "level"],
  floorCount: false, modeCount: false, maxAddedEntries: 64, maxWeight: 1000, maxPoints: 4 };
const NO_LEVEL_POLICY = Object.assign({}, LEVEL_POLICY, { entryFields: ["monster", "monster2", "weight", "forced"] });

const TOKEN = "e30." + Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url") + ".x";
const failures = [];
let passed = 0;
const check = (label, ok, detail) => { if (ok) passed++; else failures.push(label + (detail ? ": " + detail : "")); };

async function open(browser, base, policy, size) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, hasTouch: size[0] < 500 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript((t) => {
    localStorage.setItem("hvmhfz.token", t);
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  }, TOKEN);
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    let body = [];
    if (p === "/api/road/pool") {
      body = { base: BASE, policy: policy, maxFileSize: 9668,
        monsters: [1, 11, 15, 17, 51, 95, 146].map((id) => ({ id: id, name: "Monster " + id })) };
    } else if (p === "/api/road/cycle") {
      body = { id: 1, state: "submitting", submitCloses: "2026-11-20T00:00:00Z", myEntries: [], limits: { entriesPerAccount: 1 } };
    } else if (p === "/api/account/road-preference") {
      body = {};
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  });
  await page.goto(base + "/road.html");
  await page.waitForSelector("#road-app:not([hidden])", { timeout: 8000 });
  await page.evaluate(() => { const d = document.getElementById("road-table-0-0"); d.open = true; });
  await page.waitForSelector("#road-table-0-0 table.road-entries th .help-tip", { state: "attached", timeout: 5000 });
  return { page: page, errors: errors };
}

// The edit of mode 0 table 0 entry e, from the page's draft state (js/road.js roadDraftState).
async function entryEdit(page, e) {
  return page.evaluate((e) => {
    const me = (window.roadDraftState().edits.modes || []).filter((x) => x.mode === 0)[0];
    return me ? (me.entries || []).filter((x) => x.table === 0 && x.entry === e)[0] || null : null;
  }, e);
}

async function chooseLevel(page, e, label) {
  const row = page.locator("#road-table-0-0 tbody tr").nth(e);
  await row.locator("td[data-label=Level] .bui-picker-btn").click();
  await page.locator(".bui-option .bui-name", { hasText: new RegExp("^" + label + "$") }).first().click();
  await page.waitForTimeout(250); // road.js re-checks 120 ms after an edit
}

async function desktop(browser, base) {
  const { page, errors } = await open(browser, base, LEVEL_POLICY, [1280, 800]);
  try {
    const tips = await page.evaluate(() => {
      const help = window.RoadHelp.HELP;
      const out = { missing: [], wrong: [], keys: [] };
      document.querySelectorAll("[data-help]").forEach((n) => {
        const key = n.getAttribute("data-help");
        const scope = n.tagName === "LABEL" ? n.parentNode : n.tagName === "BUTTON" ? null : n;
        const tip = scope ? scope.querySelector(".help-tip[data-help-key='" + key + "']")
          : (n.nextElementSibling && n.nextElementSibling.matches(".help-tip") ? n.nextElementSibling : null);
        if (!tip) { out.missing.push(key); return; }
        out.keys.push(key);
        const pop = document.getElementById(tip.getAttribute("aria-describedby"));
        if (!pop || pop.textContent !== help[key] || !help[key] || !/^What is ".+"\?$/.test(tip.getAttribute("aria-label"))) {
          out.wrong.push(key + " (" + tip.getAttribute("aria-label") + ")");
        }
      });
      out.headers = Array.prototype.map.call(document.querySelectorAll("#road-table-0-0 thead th"), (th) => {
        const tip = th.querySelector(".help-tip");
        return tip ? tip.getAttribute("data-help-key") : "-";
      });
      out.count = document.querySelectorAll(".help-tip").length;
      out.unknown = Object.keys(help).filter((k) => !document.querySelector(".help-tip[data-help-key='" + k + "']"));
      return out;
    });
    check("desktop: every data-help has a circle", tips.missing.length === 0, tips.missing.join(", "));
    check("desktop: circles have their text and name", tips.wrong.length === 0, tips.wrong.join(", "));
    check("desktop: column headers have circles", JSON.stringify(tips.headers) ===
      JSON.stringify(["entry", "monster", "monster2", "weight", "forced", "level"]), JSON.stringify(tips.headers));
    check("desktop: every HELP text is used", tips.unknown.length === 0, tips.unknown.join(", "));
    check("desktop: the phone column key is hidden", !(await page.locator(".road-key-phone").first().isVisible()));

    // Hover the Level header's circle: the box shows whole, on screen; leaving hides it.
    const levelTip = page.locator("#road-table-0-0 thead th .help-tip[data-help-key=level]");
    await levelTip.hover();
    const pop = page.locator("#" + await levelTip.getAttribute("aria-describedby"));
    check("desktop: hover shows the box", await pop.isVisible());
    await shot(page, "desktop-level");
    const box = await pop.boundingBox();
    check("desktop: the box is on screen", box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800,
      JSON.stringify(box));
    const onTop = await page.evaluate((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      const n = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!n && n.id === id;
    }, await levelTip.getAttribute("aria-describedby"));
    check("desktop: the box is not covered or cut off", onTop);
    await page.mouse.move(5, 5);
    check("desktop: leaving hides the box", !(await pop.isVisible()));
    await levelTip.click();
    check("desktop: a click keeps it open", await pop.isVisible() && (await levelTip.getAttribute("aria-expanded")) === "true");
    await levelTip.click();
    check("desktop: a second click closes it", !(await pop.isVisible()));
    await shot(page, "desktop-table");

    // The Level picker: entry 0 (Monster 1 at 53, +0x04 10): 53 and 78 are used with it, the rest of 0-83 not.
    const levelBtn = page.locator("#road-table-0-0 tbody tr").nth(0).locator("td[data-label=Level] .bui-picker-btn");
    check("level: picker enabled with level in the policy", await levelBtn.isEnabled());
    check("level: shows the entry's level", (await levelBtn.textContent()).trim() === "53", await levelBtn.textContent());
    await levelBtn.click();
    const listed = await page.evaluate(() => Array.prototype.map.call(
      document.querySelectorAll(".bui-pop:not([hidden]) li.bui-option .bui-name, .bui-pop:not([hidden]) li.bui-group"),
      (n) => n.textContent.trim()));
    const others = [];
    for (let l = 0; l <= 83; l++) if (l !== 53 && l !== 78) others.push(String(l));
    check("level: every level 0-83, used with the monster first", JSON.stringify(listed) ===
      JSON.stringify(["Used with this monster", "53", "78", "Not used with this monster: may play at base strength"].concat(others)),
    JSON.stringify(listed));
    await page.keyboard.press("Escape");
    await chooseLevel(page, 0, "78");
    const edit = await entryEdit(page, 0);
    check("level: the choice is in the edits", edit && edit.level === 78, JSON.stringify(edit));
    check("level: the row is marked changed", await page.locator("#road-table-0-0 tbody tr").nth(0).evaluate((r) => r.classList.contains("is-changed")));
    const problems = await page.textContent("#road-problems");
    check("level: 78 passes the checks", /No problems found/.test(problems), problems);
    await chooseLevel(page, 0, "10");
    const problems10 = await page.textContent("#road-problems");
    check("level: a level the base never uses (10) passes the checks", /No problems found/.test(problems10) &&
      (await entryEdit(page, 0)).level === 10, problems10);
    await chooseLevel(page, 0, "53");
    check("level: back to the base drops the edit", (await entryEdit(page, 0)) === null, JSON.stringify(await entryEdit(page, 0)));

    // A Zenith-like entry (monster 11 at 64): 53, 64 and 78 are used with its monster, all 84 levels offered.
    await page.evaluate(() => { document.getElementById("road-table-0-1").open = true; });
    await page.waitForSelector("#road-table-0-1 tbody tr");
    await page.locator("#road-table-0-1 tbody tr").nth(0).locator("td[data-label=Level] .bui-picker-btn").click();
    const zenith = await page.evaluate(() => Array.prototype.map.call(
      document.querySelectorAll(".bui-pop:not([hidden]) li.bui-option .bui-name"), (n) => n.textContent.trim()));
    check("level: Zenith-like entry offers 84 levels, 53, 64 and 78 first", zenith.length === 84 &&
      JSON.stringify(zenith.slice(0, 3)) === JSON.stringify(["53", "64", "78"]), JSON.stringify(zenith.slice(0, 5)));
    await page.keyboard.press("Escape");

    // A level picked after a new monster stays even at the base's value; a later monster change drops it.
    const monsterBtn = page.locator("#road-table-0-0 tbody tr").nth(1).locator("td[data-label=Monster] .bui-picker-btn");
    await monsterBtn.click();
    await page.keyboard.type("Zinogre");
    await page.locator(".bui-pop:not([hidden]) .bui-option .bui-name", { hasText: /^Zinogre$/ }).click();
    await page.waitForTimeout(250);
    let e1 = await entryEdit(page, 1);
    check("level: a new monster takes its own level", e1 && e1.monster === 146 && e1.level === undefined &&
      (await page.locator("#road-table-0-0 tbody tr").nth(1).locator("td[data-label=Level] .bui-picker-btn").textContent()).trim() === "77",
    JSON.stringify(e1));
    await chooseLevel(page, 1, "53");
    e1 = await entryEdit(page, 1);
    check("level: a level picked for a new monster stays", e1 && e1.monster === 146 && e1.level === 53, JSON.stringify(e1));
    await monsterBtn.click();
    await page.keyboard.type("Blangonga");
    await page.locator(".bui-pop:not([hidden]) .bui-option .bui-name", { hasText: /^Blangonga$/ }).click();
    await page.waitForTimeout(250);
    e1 = await entryEdit(page, 1);
    check("level: a monster change drops the picked level", e1 && e1.monster === 51 && e1.level === undefined, JSON.stringify(e1));
    check("desktop: no script errors", errors.length === 0, errors.join("; "));
  } finally {
    await page.close();
  }
}

async function phone(browser, base) {
  const { page, errors } = await open(browser, base, NO_LEVEL_POLICY, [375, 667]);
  try {
    check("phone: the column key shows", await page.locator(".road-key-phone[data-help=level]").isVisible());
    check("phone: the table headers are hidden", !(await page.locator("#road-table-0-0 thead").isVisible()));
    const tip = page.locator(".road-key-phone[data-help=level] .help-tip");
    const pop = page.locator("#" + await tip.getAttribute("aria-describedby"));
    await tip.tap();
    check("phone: a tap opens the box", await pop.isVisible() && (await tip.getAttribute("aria-expanded")) === "true");
    await shot(page, "phone-level");
    const box = await pop.boundingBox();
    check("phone: the box fits the screen", box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 375 && box.y + box.height <= 667,
      JSON.stringify(box));
    const size = await tip.boundingBox();
    check("phone: the circle is big enough to tap", size && size.width >= 24 && size.height >= 24, JSON.stringify(size));
    await tip.tap();
    check("phone: a second tap closes it", !(await pop.isVisible()));
    await tip.tap();
    await page.locator("#road-tables-note").tap(); // above the key, so never under the box
    check("phone: a tap elsewhere closes it", !(await pop.isVisible()));
    await tip.tap();
    await page.keyboard.press("Escape");
    check("phone: Escape closes it", !(await pop.isVisible()));
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    check("phone: no sideways scroll", width <= 375, String(width));
    const levelBtn = page.locator("#road-table-0-0 tbody tr").nth(0).locator("td[data-label=Level] .bui-picker-btn");
    check("level: picker disabled when the policy leaves level out", await levelBtn.isDisabled());
    check("level: still shows the level", (await levelBtn.textContent()).trim() === "53");
    check("phone: no script errors", errors.length === 0, errors.join("; "));
  } finally {
    await page.close();
  }
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await desktop(browser, base);
    await phone(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s), " + passed + " passed");
    process.exit(1);
  }
  console.log("road builder help and level OK (" + passed + " checks)");
})().catch((e) => { console.error(e); process.exit(1); });
