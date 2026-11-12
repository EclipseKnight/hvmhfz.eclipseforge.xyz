#!/usr/bin/env node
/* Checks the diagnostics pages in headless Chromium against a fake API:

   Account page, Diagnostics tab, "Diagnostics" box (js/account-diag.js):
   - the help (game folder, hvdiag.txt, hvcrash files, 256 KB) is there; the "What went wrong?" note (1,000 characters,
     placeholder, counter) and the Area select (6 areas) sit above the drop zone with an "Add a note first" hint; the
     Upload button is hidden until files are left queued;
   - files upload AS SOON AS they are picked or dropped (no Upload click), one after another (never two at once):
     each POSTs the file as it is to /api/account/diagnostics?name=<file name>&note=&area= with the token, the note
     (trimmed) and the area of that moment on every file of the batch, and shows its own outcome, one line per
     finding, the facts and the note/area echoed back; API text goes in as text (no HTML);
   - an empty note still uploads (no note or area in the request); a note over 1,000 characters is cut to 1,000; a
     long Japanese note is cut to keep the request line under 6,000 encoded characters, with a message;
   - 2 files dropped on the box (hover state while dragging) are uploaded the same way;
   - a wrong file type or a file over 256 KB is listed as an error and never sent; a .log file (hvmods.log, which the
     browser gives no type) is accepted and sent as it is, also a 300 KB one (the API keeps its newest 256 KB), a .log
     over 2 MB or a .png is listed as an error; an API refusal (400) on one file
     shows the API's message and the other files still go; more than 10 files at once are capped with a message;
     an API without the endpoint (404) says so and keeps the files queued, with a primary "N files ready: Upload"
     button, and leaving the page with queued files asks first (beforeunload); not signed in: nothing is sent, the
     files stay queued;
   - nothing in the box passes 375px. Screenshots go to /srv/devbot/.bot-logs/diag-upload-multi/.
   Admin page:
   - the Diagnostics tab lists the reports (GET /api/admin/diagnostics) with the area and the player's note (cut to 80
     characters, whole note as the tooltip), View shows the note, the area, the answer and the whole file, the account
     and area filters and Older send user=, area= and before=;
   - a report with "moves" ([moves] lines, part 109) shows the Move hits table: time, weapon, style, move id with its
     name from /data/weapons (a "(guess)" mark for guesses; bowgun shots by class, k6v1 for the HBG), MV with the
     hit's own MV, damage, crit; ids without a name (missing, or "unknown" in the data) flagged "unnamed" and listed in
     the note; a line it cannot read is shown as it is; a report without moves hides the table;
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
  facts: [["Edition", "HD (mhfo-hd.dll)"], ["Patch", "v1.19 (119)"], ["Scene", "town (player state 0)"],
    ["Move hits", "312 move hits recorded (the last 6 in this report)"]]
};
// [moves] lines (hvmhfz_re part 109): named, a guess, the hit's own MV, an id the data has no record of, an "unknown"
// record, a bowgun shot (entry 6 by class) and a line from an hvmods.dll this page does not know.
const MOVES = [
  "01:00:05Z GS storm kind 0 id 2 mv 46 damage 120 crit",
  "01:00:06Z GS storm kind 0 id 4 mv 2 (hit 3) damage 5",
  "01:00:07Z GS extreme kind 0 id 9999 mv 40 damage 75 (no copy seen: id from +6)",
  "01:00:08Z LS heaven kind 0 id 207 mv 23 damage 30 negative crit",
  "01:00:09Z HBG style 7 kind 6 id 7 mv 12 damage 9",
  "01:00:10Z something new"
];
// A long note (over 80 characters) with a line break and markup: the list cuts it, the detail shows all of it.
const NOTE = "The game crashed when I broke a part in the 3rd District <b>twice</b>,\nright after the quest timer reached ten minutes.";
const LIST = [
  { id: 9, userId: 3, username: "player", createdAt: "2026-11-10T02:00:00Z", kind: "diag", fileName: "hvdiag.txt",
    outcome: "No problem recorded.", patchName: "v1.20", problems: [], note: null, area: null },
  { id: 7, userId: 3, username: "player", createdAt: "2026-11-10T01:05:00Z", kind: "crash",
    fileName: "hvcrash-20261110-010203.txt", outcome: ANSWER.outcome, patchName: "v1.19", problems: ["stage-file-missing"],
    note: NOTE, area: "crash" }
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
      state.parallel = (state.parallel || 0) + 1;
      state.maxParallel = Math.max(state.maxParallel || 0, state.parallel);
      const name = url.searchParams.get("name") || "";
      const answer = () => {
        state.parallel--;
        if (state.mode === "missing") return reply(404, { message: "Not found" });
        if (state.mode === "refuse" && (!state.failName || state.failName === name)) return reply(400, { message: "That is not a diagnostics file: upload hvdiag.txt." });
        // the API echoes the note and area as kept (absent when none)
        return reply(200, Object.assign({}, ANSWER, { fileName: name, note: url.searchParams.get("note") || undefined,
          area: url.searchParams.get("area") || undefined }));
      };
      return state.delay ? setTimeout(answer, state.delay) : answer();
    }
    if (p === "/api/admin/diagnostics") {
      state.gets.push(url.search);
      const area = url.searchParams.get("area");
      return reply(200, area ? LIST.filter((r) => r.area === area) : LIST);
    }
    if (p === "/api/admin/diagnostics/7") return reply(200, { id: 7, userId: 3, username: "player", createdAt: LIST[1].createdAt,
      kind: "crash", fileName: LIST[1].fileName, answer: ANSWER, text: REPORT, moves: MOVES, note: NOTE, area: "crash" });
    if (p === "/api/admin/diagnostics/9") return reply(200, { id: 9, userId: 3, username: "player", createdAt: LIST[0].createdAt,
      kind: "diag", fileName: LIST[0].fileName, answer: { outcome: "No problem recorded.", findings: [], facts: [] }, text: "HVDIAG 1\r\n", moves: [], note: null, area: null });
    if (p === "/api/admin/users") return reply(200, USERS);
    if (p === "/api/admin/users/3/logins") return reply(200, state.tracking === false ? { tracking: false, logins: [] } : LOGINS);
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    return reply(404, { message: "not in this check" });
  });
  await page.goto(base + page_);
  return { page, errors };
}

const SHOTS = "/srv/devbot/.bot-logs/diag-upload-multi";
const txt = (name, body) => ({ name, mimeType: "text/plain", buffer: Buffer.from(body === undefined ? REPORT : body) });
const rowsOf = (page) => page.$$eval("#diag-list > li", (n) => n.map((x) => ({
  name: x.querySelector(".diag-file-name").textContent, status: x.querySelector(".diag-file-status").textContent,
  text: x.textContent })));
// Every listed file has its answer or its error (nothing queued or uploading any more).
const settled = (page) => page.waitForFunction(() => {
  const n = document.querySelectorAll("#diag-list .diag-file-status");
  return n.length > 0 && Array.from(n).every((x) => x.textContent === "Answer" || x.textContent === "Error");
});
const paramsOf = (post) => new URL(post.url).searchParams;
// What leaving the page would do: true when the page asks first.
const asksBeforeLeaving = (page) => page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
// Drop files from "Explorer": a real DragEvent with a DataTransfer holding the files.
async function dropFiles(page, files) {
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    fs.forEach((f) => d.items.add(new File([f.body], f.name, { type: f.type })));
    return d;
  }, files.map((f) => ({ name: f.name, body: f.body === undefined ? REPORT : f.body, type: f.type === undefined ? "text/plain" : f.type })));
  await page.dispatchEvent("#diag-drop", "dragenter", { dataTransfer: dt });
  await page.dispatchEvent("#diag-drop", "dragover", { dataTransfer: dt });
  return dt;
}
const dropIt = (page, dt) => page.dispatchEvent("#diag-drop", "drop", { dataTransfer: dt });

async function accountChecks(browser, base) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const state = { mode: "ok", posts: [], gets: [] };
  const { page, errors } = await open(browser, base, "/account.html#diagnostics", state);
  await page.waitForSelector("#diag-panel", { state: "attached" });
  const help = await page.textContent("#diag-panel");
  check("help names the files and the folder", help.includes("hvdiag.txt") && help.includes("hvcrash-")
    && help.includes("hvmods.log") && help.includes("Open file location") && help.includes("256") && help.includes("10 at a time"), help.slice(0, 200));
  check("picker takes several files", await page.$eval("#diag-file", (n) => n.multiple));
  check("picker offers .txt and .log", (await page.getAttribute("#diag-file", "accept")).split(",").includes(".log")
    && (await page.getAttribute("#diag-file", "accept")).split(",").includes(".txt"));
  // the note and the area
  check("note box: label, 1000 limit, placeholder", (await page.textContent("label[for=diag-note]")).includes("What went wrong?")
    && (await page.getAttribute("#diag-note", "maxlength")) === "1000"
    && (await page.getAttribute("#diag-note", "placeholder")) === "e.g. the game crashed when I broke a part in the 3rd District");
  const areas = await page.$$eval("#diag-area option", (n) => n.map((o) => o.value + "=" + o.textContent));
  check("area select has the 6 areas", areas.join(",") === "=Not chosen,crash=Crash,mods=Mods/overlays,quest=Quest,sky-road=Sky Corridor/Road,controls=Controls,other=Other", areas.join(","));
  const hintTop = (await page.locator("#diag-note-hint").boundingBox()).y;
  const dropTop = (await page.locator("#diag-drop").boundingBox()).y;
  check("'Add a note first' hint above the drop zone", (await page.textContent("#diag-note-hint")).includes("Add a note first") && hintTop < dropTop,
    hintTop + " vs " + dropTop);
  check("counter starts at 0", (await page.textContent("#diag-note-count")) === "0 / 1000");
  check("Upload button hidden until files are left queued", await page.isHidden("#diag-upload"));
  check("list hidden until a file is picked", await page.isHidden("#diag-list"));
  check("nothing queued: leaving the page does not ask", !(await asksBeforeLeaving(page)));

  // 1. a note and an area, then 3 files picked: uploaded at once (no Upload click), one after another, each with them
  const NOTE_IN = "  The game crashed when I broke a part in the 3rd District & <b>more</b>  ";
  const NOTE_OUT = "The game crashed when I broke a part in the 3rd District & <b>more</b>";
  await page.fill("#diag-note", NOTE_IN);
  await page.selectOption("#diag-area", "crash");
  check("counter follows the note", (await page.textContent("#diag-note-count")) === NOTE_IN.length + " / 1000", await page.textContent("#diag-note-count"));
  state.delay = 150;
  await page.setInputFiles("#diag-file", [txt("hvcrash-20261110-010203.txt"), txt("hvcrash-20261110-020304.txt"), txt("hvdiag.txt", "HVDIAG 1\r\n")]);
  await page.waitForFunction(() => document.querySelectorAll("#diag-list .diag-file-status")[0].textContent === "Uploading…");
  check("files are listed at once", (await rowsOf(page)).length === 3);
  check("uploading shows a disabled Uploading… button", (await page.textContent("#diag-upload")) === "Uploading…" && await page.isDisabled("#diag-upload"));
  check("uploading: leaving the page asks first", await asksBeforeLeaving(page));
  await page.screenshot({ path: SHOTS + "/1-uploading.png", fullPage: false });
  await settled(page);
  state.delay = 0;
  let rows = await rowsOf(page);
  check("3 POSTs without any click, in order", state.posts.length === 3 && state.posts.map((p) => paramsOf(p).get("name")).join(",")
    === "hvcrash-20261110-010203.txt,hvcrash-20261110-020304.txt,hvdiag.txt", state.posts.map((p) => p.url).join(" "));
  check("never two at once", state.maxParallel === 1, String(state.maxParallel));
  check("the note and area go with every file", state.posts.every((p) => paramsOf(p).get("note") === NOTE_OUT && paramsOf(p).get("area") === "crash"),
    state.posts.map((p) => p.url).join(" "));
  const post = state.posts[0];
  check("POST body is the file", post.body === REPORT, JSON.stringify(post.body));
  check("POST token", post.auth === "Bearer " + TOKEN);
  check("POST text/plain", (post.type || "").startsWith("text/plain"), post.type);
  check("3 answers shown", (await page.$$("#diag-list .diag-outcome")).length === 3);
  check("outcome shown", (await page.textContent("#diag-list .diag-outcome")) === ANSWER.outcome);
  check("the note is shown back in each answer", rows.every((r) => r.text.includes("Your note (Crash): " + NOTE_OUT)), JSON.stringify(rows.map((r) => r.text.slice(0, 120))));
  const items = await page.$$eval("#diag-list > li:first-child .diag-findings li", (n) => n.map((x) => x.textContent));
  check("findings shown", items.length === 3 && items[1].includes("v1.19"), JSON.stringify(items));
  check("API text is text", items[2].includes("<b>stage") && (await page.$$("#diag-list b")).length === 0);
  const facts = await page.$$eval("#diag-list > li:first-child dt", (n) => n.map((x) => x.textContent));
  check("facts shown", facts.join(",") === "Edition,Patch,Scene,Move hits", facts.join(","));
  const movesFact = await page.$eval("#diag-list > li:first-child", (n) => n.textContent);
  check("move hits summary in the player's answer", movesFact.includes("312 move hits recorded"), movesFact);
  check("Upload button hidden when nothing is queued", await page.isHidden("#diag-upload"));
  check("done: leaving the page does not ask", !(await asksBeforeLeaving(page)));
  await page.screenshot({ path: SHOTS + "/2-three-answers.png", fullPage: true });

  // 2. drop 2 files: hover state, then uploaded at once with the same note
  state.posts.length = 0;
  let dt = await dropFiles(page, [{ name: "hvcrash-a.txt" }, { name: "hvcrash-b.txt" }]);
  check("hover state while dragging", await page.$eval("#diag-drop", (n) => n.classList.contains("is-over")));
  await page.screenshot({ path: SHOTS + "/3-drag-hover.png", fullPage: false });
  await dropIt(page, dt);
  check("hover state ends on drop", !(await page.$eval("#diag-drop", (n) => n.classList.contains("is-over"))));
  rows = await rowsOf(page);
  check("2 dropped files listed", rows.length === 2 && rows[0].name === "hvcrash-a.txt", JSON.stringify(rows));
  await settled(page);
  check("2 dropped files uploaded, with the note", state.posts.length === 2 && state.posts[1].body === REPORT
    && state.posts.every((p) => paramsOf(p).get("note") === NOTE_OUT), state.posts.map((p) => p.url).join(" "));

  // 3. drag leaving the box ends the hover state
  dt = await dropFiles(page, [{ name: "x.txt" }]);
  await page.dispatchEvent("#diag-drop", "dragleave", { dataTransfer: dt });
  check("hover state ends on leave", !(await page.$eval("#diag-drop", (n) => n.classList.contains("is-over"))));
  // a non-file drag (text) is not taken
  const textDrag = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData("text/plain", "hi"); return d; });
  await page.dispatchEvent("#diag-drop", "dragenter", { dataTransfer: textDrag });
  check("text drag has no hover", !(await page.$eval("#diag-drop", (n) => n.classList.contains("is-over"))));

  // 4. an empty note and no area: the upload still goes, with neither in the request, and no note echo
  state.posts.length = 0;
  await page.fill("#diag-note", "   ");
  await page.selectOption("#diag-area", "");
  await page.setInputFiles("#diag-file", [txt("hvcrash-empty-note.txt")]);
  await settled(page);
  check("empty note: uploaded, no note or area sent", state.posts.length === 1 && !paramsOf(state.posts[0]).has("note")
    && !paramsOf(state.posts[0]).has("area") && paramsOf(state.posts[0]).get("name") === "hvcrash-empty-note.txt", state.posts.map((p) => p.url).join(" "));
  check("no echo without a note", (await page.$$("#diag-list .diag-note-echo")).length === 0);

  // 4b. an area alone; a note over 1,000 characters (set by script, past the box's limit) is cut to 1,000
  state.posts.length = 0;
  await page.selectOption("#diag-area", "sky-road");
  await page.evaluate(() => { const n = document.getElementById("diag-note"); n.value = "n".repeat(1200); n.dispatchEvent(new Event("input")); });
  check("counter shows the length", (await page.textContent("#diag-note-count")) === "1200 / 1000");
  await page.setInputFiles("#diag-file", [txt("hvcrash-long-note.txt")]);
  await settled(page);
  check("long note cut to 1000, area sent", state.posts.length === 1 && paramsOf(state.posts[0]).get("note") === "n".repeat(1000)
    && paramsOf(state.posts[0]).get("area") === "sky-road", state.posts.map((p) => p.url.length).join(" "));
  // a 1,000-character Japanese note is 9,000 characters once encoded: cut under 6,000, and the player is told
  state.posts.length = 0;
  await page.fill("#diag-note", "あ".repeat(1000));
  await page.setInputFiles("#diag-file", [txt("hvcrash-japanese-note.txt")]);
  await settled(page);
  const jp = state.posts.length === 1 ? paramsOf(state.posts[0]).get("note") : "";
  check("Japanese note cut to fit the request line", state.posts.length === 1 && jp.length > 600 && jp.length < 1000 && /^あ+$/.test(jp)
    && encodeURIComponent(jp).length <= 6000 && state.posts[0].url.length < 7000, state.posts.map((p) => p.url.length).join(" "));
  check("the player is told it was shortened", (await page.textContent("#diag-alert")).includes("shortened"), await page.textContent("#diag-alert"));
  await page.fill("#diag-note", "");
  await page.selectOption("#diag-area", "");

  // 5. one bad type, one too large, one good: only the good one is sent
  state.posts.length = 0;
  await page.setInputFiles("#diag-file", [txt("hvcrash-ok.txt"),
    { name: "screenshot.png", mimeType: "image/png", buffer: Buffer.from("PNG") },
    { name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(256 * 1024 + 1, 65) }]);
  rows = await rowsOf(page);
  check("bad type listed as error", rows.length === 3 && rows[1].status === "Error" && rows[1].text.includes("Not a text or log file"), JSON.stringify(rows[1]));
  check("too large listed as error", rows[2].status === "Error" && rows[2].text.includes("Too large"), JSON.stringify(rows[2]));
  await settled(page);
  check("only the good file sent", state.posts.length === 1 && state.posts[0].url.includes("name=hvcrash-ok.txt"), state.posts.map((p) => p.url).join(" "));
  await page.screenshot({ path: SHOTS + "/4-bad-type-and-size.png", fullPage: true });

  // 5b. hvmods.log: no browser type, still taken (also uppercase and over 256 KB); a log over 2 MB and a .png are errors
  state.posts.length = 0;
  const LOGTEXT = "hvmods 11: HD (Direct3D 9), base 0x10000000, flags 0x00000200\r\nmodule test started\r\n";
  await page.setInputFiles("#diag-file", [
    { name: "hvmods.log", mimeType: "", buffer: Buffer.from(LOGTEXT) },
    { name: "OLD.LOG", mimeType: "", buffer: Buffer.alloc(300 * 1024, 65) },
    { name: "huge.log", mimeType: "", buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 65) },
    { name: "hvmods.png", mimeType: "image/png", buffer: Buffer.from("PNG") }]);
  rows = await rowsOf(page);
  check("log over 2 MB is an error", rows[2].status === "Error" && rows[2].text.includes("over 2 MB"), JSON.stringify(rows[2]));
  check("png is an error naming the log", rows[3].status === "Error" && rows[3].text.includes("Not a text or log file")
    && rows[3].text.includes("hvmods.log"), JSON.stringify(rows[3]));
  await settled(page);
  check("both logs sent as they are", state.posts.length === 2 && state.posts[0].body === LOGTEXT
    && state.posts[0].url.includes("name=hvmods.log") && state.posts[1].url.includes("name=OLD.LOG")
    && state.posts[1].body.length === 300 * 1024 && (state.posts[0].type || "").startsWith("text/plain"),
    state.posts.map((p) => p.url + " " + (p.body || "").length).join(" "));

  // 6. an API error on the 2nd of 3: that one is an error, the 3rd still goes
  state.posts.length = 0;
  state.failName = "hvcrash-two.txt";
  state.mode = "refuse";
  await page.setInputFiles("#diag-file", [txt("hvcrash-one.txt"), txt("hvcrash-two.txt", "notes"), txt("hvcrash-three.txt")]);
  await settled(page);
  rows = await rowsOf(page);
  check("API error on one file", rows.map((r) => r.status).join(",") === "Answer,Error,Answer", rows.map((r) => r.status).join(","));
  check("refusal message", rows[1].text.includes("not a diagnostics file"), rows[1].text);
  check("all 3 were sent", state.posts.length === 3);
  await page.screenshot({ path: SHOTS + "/5-api-error.png", fullPage: true });

  // 7. more than 10 files: the first 10 are added and uploaded, with a clear message
  state.posts.length = 0;
  state.failName = null;
  state.mode = "ok";
  const many = [];
  for (let i = 1; i <= 12; i++) many.push(txt("hvcrash-" + i + ".txt", REPORT + i));
  await page.setInputFiles("#diag-file", many);
  rows = await rowsOf(page);
  const alert = await page.textContent("#diag-alert");
  check("cap of 10 files", rows.length === 10, String(rows.length));
  check("cap message stays while uploading", (await page.isVisible("#diag-alert")) && alert.includes("Only 10 files at a time") && alert.includes("2 left out"), alert);
  await settled(page);
  check("the 10 files were uploaded", state.posts.length === 10, String(state.posts.length));
  await page.screenshot({ path: SHOTS + "/6-cap.png", fullPage: true });
  // Clear list empties it
  await page.click("#diag-clear");
  check("Clear list empties the list", (await page.$$("#diag-list > li")).length === 0 && await page.isHidden("#diag-upload") && await page.isHidden("#diag-alert"));

  // 8. the API without the endpoint (404) says so and keeps the file queued; the primary button is the way on, and
  // leaving the page asks first; a dropped group over 10 is capped too
  state.mode = "missing";
  state.posts.length = 0;
  await page.fill("#diag-note", "kept for the retry");
  await page.setInputFiles("#diag-file", txt("hvdiag.txt", "HVDIAG 1\r\n"));
  await page.waitForFunction(() => document.getElementById("diag-alert").textContent.includes("not available"));
  rows = await rowsOf(page);
  check("404 keeps the file queued", rows.length === 1 && rows[0].status === "Queued", JSON.stringify(rows));
  check("a queued file shows 'N file ready: Upload'", await page.isVisible("#diag-upload") && !(await page.isDisabled("#diag-upload"))
    && (await page.textContent("#diag-upload")) === "1 file ready: Upload", await page.textContent("#diag-upload"));
  check("the Upload button is the primary, highlighted action", await page.$eval("#diag-upload", (n) => n.classList.contains("btn-primary")));
  check("queued files: leaving the page asks first", await asksBeforeLeaving(page));
  await page.screenshot({ path: SHOTS + "/7-queued-ready.png", fullPage: true });
  state.mode = "ok";
  state.posts.length = 0;
  await page.fill("#diag-note", "edited before the retry");
  await page.click("#diag-upload");
  await settled(page);
  check("the button retries with the note as it is now", state.posts.length === 1 && paramsOf(state.posts[0]).get("note") === "edited before the retry"
    && (await rowsOf(page))[0].status === "Answer", state.posts.map((p) => p.url).join(" "));
  check("done: the button is gone and leaving does not ask", await page.isHidden("#diag-upload") && !(await asksBeforeLeaving(page)));
  state.mode = "missing";
  state.posts.length = 0;
  await page.setInputFiles("#diag-file", txt("hvdiag.txt", "HVDIAG 1\r\n" + "again"));
  await page.waitForFunction(() => document.getElementById("diag-alert").textContent.includes("not available"));
  state.mode = "ok";
  const dt12 = await dropFiles(page, many.map((f) => ({ name: f.name, body: REPORT + "d" })));
  await dropIt(page, dt12);
  rows = await rowsOf(page);
  check("drop adds to the queue up to 10", rows.length === 10 && (await page.textContent("#diag-alert")).includes("left out"), String(rows.length));
  await settled(page);
  check("the dropped group went with the one left queued (1 refused by the 404, then 10)", state.posts.length === 11, String(state.posts.length));
  check("no errors on the account page", errors.length === 0, errors.join(" | "));
  await page.close();

  // 9. not signed in: nothing is sent, the file stays queued with the button, and the player is told
  // (the account page needs a token to open, so the token is removed after it has loaded)
  const out = { mode: "ok", posts: [], gets: [] };
  const anon = await open(browser, base, "/account.html#diagnostics", out);
  await anon.page.waitForSelector("#diag-panel", { state: "attached" });
  await anon.page.evaluate(() => localStorage.removeItem("hvmhfz.token"));
  await anon.page.setInputFiles("#diag-file", txt("hvcrash-anon.txt"));
  await anon.page.waitForFunction(() => document.getElementById("diag-alert").textContent.includes("Sign in"));
  check("no token: nothing sent, file queued", out.posts.length === 0 && (await rowsOf(anon.page))[0].status === "Queued"
    && await anon.page.isVisible("#diag-upload"));
  await anon.page.close();

  const narrow = await open(browser, base, "/account.html#diagnostics", { mode: "ok", posts: [], gets: [] }, 375);
  await narrow.page.waitForSelector("#diag-panel", { state: "attached" });
  await narrow.page.fill("#diag-note", "On a phone the note and the area still fit the box, even when the note is long enough to wrap onto a few lines.");
  await narrow.page.selectOption("#diag-area", "controls");
  await narrow.page.setInputFiles("#diag-file", [txt("hvcrash-1-with-a-rather-long-name-20261110-010203.txt"), txt("hvcrash-2.txt")]);
  await settled(narrow.page);
  // The page's own header passes 375px by 17px with this fake API on the branch without this box too, so measure the
  // box, as dev/check-account-qol.js does for its card: nothing in it may pass the window.
  const wide = await narrow.page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll("#diag-panel, #diag-panel *"))
      .filter((n) => n.getBoundingClientRect().right > w + 0.5).map((n) => n.tagName + "#" + n.id);
  });
  check("the box stays inside 375px", wide.length === 0, wide.join(","));
  await narrow.page.locator("#diag-panel").screenshot({ path: SHOTS + "/8-phone-375.png" });
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
  // the area and the player's note in the list: the note cut to 80 characters (one line), the whole note as the tooltip
  const cells = await page.$$eval("#diag-rows tr", (n) => n.map((r) => ({ area: r.cells[4].textContent, note: r.cells[5].textContent, title: r.cells[5].title })));
  const cutNote = NOTE.replace(/\s+/g, " ").slice(0, 80).trimEnd() + "…";
  check("list shows the area", cells[1].area === "Crash" && cells[0].area === "", JSON.stringify(cells));
  check("list shows the note cut to 80 characters, whole note on hover", cells[1].note === cutNote && cells[1].note.length === 81
    && cells[1].title === NOTE && cells[0].note === "" && cells[0].title === "", JSON.stringify(cells));
  check("note in the list is text, not HTML", (await page.$$("#diag-rows b")).length === 0);
  check("the area filter lists every area", (await page.$$eval("#diag-area option", (n) => n.map((o) => o.value).join(","))) === ",crash,mods,quest,sky-road,controls,other");
  await page.click("#diag-rows tr:nth-child(2) button");
  await page.waitForSelector("#diag-view-panel:not([hidden])");
  check("view outcome", (await page.textContent("#diag-view-outcome")) === ANSWER.outcome);
  check("view shows the whole note and the area", (await page.isVisible("#diag-view-note-box")) && (await page.textContent("#diag-view-note")) === NOTE
    && (await page.textContent("#diag-view-area")).includes("Crash") && (await page.$$("#diag-view-note b")).length === 0);
  check("view findings", (await page.$$("#diag-view-findings li")).length === 3);
  check("view raw file", (await page.textContent("#diag-view-raw")) === REPORT);
  await page.waitForFunction(() => /unnamed id/.test(document.getElementById("diag-moves-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("move hits table shown", await page.isVisible("#diag-view-moves"));
  const moves = await page.$$eval("#diag-moves-rows tr", (n) => n.map((r) => Array.from(r.cells).map((c) => c.textContent)));
  check("6 move rows, oldest first", moves.length === 6 && moves[0][0] === "01:00:05Z", JSON.stringify(moves));
  check("named move: time, weapon, style, id with name, MV, damage, crit",
    JSON.stringify(moves[0]) === JSON.stringify(["01:00:05Z", "GS", "storm", "k0 #2 Horizontal Slash", "46", "120", "crit"]), JSON.stringify(moves[0]));
  check("a guess is marked, the hit's MV shown", moves[1][3] === "k0 #4 Kick (guess)" && moves[1][4] === "2 (hit 3)", JSON.stringify(moves[1]));
  check("an id with no record is flagged", moves[2][3] === "k0 #9999 (id from +6) unnamed", JSON.stringify(moves[2]));
  check("an unknown record is flagged", moves[3][3] === "k0 #207 unnamed" && moves[3][6] === "negative crit", JSON.stringify(moves[3]));
  check("bowgun shot named by class", moves[4][3] === "k6v1 #7 Pellet S Lv1, each pellet" && moves[4][2] === "style 7", JSON.stringify(moves[4]));
  check("an unreadable line is shown as it is", moves[5].length === 1 && moves[5][0].startsWith("01:00:10Z something new"), JSON.stringify(moves[5]));
  check("unnamed flags are badges", (await page.$$("#diag-moves-rows .badge.bad")).length === 2);
  const movesNote = await page.textContent("#diag-moves-note");
  check("note counts hits and lists the unnamed ids", movesNote.includes("6 hits") && movesNote.includes("2 unnamed ids: GS k0 #9999, LS k0 #207"), movesNote);
  check("weapon full name on hover", (await page.getAttribute("#diag-moves-rows tr:nth-child(4) td:nth-child(2)", "title")) === "Long Sword");
  await page.click("#diag-rows tr:nth-child(1) button");
  await page.waitForFunction(() => /HVDIAG/.test(document.getElementById("diag-view-raw").textContent));
  check("no moves: table hidden", await page.isHidden("#diag-view-moves") && (await page.$$("#diag-moves-rows tr")).length === 0);
  check("no note: the note box is hidden", await page.isHidden("#diag-view-note-box"));
  await page.fill("#diag-user", "3");
  await page.click("#diag-filter");
  await page.waitForTimeout(200);
  check("filter sends user", state.gets[state.gets.length - 1] === "?limit=50&user=3", state.gets[state.gets.length - 1]);
  await page.selectOption("#diag-area", "crash");
  await page.click("#diag-filter");
  await page.waitForFunction(() => document.querySelectorAll("#diag-rows tr").length === 1);
  check("filter sends user and area", state.gets[state.gets.length - 1] === "?limit=50&user=3&area=crash", state.gets[state.gets.length - 1]);
  check("area filter shows only that area", (await page.$$eval("#diag-rows tr", (n) => n.length)) === 1);
  await page.selectOption("#diag-area", "quest");
  await page.click("#diag-filter");
  await page.waitForFunction(() => document.querySelector("#diag-rows .empty-cell"));
  check("an area with no reports says so", state.gets[state.gets.length - 1] === "?limit=50&user=3&area=quest"
    && (await page.textContent("#diag-rows")).includes("No reports yet"));
  await page.selectOption("#diag-area", "");
  await page.click("#diag-filter");
  await page.waitForFunction(() => document.querySelectorAll("#diag-rows tr").length === 2);

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
