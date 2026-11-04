/* Admin: the event calendar (Events tab). The runs of the Hunter Festival, Diva Defense, the Speedrun Cup and
   the VS Bracket come from the API's /api/admin/events/calendar, which reads Erupe's event_calendar table; the
   game server reads the same table every minute and writes each run's status and phases back. This page never
   computes phases: it shows Erupe's. The API checks every change (the same rules as the game server and the
   table) and answers with reasons, which the form shows while you type. All times here are UTC. There are two
   lanes, one event at a time in each: the main event (Hunter Festival, Diva Defense; boundary Monday 03:00 UTC)
   and the side event (Speedrun Cup, VS Bracket; boundary Thursday 15:00 UTC). The lane is the event's: the form
   has no lane field. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var DAY = 86400000;
  var WEEKS = 12;

  var EVENTS = ["festa", "vs_bracket", "diva", "speedrun_cup"];
  var NAMES = { festa: "Hunter Festival", vs_bracket: "VS Bracket", diva: "Diva Defense", speedrun_cup: "Speedrun Cup" };
  // The settings of each event, as Erupe needs them (all of them), with the form's labels.
  var FIELDS = {
    festa: [["entry_hours", "Entry (hours)"], ["souls_hours", "Souls (hours)"], ["judging_hours", "Judging (hours)"], ["rewards_hours", "Rewards (hours)"]],
    diva: [],
    speedrun_cup: [["first_cycle", "First cycle"], ["cycles", "Cycles"], ["cycle_days", "Cycle (days)"], ["open_days", "Open (days)"], ["tally_hours", "Tally (hours)"]],
    vs_bracket: [["first_cycle", "First cycle"], ["cycles", "Cycles"], ["cycle_days", "Cycle (days)"], ["registration_days", "Sign-up (days)"], ["round_days", "Round (days)"], ["max_rounds", "Rounds (1-6)"]]
  };
  // The two lanes ("featured" is the API's word for the main lane). The lane is the event's.
  var LANES = ["featured", "side"];
  var LANE_NAMES = { featured: "Main event", side: "Side event" };
  var LANE_OF = { festa: "featured", diva: "featured", speedrun_cup: "side", vs_bracket: "side" };
  var LANE_FIRST = { featured: "festa", side: "speedrun_cup" };
  // Where each lane's runs start and its cores end: weekday (0 = Sunday), hour UTC, in words.
  var BOUNDARY = { featured: { day: 1, hour: 3, text: "Monday 03:00 UTC" }, side: { day: 4, hour: 15, text: "Thursday 15:00 UTC" } };
  var STATUS = { planned: "Planned", running: "Running", settling: "Settling", done: "Done", cancelled: "Cancelled" };

  /* ---------- pure helpers (tested under node by dev/check-admin-events.js) ---------- */

  function ms(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? null : t;
  }

  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** "Mon 23 Nov 2026 03:00" in UTC; "-" for nothing. */
  function utc(iso) {
    var t = ms(iso);
    if (t === null) return "-";
    var d = new Date(t);
    return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MO[d.getUTCMonth()] + " " + d.getUTCFullYear() + " "
      + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  /** An ISO time as a datetime-local value in UTC ("2026-11-23T03:00"). */
  function toInput(iso) {
    var t = ms(iso);
    return t === null ? "" : new Date(t).toISOString().slice(0, 16);
  }

  /** A datetime-local value read as UTC, as ISO; null when empty. */
  function fromInput(value) {
    if (!value) return null;
    var t = Date.parse(value + (value.length === 16 ? ":00" : "") + "Z");
    return isNaN(t) ? null : new Date(t).toISOString().replace(".000Z", "Z");
  }

  /** The lane a run is drawn and counted in: its event's (a transition row, lane "background", too). */
  function laneOf(run) {
    var lane = run.eventLane || LANE_OF[run.event];
    return lane === "side" ? "side" : "featured";
  }

  /** The Monday 03:00 UTC at or before t (the main lane's boundary; the strip's weeks start there). */
  function weekStart(t) {
    var d = new Date(t);
    var base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0);
    var back = (d.getUTCDay() + 6) % 7; // days since Monday
    var start = base - back * DAY;
    return start > t ? start - 7 * DAY : start;
  }

  /**
   * The strip's geometry: weeks from the Monday before now, a bar per run in [from, to) with the core and the
   * tail as percents, and the now line. Each run is in its event's lane (main or side), drawn there with a
   * transition row too.
   */
  function timeline(runs, now, weeks) {
    var from = weekStart(now), to = from + weeks * 7 * DAY, span = to - from;
    function pct(t) { return Math.max(0, Math.min(100, (t - from) / span * 100)); }
    var ticks = [];
    for (var w = 0; w < weeks; w++) {
      var t = from + w * 7 * DAY, d = new Date(t);
      ticks.push({ left: pct(t), label: d.getUTCDate() + " " + MO[d.getUTCMonth()] });
    }
    var bars = [];
    (runs || []).slice().sort(function (a, b) { return ms(a.startsAt) - ms(b.startsAt); }).forEach(function (r) {
      var s = ms(r.startsAt), c = ms(r.coreEndsAt), e = ms(r.endsAt);
      if (s === null || e === null || e <= from || s >= to || r.status === "cancelled") return;
      bars.push({ id: r.id, event: r.event, name: r.name || NAMES[r.event] || r.event,
        lane: laneOf(r), transition: r.lane === "background", status: r.status,
        left: pct(s), core: pct(c) - pct(s), tail: pct(e) - pct(c) });
    });
    // Runs that overlap in one lane (a tail beside the next core, a transition run) get their own row, so no
    // bar hides another.
    var ends = { featured: [], side: [] };
    bars.forEach(function (b) {
      var rows = ends[b.lane], i = 0;
      while (i < rows.length && rows[i] > b.left + 1e-9) i++;
      rows[i] = b.left + b.core + b.tail;
      b.row = i;
    });
    return { from: from, to: to, ticks: ticks, bars: bars, now: pct(now),
      rows: { featured: Math.max(1, ends.featured.length), side: Math.max(1, ends.side.length) } };
  }

  /** What changes in the next 7 days: starts, core ends and ends, by time. */
  function soon(runs, now) {
    var out = [];
    (runs || []).forEach(function (r) {
      if (r.status === "cancelled") return;
      var name = r.name || NAMES[r.event] || r.event;
      [["startsAt", "starts"], ["coreEndsAt", "core ends (the next event may start)"], ["endsAt", "ends"]].forEach(function (k) {
        var t = ms(r[k[0]]);
        if (t === null || t <= now || t > now + 7 * DAY) return;
        if (k[0] === "coreEndsAt" && r.coreEndsAt === r.endsAt) return; // said once by "ends"
        out.push({ t: t, text: utc(r[k[0]]) + ": " + name + " #" + r.id + " " + k[1] });
      });
    });
    return out.sort(function (a, b) { return a.t - b.t; }).map(function (x) { return x.text; });
  }

  /** The request body of the form's values (no lane: the API sets it from the event). Numbers stay numbers; an empty first cycle is left to the API. */
  function body(values) {
    var settings = {};
    (FIELDS[values.event] || []).forEach(function (f) {
      var v = values.settings[f[0]];
      if (v === "" || v === undefined || v === null) return;
      settings[f[0]] = Number(v);
    });
    return { event: values.event, startsAt: fromInput(values.start), coreEndsAt: fromInput(values.core),
      settings: settings, note: values.note || null, allowAnyTime: !!values.anyTime };
  }

  /** The phases Erupe wrote, as lines; null when it has not yet. */
  function phaseLines(run) {
    if (!Array.isArray(run.phases)) return null;
    return run.phases.map(function (p) {
      var extra = [];
      Object.keys(p).forEach(function (k) {
        if (k === "name" || k === "starts_at" || k === "ends_at") return;
        var v = p[k];
        extra.push(k.replace(/_/g, " ") + " " + (typeof v === "string" && ms(v) !== null ? utc(v) : v));
      });
      return p.name + ": " + utc(p.starts_at) + " to " + utc(p.ends_at) + (extra.length ? " (" + extra.join(", ") + ")" : "");
    });
  }

  /* ---- what each field does in game (the "?" circles); from Erupe's docs hvmhfz-event-calendar, -festa,
     -diva and -tournament. Keys: a form field, or "<event>.<setting>" before "<setting>". ---- */
  var HELP = {
    event: "Which event this run is. Hunter Festival: guilds join the blue or red team, deliver souls, then claim prizes. "
      + "VS Bracket: players sign up, are drawn into a knockout bracket and race one quest per round. Diva Defense: three weeks "
      + "of prayer gems, guild tactics, then rewards and a coin shop. Speedrun Cup: a solo and a group quest in the event quest "
      + "list; the fastest clears are ranked and everyone with a time gets a prize.",
    lane: "There are two lanes, one event at a time in each, and the event decides the lane (there is no lane field). "
      + "Main event: Hunter Festival or Diva Defense; its runs start on a Monday 03:00 UTC. Side event: Speedrun Cup or "
      + "VS Bracket; its runs start on a Thursday 15:00 UTC. A run's tail (festival judging and rewards, Diva week 3) may "
      + "run beside the next event of its lane.",
    starts_at: "When the run begins in game: festival entry opens, Diva week 1 starts, the first Cup or VS cycle opens. "
      + "UTC, at least an hour from now (the game server reads the calendar every minute). Normally on the lane's boundary: "
      + "Monday 03:00 UTC for the main event (12:00 in Japan, when Diva Defense's days start), Thursday 15:00 UTC for the "
      + "side event; any other time needs \"Allow any time\".",
    core_ends_at: "Where the main part ends and the next event of the lane may start. Empty: the event's own (festival: the "
      + "end of soul delivery; Diva: after 14 days; Cup and VS: the run's end). After it the tail (festival judging and "
      + "rewards, Diva week 3) goes on beside the next event. On the lane's boundary (Monday 03:00 UTC main, Thursday 15:00 "
      + "UTC side) unless \"Allow any time\".",
    ends_at: "Where the run really ends, worked out from the start and the settings (the game server refuses a row whose "
      + "end is wrong). Festival: start + entry + souls + judging + rewards. Diva: start + 21 days. Cup and VS: start + "
      + "cycles x cycle days. Changing it changes the last length: the festival's rewards hours, or the number of cycles.",
    note: "For admins only: kept with the run, never shown in game or on the public site.",
    any_time: "Lets the start and the core end fall on any hour, not only the lane's boundary (Monday 03:00 UTC for the main "
      + "event, Thursday 15:00 UTC for the side event). The game accepts any time; the boundary keeps each lane's loop "
      + "lined up, so tick it only on purpose (for example to fill a gap now).",
    entry_hours: "Team entry and the trial vote, the festival's first phase (hours): guilds sign up for the blue or red "
      + "team and vote for the trials. The loop uses 168 (7 days).",
    souls_hours: "Soul delivery (hours): guild members hunt and hand in souls for their team at the festival counter. At "
      + "least 168 (7 days), so a guild that plays once a week can take part. The core ends with it unless set otherwise.",
    judging_hours: "Judging (hours): the counter is closed while the totals are counted; the winning team is known at "
      + "its end. Usually 2.5.",
    rewards_hours: "Results and prizes (hours): players claim their team's prizes and the final reward. This tail runs "
      + "beside the next main event. The loop uses 333.5 (about 13.9 days).",
    first_cycle: "The number of the run's first cycle. Cycle numbers pick each cycle's quests and key its standings, "
      + "results and prizes, so they are never used twice and go up in each later run. Empty: the next free number.",
    "speedrun_cup.cycles": "How many Cup weeks this run holds, back to back. The run lasts cycles x cycle days.",
    "vs_bracket.cycles": "How many brackets this run holds, back to back. The run lasts cycles x cycle days.",
    "speedrun_cup.cycle_days": "One Cup cycle (days): open, then the tally, then the results until the next cycle. 7 "
      + "for a weekly Cup.",
    "vs_bracket.cycle_days": "One bracket (days): sign-up, the draw, the rounds, then the results until the next "
      + "bracket. 14 in the loop.",
    open_days: "Days the two Cup quests (solo and group) are in the event quest list and clears count; only each "
      + "player's best time counts. Open days + tally must end at least an hour before the cycle does.",
    tally_hours: "Hours after the open days while the ranking screen says it is counting; the prizes go to the gift box "
      + "from then. The standings show from its end to the end of the cycle.",
    registration_days: "Sign-up (days): players apply on the VS Tournament screen or with !vs join. At its end the draw "
      + "makes the bracket (whoever signed up first is seed 1).",
    round_days: "Each round (days): both players of a match clear the round's quest once, alone, whenever they like; "
      + "the faster clear goes on. Sign-up + one round must end before the cycle does; rounds that don't fit are dropped.",
    max_rounds: "The most rounds of a bracket, 1-6: 5 rounds hold 32 players, 6 hold 64. The bracket is the smallest "
      + "that holds everyone who signed up.",
    diva: "Diva Defense has no settings: it always lasts 21 days. Week 1, personal: a prayer gem each day, points, bonus "
      + "quests. Week 2, guild tactics: songs, tactics points, the guild map. Weeks 1-2 are the core. Week 3: rewards and "
      + "the coin shop, beside the next event.",
    gen_from: "The boundary where the first event of the extension starts: a Monday (03:00 UTC) for the main lane, a Thursday "
      + "(15:00 UTC) for the side lane; the API suggests the one after the lane's last core.",
    gen_first: "Which event of the lane's loop comes first; the others follow in loop order. Main: Hunter Festival, Diva "
      + "Defense (a 4-week loop). Side: Speedrun Cup, VS Bracket (a 3-week loop).",
    gen_weeks: "How many weeks to add: every loop run of the lane that starts in them is added, with the loop's settings "
      + "and the next free cycle numbers."
  };

  function help(key, event) {
    return HELP[event + "." + key] || HELP[key] || null;
  }

  var HOUR = 3600000;

  function num(v) { return v === "" || v === null || v === undefined ? NaN : Number(v); }

  /** Where a run of event from start (ms) with settings ends, and its default core end (the API's shape). */
  function shape(event, start, s) {
    s = s || {};
    if (event === "festa") {
      var entry = Math.round(num(s.entry_hours) * 3600) * 1000, souls = Math.round(num(s.souls_hours) * 3600) * 1000;
      var all = entry + souls + Math.round(num(s.judging_hours) * 3600) * 1000 + Math.round(num(s.rewards_hours) * 3600) * 1000;
      return isNaN(all) ? null : { core: start + entry + souls, end: start + all };
    }
    if (event === "diva") return { core: start + 14 * DAY, end: start + 21 * DAY };
    var len = num(s.cycle_days) * num(s.cycles) * DAY;
    return isNaN(len) ? null : { core: start + len, end: start + len };
  }

  /** A run as times in ms, with whether its core end was set by hand (not the event's own). */
  function runTimes(run) {
    var start = ms(run.startsAt), core = ms(run.coreEndsAt), end = ms(run.endsAt), sh = shape(run.event, start, run.settings);
    return { start: start, core: core, end: end, ownCore: !sh || core !== sh.core };
  }

  function copy(o) { var c = {}; Object.keys(o || {}).forEach(function (k) { c[k] = o[k]; }); return c; }

  function iso(t) { return new Date(t).toISOString().replace(".000Z", "Z"); }

  /** A changed copy of run (a "draft"): same id, event, lane and note; new times and settings. */
  function draft(run, start, core, settings, explicitCore) {
    var sh = shape(run.event, start, settings) || { core: core, end: core };
    var c = explicitCore ? core : sh.core;
    return { id: run.id, event: run.event, name: run.name, lane: run.lane, note: run.note, settings: settings,
      startsAt: iso(start), coreEndsAt: iso(c), endsAt: iso(sh.end), explicitCore: !!explicitCore };
  }

  /** The run moved by delta ms: every time shifts, the settings stay. */
  function moveRun(run, delta) {
    var t = runTimes(run);
    return draft(run, t.start + delta, t.core + delta, copy(run.settings), t.ownCore);
  }

  /**
   * The run with one edge at time t: "end" changes the last length (festival rewards, Cup/VS cycles, whole
   * cycles only), "start" the first one with the end kept (festival entry, Cup/VS cycles), "core" the festival's
   * soul delivery (or its core end when that was set by hand). Diva Defense always lasts 21 days: null.
   */
  function resizeRun(run, edge, t) {
    var r = runTimes(run), s = copy(run.settings);
    if (run.event === "diva") return null;
    if (run.event === "festa") {
      var h = function (x) { return Math.round(x / HOUR * 2) / 2; }; // half hours, as the loop's lengths
      if (edge === "end") {
        var t3 = r.start + (num(s.entry_hours) + num(s.souls_hours) + num(s.judging_hours)) * HOUR;
        s.rewards_hours = Math.max(1, h(t - t3));
        return draft(run, r.start, r.core, s, r.ownCore);
      }
      if (edge === "start") {
        var t1 = r.start + num(s.entry_hours) * HOUR;
        s.entry_hours = Math.max(1, h(t1 - t));
        return draft(run, t1 - s.entry_hours * HOUR, r.core, s, r.ownCore);
      }
      if (edge === "core") {
        if (r.ownCore) return draft(run, r.start, Math.min(Math.max(t, r.start + HOUR), r.end), s, true);
        var souls = h(t - (r.start + num(s.entry_hours) * HOUR));
        s.souls_hours = Math.max(1, souls);
        return draft(run, r.start, r.core, s, false);
      }
      return null;
    }
    var cycle = num(s.cycle_days) * DAY;
    if (!(cycle > 0) || edge === "core") return null;
    if (edge === "end") {
      s.cycles = Math.max(1, Math.round((t - r.start) / cycle));
      return draft(run, r.start, r.core, s, false);
    }
    s.cycles = Math.max(1, Math.round((r.end - t) / cycle));
    return draft(run, r.end - s.cycles * cycle, r.core, s, false);
  }

  /** Exactly on the lane's boundary (default the main lane's): Monday 03:00:00 UTC, or Thursday 15:00:00 UTC for "side". */
  function onBoundary(t, lane) {
    var d = new Date(t), b = BOUNDARY[lane === "side" ? "side" : "featured"];
    return d.getUTCDay() === b.day && d.getUTCHours() === b.hour && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  }

  /** The lane's boundaries in [from, to] (ms), for the drag to snap to. */
  function boundaries(lane, from, to) {
    var b = BOUNDARY[lane === "side" ? "side" : "featured"], out = [];
    var t = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate(), b.hour, 0);
    while (new Date(t).getUTCDay() !== b.day || t < from) t += DAY;
    for (; t <= to; t += 7 * DAY) out.push(t);
    return out;
  }

  /**
   * The API's rules (CalendarRules) checked here while dragging, so the bar says at once what the API would
   * refuse: {problems, boundary}. boundary: the lane's boundary rule (Monday 03:00 UTC main, Thursday 15:00 UTC
   * side), which "allow any time" lifts. others: the other runs (cancelled ones are skipped). The lane is the
   * event's; a transition row (lane "background") has no boundary and blocks no one. The API checks again on drop
   * and on save.
   */
  function ruleProblems(d, others, now) {
    var out = [], boundary = [], s = d.settings || {}, lane = laneOf(d), inLane = d.lane !== "background";
    var name = function (r) { return "the " + (NAMES[r.event] || r.event) + " run #" + r.id; };
    var whole = function (k) { return Math.floor(num(s[k])) === num(s[k]); };
    if (d.event === "festa") {
      ["entry_hours", "souls_hours", "judging_hours", "rewards_hours"].forEach(function (k) {
        if (!(num(s[k]) > 0)) out.push(k.replace(/_/g, " ") + " must be above 0.");
      });
      if (num(s.souls_hours) < 168) out.push("The soul delivery must last at least 7 days (168 hours).");
    } else if (d.event === "speedrun_cup" || d.event === "vs_bracket") {
      (FIELDS[d.event] || []).forEach(function (f) {
        if (f[0] === "first_cycle" && (s.first_cycle === undefined || s.first_cycle === null || s.first_cycle === "")) return;
        if (!whole(f[0]) || num(s[f[0]]) < (f[0] === "first_cycle" ? 0 : 1)) out.push(f[1] + " must be a whole number" + (f[0] === "first_cycle" ? " (0 or more)." : " of 1 or more."));
      });
      if (d.event === "speedrun_cup" && num(s.open_days) * 24 + num(s.tally_hours) > num(s.cycle_days) * 24 - 1) {
        out.push("The open days and the tally must end at least an hour before the cycle does.");
      }
      if (d.event === "vs_bracket") {
        if (num(s.max_rounds) > 6) out.push("At most 6 rounds (64 players).");
        if (num(s.registration_days) + num(s.round_days) >= num(s.cycle_days)) out.push("The sign-up and one round must end before the cycle does.");
      }
    }
    var start = ms(d.startsAt), core = ms(d.coreEndsAt), end = ms(d.endsAt);
    if (start < now + HOUR) out.push("The start must be at least an hour from now.");
    if (!(start < core) || core > end) out.push("The core must end after the start and no later than the run's end.");
    if (inLane && !onBoundary(start, lane)) boundary.push("The start is not on a " + BOUNDARY[lane].text + " (tick \"allow any time\" to use it).");
    if (inLane && !onBoundary(core, lane)) boundary.push("The core end is not on a " + BOUNDARY[lane].text + " (tick \"allow any time\" to use it).");
    var first = num(s.first_cycle), last = first + num(s.cycles) - 1;
    (others || []).forEach(function (o) {
      if (o.id === d.id || o.status === "cancelled") return;
      var os = ms(o.startsAt), oc = ms(o.coreEndsAt), oe = ms(o.endsAt);
      if (inLane && o.lane !== "background" && laneOf(o) === lane && start < oc && os < core) {
        out.push("Its core overlaps " + name(o) + "'s core: only one " + LANE_NAMES[lane].toLowerCase() + " at a time.");
      }
      if (o.event === d.event && start < oe && os < end) out.push("It overlaps " + name(o) + ": one run of an event at a time.");
      var of = num(o.settings && o.settings.first_cycle), ol = of + num(o.settings && o.settings.cycles) - 1;
      if (o.event === d.event && !isNaN(first) && !isNaN(of)) {
        if (first <= ol && of <= last) out.push("Its cycle numbers are already used by " + name(o) + ".");
        else if (os < start && first <= ol) out.push("The first cycle must be above " + ol + ", the last one of " + name(o) + ", which runs before it.");
        else if (start < os && of <= last) out.push("Its cycles must be below " + of + ", the first one of " + name(o) + ", which runs after it.");
      }
    });
    return { problems: out, boundary: boundary };
  }

  /**
   * What runs when, in [from, to): pieces split at every start, core end and end, each with the runs on then.
   * Each piece says which run's core covers each lane (main: `featured`, `side`: run ids, or null). A transition
   * row counts in its event's lane. gaps: the stretches where a lane has no core, one list for both lanes
   * (a gap of the main lane is "no main event", of the side lane "no side event"), neighbours merged; running:
   * what is still on in that lane then (tails).
   */
  function coverage(runs, from, to) {
    var live = (runs || []).filter(function (r) { return r.status !== "cancelled" && ms(r.startsAt) !== null && ms(r.endsAt) !== null; });
    var cuts = [from, to];
    live.forEach(function (r) {
      [ms(r.startsAt), ms(r.coreEndsAt), ms(r.endsAt)].forEach(function (t) { if (t !== null && t > from && t < to) cuts.push(t); });
    });
    cuts.sort(function (a, b) { return a - b; });
    var pieces = [];
    for (var i = 0; i + 1 < cuts.length; i++) {
      var a = cuts[i], b = cuts[i + 1];
      if (b <= a) continue;
      var on = [], core = { featured: null, side: null };
      live.forEach(function (r) {
        var s = ms(r.startsAt), c = ms(r.coreEndsAt), e = ms(r.endsAt), lane = laneOf(r);
        if (s >= b || e <= a) return;
        var inCore = s <= a && c >= b;
        if (inCore) core[lane] = r.id;
        on.push({ id: r.id, event: r.event, name: r.name || NAMES[r.event] || r.event, lane: lane, transition: r.lane === "background", part: inCore ? "core" : "tail" });
      });
      // By lane, the core before the tails.
      on.sort(function (x, y) { return LANES.indexOf(x.lane) - LANES.indexOf(y.lane) || (x.part === "core" ? 0 : 1) - (y.part === "core" ? 0 : 1); });
      pieces.push({ from: a, to: b, runs: on, featured: core.featured, side: core.side });
    }
    var gaps = [];
    LANES.forEach(function (lane) {
      pieces.forEach(function (p) {
        if (p[lane] !== null) return;
        var names = p.runs.filter(function (r) { return r.lane === lane; }).map(function (r) { return r.name; });
        var prev = gaps[gaps.length - 1];
        if (prev && prev.lane === lane && prev.to === p.from) {
          prev.to = p.to;
          names.forEach(function (n) { if (prev.running.indexOf(n) === -1) prev.running.push(n); });
        } else {
          gaps.push({ lane: lane, from: p.from, to: p.to, running: names });
        }
      });
    });
    gaps.sort(function (x, y) { return x.from - y.from || LANES.indexOf(x.lane) - LANES.indexOf(y.lane); });
    return { pieces: pieces, gaps: gaps };
  }

  /** The runs on at time t, from coverage's pieces. */
  function runningAt(pieces, t) {
    for (var i = 0; i < pieces.length; i++) if (pieces[i].from <= t && t < pieces[i].to) return pieces[i];
    return null;
  }

  /** "12 d 21 h" */
  function howLong(a, b) {
    var h = Math.round((b - a) / HOUR), d = Math.floor(h / 24);
    return (d ? d + " d" : "") + (d && h % 24 ? " " : "") + (h % 24 || !d ? (h % 24) + " h" : "");
  }

  /** Time t snapped: to the hour, or (day) to the lane's hour of the nearest day (03:00 UTC main, 15:00 UTC side). */
  function snap(t, day, lane) {
    if (day) {
      var h = BOUNDARY[lane === "side" ? "side" : "featured"].hour * HOUR;
      return Math.round((t - h) / DAY) * DAY + h;
    }
    return Math.round(t / HOUR) * HOUR;
  }

  /** The request body of a draft (PUT /api/admin/events/calendar/{id}): the full run, note kept (no lane: the API keeps it). */
  function draftBody(d, anyTime) {
    return { event: d.event, startsAt: d.startsAt, coreEndsAt: d.explicitCore ? d.coreEndsAt : null,
      settings: d.settings, note: d.note || null, allowAnyTime: !!anyTime };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { utc: utc, toInput: toInput, fromInput: fromInput, weekStart: weekStart, timeline: timeline,
      soon: soon, body: body, laneOf: laneOf, LANE_NAMES: LANE_NAMES, boundaries: boundaries, phaseLines: phaseLines, HELP: HELP, help: help, FIELDS: FIELDS, shape: shape,
      moveRun: moveRun, resizeRun: resizeRun, ruleProblems: ruleProblems, coverage: coverage, runningAt: runningAt,
      howLong: howLong, snap: snap, onBoundary: onBoundary, draftBody: draftBody };
  }
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var started = false;
  var rules = null;
  var state = { runs: [], now: Date.now(), editing: null, checkTimer: null, checkSeq: 0, generated: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function $(id) { return document.getElementById(id); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  // Like admin.js's: a refusal throws with the API's message and the whole answer (problems, preview).
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("Sign in again: your session has ended.");
        if (r.status === 403) throw new Error("Only admin accounts can change the calendar.");
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var error = new Error((data && data.message) || "HTTP " + r.status);
            error.data = data;
            throw error;
          }
          return data;
        });
      });
  }

  function say(id, text) {
    var box = $(id);
    box.textContent = text || "";
    box.hidden = !text;
  }

  function list(id, items, okItems) {
    var ul = $(id);
    clear(ul);
    (items || []).forEach(function (t) { ul.appendChild(el("li", null, t)); });
    (okItems || []).forEach(function (t) { ul.appendChild(el("li", "is-ok", t)); });
    ul.hidden = !ul.firstChild;
  }

  /* ---- loading ---- */

  function load() {
    var q = $("cal-cancelled").checked ? "?cancelled=true" : "";
    return request("/api/admin/events/calendar" + q).then(function (cal) {
      state.change = null;
      $("cal-change").hidden = true;
      state.runs = cal.runs || [];
      state.now = ms(cal.now) || Date.now();
      say("cal-alert", cal.tableReady ? "" : "The event_calendar table is not in the database yet: apply Erupe's "
        + "schemas/hvmhfz/2026-11-event-calendar.sql (and a seed) first. Until then nothing here can be saved.");
      $("cal-note").textContent = state.runs.length + (state.runs.length === 1 ? " run" : " runs") + " shown";
      list("cal-warnings", cal.warnings);
      LOOPS.forEach(function (l) {
        var next = cal[l.next];
        if (next && !$(l.id + "-from").value) {
          $(l.id + "-from").value = next.from;
          $(l.id + "-first").value = next.first;
        }
      });
      $("cal-always").textContent = "Always on, not in the calendar: " + (cal.alwaysOn || []).join(", ") + ".";
      renderStrip();
      renderSoon();
      renderRows();
    }).catch(function (e) { say("cal-alert", e.message); });
  }

  /* ---- the strip ---- */

  // The strip's time span and the pieces of what runs when (set by renderStrip).
  var view = { from: 0, to: 1, pieces: [] };

  function pct(t) { return Math.max(0, Math.min(100, (t - view.from) / (view.to - view.from) * 100)); }

  // What is on in a piece, per lane: "Main event: Hunter Festival #5; Side event: no side event (a gap)".
  function names(piece) {
    if (!piece) return "nothing is planned";
    var core = { featured: piece.featured, side: piece.side };
    return LANES.map(function (lane) {
      var runs = piece.runs.filter(function (r) { return r.lane === lane; }).map(function (r) {
        var tags = (r.part === "tail" ? ["tail"] : []).concat(r.transition ? ["transition"] : []);
        return r.name + " #" + r.id + (tags.length ? " (" + tags.join(", ") + ")" : "");
      });
      var gap = core[lane] === null ? "no " + LANE_NAMES[lane].toLowerCase() + " (a gap)" : "";
      return LANE_NAMES[lane] + ": " + runs.concat(gap || []).join(", ");
    }).join("; ");
  }

  function renderStrip() {
    var g = timeline(state.runs, state.now, WEEKS);
    view.from = g.from;
    view.to = g.to;
    var cov = coverage(state.runs, state.now, g.to);
    view.pieces = cov.pieces;
    var outer = $("cal-strip");
    clear(outer);
    var strip = el("div", "cal-body");
    outer.appendChild(strip);
    var head = el("div", "cal-ticks");
    g.ticks.forEach(function (t) {
      var tick = el("span", "cal-tick", t.label);
      tick.style.left = t.left + "%";
      head.appendChild(tick);
    });
    strip.appendChild(head);
    LANES.forEach(function (lane) {
      var row = el("div", "cal-lane cal-lane-" + lane);
      row.style.height = (g.rows[lane] * 34) + "px";
      row.appendChild(el("span", "cal-lane-name", LANE_NAMES[lane]));
      // The lane's gaps behind its bars: red where it has no core.
      cov.gaps.filter(function (gap) { return gap.lane === lane; }).forEach(function (gap) {
        var shade = el("span", "cal-gap is-empty");
        shade.style.left = pct(gap.from) + "%";
        shade.style.width = (pct(gap.to) - pct(gap.from)) + "%";
        shade.title = "No " + LANE_NAMES[lane].toLowerCase() + (gap.running.length ? " (" + gap.running.join(", ") + " still on)" : "")
          + ": " + utc(iso(gap.from)) + " to " + utc(iso(gap.to)) + " UTC";
        row.appendChild(shade);
      });
      g.bars.filter(function (b) { return b.lane === lane; }).forEach(function (b) {
        var run = find(b.id);
        var bar = el("button", "cal-bar cal-" + b.event);
        bar.type = "button";
        bar.dataset.id = b.id;
        bar.style.left = b.left + "%";
        bar.style.top = (2 + b.row * 34) + "px";
        bar.style.width = (b.core + b.tail) + "%";
        var core = el("span", "cal-core", b.name);
        core.style.width = (b.core + b.tail > 0 ? b.core / (b.core + b.tail) * 100 : 100) + "%";
        bar.appendChild(core);
        var label = b.name + " #" + b.id + " (" + (STATUS[b.status] || b.status) + ", " + LANE_NAMES[lane].toLowerCase() + (b.transition ? ", transition" : "") + "): " + utc(run.startsAt)
          + " to " + utc(run.endsAt) + " UTC";
        if (run.editable) {
          bar.classList.add("is-movable");
          bar.appendChild(el("span", "cal-h cal-h-start"));
          bar.appendChild(el("span", "cal-h cal-h-end"));
          if (b.event === "festa") core.appendChild(el("span", "cal-h cal-h-core"));
          bar.setAttribute("aria-describedby", "cal-keys");
          bar.title = label + ". Drag to move, drag an edge to change its length (or use the arrow keys).";
          wireBar(bar, run);
        } else {
          bar.title = label + ". " + (run.started ? "It has started: its times can't change." : "Only a planned run can move.");
        }
        bar.setAttribute("aria-label", label);
        bar.addEventListener("click", function () {
          if (drag.justDropped) { drag.justDropped = false; return; }
          showDetail(b.id);
        });
        row.appendChild(bar);
      });
      strip.appendChild(row);
    });
    var now = el("span", "cal-now");
    now.style.left = g.now + "%";
    now.title = "Now";
    strip.appendChild(now);
    strip.appendChild(el("span", "cal-tip"));
    strip.addEventListener("pointermove", function (e) {
      if (drag.active) return;
      var t = timeAt(e.clientX);
      $("cal-at").textContent = utc(iso(snap(t))) + " UTC: " + names(runningAt(view.pieces, t)) + ".";
    });
    renderNowAndGaps(cov);
  }

  function timeAt(x) {
    var box = document.querySelector("#cal-strip .cal-body").getBoundingClientRect();
    return view.from + (x - box.left) / box.width * (view.to - view.from);
  }

  /* ---- what runs now, and the gaps ---- */

  function renderNowAndGaps(cov) {
    $("cal-running").textContent = "Running now: " + names(runningAt(cov.pieces, state.now)) + ".";
    var ul = $("cal-gaps");
    clear(ul);
    cov.gaps.forEach(function (gap) {
      var li = el("li", "is-empty");
      var open = gap.to >= view.to ? " (the end of the view; nothing is planned after)" : "";
      li.appendChild(el("span", "cal-gap-key", "No " + LANE_NAMES[gap.lane].toLowerCase()));
      li.appendChild(document.createTextNode(" " + utc(iso(gap.from)) + " to " + utc(iso(gap.to)) + " UTC, "
        + howLong(gap.from, gap.to) + open + (gap.running.length ? ". Still on: " + gap.running.join(", ") + "." : ".")));
      var fill = el("button", "ghost-btn small", "Fill this gap");
      fill.type = "button";
      fill.addEventListener("click", function () { fillGap(gap); });
      li.appendChild(fill);
      ul.appendChild(li);
    });
    if (!cov.gaps.length) ul.appendChild(el("li", "is-ok", "No gaps: a main event and a side event cover every hour of the view."));
  }

  function fillGap(gap) {
    resetForm();
    var start = Math.max(snap(gap.from + HOUR / 2 - 1), Math.ceil((state.now + HOUR) / HOUR) * HOUR);
    // The gap's lane decides the event: keep the chosen one when it is of that lane, else the lane's first.
    if (LANE_OF[$("cal-event").value] !== gap.lane) {
      $("cal-event").value = LANE_FIRST[gap.lane];
      renderSettings(LANE_FIRST[gap.lane]);
    }
    $("cal-start").value = toInput(iso(start));
    $("cal-anytime").checked = !onBoundary(start, gap.lane);
    var event = $("cal-event").value, s = loopSettings(event);
    if ((event === "speedrun_cup" || event === "vs_bracket") && s.cycle_days) {
      $("cal-s-cycles").value = String(Math.max(1, Math.floor((gap.to - start) / (s.cycle_days * DAY))));
    }
    showLane();
    $("cal-gap-hint").textContent = "Filling " + utc(iso(start)) + " to " + utc(iso(gap.to)) + " UTC ("
      + howLong(start, gap.to) + "). Pick the event; the check below says where it ends and what it overlaps.";
    $("cal-gap-hint").hidden = false;
    syncEnd();
    $("cal-form").scrollIntoView({ behavior: "smooth", block: "start" });
    $("cal-event").focus();
    scheduleCheck();
  }

  /* ---- drag, resize and keys on the strip ---- */

  var drag = { active: null, justDropped: false };

  // Snap: to the hour; within 8 px of the lane's boundary (Monday 03:00 main, Thursday 15:00 side) or another run's
  // edge, to that (Shift: the lane's hour of the nearest day; Alt: hours only).
  function snapped(t, e, id, lane) {
    var t0 = snap(t, false);
    if (e && e.shiftKey) return snap(t, true, lane);
    if (e && e.altKey) return t0;
    var body = document.querySelector("#cal-strip .cal-body");
    var perPx = (view.to - view.from) / Math.max(1, body.getBoundingClientRect().width), best = t0, bestD = 8 * perPx;
    var targets = boundaries(lane, view.from, view.to);
    state.runs.forEach(function (r) {
      if (r.id === id || r.status === "cancelled") return;
      targets.push(ms(r.startsAt), ms(r.coreEndsAt), ms(r.endsAt));
    });
    targets.forEach(function (x) { if (Math.abs(x - t) < bestD) { bestD = Math.abs(x - t); best = x; } });
    return best;
  }

  function others(id) { return state.runs.filter(function (r) { return r.id !== id && r.status !== "cancelled"; }); }

  // The bar drawn where the draft is, with the start/end tip and the rules' verdict.
  function paint(bar, d) {
    var s = ms(d.startsAt), c = ms(d.coreEndsAt), e = ms(d.endsAt);
    bar.style.left = pct(s) + "%";
    bar.style.width = (pct(e) - pct(s)) + "%";
    bar.querySelector(".cal-core").style.width = (e > s ? (c - s) / (e - s) * 100 : 100) + "%";
    var rules = ruleProblems(d, others(d.id), state.now);
    var anyTime = $("cal-change-anytime") && $("cal-change-anytime").checked && !$("cal-change").hidden;
    var bad = rules.problems.concat(anyTime ? [] : rules.boundary);
    bar.classList.toggle("is-bad", rules.problems.length > 0);
    bar.classList.toggle("is-soft", !rules.problems.length && bad.length > 0);
    var tip = document.querySelector("#cal-strip .cal-tip");
    tip.textContent = "Start " + utc(d.startsAt) + " · core to " + utc(d.coreEndsAt) + " · end " + utc(d.endsAt) + " UTC"
      + (bad.length ? " · " + bad[0] + (bad.length > 1 ? " (+" + (bad.length - 1) + ")" : "") : " · the checks pass");
    tip.classList.add("is-on");
    var w = tip.parentNode.clientWidth;
    tip.style.left = Math.max(0, Math.min(pct(s) / 100 * w, w - tip.offsetWidth)) + "px";
    $("cal-drag-status").textContent = tip.textContent;
    return rules;
  }

  function wireBar(bar, run) {
    var t = runTimes(run);
    bar.addEventListener("contextmenu", function (e) { if (drag.active || drag.pressing) e.preventDefault(); });
    bar.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || drag.active) return;
      var handle = e.target.classList.contains("cal-h-start") ? "start" : e.target.classList.contains("cal-h-end") ? "end"
        : e.target.classList.contains("cal-h-core") ? "core" : "move";
      var press = { bar: bar, run: run, mode: handle, x0: e.clientX, y0: e.clientY, t0: timeAt(e.clientX), id: e.pointerId,
        touch: e.pointerType === "touch", ready: e.pointerType !== "touch", draft: null };
      drag.pressing = press;
      if (press.touch) {
        // Touch: hold still for half a second, then drag (a quick swipe still scrolls the strip).
        press.timer = setTimeout(function () {
          press.ready = true;
          bar.classList.add("is-held");
          $("cal-drag-status").textContent = "Drag " + run.name + " #" + run.id + " to move it.";
        }, 450);
      }
    });
    bar.addEventListener("keydown", function (e) {
      var hour = e.shiftKey ? DAY : HOUR, d = null, base = state.change && state.change.run.id === run.id ? state.change.draft : null;
      var cur = base || { startsAt: run.startsAt, coreEndsAt: run.coreEndsAt, endsAt: run.endsAt, settings: run.settings, explicitCore: t.ownCore };
      var asRun = { id: run.id, event: run.event, name: run.name, lane: run.lane, note: run.note, startsAt: cur.startsAt,
        coreEndsAt: cur.coreEndsAt, endsAt: cur.endsAt, settings: cur.settings };
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") d = moveRun(asRun, e.key === "ArrowLeft" ? -hour : hour);
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        var step = run.event === "festa" ? hour : (num(run.settings.cycle_days) || 0) * DAY;
        d = resizeRun(asRun, "end", ms(cur.endsAt) + (e.key === "ArrowUp" ? step : -step));
        if (!d) { $("cal-drag-status").textContent = "Diva Defense always lasts 21 days: move it with the left and right arrows."; e.preventDefault(); return; }
      } else if (e.key === "Escape" && base) { e.preventDefault(); cancelChange(); return; }
      else return;
      e.preventDefault();
      paint(bar, d);
      showChange(run, d);
    });
  }

  document.addEventListener("pointermove", function (e) {
    var p = drag.pressing;
    if (!p || e.pointerId !== p.id) return;
    var dx = e.clientX - p.x0, dy = e.clientY - p.y0;
    if (!p.ready) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { clearTimeout(p.timer); drag.pressing = null; } // a swipe: scroll
      return;
    }
    if (!drag.active) {
      if (Math.abs(dx) < 4) return;
      drag.active = p;
      p.bar.classList.add("is-dragging");
      try { p.bar.setPointerCapture(p.id); } catch (err) { /* synthetic events */ }
    }
    var r = runTimes(p.run), delta = timeAt(e.clientX) - p.t0, d;
    var lane = laneOf(p.run);
    if (p.mode === "move") d = moveRun(p.run, snapped(r.start + delta, e, p.run.id, lane) - r.start);
    else d = resizeRun(p.run, p.mode, snapped((p.mode === "start" ? r.start : p.mode === "end" ? r.end : r.core) + delta, e, p.run.id, lane));
    if (!d) { $("cal-drag-status").textContent = "Diva Defense always lasts 21 days: drag the bar to move it."; return; }
    p.draft = d;
    paint(p.bar, d);
  });

  // A held touch must not scroll the page while it drags.
  document.addEventListener("touchmove", function (e) { if (drag.pressing && drag.pressing.ready) e.preventDefault(); }, { passive: false });

  function endPress(e, cancelled) {
    var p = drag.pressing;
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.timer);
    p.bar.classList.remove("is-held", "is-dragging");
    drag.pressing = null;
    var was = drag.active;
    drag.active = null;
    if (!was) return;
    drag.justDropped = true;
    setTimeout(function () { drag.justDropped = false; }, 0);
    if (cancelled || !p.draft) { renderStrip(); return; }
    showChange(p.run, p.draft);
  }
  document.addEventListener("pointerup", function (e) { endPress(e, false); });
  document.addEventListener("pointercancel", function (e) { endPress(e, true); });

  /* ---- the change of a dragged run: before and after, the API's check, Save ---- */

  function showChange(run, d) {
    state.change = { run: run, draft: d };
    var box = $("cal-change");
    $("cal-change-title").textContent = "Change " + run.name + " #" + run.id;
    var tbody = $("cal-change-rows");
    clear(tbody);
    var rows = [["Starts", utc(run.startsAt), utc(d.startsAt)], ["Core ends", utc(run.coreEndsAt), utc(d.coreEndsAt)],
      ["Ends", utc(run.endsAt), utc(d.endsAt)]];
    (FIELDS[run.event] || []).forEach(function (f) {
      rows.push([f[1], String(run.settings[f[0]]), String(d.settings[f[0]])]);
    });
    rows.forEach(function (r) {
      var tr = el("tr", r[1] !== r[2] ? "is-changed" : null);
      tr.appendChild(el("th", null, r[0]));
      tr.appendChild(el("td", null, r[1]));
      tr.appendChild(el("td", null, r[2]));
      tbody.appendChild(tr);
    });
    box.hidden = false;
    checkChange();
  }

  function checkChange() {
    var c = state.change;
    if (!c) return;
    var anyTime = $("cal-change-anytime").checked;
    var rules = ruleProblems(c.draft, others(c.run.id), state.now);
    var mine = rules.problems.concat(anyTime ? [] : rules.boundary);
    list("cal-change-problems", mine, mine.length ? [] : ["Checking with the API..."]);
    $("cal-change-save").disabled = true;
    var seq = ++state.checkSeq;
    clearTimeout(state.changeTimer);
    state.changeTimer = setTimeout(function () {
      request("/api/admin/events/calendar/check?id=" + c.run.id, { method: "POST", body: JSON.stringify(draftBody(c.draft, anyTime)) })
        .then(function (res) {
          if (seq !== state.checkSeq || state.change !== c) return;
          var problems = res.problems || [];
          list("cal-change-problems", problems, problems.length ? [] : ["The API's checks pass."].concat(res.warnings || []));
          $("cal-change-save").disabled = problems.length > 0;
        })
        .catch(function (e) { if (seq === state.checkSeq) list("cal-change-problems", [e.message]); });
    }, 250);
  }

  function cancelChange() {
    state.change = null;
    $("cal-change").hidden = true;
    $("cal-drag-status").textContent = "Change cancelled.";
    renderStrip();
  }

  function saveChange() {
    var c = state.change;
    if (!c) return;
    $("cal-change-save").disabled = true;
    request("/api/admin/events/calendar/" + c.run.id, { method: "PUT", body: JSON.stringify(draftBody(c.draft, $("cal-change-anytime").checked)) })
      .then(function (r) {
        state.change = null;
        $("cal-change").hidden = true;
        say("cal-ok", "Run #" + r.id + " saved: from " + utc(r.startsAt) + " UTC to " + utc(r.endsAt) + " UTC. The game server reads it within a minute.");
        return load();
      })
      .catch(function (e) {
        list("cal-change-problems", (e.data && e.data.problems) || [e.message]);
        $("cal-change-save").disabled = false;
      });
  }

  function renderSoon() {
    var ul = $("cal-soon");
    clear(ul);
    var items = soon(state.runs, state.now);
    if (!items.length) items = ["Nothing starts or ends."];
    items.forEach(function (t) { ul.appendChild(el("li", null, t)); });
  }

  function find(id) {
    for (var i = 0; i < state.runs.length; i++) if (state.runs[i].id === id) return state.runs[i];
    return null;
  }

  // "Main event", "Side event", or "Main event (transition)" for a run kept from the November transition.
  function laneLabel(r) {
    return LANE_NAMES[laneOf(r)] + (r.lane === "background" ? " (transition)" : "");
  }

  function showDetail(id) {
    var r = find(id), box = $("cal-detail");
    clear(box);
    if (!r) { box.hidden = true; return; }
    box.appendChild(el("h3", "subhead", r.name + " #" + r.id));
    var meta = el("p", "note-text");
    meta.appendChild(el("span", "badge" + (r.status === "running" ? " good" : ""), STATUS[r.status] || r.status));
    meta.appendChild(document.createTextNode(" " + laneLabel(r) + ". Starts "
      + utc(r.startsAt) + ", core to " + utc(r.coreEndsAt) + ", ends " + utc(r.endsAt) + "."));
    box.appendChild(meta);
    var keys = Object.keys(r.settings || {});
    if (keys.length) {
      box.appendChild(el("p", "note-text", "Settings: " + keys.map(function (k) { return k + " " + r.settings[k]; }).join(", ") + "."));
    }
    var lines = phaseLines(r);
    if (!lines) {
      box.appendChild(el("p", "note-text", "Waiting for the game server: Erupe writes this run's phases within a minute once it reads it (config EventCalendar on)."));
    } else {
      var ul = el("ul", "cal-phases");
      lines.forEach(function (t) { ul.appendChild(el("li", null, t)); });
      box.appendChild(ul);
    }
    if (r.note) box.appendChild(el("p", "note-text", "Note: " + r.note));
    box.appendChild(el("p", "note-text muted", "Added by " + (r.createdBy || "a script") + (r.updatedBy ? ", last changed by " + r.updatedBy : "") + "."));
    box.hidden = false;
  }

  /* ---- the list ---- */

  // Two clicks for anything that changes the calendar at once.
  function confirmButton(label, confirmLabel, action) {
    var b = el("button", "ghost-btn small", label);
    b.type = "button";
    var armed = false, timer = null;
    b.addEventListener("click", function () {
      if (!armed) {
        armed = true;
        b.textContent = confirmLabel;
        timer = setTimeout(function () { armed = false; b.textContent = label; }, 5000);
        return;
      }
      clearTimeout(timer);
      b.disabled = true;
      action().then(function () { b.disabled = false; }, function () { b.disabled = false; });
    });
    return b;
  }

  function act(path, okText) {
    say("cal-alert", "");
    return request(path, { method: "POST" }).then(function () {
      say("cal-ok", okText);
      return load();
    }).catch(function (e) { say("cal-alert", e.message); });
  }

  function renderRows() {
    var body = $("cal-rows");
    clear(body);
    if (!state.runs.length) {
      var tr = el("tr"), td = el("td", "empty-cell", "No runs. Add one below, or extend the loop.");
      td.colSpan = 9;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    state.runs.forEach(function (r) {
      var tr = el("tr", r.status === "cancelled" || r.status === "done" ? "is-ended" : null);
      tr.appendChild(el("td", "rank", String(r.id)));
      var name = el("td", "cell-name");
      var link = el("button", "link-btn", r.name);
      link.type = "button";
      link.addEventListener("click", function () { showDetail(r.id); });
      name.appendChild(link);
      tr.appendChild(name);
      tr.appendChild(el("td", null, laneLabel(r)));
      tr.appendChild(el("td", null, utc(r.startsAt)));
      tr.appendChild(el("td", null, utc(r.coreEndsAt)));
      tr.appendChild(el("td", null, utc(r.endsAt)));
      var st = el("td");
      st.appendChild(el("span", "badge" + (r.status === "running" ? " good" : ""), STATUS[r.status] || r.status));
      if (!Array.isArray(r.phases) && r.status !== "cancelled") st.appendChild(el("span", "admin-desc", "waiting for the game server"));
      tr.appendChild(st);
      tr.appendChild(el("td", "cell-sub muted", r.note || "-"));
      var actions = el("td", "cal-actions");
      if (r.editable) {
        var edit = el("button", "ghost-btn small", "Edit");
        edit.type = "button";
        edit.addEventListener("click", function () { startEdit(r); });
        actions.appendChild(edit);
        actions.appendChild(confirmButton("Delete", "Confirm delete #" + r.id, function () {
          return act("/api/admin/events/calendar/" + r.id + "/cancel", "Run #" + r.id + " is cancelled; the game server drops it within a minute.");
        }));
      } else if (r.status !== "cancelled") {
        var note = el("button", "ghost-btn small", "Edit note");
        note.type = "button";
        note.addEventListener("click", function () { editNote(r); });
        actions.appendChild(note);
        var cycled = r.event === "speedrun_cup" || r.event === "vs_bracket";
        if (cycled && r.started && ms(r.endsAt) > state.now && r.settings && r.settings.cycles > 1) {
          actions.appendChild(confirmButton("Stop after current cycle", "Confirm stop #" + r.id, function () {
            return act("/api/admin/events/calendar/" + r.id + "/stop-after-current", "Run #" + r.id + " ends with its current cycle.");
          }));
        }
      }
      tr.appendChild(actions);
      body.appendChild(tr);
    });
  }

  function editNote(r) {
    var note = window.prompt("Note for " + r.name + " #" + r.id + " (it has started: only the note can change)", r.note || "");
    if (note === null) return;
    request("/api/admin/events/calendar/" + r.id, { method: "PUT", body: JSON.stringify({ note: note }) })
      .then(function () { say("cal-ok", "Note saved."); return load(); })
      .catch(function (e) { say("cal-alert", e.message); });
  }

  /* ---- the form ---- */

  function loopSettings(event) {
    var e = rules && (rules.events || []).filter(function (x) { return x.event === event; })[0];
    return (e && e.loopSettings) || {};
  }

  /* ---- the "?" circles: a button described by its text; hover or focus shows it, a tap or click keeps it open ---- */

  var helpSeq = 0;

  function addHelp(label, key, event) {
    var text = help(key, event);
    if (!label || !text || label.parentNode.querySelector(".help-tip")) return;
    var head = el("div", "field-head");
    label.parentNode.insertBefore(head, label);
    head.appendChild(label);
    var id = "cal-help-" + (++helpSeq);
    var b = el("button", "help-tip", "?");
    b.type = "button";
    b.dataset.help = key;
    b.setAttribute("aria-label", "What is \"" + label.textContent.trim() + "\"?");
    b.setAttribute("aria-describedby", id);
    b.setAttribute("aria-expanded", "false");
    var pop = el("span", "help-pop", text);
    pop.id = id;
    pop.setAttribute("role", "tooltip");
    // Escape hides it while the button keeps focus; leaving the button forgets that.
    ["blur", "mouseleave"].forEach(function (t) { b.addEventListener(t, function () { pop.classList.remove("is-dismissed"); }); });
    b.addEventListener("click", function (e) {
      e.preventDefault();
      var open = !pop.classList.contains("is-open");
      closeHelp();
      pop.classList.remove("is-dismissed");
      pop.classList.toggle("is-open", open);
      b.setAttribute("aria-expanded", String(open));
    });
    head.appendChild(b);
    head.appendChild(pop);
  }

  function closeHelp(dismiss) {
    if (dismiss && document.activeElement && document.activeElement.classList.contains("help-tip")) {
      document.activeElement.nextSibling.classList.add("is-dismissed");
    }
    Array.prototype.forEach.call(document.querySelectorAll("#panel-events .help-pop.is-open"), function (p) {
      p.classList.remove("is-open");
      p.previousSibling.setAttribute("aria-expanded", "false");
    });
  }

  // The Ends field from the start and the settings (the API's own end comes with the check).
  function syncEnd() {
    var v = values(), start = ms(fromInput(v.start)), sh = start === null ? null : shape(v.event, start, v.settings);
    $("cal-end").value = sh && !isNaN(sh.end) ? toInput(iso(sh.end)) : "";
    $("cal-end").readOnly = v.event === "diva";
  }

  // A new end typed in: the last length follows (festival rewards, Cup/VS whole cycles), as when dragging the edge.
  function endChanged() {
    var v = values(), t = ms(fromInput($("cal-end").value)), start = ms(fromInput(v.start));
    if (t === null || start === null) return;
    var sh = shape(v.event, start, v.settings);
    if (!sh || isNaN(sh.end)) return;
    var settings = {};
    Object.keys(v.settings).forEach(function (k) { settings[k] = v.settings[k] === "" ? "" : Number(v.settings[k]); });
    var d = resizeRun({ id: -1, event: v.event, startsAt: iso(start), coreEndsAt: iso(sh.core), endsAt: iso(sh.end), settings: settings }, "end", t);
    if (!d) return;
    ["rewards_hours", "cycles"].forEach(function (k) { if ($("cal-s-" + k) && d.settings[k] !== undefined) $("cal-s-" + k).value = String(d.settings[k]); });
    syncEnd();
    scheduleCheck();
  }

  function renderSettings(event, values) {
    var box = $("cal-settings");
    clear(box);
    var defaults = values || loopSettings(event);
    (FIELDS[event] || []).forEach(function (f) {
      var field = el("div", "field");
      var label = el("label", null, f[1]);
      label.htmlFor = "cal-s-" + f[0];
      field.appendChild(label);
      var input = el("input");
      input.type = "number";
      input.id = "cal-s-" + f[0];
      input.min = "0";
      input.step = event === "festa" ? "0.5" : "1";
      if (f[0] === "first_cycle") input.placeholder = "next free";
      var v = defaults[f[0]];
      input.value = v === undefined || v === null ? "" : String(v);
      input.addEventListener("input", function () { syncEnd(); scheduleCheck(); });
      field.appendChild(input);
      box.appendChild(field);
      addHelp(label, f[0], event);
    });
    if (event === "diva") {
      var field = el("div", "field admin-wide");
      var label = el("span", "field-label", "Diva weeks");
      field.appendChild(label);
      field.appendChild(el("p", "note-text", "Diva Defense always lasts 21 days: weeks 1-2 are its core, week 3 (rewards and the coin shop) runs beside the next event."));
      box.appendChild(field);
      addHelp(label, "diva");
    }
  }

  function values() {
    var event = $("cal-event").value, settings = {};
    (FIELDS[event] || []).forEach(function (f) { settings[f[0]] = $("cal-s-" + f[0]).value; });
    return { event: event, start: $("cal-start").value, core: $("cal-core").value,
      settings: settings, note: $("cal-note-text").value.trim(), anyTime: $("cal-anytime").checked };
  }

  function scheduleCheck() {
    clearTimeout(state.checkTimer);
    state.checkTimer = setTimeout(runCheck, 400);
  }

  function runCheck() {
    var v = values();
    if (!v.start) { list("cal-problems", []); $("cal-computed").textContent = ""; return; }
    var seq = ++state.checkSeq;
    var q = state.editing ? "?id=" + state.editing : "";
    request("/api/admin/events/calendar/check" + q, { method: "POST", body: JSON.stringify(body(v)) }).then(function (c) {
      if (seq !== state.checkSeq) return;
      if (c.endsAt && document.activeElement !== $("cal-end")) $("cal-end").value = toInput(c.endsAt);
      $("cal-computed").textContent = c.endsAt ? "Core to " + utc(c.coreEndsAt) + " UTC, ends " + utc(c.endsAt) + " UTC"
        + (c.settings && c.settings.first_cycle !== undefined ? ", cycles from " + c.settings.first_cycle : "") + "." : "";
      list("cal-problems", c.problems, c.problems && c.problems.length ? [] : ["The checks pass."].concat(c.warnings || []));
    }).catch(function (e) {
      if (seq === state.checkSeq) list("cal-problems", [e.message]);
    });
  }

  function resetForm() {
    state.editing = null;
    $("cal-form").reset();
    $("cal-form-title").textContent = "Add a run";
    $("cal-save").textContent = "Add the run";
    $("cal-reset").hidden = true;
    renderSettings($("cal-event").value);
    list("cal-problems", []);
    $("cal-computed").textContent = "";
    $("cal-gap-hint").hidden = true;
    showLane();
    syncEnd();
  }

  // The lane the chosen event goes in (the API sets it; there is no field).
  function showLane() {
    var lane = LANE_OF[$("cal-event").value];
    $("cal-lane-note").textContent = LANE_NAMES[lane] + ": runs start on a " + BOUNDARY[lane].text.replace(" UTC", "") + " UTC; one at a time.";
  }

  function startEdit(r) {
    state.editing = r.id;
    $("cal-event").value = r.event;
    showLane();
    $("cal-start").value = toInput(r.startsAt);
    $("cal-core").value = toInput(r.coreEndsAt);
    $("cal-note-text").value = r.note || "";
    $("cal-anytime").checked = false;
    renderSettings(r.event, r.settings || {});
    syncEnd();
    $("cal-form-title").textContent = "Change run #" + r.id + " (" + r.name + ")";
    $("cal-save").textContent = "Save the changes";
    $("cal-reset").hidden = false;
    $("cal-form").scrollIntoView({ behavior: "smooth", block: "start" });
    runCheck();
  }

  function save(event) {
    event.preventDefault();
    say("cal-alert", "");
    say("cal-ok", "");
    var v = values();
    if (!v.start) { list("cal-problems", ["Pick a start."]); return; }
    var id = state.editing;
    var path = "/api/admin/events/calendar" + (id ? "/" + id : "");
    $("cal-save").disabled = true;
    request(path, { method: id ? "PUT" : "POST", body: JSON.stringify(body(v)) }).then(function (r) {
      say("cal-ok", (id ? "Run #" + id + " saved" : NAMES[r.event] + " #" + r.id + " added") + ": from " + utc(r.startsAt)
        + " UTC to " + utc(r.endsAt) + " UTC. The game server reads it within a minute.");
      resetForm();
      return load();
    }).catch(function (e) {
      list("cal-problems", (e.data && e.data.problems) || [e.message]);
    }).then(function () { $("cal-save").disabled = false; });
  }

  /* ---- extend the loop: one form per lane, each from its own "loop next" (loopNext, sideLoopNext) ---- */

  // `lane` is what the API's generate takes ("main" or "side"); `next` the calendar answer's key for it.
  var LOOPS = [{ id: "cal-gen", lane: "main", next: "loopNext" }, { id: "cal-gen-side", lane: "side", next: "sideLoopNext" }];

  function genRequest(l, dry) {
    return { lane: l.lane, from: $(l.id + "-from").value || null, weeks: Number($(l.id + "-weeks").value) || null,
      first: $(l.id + "-first").value, dryRun: dry };
  }

  function showGenerated(l, res) {
    var bad = [], ok = [];
    (res.runs || []).forEach(function (r) {
      var line = r.name + ": " + utc(r.startsAt) + " to " + utc(r.endsAt) + " UTC"
        + (r.settings && r.settings.first_cycle !== undefined ? ", cycle " + r.settings.first_cycle : "");
      if (r.exists) ok.push(line + " (already there, skipped)");
      else if (r.problems && r.problems.length) bad.push(line + ": " + r.problems.join(" "));
      else ok.push(line + " (new)");
    });
    if (!(res.runs || []).length) bad.push("No run of the loop starts in those weeks.");
    list(l.id + "-list", bad, ok.concat(res.warnings || []));
    var fresh = (res.runs || []).filter(function (r) { return !r.exists; }).length;
    $(l.id + "-save").hidden = !(fresh && !(res.problems || []).length);
    $(l.id + "-save").textContent = "Add these " + fresh + (fresh === 1 ? " run" : " runs");
  }

  function preview(l, event) {
    event.preventDefault();
    say("cal-alert", "");
    $(l.id + "-save").hidden = true;
    request("/api/admin/events/calendar/generate", { method: "POST", body: JSON.stringify(genRequest(l, true)) })
      .then(function (res) { showGenerated(l, res); })
      .catch(function (e) { list(l.id + "-list", (e.data && e.data.problems) || [e.message]); });
  }

  function generate(l) {
    $(l.id + "-save").disabled = true;
    request("/api/admin/events/calendar/generate", { method: "POST", body: JSON.stringify(genRequest(l, false)) })
      .then(function (res) {
        say("cal-ok", res.saved + (res.saved === 1 ? " run" : " runs") + " added to the " + (l.lane === "side" ? "side" : "main") + " lane.");
        list(l.id + "-list", []);
        $(l.id + "-save").hidden = true;
        $(l.id + "-from").value = "";
        return load();
      })
      .catch(function (e) { if (e.data && e.data.runs) showGenerated(l, e.data); else list(l.id + "-list", [e.message]); })
      .then(function () { $(l.id + "-save").disabled = false; });
  }

  function wire() {
    $("cal-refresh").addEventListener("click", load);
    $("cal-cancelled").addEventListener("change", load);
    $("cal-event").addEventListener("change", function () { renderSettings($("cal-event").value); showLane(); syncEnd(); scheduleCheck(); });
    ["cal-start", "cal-core", "cal-anytime", "cal-note-text"].forEach(function (id) {
      $(id).addEventListener("input", scheduleCheck);
      $(id).addEventListener("change", scheduleCheck);
    });
    $("cal-start").addEventListener("input", syncEnd);
    $("cal-end").addEventListener("change", endChanged);
    $("cal-form").addEventListener("submit", save);
    $("cal-reset").addEventListener("click", resetForm);
    LOOPS.forEach(function (l) {
      $(l.id).addEventListener("submit", function (e) { preview(l, e); });
      $(l.id + "-save").addEventListener("click", function () { generate(l); });
    });
    $("cal-change-save").addEventListener("click", saveChange);
    $("cal-change-cancel").addEventListener("click", cancelChange);
    $("cal-change-anytime").addEventListener("change", checkChange);
    [["cal-event", "event"], ["cal-lane-label", "lane"], ["cal-start", "starts_at"], ["cal-core", "core_ends_at"], ["cal-end", "ends_at"],
      ["cal-note-text", "note"], ["cal-anytime", "any_time"], ["cal-change-anytime", "any_time"], ["cal-gen-from", "gen_from"],
      ["cal-gen-first", "gen_first"], ["cal-gen-weeks", "gen_weeks"], ["cal-gen-side-from", "gen_from"],
      ["cal-gen-side-first", "gen_first"], ["cal-gen-side-weeks", "gen_weeks"]].forEach(function (f) {
      var label = f[0] === "cal-lane-label" ? $(f[0]) : document.querySelector("label[for='" + f[0] + "']") || $(f[0]).closest("label");
      addHelp(label, f[1]);
    });
    document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".field-head")) closeHelp(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeHelp(true); });
  }

  window.startAdminEvents = function () {
    if (!started) {
      started = true;
      wire();
      request("/api/admin/events/rules").then(function (r) { rules = r; }).catch(function () { rules = null; })
        .then(function () { renderSettings($("cal-event").value); });
    }
    load();
  };
})();
