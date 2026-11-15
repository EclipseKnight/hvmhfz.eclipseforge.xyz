#!/usr/bin/env node
/* Checks guild management on the account page (js/account.js roster, js/account-guild.js) and the guild directory
   (js/guilds.js) in headless Chromium against a fake API with the shapes of the API README "Guild management":

   - account roster: Sub-leader rank, HR, GR, weapon, an "online now" dot and "Online now", "You" on own hunters,
     "N of LIMIT members" and "You: <role>" badges;
   - a leader sees the Manage part: the recruiting switch PUTs {recruiting}, the comment box counts Shift-JIS bytes,
     disables Save over 96 and PUTs {comment}; the applications table (HR, GR, weapon, applied) with Accept/Deny that
     ask first (Cancel sends nothing) and POST to .../accept and .../deny; an applicant in another guild can't be
     accepted; "Deny old applications" POSTs {days}; the API's message shows on the card after the reload, a refusal
     (409) as an error;
   - a recruiter sees recruiting and applications but no comment box and no "Deny old applications"; a plain member
     sees no Manage part; an older API (no role fields) shows none and no errors;
   - "My applications" lists the account's applications with Withdraw (asks, then DELETE), and is hidden when there
     are none or the endpoint is missing;
   - the directory sends active=N from the Active select and shows "Last active"; the public roster has the dot,
     Sub-leader, HR, GR and weapon;
   - nothing passes a 375px screen in the Manage part; no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-guild.js

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
const J = JSON.stringify;

const MEMBERS = [
  { characterId: 10, name: "Lead", rank: "Leader", recruiter: false, joinedAt: "2026-10-01T10:00:00Z", lastLogin: "2026-11-15T08:00:00Z",
    rpToday: 3, rpYesterday: 5, hr: 999, gr: 500, weapon: "Great Sword", online: false, own: true },
  { characterId: 20, name: "Second", rank: "Sub-leader", recruiter: false, joinedAt: "2026-10-02T10:00:00Z", lastLogin: "2026-11-15T07:00:00Z",
    rpToday: 0, rpYesterday: 0, hr: 700, gr: 200, weapon: "Lance", online: true, own: false },
  { characterId: 30, name: "Scout", rank: "Recruiter", recruiter: true, joinedAt: "2026-10-03T10:00:00Z", lastLogin: "2026-11-14T07:00:00Z",
    rpToday: 0, rpYesterday: 0, hr: 500, gr: 100, weapon: "Bow", online: false, own: false }
];
const APPS = [
  { characterId: 50, name: "Hopeful", hr: 200, gr: 10, weapon: "Hammer", lastLogin: "2026-11-15T06:00:00Z", online: true,
    appliedAt: "2026-11-14T06:00:00Z", inGuild: false },
  { characterId: 70, name: "Elsewhere", hr: 400, gr: 50, weapon: "Tonfa", lastLogin: "2026-08-01T06:00:00Z", online: false,
    appliedAt: "2026-11-13T06:00:00Z", inGuild: true }
];

function guild(role, extra) {
  const can = { Leader: [true, true, true], "Sub-leader": [true, true, false], Recruiter: [true, false, false], Member: [false, false, false] }[role];
  return Object.assign({ id: 100, name: "Hunters", comment: "Old comment", rankRp: 0, eventRp: 0, towerRp: 0, roomRp: 0,
    recruiting: true, createdAt: "2026-01-01T00:00:00Z", roomExpiry: null, leaderName: "Lead", members: MEMBERS,
    memberLimit: 30, myRole: role, canRecruit: can[0], canEditComment: can[1], canClearStale: can[2],
    applications: can[0] ? APPS : [] }, extra || {});
}

// state: {guilds: () => [...], own: [...] | "missing", calls: [], refuse: {path: [status, message]}}
async function open(browser, base, state, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 }, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { state.dialogs = (state.dialogs || 0) + 1; return state.cancel ? d.dismiss() : d.accept(); });
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (req.method() !== "GET") {
      state.calls.push({ method: req.method(), path: p, body: req.postData() ? JSON.parse(req.postData()) : null });
      const refusal = state.refuse && state.refuse[p];
      if (refusal) return reply(refusal[0], { message: refusal[1] });
      return reply(200, { message: "Done: " + req.method() + " " + p });
    }
    if (p === "/api/account/guilds") return reply(200, state.guilds());
    if (p === "/api/account/guild-applications") {
      if (state.own === "missing") return reply(404, { message: "Not found" });
      return reply(200, state.own || []);
    }
    if (p === "/api/public/guilds") {
      state.listQueries = (state.listQueries || []).concat([url.search]);
      return reply(200, { items: [{ id: 100, name: "Hunters", leader: "Lead", members: 3, rankRp: 50, eventRp: 0, recruiting: true,
        createdAt: "2026-01-01T00:00:00Z", lastActive: "2026-11-15T08:00:00Z" }], page: 0, size: 24, total: 1 });
    }
    if (p === "/api/public/guilds/100") {
      return reply(200, { id: 100, name: "Hunters", leader: "Lead", comment: "", rankRp: 50, eventRp: 0, towerRp: 0, roomRp: 0,
        recruiting: true, createdAt: "2026-01-01T00:00:00Z", roomExpiry: null, members: 3, posts: [],
        roster: MEMBERS.map((m) => ({ characterId: m.characterId, name: m.name, rank: m.rank, recruiter: m.recruiter,
          joinedAt: m.joinedAt, lastLogin: m.lastLogin, rpToday: 0, rpYesterday: 0, hr: m.hr, gr: m.gr, weapon: m.weapon, online: m.online })) });
    }
    if (p === "/api/account") return reply(200, { name: "leader", roles: ["ROLE_USER"], characters: 1, lastLogin: null });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
  await page.goto(base + "/account.html#guild");
  await page.waitForSelector("#panel-guild", { timeout: 5000 });
  await page.waitForTimeout(700);
  return { page, errors };
}

const texts = (page, sel) => page.$$eval(sel, (n) => n.map((x) => x.textContent.trim()));

async function run(browser, base) {
  // Leader: roster and every Manage control.
  {
    const st = { calls: [], guilds: () => [guild("Leader")], own: [] };
    const { page, errors } = await open(browser, base, st);
    const heads = await texts(page, ".guild-card .member-table thead th");
    check("roster columns", J(heads) === J(["Hunter", "Rank", "Manage right", "HR", "GR", "Weapon", "Joined", "RP today", "RP yesterday", "Last login"]), J(heads));
    const second = await texts(page, ".guild-card .member-table tbody tr:nth-child(2) td");
    check("sub-leader row", second[1] === "Sub-leader" && second[5] === "Lance" && second[4] === "200" && second[9] === "Online now", J(second));
    check("online dot on the online member only", (await page.$$(".guild-card .member-table .online-dot")).length === 1);
    check("You badge on own hunter", (await page.textContent(".guild-card .member-table tbody tr:first-child td")).includes("You"));
    const badges = await texts(page, ".guild-card .guild-head .badge");
    check("badges", badges.includes("3 of 30 members") && badges.includes("You: Leader"), J(badges));
    check("manage part shown", await page.isVisible(".guild-manage"));
    check("My applications hidden when empty", !(await page.isVisible("#guild-apps-panel")));

    const rows = await texts(page, ".guild-apps tbody tr td:first-child a");
    check("applications listed", J(rows) === J(["Hopeful", "Elsewhere"]), J(rows));
    check("in another guild: accept disabled", await page.$eval(".guild-apps tbody tr:nth-child(2) .btn-primary", (b) => b.disabled));
    check("hunter link", (await page.getAttribute(".guild-apps tbody tr:first-child a", "href")) === "/hunters.html?id=50");

    // Cancel sends nothing.
    st.cancel = true;
    await page.click(".guild-apps tbody tr:first-child .btn-primary");
    await page.waitForTimeout(200);
    check("cancelled accept sends nothing", st.calls.length === 0, J(st.calls));
    st.cancel = false;

    await page.click(".guild-apps tbody tr:first-child .btn-primary");
    await page.waitForTimeout(500);
    check("accept POST", J(st.calls[0]) === J({ method: "POST", path: "/api/account/guilds/100/applications/50/accept", body: null }), J(st.calls));
    check("message after reload", (await page.textContent(".guild-manage-status")) === "Done: POST /api/account/guilds/100/applications/50/accept");

    await page.click(".guild-apps tbody tr:first-child .btn-secondary");
    await page.waitForTimeout(500);
    check("deny POST", st.calls[1] && st.calls[1].path === "/api/account/guilds/100/applications/50/deny", J(st.calls));

    await page.selectOption(".guild-apps select", "30");
    await page.click(".guild-apps .guild-manage-row .btn");
    await page.waitForTimeout(500);
    check("clear stale POST with days", st.calls[2] && st.calls[2].path === "/api/account/guilds/100/applications/clear-stale"
      && J(st.calls[2].body) === J({ days: 30 }), J(st.calls[2]));

    await page.click(".guild-switch input");
    await page.waitForTimeout(500);
    check("recruiting PUT", st.calls[3] && st.calls[3].method === "PUT" && st.calls[3].path === "/api/account/guilds/100/recruiting"
      && J(st.calls[3].body) === J({ recruiting: false }), J(st.calls[3]));

    const input = ".guild-comment-edit input";
    check("save disabled while unchanged", await page.$eval(".guild-comment-edit button", (b) => b.disabled));
    await page.fill(input, "ハンター募集中");
    check("byte count counts Japanese as 2", (await page.textContent(".guild-comment-edit .toolbar-note")) === "14 / 96 bytes");
    await page.fill(input, "a".repeat(97));
    check("over 96 bytes: save disabled", await page.$eval(".guild-comment-edit button", (b) => b.disabled));
    await page.fill(input, "Weekly hunts");
    await page.click(".guild-comment-edit button");
    await page.waitForTimeout(500);
    check("comment PUT", st.calls[4] && st.calls[4].path === "/api/account/guilds/100/comment"
      && J(st.calls[4].body) === J({ comment: "Weekly hunts" }), J(st.calls[4]));

    // A refusal shows the API's message as an error.
    st.refuse = { "/api/account/guilds/100/applications/50/accept": [409, "The guild is full (30 of 30 members at its rank)."] };
    await page.click(".guild-apps tbody tr:first-child .btn-primary");
    await page.waitForTimeout(500);
    check("refusal shown", (await page.textContent(".guild-manage-status")) === "The guild is full (30 of 30 members at its rank)."
      && await page.$eval(".guild-manage-status", (n) => n.classList.contains("is-error")));
    check("no page errors (leader)", !errors.length, errors.join("; "));
    await page.close();
  }

  // Recruiter, member, older API.
  {
    const st = { calls: [], guilds: () => [guild("Recruiter")], own: [] };
    const { page, errors } = await open(browser, base, st);
    check("recruiter: switch and applications", await page.isVisible(".guild-switch") && await page.isVisible(".guild-apps tbody"));
    check("recruiter: no comment box", !(await page.$(".guild-comment-edit")));
    check("recruiter: no clear stale", !(await page.$(".guild-apps select")));
    check("no page errors (recruiter)", !errors.length, errors.join("; "));
    await page.close();
  }
  {
    const st = { calls: [], guilds: () => [guild("Member")], own: [] };
    const { page, errors } = await open(browser, base, st);
    check("member: no manage part", !(await page.$(".guild-manage")));
    check("no page errors (member)", !errors.length, errors.join("; "));
    await page.close();
  }
  {
    const old = guild("Leader");
    ["memberLimit", "myRole", "canRecruit", "canEditComment", "canClearStale", "applications"].forEach((k) => delete old[k]);
    const st = { calls: [], guilds: () => [old], own: "missing" };
    const { page, errors } = await open(browser, base, st);
    check("older API: no manage part", !(await page.$(".guild-manage")));
    check("older API: members badge", (await texts(page, ".guild-card .guild-head .badge")).includes("3 members"));
    check("older API: My applications hidden", !(await page.isVisible("#guild-apps-panel")));
    check("no page errors (older API)", !errors.length, errors.join("; "));
    await page.close();
  }

  // My applications.
  {
    const st = { calls: [], guilds: () => [], own: [{ characterId: 50, characterName: "Hopeful", guildId: 100, guildName: "Hunters",
      recruiting: false, appliedAt: "2026-11-14T06:00:00Z" }] };
    const { page, errors } = await open(browser, base, st);
    check("My applications shown", await page.isVisible("#guild-apps-panel"));
    const item = await page.textContent("#guild-apps li");
    check("application text", item.includes("Hopeful applied to Hunters") && item.includes("Not recruiting now"), item);
    st.own = [];
    await page.click("#guild-apps li button");
    await page.waitForTimeout(500);
    check("withdraw DELETE", J(st.calls) === J([{ method: "DELETE", path: "/api/account/guild-applications/100/50", body: null }]), J(st.calls));
    check("withdraw message", (await page.textContent("#guild-apps-status")) === "Done: DELETE /api/account/guild-applications/100/50");
    check("panel hidden once empty", !(await page.isVisible("#guild-apps-panel")));
    check("no page errors (own)", !errors.length, errors.join("; "));
    await page.close();
  }

  // 375px.
  {
    const st = { calls: [], guilds: () => [guild("Leader")], own: [] };
    const { page, errors } = await open(browser, base, st, 375);
    const w = await page.evaluate(() => {
      const box = document.querySelector(".guild-manage");
      const outside = Array.from(box.querySelectorAll("*")).filter((e) => !e.closest(".table-wrap"))
        .map((e) => e.getBoundingClientRect().right);
      return { right: box.getBoundingClientRect().right, widest: Math.max.apply(null, outside) };
    });
    check("manage part inside 375px", w.right <= 375 && w.widest <= 375, J(w));
    check("no page errors (375px)", !errors.length, errors.join("; "));
    await page.close();
  }

  // Directory and public roster.
  {
    const st = { calls: [], guilds: () => [], own: [] };
    const { page, errors } = await open(browser, base, st);
    await page.goto(base + "/guilds.html");
    await page.waitForSelector("#guilds .tile", { timeout: 5000 });
    check("tile shows last active", (await page.textContent("#guilds .tile")).includes("Last active"));
    await page.selectOption("#guild-active", "30");
    await page.waitForTimeout(400);
    const last = (st.listQueries || []).slice(-1)[0] || "";
    check("active filter sent", last.includes("active=30") && last.includes("page=0"), last);
    await page.selectOption("#guild-sort", "active");
    await page.waitForTimeout(400);
    check("sort active sent", ((st.listQueries || []).slice(-1)[0] || "").includes("sort=active"));

    await page.goto(base + "/guilds.html?id=100");
    await page.waitForSelector("#detail-view table", { timeout: 5000 });
    const heads = await texts(page, "#detail-view thead th");
    check("public roster columns", J(heads) === J(["Hunter", "Rank", "HR", "GR", "Weapon", "Joined", "RP today", "RP yesterday", "Last seen"]), J(heads));
    const row = await texts(page, "#detail-view tbody tr:nth-child(2) td");
    check("public sub-leader row", row[1] === "Sub-leader" && row[2] === "700" && row[4] === "Lance" && row[8] === "Online now", J(row));
    check("public online dot", (await page.$$("#detail-view .online-dot")).length === 1);
    const scout = await page.textContent("#detail-view tbody tr:nth-child(3) td");
    check("no doubled Recruiter badge", (scout.match(/Recruiter/g) || []).length === 0, scout);
    check("no page errors (directory)", !errors.length, errors.join("; "));
    await page.close();
  }
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try { await run(browser, base); } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("account guild management OK");
})();
