/* Quest builder: a new quest as a QuestCodec model, edited as a private draft. The server writes the
   bytes. Nothing here opens a live quest file; every draft starts from the blank quest the API owns.

   The page is laid out in the order a quest is built: basics, quest board listing, map and start area,
   objectives, monsters and their areas, rewards and supplies, text, then review and submit. Every control writes
   one field of the model the server sent, and nothing else (the listing's counter and mark are not in the file:
   they are the draft's listing, see LISTING below); the controls themselves come from js/builder-ui.js, shared
   with the Road builder. */
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

  /* LISTING: where the quest is listed in game, kept beside the model in the draft (API README "Custom quest
     listing"): the counter (event_quests.quest_type) and the appeal mark (event_quests.mark). The API refuses any
     other counter (QuestListing.AUTHOR_TYPES: event counters with live rows and no event system of their own) and
     any other mark; an admin can still change both when publishing. Names as Pax's editor has them. The third
     listing value, the player cap, is the file's body.maxHunters, which the API copies into the row. */
  var COUNTERS = [
    { value: 18, label: "HR Event", hint: "the default" }, { value: 28, label: "G Event" },
    { value: 24, label: "Series" }, { value: 26, label: "Daily" }, { value: 31, label: "G Urgent" },
    { value: 38, label: "HR Exotic" }, { value: 39, label: "G Exotic" },
    { value: 43, label: "Superior / Zenith", hint: "name unconfirmed" }
  ];
  var MARKS = [{ value: 0, label: "None" }, { value: 1, label: "Recommended" }, { value: 2, label: "New" }];
  var DEFAULT_LISTING = { questType: 18, mark: 0 };

  /* body.seasonFlags (+0x02): day is bit 3, night bit 4 (2,016 quest files set both; the builder offers one), the
     season one of bits 0-2; bit 6 goes with "all objectives required" (objective modes 3 and 4). body.flags is a
     u32 view of the same bytes, kept in step (flagsInStep), as the API does too. */
  var TIME_DAY = 0x08;
  var TIME_NIGHT = 0x10;
  var TIME_BITS = TIME_DAY | TIME_NIGHT;
  var SEASON_BITS = 0x07;
  var ALL_REQUIRED = 0x40;
  var TIMES = [{ value: TIME_DAY, label: "Day" }, { value: TIME_NIGHT, label: "Night" }];
  var SEASONS = [{ value: 0x02, label: "Warm season", hint: "most quest files" }, { value: 0x04, label: "Cold season" },
    { value: 0x01, label: "Breeding season" }];
  /* body.objectiveMode: which targets must be done to clear the quest. 3 needs sub-target A, 4 needs A and B. */
  var MODES = [{ value: 2, label: "Main target only", needs: [] },
    { value: 3, label: "Main target and sub-target A", needs: ["objective1"] },
    { value: 4, label: "All three targets", needs: ["objective1", "objective2"] }];

  /* Monster tuning (docs/quest-builder-gap.md task 2; API README "Monster tuning"). header.monsterLevel picks the
     row of the monsters' stat tables (Difficulty). The names are Pax's editor's; the 5,000 live quest files use
     0..80. The API takes 0..78, a G rank level (53 and up) only in a G rank quest (class 7), and the Zenith ranks
     64..67 only with a Zenith monster (they have their own picker, zenithRank). */
  var LEVEL_MAX = 78;
  var G_RANK_LEVEL = 53;
  var G_RANK_CLASS = 7;
  var LEVEL_NAMES = { 11: "Low / High rank", 26: "HR5", 31: "HR5", 42: "HR5", 53: "G rank", 54: "Musou 1",
    55: "Musou 2", 71: "Interception", 72: "Interception", 73: "Interception" };
  /* The levels the live files use most, for the hint: 53 (982 files), 26 (560), 6 (537), 12 (460). */
  var COMMON_LEVELS = { 6: true, 12: true, 26: true, 53: true };

  /* Rules and restrictions (docs/quest-builder-gap.md task 3; API README "Flags and restrictions"). The three flag
     bytes body.variantFlags1-3 (+0x97..+0x99), named as Pax's editor and Erupe's comments name them; none of these
     bits was tested in game here. Not offered: flags 1 bit 3 (G rank: the API sets it from the class, with the
     special list tab), flags 3 bit 4 (Zenith: set with a Zenith monster), flags 2 bit 7 (Road: would replace the
     quest's monsters) and flags 3 bit 5 (Interception: Erupe clears it), which the API refuses, and the bits with no
     name (flags 1 bits 5 and 6, flags 3 bit 6), which are kept as they are. */
  var FLAGS1 = [[0, "Hiden"], [1, "Fix HC", "not what makes a quest Hardcore: that is the Hardcore switch"],
    [2, "HC to UL"], [4, "SR"], [7, "UL fixed"]];
  var FLAGS2 = [[0, "Low conquest"], [1, "No Halk pots"], [2, "No cuff"], [3, "Timer"], [4, "No active feature"],
    [5, "Fixed difficulty"], [6, "High conquest"]];
  var FLAGS3 = [[0, "No reward skills"], [1, "GSR to GR"], [2, "No easy drink"], [3, "No GP skills"], [7, "No sigils"]];
  var FLAGS1_G_RANK = 0x08;
  /* Reward extras (docs/quest-builder-gap.md task 5; API README "Reward extras"). body.rewardFlag (+0x90) is one of
     Pax's five modes (names from data/quest-fields.json; these are the fallback), the API takes 0..4.
     body.previewItems (+0xb0) is Reward 1/2/3 of the quest list, three item ids: an approved quest shows them, the
     testing copy has them cleared (it pays no items either). Money is paid in both. "Use the main target's rewards"
     takes the three items the main target reward groups (0x8001) weigh most, as 2,585 of the 3,501 live quests that
     list items do. */
  var REWARD_FLAGS = { 0: "First main reward fixed, sub-target rewards drawn", 1: "First main and first sub-target reward fixed",
    2: "Fixed rewards", 3: "Unknown (fixed)", 4: "No fixed reward" };
  var MAIN_REWARD_GROUP = 0x8001;
  var PREVIEW_ITEMS = 3;
  var G_CLASSES = [7, 9];
  /* body.faintPenalty: the faints allowed in a G rank or Zenith quest (the live files use 3, a few 5; the API takes
     1..9), else the money taken from the reward money at each faint (the quest fails when it runs out). */
  var G_FAINTS = { min: 1, max: 9, usual: 3 };
  var PENALTY_MAX = 999999;
  var RANK_MAX = 999;
  /* The restriction list and the Hardcore notes (data/quest-condition-notes.json); these are the fallback. */
  var conditionNotes = { notes: [], groups: [], hardcore: { ids: [109, 110, 111, 112, 113, 118], written: 109, questClass: 3 } };

  /* Forced equipment (docs/quest-builder-gap.md task 4; API README "Forced equipment"; hvmhfz_re docs/quest-files.md
     "Forced equipment"): body.equipment, six 8-byte records { piece, word1, word2, word3 } in file order legs, weapon,
     head, chest, arms, waist. A record is in force when word1 bit 15 is set (and piece bit 14 clear); the low 15 bits of
     the three words are decoration item ids; for the weapon, piece bit 15 picks the gunner table and body.flagsAtC0 bit 1
     is its id bit 14. The game looks the ids up with no bound check, so only data/forced-equipment.json's pieces are
     offered (names from the API catalog, icons from js/game-icons.js), and the API refuses the rest. Nothing here was
     tested in game. */
  var GEAR_SLOTS = [
    { name: "Legs", table: "legs", catalog: "legs" },
    { name: "Weapon", weapon: true },
    { name: "Head", table: "head", catalog: "heads" },
    { name: "Chest", table: "chest", catalog: "chests" },
    { name: "Arms", table: "arms", catalog: "arms" },
    { name: "Waist", table: "waist", catalog: "waists" }
  ];
  var GEAR_ORDER = [1, 2, 3, 4, 5, 0]; // on screen: weapon, then head to legs
  var GEAR_WEAPON = 1;
  var GEAR_ON = 0x8000;      // word1: the record is in force; word2, word3: set with it in every Capcom file
  var GEAR_OFF = 0x4000;     // piece: the record is switched off
  var GEAR_GUNNER = 0x8000;  // weapon piece: the ranged table
  var GEAR_DECO = 0x7fff;
  var GEAR_ID_BIT14 = 2;     // body.flagsAtC0 bit 1
  var forcedGear = null;     // data/forced-equipment.json
  var gearIcons = null;      // data/equipment-icons.json, through js/game-icons.js
  var gearNames = {};        // "<table>:<id>" -> the API catalog's name

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

  var state = { model: null, listing: copyListing(null), draftId: null, revision: 0, busy: false, mapMessage: "",
    supplyShown: {}, serverMaps: null, mapsNote: "", spots: {}, bounds: {}, exactSpawns: [] };

  /** The draft's listing as the API answers it, the defaults for what it leaves out. */
  function copyListing(from) {
    var l = from || {};
    return { questType: typeof l.questType === "number" ? l.questType : DEFAULT_LISTING.questType,
      mark: typeof l.mark === "number" ? l.mark : DEFAULT_LISTING.mark };
  }

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
      grab("/data/quest-fields.json"), UI.loadIcons(["monsters", "items"]), grab("/data/quest-condition-notes.json"),
      grab("/data/forced-equipment.json"), window.HvGameIcons ? window.HvGameIcons.load() : null
    ]).then(function (r) {
      mapIds = r[0] || {}; mapAreas = r[1] || {}; areaIds = r[2] || {}; itemIds = r[3] || {};
      objectiveTypes = r[4] || {}; monsterIds = r[5] || {};
      ((r[6] || {}).fields || []).forEach(function (f) { fieldRef[f.key] = f; });
      if (r[8] && Array.isArray(r[8].notes)) conditionNotes = r[8];
      if (r[9] && typeof r[9].melee === "string" && Array.isArray(r[9].decorations)) forcedGear = r[9];
      gearIcons = r[10] || null;
    });
  }

  /** The maps the server has area tables for (GET /api/account/quests/maps); on failure, the blank's map only. */
  function loadServerMaps() {
    return api("/api/account/quests/maps").then(body).then(function (answer) {
      var list = answer && Array.isArray(answer.maps) ? answer.maps : null;
      if (!list || !list.length) throw new Error("empty map list");
      state.serverMaps = {};
      list.forEach(function (id) { state.serverMaps[String(id)] = true; });
      // Usual spots and allowed positions per map (an API from before monster tuning sends neither).
      state.spots = answer.spots && typeof answer.spots === "object" ? answer.spots : {};
      state.bounds = answer.bounds && typeof answer.bounds === "object" ? answer.bounds : {};
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

  // ---- monster strength, size and position (task 2) ---------------------------------------------

  /** Pax's name for a monster level: 1-10 Low rank, 12-20 High rank, the others in LEVEL_NAMES; "" for none. */
  function levelName(n) {
    if (n >= 1 && n <= 10) return "Low rank";
    if (n >= 12 && n <= 20) return "High rank";
    return LEVEL_NAMES[n] || "";
  }

  function levelLabel(n) {
    var name = levelName(n);
    return name ? n + " \u00b7 " + name : String(n);
  }

  /** Every level the API takes but the Zenith ranks; a G rank level is offered in a G rank quest only. */
  function levelOptions(model) {
    var gRank = model.body.questClass === G_RANK_CLASS;
    var list = [];
    for (var n = 0; n <= LEVEL_MAX; n++) {
      if (ZENITH_LEVELS.indexOf(n) >= 0) continue;
      var g = n >= G_RANK_LEVEL;
      list.push({ value: n, label: levelLabel(n), disabled: g && !gRank && n !== model.header.monsterLevel,
        hint: g && !gRank ? "G rank quests only" : (COMMON_LEVELS[n] ? "common in Capcom's quests" : "") });
    }
    return list;
  }

  /** What the server would refuse about header.monsterLevel, in words; "" when nothing. */
  function levelProblem(model) {
    var level = model.header && model.header.monsterLevel;
    if (typeof level !== "number") return "";
    if (ZENITH_LEVELS.indexOf(level) >= 0) {
      return Object.keys(zenithSet(model)).length ? "" : "Levels 64 to 67 are the Zenith ranks, for a quest with a"
        + " Zenith monster only: pick another level.";
    }
    if (level > LEVEL_MAX) return "The server takes levels 0 to " + LEVEL_MAX + ": pick another.";
    if (level >= G_RANK_LEVEL && model.body.questClass !== G_RANK_CLASS) {
      return "Levels from " + G_RANK_LEVEL + " up are G rank levels, for a G rank quest only: pick a lower level, or"
        + " set the quest class to G rank (Basics, More settings).";
    }
    return "";
  }

  /** Size spread choices from the field reference (header.sizeClass: 0 "100-100%" ... 4 "85-125%"). */
  function spreadOptions() {
    var named = (fieldRef["header.sizeClass"] || {}).values || {};
    return Object.keys(named).map(Number).sort(function (a, b) { return a - b; }).map(function (v) {
      var range = String(valueName(named[v])).replace("-", "\u2013");
      return { value: v, label: v === 0 ? "None (always 100%)" : range, hint: v === 2 ? "the blank's" : "" };
    });
  }

  /** The usual spot of an area on a map ([x, y, z], from GET /api/account/quests/maps); null when unknown. */
  function spotOf(mapId, areaId) {
    var areas = state.spots[String(mapId)];
    var p = areas && areas[String(areaId)];
    return Array.isArray(p) && p.length === 3 ? p : null;
  }

  /** Where an exact position may lie on a map ({min, max}, three numbers each); null with an older API. */
  function boundsOf(mapId) {
    var box = state.bounds[String(mapId)];
    return box && Array.isArray(box.min) && Array.isArray(box.max) ? box : null;
  }

  /** No position, or 0, 0, 0: the server gives the monster its area's usual spot. */
  function emptyPosition(p) {
    return !Array.isArray(p) || (p[0] === 0 && p[1] === 0 && p[2] === 0);
  }

  function samePosition(a, b) {
    return !!a && !!b && [0, 1, 2].every(function (i) { return Math.abs(a[i] - b[i]) < 0.05; });
  }

  /** True when the row shows X, Y and Z: the author chose "Set exactly", or the position is not the usual spot. */
  function isExact(spawn, mapId) {
    if (state.exactSpawns.indexOf(spawn) >= 0) return true;
    return !emptyPosition(spawn.position) && !samePosition(spawn.position, spotOf(mapId, spawn.areaId));
  }

  function forgetExact(spawn) {
    var i = state.exactSpawns.indexOf(spawn);
    if (i >= 0) state.exactSpawns.splice(i, 1);
  }

  function roundCoord(v) {
    return Math.round(v * 10) / 10;
  }

  function coordsText(p) {
    return "x " + roundCoord(p[0]) + ", y " + roundCoord(p[1]) + ", z " + roundCoord(p[2]);
  }

  /** True when an exact position lies outside the map's allowed box (always false with an older API). */
  function outsideBounds(p, mapId) {
    var box = boundsOf(mapId);
    return !!box && Array.isArray(p) && [0, 1, 2].some(function (i) { return p[i] < box.min[i] || p[i] > box.max[i]; });
  }

  /** The Position cell of a large-monster row: the usual spot, or X, Y and Z within the map's bounds. */
  function positionCell(model, spawn) {
    var mapId = model.body.mapId;
    var usual = spotOf(mapId, spawn.areaId);
    var box = boundsOf(mapId);
    var ref = F("largeSpawnAreas[].spawns[].position");
    var wrap = el("div", "bui-position");
    if (!isExact(spawn, mapId)) {
      wrap.appendChild(el("span", "bui-position-text", usual ? "Usual spot (" + coordsText(usual) + ")" : "Usual spot"));
      wrap.appendChild(UI.button("Set exactly", function () {
        // Start from the usual spot, else the middle of the map's box, else a spot near most quests' (10000, 0, 10000).
        spawn.position = usual ? usual.slice() : box ? [0, 1, 2].map(function (i) {
          return Math.round((box.min[i] + box.max[i]) / 2);
        }) : [10000, 0, 10000];
        state.exactSpawns.push(spawn);
        redraw("monsters");
        changed();
      }, null, "Set the exact position of " + monsterName(spawn.monsterId)));
      return { label: "Position", ref: ref, node: wrap };
    }
    var start = Array.isArray(spawn.position) && spawn.position.length === 3 ? spawn.position : [0, 0, 0];
    ["x", "y", "z"].forEach(function (axis, i) {
      var item = el("label", "bui-axis");
      item.appendChild(el("span", null, axis));
      item.appendChild(UI.numberInput({
        value: roundCoord(start[i]), step: "any", label: axis + " of " + monsterName(spawn.monsterId),
        min: box ? box.min[i] : -50000, max: box ? box.max[i] : 50000,
        onChange: writes(function (v) {
          var next = (Array.isArray(spawn.position) ? spawn.position : start).slice();
          next[i] = v;
          spawn.position = next;
        })
      }));
      wrap.appendChild(item);
    });
    wrap.appendChild(UI.button("Use the usual spot", function () {
      spawn.position = null;
      forgetExact(spawn);
      redraw("monsters");
      changed();
    }, null, "Put " + monsterName(spawn.monsterId) + " back at the usual spot"));
    if (box) {
      wrap.appendChild(el("span", "bui-position-text", "Allowed here: x " + box.min[0] + " to " + box.max[0] + ", y "
        + box.min[1] + " to " + box.max[1] + ", z " + box.min[2] + " to " + box.max[2] + "."));
    }
    return { label: "Position", ref: ref, node: wrap };
  }

  /** Difficulty (or the Zenith rank while a monster is Zenith), size and size spread. */
  function strengthFields(model) {
    var header = model.header;
    var g = grid();
    if (Object.keys(zenithSet(model)).length) {
      g.appendChild(zenithRank(model));
    } else if (typeof header.monsterLevel === "number") {
      var level = null;
      g.appendChild(fieldFor(F("header.monsterLevel"), "Difficulty", level = UI.picker({
        options: levelOptions(model), value: header.monsterLevel,
        unknownLabel: function (v) { return "Level " + v + (ZENITH_LEVELS.indexOf(v) >= 0 ? " (a Zenith rank)" : ""); },
        onChange: writes(function (v) { header.monsterLevel = v; level.setProblem(levelProblem(model)); })
      }), null, { help: "The row of the monsters' stat tables the quest uses: the higher, the stronger. Capcom's"
        + " quests use 1 to 10 in Low rank, 12 to 20 in High rank, 26 to 42 from HR 100 and 53 up in G rank. A"
        + " monster with no data for a level plays at its base strength." }));
      level.setProblem(levelProblem(model));
    }
    if (typeof header.monsterSize === "number") {
      g.appendChild(numberFor(F("header.monsterSize"), "Size", {
        id: "monster-size", value: header.monsterSize, min: 70, max: 150, unit: "%",
        onChange: writes(function (v) { header.monsterSize = v; })
      }, "Every large monster's size; 100 is normal. Capcom's quests use 70 to 150."));
    }
    var spreads = spreadOptions();
    if (typeof header.sizeClass === "number" && spreads.length) {
      g.appendChild(fieldFor(F("header.sizeClass"), "Size spread", UI.picker({
        options: spreads, value: header.sizeClass,
        unknownLabel: function (v) { return "Spread " + v + " (the server takes 0 to 4)"; },
        onChange: writes(function (v) { header.sizeClass = v; })
      }), "Each monster's size varies at random within this range of the size above."));
    }
    return g;
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

  /** body.flags is a u32 view of body +0x00..+0x03: bytes 2 and 3 follow seasonFlags and flagByte (or the server
      would refuse the save: two fields disagree about a byte). */
  function flagsInStep(b) {
    if (typeof b.flags !== "number") return;
    b.flags = ((b.flags & 0xffff) | ((b.seasonFlags & 0xff) << 16) | ((b.flagByte & 0xff) << 24)) >>> 0;
  }

  /** The bits of body.seasonFlags under mask become value; body.flags follows. */
  function setSeasonBits(b, mask, value) {
    b.seasonFlags = (b.seasonFlags & ~mask & 0xff) | value;
    flagsInStep(b);
  }

  function optionLabel(list, value, fallback) {
    var hit = list.filter(function (o) { return o.value === value; })[0];
    return hit ? hit.label : fallback;
  }

  function starsText(level) {
    return level + (level === 1 ? " star" : " stars");
  }

  /** True when the objective record is in use (its type is not "Not used"). */
  function used(b, key) {
    return !!(b[key] && b[key].type !== 0);
  }

  /** What the chosen objective mode needs and the quest lacks, as a sentence; "" when nothing. */
  function modeProblem(b) {
    var mode = MODES.filter(function (m) { return m.value === b.objectiveMode; })[0];
    if (!mode) return "";
    var missing = mode.needs.filter(function (key) { return !used(b, key); }).map(function (key) {
      return key === "objective1" ? "sub-target A" : "sub-target B";
    });
    return missing.length ? "\u201c" + mode.label + "\u201d needs " + missing.join(" and ") + ": set "
      + (missing.length === 1 ? "it" : "them") + " above, or require fewer targets." : "";
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
    g.appendChild(numberFor(F("body.zenny"), "Contract fee", {
      id: "meta-zenny", value: b.zenny, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.zenny = v; })
    }, "Paid to accept the quest."));
    g.appendChild(numberFor(F("body.rewardMoney"), "Reward money", {
      id: "meta-money", value: b.rewardMoney, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.rewardMoney = v; })
    }, "Paid for the main target, on a clear. Custom quests pay it, in testing too."));
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
        onChange: writes(function (v) {
          var before = b.questClass;
          b.questClass = v;
          if (model.header) model.header.questClass = v;
          classChanged(model, before);
          redraw("monsters"); // G rank levels follow the class
          redraw("rules"); // Hardcore, faints and the G rank flag follow it too
        })
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

  // ---- 2. quest board listing ---------------------------------------------------------------

  function listingSection(model) {
    var b = model.body;
    var listing = state.listing;
    var p = UI.section("Quest board listing", "where and how it is listed");
    var g = grid();
    g.appendChild(UI.field("Counter", UI.picker({
      options: COUNTERS, value: listing.questType, showIds: true,
      unknownLabel: function (v) { return "Counter " + v + " (not offered: pick one of the list)"; },
      onChange: writes(function (v) { listing.questType = v; })
    }), null, { help: "The quest list the quest appears in. These are the event counters a custom quest can use;"
      + " an admin may move the quest to another counter when publishing it." }));
    g.appendChild(UI.field("Mark", UI.picker({
      options: MARKS, value: listing.mark,
      unknownLabel: function (v) { return "Mark " + v + " (not offered)"; },
      onChange: writes(function (v) { listing.mark = v; })
    }), "The New or Recommended label beside the quest in the list."));
    var hunters = hunterOptions();
    if (hunters.length) {
      g.appendChild(fieldFor(F("body.maxHunters"), "Players", UI.picker({
        options: hunters, value: b.maxHunters, showIds: true,
        unknownLabel: function (v) { return "Other (value " + v + ", the game reads " + (v & 7) + ")"; },
        onChange: writes(function (v) { b.maxHunters = v; })
      }), "How many hunters can join; the quest list shows it too. The game reads only the low 3 bits, and 0 also"
        + " means 4."));
    } else {
      g.appendChild(numberFor(F("body.maxHunters"), "Players", {
        id: "meta-players", value: b.maxHunters, min: 1, max: 4,
        onChange: writes(function (v) { b.maxHunters = v; })
      }, "How many hunters can join, 1 to 4."));
    }
    var stars = [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return { value: n, label: starsText(n), hint: new Array(n + 1).join("\u2605") };
    });
    g.appendChild(fieldFor(F("body.level"), "Stars", UI.picker({
      options: stars, value: b.level,
      unknownLabel: function (v) { return "Level " + v + " (the server accepts 1 to 8)"; },
      onChange: writes(function (v) { b.level = v; })
    }), "The quest's difficulty in stars, as the quest list shows it."));
    p.appendChild(g);
    return p;
  }

  // ---- 2b. rules and restrictions ------------------------------------------------------------

  function isG(b) {
    return G_CLASSES.indexOf(b.questClass) >= 0;
  }

  function hardcoreIds() {
    return (conditionNotes.hardcore && conditionNotes.hardcore.ids) || [];
  }

  function hardcoreClass() {
    return (conditionNotes.hardcore && conditionNotes.hardcore.questClass) || 3;
  }

  function isHardcore(b) {
    return hardcoreIds().indexOf(b.conditionNote) >= 0;
  }

  var noteList = null;
  /** None, then the restrictions by group; a name with one source (Pax's editor only) is marked unconfirmed. */
  function noteOptions() {
    if (noteList) return noteList;
    noteList = [{ value: 0, label: "None" }].concat((conditionNotes.notes || []).map(function (n) {
      return { value: n.id, label: n.name, group: n.group, hint: n.confirmedBy ? "" : "unconfirmed" };
    }));
    return noteList;
  }

  function noteName(id) {
    if (!id) return "None";
    if (hardcoreIds().indexOf(id) >= 0) return "Hardcore (restriction " + id + ", set by the switch)";
    var hit = (conditionNotes.notes || []).filter(function (n) { return n.id === id; })[0];
    return hit ? hit.name : "Restriction " + id + " (not offered)";
  }

  /** After the quest class changed: a Hardcore note goes with class 3; flags 1 bit 3 and the special list tab follow
      the G rank line (the API sets them too); and body.faintPenalty, faints allowed in G rank and Zenith but money per
      faint otherwise, takes the usual value of its new meaning. */
  function classChanged(model, before) {
    var b = model.body;
    if (isHardcore(b) && b.questClass !== hardcoreClass()) b.conditionNote = 0;
    if (typeof b.variantFlags1 === "number") {
      b.variantFlags1 = isG(b) ? (b.variantFlags1 | FLAGS1_G_RANK) : (b.variantFlags1 & ~FLAGS1_G_RANK & 0xff);
    }
    if (typeof b.specialListTab === "number") b.specialListTab = isG(b) ? 1 : 0;
    if ((G_CLASSES.indexOf(before) >= 0) !== isG(b) && typeof b.faintPenalty === "number") {
      b.faintPenalty = isG(b) ? G_FAINTS.usual : Math.ceil((b.rewardMoney || 0) / 3);
    }
  }

  /** A checkbox with its text; opts: label, checked, onChange(on), disabled, id, hint (shown small after the text). */
  function checkbox(opts) {
    var wrap = el("label", "bui-check");
    var input = el("input");
    input.type = "checkbox";
    if (opts.id) input.id = opts.id;
    input.checked = !!opts.checked;
    input.disabled = !!opts.disabled;
    input.addEventListener("change", function () { opts.onChange(input.checked); });
    wrap.appendChild(input);
    wrap.appendChild(el("span", null, opts.label));
    if (opts.hint) wrap.appendChild(el("span", "bui-check-hint", opts.hint));
    wrap.input = input;
    return wrap;
  }

  /** One flag byte as checkboxes, one per named bit; get() reads the byte, set(v) writes it (other bits kept). */
  function flagBox(bits, get, set) {
    var box = el("div", "bui-flags");
    bits.forEach(function (bit) {
      var mask = 1 << bit[0];
      box.appendChild(checkbox({ label: bit[1], hint: bit[2], checked: !!(get() & mask), onChange: writes(function (on) {
        set(on ? (get() | mask) : (get() & ~mask & 0xff));
      }) }));
    });
    return box;
  }

  /** A maximum rank below its minimum (0 is no limit), in words; "" when fine. */
  function rankProblem(min, max, what) {
    return typeof min === "number" && typeof max === "number" && max !== 0 && max < min
      ? "The highest rank to " + what + " (" + max + ") is below the lowest (" + min + "): raise it, or 0 for no limit." : "";
  }

  function rulesSection(model) {
    var b = model.body;
    var p = UI.section("Rules and restrictions", "who may join, and how");
    var g = grid();
    var hardcore = isHardcore(b);
    var canHardcore = b.questClass === hardcoreClass();
    var hcBox = checkbox({ id: "rule-hardcore", label: "Make this a Hardcore quest", checked: hardcore,
      disabled: !canHardcore && !hardcore,
      onChange: function (on) {
        b.conditionNote = on ? ((conditionNotes.hardcore || {}).written || 109) : 0;
        redraw("rules");
        changed();
      } });
    var hcField = fieldFor(F("body.conditionNote"), "Hardcore", hcBox, canHardcore
      ? "Uses the restriction slot, so a Hardcore quest has no other restriction."
      : "For HR 100 and up quests only: set the quest class to it first (Basics, More settings).",
      { help: "The monsters use their Hardcore data and the rewards their Hardcore rows. The game does this for an"
        + " HR 100 and up quest whose restriction is one of the Hardcore notes (read from the game's code), so the"
        + " switch sets restriction 109, as most of Capcom's Hardcore quests have. The “Fix HC” flag below"
        + " does not do it. Not tested in game yet: try the quest in testing before you submit it." });
    hcField.querySelector("label").htmlFor = "rule-hardcore";
    g.appendChild(hcField);

    var restriction = null;
    g.appendChild(fieldFor(F("body.conditionNote"), "Restriction", restriction = UI.picker({
      options: noteOptions(), value: b.conditionNote, showIds: true, disabled: hardcore, unknownLabel: noteName,
      searchHint: "Type a weapon, rank or item rule",
      onChange: writes(function (v) { b.conditionNote = v; })
    }), hardcore ? "A Hardcore quest uses this slot." : "One per quest, shown on the quest's info page.",
      { help: "The rule on the quest's info page, such as “Great Sword only” or “No items”. The game"
        + " may also enforce it; which ones it enforces is not known, and none was tested here, so try the quest in"
        + " testing. “Unconfirmed” names rest on one source (Pax's quest editor). Rules that take tickets or"
        + " proofs, or need the game server to count, are untested." }));
    if (!hardcore && b.conditionNote && !noteOptions().some(function (o) { return o.value === b.conditionNote; })) {
      restriction.setProblem("The server does not take this restriction: pick another, or None.");
    }

    if (typeof b.faintPenalty === "number") {
      if (isG(b)) {
        g.appendChild(numberFor(F("body.faintPenalty"), "Faints allowed", {
          id: "rule-faints", value: b.faintPenalty, min: G_FAINTS.min, max: G_FAINTS.max,
          onChange: writes(function (v) { b.faintPenalty = v; })
        }, "The quest fails at this many faints. Capcom's G rank quests allow 3, a few 5."));
      } else {
        g.appendChild(numberFor(F("body.faintPenalty"), "Money lost per faint", {
          id: "rule-faints", value: b.faintPenalty, min: 0, max: PENALTY_MAX, unit: "zenny",
          onChange: writes(function (v) { b.faintPenalty = v; })
        }, "Taken from the reward money at each faint; the quest fails when it runs out. Capcom's quests take a third"
          + " of it (3 faints)."));
      }
    }
    p.appendChild(g);

    p.appendChild(UI.subhead("Hunter rank limits"));
    p.appendChild(note("Hunter rank, or G rank in a G rank quest. 0 as a highest rank means no limit. The game's code"
      + " was traced for the lowest rank to join only."));
    var r = grid();
    var rankFields = [];
    function rankChanged() {
      rankFields.forEach(function (f) { f.check(); });
      changed();
    }
    function rankField(input, min, max, what) {
      input.check = function () {
        var why = rankProblem(min(), max(), what);
        var box = input.input;
        box.classList.toggle("is-invalid", !!why);
        box.title = why;
      };
      rankFields.push(input);
      return input;
    }
    if (typeof b.postRankMin === "number") {
      r.appendChild(numberFor(F("body.postRankMin"), "Lowest rank to post", {
        id: "rule-post-min", value: b.postRankMin, min: 0, max: RANK_MAX,
        onChange: function (v) { b.postRankMin = v; rankChanged(); }
      }, "The lowest rank that can post the quest."));
    }
    if (typeof b.postRankMax === "number") {
      r.appendChild(rankField(numberFor(F("body.postRankMax"), "Highest rank to post", {
        id: "rule-post-max", value: b.postRankMax, min: 0, max: RANK_MAX,
        onChange: function (v) { b.postRankMax = v; rankChanged(); }
      }, "0 for no limit."), function () { return b.postRankMin; }, function () { return b.postRankMax; }, "post"));
    }
    if (typeof b.rank === "number") {
      r.appendChild(numberFor(F("body.rank"), "Lowest rank to join", {
        id: "rule-join-min", value: b.rank, min: 0, max: RANK_MAX,
        onChange: function (v) { b.rank = v; rankChanged(); }
      }, "The lowest rank that can join."));
    }
    if (typeof b.joinRankMax === "number") {
      r.appendChild(rankField(numberFor(F("body.joinRankMax"), "Highest rank to join", {
        id: "rule-join-max", value: b.joinRankMax, min: 0, max: RANK_MAX,
        onChange: function (v) { b.joinRankMax = v; rankChanged(); }
      }, "0 for no limit."), function () { return b.rank; }, function () { return b.joinRankMax; }, "join"));
    }
    p.appendChild(r);
    rankFields.forEach(function (f) { f.check(); });

    if (typeof b.variantFlags1 === "number") {
      p.appendChild(UI.subhead("Quest flags"));
      p.appendChild(note("Named as in Pax's quest editor and Erupe's comments. What each one does was not traced in"
        + " the game's code or tested in game here, so try the quest in testing. Set for you: G rank (from the quest"
        + " class) and Zenith (from the monsters). Not offered: Road and Interception."));
      var f = grid();
      f.appendChild(fieldFor(F("body.variantFlags1"), "Flags 1", flagBox(FLAGS1, function () { return b.variantFlags1; },
        function (v) { b.variantFlags1 = v; })));
      f.appendChild(fieldFor(F("body.variantFlags2"), "Flags 2", flagBox(FLAGS2, function () { return b.variantFlags2; },
        function (v) { b.variantFlags2 = v; })));
      f.appendChild(fieldFor(F("body.variantFlags3"), "Flags 3", flagBox(FLAGS3, function () { return b.variantFlags3; },
        function (v) { b.variantFlags3 = v; })));
      p.appendChild(f);
    }
    return p;
  }

  /** "Hardcore, Great Sword only, 3 faints, join HR 100 and up, flags: No Halk pots" for the review. */
  function rulesText(model) {
    var b = model.body;
    var parts = [];
    if (isHardcore(b)) parts.push("Hardcore");
    else if (b.conditionNote) parts.push(noteName(b.conditionNote));
    if (typeof b.faintPenalty === "number") {
      parts.push(isG(b) ? b.faintPenalty + (b.faintPenalty === 1 ? " faint allowed" : " faints allowed")
        : Number(b.faintPenalty).toLocaleString() + " zenny lost per faint");
    }
    function band(min, max) {
      return max ? min + " to " + max : min + " and up";
    }
    if (typeof b.postRankMin === "number" && (b.postRankMin || b.postRankMax)) parts.push("post " + band(b.postRankMin, b.postRankMax));
    if (b.rank || b.joinRankMax) parts.push("join " + band(b.rank, b.joinRankMax));
    var flags = [];
    [["variantFlags1", FLAGS1], ["variantFlags2", FLAGS2], ["variantFlags3", FLAGS3]].forEach(function (spec) {
      spec[1].forEach(function (bit) { if ((b[spec[0]] || 0) & (1 << bit[0])) flags.push(bit[1]); });
    });
    if (flags.length) parts.push("flags: " + flags.join(", "));
    return parts.length ? parts.join("; ") : "none";
  }

  // ---- 2c. forced equipment (arena quests) ----------------------------------------------------

  function emptyRecord() {
    return { piece: 0, word1: 0, word2: 0, word3: 0 };
  }

  /** The six records, or six empty ones for a draft saved before the field existed (sent only once edited). */
  function gearList(b) {
    return Array.isArray(b.equipment) && b.equipment.length === GEAR_SLOTS.length ? b.equipment
      : GEAR_SLOTS.map(emptyRecord);
  }

  function gearRecord(b, slot) {
    if (!Array.isArray(b.equipment) || b.equipment.length !== GEAR_SLOTS.length) b.equipment = gearList(b);
    return b.equipment[slot];
  }

  function inForce(rec) {
    return !!rec && (rec.word1 & GEAR_ON) !== 0 && (rec.piece & GEAR_OFF) === 0;
  }

  function blankRecord(rec) {
    return !rec || !(rec.piece || rec.word1 || rec.word2 || rec.word3);
  }

  /** A forced record's piece: { id, ranged } (a weapon's id takes bit 14 from body.flagsAtC0). */
  function gearPiece(b, slot, rec) {
    if (slot !== GEAR_WEAPON) return { id: rec.piece, ranged: false };
    return { id: (rec.piece & 0x3fff) | ((b.flagsAtC0 || 0) & GEAR_ID_BIT14 ? 0x4000 : 0), ranged: !!(rec.piece & GEAR_GUNNER) };
  }

  /** "a" any hunter, "b" blademaster, "g" gunner, or "-" when data/forced-equipment.json does not offer the piece. */
  function gearKind(slot, id, ranged) {
    if (!forcedGear) return "-";
    if (slot === GEAR_WEAPON) {
      return (forcedGear[ranged ? "ranged" : "melee"] || "").charAt(id) === "w" && id > 0 ? (ranged ? "g" : "b") : "-";
    }
    return (forcedGear[GEAR_SLOTS[slot].table] || "").charAt(id) || "-";
  }

  /** "b" or "g" when the forced pieces other than slot `skip` are for blademasters or gunners only, else "". */
  function gearSetKind(b, skip) {
    var kind = "";
    gearList(b).forEach(function (rec, slot) {
      if (slot === skip || !inForce(rec)) return;
      var p = gearPiece(b, slot, rec);
      var k = gearKind(slot, p.id, p.ranged);
      if (k === "b" || k === "g") kind = kind && kind !== k ? "x" : k;
    });
    return kind;
  }

  function gearTable(slot, ranged) {
    return slot === GEAR_WEAPON ? (ranged ? "ranged" : "melee") : GEAR_SLOTS[slot].table;
  }

  /* The API catalog's equipment ids are the game's id as 4 hex digits, low byte first ("EB19" is 6635). */
  function catalogKey(id) {
    function two(n) { return (n < 16 ? "0" : "") + n.toString(16).toUpperCase(); }
    return two(id & 0xff) + two((id >> 8) & 0xff);
  }

  function catalogId(raw) {
    var hex = String(raw || "").trim();
    return /^[0-9a-f]{4}$/i.test(hex) ? parseInt(hex.slice(2, 4) + hex.slice(0, 2), 16) : null;
  }

  /** Pieces of a slot whose name (or id, for a number) matches: [{ id, ranged, name }] from the API catalog. */
  function searchGear(slot, term) {
    var number = /^\d+$/.test(term) ? Number(term) : null;
    var lists = slot === GEAR_WEAPON ? ["melee", "ranged"] : [GEAR_SLOTS[slot].catalog];
    return Promise.all(lists.map(function (list) {
      var q = number === null ? term : catalogKey(number);
      return fetch(API + "/api/public/catalog/equipment?slot=" + list + "&size=40&q=" + encodeURIComponent(q))
        .then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (page) {
          return (page.items || []).map(function (e) {
            var ranged = list === "ranged";
            var id = catalogId(e.id);
            if (id !== null && e.name) gearNames[gearTable(slot, ranged) + ":" + id] = e.name;
            return { id: id, ranged: ranged, name: e.name || "" };
          }).filter(function (e) { return e.id !== null && (number === null || e.id === number); });
        });
    })).then(function (parts) { return [].concat.apply([], parts); });
  }

  /** The catalog name of a forced piece, fetched once; then() runs when it came in. */
  function gearNameOf(slot, piece, then) {
    var key = gearTable(slot, piece.ranged) + ":" + piece.id;
    if (gearNames[key] !== undefined) return gearNames[key];
    gearNames[key] = null;
    searchGear(slot, String(piece.id)).then(function () {
      if (gearNames[key] === null) gearNames[key] = "";
      if (then) then();
    }).catch(function () { gearNames[key] = ""; });
    return null;
  }

  function gearLabel(slot, piece, name) {
    if (slot !== GEAR_WEAPON && piece.id === 0) return "No piece: the slot is left empty";
    return name || (slot === GEAR_WEAPON ? (piece.ranged ? "Gunner weapon" : "Blademaster weapon") : GEAR_SLOTS[slot].name + " piece")
      + " #" + piece.id;
  }

  function gearIcon(slot, piece) {
    if (!window.HvGameIcons || (slot !== GEAR_WEAPON && piece.id === 0)) return el("span", "gi gi-equip gi-unknown");
    var look = slot === GEAR_WEAPON ? { kind: piece.ranged ? "ranged" : "melee", id: piece.id }
      : { kind: "armour", slot: GEAR_SLOTS[slot].table, id: piece.id };
    return window.HvGameIcons.equipmentIcon(gearIcons, look, "gi-small");
  }

  var KIND_NAMES = { b: "blademasters", g: "gunners" };

  /**
   * The forced piece of one slot: what is forced now, and a search of the API catalog (only pieces
   * data/forced-equipment.json offers, and not a blademaster piece in a gunner set or the other way round).
   * onPick({ id, ranged }) forces a piece; onPick(null) stops forcing the slot.
   */
  function gearChooser(model, slot, onPick) {
    var b = model.body;
    var s = GEAR_SLOTS[slot];
    var rec = gearList(b)[slot];
    var wrap = el("div", "qe-gear");
    var current = el("div", "qe-gear-current");
    wrap.appendChild(current);
    function drawCurrent() {
      current.textContent = "";
      wrap.classList.remove("is-invalid");
      if (!inForce(rec)) {
        current.appendChild(el("span", "qe-gear-none", blankRecord(rec) ? "Not forced" : "Not forced (old bytes left: Clear)"));
        return;
      }
      var piece = gearPiece(b, slot, rec);
      current.appendChild(gearIcon(slot, piece));
      current.appendChild(el("span", "qe-gear-name", gearLabel(slot, piece, gearNameOf(slot, piece, drawCurrent))));
      var kind = gearKind(slot, piece.id, piece.ranged);
      if (kind === "-") {
        wrap.classList.add("is-invalid");
        current.appendChild(el("span", "qe-gear-why", "not a piece the server takes: pick another"));
      } else if (kind === "b" || kind === "g") {
        current.appendChild(el("span", "qe-gear-kind", KIND_NAMES[kind] + " only"));
      }
    }
    drawCurrent();

    var actions = el("div", "qe-gear-actions");
    var chooseBtn = UI.button(inForce(rec) ? "Change" : "Choose", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) input.focus();
    }, "add", "Choose the forced " + s.name.toLowerCase());
    actions.appendChild(chooseBtn);
    if (!blankRecord(rec)) {
      actions.appendChild(UI.button("Clear", function () { onPick(null); }, "remove", "Stop forcing the " + s.name.toLowerCase()));
    }
    wrap.appendChild(actions);

    var panel = el("div", "qe-gear-search");
    panel.hidden = true;
    var input = el("input");
    input.type = "search";
    input.placeholder = slot === GEAR_WEAPON ? "Type a weapon's name or id" : "Type a " + s.name.toLowerCase() + " piece's name or id";
    input.setAttribute("aria-label", "Search " + s.name.toLowerCase() + " pieces");
    panel.appendChild(input);
    if (slot !== GEAR_WEAPON) {
      var bare = UI.button("Force no piece", function () { onPick({ id: 0, ranged: false }); }, null,
        "Force the " + s.name.toLowerCase() + " slot empty");
      bare.classList.add("qe-gear-bare");
      panel.appendChild(bare);
    }
    var found = el("ul", "qe-gear-results");
    var status = note("Type at least 2 letters, or an id.");
    panel.appendChild(status);
    panel.appendChild(found);
    wrap.appendChild(panel);

    var timer = null;
    var asked = 0;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var term = input.value.trim();
      found.textContent = "";
      if (term.length < 2 && !/^\d+$/.test(term)) { status.textContent = "Type at least 2 letters, or an id."; return; }
      status.textContent = "Searching…";
      timer = setTimeout(function () {
        var mine = ++asked;
        searchGear(slot, term).then(function (list) {
          if (mine !== asked) return;
          var setKind = gearSetKind(b, slot);
          var shown = 0;
          var hidden = 0;
          list.forEach(function (e) {
            var kind = gearKind(slot, e.id, e.ranged);
            if (kind === "-") { hidden += 1; return; }
            var clash = (kind === "b" || kind === "g") && (setKind === "b" || setKind === "g") && kind !== setKind;
            var li = el("li");
            var btn = el("button", "qe-gear-option");
            btn.type = "button";
            btn.appendChild(gearIcon(slot, e));
            btn.appendChild(el("span", "qe-gear-name", e.name));
            btn.appendChild(el("span", "bui-id", "#" + e.id));
            if (clash) {
              btn.disabled = true;
              btn.appendChild(el("span", "bui-hint", "for " + KIND_NAMES[kind] + "; the set is for " + KIND_NAMES[setKind]));
            } else if (kind === "b" || kind === "g") {
              btn.appendChild(el("span", "bui-hint", KIND_NAMES[kind] + " only"));
            }
            btn.addEventListener("click", function () { onPick({ id: e.id, ranged: e.ranged }); });
            li.appendChild(btn);
            found.appendChild(li);
            shown += 1;
          });
          status.textContent = shown ? (list.length >= 40 ? "The first matches; type more of the name to narrow them." : "")
            + (hidden ? " " + hidden + " placeholder " + (hidden === 1 ? "row" : "rows") + " of the game's tables left out." : "")
            : list.length ? "Only placeholder rows of the game's tables match: they cannot be forced."
              : "Nothing matches “" + term + "”.";
        }).catch(function () {
          if (mine === asked) status.textContent = "The equipment list could not be loaded. Try again in a moment.";
        });
      }, 250);
    });
    return wrap;
  }

  var decoList = null;
  /** None, then the decorations Capcom's quest files force (data/forced-equipment.json), by name. */
  function decoOptions() {
    if (decoList) return decoList;
    decoList = [{ value: 0, label: "None" }].concat(((forcedGear || {}).decorations || []).map(function (id) {
      return { value: id, label: itemName(id) };
    }).sort(byLabel));
    return decoList;
  }

  function equipmentSection(model) {
    var b = model.body;
    var p = UI.section("Forced equipment (arena)", "the gear every hunter must use");
    p.appendChild(note("Untested in game: no forced equipment made here has been tried in the game yet. The game"
      + " swaps each hunter's gear for these pieces when the quest starts (read from its code); try the quest in"
      + " testing before you submit it.", "bui-notice bui-warn qe-gear-untested"));
    p.appendChild(note("Leave a slot “Not forced” to let hunters bring their own. Pieces come from the game's"
      + " equipment tables, placeholder rows left out; a set cannot mix blademaster and gunner pieces. An arena quest"
      + " usually also has a supply box (Rewards) and a restriction such as “No items” (Rules and restrictions); the"
      + " quest file has no pouch of its own."));
    if (!forcedGear) {
      p.appendChild(note("The list of pieces could not be loaded, so nothing can be forced now. Reload the page to try"
        + " again.", "bui-notice bui-warn"));
      return p;
    }
    var rows = [];
    GEAR_ORDER.forEach(function (slot) {
      var s = GEAR_SLOTS[slot];
      var rec = gearList(b)[slot];
      var forced = inForce(rec);
      var cells = [{ label: "Slot", node: el("strong", null, s.name) }];
      if (slot === GEAR_WEAPON) {
        cells.push({ label: "Forced piece", ref: F(["body.equipment[].piece", "body.flagsAtC0"], slot),
          node: gearChooser(model, slot, function (piece) {
            var rec = gearRecord(b, slot);
            var keep = inForce(rec);
            rec.piece = piece ? (piece.id & 0x3fff) | (piece.ranged ? GEAR_GUNNER : 0) : 0;
            b.flagsAtC0 = ((b.flagsAtC0 || 0) & ~GEAR_ID_BIT14) | (piece && piece.id & 0x4000 ? GEAR_ID_BIT14 : 0);
            rec.word1 = piece ? GEAR_ON | (keep ? rec.word1 & GEAR_DECO : 0) : 0;
            rec.word2 = piece ? GEAR_ON | (keep ? rec.word2 & GEAR_DECO : 0) : 0;
            rec.word3 = piece ? GEAR_ON | (keep ? rec.word3 & GEAR_DECO : 0) : 0;
            redraw("equipment");
            changed();
          }) });
      } else {
        cells.push({ label: "Forced piece", ref: F("body.equipment[].piece", slot),
          node: gearChooser(model, slot, function (piece) {
            var rec = gearRecord(b, slot);
            var keep = inForce(rec) && piece && piece.id !== 0;
            rec.piece = piece ? piece.id : 0;
            rec.word1 = piece ? GEAR_ON | (keep ? rec.word1 & GEAR_DECO : 0) : 0;
            rec.word2 = piece ? GEAR_ON | (keep ? rec.word2 & GEAR_DECO : 0) : 0;
            rec.word3 = piece ? GEAR_ON | (keep ? rec.word3 & GEAR_DECO : 0) : 0;
            redraw("equipment");
            changed();
          }) });
      }
      var decos = forced && (slot === GEAR_WEAPON || rec.piece !== 0);
      function decoPicker(word, ref, write) {
        var d = UI.picker({ options: decoOptions(), value: rec[word] & GEAR_DECO, kind: "item", compact: true, showIds: true,
          label: s.name + " decoration " + word.slice(-1), disabled: !decos, unknownLabel: itemName, onChange: writes(write) });
        var v = rec[word] & GEAR_DECO;
        if (decos && v && !decoOptions().some(function (o) { return o.value === v; })) {
          d.setProblem("The server does not take this decoration: pick another, or None.");
        }
        cells.push({ label: "Decoration " + word.slice(-1), ref: ref, node: d.el });
      }
      decoPicker("word1", F("body.equipment[].word1", slot), function (v) {
        var rec = gearRecord(b, slot);
        rec.word1 = GEAR_ON | v;
      });
      decoPicker("word2", F("body.equipment[].word2", slot), function (v) {
        var rec = gearRecord(b, slot);
        rec.word2 = GEAR_ON | v;
      });
      decoPicker("word3", F("body.equipment[].word3", slot), function (v) {
        var rec = gearRecord(b, slot);
        rec.word3 = GEAR_ON | v;
      });
      rows.push(cells);
    });
    var wrap = UI.table(["Slot", "Forced piece", "Decoration 1", "Decoration 2", "Decoration 3"], rows, "", "qe-gear-table");
    // Each row's record index, so a refusal naming body.equipment[N] lands in its row (placeFor).
    [].forEach.call(wrap.querySelectorAll("tbody tr"), function (tr, i) {
      [].forEach.call(tr.querySelectorAll("td[data-fields]"), function (td) { td.setAttribute("data-index", String(GEAR_ORDER[i])); });
    });
    p.appendChild(wrap);
    p.appendChild(note("Decorations: only the ones Capcom's own quests force are offered, and the game was not seen"
      + " to check a piece's slots, so a piece may show more decorations than it has slots. Also untested: a piece for"
      + " one gender only (Capcom's quests force some)."));
    return p;
  }

  /** "Great Sword X, Head #4, legs left empty" or "none" for the review. */
  function equipmentText(model) {
    var b = model.body;
    var parts = [];
    GEAR_ORDER.forEach(function (slot) {
      var rec = gearList(b)[slot];
      if (!inForce(rec)) return;
      var piece = gearPiece(b, slot, rec);
      if (slot !== GEAR_WEAPON && piece.id === 0) { parts.push(GEAR_SLOTS[slot].name.toLowerCase() + " left empty"); return; }
      var name = gearNames[gearTable(slot, piece.ranged) + ":" + piece.id];
      var decos = [rec.word1, rec.word2, rec.word3].filter(function (w) { return w & GEAR_DECO; }).length;
      parts.push((name || GEAR_SLOTS[slot].name + " #" + piece.id) + (decos ? " (" + decos + (decos === 1 ? " decoration)" : " decorations)") : ""));
    });
    return parts.length ? parts.join(", ") + " — not tested in game" : "none (hunters bring their own)";
  }

  /** What the page sees wrong in the forced equipment, for the review list. */
  function equipmentProblems(model) {
    var b = model.body;
    var out = [];
    if (!forcedGear || !Array.isArray(b.equipment)) return out;
    var weapon = false;
    b.equipment.forEach(function (rec, slot) {
      var s = GEAR_SLOTS[slot];
      if (!inForce(rec)) {
        if (!blankRecord(rec)) out.push("The " + s.name.toLowerCase() + " slot holds old bytes: clear it (Forced equipment).");
        return;
      }
      if (slot === GEAR_WEAPON) weapon = true;
      var piece = gearPiece(b, slot, rec);
      if (gearKind(slot, piece.id, piece.ranged) === "-") {
        out.push("The forced " + s.name.toLowerCase() + " (#" + piece.id + ") is not a piece the server takes (Forced equipment).");
      }
    });
    if (gearSetKind(b, -1) === "x") out.push("The forced set mixes blademaster and gunner pieces (Forced equipment).");
    if (!weapon && (b.flagsAtC0 || 0) & GEAR_ID_BIT14) out.push("A weapon bit is left without a forced weapon: force a weapon or clear it (Forced equipment).");
    return out;
  }

  // ---- 3. map and start area -----------------------------------------------------------------

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
    // A spot belongs to its map: every large monster starts again at its area's usual spot.
    (model.largeSpawnAreas || []).forEach(function (area) {
      (area.spawns || []).forEach(function (spawn) { spawn.position = null; });
    });
    state.exactSpawns = [];
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
    if (typeof b.seasonFlags === "number") {
      g.appendChild(fieldFor(F("body.seasonFlags"), "Time of day", UI.picker({
        options: TIMES, value: b.seasonFlags & TIME_BITS,
        unknownLabel: function (v) { return v === TIME_BITS ? "Day and night (both bits, untested)" : "Not set"; },
        onChange: writes(function (v) { b.seasonFlags = (b.seasonFlags & ~TIME_BITS & 0xff) | v; flagsInStep(b); })
      }), "Day or night on the map."));
      g.appendChild(fieldFor(F("body.seasonFlags"), "Season", UI.picker({
        options: SEASONS, value: b.seasonFlags & SEASON_BITS,
        unknownLabel: function (v) { return v === SEASON_BITS ? "All three (untested)" : "Value " + v + " (untested)"; },
        onChange: writes(function (v) { b.seasonFlags = (b.seasonFlags & ~SEASON_BITS & 0xff) | v; flagsInStep(b); })
      }), null, { help: "The season the game plays the map in. It is set in the quest file, so it does not follow"
        + " the server's season. What a season changes on the map beyond that is not fully known: test the quest"
        + " in game." }));
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
     its reward money (builder item 14; a used sub-target edits its own, subTargetMoney). */
  var OBJECTIVES = [
    { key: "objective0", name: "Main target", money: "body.rewardMoney", paid: "Reward money, under Basics" },
    { key: "objective1", name: "Sub-target A", money: "body.objective1Money" },
    { key: "objective2", name: "Sub-target B", money: "body.objective2Money" }
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

  /** Sub-target A or B's reward money (body +0x18, +0x1c; the API takes 0..999,999, as for the main reward money). */
  function subTargetMoney(b, index) {
    var hint = "Paid for this sub-target, on top of the main reward money. Custom quests pay it, in testing too.";
    if (index === 1) {
      return numberFor(F("body.objective1Money"), "Reward money", {
        id: "obj-1-money", value: b.objective1Money, min: 0, unit: "zenny",
        onChange: writes(function (v) { b.objective1Money = v; })
      }, hint);
    }
    return numberFor(F("body.objective2Money"), "Reward money", {
      id: "obj-2-money", value: b.objective2Money, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.objective2Money = v; })
    }, hint);
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
      if (money && index === 0) p.appendChild(note("Its reward money is " + money + " (" + spec.paid + ")."));
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
        if (index > 0) g.appendChild(subTargetMoney(b, index));
      }
      p.appendChild(g);
    });

    if (typeof b.objectiveMode === "number") {
      var modeOptions = MODES.map(function (m) {
        var missing = m.needs.filter(function (key) { return !used(b, key); }).length;
        return { value: m.value, label: m.label, disabled: missing > 0 && m.value !== b.objectiveMode,
          hint: missing ? "set the sub-targets first" : "" };
      });
      var mode = null;
      var required = grid();
      required.appendChild(fieldFor(F("body.objectiveMode"), "Targets required to clear", mode = UI.picker({
        options: modeOptions, value: b.objectiveMode, showIds: true,
        unknownLabel: function (v) { return "Mode " + v + " (the server accepts 2 to 4)"; },
        onChange: writes(function (v) {
          b.objectiveMode = v;
          setSeasonBits(b, ALL_REQUIRED, v >= 3 ? ALL_REQUIRED : 0);
          mode.setProblem(modeProblem(b));
        })
      }), null, {
        help: "Main target only: the quest clears on the main target, and sub-targets pay extra. With more than the"
          + " main target required, the quest clears only when all of them are done, and the game pays the"
          + " sub-target rewards with the main reward." }));
      mode.setProblem(modeProblem(b));
      p.appendChild(required);
    }

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
    // Large monsters have a position the author may set; small monsters keep the file's.
    var large = where.indexOf("largeSpawnAreas") === 0;
    var rows = spawns.map(function (spawn, index) {
      var areaRef = F("largeSpawnAreas[].spawns[].areaId");
      var area = options.length ? UI.picker({
        options: options, value: spawn.areaId, compact: true, showIds: true, label: "Area of " + monsterName(spawn.monsterId),
        unknownLabel: function (v) { return areaLabel(v, mapId); },
        onChange: writes(function (v) {
          spawn.areaId = v;
          area.setProblem("");
          // A spot belongs to its area: a new area starts at its usual spot.
          if (large) { spawn.position = null; forgetExact(spawn); redraw("monsters"); }
        })
      }) : UI.numberInput(ranged(areaRef, {
        value: spawn.areaId, min: 0, label: "Area id", onChange: writes(function (v) {
          spawn.areaId = v;
          if (large) { spawn.position = null; forgetExact(spawn); }
        })
      }));
      if (options.length && !areaOnMap(spawn.areaId, mapId)) area.setProblem("This area is not part of the chosen map: pick another.");
      var cells = [
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
        { label: "Area", ref: areaRef, node: area }
      ];
      if (large) cells.push(positionCell(model, spawn));
      cells.push({ cls: "bui-row-end", node: UI.button("Remove", function () {
        keepForms(model, function () { spawns.splice(index, 1); });
        forgetExact(spawn);
        redraw("monsters");
        changed();
      }, "remove", "Remove " + monsterName(spawn.monsterId)) });
      return cells;
    });
    var headers = ["Monster", "How many", "Area"].concat(large ? ["Position"] : []);
    var t = UI.table(headers.concat([{ label: "", cls: "bui-row-end" }]), rows, "No monsters here yet.");
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
    p.appendChild(UI.subhead("Strength and size"));
    p.appendChild(strengthFields(model));
    p.appendChild(UI.subhead("Large monsters"));
    p.appendChild(note("Position is where the monster starts in its area. The usual spot is where Capcom's quests put"
      + " a large monster in that area; \u201cSet exactly\u201d lets you type x, y (height) and z. A new area or map"
      + " starts again at the usual spot."));
    if (!large.length) p.appendChild(UI.table(["Monster", "How many", "Area", "Position", ""], [], "No monsters yet."));
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
      + " the group's total. While the quest is in testing it is served with these rewards emptied, so a test clear"
      + " pays no items; once an admin approves it, it pays them. The reward money is paid in both."));
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
    p.appendChild(rewardExtras(model));
    return p;
  }

  function rewardFlagOptions() {
    var named = (fieldRef["body.rewardFlag"] || {}).values || REWARD_FLAGS;
    return Object.keys(named).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
      return { value: id, label: capital(valueName(named[id])) };
    });
  }

  /** The three items the main target reward groups weigh most (else the first group's), for Reward 1/2/3. */
  function mainRewardItems(model) {
    var groups = (model.rewardGroups || []).filter(function (g) { return g.groupId === MAIN_REWARD_GROUP; });
    if (!groups.length) groups = (model.rewardGroups || []).slice(0, 1);
    var order = [];
    var weight = {};
    groups.forEach(function (g) {
      (g.entries || []).forEach(function (e) {
        if (!e.itemId) return;
        if (!(e.itemId in weight)) { order.push(e.itemId); weight[e.itemId] = 0; }
        weight[e.itemId] += Number(e.weight) || 0;
      });
    });
    var top = order.map(function (id, i) { return { id: id, w: weight[id], i: i }; })
      .sort(function (a, b) { return b.w - a.w || a.i - b.i; }).slice(0, PREVIEW_ITEMS)
      .map(function (x) { return x.id; });
    while (top.length < PREVIEW_ITEMS) top.push(0);
    return top;
  }

  /** Every item some reward group pays. */
  function paidItems(model) {
    var paid = {};
    (model.rewardGroups || []).forEach(function (g) {
      (g.entries || []).forEach(function (e) { if (e.itemId) paid[e.itemId] = true; });
    });
    return paid;
  }

  /* Reward 1/2/3 of the quest list and the reward flag (gap plan task 5). */
  function rewardExtras(model) {
    var b = model.body;
    var box = el("div", "bui-reward-extras");
    box.appendChild(UI.subhead("Quest list rewards"));
    box.appendChild(note("Reward 1, 2 and 3: the items the quest list shows for this quest. They show once an admin"
      + " approves the quest; the testing copy lists none, as it pays no items. Usually the main target's best"
      + " rewards."));
    var items = Array.isArray(b.previewItems) ? b.previewItems : [0, 0, 0];
    var g = grid();
    [0, 1, 2].forEach(function (i) {
      g.appendChild(fieldFor(F("body.previewItems[]", i), "Reward " + (i + 1), UI.picker({
        options: itemOptions(), value: items[i] || 0, kind: "item", showIds: true, unknownLabel: itemName,
        label: "Quest list reward " + (i + 1),
        onChange: writes(function (v) {
          var list = (Array.isArray(b.previewItems) ? b.previewItems : [0, 0, 0]).slice();
          list[i] = v;
          b.previewItems = list;
        })
      })));
    });
    box.appendChild(g);
    var actions = el("div", "bui-actions");
    var fill = UI.button("Use the main target's rewards", function () {
      b.previewItems = mainRewardItems(model);
      redraw("rewards");
      changed();
    });
    fill.id = "reward-preview-fill";
    fill.disabled = !mainRewardItems(model)[0];
    if (fill.disabled) fill.title = "Add a main target reward first.";
    actions.appendChild(fill);
    box.appendChild(actions);

    var flags = grid();
    flags.appendChild(fieldFor(F("body.rewardFlag"), "Fixed rewards", UI.picker({
      options: rewardFlagOptions(), value: typeof b.rewardFlag === "number" ? b.rewardFlag : 0, showIds: true,
      unknownLabel: function (v) { return "Value " + v + " (the server accepts 0 to 4)"; },
      onChange: writes(function (v) { b.rewardFlag = v; })
    }), "Which rewards a clear always pays rather than drawing them by weight. Pax's editor's names; not traced in"
      + " the game's code, so test it."));
    box.appendChild(flags);
    return box;
  }

  // ---- 6. text -------------------------------------------------------------------------------

  /* Text auto-fill (gap plan task 5, as Pax's editor's buttons): the target lines from the objectives, the clear line
     from the targets required, the fail line from the faint rule. The last fill can be undone until the next one. */
  var lastFill = null;

  function article(word) {
    return /^[aeiou]/i.test(word) ? "an" : "a";
  }

  /** "Hunt a Tigrex", "Slay 3 Velociprey", "Deliver 5 Herbs"; "None" for an unused objective. */
  function objectiveLine(o) {
    if (!o || o.type === 0) return "None";
    var item = isItemObjective(o.type);
    var what = item ? itemName(o.target) : monsterName(o.target);
    var n = Number(o.count) || 0;
    var verb = {
      1: "Hunt", 257: "Capture", 513: "Slay", 2: "Deliver", 4098: "Deliver", 32772: "Damage", 98308: "Slay or damage"
    }[o.type];
    if (o.type === 16388) return "Break " + (n === 1 ? "a part" : n + " parts") + " of " + article(what) + " " + what;
    if (verb) return verb + " " + (n === 1 ? article(what) : n) + " " + what;
    var named = valueName(((fieldRef["body.objective0.type"] || {}).values || objectiveTypes)[String(o.type)]);
    return (named || "Objective") + ": " + n + " " + what;
  }

  function targetLines(model) {
    var b = model.body;
    return { 1: objectiveLine(b.objective0), 2: objectiveLine(b.objective1), 3: objectiveLine(b.objective2) };
  }

  function clearFailLines(model) {
    var b = model.body;
    var clear = { 3: "Complete the main target and sub-target A", 4: "Complete all targets" }[b.objectiveMode]
      || "Complete the main target";
    var faints = Number(b.faintPenalty) || 0;
    var fail = isG(b) ? "Faint " + (faints === 1 ? "once" : faints + " times") + " / Time runs out"
      : faints > 0 ? "Reward money hits zero / Time runs out" : "Time runs out";
    return { 4: clear, 5: fail };
  }

  function fillTexts(model, lines, what) {
    var before = {};
    var names = [];
    Object.keys(lines).forEach(function (index) {
      var slot = slotByIndex(model, Number(index));
      if (!slot) return;
      before[index] = slot.text || "";
      slot.text = lines[index];
      names.push((SLOTS[index] || { name: "Text " + index }).name);
    });
    lastFill = { before: before, text: "Wrote " + names.join(", ") + " " + what + "." };
    redraw("text");
    changed();
  }

  function undoFill(model) {
    if (!lastFill) return;
    Object.keys(lastFill.before).forEach(function (index) {
      var slot = slotByIndex(model, Number(index));
      if (slot) slot.text = lastFill.before[index];
    });
    lastFill = null;
    redraw("text");
    changed();
  }

  function textSection(model) {
    var p = UI.section("Quest text", "what the quest card says",
      "Each text has a set room in bytes: a plain letter takes 1, a Japanese character 2. Longer text is not"
      + " cut; it is stored at the end of the file. English and Japanese only. What the texts marked"
      + " (unconfirmed) are was read from sample quest files, not from the game's code.");
    var actions = el("div", "bui-actions");
    var targets = UI.button("Write the target lines", function () {
      fillTexts(model, targetLines(model), "from the objectives");
    });
    targets.id = "text-fill-targets";
    var rules = UI.button("Write the clear and fail lines", function () {
      fillTexts(model, clearFailLines(model), "from the targets required and the faint rule");
    });
    rules.id = "text-fill-rules";
    actions.appendChild(targets);
    actions.appendChild(rules);
    p.appendChild(actions);
    if (lastFill) {
      var done = note(lastFill.text + " ", "bui-fill-note");
      var undo = UI.button("Undo", function () { undoFill(model); });
      undo.id = "text-fill-undo";
      done.appendChild(undo);
      p.appendChild(done);
    } else {
      p.appendChild(note("The two buttons write the main and sub-target lines, or the clear and fail lines, from what"
        + " you set above, over what the texts hold; edit them after."));
    }
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
    var needs = modeProblem(b);
    if (needs) list.push("Targets required to clear: " + needs + " (Objectives).");
    var listing = state.listing;
    if (!COUNTERS.some(function (c) { return c.value === listing.questType; })) {
      list.push("The counter " + listing.questType + " is not one a custom quest can use (Quest board listing).");
    }
    if (!MARKS.some(function (m) { return m.value === listing.mark; })) {
      list.push("The mark " + listing.mark + " is not one a custom quest can use (Quest board listing).");
    }
    if (typeof b.seasonFlags === "number" && !(b.seasonFlags & TIME_BITS)) {
      list.push("No time of day is set (Map and start area).");
    }
    var off = allSpawns(model).filter(function (s) { return !areaOnMap(s.areaId, b.mapId); }).length;
    if (off) list.push(off + (off === 1 ? " monster is" : " monsters are") + " in an area that is not part of the map (Monsters).");
    var level = levelProblem(model);
    if (level) list.push("Difficulty: " + level + " (Monsters).");
    var size = model.header && model.header.monsterSize;
    if (typeof size === "number" && (size < 70 || size > 150)) {
      list.push("The size is " + size + "%; the server takes 70 to 150 (Monsters).");
    }
    var far = 0;
    (model.largeSpawnAreas || []).forEach(function (area) {
      (area.spawns || []).forEach(function (s) { if (!emptyPosition(s.position) && outsideBounds(s.position, b.mapId)) far += 1; });
    });
    if (far) list.push(far + (far === 1 ? " monster's exact position is" : " monsters' exact positions are")
      + " outside what the server allows on this map (Monsters).");
    if (isHardcore(b) && b.questClass !== hardcoreClass()) {
      list.push("Hardcore needs an HR 100 and up quest: set the quest class, or turn Hardcore off (Rules and restrictions).");
    } else if (b.conditionNote && !isHardcore(b) && !noteOptions().some(function (o) { return o.value === b.conditionNote; })) {
      list.push("The restriction " + b.conditionNote + " is not one the server takes (Rules and restrictions).");
    }
    if (typeof b.faintPenalty === "number" && isG(b) && (b.faintPenalty < G_FAINTS.min || b.faintPenalty > G_FAINTS.max)) {
      list.push("A G rank quest allows " + G_FAINTS.min + " to " + G_FAINTS.max + " faints; this one says " + b.faintPenalty
        + " (Rules and restrictions).");
    }
    [rankProblem(b.postRankMin, b.postRankMax, "post"), rankProblem(b.rank, b.joinRankMax, "join")].forEach(function (why) {
      if (why) list.push(why + " (Rules and restrictions)");
    });
    OBJECTIVES.slice(1).forEach(function (spec) {
      var paid = Number(b[spec.money.replace("body.", "")]) || 0;
      if (paid && !used(b, spec.key)) {
        list.push(spec.name + " is not used but pays " + paid.toLocaleString() + " zenny (Objectives).");
      }
    });
    var paidNow = paidItems(model);
    (Array.isArray(b.previewItems) ? b.previewItems : []).forEach(function (id, i) {
      if (id && !paidNow[id]) {
        list.push("Quest list reward " + (i + 1) + " (" + itemName(id) + ") is not an item any reward group pays (Rewards).");
      }
    });
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
    return list.concat(equipmentProblems(model));
  }

  /** "difficulty 26 · HR5, size 100% (95–110%), 1 at an exact spot" for the review. */
  function strengthText(model) {
    var h = model.header;
    if (!h) return "\u2013";
    var zenith = ZENITH_LEVELS.indexOf(h.monsterLevel);
    var parts = [zenith >= 0 && Object.keys(zenithSet(model)).length ? "Zenith \u2605" + (zenith + 1)
      : "difficulty " + levelLabel(h.monsterLevel)];
    if (typeof h.monsterSize === "number") {
      parts.push("size " + h.monsterSize + "% (" + optionLabel(spreadOptions(), h.sizeClass, "spread " + h.sizeClass) + ")");
    }
    var exact = 0;
    (model.largeSpawnAreas || []).forEach(function (area) {
      (area.spawns || []).forEach(function (s) { if (isExact(s, model.body.mapId)) exact += 1; });
    });
    if (exact) parts.push(exact + " at an exact spot");
    return parts.join(", ");
  }

  function moneyText(b) {
    var z = function (v) { return Number(v || 0).toLocaleString() + " zenny"; };
    var parts = ["fee " + z(b.zenny), "reward " + z(b.rewardMoney)];
    if (b.objective1Money) parts.push("sub-target A " + z(b.objective1Money));
    if (b.objective2Money) parts.push("sub-target B " + z(b.objective2Money));
    return parts.join(", ") + " (paid in testing too)";
  }

  function previewText(b) {
    var ids = (Array.isArray(b.previewItems) ? b.previewItems : []).filter(Boolean);
    return ids.length ? ids.map(itemName).join(", ") + " (shown once approved; the testing copy lists none)" : "none";
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
    var listing = state.listing;
    var players = (b.maxHunters & 7) === 1 ? "solo" : "up to " + ((b.maxHunters & 7) || 4) + " hunters";
    var row = [new Array((b.level || 0) + 1).join("\u2605") || "no stars"];
    if (listing.mark) row.push(optionLabel(MARKS, listing.mark, "mark " + listing.mark));
    row.push(title && title.text ? title.text : "(no name yet)");
    var required = optionLabel(MODES, b.objectiveMode, "");
    var facts = [
      ["Name", title && title.text ? title.text : "(none yet)"],
      ["In the quest list", row.join(" \u00b7 ") + " \u2014 " + optionLabel(COUNTERS, listing.questType,
        "counter " + listing.questType) + " counter, " + starsText(b.level || 0) + ", " + players],
      ["Map", mapName(b.mapId)],
      ["Time and season", typeof b.seasonFlags === "number"
        ? optionLabel(TIMES, b.seasonFlags & TIME_BITS, (b.seasonFlags & TIME_BITS) === TIME_BITS ? "Day and night" : "No time of day")
          + ", " + optionLabel(SEASONS, b.seasonFlags & SEASON_BITS, "season value " + (b.seasonFlags & SEASON_BITS)).toLowerCase()
        : "\u2013"],
      ["Start area", model.startAreas && model.startAreas.length ? areaName(model.startAreas[0].areaId, b.mapId) : "–"],
      ["Time and players", Math.round((b.timeLimit || 0) / TICKS_PER_MINUTE) + " minutes, "
        + ((b.maxHunters & 7) === 1 ? "solo" : "up to " + ((b.maxHunters & 7) || 4) + " hunters")],
      ["Money", moneyText(b)],
      ["Objectives", (goals.length ? goals.join("; ") : "none set") + (required ? " (to clear: " + required.toLowerCase() + ")" : "")],
      ["Monsters", spawns.length ? spawns.map(function (s) { return s.count + " × " + formName(model, s.monsterId); }).join(", ") : "none yet"],
      ["Strength and size", strengthText(model)],
      ["Rules", rulesText(model)],
      ["Forced equipment", equipmentText(model)],
      ["Supplies and rewards", supplies + (supplies === 1 ? " supply item, " : " supply items, ") + rewards + (rewards === 1 ? " reward" : " rewards")
        + " (" + optionLabel(rewardFlagOptions(), typeof b.rewardFlag === "number" ? b.rewardFlag : 0, "reward flag " + b.rewardFlag).toLowerCase()
        + "); paid once approved, none while testing"],
      ["Quest list rewards", previewText(b)]
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
    ["basics", basicsSection], ["listing", listingSection], ["rules", rulesSection], ["equipment", equipmentSection], ["map", mapSection], ["objectives", objectivesSection], ["monsters", monstersSection],
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
    m = /body\.objectiveMode (\d) requires sub-target ([AB])/.exec(text);
    if (m) {
      out.push({ key: "body.objectiveMode", text: "The server needs sub-target " + m[2] + " for this choice: set it, or"
        + " require fewer targets." });
    }
    var season = /body\.seasonFlags sets ([^;]*?), which no quest file does/g;
    while ((m = season.exec(text))) {
      out.push({ key: "body.seasonFlags", text: "The server refused the time of day or season: it " + m[1] + "." });
    }
    m = /(largeSpawnAreas\[\d+\]\.spawns\[\d+\]\.position) is ([^;]+) on map (\d+); allowed (x [^(]*?) \(/.exec(text);
    if (m) {
      out.push({ key: m[1], text: "This position (" + m[2] + ") is outside what the server allows on this map: "
        + m[4] + ". Move it, or use the usual spot." });
    }
    m = /(largeSpawnAreas\[\d+\]\.spawns\[\d+\]\.position) must stay within (-?\d+)\.\.(-?\d+)/.exec(text);
    if (m) {
      out.push({ key: m[1], text: "The server takes positions from " + m[2] + " to " + m[3] + " only." });
    }
    m = /header\.monsterLevel (\d+) is a (G rank|Zenith) level/.exec(text);
    if (m) {
      out.push({ key: "header.monsterLevel", text: "The server refused difficulty " + m[1] + ": " + (m[2] === "Zenith"
        ? "it is a Zenith rank, for a quest with a Zenith monster only." : "it is a G rank level, for a G rank quest only.") });
    }
    m = /body\.conditionNote (\d+) makes a quest Hardcore/.exec(text);
    if (m) {
      out.push({ key: "body.conditionNote", text: "The server refused Hardcore: it needs an HR 100 and up quest (quest"
        + " class, Basics)." });
    }
    m = /body\.conditionNote (\d+) is not one of the restrictions offered/.exec(text);
    if (m) {
      out.push({ key: "body.conditionNote", text: "The server does not take restriction " + m[1] + ": pick another." });
    }
    var order = /body\.(postRankMax|joinRankMax) is (\d+), below body\.\w+ (\d+)/g;
    while ((m = order.exec(text))) {
      out.push({ key: "body." + m[1], text: "The server refused a highest rank (" + m[2] + ") below the lowest (" + m[3]
        + "): raise it, or 0 for no limit." });
    }
    m = /body\.(variantFlags[23]) bit \d \((Road|Interception)\)/.exec(text);
    if (m) {
      out.push({ key: "body." + m[1], text: "The server does not take the " + m[2] + " flag." });
    }
    var gear = /body\.equipment\[(\d)\]\.piece: (?:[\w ]+?) (\d+) is not a/g;
    while ((m = gear.exec(text))) {
      out.push({ key: "body.equipment[" + m[1] + "].piece", text: "The server does not take this "
        + (GEAR_SLOTS[Number(m[1])] || { name: "piece" }).name.toLowerCase() + " (#" + m[2] + "): pick another." });
    }
    var deco = /body\.equipment\[(\d)\]\.(word[123]): decoration (\d+) is not one/g;
    while ((m = deco.exec(text))) {
      out.push({ key: "body.equipment[" + m[1] + "]." + m[2], text: "The server does not take decoration " + itemName(m[3])
        + " (#" + m[3] + "): pick another, or None." });
    }
    if (/body\.equipment mixes blademaster and gunner pieces/.test(text)) {
      out.push({ key: "body.equipment[1].piece", text: "The server refused a set that mixes blademaster and gunner pieces." });
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
        body: JSON.stringify({ model: state.model, listing: state.listing })
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
    if (window.HvTime && !isNaN(date)) return HvTime.text(date, { time: false });
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
      var updatedCell = el("td");
      if (window.HvTime && !isNaN(new Date(row.updatedAt))) updatedCell.appendChild(HvTime.node(row.updatedAt, { time: false }));
      else updatedCell.textContent = when(row.updatedAt);
      tr.appendChild(updatedCell);
      draftsBody.appendChild(tr);
    });
  }

  // ---- render --------------------------------------------------------------------------------

  function render(model) {
    state.model = model;
    if (!model.largeSpawnAreas) model.largeSpawnAreas = [];
    if (!model.rewardGroups) model.rewardGroups = [];
    // A draft saved before Reward 1/2/3 were in the model holds the old blank's three items in its raw bytes, which
    // nobody chose: it starts with none, as a new quest does (API README "Reward extras").
    var b = model.body;
    if (b && model.layout === "QUEST" && !Array.isArray(b.previewItems)) b.previewItems = [0, 0, 0];
    lastFill = null;
    panels(model);
    titleEl.textContent = "New quest";
    document.title = "New quest · Hunsterverse";
    subEl.textContent = "Work down the page: basics, listing, map, objectives, monsters, rewards and text, then"
      + " review and submit at the end. The server assigns the quest id when you submit.";
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
        state.listing = copyListing(draft.listing);
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
