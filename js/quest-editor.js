/* Quest editor: one quest file as a model, edited as a draft. The server writes the bytes.
   A draft is private to the signed-in account; nothing here touches the live quest files. */
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
  var questId = parseInt(params.get("id"), 10);
  var variant = (params.get("variant") || "d0").toLowerCase();

  var root = document.getElementById("editor-root");
  var titleEl = document.getElementById("editor-title");
  var subEl = document.getElementById("editor-sub");
  var statusEl = document.getElementById("editor-status");
  var draftNote = document.getElementById("editor-draft-note");
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
        throw new Error("Sign in to use the quest editor.");
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

  function areaOptions(current, count) {
    var top = Math.max(count || 0, current || 0, 10);
    var options = [];
    for (var i = 1; i <= top; i += 1) options.push({ value: i, label: "Area " + i });
    return options;
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

  function table(headers, rows) {
    var wrap = el("div", "table-wrap");
    var t = el("table", "data-table");
    var head = el("thead");
    var row = el("tr");
    headers.forEach(function (name) { row.appendChild(el("th", "num", name)); });
    head.appendChild(row);
    t.appendChild(head);
    var tb = el("tbody");
    if (!rows.length) {
      var empty = el("tr");
      var td = el("td", "empty-cell", "Nothing in this table.");
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
    var p = panel("Metadata", "body fields");
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
    p.appendChild(grid);
    p.appendChild(note("Quest " + b.questId + " · " + String(model.layout).toLowerCase().replace("_", " ")
      + " layout · " + model.length + " bytes as it stands."));
    return p;
  }

  function spawnTable(spawns) {
    var rows = (spawns || []).map(function (spawn) {
      return [
        cellSelect(spawn.monsterId, monsterOptions(spawn.monsterId), function (v) { spawn.monsterId = v; }),
        cellInput(spawn.count, function (v) { spawn.count = v; }),
        cellSelect(spawn.areaId, areaOptions(spawn.areaId, spawns.length + 4), function (v) { spawn.areaId = v; })
      ];
    });
    return table(["Monster", "Count", "Area"], rows);
  }

  function spawnPanel(model) {
    var p = panel("Monsters and spawns", "per area");
    if (!model.header) {
      p.appendChild(note("This file is an event body: it carries no spawn tables of its own."));
      return p;
    }
    var areas = model.largeSpawnAreas || [];
    if (!areas.length) {
      p.appendChild(note("No large monster spawns in this file."));
    }
    areas.forEach(function (area) {
      p.appendChild(el("h3", "subhead", "Large spawns · area " + area.areaId));
      p.appendChild(spawnTable(area.spawns));
    });
    (model.smallSpawnGroups || []).forEach(function (group, i) {
      (group.areas || []).forEach(function (area) {
        p.appendChild(el("h3", "subhead", "Small spawns · group " + (i + 1) + " · area " + area.areaId));
        p.appendChild(spawnTable(area.spawns));
      });
    });
    return p;
  }

  function rewardPanel(model) {
    var p = panel("Rewards", "groups and their entries");
    var groups = model.rewardGroups || [];
    if (!groups.length) {
      p.appendChild(note("This quest has no reward table."));
    }
    groups.forEach(function (group) {
      p.appendChild(el("h3", "subhead", "Group " + (group.groupId + 1) + " · id " + group.groupId));
      var rows = (group.entries || []).map(function (entry) {
        return [
          cellInput(entry.weight, function (v) { entry.weight = v; }),
          cellInput(entry.itemId, function (v) { entry.itemId = v; }),
          cellInput(entry.count, function (v) { entry.count = v; })
        ];
      });
      p.appendChild(table(["Weight", "Item id", "Count"], rows));
    });
    p.appendChild(note("Item ids are the client's own table indices. A submitted quest is served with"
      + " its rewards emptied, so a test clear pays nothing."));
    return p;
  }

  function variantField() {
    var wrap = el("div", "field");
    var label = el("label", null, "Quest file variant");
    label.htmlFor = "editor-variant";
    var input = el("input");
    input.id = "editor-variant";
    input.type = "text";
    input.maxLength = 4;
    input.value = variant;
    input.addEventListener("change", function () {
      var next = input.value.trim().toLowerCase();
      if (/^[a-z][0-9]$/.test(next) && next !== variant) {
        window.location.search = "?id=" + questId + "&variant=" + encodeURIComponent(next);
      }
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(note("d0, d1, n0 … the difficulty and player-count file the client asks for."));
    return wrap;
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
      body: JSON.stringify({ questId: questId, variant: variant })
    }).then(body).then(function (created) {
      state.draftId = created.id;
      state.revision = created.revision;
      setDraftNote();
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
      anchor.download = questId + variant + ".bin";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      say("Downloaded " + questId + variant + ".bin — that is the file the server would serve.", false);
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
    var p = panel("The editor could not open this quest");
    p.appendChild(note(message));
    root.appendChild(p);
    buttons.forEach(function (button) { button.disabled = true; });
  }

  function render(model, quest) {
    state.model = model;
    root.textContent = "";
    root.appendChild(textPanel(model));
    root.appendChild(metadataPanel(model));
    root.appendChild(spawnPanel(model));
    root.appendChild(rewardPanel(model));

    var name = quest && quest.name ? quest.name : "quest " + questId;
    titleEl.textContent = "Edit " + name;
    document.title = "Hunsterverse MHFZ: Edit " + name;
    subEl.textContent = "Editing a draft of " + questId + variant + ". The live file is never changed;"
      + " this copy is yours until you submit it for testing.";
    buttons.forEach(function (button) { button.disabled = false; });
    say("", false);
  }

  // ---- boot ----------------------------------------------------------------------------------

  if (!token()) {
    window.location.replace("/account.html");
    return;
  }
  if (isNaN(questId)) {
    fail("The address needs a quest id, for example /quest-editor.html?id=40212.");
    return;
  }

  saveBtn.addEventListener("click", function () {
    run(function () { return saveDraft().then(function () { say("Draft saved.", false); }); });
  });
  downloadBtn.addEventListener("click", function () { run(downloadDraft); });
  submitBtn.addEventListener("click", function () { run(submitDraft); });

  var draftPanel = document.getElementById("editor-draft-panel");
  draftPanel.insertBefore(variantField(), draftPanel.querySelector(".editor-actions"));

  Promise.all([
    api("/api/account/quests/model?questId=" + questId + "&variant=" + encodeURIComponent(variant))
      .then(body).catch(function (error) { return { error: error }; }),
    api("/api/account/quest-drafts").then(body).catch(function () { return []; }),
    fetch("/data/quests.json", { cache: "no-cache" })
      .then(function (res) { return res.json(); }).catch(function () { return null; }),
    loadMonsterIds()
  ]).then(function (results) {
    var live = results[0];
    if (live && live.error) {
      fail(live.error.message);
      return;
    }
    var drafts = results[1] || [];
    var catalog = results[2];
    var quest = null;
    if (catalog && catalog.quests) {
      quest = catalog.quests.filter(function (q) { return q.id === questId; })[0] || null;
    }
    var mine = drafts.filter(function (d) {
      return d.sourceQuestId === questId && d.variant === variant;
    })[0];

    if (!mine) {
      render(live, quest);
      setDraftNote();
      return;
    }
    api("/api/account/quest-drafts/" + mine.id).then(body).then(function (draft) {
      state.draftId = draft.id;
      state.revision = draft.revision;
      render(draft.model, quest);
      setDraftNote();
    }).catch(function (error) { fail(error.message); });
  }).catch(function (error) {
    fail("The quest could not be loaded (" + error.message + ").");
  });
})();
