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

  /* The eight text slots by their index in the file, with plain labels. Title is edited under Basics. */
  var SLOTS = {
    0: { name: "Quest name", hint: "The name the quest board shows.", rows: 1, wide: true },
    1: { name: "Objective", hint: "What the quest asks for, as the quest list shows it.", rows: 2, wide: true },
    2: { name: "Sub-objective A", hint: "Text of the first sub-objective. Leave it empty if there is none.", rows: 2 },
    3: { name: "Sub-objective B", hint: "Text of the second sub-objective. Leave it empty if there is none.", rows: 2 },
    4: { name: "Main objective", hint: "The line the quest card leads with.", rows: 2, wide: true },
    5: { name: "Fail condition", hint: "When the quest fails, for example \"Time runs out\".", rows: 2 },
    6: { name: "Client", hint: "Who posted the quest.", rows: 1 },
    7: { name: "Description", hint: "The text on the quest card.", rows: 4, wide: true }
  };
  var TEXT_ORDER = [1, 4, 7, 6, 5, 2, 3];

  /* body +0x20 counts 30 ticks a second, so a minute is 1 800 of them. */
  var TICKS_PER_MINUTE = 1800;

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

  var state = { model: null, draftId: null, revision: 0, busy: false, mapMessage: "", supplyShown: {} };

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
        window.location.replace("/account.html");
        throw new Error("Sign in to use the quest builder.");
      }
      return res;
    });
  }

  function body(res) {
    return res.json().catch(function () { return null; }).then(function (payload) {
      if (!res.ok) {
        throw new Error((payload && payload.message) || "The server answered " + res.status + ".");
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

  function loadTables() {
    function grab(url) {
      return fetch(url).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    }
    return Promise.all([
      grab("/data/map-ids.json"), grab("/data/map-areas.json"), grab("/data/area-ids.json"),
      grab("/data/item-ids.json"), grab("/data/objective-types.json"), grab("/data/monster-ids.json"),
      UI.loadIcons(["monsters", "items"])
    ]).then(function (r) {
      mapIds = r[0] || {}; mapAreas = r[1] || {}; areaIds = r[2] || {}; itemIds = r[3] || {};
      objectiveTypes = r[4] || {}; monsterIds = r[5] || {};
    });
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

  function areasForMap(mapId) {
    return (mapAreas[String(mapId)] || []).slice();
  }

  /** "Day" or "Night" from the name of the map's first area, when its name says. */
  function timeOfDay(mapId) {
    var first = areasForMap(mapId)[0];
    var name = first !== undefined ? areaIds[String(first)] || "" : "";
    var m = name.match(/\b(Day|Night)$/);
    return m ? m[1].toLowerCase() : "";
  }

  function mapName(mapId) {
    var entry = mapIds[String(mapId)];
    var name = entry && entry.name && entry.name !== "None" ? entry.name : "Unnamed map";
    var time = timeOfDay(mapId);
    return time ? name + ", " + time : name;
  }

  var mapList = null;
  function mapOptions() {
    if (mapList) return mapList;
    mapList = Object.keys(mapIds).map(Number).map(function (id) {
      var entry = mapIds[id] || {};
      var count = areasForMap(id).length;
      var hint = count ? count + (count === 1 ? " area" : " areas") : "";
      if (entry.share !== undefined && entry.share !== null && entry.share < 0.5) hint += (hint ? ", " : "") + "name is a best guess";
      return { value: id, label: mapName(id), hint: hint };
    }).sort(byLabel);
    return mapList;
  }

  /** An area's name without the map's own name in front ("Area 3, day"). */
  function areaName(areaId, mapId) {
    var name = areaIds[String(areaId)];
    if (!name || /^Loading/.test(name)) return "Unnamed area";
    var entry = mapIds[String(mapId)];
    var prefix = entry && entry.name ? entry.name + " - " : null;
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
    return Object.keys(objectiveTypes).map(Number).sort(function (a, b) { return a - b; })
      .map(function (id) { return { value: id, label: id === 0 ? "Not used" : objectiveTypes[id] }; });
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

  function slotField(slot) {
    var spec = SLOTS[slot.index] || { name: "Text " + (slot.index + 1), hint: "", rows: 2 };
    var wrap = el("div", "field" + (spec.wide ? " bui-wide" : ""));
    var lab = el("div", "slot-lab");
    var label = el("label", null, spec.name);
    label.htmlFor = "slot-" + slot.index;
    var count = el("span", "slot-count");
    lab.appendChild(label);
    lab.appendChild(count);

    var area = el(spec.rows === 1 ? "input" : "textarea");
    area.id = "slot-" + slot.index;
    if (spec.rows === 1) area.type = "text"; else area.setAttribute("rows", String(spec.rows));
    area.value = slot.text || "";

    function refresh() {
      var bytes = shiftJisBytes(area.value);
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
    g.appendChild(UI.numberField("Time limit", {
      id: "meta-time", value: Math.round((b.timeLimit || 0) / TICKS_PER_MINUTE), min: 1, unit: "minutes",
      onChange: writes(function (v) { b.timeLimit = v * TICKS_PER_MINUTE; })
    }));
    g.appendChild(UI.numberField("Players", {
      id: "meta-players", value: b.maxHunters, min: 1, max: 4,
      onChange: writes(function (v) { b.maxHunters = v; })
    }, "How many hunters can join, 1 to 4."));
    g.appendChild(UI.numberField("Contract fee", {
      id: "meta-zenny", value: b.zenny, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.zenny = v; })
    }, "Paid to accept the quest."));
    g.appendChild(UI.numberField("Reward money", {
      id: "meta-money", value: b.rewardMoney, min: 0, unit: "zenny",
      onChange: writes(function (v) { b.rewardMoney = v; })
    }, "Paid on a clear."));
    g.appendChild(UI.field("Item needed to enter", UI.picker({
      options: itemOptions(), value: b.iconLabelId, kind: "item", showIds: true,
      unknownLabel: itemName, onChange: writes(function (v) { b.iconLabelId = v; })
    }), "The quest takes this item when you accept it. None for no item."));
    g.appendChild(UI.numberField("How many it takes", {
      id: "meta-requirement-count", value: b.iconLabelCount, min: 0,
      onChange: writes(function (v) { b.iconLabelCount = v; })
    }));
    p.appendChild(g);

    var more = el("details", "bui-more-settings");
    more.appendChild(el("summary", null, "More settings"));
    var g2 = grid();
    g2.appendChild(UI.numberField("Quest class", {
      id: "meta-class", value: b.questClass, min: 0, max: 255,
      onChange: writes(function (v) { b.questClass = v; })
    }, "The game's class number for the quest. What each number means is not mapped yet, so keep the"
      + " blank quest's value unless you know the one you need."));
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

  /** The map changed: every area list follows it, and anything left outside the new map is said in words. */
  function setMap(model, mapId) {
    var b = model.body;
    b.mapId = mapId;
    var areas = areasForMap(mapId);
    var lines = [];
    var starts = model.startAreas || [];
    if (areas.length && starts.length && areas.indexOf(starts[0].areaId) === -1) {
      var before = starts[0].areaId;
      starts.forEach(function (a) { a.areaId = areas[0]; });
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
    if (known) {
      g.appendChild(UI.field("Map", UI.picker({
        options: mapOptions(), value: b.mapId, showIds: true,
        unknownLabel: function (v) { return "Unlisted map (id " + v + ")"; },
        onChange: function (v) { setMap(model, v); }
      }), "Choosing a map changes the area lists below to that map's areas."));
    } else {
      g.appendChild(UI.numberField("Map", {
        id: "meta-map", value: b.mapId, min: 0, onChange: function (v) { setMap(model, v); }
      }, "The map list could not be loaded, so the map is the game's map number."));
    }
    var starts = model.startAreas || [];
    if (starts.length) {
      var options = areaOptions(b.mapId);
      var start = UI.picker({
        options: options, value: starts[0].areaId, showIds: true,
        unknownLabel: function (v) { return areaLabel(v, b.mapId); },
        onChange: writes(function (v) { starts.forEach(function (a) { a.areaId = v; }); start.setProblem(""); })
      });
      if (!areaOnMap(starts[0].areaId, b.mapId)) start.setProblem("This area is not part of the chosen map.");
      g.appendChild(UI.field("Start area", start, options.length
        ? "Where the party arrives. Most quests start in the map's first area."
        : "This map has no known area list, so every area id is allowed."));
    }
    p.appendChild(g);
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

  function objectivesSection(model) {
    var b = model.body;
    var p = UI.section("Objectives", "what the hunters must do",
      "The first objective is the main one. The other two are optional; leave them as Not used.");
    ["objective0", "objective1", "objective2"].forEach(function (key, index) {
      var objective = b[key];
      if (!objective) return;
      p.appendChild(UI.subhead(index === 0 ? "Main objective" : "Objective " + (index + 1)));
      var g = grid();
      g.appendChild(UI.field("Type", UI.picker({
        options: typeOptions(), value: objective.type,
        unknownLabel: function (v) { return "Other (value " + v + ")"; },
        onChange: writes(function (v) { objective.type = v; redraw("objectives"); })
      })));
      if (objective.type !== 0) {
        var item = isItemObjective(objective.type);
        g.appendChild(UI.field(item ? "Item" : "Monster", UI.picker({
          options: item ? itemOptions() : monsterOptions(), value: objective.target, kind: item ? "item" : "monster",
          showIds: true, unknownLabel: item ? itemName : monsterName,
          onChange: writes(function (v) { objective.target = v; })
        }), item ? "The item to deliver." : "The monster this objective counts."));
        g.appendChild(UI.numberField("How many", {
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
        + " main target; None leaves a slot empty."));
      var g = grid();
      icons.forEach(function (id, i) {
        g.appendChild(UI.field("Picture " + (i + 1), UI.picker({
          options: monsterOptions(), value: id, kind: "monster", showIds: true, unknownLabel: monsterName,
          onChange: writes(function (v) { icons[i] = v; })
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

  function spawnTable(model, spawns) {
    var mapId = model.body.mapId;
    var options = areaOptions(mapId);
    var rows = spawns.map(function (spawn, index) {
      var area = options.length ? UI.picker({
        options: options, value: spawn.areaId, compact: true, showIds: true, label: "Area of " + monsterName(spawn.monsterId),
        unknownLabel: function (v) { return areaLabel(v, mapId); },
        onChange: writes(function (v) { spawn.areaId = v; area.setProblem(""); })
      }) : UI.numberInput({ value: spawn.areaId, min: 0, label: "Area id", onChange: writes(function (v) { spawn.areaId = v; }) });
      if (options.length && !areaOnMap(spawn.areaId, mapId)) area.setProblem("This area is not part of the chosen map: pick another.");
      return [
        { label: "Monster", node: UI.picker({
          options: monsterOptions(), value: spawn.monsterId, kind: "monster", compact: true, showIds: true,
          label: "Monster", unknownLabel: monsterName, onChange: writes(function (v) { spawn.monsterId = v; })
        }) },
        { label: "How many", node: UI.numberInput({
          value: spawn.count, min: 0, max: 127, label: "How many", onChange: writes(function (v) { spawn.count = v; })
        }) },
        { label: "Area", node: area },
        { cls: "bui-row-end", node: UI.button("Remove", function () {
          spawns.splice(index, 1);
          redraw("monsters");
          changed();
        }, "remove", "Remove " + monsterName(spawn.monsterId)) }
      ];
    });
    return UI.table(["Monster", "How many", "Area", { label: "", cls: "bui-row-end" }], rows, "No monsters here yet.");
  }

  /** Adds a monster to the first large spawn area, creating that area when the quest has none. */
  function addMonster(model) {
    if (!model.largeSpawnAreas) model.largeSpawnAreas = [];
    if (!model.largeSpawnAreas.length) {
      model.largeSpawnAreas.push({ areaId: 1, reserved: 0, monsterIdsOffset: 0, spawnOffset: 0, spawns: [] });
    }
    var area = model.largeSpawnAreas[0];
    var areas = areasForMap(model.body.mapId);
    // A new monster goes to the first area past the start (usually the camp), or the start when the map has one.
    var where = areas.length ? (areas[1] !== undefined ? areas[1] : areas[0]) : (area.areaId || 1);
    // The main objective's monster when it has one, else the first monster by name.
    var goal = model.body.objective0;
    var first = monsterOptions()[1];
    var monster = goal && goal.type !== 0 && !isItemObjective(goal.type) && goal.target ? goal.target : (first ? first.value : 1);
    spawnsOf(area).push({ monsterId: monster, count: 1, areaId: where });
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
    var large = model.largeSpawnAreas || [];
    p.appendChild(UI.subhead("Large monsters"));
    if (!large.length) p.appendChild(UI.table(["Monster", "How many", "Area", ""], [], "No monsters yet."));
    large.forEach(function (area) { p.appendChild(spawnTable(model, spawnsOf(area))); });
    var actions = el("div", "bui-actions");
    actions.appendChild(UI.button("Add a monster", function () { addMonster(model); }, "add"));
    p.appendChild(actions);
    (model.smallSpawnGroups || []).forEach(function (group, i) {
      (group.areas || []).forEach(function (area, j) {
        p.appendChild(UI.subhead("Small monsters, set " + (i + 1) + (group.areas.length > 1 ? ", part " + (j + 1) : "")));
        p.appendChild(spawnTable(model, spawnsOf(area)));
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
        { label: "Item", node: UI.picker({
          options: itemOptions(), value: entry.itemId, kind: "item", compact: true, showIds: true, label: "Supply item",
          unknownLabel: itemName, onChange: writes(function (v) { entry.itemId = v; })
        }) },
        { label: "How many", node: UI.numberInput({
          value: entry.count, min: 0, label: "How many", onChange: writes(function (v) { entry.count = v; })
        }) },
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

    var shareCells = [];
    function shares() {
      var total = entries.reduce(function (n, e) { return n + (e.weight > 0 ? e.weight : 0); }, 0);
      shareCells.forEach(function (cell, i) {
        var w = entries[i].weight > 0 ? entries[i].weight : 0;
        cell.textContent = total ? Math.round((w / total) * 1000) / 10 + "%" : "–";
      });
    }
    var rows = entries.map(function (entry, entryIndex) {
      var share = el("span", "bui-share");
      shareCells.push(share);
      return [
        { label: "Item", node: UI.picker({
          options: itemOptions(), value: entry.itemId, kind: "item", compact: true, showIds: true, label: "Reward item",
          unknownLabel: itemName, onChange: writes(function (v) { entry.itemId = v; })
        }) },
        { label: "How many", node: UI.numberInput({
          value: entry.count, min: 0, label: "How many", onChange: writes(function (v) { entry.count = v; })
        }) },
        { label: "Weight", node: UI.numberInput({
          value: entry.weight, min: 0, label: "Weight", onChange: writes(function (v) { entry.weight = v; shares(); })
        }) },
        { label: "Share", cls: "num", node: share },
        { cls: "bui-row-end", node: UI.button("Remove", function () {
          entries.splice(entryIndex, 1);
          redraw("rewards");
          changed();
        }, "remove", "Remove " + itemName(entry.itemId)) }
      ];
    });
    box.appendChild(UI.table(["Item", "How many", "Weight", { label: "Share", cls: "num" }, { label: "", cls: "bui-row-end" }],
      rows, "No rewards in this group yet."));
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
    p.appendChild(note("Each group draws its rewards by weight: a higher weight makes an item more likely, and"
      + " Share is that item's part of the group's total. A quest submitted for testing is served with its"
      + " rewards emptied, so a test clear pays nothing."));
    var groups = model.rewardGroups || [];
    groups.forEach(function (group, i) { p.appendChild(rewardGroupBlock(model, groups, group, i)); });
    var actions = el("div", "bui-actions");
    actions.appendChild(UI.button("Add a reward group", function () {
      if (!model.rewardGroups) model.rewardGroups = [];
      model.rewardGroups.push({ groupId: model.rewardGroups.length, reserved: 0, entryOffset: 0, entries: [] });
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
      + " cut; it is stored at the end of the file. English and Japanese only.");
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
    ["objective0", "objective1", "objective2"].forEach(function (key, i) {
      var o = b[key];
      if (o && o.type !== 0 && !o.target) {
        list.push((i === 0 ? "The main objective" : "Objective " + (i + 1)) + " has no "
          + (isItemObjective(o.type) ? "item" : "monster") + " (Objectives).");
      }
    });
    var off = allSpawns(model).filter(function (s) { return !areaOnMap(s.areaId, b.mapId); }).length;
    if (off) list.push(off + (off === 1 ? " monster is" : " monsters are") + " in an area that is not part of the map (Monsters).");
    var none = 0;
    (model.rewardGroups || []).forEach(function (g) { (g.entries || []).forEach(function (e) { if (!e.itemId) none += 1; }); });
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
      return (objectiveTypes[String(o.type)] || "Objective") + ": " + o.count + " × " + what;
    });
    var facts = [
      ["Name", title && title.text ? title.text : "(none yet)"],
      ["Map", mapName(b.mapId)],
      ["Start area", model.startAreas && model.startAreas.length ? areaName(model.startAreas[0].areaId, b.mapId) : "–"],
      ["Time and players", Math.round((b.timeLimit || 0) / TICKS_PER_MINUTE) + " minutes, up to " + b.maxHunters + " hunters"],
      ["Money", "fee " + Number(b.zenny || 0).toLocaleString() + " zenny, reward " + Number(b.rewardMoney || 0).toLocaleString() + " zenny"],
      ["Objectives", goals.length ? goals.join("; ") : "none set"],
      ["Monsters", spawns.length ? spawns.map(function (s) { return s.count + " × " + monsterName(s.monsterId); }).join(", ") : "none yet"],
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
    action().catch(function (error) {
      say(error.message || "That did not work.", true);
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
    document.title = "Hunsterverse MHFZ: New quest";
    subEl.textContent = "Work down the page: basics, map, objectives, monsters, rewards and text, then review and"
      + " submit at the end. The server assigns the quest id when you submit.";
    buttons.forEach(function (button) { button.disabled = false; });
    say("", false);
    setDraftNote();
  }

  // ---- boot ----------------------------------------------------------------------------------

  if (!token()) {
    window.location.replace("/account.html");
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
    return;
  }

  var load = isNaN(draftParam)
    ? api("/api/account/quests/model").then(body)
    : api("/api/account/quest-drafts/" + draftParam).then(body).then(function (draft) {
        state.draftId = draft.id;
        state.revision = draft.revision;
        return draft.model;
      });

  Promise.all([load, loadTables()])
    .then(function (results) {
      render(results[0]);
      return refreshDrafts();
    })
    .catch(function (error) {
      fail(error.message);
      refreshDrafts();
    });
})();
