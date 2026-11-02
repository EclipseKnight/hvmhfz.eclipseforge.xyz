#!/usr/bin/env node
/* Checks that every monster and item the two builders offer draws a picture, never a broken image:

     node dev/check-builder-icons.js          summary, every monster on the placeholder, the first items
     node dev/check-builder-icons.js --all    also every item on the placeholder

   Monsters: the Road builder offers ids 1 to 176 (js/road-rules.js), the Quest builder the named ids of
   data/monster-ids.json up to 176. Items: the Quest builder offers every id of data/item-ids.json. Neither
   builder offers weapons. Each one is resolved the way the pages do it (js/builder-ui.js): a file that does
   not exist is an error; no picture at all means the neutral placeholder, which is listed.

   Exit code 0 = no broken picture, 1 = a picture file is missing. */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const UI = require("../js/builder-ui.js");
const Rules = require("../js/road-rules.js");

function json(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function exists(src) {
  return fs.existsSync(path.join(ROOT, src.replace(/^\//, "")));
}

const monsterIcons = json("data/monster-icons.json");
const itemIcons = json("data/item-icons.json");
const monsterIds = json("data/monster-ids.json");
const itemIds = json("data/item-ids.json");
UI.setTables({ monsters: monsterIcons, items: itemIcons });

const broken = [];
if (!exists(UI.PLACEHOLDER)) broken.push("the placeholder " + UI.PLACEHOLDER);

// Every entry of the two tables must point at a file, offered or not.
Object.keys(monsterIcons).forEach((id) => { if (!exists(monsterIcons[id])) broken.push("monster " + id + ": " + monsterIcons[id]); });
Object.keys(itemIcons).forEach((id) => {
  const src = UI.itemIcon(id);
  if (!exists(src)) broken.push("item " + id + ": " + src);
});

// Monsters offered by either builder, with the name each page shows.
const monsters = new Map();
for (let id = 1; id <= Rules.KNOWN_MONSTERS; id++) monsters.set(id, Rules.MONSTER_NAMES[id]);
Object.keys(monsterIds).map(Number).forEach((id) => {
  if (id > 0 && id <= 176 && /[A-Za-z]/.test(monsterIds[id]) && !monsters.has(id)) monsters.set(id, monsterIds[id]);
});

function resolve(kind, ids, nameOf) {
  const placeholder = [];
  let pictures = 0;
  ids.forEach((id) => {
    const src = UI.iconFor(kind, id);
    if (src === UI.PLACEHOLDER) placeholder.push(id + " " + nameOf(id));
    else if (!exists(src)) broken.push(kind + " " + id + " " + nameOf(id) + ": " + src);
    else pictures += 1;
  });
  return { pictures, placeholder };
}

const m = resolve("monster", [...monsters.keys()].sort((a, b) => a - b), (id) => {
  const quest = monsterIds[id];
  return monsters.get(id) + (quest && quest !== monsters.get(id) ? " / " + quest : "");
});
const itemList = Object.keys(itemIds).map(Number).filter((id) => id > 0).sort((a, b) => a - b);
const i = resolve("item", itemList, (id) => itemIds[id]);

console.log("monsters offered: " + monsters.size + ", with a picture " + m.pictures + ", on the placeholder " + m.placeholder.length);
m.placeholder.forEach((line) => console.log("  placeholder monster " + line));
console.log("items offered: " + itemList.length + ", with a picture " + i.pictures + ", on the placeholder " + i.placeholder.length);
const all = process.argv.includes("--all");
(all ? i.placeholder : i.placeholder.slice(0, 15)).forEach((line) => console.log("  placeholder item " + line));
if (!all && i.placeholder.length > 15) console.log("  ... " + (i.placeholder.length - 15) + " more (--all lists them)");
console.log("weapons offered: 0 (neither builder has a weapon field)");

if (broken.length) {
  broken.forEach((line) => console.log("BROKEN " + line));
  console.log("builder icons: " + broken.length + " missing picture file(s)");
  process.exit(1);
}
console.log("builder icons OK: no broken picture");
