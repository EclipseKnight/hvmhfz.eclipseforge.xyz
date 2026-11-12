#!/usr/bin/env node
/* Checks the "Game options" card on the account page (js/account-qol.js) in headless Chromium against a fake API
   with the shape of GET/PUT /api/account/qol:

   - the card is on the Game options tab (the Keys, Viewer options and pre-release parts are
     closed folds; the pre-release one opens by itself on a pre-release channel) and renders one switch per feature the API lists (true raw and true element as
     the API has them, and a made-up third feature that proves the list is not hard-coded), off by default, with its description, "Needs client patch v<minPatch> or
     newer", and "Shows information the game normally hides" only where revealsHiddenInfo is true;
   - the card says changes take effect at the next login;
   - a toggle PUTs only that feature id and shows the saved message, true raw and true element each on their own;
     a refused save (400) puts the switch back and shows an error;
   - the Keys part renders from the "keys" of the GET answer (retire key, retire on death select with the carts
     select only for "When I cart", skip-wait key, five remote talk keys, the two hints); a picker captures Ctrl+R from
     a real keydown, ignores a lone modifier, says so for a key outside the list and cancels on Escape; Save refuses
     a letter without Ctrl/Alt and a Shift talk key before sending anything; Save sends PUT /api/account/qol/keys with
     all five settings; a 400 message from the API is shown;
   - the "iframeViewer" feature shows its switch with the hidden-info mark and the event-rule text; the Viewer options
     part shows when the list has it and the answer has "viewer": four checkboxes, a Position select (Top, Centre,
     Bottom, Left) and a Size select (Small, Normal, Large, Huge) showing the GET values; "Save viewer options" sends
     PUT /api/account/qol/viewer with exactly the six keys and the chosen values, redraws from the answer and says
     so; a 400 message is shown; the part is hidden without "viewer" (an older API) and without the iframeViewer
     feature;
   - under the "damageNumbers" switch: "Other players' hits", "Size", "Multi-hit numbers" (Spread / Combine, with its
     help text) and "Show move id" (with its help text), under "damageMeter": "Corner", "Size" and "Show monster
     health", "Health as effective HP", "Show status build-up", "DPS graph" and "Time to kill estimate" (each with its
     help text), showing the GET values; each change sends PUT /api/account/qol/damage-numbers
     or /damage-meter with only that key, redraws and says so; a 400 message is shown and the control goes back; they
     are greyed out with the switch while locked, and missing when the answer has no "damageNumbers"/"damageMeter";
   - "Weak-spot star" under Damage numbers: a checkbox with its help ("A small gold star above the number when you hit
     a weak spot (45 or more)."), checked from GET (on by default), a change sends PUT .../damage-numbers with only
     {weakSpotStar}; no checkbox when the answer has no "weakSpotStar" (an older API);
   - the line "You can also change these in game: Ctrl+F10, or hold View + Start on a controller." is the first line
     of the card, above the next-login note;
   - "Show sharpness hits left" (the answer's "sharpness": no flags bit) is its own switch line right under Damage
     numbers, with the API's name and description, "Needs client patch v1.21" and the hidden-info mark; a toggle sends
     PUT /api/account/qol/sharpness {hitsLeft} and says so; a refused save puts it back; greyed out with the message
     while locked, in the pre-release section with Damage numbers; missing when the answer has no "sharpness";
   - "Controller buttons" (the answer's "controller"): its own line at the end of its section, a PlayStation / Xbox
     select with the API's description; a change sends PUT /api/account/qol/controller {buttons} and only that; a
     refused save puts it back; while locked the select is disabled with the message (open when it is on Xbox, so the
     way back works); missing when the answer has no "controller";
   - features the API marks preReleaseOnly are listed in their own section "Being tested: pre-release only" (slot name, "These
     work only on a pre-release patch on the Test land"), apart from the stable switches, with the Keys and Viewer
     options parts inside it; while the API gives a lockedMessage ("Switch to the pre-release (mods) to try these")
     their switches, key pickers, selects and viewer options are greyed out (disabled) and show that message, the
     stable switches stay usable; on a slot that has them everything works and saves; the card reloads without a page
     reload when the Client patch box fires "hvmhfz:patch-channel"; once preReleaseOnly is false (a stable release
     reached the feature) the section is gone and the features are in the normal list;
   - at 375px the card and the page content stay inside the screen;
   - no page errors.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-qol.js

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

const DESC = "Shows weapon attack as the true value damage uses, without the weapon-class multiplier (a Great Sword's 1022 shows as 213). Display only: damage and the server's numbers do not change.";
const DESC_ELEMENT = "Shows weapon element and status values as the weapon stores them, without the 0 the game adds at the end (Fire 250 shows as 25, Poison 120 as 12), on the equipment and smithy weapon details, the equipment list and item details. Display only: damage and the server's numbers do not change.";
const EVENT_RULE = "Turned off by itself in Speedrun Cup and VS Bracket quests. A cup time or VS result made while a viewer was showing does not count.";
let viewerState = { iframeBar: true, iframeCount: false, hitstopBar: true, hitIndicator: false, position: "left", size: "large" };
let sendViewer = true;
// "off": an API without the pre-release fields; "locked": on Stable, "open": on a slot that has them; "moved": stable has reached 1.21
let preMode = "off";
let listViewer = true;
let numbersState = { othersHits: true, size: "large", showMoveId: false, multiHit: "spread", weakSpotStar: true };
let sendStar = true;   // false: an API without "weakSpotStar"
const STAR_HELP = "A small gold star above the number when you hit a weak spot (45 or more).";
let meterState = { corner: "bottomLeft", size: "small", showHealth: false, statusBuildUp: false, effectiveHp: false, dpsGraph: false, timeToKill: false };
let sharpnessOn = false;
let controllerButtons = "playstation";
const CONTROLLER_DESC = "Shows A/B/X/Y, LB/RB, LT/RT and LS/RS in the game's button prompts instead of the PlayStation symbols. Takes effect at your next login.";
const SHARPNESS_DESC = "Shows a number right of the game's sharpness gauge: how many hits before the colour drops (a normal hit uses one point). Works without the other viewers. Turned off by itself in Speedrun Cup and VS Bracket quests.";
const METER_MORE = [["effectiveHp", "Health as effective HP", "Shows the health bar's numbers divided by the monster's defence rate: how much raw damage is left. Needs \"Show monster health\"."],
  ["statusBuildUp", "Show status build-up", "Shows sleep, paralysis, stun, poison and blast on each monster: build-up now / needed, or ACTIVE. Only statuses with build-up show."],
  ["dpsGraph", "DPS graph", "Shows the team's and your damage per second over the last 2 minutes, under the meter."],
  ["timeToKill", "Time to kill estimate", "Shows each monster's remaining health over its health loss rate since its first hit: \"kill in ~m:ss\"."]];
let sendOverlays = true;
const MULTI_HIT_HELP = "Spread shows every hit as its own number; Combine adds up rapid hits on one spot.";
const HEALTH_HELP = "Shows a health bar with the number for each monster. Off in Speedrun Cup and VS quests.";
const MOVE_ID_HELP = "Shows which move hit (its attack record id, weapon and style) next to each of your damage numbers, and writes every hit to hvmods.log in the game folder so you can send us the list. For testing move names.";
let keysState = { retireKey: "Ctrl+R", retireOnDeath: "off", retireCarts: 1, skipWaitKey: null, talkKeys: [null, null, null, null, null] };
function state(flags) {
  const defs = [
    { id: "trueRaw", bit: 0, name: "True raw attack", description: DESC, revealsHiddenInfo: false, minPatch: "1.20" },
    { id: "trueElement", bit: 1, name: "True element", description: DESC_ELEMENT, revealsHiddenInfo: false, minPatch: "1.20" },
    { id: "monsterBar", bit: 2, name: "Monster health bar", description: "Shows the monster's remaining health.", revealsHiddenInfo: true, minPatch: "1.21" },
    { id: "iframeViewer", bit: 5, name: "Iframe viewer", description: "Draws bars over the game for your invulnerability frames.", revealsHiddenInfo: true, minPatch: "1.21" },
    { id: "damageNumbers", bit: 6, name: "Damage numbers", description: "Shows the damage of your own hits as numbers over the monster.", revealsHiddenInfo: true, minPatch: "1.21" },
    { id: "damageMeter", bit: 9, name: "Damage meter", description: "Shows, per monster, the damage each hunter dealt this quest.", revealsHiddenInfo: true, minPatch: "1.21" }
  ].filter((d) => listViewer || d.id !== "iframeViewer");
  if (preMode !== "off") {
    defs.splice(3, 0,
      { id: "quickRetire", bit: 3, name: "Quick retire", description: "Leave a quest at once with your retire key.", revealsHiddenInfo: false, minPatch: "1.21" },
      { id: "skipCompleteWait", bit: 4, name: "Skip the quest-complete wait", description: "Skip the wait before the results.", revealsHiddenInfo: false, minPatch: "1.21" },
      { id: "quickTalk", bit: 8, name: "Remote talk", description: "Talk to a chosen NPC from anywhere.", revealsHiddenInfo: false, minPatch: "1.21" });
  }
  const out = { features: defs.map((d) => Object.assign({ enabled: (flags & (1 << d.bit)) !== 0 }, d)), flags, keys: keysState, takesEffect: "next login" };
  if (preMode !== "off") {
    for (const f of out.features) {
      f.preReleaseOnly = preMode !== "moved" && f.minPatch === "1.21";
      f.preReleaseSlot = f.preReleaseOnly ? "mods" : null;
      f.lockedMessage = f.preReleaseOnly && preMode === "locked" ? "Switch to the pre-release (mods) to try these" : null;
    }
    out.stablePatch = preMode === "moved" ? "v1.21" : "v1.20";
    out.channel = preMode === "open" ? "pre:mods" : "stable";
  }
  if (sendViewer) out.viewer = viewerState;
  if (sendOverlays) {
    out.damageNumbers = sendStar ? numbersState : Object.fromEntries(Object.entries(numbersState).filter(([k]) => k !== "weakSpotStar"));
    out.damageMeter = meterState;
    const pre = preMode !== "off" && preMode !== "moved";
    out.sharpness = { hitsLeft: sharpnessOn, name: "Show sharpness hits left", description: SHARPNESS_DESC, revealsHiddenInfo: true, minPatch: "1.21",
      preReleaseOnly: pre, lockedMessage: pre && preMode === "locked" ? "Switch to the pre-release (mods) to try these" : null, preReleaseSlot: pre ? "mods" : null };
    out.controller = { buttons: controllerButtons, name: "Controller buttons", description: CONTROLLER_DESC, minPatch: "1.21",
      preReleaseOnly: pre, lockedMessage: pre && preMode === "locked" ? "Switch to the pre-release (mods) to try these" : null, preReleaseSlot: pre ? "mods" : null };
  }
  return out;
}

async function run(browser, base) {
  let flags = 0;
  let refuse = false;
  let refuseKeys = false;
  let refuseViewer = false;
  const puts = [];
  const keyPuts = [];
  const viewerPuts = [];
  const overlayPuts = [];
  let refuseOverlay = false;
  const sharpnessPuts = [];
  let refuseSharpness = false;
  const controllerPuts = [];
  let refuseController = false;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    if (p === "/api/account/qol" && req.method() === "GET") return reply(200, state(flags));
    if (p === "/api/account/qol/keys" && req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      keyPuts.push(body);
      if (refuseKeys) return reply(400, { message: "Ctrl+R is used twice" });
      keysState = body;
      return reply(200, state(flags));
    }
    if (p === "/api/account/qol/viewer" && req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      viewerPuts.push(body);
      if (refuseViewer) return reply(400, { message: "position must be top, center, bottom or left" });
      viewerState = Object.assign({}, viewerState, body);
      return reply(200, state(flags));
    }
    if ((p === "/api/account/qol/damage-numbers" || p === "/api/account/qol/damage-meter") && req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      overlayPuts.push([p.split("/").pop(), body]);
      if (refuseOverlay) return reply(400, { error: "Option \"size\" must be one of [normal, small, large, huge]" });
      if (p.endsWith("numbers")) numbersState = Object.assign({}, numbersState, body);
      else meterState = Object.assign({}, meterState, body);
      return reply(200, state(flags));
    }
    if (p === "/api/account/qol/sharpness" && req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      sharpnessPuts.push(body);
      if (refuseSharpness) return reply(400, { error: "Switch to the pre-release (mods) to try these" });
      sharpnessOn = body.hitsLeft;
      return reply(200, state(flags));
    }
    if (p === "/api/account/qol/controller" && req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      controllerPuts.push(body);
      if (refuseController) return reply(400, { error: "Switch to the pre-release (mods) to try these" });
      controllerButtons = body.buttons;
      return reply(200, state(flags));
    }
    if (p === "/api/account/qol" && req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      puts.push(body);
      if (refuse) return reply(400, { error: "Unknown option" });
      for (const f of state(0).features) if (f.id in body) flags = body[f.id] ? flags | (1 << f.bit) : flags & ~(1 << f.bit);
      return reply(200, state(flags));
    }
    if (p === "/api/account") return reply(200, { name: "author", roles: ["ROLE_USER"], characters: 0, lastLogin: null });
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
  await page.goto(base + "/account.html#game-options");
  await page.waitForSelector("#qol-list input", { timeout: 5000 }).catch(() => {});
  check("Keys, Viewer options and pre-release parts are closed folds", await page.$$eval("#qol-panel details.fold", (n) => n.length === 3 && n.every((d) => !d.open)));
  // the checks below use the folded parts: open them as a player would
  const openFolds = () => page.$$eval("#qol-panel details.fold", (n) => n.forEach((d) => { d.open = true; }));
  await openFolds();

  check("card heading", (await page.textContent("#qol-panel h2")) === "Game options");
  check("card is visible on the Game options tab", await page.isVisible("#qol-panel"));
  check("in-game hint at the top of the card, before the next-login note", await page.evaluate(() => {
    const p = document.querySelector("#qol-panel p.note-text");
    return !!p && p.textContent.trim() === "You can also change these in game: Ctrl+F10, or hold View + Start on a controller." && p === document.querySelector("#qol-panel .panel-head").nextElementSibling;
  }));
  check("next-login note", /Changes take effect at your next login to the game\./.test(await page.textContent("#qol-panel")));
  const boxes = await page.$$eval("#qol-list input[role=switch]", (n) => n.map((b) => [b.id, b.checked]));
  check("one switch per listed feature, all off", JSON.stringify(boxes) === JSON.stringify([["qol-trueRaw", false], ["qol-trueElement", false], ["qol-monsterBar", false], ["qol-iframeViewer", false], ["qol-damageNumbers", false], ["qol-sharpnessHitsLeft", false], ["qol-damageMeter", false]]), JSON.stringify(boxes));
  const items = await page.$$eval(".qol-item", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check("name and description", items[0].includes("True raw attack") && items[0].includes("a Great Sword's 1022 shows as 213"), items[0]);
  check("true element name and description", items[1].includes("True element") && items[1].includes("Fire 250 shows as 25"), items[1]);
  check("patch note", items[0].includes("Needs client patch v1.20 or newer") && items[1].includes("Needs client patch v1.20 or newer") && items[2].includes("Needs client patch v1.21 or newer"), items.join(" | "));
  check("hidden-info note only where flagged", !items[0].includes("information the game normally hides") && !items[1].includes("information the game normally hides") && items[2].includes("Shows information the game normally hides"), items.join(" | "));

  check("iframe viewer switch with the hidden-info mark and the event rule", items[3].includes("Iframe viewer") && items[3].includes("Shows information the game normally hides") && items[3].includes(EVENT_RULE) && items[3].includes("Needs client patch v1.21 or newer"), items[3]);
  check("event rule only on the viewer switch", !items[0].includes("Speedrun Cup") && !items[2].includes("Speedrun Cup"));

  // Toggle on.
  await page.check("#qol-trueRaw");
  await page.waitForFunction(() => /Saved\./.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends only that id", JSON.stringify(puts) === JSON.stringify([{ trueRaw: true }]), JSON.stringify(puts));
  check("saved message", /True raw attack is on from your next login/.test(await page.textContent("#qol-note")), await page.textContent("#qol-note"));
  check("switch stays on, the other off", (await page.isChecked("#qol-trueRaw")) && !(await page.isChecked("#qol-monsterBar")));

  // Reload: the stored state comes back.
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-list input", { timeout: 5000 });
  check("state survives a reload", await page.isChecked("#qol-trueRaw"));

  // Toggle off.
  await page.uncheck("#qol-trueRaw");
  await page.waitForFunction(() => /is off/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT false", JSON.stringify(puts[1]) === JSON.stringify({ trueRaw: false }), JSON.stringify(puts));

  // True element on its own: bit 1, true raw stays off.
  await page.check("#qol-trueElement");
  await page.waitForFunction(() => /True element is on/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("true element PUTs only its id", JSON.stringify(puts[2]) === JSON.stringify({ trueElement: true }), JSON.stringify(puts));
  check("true element saved message", /True element is on from your next login/.test(await page.textContent("#qol-note")), await page.textContent("#qol-note"));
  check("true element on, true raw off, stored as bit 1", (await page.isChecked("#qol-trueElement")) && !(await page.isChecked("#qol-trueRaw")) && flags === 2, "flags " + flags);

  // A refused save.
  refuse = true;
  // click, not check: check() re-reads the box after the click, and the refused save may already have put it back
  await page.click("#qol-monsterBar");
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("error shown with the API's message", /Unknown option/.test(await page.textContent("#qol-alert")), await page.textContent("#qol-alert"));
  check("switch put back after a refused save", !(await page.isChecked("#qol-monsterBar")));

  // Keys part.
  refuse = false;
  const btnText = (id) => page.textContent("#" + id).then((t) => t.trim());
  const alertText = () => page.textContent("#qol-alert").then((t) => t.trim());
  const alertShown = () => page.isVisible("#qol-alert");
  check("keys part is shown", await page.isVisible("#qol-keys"));
  const keysText = (await page.textContent("#qol-keys")).replace(/\s+/g, " ");
  check("keys part has the hints", keysText.includes("No key: always skip") && keysText.includes("In the game, target the NPC or object and press Shift + the key to remember it (saved on that PC)"), keysText);
  check("retire key from the GET", (await btnText("qol-key-retire-key")) === "Ctrl+R");
  check("skip-wait and talk keys show None", (await btnText("qol-key-skip-wait-key")) === "None" && (await btnText("qol-key-remote-talk-key-1")) === "None" && (await btnText("qol-key-remote-talk-key-5")) === "None");
  check("five talk pickers", (await page.$$eval("[id^=qol-key-remote-talk-key-].qol-key-btn", (n) => n.length)) === 5 && (await page.$$eval(".qol-key-btn", (n) => n.length)) === 7);
  const modeOptions = await page.$$eval("#qol-retire-mode option", (n) => n.map((o) => [o.value, o.textContent]));
  check("retire on death options", JSON.stringify(modeOptions) === JSON.stringify([["off", "Off"], ["cart", "When I cart"], ["health", "When my health reaches 0"]]), JSON.stringify(modeOptions));
  check("carts select hidden while Off", !(await page.isVisible("#qol-retire-carts")));
  await page.selectOption("#qol-retire-mode", "health");
  check("carts select hidden for health", !(await page.isVisible("#qol-retire-carts")));
  await page.selectOption("#qol-retire-mode", "cart");
  check("carts select shown for When I cart", await page.isVisible("#qol-retire-carts"));
  check("carts options 1-3", JSON.stringify(await page.$$eval("#qol-retire-carts option", (n) => n.map((o) => o.value))) === JSON.stringify(["1", "2", "3"]));

  // A picker captures Ctrl+R from a keydown.
  await page.click("#qol-key-retire-key-clear");
  check("clear sets None", (await btnText("qol-key-retire-key")) === "None");
  await page.click("#qol-key-retire-key");
  check("click asks for a key", (await btnText("qol-key-retire-key")) === "Press a key\u2026");
  await page.keyboard.press("Control+KeyR");
  check("picker captured Ctrl+R", (await btnText("qol-key-retire-key")) === "Ctrl+R", await btnText("qol-key-retire-key"));

  // Skip-wait picker: a lone modifier is ignored, a key outside the list is refused, Escape cancels.
  await page.click("#qol-key-skip-wait-key");
  await page.keyboard.press("Shift");
  check("lone modifier ignored", (await btnText("qol-key-skip-wait-key")) === "Press a key\u2026");
  await page.keyboard.press("Backspace");
  check("key outside the list refused", (await alertShown()) && /cannot be used/.test(await alertText()) && (await btnText("qol-key-skip-wait-key")) === "Press a key\u2026", await alertText());
  await page.keyboard.press("Escape");
  check("Escape cancels", (await btnText("qol-key-skip-wait-key")) === "None");

  // A letter without Ctrl/Alt is refused before anything is sent.
  await page.click("#qol-key-remote-talk-key-1");
  await page.keyboard.press("KeyA");
  check("plain letter captured as A", (await btnText("qol-key-remote-talk-key-1")) === "A");
  await page.click("#qol-keys-save");
  check("letter without modifier refused", (await alertShown()) && /letters and digits need Ctrl or Alt/.test(await alertText()) && !keyPuts.length, await alertText() + " puts " + keyPuts.length);

  // A Shift talk key is refused too.
  await page.click("#qol-key-remote-talk-key-1");
  await page.keyboard.press("F7");
  await page.click("#qol-key-remote-talk-key-2");
  await page.keyboard.press("Shift+F3");
  check("Shift talk key captured", (await btnText("qol-key-remote-talk-key-2")) === "Shift+F3");
  await page.click("#qol-keys-save");
  check("Shift talk key refused", (await alertShown()) && /cannot use Shift/.test(await alertText()) && !keyPuts.length, await alertText() + " puts " + keyPuts.length);

  // A duplicate key is refused.
  await page.click("#qol-key-remote-talk-key-2");
  await page.keyboard.press("Control+KeyR");
  await page.click("#qol-keys-save");
  check("duplicate key refused", (await alertShown()) && /same key/.test(await alertText()) && !keyPuts.length, await alertText() + " puts " + keyPuts.length);

  // Save sends all five settings.
  await page.click("#qol-key-remote-talk-key-2");
  await page.keyboard.press("Control+Alt+Numpad5");
  check("Ctrl+Alt+Num5 captured", (await btnText("qol-key-remote-talk-key-2")) === "Ctrl+Alt+Num5");
  await page.selectOption("#qol-retire-carts", "2");
  await page.click("#qol-keys-save");
  await page.waitForFunction(() => /Keys saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  const want = { retireKey: "Ctrl+R", retireOnDeath: "cart", retireCarts: 2, skipWaitKey: null, talkKeys: ["F7", "Ctrl+Alt+Num5", null, null, null] };
  check("Save sends the PUT body with all five keys", keyPuts.length === 1 && JSON.stringify(keyPuts[0]) === JSON.stringify(want), JSON.stringify(keyPuts));
  check("keys saved message", /Keys saved\. They take effect from your next login/.test(await page.textContent("#qol-note")), await page.textContent("#qol-note"));
  check("pickers show the saved keys", (await btnText("qol-key-remote-talk-key-2")) === "Ctrl+Alt+Num5" && (await page.inputValue("#qol-retire-mode")) === "cart" && (await page.inputValue("#qol-retire-carts")) === "2");

  // A 400 message from the API is shown.
  refuseKeys = true;
  await page.click("#qol-keys-save");
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("API 400 message shown", /Ctrl\+R is used twice/.test(await alertText()), await alertText());
  check("keys stay after a refused save", (await btnText("qol-key-retire-key")) === "Ctrl+R" && keyPuts.length === 2);

  // Viewer options part.
  const vText = () => page.textContent("#qol-viewer").then((t) => t.replace(/\s+/g, " ").trim());
  check("viewer part is shown", await page.isVisible("#qol-viewer"));
  check("viewer part heading", (await page.textContent("#qol-viewer h3")) === "Viewer options");
  const vBoxes = await page.$$eval("#qol-viewer input[type=checkbox]", (n) => n.map((b) => [b.id, b.checked, b.parentElement.textContent.trim()]));
  check("four checkboxes show the GET values", JSON.stringify(vBoxes) === JSON.stringify([["qol-viewer-iframeBar", true, "Iframe bar"], ["qol-viewer-iframeCount", false, "Iframe count"], ["qol-viewer-hitstopBar", true, "Hitstop bar"], ["qol-viewer-hitIndicator", false, "Hit indicator"]]), JSON.stringify(vBoxes));
  const optionsOf = (id) => page.$$eval("#" + id + " option", (n) => n.map((o) => [o.value, o.textContent]));
  check("position options", JSON.stringify(await optionsOf("qol-viewer-position")) === JSON.stringify([["top", "Top"], ["center", "Centre"], ["bottom", "Bottom"], ["left", "Left"]]), JSON.stringify(await optionsOf("qol-viewer-position")));
  check("size options", JSON.stringify(await optionsOf("qol-viewer-size")) === JSON.stringify([["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]]), JSON.stringify(await optionsOf("qol-viewer-size")));
  check("selects show the GET values", (await page.inputValue("#qol-viewer-position")) === "left" && (await page.inputValue("#qol-viewer-size")) === "large");
  check("save button text", (await btnText("qol-viewer-save")) === "Save viewer options");
  check("nothing sent yet", !viewerPuts.length);

  await page.uncheck("#qol-viewer-iframeBar");
  await page.check("#qol-viewer-iframeCount");
  await page.check("#qol-viewer-hitIndicator");
  await page.selectOption("#qol-viewer-position", "center");
  await page.selectOption("#qol-viewer-size", "huge");
  await page.click("#qol-viewer-save");
  await page.waitForFunction(() => /Viewer options saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  const wantViewer = { iframeBar: false, iframeCount: true, hitstopBar: true, hitIndicator: true, position: "center", size: "huge" };
  check("Save sends exactly the six keys with the chosen values", viewerPuts.length === 1 && JSON.stringify(viewerPuts[0]) === JSON.stringify(wantViewer), JSON.stringify(viewerPuts));
  check("viewer saved message", /Viewer options saved\. They take effect from your next login/.test(await page.textContent("#qol-note")), await page.textContent("#qol-note"));
  const vAfter = await page.$$eval("#qol-viewer input[type=checkbox]", (n) => n.map((b) => b.checked));
  check("controls redrawn from the answer", JSON.stringify(vAfter) === JSON.stringify([false, true, true, true]) && (await page.inputValue("#qol-viewer-position")) === "center" && (await page.inputValue("#qol-viewer-size")) === "huge", JSON.stringify(vAfter));
  check("the other switches and keys survive the viewer save", (await page.isChecked("#qol-trueElement")) && (await btnText("qol-key-retire-key")) === "Ctrl+R");

  // Saving the keys redraws the viewer part from the answer, unchanged.
  refuseKeys = false;
  await page.click("#qol-keys-save");
  await page.waitForFunction(() => /Keys saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("viewer part still shows the stored values after Save keys", (await page.inputValue("#qol-viewer-size")) === "huge" && (await page.isVisible("#qol-viewer")), await vText());

  // A 400 message from the API is shown and the part stays.
  refuseViewer = true;
  await page.selectOption("#qol-viewer-size", "small");
  await page.click("#qol-viewer-save");
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("viewer API 400 message shown", /position must be top/.test(await alertText()), await alertText());
  check("viewer part stays with the chosen value after a refused save", (await page.isVisible("#qol-viewer")) && (await page.inputValue("#qol-viewer-size")) === "small" && (await page.isEnabled("#qol-viewer-save")) && viewerPuts.length === 2);
  refuseViewer = false;

  // Options under the damage numbers and damage meter switches.
  const dnText = (await page.textContent("#qol-dn-options")).replace(/\s+/g, " ");
  check("damage numbers options under its switch", await page.evaluate(() => !!document.querySelector(".qol-item #qol-damageNumbers") && document.getElementById("qol-damageNumbers").closest(".qol-item").contains(document.getElementById("qol-dn-options"))));
  check("damage numbers labels and the move id help", dnText.includes("Other players' hits") && dnText.includes("Size") && dnText.includes("Show move id") && dnText.includes(MOVE_ID_HELP), dnText);
  check("damage numbers show the GET values", (await page.isChecked("#qol-dn-othersHits")) && !(await page.isChecked("#qol-dn-showMoveId")) && (await page.inputValue("#qol-dn-size")) === "large");
  check("damage numbers size options", JSON.stringify(await optionsOf("qol-dn-size")) === JSON.stringify([["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]]), JSON.stringify(await optionsOf("qol-dn-size")));
  check("damage meter options under its switch", await page.evaluate(() => document.getElementById("qol-damageMeter").closest(".qol-item").contains(document.getElementById("qol-dm-options"))));
  check("damage meter labels", /Corner/.test(await page.textContent("#qol-dm-options")) && /Size/.test(await page.textContent("#qol-dm-options")));
  check("damage meter corner options", JSON.stringify(await optionsOf("qol-dm-corner")) === JSON.stringify([["topRight", "Top right"], ["topLeft", "Top left"], ["bottomRight", "Bottom right"], ["bottomLeft", "Bottom left"]]), JSON.stringify(await optionsOf("qol-dm-corner")));
  check("damage meter shows the GET values", (await page.inputValue("#qol-dm-corner")) === "bottomLeft" && (await page.inputValue("#qol-dm-size")) === "small");
  await page.click("#qol-dn-showMoveId");
  await page.waitForFunction(() => /Damage numbers options saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("Show move id sends only that key", JSON.stringify(overlayPuts) === JSON.stringify([["damage-numbers", { showMoveId: true }]]), JSON.stringify(overlayPuts));
  check("damage numbers saved message", /Damage numbers options saved\. They take effect from your next login/.test(await page.textContent("#qol-note")), await page.textContent("#qol-note"));
  check("redrawn from the answer", (await page.isChecked("#qol-dn-showMoveId")) && (await page.isChecked("#qol-dn-othersHits")) && (await page.isEnabled("#qol-dn-showMoveId")));
  await page.selectOption("#qol-dm-corner", "topLeft");
  await page.waitForFunction(() => /Damage meter options saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  await page.selectOption("#qol-dm-size", "huge");
  await page.waitForFunction((n) => document.getElementById("qol-dm-size").value === "huge" && !document.getElementById("qol-dm-size").disabled, null, { timeout: 5000 }).catch(() => {});
  check("damage meter changes send one key each", JSON.stringify(overlayPuts.slice(1)) === JSON.stringify([["damage-meter", { corner: "topLeft" }], ["damage-meter", { size: "huge" }]]), JSON.stringify(overlayPuts));
  check("damage meter shows the saved values", (await page.inputValue("#qol-dm-corner")) === "topLeft" && (await page.inputValue("#qol-dm-size")) === "huge");
  refuseOverlay = true;
  await page.selectOption("#qol-dn-size", "small");
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("damage numbers 400 message shown", /Could not save the damage numbers options: Option "size"/.test(await alertText()), await alertText());
  check("the control goes back to the stored value", (await page.inputValue("#qol-dn-size")) === "large" && (await page.isEnabled("#qol-dn-size")) && overlayPuts.length === 4);
  refuseOverlay = false;
  // Multi-hit numbers (damage numbers) and Show monster health (damage meter).
  check("multi-hit select with its help, at the GET value", dnText.includes("Multi-hit numbers") && dnText.includes(MULTI_HIT_HELP)
    && JSON.stringify(await optionsOf("qol-dn-multiHit")) === JSON.stringify([["spread", "Spread"], ["combine", "Combine"]])
    && (await page.inputValue("#qol-dn-multiHit")) === "spread", JSON.stringify(await optionsOf("qol-dn-multiHit")));
  const dmText = (await page.textContent("#qol-dm-options")).replace(/\s+/g, " ");
  check("Show monster health with its help, off from GET", dmText.includes("Show monster health") && dmText.includes(HEALTH_HELP) && !(await page.isChecked("#qol-dm-showHealth")), dmText);
  await page.selectOption("#qol-dn-multiHit", "combine");
  await page.waitForFunction(() => document.getElementById("qol-dn-multiHit").value === "combine" && !document.getElementById("qol-dn-multiHit").disabled, null, { timeout: 5000 }).catch(() => {});
  await page.click("#qol-dm-showHealth");
  await page.waitForFunction(() => /Damage meter options saved/.test(document.getElementById("qol-note").textContent) && document.getElementById("qol-dm-showHealth").checked, null, { timeout: 5000 }).catch(() => {});
  check("multi-hit and monster health send one key each", JSON.stringify(overlayPuts.slice(4)) === JSON.stringify([["damage-numbers", { multiHit: "combine" }], ["damage-meter", { showHealth: true }]]), JSON.stringify(overlayPuts));
  check("multi-hit and monster health redrawn from the answer", (await page.inputValue("#qol-dn-multiHit")) === "combine" && (await page.isChecked("#qol-dm-showHealth")));
  // Weak-spot star: a checkbox under Damage numbers, on by default, its own key.
  const starText = (await page.textContent("#qol-dn-options")).replace(/\s+/g, " ");
  check("weak-spot star label and help, checked from GET", starText.includes("Weak-spot star") && starText.includes(STAR_HELP) && (await page.isChecked("#qol-dn-weakSpotStar")), starText);
  const starN = overlayPuts.length;
  await page.click("#qol-dn-weakSpotStar");
  await page.waitForFunction(() => /Damage numbers options saved/.test(document.getElementById("qol-note").textContent) && !document.getElementById("qol-dn-weakSpotStar").checked, null, { timeout: 5000 }).catch(() => {});
  check("weak-spot star sends only its key", overlayPuts.length === starN + 1 && JSON.stringify(overlayPuts[starN]) === JSON.stringify(["damage-numbers", { weakSpotStar: false }]), JSON.stringify(overlayPuts.slice(starN)));
  check("weak-spot star redrawn off, the other options kept", !(await page.isChecked("#qol-dn-weakSpotStar")) && (await page.isEnabled("#qol-dn-weakSpotStar")) && (await page.inputValue("#qol-dn-multiHit")) === "combine" && (await page.inputValue("#qol-dn-size")) === "large");
  await page.click("#qol-dn-weakSpotStar");
  await page.waitForFunction(() => document.getElementById("qol-dn-weakSpotStar").checked && !document.getElementById("qol-dn-weakSpotStar").disabled, null, { timeout: 5000 }).catch(() => {});
  check("weak-spot star back on sends true", JSON.stringify(overlayPuts[starN + 1]) === JSON.stringify(["damage-numbers", { weakSpotStar: true }]), JSON.stringify(overlayPuts.slice(starN)));
  // Overlay v2 (part 110): four more meter options, each its own key.
  for (const [id, label, help] of METER_MORE) {
    const text = (await page.textContent("#qol-dm-options")).replace(/\s+/g, " ");
    check(label + " with its help, off from GET", text.includes(label) && text.includes(help) && !(await page.isChecked("#qol-dm-" + id)), text);
    const n = overlayPuts.length;
    await page.click("#qol-dm-" + id);
    await page.waitForFunction((i) => document.getElementById("qol-dm-" + i).checked && !document.getElementById("qol-dm-" + i).disabled, id, { timeout: 5000 }).catch(() => {});
    check(label + " sends only its key", overlayPuts.length === n + 1 && JSON.stringify(overlayPuts[n]) === JSON.stringify(["damage-meter", { [id]: true }]), JSON.stringify(overlayPuts.slice(n)));
  }
  check("the meter's options in order", JSON.stringify(await page.$$eval("#qol-dm-options input, #qol-dm-options select", (n) => n.map((x) => x.id)))
    === JSON.stringify(["qol-dm-corner", "qol-dm-size", "qol-dm-showHealth", "qol-dm-effectiveHp", "qol-dm-statusBuildUp", "qol-dm-dpsGraph", "qol-dm-timeToKill"]));
  // Show sharpness hits left: its own line right under Damage numbers.
  const shRow = (await page.evaluate(() => {
    const row = document.getElementById("qol-sharpnessHitsLeft") && document.getElementById("qol-sharpnessHitsLeft").closest(".qol-item");
    return row ? { text: row.textContent.replace(/\s+/g, " "), afterNumbers: row.previousElementSibling === document.getElementById("qol-damageNumbers").closest(".qol-item") } : null;
  }));
  check("sharpness line right under Damage numbers", !!shRow && shRow.afterNumbers, JSON.stringify(shRow));
  check("sharpness line: name, description, patch, hidden info", !!shRow && shRow.text.includes("Show sharpness hits left") && shRow.text.includes(SHARPNESS_DESC)
    && shRow.text.includes("Needs client patch v1.21 or newer") && shRow.text.includes("Shows information the game normally hides"), shRow && shRow.text);
  await page.check("#qol-sharpnessHitsLeft");
  await page.waitForFunction(() => /Show sharpness hits left is on/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("sharpness sends PUT /sharpness {hitsLeft: true}", JSON.stringify(sharpnessPuts) === JSON.stringify([{ hitsLeft: true }]) && (await page.isChecked("#qol-sharpnessHitsLeft")), JSON.stringify(sharpnessPuts));
  check("sharpness is not a flags PUT", !puts.some((b) => "sharpnessHitsLeft" in b || "hitsLeft" in b), JSON.stringify(puts));
  refuseSharpness = true;
  await page.uncheck("#qol-sharpnessHitsLeft").catch(() => {});
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("sharpness refused: back on, message shown", (await page.isChecked("#qol-sharpnessHitsLeft")) && /Switch to the pre-release/.test(await alertText()), await alertText());
  refuseSharpness = false;
  sharpnessOn = false;
  // Controller buttons: its own line at the end of the list, a PlayStation / Xbox select.
  const coRow = await page.evaluate(() => {
    const sel = document.getElementById("qol-controller");
    const row = sel && sel.closest(".qol-item");
    return row ? { text: row.textContent.replace(/\s+/g, " "), last: row === row.parentNode.lastElementChild && row.parentNode.id === "qol-list",
      options: Array.from(sel.options).map((o) => o.value + "=" + o.textContent), value: sel.value, label: document.querySelector('label[for="qol-controller"]').textContent } : null;
  });
  check("controller line: last in the list, PlayStation / Xbox, PlayStation by default", !!coRow && coRow.last && coRow.label === "Controller buttons"
    && coRow.options.join() === "playstation=PlayStation,xbox=Xbox" && coRow.value === "playstation", JSON.stringify(coRow));
  check("controller line: description and patch", !!coRow && coRow.text.includes(CONTROLLER_DESC) && coRow.text.includes("Needs client patch v1.21 or newer"), coRow && coRow.text);
  await page.selectOption("#qol-controller", "xbox");
  await page.waitForFunction(() => /Controller buttons options saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("controller sends PUT /controller {buttons: xbox} only", JSON.stringify(controllerPuts) === JSON.stringify([{ buttons: "xbox" }])
    && (await page.inputValue("#qol-controller")) === "xbox" && !puts.some((b) => "buttons" in b), JSON.stringify(controllerPuts));
  refuseController = true;
  await page.selectOption("#qol-controller", "playstation");
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("controller refused: back to Xbox, message shown", (await page.inputValue("#qol-controller")) === "xbox" && /Switch to the pre-release/.test(await alertText()), await alertText());
  refuseController = false;
  controllerButtons = "playstation";

  // ---- Pre-release-only features ----
  const lockedText = "Switch to the pre-release (mods) to try these";
  const ids = (sel) => page.$$eval(sel, (n) => n.map((b) => b.id));
  const preCheck = async (label) => {
    check(label + ": the section is on the page and labelled", (await page.isVisible("#qol-pre"))
      && (await page.textContent("#qol-pre h3")) === "Being tested: pre-release only"
      && (await page.textContent("#qol-pre-note")) === "Slot: mods. These work only on a pre-release patch on the Test land.", await page.textContent("#qol-pre-note"));
    check(label + ": stable and pre-release switches are apart", JSON.stringify(await ids("#qol-list input[role=switch]")) === JSON.stringify(["qol-trueRaw", "qol-trueElement"])
      && JSON.stringify(await ids("#qol-pre-list input[role=switch]")) === JSON.stringify(["qol-monsterBar", "qol-quickRetire", "qol-skipCompleteWait", "qol-quickTalk", "qol-iframeViewer", "qol-damageNumbers", "qol-sharpnessHitsLeft", "qol-damageMeter"]),
    JSON.stringify([await ids("#qol-list input[role=switch]"), await ids("#qol-pre-list input[role=switch]")]));
    check(label + ": Keys and Viewer options are inside the section", await page.evaluate(() => !!document.querySelector("#qol-pre #qol-keys") && !!document.querySelector("#qol-pre #qol-viewer")));
  };
  const enabledIn = (sel) => page.$$eval(sel, (n) => n.map((b) => !b.disabled));
  preMode = "locked";
  flags = 0;
  await page.reload();
  await page.waitForSelector("#qol-pre:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("on Stable: the pre-release fold stays closed", await page.$eval("#qol-pre", (d) => !d.open));
  await openFolds();
  await page.waitForSelector("#qol-pre-list input", { timeout: 5000 });
  await page.waitForSelector("#qol-viewer:not([hidden])", { timeout: 5000 });
  await preCheck("on Stable");
  check("on Stable: stable switches usable, pre-release ones greyed out", (await enabledIn("#qol-list input")).every(Boolean) && (await enabledIn("#qol-pre-list input")).every((e) => !e));
  const rowsText = await page.$$eval("#qol-pre-list .qol-item", (n) => n.map((x) => x.textContent));
  check("on Stable: the controller select is greyed out at the end of the section", await page.$eval("#qol-controller", (s) => s.disabled
    && s.closest(".qol-item") === document.getElementById("qol-pre-list").lastElementChild));
  controllerButtons = "xbox";   // stored Xbox while locked: the select stays open for the way back
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-controller", { timeout: 5000 });
  check("on Stable: on Xbox the controller select stays usable", await page.$eval("#qol-controller", (s) => !s.disabled && s.value === "xbox"));
  controllerButtons = "playstation";
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-viewer:not([hidden])", { timeout: 5000 });
  check("on Stable: each greyed switch says what to do", rowsText.length === 9 && rowsText.every((t) => t.includes(lockedText)), JSON.stringify(rowsText));
  check("on Stable: stable switches carry no such message", !(await page.textContent("#qol-list")).includes("Switch to the pre-release"));
  check("on Stable: key pickers, selects and Save keys disabled", (await enabledIn("#qol-keys button, #qol-keys select")).every((e) => !e) && (await page.$$("#qol-keys button")).length === 15, JSON.stringify(await enabledIn("#qol-keys button, #qol-keys select")));
  check("on Stable: key groups show the message", (await page.$$eval("#qol-keys .qol-locked", (n) => n.map((x) => x.textContent))).join("|") === [lockedText, lockedText, lockedText].join("|"));
  check("on Stable: viewer options and Save disabled with the message", (await enabledIn("#qol-viewer input, #qol-viewer select, #qol-viewer button")).every((e) => !e)
    && (await page.textContent("#qol-viewer")).includes(lockedText));
  const overlayEnabled = await enabledIn("#qol-dn-options input, #qol-dn-options select, #qol-dm-options input, #qol-dm-options select");
  check("on Stable: damage numbers and meter options greyed out", overlayEnabled.length === 12 && overlayEnabled.every((e) => !e), JSON.stringify(overlayEnabled));
  const before = puts.length;
  await page.check("#qol-trueRaw");
  await page.waitForFunction(() => /True raw attack is on/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("on Stable: a stable switch still saves", puts.length === before + 1 && JSON.stringify(puts[before]) === JSON.stringify({ trueRaw: true }), JSON.stringify(puts));

  // The Client patch box tells the card the channel changed: it reloads without a page reload.
  await page.evaluate(() => { window.__sameDocument = 1; });
  preMode = "open";
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("hvmhfz:patch-channel", { detail: { channel: "pre:mods" } })));
  await page.waitForFunction(() => !document.getElementById("qol-monsterBar").disabled, null, { timeout: 5000 }).catch(() => {});
  check("on a slot with them: reloaded in place, nothing greyed out", (await page.evaluate(() => window.__sameDocument)) === 1
    && (await enabledIn("#qol-pre-list input, #qol-keys button, #qol-keys select, #qol-viewer input, #qol-viewer select, #qol-viewer button")).every(Boolean)
    && !(await page.textContent("#qol-pre")).includes("Switch to the pre-release"));
  await preCheck("on a slot");
  check("on a slot: the stable choice the player made is kept", await page.isChecked("#qol-trueRaw"));
  await page.check("#qol-monsterBar");
  await page.waitForFunction(() => /Monster health bar is on/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("on a slot: a pre-release switch saves", JSON.stringify(puts[puts.length - 1]) === JSON.stringify({ monsterBar: true }), JSON.stringify(puts));
  const kp = keyPuts.length;
  await page.click("#qol-keys-save");
  await page.waitForFunction(() => /Keys saved/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("on a slot: Save keys sends", keyPuts.length === kp + 1);
  await page.reload();
  await page.waitForSelector("#qol-pre:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("on a slot: the pre-release fold opens by itself", await page.$eval("#qol-pre", (d) => d.open));
  await openFolds();

  // Back to Stable: values stay, greyed out again.
  preMode = "locked";
  await page.evaluate(() => document.dispatchEvent(new CustomEvent("hvmhfz:patch-channel", { detail: { channel: "stable" } })));
  await page.waitForFunction(() => document.getElementById("qol-monsterBar").disabled, null, { timeout: 5000 }).catch(() => {});
  check("back on Stable: greyed out again, the stored switch stays on", (await page.isDisabled("#qol-monsterBar")) && (await page.isChecked("#qol-monsterBar")));

  // A stable release reaches 1.21: the features move up into the normal list, no section.
  preMode = "moved";
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-list input", { timeout: 5000 });
  await page.waitForSelector("#qol-viewer:not([hidden])", { timeout: 5000 });
  check("once stable has them: no pre-release section", !(await page.isVisible("#qol-pre")));
  check("once stable has them: they are in the normal list and usable", (await ids("#qol-list input[role=switch]")).length === 10 && (await enabledIn("#qol-list input")).every(Boolean)
    && await page.evaluate(() => !document.querySelector("#qol-pre #qol-keys") && !document.querySelector("#qol-pre #qol-viewer")));
  preMode = "off";

  // Mobile: no sideways scroll.
  await page.setViewportSize({ width: 375, height: 800 });
  // The site menu's own button is outside this card (and is wider than the screen only with this check's empty
  // status mock), so measure the page content: nothing in <main> except the tab bar's own scroller may pass 375px.
  const widths = await page.evaluate(() => ({ win: window.innerWidth,
    card: document.getElementById("qol-panel").getBoundingClientRect().right,
    wide: Array.from(document.querySelectorAll("#content *")).filter((e) => e.getBoundingClientRect().width > 0
      && e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest(".tabs"))
      .slice(0, 6).map((e) => e.tagName + "#" + e.id + "." + e.className) }));
  check("nothing in the page content passes 375px", widths.card <= widths.win && !widths.wide.length, JSON.stringify(widths));

  // An older API (no "viewer" in the answer): the part is hidden, the switch stays.
  sendViewer = false;
  sendOverlays = false;
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-list input", { timeout: 5000 });
  await page.waitForSelector("#qol-keys:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("viewer part hidden without viewer", !(await page.isVisible("#qol-viewer")) && !(await page.$("#qol-viewer-save")));
  check("iframe viewer switch still listed without viewer", !!(await page.$("#qol-iframeViewer")));
  check("no damage options without damageNumbers/damageMeter, switches stay", !(await page.$("#qol-dn-options")) && !(await page.$("#qol-dm-options")) && !!(await page.$("#qol-damageNumbers")) && !!(await page.$("#qol-damageMeter")));
  check("no sharpness line without sharpness", !(await page.$("#qol-sharpnessHitsLeft")));
  check("no controller line without controller", !(await page.$("#qol-controller")));
  sendOverlays = true;
  // An API without weakSpotStar: no star checkbox, the other damage numbers options stay.
  sendStar = false;
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-dn-options", { timeout: 5000 });
  check("no weak-spot star checkbox without weakSpotStar, the other options stay", !(await page.$("#qol-dn-weakSpotStar")) && !!(await page.$("#qol-dn-showMoveId")) && !!(await page.$("#qol-dn-multiHit")));
  sendStar = true;
  // Viewer in the answer but the list has no iframeViewer: hidden too.
  sendViewer = true;
  listViewer = false;
  await page.reload(); await openFolds();
  await page.waitForSelector("#qol-list input", { timeout: 5000 });
  await page.waitForSelector("#qol-keys:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("viewer part hidden without the iframeViewer feature", !(await page.isVisible("#qol-viewer")) && !(await page.$("#qol-iframeViewer")));
  check("no page errors", !errors.length, errors.join("; "));
  await page.close();
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try { await run(browser, base); } catch (e) { failures.push("crashed: " + e.message); }
  await browser.close();
  server.close();
  if (failures.length) { console.log("FAIL\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("account qol card OK");
})();
