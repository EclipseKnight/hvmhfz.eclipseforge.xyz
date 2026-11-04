#!/usr/bin/env node
/* Checks the Events page's live schedule cards (events.html) and the Tournaments page (tournaments.html) in
   headless Chromium against a fake API (shapes as the API's README, section "Event schedules"):

   - events.html with sample schedule rows: the cards show the live phases, times and content, the Tournaments
     link, a stale row's note, and an event with no row is left out;
   - events.html with /api/public/events/current answering 404 (or an empty list): today's static cards;
   - tournaments.html with sample standings and a drawn bracket: class picker, last week, boards, names, Bye,
     Hidden hunter, ticks, times, winner, champion; a name with markup stays text;
   - tournaments.html with empty boards, with null data, and with 404s: calm "not running yet" notes;
   - the pure helpers of js/events.js and js/tournaments.js under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (tournaments-*.png, events-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-tournaments.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Events = require("../js/events.js");
const Tournaments = require("../js/tournaments.js");

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

/* ---- the fake API ---- */

const NOW = "2026-11-06T00:00:00Z";
// The page compares with the real clock, so a running cycle started long ago and an upcoming one is far away.
const row = (event, phase, extra, over) => Object.assign({ event, cycle: 1, phase, startsAt: "2026-01-05T15:00:00Z",
  endsAt: "2026-11-12T15:00:00Z", phaseEndsAt: "2026-11-11T15:00:00Z", stale: false, updatedAt: NOW, extra }, over);

const CURRENT = { now: NOW, festa: null, events: [
  row("speedrun_cup", "open", { quest: { title: "Speedrun Cup: Espinas", solo: true, guild: true }, last_quest: null,
    open_ends_at: "2026-11-11T15:00:00Z", tally_ends_at: "2026-11-11T16:00:00Z" }),
  row("vs_bracket", "round", { signup_ends_at: "2026-11-05T15:00:00Z", round_hours: 48, max_rounds: 4, entrants: 6, rounds: 3,
    round: 2, quest: { title: "VS Round: Rathian" } }, { stale: true }),
  row("diva", "tactics", { phases: [] }),
  row("conquest", "open", { monsters: [{ id: 1, name: "Rathalos" }, { id: 2, name: "Diablos" }], weekly_rewards: [] }),
  row("campaigns", "open", { campaigns: [{ id: 1, title: "Weekly Supply Drop", reward_text: "", repeat: "weekly",
    starts_at: NOW, ends_at: NOW, period_ends_at: NOW }, { id: 2, title: "Returning Hunter Pack", reward_text: "", repeat: "once",
    starts_at: NOW, ends_at: NOW, period_ends_at: NOW }] })
] };
// Same, but the conquest and campaign rows are missing (those events are off) and the cup is upcoming.
const PARTIAL = { now: NOW, festa: null, events: [
  row("speedrun_cup", "open", { quest: { title: "Speedrun Cup: Espinas" } }, { startsAt: "2099-11-20T15:00:00Z" }),
  row("diva", "personal", {})
] };

const CLASSES = ["Great Sword", "Heavy Bowgun", "Hammer", "Lance", "Sword and Shield", "Light Bowgun", "Dual Swords",
  "Long Sword", "Hunting Horn", "Gunlance", "Bow", "Tonfa", "Switch Axe F", "Magnet Spike"];
const board = (eventId, name, entries) => ({ eventId, name, total: entries.length, entries });
const entry = (rank, name, guild, time) => ({ rank, name, guild, frames: 100, seconds: 3.3, time });
function cycle(phase, quest, filled) {
  return { cycle: 1, phase, quest, startsAt: "2026-11-05T15:00:00Z", openEndsAt: "2026-11-11T15:00:00Z", endsAt: "2026-11-12T15:00:00Z",
    classes: CLASSES.map((name, i) => board(100 + i, name, filled && i === 3
      ? [entry(1, "Lance Fan", "Sky Guild", "1:02.30"), entry(3, "<b>Bold</b>", null, "1:10.00")] : [])),
    guild: board(200, "Guild", filled ? [entry(1, "Guild Hero", "Sky Guild", "2:00.00")] : []) };
}
const STANDINGS = { now: NOW, current: cycle("open", "Speedrun Cup: Espinas", true), last: cycle("over", "Speedrun Cup: Last", true) };
const STANDINGS_EMPTY = { now: NOW, current: cycle("open", "Speedrun Cup: Espinas", false), last: null };

const match = (slot, a, b, extra) => Object.assign({ slot, playerA: a, playerB: b, byeA: false, byeB: false, clearedA: false,
  clearedB: false, secondsA: null, secondsB: null, timeA: null, timeB: null, decided: false, winner: null }, extra);
const BRACKET = { now: NOW, bracket: { cycle: 1, phase: "results", round: 0, roundCount: 2, entrants: 3, drawn: true, finished: true,
  startsAt: "2026-11-05T15:00:00Z", signupEndsAt: "2026-11-06T15:00:00Z", endsAt: "2026-11-12T15:00:00Z", champion: "Alice",
  rounds: [
    { round: 1, endsAt: "2026-11-08T15:00:00Z", decided: true, matches: [
      match(0, "Alice", "Bob", { clearedA: true, clearedB: true, timeA: "1:01.00", timeB: "1:05.50", decided: true, winner: "Alice" }),
      match(1, "Carol", null, { byeB: true, clearedA: false, decided: true, winner: "Carol" })] },
    { round: 2, endsAt: "2026-11-10T15:00:00Z", decided: true, matches: [
      match(0, "Alice", null, { clearedA: true, clearedB: true, timeA: "0:59.99", timeB: "1:20.00", decided: true, winner: "Alice" })] }
  ] } };
const BRACKET_SIGNUP = { now: NOW, bracket: { cycle: 2, phase: "signup", round: 0, roundCount: 0, entrants: 2, drawn: false,
  finished: false, startsAt: "2026-11-05T15:00:00Z", signupEndsAt: "2026-11-09T15:00:00Z", endsAt: "2026-11-20T15:00:00Z",
  champion: null, rounds: [] } };

// api = { current, bracket, standings, events }: each a body, or undefined for a 404.
function answer(api, p) {
  if (p === "/api/public/events") return { questCount: 0, quests: [], prizes: [] };
  if (p === "/api/public/festa") return { festival: null };
  if (p === "/api/public/events/current") return api.current;
  if (p === "/api/public/vs-bracket/current") return api.bracket;
  if (p === "/api/public/tournament/standings") return api.standings;
  return undefined;
}

async function open(browser, url, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const body = answer(api, new URL(route.request().url()).pathname);
    route.fulfill({ status: body === undefined ? 404 : 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body === undefined ? { message: "Not Found" } : body) });
  });
  await page.goto(url);
  return { page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const cards = (page) => page.$$eval("#events-root .event-tile", (ns) => ns.map((n) => n.textContent));
const names = (page) => page.$$eval("#events-root .event-tile h2", (ns) => ns.map((n) => n.textContent));

/* ---- events.html ---- */

async function eventsPage(browser, base) {
  let r = await open(browser, base + "/events.html", { current: CURRENT, bracket: BRACKET }, 1280);
  await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  let list = await cards(r.page);
  check("events live: card order", (await names(r.page)).join() === "Diva Defense,MezFes,Conquest,Event campaigns,Speedrun Cup,VS Bracket,Hunter Festival",
    (await names(r.page)).join());
  const find = (name) => list.find((t) => t.includes(name)) || "";
  check("events live: cup", find("Speedrun Cup").includes("Open: clear the quest") && find("Speedrun Cup").includes("Speedrun Cup: Espinas")
    && find("Speedrun Cup").includes("Clears count until") && find("Speedrun Cup").includes("Live"), find("Speedrun Cup"));
  check("events live: vs round", find("VS Bracket").includes("Round 2 of 3") && find("VS Bracket").includes("VS Round: Rathian")
    && find("VS Bracket").includes("6 hunters entered"), find("VS Bracket"));
  check("events live: stale note on vs only", find("VS Bracket").includes("Schedule may be out of date")
    && !find("Speedrun Cup").includes("out of date"));
  check("events live: diva week", find("Diva Defense").includes("Week 2: guild week") && find("Diva Defense").includes("The week ends"), find("Diva Defense"));
  check("events live: conquest", find("Conquest").includes("Rathalos, Diablos"), find("Conquest"));
  check("events live: campaigns", find("Event campaigns").includes("Weekly Supply Drop, Returning Hunter Pack"), find("Event campaigns"));
  const hrefs = await r.page.$$eval("#events-root a", (as) => as.map((a) => a.getAttribute("href")));
  check("events live: links to tournaments", hrefs.filter((h) => h === "/tournaments.html").length === 3, hrefs.join());
  check("events live: errors", r.errors.length === 0, r.errors.join("; "));
  await shot(r.page, "events-live-1280.png");
  await r.page.setViewportSize({ width: 375, height: 900 });
  check("events live 375: no sideways scroll", (await r.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await shot(r.page, "events-live-375.png");
  await r.page.close();

  r = await open(browser, base + "/events.html", { current: PARTIAL }, 1280);
  await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  check("events partial: events without a row are left out", (await names(r.page)).join() === "Diva Defense,MezFes,Speedrun Cup,Hunter Festival",
    (await names(r.page)).join());
  list = await cards(r.page);
  check("events partial: upcoming cup says From", /From /.test(list.find((t) => t.includes("Speedrun Cup")) || ""));
  await r.page.close();

  for (const [label, current] of [["404", undefined], ["empty list", { now: NOW, festa: null, events: [] }]]) {
    r = await open(browser, base + "/events.html", { current }, 1280);
    await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
    check(`events ${label}: static cards`, (await names(r.page)).join() === "Diva Defense,MezFes,Conquest,Event campaigns,Speedrun Cup,VS Bracket,Hunter Festival");
    list = await cards(r.page);
    check(`events ${label}: static text`, list.some((t) => t.includes("Weekly timed clears of the event quest")) && list.some((t) => t.includes("New & Returning Hunter Pack")));
    check(`events ${label}: tournaments link in the note`, (await r.page.$$eval("#events-root .panel-note a", (as) => as.map((a) => a.getAttribute("href")))).includes("/tournaments.html"));
    check(`events ${label}: errors`, r.errors.length === 0, r.errors.join("; "));
    if (label === "404") await shot(r.page, "events-404-1280.png");
    await r.page.close();
  }
}

/* ---- tournaments.html ---- */

async function tournamentsSample(browser, base) {
  const r = await open(browser, base + "/tournaments.html", { standings: STANDINGS, bracket: BRACKET }, 1280);
  const page = r.page;
  await page.waitForSelector("#cup-body .chip", { timeout: 5000 });
  await page.waitForSelector("#bracket-body .bracket", { timeout: 5000 });
  const chips = await page.$$eval('#cup-body [aria-label="Weapon class"] .chip', (c) => c.map((n) => n.textContent));
  check("cup: 14 classes and the guild board", chips.length === 15 && chips[0] === "Great Sword" && chips[14] === "Guild", chips.join());
  check("cup: first board with clears is open", (await text(page, "#cup-body table tbody tr:first-child")).includes("Lance Fan"));
  check("cup: quest, phase, closing time", (await text(page, "#cup-body .cup-quest")) === "Speedrun Cup: Espinas"
    && (await text(page, "#cup-body")).includes("Open: clears count.") && (await text(page, "#cup-body")).includes("Closes"), await text(page, "#cup-body"));
  const cells = await page.$$eval("#cup-body table tbody tr", (rows) => rows.map((x) => x.textContent));
  check("cup: ranks may skip, no guild shows -", cells[1].startsWith("3") && cells[1].includes("-"), cells.join(" | "));
  check("cup: names stay text", (await page.$$("#cup-body table b")).length === 0 && cells[1].includes("<b>Bold</b>"));
  check("cup: names link nowhere", (await page.$$("#cup-body table a")).length === 0);
  await page.click('#cup-body [aria-label="Weapon class"] .chip:first-child');
  check("cup: empty class says No clears yet", (await text(page, "#cup-body")).includes("No clears yet"));
  await page.click('#cup-body [aria-label="Weapon class"] .chip:last-child');
  check("cup: guild board", (await text(page, "#cup-body table tbody")).includes("Guild Hero"));
  await page.click('#cup-body [aria-label="Week"] .chip:last-child');
  check("cup: last week", (await text(page, "#cup-body .cup-quest")) === "Speedrun Cup: Last" && (await text(page, "#cup-body")).includes("Final results"));
  check("cup: last week keeps its first filled board", (await text(page, "#cup-body table tbody")).includes("Lance Fan"));

  const rounds = await page.$$eval("#bracket-body .bracket-round", (n) => n.map((x) => x.querySelector("h3").textContent));
  check("bracket: two rounds, last is the final", rounds.join() === "Round 1,Round 2 (final)", rounds.join());
  const b = await text(page, "#bracket-body");
  check("bracket: champion", (await text(page, "#bracket-body .bracket-champion")) === "Champion: Alice");
  check("bracket: Bye and Hidden hunter", b.includes("Bye") && b.includes("Hidden hunter"));
  check("bracket: times once decided", b.includes("1:01.00") && b.includes("1:05.50") && b.includes("0:59.99"));
  const winners = await page.$$eval("#bracket-body .is-winner .bracket-name", (n) => n.map((x) => x.textContent));
  check("bracket: winners highlighted", winners.join() === "Alice,Carol,Alice", winners.join());
  check("bracket: ticks", (await page.$$("#bracket-body .bracket-tick:not(:empty)")).length === 4);
  check("bracket: stays in the status text", b.includes("Finished"));
  check("tournaments: errors", r.errors.length === 0, r.errors.join("; "));
  await page.click('#cup-body [aria-label="Week"] .chip:first-child');
  await shot(page, "tournaments-sample-1280.png");
  await page.close();

  const m = await open(browser, base + "/tournaments.html", { standings: STANDINGS, bracket: BRACKET }, 375);
  await m.page.waitForSelector("#bracket-body .bracket", { timeout: 5000 });
  check("tournaments 375: no sideways scroll", (await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  const stacked = await m.page.$$eval("#bracket-body .bracket-round", (n) => n[1].getBoundingClientRect().top > n[0].getBoundingClientRect().bottom - 1);
  check("tournaments 375: rounds stacked", stacked);
  await shot(m.page, "tournaments-sample-375.png");
  await m.page.close();

  const s = await open(browser, base + "/tournaments.html", { standings: STANDINGS_EMPTY, bracket: BRACKET_SIGNUP }, 1280);
  await s.page.waitForSelector("#cup-body .chip", { timeout: 5000 });
  await s.page.waitForFunction(() => document.getElementById("bracket-body").textContent.includes("Sign-up is open"), null, { timeout: 5000 });
  check("empty: boards say No clears yet", (await text(s.page, "#cup-body")).includes("No clears yet"));
  check("empty: no week chips without last week", (await s.page.$$('#cup-body [aria-label="Week"]')).length === 0);
  const sb = await text(s.page, "#bracket-body");
  check("signup: status and entrants", sb.includes("2 hunters entered") && sb.includes("sign-up ends") && sb.includes("drawn when sign-up ends"), sb);
  check("signup: errors", s.errors.length === 0, s.errors.join("; "));
  await shot(s.page, "tournaments-empty-1280.png");
  await s.page.setViewportSize({ width: 375, height: 900 });
  await shot(s.page, "tournaments-empty-375.png");
  await s.page.close();
}

async function tournamentsSoon(browser, base) {
  const cases = [["404", {}], ["null data", { standings: { now: NOW, current: null, last: null }, bracket: { now: NOW, bracket: null } }]];
  for (const [label, api] of cases) {
    for (const width of [1280, 375]) {
      const r = await open(browser, base + "/tournaments.html", api, width);
      await r.page.waitForFunction(() => !document.querySelector("#cup-body, #bracket-body").textContent.includes("Loading"), null, { timeout: 5000 });
      await r.page.waitForTimeout(200);
      check(`${label}: cup note`, (await text(r.page, "#cup-body")).includes("not running yet"), await text(r.page, "#cup-body"));
      check(`${label}: bracket note`, (await text(r.page, "#bracket-body")).includes("not running yet"), await text(r.page, "#bracket-body"));
      check(`${label}: errors`, r.errors.length === 0, r.errors.join("; "));
      if (label === "404") await shot(r.page, "tournaments-404-" + width + ".png");
      await r.page.close();
    }
  }
}

/* ---- the pure helpers under node ---- */

function helpers() {
  const now = Date.parse(NOW);
  const cup = Events.cardFromRow(CURRENT.events[0], now);
  check("helper cardFromRow: cup", cup.badge === "Live" && cup.text.startsWith("Open:") && cup.details[0] === "Quest: Speedrun Cup: Espinas" && cup.href === "/tournaments.html");
  const later = Events.cardFromRow(PARTIAL.events[0], now);
  check("helper cardFromRow: upcoming badge", later.badge.startsWith("From "), later.badge);
  check("helper cardFromRow: stale", Events.cardFromRow(CURRENT.events[1], now).note === "Schedule may be out of date" && !cup.note);
  const vs = (phase, extra) => Events.cardFromRow(row("vs_bracket", phase, extra), now, null);
  check("helper vs phases", vs("signup", { entrants: 1, signup_ends_at: "2026-11-09T15:00:00Z" }).text.startsWith("Sign-up is open")
    && vs("drawing", {}).text.includes("drawn") && vs("no_bracket", {}).text.includes("Fewer than two")
    && vs("results", {}).text.startsWith("Finished"));
  check("helper vs winner from the bracket", Events.cardFromRow(row("vs_bracket", "results", { entrants: 3 }), now, BRACKET).details[0] === "Winner: Alice");
  check("helper campaigns none: no card", Events.cardFromRow(row("campaigns", "none", { campaigns: [] }), now) === null);
  check("helper unknown event: no card", Events.cardFromRow(row("other", "open", {}), now) === null);
  check("helper eventCards: no answer is static", Events.eventCards(null, null, now).length === 7 && Events.eventCards({ events: [] }, null, now).length === 7);
  check("helper eventCards: off events dropped", Events.eventCards(PARTIAL, null, now).map((c) => c.name).join() === "Diva Defense,MezFes,Speedrun Cup,Hunter Festival");

  check("helper playerLabel", Tournaments.playerLabel("Al", false) === "Al" && Tournaments.playerLabel(null, true) === "Bye" && Tournaments.playerLabel(null, false) === "Hidden hunter");
  const rows = Tournaments.matchRows(BRACKET.bracket.rounds[0].matches[1]);
  check("helper matchRows: bye side", rows[0].winner && rows[1].bye && rows[1].label === "Bye" && !rows[1].time);
  const undecided = Tournaments.matchRows(match(0, "A", "B", { clearedA: true, timeA: "1:00.00" }));
  check("helper matchRows: no time or winner before the decision", undecided[0].time === null && !undecided[0].winner && undecided[0].cleared);
  check("helper cupStatus", Tournaments.cupStatus({ phase: "open", openEndsAt: NOW }).startsWith("Open") && Tournaments.cupStatus({ phase: "tallying" }).includes("tallied")
    && Tournaments.cupStatus({ phase: "results", endsAt: NOW }).includes("Next cup starts") && Tournaments.cupStatus({ phase: "none" }).includes("No quest"));
  check("helper bracketStatus", Tournaments.bracketStatus({ phase: "round", round: 2, roundCount: 3 }) === "Round 2 of 3 is open." && Tournaments.bracketStatus(null) === "");
  check("helper boardsOf: classes then guild", Tournaments.boardsOf(STANDINGS.current).length === 15 && Tournaments.firstBoard(STANDINGS.current) === 3
    && Tournaments.firstBoard(STANDINGS_EMPTY.current) === 0);
}

(async () => {
  helpers();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await eventsPage(browser, base);
    await tournamentsSample(browser, base);
    await tournamentsSoon(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    failures.forEach((f) => console.log("FAIL " + f));
    process.exit(1);
  }
  console.log("tournaments OK");
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
