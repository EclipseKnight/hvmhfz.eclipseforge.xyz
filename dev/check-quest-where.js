#!/usr/bin/env node
/* Checks where each quest can be taken on Hunsterverse (data/quest-where.json from dev/make-quest-where.py, method in
   dev/quest-where.md) and the quest page's line:
   - the data: make-quest-where.py --check and make-quest-pieces.py --check pass (the pieces carry each quest's
     "where"); every quest of data/quests.json has exactly one entry and no other id is there; every status is
     offered / unconfirmed / not-offered and agrees with its places (offered: a place known for sure; unconfirmed:
     only places with sure false; not-offered: none); every place has a path that starts with a counter of the menu
     tree, a patch of both / stable / pre, and sure only as false; "hidden" only on a quest that is not offered;
     the counts add up; every live event quest the site has (dev/quest-where-inputs.json) is offered; a hand-checked
     table (the G Deco Quests and Special Material files not offered, a Key, an Urgent, a G★1, the G Urgent, the Road
     and a Sky Corridor quest of v1.30 only; the Guild Master's Goocoo Quests with their garden conditions, the GR 0
     Clan Request, the opening quest and a story chapter's gate unconfirmed);
   - in headless Chromium at 375 and 1280 px, with every request leaving the machine aborted: quest.html shows
     "Where to take it on Hunsterverse" with the counter path (22030), "Not offered on Hunsterverse" and the hidden
     G Deco Quests tab (21691), the Guild Master's Goocoo Quests with its "needs" condition (26590), "pre-release patch (Test land) only" (an SR Guide quest) and an "Unconfirmed:" line;
     no sideways scrolling, no page errors.
   SHOTS=<folder> also saves the quest pages.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-quest-where.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS;
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

const problems = [];
const check = (ok, text) => { if (!ok) problems.push(text); };
const json = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

const where = json("data/quest-where.json");
const inputs = json("dev/quest-where-inputs.json");
const quests = json("data/quests.json").quests;
const COUNTERS = ["General Quest Counter", "G Rank Quest Counter", "G Rank Quest Counter (My Missions menu)", "H.Road/Sky Corridor", "Caravan Quest Counter",
  "Winner Quest Counter", "Rookie counter (Accepting the first quest)", "Diva Defense", "Series Quest Counter",
  "Guild Master (Mezeporta)", "New character's opening (Mezeporta)"];
const STATUSES = ["offered", "unconfirmed", "not-offered"];

function staticChecks() {
  for (const [script, args] of [["make-quest-where.py", ["--check"]], ["make-quest-pieces.py", ["--check"]]]) {
    const run = childProcess.spawnSync("python3", [path.join(root, "dev", script)].concat(args), { encoding: "utf8" });
    check(run.status === 0, ((run.stdout || "") + (run.stderr || "")).trim() || "dev/" + script + " --check failed");
  }
  const w = where.quests;
  const ids = new Set(quests.map((q) => String(q.id)));
  check(Object.keys(w).length === ids.size, "data/quest-where.json: " + Object.keys(w).length + " quests, data/quests.json " + ids.size);
  for (const id of ids) check(w[id], "quest " + id + ": no entry in data/quest-where.json");
  for (const id of Object.keys(w)) check(ids.has(id), "data/quest-where.json: quest " + id + " is not in data/quests.json");
  const counts = { offered: 0, unconfirmed: 0, "not-offered": 0 };
  for (const [id, e] of Object.entries(w)) {
    check(STATUSES.includes(e.status), "quest " + id + ": status " + e.status);
    counts[e.status] = (counts[e.status] || 0) + 1;
    check(Array.isArray(e.places), "quest " + id + ": no places list");
    const places = e.places || [];
    const sure = places.filter((p) => p.sure !== false);
    const want = sure.length ? "offered" : places.length ? "unconfirmed" : "not-offered";
    check(e.status === want, "quest " + id + ": status " + e.status + " but its places say " + want);
    for (const p of places) {
      check(typeof p.path === "string" && COUNTERS.some((c) => p.path.startsWith(c + " > ")), "quest " + id + ": path " + p.path);
      check(["both", "stable", "pre"].includes(p.patch), "quest " + id + ": patch " + p.patch);
      check(p.sure === undefined || p.sure === false, "quest " + id + ": sure " + p.sure);
      check(Object.keys(p).every((k) => ["path", "patch", "need", "note", "sure"].includes(k)), "quest " + id + ": fields " + Object.keys(p));
      // need and note show on the quest page: plain words, no addresses, offsets or config keys
      for (const k of ["need", "note"]) {
        if (p[k] !== undefined) check(!/0x[0-9a-fA-F]|\b[A-Z][A-Za-z]+\.[A-Z][A-Za-z]+/.test(p[k]), "quest " + id + ": " + k + " not plain: " + p[k]);
      }
    }
    check(!e.hidden || (e.status !== "offered" && e.hidden.length), "quest " + id + ": hidden lists on an offered quest");
  }
  for (const s of STATUSES) check(where.counts[s] === counts[s], "counts." + s + " " + where.counts[s] + ", entries " + counts[s]);
  // Every live event quest the site has is on some counter row.
  const ev = new Set(inputs.live.event_quests.map((r) => String(r[0])));
  const missed = [...ev].filter((id) => w[id] && w[id].status !== "offered");
  check(missed.length === 0, "live event quests not offered: " + missed.join());
  // Hand-checked (2026-11-25): the guide's "G Deco Quests" and "Special Material" tabs are not on our counters.
  const byCat = (c) => quests.filter((q) => q.category === c).map((q) => String(q.id));
  for (const cat of ["G Decor Quest", "Special Material"]) {
    const off = byCat(cat).filter((id) => w[id].status !== "not-offered");
    check(byCat(cat).length > 60 && off.length === 0, cat + ": " + off.length + " not marked not offered: " + off.slice(0, 5));
  }
  check((w["21691"].hidden || []).includes("Order Quests > G Deco Quests"), "21691: not in the hidden G Deco Quests list");
  check(!Object.values(w).some((e) => e.places.some((p) => /G Deco Quests|Order Quests/.test(p.path))), "a place under Order Quests");
  const places = (id) => w[id].places.filter((p) => p.sure !== false).map((p) => p.path + "|" + p.patch);
  const expect = {
    22030: ["General Quest Counter > Hunter Quests > Urgent Quests|both"],
    22013: ["General Quest Counter > Hunter Quests > ★1|both"],
    23253: ["G Rank Quest Counter > G Hunter Quests > G★1 Quests|both"],
    23527: ["H.Road/Sky Corridor > Hunting Road > Hunting Road Quests|both"],
    21731: ["H.Road/Sky Corridor > Hunting Road > Hunting Road Quests|stable"],
  };
  for (const [id, want] of Object.entries(expect)) {
    check(JSON.stringify(places(id)) === JSON.stringify(want), "quest " + id + ": " + JSON.stringify(places(id)));
  }
  check(places("54244").includes("G Rank Quest Counter > G Urgent Quests|both"), "54244: not in G Urgent Quests");
  // Lists opened by NPC talk or a game state (TALK_LISTS in make-quest-where.py; hvmhfz_re docs/guku-egg-quests.md):
  // the Guild Master's Goocoo Quests by garden progress, each with its condition; the GR 0 Clan Request and the
  // opening quest unconfirmed; a story chapter's quest gate (21122) unconfirmed.
  const guku = "Guild Master (Mezeporta) > Goocoo Quests";
  for (const id of [26590, 26591, 26592, 26597, 26598, 26593, 26594, 26595, 26626, 26627, 26628, 26629, 26630]) {
    const p = w[id].places.find((x) => x.path === guku);
    check(w[id].status === "offered" && p && p.patch === "both" && p.sure === undefined && p.need, "quest " + id + ": not offered by the Guild Master with a need: " + JSON.stringify(w[id].places));
  }
  check(/My Garden/.test((w[26590].places[0] || {}).need) && /runs away/.test((w[26593].places[0] || {}).need) &&
    /hatched/.test((w[26626].places[0] || {}).need), "Goocoo Quests needs: " + [26590, 26593, 26626].map((id) => (w[id].places[0] || {}).need));
  const unsurePlace = (id, path) => w[id].status === "unconfirmed" && w[id].places.some((p) => p.path === path && p.sure === false);
  check(unsurePlace(23001, "G Rank Quest Counter > Clan Requests") && w[23001].places[0].need === "HR 999, before G Rank", "23001: " + JSON.stringify(w[23001]));
  for (const id of [26687, 26688]) check(unsurePlace(id, "New character's opening (Mezeporta) > Hunter Quests"), "quest " + id + ": " + JSON.stringify(w[id]));
  check(w[21122].places.some((p) => p.path === "General Quest Counter > Diva Story" && p.sure === false && /chapter 3/.test(p.note)), "21122: no Diva Story gate");
  check(w["21731"].places.every((p) => !p.path.includes("General Quest Counter")), "the Road list under the General Quest Counter");
}

async function main() {
  staticChecks();
  const w = where.quests;
  const preOnly = Object.keys(w).find((id) => w[id].places.some((p) => p.path.includes("SR Guide") && p.patch === "pre"));
  const unsure = Object.keys(w).find((id) => w[id].status === "unconfirmed");
  check(preOnly && unsure, "no pre-release-only or unconfirmed quest to show");
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const width of [375, 1280]) {
    const tag = width + " px";
    const context = await browser.newContext({ viewport: { width, height: width < 800 ? 812 : 900 }, hasTouch: width < 800 });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const line = async (id) => {
      await page.goto(base + "/quest.html?id=" + id, { waitUntil: "load" });
      await page.waitForSelector(".quest-facts .quest-where");
      const head = await page.$eval(".quest-facts .quest-where", (td) => td.parentNode.querySelector("th").textContent);
      check(head === "Where to take it on Hunsterverse", tag + ": quest " + id + ": row heading " + head);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(wide <= 1, tag + ": quest " + id + " scrolls sideways by " + wide + "px");
      if (shots) await page.screenshot({ path: path.join(shots, "quest-where-" + id + "-" + width + ".png"), fullPage: true });
      return page.$eval(".quest-facts .quest-where", (td) => td.innerText);
    };
    let text = await line(22030);
    check(text.includes("General Quest Counter > Hunter Quests > Urgent Quests"), tag + ": 22030: " + text);
    text = await line(21691);
    check(text.includes("Not offered on Hunsterverse") && text.includes("Order Quests > G Deco Quests"), tag + ": 21691: " + text);
    text = await line(26590);
    check(text.includes("Guild Master (Mezeporta) > Goocoo Quests (needs HR 2+, and say yes to the Felyne Caretaker in your own My Garden"), tag + ": 26590: " + text);
    text = await line(preOnly);
    check(text.includes("SR Guide Quests") && text.includes("pre-release patch (Test land) only"), tag + ": " + preOnly + ": " + text);
    text = await line(unsure);
    check(/^Unconfirmed: /m.test(text), tag + ": " + unsure + ": " + text);
    check(errors.length === 0, tag + ": page errors: " + errors.join(" | "));
    await context.close();
  }
  await browser.close();
  server.close();
}

main().then(() => {
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL " + p));
    process.exit(1);
  }
  console.log("quest where OK");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
