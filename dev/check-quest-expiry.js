#!/usr/bin/env node
/* Checks custom quest expiry on the account page (js/quest-submissions.js) and the admin Retire action
   (js/admin-quests.js) in headless Chromium against a fake API with the fields of the API README
   "Custom quest expiry":

   - account page: the reminder at the top of the page (whatever tab is open) for a reminded testing quest and
     a reminded draft, gone after Keep testing / Keep (the POSTs go to the right ids); the submissions table
     shows each testing quest's expiry date with Keep testing, Resubmit on an expired quest whose file is kept,
     "File removed" when it is not; the drafts table shows the deletion date; a deleted draft can be restored;
   - an API from before the expiry (no expiry fields, no deleted list): no reminder, no buttons, no deleted
     section, no page error;
   - admin page: Expired and Retired filters; Retire on a published quest sends the note; testing rows show
     their expiry.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-expiry.js

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
const day = (iso) => new Date(iso).toLocaleDateString("en-US"); // the browser below runs en-US

function freshApi(old) {
  const sub = (id, title, status, extra) => Object.assign({ id, title, status, note: null, submittedAt: "2026-11-01T10:00:00Z",
    reviewedAt: null, size: 4096 }, old ? {} : { lastActivity: "2026-11-01T10:00:00Z", expiresAt: null, remindedAt: null,
    expiredAt: null, fileKeptUntil: null, canResubmit: false }, old ? {} : (extra || {}));
  return {
    calls: [],
    submissions: [
      sub(1, "Rathalos at dawn", "testing", { expiresAt: "2026-11-15T10:00:00Z", remindedAt: "2026-11-12T10:00:00Z" }),
      sub(2, "Fresh one", "testing", { lastActivity: "2026-11-04T10:00:00Z", expiresAt: "2026-11-18T10:00:00Z" }),
      sub(3, "Old hunt", "expired", { expiredAt: "2026-10-20T10:00:00Z", fileKeptUntil: "2026-11-19T10:00:00Z", canResubmit: true }),
      sub(4, "Ancient hunt", "expired", { expiredAt: "2026-09-01T10:00:00Z" }),
      sub(5, "Published", "approved")
    ],
    drafts: [
      Object.assign({ id: 7, sourceQuestId: 0, variant: "d0", revision: 3, updatedAt: "2026-08-08T10:00:00Z", title: "Forgotten idea" },
        old ? {} : { lastActivity: "2026-08-08T10:00:00Z", expiresAt: "2026-11-06T10:00:00Z", remindedAt: "2026-11-03T10:00:00Z" }),
      Object.assign({ id: 8, sourceQuestId: 0, variant: "d0", revision: 1, updatedAt: "2026-11-04T10:00:00Z", title: "New idea" },
        old ? {} : { lastActivity: "2026-11-04T10:00:00Z", expiresAt: "2027-02-02T10:00:00Z", remindedAt: null })
    ],
    deleted: old ? null : [{ id: 9, title: "Deleted idea", deletedAt: "2026-11-01T10:00:00Z", purgeAt: "2026-12-01T10:00:00Z" }],
    slots: { used: 511, cap: 512, free: 1 },
    admin: [
      { id: 5, title: "Published", status: "approved", note: null, account: "author", size: 4096, submittedAt: "2026-10-01T10:00:00Z",
        reviewedAt: "2026-10-02T10:00:00Z", retiredAt: null },
      { id: 1, title: "Rathalos at dawn", status: "testing", note: null, account: "author", size: 4096, submittedAt: "2026-11-01T10:00:00Z",
        reviewedAt: null, expiresAt: "2026-11-15T10:00:00Z" }
    ]
  };
}

function fakeApi(page, api) {
  return page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const search = new URL(req.url()).search;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    if (/quest|admin/.test(p)) api.calls.push({ method: req.method(), path: p + search, body: sent });
    let m;
    if (p === "/api/account/quest-submissions" && req.method() === "GET") return reply(200, api.submissions);
    if ((m = p.match(/^\/api\/account\/quest-submissions\/(\d+)\/keep$/))) {
      const s = api.submissions.find((x) => x.id === Number(m[1]));
      s.remindedAt = null; s.expiresAt = "2026-11-19T12:00:00Z";
      return reply(200, { id: s.id, status: "testing", expiresAt: s.expiresAt });
    }
    if ((m = p.match(/^\/api\/account\/quest-submissions\/(\d+)\/resubmit$/))) {
      const s = api.submissions.find((x) => x.id === Number(m[1]));
      Object.assign(s, { status: "testing", canResubmit: false, expiredAt: null, fileKeptUntil: null, expiresAt: "2026-11-19T12:00:00Z" });
      return reply(200, { id: s.id, status: "testing" });
    }
    if (p === "/api/account/quest-drafts" && req.method() === "GET") return reply(200, api.drafts);
    if (p === "/api/account/quest-drafts/deleted") {
      return api.deleted ? reply(200, api.deleted) : reply(404, { message: "No draft with that id." });
    }
    if ((m = p.match(/^\/api\/account\/quest-drafts\/(\d+)\/keep$/))) {
      const d = api.drafts.find((x) => x.id === Number(m[1]));
      d.remindedAt = null; d.expiresAt = "2027-02-03T12:00:00Z";
      return reply(200, { id: d.id, expiresAt: d.expiresAt });
    }
    if ((m = p.match(/^\/api\/account\/quest-drafts\/(\d+)\/restore$/))) {
      const d = api.deleted.find((x) => x.id === Number(m[1]));
      api.deleted = api.deleted.filter((x) => x !== d);
      api.drafts.push({ id: d.id, sourceQuestId: 0, variant: "d0", revision: 1, updatedAt: "2026-11-01T10:00:00Z", title: d.title,
        lastActivity: "2026-11-05T12:00:00Z", expiresAt: "2027-02-03T12:00:00Z", remindedAt: null });
      return reply(200, { id: d.id, restored: true });
    }
    if (p === "/api/admin/quest-submissions") {
      const status = new URL(req.url()).searchParams.get("status");
      return reply(200, api.admin.filter((x) => status === "all" || x.status === status));
    }
    if (p === "/api/admin/quest-submissions/event-slots") return reply(200, api.slots);
    if ((m = p.match(/^\/api\/admin\/quest-submissions\/(\d+)\/decide$/))) {
      return reply(409, { message: "The in-game event quest list is full (512 of 512 slots used). Retire an approved quest first." });
    }
    if ((m = p.match(/^\/api\/admin\/quest-submissions\/(\d+)\/retire$/))) {
      const s = api.admin.find((x) => x.id === Number(m[1]));
      s.status = "retired"; s.retiredAt = "2026-11-05T12:00:00Z";
      return reply(200, { id: s.id, status: "retired" });
    }
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

const text = (page, sel) => page.textContent(sel).then((t) => (t || "").replace(/\s+/g, " ").trim());
const posted = (api, p) => api.calls.some((c) => c.method === "POST" && c.path === p);

async function account(browser, base) {
  const api = freshApi(false);
  const { page, errors } = await open(browser, base + "/account.html#overview", api);
  await page.waitForSelector("#quest-reminders:not([hidden])", { timeout: 5000 }).catch(() => {});
  const banner = await text(page, "#quest-reminders");
  check("reminder shows on the Overview tab", await page.isVisible("#quest-reminders"));
  check("reminder names the testing quest and its date", banner.includes("“Rathalos at dawn” expires on " + day("2026-11-15T10:00:00Z")), banner);
  check("reminder names the draft and its date", banner.includes("“Forgotten idea” will be deleted on " + day("2026-11-06T10:00:00Z")), banner);
  check("no reminder for a quest not reminded", !banner.includes("Fresh one"), banner);

  // The submissions table.
  await page.goto(base + "/account.html#quests");
  await page.waitForFunction(() => /Rathalos/.test(document.getElementById("quest-submit-list").textContent), null, { timeout: 5000 }).catch(() => {});
  const rows = await page.$$eval("#quest-submit-list tr", (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, " ").trim()));
  const rowOf = (t) => rows.find((r) => r.startsWith(t)) || "";
  check("testing quest shows its expiry and Keep testing", rowOf("Fresh one").includes(day("2026-11-18T10:00:00Z")) && rowOf("Fresh one").includes("Keep testing"), rowOf("Fresh one"));
  check("expired quest with its file: Resubmit", rowOf("Old hunt").includes("File kept until " + day("2026-11-19T10:00:00Z")) && rowOf("Old hunt").includes("Resubmit"), rowOf("Old hunt"));
  check("expired quest without its file", rowOf("Ancient hunt").includes("File removed") && !rowOf("Ancient hunt").includes("Resubmit"), rowOf("Ancient hunt"));
  check("approved quest has no expiry", /-$/.test(rowOf("Published")) && !rowOf("Published").includes("Keep"), rowOf("Published"));

  // Keep testing from the reminder.
  await page.click("#quest-reminders button:has-text('Keep testing')");
  await page.waitForFunction(() => !/Rathalos/.test(document.getElementById("quest-reminders").textContent), null, { timeout: 5000 }).catch(() => {});
  check("Keep testing posts for quest 1", posted(api, "/api/account/quest-submissions/1/keep"));
  check("the quest's reminder is gone", !(await text(page, "#quest-reminders")).includes("Rathalos"));
  check("the note says until when", (await text(page, "#quest-submit-note")).includes(day("2026-11-19T12:00:00Z")), await text(page, "#quest-submit-note"));

  // Resubmit.
  await page.click("#quest-submit-list tr:has-text('Old hunt') button:has-text('Resubmit')");
  await page.waitForFunction(() => /Back in testing/.test(document.getElementById("quest-submit-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("Resubmit posts for quest 3", posted(api, "/api/account/quest-submissions/3/resubmit"));
  const old = await text(page, "#quest-submit-list tr:has-text('Old hunt')");
  check("the resubmitted quest is in testing", old.includes("testing") && old.includes("Keep testing"), old);

  // Drafts: deletion dates, Keep, the deleted section and Restore.
  const drafts = await text(page, "#quest-draft-list");
  check("draft shows its deletion date", drafts.includes(day("2026-11-06T10:00:00Z")) && drafts.includes(day("2027-02-02T10:00:00Z")), drafts);
  check("draft links to the builder", await page.getAttribute("#quest-draft-list a >> nth=0", "href") === "/quest-editor.html?draft=7");
  check("deleted section shows", await page.isVisible("#quest-deleted-wrap"));
  check("deleted draft gone-for-good date", (await text(page, "#quest-deleted-list")).includes(day("2026-12-01T10:00:00Z")));
  await page.click("#quest-draft-list tr:has-text('Forgotten idea') button:has-text('Keep')");
  await page.waitForFunction(() => document.getElementById("quest-reminders").hidden, null, { timeout: 5000 }).catch(() => {});
  check("Keep posts for draft 7", posted(api, "/api/account/quest-drafts/7/keep"));
  check("no reminder left, banner hidden", await page.isHidden("#quest-reminders"));
  await page.click("#quest-deleted-list button:has-text('Restore')");
  await page.waitForFunction(() => /Deleted idea/.test(document.getElementById("quest-draft-list").textContent), null, { timeout: 5000 }).catch(() => {});
  check("Restore posts for draft 9", posted(api, "/api/account/quest-drafts/9/restore"));
  check("restored draft is listed", (await text(page, "#quest-draft-list")).includes("Deleted idea"));
  check("deleted section hidden when empty", await page.isHidden("#quest-deleted-wrap"));
  check("no page errors", !errors.length, errors.join("; "));
  await page.close();
}

async function oldApi(browser, base) {
  const api = freshApi(true);
  const { page, errors } = await open(browser, base + "/account.html#quests", api);
  await page.waitForFunction(() => /Rathalos/.test(document.getElementById("quest-submit-list").textContent), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => /Forgotten/.test(document.getElementById("quest-draft-list").textContent), null, { timeout: 5000 }).catch(() => {});
  check("old API: no reminder", await page.isHidden("#quest-reminders"));
  check("old API: no buttons in the tables", (await page.$$("#quest-submit-list button, #quest-draft-list button")).length === 0);
  check("old API: no deleted section", await page.isHidden("#quest-deleted-wrap"));
  check("old API: drafts still listed", (await text(page, "#quest-draft-list")).includes("New idea"));
  check("old API: no page errors", !errors.length, errors.join("; "));
  await page.close();
}

async function admin(browser, base) {
  const api = freshApi(false);
  const { page, errors } = await open(browser, base + "/admin.html#quests", api);
  check("Expired filter", await page.isVisible("#quests-filter .chip[data-status='expired']"));
  check("Retired filter", await page.isVisible("#quests-filter .chip[data-status='retired']"));
  await page.waitForFunction(() => /Rathalos/.test(document.getElementById("quests-body").textContent), null, { timeout: 5000 }).catch(() => {});
  check("testing row shows its expiry", (await text(page, "#quests-body")).includes("expires " + new Date("2026-11-15T10:00:00Z").toLocaleString("en-US")),
    await text(page, "#quests-body"));
  check("admin shows the event quest slots", (await text(page, "#quests-slots")) === "511 of 512 event quest slots used.", await text(page, "#quests-slots"));
  api.slots = { used: 512, cap: 512, free: 0 };
  await page.click("#quests-filter .chip[data-status='testing']");
  await page.waitForFunction(() => /512 of 512/.test(document.getElementById("quests-slots").textContent), null, { timeout: 5000 }).catch(() => {});
  check("full list says publishing is blocked", /512 of 512 event quest slots used\. Publishing is blocked/.test(await text(page, "#quests-slots")), await text(page, "#quests-slots"));
  await page.waitForSelector("#quests-body button:has-text('Publish')", { timeout: 5000 }).catch(() => {});
  await page.click("#quests-body button:has-text('Publish')");
  await page.waitForFunction(() => /list is full/.test(document.getElementById("quests-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("a refused publish shows the API's reason", /The in-game event quest list is full \(512 of 512/.test(await text(page, "#quests-note")), await text(page, "#quests-note"));
  api.slots = { used: 511, cap: 512, free: 1 };
  await page.click("#quests-filter .chip[data-status='approved']");
  await page.waitForSelector("#quests-body button:has-text('Retire')", { timeout: 5000 }).catch(() => {});
  page.once("dialog", (d) => d.accept("Replaced by the festival version."));
  await page.click("#quests-body button:has-text('Retire')");
  await page.waitForFunction(() => /Nothing approved/.test(document.getElementById("quests-body").textContent), null, { timeout: 5000 }).catch(() => {});
  const call = api.calls.find((c) => c.path === "/api/admin/quest-submissions/5/retire");
  check("Retire posts the note", call && call.body && call.body.note === "Replaced by the festival version.", JSON.stringify(call));
  await page.click("#quests-filter .chip[data-status='retired']");
  await page.waitForFunction(() => /Published/.test(document.getElementById("quests-body").textContent), null, { timeout: 5000 }).catch(() => {});
  check("retired list shows the quest", (await text(page, "#quests-body")).includes("retired"));
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
  console.log("quest expiry OK");
})().catch((e) => { console.error(e); process.exit(1); });
