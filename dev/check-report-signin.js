#!/usr/bin/env node
/* Checks in headless Chromium, against a fake API, that report.html is for signed-in accounts only:

   - signed out (no saved sign-in, or an expired one): an explanation and a Sign in button that comes back to
     the report page (/?next=...), no forms, no request to /api/feedback;
   - signed in: both forms, the report goes to POST /api/feedback with the saved token (JSON and with a file);
     the API's answers 201, 403, 429 and an unreachable API behave as before; the same page works whether or not
     the API already demands the sign-in;
   - the API answers 401 (token expired or refused): the player is asked to sign in again, what they typed stays
     in the form and in sessionStorage, and after signing in again it is back in the form; a sign-in that runs out
     before sending behaves the same without any request;
   - a saved draft is cleared after a report is sent.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-report-signin.js

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

const jwt = (exp) => "e30." + Buffer.from(JSON.stringify({ exp, sub: "Aldra" })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800);   // 2100
const EXPIRED = jwt(1000000000); // 2001
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

/* A report page with the fake API. o.feedback: status of POST /api/feedback ("down" = network error).
   The fake Turnstile always gives a token. posts: the feedback requests the API got. */
async function open(browser, token, o) {
  o = o || {};
  const page = await browser.newPage();
  const errors = [];
  const posts = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (token) await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), token);
  await page.addInitScript(() => {
    // render marks its slot: js/turnstile.js mounts the widget on a 250 ms poll, so send() waits for it.
    window.turnstile = { render: (slot) => { slot.dataset.fakeWidget = "1"; return "w1"; }, getResponse: () => "ts-ok", reset: () => {} };
  });
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    if (p === "/api/feedback") {
      posts.push({ auth: req.headers().authorization || "", type: req.headers()["content-type"] || "", body: req.postData() || "" });
      if (o.feedback === "down") return route.abort();
      const status = o.feedback || 201;
      return route.fulfill({ status, headers: CORS, contentType: "application/json",
        body: status === 201 ? JSON.stringify({ taskId: 7, attachmentsFailed: 0 }) : "{}" });
    }
    if (p === "/api/account") return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ discordLinked: true }) });
    return route.fulfill({ status: 404, headers: CORS, body: "" });
  });
  return { page, errors, posts };
}

const visible = (page, sel) => page.isVisible(sel);

async function fillBug(page) {
  await page.fill("#bug-title", "Crash in the Guild Hall");
  await page.selectOption("#bug-platform", "linux");
  await page.fill("#bug-description", "It closes.");
  await page.fill("#bug-steps", "1. Enter");
}

async function send(page, formSel) {
  await page.waitForFunction((s) => !document.querySelector(s + " .report-fields").disabled
    && document.querySelector(s + " .turnstile-slot").dataset.fakeWidget === "1", formSel);
  await page.click(formSel + " .report-send");
  await page.waitForSelector(formSel + " .report-status:not([hidden])", { timeout: 5000 });
  return page.textContent(formSel + " .report-status");
}

async function signedOut(browser, base) {
  for (const [tag, token] of [["signed out", null], ["expired sign-in", EXPIRED]]) {
    const r = await open(browser, token);
    await r.page.goto(base + "/report.html#feature");
    check(tag + ": sign-in panel", await visible(r.page, "#report-signin"));
    check(tag + ": no bug form", !(await visible(r.page, "#bug")) && !(await visible(r.page, "#bug-title")));
    check(tag + ": no feature form", !(await visible(r.page, "#feature")) && !(await visible(r.page, "#feature-title")));
    check(tag + ": no type chips", !(await visible(r.page, ".report-jump")));
    const href = await r.page.getAttribute("#report-signin-link", "href");
    check(tag + ": sign-in comes back here", href === "/?next=%2Freport.html%23feature#login-form", href);
    await r.page.click("#report-signin-link");
    await r.page.waitForURL((u) => u.pathname === "/", { timeout: 5000 });
    const url = new URL(r.page.url());
    check(tag + ": lands on the sign-in form", url.searchParams.get("next") === "/report.html#feature" && url.hash === "#login-form", r.page.url());
    const note = await r.page.waitForSelector("#login-next:not([hidden])", { timeout: 5000 }).then((n) => n.textContent()).catch(() => "(no note)");
    check(tag + ": note", note === "Sign in to report a problem.", note);
    check(tag + ": no request", r.posts.length === 0);
    check(tag + ": errors", r.errors.length === 0, r.errors.join("; "));
    await r.page.close();
  }
}

async function signedIn(browser, base) {
  let r = await open(browser, TOKEN);
  await r.page.goto(base + "/report.html");
  check("signed in: no sign-in panel", !(await visible(r.page, "#report-signin")));
  check("signed in: both forms", (await visible(r.page, "#bug-title")) && (await visible(r.page, "#feature-title")));
  await r.page.waitForFunction(() => /linked Discord/.test(document.querySelector("[data-signer]").textContent), null, { timeout: 5000 }).catch(() => {});
  check("signed in: who it is signed as", /Signed in as Aldra/.test(await r.page.textContent("[data-signer]")), await r.page.textContent("[data-signer]"));
  await fillBug(r.page);
  let text = await send(r.page, "#bug");
  check("signed in: success", /task #7/.test(text), text);
  check("signed in: one request", r.posts.length === 1);
  const post = r.posts[0] || {};
  check("signed in: token sent", post.auth === "Bearer " + TOKEN, post.auth);
  check("signed in: JSON body", /application\/json/.test(post.type) && JSON.parse(post.body || "{}").title === "Crash in the Guild Hall", post.body);
  check("signed in: form emptied", (await r.page.inputValue("#bug-title")) === "");
  check("signed in: errors", r.errors.length === 0, r.errors.join("; "));
  await r.page.close();

  // a feature request with a file: multipart, still with the token
  r = await open(browser, TOKEN);
  await r.page.goto(base + "/report.html#feature");
  await r.page.fill("#feature-title", "More boxes");
  await r.page.fill("#feature-description", "Bigger item box.");
  await r.page.setInputFiles("#feature-files", { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("log") });
  text = await send(r.page, "#feature");
  check("signed in, file: success", /task #7/.test(text), text);
  check("signed in, file: multipart with token", r.posts.length === 1 && /multipart\/form-data/.test(r.posts[0].type) && r.posts[0].auth === "Bearer " + TOKEN);
  await r.page.close();

  // the answers that are not about the sign-in
  for (const [status, want] of [[403, /spam check failed/], [429, /Too many reports/], ["down", /isn't reachable/]]) {
    r = await open(browser, TOKEN, { feedback: status });
    await r.page.goto(base + "/report.html");
    await fillBug(r.page);
    text = await send(r.page, "#bug");
    check("signed in, API " + status, want.test(text), text);
    check("signed in, API " + status + ": still signed in, text kept", (await r.page.evaluate(() => !!localStorage.getItem("hvmhfz.token")))
      && (await r.page.inputValue("#bug-title")) === "Crash in the Guild Hall" || status === "down");
    await r.page.close();
  }
}

async function expired(browser, base) {
  // the API refuses the token (401)
  let r = await open(browser, TOKEN, { feedback: 401 });
  await r.page.goto(base + "/report.html#bug");
  await fillBug(r.page);
  const text = await send(r.page, "#bug");
  check("401: asks to sign in again", /sign-in has run out/.test(text) && /Sign in again/.test(text), text);
  check("401: not the Discord fallback", !/isn't reachable/.test(text));
  check("401: form keeps the text", (await r.page.inputValue("#bug-title")) === "Crash in the Guild Hall"
    && (await r.page.inputValue("#bug-description")) === "It closes.");
  const draft = await r.page.evaluate(() => JSON.parse(sessionStorage.getItem("hvmhfz.report-draft") || "{}"));
  check("401: draft in sessionStorage", draft.bug && draft.bug.title === "Crash in the Guild Hall" && draft.bug.platform === "linux"
    && draft.bug.steps === "1. Enter", JSON.stringify(draft));
  check("401: the refused token is dropped", await r.page.evaluate(() => !localStorage.getItem("hvmhfz.token")));
  const href = await r.page.getAttribute("#bug .report-status a", "href");
  check("401: sign-in comes back here", href === "/?next=%2Freport.html%23bug#login-form", href);
  check("401: one request", r.posts.length === 1);

  // sign in again (here: a fresh token appears), come back, the text is in the form; sending clears the draft
  await r.page.evaluate((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  r.page.removeAllListeners("pageerror");
  await r.page.unroute("https://api.hvmhfz.eclipseforge.xyz/**");
  await r.page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (new URL(req.url()).pathname === "/api/feedback") {
      r.posts.push({ auth: req.headers().authorization || "" });
      return route.fulfill({ status: 201, headers: CORS, contentType: "application/json", body: JSON.stringify({ taskId: 8 }) });
    }
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: "{}" });
  });
  await r.page.reload();
  await r.page.waitForFunction(() => !document.querySelector("#bug .report-fields").disabled);
  check("after sign-in: text back in the form", (await r.page.inputValue("#bug-title")) === "Crash in the Guild Hall"
    && (await r.page.inputValue("#bug-platform")) === "linux" && (await r.page.inputValue("#bug-steps")) === "1. Enter");
  check("after sign-in: other form empty", (await r.page.inputValue("#feature-title")) === "");
  const again = await send(r.page, "#bug");
  check("after sign-in: sent", /task #8/.test(again), again);
  check("after sign-in: draft cleared", await r.page.evaluate(() => sessionStorage.getItem("hvmhfz.report-draft") === null));
  await r.page.close();

  // the sign-in runs out between loading the page and pressing send: nothing is sent
  r = await open(browser, jwt(Math.floor(Date.now() / 1000) + 40));
  await r.page.goto(base + "/report.html");
  await fillBug(r.page);
  await r.page.evaluate(() => localStorage.setItem("hvmhfz.token", "e30." + btoa(JSON.stringify({ exp: 1000000000 })) + ".x"));
  const gone = await send(r.page, "#bug");
  check("ran out before sending: asks to sign in", /sign-in has run out/.test(gone), gone);
  check("ran out before sending: nothing sent", r.posts.length === 0);
  check("ran out before sending: text kept", (await r.page.inputValue("#bug-title")) === "Crash in the Guild Hall"
    && (await r.page.evaluate(() => !!sessionStorage.getItem("hvmhfz.report-draft"))));
  await r.page.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    await signedOut(browser, base);
    await signedIn(browser, base);
    await expired(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("report page sign-in OK");
})().catch((e) => { console.error(e); process.exit(1); });
