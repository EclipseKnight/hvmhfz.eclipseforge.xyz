#!/usr/bin/env node
/* Checks the account page's Transfer tab, the transfer wizard (js/account-transfer.js), in headless Chromium
   against a fake API with POST /api/account/characters/import-new[/preview] (hvmhfz_rest_api README
   "Character import") and the Backups tab's endpoints:

   - API without import-new (Spring's 404): "The transfer wizard is coming soon", no error;
   - signed out: account.html#transfer goes to the sign-in with ?next=/account.html#transfer and its note;
     "Use another account" signs out and goes there too;
   - step 1 shows the signed-in account; steps open one by one;
   - our backup zip as a new character: the preview body has no characterId, step 3 shows "A new character",
     slot and parts "new", step 4 has the new character checked, Confirm sends exactly the previewed body to
     import-new, step 6 says it is on the account and links /play.html, the Backups history says "as a new
     character";
   - an older zip into a character already on the account: its own preview with the red "less play" alert,
     Confirm sends the import with the characterId;
   - a bare savedata file and an export JSON: read and sent as such;
   - refusals: a full account (new character off, an existing one still possible), a file without a save,
     part checks (stops at step 3), not a readable file; Start over;
   - no page errors, no sideways scroll at 375 px.

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-transfer.js
     SHOTS=<folder> ... also saves screenshots there (1280 and 375 px wide).

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Files = require("../js/backup-file.js");

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

const jwt = (claims) => "e30." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".x";
const TOKEN = jwt({ sub: "tester", exp: 4102444800 }); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const b64 = (s) => Buffer.from(s, "binary").toString("base64");

const CHARACTERS = [
  { id: 10, name: "Aldra", hr: 999, gr: 120, lastLogin: "2026-11-02T10:00:00Z" },
  { id: 11, name: "Bexo", hr: 7, gr: 0, lastLogin: null }
];
const MANIFEST = JSON.stringify({ format: "hvmhfz-backup/1", server: "hunsterverse", clientMode: "ZZ", characterId: 3,
  accountId: 9, name: "Rook", exportedAt: "2026-11-03T20:00:00Z", parts: [], tower: null });
const OUR_ZIP = Files.zip([{ name: "savedata.bin", data: new TextEncoder().encode("SAVE") },
  { name: "rengokudata.bin", data: new TextEncoder().encode("R".repeat(95)) },
  { name: "manifest.json", data: new TextEncoder().encode(MANIFEST) },
  { name: "manifest.sig", data: new TextEncoder().encode("ab12") }]);
const OLD_ZIP = Files.zip([{ name: "Hunter/2026-10-23_savedata.bin", data: new TextEncoder().encode("old") }]);
const CMP = Buffer.concat([Buffer.from("cmp 20110113   \x00", "binary"), Buffer.from([1, 2, 0, 5])]);

const facts = (name, play, hunts) => ({ name, female: false, zenny: 5000, hr: 999, grp: 593400, roadSp: 12,
  equippedRoadSkills: 1, migrationFlagSet: true, playtimeSeconds: play, huntCount: hunts });

/* The API's answer for an import into a new character (README "Character import", new character). */
function newPlan(body, applied) {
  const parts = body.parts ? Object.keys(body.parts) : ["savedata", "skin_hist"];
  return {
    applied, importId: applied ? 77 : null, importedAt: applied ? "2026-11-04T21:00:00Z" : null,
    characterId: applied ? 500 : 0, characterName: "Rook", accountId: 2,
    source: body.erupeExport ? "erupe-export" : body.manifest ? "ours-other-character" : "foreign", sourceNote: "note",
    manifest: body.manifest ? { format: "hvmhfz-backup/1", server: "hunsterverse", characterId: 3, name: "Rook", exportedAt: "2026-11-03T20:00:00Z" } : null,
    parts: parts.map((p) => ({ part: p, action: "new", oldSize: null, oldSha256: null, newSize: 20482, newSha256: "b", fileSha256: "b" })),
    ignored: [], save: { before: null, after: facts("Rook", 36000, 300), migrationFlagWasSet: false, olderBySeconds: 0 },
    roadSkills: { policy: "clear", reason: "r", towerRowExists: false, before: null, after: null, levelsBefore: 0, levelsAfter: 0 },
    notRestored: ["warehouse"],
    newCharacter: { charactersBefore: 2, maxCharacters: 16, female: false, hr: 999, gr: 100, weaponType: 7, weaponId: 4660 }
  };
}

/* The answer for an import into Aldra (id 10): the file has 7 hours less play. */
function oldPlan(body, applied) {
  return {
    applied, importId: applied ? 78 : null, importedAt: applied ? "2026-11-04T21:00:00Z" : null,
    characterId: 10, characterName: "Aldra", accountId: 2, source: "foreign", sourceNote: "note", manifest: null,
    parts: [{ part: "savedata", action: "replace", oldSize: 20480, oldSha256: "a", newSize: 20482, newSha256: "b", fileSha256: "b" }],
    ignored: [], save: { before: facts("Aldra", 4707602, 14312), after: facts("Aldra", 4682392, 14266), migrationFlagWasSet: true, olderBySeconds: 25210 },
    roadSkills: { policy: "clear", reason: "r", towerRowExists: true, before: "5,3", after: "0,0", levelsBefore: 8, levelsAfter: 0 },
    notRestored: ["warehouse"], newCharacter: null
  };
}

/* A page with the fake API. o.missing: no import-new endpoints (Spring's 404); o.full: the account is full;
   o.signedOut: no saved sign-in. Records every import call with its body. */
async function open(browser, o, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  const history = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (!o.signedOut) await page.addInitScript((t) => { if (!sessionStorage.getItem("signed-out")) localStorage.setItem("hvmhfz.token", t); }, TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS,
      body: body === undefined ? "" : JSON.stringify(body) });
    const refuse = (status, message, problems) => reply(status, { message, problems: problems || [] });
    if (/^\/api\/account\/characters\/(import(-new)?(\/preview)?)$/.test(p)) {
      const body = JSON.parse(req.postData());
      calls.push({ path: p, body });
      if (p.includes("import-new")) {
        if (o.missing) return reply(404, { timestamp: "2026-11-04T21:00:00Z", status: 404, error: "Not Found", path: p });
        if (o.full) return refuse(409, "This account already has 16 characters, the most the game shows is 16: delete one in the game, or import into one of them.");
        if (body.parts && !body.parts.savedata) return refuse(400, "A new character needs the save (savedata): this file has only other parts.");
        if (body.parts && body.parts.platebox) return refuse(400, "The file can't be imported.", ["platebox: is not nullcomp-compressed"]);
        const answer = newPlan(body, !p.endsWith("/preview"));
        if (answer.applied) history.unshift({ id: 77, at: answer.importedAt, endpoint: "web-new", characterId: 500,
          characterName: "Rook", source: answer.source, skillsPolicy: "clear", undoneAt: null, parts: [{ part: "savedata", oldSize: null, newSize: 20482 }] });
        return reply(200, answer);
      }
      if (body.characterId === 11) return refuse(409, "This character is online: log out first.");
      return reply(200, oldPlan(body, !p.endsWith("/preview")));
    }
    if (p === "/api/account") return reply(200, { name: "tester", roles: ["ROLE_USER"], characters: CHARACTERS.length, lastLogin: null });
    if (p === "/api/account/characters") return reply(200, CHARACTERS);
    if (p === "/api/account/discord") return reply(200, { linked: true });
    if (p === "/api/account/characters/imports") return reply(200, history);
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
  return { ctx, page, errors, calls };
}

const text = (page, sel) => page.innerText(sel).then((t) => (t || "").replace(/\s+/g, " ").trim());
const visible = (page, sel) => page.isVisible(sel);
const shown = async (page) => (await page.$$eval("#transfer-steps > li", (lis) => lis.filter((li) => !li.hidden).map((li) => li.id.replace("wz-", "")))).join(",");

async function choose(page, name, bytes, mime) {
  await page.setInputFiles("#wz-file-input", { name, mimeType: mime || "application/zip", buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => !/^Reading /.test(document.getElementById("wz-file-note").textContent), null, { timeout: 5000 });
}

/* After a file: wait until step 3 has an answer (a plan or a refusal). */
async function previewed(page) {
  await page.waitForFunction(() => document.getElementById("wz-preview-body").childNodes.length > 0 ||
    !document.getElementById("wz-preview-alert").hidden, null, { timeout: 5000 }).catch(() => {});
}

async function missing(browser, base) {
  const r = await open(browser, { missing: true });
  await r.page.goto(base + "/account.html#transfer");
  await choose(r.page, "rook.zip", OUR_ZIP);
  await r.page.waitForSelector("#transfer-soon:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("404: coming soon", (await visible(r.page, "#transfer-soon")) && !(await visible(r.page, "#transfer-steps")));
  check("404: page errors", r.errors.length === 0, r.errors.join("; "));
  await r.ctx.close();
}

async function signedOut(browser, base) {
  const r = await open(browser, { signedOut: true });
  await r.page.goto(base + "/account.html#transfer");
  await r.page.waitForURL(/\/\?next=/, { timeout: 5000 }).catch(() => {});
  check("signed out: to the sign-in with next", r.page.url() === base + "/?next=%2Faccount.html%23transfer#login-form", r.page.url());
  await r.page.waitForSelector("#login-next:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("signed out: the note", (await text(r.page, "#login-next")) === "Sign in, or create an account, to bring your character over.",
    await text(r.page, "#login-next").catch(() => "none"));
  await r.ctx.close();

  // "Use another account": sign out, then the same sign-in
  const s = await open(browser, {});
  await s.page.goto(base + "/account.html#transfer");
  await s.page.waitForSelector("#wz-file:not([hidden])", { timeout: 5000 }).catch(() => {});
  await s.page.evaluate(() => sessionStorage.setItem("signed-out", "1"));
  await s.page.click("#wz-switch");
  await s.page.waitForURL(/\/\?next=/, { timeout: 5000 }).catch(() => {});
  check("switch account: to the sign-in", s.page.url() === base + "/?next=%2Faccount.html%23transfer#login-form", s.page.url());
  check("switch account: signed out", (await s.page.evaluate(() => localStorage.getItem("hvmhfz.token"))) === null);
  await s.ctx.close();
}

async function flows(browser, base, shots) {
  const r = await open(browser, {});
  const page = r.page;
  await page.goto(base + "/account.html#transfer");
  await page.waitForSelector("#wz-file:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("start: tab shown", await visible(page, "#panel-transfer"));
  check("start: account step", /Signed in as tester/.test(await text(page, "#wz-account")), await text(page, "#wz-account"));
  check("start: steps 1 and 2 only", (await shown(page)) === "account,file", await shown(page));

  // our backup zip as a new character
  await choose(page, "rook.zip", OUR_ZIP);
  await previewed(page);
  check("our zip: note", /Our backup zip \(with its manifest\), 2 parts: Rook \(id 3\)/.test(await text(page, "#wz-file-note")),
    await text(page, "#wz-file-note"));
  const pv = r.calls.filter((c) => c.path === "/api/account/characters/import-new/preview").pop();
  check("our zip: preview body", pv && !("characterId" in pv.body) && pv.body.manifest === MANIFEST && pv.body.signature === "ab12"
    && Object.keys(pv.body.parts).join() === "savedata,rengokudata", JSON.stringify(pv && Object.keys(pv.body)));
  const p3 = await text(page, "#wz-preview");
  check("step 3: a new character", /A new character: Rook, slot 3 of 16 on your account/.test(p3), p3);
  check("step 3: copy of another character", /The new character is a copy of it/.test(p3), p3);
  check("step 3: parts new", /none/.test(p3) && /20,482 bytes/.test(p3) && / new/.test(p3), p3);
  check("step 3: no levels", /Road skill levels: none\. A new character starts without them/.test(p3), p3);
  check("step 3: no less-play alert", (await page.$$("#wz-preview .backup-alert")).length === 0);
  check("step 4: new checked", await page.isChecked("#wz-target-new"));
  check("step 4: label", /A new character, Rook \(slot 3 of 16\)/.test(await text(page, "#wz-target")), await text(page, "#wz-target"));
  check("step 5: shown with confirm", (await shown(page)) === "account,file,preview,target,confirm" && await visible(page, "#wz-confirm-btn"),
    await shown(page));
  check("step 5: says what happens", /Make Rook a new character on your account/.test(await text(page, "#wz-confirm")));
  check("steps: states", (await page.getAttribute("#wz-file", "data-state")) === "done"
    && (await page.getAttribute("#wz-confirm", "data-state")) === "current");
  if (shots) await page.screenshot({ path: path.join(shots, "transfer-new-1280.png"), fullPage: true });
  check("no import before confirm", !r.calls.some((c) => c.path === "/api/account/characters/import-new"));
  await page.click("#wz-confirm-btn");
  await page.waitForSelector("#wz-done:not([hidden])", { timeout: 5000 }).catch(() => {});
  const made = r.calls.filter((c) => c.path === "/api/account/characters/import-new");
  check("confirm: one import, the previewed body", made.length === 1 && JSON.stringify(made[0].body) === JSON.stringify(pv.body));
  const done = await text(page, "#wz-done");
  check("done: message", /Rook is on your account now as a new character \(id 500\)\. Import #77/.test(done), done);
  check("done: who and hunter", /log in as tester and pick Rook/.test(done), done);
  check("done: play link", (await page.getAttribute("#wz-play", "href")) === "/play.html" && /Now install and play/.test(await page.textContent("#wz-play")));
  check("done: confirm gone", !(await visible(page, "#wz-confirm-btn")));
  await page.click("#tab-backups");
  await page.waitForFunction(() => /new character/.test(document.getElementById("import-history").textContent), null, { timeout: 5000 }).catch(() => {});
  check("backups history: as a new character", /Rook \(id 500\)/.test(await text(page, "#import-history"))
    && /website, as a new character/.test(await text(page, "#import-history")), await text(page, "#import-history"));
  await page.click("#tab-transfer");

  // an older zip into a character on the account
  await page.click("#wz-again");
  check("again: back to step 2", (await shown(page)) === "account,file" && (await page.inputValue("#wz-file-input")) === "");
  await choose(page, "old.zip", OLD_ZIP);
  await previewed(page);
  check("old zip: note", /Save files without a manifest/.test(await text(page, "#wz-file-note")));
  await page.selectOption("#wz-character", "10");
  await page.waitForSelector("#wz-confirm-btn:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("existing: old option checked", await page.isChecked("#wz-target-old"));
  const p5 = await text(page, "#wz-confirm");
  check("existing: its preview", /Into Aldra \(id 10\)/.test(p5) && /replaces the save of a character you have now/.test(p5), p5);
  const alertText = await page.$$eval("#wz-confirm .backup-alert li", (t) => t.map((x) => x.textContent));
  check("existing: less-play alert first", alertText[0] === "This file has 7 hours less play than your character now. Importing it will lose that progress.",
    JSON.stringify(alertText));
  if (shots) await page.screenshot({ path: path.join(shots, "transfer-existing-1280.png"), fullPage: true });
  const pe = r.calls.filter((c) => c.path === "/api/account/characters/import/preview").pop();
  await page.click("#wz-confirm-btn");
  await page.waitForSelector("#wz-done:not([hidden])", { timeout: 5000 }).catch(() => {});
  const imp = r.calls.filter((c) => c.path === "/api/account/characters/import");
  check("existing: import with the previewed body", imp.length === 1 && imp[0].body.characterId === 10 && JSON.stringify(imp[0].body) === JSON.stringify(pe.body));
  check("existing: done", /Imported into Aldra \(id 10\)/.test(await text(page, "#wz-done")), await text(page, "#wz-done"));

  // an online character: refusal, no confirm
  await page.click("#wz-again");
  await choose(page, "old.zip", OLD_ZIP);
  await previewed(page);
  await page.selectOption("#wz-character", "11");
  await page.waitForSelector("#wz-confirm-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("online: plain words", /in the game right now/.test(await text(page, "#wz-confirm-alert")), await text(page, "#wz-confirm-alert"));
  check("online: no confirm", !(await visible(page, "#wz-confirm-btn")));
  // back to the new character: its confirm again
  await page.check("#wz-target-new");
  check("back to new: confirm", (await visible(page, "#wz-confirm-btn")) && !(await visible(page, "#wz-confirm-alert")));

  // a bare savedata file and an export JSON
  await page.click("#wz-restart");
  check("start over: step 2", (await shown(page)) === "account,file");
  await choose(page, "savedata.bin", CMP, "application/octet-stream");
  await previewed(page);
  check("bare: note", /A single save file, not in a zip, 1 part/.test(await text(page, "#wz-file-note")), await text(page, "#wz-file-note"));
  const pb = r.calls.filter((c) => c.path === "/api/account/characters/import-new/preview").pop();
  check("bare: body", Object.keys(pb.body.parts).join() === "savedata" && pb.body.parts.savedata === CMP.toString("base64"));
  await choose(page, "export.json", Buffer.from(JSON.stringify({ Character: { savedata: b64("x") } })), "application/json");
  await previewed(page);
  const pj = r.calls.filter((c) => c.path === "/api/account/characters/import-new/preview").pop();
  check("export: body", pj.body.erupeExport && !pj.body.parts);
  check("export: source", /newer Erupe server/.test(await text(page, "#wz-preview")));

  // a file without a save: no new character, an existing one still possible
  await choose(page, "plates.zip", Files.zip([{ name: "rengokudata.bin", data: new Uint8Array(95) }]));
  await previewed(page);
  check("no save: plain words", /no save \(savedata\), so it can't become a new character/.test(await text(page, "#wz-preview-alert")),
    await text(page, "#wz-preview-alert"));
  check("no save: new off, existing on", (await page.isDisabled("#wz-target-new")) && (await page.isChecked("#wz-target-old"))
    && await visible(page, "#wz-target"));

  // part checks fail: stop at step 3
  await choose(page, "bad.zip", Files.zip([{ name: "savedata.bin", data: new Uint8Array(4) }, { name: "platebox.bin", data: new Uint8Array(4) }]));
  await previewed(page);
  check("bad parts: problems listed", /can't be imported.*platebox: is not nullcomp-compressed/.test(await text(page, "#wz-preview-alert")));
  check("bad parts: stops at step 3", (await shown(page)) === "account,file,preview", await shown(page));

  // not a readable file
  await choose(page, "photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");
  check("not a file: note", /not a zip we can read/.test(await text(page, "#wz-file-note"))
    && (await page.getAttribute("#wz-file-note", "class")).includes("bad"));
  check("not a file: step 2 only", (await shown(page)) === "account,file", await shown(page));
  check("flows: page errors", r.errors.length === 0, r.errors.join("; "));
  await r.ctx.close();

  // a full account
  const f = await open(browser, { full: true });
  await f.page.goto(base + "/account.html#transfer");
  await f.page.waitForSelector("#wz-file:not([hidden])", { timeout: 5000 }).catch(() => {});
  await choose(f.page, "rook.zip", OUR_ZIP);
  await previewed(f.page);
  check("full: plain words", /already has 16 characters, the most the game shows/.test(await text(f.page, "#wz-preview-alert")),
    await text(f.page, "#wz-preview-alert"));
  check("full: new off", (await f.page.isDisabled("#wz-target-new")) && /not possible/.test(await text(f.page, "#wz-target")));
  await f.page.selectOption("#wz-character", "10");
  await f.page.waitForSelector("#wz-confirm-btn:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("full: an existing character still works", await visible(f.page, "#wz-confirm-btn"));
  check("full: page errors", f.errors.length === 0, f.errors.join("; "));
  await f.ctx.close();

  // phones: no sideways scroll
  const s = await open(browser, {}, 375);
  await s.page.goto(base + "/account.html#transfer");
  await s.page.waitForSelector("#wz-file:not([hidden])", { timeout: 5000 }).catch(() => {});
  await choose(s.page, "rook.zip", OUR_ZIP);
  await previewed(s.page);
  await s.page.waitForSelector("#wz-confirm-btn:not([hidden])", { timeout: 5000 }).catch(() => {});
  const wide = await s.page.evaluate(() => document.documentElement.scrollWidth);
  check("375 px: no sideways scroll", wide <= 375, String(wide));
  if (shots) await s.page.screenshot({ path: path.join(shots, "transfer-new-375.png"), fullPage: true });
  check("375 px: page errors", s.errors.length === 0, s.errors.join("; "));
  await s.ctx.close();
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const shots = process.env.SHOTS || "";
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  try {
    await missing(browser, base);
    await signedOut(browser, base);
    await flows(browser, base, shots);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("transfer wizard OK");
})().catch((e) => { console.error(e); process.exit(1); });
