/* Set builder page (set-builder.html): build an armour set on cards, or pick the skills you want and let "Find
   sets" (js/set-builder-find.js) look for sets that reach them.

   Layout (css/set-builder.css): on a wide screen three columns: the set as cards (weapon, five armour pieces with
   their level and decoration sockets, cuffs, hunter filters) on the left; in the centre the list for whatever card or
   socket is being edited (searchable, sortable; pointing at a row compares it with what you have); on the right the
   set's skills (every tree with points as a bar to its next threshold, the skill limit, dropped and idle skills,
   Zenith skills), defence and resistances. Below 1200 px the skills move to their own tab; on a phone the tabs are
   Equipment / Skills / Find sets. Nothing is a dropdown-only flow: every card, socket, row and chip is a button.

   Data (static, dev/make-armor-data.py): data/armor/index.json (decorations, cuffs, sigils, weapon Zenith skills,
   Tower flags and automatic skills, skill names), data/armor/<slot>.json (pieces; loaded when the slot is first
   opened or a set needs it), data/armor/rules.json (the game's skill rules and skill trees, read by
   js/armor-rules.js), data/weapons/index.json and data/weapons/<type>.json (weapons and their slots). The sums are
   js/armor-calc.js. The set lives in the address (#s=..., the set format of js/armor-calc.js), so a link shares it;
   nothing is sent to a server unless the player posts the set (or asks what is missing, below): the "Community
   sets" panel below the editor (js/community-api.js, js/set-post-form.js) posts it with POST
   /api/account/armor-sets, or, with &edit=<id> in the address (the link "My sets" on community-sets.html gives),
   changes that set of the player's with PUT.

   Signed in, the "Your character" panel and "Missing for this set" (js/set-builder-mine.js, js/armor-owned.js)
   load one of the player's characters from the API (read-only): its worn set or a My Set into the builder, an
   "Only what I own" filter for every list, and what the set still needs. */
(function () {
  "use strict";

  var UI = window.BuilderUI;
  var Calc = window.ArmorCalc;
  var SLOT_NAMES = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var RES_NAMES = { fire: "Fire", water: "Water", thunder: "Thunder", ice: "Ice", dragon: "Dragon" };
  var RES_ORDER = ["fire", "water", "thunder", "ice", "dragon"];   // as the game's status screen lists them
  var PAGE = 80;                                                     // list rows shown before "Show more"
  // The game's equipment icon colours by rarity (js/game-icons.js RANK_COLOUR; our data's rarity counts from 1).
  var RANK_COLOUR = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  // Weapon class slugs whose icon file has another name (assets/icons/1x/<slug>-<colour>.png).
  var ICON_SLUG = { "dual-swords": "dual-blades", "switch-axe-f": "switch-axe" };

  var app = document.getElementById("sb-app");
  var editor = document.getElementById("sb-editor");
  var listBox = document.getElementById("sb-list");
  var summary = document.getElementById("sb-summary");
  var findBox = document.getElementById("sb-find");
  var mineBox = document.getElementById("sb-mine-box");
  var status = document.getElementById("sb-status");
  var postBox = document.getElementById("sb-post");
  var missingBox = document.getElementById("sb-missing");
  var Api = window.CommunityApi;
  var Form = window.SetPostForm;

  var data = { index: null, rules: null, types: [], weapons: {}, pieces: {}, items: {}, weaponIds: null };
  var loading = {};
  // edit: what the centre list is for: {kind: "class"|"weapon"|"piece"|"deco"|"cuff", slot, where, index}
  var state = { set: Calc.empty(), gender: "", obtainable: true, edit: { kind: "class" }, view: "equip",
                list: freshList(), allTrees: false, preview: null };
  var optionCache = {};
  var current = null;      // the last compute() of the set shown
  // the Community sets panel: editId = the player's set the address names (&edit=), item = that set once loaded,
  // open = the form is showing, done = what the last post or save answered
  var post = { editId: null, item: null, open: false, done: null, note: "", loading: false, form: null };
  // the player's character part (js/set-builder-mine.js) and Find sets (js/set-builder-find.js); null until loaded
  var mine = null;
  var find = null;

  function freshList() { return { q: "", sort: "", dir: 0, limit: PAGE, slotted: false }; }

  /** The part of a list's cache key that the character changes (owned marks, the "only what I own" filter). */
  function ownKey() { return mine && mine.loaded() ? (mine.filtering() ? "|own" : "|have") + mine.version() : ""; }

  function el(tag, cls, text) { return UI.el(tag, cls, text); }

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url + ": " + res.status);
      return res.json();
    });
  }

  function wide() { return window.matchMedia("(min-width: 1200px)").matches; }

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

  /** Loads what a set needs (its weapon class and pieces' slots). */
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

  function compute(set) { return Calc.compute(set, ctx()); }

  function cloneSet(set) { return Calc.normalize(JSON.parse(JSON.stringify(set))); }

  // ---- icons and words --------------------------------------------------------------------------------

  function colourOf(rarity) { var c = RANK_COLOUR[Math.max(0, (rarity || 1) - 1)]; return c === undefined ? 0 : c; }

  function pieceIcon(slot, piece) { return "/assets/icons/1x/" + slot + "-" + (piece ? colourOf(piece.rarity) : 0) + ".png"; }

  function weaponIcon(cls, weapon) {
    var type = typeOf(cls);
    if (!type) return UI.PLACEHOLDER;
    return "/assets/icons/1x/" + (ICON_SLUG[type.slug] || type.slug) + "-" + (weapon ? colourOf(weapon.rarity) : 0) + ".png";
  }

  function icon(src, cls) {
    var img = el("img", "sb-icon" + (cls ? " " + cls : ""));
    img.alt = "";
    img.src = src || UI.PLACEHOLDER;
    if (src && src.indexOf("/assets/icons/1x/") === 0) {
      img.srcset = src + " 32w, " + src.replace("/1x/", "/2x/") + " 64w";
      img.sizes = "40px";
    }
    img.addEventListener("error", function () {
      img.removeAttribute("srcset");
      if (img.src.indexOf(UI.PLACEHOLDER) === -1) img.src = UI.PLACEHOLDER;
    });
    return img;
  }

  function itemIcon(id) { return UI.iconFor("item", id) || UI.PLACEHOLDER; }

  function treeName(id) { var t = data.rules.tree(id); return t ? t.name : "Tree " + id; }

  function skillText(skills) {
    return (skills || []).map(function (s) { return treeName(s[0]) + " " + signed(s[1]); }).join(", ");
  }

  function slotWord(n) { return n === 1 ? "1 slot" : n + " slots"; }

  function signed(v) { return v > 0 ? "+" + v : String(v); }

  function kindLabel(cls) { return data.rules.weaponKind(cls) === "gunner" ? "Gunner" : "Blademaster"; }

  // ---- the lists' rows ----------------------------------------------------------------------------------

  /** Per slot, each piece's defence and slots at its highest level and its search text (built once). */
  function slotFacts(slot) {
    var d = data.pieces[slot];
    if (!d.facts) {
      d.facts = {};
      d.list.forEach(function (row) {
        var p = d.byId[row[0]];
        d.facts[p.id] = {
          def: data.rules.defenceAt({ defence: p.defence, def_growth: p.defGrowth }, p.maxLevel),
          slots: data.rules.slotsAt({ slots: p.slots, max_slots: p.maxSlots, slot_growth: p.slotGrowth }, p.maxLevel),
          text: (p.name + " " + skillText(p.skills) + (p.zenith ? " " + data.rules.zenithName(p.zenith) : "")).toLowerCase()
        };
      });
    }
    return d.facts;
  }

  /** The pieces a slot's list offers: who can wear them, the weapon's kind, obtainable, owned. */
  function pieceRows(slot) {
    var kind = data.rules.weaponKind(state.set.weapon[0]);
    var key = slot + "|" + kind + "|" + state.gender + "|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var own = mine && mine.filtering();
    var facts = slotFacts(slot);
    var rows = [];
    data.pieces[slot].list.forEach(function (row) {
      var p = data.pieces[slot].byId[row[0]];
      var level = mine && mine.loaded() ? mine.ownedLevel(slot, p.id) : 0;
      if (own && !level) return;
      if (state.obtainable && !p.obtainable && !level) return;
      if (!data.rules.canWear(p.flags, state.gender) || !data.rules.kindFits(p.flags, kind)) return;
      var f = facts[p.id];
      rows.push({ id: p.id, name: p.name, icon: pieceIcon(slot, p), rarity: p.rarity, def: f.def, slots: f.slots,
                  skills: p.skills, text: f.text, owned: level ? "Lv " + level : "", obtainable: p.obtainable,
                  note: p.zenith ? data.rules.zenithName(p.zenith) : p.auto ? "automatic " + data.rules.skillName(p.auto) : "" });
    });
    optionCache[key] = rows;
    return rows;
  }

  function weaponRows(cls) {
    var key = "w" + cls + "|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var w = data.weapons[cls];
    var own = mine && mine.filtering();
    var rows = [];
    w.list.forEach(function (row) {
      var id = row[w.fields.id];
      var item = w.byId[id];
      var owned = mine && mine.loaded() && mine.ownsWeapon(cls, id);
      if (own && !owned) return;
      var note = item.tower ? "Tower weapon, " + item.slots + " sigil place" + (item.slots === 1 ? "" : "s") : "";
      if (item.zenith) note += (note ? " · " : "") + data.rules.zenithName(item.zenith);
      if (item.auto) note += (note ? " · " : "") + "automatic " + data.rules.skillName(item.auto);
      rows.push({ id: id, name: item.name, icon: weaponIcon(cls, item), rarity: item.rarity, def: item.defense,
                  slots: item.slots, skills: [], text: (item.name + " " + note).toLowerCase(), owned: owned ? "yours" : "",
                  obtainable: true, note: note });
    });
    optionCache[key] = rows;
    return rows;
  }

  /** Decorations that fit in `room` slots. A Tower weapon (tower true) takes Tower sigils and Road gems (Tower
      Decos) instead, one a place; sigils go on nothing else. */
  function decoRows(room, tower) {
    var key = "d" + room + "|" + tower + "|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var own = mine && mine.filtering();
    var rows = [];
    data.index.decorations.forEach(function (d) {
      if (d[2] === "c" || (tower ? d[2] !== "g" : d[3] > room)) return;
      if (own ? !mine.ownsItem(d[0]) : state.obtainable && !d[5]) return;
      rows.push({ id: d[0], name: d[1], icon: itemIcon(d[0]), size: tower ? 1 : d[3], skills: d[4],
                  kind: d[2] === "g" ? "Road gem" : "", text: (d[1] + " " + skillText(d[4])).toLowerCase(),
                  owned: mine && mine.loaded() ? mine.itemHint(d[0]) : "", obtainable: !!d[5] });
    });
    if (tower) {
      data.index.sigils.forEach(function (s) {
        if (own && !mine.ownsItem(s[0])) return;
        rows.push({ id: s[0], name: s[1], icon: itemIcon(s[0]), size: 1, skills: s[3], kind: "Sigil", note: s[2],
                    text: (s[1] + " " + s[2]).toLowerCase(), owned: mine && mine.loaded() ? mine.itemHint(s[0]) : "",
                    obtainable: true });
      });
    }
    optionCache[key] = rows;
    return rows;
  }

  function cuffRows() {
    var key = "c|" + state.obtainable + ownKey();
    if (optionCache[key]) return optionCache[key];
    var own = mine && mine.filtering();
    var rows = [];
    data.index.decorations.forEach(function (d) {
      if (d[2] !== "c") return;
      if (own ? !mine.ownsItem(d[0]) : state.obtainable && !d[5]) return;
      rows.push({ id: d[0], name: d[1], icon: itemIcon(d[0]), skills: d[4], text: (d[1] + " " + skillText(d[4])).toLowerCase(),
                  owned: mine && mine.loaded() ? mine.itemHint(d[0]) : "", obtainable: !!d[5] });
    });
    optionCache[key] = rows;
    return rows;
  }

  // ---- changing the set ---------------------------------------------------------------------------------

  function changed() {
    var code = Calc.encode(state.set);
    var hash = "#s=" + code + (post.editId ? "&edit=" + post.editId : "");
    if (location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
    render();
  }

  function slotIndex(slot) { return Calc.SLOTS.indexOf(slot); }

  function itemSize(id, tower) { var d = data.items[id]; return tower || !d ? 1 : d.slots; }

  /** The decorations of the holder an edit names: {list, capacity, tower} or null when it holds none. */
  function holderOf(set, where, result) {
    if (where === "weapon") {
      var w = result.weapon;
      if (!w) return null;
      return { list: set.weapon[3], capacity: w.tower ? Calc.MAX_DECOS : w.slots, tower: w.tower };
    }
    var info = result.pieces[slotIndex(where)];
    if (!info || !info.piece) return null;
    return { list: set.armour[slotIndex(where)][3], capacity: info.slots.value, tower: false };
  }

  /** Applies a list choice (target t, id; 0 = clear) to a set: the one place both choosing and the compare
      preview change a set. A new piece keeps the decorations that still fit. */
  function applyChoice(set, t, id) {
    if (t.kind === "class") {
      set.weapon = [id, 0, [], []];
    } else if (t.kind === "weapon") {
      set.weapon[1] = id;
      set.weapon[3] = [];
    } else if (t.kind === "piece") {
      var a = set.armour[slotIndex(t.slot)];
      var piece = id ? ctx().piece(t.slot, id) : null;
      var owned = piece && mine && mine.filtering() ? mine.ownedLevel(t.slot, id) : 0;
      a[1] = id;
      a[2] = piece ? (owned ? Math.min(owned, piece.maxLevel) : piece.maxLevel) : 1;
      var cap = piece ? data.rules.slotsAt({ slots: piece.slots, max_slots: piece.maxSlots, slot_growth: piece.slotGrowth }, a[2]) : 0;
      var used = 0;
      a[3] = a[3].filter(function (d) { used += itemSize(d); return used <= cap; });
    } else if (t.kind === "deco") {
      var list = t.where === "weapon" ? set.weapon[3] : set.armour[slotIndex(t.where)][3];
      if (id) list[Math.min(t.index, list.length)] = id;
      else list.splice(t.index, 1);
    } else if (t.kind === "cuff") {
      var cuffs = set.cuffs.slice();
      if (id) cuffs[Math.min(t.index, cuffs.length)] = id; else cuffs.splice(t.index, 1);
      set.cuffs = cuffs.filter(Boolean);
    }
    return set;
  }

  function choose(id) {
    var t = state.edit;
    applyChoice(state.set, t, id);
    state.preview = null;
    if (t.kind === "class") {
      state.edit = { kind: "weapon" };
      state.list = freshList();
      loadWeapons(id).then(changed, function () { showStatus("Could not load the weapons."); });
      return;
    }
    if (t.kind === "deco" && id) {
      // fill the sockets one after another: the next free one, while there is room
      var r = compute(state.set);
      var h = holderOf(state.set, t.where, r);
      var used = 0;
      if (h) h.list.forEach(function (d) { used += itemSize(d, h.tower); });
      if (h && t.index === h.list.length - 1 && used < h.capacity && h.list.length < Calc.MAX_DECOS) {
        state.edit = { kind: "deco", where: t.where, index: h.list.length };
      }
    }
    changed();
  }

  /** Opens the list for a card or socket. */
  function edit(t) {
    var sameList = listKind(t) === listKind(state.edit);
    state.edit = t;
    state.preview = null;
    if (!sameList) state.list = freshList();
    var cls = state.set.weapon[0];
    var job = t.kind === "piece" ? loadSlot(t.slot) : t.kind === "weapon" && cls >= 0 ? loadWeapons(cls) : null;
    render();
    if (job) job.then(render, function () { showStatus("Could not load the list. Try again."); });
    if (!wide()) {
      setView("equip");
      listBox.scrollIntoView({ block: "start" });
    }
  }

  function listKind(t) {
    return t.kind === "deco" ? "deco|" + t.where : t.kind === "piece" ? "piece|" + t.slot : t.kind === "cuff" ? "cuff" : t.kind;
  }

  function sameTarget(a, b) {
    return a.kind === b.kind && (a.slot || a.where || "") === (b.slot || b.where || "") && (a.index || 0) === (b.index || 0);
  }

  // ---- the cards (left) ---------------------------------------------------------------------------------

  function editButton(cls, text, focusKey, target, label) {
    var b = el("button", cls, text);
    b.type = "button";
    b.setAttribute("data-focus", focusKey);
    if (label) b.setAttribute("aria-label", label);
    var on = sameTarget(target, state.edit) || (target.kind === "weapon" && state.edit.kind === "class" && cls.indexOf("sb-card-name") !== -1);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.addEventListener("click", function () { edit(target); });
    return b;
  }

  function card(slotKey, title, iconSrc, editing) {
    var box = el("section", "sb-card" + (editing ? " is-editing" : ""));
    box.setAttribute("data-slot", slotKey);
    box.setAttribute("aria-label", title);
    var top = el("div", "sb-card-top");
    top.appendChild(icon(iconSrc, "sb-card-icon"));
    var main = el("div", "sb-card-main");
    top.appendChild(main);
    box.appendChild(top);
    return { box: box, top: top, main: main };
  }

  function clearButton(focusKey, label, onClick) {
    var b = el("button", "sb-card-clear", "×");
    b.type = "button";
    b.setAttribute("data-focus", focusKey);
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /** The sockets of a piece or weapon: one button per decoration (it spans its size) and one per free slot. */
  function sockets(where, list, capacity, tower, title) {
    var row = el("div", "sb-sockets");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", title + " decoration slots");
    if (!capacity) {
      row.appendChild(el("span", "sb-socket-none", "No slots"));
      return row;
    }
    var used = 0;
    list.forEach(function (id, i) {
      var d = data.items[id];
      var size = itemSize(id, tower);
      used += size;
      var name = d ? d.name : "Item " + id;
      var b = editButton("sb-socket is-filled", null, where + "|deco|" + i, { kind: "deco", where: where, index: i },
                         title + " slot " + (i + 1) + ": " + name + ". Change or remove it");
      b.setAttribute("data-size", String(size));
      b.appendChild(icon(itemIcon(id), "sb-socket-icon"));
      b.appendChild(el("span", "sb-socket-name", name));
      b.title = name + (d && d.skills ? " · " + skillText(d.skills) : "");
      row.appendChild(b);
    });
    var free = Math.max(0, capacity - used);
    var room = list.length < Calc.MAX_DECOS;
    for (var k = 0; k < free; k++) {
      var e = editButton("sb-socket is-empty", "+", where + "|deco|" + (list.length + k),
                         { kind: "deco", where: where, index: list.length }, title + ": empty slot, choose a decoration");
      if (!room) { e.disabled = true; e.title = "At most 3 decorations a piece"; }
      row.appendChild(e);
    }
    var note = el("span", "sb-socket-count" + (used > capacity ? " sb-bad" : ""), used + "/" + capacity);
    note.title = tower ? used + " of 3 places used" : used + " of " + slotWord(capacity) + " used";
    row.appendChild(note);
    return row;
  }

  function weaponCard(result) {
    var cls = state.set.weapon[0];
    var type = typeOf(cls);
    var w = result.weapon;
    var editing = state.edit.kind === "class" || state.edit.kind === "weapon" || (state.edit.kind === "deco" && state.edit.where === "weapon");
    var c = card("weapon", "Weapon", cls >= 0 ? weaponIcon(cls, w) : UI.PLACEHOLDER, editing);
    c.box.classList.add("sb-weapon");
    var kind = el("div", "sb-card-kind");
    kind.appendChild(el("span", null, "Weapon"));
    if (type) kind.appendChild(editButton("sb-card-class", type.name, "weapon|class", { kind: "class" }, "Weapon class " + type.name + ": change it"));
    c.main.appendChild(kind);
    if (cls < 0) {
      c.main.appendChild(editButton("sb-card-name is-empty", "Choose a weapon class", "weapon|class", { kind: "class" }));
    } else {
      c.main.appendChild(editButton("sb-card-name" + (w ? "" : " is-empty"), w ? w.name : "Any " + type.name, "weapon|id",
                                    { kind: "weapon" }, (w ? w.name : "Any " + type.name) + ": choose a weapon"));
      c.top.appendChild(clearButton("weapon|clear", "Remove the weapon", function () { state.set.weapon = [-1, 0, [], []]; changed(); }));
    }
    if (w) {
      var facts = el("p", "sb-card-facts");
      facts.textContent = "R" + w.rarity + " · " + (w.tower ? "Tower weapon" : slotWord(w.slots)) + (w.defense ? " · Def +" + w.defense : "") +
        (w.zenith ? " · " + data.rules.zenithName(w.zenith) : "") + (w.auto ? " · automatic " + data.rules.skillName(w.auto) : "");
      if (mine && mine.loaded()) facts.appendChild(ownBadge(mine.ownsWeapon(cls, w.id) ? "yours" : "", mine.ownsWeapon(cls, w.id) ? 1 : 0));
      c.box.appendChild(facts);
      if (w.tower) {
        var ws = result.weaponSlots;
        c.box.appendChild(el("p", "sb-card-hint", ws.sigilPlaces + " sigil and " + ws.gemPlaces + " Road gem place" +
          (ws.gemPlaces === 1 ? "" : "s") + ": Road gems give their own skills (outside the limit)."));
      }
      c.box.appendChild(sockets("weapon", state.set.weapon[3], w.tower ? Calc.MAX_DECOS : w.slots, w.tower, w.name));
    } else if (type) {
      c.box.appendChild(el("p", "sb-card-facts", kindLabel(cls) + (mine && mine.loaded() ? " · yours: " + mine.weaponCount(cls) : "") +
        " · skills that do nothing with it are marked"));
    }
    return c.box;
  }

  function ownBadge(text, have) {
    var badge = el("span", "badge" + (have ? " sb-badge-own" : ""), text || "not yours");
    badge.setAttribute("data-owned", String(have));
    return badge;
  }

  function slotCard(index, result) {
    var a = state.set.armour[index];
    var slot = a[0];
    var info = result.pieces[index];
    var piece = info && info.piece;
    var editing = (state.edit.kind === "piece" && state.edit.slot === slot) || (state.edit.kind === "deco" && state.edit.where === slot);
    var c = card(slot, SLOT_NAMES[slot], pieceIcon(slot, piece), editing);
    c.box.classList.add("sb-slot");
    if (!piece) c.box.classList.add("is-empty");
    var kind = el("div", "sb-card-kind");
    kind.appendChild(el("span", null, SLOT_NAMES[slot]));
    if (piece) kind.appendChild(el("span", "sb-card-def", "Def " + info.defence.value));
    c.main.appendChild(kind);
    c.main.appendChild(editButton("sb-card-name" + (piece ? "" : " is-empty"), piece ? piece.name : "Choose a " + SLOT_NAMES[slot].toLowerCase() + " piece",
                                  slot + "|piece", { kind: "piece", slot: slot }, (piece ? piece.name : SLOT_NAMES[slot] + ", empty") + ": choose a piece"));
    if (!piece) return c.box;
    c.top.appendChild(clearButton(slot + "|clear", "Take off the " + SLOT_NAMES[slot].toLowerCase() + " piece", function () {
      applyChoice(state.set, { kind: "piece", slot: slot }, 0);
      changed();
    }));
    var facts = el("p", "sb-card-facts");
    facts.appendChild(document.createTextNode("R" + piece.rarity + (piece.skills.length ? " · " + skillText(piece.skills) : "") +
      (piece.zenith ? " · " + data.rules.zenithName(piece.zenith) : "") + (piece.auto ? " · automatic " + data.rules.skillName(piece.auto) : "") + " "));
    if (!piece.obtainable) facts.appendChild(el("span", "badge sb-badge-bad", "not obtainable"));
    if (mine && mine.loaded()) {
      var have = mine.ownedLevel(slot, piece.id);
      facts.appendChild(ownBadge(have ? "yours: Lv " + have : "", have));
    }
    var link = el("a", "sb-card-link", "Materials");
    link.href = "/equipment.html?slot=" + slot + "&id=" + piece.id;
    link.title = "Materials and upgrades of " + piece.name;
    facts.appendChild(link);
    c.box.appendChild(facts);
    if (piece.maxLevel > 1) c.box.appendChild(levelRow(index, info, piece));
    c.box.appendChild(sockets(slot, a[3], info.slots.value, false, SLOT_NAMES[slot]));
    return c.box;
  }

  /** Level pips 1..max: each a button, the current one pressed. */
  function levelRow(index, info, piece) {
    var a = state.set.armour[index];
    var row = el("div", "sb-levels");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", SLOT_NAMES[a[0]] + " level");
    row.appendChild(el("span", "sb-levels-label", "Lv"));
    var owned = mine && mine.loaded() ? mine.ownedLevel(a[0], piece.id) : 0;
    for (var l = 1; l <= piece.maxLevel; l++) {
      (function (l) {
        var b = el("button", "sb-level" + (owned && l <= owned ? " is-owned" : ""), String(l));
        b.type = "button";
        b.setAttribute("data-focus", a[0] + "|level|" + l);
        b.setAttribute("aria-pressed", l === info.level ? "true" : "false");
        b.setAttribute("aria-label", "Level " + l);
        b.addEventListener("click", function () {
          a[2] = l;
          var cap = data.rules.slotsAt(info.row, l);
          var used = 0;
          a[3] = a[3].filter(function (id) { used += itemSize(id); return used <= cap; });
          changed();
        });
        row.appendChild(b);
      })(l);
    }
    return row;
  }

  function cuffCard() {
    var editing = state.edit.kind === "cuff";
    var c = card("cuffs", "Skill cuffs", itemIcon(state.set.cuffs[0]) || UI.PLACEHOLDER, editing);
    var kind = el("div", "sb-card-kind");
    kind.appendChild(el("span", null, "Skill cuffs"));
    kind.appendChild(el("span", "sb-card-def", data.rules.cuffSlots + " slots"));
    c.main.appendChild(kind);
    c.main.appendChild(el("p", "sb-card-hint", "Each cuff adds a skill slot while its Tech skill is on."));
    var row = el("div", "sb-sockets");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Cuff slots");
    for (var i = 0; i < data.rules.cuffSlots; i++) {
      var id = state.set.cuffs[i] || 0;
      var target = { kind: "cuff", index: Math.min(i, state.set.cuffs.length) };
      var d = id ? data.items[id] : null;
      var b = editButton("sb-socket sb-cuff " + (id ? "is-filled" : "is-empty"), id ? null : "+ Cuff", "cuff|" + i, target,
                         "Cuff " + (i + 1) + ": " + (d ? d.name + ". Change or remove it" : "empty, choose a cuff"));
      if (d) {
        b.appendChild(icon(itemIcon(id), "sb-socket-icon"));
        b.appendChild(el("span", "sb-socket-name", d.name));
        b.title = d.name + " · " + skillText(d.skills);
      }
      row.appendChild(b);
    }
    c.box.appendChild(row);
    return c.box;
  }

  function hunterCard() {
    var box = el("section", "sb-card sb-hunter");
    box.setAttribute("aria-label", "Hunter");
    box.appendChild(el("div", "sb-card-kind", "Hunter"));
    var chips = el("div", "sb-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Gender (some pieces are made for one)");
    [["", "Any"], ["male", "Male"], ["female", "Female"]].forEach(function (g) {
      chips.appendChild(chip(g[1], state.gender === g[0], "filter|gender|" + (g[0] || "any"), function () {
        state.gender = g[0];
        render();
      }));
    });
    box.appendChild(chips);
    var label = el("label", "bui-check sb-check");
    var check = el("input");
    check.type = "checkbox";
    check.checked = state.obtainable;
    check.setAttribute("data-focus", "filter|obtainable");
    check.addEventListener("change", function () { state.obtainable = check.checked; render(); });
    label.appendChild(check);
    label.appendChild(document.createTextNode("Only what players can get"));
    box.appendChild(label);
    return box;
  }

  function chip(text, pressed, focusKey, onClick) {
    var b = el("button", "chip sb-chip", text);
    b.type = "button";
    b.setAttribute("aria-pressed", pressed ? "true" : "false");
    if (focusKey) b.setAttribute("data-focus", focusKey);
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- the list (centre) ----------------------------------------------------------------------------------

  /** What the centre list shows for the current edit: {kind, title, rows, current, clear, columns, ...}. */
  function listModel(result) {
    var t = state.edit;
    var cls = state.set.weapon[0];
    var type = typeOf(cls);
    if (t.kind === "class" || (t.kind === "weapon" && cls < 0)) return { kind: "class", title: "Weapon class" };
    if (t.kind === "weapon") {
      if (!data.weapons[cls]) return { kind: "loading", title: type.name };
      return { kind: "weapon", title: type.name + " weapons", rows: weaponRows(cls), current: state.set.weapon[1],
               clear: state.set.weapon[1] ? "Any " + type.name : "", what: "weapon" };
    }
    if (t.kind === "piece") {
      if (!data.pieces[t.slot]) return { kind: "loading", title: SLOT_NAMES[t.slot] };
      var id = state.set.armour[slotIndex(t.slot)][1];
      return { kind: "piece", title: SLOT_NAMES[t.slot] + " pieces", rows: pieceRows(t.slot), current: id,
               clear: id ? "Leave the slot empty" : "", what: SLOT_NAMES[t.slot].toLowerCase() + " piece" };
    }
    if (t.kind === "deco") {
      var h = holderOf(state.set, t.where, result);
      if (!h) return { kind: "none", title: "Decorations", text: "Pick the " + (t.where === "weapon" ? "weapon" : SLOT_NAMES[t.where].toLowerCase() + " piece") + " first." };
      var cur = h.list[t.index] || 0;
      var used = 0;
      h.list.forEach(function (d) { used += itemSize(d, h.tower); });
      var room = h.capacity - used + (cur ? itemSize(cur, h.tower) : 0);
      var holder = t.where === "weapon" ? (result.weapon ? result.weapon.name : "Weapon") : SLOT_NAMES[t.where];
      if (room <= 0 && !cur) return { kind: "none", title: "Decorations for " + holder, text: "No free slots left." };
      return { kind: "deco", title: (h.tower ? "Sigils and Road gems for " : "Decorations for ") + holder + ", slot " + (Math.min(t.index, h.list.length) + 1),
               rows: decoRows(Math.max(1, room), h.tower), current: cur, clear: cur ? "Empty this slot" : "", what: "decoration",
               sub: h.tower ? "A Tower weapon's places take one sigil or gem each." : room + " slot" + (room === 1 ? "" : "s") + " free here" };
    }
    var curCuff = state.set.cuffs[t.index] || 0;
    return { kind: "cuff", title: "Skill cuffs, slot " + (t.index + 1), rows: cuffRows(), current: curCuff,
             clear: curCuff ? "Take the cuff off" : "", what: "cuff" };
  }

  function columnsFor(kind, match) {
    var cols = [{ key: "name", label: "Name", sort: function (r) { return r.name; } }];
    if (kind === "piece" || kind === "weapon") {
      cols.push({ key: "rarity", label: "R", title: "Rarity", num: true, sort: function (r) { return r.rarity; }, cell: function (r) { return String(r.rarity); } });
      cols.push({ key: "def", label: "Def", title: kind === "piece" ? "Defence at the highest level" : "Defence bonus", num: true,
                  sort: function (r) { return r.def; }, cell: function (r) { return String(r.def || 0); } });
      cols.push({ key: "slots", label: "Slots", title: kind === "piece" ? "Decoration slots at the highest level" : "Slots (sigil places on a Tower weapon)",
                  num: true, sort: function (r) { return r.slots; }, cell: function (r) { return slotDots(r.slots); } });
    }
    if (kind === "deco") {
      cols.push({ key: "size", label: "Size", num: true, sort: function (r) { return r.size; }, cell: function (r) { return slotDots(r.size); } });
    }
    if (match) {
      cols.push({ key: "pts", label: match.name, title: match.name + " points", num: true, sort: function (r) { return pointsIn(r, match.id); },
                  cell: function (r) { return signed(pointsIn(r, match.id)); } });
    }
    if (kind !== "weapon") cols.push({ key: "skills", label: "Skills", cell: skillCell });
    else cols.push({ key: "notes", label: "Notes", cell: function (r) { return r.note || ""; } });
    if (mine && mine.loaded()) cols.push({ key: "own", label: "Yours", cell: ownedCell, sort: function (r) { return r.owned ? 1 : 0; } });
    return cols;
  }

  function slotDots(n) {
    var s = el("span", "sb-dots");
    s.setAttribute("aria-label", slotWord(n || 0));
    s.textContent = n ? new Array(n + 1).join("●") : "–";
    return s;
  }

  function pointsIn(row, tree) {
    var p = 0;
    (row.skills || []).forEach(function (s) { if (s[0] === tree) p += s[1]; });
    return p;
  }

  function skillCell(r) {
    var box = el("span", "sb-row-skills");
    (r.skills || []).forEach(function (s) {
      box.appendChild(el("span", "sb-pt" + (s[1] < 0 ? " is-neg" : ""), treeName(s[0]) + " " + signed(s[1])));
    });
    if (r.note) box.appendChild(el("span", "sb-pt is-note", r.note));
    return box;
  }

  function ownedCell(r) {
    if (!r.owned) return "";
    var mineText = /^you have none/.test(r.owned) ? "" : r.owned;
    return mineText ? el("span", "badge sb-badge-own", mineText) : el("span", "sb-none", "none");
  }

  /** A skill tree whose name is the whole search: the list then shows only rows with its points, best first. */
  function treeMatch(q) {
    var want = q.trim().toLowerCase();
    if (!want) return null;
    for (var i = 0; i < data.rules.trees.length; i++) {
      var t = data.rules.trees[i];
      if (t.name.toLowerCase() === want) return t;
    }
    return null;
  }

  function filteredRows(model) {
    var q = state.list.q.trim().toLowerCase();
    var match = treeMatch(q);
    var rows = model.rows;
    if (match) rows = rows.filter(function (r) { return pointsIn(r, match.id) !== 0; });
    else if (q) {
      var words = q.split(/\s+/);
      rows = rows.filter(function (r) { return words.every(function (w) { return r.text.indexOf(w) !== -1; }); });
    }
    if (state.list.slotted) rows = rows.filter(function (r) { return (r.slots || r.size || 0) > 0; });
    var cols = columnsFor(model.kind, match);
    var key = state.list.sort || (match ? "pts" : model.kind === "piece" ? "def" : model.kind === "weapon" ? "rarity" : "name");
    var col = cols.filter(function (c) { return c.key === key && c.sort; })[0] || cols[0];
    var dir = state.list.dir || (col.key === "name" ? 1 : -1);
    rows = rows.slice().sort(function (a, b) {
      var x = col.sort(a), y = col.sort(b);
      var d = typeof x === "string" ? x.localeCompare(y) : x - y;
      return d * dir || a.name.localeCompare(b.name);
    });
    return { rows: rows, cols: cols, sortKey: col.key, dir: dir, match: match };
  }

  function renderList(result) {
    var model = listModel(result);
    listBox.textContent = "";
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, model.title));
    var count = el("span", "panel-note");
    count.id = "sb-list-count";
    head.appendChild(count);
    listBox.appendChild(head);
    listBox.setAttribute("data-kind", model.kind);
    if (model.kind === "class") { listBox.appendChild(classTiles()); return; }
    if (model.kind === "loading") { listBox.appendChild(UI.note("Loading the list.")); return; }
    if (model.kind === "none") { listBox.appendChild(UI.note(model.text)); return; }

    var bar = el("div", "sb-list-bar");
    var search = el("input", "sb-search");
    search.type = "search";
    search.placeholder = model.kind === "weapon" ? "Search weapons" : "Search by name or skill (a skill name sorts by its points)";
    search.setAttribute("aria-label", "Search the " + model.what + " list");
    search.setAttribute("data-focus", "list|q");
    search.value = state.list.q;
    search.addEventListener("input", function () {
      // a skill tree's name as the search sorts by its points, whatever sort was picked before
      if (treeMatch(search.value) !== treeMatch(state.list.q)) { state.list.sort = ""; state.list.dir = 0; }
      state.list.q = search.value;
      state.list.limit = PAGE;
      renderRows(model);
    });
    search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var first = listBox.querySelector(".sb-pick");
        if (first) first.click();
      } else if (e.key === "ArrowDown") {
        var row = listBox.querySelector(".sb-pick");
        if (row) { e.preventDefault(); row.focus(); }
      }
    });
    bar.appendChild(search);
    if (model.kind === "piece" || model.kind === "weapon") {
      bar.appendChild(chip("Has slots", state.list.slotted, "list|slotted", function () {
        state.list.slotted = !state.list.slotted;
        state.list.limit = PAGE;
        render();
      }));
    }
    if (model.kind === "weapon") {
      var other = el("button", "ghost-btn small", "Change class");
      other.type = "button";
      other.setAttribute("data-focus", "list|classes");
      other.addEventListener("click", function () { edit({ kind: "class" }); });
      bar.appendChild(other);
    }
    if (model.clear) {
      var clear = el("button", "ghost-btn small sb-clear", model.clear);
      clear.type = "button";
      clear.id = "sb-list-clear";
      clear.setAttribute("data-focus", "list|clear");
      clear.addEventListener("click", function () { choose(0); });
      bar.appendChild(clear);
    }
    listBox.appendChild(bar);
    if (model.sub) listBox.appendChild(el("p", "note-text sb-list-sub", model.sub));
    var preview = el("div", "sb-preview");
    preview.id = "sb-preview";
    preview.setAttribute("aria-live", "polite");
    listBox.appendChild(preview);
    var rowsBox = el("div", "sb-rows");
    rowsBox.id = "sb-rows";
    listBox.appendChild(rowsBox);
    renderRows(model);
    showPreview(null);
  }

  function renderRows(model) {
    var box = document.getElementById("sb-rows");
    var f = filteredRows(model);
    var countNode = document.getElementById("sb-list-count");
    countNode.textContent = f.rows.length.toLocaleString("en-US") + (f.rows.length === 1 ? " match" : " match");
    box.textContent = "";
    if (!f.rows.length) {
      box.appendChild(UI.note(mine && mine.filtering() ? "Nothing here that you own matches." : "Nothing matches."));
      return;
    }
    // not .table-wrap: js/tablesort.js's swipe hint would go in and out as the phone layout reflows
    var wrap = el("div", "sb-table-wrap");
    var table = el("table", "data-table sb-table");
    table.setAttribute("data-nosort", "");
    var thead = el("thead");
    var tr = el("tr");
    f.cols.forEach(function (c) {
      var th = el("th", c.num ? "num" : null);
      if (c.sort) {
        var b = el("button", "sb-sort", c.label);
        b.type = "button";
        b.setAttribute("data-focus", "list|sort|" + c.key);
        if (c.title) b.title = "Sort by " + c.title.toLowerCase();
        th.setAttribute("aria-sort", f.sortKey === c.key ? (f.dir > 0 ? "ascending" : "descending") : "none");
        b.addEventListener("click", function () {
          if (f.sortKey === c.key) state.list.dir = -f.dir;
          else { state.list.sort = c.key; state.list.dir = c.key === "name" ? 1 : -1; }
          state.list.sort = c.key;
          renderRows(model);
          var again = box.querySelector('[data-focus="list|sort|' + c.key + '"]');
          if (again) again.focus();
        });
        th.appendChild(b);
      } else {
        th.textContent = c.label;
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el("tbody");
    f.rows.slice(0, state.list.limit).forEach(function (r) {
      var row = el("tr", r.id === model.current ? "is-current" : null);
      row.setAttribute("data-id", String(r.id));
      f.cols.forEach(function (c, i) {
        var td = el("td", c.num ? "num" : "sb-col-" + c.key);
        if (i === 0) {
          var b = el("button", "sb-pick");
          b.type = "button";
          b.setAttribute("data-id", String(r.id));
          b.setAttribute("data-focus", "list|row|" + r.id);
          if (r.id === model.current) b.setAttribute("aria-current", "true");
          b.appendChild(icon(r.icon, "sb-row-icon"));
          b.appendChild(el("span", "sb-row-name", r.name));
          td.appendChild(b);
          if (r.kind) td.appendChild(el("span", "badge sb-kind", r.kind));
          if (!r.obtainable) td.appendChild(el("span", "badge sb-badge-bad", "not obtainable"));
        } else {
          var v = c.cell(r);
          if (v instanceof Node) td.appendChild(v); else td.textContent = v;
        }
        if (c.label) td.setAttribute("data-label", c.label);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    tbody.addEventListener("click", function (e) {
      var b = e.target.closest(".sb-pick");
      if (b) choose(Number(b.getAttribute("data-id")));
    });
    tbody.addEventListener("mouseover", function (e) {
      var row = e.target.closest("tr[data-id]");
      if (row) showPreview(Number(row.getAttribute("data-id")));
    });
    tbody.addEventListener("focusin", function (e) {
      var row = e.target.closest("tr[data-id]");
      if (row) showPreview(Number(row.getAttribute("data-id")));
    });
    tbody.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      var picks = Array.prototype.slice.call(tbody.querySelectorAll(".sb-pick"));
      var at = picks.indexOf(document.activeElement);
      if (at === -1) return;
      e.preventDefault();
      var next = picks[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) next.focus();
      else if (e.key === "ArrowUp") { var s = listBox.querySelector(".sb-search"); if (s) s.focus(); }
    });
    table.addEventListener("mouseleave", function () { showPreview(null); });
    wrap.appendChild(table);
    box.appendChild(wrap);
    if (f.rows.length > state.list.limit) {
      var more = el("button", "ghost-btn small sb-more", "Show " + Math.min(PAGE, f.rows.length - state.list.limit) + " more of " +
        (f.rows.length - state.list.limit).toLocaleString("en-US"));
      more.type = "button";
      more.setAttribute("data-focus", "list|more");
      more.addEventListener("click", function () {
        state.list.limit += PAGE;
        renderRows(model);
        var next = box.querySelectorAll(".sb-pick")[state.list.limit - PAGE];
        if (next) next.focus();
      });
      box.appendChild(more);
    }
  }

  /** Weapon classes as tiles with their icons. */
  function classTiles() {
    var grid = el("div", "sb-classes");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Weapon classes");
    data.types.forEach(function (t) {
      var b = el("button", "sb-class");
      b.type = "button";
      b.setAttribute("data-focus", "list|class|" + t.class);
      b.setAttribute("aria-pressed", state.set.weapon[0] === t.class ? "true" : "false");
      b.appendChild(icon(weaponIcon(t.class, null), "sb-class-icon"));
      b.appendChild(el("span", "sb-class-name", t.name));
      b.appendChild(el("span", "sb-class-kind", kindLabel(t.class) + (mine && mine.loaded() ? " · yours: " + mine.weaponCount(t.class) : "")));
      b.addEventListener("click", function () { choose(t.class); });
      grid.appendChild(b);
    });
    return grid;
  }

  // ---- compare a row with what you have -----------------------------------------------------------------

  function showPreview(id) {
    var box = document.getElementById("sb-preview");
    if (!box) return;
    if (id === state.preview && box.firstChild) return;
    state.preview = id;
    box.textContent = "";
    if (id === null || id === undefined) {
      box.appendChild(el("p", "sb-preview-hint", "Point at a row (or tab to it) to see what it changes."));
      return;
    }
    var model = listModel(current);
    var row = (model.rows || []).filter(function (r) { return r.id === id; })[0];
    if (!row || id === model.current) {
      box.appendChild(el("p", "sb-preview-hint", row ? row.name + " is what you have now." : ""));
      return;
    }
    var after = compute(applyChoice(cloneSet(state.set), state.edit, id));
    box.appendChild(el("p", "sb-preview-title", "With " + row.name + ":"));
    box.appendChild(deltaNode(current, after));
  }

  /** Chips for what changes between two computed sets: defence, skills gained and lost, points per tree. */
  function deltaNode(before, after) {
    var box = el("div", "sb-delta");
    function add(text, cls) { box.appendChild(el("span", "sb-d " + cls, text)); }
    var dd = after.defence.total - before.defence.total;
    if (dd) add("Def " + signed(dd), dd > 0 ? "is-up" : "is-down");
    function on(r) {
      var out = {};
      r.active.forEach(function (s) { if (!s.dropped && s.works && !s.negative) out[s.skill] = s.name; });
      return out;
    }
    function bad(r) {
      var out = {};
      r.active.forEach(function (s) { if (!s.dropped && s.negative) out[s.skill] = s.name; });
      return out;
    }
    var a = on(before), b = on(after), na = bad(before), nb = bad(after);
    Object.keys(b).forEach(function (k) { if (!a[k]) add("+ " + b[k], "is-up"); });
    Object.keys(a).forEach(function (k) { if (!b[k]) add("− " + a[k], "is-down"); });
    Object.keys(nb).forEach(function (k) { if (!na[k]) add("+ " + nb[k], "is-down"); });
    Object.keys(na).forEach(function (k) { if (!nb[k]) add("− " + na[k], "is-up"); });
    var tot = {};
    before.trees.forEach(function (t) { tot[t.tree] = [t.total, 0, t.name]; });
    after.trees.forEach(function (t) { (tot[t.tree] || (tot[t.tree] = [0, 0, t.name]))[1] = t.total; });
    Object.keys(tot).map(function (k) { return tot[k]; }).filter(function (v) { return v[0] !== v[1]; })
      .sort(function (x, y) { return Math.abs(y[1] - y[0]) - Math.abs(x[1] - x[0]); }).slice(0, 8)
      .forEach(function (v) { add(v[2] + " " + signed(v[1] - v[0]) + " (" + v[1] + ")", "is-pts" + (v[1] > v[0] ? " is-up" : " is-down")); });
    if (!box.firstChild) add("No change to skills or defence", "is-pts");
    return box;
  }

  // ---- the skills panel (right) -----------------------------------------------------------------------------

  function summaryView(result) {
    var frag = document.createDocumentFragment();

    var stats = UI.section("Defence and resistances", "armour and weapon");
    var dl = el("dl", "sb-stats");
    function stat(name, value, title, cls) {
      var pair = el("div", "sb-stat" + (cls ? " " + cls : ""));
      var dd = el("dd", null, value);
      if (title) dd.title = title;
      pair.appendChild(el("dt", null, name));
      pair.appendChild(dd);
      dl.appendChild(pair);
    }
    stat("Defence", String(result.defence.total), "Armour " + result.defence.pieces + ", weapon " + result.defence.weapon, "is-def");
    RES_ORDER.forEach(function (r) { stat(RES_NAMES[r], signed(result.res[r]), null, "is-" + r + (result.res[r] < 0 ? " is-neg" : "")); });
    dl.setAttribute("data-defence", result.defence.total);
    stats.appendChild(dl);
    stats.appendChild(UI.note("Skills such as Defense+ or Fire Res+ are not added here."));
    frag.appendChild(stats);

    var lim = result.limit;
    var skills = UI.section("Active skills", lim.count + " of " + lim.limit);
    skills.id = "sb-active";
    skills.setAttribute("data-limit", lim.limit);
    skills.appendChild(limitMeter(lim, result));
    if (!result.active.length) skills.appendChild(UI.note("No skills yet: pick armour and decorations."));
    var groups = [["points", false, null], ["automatic", false, "Automatic skills (outside the limit)"],
                  ["tower", false, "Road gem skills (outside the limit)"], ["points", true, "Over the limit: not active"]];
    groups.forEach(function (g) {
      var items = result.active.filter(function (s) { return s.from === g[0] && s.dropped === g[1]; });
      if (!items.length) return;
      if (g[2]) skills.appendChild(el("h3", "sb-group", g[2]));
      var ul = el("ul", "sb-active-list");
      items.forEach(function (s) { ul.appendChild(skillItem(s)); });
      skills.appendChild(ul);
    });
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
        var li = el("li", "sb-skill" + (z.lit ? " is-lit" : " is-idle"));
        li.setAttribute("data-zenith", z.id);
        li.setAttribute("data-lit", z.lit ? "1" : "0");
        li.appendChild(el("span", "sb-mark", z.lit ? "✦" : "✧"));
        li.appendChild(el("span", "sb-skill-name", z.name));
        if (z.needs) li.appendChild(el("span", "sb-skill-meta", "needs a " + z.needs + " skill"));
        if (!z.lit) li.appendChild(el("span", "sb-skill-warn", "not lit: no effect"));
        zl.appendChild(li);
      });
      zen.appendChild(zl);
      frag.appendChild(zen);
    }

    frag.appendChild(treesPanel(result));

    if (result.problems.length) {
      var prob = UI.section("Problems with this set");
      var pl = el("ul", "sb-problems");
      result.problems.forEach(function (x) { pl.appendChild(el("li", null, x)); });
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
        state.set.data = data.index.version;
        state.edit = { kind: "class" };
        changed();
        return;
      }
      reset.classList.add("is-armed");
      reset.textContent = "Click again to clear";
    });
    reset.setAttribute("data-focus", "summary|reset");
    actions.appendChild(copy);
    actions.appendChild(reset);
    share.appendChild(actions);
    share.appendChild(UI.note("The link holds the whole set; nothing is saved on our server."));
    frag.appendChild(share);
    return frag;
  }

  /** The skill limit as boxes: used, free, and the skills that fell off past it. */
  function limitMeter(lim, result) {
    var dropped = result.active.filter(function (s) { return s.dropped; }).length;
    var box = el("div", "sb-meter");
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", lim.count + " of " + lim.limit + " skill slots used" + (dropped ? ", " + dropped + " over the limit" : ""));
    for (var i = 0; i < lim.limit + dropped; i++) {
      box.appendChild(el("span", "sb-meter-box" + (i < lim.count ? " is-used" : i >= lim.limit ? " is-over" : "")));
    }
    return box;
  }

  function skillItem(s) {
    var li = el("li", "sb-skill" + (s.negative ? " is-negative" : "") + (s.works ? "" : " is-idle") + (s.dropped ? " is-dropped" : ""));
    li.setAttribute("data-skill", s.skill);
    li.setAttribute("data-from", s.from);
    li.appendChild(el("span", "sb-mark", s.dropped ? "✕" : !s.works ? "–" : s.negative ? "▼" : "▲"));
    var name = s.tree ? el("a", "sb-skill-name", s.name) : el("span", "sb-skill-name", s.name);
    if (s.tree) name.href = "/skill.html?id=" + s.tree;
    li.appendChild(name);
    var meta = s.from === "automatic" ? "automatic, from " + s.source
      : s.from === "tower" ? "Road gem skill of " + s.source
      : s.treeName + " " + signed(s.total);
    li.appendChild(el("span", "sb-skill-meta", meta));
    if (!s.works) {
      var type = typeOf(state.set.weapon[0]);
      li.appendChild(el("span", "sb-skill-warn", "no effect with " + (type ? type.name : "this weapon")));
    }
    if (s.dropped) li.appendChild(el("span", "sb-skill-warn", "over the limit: not active"));
    return li;
  }

  /** The positive thresholds of a tree, [[points, skill]] without repeats (levels 3-7; all levels for the
      all-positive tree). */
  function thresholds(tree) {
    var out = [];
    var from = tree.id === data.rules.rules.all_positive_tree ? 0 : 3;
    tree.levels.slice(from).forEach(function (l) {
      if (l[1] && !out.some(function (o) { return o[1] === l[1]; })) out.push(l);
    });
    return out.sort(function (a, b) { return a[0] - b[0]; });
  }

  function treesPanel(result) {
    var box = UI.section("Skill points", state.allTrees ? "every skill tree" : "per skill tree");
    box.id = "sb-trees";
    var actions = el("div", "sb-trees-bar");
    var all = chip(state.allTrees ? "Only trees with points" : "All skill trees", false, "summary|alltrees", function () {
      state.allTrees = !state.allTrees;
      render();
    });
    actions.appendChild(all);
    box.appendChild(actions);
    var byTree = {};
    result.trees.forEach(function (t) { byTree[t.tree] = t; });
    var activeBy = {};
    result.active.forEach(function (s) { if (s.from === "points") activeBy[s.tree] = s; });
    var trees = result.trees.slice();
    if (state.allTrees) {
      data.rules.trees.forEach(function (t) {
        if (!byTree[t.id] && /[A-Za-z]/.test(t.name) && thresholds(t).length) trees.push({ tree: t.id, name: t.name, total: 0, parts: [] });
      });
    }
    if (!trees.length) { box.appendChild(UI.note("No skill points yet.")); return box; }
    var ul = el("ul", "sb-trees");
    trees.forEach(function (t) { ul.appendChild(treeRow(t, activeBy[t.tree])); });
    box.appendChild(ul);
    return box;
  }

  /** One tree: name, points, a bar from 0 (or its first negative threshold) to its next threshold with a tick for
      each threshold, and what it reaches or how many points the next level needs. */
  function treeRow(t, active) {
    var tree = data.rules.tree(t.tree);
    var li = el("li", "sb-tree" + (active ? (active.dropped ? " is-dropped" : active.works ? "" : " is-idle") + (active.negative ? " is-negative" : " is-active") : ""));
    li.setAttribute("data-tree", t.tree);
    var top = el("div", "sb-tree-top");
    var name = el("a", "sb-tree-name", t.name);
    name.href = "/skill.html?id=" + t.tree;
    top.appendChild(name);
    top.appendChild(el("span", "sb-tree-pts", signed(t.total)));
    li.appendChild(top);
    var pos = thresholds(tree);
    var neg = tree.id === data.rules.rules.all_positive_tree ? [] : tree.levels.slice(0, 3).filter(function (l) { return l[1]; });
    var next = pos.filter(function (l) { return l[0] > t.total; })[0];
    var hi = Math.max(t.total, next ? next[0] : pos.length ? pos[pos.length - 1][0] : 10, 1);
    var lo = Math.min(0, t.total, neg.length ? Math.max.apply(null, neg.map(function (l) { return l[0]; })) : 0);
    var span = hi - lo || 1;
    var at = function (v) { return ((v - lo) / span * 100).toFixed(1) + "%"; };
    var bar = el("div", "sb-bar");
    bar.setAttribute("aria-hidden", "true");
    var fill = el("span", "sb-bar-fill" + (t.total < 0 ? " is-neg" : ""));
    var a = Math.min(0, t.total), b = Math.max(0, t.total);
    fill.style.left = at(a);
    fill.style.width = ((b - a) / span * 100).toFixed(1) + "%";
    bar.appendChild(fill);
    pos.concat(neg).forEach(function (l) {
      if (l[0] < lo || l[0] > hi) return;
      var tick = el("span", "sb-tick" + (l[0] < 0 ? " is-neg" : "") + ((l[0] > 0 ? t.total >= l[0] : t.total <= l[0]) ? " is-hit" : ""));
      tick.style.left = at(l[0]);
      tick.title = data.rules.skillName(l[1]) + " at " + signed(l[0]);
      bar.appendChild(tick);
    });
    li.appendChild(bar);
    var reached = t.skill ? t.skill.name : "";
    var text = reached ? reached : "";
    if (next && t.total >= 0) text += (text ? " · " : "") + (next[0] - t.total) + " more for " + data.rules.skillName(next[1]);
    var info = el("div", "sb-tree-info", text || "–");
    if (active && active.dropped) info.appendChild(el("span", "sb-skill-warn", " over the limit"));
    else if (active && !active.works) info.appendChild(el("span", "sb-skill-warn", " no effect with this weapon"));
    li.appendChild(info);
    if (t.parts && t.parts.length) li.title = t.parts.map(function (p) { return p.from + " " + signed(p.points); }).join(", ");
    return li;
  }

  // ---- posting to Community sets ------------------------------------------------------------------------

  /** The skill ids the calculator says are active and do something: what the community list filters on. */
  function activeSkillIds() {
    var seen = {};
    var ids = [];
    compute(state.set).active.forEach(function (s) {
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
          var editId = post.editId;
          return Api.request("/api/account/armor-sets" + (editId ? "/" + editId : ""),
                             { method: editId ? "PUT" : "POST", body: body, auth: true }).then(function (saved) {
            post.done = { id: saved.id, edited: !!editId };
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

  // ---- tabs and render --------------------------------------------------------------------------------------

  function setView(view) {
    state.view = view;
    app.setAttribute("data-view", view);
    Array.prototype.forEach.call(document.querySelectorAll(".sb-tab"), function (tab) {
      var on = tab.getAttribute("data-view") === view || (view === "skills" && wide() && tab.getAttribute("data-view") === "equip");
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    if (view === "find" && find) find.render();
  }

  function setupTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".sb-tab"));
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () { setView(tab.getAttribute("data-view")); });
      tab.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
        var shown = tabs.filter(function (t) { return t.offsetParent !== null; });
        var at = shown.indexOf(tab);
        var next = e.key === "Home" ? shown[0] : e.key === "End" ? shown[shown.length - 1]
          : shown[(at + (e.key === "ArrowRight" ? 1 : shown.length - 1)) % shown.length];
        e.preventDefault();
        next.focus();
        setView(next.getAttribute("data-view"));
      });
    });
    window.matchMedia("(min-width: 1200px)").addEventListener("change", function () { setView(state.view); });
  }

  function rememberFocus() {
    var a = document.activeElement;
    var key = a && a.getAttribute && a.getAttribute("data-focus");
    if (!key) return null;
    var sel = null;
    try { if (typeof a.selectionStart === "number") sel = [a.selectionStart, a.selectionEnd]; } catch (e) { sel = null; }
    return { key: key, sel: sel };
  }

  function restoreFocus(f) {
    if (!f) return;
    var again = document.querySelector('[data-focus="' + f.key + '"]');
    if (!again || again.disabled) return;
    again.focus({ preventScroll: true });
    if (f.sel && again.setSelectionRange) try { again.setSelectionRange(f.sel[0], f.sel[1]); } catch (e) { /* not a text input */ }
  }

  function render() {
    var focus = rememberFocus();
    var result = compute(state.set);
    current = result;
    mineBox.textContent = "";
    if (mine) mineBox.appendChild(mine.panel());
    editor.textContent = "";
    editor.appendChild(weaponCard(result));
    state.set.armour.forEach(function (_a, i) { editor.appendChild(slotCard(i, result)); });
    editor.appendChild(cuffCard());
    editor.appendChild(hunterCard());
    renderList(result);
    summary.textContent = "";
    summary.appendChild(summaryView(result));
    if (mine) mine.renderMissing(missingBox);
    if (find && state.view === "find") find.render();
    restoreFocus(focus);
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

  /** The first thing to edit for a set: the weapon class when there is none, else its first armour piece (whose
      list the set already loaded), else the weapon. Never loads a slot's list by itself. */
  function firstEdit(set) {
    if (set.weapon[0] < 0) return { kind: "class" };
    for (var i = 0; i < set.armour.length; i++) {
      if (set.armour[i][1] && data.pieces[set.armour[i][0]]) return { kind: "piece", slot: set.armour[i][0] };
    }
    return { kind: "weapon" };
  }

  function loadHash() {
    var set = fromHash() || Calc.empty();
    state.set = set;
    var editId = editFromHash();
    var editChanged = editId !== post.editId;
    post.editId = editId;
    return loadForSet(set).then(function () {
      if (set.data && data.index && set.data !== data.index.version) {
        showStatus("This set was made with the game data of " + set.data + "; the page now uses " +
          data.index.version + ", so numbers may differ.");
      }
      set.data = data.index.version;
      state.edit = firstEdit(set);
      state.list = freshList();
      render();
      if (editChanged || !postBox.firstChild) {
        post.done = null;
        post.open = false;
        post.form = null;
        resolveEdit();
      }
    });
  }

  /** Replaces the set shown (a loaded character set or a Find sets result) and goes back to the cards. */
  function loadSet(set, note) {
    state.set = Calc.normalize(set);
    state.set.data = data.index.version;
    return loadForSet(state.set).then(function () {
      state.edit = firstEdit(state.set);
      state.list = freshList();
      if (note) showStatus(note);
      changed();
    }, function () { showStatus("Could not load the set's data. Try again."); });
  }

  function start() {
    setupTabs();
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
        setGender: function (g) { state.gender = g; if (find) find.characterChanged(); },
        render: render,
        maxLevelOf: function (slot, id) { var p = ctx().piece(slot, id); return p ? p.maxLevel : 0; },
        loadSet: function (set) { loadSet(set); }
      });
      find = window.SetBuilderFind.create({
        box: findBox, data: data, mine: mine, getSet: function () { return state.set; },
        gender: function () { return state.gender; },
        loadForSet: loadForSet, compute: compute, typeOf: typeOf, weaponIcon: weaponIcon, pieceIcon: pieceIcon,
        itemIcon: itemIcon, treeName: treeName, thresholds: thresholds, deltaNode: deltaNode,
        piece: function (slot, id) { return ctx().piece(slot, id); },
        loadSet: function (set, note) { setView("equip"); return loadSet(set, note); }
      });
      setView(state.view);
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
