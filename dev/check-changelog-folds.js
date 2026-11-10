#!/usr/bin/env node
/* Checks the changelog's drop-downs (details.cl-fold, js/changelog-folds.js) in headless Chromium at 375x667 and 1280x800:
   the newest 3 days and their month are open and every older day and month is closed; a link to an older day, to a topic of
   it and to a month opens the folds around it and scrolls it into view (on load, on a hash change, and from the contents,
   also when the hash is already the page's); a closed summary opens with the keyboard (Enter and Space); Expand all and
   Collapse all work; nothing in the changelog sticks out of the screen. Needs Playwright with Chromium, which the site itself does not use:

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-changelog-folds.js
     SHOTS=dev-shots NODE_PATH=... node dev/check-changelog-folds.js   (also saves screenshots)

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
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

// the fold of an id is open, and the element is inside the viewport (below the sticky bar)
const state = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  if (!el) return { missing: true };
  let hidden = false;
  for (let n = el.parentElement; n; n = n.parentElement) if (n.tagName === "DETAILS" && !n.open) hidden = true;
  const r = el.getBoundingClientRect();
  return { hidden, top: r.top, inView: !hidden && r.top < innerHeight && r.bottom > 0 };
}, id);

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/changelog.html";
  const browser = await chromium.launch();
  if (shots) fs.mkdirSync(shots, { recursive: true });
  for (const [w, h] of [[375, 667], [1280, 800]]) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, reducedMotion: "reduce" });
    await context.addInitScript(() => localStorage.setItem("hvmhfz.consent", JSON.stringify({ choice: "declined", at: new Date().toISOString() })));
    await context.route("**/*", (r) => (r.request().url().startsWith("http://127.0.0.1") ? r.continue() : r.abort()));
    const tag = `${w}x${h}`;
    const open = async (page, id) => (await page.evaluate((i) => document.getElementById(i).closest("details").open, id));

    // 1. the starting state
    let page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    const days = await page.evaluate(() => [...document.querySelectorAll("section.cl-day")].map((d) => [d.id, d.closest("details").open]));
    check(days.length >= 4, `${tag}: expected several days, got ${days.length}`);
    check(days.every(([, o], i) => o === (i < 3)), `${tag}: only the newest 3 days should be open: ${JSON.stringify(days.map((d) => +d[1]))}`);
    const months = await page.evaluate(() => [...document.querySelectorAll("section.cl-month")].map((m) => [m.id, m.closest("details").open]));
    check(months[0][1] === true && months.slice(1).every((m) => !m[1]), `${tag}: only the newest month should be open: ${JSON.stringify(months)}`);
    // (the page itself is 392px wide at 375 even before the folds; only the changelog's own content is checked)
    check(await page.evaluate(() => [...document.querySelectorAll("main .cl-fold, main .cl-fold *")].every((e) => !e.offsetParent || e.getBoundingClientRect().right <= innerWidth + 1)),
      `${tag}: a change sticks out of the screen`);
    const oldMonth = months[months.length - 1][0];
    const oldDay = days[days.length - 1][0];
    const midDay = days[3][0];
    if (shots) await page.screenshot({ path: `${shots}/${tag}-top.png` });

    // 2. keyboard: Tab to a closed summary, Enter and Space toggle it
    const summary = page.locator(`details:has(> #${midDay}) > summary`);
    await summary.focus();
    check(await page.evaluate(() => document.activeElement.tagName === "SUMMARY"), `${tag}: a summary cannot take focus`);
    await page.keyboard.press("Enter");
    check(await open(page, midDay), `${tag}: Enter did not open ${midDay}`);
    await page.keyboard.press("Space");
    check(!(await open(page, midDay)), `${tag}: Space did not close ${midDay}`);
    check((await summary.evaluate((s) => s.getBoundingClientRect().height)) >= 43.5, `${tag}: a summary is under 44px tall`);

    // 3. the contents open the fold: a day of the closed month, the month, and the same link twice
    await page.click(`.cl-toc a[href="#${oldDay}"]`);
    await page.waitForTimeout(150);
    let s = await state(page, oldDay);
    check(!s.hidden && s.inView, `${tag}: the contents link to ${oldDay} did not open and show it: ${JSON.stringify(s)}`);
    if (shots) await page.screenshot({ path: `${shots}/${tag}-toc-day.png` });
    await page.evaluate((i) => { document.getElementById(i).closest("details").open = false; }, oldDay);
    await page.click(`.cl-toc a[href="#${oldDay}"]`); // the hash is the same: no hashchange, the click handler must open it
    await page.waitForTimeout(150);
    s = await state(page, oldDay);
    check(!s.hidden, `${tag}: the same contents link a second time did not reopen ${oldDay}`);
    await page.evaluate(() => document.querySelectorAll("details.cl-fold").forEach((d) => { d.open = false; }));
    await page.click(`.cl-toc a[href="#${oldMonth}"]`);
    await page.waitForTimeout(150);
    s = await state(page, oldMonth);
    check(!s.hidden && s.inView, `${tag}: the contents link to ${oldMonth} did not open it: ${JSON.stringify(s)}`);
    await page.close();

    // 4. a shared link on load: a day, and a topic of the oldest day
    const topic = await (async () => {
      const p = await context.newPage();
      await p.goto(base, { waitUntil: "load" });
      const t = await p.evaluate((d) => document.querySelector(`#${d} .cl-topic`).id, oldDay);
      await p.close();
      return t;
    })();
    for (const id of [midDay, oldDay, topic]) {
      page = await context.newPage();
      await page.goto(`${base}#${id}`, { waitUntil: "load" });
      await page.waitForTimeout(150);
      s = await state(page, id);
      check(!s.hidden && s.inView, `${tag}: opening ...#${id} did not show it: ${JSON.stringify(s)}`);
      const dayOpen = await open(page, id.slice(0, 12));
      check(dayOpen, `${tag}: ...#${id}: its day is closed`);
      const stillClosed = await page.evaluate((d) => [...document.querySelectorAll("section.cl-day")].filter((x) => x.id !== d && !x.closest("details").open).length, id.slice(0, 12));
      check(stillClosed >= 1, `${tag}: ...#${id} opened more than it should`);
      if (shots && id === topic) await page.screenshot({ path: `${shots}/${tag}-anchor-topic.png` });
      // 5. a hashchange on the open page
      if (id === oldDay) {
        await page.evaluate((d) => { document.getElementById(d).closest("details").open = false; }, oldDay);
        await page.evaluate((i) => { location.hash = i; }, midDay);
        await page.waitForTimeout(150);
        check(!(await state(page, midDay)).hidden, `${tag}: a hash change to ${midDay} did not open it`);
      }
      await page.close();
    }

    // 6. Expand all and Collapse all
    page = await context.newPage();
    await page.goto(base, { waitUntil: "load" });
    await page.click("text=Expand all");
    check(await page.evaluate(() => [...document.querySelectorAll("details.cl-fold")].every((d) => d.open)), `${tag}: Expand all left a fold closed`);
    await page.click("text=Collapse all");
    check(await page.evaluate(() => [...document.querySelectorAll("details.cl-fold")].every((d) => !d.open)), `${tag}: Collapse all left a fold open`);
    if (shots) await page.screenshot({ path: `${shots}/${tag}-collapsed.png` });
    await page.close();
    await context.close();
  }
  await browser.close();
  server.close();
  if (problems.length) {
    problems.forEach((p) => console.log("FAIL " + p));
    process.exit(1);
  }
  console.log("changelog folds OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
