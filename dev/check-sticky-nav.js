#!/usr/bin/env node
/* Checks that each long page keeps its own navigation on screen, pinned under the site bar (js/page-nav.js, the
   Frontier guide's side column, the sticky tab rows), in headless Chromium at 1280 and 375 px (and the guide at
   1024 px, where the page nav bar replaces the side column):

   - at the top of the page the contents list is in its place and the page nav bar is not shown (pages with a list);
   - half way down and at the very bottom: the page's nav is visible, starts at the site bar's bottom edge (not
     under it, not lower than 16 px below it), and the section in view is marked (bar and Jump to select agree;
     at the bottom, the last section);
   - the page is never wider than the screen;
   - a #hash load (also from another page, as the account page's next-step links do) puts the target below both
     bars, in the upper half of the screen (unless the page ends first), once the scroll has settled; the phone's Jump to select does the same;
   - the guide's Guide select lists the guide pages with this one chosen;
   - no page errors.

   With SHOTS=<folder> it also saves screenshots, top and scrolled, of a few pages at 1280 and 375 px.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-sticky-nav.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (file.endsWith(path.sep)) file += "index.html";
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const SHOTS = process.env.SHOTS || "";

// page, widths, what holds its nav (by width), whether its contents list starts in place (bar hidden at the top)
const PAGES = [
  { page: "guide-frontier-armour.html", widths: [1280, 1024, 375], list: true, shot: "guide-armour" },
  { page: "guide-frontier-zenith.html", widths: [1280, 375], list: true },
  { page: "guide-frontier-hunsterverse.html", widths: [1280, 375], list: true, shot: "guide-hunsterverse" },
  { page: "guide-frontier.html", widths: [1280, 375], list: true },
  { page: "changelog.html", widths: [1280, 375], list: true, shot: "changelog" },
  { page: "privacy.html", widths: [1280, 375], list: true },
  { page: "api.html", widths: [1280, 375], list: true },
  { page: "play.html", widths: [1280, 375], list: true, shot: "play" },
  { page: "currencies.html", widths: [1280, 375], list: true },
  { page: "weapons.html", widths: [1280, 375], list: false, shot: "weapons" },
  { page: "food.html", widths: [1280, 375], list: false }
];
const HASHES = [
  { page: "guide-frontier-progression.html", hash: "end-game", widths: [1280, 375] },
  { page: "guide-frontier-zenith.html", hash: "zenith-skills", widths: [1024] },
  { page: "guide-frontier-hunsterverse.html", hash: "zenith", widths: [1280, 375] },
  { page: "privacy.html", hash: "cookies", widths: [1280, 375] },
  { page: "changelog.html", hash: "known", widths: [375] },
  { page: "weapons.html", hash: "calc", widths: [1280] }
];

function navSelector(page, width) {
  if (page === "weapons.html" || page === "food.html") return ".subtabs-bar";
  if (width >= 1100 && /^guide-frontier-(?!hunsterverse)/.test(page)) return ".hb-side";
  return "nav.page-nav";
}

async function open(browser, port, width, url) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 812 : 800 }, locale: "en-US" });
  // nothing leaves the machine: the API and third-party hosts are refused
  await ctx.route("**/*", (route) => (route.request().url().startsWith("http://127.0.0.1:" + port) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:" + port + "/" + url, { waitUntil: "load" });
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

// Waits until the page has stopped scrolling (a smooth scroll to an anchor takes a moment).
async function settle(page) {
  let last = -1;
  for (let i = 0; i < 50; i++) {
    const y = await page.evaluate(() => window.pageYOffset);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(150);
  }
}

async function scrollTo(page, where) {
  await page.evaluate((where) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: where === "bottom" ? max : Math.round(max * where), left: 0, behavior: "instant" });
  }, where);
  await page.waitForTimeout(250);
}

function state(page, sel) {
  return page.evaluate((sel) => {
    const header = document.querySelector("header.site-nav").getBoundingClientRect();
    const nav = document.querySelector(sel);
    const shown = !!nav && !nav.hidden && nav.getClientRects().length > 0;
    const r = shown ? nav.getBoundingClientRect() : null;
    const here = nav && nav.querySelector(".is-here");
    const jump = nav && nav.querySelector(".page-nav-jump select");
    const links = nav ? Array.prototype.map.call(nav.querySelectorAll(".page-nav-row a"), (a) => a.getAttribute("href")) : [];
    return {
      headerBottom: header.bottom, shown, top: r && r.top, bottom: r && r.bottom, height: r && r.height,
      here: here && here.getAttribute("href"), jump: jump && jump.value, lastLink: links[links.length - 1] || null,
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, viewH: window.innerHeight
    };
  }, sel);
}

function pinned(label, s) {
  check(label + ": page nav shown", s.shown);
  if (!s.shown) return;
  check(label + ": page nav not under the site bar", s.top >= s.headerBottom - 0.5, "top " + s.top + ", site bar ends at " + s.headerBottom);
  check(label + ": page nav right under the site bar", s.top <= s.headerBottom + 16, "top " + s.top + ", site bar ends at " + s.headerBottom);
  check(label + ": page nav on screen", s.height > 20 && s.bottom <= s.viewH, "height " + s.height + ", bottom " + s.bottom);
}

// The target of a #hash below both bars and in the upper half of the screen.
async function landed(label, page, id, sel) {
  await settle(page);
  const r = await page.evaluate(({ id, sel }) => {
    const t = document.getElementById(id);
    const header = document.querySelector("header.site-nav").getBoundingClientRect();
    const nav = sel && document.querySelector(sel);
    const navRect = nav && !nav.hidden && nav.getClientRects().length ? nav.getBoundingClientRect() : null;
    return { top: t ? t.getBoundingClientRect().top : null, header: header.bottom,
      nav: navRect ? navRect.bottom : header.bottom, h: window.innerHeight,
      end: window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2 };
  }, { id, sel });
  check(label + ": target exists", r.top !== null);
  if (r.top === null) return;
  check(label + ": target below both bars", r.top >= r.nav - 0.5, "target at " + Math.round(r.top) + ", bars end at " + Math.round(r.nav));
  // (a target near the end of the page cannot go higher than the page's end allows)
  check(label + ": target in the upper half of the screen", r.top <= r.h / 2 || r.end, "target at " + Math.round(r.top));
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  try {
    for (const p of PAGES) {
      for (const width of p.widths) {
        const label = p.page + " @" + width;
        const sel = navSelector(p.page, width);
        const { ctx, page, errors } = await open(browser, port, width, p.page);
        const top = await state(page, sel);
        if (p.list && sel === "nav.page-nav") check(label + ": no page nav bar at the top (the contents list is in place)", !top.shown);
        if (SHOTS && p.shot) await page.screenshot({ path: path.join(SHOTS, p.shot + "-" + width + "-top.png") });
        await scrollTo(page, 0.5);
        const mid = await state(page, sel);
        pinned(label + " half way", mid);
        if (sel === "nav.page-nav" && mid.shown) {
          check(label + " half way: a section is marked", !!mid.here);
          check(label + " half way: Jump to agrees with the bar", mid.jump && "#" + mid.jump === mid.here, mid.jump + " / " + mid.here);
        }
        if (SHOTS && p.shot) await page.screenshot({ path: path.join(SHOTS, p.shot + "-" + width + "-scrolled.png") });
        await scrollTo(page, "bottom");
        const end = await state(page, sel);
        pinned(label + " at the bottom", end);
        if (sel === "nav.page-nav" && end.shown) {
          check(label + " at the bottom: the last section is marked", end.here === end.lastLink, end.here + " / " + end.lastLink);
        }
        check(label + ": nothing wider than the screen", top.wide <= 0 && mid.wide <= 0 && end.wide <= 0,
          [top.wide, mid.wide, end.wide].join("/"));

        if (sel === "nav.page-nav" && /^guide-frontier-(?!hunsterverse)/.test(p.page) && p.page !== "guide-frontier.html") {
          const guide = await page.evaluate(() => {
            const s = document.querySelector(".page-nav-pages select");
            return s ? { n: s.options.length, value: s.value } : null;
          });
          check(label + ": Guide select lists the guide pages", guide && guide.n >= 15, JSON.stringify(guide));
          check(label + ": Guide select shows this page", guide && guide.value === "/" + p.page, JSON.stringify(guide));
        }
        if (width === 375 && sel === "nav.page-nav") {
          // the phone's Jump to select: the first section, from the bottom of the page
          const first = await page.evaluate(() => {
            const s = document.querySelector(".page-nav-jump select");
            if (!s || !s.getClientRects().length) return null;
            s.value = s.options[1] ? s.options[1].value : s.options[0].value;
            s.dispatchEvent(new Event("change"));
            return s.value;
          });
          check(label + ": Jump to select shown on a phone", !!first);
          if (first) await landed(label + " Jump to #" + first, page, first, sel);
        }
        check(label + ": no page errors", !errors.length, errors.join(" | "));
        await ctx.close();
      }
    }
    for (const h of HASHES) {
      for (const width of h.widths) {
        const label = h.page + "#" + h.hash + " @" + width;
        const { ctx, page, errors } = await open(browser, port, width, h.page + "#" + h.hash);
        const sel = navSelector(h.page, width);
        await landed(label, page, h.hash, sel === ".hb-side" ? null : sel);
        if (sel !== ".hb-side") pinned(label, await state(page, sel));
        check(label + ": no page errors", !errors.length, errors.join(" | "));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.length + " difference(s):\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("sticky page nav OK");
})().catch((e) => { console.error(e); process.exit(1); });
