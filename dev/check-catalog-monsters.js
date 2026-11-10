#!/usr/bin/env node
/* Checks that every monster the quest catalog lists has a monster page, and that the field guide's index
   (data/monsters/index.json) holds together.

   1. Every name in data/quests.json "monsters" resolves, the way the quest pages resolve it
      (js/monster-links.js), to an index entry whose data file data/monsters/<slug>.json exists; except
      the known gaps below (monsters of the game the guide has no page for yet).
   2. data/quests.json is what dev/make-quest-monsters.py writes (run it with --check).
   3. The English objective of every quest (data/quests.json "objective") names the same Dos-/prey/boar/Cephalos
      monsters as its "monsters" list (Iodrome and Gendrome, Ioprey and Genprey were once swapped), and the
      English texts of data/quest-details.json say what their Japanese text says (dev/fix-quest-text-names.py --check).
   4. The index: each entry has its data file and the file the same name, every picture it names exists,
      slugs and old slugs are unique, every link form monster.html accepts (slug, oldSlug, formerSlugs)
      opens the entry, and every monster id of data/monster-ids.json belongs to an entry or is a known gap.

   Usage: node dev/check-catalog-monsters.js     Exit code 0 = OK, 1 = problems, listed one per line. */
"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MonsterLinks = require(path.join(ROOT, "js/monster-links.js"));

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

// In the game, no field guide page yet (the guide's data comes from the Ferias tables, which these lack).
// A name here must not have a page: when one is added, take it out of this list. Empty since Shagaru Magala
// (id 164) got a minimal page from our own data (data/monsters/shagaru-magala.json, "ferias": false).
const NO_PAGE = {};
// Monster ids of data/monster-ids.json that are no monster to give a page: an NPC. Mi Ru (113) and Unknown (100)
// have name-only pages since the wiki cross-check (2026-11-03); the five Musou monsters of player report #26 have
// name-only pages without ids of their own.
const NO_PAGE_IDS = { 10: "Veggie Elder (NPC)" };

const problems = [];
const fail = function (message) { problems.push(message); };

const index = readJson("data/monsters/index.json");
const quests = readJson("data/quests.json").quests;
const monsterIds = readJson("data/monster-ids.json");
const links = MonsterLinks.build(index);

// ---- 1. catalog names ----
const unresolved = {};
let mentions = 0;
quests.forEach(function (quest) {
  (quest.monsters || []).forEach(function (name) {
    mentions += 1;
    const hit = links.find(name);
    if (hit && hit.name !== name) fail("quest " + quest.id + ": \"" + name + "\" is not the guide's name (\"" + hit.name + "\"); run dev/make-quest-monsters.py");
    if (hit && !exists("data/monsters/" + hit.slug + ".json")) fail("quest " + quest.id + ": \"" + name + "\" -> monster.html?m=" + hit.slug + ", which has no data file");
    if (!hit && !(name in NO_PAGE)) (unresolved[name] = unresolved[name] || []).push(quest.id);
    if (hit && name in NO_PAGE) fail("\"" + name + "\" has a page now: take it out of NO_PAGE in dev/check-catalog-monsters.js");
  });
});
Object.keys(unresolved).forEach(function (name) {
  const ids = unresolved[name];
  fail("\"" + name + "\" (" + ids.length + " quests, e.g. " + ids.slice(0, 3).join(", ") + ") has no monster page");
});

// ---- 2. the generator has run ----
const gen = childProcess.spawnSync("python3", [path.join(ROOT, "dev/make-quest-monsters.py"), "--check"], { encoding: "utf8" });
if (gen.status !== 0) fail((gen.stdout || gen.stderr || "dev/make-quest-monsters.py --check failed").trim());

// ---- 3. English objectives name the monsters of the catalog ----
// The family whose names the translators swapped; other monsters have several English spellings per Japanese name
// (subspecies, rare species), so only this family is compared as a set.
const FAMILY = ["Velociprey", "Velocidrome", "Giaprey", "Genprey", "Gendrome", "Ioprey", "Iodrome", "Bullfango", "Bulldrome",
  "Cephalos", "Cephadrome", "Blango", "Blangonga"];
quests.forEach(function (quest) {
  if (!quest.objective) return;
  const named = FAMILY.filter(function (name) { return new RegExp("\\b" + name + "(s|es)?\\b", "i").test(quest.objective); });
  const listed = FAMILY.filter(function (name) { return (quest.monsters || []).indexOf(name) !== -1; });
  if (named.join() !== listed.join()) fail("quest " + quest.id + ": objective \"" + quest.objective + "\" names " + (named.join(", ") || "none of " + "the Dos-/prey family") + ", the monsters list says " + (listed.join(", ") || "none"));
});
const texts = childProcess.spawnSync("python3", [path.join(ROOT, "dev/fix-quest-text-names.py"), "--check"], { encoding: "utf8" });
if (texts.status !== 0) fail((texts.stdout || texts.stderr || "dev/fix-quest-text-names.py --check failed").trim().split("\n").slice(0, 6).join(" | "));

// ---- 4. the index ----
const forms = {};
index.forEach(function (m) {
  const file = "data/monsters/" + m.slug + ".json";
  if (!exists(file)) { fail("index: " + m.slug + " has no " + file); return; }
  const data = readJson(file);
  if (data.name !== m.name) fail("index: " + m.slug + " is \"" + m.name + "\" in the index, \"" + data.name + "\" in its file");
  [["icons", m.icon], ["icons", m.render], ["zones", m.zone], ["icons", data.icon], ["icons", data.render], ["zones", data.zone]]
    .forEach(function (pic) {
      if (pic[1] && !exists("assets/monsters/" + pic[0] + "/" + pic[1])) fail("index: " + m.slug + " names assets/monsters/" + pic[0] + "/" + pic[1] + ", which is missing");
    });
  [m.slug, m.oldSlug].concat(m.formerSlugs || []).forEach(function (form) {
    if (!form) return;
    if (forms[form] && forms[form] !== m.slug) fail("index: link form \"" + form + "\" opens both " + forms[form] + " and " + m.slug);
    forms[form] = m.slug;
  });
});
// monster.html?m=<form>: the file of that name, else the index entry whose oldSlug or formerSlugs has it
// (js/monster.js). Every form must open the entry it belongs to.
Object.keys(forms).forEach(function (form) {
  const direct = exists("data/monsters/" + form + ".json");
  const viaIndex = index.filter(function (m) { return m.oldSlug === form || (m.formerSlugs || []).indexOf(form) !== -1; })[0];
  const opens = direct ? form : viaIndex ? viaIndex.slug : null;
  if (opens !== forms[form]) fail("monster.html?m=" + form + " opens " + opens + ", not " + forms[form]);
});
const byId = {};
index.forEach(function (m) { (m.ids || []).forEach(function (id) { (byId[id] = byId[id] || []).push(m.slug); }); });
Object.keys(monsterIds).forEach(function (id) {
  if (Number(id) === 0) return;
  if (!byId[id] && !(id in NO_PAGE_IDS)) fail("data/monster-ids.json " + id + " (" + monsterIds[id] + ") is on no index entry (\"ids\")");
  if (byId[id] && id in NO_PAGE_IDS) fail("monster id " + id + " has a page now: take it out of NO_PAGE_IDS");
});
Object.keys(byId).forEach(function (id) {
  if (!(id in monsterIds)) fail("index: id " + id + " (on " + byId[id].join(", ") + ") is not in data/monster-ids.json");
});

// Player report #26: the Musou versions with no id of their own keep their pages.
["pariapuria", "zinogre", "guanzorumu", "mi-ru", "elzelion"].forEach(function (k) {
  const slug = "musou-" + k;
  if (!index.some(function (m) { return m.slug === slug; })) fail("index: " + slug + " (player report #26) is missing");
  if (!fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8").includes("monster.html?m=" + slug + "<")) fail("sitemap.xml: " + slug + " is missing");
});

problems.forEach(function (p) { console.log("FAIL: " + p); });
if (problems.length) {
  console.log(problems.length + " problem(s)");
  process.exit(1);
}
console.log("catalog monsters OK: " + mentions + " mentions in " + quests.length + " quests, " + index.length +
  " guide entries; known gaps without a page: " + (Object.keys(NO_PAGE).map(function (n) { return n + " (id " + NO_PAGE[n] + ")"; }).join(", ") || "none"));
