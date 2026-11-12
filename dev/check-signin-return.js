#!/usr/bin/env node
/* Checks in headless Chromium, against a fake API, the sign-in return and the public Road page:

   - signed out (no saved sign-in, or an expired one), the Road builder, the Quest builder and the account
     page send the visitor to /?next=<that page>#login-form, and the home page says why ("Sign in to use the
     Quest builder");
   - with a saved sign-in the home page sends the visitor on to next, and to the account page when next is
     missing or not a path on this site (another site, //host, a backslash, javascript:);
   - road-vote.html signed out shows the Road live now (GET /api/public/road/versions), how a rotation runs,
     the links to Past winners, Road data and Roads in game, and a "Sign in to vote" link that comes back;
     it calls no signed-in endpoint. Signed in it still shows the rotation and its entries.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-signin-return.js

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
const TOKEN = jwt(4102444800);   // 2100
const EXPIRED = jwt(1000000000); // 2001

const VERSIONS = [
  { sha256: "b".repeat(64), name: "Sky Ladder", author: "Aldra", kind: "winner", firstLiveAt: "2026-10-30T12:00:00Z",
    retiredAt: null, live: true, cycle: 3, always: false },
  { sha256: "a".repeat(64), name: "Original Road", author: null, kind: "original", firstLiveAt: null,
    retiredAt: "2026-10-01T00:00:00Z", live: false, cycle: -1, always: true }
];
const CYCLE = { id: 9, number: 4, state: "submitting", paused: false, submitOpens: "2026-10-23T00:00:00Z",
  submitCloses: "2026-11-06T00:00:00Z", voteCloses: "2026-11-13T00:00:00Z", limits: { entriesPerAccount: 1, votesPerAccount: 3 },
  myEntries: [], myVotes: [] };

const PUBLIC_CYCLE = { number: 4, name: null, state: "submitting", submitOpens: "2026-10-23T00:00:00Z",
  submitCloses: "2026-11-06T00:00:00Z", voteOpens: "2026-11-06T00:00:00Z", voteCloses: "2026-11-13T00:00:00Z",
  liveFrom: null, liveUntil: null, paused: false,
  next: { number: 3, name: null, state: "voting", submitOpens: "2026-10-09T00:00:00Z", submitCloses: "2026-10-23T00:00:00Z",
    voteOpens: "2026-10-23T00:00:00Z", voteCloses: "2026-10-30T00:00:00Z", liveFrom: "2026-10-30T00:00:00Z", liveUntil: null } };

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };

/* A page with the fake API; token: the saved sign-in (or none). Records every API path asked for. */
async function open(browser, token, opts) {
  const o = opts || {};
  const page = await browser.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (token) await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), token);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    calls.push(p);
    const signed = (req.headers().authorization || "") === "Bearer " + TOKEN;
    let status = 200;
    let body = "[]";
    if (p === "/api/public/road/cycle") {
      // o.cycle: undefined = the public cycle, "missing" = old API (404), "none" = no cycle yet (204), or an object
      if (o.cycle === "missing") { status = 404; body = ""; }
      else if (o.cycle === "none") { status = 204; body = ""; }
      else body = JSON.stringify(o.cycle || PUBLIC_CYCLE);
    } else if (p === "/api/public/road/versions") body = JSON.stringify(o.versions || VERSIONS);
    else if (p.startsWith("/api/public/")) body = "[]";
    else if (!signed) { status = 401; body = "{}"; }
    else if (p === "/api/account") body = "{}";
    else if (p === "/api/road/cycle") body = JSON.stringify(CYCLE);
    else if (p === "/api/road/entries") body = JSON.stringify([{ id: 1, name: "Tall Road", characterName: "Bexo", votes: null }]);
    return route.fulfill({ status, contentType: "application/json", headers: CORS, body });
  });
  return { page, errors, calls };
}

async function landing(page) {
  await page.waitForURL((u) => u.pathname === "/", { timeout: 5000 }).catch(() => {});
  return new URL(page.url());
}

async function signinPages(browser, base) {
  const cases = [
    { from: "/road.html", note: "Sign in to use the Road builder." },
    { from: "/road.html?entry=5", note: "Sign in to use the Road builder." },
    { from: "/quest-editor.html", note: "Sign in to use the Quest builder." },
    { from: "/quest-editor.html?draft=3", note: "Sign in to use the Quest builder." },
    { from: "/account.html#quests", note: "Sign in to open your account." }
  ];
  for (const token of [null, EXPIRED]) {
    const tag = token ? "expired sign-in" : "signed out";
    for (const c of cases) {
      const r = await open(browser, token);
      await r.page.goto(base + c.from);
      const url = await landing(r.page);
      check(`${tag} ${c.from}: sent to the sign-in form`, url.pathname === "/" && url.searchParams.get("next") === c.from
        && url.hash === "#login-form", url.href);
      const note = await r.page.waitForSelector("#login-next:not([hidden])", { timeout: 5000 })
        .then((n) => n.textContent()).catch(() => "(no note)");
      check(`${tag} ${c.from}: note`, note === c.note, note);
      check(`${tag} ${c.from}: errors`, r.errors.length === 0, r.errors.join("; "));
      await r.page.close();
    }
  }
}

/* With a saved sign-in, the home page goes on to next (js/main.js, after GET /api/account). */
async function returns(browser, base) {
  const cases = [
    ["?next=%2Fquest-editor.html%3Fdraft%3D3", "/quest-editor.html?draft=3"],
    ["?next=%2Froad-vote.html", "/road-vote.html"],
    ["", "/account.html"],
    ["?next=https%3A%2F%2Fevil.example%2F", "/account.html"],
    ["?next=%2F%2Fevil.example", "/account.html"],
    ["?next=%2F%5Cevil.example", "/account.html"],
    ["?next=%2F%09%2Fevil.example", "/account.html"],
    ["?next=javascript%3Aalert(document.domain)", "/account.html"],
    ["?next=%2F", "/account.html"]
  ];
  for (const [query, want] of cases) {
    const r = await open(browser, TOKEN);
    let off = null;
    r.page.on("request", (req) => { if (req.isNavigationRequest() && !req.url().startsWith(base)) off = req.url(); });
    await r.page.goto(base + "/" + query);
    await r.page.waitForURL((u) => u.pathname !== "/", { timeout: 5000 }).catch(() => {});
    const url = new URL(r.page.url());
    check(`return ${query || "(none)"}`, url.origin === base && url.pathname + url.search === want && off === null,
      r.page.url() + (off ? " (left for " + off + ")" : ""));
    if (query.includes("evil") && url.pathname === "/") {
      check(`return ${query}: no note`, await r.page.isHidden("#login-next").catch(() => true), "");
    }
    await r.page.close();
  }
}

async function roadPage(browser, base) {
  // signed out
  let r = await open(browser, null);
  await r.page.goto(base + "/road-vote.html");
  await r.page.waitForFunction(() => /Sky Ladder/.test(document.getElementById("vote-phase-text").textContent), null, { timeout: 5000 })
    .catch(() => {});
  const text = await r.page.textContent("#vote-phase-text");
  check("road signed out: live Road", text === "“Sky Ladder” is the Hunting Road in game now, the winner of rotation 3, by Aldra.", text);
  const phase = await r.page.textContent("#vote-phase");
  check("road signed out: live since", /Live since/.test(phase) && /2026/.test(phase), phase);
  check("road signed out: schedule", /14 days/.test(await r.page.textContent("#vote-limits")));
  check("road signed out: vote box", await r.page.isVisible("#vote-signin"));
  await r.page.waitForFunction(() => !document.getElementById("vote-cycle").hidden, null, { timeout: 5000 }).catch(() => {});
  check("road signed out: rotation head", (await r.page.textContent("#vote-cycle-head")) === "Rotation 4");
  check("road signed out: phase in words", (await r.page.textContent("#vote-cycle-text")) === "Submissions are open.", await r.page.textContent("#vote-cycle-text"));
  const local = await r.page.evaluate(() => window.HvTime.text("2026-11-13T00:00:00Z"));
  const dates = await r.page.textContent("#vote-cycle-dates");
  check("road signed out: dates in local time", dates.includes(local) && /Voting closes/.test(dates), dates);
  check("road signed out: next rotation", /Next up, rotation 3: Voting is open\./.test(await r.page.textContent("#vote-next-text"))
    && /Winner goes live/.test(await r.page.textContent("#vote-next-dates")));
  check("road signed out: no entries panel", await r.page.isHidden("#vote-entries-panel"));
  const signin = await r.page.getAttribute("#vote-signin a.btn", "href");
  check("road signed out: sign-in comes back", signin === "/?next=%2Froad-vote.html#login-form", signin);
  const hrefs = await r.page.$$eval("main a", (as) => as.filter((a) => a.offsetParent !== null).map((a) => a.getAttribute("href")));
  ["/road-history.html", "/road-data.html", "/guide-roads.html"].forEach((h) => check("road signed out: link " + h, hrefs.includes(h), hrefs.join(" ")));
  check("road signed out: public endpoints only", r.calls.every((p) => p.startsWith("/api/public/")), r.calls.join(" "));
  check("road signed out: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  // signed out, the Original Road live, then the archive down
  r = await open(browser, null, { versions: [Object.assign({}, VERSIONS[1], { live: true, retiredAt: null })] });
  await r.page.goto(base + "/road-vote.html");
  await r.page.waitForFunction(() => /original/.test(document.getElementById("vote-phase-text").textContent), null, { timeout: 5000 }).catch(() => {});
  check("road signed out: original Road", (await r.page.textContent("#vote-phase-text")) === "“Original Road” is the Hunting Road in game now, the server's original Road.");
  await r.page.close();
  r = await open(browser, null);
  await r.page.route("https://api.hvmhfz.eclipseforge.xyz/api/public/road/versions", (route) => route.fulfill({ status: 503, headers: CORS, body: "" }));
  await r.page.goto(base + "/road-vote.html");
  await r.page.waitForFunction(() => /could not be loaded/.test(document.getElementById("vote-phase-text").textContent), null, { timeout: 5000 }).catch(() => {});
  check("road signed out: archive down", /could not be loaded/.test(await r.page.textContent("#vote-phase-text")));
  check("road signed out, archive down: vote box", await r.page.isVisible("#vote-signin"));
  await r.page.close();

  // the cycle endpoint missing (old API, 404), empty (204) or without a next rotation
  for (const [tag, cycle] of [["404", "missing"], ["204", "none"]]) {
    r = await open(browser, null, { cycle });
    await r.page.goto(base + "/road-vote.html");
    await r.page.waitForFunction(() => /Sky Ladder/.test(document.getElementById("vote-phase-text").textContent), null, { timeout: 5000 }).catch(() => {});
    await r.page.waitForTimeout(300);
    check("road cycle " + tag + ": current view", /Sky Ladder/.test(await r.page.textContent("#vote-phase-text")) && await r.page.isVisible("#vote-signin"));
    check("road cycle " + tag + ": no rotation block", await r.page.isHidden("#vote-cycle"));
    check("road cycle " + tag + ": errors", r.errors.length === 0, r.errors.join("; "));
    await r.page.close();
  }
  r = await open(browser, null, { cycle: Object.assign({}, PUBLIC_CYCLE, { next: null, paused: true, state: "voting" }) });
  await r.page.goto(base + "/road-vote.html");
  await r.page.waitForFunction(() => !document.getElementById("vote-cycle").hidden, null, { timeout: 5000 }).catch(() => {});
  check("road cycle: voting, paused", /^Voting is open\. New rotations are paused/.test(await r.page.textContent("#vote-cycle-text")));
  check("road cycle: no next", await r.page.isHidden("#vote-next-text"));
  await r.page.close();

  // expired sign-in: the same public view
  r = await open(browser, EXPIRED);
  await r.page.goto(base + "/road-vote.html");
  await r.page.waitForFunction(() => /Sky Ladder/.test(document.getElementById("vote-phase-text").textContent), null, { timeout: 5000 }).catch(() => {});
  check("road expired: public view", /Sky Ladder/.test(await r.page.textContent("#vote-phase-text")));
  await r.page.close();

  // signed in: the rotation and its entries, no sign-in box
  r = await open(browser, TOKEN);
  await r.page.goto(base + "/road-vote.html");
  await r.page.waitForFunction(() => /Tall Road/.test(document.getElementById("vote-rows").textContent), null, { timeout: 5000 }).catch(() => {});
  check("road signed in: rotation", (await r.page.textContent("#vote-phase-head")) === "Rotation 4");
  check("road signed in: entries", /Tall Road/.test(await r.page.textContent("#vote-rows")));
  check("road signed in: no sign-in box", await r.page.isHidden("#vote-signin"));
  check("road signed in: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await signinPages(browser, base);
    await returns(browser, base);
    await roadPage(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("sign-in return and public Road page OK");
})().catch((e) => { console.error(e); process.exit(1); });
