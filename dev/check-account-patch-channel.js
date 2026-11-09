#!/usr/bin/env node
/* Checks the "Pre-release client patch" box on the account page (js/account-patch-channel.js) in headless Chromium
   against a fake API with the shape of GET/PUT /api/account/patch-channel:

   - the box is hidden for a plain user (eligible false) and when the endpoint is missing (404);
   - the box is shown for a tester with the current choice marked (Stable or Pre-release);
   - a click PUTs {"channel": ...}, shows the API's message and moves the mark; the choice survives a reload;
   - a 403 refusal shows the API's message as an error and leaves the mark where it was;
   - no page errors.

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

// mode: "user" (eligible false), "missing" (404), "tester"
async function open(browser, base, mode, state) {
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
    if (p === "/api/account/patch-channel") {
      if (mode === "missing") return reply(404, { message: "Not found" });
      if (req.method() === "GET") return reply(200, { channel: state.channel, eligible: mode === "tester" });
      if (req.method() === "PUT") {
        const body = JSON.parse(req.postData());
        state.puts.push(body);
        if (state.refuse) return reply(403, { message: "Your account cannot use the pre-release patch." });
        state.channel = body.channel;
        return reply(200, { channel: state.channel, eligible: true,
          message: body.channel === "pre" ? "Pre-release patch on from your next launcher login." : "Stable patch on from your next launcher login." });
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

const marked = (page) => page.$$eval("#patch-channel-choices [data-channel]", (n) => n.filter((b) => b.classList.contains("is-on")).map((b) => b.dataset.channel));

async function run(browser, base) {
  // A plain user and an API without the endpoint: the box stays hidden.
  for (const mode of ["user", "missing"]) {
    const { page, errors } = await open(browser, base, mode, { channel: "stable", puts: [] });
    check("box hidden for " + mode, !(await page.isVisible("#patch-channel-panel")));
    check("no page errors for " + mode, !errors.length, errors.join("; "));
    await page.close();
  }

  // A tester.
  const state = { channel: "stable", puts: [], refuse: false };
  const { page, errors } = await open(browser, base, "tester", state);
  check("box shown for a tester", await page.isVisible("#patch-channel-panel"));
  check("heading", (await page.textContent("#patch-channel-panel h2")) === "Pre-release client patch");
  const text = await page.textContent("#patch-channel-panel");
  check("text: pre-release", text.includes("your Mezeporta launcher downloads the test patch at its next login. Use it to test changes before they go out to everyone."));
  check("text: stable", text.includes("the launcher puts the normal patch back at its next login."));
  check("text: only the launcher", text.includes("Only the Mezeporta launcher follows this setting. When no pre-release is out, you get the stable patch either way."));
  const labels = await page.$$eval("#patch-channel-choices [data-channel]", (n) => n.map((b) => b.dataset.channel + ":" + b.textContent.trim()));
  check("two choices", JSON.stringify(labels) === JSON.stringify(["stable:Stable", "pre:Pre-release"]), JSON.stringify(labels));
  check("stable marked", JSON.stringify(await marked(page)) === JSON.stringify(["stable"]), JSON.stringify(await marked(page)));

  await page.click('[data-channel="pre"]');
  await page.waitForFunction(() => /Pre-release patch on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends pre", JSON.stringify(state.puts) === JSON.stringify([{ channel: "pre" }]), JSON.stringify(state.puts));
  check("message shown", (await page.textContent("#patch-channel-note")) === "Pre-release patch on from your next launcher login.", await page.textContent("#patch-channel-note"));
  check("pre marked", JSON.stringify(await marked(page)) === JSON.stringify(["pre"]), JSON.stringify(await marked(page)));

  await page.reload();
  await page.waitForSelector("#patch-channel-panel:not([hidden])", { timeout: 5000 });
  check("choice survives a reload", JSON.stringify(await marked(page)) === JSON.stringify(["pre"]));

  await page.click('[data-channel="stable"]');
  await page.waitForFunction(() => /Stable patch on/.test(document.getElementById("patch-channel-note").textContent), null, { timeout: 5000 }).catch(() => {});
  check("PUT sends stable", JSON.stringify(state.puts[1]) === JSON.stringify({ channel: "stable" }), JSON.stringify(state.puts));
  check("stable marked again", JSON.stringify(await marked(page)) === JSON.stringify(["stable"]));

  // A 403 refusal: the API's message is shown, the mark stays.
  state.refuse = true;
  await page.click('[data-channel="pre"]');
  await page.waitForSelector("#patch-channel-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("403 message shown", (await page.textContent("#patch-channel-alert")) === "Your account cannot use the pre-release patch.", await page.textContent("#patch-channel-alert"));
  check("mark stays on stable after a refusal", JSON.stringify(await marked(page)) === JSON.stringify(["stable"]));
  check("buttons usable again", !(await page.isDisabled('[data-channel="pre"]')));

  // 375px: nothing in the box passes the screen.
  await page.setViewportSize({ width: 375, height: 800 });
  const right = await page.evaluate(() => document.getElementById("patch-channel-panel").getBoundingClientRect().right);
  check("box inside 375px", right <= 375, String(right));
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
  console.log("account patch channel box OK");
})();
