#!/usr/bin/env node
/* Checks the sub-tabs (js/subtabs.js) on the account page in headless Chromium against a fake API:

   - roles: one tablist, 11 tabs with aria-controls, each panel a tabpanel labelled by its tab; one panel shows at a
     time; only the selected tab is in the Tab order (roving tabindex);
   - no hash and nothing remembered: Overview;
   - a click opens the tab and puts #name in the address; Back and Forward step through the tabs, Back to the entry
     without a hash shows the tab the page opened with;
   - the last tab is remembered per page (localStorage "hv.subtabs.account") and opens on the next visit without a hash;
   - every hash that worked before still works (#overview #characters #hunts #guild #quests #backups #transfer #account,
     #storage and #details to Characters), and the short ones (#qol #options #settings to Game options, #patch to
     Client patch, #diag to Diagnostics, #discord to the Discord box on Overview);
   - nested anchors: #game-options-keys opens Game options, opens the closed Keys fold and scrolls it into view below
     the sticky bar; #diag-drop opens Diagnostics and scrolls to the drop box; a hash change in the page does the same;
     the skip link (#content) leaves the tab alone;
   - keyboard: ArrowRight/ArrowLeft move and open (wrapping), Home and End go to the first and last; focus follows;
     no history entry per key press;
   - the bar sticks under the site bar while a long tab scrolls (1280px), and a tab change made from below the bar
     brings the new panel's top back under it;
   - lazy panels: GET /api/account/qol only once Game options opens, GET /api/account/patch-channel only once Client
     patch opens;
   - 375px: the row gives way to a "Jump to" select (11 options, current one chosen), choosing one opens it and puts
     the hash in the address; the bar sticks under the site bar; nothing is wider than the screen;
   - no page errors.

   With SHOTS=<folder> it also saves screenshots of every tab at 375 and 1280 px (account-<tab>-<width>.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-subtabs.js

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

const TABS = ["overview", "characters", "hunts", "guild", "quests", "backups", "transfer", "game-options", "client-patch", "diagnostics", "account"];
const CHARACTERS = [
  { id: 10, name: "Aldra", hr: 999, gr: 120, weaponType: "Long Sword", female: true, lastLogin: "2026-11-02T10:00:00Z", guildName: "Test Guild", guildRank: "Leader" },
  { id: 11, name: "Bexo", hr: 7, gr: 0, weaponType: "Great Sword", female: false, lastLogin: null }
];
const QOL = {
  features: [
    { id: "trueRaw", bit: 0, name: "True raw attack", description: "Shows the true raw.", enabled: false, revealsHiddenInfo: false, minPatch: "1.20" },
    { id: "quickRetire", bit: 3, name: "Quick retire", description: "Leave a quest at once.", enabled: false, revealsHiddenInfo: false, minPatch: "1.21" },
    { id: "iframeViewer", bit: 5, name: "Iframe viewer", description: "Draws bars.", enabled: false, revealsHiddenInfo: true, minPatch: "1.21" }
  ],
  flags: 0, takesEffect: "next login",
  keys: { retireKey: "Ctrl+R", retireOnDeath: "off", retireCarts: 1, skipWaitKey: null, talkKeys: [null, null, null, null, null] },
  viewer: { iframeBar: true, iframeCount: false, hitstopBar: true, hitIndicator: false, position: "top", size: "normal" }
};
const PATCH = { channel: "stable", slot: null, eligible: true, confirmationRequired: false, slotsAvailable: true, slots: [],
  characters: [{ name: "Aldra", clientPatch: 21, clientPatchName: "v1.21", clientPatchSeenAt: "2026-11-10T10:00:00Z" }], currentPatch: 21 };

async function open(browser, width, hash, opts) {
  const o = opts || {};
  const ctx = o.ctx || await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 800 }, locale: "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  const gets = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (!o.ctx) await ctx.addInitScript((t) => {
    localStorage.setItem("hvmhfz.token", t);
    localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "accept", at: new Date().toISOString() }));
  }, TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    gets.push(p);
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p === "/api/account") return reply(200, { username: "tester", roles: ["ROLE_USER"], characters: 2, lastLogin: null, discordLinked: true });
    if (p === "/api/account/characters") return reply(200, CHARACTERS);
    if (p === "/api/account/discord") return reply(200, { linked: true });
    if (p === "/api/account/qol") return reply(200, QOL);
    if (p === "/api/account/patch-channel") return reply(200, PATCH);
    if (p.endsWith("/distributions")) return reply(200, { global: [], targeted: [] });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, []);
  });
  await page.goto(server.base + "/account.html" + (hash || ""));
  await page.waitForTimeout(400);
  return { ctx, page, errors, gets };
}

const selected = (page) => page.$$eval('[role="tab"][aria-selected="true"]', (n) => n.map((t) => t.getAttribute("href").slice(1)));
const shownPanels = (page) => page.$$eval('[role="tabpanel"]', (n) => n.filter((p) => !p.hidden).map((p) => p.id.replace(/^panel-/, "")));
const hash = (page) => page.evaluate(() => location.hash);
const state = async (page) => J({ tab: await selected(page), panels: await shownPanels(page) });
const on = (name) => J({ tab: [name], panels: [name] });

async function run(browser) {
  // ---- roles, default tab, clicks, Back/Forward, remembered tab (1280) ----
  const a = await open(browser, 1280, "");
  const page = a.page;
  const roles = await page.evaluate(() => {
    const list = document.querySelectorAll('[role="tablist"]');
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    return {
      lists: list.length,
      tabs: tabs.map((t) => t.getAttribute("href").slice(1)),
      paired: tabs.every((t) => { const p = document.getElementById(t.getAttribute("aria-controls")); return p && p.getAttribute("role") === "tabpanel" && p.getAttribute("aria-labelledby") === t.id; }),
      tabindex: tabs.map((t) => t.getAttribute("tabindex"))
    };
  });
  check("one tablist", roles.lists === 1, roles.lists);
  check("the 11 tabs in order", J(roles.tabs) === J(TABS), J(roles.tabs));
  check("each tab controls a tabpanel labelled by it", roles.paired);
  check("roving tabindex: only Overview is 0", J(roles.tabindex) === J(["0"].concat(Array(10).fill("-1"))), J(roles.tabindex));
  check("no hash: Overview", (await state(page)) === on("overview"), await state(page));
  check("lazy: no qol or patch-channel GET on Overview", !a.gets.includes("/api/account/qol") && !a.gets.includes("/api/account/patch-channel"), J(a.gets));

  const before = await page.evaluate(() => history.length);
  await page.click("#tab-game-options");
  await page.waitForSelector("#qol-list input", { timeout: 5000 }).catch(() => {});
  check("click: Game options and #game-options", (await state(page)) === on("game-options") && (await hash(page)) === "#game-options", await state(page));
  check("lazy: qol loaded once Game options opened", a.gets.includes("/api/account/qol"), J(a.gets));
  check("the Road and Game options boxes are on Game options", await page.isVisible("#road-pref-panel") && await page.isVisible("#qol-panel"));
  check("Keys and Viewer options are closed folds", await page.$$eval("#qol-keys, #qol-viewer", (n) => n.length === 2 && n.every((d) => d.tagName === "DETAILS" && !d.open && !d.hidden)));
  check("click adds a history entry", (await page.evaluate(() => history.length)) === before + 1);
  check("remembered", (await page.evaluate(() => localStorage.getItem("hv.subtabs.account"))) === "game-options");
  await page.click("#tab-client-patch");
  await page.waitForSelector("#patch-channel-panel:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("lazy: patch channel loaded once Client patch opened", a.gets.includes("/api/account/patch-channel") && await page.isVisible("#patch-channel-panel"), J(a.gets));
  await page.click("#tab-diagnostics");
  check("click: Diagnostics", (await state(page)) === on("diagnostics") && (await hash(page)) === "#diagnostics");
  await page.goBack();
  await page.waitForTimeout(100);
  check("Back: Client patch", (await state(page)) === on("client-patch") && (await hash(page)) === "#client-patch", await state(page));
  await page.goBack();
  await page.goBack();
  await page.waitForTimeout(100);
  check("Back to the entry without a hash: Overview", (await state(page)) === on("overview") && (await hash(page)) === "", await state(page));
  await page.goForward();
  await page.waitForTimeout(100);
  check("Forward: Game options", (await state(page)) === on("game-options"), await state(page));
  await page.evaluate(() => { location.hash = "#diag"; });
  await page.waitForTimeout(100);
  check("hash change in the page (#diag): Diagnostics", (await state(page)) === on("diagnostics"), await state(page));
  await page.evaluate(() => { location.hash = "#content"; });
  await page.waitForTimeout(100);
  check("skip link (#content) leaves the tab alone", (await state(page)) === on("diagnostics"), await state(page));
  await page.goto(server.base + "/account.html");
  await page.waitForTimeout(300);
  check("next visit without a hash: the last tab (Diagnostics)", (await state(page)) === on("diagnostics"), await state(page));

  // ---- keyboard ----
  await page.focus("#tab-diagnostics");
  const h0 = await page.evaluate(() => history.length);
  await page.keyboard.press("ArrowRight");
  check("ArrowRight: Account, focused", (await state(page)) === on("account") && (await page.evaluate(() => document.activeElement.id)) === "tab-account", await state(page));
  await page.keyboard.press("ArrowRight");
  check("ArrowRight wraps to Overview", (await state(page)) === on("overview"), await state(page));
  await page.keyboard.press("ArrowLeft");
  check("ArrowLeft wraps to Account", (await state(page)) === on("account"), await state(page));
  await page.keyboard.press("Home");
  check("Home: Overview", (await state(page)) === on("overview") && (await hash(page)) === "#overview", await state(page));
  await page.keyboard.press("End");
  check("End: Account, focused", (await state(page)) === on("account") && (await page.evaluate(() => document.activeElement.id)) === "tab-account", await state(page));
  check("keys add no history entries", (await page.evaluate(() => history.length)) === h0);
  check("roving tabindex follows", J(await page.$$eval('[role="tab"][tabindex="0"]', (n) => n.map((t) => t.id))) === J(["tab-account"]));

  // ---- sticky bar (1280) ----
  await page.click("#tab-game-options");
  await page.waitForSelector("#qol-list input", { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => { document.querySelectorAll("#qol-panel details").forEach((d) => { d.open = true; }); document.documentElement.style.scrollBehavior = "auto"; });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(100);
  const navH = await page.evaluate(() => document.querySelector(".site-nav").getBoundingClientRect().height);
  const barTop = await page.evaluate(() => document.querySelector(".subtabs-bar").getBoundingClientRect().top);
  check("1280: the bar sticks under the site bar", Math.abs(barTop - navH) <= 1, barTop + " vs " + navH);
  await page.click("#tab-account");
  await page.waitForTimeout(100);
  const top = await page.evaluate(() => {
    const bar = document.querySelector(".subtabs-bar").getBoundingClientRect();
    return { bar: bar.top, panel: document.getElementById("panel-account").getBoundingClientRect().top, barBottom: bar.bottom };
  });
  check("tab change from below: the panel's top is back under the bar", top.panel >= top.barBottom - 1 && top.panel <= top.barBottom + 60, J(top));
  check("1280: no page errors", !a.errors.length, a.errors.join("; "));
  await a.ctx.close();

  // ---- every old and short hash, in a fresh page each ----
  const hashes = { overview: "overview", characters: "characters", hunts: "hunts", guild: "guild", quests: "quests", backups: "backups",
    transfer: "transfer", account: "account", storage: "characters", details: "characters", qol: "game-options", options: "game-options",
    settings: "game-options", "game-options": "game-options", patch: "client-patch", "client-patch": "client-patch", diag: "diagnostics",
    diagnostics: "diagnostics", discord: "overview" };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  await ctx.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  for (const [h, tab] of Object.entries(hashes)) {
    const r = await open(browser, 1280, "#" + h, { ctx });
    check("#" + h + " opens " + tab, (await state(r.page)) === on(tab), await state(r.page));
    if (r.errors.length) check("#" + h + ": no page errors", false, r.errors.join("; "));
    await r.page.close();
  }
  // nested anchors
  for (const [h, tab, el] of [["game-options-keys", "game-options", "#qol-keys"], ["qol-keys", "game-options", "#qol-keys"], ["diag-drop", "diagnostics", "#diag-drop"]]) {
    const r = await open(browser, 1280, "#" + h, { ctx });
    await r.page.waitForTimeout(700);
    const pos = await r.page.evaluate((sel) => {
      const node = document.querySelector(sel);
      const bar = document.querySelector(".subtabs-bar").getBoundingClientRect();
      return { open: node.tagName !== "DETAILS" || node.open, top: node.getBoundingClientRect().top, barBottom: bar.bottom, vh: innerHeight };
    }, el);
    check("#" + h + " opens " + tab, (await state(r.page)) === on(tab), await state(r.page));
    check("#" + h + " opens its fold and scrolls it into view below the bar", pos.open && pos.top >= pos.barBottom - 1 && pos.top < pos.vh - 40, J(pos));
    await r.page.close();
  }
  await ctx.close();

  // ---- phone ----
  const m = await open(browser, 375, "#hunts");
  const jump = await m.page.evaluate(() => {
    const s = document.querySelector(".subtabs-jump select");
    return s && { visible: s.offsetParent !== null, options: s.options.length, value: s.value, rowShown: document.querySelector(".subtabs-bar .tabs").offsetParent !== null };
  });
  check("375: Jump to select instead of the row", jump && jump.visible && !jump.rowShown, J(jump));
  check("375: 11 options, Hunts chosen", jump && jump.options === 11 && jump.value === "hunts", J(jump));
  await m.page.selectOption(".subtabs-jump select", "diagnostics");
  await m.page.waitForTimeout(100);
  check("375: choosing Diagnostics opens it", (await state(m.page)) === on("diagnostics") && (await hash(m.page)) === "#diagnostics", await state(m.page));
  await m.page.goBack();
  await m.page.waitForTimeout(100);
  check("375: Back to Hunts, the select follows", (await state(m.page)) === on("hunts") && (await m.page.$eval(".subtabs-jump select", (s) => s.value)) === "hunts");
  await m.page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });
  await m.page.selectOption(".subtabs-jump select", "diagnostics");
  await m.page.evaluate(() => window.scrollTo(0, 700));
  await m.page.waitForTimeout(100);
  const mBar = await m.page.evaluate(() => ({ bar: document.querySelector(".subtabs-bar").getBoundingClientRect().top, nav: document.querySelector(".site-nav").getBoundingClientRect().bottom }));
  check("375: the bar sticks under the site bar", Math.abs(mBar.bar - mBar.nav) <= 1, J(mBar));
  for (const t of TABS) {
    await m.page.selectOption(".subtabs-jump select", t);
    await m.page.waitForTimeout(t === "game-options" || t === "client-patch" ? 400 : 60);
    const wide = await m.page.evaluate(() => document.documentElement.scrollWidth);
    if (wide > 375) check("375: " + t + " fits the screen", false, wide + "px");
  }
  check("375: no page errors", !m.errors.length, m.errors.join("; "));
  await m.ctx.close();

  // ---- screenshots ----
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    for (const width of [375, 1280]) {
      for (const t of TABS) {
        const s = await open(browser, width, "#" + t);
        await s.page.waitForTimeout(500);
        await s.page.screenshot({ path: path.join(process.env.SHOTS, "account-" + t + "-" + width + ".png"), fullPage: true });
        await s.ctx.close();
      }
    }
  }
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await run(browser);
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("FAIL");
    failures.forEach((f) => console.log("- " + f));
    process.exit(1);
  }
  console.log("sub-tabs OK");
})();
