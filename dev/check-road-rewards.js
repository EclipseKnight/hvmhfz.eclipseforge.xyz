#!/usr/bin/env node
/* Checks js/road-rewards.js (the Hunting Road rewards on the account page) on made-up rows, both from
   the API with boards (design and score) and from the API before boards:

     node dev/check-road-rewards.js

   Exit code 0 = every case as expected, 1 = a difference. */
"use strict";

const assert = require("assert");
const rewards = require("../js/road-rewards.js");

const design = { cycleId: 7, number: 3, board: "design", place: 1, tier: "Champion", entryName: "Lava Gauntlet",
  floor: null, points: null, claimable: true, claimed: null, reason: "Place 1: Champion." };
const score = { cycleId: 7, number: 3, board: "score", place: 12, tier: "Contender", entryName: null,
  floor: 41, points: 123456, claimable: true, claimed: null, reason: "Place 12: Contender." };
const before = { cycleId: 5, number: 2, entryName: "Old Road", claimable: true, claimed: null, reason: null };

const cases = {
  "claim sends the row's board": () => {
    assert.deepStrictEqual(rewards.claimBody(design, "101"), { cycleId: 7, characterId: 101, board: "design" });
    assert.deepStrictEqual(rewards.claimBody(score, "101"), { cycleId: 7, characterId: 101, board: "score" });
  },
  "claim from an API before boards sends no board (the API's default, design)": () => {
    assert.deepStrictEqual(rewards.claimBody(before, "101"), { cycleId: 5, characterId: 101 });
  },
  "one title per board": () => {
    assert.strictEqual(rewards.title(design), "Rotation 3, design vote");
    assert.strictEqual(rewards.title(score), "Rotation 3, floor clear board");
    assert.strictEqual(rewards.title(before), "Rotation 2: Old Road");
  },
  "details: place, tier, then entry or floor and points": () => {
    assert.strictEqual(rewards.details(design), "Place 1 · Champion · entry Lava Gauntlet");
    assert.strictEqual(rewards.details(score), "Place 12 · Contender · floor 41 · 123,456 points");
    assert.strictEqual(rewards.details(before), "");
  },
  "details: a place without a tier or score shows what is there": () => {
    assert.strictEqual(rewards.details({ board: "score", place: 60, tier: null, floor: 3, points: null }),
      "Place 60 · floor 3");
    assert.strictEqual(rewards.details({ board: "design", place: null, tier: null, entryName: null }), "");
  }
};

let failed = 0;
for (const [name, run] of Object.entries(cases)) {
  try {
    run();
    console.log("ok   " + name);
  } catch (error) {
    failed++;
    console.log("FAIL " + name + "\n     " + error.message.split("\n").join("\n     "));
  }
}
console.log(failed ? failed + " failed" : "all " + Object.keys(cases).length + " cases pass");
process.exit(failed ? 1 : 0);
