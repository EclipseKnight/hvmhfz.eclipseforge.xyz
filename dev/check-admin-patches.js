#!/usr/bin/env node
/* Checks the client patch versions on the admin panel's Users tab (js/admin-patches.js, js/admin.js) in headless
   Chromium against a fake API (GET /api/admin/users as the API's docs/api-private.md) and this site's own
   data/patch-versions.json:

   - the summary line: current / pre-release (newer, when any) / older / unknown, from the API's patches counts and the version marked current
     (the check serves its own version file with v1.20 current); its tooltip lists each version;
   - each character chip shows the patch it last logged in with ("patch v1.19", "patch ≤v1.18"), none when not seen;
   - an API without the columns (patchTracking false) says the recording is off and the chips show no patch;
   - no page errors; the summary line adds no horizontal overflow at 375 px;
   - the pure helpers under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (admin-patches-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-patches.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const P = require("../js/admin-patches.js");

const root = path.join(__dirname, "..");
const shots = path.join(root, "dev-shots");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
// The version file the page reads: v1.20 current (the real file's current one changes with each release).
const VERSIONS = { patches: [{ version: "1.20", current: true }, { version: "1.19" }, { version: "1.18" }] };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/data/patch-versions.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(VERSIONS));
    return;
  }
  let file = path.join(root, url);
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
  return b64({ alg: "HS256" }) + "." + b64({ sub: "boss", exp }) + ".sig";
}
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
const NOW = "2026-11-20T12:00:00Z";

function character(id, name, clientPatch) {
  return { id, name, hr: 999, gr: 50, weapon: "Lance", lastLogin: NOW, deleted: false, isNew: false, clientPatch,
    clientPatchSeenAt: clientPatch === null ? null : NOW };
}

function usersReply(tracking) {
  const t = (v) => (tracking ? v : null);
  return {
    total: 2, page: 0, size: 25,
    summary: { accounts: 2, admins: 1, moderators: 0, linked: 0 },
    users: [
      { id: 1, username: "boss", roles: ["ROLE_ADMIN"], characters: 2, lastLogin: NOW, discordLinked: false, discordId: null,
        op: false, timer: false, characterList: [character(10, "Alpha", t(120)), character(11, "Bravo", t(119))] },
      { id: 2, username: "player", roles: ["ROLE_USER"], characters: 2, lastLogin: NOW, discordLinked: false, discordId: null,
        op: false, timer: false, characterList: [character(20, "Charlie", t(0)), character(21, "Delta", null)] },
    ],
    patchTracking: tracking,
    patches: tracking ? [
      { clientPatch: 120, characters: 5, seenLast7Days: 4 },
      { clientPatch: 119, characters: 3, seenLast7Days: 1 },
      { clientPatch: 0, characters: 7, seenLast7Days: 2 },
      { clientPatch: null, characters: 40, seenLast7Days: 0 },
    ] : [],
  };
}

function fakeApi(page, tracking) {
  page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/users") return reply(200, usersReply(tracking));
    return reply(404, { message: "not in this check" });
  });
}

async function open(browser, url, tracking, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  fakeApi(page, tracking);
  await page.goto(url);
  return { page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

function pure() {
  check("name 119", P.patchName(119) === "v1.19");
  check("name 200", P.patchName(200) === "v2.0");
  check("name 0", P.patchName(0) === "v1.18 or older");
  check("name null", P.patchName(null) === "not seen");
  // 10000 and up: a pre-release build, (major * 100 + minor) * 100 + N.
  check("name pre build", P.patchName(12102) === "v1.21-pre2" && P.patchName(12101) === "v1.21-pre1" && P.patchName(12199) === "v1.21-pre99"
    && P.patchName(10001) === "v1.0-pre1" && P.patchName(9999) === "v99.99", P.patchName(12102) + " " + P.patchName(9999));
  check("bucket pre build", P.bucket(12102, 120) === "pre");
  check("chip pre build", P.chipLabel({ clientPatch: 12102 }, true, 120) === "patch v1.21-pre2 pre-release"
    && P.chipLabel({ clientPatch: 12102 }, true) === "patch v1.21-pre2 pre-release", P.chipLabel({ clientPatch: 12102 }, true, 120));
  check("value", P.versionValue("1.19") === 119 && P.versionValue("v2.5") === 205);
  check("value refused", P.versionValue("1.100") === null && P.versionValue("soon") === null && P.versionValue("") === null);
  check("current from the file", P.currentValue(VERSIONS) === 120);
  check("no current", P.currentValue({ patches: [{ version: "1.1" }] }) === null && P.currentValue(null) === null);
  check("bucket", P.bucket(120, 120) === "current" && P.bucket(121, 120) === "pre" && P.bucket(119, 120) === "older"
    && P.bucket(0, 120) === "unknown" && P.bucket(null, 120) === "unknown" && P.bucket(119, null) === "known");
  const s = P.summarize(usersReply(true).patches, 120);
  check("summarize", s.current === 5 && s.older === 3 && s.unknown === 47 && s.notSeen === 40 && s.total === 55
    && s.recent === 7, JSON.stringify(s));
  const text = P.summaryText(usersReply(true), 120);
  check("summary text", text === "Client patch, played characters: 5 current (v1.20) · 3 older · 47 unknown "
    + "(7 on v1.18 or older, 40 not seen since recording started).", text);
  check("summary without the version file", P.summaryText(usersReply(true), null).includes("8 with a version"));
  check("summary off", P.summaryText(usersReply(false), 120).includes("not recorded yet"));
  check("breakdown", P.breakdown(usersReply(true)).split("\n")[0] === "v1.20: 5 (4 in the last 7 days)");
  check("chip labels", P.chipLabel({ clientPatch: 119 }, true) === "patch v1.19" && P.chipLabel({ clientPatch: 0 }, true)
    === "patch ≤v1.18" && P.chipLabel({ clientPatch: null }, true) === "" && P.chipLabel({ clientPatch: 119 }, false) === "");
  // A version newer than the current one is a pre-release (only testers get one).
  check("chip pre-release", P.chipLabel({ clientPatch: 121 }, true, 120) === "patch v1.21 pre-release"
    && P.chipLabel({ clientPatch: 120 }, true, 120) === "patch v1.20" && P.chipLabel({ clientPatch: 121 }, true) === "patch v1.21");
  const pre = usersReply(true);
  pre.patches = pre.patches.concat([{ clientPatch: 121, characters: 2, seenLast7Days: 2 }]);
  const preText = P.summaryText(pre, 120);
  check("summary with a pre-release", preText === "Client patch, played characters: 5 current (v1.20) · 2 pre-release (newer) · "
    + "3 older · 47 unknown (7 on v1.18 or older, 40 not seen since recording started).", preText);
}

async function main() {
  pure();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser, base + "/admin.html#users", true);
    await page.waitForSelector("#users-patches:not([hidden])");
    const line = await page.textContent("#users-patches");
    check("summary line", line.startsWith("Client patch, played characters: 5 current (v1.20) · 3 older · 47 unknown"), line);
    check("summary tooltip", (await page.getAttribute("#users-patches", "title")).includes("v1.19: 3 (1 in the last 7 days)"));
    const chips = await page.$$eval(".char-chip", (els) => els.map((e) => e.textContent));
    check("chip v1.20", chips.some((t) => t.includes("Alpha") && t.includes("patch v1.20")), chips.join(" | "));
    check("chip v1.19", chips.some((t) => t.includes("Bravo") && t.includes("patch v1.19")), chips.join(" | "));
    check("chip unpatched", chips.some((t) => t.includes("Charlie") && t.includes("patch ≤v1.18")), chips.join(" | "));
    check("chip never seen", chips.some((t) => t.includes("Delta") && !t.includes("patch")), chips.join(" | "));
    await shot(page, "admin-patches-1280.png");
    check("no page errors", errors.length === 0, errors.join("; "));
    await page.close();

    // Before the schema: the line says so; 375 px.
    const r = await open(browser, base + "/admin.html#users", false, 375);
    await r.page.waitForSelector("#users-patches:not([hidden])");
    check("off line", (await r.page.textContent("#users-patches")).includes("not recorded yet"));
    const offChips = await r.page.$$eval(".char-chip", (els) => els.map((e) => e.textContent));
    check("no patch on chips when off", offChips.length === 4 && offChips.every((t) => !t.includes("patch")), offChips.join(" | "));
    // The admin page's header is already 17 px too wide at 375 px (check-admin-notices.js says so too): check only
    // that the patch line adds nothing.
    const overflow = await r.page.evaluate(() => {
      const over = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const line = document.getElementById("users-patches");
      const shown = over();
      line.hidden = true;
      const without = over();
      line.hidden = false;
      return shown - without;
    });
    check("the patch line adds no overflow at 375 px", overflow <= 0, String(overflow));
    await shot(r.page, "admin-patches-375.png");
    check("no page errors at 375", r.errors.length === 0, r.errors.join("; "));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("FAIL\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("admin patches OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
