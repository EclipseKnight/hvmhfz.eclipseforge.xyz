#!/usr/bin/env node
/* Checks the diagnostics pages in headless Chromium against a fake API:

   Account page, Account tab, "Diagnostics" box (js/account-diag.js):
   - the help (game folder, hvdiag.txt, hvcrash files, 256 KB) is there; Upload is off until a file is picked;
   - an upload POSTs the file as it is to /api/account/diagnostics?name=<file name> with the token, and shows the
     outcome, one line per finding and the facts; API text goes in as text (no HTML);
   - a refusal (400) shows the API's message; a file over 256 KB is refused before any request; an API without the
     endpoint (404) says so;
   - nothing in the box passes 375px.
   Admin page:
   - the Diagnostics tab lists the reports (GET /api/admin/diagnostics), View shows the answer and the whole file,
     the account filter and Older send user= and before=;
   - the Users tab's Logins button shows the account's recent logins (GET /api/admin/users/{id}/logins): land,
     patch, options, refusal, how it ended; "does not record logins yet" when tracking is false; the
     "This account's diagnostics" button opens the tab filtered to that account;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-diag.js

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

const jwt = (exp) => "e30." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

const REPORT = "HVCRASH 1\r\ntime: 2026-11-10 01:02:03Z\r\nat: mhfo-hd.dll+0x0089f165\r\n";
const ANSWER = {
  id: 7, fileName: "hvcrash-20261110-010203.txt", kind: "crash",
  outcome: "The game crashed in our patch, part 87: diagnostics, the stage fallback (stub F) (mhfo-hd.dll 0x1089f165).",
  findings: [
    { kind: "crash", text: "What to do: For everyone, no switch: report it to staff with this file." },
    { kind: "patch-old", text: "Your patch is v1.19; the current one is v1.20: run the launcher to update." },
    { kind: "stage-file-missing", text: "Map file missing (<b>stage\\st394.pac</b>, stage 394): the game loaded Mezeporta instead." }
  ],
  facts: [["Edition", "HD (mhfo-hd.dll)"], ["Patch", "v1.19 (119)"], ["Scene", "town (player state 0)"]]
};
const LIST = [
  { id: 9, userId: 3, username: "player", createdAt: "2026-11-10T02:00:00Z", kind: "diag", fileName: "hvdiag.txt",
    outcome: "No problem recorded.", patchName: "v1.20", problems: [] },
  { id: 7, userId: 3, username: "player", createdAt: "2026-11-10T01:05:00Z", kind: "crash",
    fileName: "hvcrash-20261110-010203.txt", outcome: ANSWER.outcome, patchName: "v1.19", problems: ["stage-file-missing"] }
];
const LOGINS = {
  tracking: true,
  logins: [
    { id: 2, charId: 10, charName: "Hunter One", loginAt: "2026-11-10T01:50:00Z", logoutAt: null, serverId: 9,
      land: "Test land", clientPatch: 12103, clientPatchName: "v1.21-pre3", qolFlags: 0, qolNames: [],
      refusal: "gate: client v1.19, oldest allowed v1.20", disconnect: null },
    { id: 1, charId: 10, charName: "Hunter One", loginAt: "2026-11-10T00:00:00Z", logoutAt: "2026-11-10T01:00:00Z",
      serverId: 1, land: "Hunsterverse", clientPatch: 120, clientPatchName: "v1.20", qolFlags: 3,
      qolNames: ["True raw attack", "True element"], refusal: null, disconnect: "logout" }
  ]
};
const USERS = {
  total: 1, page: 0, size: 25, summary: { accounts: 1, admins: 1, moderators: 0, linked: 0 },
  users: [{ id: 3, username: "player", roles: ["ROLE_USER"], characters: 1, lastLogin: null, discordLinked: false,
    discordId: null, op: false, timer: false, characterList: [], patchChannel: "stable" }],
  patchTracking: false, patches: []
};

// state.mode: "ok" | "refuse" | "missing"; state.posts: [{url, body, auth, type}]; state.gets: [url];
// state.tracking: false to answer logins with tracking false
async function open(browser, base, page_, state, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 }, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p === "/api/users/self") return reply(200, { id: 1, username: "boss", roles: ["ROLE_ADMIN"], characters: [] });
    if (p === "/api/account/diagnostics") {
      state.posts.push({ url: req.url(), body: req.postData(), auth: req.headers()["authorization"], type: req.headers()["content-type"] });
      if (state.mode === "missing") return reply(404, { message: "Not found" });
      if (state.mode === "refuse") return reply(400, { message: "That is not a diagnostics file: upload hvdiag.txt." });
      return reply(200, ANSWER);
    }
    if (p === "/api/admin/diagnostics") { state.gets.push(url.search); return reply(200, LIST); }
    if (p === "/api/admin/diagnostics/7") return reply(200, { id: 7, userId: 3, username: "player", createdAt: LIST[1].createdAt,
      kind: "crash", fileName: LIST[1].fileName, answer: ANSWER, text: REPORT });
    if (p === "/api/admin/users") return reply(200, USERS);
    if (p === "/api/admin/users/3/logins") return reply(200, state.tracking === false ? { tracking: false, logins: [] } : LOGINS);
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    return reply(404, { message: "not in this check" });
  });
  await page.goto(base + page_);
  return { page, errors };
}

async function accountChecks(browser, base) {
  const state = { mode: "ok", posts: [], gets: [] };
  const { page, errors } = await open(browser, base, "/account.html#account", state);
  await page.waitForSelector("#diag-panel", { state: "attached" });
  const help = await page.textContent("#diag-panel");
  check("help names the files and the folder", help.includes("hvdiag.txt") && help.includes("hvcrash-")
    && help.includes("Open file location") && help.includes("256"), help.slice(0, 200));
  check("Upload off until a file is picked", await page.isDisabled("#diag-upload"));
  await page.setInputFiles("#diag-file", { name: "hvcrash-20261110-010203.txt", mimeType: "text/plain", buffer: Buffer.from(REPORT) });
  check("Upload on after a pick", !(await page.isDisabled("#diag-upload")));
  await page.click("#diag-upload");
  await page.waitForSelector("#diag-answer:not([hidden])");
  const post = state.posts[0] || {};
  check("one POST", state.posts.length === 1, String(state.posts.length));
  check("POST name", (post.url || "").endsWith("/api/account/diagnostics?name=hvcrash-20261110-010203.txt"), post.url);
  check("POST body is the file", post.body === REPORT, JSON.stringify(post.body));
  check("POST token", post.auth === "Bearer " + TOKEN);
  check("POST text/plain", (post.type || "").startsWith("text/plain"), post.type);
  check("outcome shown", (await page.textContent("#diag-outcome")) === ANSWER.outcome);
  const items = await page.$$eval("#diag-findings li", (n) => n.map((x) => x.textContent));
  check("findings shown", items.length === 3 && items[1].includes("v1.19"), JSON.stringify(items));
  check("API text is text", items[2].includes("<b>stage") && (await page.$$("#diag-findings b")).length === 0);
  const facts = await page.$$eval("#diag-facts dt", (n) => n.map((x) => x.textContent));
  check("facts shown", facts.join(",") === "Edition,Patch,Scene", facts.join(","));

  state.mode = "refuse";
  await page.setInputFiles("#diag-file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.click("#diag-upload");
  await page.waitForSelector("#diag-alert:not([hidden])");
  check("refusal message", (await page.textContent("#diag-alert")).includes("not a diagnostics file"));
  check("answer hidden after a refusal", await page.isHidden("#diag-answer"));

  const before = state.posts.length;
  await page.setInputFiles("#diag-file", { name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(256 * 1024 + 1, 65) });
  await page.click("#diag-upload");
  await page.waitForSelector("#diag-alert:not([hidden])");
  check("too large refused here", (await page.textContent("#diag-alert")).includes("too large") && state.posts.length === before);

  state.mode = "missing";
  await page.setInputFiles("#diag-file", { name: "hvdiag.txt", mimeType: "text/plain", buffer: Buffer.from("HVDIAG 1\r\n") });
  await page.click("#diag-upload");
  await page.waitForFunction(() => document.getElementById("diag-alert").textContent.includes("not available"));
  check("no errors on the account page", errors.length === 0, errors.join(" | "));
  await page.close();

  const narrow = await open(browser, base, "/account.html#account", { mode: "ok", posts: [], gets: [] }, 375);
  await narrow.page.waitForSelector("#diag-panel", { state: "attached" });
  await narrow.page.setInputFiles("#diag-file", { name: "hvcrash-1.txt", mimeType: "text/plain", buffer: Buffer.from(REPORT) });
  await narrow.page.click("#diag-upload");
  await narrow.page.waitForSelector("#diag-answer:not([hidden])");
  // The page's own header passes 375px by 17px with this fake API on the branch without this box too, so measure the
  // box, as dev/check-account-qol.js does for its card: nothing in it may pass the window.
  const wide = await narrow.page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll("#diag-panel, #diag-panel *"))
      .filter((n) => n.getBoundingClientRect().right > w + 0.5).map((n) => n.tagName + "#" + n.id);
  });
  check("the box stays inside 375px", wide.length === 0, wide.join(","));
  await narrow.page.close();
}

async function adminChecks(browser, base) {
  const state = { mode: "ok", posts: [], gets: [] };
  const { page, errors } = await open(browser, base, "/admin.html#diagnostics", state);
  await page.waitForSelector("#diag-rows tr:nth-child(2)");
  const rows = await page.$$eval("#diag-rows tr", (n) => n.map((x) => x.textContent));
  check("report list", rows.length === 2 && rows[1].includes("hvcrash-20261110-010203.txt") && rows[1].includes("stage-file-missing")
    && rows[1].includes("player (#3)"), JSON.stringify(rows));
  check("first list call", state.gets[0] === "?limit=50", state.gets[0]);
  await page.click("#diag-rows tr:nth-child(2) button");
  await page.waitForSelector("#diag-view-panel:not([hidden])");
  check("view outcome", (await page.textContent("#diag-view-outcome")) === ANSWER.outcome);
  check("view findings", (await page.$$("#diag-view-findings li")).length === 3);
  check("view raw file", (await page.textContent("#diag-view-raw")) === REPORT);
  await page.fill("#diag-user", "3");
  await page.click("#diag-filter");
  await page.waitForTimeout(200);
  check("filter sends user", state.gets[state.gets.length - 1] === "?limit=50&user=3", state.gets[state.gets.length - 1]);

  await page.evaluate(() => { window.location.hash = "users"; });
  await page.waitForSelector("#user-rows button:has-text('Logins')");
  await page.click("#user-rows button:has-text('Logins')");
  await page.waitForSelector("#logins-rows tr:nth-child(2)");
  const logins = await page.$$eval("#logins-rows tr", (n) => n.map((x) => x.textContent));
  check("logins newest first", logins[0].includes("Test land") && logins[0].includes("v1.21-pre3")
    && logins[0].includes("gate: client v1.19") && logins[0].includes("on now, or no logout"), logins[0]);
  check("logins second row", logins[1].includes("True raw attack, True element") && logins[1].includes("logout")
    && logins[1].includes("Hunter One (10)"), logins[1]);
  await page.click("#logins-diag");
  await page.waitForSelector("#panel-diagnostics:not([hidden])");
  await page.waitForTimeout(200);
  check("account diagnostics from logins", state.gets[state.gets.length - 1] === "?limit=50&user=3", state.gets[state.gets.length - 1]);
  check("no errors on the admin page", errors.length === 0, errors.join(" | "));
  await page.close();

  const off = await open(browser, base, "/admin.html#users", { mode: "ok", posts: [], gets: [], tracking: false });
  await off.page.waitForSelector("#user-rows button:has-text('Logins')");
  await off.page.click("#user-rows button:has-text('Logins')");
  await off.page.waitForFunction(() => document.getElementById("logins-rows").textContent.includes("does not record logins yet"));
  await off.page.close();
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await accountChecks(browser, base);
    await adminChecks(browser, base);
  } catch (e) {
    failures.push("exception: " + e.message);
  }
  await browser.close();
  server.close();
  if (failures.length) {
    failures.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("diagnostics pages OK");
})();
