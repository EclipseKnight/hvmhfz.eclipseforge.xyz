#!/usr/bin/env node
/* Checks the "Roads you play" panel (js/road-preference.js, on road.html and account.html) on a fake API, with
   a tiny stand-in for the page (no browser needed):
   - the Party Road list leaves out a Road with partyHidden (Zenith Road (Solo Zenith)), unless it is this
     account's party Road: then it is listed and selected, so saving keeps it;
   - the Solo Road list is unchanged by partyHidden (Original and Zenith, oldest first);
   - an API without partyHidden (older than the field) lists every Road;
   - saving sends the selected party and solo Roads, reads them back and says what is saved;
   The solo Road bug of 17 Nov 2026 (a pick lost or overwritten while the page said "Saved."):
   - the selects and Save stay disabled until the saved Roads are loaded, so a slow answer cannot replace a
     pick, and the page does not say "Saved." before any save, only what is saved now;
   - when loading the saved Roads fails, Save stays disabled (it used to save both Roads as blank);
   - a second tab opened before a change elsewhere does not write its old solo Road back: Save re-reads and
     shows what is saved instead;
   - a failed save says so and what is still saved.

     node dev/check-road-preference.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "road-preference.js"), "utf8");

const ORIGINAL = "cd54f255572aec8b4a159717e9f5b7251f48a45f4a5502189e51d6ffccca2c6a";
const ZENITH = "fdfd45f402a7559e89ba0f67ef591db98530c40e1ee8e5559fa5830dcb7bc985";
const SOLO_ZENITH = "50800947e8d2aa344b0f9389924469e5aa58e3f33fde69654b633c5dc6a45f27";

// /api/public/road/versions, newest first, as the API answers.
function versions(withFlag) {
  const list = [
    { sha256: SOLO_ZENITH, name: "Zenith Road (Solo Zenith)", soloName: "Zenith", live: true, always: false, partyHidden: true },
    { sha256: ZENITH, name: "Zenith Road", soloName: null, live: true, always: false, partyHidden: false },
    { sha256: ORIGINAL, name: "Original Road", soloName: "Original", live: false, always: true, partyHidden: false }
  ];
  if (!withFlag) list.forEach(function (v) { delete v.partyHidden; });
  return list;
}

// A <select>: value follows the browser (a value with no option selects nothing, "").
function element() {
  const el = {
    options: [], textContent: "", disabled: false, listeners: {},
    classList: { toggle: function () {} },
    set innerHTML(_) { el.options = []; el._value = ""; },
    appendChild: function (o) { el.options.push(o); if (el.options.length === 1) el._value = o.value; return o; },
    get value() { return el._value; },
    set value(v) { el._value = el.options.some(function (o) { return o.value === v; }) ? v : ""; },
    addEventListener: function (type, fn) { el.listeners[type] = fn; }
  };
  el._value = "";
  return el;
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise(function (r) { setImmediate(r); });
}

// The saved Roads, shared by every tab of one test.
function account(sha, soloSha) { return { sha: sha, soloSha: soloSha, puts: [] }; }

// One page (tab) on the fake API. opts: withFlag (default true), holdGet (the first account GET waits for
// release()), getFails, putFails.
function open(db, opts) {
  opts = opts || {};
  const withFlag = opts.withFlag !== false;
  const els = {};
  ["road-pref-select", "road-pref-solo-select", "road-pref-note", "road-pref-save"].forEach(function (id) {
    els[id] = element();
  });
  let release = function () {};
  let held = !!opts.holdGet;
  function answer(body, status) {
    status = status || 200;
    return Promise.resolve({ ok: status < 300, status: status, json: function () { return Promise.resolve(body); } });
  }
  const sandbox = {
    document: {
      getElementById: function (id) { return els[id] || null; },
      createElement: function () { return { value: "", textContent: "" }; }
    },
    localStorage: { getItem: function () { return "token"; } },
    fetch: function (url, o) {
      if (url.endsWith("/api/public/road/versions")) return answer(versions(withFlag));
      if (url.endsWith("/api/account/road-preference")) {
        if (o && o.method === "PUT") {
          const body = JSON.parse(o.body);
          db.puts.push(body);
          if (opts.putFails) return answer({ message: "There is no such Road." }, 400);
          db.sha = body.sha;
          if ("soloSha" in body) db.soloSha = body.soloSha;
          return answer({ sha: db.sha, soloSha: db.soloSha });
        }
        if (opts.getFails) return answer({}, 503);
        if (held) {
          held = false;
          // The answer is what was saved when the request went out.
          const then = { sha: db.sha, soloSha: db.soloSha };
          return new Promise(function (resolve) { release = function () { resolve(answer(then)); }; });
        }
        return answer({ sha: db.sha, soloSha: db.soloSha });
      }
      return Promise.reject(new Error("unexpected " + url));
    }
  };
  vm.runInNewContext(source, sandbox);
  const party = els["road-pref-select"], solo = els["road-pref-solo-select"], save = els["road-pref-save"];
  return {
    release: function () { release(); },
    // A user's pick: a disabled select cannot be changed.
    pickSolo: function (v) { if (!solo.disabled) solo.value = v; },
    pickParty: function (v) { if (!party.disabled) { party.value = v; if (party.listeners.change) party.listeners.change(); } },
    save: async function () { if (!save.disabled) save.listeners.click(); await settle(); },
    view: function () {
      return {
        party: party.options.map(function (o) { return o.value; }),
        partyValue: party.value,
        solo: solo.options.map(function (o) { return o.textContent; }),
        soloValue: solo.value,
        note: els["road-pref-note"].textContent,
        locked: [party.disabled, solo.disabled, save.disabled]
      };
    }
  };
}

let failed = 0;
function expect(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { failed++; console.log("FAIL " + name + "\n  got  " + a + "\n  want " + b); }
  else console.log("ok   " + name);
}
function expectMatch(name, text, re) {
  if (!re.test(text)) { failed++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(text) + "\n  want " + re); }
  else console.log("ok   " + name);
}
function puts(db) {
  return db.puts.map(function (b) { return [b.sha.slice(0, 8), (b.soloSha || "").slice(0, 8)]; });
}

(async function () {
  const soloList = ["Same as my party Road", "Original solo Road", "Zenith solo Road"];
  const unlocked = [false, false, false], locked = [true, true, true];

  // The party list, the solo list, a plain save.
  let db = account(ZENITH, SOLO_ZENITH);
  let p = open(db);
  await settle();
  let v = p.view();
  expect("party list leaves out the hidden Road", v.party, ["", ZENITH, ORIGINAL]);
  expect("party choice shown", v.partyValue, ZENITH);
  expect("solo list unchanged", v.solo, soloList);
  expect("solo choice shown", v.soloValue, SOLO_ZENITH);
  expect("unlocked once loaded", v.locked, unlocked);
  expect("on load the note says what is saved, not \"Saved.\"", v.note,
    "Saved now: party Road Zenith Road, solo Road Zenith solo Road.");
  await p.save();
  expect("save sends both", puts(db), [[ZENITH.slice(0, 8), SOLO_ZENITH.slice(0, 8)]]);

  db = account(SOLO_ZENITH, "");
  p = open(db);
  await settle();
  v = p.view();
  expect("an account on the hidden Road sees it", v.party, ["", ZENITH, ORIGINAL, SOLO_ZENITH]);
  expect("and it is selected", v.partyValue, SOLO_ZENITH);
  expect("the solo default names the hidden Road's solo half", v.solo[0], "Same as my party Road (Zenith)");
  await p.save();
  expect("saving keeps it", puts(db), [[SOLO_ZENITH.slice(0, 8), ""]]);

  db = account("", "");
  p = open(db, { withFlag: false });
  await settle();
  v = p.view();
  expect("an API without partyHidden lists every Road", v.party, ["", SOLO_ZENITH, ZENITH, ORIGINAL]);
  expect("solo list without the field", v.solo, soloList);

  // Shiro, 17 Nov: party Zenith Road, no solo Road yet, picks the Zenith solo Road and saves.
  db = account(ZENITH, "");
  p = open(db);
  await settle();
  p.pickSolo(SOLO_ZENITH);
  await p.save();
  v = p.view();
  expect("Zenith solo saved", [db.sha, db.soloSha], [ZENITH, SOLO_ZENITH]);
  expect("after Save the page shows what was read back", [v.partyValue, v.soloValue], [ZENITH, SOLO_ZENITH]);
  expectMatch("and says it, and when it applies", v.note,
    /^Saved: party Road Zenith Road, solo Road Zenith solo Road\. .*go back to town once/);
  expect("unlocked after Save", v.locked, unlocked);

  // The saved Roads answer late: nothing can be picked before, so the answer replaces no pick.
  db = account(ZENITH, "");
  p = open(db, { holdGet: true });
  await settle();
  expect("locked while the saved Roads load", p.view().locked, locked);
  expect("no \"Saved.\" while loading", p.view().note, "");
  p.pickSolo(SOLO_ZENITH);
  p.release();
  await settle();
  v = p.view();
  expect("the late answer shows the saved solo Road", v.soloValue, "");
  expect("unlocked after the late answer", v.locked, unlocked);
  p.pickSolo(SOLO_ZENITH);
  await p.save();
  expect("a pick made after loading is the one saved", puts(db), [[ZENITH.slice(0, 8), SOLO_ZENITH.slice(0, 8)]]);

  // Loading the saved Roads fails: Save must not write blanks over them.
  db = account(ZENITH, SOLO_ZENITH);
  p = open(db, { getFails: true });
  await settle();
  await p.save();
  v = p.view();
  expect("a failed load keeps Save disabled", v.locked, locked);
  expect("and saves nothing", db.puts, []);
  expectMatch("and says so", v.note, /^Could not load your saved Roads/);

  // Two tabs: the older one still shows the Original solo Road picked earlier; the newer one saves Zenith.
  db = account(ZENITH, ORIGINAL);
  const older = open(db);
  await settle();
  const newer = open(db);
  await settle();
  newer.pickSolo(SOLO_ZENITH);
  await newer.save();
  older.pickParty(ORIGINAL);
  await older.save();
  v = older.view();
  expect("the older tab does not write its Original solo Road back", [db.sha, db.soloSha], [ZENITH, SOLO_ZENITH]);
  expect("it shows what is saved now", [v.partyValue, v.soloValue], [ZENITH, SOLO_ZENITH]);
  expectMatch("and says it changed elsewhere", v.note, /changed somewhere else.*Zenith solo Road/);
  older.pickParty(ORIGINAL);
  await older.save();
  expect("saving again then keeps the Zenith solo Road", [db.sha, db.soloSha], [ORIGINAL, SOLO_ZENITH]);

  // A failed save.
  db = account(ZENITH, "");
  p = open(db, { putFails: true });
  await settle();
  p.pickSolo(SOLO_ZENITH);
  await p.save();
  v = p.view();
  expectMatch("a failed save says why and what is still saved", v.note,
    /^Could not save: There is no such Road\. Still saved: party Road Zenith Road, solo Road same as the party Road\.$/);
  expect("the pick stays to try again", v.soloValue, SOLO_ZENITH);
  expect("unlocked to try again", v.locked, unlocked);

  console.log(failed ? failed + " difference(s)" : "road preference OK");
  process.exit(failed ? 1 : 0);
})();
