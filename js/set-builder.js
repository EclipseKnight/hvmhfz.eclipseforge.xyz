/* Set builder page (set-builder.html): pick a weapon, five armour pieces with their levels, decorations,
   sigils and cuffs, and see the skill points, active skills, defence and resistances as you go.

   Data (static, dev/make-armor-data.py): data/armor/index.json (decorations, cuffs, sigils, weapon Zenith skills,
   Tower flags and automatic skills, skill names), data/armor/<slot>.json (pieces; loaded when the slot is first
   opened or a set needs it), data/armor/rules.json (the game's skill rules and skill trees, read by
   js/armor-rules.js), data/weapons/index.json and data/weapons/<type>.json (weapons and their slots). The sums are
   js/armor-calc.js; the controls are js/builder-ui.js's. The set lives in the address (#s=..., the set format of
   js/armor-calc.js), so a link shares it; nothing is sent to a server unless the player posts the set (or asks
   what is missing, below): the "Community sets" panel below the editor (js/community-api.js, js/set-post-form.js)
   posts it with POST /api/account/armor-sets, or, with &edit=<id> in the address (the link "My sets" on
   community-sets.html gives), changes that set of the player's with PUT.

   Signed in, the "Your character" panel and "Missing for this set" (js/set-builder-mine.js, js/armor-owned.js)
   load one of the player's characters from the API (read-only): its worn set or a My Set into the builder, an
   "Only what I own" filter for every picker below, and what the set still needs. */
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
  var postBox = document.getElementById("sb-post");
  var Api = window.CommunityApi;
  var Form = window.SetPostForm;

  var data = { index: null, rules: null, types: [], weapons: {}, pieces: {}, items: {}, weaponIds: null };
  var loading = {};
  var state = { set: Calc.empty(), gender: "", obtainable: true };
  var optionCache = {};
  // the Community sets panel: editId = the player's set the address names (&edit=), item = that set once loaded,
  // open = the form is showing, done = what the last post or save answered
  var post = { editId: null, item: null, open: false, done: null, note: "", loading: false, form: null };
  var missingBox = document.getElementById("sb-missing");
  // the player's character part (js/set-builder-mine.js); null until the game data has loaded
  var mine = null;

  /** The part of a picker's cache key that the "only what I own" filter changes. */
  function ownKey() { return mine && mine.filtering() ? "|own" + mine.version() : ""; }

  function el(tag, cls, text) { return UI.el(tag, cls, text); }

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url + ": " + res.status);
      return res.json();
    });
  }

  // ---- data ----------------------------------------------------------------------------------------

  function pieceObject(row) {
    return { id: row[0], name: row[1], rarity: row[2], defence: row[3], slots: row[4], maxSlots: row[5],
             res: row[6], flags: row[7], maxLevel: row[8], skills: row[9], auto: row[10], obtainable: !!row[11],
             defGrowth: row[12], slotGrowth: row[13], limitKind: row[14], zenith: row[15] };
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
        var table = json.kind === "melee" ? "melee" : "ranged";   // bowguns and bows share the game's ranged table
        var auto = data.index.weaponAuto[table] || {};
        var extra = data.index.weapons[table] || {};
        var byId = {};
        json.weapons.forEach(function (w) {
          var x = extra[w[f.id]] || [0, 0];
          byId[w[f.id]] = { id: w[f.id], name: w[f.name], rarity: w[f.rarity], slots: w[f.slots] || 0,
                            defense: w[f.defense] || 0, auto: auto[w[f.id]] || 0, zenith: x[0], tower: !!x[1] };
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
      item: function (id) { return data.items[id] || null; }
    };
  }

  // ---- options for the pickers ------------------------------------------------------------------------

  function skillText(skills) {
    return (skills || []).map(function (s) {
      var t = data.rules.tree(s[0]);
      return (t ? t.name : "Tree " + s[0]) + " " + (s[1] > 0 ? "+" : "") + s[1];
    }).join(", ");
  }

  function pieceOptions(slot) {
    var kind = data.rules.weaponKind(state.set.weapon[0]);
    var key = slot + "|" + kind + "|" + state.gender + "|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var opts = [{ value: 0, label: "Nothing" }];
    var own = mine && mine.filtering();
    data.pieces[slot].list.forEach(function (row) {
      var p = data.pieces[slot].byId[row[0]];
      var level = own ? mine.ownedLevel(slot, p.id) : 0;
      if (own && !level) return;
      if (state.obtainable && !p.obtainable && !level) return;
      if (!data.rules.canWear(p.flags, state.gender) || !data.rules.kindFits(p.flags, kind)) return;
      opts.push({ value: p.id, label: p.name,
                  hint: (level ? "yours: Lv " + level + " · " : "") + "R" + p.rarity + " · Def " + p.defence + " · " +
                        slotWord(p.slots) + (p.skills.length ? " · " + skillText(p.skills) : "") +
                        (p.zenith ? " · " + data.rules.zenithName(p.zenith) : "") });
    });
    optionCache[key] = opts;
    return opts;
  }

  function weaponOptions(cls) {
    var key = "w" + cls + "|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var type = typeOf(cls);
    var opts = [{ value: 0, label: "Any " + (type ? type.name : "weapon") }];
    var w = data.weapons[cls];
    var own = mine && mine.filtering();
    w.list.forEach(function (row) {
      var id = row[w.fields.id];
      var item = w.byId[id];
      if (own && !mine.ownsWeapon(cls, id)) return;
      opts.push({ value: id, label: item.name, hint: "R" + item.rarity + " · " +
                  (item.tower ? "Tower weapon, " + item.slots + " sigil places" : slotWord(item.slots)) +
                  (item.defense ? " · Def +" + item.defense : "") +
                  (item.zenith ? " · " + data.rules.zenithName(item.zenith) : "") });
    });
    optionCache[key] = opts;
    return opts;
  }

  /** Decorations that fit in `room` slots. A Tower weapon (tower true) takes Tower sigils and Road gems (Tower
      Decos) instead, one a place; sigils go on nothing else. */
  function decoOptions(room, tower) {
    var key = "d" + room + "|" + tower + "|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var opts = [{ value: 0, label: "Empty slot" }];
    var own = mine && mine.filtering();
    data.index.decorations.forEach(function (d) {
      if (d[2] === "c" || (tower ? d[2] !== "g" : d[3] > room)) return;
      if (own ? !mine.ownsItem(d[0]) : state.obtainable && !d[5]) return;
      opts.push({ value: d[0], label: d[1], group: d[2] === "g" ? "Road gems (Tower Decos)" : "Decorations",
                  hint: (own ? mine.itemHint(d[0]) + " · " : "") + slotWord(d[3]) + " · " + skillText(d[4]) });
    });
    opts.sort(function (a, b) { return groupRank(a) - groupRank(b); });
    if (tower) {
      data.index.sigils.forEach(function (s) {
        if (own && !mine.ownsItem(s[0])) return;
        opts.push({ value: s[0], label: s[1], group: "Tower sigils", hint: (own ? mine.itemHint(s[0]) + " · " : "") + s[2] });
      });
    }
    optionCache[key] = opts;
    return opts;
  }

  function groupRank(opt) { return !opt.group ? 0 : opt.group === "Decorations" ? 1 : 2; }

  function cuffOptions() {
    var key = "c|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var opts = [{ value: 0, label: "No cuff" }];
    var own = mine && mine.filtering();
    data.index.decorations.forEach(function (d) {
      if (d[2] !== "c") return;
      if (own ? !mine.ownsItem(d[0]) : state.obtainable && !d[5]) return;
      opts.push({ value: d[0], label: d[1], hint: (own ? mine.itemHint(d[0]) + " · " : "") + skillText(d[4]) });
    });
    optionCache[key] = opts;
    return opts;
  }

  function slotWord(n) { return n === 1 ? "1 slot" : n + " slots"; }

  // ---- state changes ----------------------------------------------------------------------------------

  function changed() {
    var code = Calc.encode(state.set);
    var hash = "#s=" + code + (post.editId ? "&edit=" + post.editId : "");
    if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
    render();
  }

  function setSlotPiece(index, id) {
    var a = state.set.armour[index];
    a[1] = id;
    a[3] = [];
    var piece = id ? ctx().piece(a[0], id) : null;
    var owned = mine && mine.filtering() ? mine.ownedLevel(a[0], id) : 0;
    a[2] = piece ? (owned ? Math.min(owned, piece.maxLevel) : piece.maxLevel) : 1;
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

  /** The decoration pickers of a piece or weapon. tower: a Tower weapon, whose 3 places take one sigil or gem each. */
  function decoArea(list, capacity, tower, where, onChange) {
    var box = el("div", "sb-decos");
    var used = 0;
    function size(id) { var d = data.items[id]; return tower || !d ? 1 : d.slots; }
    list.forEach(function (id) { used += size(id); });
    var shown = list.length + (used < capacity && list.length < Calc.MAX_DECOS ? 1 : 0);
    if (!capacity) {
      box.appendChild(el("p", "note-text sb-noslots", "No decoration slots."));
      return box;
    }
    for (var i = 0; i < shown; i++) {
      (function (i) {
        var current = list[i] || 0;
        var own = current ? size(current) : 0;
        var room = capacity - used + own;
        var picker = UI.picker({
          options: decoOptions(Math.max(1, room), tower), value: current, kind: "item", compact: true,
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
    var note = el("p", "note-text sb-slots-note", tower ? used + " of 3 places used" : used + " of " + slotWord(capacity) + " used");
    if (used > capacity) note.classList.add("sb-bad");
    box.appendChild(note);
    return box;
  }

  function weaponPanel(result) {
    var box = UI.section("Weapon", "class and weapon");
    var grid = el("div", "editor-grid");
    var cls = state.set.weapon[0];
    var classOpts = [{ value: -1, label: "No weapon picked" }].concat(data.types.map(function (t) {
      var hint = t.class === 1 || t.class === 5 || t.class === 10 ? "Gunner" : "Blademaster";
      if (mine && mine.loaded()) hint += " · yours: " + mine.weaponCount(t.class);
      return { value: t.class, label: t.name, hint: hint };
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
    if (result.weapon && result.weapon.tower) {
      box.appendChild(UI.subhead("Tower sigils and Road gems"));
      var ws = result.weaponSlots;
      box.appendChild(UI.note("A Tower weapon: " + ws.sigilPlaces + " sigil place" + (ws.sigilPlaces === 1 ? "" : "s") +
        " and " + ws.gemPlaces + " Road gem place" + (ws.gemPlaces === 1 ? "" : "s") + ". Its Road gems give their own " +
        "skills (the best gem of each skill, up to 4, outside the skill limit), not skill points."));
      box.appendChild(decoArea(state.set.weapon[3], 3, true, "weapon", function (next) {
        state.set.weapon[3] = next;
        changed();
      }));
    } else if (result.weapon) {
      box.appendChild(UI.subhead("Decorations"));
      box.appendChild(decoArea(state.set.weapon[3], result.weapon.slots, false, "weapon", function (next) {
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
    var box = UI.section(SLOT_NAMES[slot], piece ? "Def " + info.defence.value : "empty");
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
          var cap = data.rules.slotsAt(info.row, v);
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
      facts.appendChild(document.createTextNode("R" + piece.rarity + " · Def " + info.defence.value + " · " +
        RES_ORDER.map(function (r) { var v = piece.res[Calc.RES.indexOf(r)]; return RES_NAMES[r] + " " + signed(v); }).join(", ") +
        (piece.skills.length ? " · " + skillText(piece.skills) : "") +
        (piece.zenith ? " · " + data.rules.zenithName(piece.zenith) : "") +
        (piece.auto ? " · automatic " + data.rules.skillName(piece.auto) : "") + " "));
      var link = el("a", null, "Materials and upgrades");
      link.href = "/equipment.html?slot=" + slot + "&id=" + piece.id;
      facts.appendChild(link);
      if (!piece.obtainable) facts.appendChild(el("span", "badge sb-badge-bad", "not obtainable"));
      if (mine && mine.loaded()) {
        var have = mine.ownedLevel(slot, piece.id);
        var badge = el("span", "badge" + (have ? " sb-badge-own" : ""), have ? "yours: Lv " + have : "not yours");
        badge.setAttribute("data-owned", String(have));
        facts.appendChild(badge);
      }
      box.appendChild(facts);
      box.appendChild(decoArea(a[3], info.slots.value, false, slot, function (next) { a[3] = next; changed(); }));
    }
    return box;
  }

  function cuffPanel() {
    var box = UI.section("Skill cuffs", data.rules.cuffSlots + " slots");
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

    var stats = UI.section("Defence and resistances", "armour and weapon");
    var dl = el("dl", "sb-stats");
    function stat(name, value, title) {
      var pair = el("div", "sb-stat");
      var dd = el("dd", null, value);
      if (title) dd.title = title;
      pair.appendChild(el("dt", null, name));
      pair.appendChild(dd);
      dl.appendChild(pair);
    }
    stat("Defence", String(result.defence.total), "Armour " + result.defence.pieces + ", weapon " + result.defence.weapon);
    RES_ORDER.forEach(function (r) { stat(RES_NAMES[r], signed(result.res[r])); });
    dl.setAttribute("data-defence", result.defence.total);
    stats.appendChild(dl);
    stats.appendChild(UI.note("Skills such as Defense+ or Fire Res+ are not added here."));
    frag.appendChild(stats);

    var lim = result.limit;
    var skills = UI.section("Active skills", lim.count + " of " + lim.limit);
    skills.id = "sb-active";
    skills.setAttribute("data-limit", lim.limit);
    if (!result.active.length) skills.appendChild(UI.note("No skills yet: pick armour and decorations."));
    var ul = el("ul", "sb-active-list");
    result.active.forEach(function (s) {
      var li = el("li", "sb-skill" + (s.negative ? " is-negative" : "") + (s.works ? "" : " is-idle") +
        (s.dropped ? " is-dropped" : ""));
      li.setAttribute("data-skill", s.skill);
      li.setAttribute("data-from", s.from);
      var name = s.tree ? el("a", "sb-skill-name", s.name) : el("span", "sb-skill-name", s.name);
      if (s.tree) name.href = "/skill.html?id=" + s.tree;
      li.appendChild(name);
      var meta = s.from === "automatic" ? "automatic, from " + s.source
        : s.from === "tower" ? "Road gem skill of " + s.source + ", outside the limit"
        : s.treeName + " " + signed(s.total);
      li.appendChild(el("span", "sb-skill-meta", meta));
      if (!s.works) {
        var type = typeOf(state.set.weapon[0]);
        li.appendChild(el("span", "sb-skill-warn", "no effect with " + (type ? type.name : "this weapon")));
      }
      if (s.dropped) li.appendChild(el("span", "sb-skill-warn", "over the limit: not active"));
      ul.appendChild(li);
    });
    skills.appendChild(ul);
    if (lim.over) {
      skills.appendChild(el("p", "form-alert sb-over", "More skills than the limit of " + lim.limit + ": the game keeps " +
        "them in the order of its skill table, so the ones marked are off."));
    }
    var p = lim.parts;
    var why = ["10 to start"];
    if (p.rank_bonus) why.push("+" + p.rank_bonus + " for " + (p.rank_pieces + p.zenith_pieces + p.tower_plates) + " G-rank or Zenith pieces");
    if (p.skill_slots_up) why.push("+" + p.skill_slots_up + " Skill Slots Up");
    if (p.cuffs) why.push("+" + p.cuffs + " for cuffs");
    if (lim.limit < p.limit) why.push("-" + (p.limit - lim.limit) + " for a cuff whose Tech skill is not on");
    skills.appendChild(UI.note("Skill limit " + lim.limit + ": " + why.join(", ") + ". Automatic and Road gem skills do not count."));
    frag.appendChild(skills);

    if (result.zenith.length) {
      var zen = UI.section("Zenith skills");
      zen.id = "sb-zenith";
      var zl = el("ul", "sb-active-list");
      result.zenith.forEach(function (z) {
        var li = el("li", "sb-skill" + (z.lit ? "" : " is-idle"));
        li.setAttribute("data-zenith", z.id);
        li.setAttribute("data-lit", z.lit ? "1" : "0");
        li.appendChild(el("span", "sb-skill-name", z.name));
        if (z.needs) li.appendChild(el("span", "sb-skill-meta", "needs a " + z.needs + " skill"));
        if (!z.lit) li.appendChild(el("span", "sb-skill-warn", "not lit: no effect"));
        zl.appendChild(li);
      });
      zen.appendChild(zl);
      frag.appendChild(zen);
    }

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

  // ---- posting to Community sets ------------------------------------------------------------------------

  /** The skill ids the calculator says are active and do something: what the community list filters on. */
  function activeSkillIds() {
    var seen = {};
    var ids = [];
    Calc.compute(state.set, ctx()).active.forEach(function (s) {
      if (s.dropped || !s.works || s.negative || seen[s.skill]) return;
      seen[s.skill] = true;
      ids.push(s.skill);
    });
    return ids;
  }

  function postBody(v) {
    var set = Calc.normalize(state.set);
    set.data = data.index.version;
    // the API's rules: a weapon class (lists filter on it), and a weapon or at least one armour piece
    if (set.weapon[0] < 0) throw new Error("Pick a weapon class first: community sets are listed by weapon.");
    var empty = !set.weapon[1] && !set.armour.some(function (a) { return a[1]; });
    if (empty) throw new Error("Pick a weapon or some armour first: there is nothing to post yet.");
    return { title: v.title, notes: v.notes, set: set, band: v.band, stage: v.stage, skills: activeSkillIds(),
             showAuthor: v.showAuthor, charId: v.charId };
  }

  function openPostForm() {
    post.loading = true;
    post.note = "";
    renderPost();
    Promise.all([Api.loadOptions(), Api.loadCharacters()]).then(function (all) {
      var item = post.item;
      post.form = Form.create({
        options: all[0], characters: all[1], submitLabel: item ? "Save changes" : "Post set",
        values: item ? { title: item.title, notes: item.notes, band: item.band, stage: item.stage,
                         showAuthor: item.showAuthor, charId: item.charId } : {},
        onCancel: function () { post.open = false; post.form = null; renderPost(); },
        submit: function (v) {
          var body = postBody(v);
          var edit = post.editId;
          return Api.request("/api/account/armor-sets" + (edit ? "/" + edit : ""),
                             { method: edit ? "PUT" : "POST", body: body, auth: true }).then(function (saved) {
            post.done = { id: saved.id, edited: !!edit };
            post.open = false;
            post.form = null;
            renderPost();
          });
        }
      });
      post.open = true;
      post.loading = false;
      renderPost();
    }, function (error) {
      post.loading = false;
      post.note = error.message;
      renderPost();
    });
  }

  /** With &edit=<id> in the address: that set's details from the player's own list, then the form opens on them. */
  function resolveEdit() {
    post.item = null;
    if (!post.editId || !Api.signedIn()) { renderPost(); return; }
    Api.request("/api/account/armor-sets", { auth: true }).then(function (res) {
      var found = ((res && res.items) || []).filter(function (it) { return it.id === post.editId; })[0];
      if (found) {
        post.item = found;
        openPostForm();
        return;
      }
      post.note = "Set " + post.editId + " is not one of your sets (it may be deleted), so this posts a new set.";
      post.editId = null;
      history.replaceState(null, "", location.pathname + location.search + "#s=" + Calc.encode(state.set));
      renderPost();
    }, function (error) {
      post.note = error.message;
      renderPost();
    });
  }

  function renderPost() {
    postBox.hidden = false;
    postBox.textContent = "";
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Community sets"));
    postBox.appendChild(head);
    if (!Api.signedIn()) {
      var p = el("p", "note-text");
      var a = el("a", "btn btn-primary", "Sign in to post");
      a.id = "sb-post-signin";
      a.href = Api.signinUrl("/set-builder.html" + location.hash);
      p.appendChild(a);
      p.appendChild(document.createTextNode(" Share this set with other hunters. Browsing needs no account: "));
      var all = el("a", null, "see the community sets");
      all.href = "/community-sets.html";
      p.appendChild(all);
      p.appendChild(document.createTextNode("."));
      postBox.appendChild(p);
      return;
    }
    if (post.note) {
      var note = el("p", "form-alert", post.note);
      note.setAttribute("role", "alert");
      postBox.appendChild(note);
    }
    if (post.done) {
      var ok = el("p", "road-ok");
      ok.id = "sb-post-done";
      ok.setAttribute("role", "status");
      ok.appendChild(document.createTextNode(post.done.edited ? "Saved. " : "Posted. "));
      var link = el("a", null, "See the set on Community sets");
      link.href = "/community-sets.html?id=" + post.done.id;
      ok.appendChild(link);
      ok.appendChild(document.createTextNode("."));
      postBox.appendChild(ok);
    }
    if (post.open && post.form) {
      if (post.item) postBox.appendChild(el("p", "note-text", "Changing your set \"" + post.item.title +
        "\" to the set shown above. The title, notes and the rest can be changed too."));
      postBox.appendChild(post.form.el);
      return;
    }
    var row = el("div", "bui-actions");
    var open = UI.button(post.loading ? "Loading" : post.editId && post.item ? "Save this set over \"" + post.item.title + "\""
      : "Post to Community Sets", openPostForm);
    open.id = "sb-post-open";
    open.disabled = post.loading;
    row.appendChild(open);
    postBox.appendChild(row);
    postBox.appendChild(UI.note("Posting shows the set, your title and notes to everyone, right away. Staff hide sets that are reported. " +
      "Your characters' items are never shown."));
  }

  // ---- render -----------------------------------------------------------------------------------------

  function render() {
    var focusKey = document.activeElement && document.activeElement.getAttribute("data-focus");
    var result = Calc.compute(state.set, ctx());
    editor.textContent = "";
    if (mine) editor.appendChild(mine.panel());
    editor.appendChild(weaponPanel(result));
    editor.appendChild(filtersPanel());
    state.set.armour.forEach(function (_a, i) { editor.appendChild(slotPanel(i, result)); });
    editor.appendChild(cuffPanel());
    summary.textContent = "";
    summary.appendChild(summaryView(result));
    if (mine) mine.renderMissing(missingBox);
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

  function editFromHash() {
    var m = /(?:^#|&)edit=(\d{1,10})(?:&|$)/.exec(location.hash);
    return m ? Number(m[1]) : null;
  }

  function loadHash() {
    var set = fromHash() || Calc.empty();
    state.set = set;
    var edit = editFromHash();
    var editChanged = edit !== post.editId;
    post.editId = edit;
    return loadForSet(set).then(function () {
      if (set.data && data.index && set.data !== data.index.version) {
        showStatus("This set was made with the game data of " + set.data + "; the page now uses " +
          data.index.version + ", so numbers may differ.");
      }
      set.data = data.index.version;
      render();
      if (editChanged || !postBox.firstChild) {
        post.done = null;
        post.open = false;
        post.form = null;
        resolveEdit();
      }
    });
  }

  function start() {
    Promise.all([
      getJson("/data/armor/index.json"),
      getJson("/data/armor/rules.json"),
      getJson("/data/weapons/index.json"),
      UI.loadIcons(["items"]),
      Api.signedIn() ? getJson("/data/weapons/ids.json") : null
    ]).then(function (all) {
      data.weaponIds = all[4];
      data.index = all[0];
      data.rules = window.ArmorRules.make(all[1]);
      data.types = all[2].types.map(function (t) { return { slug: t.slug, name: t.name, class: t.class }; });
      data.types.sort(function (a, b) { return a.name.localeCompare(b.name); });
      data.index.decorations.forEach(function (d) {
        data.items[d[0]] = { item: d[0], name: d[1], kind: d[2], slots: d[3], skills: d[4], obtainable: !!d[5],
                             zenith: d[6], firstTree: d[7], firstPoints: d[8] };
      });
      data.index.sigils.forEach(function (s) {
        data.items[s[0]] = { item: s[0], name: s[1], kind: "s", slots: 1, skills: s[3], effect: s[2], zenith: s[4],
                             firstTree: s[5], firstPoints: s[6] };
      });
      document.getElementById("sb-data").textContent = "Game data: client patch " + data.index.version +
        ". Skill rules: the game's own, read from the client.";
      state.set.data = data.index.version;
      app.hidden = false;
      mine = window.SetBuilderMine.create({
        data: data,
        getSet: function () { return state.set; },
        setGender: function (g) { state.gender = g; },
        render: render,
        maxLevelOf: function (slot, id) { var p = ctx().piece(slot, id); return p ? p.maxLevel : 0; },
        loadSet: function (set) {
          state.set = Calc.normalize(set);
          state.set.data = data.index.version;
          loadForSet(state.set).then(changed, function () { showStatus("Could not load the set's data. Try again."); });
        }
      });
      return loadHash().then(function () { mine.start(); });
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
