#!/usr/bin/env node
/* Checks that times show in the viewer's own time zone (js/time.js), in headless Chromium run with
   timezoneId Europe/Berlin and America/Los_Angeles, on a fake API:

   - changelog: a release time written "11 Nov 2026, 19:36 UTC" in the page reads in the visitor's zone
     ("20:36 CET", "11:36 PST"), keeps its datetime, and has the UTC text as its title;
   - the footer's "Times" setting: UTC turns the times back to UTC at once, is remembered over a reload,
     and "my timezone" turns them back;
   - leaderboards: the Reached column is a <time> in the visitor's zone with the UTC title; the week note
     says when the 00:00 UTC reset is for the visitor; the "Weeks start Monday 00:00 UTC" line adds it too;
   - Sky Corridor: the last clear in the visitor's zone;
   - Events: the MezFes and Speedrun Cup texts give JST resets in the visitor's time ("your time (00:00 JST)");
   - Play: the current patch and the older patches' release times, UTC on hover;
   - Balance changes: the version's date;
   - js/time.js itself: text, utc, relative and boundary.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-times.js

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

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

// The two zones, their November short names, and the expected text of an instant, worked out here
// with Intl directly (not through js/time.js).
const ZONES = [{ id: "Europe/Berlin", name: "CET" }, { id: "America/Los_Angeles", name: "PST" }];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function partsIn(iso, tz) {
  const out = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).forEach((p) => { out[p.type] = p.value; });
  return out;
}
function expected(iso, zone, opts) {
  opts = opts || {};
  const p = partsIn(iso, zone.id);
  const name = zone.id === "UTC" ? "UTC" : zone.name;
  let d = (opts.weekday ? p.weekday + " " : "") + Number(p.day) + " " + MONTHS[Number(p.month) - 1];
  if (opts.year !== false) d += " " + p.year;
  return d + ", " + p.hour + ":" + p.minute + " " + name;
}
const UTCZ = { id: "UTC", name: "UTC" };

/* ---- the fake API ---- */
const T = "2026-11-03T12:00:00Z";
const REACHED = "2026-11-10T21:30:00Z";
function api(p) {
  if (p === "/api/public/leaderboards/hunts") return { period: "week", from: "2026-11-09T00:00:00Z", to: "2026-11-16T00:00:00Z",
    resetsAt: "2026-11-16T00:00:00Z", hunters: [], guilds: [], monsters: [] };
  if (p === "/api/public/road/leaderboard") return { rotation: { key: "current", number: 3, name: "Test", from: "2026-11-02T00:00:00Z",
    to: "2026-11-16T00:00:00Z" }, tracking: true, rotations: [], hunters: 1, entries: [{ rank: 1, charId: 1, name: "Floor Fan", floor: 30, reachedAt: REACHED }] };
  if (p === "/api/public/road/versions") return [];
  if (p === "/api/public/road/rotations") return [];
  if (p === "/api/public/sky/overview") return { tracking: true, goals: { clears: 25, floors: 100 },
    totals: { clears: 1, floors: 2, players: 1 }, lastActivity: T,
    districts: [1, 2, 3, 4].map((n) => ({ district: n, shownInGame: n <= 2, clears: 0, floors: 0, players: 0, clearsPercent: 0,
      floorsPercent: 0, clearsGoalReached: false, floorsGoalReached: false, lastActivity: null })) };
  if (p === "/api/public/balance") return { version: 4, publishedAt: "2026-11-08T19:20:00Z", rows: [] };
  return undefined;
}

async function open(browser, zone, url, storage) {
  const context = await browser.newContext({ timezoneId: zone.id, locale: "en-US", viewport: { width: 1280, height: 900 } });
  if (storage) await context.addInitScript((s) => { try { localStorage.setItem("hv-times", s); } catch (e) { /* none */ } }, storage);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const u = new URL(route.request().url());
    const body = api(u.pathname);
    route.fulfill({ status: body === undefined ? 404 : 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body === undefined ? { message: "Not Found" } : body) });
  });
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.goto(url);
  return { page, context, errors };
}

const textOf = (page, sel) => page.$eval(sel, (n) => n.textContent.trim());
const attr = (page, sel, a) => page.$eval(sel, (n, a) => n.getAttribute(a), a);

async function changelog(browser, base, zone) {
  const sel = 'time.cl-when[datetime="2026-11-11T19:36Z"]';
  const { page, context, errors } = await open(browser, zone, base + "/changelog.html");
  await page.waitForSelector(sel + "[data-hv-time]", { state: "attached" });
  const at = "2026-11-11T19:36:00Z";
  check(zone.id + " changelog text", (await textOf(page, sel)) === expected(at, zone), await textOf(page, sel));
  check(zone.id + " changelog title is UTC", (await attr(page, sel, "title")) === "11 Nov 2026, 19:36 UTC", await attr(page, sel, "title"));
  check(zone.id + " changelog datetime kept", /^2026-11-11T19:36/.test(await attr(page, sel, "datetime")));
  // the footer setting
  const options = await page.$$eval("#hv-times option", (os) => os.map((o) => o.value + "=" + o.textContent));
  check(zone.id + " Times setting in the footer", options.join("|") === "local=my timezone (" + zone.name + ")|utc=UTC", options.join("|"));
  await page.selectOption("#hv-times", "utc");
  check(zone.id + " UTC toggle", (await textOf(page, sel)) === "11 Nov 2026, 19:36 UTC", await textOf(page, sel));
  await page.reload();
  await page.waitForSelector(sel + "[data-hv-time]", { state: "attached" });
  check(zone.id + " UTC remembered", (await textOf(page, sel)) === "11 Nov 2026, 19:36 UTC" &&
    (await page.$eval("#hv-times", (s) => s.value)) === "utc", await textOf(page, sel));
  await page.selectOption("#hv-times", "local");
  check(zone.id + " back to my timezone", (await textOf(page, sel)) === expected(at, zone), await textOf(page, sel));
  check(zone.id + " changelog: no page error", !errors.length, errors.join("; "));
  await context.close();
}

async function leaderboards(browser, base, zone) {
  let { page, context, errors } = await open(browser, zone, base + "/leaderboards.html#hunters-week");
  await page.waitForFunction(() => /resets in/.test(document.getElementById("board-note").textContent));
  const note = await textOf(page, "#board-note");
  const reset = partsIn("2026-11-16T00:00:00Z", zone.id);
  const local = reset.weekday + " " + Number(reset.day) + " Nov, " + reset.hour + ":" + reset.minute + " your time (Mon 16 Nov, 00:00 UTC)";
  check(zone.id + " leaderboard reset in local time", note.includes(local), note);
  const week = await textOf(page, "#week-start-local");
  const mon = partsIn("2026-11-16T00:00:00Z", zone.id);
  check(zone.id + " week start line", week === "(" + mon.weekday + " " + mon.hour + ":" + mon.minute + " " + zone.name + ")", week);
  await context.close();
  ({ page, context, errors } = await open(browser, zone, base + "/leaderboards.html#road"));
  await page.waitForSelector("#board-body time", { state: "attached" });
  check(zone.id + " Reached column", (await textOf(page, "#board-body time")) === expected(REACHED, zone, { year: false }),
    await textOf(page, "#board-body time"));
  check(zone.id + " Reached title", (await attr(page, "#board-body time", "title")) === "10 Nov 2026, 21:30 UTC",
    await attr(page, "#board-body time", "title"));
  const road = await textOf(page, "#board-note");
  check(zone.id + " rotation dates in local time", road.includes(expected("2026-11-02T00:00:00Z", zone, { year: false })), road);
  check(zone.id + " leaderboards: no page error", !errors.length, errors.join("; "));
  await context.close();
}

async function sky(browser, base, zone) {
  const { page, context, errors } = await open(browser, zone, base + "/sky-corridor.html");
  await page.waitForFunction((t) => document.body.textContent.includes(t), expected(T, zone), { timeout: 5000 }).catch(() => {});
  check(zone.id + " Sky Corridor last clear", (await page.textContent("body")).includes(expected(T, zone)));
  check(zone.id + " Sky Corridor: no page error", !errors.length, errors.join("; "));
  await context.close();
}

async function events(browser, base, zone) {
  const { page, context, errors } = await open(browser, zone, base + "/events.html");
  const info = await page.evaluate(() => ({ mezfes: window.HvEventInfo.mezfes.when, cup: window.HvEventInfo.speedrun_cup.when }));
  const sun = partsIn("2026-11-08T15:00:00Z", zone.id);
  const want = sun.weekday + " " + sun.hour + ":" + sun.minute + " your time (Mon 00:00 JST)";
  check(zone.id + " MezFes reset", info.mezfes.includes(want), info.mezfes);
  const cup = partsIn("2026-11-05T15:00:00Z", zone.id);
  check(zone.id + " Cup start", info.cup.includes(cup.weekday + " " + Number(cup.day) + " Nov, " + cup.hour + ":" + cup.minute +
    " your time (Fri 6 Nov, 00:00 JST)"), info.cup);
  check(zone.id + " events: no page error", !errors.length, errors.join("; "));
  await context.close();
}

async function play(browser, base, zone) {
  const pv = JSON.parse(fs.readFileSync(path.join(root, "data/patch-versions.json"), "utf8"));
  const now = pv.patches.find((p) => p.current);
  const older = pv.patches.find((p) => !p.current && /T/.test(p.published));
  const { page, context, errors } = await open(browser, zone, base + "/play.html#patches");
  await page.waitForSelector(".play-patch-meta time", { state: "attached" });
  const iso = (s) => s.replace(/Z$/, ":00Z");
  check(zone.id + " current patch time", (await textOf(page, ".play-patch-meta time")) === expected(iso(now.published), zone),
    await textOf(page, ".play-patch-meta time"));
  check(zone.id + " current patch title", (await attr(page, ".play-patch-meta time", "title")) === expected(iso(now.published), UTCZ));
  if (older) {
    const sel = 'tr[data-version="' + older.version + '"] time';
    check(zone.id + " older patch time", (await textOf(page, sel)) === expected(iso(older.published), zone), await textOf(page, sel));
    check(zone.id + " older patch title", (await attr(page, sel, "title")) === expected(iso(older.published), UTCZ));
  }
  check(zone.id + " play: no page error", !errors.length, errors.join("; "));
  await context.close();
}

async function balance(browser, base, zone) {
  const { page, context, errors } = await open(browser, zone, base + "/balance.html");
  await page.waitForSelector("#bal-date[data-hv-time]", { state: "attached", timeout: 5000 }).catch(() => {});
  check(zone.id + " balance version date", (await textOf(page, "#bal-date")) === expected("2026-11-08T19:20:00Z", zone),
    await textOf(page, "#bal-date"));
  check(zone.id + " balance: no page error", !errors.length, errors.join("; "));
  await context.close();
}

async function unit(browser, base) {
  const zone = ZONES[0];
  const { page, context } = await open(browser, zone, base + "/changelog.html");
  const r = await page.evaluate(() => ({
    text: HvTime.text("2026-11-12T14:12:00Z"),
    utc: HvTime.utc("2026-11-12T14:12:00Z", { weekday: true }),
    dateOnly: HvTime.text("2026-11-12T23:30:00Z", { time: false }),
    future: HvTime.relative(Date.now() + 3 * 3600e3),
    past: HvTime.relative(Date.now() - 5 * 60e3),
    jst: HvTime.boundary("2026-11-08T15:00:00Z", "JST", 9),
    bad: HvTime.text("not a time")
  }));
  check("unit text", r.text === "12 Nov 2026, 15:12 CET", r.text);
  check("unit utc", r.utc === "Thu 12 Nov 2026, 14:12 UTC", r.utc);
  check("unit date only (the visitor's day)", r.dateOnly === "13 Nov 2026", r.dateOnly);
  check("unit relative", r.future === "in 3 h" && r.past === "5 min ago", r.future + " / " + r.past);
  check("unit boundary", r.jst === "16:00 your time (00:00 JST)", r.jst);
  check("unit bad value", r.bad === "", r.bad);
  await context.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await unit(browser, base);
    for (const zone of ZONES) {
      await changelog(browser, base, zone);
      await leaderboards(browser, base, zone);
      await sky(browser, base, zone);
      await events(browser, base, zone);
      await play(browser, base, zone);
      await balance(browser, base, zone);
    }
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("check-times: " + failures.length + " difference(s)");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
  console.log("check-times: OK (" + ZONES.map((z) => z.id).join(", ") + ")");
})();
