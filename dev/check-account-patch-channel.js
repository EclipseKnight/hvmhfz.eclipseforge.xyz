#!/usr/bin/env node
/* Checks the "Client patch" box on the account page (js/account-patch-channel.js) in headless Chromium against a
   fake API with the shape of GET/PUT /api/account/patch-channel (several slots, characters, notes):

   - the box is hidden when the endpoint is missing (404) or fails (500);
   - a plain user sees the characters (version, "pre-release", when seen; "not seen yet"), the published slots with
     their notes, the "Join the playtest" switch (off) with its explanation above the pre-releases, the line
     "Pre-releases are for playtesters. Join the playtest above to choose one." and no choice;
   - joining PUTs {"join": true}, shows the API's message and the pre-release choice (Stable + one per slot); picking a
     slot and then leaving PUTs {"join": false}, the API puts the channel back to stable, the choice goes away again;
     a refusal shows the API's message and puts the switch back; without the endpoint (an older API) the switch is
     hidden and the line names playtesters, moderators and admins;
   - "No pre-release is out right now." with no slots; "Could not load the pre-releases." when slotsAvailable is false;
   - a tester sees the choice (Stable + one button per slot, current one aria-pressed) and the owner's Test-land text
     next to it; a click PUTs {"channel": "pre:<slot>"}, shows the API's message and moves the mark, and it
     survives a reload; a slot that is not published shows as "(not out: you get stable)";
   - a 403 refusal shows the API's message as an error and leaves the mark where it was;
   - no horizontal overflow at 375px, no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-patch-channel.js

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

const SLOTS = [
  { slot: "balance", version: "v1.21-pre1", notes: ["Weapon tuning"], published: "2026-11-09T18:00:00Z" },
  { slot: "mods", version: "v1.21-pre2", notes: ["Quick retire", "Skip wait"], published: "2026-11-09T21:15:37Z" }
];
const CHARS = [
  { id: 5, name: "Hunter", clientPatch: 12102, clientPatchName: "v1.21-pre2", clientPatchSeenAt: "2026-11-09T22:00:00Z" },
  { id: 6, name: "Old<b>Guy</b>", clientPatch: 120, clientPatchName: "v1.20", clientPatchSeenAt: "2026-11-08T10:30:00Z" },
  { id: 7, name: "Fresh", clientPatch: null, clientPatchName: null, clientPatchSeenAt: null },
  { id: 8, name: "Ahead", clientPatch: 121, clientPatchName: "v1.21", clientPatchSeenAt: "2026-11-09T08:00:00Z" }
];

// mode: "user" (not eligible until it joins), "missing" (404), "broken" (500), "old" (API before slots), "tester";
// state.slots, state.slotsAvailable; state.joined (the playtest role, default false); state.noPlaytest (no such endpoint);
// state.refuseJoin (the playtest PUT answers 503); state.playtestPuts (the bodies it got)
async function open(browser, base, mode, state, width) {
  const page = await browser.newPage({ viewport: { width: width || 1280, height: 900 }, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p === "/api/account/playtest") {
      if (state.noPlaytest) return reply(404, { message: "Not found" });
      if (req.method() === "GET") return reply(200, { joined: state.joined === true });
      const body = JSON.parse(req.postData());
      (state.playtestPuts = state.playtestPuts || []).push(body);
      if (state.refuseJoin) return reply(503, { message: "The playtest is not open yet." });
      state.joined = body.join === true;
      if (!state.joined) state.channel = "stable"; // leaving resets the channel
      return reply(200, { joined: state.joined, channel: state.channel,
        message: state.joined ? "You joined the playtest. You can now choose the pre-release patch." : "You left the playtest. Your launcher puts the stable patch back at its next login." });
    }
    if (p === "/api/account/patch-channel") {
      if (mode === "missing") return reply(404, { message: "Not found" });
      if (mode === "broken") return reply(500, { message: "boom" });
      if (mode === "old" && req.method() === "GET") return reply(200, { channel: "pre", eligible: true });
      if (req.method() === "GET") {
        const slot = state.channel.startsWith("pre:") ? state.channel.slice(4) : null;
        return reply(200, { channel: state.channel, slot, eligible: mode === "tester" || state.joined === true, slotsAvailable: state.slotsAvailable !== false,
          slots: state.slotsAvailable === false ? [] : state.slots, characters: state.characters || CHARS, currentPatch: "v1.20" });
      }
      if (req.method() === "PUT") {
        const body = JSON.parse(req.postData());
        state.puts.push(body);
        if (state.refuse) return reply(403, { message: "Your account cannot use the pre-release patch." });
        state.channel = body.channel;
        return reply(200, { channel: state.channel, slot: body.channel === "stable" ? null : body.channel.slice(4), eligible: true,
          message: body.channel === "stable" ? "Stable patch on from your next launcher login." : "Pre-release " + body.channel.slice(4) + " on from your next launcher login." });
      }
    }
    if (p === "/api/account") return reply(200, { name: "author", roles: ["ROLE_USER"], characters: 0, lastLogin: null });
    if (p === "/api/account/qol") return reply(200, { features: [], flags: 0, takesEffect: "next login" });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
  await page.goto(base + "/account.html#account");
  await page.waitForSelector("#qol-list", { timeout: 5000 });
  await page.waitForTimeout(600);
  return { page, errors };
}

const marked = (page) => page.$$eval("#patch-channel-choices [data-channel]", (n) => n.filter((b) => b.classList.contains("is-on") && b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.channel));
const J = JSON.stringify;

async function run(browser, base) {
  // An API without the endpoint, or a broken one: the box stays hidden.
  // An API from before slots ({channel, eligible} only) too: its answer would show a wrong picture.
  for (const mode of ["missing", "broken", "old"]) {
    const { page, errors } = await open(browser, base, mode, { channel: "stable", puts: [], slots: SLOTS });
    check("box hidden for " + mode, !(await page.isVisible("#patch-channel-panel")));
    check("no page errors for " + mode, !errors.length, errors.join("; "));
    await page.close();
  }

  // A plain user: information only, no switch.
  {
    const { page, errors } = await open(browser, base, "user", { channel: "stable", puts: [], slots: SLOTS });
    check("box shown for a plain user", await page.isVisible("#patch-channel-panel"));
    check("heading", (await page.textContent("#patch-channel-panel h2")) === "Client patch");
    const chars = await page.$$eval("#patch-chars li", (n) => n.map((x) => x.textContent));
    check("character: pre-release build", chars[0] === "Hunter: v1.21-pre2, pre-release, 9 Nov, 22:00 UTC", J(chars));
    check("character: current release, no pre-release", chars[1] === "Old<b>Guy</b>: v1.20, 8 Nov, 10:30 UTC", J(chars));
    check("character: not seen", chars[2] === "Fresh: not seen yet", J(chars));
    check("character: newer than current is pre-release", chars[3].startsWith("Ahead: v1.21, pre-release, "), J(chars));
    check("API text not parsed as HTML", (await page.$$("#patch-chars b")).length === 0);
    const slots = await page.textContent("#patch-slots");
    check("slot lines", slots.includes("Pre-release available: v1.21-pre2 (mods)") && slots.includes("Pre-release available: v1.21-pre1 (balance)"), slots);
    check("notes", slots.includes("What you are testing:") && (await page.$$eval("#patch-slots .patch-notes li", (n) => n.map((x) => x.textContent))).join("|") === "Weapon tuning|Quick retire|Skip wait");
    check("no switch", !(await page.isVisible("#patch-switch")) && !(await page.isVisible("#patch-warning")));
    check("not eligible line", (await page.textContent("#patch-not-eligible")) === "Pre-releases are for playtesters. Join the playtest above to choose one." && await page.isVisible("#patch-not-eligible"));
    check("playtest switch shown, off", await page.isVisible("#playtest-box") && !(await page.isChecked("#playtest-toggle"))
      && (await page.textContent("#playtest-box label")).trim() === "Join the playtest" && (await page.getAttribute("#playtest-toggle", "role")) === "switch");
    check("playtest explanation", (await page.textContent("#playtest-box")).includes("Playtesters can try pre-release client patches before everyone else."));
    check("playtest switch above the pre-releases and the choice", await page.evaluate(() => {
      const t = document.getElementById("playtest-box"), pos = (id) => t.compareDocumentPosition(document.getElementById(id));
      return !!(pos("patch-slots") & Node.DOCUMENT_POSITION_FOLLOWING) && !!(pos("patch-switch") & Node.DOCUMENT_POSITION_FOLLOWING);
    }));
    check("no page errors (user)", !errors.length, errors.join("; "));
    await page.close();
  }

  // An older API without /api/account/playtest: no switch, the old line.
  {
    const { page, errors } = await open(browser, base, "user", { channel: "stable", puts: [], slots: SLOTS, noPlaytest: true });
    check("no playtest switch without the endpoint", await page.isVisible("#patch-channel-panel") && !(await page.isVisible("#playtest-box")));
    check("old not-eligible line", (await page.textContent("#patch-not-eligible")) === "Pre-releases are for playtesters, moderators and admins.");
    check("no page errors (no playtest endpoint)", !errors.length, errors.join("; "));
    await page.close();
  }

  // Join, choose a slot, leave; and a refused join.
  {
    const st = { channel: "stable", puts: [], slots: SLOTS, joined: false };
    const { page, errors } = await open(browser, base, "user", st);
    await page.click("#playtest-toggle");
    await page.waitForFunction(() => /You joined the playtest/.test(document.getElementById("playtest-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("join PUTs {join: true}", J(st.playtestPuts) === J([{ join: true }]), J(st.playtestPuts));
    check("join message", (await page.textContent("#playtest-note")) === "You joined the playtest. You can now choose the pre-release patch.", await page.textContent("#playtest-note"));
    check("switch on, choice shown, not-eligible line gone", await page.isChecked("#playtest-toggle") && await page.isVisible("#patch-switch") && !(await page.isVisible("#patch-not-eligible")));
    check("choice has Stable and the slots", J(await page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((b) => b.dataset.channel))) === J(["stable", "pre:balance", "pre:mods"]));
    await page.click('[data-channel="pre:mods"]');
    await page.waitForFunction(() => /Pre-release mods on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("slot chosen", st.channel === "pre:mods" && J(await marked(page)) === J(["pre:mods"]));
    await page.click("#playtest-toggle");
    await page.waitForFunction(() => /You left the playtest/.test(document.getElementById("playtest-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("leave PUTs {join: false}", J(st.playtestPuts) === J([{ join: true }, { join: false }]), J(st.playtestPuts));
    check("left: channel reset to stable, choice gone, switch off", st.channel === "stable" && !(await page.isVisible("#patch-switch"))
      && await page.isVisible("#patch-not-eligible") && !(await page.isChecked("#playtest-toggle")));
    check("leave message", (await page.textContent("#playtest-note")) === "You left the playtest. Your launcher puts the stable patch back at its next login.", await page.textContent("#playtest-note"));
    check("no page errors (join and leave)", !errors.length, errors.join("; "));
    await page.close();

    const bad = { channel: "stable", puts: [], slots: SLOTS, joined: false, refuseJoin: true };
    const b = await open(browser, base, "user", bad);
    await b.page.click("#playtest-toggle");
    await b.page.waitForSelector("#patch-channel-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("refused join shows the API's message", (await b.page.textContent("#patch-channel-alert")) === "The playtest is not open yet.", await b.page.textContent("#patch-channel-alert"));
    check("refused join puts the switch back, no choice", !(await b.page.isChecked("#playtest-toggle")) && !(await b.page.isVisible("#patch-switch")) && !(await b.page.isDisabled("#playtest-toggle")));
    await b.page.close();
  }

  // No slot out, and the slot list not loadable.
  {
    const a = await open(browser, base, "user", { channel: "stable", puts: [], slots: [] });
    check("no pre-release text", (await a.page.textContent("#patch-slots")) === "No pre-release is out right now.");
    await a.page.close();
    const b = await open(browser, base, "tester", { channel: "stable", puts: [], slots: [], slotsAvailable: false });
    check("slots unavailable text", (await b.page.textContent("#patch-slots")) === "Could not load the pre-releases.");
    check("switch still has Stable", J(await b.page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((x) => x.dataset.channel))) === J(["stable"]));
    await b.page.close();
  }

  // A tester.
  const state = { channel: "stable", puts: [], refuse: false, slots: SLOTS };
  const { page, errors } = await open(browser, base, "tester", state);
  check("box shown for a tester", await page.isVisible("#patch-channel-panel"));
  check("switch shown, no not-eligible line", await page.isVisible("#patch-switch") && !(await page.isVisible("#patch-not-eligible")));
  const warn = (await page.textContent("#patch-warning")).trim();
  check("warning text", warn === "Pre-release patches play only on the Test land, where nothing is saved. They cannot play on normal lands; switch back to Stable to play normally (if you try a normal land, you are switched back automatically).", warn);
  check("warning visible next to the switch", await page.isVisible("#patch-warning")
    && await page.evaluate(() => document.getElementById("patch-warning").previousElementSibling === document.getElementById("patch-channel-choices")));
  const labels = await page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((b) => b.dataset.channel + ":" + b.textContent.trim()));
  check("choices", J(labels) === J(["stable:Stable", "pre:balance:balance (v1.21-pre1)", "pre:mods:mods (v1.21-pre2)"]), J(labels));
  check("stable marked", J(await marked(page)) === J(["stable"]), J(await marked(page)));

  await page.click('[data-channel="pre:mods"]');
  await page.waitForFunction(() => /Pre-release mods on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends pre:mods", J(state.puts) === J([{ channel: "pre:mods" }]), J(state.puts));
  check("message shown", (await page.textContent("#patch-channel-note")) === "Pre-release mods on from your next launcher login.", await page.textContent("#patch-channel-note"));
  check("pre:mods marked", J(await marked(page)) === J(["pre:mods"]), J(await marked(page)));

  await page.reload();
  await page.waitForSelector("#patch-channel-panel:not([hidden])", { timeout: 5000 });
  check("choice survives a reload", J(await marked(page)) === J(["pre:mods"]));

  await page.click('[data-channel="pre:balance"]');
  await page.waitForFunction(() => /Pre-release balance on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("other slot marked", J(await marked(page)) === J(["pre:balance"]));

  await page.click('[data-channel="stable"]');
  await page.waitForFunction(() => /Stable patch on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends stable", J(state.puts[2]) === J({ channel: "stable" }), J(state.puts));
  check("stable marked again", J(await marked(page)) === J(["stable"]));

  // A 403 refusal: the API's message is shown, the mark stays.
  state.refuse = true;
  await page.click('[data-channel="pre:mods"]');
  await page.waitForSelector("#patch-channel-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("403 message shown", (await page.textContent("#patch-channel-alert")) === "Your account cannot use the pre-release patch.", await page.textContent("#patch-channel-alert"));
  check("mark stays on stable after a refusal", J(await marked(page)) === J(["stable"]));
  check("buttons usable again", !(await page.isDisabled('[data-channel="pre:mods"]')));
  check("no page errors", !errors.length, errors.join("; "));
  await page.close();

  // On a slot that is not out: shown and marked, saying what the player gets.
  {
    const st = { channel: "pre:ghost", puts: [], slots: SLOTS };
    const o = await open(browser, base, "tester", st);
    const gone = await o.page.$$eval('#patch-channel-choices [data-channel="pre:ghost"]', (n) => n.map((b) => b.textContent));
    check("unpublished slot shown", J(gone) === J(["ghost (not out: you get stable)"]), J(gone));
    check("unpublished slot marked", J(await marked(o.page)) === J(["pre:ghost"]));
    await o.page.close();
  }

  // 375px: nothing passes the screen (tester, long notes; the page's own tab strip scrolls sideways, so only the box is measured).
  {
    const st = { channel: "pre:mods", puts: [], slots: [{ slot: "mods", version: "v1.21-pre2", published: "2026-11-09T21:15:37Z",
      notes: ["A very long note without any spaces in it to see whether the box wraps: " + "x".repeat(120), "Short"] }] };
    const m = await open(browser, base, "tester", st, 375);
    const w = await m.page.evaluate(() => ({ right: document.getElementById("patch-channel-panel").getBoundingClientRect().right,
      widest: Math.max.apply(null, Array.from(document.querySelectorAll("#patch-channel-panel *")).map((e) => e.getBoundingClientRect().right)) }));
    check("box and everything in it inside 375px", w.right <= 375 && w.widest <= 375, J(w));
    check("no page errors (375px)", !m.errors.length, m.errors.join("; "));
    await m.page.close();
  }
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try { await run(browser, base); } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("account patch channel box OK");
})();
