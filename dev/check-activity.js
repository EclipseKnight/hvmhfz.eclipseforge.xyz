#!/usr/bin/env node
/* Checks the pure part of js/activity.js (the live board on the Worlds page) on the made-up answers
   in dev/activity-fixtures.json:

     node dev/check-activity.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const assert = require("assert");
const board = require("../js/activity.js");
const fixtures = require("./activity-fixtures.json");

const cases = {
  "busy board lists every player, by world": () => {
    assert.deepStrictEqual(board.totals(fixtures.busy), { online: 3, inTown: 1, inQuest: 2 });
    assert.strictEqual(board.listState(fixtures.busy), "");
    assert.deepStrictEqual(board.rows(fixtures.busy), [
      { name: "Aldra", discord: "", world: "Newbie · Land 1", inQuest: true, quest: "Quest 23051" },
      { name: "Bexo", discord: "", world: "Newbie · Land 1", inQuest: false, quest: "" },
      { name: "Cyra", discord: "cyra_hunts", world: "Normal · Land 1", inQuest: true, quest: "Departing" }
    ]);
  },
  "a world with no name or land still gets a label": () => {
    assert.strictEqual(board.worldLabel({ worldName: null, land: null }), "World");
  },
  "nobody online says so": () => {
    assert.strictEqual(board.listState(fixtures.empty), "empty");
    assert.deepStrictEqual(board.rows(fixtures.empty), []);
  },
  "counts only (names off in the API)": () => {
    assert.strictEqual(board.listState(fixtures.hidden), "hidden");
    assert.deepStrictEqual(board.totals(fixtures.hidden), { online: 2, inTown: 1, inQuest: 1 });
  },
  "a broken answer shows zeros, not an error": () => {
    assert.deepStrictEqual(board.totals(null), { online: 0, inTown: 0, inQuest: 0 });
    assert.deepStrictEqual(board.totals({ totals: { online: "x", inTown: -1 } }), { online: 0, inTown: 0, inQuest: 0 });
    assert.deepStrictEqual(board.rows({}), []);
    assert.strictEqual(board.listState({}), "empty");
  }
};

let failed = 0;
for (const [name, run] of Object.entries(cases)) {
  try {
    run();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + "\n     " + e.message.split("\n").join("\n     "));
  }
}
console.log(failed ? failed + " failed" : "all " + Object.keys(cases).length + " cases ok");
process.exit(failed ? 1 : 0);
