#!/usr/bin/env node
/* Checks the website sign-up (index.html #signup, js/signup.js), in node and in headless Chromium against a fake API:

   - the rules in js/signup.js match the API's SignupRules (names 3-20 of A-Z a-z 0-9 _ . -, passwords 6-72 of
     printable ASCII, both passwords the same);
   - the home page shows the sign-in form; "Create an account" (or /#signup) shows the sign-up form instead, with the
     case-sensitivity note and its own Turnstile widget, and "Sign in" goes back;
   - mistakes caught in the page are listed and nothing is sent;
   - the API's refusals are shown as they are (409 for a name that differs only by case, 400, 403, 429), a refusal
     without a message and an unreachable API get a plain sentence, and the widget is reset after each try;
   - a success sends {username, password, token} to POST /api/auth/signup, saves the sign-in and goes on like
     sign-in (the account page, or ?next=);
   - the Play page's account steps link to the form; no page errors; no sideways scrolling on a 360px phone.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-signup.js

   Exit code 0 = every case as expected, 1 = a difference (listed one per line). */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const Signup = require(path.join(root, "js", "signup.js"));

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

// ---- the rules, in node ----
const ok = (u, p, p2) => Signup.problems(u, p, p2 === undefined ? p : p2).length === 0;
["abc", "New_Hunter.1", "a-b", "x".repeat(20), "Eclipse"].forEach((u) => check("name accepted " + u, ok(u, "secret12")));
["", "ab", "x".repeat(21), "has space", "plus+", "Ünicode", "ハンター", " lead", "a/b"].forEach((u) =>
  check("name refused " + JSON.stringify(u), !ok(u, "secret12")));
["secret", "hunt3r pass!", "x".repeat(72), "~!@#$%^&*()"].forEach((p) => check("password accepted " + p, ok("abc", p)));
["", "short", "x".repeat(73), "pässword", "tab\there"].forEach((p) =>
  check("password refused " + JSON.stringify(p), !ok("abc", p)));
check("passwords must match", !ok("abc", "secret12", "secret13"));
check("two problems at once", Signup.problems("a b", "x", "x").length === 2);

// ---- the pages, in Chromium ----
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

const jwt = "e30." + Buffer.from(JSON.stringify({ exp: 4102444800, sub: "New_Hunter" })).toString("base64url") + ".x";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };

/* A page with the fake API and a fake Turnstile (token "ts-ok"; resets counted in window.__resets).
   answer: what POST /api/auth/signup returns ({status, body} or "down"). posts: the sign-up bodies sent. */
async function open(browser, answer, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 } });
  const errors = [];
  const posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__resets = 0;
    window.__slots = [];
    window.turnstile = {
      render: (slot) => { slot.dataset.fakeWidget = "1"; window.__slots.push(slot.id); return "w" + window.__slots.length; },
      getResponse: () => "ts-ok",
      reset: () => { window.__resets++; }
    };
  });
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    if (p === "/api/auth/signup") {
      posts.push(req.postData() || "");
      if (answer === "down") return route.abort();
      return route.fulfill({ status: answer.status, headers: CORS, contentType: "application/json", body: JSON.stringify(answer.body) });
    }
    if (p === "/api/account") return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ username: "New_Hunter" }) });
    return route.fulfill({ status: 404, headers: CORS, body: "" });
  });
  return { page, errors, posts };
}

async function fill(page, u, p, p2) {
  await page.fill("#signup-username", u);
  await page.fill("#signup-password", p);
  await page.fill("#signup-password2", p2 === undefined ? p : p2);
}

async function submit(page) {
  await page.waitForFunction(() => document.getElementById("signup-turnstile-slot").dataset.fakeWidget === "1");
  await page.click("#signup-submit");
}

async function warning(page) {
  await page.waitForSelector("#signup-warning:not([hidden])", { timeout: 5000 }).catch(() => {});
  return (await page.isVisible("#signup-warning")) ? page.textContent("#signup-warning") : "(no warning)";
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const conflict = "The username eclipse is taken: an account named Eclipse already exists, and names that differ only by capital letters are not allowed.";

  // switching forms
  let r = await open(browser, { status: 200, body: {} });
  await r.page.goto(base + "/");
  await r.page.waitForFunction(() => window.__slots.length > 0, null, { timeout: 5000 }).catch(() => {});
  check("home: sign-in form shown", await r.page.isVisible("#username"));
  check("home: sign-up hidden", !(await r.page.isVisible("#signup-username")));
  check("home: sign-up widget not rendered while hidden", (await r.page.evaluate(() => window.__slots.join())) === "turnstile-slot");
  await r.page.click("#signup-open");
  await r.page.waitForSelector("#signup-username", { state: "visible", timeout: 5000 }).catch(() => {});
  check("open: sign-up shown", await r.page.isVisible("#signup-username"));
  check("open: sign-in hidden", !(await r.page.isVisible("#username")));
  check("open: heading", (await r.page.textContent("#signin-title")) === "Create an account");
  check("open: case note", /Case-sensitive:/.test(await r.page.textContent("#signup-username-help")));
  check("open: launcher REGISTER still named", /REGISTER in the launcher/.test(await r.page.textContent("#signup")));
  await r.page.waitForFunction(() => window.__slots.includes("signup-turnstile-slot"), null, { timeout: 5000 }).catch(() => {});
  check("open: own widget", (await r.page.evaluate(() => window.__slots.join())) === "turnstile-slot,signup-turnstile-slot",
    await r.page.evaluate(() => window.__slots.join()));
  await r.page.click("#signup-close");
  await r.page.waitForSelector("#username", { state: "visible", timeout: 5000 }).catch(() => {});
  check("back: sign-in shown", await r.page.isVisible("#username"));
  check("back: sign-up hidden", !(await r.page.isVisible("#signup-username")));
  check("back: heading", (await r.page.textContent("#signin-title")) === "Sign in");
  check("switching: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  // mistakes caught in the page
  r = await open(browser, { status: 200, body: {} });
  await r.page.goto(base + "/#signup");
  await fill(r.page, "has space", "short");
  await submit(r.page);
  let text = await warning(r.page);
  check("page rules: name", /English letters/.test(text), text);
  check("page rules: password", /6 to 72/.test(text), text);
  await fill(r.page, "Fine_Name", "secret12", "secret13");
  await r.page.click("#signup-submit");
  text = await warning(r.page);
  check("page rules: mismatch", text === "The two passwords are not the same.", text);
  check("page rules: nothing sent", r.posts.length === 0);
  await r.page.close();

  // the API's refusals
  const refusals = [
    ["409 wrong case", { status: 409, body: { message: conflict } }, conflict],
    ["400 message", { status: 400, body: { message: "Your username must be 3 to 20 characters long." } }, "Your username must be 3 to 20 characters long."],
    ["403 captcha", { status: 403, body: { message: "The captcha check failed. Complete it again and resubmit." } }, "The captcha check failed. Complete it again and resubmit."],
    ["429 no message", { status: 429, body: {} }, "Too many sign-up attempts from your connection. Try again later."],
    ["500 no message", { status: 500, body: {} }, "The sign-up service had an error. Try again in a moment."],
    ["down", "down", "The sign-up service did not respond. Try again in a moment."]
  ];
  for (const [label, answer, want] of refusals) {
    r = await open(browser, answer);
    await r.page.goto(base + "/#signup");
    await fill(r.page, "eclipse", "secret12");
    await submit(r.page);
    text = await warning(r.page);
    check(label + ": shown", text === want, text);
    check(label + ": one request", r.posts.length === 1, String(r.posts.length));
    check(label + ": widget reset", (await r.page.evaluate(() => window.__resets)) >= 1);
    check(label + ": still on the form", new URL(r.page.url()).pathname === "/" && await r.page.isVisible("#signup-username"));
    check(label + ": no sign-in saved", (await r.page.evaluate(() => localStorage.getItem("hvmhfz.token"))) === null);
    check(label + ": button usable again", await r.page.isEnabled("#signup-submit"));
    check(label + ": errors", r.errors.length === 0, r.errors.join("; "));
    await r.page.close();
  }

  // success: signed in, then the account page or ?next=
  for (const [label, query, wantPath] of [["success", "", "/account.html"], ["success with next", "?next=%2Froad-vote.html", "/road-vote.html"]]) {
    r = await open(browser, { status: 200, body: { accessToken: jwt, username: "New_Hunter", roles: ["ROLE_USER"], discordActivationToken: "abc" } });
    await r.page.goto(base + "/" + query + "#signup");
    await fill(r.page, "New_Hunter", "hunt3r pass!");
    await submit(r.page);
    await r.page.waitForURL((u) => u.pathname === wantPath, { timeout: 5000 }).catch(() => {});
    check(label + ": goes on", new URL(r.page.url()).pathname === wantPath, r.page.url());
    let sent = {};
    try { sent = JSON.parse(r.posts[0] || "{}"); } catch (e) { /* listed below */ }
    check(label + ": body", sent.username === "New_Hunter" && sent.password === "hunt3r pass!" && sent.token === "ts-ok", r.posts[0]);
    check(label + ": sign-in saved", (await r.page.evaluate(() => localStorage.getItem("hvmhfz.token"))) === jwt);
    await r.page.close();
  }

  // Play page links straight to the form
  r = await open(browser, { status: 200, body: {} });
  await r.page.goto(base + "/play.html");
  for (const step of ["win-register", "lin-register"]) {
    const href = await r.page.getAttribute("[data-step=" + step + "] a.btn", "href");
    check("play " + step + ": link", href === "/#signup", href);
    check("play " + step + ": REGISTER still offered", /REGISTER in the launcher/.test(await r.page.textContent("[data-step=" + step + "]")));
    check("play " + step + ": case note", /case-sensitive/.test(await r.page.textContent("[data-step=" + step + "]")));
  }
  await r.page.click("[data-step=win-register] a.btn");
  await r.page.waitForURL((u) => u.pathname === "/" && u.hash === "#signup", { timeout: 5000 }).catch(() => {});
  check("play: opens the form", await r.page.isVisible("#signup-username").catch(() => false), r.page.url());
  check("play: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  // a narrow phone
  r = await open(browser, { status: 200, body: {} }, { width: 360, height: 740 });
  await r.page.goto(base + "/#signup");
  const overflow = await r.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no sideways scrolling", overflow <= 0, overflow + "px");
  check("phone: form shown", await r.page.isVisible("#signup-submit"));
  await r.page.close();

  await browser.close();
  server.close();
}

main().then(() => {
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("sign-up OK");
}).catch((e) => { console.error(e); process.exit(1); });
