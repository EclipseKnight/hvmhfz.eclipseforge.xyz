/* Quest builder: a new quest as a QuestCodec model, edited as a private draft. The server writes the
   bytes. Nothing here opens a live quest file; every draft starts from the blank quest the API owns. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  /* Slot order in the file: 0 title, 1 objective, 2 and 3 sub-quests, 4 main objective line,
     5 fail condition, 6 client, 7 description. */
  var SLOTS = [
    { name: "Title", hint: "slot 0 · the name the quest counter shows", wide: true },
    { name: "Objective", hint: "slot 1 · what the quest asks for", wide: true },
    { name: "Sub-quest A", hint: "slot 2" },
    { name: "Sub-quest B", hint: "slot 3" },
    { name: "Main objective", hint: "slot 4 · the line the quest card leads with", wide: true },
    { name: "Fail condition", hint: "slot 5" },
    { name: "Client", hint: "slot 6 · who posted it", wide: true },
    { name: "Description", hint: "slot 7 · the text on the quest card", wide: true }
  ];

  var params = new URLSearchParams(window.location.search);
  /* The old address for a copy of a live quest. It is kept only so the page can show the server's refusal
     instead of a blank editor that looks like it worked. */
  var liveId = parseInt(params.get("id"), 10);
  var draftParam = parseInt(params.get("draft"), 10);

  var root = document.getElementById("editor-root");
  var titleEl = document.getElementById("editor-title");
  var subEl = document.getElementById("editor-sub");
  var statusEl = document.getElementById("editor-status");
  var draftNote = document.getElementById("editor-draft-note");
  var draftsBody = document.getElementById("editor-drafts");
  var saveBtn = document.getElementById("editor-save");
  var downloadBtn = document.getElementById("editor-download");
  var submitBtn = document.getElementById("editor-submit");
  var buttons = [saveBtn, downloadBtn, submitBtn];

  var state = { model: null, draftId: null, revision: 0, busy: false };

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

  // ---- small DOM helpers ---------------------------------------------------------------------

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function note(text) {
    return el("p", "note-text", text);
  }

  function panel(title, panelNote) {
    var section = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (panelNote) head.appendChild(el("span", "panel-note", panelNote));
    section.appendChild(head);
    return section;
  }

  function numberField(id, labelText, value, hint, onChange) {
    var wrap = el("div", "field");
    var label = el("label", null, labelText);
    label.htmlFor = id;
    var input = el("input");
    input.id = id;
    input.type = "number";
    input.min = "0";
    input.value = String(value === undefined || value === null ? 0 : value);
    input.addEventListener("input", function () {
      var next = parseInt(input.value, 10);
      if (!isNaN(next)) onChange(next);
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    if (hint) wrap.appendChild(note(hint));
    return wrap;
  }

  function actionButton(label, onClick) {
    var button = el("button", "ghost-btn small", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  // ---- id lookups ---------------------------------------------------------------------------

  var monsterIds = null;

  function loadMonsterIds() {
    if (monsterIds) return Promise.resolve(monsterIds);
    return fetch("/data/monster-ids.json")
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (map) { monsterIds = map || {}; return monsterIds; })
      .catch(function () { monsterIds = {}; return monsterIds; });
  }

  function monsterOptions(current) {
    var options = [{ value: 0, label: "None (0)" }];
    Object.keys(monsterIds || {}).map(Number).sort(function (a, b) {
      return String(monsterIds[a]).localeCompare(String(monsterIds[b]));
    }).forEach(function (id) {
      options.push({ value: id, label: monsterIds[id] + " (" + id + ")" });
    });
    if (current && !(current in (monsterIds || {}))) {
      options.push({ value: current, label: "Unlisted monster (" + current + ")" });
    }
    return options;
  }

  function areaOptions(current, count, mapId) {
    var known = areasForMap(mapId);
    if (!known.length) {
      var top = Math.max(count || 0, current || 0, 10);
      var simple = [];
      for (var i = 1; i <= top; i += 1) simple.push({ value: i, label: "Area " + i });
      return simple;
    }
    if (current && known.indexOf(current) === -1) known.push(current);
    return known.sort(function (a, b) { return a - b; }).map(function (id) {
      return { value: id, label: areaLabel(id) };
    });
  }


  var mapIds = null;
  var mapAreas = null;
  var areaIds = null;
  var itemIds = null;
  var objectiveTypes = null;

  function loadTables() {
    function grab(url, fallback) {
      return fetch(url).then(function (r) { return r.ok ? r.json() : fallback; }).catch(function () { return fallback; });
    }
    return Promise.all([
      mapIds ? Promise.resolve(mapIds) : grab("/data/map-ids.json", {}),
      mapAreas ? Promise.resolve(mapAreas) : grab("/data/map-areas.json", {}),
      areaIds ? Promise.resolve(areaIds) : grab("/data/area-ids.json", {}),
      itemIds ? Promise.resolve(itemIds) : grab("/data/item-ids.json", {}),
      objectiveTypes ? Promise.resolve(objectiveTypes) : grab("/data/objective-types.json", {}),
      monsterIds ? Promise.resolve(monsterIds) : grab("/data/monster-ids.json", {})
    ]).then(function (r) {
      mapIds = mapIds || r[0]; mapAreas = mapAreas || r[1]; areaIds = areaIds || r[2]; itemIds = itemIds || r[3];
      objectiveTypes = objectiveTypes || r[4];
      monsterIds = monsterIds || r[5];
      return true;
    });
  }

  function areaLabel(id) {
    var name = areaIds && areaIds[String(id)];
    return name || ("Area " + id);
  }

  function areasForMap(mapId) {
    var list = (mapAreas && mapAreas[String(mapId)]) || [];
    return list.slice();
  }

  function itemLabel(id) {
    var name = itemIds && itemIds[String(id)];
    return name || ("Item " + id);
  }

  function loadMapIds() {
    if (mapIds) return Promise.resolve(mapIds);
    return fetch("/data/map-ids.json")
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (map) { mapIds = map || {}; return mapIds; })
      .catch(function () { mapIds = {}; return mapIds; });
  }

  function mapOptions(current) {
    var options = [];
    Object.keys(mapIds || {}).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      var entry = mapIds[id] || {};
      options.push({ value: id, label: (entry.name || ("Map " + id)) + " (" + id + ")" });
    });
    if (current && !(String(current) in (mapIds || {}))) {
      options.unshift({ value: current, label: "Map " + current });
    }
    return options;
  }

  function selectField(id, labelText, value, hint, options, onChange) {
    var wrap = el("div", "field");
    var label = el("label", null, labelText);
    label.htmlFor = id;
    var select = el("select");
    select.id = id;
    options.forEach(function (opt) {
      var option = el("option", null, opt.label);
      option.value = String(opt.value);
      if (Number(opt.value) === Number(value)) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", function () { onChange(parseInt(select.value, 10)); });
    wrap.appendChild(label);
    wrap.appendChild(select);
    if (hint) wrap.appendChild(note(hint));
    return wrap;
  }


  function cellCombo(value, options, onChange, display) {
    var cell = el("td", "item-cell");
    var listId = "items-" + Math.random().toString(36).slice(2, 8);
    var input = el("input", "cell-input");
    input.setAttribute("list", listId);
    input.value = display ? display(value) : String(value);
    var list = el("datalist");
    list.id = listId;
    options.forEach(function (opt) { var o = el("option"); o.value = opt.label; list.appendChild(o); });
    function commitCell() {
      var raw = input.value.trim();
      var m = raw.match(/\((\d+)\)\s*$/);
      var next = m ? parseInt(m[1], 10) : parseInt(raw, 10);
      if (!isNaN(next)) { onChange(next); input.value = display ? display(next) : String(next); }
    }
    input.addEventListener("change", commitCell);
    input.addEventListener("blur", commitCell);
    cell.appendChild(input);
    cell.appendChild(list);
    return cell;
  }

  function itemCell(value, onChange) {
    var cell = el("td", "item-cell");
    var input = el("input", "cell-input");
    input.type = "number";
    input.min = "0";
    input.value = String(value === undefined || value === null ? 0 : value);
    var label = el("span", "cell-name", itemLabel(value));
    input.addEventListener("input", function () {
      var next = parseInt(input.value, 10);
      if (!isNaN(next)) { onChange(next); label.textContent = itemLabel(next); }
    });
    cell.appendChild(input);
    cell.appendChild(label);
    return cell;
  }

  function cellSelect(value, options, onChange) {
    var cell = el("td");
    var select = el("select", "cell-input");
    options.forEach(function (opt) {
      var option = el("option", null, opt.label);
      option.value = String(opt.value);
      if (Number(opt.value) === Number(value)) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", function () { onChange(parseInt(select.value, 10)); });
    cell.appendChild(select);
    return cell;
  }

  function cellInput(value, onChange) {
    var cell = el("td");
    var input = el("input", "cell-input");
    input.type = "number";
    input.min = "0";
    input.value = String(value === undefined || value === null ? 0 : value);
    input.addEventListener("input", function () {
      var next = parseInt(input.value, 10);
      if (!isNaN(next)) onChange(next);
    });
    cell.appendChild(input);
    return cell;
  }

  function cellAction(label, onClick) {
    var cell = el("td");
    cell.appendChild(actionButton(label, onClick));
    return cell;
  }

  function table(headers, rows) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table");
    // An editable table must not be re-ordered by the site's table sorter: a sorted row would sit next to
    // the wrong label while its inputs stayed bound to the record they were built from.
    t.setAttribute("data-nosort", "");
    var head = el("thead");
    var row = el("tr");
    headers.forEach(function (name) { row.appendChild(el("th", "num", name)); });
    head.appendChild(row);
    t.appendChild(head);
    var tb = el("tbody");
    if (!rows.length) {
      var empty = el("tr");
      var td = el("td", "empty-cell", "Nothing in this table yet.");
      td.colSpan = headers.length;
      empty.appendChild(td);
      tb.appendChild(empty);
    } else {
      rows.forEach(function (cells) {
        var tr = el("tr");
        cells.forEach(function (cell) { tr.appendChild(cell); });
        tb.appendChild(tr);
      });
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  /** Shift-JIS bytes: one for ASCII, two for everything else a quest string can hold. */
  function shiftJisBytes(text) {
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      total += text.charCodeAt(i) < 0x80 ? 1 : 2;
    }
    return total;
  }

  // ---- panels --------------------------------------------------------------------------------

  function slotField(slot, spec) {
    var wrap = el("div", "field");
    var lab = el("div", "slot-lab");
    var label = el("label", null, spec.name);
    label.htmlFor = "slot-" + slot.index;
    var count = el("span", "slot-count");
    count.id = "count-" + slot.index;
    lab.appendChild(label);
    lab.appendChild(count);

    var area = el("textarea");
    area.id = "slot-" + slot.index;
    area.setAttribute("rows", spec.wide ? "3" : "2");
    area.value = slot.text || "";

    function refresh() {
      var bytes = shiftJisBytes(area.value);
      var over = bytes + 1 > slot.capacity;
      count.textContent = bytes + " / " + slot.capacity + " bytes" + (over ? " · appended to the file" : "");
      count.classList.toggle("bad", over);
    }

    area.addEventListener("input", function () {
      slot.text = area.value;
      refresh();
    });
    refresh();

    wrap.appendChild(lab);
    wrap.appendChild(area);
    if (spec.hint) wrap.appendChild(note(spec.hint));
    return wrap;
  }

  function textPanel(model) {
    var p = panel("Text", "eight slots · room in bytes");
    p.appendChild(note("A slot has the room the file gives it. Text that does not fit is appended to the"
      + " end of the file and the slot repointed, so nothing is cut; the client's quest buffer is the"
      + " only ceiling. Japanese and plain ASCII only."));
    var grid = null;
    model.texts.forEach(function (slot, i) {
      var spec = SLOTS[i] || { name: "Slot " + i, hint: "" };
      var holder = p;
      if (!spec.wide) {
        if (!grid) {
          grid = el("div", "editor-grid");
          p.appendChild(grid);
        }
        holder = grid;
      } else {
        grid = null;
      }
      holder.appendChild(slotField(slot, spec));
    });
    return p;
  }

  /* body +0x20 counts 30 ticks a second, so a minute is 1 800 of them (verified against the site's
     own minutes for every quest checked). */
  var TICKS_PER_MINUTE = 1800;

  function metadataPanel(model) {
    var p = panel("Map and rules", "environment, limits and payout");
    var b = model.body;
    var grid = el("div", "editor-grid");
    grid.appendChild(numberField("meta-time", "Time limit (minutes)",
      Math.round((b.timeLimit || 0) / TICKS_PER_MINUTE), "body +0x20 · 1 800 ticks a minute",
      function (v) { b.timeLimit = v * TICKS_PER_MINUTE; }));
    grid.appendChild(numberField("meta-zenny", "Zenny", b.zenny, "body +0x0c · contract fee",
      function (v) { b.zenny = v; }));
    grid.appendChild(numberField("meta-money", "Reward money", b.rewardMoney, "body +0x10",
      function (v) { b.rewardMoney = v; }));
    grid.appendChild(numberField("meta-players", "Max players", b.maxHunters, "body +0x0b",
      function (v) { b.maxHunters = v; }));
    grid.appendChild(numberField("meta-class", "Quest class", b.questClass, "body +0x0a",
      function (v) { b.questClass = v; }));
    if (mapIds && Object.keys(mapIds).length) {
      grid.appendChild(selectField("meta-map", "Map (environment)", b.mapId,
        "body +0x24 · named from the quest text that mentions each region",
        mapOptions(b.mapId), function (v) { b.mapId = v; }));
    } else {
      grid.appendChild(numberField("meta-map", "Map (environment)", b.mapId, "body +0x24",
        function (v) { b.mapId = v; }));
    }
    if (model.startAreas && model.startAreas.length) {
      grid.appendChild(selectField("meta-start-area", "Start area", model.startAreas[0].areaId,
        "header +0x04 · where the party lands",
        areaOptions(model.startAreas[0].areaId, 10, b.mapId),
        function (v) { model.startAreas.forEach(function (a) { a.areaId = v; }); }));
    }
    grid.appendChild(comboField("meta-requirement", "Requirement item (0 = none)", b.iconLabelId,
      "body +0x94 · the item the quest consumes on entry", itemOptions(),
      function (v) { b.iconLabelId = v; }, itemDisplay));
    grid.appendChild(numberField("meta-requirement-count", "Requirement count", b.iconLabelCount,
      "body +0x96 · how many the quest takes", function (v) { b.iconLabelCount = v; }));
    p.appendChild(grid);
    p.appendChild(note("Map names are not mapped yet, so the map is a number: the client's own stage id."
      + " The server assigns the quest id when you submit, so it is 0 here."
      + " " + String(model.layout).toLowerCase().replace("_", " ") + " layout · " + model.length
      + " bytes as it stands."));
    return p;
  }

  function spawnsOf(area) {
    if (!area.spawns) area.spawns = [];
    return area.spawns;
  }



  // A searchable picker: the input accepts a name or an id, and the datalist offers every known name.
  // Used where a plain select would hold 16,701 options (items).
  function comboField(id, labelText, value, hint, options, onChange, display) {
    var wrap = el("div", "field");
    var label = el("label", null, labelText);
    label.htmlFor = id;
    var listId = id + "-list";
    var input = el("input");
    input.id = id;
    input.setAttribute("list", listId);
    input.value = display ? display(value) : String(value === undefined || value === null ? 0 : value);
    var list = el("datalist");
    list.id = listId;
    options.forEach(function (opt) {
      var option = el("option");
      option.value = opt.label;
      list.appendChild(option);
    });
    function commit() {
      var raw = input.value.trim();
      var match = raw.match(/\((\d+)\)\s*$/);
      var next = match ? parseInt(match[1], 10) : parseInt(raw, 10);
      if (!isNaN(next)) { onChange(next); input.value = display ? display(next) : String(next); }
    }
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(list);
    if (hint) wrap.appendChild(note(hint));
    return wrap;
  }

  function itemOptions() {
    return Object.keys(itemIds || {}).map(Number).sort(function (a, b) {
      return String(itemIds[a]).localeCompare(String(itemIds[b]));
    }).map(function (id) { return { value: id, label: itemIds[id] + " (" + id + ")" }; });
  }

  function itemDisplay(id) {
    return itemIds && itemIds[String(id)] ? itemIds[String(id)] + " (" + id + ")" : "Item " + id;
  }

  function typeOptions(current) {
    var options = [];
    Object.keys(objectiveTypes || {}).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (id) {
        options.push({ value: id, label: objectiveTypes[id] + " (" + id + ")" });
      });
    if (!(String(current) in (objectiveTypes || {}))) {
      options.unshift({ value: current, label: "Type " + current });
    }
    return options;
  }

  function objectivesPanel(model) {
    var p = panel("Objectives", "what the quest asks for");
    var b = model.body;
    ["objective0", "objective1", "objective2"].forEach(function (key, index) {
      var objective = b[key];
      if (!objective) return;
      p.appendChild(el("h3", "subhead", "Objective " + (index + 1)));
      var grid = el("div", "editor-grid");
      grid.appendChild(selectField("obj-" + index + "-type", "Type", objective.type,
        "body +0x" + (0x30 + index * 8).toString(16) + " · the objective kind",
        typeOptions(objective.type), function (v) { objective.type = v; render(model, state.quest); }));
      if (objective.type & 2 && !(objective.type & 1)) {
        grid.appendChild(comboField("obj-" + index + "-target", "Item target", objective.target,
          "the item the objective counts", itemOptions(),
          function (v) { objective.target = v; }, itemDisplay));
      } else {
        grid.appendChild(selectField("obj-" + index + "-target", "Monster target", objective.target,
          "the monster the objective counts" + (objective.type === 0 ? " · pick a type above first" : ""),
          monsterOptions(objective.target), function (v) { objective.target = v; }));
      }
      grid.appendChild(numberField("obj-" + index + "-count", "Count", objective.count,
        "how many are needed", function (v) { objective.count = v; }));
      p.appendChild(grid);
    });
    p.appendChild(note("Type values are the client's own objective bitfield: Hunt, Slay, Capture, Deliver,"
      + " Break Part, Damage and so on."));
    return p;
  }


  function iconMonstersPanel(model) {
    var p = panel("Quest page icons", "the monster icons the info page shows");
    var icons = (model.body && model.body.iconMonsters) || [];
    var grid = el("div", "editor-grid");
    icons.forEach(function (id, i) {
      grid.appendChild(selectField("icon-mon-" + i, "Icon " + (i + 1), id,
        i === 0 ? "body +0xb9 · usually the objective target" : "body +0x" + (0xb9 + i).toString(16),
        monsterOptions(id), function (v) { icons[i] = v; }));
    });
    p.appendChild(grid);
    return p;
  }

  function supplyPanel(model) {
    var p = panel("Supply box", "items handed out at departure");
    var items = model.startItems || [];
    var shown = 0;
    var grid = el("div", "editor-grid");
    items.forEach(function (entry, index) {
      if (!entry.itemId) return;
      shown += 1;
      grid.appendChild(comboField("supply-" + index, "Item " + shown, entry.itemId,
        "header +0x08 · count below", itemOptions(),
        function (v) { entry.itemId = v; }, itemDisplay));
      grid.appendChild(numberField("supply-count-" + index, "Count", entry.count, "how many",
        function (v) { entry.count = v; }));
    });
    if (!shown) p.appendChild(note("This quest hands out no supply items."));
    p.appendChild(grid);
    p.appendChild(note("Clearing an item sets its id to 0, which removes it from the box."));
    return p;
  }

  function spawnTable(spawns, model) {
    var rows = (spawns || []).map(function (spawn) {
      var index = spawns.indexOf(spawn);
      return [
        cellSelect(spawn.monsterId, monsterOptions(spawn.monsterId), function (v) { spawn.monsterId = v; }),
        cellInput(spawn.count, function (v) { spawn.count = v; }),
        cellSelect(spawn.areaId, areaOptions(spawn.areaId, spawns.length + 4, model.body.mapId), function (v) { spawn.areaId = v; }),
        cellAction("Remove", function () {
          spawns.splice(index, 1);
          rebuild();
        })
      ];
    });
    return table(["Monster", "Count", "Area", ""], rows);
  }

  function defaultMonsterId() {
    // Id 0 is "None", which is not a monster; the list is keyed by id, so the first real one is the default.
    var keys = Object.keys(monsterIds || {}).map(Number).filter(function (id) { return id > 0; }).sort(function (a, b) {
      return a - b;
    });
    return keys.length ? keys[0] : 1;
  }

  /** Adds a monster to the first large spawn area, creating that area when the quest has none. */
  function addMonster() {
    var model = state.model;
    if (!model.largeSpawnAreas) model.largeSpawnAreas = [];
    if (!model.largeSpawnAreas.length) {
      model.largeSpawnAreas.push({ areaId: 1, reserved: 0, monsterIdsOffset: 0, spawnOffset: 0, spawns: [] });
    }
    var area = model.largeSpawnAreas[0];
    spawnsOf(area).push({ monsterId: defaultMonsterId(), count: 1, areaId: area.areaId || 1 });
    rebuild();
  }

  function spawnPanel(model) {
    var p = panel("Monsters and spawns", "per area");
    if (!model.header) {
      p.appendChild(note("This file is an event body: it carries no spawn tables of its own."));
      return p;
    }
    var areas = model.largeSpawnAreas || [];
    if (!areas.length) {
      p.appendChild(note("No monsters yet. Add one and it goes into area 1; change the area in its row."));
    }
    areas.forEach(function (area) {
      p.appendChild(el("h3", "subhead", "Large spawns · area " + area.areaId));
      p.appendChild(spawnTable(spawnsOf(area)));
    });
    (model.smallSpawnGroups || []).forEach(function (group, i) {
      (group.areas || []).forEach(function (area) {
        p.appendChild(el("h3", "subhead", "Small spawns · group " + (i + 1) + " · area " + area.areaId));
        p.appendChild(spawnTable(spawnsOf(area)));
      });
    });
    p.appendChild(actionButton("Add monster", addMonster));
    return p;
  }

  function rewardPanel(model) {
    var p = panel("Rewards", "groups and their entries");
    var groups = model.rewardGroups || [];
    if (!groups.length) {
      p.appendChild(note("No reward table yet. Add a group, then entries inside it."));
    }
    groups.forEach(function (group, groupIndex) {
      if (!group.entries) group.entries = [];
      var head = el("div", "panel-head");
      head.appendChild(el("h3", "subhead", "Group " + (group.groupId + 1) + " · id " + group.groupId));
      head.appendChild(actionButton("Add entry", function () {
        if (!group.entries) group.entries = [];
        group.entries.push({ weight: 1, itemId: 0, count: 1 });
        rebuild();
      }));
      p.appendChild(head);
      var entries = group.entries || [];
      var rows = entries.map(function (entry, entryIndex) {
        return [
          cellInput(entry.weight, function (v) { entry.weight = v; }),
          cellCombo(entry.itemId, itemOptions(), function (v) { entry.itemId = v; }, itemDisplay),
          cellInput(entry.count, function (v) { entry.count = v; }),
          cellAction("Remove", function () {
            entries.splice(entryIndex, 1);
            rebuild();
          })
        ];
      });
      p.appendChild(table(["Weight", "Item id", "Count", ""], rows));
      if (groups.length > 1) {
        p.appendChild(actionButton("Remove group " + (groupIndex + 1), function () {
          groups.splice(groupIndex, 1);
          rebuild();
        }));
      }
    });
    p.appendChild(actionButton("Add reward group", function () {
      if (!model.rewardGroups) model.rewardGroups = [];
      model.rewardGroups.push({
        groupId: model.rewardGroups.length, reserved: 0, entryOffset: 0, entries: []
      });
      rebuild();
    }));
    p.appendChild(note("Item ids are the client's own table indices. A submitted quest is served with"
      + " its rewards emptied, so a test clear pays nothing."));
    return p;
  }

  // ---- state and actions ---------------------------------------------------------------------

  function say(text, bad) {
    statusEl.textContent = text;
    statusEl.classList.toggle("bad", !!bad);
  }

  function setDraftNote() {
    draftNote.textContent = state.draftId
      ? "draft #" + state.draftId + " · revision " + state.revision
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
      say("Downloaded new-quest.bin — that is the file the server would serve.", false);
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
    var p = panel("The builder could not open a quest");
    p.appendChild(note(message));
    root.appendChild(p);
    buttons.forEach(function (button) { button.disabled = true; });
    titleEl.textContent = "New quest";
    subEl.textContent = "Start again from /quest-editor.html for a blank quest.";
  }

  // ---- drafts list ---------------------------------------------------------------------------

  function when(iso) {
    var date = new Date(iso);
    return isNaN(date) ? "-" : date.toLocaleDateString();
  }

  function refreshDrafts() {
    if (!draftsBody) return Promise.resolve();
    return api("/api/account/quest-drafts").then(body).then(function (rows) {
      renderDrafts(rows || []);
    }).catch(function () {
      draftsBody.innerHTML = "";
      var tr = el("tr");
      var td = el("td", "empty-cell", "Your drafts could not be loaded.");
      td.colSpan = 3;
      tr.appendChild(td);
      draftsBody.appendChild(tr);
    });
  }

  function renderDrafts(rows) {
    draftsBody.innerHTML = "";
    if (!rows.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No drafts yet.");
      cell.colSpan = 3;
      empty.appendChild(cell);
      draftsBody.appendChild(empty);
      return;
    }
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

  function panels(model) {
    root.textContent = "";
    root.appendChild(objectivesPanel(model));
    root.appendChild(textPanel(model));
    root.appendChild(metadataPanel(model));
    root.appendChild(iconMonstersPanel(model));
    root.appendChild(supplyPanel(model));
    root.appendChild(spawnPanel(model));
    root.appendChild(rewardPanel(model));
  }

  /** Redraws the panels after a row was added or removed; the model holds every field. */
  function rebuild() {
    if (!state.model) return;
    panels(state.model);
  }

  function render(model) {
    state.model = model;
    if (!model.largeSpawnAreas) model.largeSpawnAreas = [];
    if (!model.rewardGroups) model.rewardGroups = [];
    panels(model);
    titleEl.textContent = "New quest";
    document.title = "Hunsterverse MHFZ: New quest";
    subEl.textContent = state.draftId
      ? "Draft #" + state.draftId + ", revision " + state.revision + ". The server assigns the quest id at"
        + " submit; nothing here touches a live quest file."
      : "A new quest. Save keeps it as a draft under your account; the server assigns the quest id at"
        + " submit.";
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
