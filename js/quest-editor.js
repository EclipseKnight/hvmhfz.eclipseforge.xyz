/* Quest builder: a new quest as a QuestCodec model, edited as a private draft. The server writes the
   bytes. Nothing here opens a live quest file; every draft starts from the blank quest the API owns.

   The page is laid out in the order a quest is built: basics, map and start area, objectives, monsters and
   their areas, rewards and supplies, text, then review and submit. Every control writes one field of the
   model the server sent, and nothing else; the controls themselves come from js/builder-ui.js, shared with
   the Road builder. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var UI = window.BuilderUI;
  var el = UI.el;
  var note = UI.note;

  /* The eight text slots by their index in the file. The names are the labels of texts[N].text in
     data/quest-fields.json (these are the fallback when it does not load); Title is edited under Basics. */
  var SLOTS = {
    0: { name: "Title", hint: "The quest's name on the quest board.", rows: 1, wide: true },
    1: { name: "Main target", hint: "The main target line, for example \"Hunt a Tigrex\".", rows: 2, wide: true },
    2: { name: "Sub-target A", hint: "The sub-target A line. Write \"None\" when the quest has no sub-target A.", rows: 2 },
    3: { name: "Sub-target B", hint: "The sub-target B line. Write \"None\" when the quest has no sub-target B.", rows: 2 },
    4: { name: "Clear condition", hint: "What clears the quest, for example \"Complete the main target\".", rows: 2, wide: true },
    5: { name: "Fail conditions", hint: "When the quest fails, for example \"Reward money hits zero / Time runs out\".", rows: 2 },
    6: { name: "Client", hint: "Who posted the quest.", rows: 1 },
    7: { name: "Description", hint: "The request text on the quest card.", rows: 4, wide: true }
  };
  var TEXT_ORDER = [1, 4, 7, 6, 5, 2, 3];

  /* body +0x20 counts 30 ticks a second, so a minute is 1 800 of them. */
  var TICKS_PER_MINUTE = 1800;

  /* The blank quest is on map 26. The API gives a new quest the per-area tables (trigger zones, area rectangles,
     gathering points, area zones) of its chosen map, for the maps GET /api/account/quests/maps lists; any
     other map is refused with 400. When that list cannot be loaded, only the blank's own map is offered. */
  var BLANK_MAP = 26;

  /* Objective types no quest file uses; their names come from the overlay only (builder item 11). */
  var UNTESTED_TYPES = { 16: true, 131072: true, 262144: true };

  /* Reward group conditions in the order the picker offers them, with the group each sits in. The names come
     from data/quest-fields.json (rewardGroups[].groupId); ids 0..10 are never paid (builder item 6). */
  var CONDITION_ORDER = [
    [32769, "Objectives"], [32768, "Objectives"], [32770, "Objectives"], [32771, "Objectives"],
    [32772, "Extra condition (header +0x80 counter)"], [32773, "Extra condition (header +0x80 counter)"],
    [32774, "Extra condition (header +0x80 counter)"],
    [41, "Special conditions"], [42, "Special conditions"], [43, "Special conditions"], [44, "Special conditions"],
    [45, "Special conditions"], [46, "Special conditions"], [47, "Special conditions"]
  ];
  /* A new group takes the first of these its quest does not use yet: main target, then always paid. */
  var NEW_GROUP_CONDITIONS = [32769, 32768, 32770, 32771];

  var params = new URLSearchParams(window.location.search);
  /* The old address for a copy of a live quest. It is kept only so the page can show the server's refusal
     instead of a blank editor that looks like it worked. */
  var liveId = parseInt(params.get("id"), 10);
  var draftParam = parseInt(params.get("draft"), 10);

  var root = document.getElementById("editor-root");
  var reviewBox = document.getElementById("editor-review");
  var reviewPanel = document.getElementById("editor-review-panel");
  var titleEl = document.getElementById("editor-title");
  var subEl = document.getElementById("editor-sub");
  var statusEl = document.getElementById("editor-status");
  var draftNote = document.getElementById("editor-draft-note");
  var draftsBody = document.getElementById("editor-drafts");
  var saveBtn = document.getElementById("editor-save");
  var downloadBtn = document.getElementById("editor-download");
  var submitBtn = document.getElementById("editor-submit");
  var buttons = [saveBtn, downloadBtn, submitBtn];

  var state = { model: null, draftId: null, revision: 0, busy: false, mapMessage: "", supplyShown: {},
    serverMaps: null, mapsNote: "" };

  // ---- server calls --------------------------------------------------------------------------

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function api(path, options) {
    var opts = options || {};
    var headers = opts.headers || {};
    headers.Authorization = "Bearer " + token();
    opts.headers = headers;
    return fetch(API + path, opts).then(function (res) {
      if (res.status === 401) {
        window.HvNext.toSignin(); // back here after sign-in (js/signin-next.js)
        throw new Error("Sign in to use the quest builder.");
      }
      return res;
    });
  }

  function body(res) {
    return res.json().catch(function () { return null; }).then(function (payload) {
      if (!res.ok) {
        var error = new Error((payload && payload.message) || "The server answered " + res.status + ".");
        error.status = res.status;
        throw error;
      }
      return payload;
    });
  }

  // ---- lookup tables -------------------------------------------------------------------------

  var mapIds = {};
  var mapAreas = {};
  var areaIds = {};
  var itemIds = {};
  var objectiveTypes = {};
  var monsterIds = {};
  var fieldRef = {};

  function loadTables() {
    function grab(url) {
      return fetch(url).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    }
    return Promise.all([
      grab("/data/map-ids.json"), grab("/data/map-areas.json"), grab("/data/area-ids.json"),
      grab("/data/item-ids.json"), grab("/data/objective-types.json"), grab("/data/monster-ids.json"),
      grab("/data/quest-fields.json"), UI.loadIcons(["monsters", "items"])
    ]).then(function (r) {
      mapIds = r[0] || {}; mapAreas = r[1] || {}; areaIds = r[2] || {}; itemIds = r[3] || {};
      objectiveTypes = r[4] || {}; monsterIds = r[5] || {};
      ((r[6] || {}).fields || []).forEach(function (f) { fieldRef[f.key] = f; });
    });
  }

  /** The maps the server has area tables for (GET /api/account/quests/maps); on failure, the blank's map only. */
  function loadServerMaps() {
    return api("/api/account/quests/maps").then(body).then(function (answer) {
      var list = answer && Array.isArray(answer.maps) ? answer.maps : null;
      if (!list || !list.length) throw new Error("empty map list");
      state.serverMaps = {};
      list.forEach(function (id) { state.serverMaps[String(id)] = true; });
    }).catch(function () {
      state.serverMaps = {};
      state.serverMaps[String(BLANK_MAP)] = true;
      state.mapsNote = "The server's list of maps could not be loaded, so only map " + BLANK_MAP + " is offered for"
        + " now. Reload the page to try again.";
    });
  }

  /** True when the server can build a quest on this map (always true before the list has loaded). */
  function mapOnServer(mapId) {
    return !state.serverMaps || state.serverMaps[String(mapId)] === true;
  }

  // ---- the field reference (data/quest-fields.json) ------------------------------------------

  /**
   * The quest-fields.json entries a control writes, for its bytes label and range: F("body.zenny"),
   * F(["body.questClass", "header.questClass"]) for a value kept in two places, F("body.iconMonsters[]", 2) for
   * one element of an array, F("texts[#].text", 3) with # standing for the index. null when the file did not
   * load (the control then has no bytes label). dev/check-quest-fields.js checks every literal key here
   * against the model property the control assigns next.
   */
  function F(keys, index) {
    var list = [].concat(keys).map(function (k) {
      return fieldRef[String(k).replace("#", index)];
    }).filter(Boolean);
    if (!list.length) return null;
    return { fields: list, index: String(keys).indexOf("#") >= 0 ? null : index };
  }

  /** A field's bytes as text, for a field the page mentions but does not edit. */
  function refText(key) {
    return UI.bytesText(F(key));
  }

  /** opts with min and max from the field's range in the JSON (opts' own min and max are the fallback). */
  function ranged(ref, opts) {
    var r = ref && ref.fields[0].range;
    if (r) { opts.min = r.min; opts.max = r.max; }
    opts.ref = ref;
    return opts;
  }

  function valueName(v) {
    return v && typeof v === "object" ? v.name : v;
  }

  function capital(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  /** A labelled field with the bytes label of ref; ref comes first so the check reads it before the control. */
  function fieldFor(ref, label, control, hint, opts) {
    var o = opts || {};
    o.ref = ref;
    return UI.field(label, control, hint, o);
  }

  /** A number field ranged and labelled from ref. */
  function numberFor(ref, label, opts, hint) {
    return UI.numberField(label, ranged(ref, opts), hint);
  }

  function byLabel(a, b) {
    return a.label.localeCompare(b.label, undefined, { numeric: true }) || a.value - b.value;
  }

  var monsterList = null;
  /** None, then every monster the game knows by name (ids 1 to 176), by name. */
  function monsterOptions() {
    if (monsterList) return monsterList;
    var list = Object.keys(monsterIds).map(Number).filter(function (id) {
      return id > 0 && id <= 176 && /[A-Za-z]/.test(monsterIds[id]);
    }).map(function (id) { return { value: id, label: monsterIds[id] }; }).sort(byLabel);
    monsterList = [{ value: 0, label: "None" }].concat(list);
    return monsterList;
  }

  var itemList = null;
  /** None, then all items by name. */
  function itemOptions() {
    if (itemList) return itemList;
    var list = Object.keys(itemIds).map(Number).filter(function (id) { return id > 0; })
      .map(function (id) { return { value: id, label: itemIds[id] }; }).sort(byLabel);
    itemList = [{ value: 0, label: "None" }].concat(list);
    return itemList;
  }

  function itemName(id) {
    return Number(id) ? (itemIds[String(id)] || "Unlisted item (id " + id + ")") : "None";
  }

  function monsterName(id) {
    return Number(id) ? (monsterIds[String(id)] || "Unlisted monster (id " + id + ")") : "None";
  }

  /* Zenith forms (body.monsterVariants[0-1] and [2-4], data/quest-fields.json): one byte per slot of the first
     large-monster list, which the API writes as that list's distinct monsters, first appearance first. 16 there
     makes that monster Zenith in the whole quest (the client asks by monster id). Offered as "Zenith <name>", with
     the monster's negative id as the picker value, for the monsters the live quest files make Zenith (the API's
     QuestCodec.ZENITH_MONSTERS, which refuses any other); only in the first large-monster list, whose five slots
     the bytes describe. A model without the field (an API from before it) offers none. */
  var VARIANT_ZENITH = 16;
  /* Every one of the 617 live quests with a Zenith monster also sets body.variantFlags3 bit 4 (no other quest
     does) and a Zenith monster level, header.monsterLevel 64 to 67 (Zenith rank 1 to 4; the API refuses a Zenith
     monster without both). keepForms sets them with the first Zenith monster and undoes them with the last. */
  var FLAGS3_ZENITH = 0x10;
  var ZENITH_LEVELS = [64, 65, 66, 67];
  var levelBeforeZenith = null; // header.monsterLevel before the first Zenith monster, put back after the last
  var ZENITH_MONSTERS = [11, 15, 17, 21, 48, 51, 74, 76, 80, 83, 95, 99, 103, 109, 110, 111, 112, 121, 129, 140, 141, 142, 170];

  function canZenith(model) {
    var v = model && model.body && model.body.monsterVariants;
    return Array.isArray(v) && v.length === 5;
  }

  /** The first large-monster list's distinct monsters, first appearance first: the slots the variants describe. */
  function slotMonsters(model) {
    var ids = [];
    var first = (model.largeSpawnAreas || [])[0];
    ((first && first.spawns) || []).forEach(function (spawn) {
      if (ids.indexOf(spawn.monsterId) < 0) ids.push(spawn.monsterId);
    });
    return ids;
  }

  /** {id: true} for the monsters the quest makes Zenith now. */
  function zenithSet(model) {
    var set = {};
    if (!canZenith(model)) return set;
    slotMonsters(model).forEach(function (id, i) {
      if (i < 5 && model.body.monsterVariants[i] === VARIANT_ZENITH) set[id] = true;
    });
    return set;
  }

  /** Runs fn(set), which changes the first list and the Zenith set, then puts each Zenith monster's 16 in its new
      slot. A slot that is no longer Zenith goes back to 0; other values the file had stay where they are. */
  function keepForms(model, fn) {
    var set = zenithSet(model);
    fn(set);
    if (!canZenith(model)) return;
    var ids = slotMonsters(model);
    var variants = model.body.monsterVariants;
    var any = false;
    for (var i = 0; i < 5; i++) {
      var zenith = i < ids.length && !!set[ids[i]] && ZENITH_MONSTERS.indexOf(ids[i]) >= 0;
      if (zenith) variants[i] = VARIANT_ZENITH;
      else if (variants[i] === VARIANT_ZENITH) variants[i] = 0;
      any = any || zenith;
    }
    var flags = model.body.variantFlags3 || 0;
    model.body.variantFlags3 = any ? (flags | FLAGS3_ZENITH) : (flags & ~FLAGS3_ZENITH);
    if (!model.header) return;
    var level = model.header.monsterLevel;
    if (any && ZENITH_LEVELS.indexOf(level) < 0) {
      levelBeforeZenith = level;
      model.header.monsterLevel = ZENITH_LEVELS[0];
    } else if (!any && ZENITH_LEVELS.indexOf(level) >= 0 && levelBeforeZenith !== null) {
      model.header.monsterLevel = levelBeforeZenith;
      levelBeforeZenith = null;
    }
  }

  /** The Zenith rank picker (header.monsterLevel 64 to 67), shown while the quest has a Zenith monster. */
  function zenithRank(model) {
    var header = model.header;
    var options = ZENITH_LEVELS.map(function (level, i) {
      return { value: level, label: "Zenith \u2605" + (i + 1), hint: "monster level " + level };
    });
    return fieldFor(F("header.monsterLevel"), "Zenith rank", UI.picker({
      options: options, value: header.monsterLevel,
      onChange: writes(function (v) { header.monsterLevel = v; })
    }), "The level of every large monster in the quest, as Capcom's 1\u2605 to 4\u2605 Zenith quests have it.");
  }

  /** A monster as the quest has it: "Zenith Rathalos" when the quest makes it Zenith. */
  function formName(model, id) {
    return (zenithSet(model)[id] ? "Zenith " : "") + monsterName(id);
  }

  var zenithList = null;
  /** monsterOptions with the Zenith forms (value -id), by name. */
  function zenithOptions() {
    if (zenithList) return zenithList;
    var zenith = ZENITH_MONSTERS.filter(function (id) { return monsterIds[String(id)]; }).map(function (id) {
      return { value: -id, label: "Zenith " + monsterName(id) };
    });
    var list = monsterOptions().slice(1).concat(zenith).sort(byLabel);
    zenithList = [monsterOptions()[0]].concat(list);
    return zenithList;
  }

  function areasForMap(mapId) {
    return (mapAreas[String(mapId)] || []).slice();
  }

  /** The map's name from data/map-ids.json: every map has its own ("Volcano (night)", "Ancient Tower 2"). */
  function mapName(mapId) {
    var entry = mapIds[String(mapId)];
    return entry && entry.name ? entry.name : "Unlisted map (id " + mapId + ")";
  }

  /* The dropdown's groups, in this order; data/map-ids.json gives each map one. Maps no quest file uses are
     in the last group (dev/check-quest-fields.js keeps the groups and this list in step). */
  var MAP_GROUPS = ["Field maps", "Arenas and battle stages", "Towers", "Forts and sieges",
    "Raviente, Road and special", "Unused / untested"];

  var mapList = null;
  /** Every map, by group: the ones the server can build first, the most used first; the others are shown but
      cannot be chosen. The hint gives areas, quests and how sure the name is. */
  function mapOptions() {
    if (mapList) return mapList;
    mapList = Object.keys(mapIds).map(Number).map(function (id) {
      var entry = mapIds[id] || {};
      var count = areasForMap(id).length;
      var quests = entry.quests || 0;
      var hint = [count + (count === 1 ? " area" : " areas")];
      hint.push(quests ? quests + (quests === 1 ? " quest" : " quests") : "no quest uses it");
      if (quests && entry.confidence === "guess") hint.push("name is a guess");
      if (entry.ja) hint.push(entry.ja);
      var group = MAP_GROUPS.indexOf(entry.group) >= 0 ? entry.group : MAP_GROUPS[MAP_GROUPS.length - 1];
      var off = !mapOnServer(id);
      return { value: id, label: mapName(id), group: group, quests: quests, disabled: off,
        hint: off ? "not available yet (no template on the server)" : hint.join(", ") };
    }).sort(function (a, b) {
      return MAP_GROUPS.indexOf(a.group) - MAP_GROUPS.indexOf(b.group) || a.disabled - b.disabled
        || b.quests - a.quests || byLabel(a, b);
    });
    return mapList;
  }

  /** An area's name without the map's own name in front ("Area 3, day"). */
  function areaName(areaId, mapId) {
    var name = areaIds[String(areaId)];
    if (!name || /^Loading/.test(name)) return "Unnamed area";
    var entry = mapIds[String(mapId)];
    // data/area-ids.json writes "<location> - Area 3 - Day"; base is that location ("Volcano" for "Volcano (night)").
    var prefix = entry && entry.base ? entry.base + " - " : null;
    if (prefix && name.indexOf(prefix) === 0) name = name.slice(prefix.length);
    return name.split(" - ").join(", ");
  }

  /** The areas of one map, its first area (where quests start) first, then by name. */
  function areaOptions(mapId) {
    var areas = areasForMap(mapId);
    if (!areas.length) return [];
    var first = { value: areas[0], label: areaName(areas[0], mapId), hint: "first area of the map" };
    var rest = areas.slice(1).map(function (id) { return { value: id, label: areaName(id, mapId) }; }).sort(byLabel);
    return [first].concat(rest);
  }

  function areaOnMap(areaId, mapId) {
    var areas = areasForMap(mapId);
    return !areas.length || areas.indexOf(Number(areaId)) !== -1;
  }

  function areaLabel(areaId, mapId) {
    return areaName(areaId, mapId) + " (id " + areaId + ")";
  }

  function typeOptions() {
    var named = (fieldRef["body.objective0.type"] || {}).values || objectiveTypes;
    return Object.keys(named).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
      var opt = { value: id, label: id === 0 ? "Not used" : valueName(named[id]) };
      if (UNTESTED_TYPES[id]) opt.hint = "untested, unconfirmed: no quest file uses it";
      return opt;
    });
  }

  /** Quest class: the values quest-fields.json names (0, 1, 2, 3, 7, 8, 9); the names rest on one source. */
  function classOptions() {
    var named = (fieldRef["body.questClass"] || {}).values || {};
    return Object.keys(named).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
      return { value: id, label: valueName(named[id]) };
    });
  }

  /** Max hunters: the cap is the low 3 bits, 0 also means 4 (the quest files write 0 or 1). */
  function hunterOptions() {
    var named = (fieldRef["body.maxHunters"] || {}).values || {};
    var hints = { 0: "as the quest files write 4", 1: "", 2: "untested: no quest file uses it",
      3: "untested: no quest file uses it", 4: "the blank's value; no quest file uses it" };
    return Object.keys(named).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
      var name = capital(String(valueName(named[id])).replace(/ \(.*\)$/, ""));
      return { value: id, label: id === 1 ? "Solo" : "Up to " + name, hint: hints[id] || "" };
    });
  }

  /** Reward group conditions with the JSON's names: "main target reward (0x8001; ...)" becomes the label
      "Main target reward" and the hint "0x8001; ...". */
  function conditionOptions() {
    var named = (fieldRef["rewardGroups[].groupId"] || {}).values || {};
    return CONDITION_ORDER.filter(function (c) { return named[c[0]]; }).map(function (c) {
      var name = String(valueName(named[c[0]]));
      var m = /^(.*?) \((.*)\)$/.exec(name);
      return { value: c[0], label: capital(m ? m[1] : name), hint: m ? m[2] : "", group: c[1] };
    });
  }

  function conditionLabel(id) {
    return id <= 10 ? "Never paid (condition " + id + ")" : "Unnamed condition (" + id + ")";
  }

  function nextCondition(groups) {
    var used = groups.map(function (g) { return g.groupId; });
    var free = NEW_GROUP_CONDITIONS.filter(function (id) { return used.indexOf(id) === -1; });
    return free.length ? free[0] : 32768;
  }

  // ---- the review panel follows every change --------------------------------------------------

  var reviewTimer = null;
  function changed() {
    clearTimeout(reviewTimer);
    reviewTimer = setTimeout(renderReview, 120);
  }

  /** Wraps a model write so the review panel follows it. */
  function writes(fn) {
    return function (v) { fn(v); changed(); };
  }

  // ---- shared bits ---------------------------------------------------------------------------

  function shiftJisBytes(text) {
    var total = 0;
    for (var i = 0; i < text.length; i++) total += text.charCodeAt(i) < 0x80 ? 1 : 2;
    return total;
  }

  /** True when the slot's string is the last one in the file: its room is only its own bytes, so any text
      written there is put at the end of the file (builder item 10; QuestCodec.parseTexts). */
  function lastString(slot) {
    return (state.model.texts || []).every(function (other) { return other.offset <= slot.offset; });
  }

  function slotField(slot) {
    var spec = SLOTS[slot.index] || { name: "Text " + (slot.index + 1), hint: "", rows: 2 };
    var ref = F("texts[#].text", slot.index);
    var name = ref ? ref.fields[0].label : spec.name;
    var wrap = el("div", "field" + (spec.wide ? " bui-wide" : ""));
    var lab = el("div", "slot-lab");
    var label = el("label", null, name);
    label.htmlFor = "slot-" + slot.index;
    if (ref && UI.unsure(ref)) {
      label.appendChild(document.createTextNode(" "));
      label.appendChild(el("span", "bui-unsure", "(unconfirmed)"));
      label.lastChild.title = "What this text is was read from sample quest files, one source (docs/quest-fields.md).";
    }
    var count = el("span", "slot-count");
    var last = typeof slot.offset === "number" && lastString(slot);
    lab.appendChild(label);
    lab.appendChild(count);

    var area = el(spec.rows === 1 ? "input" : "textarea");
    area.id = "slot-" + slot.index;
    if (spec.rows === 1) area.type = "text"; else area.setAttribute("rows", String(spec.rows));
    area.value = slot.text || "";

    function refresh() {
      var bytes = shiftJisBytes(area.value);
      if (last) {
        // The real room is the string's own NUL; the counter would say "0 of 1 bytes".
        count.textContent = bytes + " bytes · last text in the file, so it is stored at the end of the file";
        count.title = "This string is the last one in the file, so its room is only its own end byte: any text"
          + " here is written at the end of the file. That is harmless.";
        count.classList.add("is-end");
        return;
      }
      var over = bytes + 1 > slot.capacity;
      count.textContent = over
        ? bytes + " bytes, more than the " + slot.capacity + " this text has room for: it is stored at the end of the file"
        : bytes + " of " + slot.capacity + " bytes";
      count.classList.toggle("bad", over);
    }

    area.addEventListener("input", function () {
      slot.text = area.value;
      refresh();
      changed();
    });
    refresh();
    wrap.appendChild(lab);
    var bytesLabel = ref ? el("span", "bui-bytes", UI.bytesText(ref)) : null;
    if (bytesLabel) {
      bytesLabel.setAttribute("data-fields", ref.fields[0].key);
      wrap.appendChild(bytesLabel);
    }
    wrap.appendChild(area);
    if (spec.hint) wrap.appendChild(note(spec.hint));
    return wrap;
  }

  function slotByIndex(model, index) {
    return (model.texts || []).filter(function (s) { return s.index === index; })[0];
  }

  function grid() {
    return el("div", "editor-grid");
  }

  // ---- 1. basics -----------------------------------------------------------------------------

  function basicsSection(model) {
    var b = model.body;
    var p = UI.section("Basics", "name, time and money");
    var title = slotByIndex(model, 0);
    if (title) p.appendChild(slotField(title));
    var g = grid();
    var timeRef = F("body.timeLimit");
    var ticks = timeRef && timeRef.fields[0].range;
    g.appendChild(UI.numberField("Time limit", {
      ref: timeRef, id: "meta-time", value: Math.round((b.timeLimit || 0) / TICKS_PER_MINUTE), unit: "minutes",
      min: ticks ? Math.ceil(ticks.min / TICKS_PER_MINUTE) : 1, max: ticks ? Math.floor(ticks.max / TICKS_PER_MINUTE) : undefined,
      onChange: writes(function (v) { b.timeLimit = v * TICKS_PER_MINUTE; })
    }, "The quest files use 10 to 50 minutes; longer is untested."));
    var hunters = hunterOptions();
    if (hunters.length) {
      g.appendChild(fieldFor(F("body.maxHunters"), "Players", UI.picker({
        options: hunters, value: b.maxHunters, showIds: true,
        unknownLabel: function (v) { return "Other (value " + v + ", the game reads " + (v & 7) + ")"; },
        onChange: writes(function (v) { b.maxHunters = v; })
      }), "How many hunters can join. The game reads only the low 3 bits, and 0 also means 4."));
    } else {
      g.appendChild(numberFor(F("body.maxHunters"), "Players", {
        id: "meta-players", value: b.maxHunters, min: 1, max: 4,
        onChange: writes(function (v) { b.maxHunters = v; })
      }, "How many hunters can join, 1 to 4."));
    }
    g.appendChild(numberFor(F("body.zenny"), "Contract fee", {
      id: "meta-zenny", value: b.zenny, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.zenny = v; })
    }, "Paid to accept the quest."));
    g.appendChild(numberFor(F("body.rewardMoney"), "Reward money", {
      id: "meta-money", value: b.rewardMoney, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.rewardMoney = v; })
    }, "Paid for the main target, on a clear."));
    var countField = null;
    g.appendChild(fieldFor(F("body.iconLabelId"), "Item needed to enter", UI.picker({
      options: itemOptions(), value: b.iconLabelId, kind: "item", showIds: true,
      unknownLabel: itemName, onChange: writes(function (v) {
        b.iconLabelId = v;
        // Item and count go together: both 0 or both set, as in every quest file.
        var count = v ? (b.iconLabelCount || 1) : 0;
        if (count !== b.iconLabelCount) {
          b.iconLabelCount = count;
          if (countField) countField.input.setValue(count);
        }
      })
    }), "Required to accept the quest, and shown on the quest info page with the count. Whether the game takes"
      + " it when the quest starts is not known. None for no item."));
    countField = numberFor(F("body.iconLabelCount"), "How many are needed", {
      id: "meta-requirement-count", value: b.iconLabelCount, min: 0,
      onChange: writes(function (v) { b.iconLabelCount = v; })
    }, "0 with no item, at least 1 with one.");
    g.appendChild(countField);
    p.appendChild(g);

    var more = el("details", "bui-more-settings");
    more.appendChild(el("summary", null, "More settings"));
    var g2 = grid();
    var classes = classOptions();
    if (classes.length) {
      g2.appendChild(fieldFor(F(["body.questClass", "header.questClass"]), "Quest class", UI.picker({
        options: classes, value: b.questClass, showIds: true,
        unknownLabel: function (v) { return "Unnamed class (value " + v + ")"; },
        onChange: writes(function (v) { b.questClass = v; if (model.header) model.header.questClass = v; })
      }), "Sets both copies: the game reads the header's. The names come from the quest lists each class"
        + " appears in; the game's code names none."));
    } else {
      g2.appendChild(numberFor(F(["body.questClass", "header.questClass"]), "Quest class", {
        id: "meta-class", value: b.questClass, min: 0, max: 255,
        onChange: writes(function (v) { b.questClass = v; if (model.header) model.header.questClass = v; })
      }, "The game's class number for the quest."));
    }
    more.appendChild(g2);
    p.appendChild(more);
    return p;
  }

  // ---- 2. map and start area -----------------------------------------------------------------

  function allSpawns(model) {
    var list = [];
    (model.largeSpawnAreas || []).forEach(function (area) { (area.spawns || []).forEach(function (s) { list.push(s); }); });
    (model.smallSpawnGroups || []).forEach(function (group) {
      (group.areas || []).forEach(function (area) { (area.spawns || []).forEach(function (s) { list.push(s); }); });
    });
    return list;
  }

  /** The map changed (body.mapId and the map record are already set): every area list follows it, and
      anything left outside the new map is said in words. */
  function setMap(model, mapId) {
    var areas = areasForMap(mapId);
    var lines = [];
    var starts = model.startAreas || [];
    if (areas.length && starts.length && areas.indexOf(starts[0].areaId) === -1) {
      var before = starts[0].areaId;
      starts.forEach(function (a) { a.areaId = areas[0]; });
      // The map record's area is the base camp, kept with the start area (builder item 3).
      if (model.map) model.map.areaId = areas[0];
      lines.push("Start area moved to " + areaName(areas[0], mapId) + ": the old one (id " + before + ") is not part of "
        + mapName(mapId) + ".");
    }
    var off = allSpawns(model).filter(function (s) { return !areaOnMap(s.areaId, mapId); }).length;
    if (off) {
      lines.push(off + (off === 1 ? " monster is" : " monsters are") + " in an area that is not part of " + mapName(mapId)
        + ". " + (off === 1 ? "It is" : "They are") + " marked under Monsters: pick one of this map's areas.");
    }
    state.mapMessage = lines.join(" ");
    redraw("map");
    redraw("monsters");
    changed();
  }

  function mapSection(model) {
    var b = model.body;
    var p = UI.section("Map and start area", "where the hunt takes place");
    var g = grid();
    var known = Object.keys(mapIds).length > 0;
    // The map record (header pointer 9) indexes the game's per-map area lists: it always follows body.mapId.
    if (known) {
      var mapPicker = UI.picker({
        options: mapOptions(), value: b.mapId, showIds: true,
        unknownLabel: function (v) { return "Unlisted map (id " + v + ")"; },
        onChange: function (v) { b.mapId = v; if (model.map) model.map.mapId = v; setMap(model, v); }
      });
      if (!mapOnServer(b.mapId)) mapPicker.setProblem("The server has no area tables for this map yet: choose another.");
      g.appendChild(fieldFor(F(["body.mapId", "map.mapId"]), "Map", mapPicker, "Choosing a map changes the area"
        + " lists below to that map's areas. Sets the body's map and the map record; the server adds the map's"
        + " area tables. Maps marked \u201cnot available yet\u201d have no template on the server."));
    } else {
      g.appendChild(numberFor(F(["body.mapId", "map.mapId"]), "Map", {
        id: "meta-map", value: b.mapId, min: 0,
        onChange: function (v) { b.mapId = v; if (model.map) model.map.mapId = v; setMap(model, v); }
      }, "The map list could not be loaded, so the map is the game's map number."));
    }
    var starts = model.startAreas || [];
    if (starts.length) {
      var options = areaOptions(b.mapId);
      var startRef = F(["startAreas[].areaId", "map.areaId"]);
      var start = UI.picker({
        options: options, value: starts[0].areaId, showIds: true,
        unknownLabel: function (v) { return areaLabel(v, b.mapId); },
        onChange: writes(function (v) {
          starts.forEach(function (a) { a.areaId = v; });
          if (model.map) model.map.areaId = v;
          start.setProblem("");
        })
      });
      if (!areaOnMap(starts[0].areaId, b.mapId)) start.setProblem("This area is not part of the chosen map.");
      g.appendChild(fieldFor(startRef, "Start area", start, (options.length
        ? "Where the party arrives. Most quests start in the map's first area."
        : "This map has no known area list, so every area id is allowed.")
        + " Sets all four start records and the map record's base camp."));
    }
    p.appendChild(g);
    if (state.mapsNote) p.appendChild(note(state.mapsNote, "bui-notice"));
    if (state.mapMessage) {
      var msg = note(state.mapMessage, "bui-notice");
      msg.setAttribute("role", "status");
      p.appendChild(msg);
    }
    return p;
  }

  // ---- 3. objectives -------------------------------------------------------------------------

  function isItemObjective(type) {
    return (type & 2) && !(type & 1);
  }

  /* The three objective records: the main target and sub-targets A and B, each with the body field that pays
     its reward money (builder item 14). */
  var OBJECTIVES = [
    { key: "objective0", name: "Main target", money: "body.rewardMoney", paid: "Reward money, under Basics" },
    { key: "objective1", name: "Sub-target A", money: "body.objective1Money", paid: "kept from the blank, not edited here" },
    { key: "objective2", name: "Sub-target B", money: "body.objective2Money", paid: "kept from the blank, not edited here" }
  ];

  /** The first empty picture ends the list of five, so pictures fill from the left (builder item 13). */
  function packIcons(icons) {
    var kept = icons.filter(function (id) { return Number(id) > 0; });
    var moved = false;
    for (var i = 0; i < icons.length; i++) {
      var next = i < kept.length ? kept[i] : 0;
      if (icons[i] !== next) moved = true;
      icons[i] = next;
    }
    return moved;
  }

  function objectivesSection(model) {
    var b = model.body;
    var p = UI.section("Objectives", "what the hunters must do",
      "The main target clears the quest. Sub-targets A and B are optional; leave them as Not used.");
    OBJECTIVES.forEach(function (spec, index) {
      var objective = b[spec.key];
      if (!objective) return;
      p.appendChild(UI.subhead(spec.name));
      var money = refText(spec.money);
      if (money) p.appendChild(note("Its reward money is " + money + " (" + spec.paid + ")."));
      var g = grid();
      g.appendChild(fieldFor(F("body.objective#.type", index), "Type", UI.picker({
        options: typeOptions(), value: objective.type, showIds: true,
        unknownLabel: function (v) { return "Other (value " + v + ")"; },
        onChange: writes(function (v) { objective.type = v; redraw("objectives"); })
      }), UNTESTED_TYPES[objective.type] ? "Untested: no quest file uses this type, and what its target means is"
        + " not known." : null));
      if (objective.type !== 0) {
        var item = isItemObjective(objective.type);
        g.appendChild(fieldFor(F("body.objective#.target", index), item ? "Item" : "Monster", UI.picker({
          options: item ? itemOptions() : monsterOptions(), value: objective.target, kind: item ? "item" : "monster",
          showIds: true, unknownLabel: item ? itemName : monsterName,
          onChange: writes(function (v) { objective.target = v; })
        }), item ? "The item to deliver." : "The monster this objective counts."));
        g.appendChild(numberFor(F("body.objective#.count", index), "How many", {
          id: "obj-" + index + "-count", value: objective.count, min: 0,
          onChange: writes(function (v) { objective.count = v; })
        }));
      }
      p.appendChild(g);
    });

    var icons = b.iconMonsters || [];
    if (icons.length) {
      p.appendChild(UI.subhead("Monsters on the quest card"));
      p.appendChild(note("The monster pictures the quest card and the quest page show. Usually the first is the"
        + " main target. The first empty picture ends the list, so the pictures fill from the left."));
      var g = grid();
      icons.forEach(function (id, i) {
        g.appendChild(fieldFor(F("body.iconMonsters[]", i), "Picture " + (i + 1), UI.picker({
          options: monsterOptions(), value: id, kind: "monster", showIds: true, unknownLabel: monsterName,
          onChange: writes(function (v) { icons[i] = v; if (packIcons(icons)) redraw("objectives"); })
        })));
      });
      p.appendChild(g);
    }
    return p;
  }

  // ---- 4. monsters and their areas -----------------------------------------------------------

  function spawnsOf(area) {
    if (!area.spawns) area.spawns = [];
    return area.spawns;
  }

  /** where: the spawn area's path in the model ("largeSpawnAreas[0]"), so a server message can find the table. */
  function spawnTable(model, spawns, where) {
    var mapId = model.body.mapId;
    var options = areaOptions(mapId);
    // The first large-monster list holds the slots a Zenith form is kept in (keepForms).
    var forms = where === "largeSpawnAreas[0]" && canZenith(model);
    var zenith = forms ? zenithSet(model) : {};
    var rows = spawns.map(function (spawn, index) {
      var areaRef = F("largeSpawnAreas[].spawns[].areaId");
      var area = options.length ? UI.picker({
        options: options, value: spawn.areaId, compact: true, showIds: true, label: "Area of " + monsterName(spawn.monsterId),
        unknownLabel: function (v) { return areaLabel(v, mapId); },
        onChange: writes(function (v) { spawn.areaId = v; area.setProblem(""); })
      }) : UI.numberInput(ranged(areaRef, {
        value: spawn.areaId, min: 0, label: "Area id", onChange: writes(function (v) { spawn.areaId = v; })
      }));
      if (options.length && !areaOnMap(spawn.areaId, mapId)) area.setProblem("This area is not part of the chosen map: pick another.");
      return [
        { label: "Monster", ref: F("largeSpawnAreas[].spawns[].monsterId"), node: UI.picker({
          options: forms ? zenithOptions() : monsterOptions(), kind: "monster", compact: true, showIds: true,
          value: zenith[spawn.monsterId] ? -spawn.monsterId : spawn.monsterId, iconOf: Math.abs, idOf: Math.abs,
          label: "Monster", unknownLabel: function (v) { return v < 0 ? "Zenith " + monsterName(-v) : monsterName(v); },
          onChange: writes(function (v) {
            if (!forms) { spawn.monsterId = v; return; }
            keepForms(model, function (set) {
              spawn.monsterId = Math.abs(v);
              if (v < 0) set[-v] = true; else delete set[v];
            });
            // A monster is Zenith in the whole quest: its other rows change with it.
            redraw("monsters");
          })
        }) },
        { label: "How many", ref: F("largeSpawnAreas[].spawns[].count"), node: UI.numberInput(ranged(F("largeSpawnAreas[].spawns[].count"), {
          value: spawn.count, min: 0, max: 99, label: "How many", onChange: writes(function (v) { spawn.count = v; })
        })) },
        { label: "Area", ref: areaRef, node: area },
        { cls: "bui-row-end", node: UI.button("Remove", function () {
          keepForms(model, function () { spawns.splice(index, 1); });
          redraw("monsters");
          changed();
        }, "remove", "Remove " + monsterName(spawn.monsterId)) }
      ];
    });
    var t = UI.table(["Monster", "How many", "Area", { label: "", cls: "bui-row-end" }], rows, "No monsters here yet.");
    t.setAttribute("data-where", where);
    return t;
  }

  /** Adds a monster to the first large spawn area, creating that area when the quest has none. */
  function addMonster(model) {
    if (!model.largeSpawnAreas) model.largeSpawnAreas = [];
    if (!model.largeSpawnAreas.length) {
      model.largeSpawnAreas.push({ areaId: 1, reserved: 0, monsterIdsOffset: 0, spawnOffset: 0, spawns: [] });
    }
    var area = model.largeSpawnAreas[0];
    var areas = areasForMap(model.body.mapId);
    // A new monster goes to an area of the chosen map: the first area past the base camp, else the camp. The
    // record's own areaId (1) is a record number, not an area (builder item 4), so it is never the fallback:
    // a map without a known area list takes the start area.
    var starts = model.startAreas || [];
    var where = areas.length ? (areas[1] !== undefined ? areas[1] : areas[0]) : (starts.length ? starts[0].areaId : 0);
    // The main objective's monster when it has one, else the first monster by name.
    var goal = model.body.objective0;
    var first = monsterOptions()[1];
    var monster = goal && goal.type !== 0 && !isItemObjective(goal.type) && goal.target ? goal.target : (first ? first.value : 1);
    keepForms(model, function () { spawnsOf(area).push({ monsterId: monster, count: 1, areaId: where }); });
    redraw("monsters");
    changed();
  }

  function monstersSection(model) {
    var p = UI.section("Monsters and their areas", "who appears, and where");
    if (!model.header) {
      p.appendChild(note("This quest has no monster tables of its own."));
      return p;
    }
    p.appendChild(note("Each row puts monsters in one area of the chosen map. The areas offered are the map's own."));
    if (canZenith(model)) {
      p.appendChild(note("\u201cZenith <name>\u201d is the monster's Zenith form, for the monsters that have one. Pick it in the"
        + " first list of large monsters: a monster is Zenith everywhere in the quest, so its other rows change with it."));
    }
    var large = model.largeSpawnAreas || [];
    if (model.header && Object.keys(zenithSet(model)).length) {
      var rank = grid();
      rank.appendChild(zenithRank(model));
      p.appendChild(rank);
    }
    p.appendChild(UI.subhead("Large monsters"));
    if (!large.length) p.appendChild(UI.table(["Monster", "How many", "Area", ""], [], "No monsters yet."));
    large.forEach(function (area, a) { p.appendChild(spawnTable(model, spawnsOf(area), "largeSpawnAreas[" + a + "]")); });
    var actions = el("div", "bui-actions");
    actions.appendChild(UI.button("Add a monster", function () { addMonster(model); }, "add"));
    p.appendChild(actions);
    (model.smallSpawnGroups || []).forEach(function (group, i) {
      (group.areas || []).forEach(function (area, j) {
        p.appendChild(UI.subhead("Small monsters, set " + (i + 1) + (group.areas.length > 1 ? ", part " + (j + 1) : "")));
        p.appendChild(spawnTable(model, spawnsOf(area), "smallSpawnGroups[" + i + "].areas[" + j + "]"));
      });
    });
    return p;
  }

  // ---- 5. rewards and supplies ---------------------------------------------------------------

  function supplyTable(model) {
    var items = model.startItems || [];
    var rows = [];
    items.forEach(function (entry, index) {
      if (!entry.itemId && !state.supplyShown[index]) return;
      rows.push([
        { label: "Item", ref: F("startItems[].itemId"), node: UI.picker({
          options: itemOptions(), value: entry.itemId, kind: "item", compact: true, showIds: true, label: "Supply item",
          unknownLabel: itemName, onChange: writes(function (v) { entry.itemId = v; })
        }) },
        { label: "How many", ref: F("startItems[].count"), node: UI.numberInput(ranged(F("startItems[].count"), {
          value: entry.count, min: 1, label: "How many", onChange: writes(function (v) { entry.count = v; })
        })) },
        { cls: "bui-row-end", node: UI.button("Remove", function () {
          entry.itemId = 0;
          entry.count = 0;
          delete state.supplyShown[index];
          redraw("rewards");
          changed();
        }, "remove", "Remove " + itemName(entry.itemId)) }
      ]);
    });
    var free = -1;
    for (var i = 0; i < items.length; i++) {
      if (!items[i].itemId && !state.supplyShown[i]) { free = i; break; }
    }
    var wrap = el("div");
    wrap.appendChild(UI.table(["Item", "How many", { label: "", cls: "bui-row-end" }], rows, "The supply box is empty."));
    var actions = el("div", "bui-actions");
    var add = UI.button("Add a supply item", function () {
      state.supplyShown[free] = true;
      items[free].count = 1;
      redraw("rewards");
      changed();
    }, "add");
    add.disabled = free === -1 || !items.length;
    actions.appendChild(add);
    if (items.length && free === -1) actions.appendChild(note("The supply box is full (" + items.length + " items)."));
    wrap.appendChild(actions);
    return wrap;
  }

  /** The sum of a group's weights; the game reads them as percent, so it should be 100 (builder item 7). */
  function weightSum(entries) {
    return entries.reduce(function (n, e) { return n + (e.weight > 0 ? e.weight : 0); }, 0);
  }

  function rewardGroupBlock(model, groups, group, groupIndex) {
    if (!group.entries) group.entries = [];
    var entries = group.entries;
    var box = el("div", "bui-group-block");
    var head = el("div", "bui-group-head");
    head.appendChild(UI.subhead("Reward group " + (groupIndex + 1)));
    head.appendChild(UI.button("Remove group", function () {
      groups.splice(groupIndex, 1);
      redraw("rewards");
      changed();
    }, "remove", "Remove reward group " + (groupIndex + 1)));
    box.appendChild(head);

    var conditions = conditionOptions();
    if (conditions.length) {
      var condition = UI.picker({
        options: conditions, value: group.groupId, showIds: true, unknownLabel: conditionLabel,
        onChange: writes(function (v) { group.groupId = v; condition.setProblem(""); })
      });
      if (group.groupId <= 10) condition.setProblem("The game never pays a group with this condition: pick one.");
      box.appendChild(fieldFor(F("rewardGroups[].groupId"), "Paid when", condition,
        "The condition is the group's id: the game pays the group only when it holds."));
    } else {
      box.appendChild(numberFor(F("rewardGroups[].groupId"), "Paid when (condition id)", {
        value: group.groupId, min: 0, max: 65535,
        onChange: writes(function (v) { group.groupId = v; })
      }, "32769 pays on the main target, 32768 on every clear; 0 to 10 are never paid."));
    }

    var shareCells = [];
    var sumLine = note("", "bui-weight-sum");
    function shares() {
      var total = weightSum(entries);
      shareCells.forEach(function (cell, i) {
        var w = entries[i].weight > 0 ? entries[i].weight : 0;
        cell.textContent = total ? Math.round((w / total) * 1000) / 10 + "%" : "–";
      });
      var off = entries.length > 0 && total !== 100;
      sumLine.textContent = entries.length
        ? "Weights add up to " + total + (off ? ". The game reads them as percent, so they should add up to 100." : ", as they should.")
        : "";
      sumLine.classList.toggle("bad", off);
    }
    var rows = entries.map(function (entry, entryIndex) {
      var share = el("span", "bui-share");
      shareCells.push(share);
      return [
        { label: "Item", ref: F("rewardGroups[].entries[].itemId"), node: UI.picker({
          options: itemOptions(), value: entry.itemId, kind: "item", compact: true, showIds: true, label: "Reward item",
          unknownLabel: itemName, onChange: writes(function (v) { entry.itemId = v; })
        }) },
        { label: "How many", ref: F("rewardGroups[].entries[].count"), node: UI.numberInput(ranged(F("rewardGroups[].entries[].count"), {
          value: entry.count, min: 1, label: "How many", onChange: writes(function (v) { entry.count = v; })
        })) },
        { label: "Weight (%)", ref: F("rewardGroups[].entries[].weight"), node: UI.numberInput(ranged(F("rewardGroups[].entries[].weight"), {
          value: entry.weight, min: 1, max: 100, label: "Weight", onChange: writes(function (v) { entry.weight = v; shares(); })
        })) },
        { label: "Share", cls: "num", node: share },
        { cls: "bui-row-end", node: UI.button("Remove", function () {
          entries.splice(entryIndex, 1);
          redraw("rewards");
          changed();
        }, "remove", "Remove " + itemName(entry.itemId)) }
      ];
    });
    box.appendChild(UI.table(["Item", "How many", "Weight (%)", { label: "Share", cls: "num" }, { label: "", cls: "bui-row-end" }],
      rows, "No rewards in this group yet."));
    box.appendChild(sumLine);
    shares();
    var actions = el("div", "bui-actions");
    actions.appendChild(UI.button("Add a reward", function () {
      entries.push({ weight: 1, itemId: 0, count: 1 });
      redraw("rewards");
      changed();
    }, "add"));
    box.appendChild(actions);
    return box;
  }

  function rewardsSection(model) {
    var p = UI.section("Rewards and supplies", "what hunters get");
    p.appendChild(UI.subhead("Supply box"));
    p.appendChild(note("Items handed out when the quest starts."));
    p.appendChild(supplyTable(model));

    p.appendChild(UI.subhead("Rewards"));
    p.appendChild(note("Each group is paid when its condition holds, and draws its rewards by weight. The game"
      + " reads the weights as percent, so a group's weights should add up to 100; Share is each item's part of"
      + " the group's total. A quest submitted for testing is served with its rewards emptied, so a test clear"
      + " pays nothing."));
    var groups = model.rewardGroups || [];
    groups.forEach(function (group, i) { p.appendChild(rewardGroupBlock(model, groups, group, i)); });
    var actions = el("div", "bui-actions");
    actions.appendChild(UI.button("Add a reward group", function () {
      if (!model.rewardGroups) model.rewardGroups = [];
      model.rewardGroups.push({ groupId: nextCondition(model.rewardGroups), reserved: 0, entryOffset: 0, entries: [] });
      redraw("rewards");
      changed();
    }, "add"));
    p.appendChild(actions);
    return p;
  }

  // ---- 6. text -------------------------------------------------------------------------------

  function textSection(model) {
    var p = UI.section("Quest text", "what the quest card says",
      "Each text has a set room in bytes: a plain letter takes 1, a Japanese character 2. Longer text is not"
      + " cut; it is stored at the end of the file. English and Japanese only. What the texts marked"
      + " (unconfirmed) are was read from sample quest files, not from the game's code.");
    var g = grid();
    TEXT_ORDER.forEach(function (index) {
      var slot = slotByIndex(model, index);
      if (slot) g.appendChild(slotField(slot));
    });
    p.appendChild(g);
    return p;
  }

  // ---- 7. review -----------------------------------------------------------------------------

  function problems(model) {
    var b = model.body;
    var list = [];
    var title = slotByIndex(model, 0);
    if (title && !String(title.text || "").trim()) list.push("The quest has no name (Basics).");
    if (!b.timeLimit) list.push("The time limit is 0 minutes (Basics).");
    if (model.startAreas && model.startAreas.length && !areaOnMap(model.startAreas[0].areaId, b.mapId)) {
      list.push("The start area is not part of the chosen map (Map and start area).");
    }
    if (!mapOnServer(b.mapId)) {
      list.push("The server has no area tables for " + mapName(b.mapId) + " yet: choose another map (Map and start area).");
    }
    if (!b.iconLabelId !== !b.iconLabelCount) {
      list.push(b.iconLabelId ? "The item needed to enter has a count of 0 (Basics)."
        : "The item needed to enter is None but its count is not 0 (Basics).");
    }
    OBJECTIVES.forEach(function (spec) {
      var o = b[spec.key];
      if (o && o.type !== 0 && !o.target) {
        list.push(spec.name + " has no " + (isItemObjective(o.type) ? "item" : "monster") + " (Objectives).");
      }
      if (o && UNTESTED_TYPES[o.type]) list.push(spec.name + " uses a type no quest file uses: untested (Objectives).");
    });
    var off = allSpawns(model).filter(function (s) { return !areaOnMap(s.areaId, b.mapId); }).length;
    if (off) list.push(off + (off === 1 ? " monster is" : " monsters are") + " in an area that is not part of the map (Monsters).");
    var none = 0;
    (model.rewardGroups || []).forEach(function (g, i) {
      (g.entries || []).forEach(function (e) { if (!e.itemId) none += 1; });
      if (g.groupId <= 10) list.push("Reward group " + (i + 1) + " has a condition the game never pays (Rewards).");
      var sum = weightSum(g.entries || []);
      if ((g.entries || []).length && sum !== 100) {
        list.push("Reward group " + (i + 1) + ": the weights add up to " + sum + ", not 100 (Rewards).");
      }
    });
    if (none) list.push(none + (none === 1 ? " reward has" : " rewards have") + " no item (Rewards).");
    return list;
  }

  function renderReview() {
    var model = state.model;
    if (!model || !reviewBox) return;
    var b = model.body;
    reviewBox.textContent = "";
    var title = slotByIndex(model, 0);
    var spawns = allSpawns(model);
    var supplies = (model.startItems || []).filter(function (e) { return e.itemId; }).length;
    var rewards = (model.rewardGroups || []).reduce(function (n, g) { return n + (g.entries || []).length; }, 0);
    var goals = ["objective0", "objective1", "objective2"].map(function (key) { return b[key]; }).filter(function (o) {
      return o && o.type !== 0;
    }).map(function (o) {
      var what = isItemObjective(o.type) ? itemName(o.target) : monsterName(o.target);
      var named = ((fieldRef["body.objective0.type"] || {}).values || objectiveTypes)[String(o.type)];
      return (valueName(named) || "Objective") + ": " + o.count + " × " + what;
    });
    var facts = [
      ["Name", title && title.text ? title.text : "(none yet)"],
      ["Map", mapName(b.mapId)],
      ["Start area", model.startAreas && model.startAreas.length ? areaName(model.startAreas[0].areaId, b.mapId) : "–"],
      ["Time and players", Math.round((b.timeLimit || 0) / TICKS_PER_MINUTE) + " minutes, "
        + ((b.maxHunters & 7) === 1 ? "solo" : "up to " + ((b.maxHunters & 7) || 4) + " hunters")],
      ["Money", "fee " + Number(b.zenny || 0).toLocaleString() + " zenny, reward " + Number(b.rewardMoney || 0).toLocaleString() + " zenny"],
      ["Objectives", goals.length ? goals.join("; ") : "none set"],
      ["Monsters", spawns.length ? spawns.map(function (s) { return s.count + " × " + formName(model, s.monsterId); }).join(", ") : "none yet"],
      ["Supplies and rewards", supplies + (supplies === 1 ? " supply item, " : " supply items, ") + rewards + (rewards === 1 ? " reward" : " rewards")]
    ];
    var dl = el("dl", "bui-review");
    facts.forEach(function (f) {
      dl.appendChild(el("dt", null, f[0]));
      dl.appendChild(el("dd", null, f[1]));
    });
    reviewBox.appendChild(dl);
    var list = problems(model);
    if (list.length) {
      reviewBox.appendChild(note("Worth fixing before you test (none of these stop a save):", "bui-warn-head"));
      var ul = el("ul", "bui-problems");
      list.forEach(function (text) { ul.appendChild(el("li", null, text)); });
      reviewBox.appendChild(ul);
    } else {
      reviewBox.appendChild(note("Nothing to fix that this page can see. The server checks the quest again when you save.", "bui-ok"));
    }
  }

  // ---- drawing -------------------------------------------------------------------------------

  var SECTIONS = [
    ["basics", basicsSection], ["map", mapSection], ["objectives", objectivesSection], ["monsters", monstersSection],
    ["rewards", rewardsSection], ["text", textSection]
  ];
  var drawn = {};

  function panels(model) {
    root.textContent = "";
    drawn = {};
    SECTIONS.forEach(function (s) {
      drawn[s[0]] = s[1](model);
      root.appendChild(drawn[s[0]]);
    });
    if (reviewPanel) reviewPanel.hidden = false;
    renderReview();
  }

  /** Redraws one section after a row was added or removed, or the map changed; the model holds every field. */
  function redraw(key) {
    if (!state.model || !drawn[key]) return;
    var builder = SECTIONS.filter(function (s) { return s[0] === key; })[0][1];
    var next = builder(state.model);
    root.replaceChild(next, drawn[key]);
    drawn[key] = next;
  }

  // ---- state and actions ---------------------------------------------------------------------

  function say(text, bad) {
    statusEl.textContent = text;
    statusEl.classList.toggle("bad", !!bad);
  }

  // ---- the server's refusals, next to the field they name ------------------------------------

  /* The API answers a save it refuses with 400 and a message naming the model field ("Out of range:
     body.timeLimit is 0; allowed 1800..90000.", "Large monster area 1 has 6 different monsters ...",
     "Map 7 has no area tables on this server ..."). serverProblems turns it into [{key, text}] in plain words. */
  function serverProblems(message) {
    var text = String(message || "").replace(/^(Out of range|The quest model is not valid|This draft cannot be written as a quest file): /, "");
    var out = [];
    var range = /([A-Za-z][\w.\[\]]*) is (-?\d+); allowed (-?\d+)\.\.(-?\d+)/g;
    var m;
    while ((m = range.exec(text))) {
      var ref = fieldRef[m[1].replace(/\[\d+\]/g, "[]")];
      var label = ref ? ref.label : m[1];
      var value = Number(m[2]), min = Number(m[3]), max = Number(m[4]);
      if (ref && /^ticks/.test(ref.unit || "")) {
        out.push({ key: m[1], text: label + " is " + minutes(value) + "; the server accepts " + minutes(min) + " to "
          + minutes(max) + "." });
      } else {
        out.push({ key: m[1], text: label + " is " + value + "; the server accepts " + min + " to " + max + "." });
      }
    }
    m = /Large monster area (\d+) has (\d+) different monsters \[([^\]]*)\]; a quest lists at most (\d+) per area/.exec(text);
    if (m) {
      var names = m[3].split(/,\s*/).filter(Boolean).map(function (id) { return monsterName(id); }).join(", ");
      out.push({ key: "largeSpawnAreas[" + (Number(m[1]) - 1) + "]", text: "This list has " + m[2] + " different monsters ("
        + names + "); a quest can list at most " + m[4] + " in one area. Remove one." });
    }
    m = /Map (\d+) has no area tables on this server/.exec(text);
    if (m) {
      out.push({ key: "body.mapId", text: "The server has no area tables for " + mapName(m[1]) + " (map " + m[1]
        + ") yet, so a quest cannot use it. Choose a map the list offers." });
    }
    return out;
  }

  function minutes(ticks) {
    var n = Math.round(ticks / TICKS_PER_MINUTE * 100) / 100;
    return n + (n === 1 ? " minute" : " minutes");
  }

  /** The element a model path points at: a table cell, a field, or a spawn table; null when the page has none. */
  function placeFor(key) {
    var scope = root;
    var rest = key;
    var tables = root.querySelectorAll("[data-where]");
    for (var i = 0; i < tables.length; i++) {
      var where = tables[i].getAttribute("data-where");
      if (key === where || key.indexOf(where + ".") === 0) { scope = tables[i]; rest = key.slice(where.length + 1); break; }
    }
    if (scope !== root) {
      var row = /^spawns\[(\d+)\]/.exec(rest);
      var tr = row ? scope.querySelectorAll("tbody tr")[Number(row[1])] : null;
      var cell = tr && tr.querySelector('td[data-fields~="' + key.replace(/\[\d+\]/g, "[]") + '"]');
      return cell || scope;
    }
    var norm = key.replace(/\[\d+\]/g, "[]");
    var index = /\[(\d+)\][^\[]*$/.exec(key);
    var marks = [].slice.call(root.querySelectorAll('[data-fields~="' + norm + '"]'));
    var exact = index && marks.filter(function (n) { return n.getAttribute("data-index") === index[1]; })[0];
    var hit = exact || marks[0];
    if (!hit) return null;
    return hit.closest("td") || hit.closest(".field") || hit.closest(".bui-section");
  }

  function clearServerProblems() {
    [].slice.call(document.querySelectorAll(".bui-server-problem")).forEach(function (n) { n.remove(); });
  }

  /** Shows a 400's problems next to their fields; true when at least one found its field. */
  function showServerProblems(message) {
    clearServerProblems();
    var first = null;
    serverProblems(message).forEach(function (problem) {
      var place = placeFor(problem.key);
      if (!place) return;
      var msg = note(problem.text, "bui-notice bui-warn bui-server-problem");
      msg.setAttribute("role", "alert");
      if (place.matches("[data-where]")) place.parentNode.insertBefore(msg, place.nextSibling); else place.appendChild(msg);
      if (!first) first = msg;
    });
    if (first) first.scrollIntoView({ block: "center" });
    return !!first;
  }

  function setDraftNote() {
    draftNote.textContent = state.draftId
      ? "draft " + state.draftId + ", revision " + state.revision
      : "not saved yet";
  }

  function ensureDraft() {
    if (state.draftId) return Promise.resolve(state.draftId);
    return api("/api/account/quest-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blank: true })
    }).then(body).then(function (created) {
      state.draftId = created.id;
      state.revision = created.revision;
      setDraftNote();
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "/quest-editor.html?draft=" + created.id);
      }
      return created.id;
    });
  }

  function saveDraft() {
    return ensureDraft().then(function (id) {
      return api("/api/account/quest-drafts/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: state.model })
      }).then(body).then(function (saved) {
        state.revision = saved.revision;
        setDraftNote();
        refreshDrafts();
        return id;
      });
    });
  }

  function downloadDraft() {
    return saveDraft().then(function (id) {
      return api("/api/account/quest-drafts/" + id + "/file").then(function (res) {
        if (!res.ok) throw new Error("The server could not write that file.");
        return res.blob();
      });
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var anchor = el("a");
      anchor.href = url;
      anchor.download = "new-quest.bin";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      say("Downloaded new-quest.bin, the file exactly as the server would serve it.", false);
    });
  }

  function submitDraft() {
    return saveDraft().then(function (id) {
      return api("/api/account/quest-drafts/" + id + "/submit", { method: "POST" }).then(body);
    }).then(function (result) {
      say("Submitted. Quest " + result.sandboxQuestId + " is in your quest counter as a testing quest;"
        + " only this account can load it until an admin publishes it.", false);
    });
  }

  function run(action) {
    if (state.busy) return;
    state.busy = true;
    buttons.forEach(function (button) { button.disabled = true; });
    say("Working…", false);
    clearServerProblems();
    action().catch(function (error) {
      var placed = error.status === 400 && showServerProblems(error.message);
      say(placed ? "The server did not accept the quest; the fields it named are marked below. It said: "
        + error.message : error.message || "That did not work.", true);
    }).then(function () {
      state.busy = false;
      buttons.forEach(function (button) { button.disabled = false; });
    });
  }

  function fail(message) {
    root.textContent = "";
    var p = UI.section("The builder could not open a quest");
    p.appendChild(note(message));
    root.appendChild(p);
    if (reviewPanel) reviewPanel.hidden = true;
    buttons.forEach(function (button) { button.disabled = true; });
    titleEl.textContent = "New quest";
    subEl.textContent = "Start again from /quest-editor.html for a blank quest.";
  }

  // ---- drafts list ---------------------------------------------------------------------------

  function when(iso) {
    var date = new Date(iso);
    return isNaN(date) ? "–" : date.toLocaleDateString();
  }

  function draftsMessage(text) {
    draftsBody.textContent = "";
    var tr = el("tr");
    var td = el("td", "empty-cell", text);
    td.colSpan = 3;
    tr.appendChild(td);
    draftsBody.appendChild(tr);
  }

  function refreshDrafts() {
    if (!draftsBody) return Promise.resolve();
    return api("/api/account/quest-drafts").then(body).then(function (rows) {
      renderDrafts(rows || []);
    }).catch(function () {
      draftsMessage("Your drafts could not be loaded.");
    });
  }

  function renderDrafts(rows) {
    if (!rows.length) { draftsMessage("No drafts yet."); return; }
    draftsBody.textContent = "";
    rows.forEach(function (row) {
      var tr = el("tr");
      var name = el("td");
      var link = el("a", null, row.title || "Untitled quest");
      link.href = "/quest-editor.html?draft=" + row.id;
      if (row.id === state.draftId) {
        link.setAttribute("aria-current", "page");
        name.appendChild(el("span", "panel-note", "open · "));
      }
      name.appendChild(link);
      tr.appendChild(name);
      tr.appendChild(el("td", "num", String(row.revision)));
      tr.appendChild(el("td", null, when(row.updatedAt)));
      draftsBody.appendChild(tr);
    });
  }

  // ---- render --------------------------------------------------------------------------------

  function render(model) {
    state.model = model;
    if (!model.largeSpawnAreas) model.largeSpawnAreas = [];
    if (!model.rewardGroups) model.rewardGroups = [];
    panels(model);
    titleEl.textContent = "New quest";
    document.title = "New quest · Hunsterverse";
    subEl.textContent = "Work down the page: basics, map, objectives, monsters, rewards and text, then review and"
      + " submit at the end. The server assigns the quest id when you submit.";
    buttons.forEach(function (button) { button.disabled = false; });
    say("", false);
    setDraftNote();
  }

  // ---- boot ----------------------------------------------------------------------------------

  if (!token()) {
    window.HvNext.toSignin();
    return;
  }

  saveBtn.addEventListener("click", function () {
    run(function () { return saveDraft().then(function () { say("Draft saved.", false); }); });
  });
  downloadBtn.addEventListener("click", function () { run(downloadDraft); });
  submitBtn.addEventListener("click", function () { run(submitDraft); });

  if (!isNaN(liveId)) {
    // The builder only makes new quests. Ask the API for that file's model so the refusal on screen is the
    // server's own answer, not a message this page invented.
    api("/api/account/quests/model?questId=" + liveId).then(body).then(function () {
      fail("This page builds new quests only; it does not open live quests.");
    }).catch(function (error) {
      fail(error.message);
    });
    refreshDrafts(); // the drafts list under the refusal still loads
    return;
  }

  var load = isNaN(draftParam)
    ? api("/api/account/quests/model").then(body)
    : api("/api/account/quest-drafts/" + draftParam).then(body).then(function (draft) {
        state.draftId = draft.id;
        state.revision = draft.revision;
        return draft.model;
      });

  Promise.all([load, loadTables(), loadServerMaps()])
    .then(function (results) {
      render(results[0]);
      return refreshDrafts();
    })
    .catch(function (error) {
      fail(error.message);
      refreshDrafts();
    });
})();
