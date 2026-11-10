#!/usr/bin/env node
/* Checks the "Client patch" box on the account page (js/account-patch-channel.js) in headless Chromium against a
   fake API with the shape of GET/PUT /api/account/patch-channel (several slots, characters, notes):

   - the box is hidden when the endpoint is missing (404) or fails (500);
   - a plain user sees the characters (version, "pre-release", when seen; "not seen yet"), the published slots with
     their notes, and the one choice (Stable + one button per slot, Stable marked, the Test-land warning); there is
     no "Join the playtest" switch any more;
   - a plain user's first pre-release click shows the explanation (Test land only, nothing saved, no normal lands, switch
     back, Playtester role kept 7 days) and sends nothing; "Cancel" sends nothing; "I understand" PUTs
     {"channel": "pre:<slot>", "confirm": true}, shows the API's message and marks the slot; the next pre-release click
     and Stable need no confirmation; a stale page whose PUT answers 409 shows the explanation too;
   - "No pre-release is out right now." with no slots (and no choice); "Could not load the pre-releases." when slotsAvailable is false;
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

// mode: "user" (not eligible until it confirms a pre-release), "missing" (404), "broken" (500), "old" (API before slots), "tester";
// state.slots, state.slotsAvailable; state.role (a confirmed player holds the Playtester role, default false);
// state.stale (GET says no confirmation is needed, the PUT still asks for it)
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
    if (p === "/api/account/patch-channel") {
      if (mode === "missing") return reply(404, { message: "Not found" });
      if (mode === "broken") return reply(500, { message: "boom" });
      if (mode === "old" && req.method() === "GET") return reply(200, { channel: "pre", eligible: true });
      if (req.method() === "GET") {
        const slot = state.channel.startsWith("pre:") ? state.channel.slice(4) : null;
        return reply(200, { channel: state.channel, slot, eligible: mode === "tester" || state.role === true,
          confirmationRequired: !(mode === "tester" || state.role === true || state.stale === true), slotsAvailable: state.slotsAvailable !== false,
          slots: state.slotsAvailable === false ? [] : state.slots, characters: state.characters || CHARS, currentPatch: "v1.20" });
      }
      if (req.method() === "PUT") {
        const body = JSON.parse(req.postData());
        state.puts.push(body);
        if (state.refuse) return reply(403, { message: "Your account cannot use the pre-release patch." });
        if (body.channel !== "stable" && mode !== "tester" && state.role !== true) {
          if (body.confirm !== true) return reply(409, { message: "Pre-release patches play only on the Test land.", confirmationRequired: true });
          state.role = true;
        }
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
    check("choice shown for a plain user, Stable marked", await page.isVisible("#patch-switch")
      && J(await page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((b) => b.dataset.channel))) === J(["stable", "pre:balance", "pre:mods"])
      && J(await marked(page)) === J(["stable"]));
    check("no playtest switch and no not-eligible line", (await page.$$("#playtest-box, #playtest-toggle, #patch-not-eligible")).length === 0);
    check("confirmation hidden at first", !(await page.isVisible("#patch-confirm")));
    check("no page errors (user)", !errors.length, errors.join("; "));
    await page.close();
  }

  // The first pre-release choice of a plain user: explanation, cancel, "I understand", then no more questions.
  {
    const st = { channel: "stable", puts: [], slots: SLOTS, role: false };
    const { page, errors } = await open(browser, base, "user", st);
    await page.click('[data-channel="pre:mods"]');
    check("explanation shown, nothing sent", await page.isVisible("#patch-confirm") && st.puts.length === 0 && st.channel === "stable", J(st.puts));
    const text = await page.textContent("#patch-confirm");
    check("explanation text", ["only on the Test land", "nothing you do there is saved", "cannot play on the normal lands", "Switch back to Stable any time",
      "the server switches you back", "Playtester", "7 days after you last use a pre-release"].every((t) => text.includes(t)), text);
    check("buttons", (await page.textContent("#patch-confirm-ok")) === "I understand" && (await page.textContent("#patch-confirm-cancel")) === "Cancel");
    check("mark still on stable while asking", J(await marked(page)) === J(["stable"]));
    await page.click("#patch-confirm-cancel");
    check("cancel hides it and sends nothing", !(await page.isVisible("#patch-confirm")) && st.puts.length === 0);

    await page.click('[data-channel="pre:mods"]');
    await page.click("#patch-confirm-ok");
    await page.waitForFunction(() => /Pre-release mods on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("I understand PUTs the channel with confirm", J(st.puts) === J([{ channel: "pre:mods", confirm: true }]), J(st.puts));
    check("API message shown, slot marked, explanation gone", (await page.textContent("#patch-channel-note")) === "Pre-release mods on from your next launcher login."
      && J(await marked(page)) === J(["pre:mods"]) && !(await page.isVisible("#patch-confirm")));
    check("role granted by that one call", st.role === true);

    await page.click('[data-channel="stable"]');
    await page.waitForFunction(() => /Stable patch on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
    await page.click('[data-channel="pre:balance"]');
    await page.waitForFunction(() => /Pre-release balance on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("later choices need no confirmation", J(st.puts) === J([{ channel: "pre:mods", confirm: true }, { channel: "stable" }, { channel: "pre:balance" }]) && !(await page.isVisible("#patch-confirm")), J(st.puts));
    check("no page errors (confirm)", !errors.length, errors.join("; "));
    await page.close();

    // Stable never asks, even before the first confirmation.
    const s2 = { channel: "pre:mods", puts: [], slots: SLOTS, role: false };
    const o = await open(browser, base, "user", s2);
    await o.page.click('[data-channel="stable"]');
    await o.page.waitForFunction(() => /Stable patch on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("Stable sends no confirm", J(s2.puts) === J([{ channel: "stable" }]) && !(await o.page.isVisible("#patch-confirm")), J(s2.puts));
    await o.page.close();

    // A stale page (the GET said no confirmation needed): the 409 shows the explanation, and confirming works.
    const s3 = { channel: "stable", puts: [], slots: SLOTS, role: false, stale: true };
    const t = await open(browser, base, "user", s3);
    await t.page.click('[data-channel="pre:mods"]');
    await t.page.waitForSelector("#patch-confirm:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("409 shows the explanation, no error", await t.page.isVisible("#patch-confirm") && !(await t.page.isVisible("#patch-channel-alert"))
      && J(await marked(t.page)) === J(["stable"]) && !(await t.page.isDisabled('[data-channel="pre:mods"]')));
    await t.page.click("#patch-confirm-ok");
    await t.page.waitForFunction(() => /Pre-release mods on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
    check("409 then confirm", J(s3.puts) === J([{ channel: "pre:mods" }, { channel: "pre:mods", confirm: true }]) && s3.channel === "pre:mods", J(s3.puts));
    await t.page.close();
  }

  // No slot out, and the slot list not loadable.
  {
    const a = await open(browser, base, "user", { channel: "stable", puts: [], slots: [] });
    check("no pre-release text", (await a.page.textContent("#patch-slots")) === "No pre-release is out right now.");
    check("no choice when nothing is out", !(await a.page.isVisible("#patch-switch")));
    await a.page.close();
    const b = await open(browser, base, "tester", { channel: "stable", puts: [], slots: [], slotsAvailable: false });
    check("slots unavailable text", (await b.page.textContent("#patch-slots")) === "Could not load the pre-releases.");
    await b.page.close();
    // On a pre-release while the list cannot be read: the choice stays, so the account can go back to Stable.
    const c = await open(browser, base, "tester", { channel: "pre:mods", puts: [], slots: [], slotsAvailable: false });
    check("choice stays with Stable while on a pre-release", J(await c.page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((x) => x.dataset.channel))) === J(["stable", "pre:mods"]));
    await c.page.close();
  }

  // A tester.
  const state = { channel: "stable", puts: [], refuse: false, slots: SLOTS };
  const { page, errors } = await open(browser, base, "tester", state);
  check("box shown for a tester", await page.isVisible("#patch-channel-panel"));
  check("switch shown", await page.isVisible("#patch-switch"));
  const warn = (await page.textContent("#patch-warning")).trim();
  check("warning text", warn === "Pre-release patches play only on the Test land, where nothing is saved. They cannot play on normal lands; switch back to Stable to play normally (if you try a normal land, you are switched back automatically).", warn);
  check("warning visible next to the switch", await page.isVisible("#patch-warning")
    && await page.evaluate(() => document.getElementById("patch-warning").previousElementSibling === document.getElementById("patch-channel-choices")));
  const labels = await page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((b) => b.dataset.channel + ":" + b.textContent.trim()));
  check("choices", J(labels) === J(["stable:Stable", "pre:balance:balance (v1.21-pre1)", "pre:mods:mods (v1.21-pre2)"]), J(labels));
  check("stable marked", J(await marked(page)) === J(["stable"]), J(await marked(page)));

  await page.click('[data-channel="pre:mods"]');
  await page.waitForFunction(() => /Pre-release mods on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends pre:mods without confirm (staff are not asked)", J(state.puts) === J([{ channel: "pre:mods" }]) && !(await page.isVisible("#patch-confirm")), J(state.puts));
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
