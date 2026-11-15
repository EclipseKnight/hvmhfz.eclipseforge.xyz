#!/usr/bin/env node
/* Checks the Community sets page (community-sets.html, js/community-sets.js, js/community-api.js,
   js/set-post-form.js) in headless Chromium against a fake API that follows the contract in
   docs/armor-set-builder.md "Community sets":

   - the list: cards with title, weapon class, band, stage, skill names, votes, author and date; every filter
     sends its query to the API and lands in the address; the address restores the filters; paging;
   - one set (?id=N): title, notes, pieces with names, decorations, "Open in the Set builder", Share copies the
     API's share link, a missing set says so;
   - signed out: "Sign in to ..." links instead of vote, report and post, each coming back to the page;
   - signed in: Upvote / Remove vote, Report (empty reason refused, the API's refusal shown), nothing to vote or
     report on your own set, "My sets" (hidden note, Edit sends the PUT body, Delete asks first, the builder link);
   - posting from the Set builder (set-builder.html, js/set-builder.js): signed out the button says Sign in to post;
     signed in the form's POST body (title, notes, normalized set, band, stage, the active skill ids the page shows,
     showAuthor off by default, the character), refusals shown, the link to the new set; with &edit=<id> the form
     opens on that set's details and sends a PUT, and the address keeps &edit; an id that is not the player's falls
     back to posting;
   - markup in titles, notes, authors and reasons stays text; no sideways scroll at 390 px; no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-community-sets.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Calc = require("../js/armor-calc.js");

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
  return b64({ alg: "HS256" }) + "." + b64({ sub: "hunter1", exp }) + ".sig";
}
const TOKEN = jwt(4102444800);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };

/* ---- fixtures: real piece ids and names from the site's data, made-up everything else ---- */

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const head = readJson("data/armor/head.json").pieces[3];
const chest = readJson("data/armor/chest.json").pieces[3];
const index = readJson("data/armor/index.json");
const deco = index.decorations.filter((d) => d[2] === "d")[0];
const SKILL_A = 1, SKILL_B = 2;
const nameA = index.skillNames[SKILL_A], nameB = index.skillNames[SKILL_B];
const SET = { v: 1, data: index.version, weapon: [7, 0, [], []],
  armour: [["head", head[0], 3, [deco[0]]], ["chest", chest[0], 1, []], ["arms", 0, 1, []], ["waist", 0, 1, []], ["legs", 0, 1, []]], cuffs: [] };
const BAD_TITLE = "Starter <b>LS</b> & <script>window.__x=1</script>";
const BAD_NOTES = "Use <img src=x onerror=\"window.__y=1\"> on Zenith.\nSecond line.";

function item(id, over) {
  return Object.assign({ id, title: "Set " + id, notes: "", set: SET, data: index.version, weaponClass: 7, weaponId: 0, band: "hr4",
    stage: "zenith", skills: [SKILL_A, SKILL_B], votes: 1, author: null, createdAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z",
    voted: false, mine: false, hidden: false, hiddenReason: null, showAuthor: false, charId: null }, over || {});
}

function newApi(extra) {
  return Object.assign({
    calls: [],
    options: { bands: [{ key: "hr1", label: "HR1 (HR 1-29)" }, { key: "hr2", label: "HR2 (HR 30-49)" }, { key: "hr3", label: "HR3 (HR 50-98)" },
      { key: "hr4", label: "HR4 (HR 99-298)" }, { key: "hr5", label: "HR5 (HR 299-997)" }, { key: "hr6", label: "HR6-7 (HR 998-999)" },
      { key: "gr1", label: "GR 1-49" }, { key: "gr50", label: "GR 50-99" }, { key: "gr100", label: "GR 100+" }],
      stages: [{ key: "", label: "Any" }, { key: "zenith", label: "Zenith" }, { key: "tower", label: "Tower" }, { key: "road", label: "Hunting Road" }],
      data: index.version, maxTitle: 60, maxNotes: 1000, maxReason: 300 },
    sets: [item(1, { title: BAD_TITLE, notes: BAD_NOTES, author: "Hunter <i>One</i>", votes: 3 }),
           item(2, { title: "Gunner start", weaponClass: 5, band: "gr50", stage: "", skills: [SKILL_B], votes: 0, createdAt: "2026-11-14T10:00:00Z" }),
           item(3, { title: "Own long sword", mine: true, votes: 2 })],
    own: [item(10, { title: "My <u>bow</u> set", notes: "mine", mine: true, votes: 1, showAuthor: false, charId: 5, weaponClass: 10 }),
          item(11, { title: "Hidden one", mine: true, hidden: true, hiddenReason: "Not a set <b>really</b>" })],
    characters: [{ id: 5, name: "Aldric", hr: 120, gr: 0 }, { id: 6, name: "Brenna", hr: 5, gr: 60 }],
    bigTotal: false, reported: {}, signedIn: false
  }, extra || {});
}

function fakeApi(page, api) {
  page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    api.calls.push({ method: req.method(), path: p + url.search, body: sent, auth: req.headers().authorization || "" });
    const needAuth = p.startsWith("/api/account");
    if (needAuth && !req.headers().authorization) return reply(401, { message: "Unauthorized" });
    let m;
    if (p === "/api/public/armor-sets/options") return reply(200, api.options);
    if (p === "/api/public/armor-sets") {
      const q = url.searchParams;
      const order = api.options.bands.map((b) => b.key);
      let list = api.sets.filter((s) => (!q.get("band") || s.band === q.get("band"))
        && (!q.get("upTo") || order.indexOf(s.band) <= order.indexOf(q.get("upTo")))
        && (!q.get("stage") || s.stage === q.get("stage"))
        && (!q.get("weapon") || s.weaponClass === Number(q.get("weapon")))
        && (!q.getAll("skill").length || (q.get("match") === "all" ? q.getAll("skill").every((k) => s.skills.indexOf(Number(k)) !== -1)
          : q.getAll("skill").some((k) => s.skills.indexOf(Number(k)) !== -1))));
      if (q.get("sort") === "new") list = list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
      else list = list.slice().sort((a, b) => b.votes - a.votes || b.id - a.id);
      return reply(200, { total: api.bigTotal ? 41 : list.length, page: Number(q.get("page") || 0), size: Number(q.get("size") || 20), items: list });
    }
    if ((m = p.match(/^\/api\/public\/armor-sets\/(\d+)$/))) {
      const s = api.sets.find((x) => x.id === Number(m[1]));
      return s ? reply(200, s) : reply(404, { message: "No such set." });
    }
    if (p === "/api/account/characters") return reply(200, api.characters);
    if (p === "/api/account/armor-sets" && req.method() === "GET") return reply(200, { items: api.own });
    if (p === "/api/account/armor-sets" && req.method() === "POST") {
      if (api.postRefuse) return reply(api.postRefuse.status, { message: api.postRefuse.message });
      return reply(201, Object.assign(item(77, { mine: true }), sent));
    }
    if ((m = p.match(/^\/api\/account\/armor-sets\/(\d+)$/))) {
      const i = api.own.findIndex((x) => x.id === Number(m[1]));
      if (i < 0) return reply(404, { message: "No such set." });
      if (req.method() === "DELETE") { api.own.splice(i, 1); return reply(200, { deleted: 1 }); }
      if (req.method() === "PUT") { api.own[i] = Object.assign({}, api.own[i], sent); return reply(200, api.own[i]); }
    }
    if ((m = p.match(/^\/api\/account\/armor-sets\/(\d+)\/vote$/))) {
      const s = api.sets.find((x) => x.id === Number(m[1]));
      if (s.mine) return reply(400, { message: "You cannot vote for your own set." });
      s.voted = req.method() === "PUT";
      s.votes += s.voted ? 1 : -1;
      return reply(200, { votes: s.votes, voted: s.voted });
    }
    if ((m = p.match(/^\/api\/account\/armor-sets\/(\d+)\/report$/))) {
      if (api.reported[m[1]]) return reply(409, { message: "You already reported this set." });
      api.reported[m[1]] = true;
      return reply(200, { message: "Thanks: staff will look at this set." });
    }
    return reply(404, { message: "Not Found" });
  });
}

async function open(browser, url, api, width, signedIn) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((arg) => {
    if (arg.token) localStorage.setItem("hvmhfz.token", arg.token);
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() }));
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  }, { token: signedIn ? TOKEN : "" });
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  fakeApi(page, api);
  await page.goto(url);
  return { page, errors };
}

// SHOTS=<folder> saves a picture of the main states, for looking at
const shot = async (page, name) => {
  if (!process.env.SHOTS) return;
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await page.addStyleTag({ content: ".site-nav{position:static !important}" });
  await page.screenshot({ path: path.join(process.env.SHOTS, name + ".png"), fullPage: true });
};
const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const texts = (page, sel) => page.$$eval(sel, (n) => n.map((x) => x.textContent));
const listCalls = (api) => api.calls.filter((c) => c.method === "GET" && c.path.startsWith("/api/public/armor-sets?"));
const lastList = (api) => listCalls(api).pop().path.replace("/api/public/armor-sets?", "");
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const cards = (page) => page.$$eval("#cs-list .cs-card", (n) => n.map((c) => c.getAttribute("data-id")).join(","));

async function waitCards(page, ids) {
  await page.waitForFunction((want) => Array.from(document.querySelectorAll("#cs-list .cs-card")).map((c) => c.getAttribute("data-id")).join(",") === want, ids, { timeout: 5000 })
    .catch(() => {});
}

async function run() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  let r, page, api;

  // ---- signed out: the list ----
  api = newApi();
  r = await open(browser, base + "/community-sets.html", api, 1280, false);
  page = r.page;
  await waitCards(page, "1,3,2");
  check("list: cards in vote order", (await cards(page)) === "1,3,2", await cards(page));
  await shot(page, "cs-list-signed-out");
  check("list: default query", lastList(api) === "sort=top&page=0&size=20", lastList(api));
  check("list: no sign-in header sent signed out", listCalls(api).every((c) => c.auth === ""));
  check("list: markup in a title stays text", (await text(page, '.cs-card[data-id="1"] .cs-card-title')) === BAD_TITLE
    && (await page.$$('.cs-card[data-id="1"] .cs-card-title b')).length === 0 && !(await page.evaluate(() => window.__x)));
  check("list: author with markup stays text", (await text(page, '.cs-card[data-id="1"] .cs-foot')).indexOf("by Hunter <i>One</i>") === 0
    && (await page.$$('.cs-card[data-id="1"] .cs-foot i')).length === 0);
  const c1 = await text(page, '.cs-card[data-id="1"]');
  check("card: weapon class, band, stage, skills, votes, date", c1.indexOf("Long Sword") !== -1 && c1.indexOf("HR4 (HR 99-298)") !== -1 && c1.indexOf("Zenith") !== -1
    && c1.indexOf(nameA) !== -1 && c1.indexOf(nameB) !== -1 && c1.indexOf("3 votes") !== -1 && c1.indexOf("2026-11-15") !== -1, c1);
  const c2 = await text(page, '.cs-card[data-id="2"]');
  check("card: Light Bowgun, GR 50-99, no stage, no author, 0 votes", c2.indexOf("Light Bowgun") !== -1 && c2.indexOf("GR 50-99") !== -1 && c2.indexOf("by ") === -1 && c2.indexOf("0 votes") !== -1, c2);
  check("band select from the API's options", (await texts(page, "#cs-band option")).length === 10 && (await texts(page, "#cs-stage option")).join("|") === "Any stage|Zenith|Tower|Hunting Road");
  check("skill suggestions hold the skill names", (await page.$$eval("#cs-skill-names option", (o) => o.some((x) => x.value === "Para Halved"))));
  const mine = await text(page, "#cs-mine");
  check("signed out: Sign in to post, no My sets list", mine.indexOf("Sign in to post a set") !== -1 && (await page.$$("#cs-mine .cs-mine-item")).length === 0);
  check("signed out: sign-in link comes back to the page", (await page.getAttribute("#cs-mine a.btn", "href")) === "/?next=%2Fcommunity-sets.html#login-form",
    await page.getAttribute("#cs-mine a.btn", "href"));
  check("no page errors (list, signed out)", r.errors.length === 0, r.errors.join("; "));

  // ---- filters send their query and live in the address ----
  api.calls.length = 0;
  await page.selectOption("#cs-band", "hr4");
  await waitCards(page, "1,3");
  check("band: query", lastList(api) === "band=hr4&sort=top&page=0&size=20", lastList(api));
  check("band: address", new URL(page.url()).search === "?band=hr4", page.url());
  check("band: only the HR4 sets", (await cards(page)) === "1,3", await cards(page));
  await page.selectOption("#cs-upto", "gr50");
  await waitCards(page, "1,3,2");
  check("up to my rank: query has upTo and no band", lastList(api) === "upTo=gr50&sort=top&page=0&size=20", lastList(api));
  check("up to my rank clears the band select", (await page.$eval("#cs-band", (s) => s.value)) === "" && new URL(page.url()).search === "?upTo=gr50", page.url());
  await page.selectOption("#cs-upto", "");
  await page.selectOption("#cs-stage", "zenith");
  await waitCards(page, "1,3");
  check("stage: query", lastList(api) === "stage=zenith&sort=top&page=0&size=20", lastList(api));
  await page.selectOption("#cs-weapon", "7");
  await waitCards(page, "1,3");
  check("weapon: query", lastList(api) === "stage=zenith&weapon=7&sort=top&page=0&size=20", lastList(api));
  await page.fill("#cs-skill", nameA);
  await page.click("#cs-skill-add");
  await page.fill("#cs-skill", nameB);
  await page.click("#cs-skill-add");
  await page.selectOption("#cs-match", "all");
  await page.selectOption("#cs-sort", "new");
  await page.waitForFunction(() => /sort=new/.test(location.search));
  await waitCards(page, "3,1");
  check("skills, all, new: query", lastList(api) === "stage=zenith&weapon=7&skill=" + SKILL_A + "&skill=" + SKILL_B + "&match=all&sort=new&page=0&size=20", lastList(api));
  check("skills show as chips", (await texts(page, "#cs-skill-chips .cs-skill-chip span")).join("|") === nameA + "|" + nameB);
  const linked = new URL(page.url()).search;
  check("address holds every filter", linked === "?stage=zenith&weapon=7&skill=" + SKILL_A + "&skill=" + SKILL_B + "&match=all&sort=new", linked);
  await page.fill("#cs-skill", "No such skill");
  await page.click("#cs-skill-add");
  check("unknown skill name is refused", (await text(page, "#cs-skill-note")).indexOf("No skill is called") !== -1 && (await page.$$("#cs-skill-chips li")).length === 2);
  await page.click('#cs-skill-chips .cs-skill-chip[data-skill="' + SKILL_A + '"] button');
  await page.waitForFunction(() => document.querySelectorAll("#cs-skill-chips li").length === 1);
  check("a skill chip's x removes the skill", /skill=2/.test(lastList(api)) && !/skill=1&/.test(lastList(api)), lastList(api));
  await page.click("#cs-clear");
  await waitCards(page, "1,3,2");
  check("clear: no filters left", new URL(page.url()).search === "" && lastList(api) === "sort=top&page=0&size=20", page.url() + " " + lastList(api));
  await page.close();

  // a linked, filtered address restores the form
  api = newApi();
  r = await open(browser, base + "/community-sets.html" + linked, api, 1280, false);
  page = r.page;
  await waitCards(page, "3,1");
  check("linked list: query from the address", lastList(api) === linked.slice(1) + "&page=0&size=20", lastList(api));
  check("linked list: form restored", (await page.$eval("#cs-stage", (s) => s.value)) === "zenith" && (await page.$eval("#cs-weapon", (s) => s.value)) === "7"
    && (await page.$eval("#cs-sort", (s) => s.value)) === "new" && (await page.$eval("#cs-match", (s) => s.value)) === "all"
    && (await page.$$("#cs-skill-chips li")).length === 2);
  await page.close();

  // a bad address value is dropped, not sent
  api = newApi();
  r = await open(browser, base + "/community-sets.html?band=%3Cx%3E&weapon=99&skill=abc&sort=evil&page=-3", api, 1280, false);
  page = r.page;
  await waitCards(page, "1,3,2");
  check("bad address values are dropped", lastList(api) === "sort=top&page=0&size=20", lastList(api));
  await page.close();

  // ---- paging ----
  api = newApi({ bigTotal: true });
  r = await open(browser, base + "/community-sets.html", api, 1280, false);
  page = r.page;
  await page.waitForSelector("#cs-pager:not([hidden])");
  check("pager: page 1 of 3, Previous off", (await text(page, "#cs-page-note")) === "Page 1 of 3" && (await page.$eval("#cs-prev", (b) => b.disabled)));
  await page.click("#cs-next");
  await page.waitForFunction(() => /Page 2 of 3/.test(document.getElementById("cs-page-note").textContent));
  check("pager: Next asks page=1 and the address says so", /page=1/.test(lastList(api)) && new URL(page.url()).search === "?page=1", lastList(api) + " " + page.url());
  await page.close();

  // ---- one set, signed out ----
  api = newApi();
  r = await open(browser, base + "/community-sets.html", api, 1280, false);
  page = r.page;
  await waitCards(page, "1,3,2");
  await page.click('.cs-card[data-id="1"] .cs-card-title a');
  await page.waitForSelector("#cs-detail-view .cs-detail");
  check("detail: address is ?id=1", new URL(page.url()).search === "?id=1", page.url());
  check("detail: title with markup is text", (await text(page, ".cs-detail-title")) === BAD_TITLE && (await page.$$(".cs-detail-title b, .cs-detail script")).length === 0 && !(await page.evaluate(() => window.__x)));
  check("detail: notes with markup are text, line break kept", (await text(page, ".cs-notes")) === BAD_NOTES && (await page.$$(".cs-notes img")).length === 0 && !(await page.evaluate(() => window.__y)));
  const rows = await texts(page, ".cs-pieces tbody tr");
  check("detail: pieces by name", rows.some((t) => t.indexOf("Weapon") === 0 && t.indexOf("Any Long Sword") !== -1)
    && rows.some((t) => t.indexOf("Head") === 0 && t.indexOf(head[1]) !== -1 && t.indexOf("Level 3") !== -1 && t.indexOf(deco[1]) !== -1)
    && rows.some((t) => t.indexOf("Chest") === 0 && t.indexOf(chest[1]) !== -1) && rows.some((t) => /^Arms\s*Nothing/.test(t)), rows.join(" | "));
  check("detail: skills by name", (await texts(page, ".cs-detail .cs-skills .badge")).join("|") === nameA + "|" + nameB);
  await shot(page, "cs-detail-signed-out");
  check("detail: 3 votes and the author", (await text(page, "#cs-detail-votes")) === "3 votes" && (await text(page, ".cs-detail .cs-foot")).indexOf("by Hunter <i>One</i>") === 0);
  check("detail: Open in the Set builder link holds the set", (await page.getAttribute(".cs-actions a.btn", "href")) === "/set-builder.html#s=" + Calc.encode(SET));
  check("detail: signed out says Sign in to upvote and to report, no buttons", (await texts(page, ".cs-actions a")).join("|").indexOf("Sign in to upvote") !== -1
    && (await texts(page, ".cs-actions a")).join("|").indexOf("Sign in to report") !== -1 && (await page.$$(".cs-vote, .cs-report")).length === 0);
  check("detail: sign-in link comes back to the set", (await page.$$eval(".cs-actions a", (a) => a.map((x) => x.getAttribute("href")))).indexOf("/?next=%2Fcommunity-sets.html%3Fid%3D1#login-form") !== -1);
  await page.click(".cs-share");
  check("detail: Share copies the API share link", (await page.evaluate(() => window.__copied)).join() === "https://api.hvmhfz.eclipseforge.xyz/share/set/1", String(await page.evaluate(() => window.__copied)));
  await page.setViewportSize({ width: 390, height: 800 });
  check("detail at 390 px: no sideways scroll", (await overflow(page)) <= 0, String(await overflow(page)));
  await page.goBack();
  await waitCards(page, "1,3,2");
  check("Back returns to the list", (await page.$eval("#cs-list-view", (n) => !n.hidden)) && (await page.$eval("#cs-detail-view", (n) => n.hidden)));
  check("no page errors (detail, signed out)", r.errors.length === 0, r.errors.join("; "));
  await page.goto(base + "/community-sets.html?id=999");
  await page.waitForSelector(".cs-missing");
  check("missing set: the API's message", (await text(page, ".cs-missing")) === "No such set.");
  await page.close();

  // ---- signed in: vote, report ----
  api = newApi();
  r = await open(browser, base + "/community-sets.html?id=1", api, 1280, true);
  page = r.page;
  await page.waitForSelector(".cs-vote");
  check("signed in: Upvote (3)", (await text(page, ".cs-vote")) === "Upvote (3)");
  check("signed in: the page asked with the sign-in header", api.calls.filter((c) => c.path === "/api/public/armor-sets/1").every((c) => /^Bearer /.test(c.auth)));
  await page.click(".cs-vote");
  await page.waitForFunction(() => document.querySelector(".cs-vote").textContent === "Remove vote (4)");
  check("vote: PUT, votes 4", api.calls.some((c) => c.method === "PUT" && c.path === "/api/account/armor-sets/1/vote") && (await text(page, "#cs-detail-votes")) === "4 votes");
  await page.click(".cs-vote");
  await page.waitForFunction(() => document.querySelector(".cs-vote").textContent === "Upvote (3)");
  check("remove vote: DELETE, votes 3", api.calls.some((c) => c.method === "DELETE" && c.path === "/api/account/armor-sets/1/vote") && (await text(page, "#cs-detail-votes")) === "3 votes");
  check("report form is closed at first", await page.$eval(".cs-report-form", (f) => f.hidden));
  await page.click(".cs-report");
  await page.click(".cs-report-form button[type=submit]");
  check("empty report reason is refused, nothing sent", (await text(page, ".cs-report-form .form-alert")).indexOf("Say what is wrong") !== -1
    && !api.calls.some((c) => c.path.endsWith("/report")));
  check("report box limit is the API's 300", (await page.getAttribute("#cs-reason", "maxlength")) === "300");
  await page.fill("#cs-reason", "Not a real <b>set</b>");
  await page.click(".cs-report-form button[type=submit]");
  await page.waitForFunction(() => /Thanks/.test(document.querySelector(".cs-message").textContent));
  const rep = api.calls.find((c) => c.path === "/api/account/armor-sets/1/report");
  check("report: POST with the reason", rep && rep.method === "POST" && rep.body.reason === "Not a real <b>set</b>");
  check("report: thanks shown, form closed", (await text(page, ".cs-message")) === "Thanks: staff will look at this set." && (await page.$eval(".cs-report-form", (f) => f.hidden)));
  await page.click(".cs-report");
  await page.fill("#cs-reason", "again");
  await page.click(".cs-report-form button[type=submit]");
  await page.waitForFunction(() => /already reported/.test(document.querySelector(".cs-report-form .form-alert").textContent));
  check("second report: the API's refusal as it is", (await text(page, ".cs-report-form .form-alert")) === "You already reported this set.");
  check("no page errors (vote, report)", r.errors.length === 0, r.errors.join("; "));
  await page.goto(base + "/community-sets.html?id=3");
  await page.waitForSelector(".cs-own");
  check("own set: no vote, no report", (await page.$$(".cs-vote, .cs-report")).length === 0 && (await text(page, ".cs-own")) === "This is your set.");
  await page.close();

  // ---- signed in: my sets ----
  api = newApi();
  r = await open(browser, base + "/community-sets.html", api, 1280, true);
  page = r.page;
  await page.waitForSelector("#cs-mine .cs-mine-item");
  check("my sets: both listed, hidden note with the reason as text", (await page.$$("#cs-mine .cs-mine-item")).length === 2
    && (await text(page, '.cs-mine-item[data-id="11"] .cs-hidden-note')) === "Hidden by staff: only you can see this set. Reason: Not a set <b>really</b>"
    && (await page.$$(".cs-hidden-note b")).length === 0);
  await shot(page, "cs-list-my-sets");
  check("my sets: markup in a title is text", (await text(page, '.cs-mine-item[data-id="10"] .cs-card-title')) === "My <u>bow</u> set" && (await page.$$(".cs-mine-item u")).length === 0);
  check("my sets: change the pieces in the builder", (await page.getAttribute('.cs-mine-item[data-id="10"] a.ghost-btn', "href")) === "/set-builder.html#s=" + Calc.encode(SET) + "&edit=10");
  check("signed in: no Sign in to post", (await text(page, "#cs-mine")).indexOf("Sign in to post") === -1);
  await page.click('.cs-mine-item[data-id="10"] .bui-actions button:first-child');
  await page.waitForSelector('.cs-mine-item[data-id="10"] .spf-form');
  check("edit form: values loaded, character list from the API", (await page.$eval('.cs-mine-item[data-id="10"] .spf-form input[type=text]', (i) => i.value)) === "My <u>bow</u> set"
    && (await page.$$eval('.cs-mine-item[data-id="10"] .spf-form select option', (o) => o.map((x) => x.textContent))).join("|").indexOf("Aldric|Brenna") !== -1
    && (await page.$eval('.cs-mine-item[data-id="10"] .spf-form input[type=checkbox]', (c) => c.checked)) === false);
  await page.fill('.cs-mine-item[data-id="10"] .spf-form input[type=text]', "");
  await page.click('.cs-mine-item[data-id="10"] .spf-form button[type=submit]');
  check("edit: an empty title is refused, nothing sent", !api.calls.some((c) => c.method === "PUT") && (await text(page, ".spf-form .form-alert")).indexOf("title") !== -1);
  await page.fill('.cs-mine-item[data-id="10"] .spf-form input[type=text]', "Better bow set");
  await page.fill('.cs-mine-item[data-id="10"] .spf-form textarea', "new notes");
  await page.selectOption('.cs-mine-item[data-id="10"] .spf-form select >> nth=0', "gr50");
  await page.selectOption('.cs-mine-item[data-id="10"] .spf-form select >> nth=1', "tower");
  await page.selectOption('.cs-mine-item[data-id="10"] .spf-form select >> nth=2', "6");
  await page.check('.cs-mine-item[data-id="10"] .spf-form input[type=checkbox]');
  await page.click('.cs-mine-item[data-id="10"] .spf-form button[type=submit]');
  await page.waitForSelector(".cs-message");
  const put = api.calls.find((c) => c.method === "PUT" && c.path === "/api/account/armor-sets/10");
  check("edit: PUT body", put && JSON.stringify(put.body) === JSON.stringify({ title: "Better bow set", notes: "new notes", set: SET, band: "gr50", stage: "tower",
    skills: [SKILL_A, SKILL_B], showAuthor: true, charId: 6 }), put && JSON.stringify(put.body));
  check("edit: saved, list shows the new title", (await text(page, ".cs-message")).indexOf("Saved") === 0 && (await text(page, '.cs-mine-item[data-id="10"] .cs-card-title')) === "Better bow set");
  await page.click('.cs-mine-item[data-id="10"] .cs-delete');
  check("delete: asks first, nothing sent yet", (await text(page, '.cs-mine-item[data-id="10"] .cs-confirm')).indexOf("Delete \"Better bow set\" for good?") !== -1
    && !api.calls.some((c) => c.method === "DELETE"));
  await page.click('.cs-mine-item[data-id="10"] .cs-confirm .ghost-btn');
  check("delete: Keep it cancels", (await page.$$(".cs-confirm")).length === 0 && !api.calls.some((c) => c.method === "DELETE"));
  await page.click('.cs-mine-item[data-id="10"] .cs-delete');
  await page.click('.cs-mine-item[data-id="10"] .cs-confirm .btn');
  await page.waitForFunction(() => document.querySelectorAll("#cs-mine .cs-mine-item").length === 1);
  check("delete: DELETE sent, set gone", api.calls.some((c) => c.method === "DELETE" && c.path === "/api/account/armor-sets/10") && (await text(page, ".cs-message")).indexOf("Deleted") === 0);
  await page.setViewportSize({ width: 390, height: 800 });
  check("list at 390 px: no sideways scroll", (await overflow(page)) <= 0, String(await overflow(page)));
  check("no page errors (my sets)", r.errors.length === 0, r.errors.join("; "));
  await page.close();


  // ---- posting from the Set builder ----
  const SET_HASH = "#s=" + Calc.encode(SET);
  // the active skill ids the builder shows for the set (those that work: not idle, negative or dropped)
  const shownSkills = (pg) => pg.$$eval("#sb-active .sb-skill:not(.is-idle):not(.is-negative):not(.is-dropped)", (n) => n.map((li) => Number(li.getAttribute("data-skill"))));

  api = newApi();
  r = await open(browser, base + "/set-builder.html" + SET_HASH, api, 1280, false);
  page = r.page;
  await page.waitForSelector("#sb-post-signin");
  check("builder, signed out: Sign in to post, no form", (await text(page, "#sb-post-signin")) === "Sign in to post" && (await page.$$("#sb-post .spf-form")).length === 0
    && (await page.getAttribute("#sb-post-signin", "href")).indexOf("/?next=%2Fset-builder.html%23s%3D") === 0 && (await page.getAttribute("#sb-post-signin", "href")).endsWith("#login-form"),
    await page.getAttribute("#sb-post-signin", "href"));
  check("builder, signed out: no sets or account call", !api.calls.some((c) => /armor-sets|\/api\/account/.test(c.path)), JSON.stringify(api.calls));
  await page.close();

  api = newApi();
  r = await open(browser, base + "/set-builder.html" + SET_HASH, api, 1280, true);
  page = r.page;
  await page.waitForSelector("#sb-post-open");
  check("builder: Post to Community Sets button", (await text(page, "#sb-post-open")) === "Post to Community Sets");
  await page.click("#sb-post-open");
  await page.waitForSelector("#sb-post .spf-form");
  check("post form: title and notes limits from the API's options", (await page.getAttribute("#sb-post .spf-form input[type=text]", "maxlength")) === "60"
    && (await page.getAttribute("#sb-post .spf-form textarea", "maxlength")) === "1000");
  await shot(page, "builder-post-form");
  check("post form: Show my hunter name is off by default", (await page.$eval("#sb-post .spf-form input[type=checkbox]", (c) => c.checked)) === false);
  check("post form: band from the character's rank (HR 120 = HR4), characters listed", (await page.$eval("#sb-post .spf-form select >> nth=0", (s) => s.value)).length > 0
    && (await page.$eval("#sb-post .spf-form select", (s) => s.value)) === "hr4"
    && (await page.$$eval("#sb-post .spf-form select:nth-of-type(1) option", (o) => o.length)) >= 1
    && (await page.$$eval("#sb-post .spf-form select option", (o) => o.map((x) => x.textContent))).join("|").indexOf("Aldric|Brenna") !== -1);
  await page.click("#sb-post .spf-form button[type=submit]");
  check("post: an empty title is refused, nothing sent", (await text(page, "#sb-post .form-alert")).indexOf("title") !== -1 && !api.calls.some((c) => c.method === "POST"));
  await page.fill("#sb-post .spf-form input[type=text]", "<b>My</b> post");
  await page.fill("#sb-post .spf-form textarea", "Notes <i>here</i>");
  await page.selectOption("#sb-post .spf-form select >> nth=1", "tower");
  api.postRefuse = { status: 429, message: "You are posting too fast. Try again in a minute." };
  await page.click("#sb-post .spf-form button[type=submit]");
  await page.waitForFunction(() => /too fast/.test(document.querySelector("#sb-post .form-alert").textContent));
  check("post: the API's refusal shown as it is, form kept", (await text(page, "#sb-post .form-alert")) === "You are posting too fast. Try again in a minute." && (await page.$$("#sb-post .spf-form")).length === 1);
  api.postRefuse = null;
  await page.click("#sb-post .spf-form button[type=submit]");
  await page.waitForSelector("#sb-post-done");
  const posted = api.calls.filter((c) => c.method === "POST" && c.path === "/api/account/armor-sets").pop();
  const wantSet = Calc.normalize(SET);
  check("post: POST body", posted && JSON.stringify(Object.assign({}, posted.body, { skills: null })) === JSON.stringify({ title: "<b>My</b> post", notes: "Notes <i>here</i>", set: wantSet,
    band: "hr4", stage: "tower", skills: null, showAuthor: false, charId: 5 }), posted && JSON.stringify(posted.body));
  check("post: skills = the active skills the page shows", posted && JSON.stringify(posted.body.skills) === JSON.stringify(await shownSkills(page)), posted && JSON.stringify(posted.body.skills) + " vs " + JSON.stringify(await shownSkills(page)));
  check("post: sent with the sign-in header", /^Bearer /.test(posted.auth));
  check("post: success links to the set on the community page", (await text(page, "#sb-post-done")) === "Posted. See the set on Community sets." && (await page.getAttribute("#sb-post-done a", "href")) === "/community-sets.html?id=77");
  check("post: the form is gone, the button is back", (await page.$$("#sb-post .spf-form")).length === 0 && (await page.$$("#sb-post-open")).length === 1);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click("#sb-post-open");
  await page.waitForSelector("#sb-post .spf-form");
  check("builder at 390 px with the form open: no sideways scroll", (await overflow(page)) <= 0, String(await overflow(page)));
  check("no page errors (builder post)", r.errors.length === 0, r.errors.join("; "));
  await page.close();

  // an empty set is not posted
  api = newApi();
  r = await open(browser, base + "/set-builder.html", api, 1280, true);
  page = r.page;
  await page.waitForSelector("#sb-post-open");
  await page.click("#sb-post-open");
  await page.waitForSelector("#sb-post .spf-form");
  await page.fill("#sb-post .spf-form input[type=text]", "Nothing");
  await page.click("#sb-post .spf-form button[type=submit]");
  await page.waitForFunction(() => /Pick a weapon class/.test(document.querySelector("#sb-post .form-alert").textContent));
  check("a set without a weapon class is refused here (the API needs one), nothing sent", !api.calls.some((c) => c.method === "POST"));
  await page.close();

  // a weapon class alone (any weapon, no armour) is still an empty set, as the API says
  api = newApi();
  const classOnly = Buffer.from(JSON.stringify({ v: 1, weapon: [7, 0, [], []], armour: [], cuffs: [] }), "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  r = await open(browser, base + "/set-builder.html#s=" + classOnly, api, 1280, true);
  page = r.page;
  await page.waitForSelector("#sb-post-open");
  await page.click("#sb-post-open");
  await page.waitForSelector("#sb-post .spf-form");
  await page.fill("#sb-post .spf-form input[type=text]", "Nothing");
  await page.click("#sb-post .spf-form button[type=submit]");
  await page.waitForFunction(() => /nothing to post/.test(document.querySelector("#sb-post .form-alert").textContent));
  check("an empty set is refused here, nothing sent", !api.calls.some((c) => c.method === "POST"));
  await page.close();

  // edit mode: &edit=<id> loads the player's set's details and sends a PUT
  api = newApi();
  r = await open(browser, base + "/set-builder.html" + SET_HASH + "&edit=10", api, 1280, true);
  page = r.page;
  await page.waitForSelector("#sb-post .spf-form");
  check("edit mode: the form opened on the set's details", (await page.$eval("#sb-post .spf-form input[type=text]", (i) => i.value)) === "My <u>bow</u> set"
    && (await page.$eval("#sb-post .spf-form textarea", (i) => i.value)) === "mine" && (await text(page, "#sb-post .spf-form button[type=submit]")) === "Save changes"
    && (await text(page, "#sb-post")).indexOf("Changing your set \"My <u>bow</u> set\"") !== -1);
  check("edit mode: the address keeps &edit after the set changes", (await page.evaluate(() => location.hash)).endsWith("&edit=10"));
  await page.fill("#sb-post .spf-form input[type=text]", "Edited");
  await page.click("#sb-post .spf-form button[type=submit]");
  await page.waitForSelector("#sb-post-done");
  const put2 = api.calls.find((c) => c.method === "PUT" && c.path === "/api/account/armor-sets/10");
  check("edit mode: PUT, not POST, with the details and the current set", put2 && !api.calls.some((c) => c.method === "POST")
    && put2.body.title === "Edited" && put2.body.notes === "mine" && put2.body.charId === 5 && put2.body.showAuthor === false && put2.body.band === "hr4"
    && JSON.stringify(put2.body.set) === JSON.stringify(wantSet), put2 && JSON.stringify(put2.body));
  check("edit mode: Saved, link to the set", (await text(page, "#sb-post-done")) === "Saved. See the set on Community sets." && (await page.getAttribute("#sb-post-done a", "href")) === "/community-sets.html?id=10");
  await page.close();

  // an id that is not the player's: a note, and posting a new set
  api = newApi();
  r = await open(browser, base + "/set-builder.html" + SET_HASH + "&edit=999", api, 1280, true);
  page = r.page;
  await page.waitForFunction(() => document.querySelector("#sb-post .form-alert"));
  check("edit of a set that is not yours: says so, edit dropped from the address, posts new", (await text(page, "#sb-post .form-alert")).indexOf("not one of your sets") !== -1
    && (await page.evaluate(() => location.hash.indexOf("edit"))) === -1 && (await text(page, "#sb-post-open")) === "Post to Community Sets");
  await page.close();

  // edit link, signed out: the sign-in link comes back with the set and the edit id
  api = newApi();
  r = await open(browser, base + "/set-builder.html" + SET_HASH + "&edit=10", api, 1280, false);
  page = r.page;
  await page.waitForSelector("#sb-post-signin");
  check("edit link signed out: sign-in comes back with &edit", decodeURIComponent(await page.getAttribute("#sb-post-signin", "href")).indexOf("&edit=10") !== -1);
  await page.close();

  // ---- the API answers an error for the list ----
  api = newApi();
  r = await open(browser, base + "/community-sets.html?stage=road", api, 1280, false);
  page = r.page;
  await waitCards(page, "");
  check("a stage with no sets says so", (await text(page, "#cs-list")).indexOf("No sets match these filters yet") !== -1);
  await page.close();

  await browser.close();
  server.close();
  if (failures.length) {
    console.log("FAIL (" + failures.length + ")");
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log("community sets OK");
}

run().catch((e) => { console.log("FAIL " + e.stack); process.exit(1); });
