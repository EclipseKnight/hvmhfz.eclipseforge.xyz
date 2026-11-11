#!/usr/bin/env node
/* Checks play.html and js/play.js in headless Chromium (no API needed): three cards with a numbered checklist
   each; ticks are kept in localStorage (hvmhfz.play) and come back after a reload; the progress count and
   the "clear the ticks" button; the copy buttons put the server settings on the clipboard; the installer and
   full download slots are hidden until their flag and URL are set (the test serves js/play.js with them
   switched on); the home page's main button and the "New here" tiles go to /play.html (cards by anchor); the "More help"
   sections (troubleshooting, patch, Linux per distribution, language, Discord commands) and the way a link or address
   opens one; the client patch versions (#patches, from data/patch-versions.json); the old Windows and Linux guides are only
   redirect pages that send each old #anchor to Play. Needs Playwright:

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

  // the transfer table and the transfer wizard link (account page, Transfer tab)
  check("transfer table rows", (await page.locator("#transfer .play-sources tbody tr").count()) >= 4);
  check("transfer wizard link", (await page.locator('#transfer a[href="/account.html#transfer"]').count()) === 1);

  // "More help": the sections kept from the old guides, closed until asked for, opened by an address or a link
  const helpIds = ["windows-patch", "windows-trouble", "linux-packages", "linux-patch", "linux-prefix", "linux-wrapper", "linux-trouble", "language", "discord"];
  for (const id of helpIds) {
    check("help section " + id + " is a closed <details>", await page.locator("details#" + id).evaluate((el) => el.open === false).catch(() => false));
  }
  check("Windows troubleshooting has the 'Patcher failed to connect' and login rows",
    /Patcher failed to connect/.test(await page.locator("#windows-trouble").textContent()) && /Login fails/.test(await page.locator("#windows-trouble").textContent()));
  check("Windows patch script is there", /Invoke-WebRequest/.test(await page.locator("#windows-patch").textContent()) && !/EclipseKnightt/.test(await page.locator("#windows-patch").innerHTML()));
  const linuxPk = await page.locator("#linux-packages").textContent();
  check("Linux packages has every distribution", ["Arch", "Debian and Ubuntu", "Fedora", "openSUSE", "Any other distribution"].every((d) => linuxPk.includes(d)));
  check("Linux prefix and wrapper have their commands", /mezeporta-setup-arch\.sh/.test(await page.locator("#linux-prefix").textContent()) && /GDK_BACKEND=x11/.test(await page.locator("#linux-wrapper").textContent()));
  const lt = await page.locator("#linux-trouble").textContent();
  check("Linux troubleshooting rows", ["Error 71", "Patcher failed to manage files", "Patcher failed to connect", "Login fails"].every((t) => lt.includes(t)));
  check("language section says Japanese text", /Japanese text shows as boxes/.test(await page.locator("#language").textContent()));
  const dc = await page.locator("#discord").textContent();
  check("Discord section commands", ["/link", "/backup", "/import", "/password"].every((c) => dc.includes(c)));
  // a link to an id inside a closed section, and an address with the id, open it
  await page.locator('#windows-trouble a[href="#windows-patch"]').first().evaluate((a) => a.scrollIntoView());
  await page.locator("#windows-trouble > summary").click();
  await page.locator('#windows-trouble a[href="#windows-patch"]').first().click();
  check("a link to a help section opens it", await page.locator("#windows-patch").evaluate((el) => el.open));
  await page.goto(base + "/play.html#linux-prefix");
  check("an address opens the help section it names", await page.locator("#linux-prefix").evaluate((el) => el.open));
  check("only that section opened", !(await page.locator("#linux-wrapper").evaluate((el) => el.open)));
  await page.goto(base + "/play.html#windows-server");
  check("step anchors exist", (await page.locator("li#windows-server, li#linux-server, li#windows-launcher, li#linux-launcher").count()) === 4);
  // every in-page link of Play points at an id of the page
  const dead = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => id && !document.getElementById(id)));
  check("every in-page link has its target", dead.length === 0, dead.join(" "));

  // client patch versions (#patches) from data/patch-versions.json: the current one in the box, the older ones in
  // the table (newest first) with their own release download and a copy button for the full sha256; the patch
  // size in the steps follows the current one; without the file a note points at GitHub releases
  const pv = JSON.parse(fs.readFileSync(path.join(root, "data", "patch-versions.json"), "utf8"));
  const pvNow = pv.patches.find((p) => p.current);
  const mb = (pvNow.size / 1e6).toFixed(1) + " MB";
  await page.goto(base + "/play.html#patches");
  await page.locator("[data-patch-current]").waitFor({ state: "visible" });
  const box = await page.locator("[data-patch-current]").innerText();
  check("current patch version shown", box.includes("v" + pvNow.version) && box.includes(pvNow.sha256) && box.includes(mb), box);
  check("current patch download is client_patch", (await page.locator("[data-patch-current] a.btn").getAttribute("href")) === pv.current);
  const rows = await page.locator("[data-patch-rows] tr").evaluateAll((trs) => trs.map((tr) => ({
    v: tr.getAttribute("data-version"), href: (tr.querySelector('td[data-label="Download"] a') || {}).href,
    hash: tr.querySelector('td[data-label="SHA-256"] code').textContent, text: tr.textContent })));
  const older = pv.patches.filter((p) => !p.current);
  check("one row per older version, newest first", rows.map((r) => r.v).join() === older.map((p) => p.version).join(), rows.map((r) => r.v).join());
  check("each row downloads its own release", rows.every((r, i) => r.href === older[i].download && /\/releases\/download\/client-patch-v[0-9.]+\/Frontier_Patch\.zip$/.test(r.href)));
  check("short sha256 per row", rows.every((r, i) => r.hash === older[i].sha256.slice(0, 8)));
  check("known problems shown", older.filter((p) => p.note).every((p) => rows.find((r) => r.v === p.version).text.includes(p.note)));
  check("troubleshooting note", /always installs the current patch/.test(await page.locator("#patches").innerText()));
  check("load note hidden once loaded", await page.locator("[data-patch-status]").isHidden());
  const sizes = await page.locator("[data-patch-size]").allTextContents();
  check("patch size in the steps follows the current patch", sizes.length === 3 && sizes.every((t) => t === mb), sizes.join());
  await page.locator('[data-patch-rows] tr[data-version="' + older[0].version + '"] button[data-copy-sha]').click();
  check("copy puts the full sha256 on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === older[0].sha256);
  check("patch links from the help sections", (await page.locator('#windows-patch a[href="#patches"], #linux-patch a[href="#patches"]').count()) === 2);
  const failing = await context.newPage();
  await failing.route("**/data/patch-versions.json", (r) => r.fulfill({ status: 404, body: "" }));
  await failing.goto(base + "/play.html");
  await failing.waitForFunction(() => /could not be loaded/.test(document.querySelector("[data-patch-status]").textContent));
  check("no file: note with the GitHub releases link", (await failing.locator('[data-patch-status] a[href$="/releases"]').count()) === 1
    && await failing.locator("[data-patch-current]").isHidden() && await failing.locator(".play-patch-table").isHidden());
  await failing.close();

  // links into the page: the paths and the card anchors
  await page.goto(base + "/play.html#linux");
  check("anchor opens the Linux card", (await page.locator("#linux").isVisible()));

  // phone width: nothing scrolls sideways
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto(base + "/play.html"); // load it at phone width, as a phone does
  await page.waitForTimeout(500);       // the folded Menu is set by js/nav.js after load
  await page.locator("[data-patch-rows] tr").first().waitFor();
  check("patch table is one card per version on a phone", (await page.locator(".play-patch-table thead").isHidden())
    && (await page.locator("[data-patch-rows] tr").first().evaluate((tr) => getComputedStyle(tr).display)) === "grid");
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
  // the old setup guides are redirect pages: noindex, canonical, a meta refresh to the card, a visible link, no
  // Play checklist of their own; each old #anchor (and no anchor, and an unknown one) lands on its Play id
  const moved = {
    "guide-windows.html": { card: "windows", map: { patch: "windows-patch", trouble: "windows-trouble", layout: "windows-trouble",
      launcher: "windows-launcher", server: "windows-server", english: "language", discord: "discord", need: "windows", "": "windows" } },
    "guide-linux.html": { card: "linux", map: { packages: "linux-packages", other: "linux-packages", patch: "linux-patch",
      prefix: "linux-prefix", settings: "linux-prefix", wrapper: "linux-wrapper", trouble: "linux-trouble", launcher: "linux-launcher",
      server: "linux-server", english: "language", discord: "discord", layout: "linux", "": "linux" } },
  };
  const playIds = await (async () => { await page.goto(base + "/play.html"); return new Set(await page.evaluate(() => [...document.querySelectorAll("[id]")].map((e) => e.id))); })();
  for (const [guide, info] of Object.entries(moved)) {
    const raw = fs.readFileSync(path.join(root, guide), "utf8");
    check(guide + " is noindex", /<meta name="robots" content="noindex"/.test(raw));
    check(guide + " canonical is Play", raw.includes('<link rel="canonical" href="https://hvmhfz.eclipseforge.xyz/play.html" />'));
    check(guide + " meta refresh 0 to the card", raw.includes('<meta http-equiv="refresh" content="0; url=/play.html#' + info.card + '"'));
    // the shared bar and footer (dev/shell/) grow with the site, so only the rest of the page is measured
    const own = raw.replace(/<header class="site-nav">[\s\S]*?<\/header>|<footer class="site-foot"[\s\S]*?<\/footer>/g, "");
    check(guide + " has no guide text left", own.length < 8000, String(own.length));
    for (const [oldAnchor, id] of Object.entries(info.map)) {
      check(guide + "#" + oldAnchor + " goes to an id on Play (" + id + ")", playIds.has(id));
      await page.goto(base + "/" + guide + (oldAnchor ? "#" + oldAnchor : ""));
      await page.waitForURL("**/play.html**");
      check(guide + "#" + oldAnchor + " lands on #" + id, new URL(page.url()).hash === "#" + id, page.url());
    }
    await page.goto(base + "/" + guide + "#no-such-anchor");
    await page.waitForURL("**/play.html**");
    check(guide + " unknown anchor opens the card", new URL(page.url()).hash === "#" + info.card, page.url());
    // without JavaScript the page stays visible, with its link to the card
    const plain = await context.browser().newContext({ javaScriptEnabled: false });
    const p2 = await plain.newPage();
    await p2.goto(base + "/" + guide, { waitUntil: "commit" }).catch(() => {});
    await p2.waitForURL("**/play.html**", { timeout: 5000 }).catch(() => {});
    check(guide + " meta refresh works without JavaScript", new URL(p2.url()).pathname === "/play.html" && new URL(p2.url()).hash === "#" + info.card, p2.url());
    await plain.close();
  }
  // the redirect page shows a visible link to the card
  for (const guide of Object.keys(moved)) {
    const html = fs.readFileSync(path.join(root, guide), "utf8");
    check(guide + " has the visible 'This guide moved to Play' link", html.includes(">This guide moved to Play</a>") && html.includes('href="/play.html#' + moved[guide].card + '"'));
  }
  // the nav and the footer do not list them any more
  for (const where of ["#site-menu", ".site-foot"]) {
    await page.goto(base + "/play.html");
    check(where + " has no old guide link", (await page.locator(where + ' a[href^="/guide-windows"], ' + where + ' a[href^="/guide-linux"]').count()) === 0);
  }
  // no page outside the redirect pages links the old guides, except the changelog's history
  for (const f of fs.readdirSync(root).filter((n) => n.endsWith(".html") && !(n in moved) && n !== "changelog.html")) {
    check(f + " does not link an old guide", !/href="\/guide-(windows|linux)\.html/.test(fs.readFileSync(path.join(root, f), "utf8")));
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
