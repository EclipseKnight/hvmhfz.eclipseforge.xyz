#!/usr/bin/env node
/* Checks the folded Menu (js/nav.js and the "nav: folded Menu" section of css/styles.css) in headless
   Chromium: at 375x667, 667x375 (a phone on its side), 768x1024 and 1280x800, on the home, Worlds
   and a guide page. With the menu open every entry can be scrolled into view, is 44px tall at least,
   keeps its label inside its box, and the page does not scroll sideways; a tap on a link and the
   Escape key close the menu (Escape puts the focus back on the Menu button). At 1280 the bar is not
   folded. Needs Playwright with Chromium, which the site itself does not use:

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-nav-mobile.js
     SHOTS=dev-shots NODE_PATH=... node dev/check-nav-mobile.js   (also saves a screenshot of each)

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const pages = ["/", "/worlds.html", "/guide-windows.html"];
const sizes = [[375, 667], [667, 375], [768, 1024], [1280, 800]];
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const shots = process.env.SHOTS;

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

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [w, h] of sizes) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800 });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    for (const url of pages) {
      const tag = `${w}x${h} ${url}`;
      const page = await context.newPage();
      await page.goto(base + url, { waitUntil: "load" });
      await page.waitForTimeout(300);
      const folded = await page.evaluate(() => !!document.querySelector(".nav-toggle").offsetParent);
      if (w > 1160) {
        check(!folded, `${tag}: the bar should not be folded`);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: page scrolls sideways`);
        if (shots) await page.screenshot({ path: `${shots}/${w}x${h}-${url.replace(/\W/g, "") || "index"}.png` });
        await page.close();
        continue;
      }
      check(folded, `${tag}: the Menu button is missing`);
      await page.click(".nav-toggle");
      check(await page.evaluate(() => document.querySelector(".site-nav").classList.contains("open")), `${tag}: Menu did not open`);
      if (shots) await page.screenshot({ path: `${shots}/${w}x${h}-${url.replace(/\W/g, "") || "index"}-menu.png` });

      const info = await page.evaluate(() => {
        const nav = document.querySelector(".site-nav nav");
        const barBottom = document.querySelector(".site-nav").getBoundingClientRect().bottom;
        const items = [...nav.querySelectorAll("a, .nav-search")].filter((e) => e.offsetParent);
        return {
          count: items.length,
          overflowY: getComputedStyle(nav).overflowY,
          fits: nav.scrollHeight <= nav.clientHeight,
          navBottom: nav.getBoundingClientRect().bottom, vh: innerHeight, barBottom,
          small: items.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim()),
          clipped: items.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()),
          sideways: document.documentElement.scrollWidth > innerWidth,
        };
      });
      check(info.count >= 18, `${tag}: only ${info.count} menu entries`);
      check(info.fits || info.overflowY === "auto", `${tag}: the open menu is taller than its box and cannot scroll`);
      check(info.navBottom <= info.vh + 1, `${tag}: the open menu runs ${Math.round(info.navBottom - info.vh)}px past the screen`);
      check(!info.small.length, `${tag}: entries under 44px: ${info.small.join(", ")}`);
      check(!info.clipped.length, `${tag}: labels wider than their box: ${info.clipped.join(", ")}`);
      check(!info.sideways, `${tag}: page scrolls sideways`);

      // every entry can be scrolled into the visible part of the screen
      const n = info.count;
      for (let i = 0; i < n; i++) {
        const seen = await page.evaluate((i) => {
          const nav = document.querySelector(".site-nav nav");
          const el = [...nav.querySelectorAll("a, .nav-search")].filter((e) => e.offsetParent)[i];
          el.scrollIntoView({ block: "nearest" });
          const r = el.getBoundingClientRect(), box = nav.getBoundingClientRect();
          return { text: el.textContent.trim(), ok: r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.bottom <= innerHeight + 1 };
        }, i);
        check(seen.ok, `${tag}: "${seen.text}" cannot be reached`);
      }
      if (shots) {
        await page.evaluate(() => { const nav = document.querySelector(".site-nav nav"); nav.scrollTop = nav.scrollHeight; });
        await page.screenshot({ path: `${shots}/${w}x${h}-${url.replace(/\W/g, "") || "index"}-menu-end.png` });
      }

      // Escape closes it and the focus goes back to the Menu button
      await page.keyboard.press("Escape");
      const esc = await page.evaluate(() => ({
        open: document.querySelector(".site-nav").classList.contains("open"),
        focus: document.activeElement === document.querySelector(".nav-toggle"),
        expanded: document.querySelector(".nav-toggle").getAttribute("aria-expanded"),
      }));
      check(!esc.open && esc.expanded === "false", `${tag}: Escape did not close the menu`);
      check(esc.focus, `${tag}: after Escape the focus is not on the Menu button`);

      // a tap on a link closes it (the click is cancelled so the page stays)
      await page.evaluate(() => document.addEventListener("click", (e) => { if (e.target.closest("a")) e.preventDefault(); }));
      await page.click(".nav-toggle");
      await page.evaluate(() => document.querySelector(".site-nav nav a[href='/events.html']").scrollIntoView({ block: "nearest" }));
      await page.click(".site-nav nav a[href='/events.html']");
      const tap = await page.evaluate(() => ({
        open: document.querySelector(".site-nav").classList.contains("open"),
        focus: document.activeElement === document.querySelector(".nav-toggle"),
      }));
      check(!tap.open, `${tag}: a tap on a link did not close the menu`);
      check(tap.focus, `${tag}: after a tap on a link the focus is not on the Menu button`);
      await page.close();
    }
    await context.close();
  }
  await browser.close();
  server.close();
}

main().then(() => {
  if (problems.length) { console.log(problems.join("\n")); console.log(problems.length + " problem(s)"); process.exit(1); }
  console.log("folded menu OK");
}, (err) => { console.error(err); server.close(); process.exit(1); });
