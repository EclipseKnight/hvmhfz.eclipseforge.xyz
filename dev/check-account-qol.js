#!/usr/bin/env node
/* Checks the "Game options" card on the account page (js/account-qol.js) in headless Chromium against a fake API
   with the shape of GET/PUT /api/account/qol:

   - the card is on the Account tab and renders one switch per feature the API lists (a second, made-up feature
     proves the list is not hard-coded), off by default, with its description, "Needs client patch v<minPatch> or
     newer", and "Shows information the game normally hides" only where revealsHiddenInfo is true;
   - the card says changes take effect at the next login;
   - a toggle PUTs only that feature id and shows the saved message; a refused save (400) puts the switch back
     and shows an error;
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
function state(flags) {
  const defs = [
    { id: "trueRaw", bit: 0, name: "True raw attack", description: DESC, revealsHiddenInfo: false, minPatch: "1.20" },
    { id: "monsterBar", bit: 1, name: "Monster health bar", description: "Shows the monster's remaining health.", revealsHiddenInfo: true, minPatch: "1.21" }
  ];
  return { features: defs.map((d) => Object.assign({ enabled: (flags & (1 << d.bit)) !== 0 }, d)), flags, takesEffect: "next login" };
}

async function run(browser, base) {
  let flags = 0;
  let refuse = false;
  const puts = [];
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
  await page.goto(base + "/account.html#account");
  await page.waitForSelector("#qol-list input", { timeout: 5000 }).catch(() => {});

  check("card heading", (await page.textContent("#qol-panel h2")) === "Game options");
  check("card is visible on the Account tab", await page.isVisible("#qol-panel"));
  check("next-login note", /Changes take effect at your next login to the game\./.test(await page.textContent("#qol-panel")));
  const boxes = await page.$$eval("#qol-list input[type=checkbox]", (n) => n.map((b) => [b.id, b.checked]));
  check("one switch per listed feature, all off", JSON.stringify(boxes) === JSON.stringify([["qol-trueRaw", false], ["qol-monsterBar", false]]), JSON.stringify(boxes));
  const items = await page.$$eval(".qol-item", (n) => n.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check("name and description", items[0].includes("True raw attack") && items[0].includes("a Great Sword's 1022 shows as 213"), items[0]);
  check("patch note", items[0].includes("Needs client patch v1.20 or newer") && items[1].includes("Needs client patch v1.21 or newer"), items.join(" | "));
  check("hidden-info note only where flagged", !items[0].includes("information the game normally hides") && items[1].includes("Shows information the game normally hides"), items.join(" | "));

  // Toggle on.
  await page.check("#qol-trueRaw");
  await page.waitForFunction(() => /Saved\./.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends only that id", JSON.stringify(puts) === JSON.stringify([{ trueRaw: true }]), JSON.stringify(puts));
  check("saved message", /True raw attack is on from your next login/.test(await page.textContent("#qol-note")), await page.textContent("#qol-note"));
  check("switch stays on, the other off", (await page.isChecked("#qol-trueRaw")) && !(await page.isChecked("#qol-monsterBar")));

  // Reload: the stored state comes back.
  await page.reload();
  await page.waitForSelector("#qol-list input", { timeout: 5000 });
  check("state survives a reload", await page.isChecked("#qol-trueRaw"));

  // Toggle off.
  await page.uncheck("#qol-trueRaw");
  await page.waitForFunction(() => /is off/.test(document.getElementById("qol-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT false", JSON.stringify(puts[1]) === JSON.stringify({ trueRaw: false }), JSON.stringify(puts));

  // A refused save.
  refuse = true;
  await page.check("#qol-monsterBar");
  await page.waitForSelector("#qol-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("error shown", /Could not save/.test(await page.textContent("#qol-alert")));
  check("switch put back after a refused save", !(await page.isChecked("#qol-monsterBar")));

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
