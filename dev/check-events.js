#!/usr/bin/env node
/* Checks the Events page's tap-to-open cards (events.html, js/events.js, js/event-info.js) in headless Chromium
   against a fake API:

   - every card has a button (aria-expanded, aria-controls) that opens its part: what it is, how to take part,
     what you get, when (with the card's live text), tips and links; a second press closes it;
   - the keyboard works: Tab reaches the button, Enter and Space open and close, Escape inside closes;
   - a tap anywhere on a card opens it, while its own link still works;
   - with the live schedules, with no schedules (404 or empty) and with the whole API missing, every card is
     there and opens, and the page has no errors;
   - at 375 px: tap target at least 44 px, no sideways scroll with every card open;
   - js/event-info.js: one entry per card key, the sections filled, no internal words, every link target and
     anchor exists in this repo.

   Screenshots go to dev-shots/ (events-open-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-events.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Events = require("../js/events.js");

const root = path.join(__dirname, "..");
const shots = path.join(root, "dev-shots");
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

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

const KEYS = ["diva", "mezfes", "campaigns", "speedrun_cup", "vs_bracket", "festival", "raviente", "caravan_rankings", "sky_corridor",
  "road_vote", "event_quests"];
const SECTIONS = ["what", "how", "gets", "when", "tips", "links"];

/* ---- the fake API ---- */

const NOW = "2026-11-06T00:00:00Z";
const row = (event, phase, extra) => ({ event, cycle: 1, phase, startsAt: "2026-01-05T15:00:00Z", endsAt: "2026-11-12T15:00:00Z",
  phaseEndsAt: "2026-11-11T15:00:00Z", stale: false, updatedAt: NOW, extra });
const CURRENT = { now: NOW, festa: null, events: [
  row("speedrun_cup", "open", { quest: { title: "Speedrun Cup: Espinas" } }),
  row("vs_bracket", "signup", { signup_ends_at: "2026-11-09T15:00:00Z", entrants: 3 }),
  row("diva", "personal", {}),
  row("campaigns", "open", { campaigns: [{ title: "Weekly Supply Drop" }] })
] };
const POOL = { questCount: 1, quests: [{ questId: 58043, questType: 48, maxPlayers: 4, startTime: "2024-03-08T00:00:00Z" }],
  prizes: [{ tier: 1, type: "Item", soulsReq: 100, itemName: "Potion", quantity: 2 }] };

// api: { pool, current, festa } = bodies, undefined for a 404 (the default for what is not given).
function answer(api, p) {
  if (p === "/api/public/events") return api.pool;
  if (p === "/api/public/festa") return api.festa;
  if (p === "/api/public/events/current") return api.current;
  return undefined;
}

async function open(browser, url, api, width, touch) {
  const context = await browser.newContext({ viewport: { width: width || 1280, height: 900 }, hasTouch: !!touch });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const body = answer(api, new URL(route.request().url()).pathname);
    route.fulfill({ status: body === undefined ? 404 : 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body === undefined ? { message: "Not Found" } : body) });
  });
  await page.goto(url);
  await page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  return { page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const toggles = (page) => page.$$("#events-root .event-tile .event-toggle");
const expanded = (button) => button.getAttribute("aria-expanded");
const panelOf = (page, button) => button.getAttribute("aria-controls").then((id) => page.$("#" + id));

/* Every card on the page: it opens with its sections, and closes again. */
async function everyCardOpens(page, label) {
  const buttons = await toggles(page);
  check(`${label}: a button on every card`, buttons.length === KEYS.length, String(buttons.length));
  for (const button of buttons) {
    const name = (await button.textContent()).trim();
    const where = `${label}: ${name}`;
    check(`${where}: starts closed`, (await expanded(button)) === "false");
    const panel = await panelOf(page, button);
    check(`${where}: aria-controls points to a panel`, !!panel);
    if (!panel) continue;
    check(`${where}: panel hidden at first`, !(await panel.isVisible()));
    await button.click();
    check(`${where}: opens`, (await expanded(button)) === "true" && (await panel.isVisible()));
    const have = await panel.$$eval(".event-sec", (ns) => ns.map((n) => n.getAttribute("data-sec")));
    check(`${where}: sections`, SECTIONS.every((s) => have.includes(s)), have.join());
    const now = await panel.$$eval(".event-now", (ns) => ns.map((n) => n.textContent));
    check(`${where}: right now line`, now.length === 1 && now[0].length > 20, now.join());
    check(`${where}: links`, (await panel.$$eval(".event-links a", (as) => as.length)) >= 1);
    await button.click();
    check(`${where}: closes`, (await expanded(button)) === "false" && !(await panel.isVisible()));
  }
}

async function openCards(browser, base) {
  // Live schedules, the full API.
  let r = await open(browser, base + "/events.html", { pool: POOL, current: CURRENT, festa: { festival: { phase: "souls" } } });
  await everyCardOpens(r.page, "live");
  const cup = (await r.page.$$eval("#events-root .event-tile", (ns) => ns.map((n) => n.textContent))).find((t) => t.includes("Speedrun Cup")) || "";
  check("live: cup card keeps its live text", cup.includes("Open: clear the quest") && cup.includes("Speedrun Cup: Espinas"));
  const cupButton = (await toggles(r.page))[4];
  await cupButton.click();
  const when = await r.page.$eval("#event-more-speedrun_cup [data-sec=when]", (n) => n.textContent);
  check("live: when has the live dates", when.includes("Open: clear the quest") && when.includes("Clears count until"), when);
  check("live: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.context().close();

  // No schedules: the static cards.
  for (const [label, current] of [["404", undefined], ["empty list", { now: NOW, festa: null, events: [] }]]) {
    r = await open(browser, base + "/events.html", { pool: POOL, current }, 1280);
    await everyCardOpens(r.page, "schedules " + label);
    check(`schedules ${label}: errors`, r.errors.length === 0, r.errors.join("; "));
    await r.page.context().close();
  }

  // The whole API missing, and an API that answers with nothing.
  for (const [label, api] of [["API missing", {}], ["API empty", { pool: {}, current: {}, festa: {} }],
    ["pool empty", { pool: { questCount: 0, quests: [], prizes: [] }, current: null }]]) {
    r = await open(browser, base + "/events.html", api, 1280);
    await everyCardOpens(r.page, label);
    check(`${label}: errors`, r.errors.length === 0, r.errors.join("; "));
    if (label === "API missing") {
      const notes = await r.page.$$eval("#events-root .panel-note", (ns) => ns.map((n) => n.textContent).join("|"));
      check("API missing: pool note", notes.includes("could not be loaded"), notes);
      await shot(r.page, "events-open-api-missing-1280.png");
    }
    await r.page.context().close();
  }
}

async function keyboard(browser, base) {
  const r = await open(browser, base + "/events.html", { pool: POOL, current: CURRENT });
  const page = r.page;
  // Tab reaches the first card's button (the skip link and the menu come first).
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("event-toggle"));
  }
  check("keyboard: Tab reaches a card button", reached);
  const first = (await toggles(page))[0];
  check("keyboard: the first button has the focus", await first.evaluate((n) => n === document.activeElement));
  await page.keyboard.press("Enter");
  check("keyboard: Enter opens", (await expanded(first)) === "true");
  await page.keyboard.press("Enter");
  check("keyboard: Enter closes", (await expanded(first)) === "false");
  await page.keyboard.press("Space");
  check("keyboard: Space opens", (await expanded(first)) === "true");
  await page.keyboard.press("Space");
  check("keyboard: Space closes", (await expanded(first)) === "false");
  // Escape inside the opened part closes it and gives the focus back to the button.
  await page.keyboard.press("Enter");
  await page.focus("#event-more-diva .event-links a");
  await page.keyboard.press("Escape");
  check("keyboard: Escape closes", (await expanded(first)) === "false");
  check("keyboard: Escape returns the focus", await first.evaluate((n) => n === document.activeElement));
  check("keyboard: focus is visible", await first.evaluate((n) => {
    const s = getComputedStyle(n, "::after");
    return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
  }));
  // Tab goes on to the next card's button (a card's link is in between when it has one).
  await page.keyboard.press("Tab");
  check("keyboard: Tab moves on", await page.evaluate(() => document.activeElement.classList.contains("event-toggle")
    || document.activeElement.closest(".event-tile") !== null));
  check("keyboard: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.context().close();
}

async function mobile(browser, base) {
  const r = await open(browser, base + "/events.html", { pool: POOL, current: CURRENT }, 375, true);
  const page = r.page;
  const buttons = await toggles(page);
  for (const button of buttons) {
    const box = await button.boundingBox();
    check("375: toggle is at least 44 px high", box && box.height >= 44, JSON.stringify(box));
  }
  check("375: no sideways scroll", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);

  // A tap on the card's text (not on the button) opens it.
  const card = (await page.$$("#events-root .event-tile"))[0];
  const text = await card.$(".tile-meta");
  const tb = await text.boundingBox();
  const at = [tb.x + 20, tb.y + tb.height / 2];
  await page.touchscreen.tap(at[0], at[1]);
  check("375: a tap on the card text opens it", (await expanded(buttons[0])) === "true");
  await page.touchscreen.tap(at[0], at[1]);
  check("375: a second tap closes it", (await expanded(buttons[0])) === "false");

  // The card's own link is above the covering button: the point at its centre is the link.
  const link = await page.$("#events-root .event-tile .event-link a");
  await link.scrollIntoViewIfNeeded();
  const box = await link.boundingBox();
  const top = await page.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); return n && n.tagName; },
    [box.x + box.width / 2, box.y + box.height / 2]);
  check("375: the card link stays clickable", top === "A", String(top));
  check("375: card link is at least 44 px high", box.height >= 44, String(box.height));

  // Everything open at once.
  for (const button of buttons) await button.tap();
  check("375: all open", (await Promise.all(buttons.map(expanded))).every((v) => v === "true"));
  check("375: no sideways scroll with every card open", (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0,
    String(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)));
  const wide = await page.$$eval("#events-root .event-more", (ns) => ns.filter((n) => n.scrollWidth > n.clientWidth + 1).length);
  check("375: no panel wider than its card", wide === 0, String(wide));
  const small = await page.$$eval("#events-root .event-more a", (as) => as.filter((a) => a.getBoundingClientRect().height < 44).length);
  check("375: every link in a panel is a 44 px target", small === 0, String(small));
  await shot(page, "events-open-375.png");
  check("375: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.context().close();

  // Desktop: one open card spans the row.
  const d = await open(browser, base + "/events.html", { pool: POOL, current: CURRENT }, 1280);
  const b0 = (await toggles(d.page))[0];
  await b0.click();
  const spans = await d.page.$eval("#events-root .event-tile.is-open", (n) => n.getBoundingClientRect().width > n.parentElement.getBoundingClientRect().width * 0.9);
  check("1280: an open card spans the row", spans);
  check("1280: no sideways scroll", (await d.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await shot(d.page, "events-open-1280.png");
  await d.page.context().close();
}

/* ---- the text in js/event-info.js ---- */

function info() {
  const INFO = Events.info;
  check("info: one entry per card key", KEYS.every((k) => INFO[k]) && Object.keys(INFO).length === KEYS.length, Object.keys(INFO).join());
  const staticKeys = Events.staticCards(null, Date.now()).map((c) => c.key);
  check("info: static cards have the keys", staticKeys.join() === KEYS.join(), staticKeys.join());
  const apiKeys = Events.eventCards({ events: [{ event: "diva", phase: "personal", extra: {} }] }, null, Date.now()).map((c) => c.key);
  check("info: every card of an API answer has a key with text", apiKeys.every((k) => INFO[k]), apiKeys.join());
  const internal = /0x[0-9a-f]{2,}|erupe|api\b|json|sql|\bid\b|_id|config|database|event_/i;
  for (const key of KEYS) {
    const e = INFO[key];
    check(`info ${key}: what is 1-2 sentences`, typeof e.what === "string" && (e.what.match(/[.!?](\s|$)/g) || []).length <= 3 && e.what.length > 40);
    check(`info ${key}: steps`, Array.isArray(e.steps) && e.steps.length >= 2);
    check(`info ${key}: gets`, Array.isArray(e.gets) && e.gets.length >= 1);
    check(`info ${key}: when`, typeof e.when === "string" && e.when.length > 20);
    check(`info ${key}: tips`, Array.isArray(e.tips) && e.tips.length >= 1);
    check(`info ${key}: links`, Array.isArray(e.links) && e.links.length >= 1);
    const all = [e.what, e.when].concat(e.steps || [], e.gets || [], e.tips || [], (e.links || []).map((l) => l[0])).join("\n");
    const bad = all.match(internal);
    check(`info ${key}: no internal words`, !bad, bad && bad[0]);
    for (const [text, href] of e.links || []) {
      if (/^https?:/.test(href)) continue;
      const [file, anchor] = href.split("#");
      const target = path.join(root, file === "" ? "events.html" : file.replace(/^\//, ""));
      const exists = fs.existsSync(target) && fs.statSync(target).isFile();
      check(`info ${key}: link ${href} exists`, exists);
      if (exists && anchor) {
        let source = fs.readFileSync(target, "utf8");
        if (file === "") source += fs.readFileSync(path.join(root, "js/events.js"), "utf8");
        check(`info ${key}: anchor #${anchor} exists`, source.includes(`id="${anchor}"`) || source.includes(`.id = "${anchor}"`), href);
      }
    }
  }
  const tournamentsLinks = ["speedrun_cup", "vs_bracket"].every((k) => INFO[k].links.some((l) => l[1].startsWith("/tournaments.html")));
  check("info: Cup and VS Bracket link to Tournaments", tournamentsLinks);
  check("info: every event with a 4 Nov change links the changelog", ["diva", "mezfes", "campaigns", "speedrun_cup", "vs_bracket", "festival"]
    .every((k) => INFO[k].links.some((l) => l[1].startsWith("/changelog.html#d-2026-11-04"))));
  check("info: VS Bracket explains !vs join", INFO.vs_bracket.steps.join(" ").includes("!vs join"));
  check("info: new events say so", ["diva", "mezfes", "speedrun_cup", "vs_bracket"].every((k) => /new/i.test(INFO[k].what + INFO[k].tips.join(" "))));
}

(async () => {
  info();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await openCards(browser, base);
    await keyboard(browser, base);
    await mobile(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    failures.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("events OK");
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
