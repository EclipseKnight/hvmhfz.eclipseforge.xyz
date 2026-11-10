#!/usr/bin/env node
/* Checks the Road builder's "Test in game" panel (road.html, js/road-test.js) in headless Chromium on a fake
   API with a small made-up Road (no game data):
   - live setting off (GET /api/account/road-test says enabled false, no test): the panel stays hidden;
   - on: the panel shows the hours, the warning that test runs are not saved, "no test running", Stop hidden; Test in game sends PUT with the page's
     name and edits (js/road.js roadDraftState), then shows "testing <name> until ..." and the Stop button;
   - a Road the API refuses (400 with problems): the reason and the first problem show, the button comes back;
   - Stop sends DELETE and hides Stop again;
   - no name: refused on the page, nothing sent;
   - no script errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-road-test.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

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

function entry(monster) {
  return { monster: monster, unk04: 10, monster2: 0, unk0c: 0, level: 53, unk14: -1, weight: 10, flags: 0 };
}
const MODE = {
  floors: [{ floor: 1, table: 0, bonus: 0, points: 1, points2: 1, loop: 1 }],
  tables: [[entry(1), entry(11), entry(51), entry(146)]]
};
const BASE = { modes: [MODE, MODE] };
const POLICY = { modes: [0], floorFields: ["table"], entryFields: ["monster", "monster2", "weight", "forced"],
  floorCount: false, modeCount: false, maxAddedEntries: 64, maxWeight: 1000, maxPoints: 4 };

const TOKEN = "e30." + Buffer.from(JSON.stringify({ exp: 4102444800 })).toString("base64url") + ".x";
const failures = [];
let passed = 0;
const check = (label, ok, detail) => { if (ok) passed++; else failures.push(label + (detail ? ": " + detail : "")); };

// state: the fake API's road_test answer; refuse: answer the next PUT with a 400; sent: the requests seen.
async function open(browser, base, state) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const sent = [];
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
    let status = 200;
    let body = [];
    if (p === "/api/road/pool") {
      body = { base: BASE, policy: POLICY, maxFileSize: 9668,
        monsters: [1, 11, 51, 146].map((id) => ({ id: id, name: "Monster " + id })) };
    } else if (p === "/api/road/cycle") {
      body = { id: 1, state: "submitting", submitCloses: "2026-11-20T00:00:00Z", myEntries: [], limits: { entriesPerAccount: 1 } };
    } else if (p === "/api/account/road-preference") {
      body = {};
    } else if (p === "/api/account/road-test") {
      sent.push({ method: req.method(), body: req.postData() ? JSON.parse(req.postData()) : null });
      if (req.method() === "PUT" && state.refuse) {
        state.refuse = false;
        status = 400;
        body = { message: "The Road breaks the rules.", problems: [{ rule: "table-index", message: "Floor 1 uses table 9, which does not exist." }] };
      } else {
        if (req.method() === "PUT") {
          state.test = { name: JSON.parse(req.postData()).name, sha256: "ab".repeat(32), size: 4000,
            createdAt: "2026-11-09T21:00:00Z", expiresAt: "2026-11-10T03:00:00Z" };
        } else if (req.method() === "DELETE") {
          state.test = null;
        }
        body = { enabled: state.enabled, hours: state.hours, test: state.test };
      }
    }
    return route.fulfill({ status: status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  });
  await page.goto(base + "/road.html");
  await page.waitForSelector("#road-app:not([hidden])", { timeout: 8000 });
  await page.waitForTimeout(300); // road-test.js asks after the page is up
  return { page: page, errors: errors, sent: sent };
}

async function run(browser, base) {
  {
    const { page, errors, sent } = await open(browser, base, { enabled: false, hours: 24, test: null });
    check("off: panel hidden", await page.locator("#road-test-panel").isHidden());
    check("off: asked once", sent.length === 1 && sent[0].method === "GET", JSON.stringify(sent));
    check("off: no script errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
  {
    const state = { enabled: true, hours: 6, test: null, refuse: false };
    const { page, errors, sent } = await open(browser, base, state);
    check("on: panel shown", await page.locator("#road-test-panel").isVisible());
    check("on: hours", (await page.textContent("#road-test-hours")) === "6");
    check("on: no test", /no test running/.test(await page.textContent("#road-test-state")));
    check("on: stop hidden", await page.locator("#road-test-stop").isHidden());
    const warning = (await page.textContent("#road-test-warning")).replace(/\s+/g, " ").trim();
    check("on: no-save warning shown before use", await page.locator("#road-test-warning").isVisible() &&
      warning.startsWith("Nothing is saved from the moment a test Road starts until you log out.") &&
      warning.includes("thrown away when you log out") && warning.includes("short session just for testing"), warning);

    sent.length = 0;
    await page.fill("#road-name", "");
    await page.click("#road-test-start");
    check("no name: refused on the page", /name/.test(await page.textContent("#road-test-note")) && sent.length === 0);

    await page.fill("#road-name", "Lava Lap");
    state.refuse = true;
    await page.click("#road-test-start");
    await page.waitForFunction(() => /breaks the rules/.test(document.getElementById("road-test-note").textContent));
    check("refused: the problem shows", /table 9/.test(await page.textContent("#road-test-note")));
    check("refused: button back", await page.locator("#road-test-start").isEnabled());

    sent.length = 0;
    await page.click("#road-test-start");
    await page.waitForFunction(() => /testing/.test(document.getElementById("road-test-state").textContent));
    const put = sent.filter((s) => s.method === "PUT")[0];
    check("start: PUT with name and edits", put && put.body.name === "Lava Lap" && typeof put.body.edits === "object",
      JSON.stringify(put));
    check("start: state names the Road", /"Lava Lap"/.test(await page.textContent("#road-test-state")));
    check("start: stop shown", await page.locator("#road-test-stop").isVisible());
    check("start: log in again", /Log in to the game again/.test(await page.textContent("#road-test-note")));

    await page.click("#road-test-stop");
    await page.waitForFunction(() => /no test running/.test(document.getElementById("road-test-state").textContent));
    check("stop: DELETE sent", sent.some((s) => s.method === "DELETE"));
    check("stop: stop hidden", await page.locator("#road-test-stop").isHidden());
    check("on: no script errors", errors.length === 0, errors.join(" | "));
    await page.close();
  }
}

server.listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await run(browser, base);
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(passed + " checks passed" + (failures.length ? ", " + failures.length + " failed:" : "."));
  failures.forEach((f) => console.log("  FAIL " + f));
  process.exit(failures.length ? 1 : 0);
});
