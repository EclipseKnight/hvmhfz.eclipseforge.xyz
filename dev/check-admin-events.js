#!/usr/bin/env node
/* Checks the event calendar on the website in headless Chromium against a fake API (shapes as the API's README,
   section "Event calendar"):

   - admin.html#events: the strip (bars per lane, tails, the now line), the warnings, the 7-day list, the runs
     with Erupe's status ("waiting for the game server" without phases), a run's phases on click; adding a run
     (the live check, its reasons, the request body, times read as UTC); changing a planned run (PUT); delete
     and stop after the current cycle only on the second click; the note of a started run; extending the loop
     (preview, then add); a note with markup stays text; no horizontal overflow at 375 px;
   - the strip's gaps (red where nothing runs, hatched where no featured event is on), "Running now", the gap
     list and "Fill this gap"; dragging a planned run (move, resize an edge) with the mouse: the live tip with the
     rules' verdict, the before/after preview, the API's check with ?id=, Save as a PUT of the whole run;
     Cancel; the keyboard (arrows, Shift, Escape); a long press at 375 px; started runs can't move; a "?" circle
     with its text for every field of the form, each event's settings and the loop; the Ends field;
   - events.html: "Now: ... Next: ... from ..." from /api/public/events/calendar, and no line when the API has
     no calendar (404) or nothing is planned;
   - the pure helpers of js/admin-events.js and js/events.js under node.

   Screenshots at 1280 and 375 px wide go to dev-shots/ (admin-events-*.png, events-next-*.png).

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-admin-events.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Cal = require("../js/admin-events.js");
const Events = require("../js/events.js");

const root = path.join(__dirname, "..");
const shots = path.join(root, "dev-shots");
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
  return b64({ alg: "HS256" }) + "." + b64({ sub: "boss", exp }) + ".sig";
}
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };

/* ---- the pure helpers ---- */

function helpers() {
  check("utc", Cal.utc("2026-11-23T03:00:00Z") === "Mon 23 Nov 2026 03:00", Cal.utc("2026-11-23T03:00:00Z"));
  check("utc empty", Cal.utc(null) === "-");
  check("toInput", Cal.toInput("2026-11-23T03:00:00Z") === "2026-11-23T03:00");
  check("fromInput is UTC", Cal.fromInput("2026-11-23T03:00") === "2026-11-23T03:00:00Z", Cal.fromInput("2026-11-23T03:00"));
  check("fromInput empty", Cal.fromInput("") === null);
  check("weekStart Wed", Cal.weekStart(Date.parse("2026-11-04T15:35:00Z")) === Date.parse("2026-11-02T03:00:00Z"));
  check("weekStart Mon 02:00 is the week before", Cal.weekStart(Date.parse("2026-11-02T02:00:00Z")) === Date.parse("2026-10-26T03:00:00Z"));
  check("weekStart Mon 03:00", Cal.weekStart(Date.parse("2026-11-02T03:00:00Z")) === Date.parse("2026-11-02T03:00:00Z"));
  const g = Cal.timeline([
    { id: 5, event: "festa", lane: "featured", status: "planned", startsAt: "2026-11-16T03:00:00Z", coreEndsAt: "2026-11-30T03:00:00Z", endsAt: "2026-12-14T03:00:00Z" },
    { id: 6, event: "diva", lane: "featured", status: "cancelled", startsAt: "2026-11-16T03:00:00Z", coreEndsAt: "2026-11-30T03:00:00Z", endsAt: "2026-12-07T03:00:00Z" },
    { id: 7, event: "diva", lane: "background", status: "done", startsAt: "2026-01-05T03:00:00Z", coreEndsAt: "2026-01-19T03:00:00Z", endsAt: "2026-01-26T03:00:00Z" }
  ], Date.parse("2026-11-04T00:00:00Z"), 12);
  check("timeline: cancelled and past runs left out", g.bars.length === 1, JSON.stringify(g.bars));
  const b = g.bars[0] || {};
  const week = 100 / 12;
  check("timeline: geometry", Math.abs(b.left - 2 * week) < 1e-9 && Math.abs(b.core - 2 * week) < 1e-9 && Math.abs(b.tail - 2 * week) < 1e-9, JSON.stringify(b));
  const stacked = Cal.timeline([
    { id: 1, event: "festa", lane: "featured", startsAt: "2026-11-16T03:00:00Z", coreEndsAt: "2026-11-30T03:00:00Z", endsAt: "2026-12-14T03:00:00Z" },
    { id: 2, event: "vs_bracket", lane: "featured", startsAt: "2026-11-30T03:00:00Z", coreEndsAt: "2026-12-14T03:00:00Z", endsAt: "2026-12-14T03:00:00Z" },
    { id: 3, event: "diva", lane: "featured", startsAt: "2026-12-14T03:00:00Z", coreEndsAt: "2026-12-28T03:00:00Z", endsAt: "2027-01-04T03:00:00Z" }
  ], Date.parse("2026-11-04T00:00:00Z"), 12);
  check("timeline: a tail beside the next core gets its own row, back to back shares one",
    stacked.bars.map((x) => x.row).join() === "0,1,0" && stacked.rows.featured === 2, JSON.stringify(stacked.bars.map((x) => x.row)));
  check("timeline: ticks", g.ticks.length === 12 && g.ticks[0].label === "2 Nov", JSON.stringify(g.ticks[0]));
  const s = Cal.soon([{ id: 1, name: "Speedrun Cup", status: "running", startsAt: "2026-11-05T15:00:00Z", coreEndsAt: "2026-11-12T15:00:00Z", endsAt: "2026-11-12T15:00:00Z" },
    { id: 2, name: "Hunter Festival", status: "planned", startsAt: "2026-11-17T15:00:00Z", coreEndsAt: "2026-12-21T03:00:00Z", endsAt: "2027-01-12T17:30:00Z" }],
  Date.parse("2026-11-11T00:00:00Z"));
  check("soon", s.join("|") === "Thu 12 Nov 2026 15:00: Speedrun Cup #1 ends|Tue 17 Nov 2026 15:00: Hunter Festival #2 starts", s.join("|"));
  const body = Cal.body({ event: "speedrun_cup", lane: "featured", start: "2027-03-29T03:00", core: "", note: "",
    anyTime: false, settings: { first_cycle: "", cycles: "2", cycle_days: "7", open_days: "6", tally_hours: "1" } });
  check("body", JSON.stringify(body) === JSON.stringify({ event: "speedrun_cup", lane: "featured", startsAt: "2027-03-29T03:00:00Z",
    coreEndsAt: null, settings: { cycles: 2, cycle_days: 7, open_days: 6, tally_hours: 1 }, note: null, allowAnyTime: false }), JSON.stringify(body));
  check("phaseLines none", Cal.phaseLines({ phases: null }) === null);
  const lines = Cal.phaseLines({ phases: [{ name: "cycle", starts_at: "2026-11-05T15:00:00Z", ends_at: "2026-11-12T15:00:00Z", cycle: 0, open_ends_at: "2026-11-11T15:00:00Z" }] });
  check("phaseLines", lines && lines[0] === "cycle: Thu 5 Nov 2026 15:00 to Thu 12 Nov 2026 15:00 (cycle 0, open ends at Wed 11 Nov 2026 15:00)", lines && lines[0]);
  // Drag and resize, the rules while dragging, gaps, help texts.
  const festa = { id: 5, event: "festa", lane: "featured", status: "planned", note: "keep me", startsAt: "2026-11-17T15:00:00Z",
    coreEndsAt: "2026-12-21T03:00:00Z", endsAt: "2027-01-12T17:30:00Z", settings: { entry_hours: 336, souls_hours: 504, judging_hours: 2.5, rewards_hours: 504 } };
  const vs = { id: 6, event: "vs_bracket", lane: "featured", status: "planned", startsAt: "2026-12-21T03:00:00Z", coreEndsAt: "2027-01-04T03:00:00Z",
    endsAt: "2027-01-04T03:00:00Z", settings: { first_cycle: 1, cycles: 1, cycle_days: 14, registration_days: 3, round_days: 2, max_rounds: 5 } };
  const diva = { id: 2, event: "diva", lane: "background", status: "running", startsAt: "2026-11-02T03:00:00Z", coreEndsAt: "2026-11-16T03:00:00Z",
    endsAt: "2026-11-23T03:00:00Z", settings: {} };
  const H = 3600000, D = 24 * H, T = (x) => Date.parse(x);
  const sh = Cal.shape("festa", T(festa.startsAt), festa.settings);
  check("shape festa", sh.end === T(festa.endsAt) && sh.core === T("2026-12-22T15:00:00Z"), JSON.stringify(sh));
  check("shape diva", Cal.shape("diva", 0, {}).end === 21 * D && Cal.shape("diva", 0, {}).core === 14 * D);
  const mv = Cal.moveRun(festa, D + 2 * H);
  check("move: every time shifts, a hand-set core too, settings kept", mv.startsAt === "2026-11-18T17:00:00Z" && mv.coreEndsAt === "2026-12-22T05:00:00Z"
    && mv.endsAt === "2027-01-13T19:30:00Z" && mv.explicitCore && JSON.stringify(mv.settings) === JSON.stringify(festa.settings), JSON.stringify(mv));
  const re = Cal.resizeRun(festa, "end", T("2027-01-13T17:30:00Z"));
  check("resize festa end: rewards hours", re.settings.rewards_hours === 528 && re.endsAt === "2027-01-13T17:30:00Z" && re.startsAt === festa.startsAt, JSON.stringify(re));
  const rs = Cal.resizeRun(festa, "start", T("2026-11-16T15:00:00Z"));
  check("resize festa start: entry hours, end kept", rs.settings.entry_hours === 360 && rs.startsAt === "2026-11-16T15:00:00Z" && rs.endsAt === festa.endsAt, JSON.stringify(rs));
  const rc = Cal.resizeRun(festa, "core", T("2026-12-28T03:00:00Z"));
  check("resize festa core (set by hand): the core end", rc.coreEndsAt === "2026-12-28T03:00:00Z" && rc.explicitCore && rc.endsAt === festa.endsAt, JSON.stringify(rc));
  const own = Object.assign({}, festa, { coreEndsAt: "2026-12-22T15:00:00Z" });
  const ro = Cal.resizeRun(own, "core", T("2026-12-15T15:00:00Z"));
  check("resize festa core (its own): souls hours, tail follows", ro.settings.souls_hours === 336 && !ro.explicitCore && ro.coreEndsAt === "2026-12-15T15:00:00Z"
    && ro.endsAt === "2027-01-05T17:30:00Z", JSON.stringify(ro));
  check("resize Diva: no (21 days)", Cal.resizeRun(diva, "end", T("2026-11-30T03:00:00Z")) === null);
  const rv = Cal.resizeRun(vs, "end", T("2027-01-15T10:00:00Z"));
  check("resize VS end: whole cycles", rv.settings.cycles === 2 && rv.endsAt === "2027-01-18T03:00:00Z" && rv.coreEndsAt === rv.endsAt && !rv.explicitCore, JSON.stringify(rv));
  const rvs = Cal.resizeRun(vs, "start", T("2026-12-08T00:00:00Z"));
  check("resize VS start: whole cycles, end kept", rvs.settings.cycles === 2 && rvs.startsAt === "2026-12-07T03:00:00Z" && rvs.endsAt === vs.endsAt, JSON.stringify(rvs));
  const now = T("2026-11-10T00:00:00Z");
  const early = Cal.ruleProblems(Cal.moveRun(vs, -10 * D), [festa, diva], now);
  check("rules: featured cores overlap", early.problems.some((p) => /overlaps the Hunter Festival run #5's core/.test(p)), JSON.stringify(early));
  check("rules: Monday 03:00 is the soft rule", early.boundary.length === 2 && Cal.ruleProblems(vs, [festa], now).boundary.length === 0, JSON.stringify(early.boundary));
  check("rules: background runs don't block a featured core", !Cal.ruleProblems(Cal.moveRun(vs, -42 * D), [diva], now).problems.some((p) => /core/.test(p)));
  check("rules: same event, tails included", Cal.ruleProblems(Object.assign({}, festa, { id: 9 }), [festa], now).problems.some((p) => /one run of an event at a time/.test(p)));
  check("rules: souls at least 7 days", Cal.ruleProblems(Cal.resizeRun(own, "core", T("2026-12-03T15:00:00Z")), [], now).problems.some((p) => /168/.test(p)));
  check("rules: an hour ahead", Cal.ruleProblems(Cal.moveRun(vs, T("2026-11-10T00:30:00Z") - T(vs.startsAt)), [], now).problems.some((p) => /an hour from now/.test(p)));
  const cupBad = { id: 7, event: "speedrun_cup", lane: "featured", startsAt: "2027-02-01T03:00:00Z", coreEndsAt: "2027-02-08T03:00:00Z", endsAt: "2027-02-08T03:00:00Z",
    settings: { first_cycle: 0, cycles: 1, cycle_days: 7, open_days: 7, tally_hours: 1 } };
  const cupR = Cal.ruleProblems(cupBad, [{ id: 3, event: "speedrun_cup", lane: "background", startsAt: "2026-11-05T15:00:00Z", coreEndsAt: "2026-11-19T15:00:00Z",
    endsAt: "2026-11-19T15:00:00Z", settings: { first_cycle: 0, cycles: 2 } }], now).problems.join(" ");
  check("rules: Cup open + tally, cycle numbers", /an hour before the cycle/.test(cupR) && /already used/.test(cupR), cupR);
  const cov = Cal.coverage([festa, vs, diva], now, T("2027-02-01T03:00:00Z"));
  const gl = cov.gaps.map((g) => g.kind + " " + new Date(g.from).toISOString().slice(0, 16) + " " + new Date(g.to).toISOString().slice(0, 16) + " " + g.running.join("+"));
  check("coverage: no featured (background on), festival tail alone, then nothing", gl.join("|") === "featured 2026-11-10T00:00 2026-11-17T15:00 Diva Defense"
    + "|featured 2027-01-04T03:00 2027-01-12T17:30 Hunter Festival|empty 2027-01-12T17:30 2027-02-01T03:00 ", gl.join("|"));
  const at = Cal.runningAt(cov.pieces, T("2026-11-20T00:00:00Z"));
  check("runningAt", at && at.featured === 5 && at.runs.map((r) => r.id + r.part).join() === "5core,2tail", JSON.stringify(at));
  check("howLong", Cal.howLong(0, (12 * 24 + 21) * H) === "12 d 21 h" && Cal.howLong(0, 2 * D) === "2 d" && Cal.howLong(0, 5 * H) === "5 h");
  check("snap", Cal.snap(T("2026-11-10T10:31:00Z")) === T("2026-11-10T11:00:00Z") && Cal.snap(T("2026-11-10T16:00:00Z"), true) === T("2026-11-11T03:00:00Z"));
  check("draftBody: own core left out, note kept", JSON.stringify(Cal.draftBody(rv, true)) === JSON.stringify({ event: "vs_bracket", lane: "featured",
    startsAt: vs.startsAt, coreEndsAt: null, settings: rv.settings, note: null, allowAnyTime: true }) && Cal.draftBody(mv).note === "keep me"
    && Cal.draftBody(mv).coreEndsAt === "2026-12-22T05:00:00Z");
  ["event", "lane", "starts_at", "core_ends_at", "ends_at", "note", "any_time", "diva", "gen_from", "gen_first", "gen_weeks"].forEach((k) =>
    check("help text: " + k, (Cal.help(k) || "").length > 40));
  Object.keys(Cal.FIELDS).forEach((e) => Cal.FIELDS[e].forEach((f) => check("help text: " + e + "." + f[0], (Cal.help(f[0], e) || "").length > 40)));
  check("events: calendarLine none", Events.calendarLine(null) === null && Events.calendarLine({ current: null, next: null }) === null);
  const line = Events.calendarLine({ current: null, next: { name: "Hunter Festival", startsAt: "2026-11-17T15:00:00Z" } }) || "";
  check("events: calendarLine next", /^Next: Hunter Festival from .+\.$/.test(line), line);
}

/* ---- the fake API ---- */

const NOW = "2026-11-10T00:00:00Z";
const CUP_PHASES = [{ name: "cycle", starts_at: "2026-11-05T15:00:00Z", ends_at: "2026-11-12T15:00:00Z", cycle: 0,
  open_ends_at: "2026-11-11T15:00:00Z", tally_ends_at: "2026-11-11T16:00:00Z" }];

function seed() {
  const run = (id, event, name, lane, status, s, c, e, settings, extra) => Object.assign({ id, event, name, lane, status,
    startsAt: s, coreEndsAt: c, endsAt: e, settings, phases: null, note: null, createdBy: "seed-2026-11-b", createdAt: NOW,
    updatedBy: null, updatedAt: NOW, started: Date.parse(s) <= Date.parse(NOW), editable: status === "planned" && Date.parse(s) > Date.parse(NOW) }, extra || {});
  return [
    run(2, "diva", "Diva Defense", "background", "running", "2026-11-02T03:00:00Z", "2026-11-16T03:00:00Z", "2026-11-23T03:00:00Z", {},
      { phases: [{ name: "personal", starts_at: "2026-11-02T03:00:00Z", ends_at: "2026-11-09T02:00:00Z" }], note: "<b>Diva event 1</b>" }),
    run(3, "speedrun_cup", "Speedrun Cup", "background", "running", "2026-11-05T15:00:00Z", "2026-11-19T15:00:00Z", "2026-11-19T15:00:00Z",
      { first_cycle: 0, cycles: 2, cycle_days: 7, open_days: 6, tally_hours: 1 }, { phases: CUP_PHASES }),
    run(5, "festa", "Hunter Festival", "featured", "planned", "2026-11-17T15:00:00Z", "2026-12-21T03:00:00Z", "2027-01-12T17:30:00Z",
      { entry_hours: 336, souls_hours: 504, judging_hours: 2.5, rewards_hours: 504 }),
    run(6, "vs_bracket", "VS Bracket", "featured", "planned", "2026-12-21T03:00:00Z", "2027-01-04T03:00:00Z", "2027-01-04T03:00:00Z",
      { first_cycle: 1, cycles: 1, cycle_days: 14, registration_days: 3, round_days: 2, max_rounds: 5 })
  ];
}

const RULES = { events: [
  { event: "festa", name: "Hunter Festival", loopSettings: { entry_hours: 168, souls_hours: 168, judging_hours: 2.5, rewards_hours: 333.5 } },
  { event: "vs_bracket", name: "VS Bracket", loopSettings: { cycles: 1, cycle_days: 14, registration_days: 3, round_days: 2, max_rounds: 5 } },
  { event: "diva", name: "Diva Defense", loopSettings: {} },
  { event: "speedrun_cup", name: "Speedrun Cup", loopSettings: { cycles: 1, cycle_days: 7, open_days: 6, tally_hours: 1 } }] };

const GENERATED = ["festa", "vs_bracket", "diva", "speedrun_cup"].map((e, i) => ({ event: e, name: e, startsAt: "2027-0" + (3 + i) + "-01T03:00:00Z",
  coreEndsAt: "2027-0" + (3 + i) + "-15T03:00:00Z", endsAt: "2027-0" + (3 + i) + "-20T03:00:00Z", settings: {}, exists: i === 0, problems: [] }));

function fakeApi(page, api) {
  page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    const sent = req.postData() ? JSON.parse(req.postData()) : null;
    api.calls.push({ method: req.method(), path: p + url.search, body: sent });
    if (p === "/api/users/self") return reply(200, { username: "boss" });
    if (p === "/api/admin/distributions/options") return reply(200, { lists: {}, items: {}, needsItemId: [], maxCharacters: 100 });
    if (p === "/api/admin/distributions") return reply(200, []);
    if (p === "/api/admin/events/rules") return reply(200, RULES);
    if (p === "/api/admin/events/calendar" && req.method() === "GET") {
      return reply(200, { now: NOW, tableReady: true, runs: api.runs, warnings: ["No featured event from Tue 10 Nov 2026 00:00 UTC to Tue 17 Nov 2026 15:00 UTC."],
        loopNext: { from: "2027-03-15", first: "festa" }, alwaysOn: ["MezFes (every day)", "Raviente"] });
    }
    if (p === "/api/admin/events/calendar/check") {
      const monday = sent.startsAt && new Date(sent.startsAt).getUTCDay() === 1;
      return reply(200, { event: sent.event, startsAt: sent.startsAt, coreEndsAt: "2027-03-29T03:00:00Z", endsAt: "2027-04-05T03:00:00Z",
        settings: sent.settings, problems: monday || sent.allowAnyTime ? [] : ["The start (" + sent.startsAt + ") is not on a Monday 03:00 UTC; tick \"allow any time\" to use it anyway."],
        warnings: [] });
    }
    if (p === "/api/admin/events/calendar" && req.method() === "POST") {
      if (sent.note === "refuse me") return reply(400, { message: "Its core overlaps the VS Bracket run #6's core.", problems: ["Its core overlaps the VS Bracket run #6's core.", "Second reason."] });
      const r = { id: 20, event: sent.event, name: "Diva Defense", lane: sent.lane, status: "planned", startsAt: sent.startsAt,
        coreEndsAt: "2027-03-29T03:00:00Z", endsAt: "2027-04-05T03:00:00Z", settings: sent.settings, phases: null, note: sent.note, editable: true };
      api.runs.push(r);
      return reply(201, r);
    }
    let m = p.match(/^\/api\/admin\/events\/calendar\/(\d+)$/);
    if (m && req.method() === "PUT") {
      const r = api.runs.find((x) => x.id === Number(m[1]));
      Object.assign(r, sent.note !== undefined ? { note: sent.note } : {});
      if (sent.startsAt) {
        const t = Cal.shape(r.event, Date.parse(sent.startsAt), sent.settings);
        Object.assign(r, { startsAt: sent.startsAt, settings: sent.settings, endsAt: new Date(t.end).toISOString(),
          coreEndsAt: sent.coreEndsAt || new Date(t.core).toISOString() });
      }
      return reply(200, r);
    }
    m = p.match(/^\/api\/admin\/events\/calendar\/(\d+)\/(cancel|stop-after-current)$/);
    if (m) {
      const r = api.runs.find((x) => x.id === Number(m[1]));
      if (m[2] === "cancel") { r.status = "cancelled"; api.runs = api.runs.filter((x) => x !== r); } else { r.settings.cycles = 1; }
      return reply(200, r);
    }
    if (p === "/api/admin/events/calendar/generate") {
      return reply(200, { message: null, runs: GENERATED, problems: [], warnings: [], saved: sent.dryRun ? 0 : 3, ids: sent.dryRun ? [] : [21, 22, 23] });
    }
    if (p === "/api/public/events") return reply(200, { questCount: 0, quests: [], prizes: [] });
    if (p === "/api/public/events/calendar" && api.calendar !== undefined) return reply(200, api.calendar);
    return reply(404, { message: "Not Found" });
  });
}

async function open(browser, url, api, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept(api.prompt || ""));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  fakeApi(page, api);
  await page.goto(url);
  return { page, errors };
}

async function shot(page, name) {
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name), fullPage: true });
}

const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const last = (api, method, pathPart) => api.calls.filter((c) => c.method === method && c.path.indexOf(pathPart) !== -1).pop();

async function adminPage(browser, base) {
  const api = { runs: seed(), calls: [], prompt: "Diva event 1 (week 3 to 23 Nov)" };
  const { page, errors } = await open(browser, base + "/admin.html#events", api, 1280);
  await page.waitForSelector("#cal-rows tr td.rank", { timeout: 5000 });
  check("tab selected", (await page.getAttribute("#tab-events", "aria-selected")) === "true");
  check("panel shown", await page.isVisible("#panel-events"));
  const bars = await page.$$eval("#cal-strip .cal-lane", (ls) => ls.map((l) => l.querySelectorAll(".cal-bar").length));
  check("strip: bars per lane (featured, background)", bars.join() === "2,2", bars.join());
  check("strip: now line", (await page.$$("#cal-strip .cal-now")).length === 1);
  check("warnings", (await text(page, "#cal-warnings")).indexOf("No featured event from Tue 10 Nov") !== -1);
  check("7 days", (await text(page, "#cal-soon")) === "Mon 16 Nov 2026 03:00: Diva Defense #2 core ends (the next event may start)",
    await text(page, "#cal-soon"));
  const rows = await page.$$eval("#cal-rows tr", (rs) => rs.map((r) => r.textContent));
  check("rows", rows.length === 4, rows.length);
  check("waiting for the game server", rows[2].indexOf("waiting for the game server") !== -1 && rows[0].indexOf("waiting") === -1, rows[2]);
  check("note with markup is text", (await page.$$("#cal-rows b")).length === 0 && rows[0].indexOf("<b>Diva event 1</b>") !== -1);
  check("started rows: no delete", rows[0].indexOf("Delete") === -1 && rows[0].indexOf("Edit note") !== -1);
  check("planned rows: edit and delete", rows[2].indexOf("Edit") !== -1 && rows[2].indexOf("Delete") !== -1);
  check("stop only for a running multi-cycle Cup", rows[1].indexOf("Stop after current cycle") !== -1 && rows[0].indexOf("Stop") === -1);
  check("always on", (await text(page, "#cal-always")).indexOf("MezFes (every day), Raviente") !== -1);

  // A run's phases, from Erupe.
  await page.click("#cal-strip .cal-speedrun_cup");
  const detail = await text(page, "#cal-detail");
  check("detail: Erupe's phases", detail.indexOf("cycle: Thu 5 Nov 2026 15:00 to Thu 12 Nov 2026 15:00 (cycle 0") !== -1, detail);
  await page.click("#cal-strip .cal-festa");
  check("detail: waiting", (await text(page, "#cal-detail")).indexOf("Waiting for the game server") !== -1);
  await shot(page, "admin-events-1280.png");

  // Add a run: the live check (a Tuesday is refused with the API's reason), then a Monday and save.
  await page.selectOption("#cal-event", "diva");
  await page.fill("#cal-start", "2027-03-16T03:00");
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("not on a Monday") !== -1, null, { timeout: 3000 })
    .catch(() => check("live check shows the reason", false));
  await page.fill("#cal-start", "2027-03-15T03:00");
  await page.fill("#cal-note-text", "extra Diva");
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("The checks pass.") !== -1, null, { timeout: 3000 })
    .catch(() => check("live check passes", false));
  check("computed ends", (await text(page, "#cal-computed")).indexOf("ends Mon 5 Apr 2027 03:00 UTC") !== -1, await text(page, "#cal-computed"));
  await page.click("#cal-save");
  await page.waitForFunction(() => !document.getElementById("cal-ok").hidden, null, { timeout: 3000 }).catch(() => {});
  const created = last(api, "POST", "/api/admin/events/calendar");
  check("create body", created && created.path === "/api/admin/events/calendar" && JSON.stringify(created.body) === JSON.stringify({ event: "diva", lane: "featured",
    startsAt: "2027-03-15T03:00:00Z", coreEndsAt: null, settings: {}, note: "extra Diva", allowAnyTime: false }), created && JSON.stringify(created.body));
  check("create ok", (await text(page, "#cal-ok")).indexOf("Diva Defense #20 added") !== -1, await text(page, "#cal-ok"));
  await page.waitForFunction(() => document.querySelectorAll("#cal-rows tr").length === 5, null, { timeout: 3000 }).catch(() => check("list reloaded", false));

  // A refusal shows every reason.
  await page.fill("#cal-start", "2027-03-15T03:00");
  await page.fill("#cal-note-text", "refuse me");
  await page.click("#cal-save");
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("Second reason.") !== -1, null, { timeout: 3000 })
    .catch(() => check("refusal reasons shown", false));

  // Change a planned run: the form takes its values; Save is a PUT to it.
  await page.click("#cal-reset").catch(() => {});
  const festaRow = await page.$("#cal-rows tr:nth-child(3)");
  await (await festaRow.$("button:text-is('Edit')")).click();
  check("edit fills the form", (await page.inputValue("#cal-start")) === "2026-11-17T15:00" && (await page.inputValue("#cal-s-souls_hours")) === "504"
    && (await text(page, "#cal-form-title")).indexOf("Change run #5") !== -1);
  await page.fill("#cal-note-text", "moved");
  await page.click("#cal-save");
  await page.waitForTimeout(300);
  const put = last(api, "PUT", "/api/admin/events/calendar/5");
  check("edit is a PUT with the settings", put && put.body.settings.souls_hours === 504 && put.body.note === "moved" && put.body.startsAt === "2026-11-17T15:00:00Z",
    put && JSON.stringify(put.body));

  // Delete and stop: nothing on the first click.
  const before = api.calls.length;
  const vsRow = () => page.$("#cal-rows tr:nth-child(4)");
  await (await (await vsRow()).$("button:text-is('Delete')")).click();
  check("delete: first click asks", api.calls.length === before && (await (await vsRow()).textContent()).indexOf("Confirm delete #6") !== -1);
  await (await (await vsRow()).$("button:has-text('Confirm delete')")).click();
  await page.waitForTimeout(300);
  check("delete: second click cancels the run", !!last(api, "POST", "/api/admin/events/calendar/6/cancel"));
  const cupRow = await page.$("#cal-rows tr:nth-child(2)");
  await (await cupRow.$("button:has-text('Stop after current cycle')")).click();
  check("stop: first click asks", !last(api, "POST", "stop-after-current"));
  await (await (await page.$("#cal-rows tr:nth-child(2)")).$("button:has-text('Confirm stop')")).click();
  await page.waitForTimeout(300);
  check("stop: second click", !!last(api, "POST", "/api/admin/events/calendar/3/stop-after-current"));

  // A started run: only its note, through the prompt.
  await (await (await page.$("#cal-rows tr:nth-child(1)")).$("button:text-is('Edit note')")).click();
  await page.waitForTimeout(300);
  const note = last(api, "PUT", "/api/admin/events/calendar/2");
  check("note of a started run", note && JSON.stringify(note.body) === JSON.stringify({ note: "Diva event 1 (week 3 to 23 Nov)" }), note && JSON.stringify(note.body));

  // Extend the loop: prefilled from loopNext; preview, then add.
  check("loop prefilled", (await page.inputValue("#cal-gen-from")) === "2027-03-15" && (await page.inputValue("#cal-gen-first")) === "festa");
  await page.fill("#cal-gen-weeks", "7");
  await page.click("#cal-gen-preview");
  await page.waitForSelector("#cal-gen-save:not([hidden])", { timeout: 3000 }).catch(() => check("preview offers to add", false));
  const dry = last(api, "POST", "/generate");
  check("preview body", dry && JSON.stringify(dry.body) === JSON.stringify({ from: "2027-03-15", weeks: 7, first: "festa", dryRun: true }), dry && JSON.stringify(dry.body));
  check("preview list", (await text(page, "#cal-gen-list")).indexOf("(already there, skipped)") !== -1 && (await text(page, "#cal-gen-save")) === "Add these 3 runs");
  await page.click("#cal-gen-save");
  await page.waitForTimeout(300);
  check("add the loop", last(api, "POST", "/generate").body.dryRun === false && (await text(page, "#cal-ok")).indexOf("3 runs added") !== -1);
  check("admin: no page errors", errors.length === 0, errors.join("; "));
  await page.close();

  const small = await open(browser, base + "/admin.html#events", { runs: seed(), calls: [] }, 375);
  await small.page.waitForSelector("#cal-rows tr td.rank", { timeout: 5000 });
  const overflow = await small.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("admin 375: no horizontal overflow", overflow <= 0, overflow + " px");
  await shot(small.page, "admin-events-375.png");
  check("admin 375: no page errors", small.errors.length === 0, small.errors.join("; "));
  await small.page.close();
}

/* ---- gaps, drag, keys, help circles ---- */

// Pixels of the strip for ms of time, and the x of time t.
async function geometry(page) {
  return page.evaluate(() => {
    const b = document.querySelector("#cal-strip .cal-body").getBoundingClientRect();
    return { left: b.left, width: b.width };
  });
}
const FROM = Date.parse("2026-11-09T03:00:00Z"), SPAN = 84 * 86400000;
const xOf = (g, t) => g.left + (Date.parse(t) - FROM) / SPAN * g.width;

// Waits until the page stops scrolling (the form scrolls smoothly).
async function settle(page) {
  await page.waitForFunction(() => new Promise((ok) => { const y = scrollY; setTimeout(() => ok(scrollY === y), 150); }), null, { timeout: 5000 }).catch(() => {});
}

async function dragBy(page, sel, fromX, toX) {
  await page.$eval(sel, (n) => n.scrollIntoView({ block: "center" }));
  await settle(page);
  const box = await (await page.$(sel)).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(fromX + (toX - fromX) / 3, y, { steps: 3 });
  await page.mouse.move(toX, y, { steps: 5 });
}

async function dragPage(browser, base) {
  const api = { runs: seed(), calls: [] };
  api.runs.find((r) => r.id === 5).note = "keep me";
  const { page, errors } = await open(browser, base + "/admin.html#events", api, 1280);
  await page.emulateMedia({ reducedMotion: "reduce" }); // no smooth scrolling under the mouse
  await page.waitForSelector("#cal-rows tr td.rank", { timeout: 5000 });

  // What runs now and the gaps.
  const running = await text(page, "#cal-running");
  check("running now: background runs, no featured", running.indexOf("Diva Defense #2 (background)") !== -1 && running.indexOf("Speedrun Cup #3 (background)") !== -1
    && running.indexOf("no featured event") !== -1, running);
  check("strip: one red gap, two hatched", (await page.$$("#cal-strip .cal-gap.is-empty")).length === 1 && (await page.$$("#cal-strip .cal-gap.is-nofeatured")).length === 2);
  const gaps = await page.$$eval("#cal-gaps li", (ls) => ls.map((l) => l.textContent));
  check("gap list", gaps.length === 3 && /^No featured event Tue 10 Nov 2026 00:00 to Tue 17 Nov 2026 15:00 UTC, 7 d 15 h\. Still on: Diva Defense, Speedrun Cup\.Fill this gap$/.test(gaps[0])
    && /^Nothing runs Tue 12 Jan 2027 17:30 to Mon 1 Feb 2027 03:00 UTC, .*nothing is planned after.*Fill this gap$/.test(gaps[2]), gaps.join(" | "));
  const g = await geometry(page);
  await page.mouse.move(xOf(g, "2026-11-20T00:00:00Z"), (await (await page.$("#cal-strip .cal-festa")).boundingBox()).y + 10);
  check("pointing says what runs then", /^Fri 20 Nov 2026 00:00 UTC: Hunter Festival #5 \(featured\), Diva Defense #2 \(background, tail\)\.$/.test(await text(page, "#cal-at")), await text(page, "#cal-at"));

  // Fill this gap: the form starts at the gap (an hour ahead at least), featured, any time allowed.
  await page.click("#cal-gaps li:first-child button");
  check("fill: start, lane, any time", (await page.inputValue("#cal-start")) === "2026-11-10T01:00" && (await page.inputValue("#cal-lane")) === "featured"
    && (await page.isChecked("#cal-anytime")), await page.inputValue("#cal-start"));
  check("fill: hint", /^Filling Tue 10 Nov 2026 01:00 to Tue 17 Nov 2026 15:00 UTC \(7 d 14 h\)/.test(await text(page, "#cal-gap-hint")), await text(page, "#cal-gap-hint"));
  check("fill: Ends from the settings", (await page.inputValue("#cal-end")) === "2026-12-08T01:00", await page.inputValue("#cal-end"));
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("The checks pass.") !== -1, null, { timeout: 3000 })
    .catch(() => check("fill: checked", false));
  // A new end changes the last length: the Cup's cycles.
  await page.selectOption("#cal-event", "speedrun_cup");
  await page.fill("#cal-end", "2026-12-01T01:00");
  await page.dispatchEvent("#cal-end", "change");
  check("Ends: Cup cycles follow", (await page.inputValue("#cal-s-cycles")) === "3" && (await page.inputValue("#cal-end")) === "2026-12-01T01:00", await page.inputValue("#cal-s-cycles"));
  await page.selectOption("#cal-event", "diva");
  check("Ends: Diva can't change", await page.$eval("#cal-end", (n) => n.readOnly));

  // Help circles: every field, each event's settings, the loop; open on click, closed by Escape.
  const helpFor = (id) => page.evaluate((id) => {
    const input = document.getElementById(id);
    const head = input.closest(".field, .cal-anytime, .cal-change, form").querySelector(".field-head");
    const b = head && head.querySelector(".help-tip");
    const pop = b && document.getElementById(b.getAttribute("aria-describedby"));
    return b && pop && b.tagName === "BUTTON" && b.getAttribute("aria-label").length > 5 && pop.getAttribute("role") === "tooltip" ? pop.textContent : "";
  }, id);
  for (const id of ["cal-event", "cal-lane", "cal-start", "cal-core", "cal-end", "cal-note-text", "cal-anytime", "cal-gen-from", "cal-gen-first", "cal-gen-weeks"]) {
    check("help circle: " + id, (await helpFor(id)).length > 40);
  }
  for (const [ev, keys] of Object.entries(Cal.FIELDS)) {
    await page.selectOption("#cal-event", ev);
    for (const k of keys) check("help circle: " + ev + " " + k[0], (await helpFor("cal-s-" + k[0])).length > 40);
  }
  await page.selectOption("#cal-event", "diva");
  check("help circle: Diva weeks", /21 days/.test(await page.$eval("#cal-settings .help-pop", (n) => n.textContent)));
  await page.click("label[for='cal-lane'] + .help-tip");
  check("help: click opens", await page.isVisible("label[for='cal-lane'] ~ .help-pop") && (await page.getAttribute("label[for='cal-lane'] + .help-tip", "aria-expanded")) === "true");
  await page.keyboard.press("Escape");
  check("help: Escape closes", !(await page.isVisible("label[for='cal-lane'] ~ .help-pop")));
  await page.click("#cal-reset").catch(() => {});

  // Started runs don't move.
  check("started runs: no handles", (await page.$$("#cal-strip .cal-diva .cal-h, #cal-strip .cal-speedrun_cup .cal-h")).length === 0
    && (await page.$$("#cal-strip .cal-festa .cal-h")).length === 3);

  await page.$eval("#cal-strip", (n) => n.scrollIntoView({ block: "center" }));
  await settle(page);
  // Drag the festival from Tue 17 Nov 15:00 to Mon 23 Nov 03:00 (the magnet takes it to the boundary).
  const fb = await (await page.$("#cal-strip .cal-festa")).boundingBox();
  const startX = fb.x + 60;
  await dragBy(page, "#cal-strip .cal-festa", startX, startX + (xOf(g, "2026-11-23T02:00:00Z") - xOf(g, "2026-11-17T15:00:00Z")));
  const tip = await text(page, "#cal-strip .cal-tip");
  check("drag: the live tip", await page.isVisible("#cal-strip .cal-tip") && tip.indexOf("Start Mon 23 Nov 2026 03:00") !== -1
    && tip.indexOf("overlaps the VS Bracket run #6") !== -1, tip);
  check("drag: the bar says it breaks a rule", await page.$eval("#cal-strip .cal-festa", (n) => n.classList.contains("is-bad")));
  await page.mouse.up();
  await page.waitForSelector("#cal-change:not([hidden])", { timeout: 3000 }).catch(() => check("drop: the change shows", false));
  const rows = await page.$$eval("#cal-change-rows tr", (rs) => rs.map((r) => r.textContent));
  check("drop: before and after", rows[0] === "StartsTue 17 Nov 2026 15:00Mon 23 Nov 2026 03:00" && rows[1] === "Core endsMon 21 Dec 2026 03:00Sat 26 Dec 2026 15:00"
    && rows.length === 7, rows.join(" | "));
  check("drop: no detail opened", await page.isHidden("#cal-detail"));
  await page.waitForFunction(() => document.getElementById("cal-change-problems").textContent.indexOf("API's checks pass") !== -1, null, { timeout: 3000 })
    .catch(() => check("drop: the API's check", false));
  const chk = last(api, "POST", "/check?id=5");
  check("drop: checked with ?id=", chk && chk.body.startsAt === "2026-11-23T03:00:00Z" && chk.body.coreEndsAt === "2026-12-26T15:00:00Z", chk && JSON.stringify(chk.body));
  await page.click("#cal-change-save");
  await page.waitForFunction(() => document.getElementById("cal-change").hidden, null, { timeout: 3000 }).catch(() => check("save closes the change", false));
  const put = last(api, "PUT", "/api/admin/events/calendar/5");
  check("save: a PUT of the whole run, note kept", put && JSON.stringify(put.body) === JSON.stringify({ event: "festa", lane: "featured", startsAt: "2026-11-23T03:00:00Z",
    coreEndsAt: "2026-12-26T15:00:00Z", settings: { entry_hours: 336, souls_hours: 504, judging_hours: 2.5, rewards_hours: 504 }, note: "keep me", allowAnyTime: false }),
  put && JSON.stringify(put.body));
  check("save: said", (await text(page, "#cal-ok")).indexOf("Run #5 saved") !== -1);
  await page.waitForTimeout(200);

  // Resize the VS Bracket's end by two weeks: two cycles; Cancel puts it back.
  const vb = await (await page.$("#cal-strip .cal-vs_bracket")).boundingBox();
  const before = await page.$eval("#cal-strip .cal-vs_bracket", (n) => n.style.width);
  const endX = vb.x + vb.width - 3;
  await dragBy(page, "#cal-strip .cal-vs_bracket", endX, endX + (xOf(g, "2027-01-18T03:00:00Z") - xOf(g, "2027-01-04T03:00:00Z")));
  await page.mouse.up();
  await page.waitForSelector("#cal-change:not([hidden])", { timeout: 3000 }).catch(() => check("resize: the change shows", false));
  const vrows = await page.$$eval("#cal-change-rows tr", (rs) => rs.map((r) => r.textContent));
  check("resize: cycles 1 to 2", vrows.indexOf("Cycles12") !== -1 && vrows.indexOf("EndsMon 4 Jan 2027 03:00Mon 18 Jan 2027 03:00") !== -1, vrows.join(" | "));
  const puts = api.calls.filter((c) => c.method === "PUT").length;
  await page.click("#cal-change-cancel");
  check("cancel: nothing saved, bar back", api.calls.filter((c) => c.method === "PUT").length === puts && await page.isHidden("#cal-change")
    && (await page.$eval("#cal-strip .cal-vs_bracket", (n) => n.style.width)) === before);

  // The keyboard: arrows move by an hour, Shift by a day, Up lengthens, Escape cancels.
  await page.focus("#cal-strip .cal-vs_bracket");
  await page.keyboard.press("ArrowRight");
  check("keys: the change shows, focus stays", await page.isVisible("#cal-change") && await page.evaluate(() => document.activeElement.dataset.id === "6"));
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowUp");
  const krows = await page.$$eval("#cal-change-rows tr", (rs) => rs.map((r) => r.textContent));
  check("keys: +1 h, +1 day, a cycle longer", krows[0] === "StartsMon 21 Dec 2026 03:00Tue 22 Dec 2026 04:00" && krows.indexOf("Cycles12") !== -1, krows.join(" | "));
  await page.keyboard.press("Escape");
  check("keys: Escape cancels", await page.isHidden("#cal-change"));
  check("drag: no page errors", errors.length === 0, errors.join("; "));
  await shot(page, "admin-events-gaps-1280.png");
  await page.close();

  // 375 px: a long press, then drag; a quick swipe does nothing.
  const small = await open(browser, base + "/admin.html#events", { runs: seed(), calls: [] }, 375);
  await small.page.waitForSelector("#cal-rows tr td.rank", { timeout: 5000 });
  const touch = (type, x, y) => small.page.evaluate(([type, x, y]) => {
    const bar = document.querySelector("#cal-strip .cal-festa");
    (type === "pointerdown" ? bar : document).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", button: 0, clientX: x, clientY: y }));
  }, [type, x, y]);
  await small.page.$eval("#cal-strip .cal-festa", (n) => n.scrollIntoView({ block: "center", inline: "start" }));
  const sb = await (await small.page.$("#cal-strip .cal-festa")).boundingBox();
  const sx = sb.x + 20, sy = sb.y + 10;
  await touch("pointerdown", sx, sy);
  await touch("pointermove", sx + 30, sy);
  await touch("pointerup", sx + 30, sy);
  check("375: a swipe doesn't drag", await small.page.isHidden("#cal-change"));
  await touch("pointerdown", sx, sy);
  await small.page.waitForTimeout(600);
  check("375: held", await small.page.$eval("#cal-strip .cal-festa", (n) => n.classList.contains("is-held")));
  await touch("pointermove", sx + 10, sy);
  await touch("pointermove", sx + 40, sy);
  await touch("pointerup", sx + 40, sy);
  check("375: long press then drag shows the change", await small.page.isVisible("#cal-change"));
  const overflow = await small.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("375 with the change: no horizontal overflow", overflow <= 0, overflow + " px");
  check("375: the before/after table fits", await small.page.$eval("#cal-change .table-wrap", (n) => n.scrollWidth <= n.clientWidth));
  await small.page.click("label[for='cal-start'] + .help-tip");
  check("375: help opens on tap", await small.page.isVisible("label[for='cal-start'] ~ .help-pop"));
  check("375 help: no horizontal overflow", (await small.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await shot(small.page, "admin-events-drag-375.png");
  check("375 drag: no page errors", small.errors.length === 0, small.errors.join("; "));
  await small.page.close();
}

async function eventsPage(browser, base) {
  const next = { now: NOW, current: null, next: { id: 5, event: "festa", name: "Hunter Festival", lane: "featured", startsAt: "2026-11-17T15:00:00Z",
    coreEndsAt: "2026-12-21T03:00:00Z", endsAt: "2027-01-12T17:30:00Z", status: "planned", phases: null }, runs: [] };
  let r = await open(browser, base + "/events.html", { calls: [], calendar: next }, 1280);
  await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  const line = await r.page.$eval("#events-next", (n) => n.textContent).catch(() => "");
  check("events: next line", /^Next: Hunter Festival from .*17.*\.$/.test(line), line);
  await shot(r.page, "events-next-1280.png");
  check("events: no page errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  const now = Object.assign({}, next, { current: next.next, next: { id: 6, event: "vs_bracket", name: "VS Bracket", startsAt: "2026-12-21T03:00:00Z" } });
  r = await open(browser, base + "/events.html", { calls: [], calendar: now }, 375);
  await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  const both = await r.page.$eval("#events-next", (n) => n.textContent).catch(() => "");
  check("events: now and next", /^Now: Hunter Festival \(to .+\)\. Next: VS Bracket from .+\.$/.test(both), both);
  await shot(r.page, "events-next-375.png");
  await r.page.close();

  for (const [label, calendar] of [["404", undefined], ["nothing planned", { now: NOW, current: null, next: null, runs: [] }]]) {
    r = await open(browser, base + "/events.html", { calls: [], calendar }, 1280);
    await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
    check("events " + label + ": no line", (await r.page.$$("#events-next")).length === 0);
    check("events " + label + ": no page errors", r.errors.length === 0, r.errors.join("; "));
    await r.page.close();
  }
}

(async () => {
  helpers();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await adminPage(browser, base);
    await dragPage(browser, base);
    await eventsPage(browser, base);
  } catch (e) {
    failures.push("crashed: " + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log("FAIL\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("admin events OK");
})();
