#!/usr/bin/env node
/* Checks the "Roads you play" panel (js/road-preference.js, on road.html and account.html) on a fake API, with
   a tiny stand-in for the page (no browser needed):
   - the Party Road list leaves out a Road with partyHidden (Zenith Road (Solo Zenith)), unless it is this
     account's party Road: then it is listed and selected, so saving keeps it;
   - the Solo Road list is unchanged by partyHidden (Original and Zenith, oldest first);
   - an API without partyHidden (older than the field) lists every Road;
   - saving sends the selected party and solo Roads.

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

async function run(withFlag, mine) {
  const els = {};
  ["road-pref-select", "road-pref-solo-select", "road-pref-note", "road-pref-save"].forEach(function (id) {
    els[id] = element();
  });
  const puts = [];
  function answer(body) { return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } }); }
  const sandbox = {
    document: {
      getElementById: function (id) { return els[id] || null; },
      createElement: function () { return { value: "", textContent: "" }; }
    },
    localStorage: { getItem: function () { return "token"; } },
    fetch: function (url, opts) {
      if (url.endsWith("/api/public/road/versions")) return answer(versions(withFlag));
      if (url.endsWith("/api/account/road-preference")) {
        if (opts && opts.method === "PUT") { puts.push(JSON.parse(opts.body)); return answer(mine); }
        return answer(mine);
      }
      return Promise.reject(new Error("unexpected " + url));
    }
  };
  vm.runInNewContext(source, sandbox);
  for (let i = 0; i < 10; i++) await new Promise(function (r) { setImmediate(r); });
  els["road-pref-save"].listeners.click();
  for (let i = 0; i < 10; i++) await new Promise(function (r) { setImmediate(r); });
  return {
    party: els["road-pref-select"].options.map(function (o) { return o.value; }),
    partyValue: els["road-pref-select"].value,
    solo: els["road-pref-solo-select"].options.map(function (o) { return o.textContent; }),
    soloValue: els["road-pref-solo-select"].value,
    note: els["road-pref-note"].textContent,
    puts: puts
  };
}

let failed = 0;
function expect(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { failed++; console.log("FAIL " + name + "\n  got  " + a + "\n  want " + b); }
  else console.log("ok   " + name);
}

(async function () {
  const soloList = ["Same as my party Road", "Original solo Road", "Zenith solo Road"];

  let r = await run(true, { sha: ZENITH, soloSha: SOLO_ZENITH });
  expect("party list leaves out the hidden Road", r.party, ["", ZENITH, ORIGINAL]);
  expect("party choice shown", r.partyValue, ZENITH);
  expect("solo list unchanged", r.solo, soloList);
  expect("solo choice shown", r.soloValue, SOLO_ZENITH);
  expect("save sends both", r.puts, [{ sha: ZENITH, soloSha: SOLO_ZENITH }]);

  r = await run(true, { sha: SOLO_ZENITH, soloSha: "" });
  expect("an account on the hidden Road sees it", r.party, ["", ZENITH, ORIGINAL, SOLO_ZENITH]);
  expect("and it is selected", r.partyValue, SOLO_ZENITH);
  expect("saving keeps it", r.puts, [{ sha: SOLO_ZENITH, soloSha: "" }]);

  r = await run(false, { sha: "", soloSha: "" });
  expect("an API without partyHidden lists every Road", r.party, ["", SOLO_ZENITH, ZENITH, ORIGINAL]);
  expect("solo list without the field", r.solo, soloList);

  console.log(failed ? failed + " difference(s)" : "road preference OK");
  process.exit(failed ? 1 : 0);
})();
