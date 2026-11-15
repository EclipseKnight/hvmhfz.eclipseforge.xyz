/* Set builder page (set-builder.html): pick a weapon, five armour pieces with their levels, decorations,
   sigils and cuffs, and see the skill points, active skills, defence and resistances as you go.

   Data (static, dev/make-armor-data.py): data/armor/index.json (decorations, cuffs, sigils, weapon automatic
   skills, skill names), data/armor/<slot>.json (pieces; loaded when the slot is first opened or a set needs it),
   data/armor/rules.json (skill rules, read by js/armor-rules.js), data/skills/index.json (skill trees and their
   levels), data/weapons/index.json and data/weapons/<type>.json (weapons and their slots). The sums are
   js/armor-calc.js; the controls are js/builder-ui.js's. The set lives in the address (#s=..., the set format of
   js/armor-calc.js), so a link shares it; nothing is sent to a server. */
(function () {
  "use strict";

  var UI = window.BuilderUI;
  var Calc = window.ArmorCalc;
  var SLOT_NAMES = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var RES_NAMES = { fire: "Fire", water: "Water", thunder: "Thunder", ice: "Ice", dragon: "Dragon" };
  var RES_ORDER = ["fire", "water", "thunder", "ice", "dragon"];   // as the game's status screen lists them

  var app = document.getElementById("sb-app");
  var editor = document.getElementById("sb-editor");
  var summary = document.getElementById("sb-summary");
  var status = document.getElementById("sb-status");

  var data = { index: null, rules: null, trees: {}, types: [], weapons: {}, pieces: {}, items: {} };
  var loading = {};
  var state = { set: Calc.empty(), gender: "", obtainable: true };
  var optionCache = {};

  function el(tag, cls, text) { return UI.el(tag, cls, text); }

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url + ": " + res.status);
      return res.json();
    });
  }

  // ---- data ----------------------------------------------------------------------------------------

  function pieceObject(row) {
    return { id: row[0], name: row[1], rarity: row[2], defence: row[3], slots: row[4], topSlots: row[5],
             res: row[6], flags: row[7], maxLevel: row[8], skills: row[9], auto: row[10], obtainable: !!row[11] };
  }

  /** The pieces of one slot, loaded once. */
  function loadSlot(slot) {
    if (data.pieces[slot]) return Promise.resolve(data.pieces[slot]);
    if (!loading[slot]) {
      loading[slot] = getJson("/data/armor/" + slot + ".json").then(function (json) {
        var byId = {};
        json.pieces.forEach(function (row) { byId[row[0]] = pieceObject(row); });
        data.pieces[slot] = { list: json.pieces, byId: byId };
        return data.pieces[slot];
      });
    }
    return loading[slot];
  }

  function typeOf(cls) {
    for (var i = 0; i < data.types.length; i++) if (data.types[i].class === cls) return data.types[i];
    return null;
  }

  /** The weapons of one class, loaded once. */
  function loadWeapons(cls) {
    var type = typeOf(cls);
    if (!type) return Promise.resolve(null);
    if (data.weapons[cls]) return Promise.resolve(data.weapons[cls]);
    var key = "w" + cls;
    if (!loading[key]) {
      loading[key] = getJson("/data/weapons/" + type.slug + ".json").then(function (json) {
        var f = {};
        json.fields.forEach(function (name, i) { f[name] = i; });
        var auto = data.index.weaponAuto[json.kind] || {};
        var byId = {};
        json.weapons.forEach(function (w) {
          byId[w[f.id]] = { id: w[f.id], name: w[f.name], rarity: w[f.rarity], slots: w[f.slots] || 0,
                            defense: w[f.defense] || 0, auto: auto[w[f.id]] || [] };
        });
        data.weapons[cls] = { list: json.weapons, byId: byId, fields: f, kind: json.kind };
        return data.weapons[cls];
      });
    }
    return loading[key];
  }

  /** Loads what the current set needs (its weapon class and pieces' slots). */
  function loadForSet(set) {
    var jobs = [];
    if (set.weapon[0] >= 0) jobs.push(loadWeapons(set.weapon[0]));
    set.armour.forEach(function (a) { if (a[1]) jobs.push(loadSlot(a[0])); });
    return Promise.all(jobs);
  }

  function ctx() {
    return {
      rules: data.rules,
      gender: state.gender,
      piece: function (slot, id) { var p = data.pieces[slot]; return p ? p.byId[id] || null : null; },
      weapon: function (cls, id) { var w = data.weapons[cls]; return w ? w.byId[id] || null : null; },
      item: function (id) { return data.items[id] || null; },
      tree: function (id) { return data.trees[id] || null; },
      skillName: function (id) { return data.index.skillNames[id] || "Skill " + id; }
    };
  }

  // ---- options for the pickers ------------------------------------------------------------------------

  function skillText(skills) {
    return (skills || []).map(function (s) {
      var t = data.trees[s[0]];
      return (t ? t.name : "Tree " + s[0]) + " " + (s[1] > 0 ? "+" : "") + s[1];
    }).join(", ");
  }

  function pieceOptions(slot) {
    var kind = data.rules.weaponKind(state.set.weapon[0]);
    var key = slot + "|" + kind + "|" + state.gender + "|" + state.obtainable;
    if (optionCache[key]) return optionCache[key];
    var opts = [{ value: 0, label: "Nothing" }];
    data.pieces[slot].list.forEach(function (row) {
      var p = data.pieces[slot].byId[row[0]];
      if (state.obtainable && !p.obtainable) return;
      if (!data.rules.canWear(p.flags, kind, state.gender)) return;
      opts.push({ value: p.id, label: p.name,
                  hint: "R" + p.rarity + " · Def " + p.defence + " · " + slotWord(p.slots) +
                        (p.skills.length ? " · " + skillText(p.skills) : "") });
    });
    optionCache[key] = opts;
    return opts;
  }

  function weaponOptions(cls) {
    var key = "w" + cls + "|" + state.obtainable;
    if (optionCache[key]) return optionCache[key];
    var type = typeOf(cls);
    var opts = [{ value: 0, label: "Any " + (type ? type.name : "weapon") }];
    var w = data.weapons[cls];
    w.list.forEach(function (row) {
      var id = row[w.fields.id];
      var item = w.byId[id];
      opts.push({ value: id, label: item.name, hint: "R" + item.rarity + " · " + slotWord(item.slots) +
                  (item.defense ? " · Def +" + item.defense : "") });
    });
    optionCache[key] = opts;
    return opts;
  }

  /** Decorations that fit in `room` slots; with sigils for the weapon. */
  function decoOptions(room, forWeapon) {
    var key = "d" + room + "|" + forWeapon + "|" + state.obtainable;
    if (optionCache[key]) return optionCache[key];
    var opts = [{ value: 0, label: "Empty slot" }];
    data.index.decorations.forEach(function (d) {
      if (d[2] === "c" || d[3] > room) return;
      if (state.obtainable && !d[5]) return;
      opts.push({ value: d[0], label: d[1], group: d[2] === "g" ? "Road gems (Tower Decos)" : "Decorations",
                  hint: slotWord(d[3]) + " · " + skillText(d[4]) });
    });
    opts.sort(function (a, b) { return groupRank(a) - groupRank(b); });
    if (forWeapon) {
      data.index.sigils.forEach(function (s) {
        opts.push({ value: s[0], label: s[1], group: "Tower sigils", hint: s[2] });
      });
    }
    optionCache[key] = opts;
    return opts;
  }

  function groupRank(opt) { return !opt.group ? 0 : opt.group === "Decorations" ? 1 : 2; }

  function cuffOptions() {
    var key = "c|" + state.obtainable;
    if (optionCache[key]) return optionCache[key];
    var opts = [{ value: 0, label: "No cuff" }];
    data.index.decorations.forEach(function (d) {
      if (d[2] !== "c" || (state.obtainable && !d[5])) return;
      opts.push({ value: d[0], label: d[1], hint: skillText(d[4]) });
    });
    optionCache[key] = opts;
    return opts;
  }

  function slotWord(n) { return n === 1 ? "1 slot" : n + " slots"; }

  // ---- state changes ----------------------------------------------------------------------------------

  function changed() {
    var code = Calc.encode(state.set);
    var hash = "#s=" + code;
    if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
    render();
  }

  function setSlotPiece(index, id) {
    var a = state.set.armour[index];
    a[1] = id;
    a[3] = [];
    var piece = id ? ctx().piece(a[0], id) : null;
    a[2] = piece ? piece.maxLevel : 1;
    changed();
  }

  // ---- the editor -------------------------------------------------------------------------------------

  /** A picker whose options load on the first open (a slot's pieces). */
  function lazyPicker(opts, load) {
    var p = UI.picker({ options: opts.ready() ? opts.options() : opts.placeholder, value: opts.value,
                        searchHint: opts.searchHint, unknownLabel: opts.unknownLabel, onChange: opts.onChange });
    function first(event) {
      if (opts.ready()) return;
      if (event.type === "keydown" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.stopPropagation();
      event.preventDefault();
      p.setDisabled(true);
      load().then(function () {
        p.setOptions(opts.options());
        p.setDisabled(false);
        p.button.click();
      }, function () {
        p.setDisabled(false);
        showStatus("Could not load the list. Try again.");
      });
    }
    p.el.addEventListener("click", first, true);
    p.el.addEventListener("keydown", first, true);
    return p;
  }

  function decoArea(list, capacity, forWeapon, where, onChange) {
    var box = el("div", "sb-decos");
    var used = 0;
    list.forEach(function (id) { var d = data.items[id]; used += d ? d.slots : 1; });
    var shown = list.length + (used < capacity && list.length < Calc.MAX_DECOS ? 1 : 0);
    if (!capacity) {
      box.appendChild(el("p", "note-text sb-noslots", "No decoration slots."));
      return box;
    }
    for (var i = 0; i < shown; i++) {
      (function (i) {
        var current = list[i] || 0;
        var own = current && data.items[current] ? data.items[current].slots : 0;
        var room = capacity - used + own;
        var picker = UI.picker({
          options: decoOptions(Math.max(1, room), forWeapon), value: current, kind: "item", compact: true,
          label: where + " slot " + (i + 1), searchHint: "Type a decoration or skill name",
          unknownLabel: function (v) { return data.items[v] ? data.items[v].name : "Item " + v; },
          onChange: function (v) {
            var next = list.slice();
            if (v) next[i] = v; else next.splice(i, 1);
            onChange(next);
          }
        });
        picker.button.setAttribute("data-focus", where + "|deco|" + i);
        box.appendChild(picker.el);
      })(i);
    }
    var note = el("p", "note-text sb-slots-note", used + " of " + slotWord(capacity) + " used");
    if (used > capacity) note.classList.add("sb-bad");
    box.appendChild(note);
    return box;
  }

  function weaponPanel(result) {
    var box = UI.section("Weapon", "class and weapon");
    var grid = el("div", "editor-grid");
    var cls = state.set.weapon[0];
    var classOpts = [{ value: -1, label: "No weapon picked" }].concat(data.types.map(function (t) {
      return { value: t.class, label: t.name, hint: t.class === 1 || t.class === 5 || t.class === 10 ? "Gunner" : "Blademaster" };
    }));
    var classPicker = UI.picker({
      options: classOpts, value: cls, label: "Weapon class",
      onChange: function (v) {
        state.set.weapon = [v, 0, [], []];
        loadWeapons(v).then(changed, function () { showStatus("Could not load the weapons."); });
      }
    });
    classPicker.button.setAttribute("data-focus", "weapon|class");
    grid.appendChild(UI.field("Weapon class", classPicker, "Skills that do nothing with it are marked."));
    if (cls >= 0 && data.weapons[cls]) {
      var weaponPicker = UI.picker({
        options: weaponOptions(cls), value: state.set.weapon[1], searchHint: "Type a weapon name",
        onChange: function (v) { state.set.weapon[1] = v; state.set.weapon[3] = []; changed(); }
      });
      weaponPicker.button.setAttribute("data-focus", "weapon|id");
      var weaponField = UI.field("Weapon", weaponPicker);
      if (result.weapon) weaponField.appendChild(linkHint("/weapons.html?type=" + typeOf(cls).slug + "&w=" + result.weapon.id, "Stats and moves"));
      grid.appendChild(weaponField);
    }
    box.appendChild(grid);
    if (result.weapon) {
      box.appendChild(UI.subhead("Decorations and sigils"));
      box.appendChild(decoArea(state.set.weapon[3], result.weapon.slots, true, "weapon", function (next) {
        state.set.weapon[3] = next;
        changed();
      }));
    }
    return box;
  }

  function linkHint(href, text) {
    var p = el("p", "note-text");
    var a = el("a", null, text);
    a.href = href;
    p.appendChild(a);
    return p;
  }

  function filtersPanel() {
    var box = UI.section("Hunter", "filters the lists");
    var grid = el("div", "editor-grid");
    var genderPicker = UI.picker({
      options: [{ value: 0, label: "Any" }, { value: 1, label: "Male" }, { value: 2, label: "Female" }],
      value: state.gender === "male" ? 1 : state.gender === "female" ? 2 : 0,
      onChange: function (v) { state.gender = v === 1 ? "male" : v === 2 ? "female" : ""; render(); }
    });
    genderPicker.button.setAttribute("data-focus", "filter|gender");
    grid.appendChild(UI.field("Hunter", genderPicker, "Some pieces are made for one gender."));
    var wrap = el("div", "bui-flags");
    var label = el("label", "bui-check");
    var check = el("input");
    check.type = "checkbox";
    check.checked = state.obtainable;
    check.setAttribute("data-focus", "filter|obtainable");
    check.addEventListener("change", function () { state.obtainable = check.checked; render(); });
    label.appendChild(check);
    label.appendChild(document.createTextNode("Only what players can get"));
    wrap.appendChild(label);
    grid.appendChild(UI.field("Lists", wrap, "Leaves out pieces and decorations nobody can get."));
    box.appendChild(grid);
    return box;
  }

  function slotPanel(index, result) {
    var a = state.set.armour[index];
    var slot = a[0];
    var info = result.pieces[index];
    var piece = info && info.piece;
    var box = UI.section(SLOT_NAMES[slot], piece ? "Def " + info.defence.value + (info.defence.exact ? "" : "*") : "empty");
    box.classList.add("sb-slot");
    box.setAttribute("data-slot", slot);
    var grid = el("div", "editor-grid");
    var picker = lazyPicker({
      options: function () { return pieceOptions(slot); },
      ready: function () { return !!data.pieces[slot]; },
      value: a[1], searchHint: "Type a piece name",
      placeholder: [{ value: 0, label: "Nothing" }],
      unknownLabel: function (v) { return v ? "Piece " + v : "Nothing"; },
      onChange: function (v) { setSlotPiece(index, v); }
    }, function () { return loadSlot(slot); });
    picker.button.setAttribute("data-focus", slot + "|piece");
    grid.appendChild(UI.field(SLOT_NAMES[slot] + " piece", picker));
    if (piece) {
      var levels = [];
      for (var l = 1; l <= piece.maxLevel; l++) levels.push({ value: l, label: "Level " + l });
      var levelPicker = UI.picker({
        options: levels, value: info.level,
        onChange: function (v) {
          a[2] = v;
          var cap = data.rules.slotsAt(piece, v).value;
          var used = 0;
          a[3] = a[3].filter(function (id) { used += (data.items[id] || { slots: 1 }).slots; return used <= cap; });
          changed();
        }
      });
      levelPicker.button.setAttribute("data-focus", slot + "|level");
      grid.appendChild(UI.field("Level", levelPicker));
    }
    box.appendChild(grid);
    if (piece) {
      var facts = el("p", "note-text sb-piece-facts");
      facts.appendChild(document.createTextNode("R" + piece.rarity + " · Def " + info.defence.value +
        (info.defence.exact ? "" : "* (level 1 value)") + " · " +
        RES_ORDER.map(function (r) { var v = piece.res[Calc.RES.indexOf(r)]; return RES_NAMES[r] + " " + signed(v); }).join(", ") +
        (piece.skills.length ? " · " + skillText(piece.skills) : "") + " "));
      var link = el("a", null, "Materials and upgrades");
      link.href = "/equipment.html?slot=" + slot + "&id=" + piece.id;
      facts.appendChild(link);
      if (!piece.obtainable) facts.appendChild(el("span", "badge sb-badge-bad", "not obtainable"));
      box.appendChild(facts);
      box.appendChild(decoArea(a[3], info.slots.value, false, slot, function (next) { a[3] = next; changed(); }));
    }
    return box;
  }

  function cuffPanel() {
    var box = UI.section("Skill cuffs", data.rules.cuffSlots + " slots" + (data.rules.exact ? "" : "*"));
    var grid = el("div", "editor-grid");
    for (var i = 0; i < data.rules.cuffSlots; i++) {
      (function (i) {
        var p = UI.picker({
          options: cuffOptions(), value: state.set.cuffs[i] || 0, kind: "item", searchHint: "Type a cuff name",
          onChange: function (v) {
            var next = state.set.cuffs.slice();
            if (v) next[i] = v; else next[i] = 0;
            state.set.cuffs = next.filter(Boolean);
            changed();
          }
        });
        p.button.setAttribute("data-focus", "cuff|" + i);
        grid.appendChild(UI.field("Cuff " + (i + 1), p));
      })(i);
    }
    box.appendChild(grid);
    return box;
  }

  // ---- the summary ------------------------------------------------------------------------------------

  function signed(v) { return v > 0 ? "+" + v : String(v); }

  function summaryView(result) {
    var frag = document.createDocumentFragment();
    var rules = data.rules;

    var stats = UI.section("Defence and resistances", result.defence.exact && result.bonusExact ? "" : "* not yet exact");
    var dl = el("dl", "sb-stats");
    function stat(name, value, title) {
      var pair = el("div", "sb-stat");
      var dd = el("dd", null, value);
      if (title) dd.title = title;
      pair.appendChild(el("dt", null, name));
      pair.appendChild(dd);
      dl.appendChild(pair);
    }
    stat("Defence", String(result.defence.total) + (result.defence.exact ? "" : "*"),
      "Armour " + result.defence.pieces + ", weapon " + result.defence.weapon + ", skills " + result.defence.skills);
    RES_ORDER.forEach(function (r) { stat(RES_NAMES[r], signed(result.res[r])); });
    dl.setAttribute("data-defence", result.defence.total);
    stats.appendChild(dl);
    if (!result.defence.exact) stats.appendChild(UI.note("* " + rules.notes.levels));
    frag.appendChild(stats);

    var skills = UI.section("Active skills", result.limit.count + " of " + result.limit.limit +
      (result.limit.exact ? "" : "*"));
    skills.id = "sb-active";
    if (!result.active.length) skills.appendChild(UI.note("No skills yet: pick armour and decorations."));
    var ul = el("ul", "sb-active-list");
    result.active.forEach(function (s) {
      var li = el("li", "sb-skill" + (s.negative ? " is-negative" : "") + (s.works ? "" : " is-idle") +
        (s.dropped ? " is-dropped" : ""));
      li.setAttribute("data-skill", s.skill);
      var name = s.tree ? el("a", "sb-skill-name", s.name) : el("span", "sb-skill-name", s.name);
      if (s.tree) name.href = "/skill.html?id=" + s.tree;
      li.appendChild(name);
      var meta = s.from === "automatic" ? "set bonus / automatic, from " + s.source : s.treeName + " " + signed(s.total);
      li.appendChild(el("span", "sb-skill-meta", meta));
      if (!s.works) {
        var type = typeOf(state.set.weapon[0]);
        li.appendChild(el("span", "sb-skill-warn", "no effect with " + (type ? type.name : "this weapon") +
          (s.worksExact ? "" : "*")));
      }
      if (s.dropped) li.appendChild(el("span", "sb-skill-warn", "over the limit: not active"));
      ul.appendChild(li);
    });
    skills.appendChild(ul);
    if (result.limit.over) {
      skills.appendChild(el("p", "form-alert sb-over", "More skills than the limit of " + result.limit.limit + "." +
        (result.limit.dropKnown ? "" : " The game turns some off; which ones is not decoded yet.")));
    }
    var notes = [];
    if (!result.limit.exact) notes.push(rules.notes.skillLimit);
    if (result.active.some(function (s) { return !s.works && !s.worksExact; })) notes.push(rules.notes.weapon);
    if (rules.notes.zenith) notes.push(rules.notes.zenith);
    if (notes.length) skills.appendChild(UI.note("* " + notes.join(" ")));
    frag.appendChild(skills);

    var pts = UI.section("Skill points", "per skill tree");
    var rows = result.trees.map(function (t) {
      var name = el("a", null, t.name);
      name.href = "/skill.html?id=" + t.tree;
      var from = t.parts.map(function (p) { return p.from + " " + signed(p.points); }).join(", ");
      var reach = t.skill ? t.skill.name : (t.next ? t.next.points - t.total + " more for " + t.next.name : "");
      return [{ node: name, label: "Tree" }, { node: signed(t.total), label: "Points", cls: "num" },
              { node: reach, label: "Skill" }, { node: from, label: "From", cls: "sb-from" }];
    });
    var table = UI.table(["Tree", "Points", "Skill", "From"], rows, "No skill points yet.", "sb-points");
    pts.appendChild(table);
    frag.appendChild(pts);

    if (result.problems.length) {
      var prob = UI.section("Problems with this set");
      var pl = el("ul", "sb-problems");
      result.problems.forEach(function (p) { pl.appendChild(el("li", null, p)); });
      prob.appendChild(pl);
      frag.appendChild(prob);
    }

    var share = UI.section("Share");
    var actions = el("div", "bui-actions");
    var copy = UI.button("Copy link", function () {
      var url = location.href;
      var done = function () { copy.textContent = "Link copied"; setTimeout(function () { copy.textContent = "Copy link"; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt("Copy this link", url); });
      else prompt("Copy this link", url);
    });
    copy.id = "sb-copy";
    var reset = UI.button("Start over", function () {
      if (reset.classList.contains("is-armed")) {
        state.set = Calc.empty();
        changed();
        return;
      }
      reset.classList.add("is-armed");
      reset.textContent = "Click again to clear";
    });
    actions.appendChild(copy);
    actions.appendChild(reset);
    share.appendChild(actions);
    share.appendChild(UI.note("The link holds the whole set; nothing is saved on our server."));
    frag.appendChild(share);
    return frag;
  }

  // ---- render -----------------------------------------------------------------------------------------

  function render() {
    var focusKey = document.activeElement && document.activeElement.getAttribute("data-focus");
    var result = Calc.compute(state.set, ctx());
    editor.textContent = "";
    editor.appendChild(weaponPanel(result));
    editor.appendChild(filtersPanel());
    state.set.armour.forEach(function (_a, i) { editor.appendChild(slotPanel(i, result)); });
    editor.appendChild(cuffPanel());
    summary.textContent = "";
    summary.appendChild(summaryView(result));
    if (focusKey) {
      var again = document.querySelector('[data-focus="' + focusKey + '"]');
      if (again) again.focus({ preventScroll: true });
    }
    app.setAttribute("data-ready", "1");
  }

  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function fromHash() {
    var m = /(?:^#|&)s=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    var set = Calc.decode(m[1]);
    if (!set) showStatus("This link's set could not be read; starting with an empty set.");
    return set;
  }

  function loadHash() {
    var set = fromHash() || Calc.empty();
    state.set = set;
    return loadForSet(set).then(function () {
      if (set.data && data.index && set.data !== data.index.version) {
        showStatus("This set was made with the game data of " + set.data + "; the page now uses " +
          data.index.version + ", so numbers may differ.");
      }
      set.data = data.index.version;
      render();
    });
  }

  function start() {
    Promise.all([
      getJson("/data/armor/index.json"),
      getJson("/data/armor/rules.json").catch(function () { return null; }),
      getJson("/data/skills/index.json"),
      getJson("/data/weapons/index.json"),
      UI.loadIcons(["items"])
    ]).then(function (all) {
      data.index = all[0];
      data.rules = window.ArmorRules.make(all[1]);
      all[2].trees.forEach(function (t) { data.trees[t[0]] = { id: t[0], name: t[1], category: t[2], levels: t[3] }; });
      data.types = all[3].types.map(function (t) { return { slug: t.slug, name: t.name, class: t.class }; });
      data.types.sort(function (a, b) { return a.name.localeCompare(b.name); });
      data.index.decorations.forEach(function (d) {
        data.items[d[0]] = { item: d[0], name: d[1], kind: d[2], slots: d[3], skills: d[4], obtainable: !!d[5] };
      });
      data.index.sigils.forEach(function (s) {
        data.items[s[0]] = { item: s[0], name: s[1], kind: "s", slots: 1, skills: [], effect: s[2] };
      });
      document.getElementById("sb-data").textContent = "Game data: client patch " + data.index.version + ". Rules: " +
        (data.rules.exact ? "decoded from the game" : "not yet exact (marked *), being decoded from the game") + ".";
      state.set.data = data.index.version;
      app.hidden = false;
      return loadHash();
    }).catch(function (err) {
      showStatus("The Set builder's data did not load. Reload the page to try again.");
      if (window.console) console.warn(err);
    });
    window.addEventListener("hashchange", function () {
      var set = fromHash();
      if (set && Calc.encode(set) !== Calc.encode(state.set)) loadHash();
    });
  }

  start();
})();
