#!/usr/bin/env node
/* Checks play.html and js/play.js in headless Chromium (no API needed): three cards with a numbered checklist
   each; ticks are kept in localStorage (hvmhfz.play) and come back after a reload; the progress count and
   the "clear the ticks" button; the copy buttons put the server settings on the clipboard; the installer and
   full download slots are hidden until their flag and URL are set (the test serves js/play.js with them
   switched on); the home page's main button and the "New here" tiles go to /play.html (cards by anchor); the Windows and Linux
   guides open with a Start at Play box. Needs Playwright:

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-play.js
     SHOTS=dev-shots NODE_PATH=... node dev/check-play.js   (also saves screenshots)

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const shots = process.env.SHOTS;
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
// ?slots=on serves js/play.js with every slot switched on, to test what the flag does
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (file.endsWith(path.sep)) file += "index.html";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    if (url.pathname === "/js/play.js" && req.headers.referer && req.headers.referer.includes("slots=on")) {
      data = Buffer.from(data.toString("utf8").replace(/enabled: false, url: ""/g, 'enabled: true, url: "https://example.org/file"'));
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base + "/play.html");
  check("title", (await page.title()) === "Play on Hunsterverse · Hunsterverse");
  check("one h1", (await page.locator("h1").count()) === 1);

  // three cards, each a numbered list of steps with a checkbox
  const cards = await page.locator("[data-card]").evaluateAll((els) => els.map((el) => ({
    id: el.id, steps: el.querySelectorAll("ol.play-steps > li[data-step]").length,
    boxes: el.querySelectorAll("ol.play-steps > li[data-step] input[type=checkbox]").length })));
  check("three cards", cards.map((c) => c.id).join() === "windows,linux,transfer", JSON.stringify(cards));
  cards.forEach((c) => check(c.id + " has steps with a checkbox each", c.steps >= 5 && c.steps === c.boxes, JSON.stringify(c)));
  const ids = await page.locator("[data-step]").evaluateAll((els) => els.map((el) => el.getAttribute("data-step")));
  check("step ids are unique", new Set(ids).size === ids.length);

  // Steam Deck is marked as not tested
  check("Steam Deck not tested note", /Steam Deck is not tested yet/.test(await page.locator("#linux .note-text").first().innerText()));

  // ticks: progress, saved, back after a reload
  const win = page.locator("#windows");
  const total = cards[0].steps;
  check("progress starts at 0", (await win.locator("[data-progress]").textContent()) === "0 of " + total + " done");
  await win.locator('[data-step="win-client"] input').check();
  await win.locator('[data-step="win-folder"] input').check();
  await page.locator('#transfer [data-step="tr-setup"] input').check();
  check("progress counts", (await win.locator("[data-progress]").textContent()) === "2 of " + total + " done");
  check("step marked done", await win.locator('[data-step="win-client"]').evaluate((el) => el.classList.contains("is-done")));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("hvmhfz.play")));
  check("saved in localStorage", JSON.stringify(saved) === JSON.stringify({ "win-client": true, "win-folder": true, "tr-setup": true }), JSON.stringify(saved));
  await page.reload();
  check("ticks come back after a reload", (await win.locator("input:checked").count()) === 2
    && await page.locator('#transfer [data-step="tr-setup"] input').isChecked());
  await win.locator('[data-step="win-client"] input').uncheck();
  check("unticking is saved", Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem("hvmhfz.play")))).length === 2);
  // clear one card: the other card keeps its tick
  await win.locator("[data-reset]").click();
  check("clear empties the card", (await win.locator("input:checked").count()) === 0);
  check("clear keeps the other cards", await page.locator('#transfer [data-step="tr-setup"] input').isChecked());
  await page.locator("#transfer [data-reset]").click();
  check("nothing left in storage", (await page.evaluate(() => localStorage.getItem("hvmhfz.play"))) === null);

  // a broken saved value is ignored
  await page.evaluate(() => localStorage.setItem("hvmhfz.play", "not json"));
  await page.reload();
  check("bad saved value ignored", (await win.locator("input:checked").count()) === 0 && errors.length === 0, errors.join("; "));
  await page.evaluate(() => localStorage.removeItem("hvmhfz.play"));

  // copy buttons: server settings in both cards and the two Discord commands
  const copies = await page.locator("[data-copy]").evaluateAll((els) => els.map((el) => [el.closest("[data-card]").id, el.getAttribute("data-copy")]));
  ["Hunsterverse", "129.213.54.221", "8080", "53310"].forEach((v) =>
    ["windows", "linux"].forEach((c) => check("copy " + v + " in " + c, copies.some((x) => x[0] === c && x[1] === v))));
  check("copy /link and /import", copies.some((x) => x[1] === "/link code:") && copies.some((x) => x[1] === "/import backup:"));
  await win.locator('button[data-copy="129.213.54.221"]').click();
  check("clipboard holds the host", (await page.evaluate(() => navigator.clipboard.readText())) === "129.213.54.221");
  check("button says Copied", (await win.locator('button[data-copy="129.213.54.221"]').textContent()) === "Copied");

  // slots: the published installers are on; the full download stays hidden until its flag is set
  check("installer slots shown", (await page.locator('[data-slot^="installer"]:visible').count()) === 2);
  check("full download shown", (await page.locator('[data-slot="full"]:visible').count()) === 1);
  check("installer link", (await page.locator('[data-slot="installer"] a').getAttribute("href")).endsWith("/releases/download/installer/HunsterverseSetup.exe"));
  await page.goto(base + "/play.html?slots=on");
  check("slots shown when on", (await page.locator("[data-slot]:visible").count()) === 3);
  check("slot link set", (await page.locator('[data-slot="full"] a').getAttribute("href")) .startsWith("https://"));

  // the transfer table and the Backups link
  check("transfer table rows", (await page.locator("#transfer .play-sources tbody tr").count()) >= 4);
  check("Backups link", (await page.locator('#transfer a[href="/account.html#backups"]').count()) === 1);

  // links into the page: the paths and the card anchors
  await page.goto(base + "/play.html#linux");
  check("anchor opens the Linux card", (await page.locator("#linux").isVisible()));

  // phone width: nothing scrolls sideways
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(base + "/play.html"); // load it at phone width, as a phone does
  await page.waitForTimeout(500);       // the folded Menu is set by js/nav.js after load
  check("no sideways scroll on a phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    (await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 4).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right)).join("; "))));
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, "play-375.png"), fullPage: true }); }
  await page.setViewportSize({ width: 1280, height: 900 });
  if (shots) await page.screenshot({ path: path.join(shots, "play-1280.png"), fullPage: true });

  // home page: the main button and the New here tile
  await page.goto(base + "/");
  check("home main button", (await page.locator(".hero-actions .btn-primary").getAttribute("href")) === "/play.html");
  check("home New here tile", (await page.locator("#new-here a[href='/play.html']").count()) === 1);
  // the "New here" row sends everything to Play (cards by anchor); the old guides are not linked from it
  const hrefs = await page.locator("#new-here a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check("home New here tiles go to Play cards", ["/play.html#windows", "/play.html#linux", "/play.html#transfer"].every((h) => hrefs.includes(h)), hrefs.join(" "));
  check("home New here row has no old guide", !hrefs.some((h) => /guide-(windows|linux)/.test(h)), hrefs.join(" "));
  check("home sign-in box links to Play", (await page.locator(".login-box a[href='/play.html']").count()) === 1);
  // the old setup guides open with a Start at Play box: Play, the three cards, and the installer slot (hidden
  // by default, shown from js/play.js's flag, with that flag's URL)
  for (const [guide, slot] of [["guide-windows.html", "installer"], ["guide-linux.html", "installer-linux"]]) {
    await page.goto(base + "/" + guide);
    const start = page.locator("#start-at-play");
    check(guide + " Start at Play box", (await start.count()) === 1);
    const links = await start.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    check(guide + " box links", ["/play.html", "/play.html#windows", "/play.html#linux", "/play.html#transfer"].every((h) => links.includes(h)), links.join(" "));
    check(guide + " box is above the contents", await page.evaluate(() => document.querySelector("#start-at-play").compareDocumentPosition(document.querySelector(".toc")) & Node.DOCUMENT_POSITION_FOLLOWING));
    const s = start.locator("[data-slot='" + slot + "']");
    check(guide + " installer slot shown", await s.isVisible());
    check(guide + " installer link", /^https:\/\/github\.com\/EclipseKnight\/.*\/installer\//.test((await s.locator("[data-slot-link]").getAttribute("href")) || ""));
    if (shots) await page.screenshot({ path: path.join(shots, guide.replace(".html", "") + "-1280.png"), clip: { x: 0, y: 0, width: 1280, height: 900 } });
  }
  // the Roads guide is not a setup guide: no Windows / Linux switch
  await page.goto(base + "/guide-roads.html");
  check("roads guide has no setup switch", (await page.locator(".guide-switch").count()) === 0);
  // nav
  check("nav has Play", (await page.locator('#site-menu a[href="/play.html"]').count()) === 1);

  await browser.close();
  server.close();
  failures.forEach((f) => console.log("FAIL " + f));
  console.log(failures.length ? failures.length + " check(s) failed" : "play page OK");
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.log("error: " + e.message); process.exit(1); });
