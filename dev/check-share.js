#!/usr/bin/env node
/* Checks, in headless Chromium, the share links (dev/make-share-pages.py, js/share.js):

   - each share page opens the real page: /s/monster/akantor.html -> /monster.html?m=akantor,
     /s/weapon/lance.html?w=<id> -> /weapons.html?type=lance&w=<id> (the weapon id passed on, anything
     else in the query dropped), /s/changelog/<day>.html#d-<day>-<topic> -> the changelog at that topic;
   - the "Copy link" button copies the share page's address: a monster opened by its old slug gives the
     current slug's share page, a quest and an item theirs, the weapon page the type's share page with the
     open weapon, the changelog the day of its #d- anchor; an item without a share page (no sources) and
     the changelog without an anchor copy the page's own address;
   - on the hunter, guild and leaderboard pages (API data) it copies the API's share link
     (https://api.hvmhfz.eclipseforge.xyz/share/...; the API README's "Share links"): a hunter or guild by
     id, the board in the hash (no hash: this week's top hunters; old #guilds: Guild RP), the live Road's
     board; a past Road rotation and the hunter list copy the page's own address. The hunter profile's own
     "Copy profile link" copies the hunter's share link too;
   - the button fits beside the breadcrumbs at 375 px.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-share.js

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
    res.end(req.method === "HEAD" ? undefined : data);
  });
});

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };

const monsters = JSON.parse(fs.readFileSync(path.join(root, "data/monsters/index.json"), "utf8"));
const old = monsters.find((m) => m.oldSlug && m.oldSlug !== m.slug);
const quest = JSON.parse(fs.readFileSync(path.join(root, "data/quests.json"), "utf8")).quests[0];
const lance = JSON.parse(fs.readFileSync(path.join(root, "data/weapons/lance.json"), "utf8"));
const lanceId = lance.weapons[5][lance.fields.indexOf("id")];
const itemIds = fs.readdirSync(path.join(root, "data/items")).filter((f) => /^\d+\.json$/.test(f)).map((f) => parseInt(f, 10));
const itemWith = itemIds[0];
let itemWithout = 1;
while (itemIds.includes(itemWithout)) itemWithout += 1;
const changelog = fs.readFileSync(path.join(root, "changelog.html"), "utf8");
const day = /id="d-(\d{4}-\d\d-\d\d)"/.exec(changelog)[1];
const topic = new RegExp('href="#(d-' + day + '-[a-z0-9-]+)"').exec(changelog)[1];

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  // the pages also call the live API (quest stats, standings): answer nothing, quickly
  await context.route(/api\.hvmhfz\.eclipseforge\.xyz/, (route) => route.fulfill({ status: 404, body: "" }));

  async function lands(from, want) {
    const page = await context.newPage();
    await page.goto(base + from);
    await page.waitForURL((u) => u.pathname !== new URL(base + from).pathname, { timeout: 5000 }).catch(() => {});
    const got = page.url().replace(base, "");
    check("share page " + from + " opens " + want, got === want, "landed on " + got);
    await page.close();
  }

  async function copies(from, want, width) {
    const page = await context.newPage();
    if (width) await page.setViewportSize({ width, height: 800 });
    await page.goto(base + from);
    const button = page.locator("nav.breadcrumbs .share-copy");
    await button.waitFor({ timeout: 5000 }).catch(() => {});
    if (!(await button.count())) {
      check("Copy link on " + from, false, "no button");
      await page.close();
      return;
    }
    await button.click();
    await page.waitForFunction(() => document.querySelector(".share-copy").textContent === "Copied", null, { timeout: 5000 }).catch(() => {});
    const got = await page.evaluate(() => navigator.clipboard.readText());
    // a want with its own scheme is an address elsewhere (the API's share links), else a path on this site
    const full = /^https:/.test(want) ? want : base + want;
    check("Copy link on " + from + " copies " + want, got === full, "copied " + got);
    if (width) {
      const fits = await page.evaluate(() => {
        const b = document.querySelector(".share-copy").getBoundingClientRect();
        // only the button: the header's menu toggle already pokes past 375 px on every page
        return b.left >= 0 && b.right <= document.documentElement.clientWidth;
      });
      check("Copy link fits at " + width + " px on " + from, fits);
    }
    await page.close();
  }

  await lands("/s/monster/akantor.html", "/monster.html?m=akantor");
  await lands("/s/quest/" + quest.id + ".html", "/quest.html?id=" + quest.id);
  await lands("/s/weapon/lance.html?w=" + lanceId, "/weapons.html?type=lance&w=" + lanceId);
  await lands("/s/weapon/lance.html?w=1%26type%3Dbow&x=2", "/weapons.html?type=lance");
  await lands("/s/changelog/" + day + ".html#" + topic, "/changelog.html#" + topic);

  await copies("/monster.html?m=" + old.oldSlug, "/s/monster/" + old.slug + ".html");
  await copies("/monster.html?m=akantor", "/s/monster/akantor.html", 375);
  await copies("/quest.html?id=" + quest.id, "/s/quest/" + quest.id + ".html");
  await copies("/item.html?id=" + itemWith, "/s/item/" + itemWith + ".html");
  await copies("/item.html?id=" + itemWithout, "/item.html?id=" + itemWithout);
  await copies("/weapons.html?type=lance&w=" + lanceId, "/s/weapon/lance.html?w=" + lanceId);
  await copies("/changelog.html#" + topic, "/s/changelog/" + day + ".html#" + topic);
  await copies("/changelog.html", "/changelog.html");

  const share = "https://api.hvmhfz.eclipseforge.xyz/share";
  await copies("/hunters.html?id=42", share + "/hunter/42", 375);
  await copies("/hunters.html", "/hunters.html");
  await copies("/guilds.html?id=7", share + "/guild/7");
  await copies("/leaderboards.html", share + "/leaderboard/hunters/week");
  await copies("/leaderboards.html#guilds-lastmonth", share + "/leaderboard/guilds/lastmonth");
  await copies("/leaderboards.html#monsters-all", share + "/leaderboard/monsters/all");
  await copies("/leaderboards.html#guilds", share + "/leaderboard/rp");
  await copies("/leaderboards.html#road-solo", share + "/leaderboard/road/solo");
  await copies("/leaderboards.html#road-open-12", "/leaderboards.html#road-open-12");

  // the hunter profile's own button: a stand-in profile, since the live API is not called here
  {
    const page = await context.newPage();
    await page.route(/api\.hvmhfz\.eclipseforge\.xyz\/api\/public\/hunters\/42$/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ id: 42, name: "Test Hunter", hr: 7, gr: 100, weapon: "Lance", topMonsters: [], weaponTime: [] })
    }));
    await page.goto(base + "/hunters.html?id=42");
    const button = page.locator("button", { hasText: "Copy profile link" });
    await button.waitFor({ timeout: 5000 }).catch(() => {});
    if (await button.count()) {
      await button.click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Copied"),
        null, { timeout: 5000 }).catch(() => {});
      const got = await page.evaluate(() => navigator.clipboard.readText());
      check("Copy profile link copies " + share + "/hunter/42", got === share + "/hunter/42", "copied " + got);
    } else {
      check("Copy profile link on /hunters.html?id=42", false, "no button");
    }
    await page.close();
  }

  await browser.close();
  server.close();
  failures.forEach((f) => console.log("FAIL " + f));
  console.log(failures.length ? failures.length + " failure(s)" : "share links OK");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
