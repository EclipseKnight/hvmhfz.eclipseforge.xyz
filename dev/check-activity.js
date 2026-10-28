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
    assert.deepStrictEqual(board.totals(fixtures.busy), { online: 4, inTown: 2, inQuest: 2 });
    assert.strictEqual(board.listState(fixtures.busy), "");
    assert.deepStrictEqual(board.rows(fixtures.busy), [
      { name: "Aldra", discord: "", world: "Newbie · Land 1", inQuest: true, quest: "Quest 23051" },
      { name: "Bexo", discord: "", world: "Newbie · Land 1", inQuest: false, quest: "" },
      { name: "Cyra", discord: "Cyra the Bold", world: "Normal · Land 1", inQuest: true, quest: "Departing" },
      { name: "Dax", discord: "<img src=x onerror=alert(1)>", world: "Normal · Land 1", inQuest: false, quest: "" }
    ]);
  },
  "discordName: shown when set, blank when null, missing or not text": () => {
    const discord = (player) => board.rows({ worlds: [{ players: [player] }] })[0].discord;
    assert.strictEqual(discord({ characterName: "A", discordName: "Cyra the Bold" }), "Cyra the Bold");
    assert.strictEqual(discord({ characterName: "A", discordName: "  padded  " }), "padded");
    assert.strictEqual(discord({ characterName: "A", discordName: null }), "");
    assert.strictEqual(discord({ characterName: "A" }), "");
    assert.strictEqual(discord({ characterName: "A", discordName: "   " }), "");
    assert.strictEqual(discord({ characterName: "A", discordName: 123456789012345678 }), "");
  },
  "names reach the page as text only (no innerHTML in the board)": () => {
    // A name like Dax's "<img ... onerror>" is passed through unchanged by rows() and must only ever
    // be set with textContent; any HTML-parsing sink in js/activity.js would turn it into markup.
    const source = require("fs").readFileSync(require("path").join(__dirname, "../js/activity.js"), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
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
