#!/usr/bin/env node
/* Checks the account page's Backups tab (js/account-backup.js) in headless Chromium against a fake API
   with the account endpoints of docs/character-backup-web.md:

   - API without them (404 everywhere): "Backups on the website are coming soon", no error, no table, and the
     "What is in your backup" text;
   - the character list (id, name, HR, GR, last login); Download backup saves a zip the import reads back;
     a 503 says backups are switched off;
   - import our zip: Preview shows the target, the parts, the save before/after and that Road skill levels
     are restored; Cancel writes nothing; Confirm sends exactly the previewed body (no Discord id) and the
     history shows the import;
   - an older zip: a red alert first ("N hours less play than your character now", and the Road skill
     levels cleared), play time and monsters hunted before/after, Confirm kept; no alert for a file with
     the same play; an export JSON;
   - refusals in plain words: online, deleted, never played, a part that fails the checks (each problem
     listed), not a zip; and a 404 in the middle of a preview switches to "coming soon".

     NODE_PATH=/root/work/pw-tools/node_modules node dev/check-account-backup.js
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

const jwt = (exp) => "e30." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".x";
const TOKEN = jwt(4102444800); // 2100
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const b64 = (s) => Buffer.from(s, "binary").toString("base64");

const CHARACTERS = [
  { id: 10, name: "Aldra", hr: 999, gr: 120, lastLogin: "2026-11-02T10:00:00Z" },
  { id: 11, name: "Bexo", hr: 7, gr: 0, lastLogin: null },
  { id: 12, name: "Cira", hr: 300, gr: 0, lastLogin: "2026-11-03T20:00:00Z" },
  { id: 13, name: "Dov", hr: 1, gr: 0, lastLogin: null },
  { id: 14, name: "Eno", hr: 0, gr: 0, lastLogin: null }
];
const MANIFEST = JSON.stringify({ format: "hvmhfz-backup/1", server: "hunsterverse", clientMode: "ZZ", characterId: 10,
  accountId: 2, name: "Aldra", exportedAt: "2026-11-03T20:00:00Z", parts: [], tower: { skills: "5,3", tr: 0, trp: 0, tsp: 0 } });
const BACKUP = { manifest: MANIFEST, signature: "ab12", parts: { savedata: b64("SAVE"), rengokudata: b64("R".repeat(95)) } };

/* The API's answer to a preview or import, as the README shows it. */
function plan(body, applied) {
  const ours = body.manifest === MANIFEST && body.signature === "ab12";
  const ch = CHARACTERS.find((c) => c.id === body.characterId);
  const partNames = body.parts ? Object.keys(body.parts) : ["savedata"];
  return {
    applied, importId: applied ? 42 : null, importedAt: applied ? "2026-11-03T21:00:00Z" : null,
    characterId: ch.id, characterName: ch.name, accountId: 2,
    source: body.erupeExport ? "erupe-export" : ours ? "ours-verified" : "foreign", sourceNote: "note",
    manifest: ours ? { format: "hvmhfz-backup/1", server: "hunsterverse", characterId: 10, name: "Aldra", exportedAt: "2026-11-03T20:00:00Z" } : null,
    parts: partNames.map((p) => ({ part: p, action: "replace", oldSize: 20480, oldSha256: "a", newSize: 20482, newSha256: "b", fileSha256: "b" })),
    ignored: body.erupeExport ? [{ part: "gacha_items", reason: "gacha prizes the server holds" }] : [],
    save: { before: { name: "Aldra", female: false, zenny: 1000, hr: 999, grp: 5, roadSp: 40, equippedRoadSkills: 3, migrationFlagSet: true,
                      playtimeSeconds: 4707602, huntCount: 14312 },
            after: { name: ours ? "Aldra" : "Other", female: false, zenny: 99999, hr: 999, grp: 5, roadSp: 80, equippedRoadSkills: 2, migrationFlagSet: true,
                     playtimeSeconds: ours ? 4707602 : 4682392, huntCount: ours ? 14312 : 14266 },
            migrationFlagWasSet: true, olderBySeconds: ours ? 0 : 25210 },
    roadSkills: ours ? { policy: "restore", reason: "r", towerRowExists: true, before: "5,3", after: "5,3", levelsBefore: 8, levelsAfter: 8 }
                     : { policy: "clear", reason: "r", towerRowExists: true, before: "5,3", after: "0,0", levelsBefore: 8, levelsAfter: 0 },
    notRestored: ["warehouse", "the account's shared item box"]
  };
}

/* A signed-in account page with the fake API. o.missing: the API has no backup endpoints (Spring's 404);
   o.previewMissing: only the preview answers 404. Records every backup call with its body. */
async function open(browser, o, width) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: width || 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  const history = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem("hvmhfz.token", t), TOKEN);
  await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
  await page.route("https://api.hvmhfz.eclipseforge.xyz/**", (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const p = url.pathname;
    const reply = (status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS,
      body: body === undefined ? "" : JSON.stringify(body) });
    const springMissing = () => reply(404, { timestamp: "2026-11-03T21:00:00Z", status: 404, error: "Not Found", path: p });
    const isBackup = /^\/api\/account\/characters\/(\d+\/backup|import(\/preview)?|imports)$/.test(p);
    if (isBackup) {
      let body = null;
      try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = "unparsable"; }
      calls.push({ method: req.method(), path: p + url.search, body });
      if (o.missing) return springMissing();
    }
    if (p === "/api/account") return reply(200, { name: "tester", roles: ["ROLE_USER"], characters: CHARACTERS.length, lastLogin: null });
    if (p === "/api/account/characters") return reply(200, CHARACTERS);
    if (p === "/api/account/discord") return reply(200, { linked: true });
    if (p === "/api/account/characters/imports") return reply(200, history);
    const backup = p.match(/^\/api\/account\/characters\/(\d+)\/backup$/);
    if (backup) {
      if (backup[1] === "10") return reply(200, BACKUP);
      return reply(503, { message: "Backups are off: hvmhfz.character-transfer.hmac-secret is not set on the API.", problems: [] });
    }
    if (p === "/api/account/characters/import/preview" || p === "/api/account/characters/import") {
      if (o.previewMissing) return springMissing();
      const body = JSON.parse(req.postData());
      const refuse = (status, message, problems) => reply(status, { message, problems: problems || [] });
      if (body.characterId === 12) return refuse(409, "This character is online: log out first.");
      if (body.characterId === 13) return refuse(409, "This character is deleted.");
      if (body.characterId === 14) return refuse(409, "This character was never played: log in with it once first (the game would replace the import).");
      if (body.characterId === 11) return refuse(400, "The file can't be imported.", ["savedata: expands to 114820 bytes; a ZZ save expands to 150820", "rengokudata: 94 bytes; it must be 95"]);
      const answer = plan(body, p.endsWith("/import"));
      if (answer.applied) history.unshift({ id: 42, at: answer.importedAt, endpoint: "web", characterId: 10, characterName: "Aldra",
        source: answer.source, skillsPolicy: answer.roadSkills.policy, undoneAt: null, parts: answer.parts.map((x) => ({ part: x.part, oldSize: x.oldSize, newSize: x.newSize })) });
      return reply(200, answer);
    }
    if (p.startsWith("/api/public/")) return reply(200, []);
    return reply(200, p.endsWith("/distributions") ? { global: [], targeted: [] } : []);
  });
  return { ctx, page, errors, calls };
}

const text = (page, sel) => page.innerText(sel).then((t) => (t || "").replace(/\s+/g, " ").trim());
const visible = (page, sel) => page.isVisible(sel);

async function choose(page, name, bytes, mime) {
  await page.setInputFiles("#import-file", { name, mimeType: mime || "application/zip", buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => !/^Reading /.test(document.getElementById("import-file-note").textContent), null, { timeout: 5000 });
}

async function previewInto(page, id) {
  await page.selectOption("#import-target", String(id));
  await page.click("#import-preview-btn");
  await page.waitForSelector("#import-preview:not([hidden])", { timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById("import-preview-btn").disabled, null, { timeout: 5000 });
}

async function missing(browser, base) {
  const r = await open(browser, { missing: true });
  await r.page.goto(base + "/account.html#backups");
  await r.page.waitForSelector("#backup-soon:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("404: coming soon shown", await visible(r.page, "#backup-soon"));
  check("404: coming soon text", /Backups on the website are coming soon/.test(await text(r.page, "#backup-soon")));
  check("404: no table or errors", !(await visible(r.page, "#backup-live")) && !(await visible(r.page, "#account-error")));
  check("404: what is in your backup", /does not hold what the server keeps/.test(await text(r.page, "#backup-about")));
  check("404: only the probe asked", r.calls.length === 1 && r.calls[0].path.startsWith("/api/account/characters/imports"),
    JSON.stringify(r.calls));
  check("404: page errors", r.errors.length === 0, r.errors.join("; "));
  await r.ctx.close();
}

async function flows(browser, base, shots) {
  const r = await open(browser, {});
  const page = r.page;
  await page.goto(base + "/account.html#backups");
  await page.waitForSelector("#backup-live:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("live: panel shown, soon hidden", (await visible(page, "#backup-live")) && !(await visible(page, "#backup-soon")));
  const rows = await page.$$eval("#backup-characters tr", (trs) => trs.map((tr) => [...tr.cells].slice(0, 4).map((td) => td.textContent)));
  check("live: character list", JSON.stringify(rows[0]) === JSON.stringify(["Aldra", "10", "HR999 (HR7)", "120"]) && rows.length === 5 &&
    rows[2][2] === "HR300 (HR5)" && rows[3][2] === "HR1 (HR1)" && rows[4][2] === "0",
    JSON.stringify(rows));
  const sortKeys = await page.$$eval("#backup-characters tr", (trs) => trs.map((tr) => tr.cells[2].dataset.sort));
  check("live: HR column sorts by the stored number", JSON.stringify(sortKeys) === JSON.stringify(["999", "7", "300", "1", "0"]),
    JSON.stringify(sortKeys));
  check("live: empty history", /No imports on this account yet/.test(await text(page, "#import-history")));

  // download
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 5000 }),
    page.click('#backup-characters tr[data-character="10"] .backup-download')]);
  const name = download.suggestedFilename();
  check("download: file name", /^Aldra_10_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.zip$/.test(name), name);
  const saved = fs.readFileSync(await download.path());
  const read = await Files.readImportFile(name, new Uint8Array(saved));
  check("download: reads back as our backup", read.kind === "backup" && read.body.manifest === MANIFEST
    && read.body.signature === "ab12" && read.body.parts.savedata === BACKUP.parts.savedata);
  await page.click('#backup-characters tr[data-character="11"] .backup-download');
  await page.waitForSelector("#backup-alert:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("download 503: plain words", /switched off on the server/.test(await text(page, "#backup-alert")), await text(page, "#backup-alert"));

  // import our zip: preview, cancel
  await choose(page, name, saved);
  check("file note: our backup", /Our backup zip \(with its manifest\), 2 parts: Aldra \(id 10\)/.test(await text(page, "#import-file-note")),
    await text(page, "#import-file-note"));
  await previewInto(page, 10);
  const pv = await text(page, "#import-preview");
  check("preview: target", /Into Aldra \(id 10\)/.test(pv), pv);
  check("preview: source", /Our backup of this character, unchanged/.test(pv), pv);
  check("preview: parts", (await page.$$eval(".backup-parts tbody tr", (t) => t.map((x) => x.dataset.part))).join() === "savedata,rengokudata");
  check("preview: sizes", /20,480 bytes/.test(pv) && /20,482 bytes/.test(pv) && /replaced/.test(pv), pv);
  check("preview: save facts", /Zenny 1,000 99,999/i.test(pv) && /Road points 40 80/i.test(pv), pv);
  check("preview: skills restored", (await page.getAttribute(".backup-skills", "data-policy")) === "restore"
    && /Road skill levels: 8 now, 8 after\. They go back to what they were/.test(pv), pv);
  check("preview: play time and hunts", /Play time 1,307 h 40 min 1,307 h 40 min/.test(pv) && /Monsters hunted 14,312 14,312/.test(pv), pv);
  check("preview: no alert for a file with the same play", (await page.$$(".backup-alert")).length === 0, pv);
  check("preview: not restored listed", /Stays as it is warehouse/i.test(pv), pv);
  check("preview: confirm shown", await visible(page, "#import-confirm"));
  const previewCall = r.calls.filter((c) => c.path === "/api/account/characters/import/preview").pop();
  check("preview: body", previewCall && previewCall.body.characterId === 10 && !("discordId" in previewCall.body)
    && previewCall.body.manifest === MANIFEST && previewCall.body.signature === "ab12" && previewCall.body.parts.rengokudata === BACKUP.parts.rengokudata,
    JSON.stringify(previewCall && Object.keys(previewCall.body)));
  if (shots) {
    await page.screenshot({ path: path.join(shots, "backup-preview-1280.png"), fullPage: true });
  }
  await page.click("#import-cancel");
  check("cancel: preview closed", !(await visible(page, "#import-preview")));
  check("cancel: says nothing changed", /Cancelled: nothing was changed/.test(await text(page, "#import-file-note")));
  check("cancel: no import sent", !r.calls.some((c) => c.path === "/api/account/characters/import"));

  // preview again, confirm
  await previewInto(page, 10);
  await page.click("#import-confirm");
  await page.waitForSelector("#import-done:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("confirm: done message", /Imported into Aldra \(import #42\)/.test(await text(page, "#import-done")), await text(page, "#import-done"));
  const imp = r.calls.filter((c) => c.path === "/api/account/characters/import");
  const lastPreview = r.calls.filter((c) => c.path === "/api/account/characters/import/preview").pop();
  check("confirm: one import, same body as the preview", imp.length === 1 && JSON.stringify(imp[0].body) === JSON.stringify(lastPreview.body));
  await page.waitForFunction(() => /Aldra/.test(document.getElementById("import-history").textContent), null, { timeout: 5000 }).catch(() => {});
  const hist = await text(page, "#import-history");
  check("history: the import", /Aldra \(id 10\)/.test(hist) && /2 parts, Road skill levels restored/.test(hist) && /website/.test(hist), hist);
  check("confirm: preview closed", !(await visible(page, "#import-preview")));

  // an older zip of bins: levels cleared, warning
  const oldZip = Files.zip([{ name: "2026-10-23_12-00-00_savedata.bin", data: new TextEncoder().encode("old") },
    { name: "2026-10-23_12-00-00_platebox.bin", data: new Uint8Array(0) }]);
  await choose(page, "old.zip", oldZip);
  check("old zip: note", /Save files without a manifest \(another server's zip, or an older backup of ours\), 1 part\. Skipped: 2026-10-23_12-00-00_platebox\.bin \(empty\)/.test(await text(page, "#import-file-note")),
    await text(page, "#import-file-note"));
  await previewInto(page, 10);
  const old = await text(page, "#import-preview");
  check("old zip: cleared", (await page.getAttribute(".backup-skills", "data-policy")) === "clear" && /8 now, 0 after\. They are cleared/.test(old), old);
  check("old zip: warnings", /Aldra has 8 Road skill levels now\. They will be cleared/.test(old) && /the hunter Other, not Aldra/.test(old), old);
  const alertText = await page.$$eval(".backup-alert li", (t) => t.map((x) => x.textContent));
  check("old zip: alert first, less play and the levels", alertText.length === 2
    && alertText[0] === "This file has 7 hours less play than your character now. Importing it will lose that progress."
    && /^Aldra has 8 Road skill levels now/.test(alertText[1]), JSON.stringify(alertText));
  check("old zip: alert is above the other warnings", await page.$eval("#import-preview .backup-alert + .backup-warnings", () => true).catch(() => false));
  check("old zip: play time shown", /Play time 1,307 h 40 min 1,300 h 39 min/.test(old) && /Monsters hunted 14,312 14,266/.test(old), old);
  check("old zip: Confirm is still there", await visible(page, "#import-confirm"));

  // export JSON
  await choose(page, "export.json", Buffer.from(JSON.stringify({ Character: { savedata: b64("x") } })), "application/json");
  await previewInto(page, 10);
  const ex = await text(page, "#import-preview");
  check("export: source and ignored", /newer Erupe server/.test(ex) && /Not imported gacha_items/i.test(ex), ex);
  const exCall = r.calls.filter((c) => c.path === "/api/account/characters/import/preview").pop();
  check("export: body", exCall.body.erupeExport && !exCall.body.parts, JSON.stringify(Object.keys(exCall.body)));

  // refusals
  const refusals = [
    [12, /in the game right now\. Log out/],
    [13, /deleted, so it can't take an import/],
    [14, /never played\. Log in with it once/],
    [11, /can't be imported, so nothing was changed.*savedata: expands to 114820 bytes.*rengokudata: 94 bytes/]
  ];
  await choose(page, name, saved);
  for (const [id, pattern] of refusals) {
    await previewInto(page, id);
    const t = await text(page, "#import-preview-alert");
    check("refusal " + id + ": plain words", pattern.test(t), t);
    check("refusal " + id + ": no confirm", !(await visible(page, "#import-confirm")));
  }
  if (shots) await page.screenshot({ path: path.join(shots, "backup-refusal-1280.png"), fullPage: true });
  check("refusals: one import only", r.calls.filter((c) => c.path === "/api/account/characters/import").length === 1);

  // not a zip
  await choose(page, "save.zip", Buffer.from("hello"));
  check("not a zip: note", /not a zip we can read/.test(await text(page, "#import-file-note")) &&
    (await page.getAttribute("#import-file-note", "class")).includes("bad"));
  await page.click("#import-preview-btn");
  check("not a zip: no preview", /Choose a backup file first/.test(await text(page, "#import-file-note")));
  check("live: page errors", r.errors.length === 0, r.errors.join("; "));
  await r.ctx.close();

  // the API loses the endpoints mid-way (deploy rolled back): coming soon, no error text
  const m = await open(browser, { previewMissing: true });
  await m.page.goto(base + "/account.html#backups");
  await m.page.waitForSelector("#backup-live:not([hidden])", { timeout: 5000 }).catch(() => {});
  await choose(m.page, name, saved);
  await m.page.selectOption("#import-target", "10");
  await m.page.click("#import-preview-btn");
  await m.page.waitForSelector("#backup-soon:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("404 mid-way: coming soon", (await visible(m.page, "#backup-soon")) && !(await visible(m.page, "#backup-live")));
  check("404 mid-way: page errors", m.errors.length === 0, m.errors.join("; "));
  await m.ctx.close();

  if (shots) {
    const s = await open(browser, {}, 375);
    await s.page.goto(base + "/account.html#backups");
    await s.page.waitForSelector("#backup-live:not([hidden])", { timeout: 5000 }).catch(() => {});
    await choose(s.page, name, saved);
    await previewInto(s.page, 10);
    await s.page.screenshot({ path: path.join(shots, "backup-preview-375.png"), fullPage: true });
    await s.ctx.close();
  }
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const shots = process.env.SHOTS || "";
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  try {
    await missing(browser, base);
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
  console.log("account backups OK");
})().catch((e) => { console.error(e); process.exit(1); });
