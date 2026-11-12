#!/usr/bin/env node
/* Checks the event calendar on the website in headless Chromium against a fake API (shapes as the API's README,
   section "Event calendar"):

   - admin.html#events: the strip (bars per lane, tails, the now line), the warnings, the 7-day list, the runs
     with Erupe's status ("waiting for the game server" without phases), a run's phases on click; adding a run
     (the live check, its reasons, the request body, times read as UTC); changing a planned run (PUT); delete
     and stop after the current cycle only on the second click; the note of a started run; extending the loop
     (preview, then add); a note with markup stays text; no horizontal overflow at 375 px;
   - the strip's two lanes (main and side event, each run in its event's lane; a transition run too, labelled
     "(transition)" and covering its lane until it ends), the gaps
     (red in the lane that has no run: no main event, no side event), "Running now", the gap list and "Fill this
     gap" (the lane's first event); no lane field in the form, the lane under the event; the side lane's
     Thursday 15:00 boundary when dragging; one "extend the loop" form per lane (sends lane main or side); dragging a planned run (move, resize an edge) with the mouse: the live tip with the
     rules' verdict, the before/after preview, the API's check with ?id=, Save as a PUT of the whole run;
     Cancel; the keyboard (arrows, Shift, Escape); a long press at 375 px; started runs can't move; a "?" circle
     with its text for every field of the form, each event's settings and the loop; the Ends field;
   - events.html: "Now: ... Next: ... from ..." and "Side event now: ... Next: ..." from
     /api/public/events/calendar, and no line when the API has no calendar (404) or nothing is planned;
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
    { id: 5, event: "festa", lane: "featured", eventLane: "featured", status: "planned", startsAt: "2026-11-16T03:00:00Z", coreEndsAt: "2026-11-30T03:00:00Z", endsAt: "2026-12-14T03:00:00Z" },
    { id: 6, event: "diva", lane: "featured", eventLane: "featured", status: "cancelled", startsAt: "2026-11-16T03:00:00Z", coreEndsAt: "2026-11-30T03:00:00Z", endsAt: "2026-12-07T03:00:00Z" },
    { id: 7, event: "diva", lane: "background", eventLane: "featured", status: "done", startsAt: "2026-01-05T03:00:00Z", coreEndsAt: "2026-01-19T03:00:00Z", endsAt: "2026-01-26T03:00:00Z" }
  ], Date.parse("2026-11-04T00:00:00Z"), 12);
  check("timeline: cancelled and past runs left out", g.bars.length === 1, JSON.stringify(g.bars));
  const b = g.bars[0] || {};
  const week = 100 / 12;
  check("timeline: geometry", Math.abs(b.left - 2 * week) < 1e-9 && Math.abs(b.core - 2 * week) < 1e-9 && Math.abs(b.tail - 2 * week) < 1e-9, JSON.stringify(b));
  const stacked = Cal.timeline([
    { id: 1, event: "festa", lane: "featured", eventLane: "featured", startsAt: "2026-11-16T03:00:00Z", coreEndsAt: "2026-11-30T03:00:00Z", endsAt: "2026-12-14T03:00:00Z" },
    { id: 2, event: "diva", lane: "background", eventLane: "featured", startsAt: "2026-11-30T03:00:00Z", coreEndsAt: "2026-12-14T03:00:00Z", endsAt: "2026-12-21T03:00:00Z" },
    { id: 3, event: "diva", lane: "featured", eventLane: "featured", startsAt: "2026-12-14T03:00:00Z", coreEndsAt: "2026-12-28T03:00:00Z", endsAt: "2027-01-04T03:00:00Z" },
    { id: 4, event: "vs_bracket", lane: "side", eventLane: "side", startsAt: "2026-11-19T15:00:00Z", coreEndsAt: "2026-12-03T15:00:00Z", endsAt: "2026-12-03T15:00:00Z" }
  ], Date.parse("2026-11-04T00:00:00Z"), 12);
  check("timeline: a run is in its event's lane (a transition row too); a tail beside the next core gets its own row, back to back shares one",
    stacked.bars.map((x) => x.lane + x.row).join() === "featured0,side0,featured1,featured0" && stacked.rows.featured === 2 && stacked.rows.side === 1
    && stacked.bars.filter((x) => x.transition).length === 1, JSON.stringify(stacked.bars.map((x) => x.lane + x.row)));
  check("timeline: ticks", g.ticks.length === 12 && g.ticks[0].label === "2 Nov", JSON.stringify(g.ticks[0]));
  check("laneOf: eventLane first, else the event's", Cal.laneOf({ event: "diva", lane: "background", eventLane: "featured" }) === "featured"
    && Cal.laneOf({ event: "speedrun_cup", lane: "background" }) === "side" && Cal.laneOf({ event: "vs_bracket", eventLane: "side" }) === "side"
    && Cal.laneOf({ event: "festa" }) === "featured");
  check("lane names", Cal.LANE_NAMES.featured === "Main event" && Cal.LANE_NAMES.side === "Side event");
  const s = Cal.soon([{ id: 1, name: "Speedrun Cup", status: "running", startsAt: "2026-11-05T15:00:00Z", coreEndsAt: "2026-11-12T15:00:00Z", endsAt: "2026-11-12T15:00:00Z" },
    { id: 2, name: "Hunter Festival", status: "planned", startsAt: "2026-11-17T15:00:00Z", coreEndsAt: "2026-12-21T03:00:00Z", endsAt: "2027-01-12T17:30:00Z" }],
  Date.parse("2026-11-11T00:00:00Z"));
  check("soon", s.join("|") === "Thu 12 Nov 2026 15:00: Speedrun Cup #1 ends|Tue 17 Nov 2026 15:00: Hunter Festival #2 starts", s.join("|"));
  const body = Cal.body({ event: "speedrun_cup", lane: "side", start: "2027-04-01T15:00", core: "", note: "",
    anyTime: false, settings: { first_cycle: "", cycles: "2", cycle_days: "7", open_days: "6", tally_hours: "1" } });
  check("body: no lane (the API takes it from the event)", JSON.stringify(body) === JSON.stringify({ event: "speedrun_cup", startsAt: "2027-04-01T15:00:00Z",
    coreEndsAt: null, settings: { cycles: 2, cycle_days: 7, open_days: 6, tally_hours: 1 }, note: null, allowAnyTime: false }), JSON.stringify(body));
  check("phaseLines none", Cal.phaseLines({ phases: null }) === null);
  const lines = Cal.phaseLines({ phases: [{ name: "cycle", starts_at: "2026-11-05T15:00:00Z", ends_at: "2026-11-12T15:00:00Z", cycle: 0, open_ends_at: "2026-11-11T15:00:00Z" }] });
  check("phaseLines", lines && lines[0] === "cycle: Thu 5 Nov 2026 15:00 to Thu 12 Nov 2026 15:00 (cycle 0, open ends at Wed 11 Nov 2026 15:00)", lines && lines[0]);
  // Drag and resize, the rules while dragging, gaps, help texts.
  const festa = { id: 5, event: "festa", lane: "featured", eventLane: "featured", status: "planned", note: "keep me", startsAt: "2026-11-17T15:00:00Z",
    coreEndsAt: "2026-12-21T03:00:00Z", endsAt: "2027-01-12T17:30:00Z", settings: { entry_hours: 336, souls_hours: 504, judging_hours: 2.5, rewards_hours: 504 } };
  const vs = { id: 6, event: "vs_bracket", lane: "side", eventLane: "side", status: "planned", startsAt: "2026-12-24T15:00:00Z", coreEndsAt: "2027-01-07T15:00:00Z",
    endsAt: "2027-01-07T15:00:00Z", settings: { first_cycle: 1, cycles: 1, cycle_days: 14, registration_days: 3, round_days: 2, max_rounds: 5 } };
  const cup = { id: 3, event: "speedrun_cup", lane: "side", eventLane: "side", status: "running", startsAt: "2026-11-05T15:00:00Z", coreEndsAt: "2026-11-19T15:00:00Z",
    endsAt: "2026-11-19T15:00:00Z", settings: { first_cycle: 0, cycles: 2, cycle_days: 7, open_days: 6, tally_hours: 1 } };
  const diva = { id: 2, event: "diva", lane: "background", eventLane: "featured", status: "running", startsAt: "2026-11-02T03:00:00Z", coreEndsAt: "2026-11-16T03:00:00Z",
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
  const rv = Cal.resizeRun(vs, "end", T("2027-01-20T10:00:00Z"));
  check("resize VS end: whole cycles", rv.settings.cycles === 2 && rv.endsAt === "2027-01-21T15:00:00Z" && rv.coreEndsAt === rv.endsAt && !rv.explicitCore, JSON.stringify(rv));
  const rvs = Cal.resizeRun(vs, "start", T("2026-12-10T00:00:00Z"));
  check("resize VS start: whole cycles, end kept", rvs.settings.cycles === 2 && rvs.startsAt === "2026-12-10T15:00:00Z" && rvs.endsAt === vs.endsAt, JSON.stringify(rvs));
  const now = T("2026-11-10T00:00:00Z");
  // Two lanes: one event at a time in each.
  const early = Cal.ruleProblems(Cal.moveRun(vs, -42 * D), [festa, cup, diva], now);
  check("rules: side cores overlap (the main lane's runs don't count)", early.problems.length === 1 && /overlaps the Speedrun Cup run #3's core.*only one side event at a time/.test(early.problems[0]), JSON.stringify(early));
  check("rules: Thursday 15:00 is the side lane's soft rule", early.boundary.length === 0 && Cal.ruleProblems(vs, [festa], now).boundary.length === 0
    && Cal.ruleProblems(Cal.moveRun(vs, -10 * D), [], now).boundary.length === 2
    && /Thursday 15:00 UTC/.test(Cal.ruleProblems(Cal.moveRun(vs, -10 * D), [], now).boundary[0]), JSON.stringify(Cal.ruleProblems(Cal.moveRun(vs, -10 * D), [], now).boundary));
  const mainB = Cal.ruleProblems(festa, [], now).boundary;
  check("rules: Monday 03:00 is the main lane's (the festival's start is a Tuesday, its core end a Monday)", mainB.length === 1 && /^The start is not on a Monday 03:00 UTC/.test(mainB[0]), JSON.stringify(mainB));
  const mainOverlap = Cal.ruleProblems(Object.assign({}, diva, { id: 8, lane: "featured", status: "planned", startsAt: "2026-12-14T03:00:00Z", coreEndsAt: "2026-12-28T03:00:00Z", endsAt: "2027-01-04T03:00:00Z" }), [festa, vs], now);
  check("rules: main cores overlap", mainOverlap.problems.length === 1 && /overlaps the Hunter Festival run #5's core.*only one main event at a time/.test(mainOverlap.problems[0]), JSON.stringify(mainOverlap));
  check("rules: a transition run blocks no one", !Cal.ruleProblems(Cal.moveRun(festa, -2 * D), [diva], now).problems.some((p) => /overlaps/.test(p)));
  check("rules: a transition run has no boundary", Cal.ruleProblems(diva, [], T("2026-10-01T00:00:00Z")).boundary.length === 0);
  check("rules: same event, tails included", Cal.ruleProblems(Object.assign({}, festa, { id: 9 }), [festa], now).problems.some((p) => /one run of an event at a time/.test(p)));
  check("rules: souls at least 7 days", Cal.ruleProblems(Cal.resizeRun(own, "core", T("2026-12-03T15:00:00Z")), [], now).problems.some((p) => /168/.test(p)));
  check("rules: an hour ahead", Cal.ruleProblems(Cal.moveRun(vs, T("2026-11-10T00:30:00Z") - T(vs.startsAt)), [], now).problems.some((p) => /an hour from now/.test(p)));
  const cupBad = { id: 7, event: "speedrun_cup", lane: "side", eventLane: "side", startsAt: "2027-02-04T15:00:00Z", coreEndsAt: "2027-02-11T15:00:00Z", endsAt: "2027-02-11T15:00:00Z",
    settings: { first_cycle: 0, cycles: 1, cycle_days: 7, open_days: 7, tally_hours: 1 } };
  const cupR = Cal.ruleProblems(cupBad, [Object.assign({}, cup, { lane: "background" })], now).problems.join(" ");
  check("rules: Cup open + tally, cycle numbers", /an hour before the cycle/.test(cupR) && /already used/.test(cupR), cupR);
  const cov = Cal.coverage([festa, vs, diva], now, T("2027-02-01T03:00:00Z"));
  const gl = cov.gaps.map((g) => g.lane + " " + new Date(g.from).toISOString().slice(0, 16) + " " + new Date(g.to).toISOString().slice(0, 16) + " " + g.running.join("+"));
  check("coverage: gaps of both lanes (a transition row counts in its event's lane, to its end), by time", gl.join("|") === "side 2026-11-10T00:00 2026-12-24T15:00 "
    + "|featured 2026-12-21T03:00 2027-02-01T03:00 Hunter Festival|side 2027-01-07T15:00 2027-02-01T03:00 ", gl.join("|"));
  const at = Cal.runningAt(cov.pieces, T("2026-11-20T00:00:00Z"));
  check("runningAt: a run's own core wins over a transition row", at && at.featured === 5 && at.side === null && at.runs.map((r) => r.id + r.part).join() === "5core,2tail", JSON.stringify(at));
  const week3 = Cal.runningAt(cov.pieces, T("2026-11-16T12:00:00Z"));
  check("coverage: a transition row covers its lane in its tail too (Diva week 3, 16-17 Nov: no gap)", week3 && week3.featured === 2
    && week3.runs.filter((r) => r.lane === "featured").map((r) => r.id + r.part).join() === "2tail", JSON.stringify(week3));
  const regular = Cal.coverage([festa, Object.assign({}, diva, { lane: "featured" })], now, T("2026-11-20T00:00:00Z"));
  check("coverage: a regular run covers its lane with its core only", regular.gaps.map((g) => g.lane + " " + new Date(g.from).toISOString().slice(0, 16)).join("|")
    === "side 2026-11-10T00:00|featured 2026-11-16T03:00", JSON.stringify(regular.gaps));
  check("howLong", Cal.howLong(0, (12 * 24 + 21) * H) === "12 d 21 h" && Cal.howLong(0, 2 * D) === "2 d" && Cal.howLong(0, 5 * H) === "5 h");
  check("snap", Cal.snap(T("2026-11-10T10:31:00Z")) === T("2026-11-10T11:00:00Z") && Cal.snap(T("2026-11-10T16:00:00Z"), true) === T("2026-11-11T03:00:00Z")
    && Cal.snap(T("2026-11-10T16:00:00Z"), true, "side") === T("2026-11-10T15:00:00Z"));
  check("onBoundary by lane", Cal.onBoundary(T("2026-11-16T03:00:00Z")) && Cal.onBoundary(T("2026-11-16T03:00:00Z"), "featured") && !Cal.onBoundary(T("2026-11-16T03:00:00Z"), "side")
    && Cal.onBoundary(T("2026-11-19T15:00:00Z"), "side") && !Cal.onBoundary(T("2026-11-19T15:00:00Z")) && !Cal.onBoundary(T("2026-11-19T15:01:00Z"), "side"));
  check("boundaries of the side lane", Cal.boundaries("side", T("2026-11-09T03:00:00Z"), T("2026-11-30T03:00:00Z")).map((t) => new Date(t).toISOString()).join()
    === "2026-11-12T15:00:00.000Z,2026-11-19T15:00:00.000Z,2026-11-26T15:00:00.000Z");
  check("draftBody: own core left out, note kept, no lane", JSON.stringify(Cal.draftBody(rv, true)) === JSON.stringify({ event: "vs_bracket",
    startsAt: vs.startsAt, coreEndsAt: null, settings: rv.settings, note: null, allowAnyTime: true }) && Cal.draftBody(mv).note === "keep me"
    && Cal.draftBody(mv).coreEndsAt === "2026-12-22T05:00:00Z");
  ["event", "lane", "starts_at", "core_ends_at", "ends_at", "note", "any_time", "diva", "gen_from", "gen_first", "gen_weeks"].forEach((k) =>
    check("help text: " + k, (Cal.help(k) || "").length > 40));
  check("help text: lane says what is main and what is side", /Main event: Hunter Festival or Diva Defense/.test(Cal.help("lane")) && /Side event: Speedrun Cup or VS Bracket/.test(Cal.help("lane")), Cal.help("lane"));
  Object.keys(Cal.FIELDS).forEach((e) => Cal.FIELDS[e].forEach((f) => check("help text: " + e + "." + f[0], (Cal.help(f[0], e) || "").length > 40)));
  check("events: calendarLine none", Events.calendarLine(null) === null && Events.calendarLine({ current: null, next: null }) === null);
  const line = Events.calendarLine({ current: null, next: { name: "Hunter Festival", startsAt: "2026-11-17T15:00:00Z" } }) || "";
  check("events: calendarLine next", /^Next: Hunter Festival from .+\.$/.test(line), line);
  check("events: sideLine none", Events.sideLine(null) === null && Events.sideLine({ current: { name: "x", coreEndsAt: NOW }, sideCurrent: null, sideNext: null }) === null);
  const sline = Events.sideLine({ sideCurrent: { name: "Speedrun Cup", coreEndsAt: "2026-11-19T15:00:00Z" }, sideNext: { name: "VS Bracket", startsAt: "2026-11-19T15:00:00Z" } }) || "";
  check("events: sideLine now and next", /^Side event now: Speedrun Cup \(to .+\)\. Next: VS Bracket from .+\.$/.test(sline), sline);
  check("events: sideLine next only", /^Side event next: VS Bracket from .+\.$/.test(Events.sideLine({ sideNext: { name: "VS Bracket", startsAt: "2026-11-19T15:00:00Z" } }) || ""));
}

/* ---- the fake API ---- */

const NOW = "2026-11-10T00:00:00Z";
const CUP_PHASES = [{ name: "cycle", starts_at: "2026-11-05T15:00:00Z", ends_at: "2026-11-12T15:00:00Z", cycle: 0,
  open_ends_at: "2026-11-11T15:00:00Z", tally_ends_at: "2026-11-11T16:00:00Z" }];

function seed() {
  const lanes = { festa: "featured", diva: "featured", speedrun_cup: "side", vs_bracket: "side" };
  const laneNames = { featured: "Main event", side: "Side event", background: "Transition" };
  const run = (id, event, name, lane, status, s, c, e, settings, extra) => Object.assign({ id, event, name, lane, laneName: laneNames[lane],
    eventLane: lanes[event], status, startsAt: s, coreEndsAt: c, endsAt: e, settings, phases: null, note: null, createdBy: "seed-2026-11-b", createdAt: NOW,
    updatedBy: null, updatedAt: NOW, started: Date.parse(s) <= Date.parse(NOW), editable: status === "planned" && Date.parse(s) > Date.parse(NOW) }, extra || {});
  return [
    run(2, "diva", "Diva Defense", "background", "running", "2026-11-02T03:00:00Z", "2026-11-16T03:00:00Z", "2026-11-23T03:00:00Z", {},
      { phases: [{ name: "personal", starts_at: "2026-11-02T03:00:00Z", ends_at: "2026-11-09T02:00:00Z" }], note: "<b>Diva event 1</b>" }),
    run(3, "speedrun_cup", "Speedrun Cup", "side", "running", "2026-11-05T15:00:00Z", "2026-11-19T15:00:00Z", "2026-11-19T15:00:00Z",
      { first_cycle: 0, cycles: 2, cycle_days: 7, open_days: 6, tally_hours: 1 }, { phases: CUP_PHASES }),
    run(5, "festa", "Hunter Festival", "featured", "planned", "2026-11-17T15:00:00Z", "2026-12-21T03:00:00Z", "2027-01-12T17:30:00Z",
      { entry_hours: 336, souls_hours: 504, judging_hours: 2.5, rewards_hours: 504 }),
    run(6, "vs_bracket", "VS Bracket", "side", "planned", "2026-12-24T15:00:00Z", "2027-01-07T15:00:00Z", "2027-01-07T15:00:00Z",
      { first_cycle: 1, cycles: 1, cycle_days: 14, registration_days: 3, round_days: 2, max_rounds: 5 })
  ];
}

const RULES = { events: [
  { event: "festa", name: "Hunter Festival", lane: "featured", loopSettings: { entry_hours: 168, souls_hours: 168, judging_hours: 2.5, rewards_hours: 333.5 } },
  { event: "vs_bracket", name: "VS Bracket", lane: "side", loopSettings: { cycles: 1, cycle_days: 14, registration_days: 3, round_days: 2, max_rounds: 5 } },
  { event: "diva", name: "Diva Defense", lane: "featured", loopSettings: {} },
  { event: "speedrun_cup", name: "Speedrun Cup", lane: "side", loopSettings: { cycles: 1, cycle_days: 7, open_days: 6, tally_hours: 1 } }],
  lanes: ["featured", "side", "background"], laneNames: { featured: "Main event", side: "Side event", background: "Transition" },
  boundary: "Monday 03:00 UTC", boundaries: { featured: "Monday 03:00 UTC", side: "Thursday 15:00 UTC" }, loops: { featured: 28, side: 21 }, loopDays: 28 };

// What generate answers per lane: the first run of the main loop is there already (skipped).
const GENERATED = { main: ["festa", "diva", "festa", "diva"].map((e, i) => ({ event: e, name: e, startsAt: "2027-0" + (3 + i) + "-01T03:00:00Z",
  coreEndsAt: "2027-0" + (3 + i) + "-15T03:00:00Z", endsAt: "2027-0" + (3 + i) + "-20T03:00:00Z", settings: {}, exists: i === 0, problems: [] })),
side: ["speedrun_cup", "vs_bracket"].map((e, i) => ({ event: e, name: e, startsAt: "2027-03-" + (18 + 7 * i) + "T15:00:00Z",
  coreEndsAt: "2027-03-" + (25 + 7 * i) + "T15:00:00Z", endsAt: "2027-03-" + (25 + 7 * i) + "T15:00:00Z", settings: { first_cycle: 2 + i }, exists: i === 0, problems: [] })) };
const SAVED = { main: 3, side: 1 };

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
      return reply(200, { now: NOW, tableReady: true, runs: api.runs, warnings: ["No main event from Mon 16 Nov 2026 03:00 UTC to Tue 17 Nov 2026 15:00 UTC."],
        loopNext: { lane: "main", from: "2027-03-15", first: "festa" }, sideLoopNext: { lane: "side", from: "2027-03-18", first: "speedrun_cup" },
        alwaysOn: ["MezFes (every day)", "Raviente"] });
    }
    if (p === "/api/admin/events/calendar/check") {
      // The lane's boundary by the event (the request has no lane): Monday for the main lane, Thursday for the side lane.
      const side = sent.event === "speedrun_cup" || sent.event === "vs_bracket";
      const onDay = sent.startsAt && new Date(sent.startsAt).getUTCDay() === (side ? 4 : 1);
      return reply(200, { event: sent.event, lane: side ? "side" : "featured", startsAt: sent.startsAt, coreEndsAt: "2027-03-29T03:00:00Z", endsAt: "2027-04-05T03:00:00Z",
        settings: sent.settings, problems: onDay || sent.allowAnyTime ? [] : ["The start (" + sent.startsAt + ") is not on a " + (side ? "Thursday 15:00" : "Monday 03:00") + " UTC; tick \"allow any time\" to use it anyway."],
        warnings: [] });
    }
    if (p === "/api/admin/events/calendar" && req.method() === "POST") {
      if (sent.note === "refuse me") return reply(400, { message: "Its core overlaps the VS Bracket run #6's core.", problems: ["Its core overlaps the VS Bracket run #6's core.", "Second reason."] });
      const r = { id: 20, event: sent.event, name: "Diva Defense", lane: "featured", laneName: "Main event", eventLane: "featured", status: "planned", startsAt: sent.startsAt,
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
      return reply(200, { message: null, runs: GENERATED[sent.lane], problems: [], warnings: [], saved: sent.dryRun ? 0 : SAVED[sent.lane], ids: sent.dryRun ? [] : [21, 22, 23].slice(0, SAVED[sent.lane]) });
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
  check("strip: bars per lane (main, side)", bars.join() === "2,2", bars.join());
  const laneNames = await page.$$eval("#cal-strip .cal-lane-name", (ns) => ns.map((n) => n.textContent));
  check("strip: lanes are labelled Main event and Side event", laneNames.join() === "Main event,Side event", laneNames.join());
  const laneOf = await page.$$eval("#cal-strip .cal-lane", (ls) => ls.map((l) => Array.from(l.querySelectorAll(".cal-bar")).map((b) => b.dataset.id).join("+")));
  check("strip: each run in its event's lane (the transition Diva in the main row, the Cup in the side row)", laneOf.join() === "2+5,3+6", laneOf.join());
  check("form: no lane field", (await page.$$("#cal-lane")).length === 0 && /^Main event/.test(await text(page, "#cal-lane-note")), await text(page, "#cal-lane-note"));
  check("strip: now line", (await page.$$("#cal-strip .cal-now")).length === 1);
  check("warnings", (await text(page, "#cal-warnings")).indexOf("No main event from Mon 16 Nov") !== -1);
  check("rows say the lane", (await page.$$eval("#cal-rows tr", (rs) => rs.map((r) => r.children[2].textContent))).join() === "Main event (transition),Side event,Main event,Side event");
  check("7 days", (await text(page, "#cal-soon")) === "Mon 16 Nov 2026, 03:00 UTC: Diva Defense #2 core ends (the next event may start)",
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
  check("detail: Erupe's phases", detail.indexOf("cycle: Thu 5 Nov 2026, 15:00 UTC to Thu 12 Nov 2026, 15:00 UTC (cycle 0") !== -1, detail);
  await page.click("#cal-strip .cal-festa");
  check("detail: lane in words", (await text(page, "#cal-detail")).indexOf("Main event. Starts") !== -1, await text(page, "#cal-detail"));
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
  check("computed ends", (await text(page, "#cal-computed")).indexOf("ends Mon 5 Apr 2027, 03:00 UTC") !== -1, await text(page, "#cal-computed"));
  await page.click("#cal-save");
  await page.waitForFunction(() => !document.getElementById("cal-ok").hidden, null, { timeout: 3000 }).catch(() => {});
  const created = last(api, "POST", "/api/admin/events/calendar");
  check("create body (no lane: the event decides it)", created && created.path === "/api/admin/events/calendar" && JSON.stringify(created.body) === JSON.stringify({ event: "diva",
    startsAt: "2027-03-15T03:00:00Z", coreEndsAt: null, settings: {}, note: "extra Diva", allowAnyTime: false }), created && JSON.stringify(created.body));
  check("create ok", (await text(page, "#cal-ok")).indexOf("Diva Defense #20 added") !== -1, await text(page, "#cal-ok"));
  await page.waitForFunction(() => document.querySelectorAll("#cal-rows tr").length === 5, null, { timeout: 3000 }).catch(() => check("list reloaded", false));

  // The side lane's boundary is a Thursday: a Cup on a Monday is refused, and on a Thursday passes.
  await page.selectOption("#cal-event", "speedrun_cup");
  check("form: the lane note follows the event", /^Side event.*Thursday 15:00 UTC/.test(await text(page, "#cal-lane-note")), await text(page, "#cal-lane-note"));
  await page.fill("#cal-start", "2027-03-15T15:00");
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("not on a Thursday 15:00") !== -1, null, { timeout: 3000 })
    .catch(() => check("side lane: the live check names Thursday 15:00", false));
  await page.fill("#cal-start", "2027-03-18T15:00");
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("The checks pass.") !== -1, null, { timeout: 3000 })
    .catch(() => check("side lane: a Thursday passes", false));
  await page.selectOption("#cal-event", "diva");
  await page.fill("#cal-start", "2027-03-15T03:00");

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
  check("edit is a PUT with the settings, no lane", put && put.body.settings.souls_hours === 504 && put.body.lane === undefined && put.body.note === "moved" && put.body.startsAt === "2026-11-17T15:00:00Z",
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

  // Extend the loop: one form per lane, each prefilled from its own loop next; preview, then add.
  check("loop prefilled, main", (await page.inputValue("#cal-gen-from")) === "2027-03-15" && (await page.inputValue("#cal-gen-first")) === "festa");
  check("loop prefilled, side (sideLoopNext)", (await page.inputValue("#cal-gen-side-from")) === "2027-03-18" && (await page.inputValue("#cal-gen-side-first")) === "speedrun_cup");
  check("loop: one preview button per lane, with the side lane's events", (await text(page, "#cal-gen-preview")) === "Preview" && (await text(page, "#cal-gen-side-preview")) === "Preview"
    && (await page.$$eval("#cal-gen-first option", (o) => o.map((x) => x.value))).join() === "festa,diva"
    && (await page.$$eval("#cal-gen-side-first option", (o) => o.map((x) => x.value))).join() === "speedrun_cup,vs_bracket");
  await page.fill("#cal-gen-weeks", "8");
  await page.click("#cal-gen-preview");
  await page.waitForSelector("#cal-gen-save:not([hidden])", { timeout: 3000 }).catch(() => check("preview offers to add", false));
  const dry = last(api, "POST", "/generate");
  check("preview body (lane main)", dry && JSON.stringify(dry.body) === JSON.stringify({ lane: "main", from: "2027-03-15", weeks: 8, first: "festa", dryRun: true }), dry && JSON.stringify(dry.body));
  check("preview list", (await text(page, "#cal-gen-list")).indexOf("(already there, skipped)") !== -1 && (await text(page, "#cal-gen-save")) === "Add these 3 runs");
  check("the side form is untouched by the main preview", await page.isHidden("#cal-gen-side-save"));
  await page.click("#cal-gen-save");
  await page.waitForTimeout(300);
  check("add the loop", last(api, "POST", "/generate").body.dryRun === false && last(api, "POST", "/generate").body.lane === "main" && (await text(page, "#cal-ok")).indexOf("3 runs added") !== -1);
  await page.click("#cal-gen-side-preview");
  await page.waitForSelector("#cal-gen-side-save:not([hidden])", { timeout: 3000 }).catch(() => check("side preview offers to add", false));
  const sdry = last(api, "POST", "/generate");
  check("preview body (lane side)", sdry && JSON.stringify(sdry.body) === JSON.stringify({ lane: "side", from: "2027-03-18", weeks: 6, first: "speedrun_cup", dryRun: true }), sdry && JSON.stringify(sdry.body));
  check("side preview list", (await text(page, "#cal-gen-side-list")).indexOf("(already there, skipped)") !== -1 && (await text(page, "#cal-gen-side-save")) === "Add these 1 run");
  await page.click("#cal-gen-side-save");
  await page.waitForTimeout(300);
  check("add the side loop", last(api, "POST", "/generate").body.lane === "side" && last(api, "POST", "/generate").body.dryRun === false && (await text(page, "#cal-ok")).indexOf("1 run added to the side lane") !== -1, await text(page, "#cal-ok"));
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
  check("running now: a main and a side event", running === "Running now: Main event: Diva Defense #2 (transition); Side event: Speedrun Cup #3.", running);
  // The transition Diva (#2) covers the main lane to its end (23 Nov): no gap 16-17 Nov.
  check("strip: three red gaps, one in the main row, two in the side row", (await page.$$("#cal-strip .cal-gap.is-empty")).length === 3
    && (await page.$$eval("#cal-strip .cal-lane", (ls) => ls.map((l) => l.querySelectorAll(".cal-gap").length))).join() === "1,2");
  const gaps = await page.$$eval("#cal-gaps li", (ls) => ls.map((l) => l.textContent));
  check("gap list: both kinds, by time", gaps.length === 3
    && /^No side event Thu 19 Nov 2026, 15:00 UTC to Thu 24 Dec 2026, 15:00 UTC, 35 d\.Fill this gap$/.test(gaps[0])
    && /^No main event Mon 21 Dec 2026, 03:00 UTC to Mon 1 Feb 2027, 03:00 UTC, .*nothing is planned after.*Still on: Hunter Festival\.Fill this gap$/.test(gaps[1])
    && /^No side event Thu 7 Jan 2027, 15:00 UTC to Mon 1 Feb 2027, 03:00 UTC, .*nothing is planned after.*Fill this gap$/.test(gaps[2]), gaps.join(" | "));
  check("strip: a transition run says so on its bar", await text(page, '#cal-strip .cal-bar[data-id="2"] .cal-core') === "Diva Defense (transition)"
    && await text(page, '#cal-strip .cal-bar[data-id="5"] .cal-core') === "Hunter Festival", await text(page, '#cal-strip .cal-bar[data-id="2"] .cal-core'));
  const g = await geometry(page);
  await page.mouse.move(xOf(g, "2026-11-20T00:00:00Z"), (await (await page.$("#cal-strip .cal-festa")).boundingBox()).y + 10);
  check("pointing says what runs then, per lane", await text(page, "#cal-at") === "Fri 20 Nov 2026, 00:00 UTC: Main event: Hunter Festival #5, Diva Defense #2 (tail, transition); Side event: no side event (a gap).", await text(page, "#cal-at"));

  // Fill this gap: the form starts at the gap (an hour ahead at least), on the lane's boundary (no "any time").
  await page.click("#cal-gaps li:nth-child(2) button");
  check("fill main gap: start, event, lane note, boundary kept", (await page.inputValue("#cal-start")) === "2026-12-21T03:00" && (await page.inputValue("#cal-event")) === "festa"
    && /^Main event/.test(await text(page, "#cal-lane-note")) && !(await page.isChecked("#cal-anytime")), await page.inputValue("#cal-start"));
  check("fill: hint", /^Filling Mon 21 Dec 2026, 03:00 UTC to Mon 1 Feb 2027, 03:00 UTC \(42 d\)/.test(await text(page, "#cal-gap-hint")), await text(page, "#cal-gap-hint"));
  check("fill: Ends from the settings", (await page.inputValue("#cal-end")) === "2027-01-18T03:00", await page.inputValue("#cal-end"));
  await page.waitForFunction(() => document.getElementById("cal-problems").textContent.indexOf("The checks pass.") !== -1, null, { timeout: 3000 })
    .catch(() => check("fill: checked", false));
  // The side lane's gap switches the event to the side lane's first (the Cup) and starts on a Thursday 15:00.
  await page.click("#cal-gaps li:nth-child(1) button");
  check("fill side gap: Cup, Thursday 15:00, side lane note", (await page.inputValue("#cal-event")) === "speedrun_cup" && (await page.inputValue("#cal-start")) === "2026-11-19T15:00"
    && /^Side event/.test(await text(page, "#cal-lane-note")) && !(await page.isChecked("#cal-anytime")), await page.inputValue("#cal-event") + " " + await page.inputValue("#cal-start"));
  check("fill side gap: the cycles that fit", (await page.inputValue("#cal-s-cycles")) === "5" && (await page.inputValue("#cal-end")) === "2026-12-24T15:00", await page.inputValue("#cal-s-cycles") + " " + await page.inputValue("#cal-end"));
  // A new end changes the last length: the Cup's cycles.
  await page.fill("#cal-end", "2026-12-10T15:00");
  await page.dispatchEvent("#cal-end", "change");
  check("Ends: Cup cycles follow", (await page.inputValue("#cal-s-cycles")) === "3" && (await page.inputValue("#cal-end")) === "2026-12-10T15:00", await page.inputValue("#cal-s-cycles"));
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
  for (const id of ["cal-event", "cal-lane-note", "cal-start", "cal-core", "cal-end", "cal-note-text", "cal-anytime", "cal-gen-from", "cal-gen-first", "cal-gen-weeks", "cal-gen-side-from", "cal-gen-side-first", "cal-gen-side-weeks"]) {
    check("help circle: " + id, (await helpFor(id)).length > 40);
  }
  for (const [ev, keys] of Object.entries(Cal.FIELDS)) {
    await page.selectOption("#cal-event", ev);
    for (const k of keys) check("help circle: " + ev + " " + k[0], (await helpFor("cal-s-" + k[0])).length > 40);
  }
  await page.selectOption("#cal-event", "diva");
  check("help circle: Diva weeks", /21 days/.test(await page.$eval("#cal-settings .help-pop", (n) => n.textContent)));
  await page.click("#cal-lane-label + .help-tip");
  check("help: click opens", await page.isVisible("#cal-lane-label ~ .help-pop") && (await page.getAttribute("#cal-lane-label + .help-tip", "aria-expanded")) === "true");
  const laneHelp = await text(page, "#cal-lane-label ~ .help-pop");
  check("help: the lane says main is Hunter Festival / Diva Defense, side is Speedrun Cup / VS Bracket", /Main event: Hunter Festival or Diva Defense/.test(laneHelp) && /Side event: Speedrun Cup or VS Bracket/.test(laneHelp), laneHelp);
  await page.keyboard.press("Escape");
  check("help: Escape closes", !(await page.isVisible("#cal-lane-label ~ .help-pop")));
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
  check("drag: the live tip (the start snaps to Monday 03:00; the hand-set core end moves off it)", await page.isVisible("#cal-strip .cal-tip") && tip.indexOf("Start Mon 23 Nov 2026, 03:00 UTC") !== -1
    && tip.indexOf("The core end is not on a Monday 03:00 UTC") !== -1, tip);
  check("drag: the bar says it is off the boundary (soft, not a refusal)", await page.$eval("#cal-strip .cal-festa", (n) => n.classList.contains("is-soft") && !n.classList.contains("is-bad")));
  await page.mouse.up();
  await page.waitForSelector("#cal-change:not([hidden])", { timeout: 3000 }).catch(() => check("drop: the change shows", false));
  const rows = await page.$$eval("#cal-change-rows tr", (rs) => rs.map((r) => r.textContent));
  check("drop: before and after", rows[0] === "StartsTue 17 Nov 2026, 15:00 UTCMon 23 Nov 2026, 03:00 UTC" && rows[1] === "Core endsMon 21 Dec 2026, 03:00 UTCSat 26 Dec 2026, 15:00 UTC"
    && rows.length === 7, rows.join(" | "));
  check("drop: no detail opened", await page.isHidden("#cal-detail"));
  await page.waitForFunction(() => document.getElementById("cal-change-problems").textContent.indexOf("API's checks pass") !== -1, null, { timeout: 3000 })
    .catch(() => check("drop: the API's check", false));
  const chk = last(api, "POST", "/check?id=5");
  check("drop: checked with ?id=", chk && chk.body.startsAt === "2026-11-23T03:00:00Z" && chk.body.coreEndsAt === "2026-12-26T15:00:00Z", chk && JSON.stringify(chk.body));
  await page.click("#cal-change-save");
  await page.waitForFunction(() => document.getElementById("cal-change").hidden, null, { timeout: 3000 }).catch(() => check("save closes the change", false));
  const put = last(api, "PUT", "/api/admin/events/calendar/5");
  check("save: a PUT of the whole run, note kept, no lane", put && JSON.stringify(put.body) === JSON.stringify({ event: "festa", startsAt: "2026-11-23T03:00:00Z",
    coreEndsAt: "2026-12-26T15:00:00Z", settings: { entry_hours: 336, souls_hours: 504, judging_hours: 2.5, rewards_hours: 504 }, note: "keep me", allowAnyTime: false }),
  put && JSON.stringify(put.body));
  check("save: said", (await text(page, "#cal-ok")).indexOf("Run #5 saved") !== -1);
  await page.waitForTimeout(200);

  // A side run dragged onto the Cup's core: refused live, the bar snaps to Thursday 15:00 (the side lane's boundary).
  const vb0 = await (await page.$("#cal-strip .cal-vs_bracket")).boundingBox();
  const vx = vb0.x + 40;
  await dragBy(page, "#cal-strip .cal-vs_bracket", vx, vx + (xOf(g, "2026-11-12T14:00:00Z") - xOf(g, "2026-12-24T15:00:00Z")));
  const vtip = await text(page, "#cal-strip .cal-tip");
  check("drag a side run: snaps to Thursday 15:00 and the overlap with the Cup's core is refused", vtip.indexOf("Start Thu 12 Nov 2026, 15:00 UTC") !== -1
    && vtip.indexOf("overlaps the Speedrun Cup run #3's core") !== -1 && vtip.indexOf("one side event at a time") !== -1
    && await page.$eval("#cal-strip .cal-vs_bracket", (n) => n.classList.contains("is-bad")), vtip);
  await page.mouse.up();
  await page.waitForSelector("#cal-change:not([hidden])", { timeout: 3000 }).catch(() => check("side drop: the change shows", false));
  const putsBefore = api.calls.filter((c) => c.method === "PUT").length;
  await page.click("#cal-change-cancel");
  check("side drop cancelled: nothing saved", api.calls.filter((c) => c.method === "PUT").length === putsBefore && await page.isHidden("#cal-change"));
  // Shift snaps to 15:00 of the nearest day in the side lane.
  const vb1 = await (await page.$("#cal-strip .cal-vs_bracket")).boundingBox();
  await page.keyboard.down("Shift");
  await dragBy(page, "#cal-strip .cal-vs_bracket", vb1.x + 40, vb1.x + 40 + (xOf(g, "2026-12-10T05:00:00Z") - xOf(g, "2026-12-24T15:00:00Z")));
  check("Shift snaps a side run to 15:00", (await text(page, "#cal-strip .cal-tip")).indexOf("Start Thu 10 Dec 2026, 15:00 UTC") !== -1 || (await text(page, "#cal-strip .cal-tip")).indexOf("Start Wed 9 Dec 2026, 15:00 UTC") !== -1, await text(page, "#cal-strip .cal-tip"));
  await page.keyboard.up("Shift");
  await page.mouse.up();
  await page.waitForSelector("#cal-change:not([hidden])", { timeout: 3000 }).catch(() => {});
  await page.click("#cal-change-cancel");

  // Resize the VS Bracket's end by two weeks: two cycles; Cancel puts it back.
  const vb = await (await page.$("#cal-strip .cal-vs_bracket")).boundingBox();
  const before = await page.$eval("#cal-strip .cal-vs_bracket", (n) => n.style.width);
  const endX = vb.x + vb.width - 3;
  await dragBy(page, "#cal-strip .cal-vs_bracket", endX, endX + (xOf(g, "2027-01-21T15:00:00Z") - xOf(g, "2027-01-07T15:00:00Z")));
  await page.mouse.up();
  await page.waitForSelector("#cal-change:not([hidden])", { timeout: 3000 }).catch(() => check("resize: the change shows", false));
  const vrows = await page.$$eval("#cal-change-rows tr", (rs) => rs.map((r) => r.textContent));
  check("resize: cycles 1 to 2", vrows.indexOf("Cycles12") !== -1 && vrows.indexOf("EndsThu 7 Jan 2027, 15:00 UTCThu 21 Jan 2027, 15:00 UTC") !== -1, vrows.join(" | "));
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
  check("keys: +1 h, +1 day, a cycle longer", krows[0] === "StartsThu 24 Dec 2026, 15:00 UTCFri 25 Dec 2026, 16:00 UTC" && krows.indexOf("Cycles12") !== -1, krows.join(" | "));
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
    coreEndsAt: "2026-12-21T03:00:00Z", endsAt: "2027-01-12T17:30:00Z", status: "planned", phases: null }, sideCurrent: null,
  sideNext: { id: 6, event: "vs_bracket", name: "VS Bracket", lane: "side", startsAt: "2026-12-24T15:00:00Z", coreEndsAt: "2027-01-07T15:00:00Z", endsAt: "2027-01-07T15:00:00Z" }, runs: [] };
  let r = await open(browser, base + "/events.html", { calls: [], calendar: next }, 1280);
  await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  const line = await r.page.$eval("#events-next", (n) => n.textContent).catch(() => "");
  check("events: next line", /^Next: Hunter Festival from .*17.*\.$/.test(line), line);
  const sideLine = await r.page.$eval("#events-side-next", (n) => n.textContent).catch(() => "");
  check("events: side event line (next only)", /^Side event next: VS Bracket from .*24.*\.$/.test(sideLine), sideLine);
  await shot(r.page, "events-next-1280.png");
  check("events: no page errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  const now = Object.assign({}, next, { current: next.next, next: { id: 7, event: "diva", name: "Diva Defense", startsAt: "2026-12-21T03:00:00Z" },
    sideCurrent: { id: 3, event: "speedrun_cup", name: "Speedrun Cup", lane: "side", startsAt: "2026-11-05T15:00:00Z", coreEndsAt: "2026-11-19T15:00:00Z", endsAt: "2026-11-19T15:00:00Z" } });
  r = await open(browser, base + "/events.html", { calls: [], calendar: now }, 375);
  await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
  const both = await r.page.$eval("#events-next", (n) => n.textContent).catch(() => "");
  check("events: now and next", /^Now: Hunter Festival \(to .+\)\. Next: Diva Defense from .+\.$/.test(both), both);
  const sboth = await r.page.$eval("#events-side-next", (n) => n.textContent).catch(() => "");
  check("events: side event now and next", /^Side event now: Speedrun Cup \(to .+\)\. Next: VS Bracket from .+\.$/.test(sboth), sboth);
  await shot(r.page, "events-next-375.png");
  await r.page.close();

  for (const [label, calendar] of [["404", undefined], ["nothing planned", { now: NOW, current: null, next: null, sideCurrent: null, sideNext: null, runs: [] }]]) {
    r = await open(browser, base + "/events.html", { calls: [], calendar }, 1280);
    await r.page.waitForSelector("#events-root .event-tile", { timeout: 5000 });
    check("events " + label + ": no line", (await r.page.$$("#events-next, #events-side-next")).length === 0);
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
