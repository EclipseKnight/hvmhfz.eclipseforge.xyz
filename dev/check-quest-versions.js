#!/usr/bin/env node
/* Checks custom quest versions and the player's Delete (API README "Custom quest versions and delete") in headless
   Chromium against a fake API, with a made-up model (no game data):

   - account page: each submission shows its version ("v2") beside the title; a testing or pending quest has Delete;
     dismissing the confirm sends nothing, accepting sends DELETE for that id, the note says it was deleted and the
     draft is kept, and the row is gone after the reload; approved and expired quests have no Delete; a draft shows
     its latest submission ("testing v2");
   - an API without versions: no Delete button, no "v" (js/quest-submissions.js shows neither);
   - quest builder: a draft whose quest is in testing as v2 says so in the draft note; Submit, answered as an update,
     says "Updated to v3" and the note follows; a first submit says "Submitted as v1";
   - admin: a Deleted filter, the version in the row and "deleted by author" on a deleted quest;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-versions.js

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
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const text = (page, sel) => page.textContent(sel).then((t) => (t || "").replace(/\s+/g, " ").trim());
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {});

function freshApi(old) {
  const sub = (id, title, status, version, extra) => Object.assign({ id, title, status, note: null,
    submittedAt: "2026-11-01T10:00:00Z", reviewedAt: null, size: 4096, lastActivity: "2026-11-01T10:00:00Z",
    expiresAt: status === "testing" ? "2026-11-20T10:00:00Z" : null, remindedAt: null, expiredAt: null,
    canResubmit: false }, old ? {} : { version, draftId: null }, extra || {});
  return {
    calls: [],
    submissions: [
      sub(1, "Polar Sea Migration", "testing", 2, { draftId: 7 }),
      sub(2, "Waiting one", "pending", 1),
      sub(3, "Old hunt", "expired", 1, { expiredAt: "2026-10-20T10:00:00Z", canResubmit: true }),
      sub(4, "Published", "approved", 4)
    ],
    drafts: [Object.assign({ id: 7, sourceQuestId: 0, variant: "d0", revision: 5, updatedAt: "2026-11-12T10:00:00Z",
      title: "Polar Sea Migration", lastActivity: "2026-11-12T10:00:00Z" },
      old ? {} : { submission: { id: 1, status: "testing", version: 2 } })],
    admin: [
      { id: 1, title: "Polar Sea Migration", status: "testing", note: null, account: "author", size: 4096,
        submittedAt: "2026-11-01T10:00:00Z", reviewedAt: null, expiresAt: "2026-11-20T10:00:00Z", questType: 18, mark: 0,
        version: 2 },
      { id: 9, title: "Gone one", status: "deleted", note: null, account: "author", size: 4096,
        submittedAt: "2026-11-01T10:00:00Z", reviewedAt: null, questType: 18, mark: 0, version: 1,
        deletedAt: "2026-11-13T10:00:00Z" }
    ]
  };
}

function fakeApi(page, api) {
  return page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (/quest|admin/.test(p)) api.calls.push({ method: req.method(), path: p + url.search });
    let m;
    if (p === "/api/account/quest-submissions" && req.method() === "GET") return reply(200, api.submissions);
    if ((m = p.match(/^\/api\/account\/quest-submissions\/(\d+)$/)) && req.method() === "DELETE") {
      api.submissions = api.submissions.filter((x) => x.id !== Number(m[1]));
      api.drafts.forEach((d) => { if (d.submission && d.submission.id === Number(m[1])) d.submission = null; });
      return reply(200, { id: Number(m[1]), status: "deleted" });
    }
    if (p === "/api/account/quest-drafts" && req.method() === "GET") return reply(200, api.drafts);
    if (p === "/api/admin/quest-submissions") {
      const status = url.searchParams.get("status");
      return reply(200, api.admin.filter((x) => status === "all" || x.status === status));
    }
    if (p === "/api/admin/quest-submissions/event-slots") return reply(200, { used: 449, cap: 2048, free: 1599 });
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/account") return reply(200, { name: "author", roles: ["ROLE_USER"], characters: 0, lastLogin: null });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
}

async function open(browser, url, api) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await fakeApi(page, api);
  await page.goto(url);
  return { page, errors };
}

const rowsOf = (page) => page.$$eval("#quest-submit-list tr", (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, " ").trim()));

async function account(browser, base) {
  const api = freshApi(false);
  const { page, errors } = await open(browser, base + "/account.html#quests", api);
  await until(page, () => /Polar/.test(document.getElementById("quest-submit-list").textContent));
  let rows = await rowsOf(page);
  const rowOf = (t) => rows.find((r) => r.startsWith(t)) || "";
  check("testing quest shows its version", rowOf("Polar Sea Migration v2").length > 0, rows.join(" | "));
  check("testing quest has Delete", rowOf("Polar Sea Migration").includes("Delete"), rowOf("Polar Sea Migration"));
  check("pending quest has Delete", rowOf("Waiting one").includes("Delete"), rowOf("Waiting one"));
  check("expired quest has no Delete", !rowOf("Old hunt").includes("Delete"), rowOf("Old hunt"));
  check("approved quest has no Delete, shows v4", !rowOf("Published").includes("Delete") && rowOf("Published").startsWith("Published v4"),
    rowOf("Published"));
  check("draft shows its testing version", (await text(page, "#quest-draft-list")).includes("testing v2"), await text(page, "#quest-draft-list"));

  // Dismissing the confirm sends nothing.
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); d.dismiss(); });
  await page.click("#quest-submit-list tr:has-text('Polar Sea') button:has-text('Delete')");
  await page.waitForTimeout(300);
  check("Delete asks first, naming quest and version", asked.includes("“Polar Sea Migration” (v2)") && asked.includes("draft"), asked);
  check("a dismissed confirm sends nothing", !api.calls.some((c) => c.method === "DELETE"));

  page.once("dialog", (d) => d.accept());
  await page.click("#quest-submit-list tr:has-text('Polar Sea') button:has-text('Delete')");
  await until(page, () => !/Polar/.test(document.getElementById("quest-submit-list").textContent));
  check("Delete sends DELETE for quest 1", api.calls.some((c) => c.method === "DELETE" && c.path === "/api/account/quest-submissions/1"),
    JSON.stringify(api.calls.filter((c) => c.method !== "GET")));
  const said = await text(page, "#quest-submit-note");
  check("the note says deleted, draft kept", /^Deleted “Polar Sea Migration” \(v2\)\. Its draft/.test(said), said);
  rows = await rowsOf(page);
  check("the deleted quest is gone from the list", !rows.some((r) => r.includes("Polar")), rows.join(" | "));
  await until(page, () => !/testing v2/.test(document.getElementById("quest-draft-list").textContent));
  const draftsNow = await text(page, "#quest-draft-list");
  check("the draft stays, without the deleted version", draftsNow.startsWith("Polar Sea Migration") && !/v\d/.test(draftsNow), draftsNow);
  check("no page errors", !errors.length, errors.join("; "));
  await page.close();
}

async function oldApi(browser, base) {
  const api = freshApi(true);
  const { page, errors } = await open(browser, base + "/account.html#quests", api);
  await until(page, () => /Polar/.test(document.getElementById("quest-submit-list").textContent));
  const rows = await rowsOf(page);
  check("old API: no Delete", !rows.some((r) => r.includes("Delete")), rows.join(" | "));
  check("old API: no version", !rows.some((r) => / v\d/.test(r)), rows.join(" | "));
  check("old API: no page errors", !errors.length, errors.join("; "));
  await page.close();
}

const obj = () => ({ type: 0, target: 0, count: 0 });
/** A made-up new quest, as dev/check-quest-listing.js has it. */
function model() {
  const body = { mapId: 26, questClass: 1, objective0: { type: 1, target: 11, count: 1 }, objective1: obj(), objective2: obj(),
    zenny: 0, rewardMoney: 0, timeLimit: 50 * 1800, maxHunters: 4, iconMonsters: [11, 0, 0, 0, 0], iconLabelId: 0,
    iconLabelCount: 0, flags: 0x000a4001, seasonFlags: 0x0a, flagByte: 0, level: 6, objectiveMode: 2 };
  return { layout: "QUEST", length: 0, header: { questClass: 1, monsterLevel: 7 }, raw: [], body,
    map: { mapId: 26, areaId: 224 }, startAreas: [0, 1, 2, 3].map(() => ({ areaId: 224 })), startItems: [],
    texts: [192, 320, 320, 160, 160, 768, 96, 96].map((c, i) => ({ index: i, text: i === 0 ? "Polar Sea Migration" : "", capacity: c })),
    rewardGroups: [], smallSpawnGroups: [], largeSpawnAreas: [] };
}

async function editor(browser, base, submission, answer) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("hvmhfz.token", "x");
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
  });
  const draft = { id: 7, sourceQuestId: 0, variant: "d0", revision: 4, model: model(), listing: { questType: 18, mark: 0 },
    submission };
  await context.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === base) return route.continue();
    if (!/^api\./.test(url.hostname)) return route.abort();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/account/quests/maps") return json(200, { maps: [26] });
    if (url.pathname === "/api/account/quest-drafts") return json(200, []);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "GET") return json(200, draft);
    if (url.pathname === "/api/account/quest-drafts/7" && req.method() === "PUT") return json(200, { id: 7, revision: 5 });
    if (url.pathname === "/api/account/quest-drafts/7/submit") return json(200, answer);
    return json(404, { message: "Not in the fake API." });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/quest-editor.html?draft=7", { waitUntil: "networkidle" });
  await page.waitForSelector(".bui-section");
  return { context, page, errors };
}

async function editorUpdate(browser, base) {
  const { context, page, errors } = await editor(browser, base, { id: 1, status: "testing", version: 2 },
    { submissionId: 1, sandboxQuestId: 65001, version: 3, updated: true });
  check("editor: the draft note names the testing version", (await text(page, "#editor-draft-note")).endsWith("testing v2"),
    await text(page, "#editor-draft-note"));
  await page.click("#editor-submit");
  await until(page, () => /Updated|could not|not/.test(document.getElementById("editor-status").textContent));
  const said = await text(page, "#editor-status");
  check("editor: an update says Updated to v3", said.startsWith("Updated to v3. Quest 65001"), said);
  check("editor: the note follows", (await text(page, "#editor-draft-note")).endsWith("testing v3"), await text(page, "#editor-draft-note"));
  check("editor (update): no page errors", !errors.length, errors.join("; "));
  await context.close();
}

async function editorFirst(browser, base) {
  const { context, page, errors } = await editor(browser, base, null,
    { submissionId: 11, sandboxQuestId: 65011, version: 1, updated: false });
  check("editor: a draft never submitted has no version in its note", !/v\d/.test(await text(page, "#editor-draft-note")),
    await text(page, "#editor-draft-note"));
  await page.click("#editor-submit");
  await until(page, () => /Submitted|could not|not/.test(document.getElementById("editor-status").textContent));
  const said = await text(page, "#editor-status");
  check("editor: a first submit says Submitted as v1", said.startsWith("Submitted as v1. Quest 65011"), said);
  check("editor (first): no page errors", !errors.length, errors.join("; "));
  await context.close();
}

async function admin(browser, base) {
  const api = freshApi(false);
  const { page, errors } = await open(browser, base + "/admin.html#quests", api);
  await until(page, () => /Polar/.test(document.getElementById("quests-body").textContent));
  check("admin: the version is in the row", (await text(page, "#quests-body")).includes("v2"), await text(page, "#quests-body"));
  check("admin: Deleted filter", await page.isVisible("#quests-filter .chip[data-status='deleted']"));
  await page.click("#quests-filter .chip[data-status='deleted']");
  await until(page, () => /Gone one/.test(document.getElementById("quests-body").textContent));
  check("admin: a deleted quest says so", (await text(page, "#quests-body")).includes("deleted by author"), await text(page, "#quests-body"));
  check("admin: no page errors", !errors.length, errors.join("; "));
  await page.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await account(browser, base);
    await oldApi(browser, base);
    await editorUpdate(browser, base);
    await editorFirst(browser, base);
    await admin(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("quest versions OK");
})().catch((e) => { console.error(e); process.exit(1); });
