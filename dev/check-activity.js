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
      { name: "Aldra", discord: "", world: "Newbie · Land 1", inQuest: true, quest: "Quest 23051", inParty: true,
        href: "/hunters.html?q=Aldra" },
      { name: "Bexo", discord: "", world: "Newbie · Land 1", inQuest: false, quest: "", inParty: true,
        href: "/hunters.html?id=102" },
      { name: "Cyra", discord: "Cyra the Bold", world: "Normal · Land 1", inQuest: true, quest: "Departing", inParty: false,
        href: "/hunters.html?id=103" },
      { name: "Dax", discord: "<img src=x onerror=alert(1)>", world: "Normal · Land 1", inQuest: false, quest: "", inParty: false,
        href: "/hunters.html?id=104" }
    ]);
  },
  "parties: one block per world with a party of 2 or more": () => {
    assert.deepStrictEqual(board.parties(fixtures.busy), [
      { world: "Newbie · Land 1", parties: [{ quest: "Quest #23051", members: ["Aldra", "Bexo"],
        hrefs: ["/hunters.html?q=Aldra", "/hunters.html?id=102"] }] }
    ]);
  },
  "parties: quest by id, loading while the id is null": () => {
    assert.strictEqual(board.partyQuestLabel({ questId: 23051 }), "Quest #23051");
    assert.strictEqual(board.partyQuestLabel({ questId: null }), "Quest loading\u2026");
    assert.strictEqual(board.partyQuestLabel({}), "Quest loading\u2026");
    assert.strictEqual(board.partyQuestLabel({ questId: "23051" }), "Quest loading\u2026");
  },
  "parties: missing, empty or broken show nothing (works with the API before parties)": () => {
    const world = (parties) => ({ worlds: [{ worldName: "Newbie", land: 1, parties: parties,
      players: [{ characterName: "Aldra" }, { characterName: "Bexo" }] }] });
    const tags = (b) => board.rows(b).map((r) => r.inParty);
    assert.deepStrictEqual(board.parties(world(undefined)), []);
    assert.deepStrictEqual(tags(world(undefined)), [false, false]);
    assert.deepStrictEqual(board.parties(world([])), []);
    assert.deepStrictEqual(board.parties(world(null)), []);
    assert.deepStrictEqual(board.parties(world("x")), []);
    assert.deepStrictEqual(board.parties(world([null, {}, { members: "Aldra" }, { members: ["Aldra", 7, " "] }])), []);
    assert.deepStrictEqual(tags(world([{ members: ["Aldra", 7, " "] }])), [false, false]);
    assert.deepStrictEqual(board.parties(fixtures.empty), []);
    assert.deepStrictEqual(board.parties(null), []);
  },
  "parties: a member is tagged only in the world of the party, and by exact name": () => {
    const b = { worlds: [
      { worldName: "Newbie", land: 1, parties: [{ questId: 1, members: ["Aldra", "constructor"] }],
        players: [{ characterName: "Aldra" }, { characterName: "aldra" }, { characterName: "toString" }] },
      { worldName: "Normal", land: 1, players: [{ characterName: "Aldra" }] }
    ] };
    assert.deepStrictEqual(board.rows(b).map((r) => r.inParty), [true, false, false, false]);
  },
  "parties: counts-only API (no players) never shows names through parties": () => {
    const b = { totals: { online: 2 }, worlds: [{ worldName: "Newbie", players: [],
      parties: [{ questId: 1, members: ["Aldra", "Bexo"] }] }] };
    assert.deepStrictEqual(board.parties(b), []);
    assert.strictEqual(board.listState(b), "hidden");
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
  "names link to the hunter profile by charId": () => {
    assert.strictEqual(board.hunterHref("Aldra", 42), "/hunters.html?id=42");
    assert.strictEqual(board.hunterHref(null, 42), "/hunters.html?id=42");
    const row = board.rows({ worlds: [{ players: [{ characterName: "A&b", charId: 7, status: "town" }] }] })[0];
    assert.strictEqual(row.href, "/hunters.html?id=7");
  },
  "a missing or broken charId falls back to the name search (API before charId)": () => {
    [undefined, null, 0, -3, 1.5, NaN, Infinity, "42", "1&x=y", {}, true].forEach((id) => {
      assert.strictEqual(board.hunterHref("Aldra", id), "/hunters.html?q=Aldra", String(id));
    });
    assert.strictEqual(board.hunterHref("", null), "");
  },
  "party members link by the charId of the same-named player in their world": () => {
    const b = { worlds: [
      { worldName: "Newbie", parties: [{ questId: 1, members: ["Aldra", "Bexo", "Cyra", "Gone", "constructor"] }],
        players: [{ characterName: "Aldra", charId: 11 }, { characterName: "Bexo" },
                  { characterName: "Cyra", charId: 13 }, { characterName: "Cyra", charId: 14 }] },
      { worldName: "Normal", parties: [{ questId: 2, members: ["Aldra", "Dax"] }],
        players: [{ characterName: "Aldra", charId: 21 }, { characterName: "Dax", charId: 22 }] }
    ] };
    assert.deepStrictEqual(board.parties(b).map((block) => block.parties[0].hrefs), [
      // Bexo has no id; Cyra's name has two ids (no way to tell them apart); Gone is not in the
      // players list; "constructor" must not pick up an inherited key.
      ["/hunters.html?id=11", "/hunters.html?q=Bexo", "/hunters.html?q=Cyra", "/hunters.html?q=Gone",
       "/hunters.html?q=constructor"],
      ["/hunters.html?id=21", "/hunters.html?id=22"]
    ]);
  },
  "names link to the Hunters page searching for them, URL-encoded; no name, no link": () => {
    assert.strictEqual(board.hunterHref("Aldra"), "/hunters.html?q=Aldra");
    assert.strictEqual(board.hunterHref(" Aldra "), "/hunters.html?q=Aldra");
    assert.strictEqual(board.hunterHref("A&b=c #?/<x>\"'"),
      "/hunters.html?q=A%26b%3Dc%20%23%3F%2F%3Cx%3E%22'");
    assert.strictEqual(board.hunterHref("\u30cf\u30f3\u30bf\u30fc"), "/hunters.html?q=%E3%83%8F%E3%83%B3%E3%82%BF%E3%83%BC");
    assert.strictEqual(board.hunterHref(""), "");
    assert.strictEqual(board.hunterHref("   "), "");
    assert.strictEqual(board.hunterHref(null), "");
    assert.strictEqual(board.hunterHref(7), "");
    const row = board.rows({ worlds: [{ players: [{ status: "town" }] }] })[0];
    assert.strictEqual(row.name, "Unknown hunter");
    assert.strictEqual(row.href, "");
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
