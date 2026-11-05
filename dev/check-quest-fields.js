#!/usr/bin/env node
/* Checks data/quest-fields.json, the quest builder's field reference (docs/quest-fields.md).

     node dev/check-quest-fields.js            (QuestCodec.java at its default path, see CODEC below)
     QUEST_CODEC=/path/QuestCodec.java node dev/check-quest-fields.js

   1. The file itself: every field has a key, struct, offset, size, type, source and confidence, and the
      size fits the type.
   2. The API codec (QuestCodec.java, in the private API repo): every byte it reads or writes is a field here
      with the same struct, offset and size, and every field here marked as in the codec is written by it.
      Skipped, and said so, when the file is not on this machine.
   3. The builder (js/quest-editor.js): every model property it assigns is a field here, and every bytes
      label it shows is right. A label is F("key") (or F(["key", "key"]) for a value kept in two places) next
      to the control: each key must be a field here, the first model property the control assigns after it
      must be one of the keys and every key must be assigned there, and js/builder-ui.js's bytesText must
      print each field's struct, offset and size as this file has them.
   4. The site's data: every map, area, item and monster used in data/quests.json and
      data/quest-details.json has a name, or is listed here as a known gap; the name tables hold no id
      outside the field's range; the objective type names here match data/objective-types.json. Every map
      in data/map-areas.json has its own name in data/map-ids.json (no two alike), with a group the builder
      knows, its quest count and a confidence, and docs/maps.md's table matches it.
   5. docs/quest-fields.md: its field tables have one row per field, with the JSON's struct, offset and size.

   Exit code 0 = all good, 1 = problems, each listed on its own line. */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CODEC = process.env.QUEST_CODEC ||
  "/root/mhfz/hvmhfz_rest_api/src/main/java/xyz/eclipseforge/hvmhfz/hvmhfz_rest_api/quest/QuestCodec.java";

const problems = [];
const notes = [];
function fail(text) { problems.push(text); }

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

const ref = readJson("data/quest-fields.json");
const fields = ref.fields;
const CONFIDENCE = Object.keys(ref.confidence);
const BUILDER = Object.keys(ref.builderValues);
const SECTIONS = ["basics", "map", "objectives", "monsters", "rewards", "text", "other"];

/** Bytes of one element of a field: the width its type names, or size / count for an array. */
function elementSize(field) {
  return field.count ? field.size / field.count : field.size;
}

function typeWidth(type) {
  const m = /^(u8|s8|u16|s16|u32|s32|f32)/.exec(type);
  return m ? { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4, f32: 4 }[m[1]] : null;
}

function inCodec(field) { return field.codec !== false; }

// ---- 1. the reference file itself -------------------------------------------------------------

const seenKeys = new Set();
fields.forEach(function (f) {
  const where = "quest-fields.json " + (f.key || "(no key)");
  ["key", "label", "section", "struct", "size", "type", "source", "confidence", "builder"].forEach(function (k) {
    if (f[k] === undefined || f[k] === "") fail(where + ": missing " + k);
  });
  if (seenKeys.has(f.key)) fail(where + ": key listed twice");
  seenKeys.add(f.key);
  if (SECTIONS.indexOf(f.section) < 0) fail(where + ": section " + f.section + " is not one of " + SECTIONS.join(", "));
  if (!ref.structs[f.struct]) fail(where + ": struct " + f.struct + " is not in structs");
  if (CONFIDENCE.indexOf(f.confidence) < 0) fail(where + ": confidence " + f.confidence + " is not one of " + CONFIDENCE.join(", "));
  if (BUILDER.indexOf(f.builder) < 0) fail(where + ": builder " + f.builder + " is not one of " + BUILDER.join(", "));
  if (f.struct !== "text" && !/^0x[0-9a-f]+$/.test(String(f.offset))) fail(where + ": offset " + f.offset + " is not hex");
  if (!Array.isArray(f.source) || !f.source.length) fail(where + ": source must list at least one place");
  const width = typeWidth(f.type);
  if (width && elementSize(f) !== width) {
    fail(where + ": type " + f.type + " is " + width + " bytes but the field is " + elementSize(f) + " per element");
  }
  if (f.count && f.size % f.count) fail(where + ": size " + f.size + " is not a multiple of count " + f.count);
  if (f.range && f.range.min > f.range.max) fail(where + ": range min is above max");
});

function offsetOf(f) { return parseInt(f.offset, 16); }

/** Fields of a struct whose key ends in the property name the codec uses. A key may end in "[]" or name the
    elements it holds ("body.monsterVariants[2-4]": one array kept at two offsets). */
function fieldsFor(struct, prop) {
  return fields.filter(function (f) {
    if (f.struct !== struct || !inCodec(f)) return false;
    const key = f.key.replace(/\[[^\]]*\]$/, "");
    return key === prop || key.endsWith("." + prop);
  });
}

// ---- 2. the API codec ---------------------------------------------------------------------------

/** Splits "a, b(c, d), e" at the top-level commas. */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The methods of a Java source, by name: the text between the method's braces. */
function javaMethods(src) {
  const out = {};
  const head = /(?:private|public) static [\w<>\[\], ]+? (\w+)\([^)]*\)\s*\{/g;
  let m;
  while ((m = head.exec(src))) {
    let depth = 1;
    let i = head.lastIndex;
    while (depth && i < src.length) {
      if (src[i] === "{") depth += 1;
      if (src[i] === "}") depth -= 1;
      i += 1;
    }
    out[m[1]] = src.slice(head.lastIndex, i - 1);
  }
  return out;
}

/** An offset expression such as "body + 0x0c", "table + 4 * i + 2" or "0x44": its base and constant. */
function parseOffset(expr, bases) {
  let base = null;
  let offset = 0;
  expr.replace(/\(int\)/g, "").split("+").map(function (t) { return t.trim(); }).forEach(function (term) {
    if (/^(0x[0-9a-fA-F]+|\d+)$/.test(term)) offset += parseInt(term, term.startsWith("0x") ? 16 : 10);
    else if (Object.prototype.hasOwnProperty.call(bases, term)) base = term;
    // "4 * i", "16 * i", "i": a record index, not part of the field's offset
  });
  return { base: base, offset: offset };
}

const WIDTH = { U8: 1, S8: 1, U16: 2, U32: 4 };

/* Which struct each codec method reads or writes, by the variable that holds the struct's start. A method
   whose offsets are plain numbers (the header) uses the "" entry. */
const WRITERS = {
  writeHeader: { "": "header" },
  writeBody: { body: "body" },
  writeObjective: { at: "objective" },
  writeStartAreas: { table: "startArea" },
  writeStartItems: { table: "startItem" },
  writeMap: { at: "mapRecord" },
  writeRewards: { at: "rewardGroup", entry: "rewardEntry" },
  writeSmallSpawns: { slot: "smallSpawnSlot" },
  writeSpawnArea: { at: "spawnArea", record: "spawnRecord", id: "monsterIdList" },
  writeTexts: { table: "textTable" }
};
const READERS = {
  parseHeader: { "": "header" },
  parseBody: { body: "body" },
  parseStartAreas: { at: "startArea", table: "startArea" },
  parseStartItems: { table: "startItem" },
  parseMap: { at: "mapRecord" },
  parseRewards: { at: "rewardGroup", entry: "rewardEntry" },
  parseSmallSpawns: { at: "smallSpawnSlot" },
  parseSpawnAreas: { at: "spawnArea" },
  parseSpawnRecords: { at: "spawnRecord" },
  parseTexts: { table: "textTable" }
};
/* Writes whose value is not a getter: the small spawn slot holds the group offset itself, and the monster id
   list is written id by id (and its 0xffffffff end) from a loop variable. */
const PLAIN_VALUES = { smallSpawnSlot: "smallSpawnGroupOffsets", monsterIdList: "monsterIds" };

function structOf(map, base) {
  if (base === null) return map[""] || null;
  return map[base] || null;
}

function codecWrites(methods) {
  const writes = [];
  const objective = [];
  Object.keys(WRITERS).forEach(function (name) {
    const text = methods[name];
    if (!text) { fail("QuestCodec.java: method " + name + " not found (the check's map of codec methods needs updating)"); return; }
    const call = /writer\.put(U8|S8|U16|U32|Bytes)\(([^;]*)\);/g;
    let m;
    while ((m = call.exec(text))) {
      const args = splitArgs(m[2]);
      const at = parseOffset(args[0], WRITERS[name]);
      const struct = structOf(WRITERS[name], at.base);
      if (!struct) continue; // a string written where its slot points: checked as text, not here
      const getter = /\.(\w+)\(\)(?:\[i\])?\)?\s*$/.exec(args[1]);
      let prop = getter ? getter[1] : PLAIN_VALUES[struct];
      if (/^(0x[0-9a-fA-F]+|\d+)$/.test(args[1].trim())) continue; // a terminator, not a field
      if (!prop) { fail("QuestCodec.java " + name + ": cannot tell which field `" + m[0] + "` writes"); continue; }
      const entry = { method: name, struct: struct, offset: at.offset, size: WIDTH[m[1]] || null, prop: prop };
      (struct === "objective" ? objective : writes).push(entry);
    }
  });
  // writeBody hands each objective record to writeObjective at its own offset.
  const objCall = /writeObjective\(writer, body \+ (0x[0-9a-fA-F]+), value\.(\w+)\(\)\)/g;
  let m;
  while ((m = objCall.exec(methods.writeBody || ""))) {
    const base = parseInt(m[1], 16);
    const record = m[2];
    objective.forEach(function (o) {
      writes.push({ method: "writeObjective", struct: "body", offset: base + o.offset, size: o.size, prop: record + "." + o.prop });
    });
  }
  return writes;
}

function codecReads(methods) {
  const reads = [];
  Object.keys(READERS).forEach(function (name) {
    const text = methods[name];
    if (!text) { fail("QuestCodec.java: method " + name + " not found (the check's map of codec methods needs updating)"); return; }
    const call = /read(U8|S8|U16|U32)\(data, ([^)]*(?:\([^)]*\))?[^)]*)\)/g;
    let m;
    while ((m = call.exec(text))) {
      const at = parseOffset(m[2], READERS[name]);
      const struct = structOf(READERS[name], at.base);
      if (struct) reads.push({ method: name, struct: struct, offset: at.offset, size: WIDTH[m[1]] });
    }
    // Arrays.copyOfRange(data, 0x88, 0xA0): a block read as bytes
    const block = /copyOfRange\(data, (0x[0-9a-fA-F]+), (0x[0-9a-fA-F]+)\)/g;
    while ((m = block.exec(text))) {
      reads.push({ method: name, struct: structOf(READERS[name], null), offset: parseInt(m[1], 16),
        size: parseInt(m[2], 16) - parseInt(m[1], 16), block: true });
    }
  });
  return reads;
}

let codecSummary = "codec not checked";
if (fs.existsSync(CODEC)) {
  const methods = javaMethods(fs.readFileSync(CODEC, "utf8"));
  const writes = codecWrites(methods);
  const reads = codecReads(methods);
  const written = new Set();
  writes.forEach(function (w) {
    let found = fieldsFor(w.struct, w.prop);
    // One array kept at two offsets: the write is the part at its offset.
    if (found.length > 1 && found.some(function (f) { return offsetOf(f) === w.offset; })) {
      found = found.filter(function (f) { return offsetOf(f) === w.offset; });
    }
    const what = "QuestCodec." + w.method + " writes " + w.struct + " +0x" + w.offset.toString(16) + " (" + w.prop + ")";
    if (!found.length) { fail(what + ": no field in quest-fields.json"); return; }
    found.forEach(function (f) {
      written.add(f.key);
      if (offsetOf(f) !== w.offset) fail(what + ": quest-fields.json " + f.key + " says offset " + f.offset);
      if (w.size !== null && elementSize(f) !== w.size) {
        fail(what + " as " + w.size + " bytes: quest-fields.json " + f.key + " says " + elementSize(f));
      }
    });
  });
  reads.forEach(function (r) {
    const hit = fields.some(function (f) {
      if (f.struct !== r.struct || !inCodec(f)) return false;
      if (r.block) return offsetOf(f) === r.offset && f.size === r.size;
      const el = elementSize(f);
      const rel = r.offset - offsetOf(f);
      return el === r.size && rel >= 0 && rel % el === 0 && rel < f.size;
    });
    if (!hit) {
      fail("QuestCodec." + r.method + " reads " + r.size + " bytes at " + r.struct + " +0x" + r.offset.toString(16) +
        ": no field in quest-fields.json has that offset and size");
    }
  });
  fields.forEach(function (f) {
    if (inCodec(f) && f.struct !== "text" && !written.has(f.key)) {
      fail("quest-fields.json " + f.key + ": marked as in the codec, but QuestCodec writes no such field (set \"codec\": false if it is raw bytes)");
    }
  });
  codecSummary = "codec: " + writes.length + " writes and " + reads.length + " reads matched";
} else {
  notes.push("QuestCodec.java not found at " + CODEC + ": the codec part was skipped (set QUEST_CODEC to check it)");
}

// ---- 3. the builder -----------------------------------------------------------------------------

const editor = fs.readFileSync(path.join(ROOT, "js/quest-editor.js"), "utf8");

/* The builder's variable names for model records, and the keys they stand for. */
const EDITOR_VARS = {
  b: ["body."],
  header: ["header."],
  map: ["map."],
  objective: ["body.objective0.", "body.objective1.", "body.objective2."],
  spawn: ["largeSpawnAreas[].spawns[].", "smallSpawnGroups[].areas[].spawns[]."],
  entry: ["startItems[].", "rewardGroups[].entries[]."],
  a: ["startAreas[]."],
  group: ["rewardGroups[]."],
  slot: ["texts[0].", "texts[1].", "texts[2].", "texts[3].", "texts[4].", "texts[5].", "texts[6].", "texts[7]."]
};
/* Records the builder adds with .push({...}), told apart by one key each holds. */
const PUSHED = [
  { has: "groupId", prefix: "rewardGroups[]." },
  { has: "monsterIdsOffset", prefix: "largeSpawnAreas[]." },
  { has: "weight", prefix: "rewardGroups[].entries[]." },
  { has: "monsterId", prefix: "largeSpawnAreas[].spawns[]." }
];
/* Containers and editor-only properties: not file fields. */
const NOT_FIELDS = ["spawns", "entries"];

const allKeys = new Set();
fields.forEach(function (f) { allKeys.add(f.key); (f.alsoKeys || []).forEach(function (k) { allKeys.add(k); }); });

function known(prefixes, prop) {
  return prefixes.some(function (p) { return allKeys.has(p + prop) || allKeys.has(p + prop + "[]"); });
}

const lineOf = function (index) { return editor.slice(0, index).split("\n").length; };
let editorWrites = 0;
const assign = /\b([a-z]\w*)\.(\w+)\s*=(?!=)/g;
let am;
while ((am = assign.exec(editor))) {
  const prefixes = EDITOR_VARS[am[1]];
  if (!prefixes || NOT_FIELDS.indexOf(am[2]) >= 0) continue;
  editorWrites += 1;
  if (!known(prefixes, am[2])) {
    fail("js/quest-editor.js:" + lineOf(am.index) + " sets " + am[1] + "." + am[2] + ": no field " + prefixes[0] + am[2] + " in quest-fields.json");
  }
}
if (/\bicons\[i\]\s*=(?!=)/.test(editor)) {
  editorWrites += 1;
  if (!allKeys.has("body.iconMonsters[]")) fail("js/quest-editor.js sets icons[i]: no field body.iconMonsters[]");
}
const push = /\.push\(\{([^}]*)\}\)/g;
while ((am = push.exec(editor))) {
  const props = am[1].split(",").map(function (p) { return p.split(":")[0].trim(); }).filter(Boolean);
  const kind = PUSHED.filter(function (k) { return props.indexOf(k.has) >= 0; })[0];
  if (!kind) continue;
  props.forEach(function (p) {
    if (NOT_FIELDS.indexOf(p) >= 0) return;
    editorWrites += 1;
    if (!known([kind.prefix], p)) fail("js/quest-editor.js:" + lineOf(am.index) + " adds a record with " + p + ": no field " + kind.prefix + p);
  });
}

/* Bytes labels. The page draws every label from this file through F("key") in js/quest-editor.js and
   bytesText in js/builder-ui.js, so a label is right when (a) F names the field the control writes and
   (b) bytesText prints that field's struct, offset and size. "#" in a key stands for the record index
   (body.objective#.type), and matches any digit here. */
const UI = require(path.join(ROOT, "js/builder-ui.js"));

function keysMatching(pattern) {
  if (pattern.indexOf("#") < 0) return allKeys.has(pattern) ? [pattern] : [];
  const re = new RegExp("^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("#", "\\d+") + "$");
  return Array.from(allKeys).filter(function (k) { return re.test(k); });
}

/** The keys one assignment can stand for: "spawn.count" -> the spawn record count keys. */
function keysOf(v, prop) {
  if (v === "icons") return ["body.iconMonsters[]"];
  return (EDITOR_VARS[v] || []).map(function (p) { return p + prop; }).concat(
    (EDITOR_VARS[v] || []).map(function (p) { return p + prop + "[]"; })).filter(function (k) { return allKeys.has(k); });
}

/** The canonical key of a key or an alsoKeys alias. */
function canonical(key) {
  const f = fields.filter(function (x) { return x.key === key || (x.alsoKeys || []).indexOf(key) >= 0; })[0];
  return f ? f.key : key;
}

let hints = 0;
const labelled = new Set();
const SPAN = 2000; // how far after F(...) the control's assignment may be (slotField sets slot.text 1.7k chars on)
/* The editor with its comments blanked (lines kept), so a comment's example F("...") is not read as a label. */
const code = editor.replace(/\/\*[\s\S]*?\*\//g, function (c) { return c.replace(/[^\n]/g, " "); })
  .replace(/^(\s*)(\/\/.*)$/gm, function (all, lead, c) { return lead + c.replace(/./g, " "); });
const fCall = /\bF\(\s*(\[\s*"[^"]*"(?:\s*,\s*"[^"]*")*\s*\]|"[^"]*")/g;
while ((am = fCall.exec(code))) {
  const at = lineOf(am.index);
  const patterns = (am[1].match(/"[^"]*"/g) || []).map(function (q) { return q.slice(1, -1); });
  const expanded = patterns.map(function (pat) {
    const ks = keysMatching(pat).map(canonical);
    if (!ks.length) fail("js/quest-editor.js:" + at + " labels a control with " + pat + ": no such field in quest-fields.json");
    return ks;
  });
  if (expanded.some(function (ks) { return !ks.length; })) continue;
  const after = code.slice(am.index, am.index + SPAN);
  const assigned = [];
  const a3 = /\b([a-z]\w*)\.(\w+)\s*=(?!=)|\b(icons)\[i\]\s*=(?!=)/g;
  let w;
  while ((w = a3.exec(after))) {
    const ks = w[3] ? keysOf("icons") : keysOf(w[1], w[2]);
    if (ks.length) assigned.push({ text: w[0].replace(/\s*=$/, ""), keys: ks.map(canonical) });
  }
  if (!assigned.length) { fail("js/quest-editor.js:" + at + " labels " + patterns.join(" + ") + " but no model property is assigned after it"); continue; }
  const hit = function (ks, a) { return ks.some(function (k) { return a.keys.indexOf(k) >= 0; }); };
  if (!expanded.some(function (ks) { return hit(ks, assigned[0]); })) {
    fail("js/quest-editor.js:" + at + " labels " + patterns.join(" + ") + ", but the control next to it sets " + assigned[0].text);
  }
  expanded.forEach(function (ks, i) {
    if (!assigned.some(function (a) { return hit(ks, a); })) {
      fail("js/quest-editor.js:" + at + " labels " + patterns[i] + ", but the control does not set it");
    }
  });
  hints += 1;
  expanded.forEach(function (ks) { ks.forEach(function (k) { labelled.add(k); }); });
}
/* Fields the page mentions without editing (refText in a table such as OBJECTIVES' money). */
const shown = /\bmoney: "([^"]+)"/g;
while ((am = shown.exec(editor))) {
  if (!allKeys.has(am[1])) fail("js/quest-editor.js:" + lineOf(am.index) + " shows " + am[1] + ": no such field in quest-fields.json");
  else { hints += 1; labelled.add(am[1]); }
}
/* Every field the builder edits has a label. */
fields.forEach(function (f) {
  if (f.builder === "edits" && !labelled.has(f.key)) fail("quest-fields.json " + f.key + " is marked edits, but js/quest-editor.js shows no bytes label for it");
});
/* bytesText prints what this file says, for every field. */
fields.forEach(function (f) {
  const text = UI.bytesText({ fields: [f] });
  const one = f.count ? f.size / f.count : f.size;
  if (f.struct === "text") {
    if (text.indexOf("text slot " + /\[(\d+)\]/.exec(f.key)[1] + " ") !== 0) fail("bytesText(" + f.key + ") = \"" + text + "\"");
    return;
  }
  const m = /^(\w+) \+0x([0-9a-f]+) · .*?(?:× (\d+), )?(\d+) bytes?$/.exec(text);
  if (!m || m[1] !== f.struct || parseInt(m[2], 16) !== offsetOf(f) || Number(m[4]) !== f.size) {
    fail("bytesText(" + f.key + ") = \"" + text + "\": quest-fields.json says " + f.struct + " +" + f.offset + ", " + f.size + " bytes");
  }
  if (f.count) {
    const el = UI.bytesText({ fields: [f], index: f.count - 1 });
    const last = offsetOf(f) + (f.count - 1) * one;
    if (el.indexOf(f.struct + " +0x" + (last < 16 ? "0" : "") + last.toString(16) + " · ") !== 0 || !/, (\d+) bytes?$/.test(el) ||
        Number(/, (\d+) bytes?$/.exec(el)[1]) !== one) {
      fail("bytesText(" + f.key + ", element " + (f.count - 1) + ") = \"" + el + "\"");
    }
  }
});
const pair = UI.bytesText({ fields: [field("body.questClass"), field("header.questClass")] });
if (pair !== "body +0x0a and header +0x5c · u8, 1 byte each") fail("bytesText of the two quest class copies = \"" + pair + "\"");

// ---- 4. the site's data -------------------------------------------------------------------------

const monsters = readJson("data/monster-ids.json");
const items = readJson("data/item-ids.json");
const areas = readJson("data/area-ids.json");
const maps = readJson("data/map-ids.json");
const objectiveTypes = readJson("data/objective-types.json");
const quests = readJson("data/quests.json").quests;
const details = readJson("data/quest-details.json");

function field(key) { return fields.filter(function (f) { return f.key === key; })[0] || {}; }

function hasName(name) { return typeof name === "string" && /[A-Za-z぀-ヿ一-鿿]/.test(name); }

// Name tables: every id inside the field's range, every name a word.
[["data/monster-ids.json", monsters, field("largeSpawnAreas[].spawns[].monsterId")]].forEach(function (t) {
  Object.keys(t[1]).forEach(function (id) {
    if (Number(id) === 0) return; // "None", the picker's empty choice
    const range = t[2].range;
    if (range && (Number(id) < range.min || Number(id) > range.max)) {
      fail(t[0] + ": id " + id + " (\"" + t[1][id] + "\") is outside " + range.min + ".." + range.max + " (" + t[2].key + ")");
    } else if (!hasName(t[1][id])) {
      fail(t[0] + ": id " + id + " has no real name (\"" + t[1][id] + "\")");
    }
  });
});

// Objective types: the names here and the builder's dropdown table agree.
["body.objective0.type", "body.objective1.type", "body.objective2.type"].forEach(function (key) {
  const values = field(key).values || {};
  Object.keys(objectiveTypes).forEach(function (id) {
    if (values[id] !== objectiveTypes[id]) fail(key + ": value " + id + " is \"" + values[id] + "\" here, \"" + objectiveTypes[id] + "\" in data/objective-types.json");
  });
  Object.keys(values).forEach(function (id) {
    if (!(id in objectiveTypes)) fail(key + ": value " + id + " is not in data/objective-types.json");
  });
});

// Ids used by the catalog data.
const unnamedMaps = field("body.mapId").unnamed || {};
const unnamedAreas = new Set((ref.unnamedAreaIds.ids || []).map(String));
const missing = { map: {}, area: {}, item: {}, monster: {} };
function miss(kind, id, quest) { (missing[kind][id] = missing[kind][id] || []).push(quest); }
Object.keys(details).forEach(function (qid) {
  const d = details[qid];
  const map = maps[String(d.mapId)];
  if (!(map && map.name) && !(String(d.mapId) in unnamedMaps)) miss("map", d.mapId, qid);
  if (!(String(d.areaId) in areas) && !unnamedAreas.has(String(d.areaId))) miss("area", d.areaId, qid);
  if (d.requirementItemId && !(String(d.requirementItemId) in items)) miss("item", d.requirementItemId, qid);
});
const monsterNames = new Set(Object.keys(monsters).map(function (id) { return monsters[id]; }));
// The catalog uses the field guide's names (dev/make-quest-monsters.py); a guide entry with game ids
// (data/monsters/index.json "ids") names those ids. dev/check-catalog-monsters.js checks the pages.
readJson("data/monsters/index.json").forEach(function (m) { if ((m.ids || []).length) monsterNames.add(m.name); });
const NO_GUIDE_PAGE = { "Shagaru Magala": 164 }; // in data/monster-ids.json, no guide page yet
Object.keys(NO_GUIDE_PAGE).forEach(function (name) {
  if (monsters[NO_GUIDE_PAGE[name]] === name) monsterNames.add(name);
});
const aliases = ref.monsterNameAliases || {};
const catalogErrors = {};
quests.forEach(function (q) {
  (q.monsters || []).forEach(function (name) {
    if (monsterNames.has(name)) return;
    const alias = aliases[name];
    if (!alias) { miss("monster", name, q.id); return; }
    if (alias.catalogError) (catalogErrors[name] = catalogErrors[name] || []).push(q.id);
  });
});
Object.keys(missing).forEach(function (kind) {
  Object.keys(missing[kind]).forEach(function (id) {
    const list = missing[kind][id];
    fail("data: " + kind + " " + id + " has no name (" + list.length + " quests, e.g. " + list.slice(0, 3).join(", ") + ")");
  });
});
Object.keys(catalogErrors).forEach(function (name) {
  notes.push("known catalog error (docs/quest-fields.md): data/quests.json lists \"" + name + "\" for " +
    catalogErrors[name].length + " quests; " + aliases[name].why);
});

// Known gaps that are no longer gaps: keep the lists honest.
Object.keys(unnamedMaps).forEach(function (id) {
  if (maps[id] && maps[id].name) fail("quest-fields.json body.mapId lists map " + id + " as unnamed, but data/map-ids.json names it " + maps[id].name);
});
unnamedAreas.forEach(function (id) {
  if (id in areas) fail("quest-fields.json unnamedAreaIds lists area " + id + ", but data/area-ids.json names it");
});
Object.keys(field("largeSpawnAreas[].spawns[].monsterId").unnamed || {}).forEach(function (id) {
  if (id in monsters) fail("quest-fields.json lists monster " + id + " as unnamed, but data/monster-ids.json names it");
});

// Map names (docs/maps.md): one entry per map the client knows, every name different, so the builder's
// dropdown never shows two maps alike; the groups are the builder's, and only unused maps are "Unused".
const mapAreas = readJson("data/map-areas.json");
const editorSource = fs.readFileSync(path.join(ROOT, "js/quest-editor.js"), "utf8");
const groupsMatch = /var MAP_GROUPS = (\[[^\]]*\])/.exec(editorSource);
const MAP_GROUPS = groupsMatch ? JSON.parse(groupsMatch[1].replace(/\s+/g, " ")) : [];
if (!MAP_GROUPS.length) fail("js/quest-editor.js: no MAP_GROUPS list found");
const UNUSED_GROUP = MAP_GROUPS[MAP_GROUPS.length - 1];
const MAP_CONFIDENCE = ["confirmed", "likely", "guess"];
const mapUse = {};
Object.keys(details).forEach(function (qid) { const m = String(details[qid].mapId); mapUse[m] = (mapUse[m] || 0) + 1; });
const mapLabels = {};
Object.keys(mapAreas).forEach(function (id) {
  const m = maps[id];
  if (!m || !hasName(m.name)) { fail("data/map-ids.json: map " + id + " (in data/map-areas.json) has no name"); return; }
  const label = m.name.toLowerCase();
  if (mapLabels[label]) fail("data/map-ids.json: maps " + mapLabels[label] + " and " + id + " are both named \"" + m.name + "\"");
  mapLabels[label] = id;
  if (MAP_GROUPS.indexOf(m.group) < 0) fail("data/map-ids.json: map " + id + " has group \"" + m.group + "\", not one of js/quest-editor.js MAP_GROUPS");
  if (m.quests !== (mapUse[id] || 0)) fail("data/map-ids.json: map " + id + " says " + m.quests + " quests, data/quest-details.json has " + (mapUse[id] || 0));
  if ((m.group === UNUSED_GROUP) !== !mapUse[id]) fail("data/map-ids.json: map " + id + " is in group \"" + m.group + "\" with " + (mapUse[id] || 0) + " quests (only unused maps go in \"" + UNUSED_GROUP + "\")");
  if (MAP_CONFIDENCE.indexOf(m.confidence) < 0) fail("data/map-ids.json: map " + id + " has confidence \"" + m.confidence + "\", not one of " + MAP_CONFIDENCE.join(", "));
  if (!m.source) fail("data/map-ids.json: map " + id + " has no source");
  if (m.base && !mapAreas[id].some(function (a) { return String(areas[a] || "").indexOf(m.base + " - ") === 0; })) {
    fail("data/map-ids.json: map " + id + " has base \"" + m.base + "\", but no area of it in data/area-ids.json starts with it");
  }
});
Object.keys(maps).forEach(function (id) {
  if (!(id in mapAreas)) fail("data/map-ids.json: map " + id + " is not in data/map-areas.json");
});
const mapDoc = fs.readFileSync(path.join(ROOT, "docs/maps.md"), "utf8");
const mapRows = {};
mapDoc.split("\n").forEach(function (line, i) {
  const cells = line.split("|").slice(1, -1).map(function (c) { return c.trim(); });
  if (cells.length !== 8 || !/^\d+$/.test(cells[0])) return;
  mapRows[cells[0]] = true;
  const m = maps[cells[0]];
  const want = m ? [cells[0], m.name, m.group, String((mapAreas[cells[0]] || []).length), String(m.quests)] : [];
  if (!m || cells.slice(0, 5).join("|") !== want.join("|") || cells[6] !== m.confidence) {
    fail("docs/maps.md:" + (i + 1) + ": row for map " + cells[0] + " does not match data/map-ids.json");
  }
});
Object.keys(maps).forEach(function (id) { if (!mapRows[id]) fail("docs/maps.md: no row for map " + id); });

// ---- 5. the readable table in docs/quest-fields.md ----------------------------------------------

const doc = fs.readFileSync(path.join(ROOT, "docs/quest-fields.md"), "utf8");
const rows = {};
doc.split("\n").forEach(function (line, i) {
  const cells = line.split("|").slice(1, -1).map(function (c) { return c.trim(); });
  const key = /^`([^`]+)`$/.exec(cells[0] || "");
  if (!key || cells.length < 10 || !ref.structs[cells[2]]) return; // not a row of the field tables
  if (rows[key[1]]) fail("docs/quest-fields.md:" + (i + 1) + ": " + key[1] + " has two rows");
  rows[key[1]] = { line: i + 1, struct: cells[2], offset: cells[3], bytes: parseInt(cells[4], 10) };
});
fields.forEach(function (f) {
  const row = rows[f.key];
  if (!row) { fail("docs/quest-fields.md: no table row for " + f.key); return; }
  const offset = f.offset === null ? "slot" : f.offset;
  if (row.struct !== f.struct || row.offset !== offset || row.bytes !== f.size) {
    fail("docs/quest-fields.md:" + row.line + ": " + f.key + " is " + row.struct + " " + row.offset + ", " + row.bytes +
      " bytes; quest-fields.json says " + f.struct + " " + offset + ", " + f.size + " bytes");
  }
});
Object.keys(rows).forEach(function (key) {
  if (!seenKeys.has(key)) fail("docs/quest-fields.md:" + rows[key].line + ": row for " + key + ", which is not in quest-fields.json");
});

// ---- report -------------------------------------------------------------------------------------

notes.forEach(function (n) { console.log("note: " + n); });
if (problems.length) {
  problems.forEach(function (p) { console.log("FAIL: " + p); });
  console.log(problems.length + " problem(s)");
  process.exit(1);
}
const counts = {};
fields.forEach(function (f) { counts[f.confidence] = (counts[f.confidence] || 0) + 1; });
console.log("quest fields OK: " + fields.length + " fields (" + CONFIDENCE.map(function (c) { return (counts[c] || 0) + " " + c; }).join(", ") +
  "); " + codecSummary + "; editor: " + editorWrites + " writes, " + hints + " offset hints (" + labelled.size + " fields labelled)");
