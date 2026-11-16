/* The Set builder's "my character" part (set-builder.html, docs/armor-set-builder.md "Character import"): for a
   signed-in player, pick one of their characters, load its worn set, town set or a My Set, filter every picker to
   "only what I own", and ask the API what is missing for the set shown.

   Calls (js/community-api.js request(); read-only, the API never writes a save):
     GET  /api/account/characters                      the character select
     GET  /api/account/characters/{id}/builder          the import (pieces, My Sets, item counts, zenny, online)
     POST /api/account/characters/{id}/builder/missing  the set -> pieces with their cheapest path, decorations,
                                                         materials with sources, zenny
   The import's meaning for the builder (sets, owned counts, the request body) is js/armor-owned.js.
   js/set-builder.js creates this with a host object: getSet(), data (the page's data), setGender(g),
   loadSet(set) (replaces the set and redraws), render(), maxLevelOf(slot, id). The panel sits in a strip above the
   builder's tabs, so "Only what I own" filters the Equipment lists and Find sets can use the import too. */
(function () {
  "use strict";

  var CHAR_KEY = "hvmhfz.sb.char";
  var UI = window.BuilderUI;
  var Calc = window.ArmorCalc;
  var Owned = window.ArmorOwned;
  var Api = window.CommunityApi;
  var SLOT_NAMES = { melee: "Weapon", ranged: "Weapon", head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var KIND_NAMES = { decoration: "Decoration", sigil: "Sigil", towerDeco: "Tower Deco", cuff: "Cuff" };

  function el(tag, cls, text) { return UI.el(tag, cls, text); }

  function link(href, text) {
    var a = el("a", null, text);
    a.href = href;
    return a;
  }

  function itemLink(id, name) { return link("/item.html?id=" + id, name || "Item " + id); }

  function num(v) { return Number(v || 0).toLocaleString("en-US"); }

  function create(host) {
    var classOf = Owned.classFinder(host.data.weaponIds);
    var mine = {
      chars: null, charsError: "", charId: 0, imp: null, inv: null, loading: false, error: "", ownedOnly: false,
      loadNote: "", version: 0,
      missing: { code: "", result: null, error: "", loading: false }
    };

    function saved() {
      try { return Number(localStorage.getItem(CHAR_KEY)) || 0; } catch (e) { return 0; }
    }

    function remember(id) {
      try { if (id) localStorage.setItem(CHAR_KEY, String(id)); else localStorage.removeItem(CHAR_KEY); } catch (e) { /* private mode */ }
    }

    function start() {
      if (!Api.signedIn()) return;
      Api.loadCharacters().then(function (list) {
        mine.chars = list;
        var want = saved();
        if (want && list.some(function (c) { return c.id === want; })) pick(want);
        else host.render();
      }, function (error) {
        mine.charsError = error.message;
        host.render();
      });
    }

    /** Loads (or reloads) a character's import. */
    function pick(id) {
      mine.charId = id;
      mine.imp = null;
      mine.inv = null;
      mine.error = "";
      mine.loadNote = "";
      mine.missing = { code: "", result: null, error: "", loading: false };
      remember(id);
      if (!id) { mine.ownedOnly = false; mine.version++; host.render(); return; }
      mine.loading = true;
      host.render();
      Api.request("/api/account/characters/" + id + "/builder", { auth: true }).then(function (imp) {
        if (mine.charId !== id) return;
        mine.imp = imp;
        mine.inv = Owned.inventory(imp, classOf);
        mine.loading = false;
        mine.version++;
        host.setGender(imp.female ? "female" : "male");
        host.render();
      }, function (error) {
        if (mine.charId !== id) return;
        mine.loading = false;
        mine.error = error.status === 404 ? "That character is not on your account (any more)." : error.message;
        host.render();
      });
    }

    function loadSet(which) {
      var imp = mine.imp;
      var res;
      var name;
      if (which === -1) { res = Owned.setFromPieces(imp.hunting, [], classOf); name = "your worn set"; }
      else if (which === -2) { res = Owned.setFromPieces(imp.town, [], classOf); name = "your town set"; }
      else {
        var ms = (imp.mySets || []).filter(function (s) { return s.number === which; })[0];
        if (!ms) return;
        res = Owned.setFromPieces(ms.pieces, ms.cuffs, classOf);
        name = "My Set " + ms.number + " (" + ms.name + ")";
      }
      mine.loadNote = "Loaded " + name + "." + (res.lost ? " " + res.lost + (res.lost === 1 ? " piece of it is" : " pieces of it are") +
        " no longer in your equipment box, so " + (res.lost === 1 ? "its slot is" : "their slots are") + " empty." : "");
      host.loadSet(res.set);
    }

    // ---- the character panel (top of the editor) -------------------------------------------------------

    function panel() {
      var box = UI.section("Your character", mine.imp ? "from the last save" : "");
      box.id = "sb-mine";
      if (!Api.signedIn()) {
        var p = el("p", "note-text");
        var a = link(Api.signinUrl("/set-builder.html" + location.hash), "Sign in");
        a.id = "sb-mine-signin";
        p.appendChild(a);
        p.appendChild(document.createTextNode(" to load your worn set or a My Set, list only the gear you own and see what " +
          "you are missing for a set."));
        box.appendChild(p);
        return box;
      }
      if (mine.charsError) { box.appendChild(alert(mine.charsError)); return box; }
      if (!mine.chars) { box.appendChild(UI.note("Loading your characters.")); return box; }
      if (!mine.chars.length) { box.appendChild(UI.note("This account has no characters yet.")); return box; }

      var grid = el("div", "editor-grid");
      var charOpts = [{ value: 0, label: "No character" }].concat(mine.chars.map(function (c) {
        return { value: c.id, label: c.name, hint: rankText(c.hr, c.gr) + (c.weaponType ? " · " + c.weaponType : "") };
      }));
      var charPicker = UI.picker({ options: charOpts, value: mine.charId, onChange: pick, label: "Character" });
      charPicker.button.setAttribute("data-focus", "mine|char");
      grid.appendChild(UI.field("Character", charPicker));

      if (mine.imp) {
        var imp = mine.imp;
        var loadOpts = [{ value: 0, label: "Pick a set to load" }, { value: -1, label: "Worn set", hint: count(imp.hunting) }];
        if (imp.town && imp.town.length) loadOpts.push({ value: -2, label: "Town set", hint: count(imp.town) });
        (imp.mySets || []).forEach(function (s) {
          loadOpts.push({ value: s.number, label: "My Set " + s.number + ": " + s.name, hint: count(s.pieces) });
        });
        var loadPicker = UI.picker({ options: loadOpts, value: 0, onChange: function (v) { if (v) loadSet(v); }, label: "Load a set" });
        loadPicker.button.setAttribute("data-focus", "mine|load");
        grid.appendChild(UI.field("Load", loadPicker, "Replaces the set shown."));

        var wrap = el("div", "bui-flags");
        var label = el("label", "bui-check");
        var check = el("input");
        check.type = "checkbox";
        check.checked = mine.ownedOnly;
        check.setAttribute("data-focus", "mine|owned");
        check.id = "sb-owned-only";
        check.addEventListener("change", function () { mine.ownedOnly = check.checked; mine.version++; host.render(); });
        label.appendChild(check);
        label.appendChild(document.createTextNode("Only what I own"));
        wrap.appendChild(label);
        grid.appendChild(UI.field("Lists", wrap, "Pieces at the level you have; decorations, sigils and cuffs from your boxes and gear."));
      }
      box.appendChild(grid);

      if (mine.loading) box.appendChild(UI.note("Loading the character's gear."));
      if (mine.error) box.appendChild(alert(mine.error));
      if (mine.imp) {
        var facts = el("p", "note-text sb-mine-facts");
        facts.appendChild(document.createTextNode(mine.imp.name + " · " + rankText(mine.imp.hr, mine.imp.gr) + " · " +
          num(mine.imp.zenny) + " zenny · " + (mine.imp.owned || []).length + " pieces in the equipment box. From the last save. "));
        var refresh = UI.button("Refresh", function () { pick(mine.charId); });
        refresh.id = "sb-mine-refresh";
        facts.appendChild(refresh);
        box.appendChild(facts);
        if (!mine.imp.hasSave) box.appendChild(alert("This character has no save on the server yet: nothing is owned."));
        if (mine.imp.online) {
          var on = alert("You are in game: changes since your last save are not shown yet.");
          on.id = "sb-mine-online";
          box.appendChild(on);
        }
        if (mine.imp.mySetsNotDecoded) box.appendChild(UI.note("My Sets: " + mine.imp.mySetsNotDecoded));
      }
      if (mine.loadNote) {
        var ln = el("p", "road-ok", mine.loadNote);
        ln.id = "sb-mine-loaded";
        ln.setAttribute("role", "status");
        box.appendChild(ln);
      }
      return box;
    }

    function alert(text) {
      var p = el("p", "form-alert", text);
      p.setAttribute("role", "alert");
      return p;
    }

    function count(pieces) {
      var n = (pieces || []).filter(function (p) { return p[1]; }).length;
      return n === 1 ? "1 piece" : n + " pieces";
    }

    function rankText(hr, gr) {
      return gr ? "GR " + gr : hr ? "HR " + hr : "no rank yet";
    }

    // ---- filters for js/set-builder.js's pickers ---------------------------------------------------------

    function filtering() { return mine.ownedOnly && !!mine.inv; }

    /** The highest level of the piece the character owns, 0 when not owned (or no character loaded). */
    function ownedLevel(slot, id) { return mine.inv && mine.inv.pieces[slot] ? mine.inv.pieces[slot][id] || 0 : 0; }

    function ownsWeapon(cls, id) { return !!(mine.inv && mine.inv.weapons[cls] && mine.inv.weapons[cls][id]); }

    function weaponCount(cls) { return mine.inv && mine.inv.weapons[cls] ? Object.keys(mine.inv.weapons[cls]).length : 0; }

    function ownsItem(id) { return Owned.ownsItem(mine.inv, id); }

    /** "yours: 3 in boxes · 1 set in gear" for a decoration, sigil or cuff option; "" when nothing is loaded. */
    function itemHint(id) {
      if (!mine.inv) return "";
      var it = mine.inv.items[id];
      if (!it || (!it.have && !it.inEquipment)) return "you have none";
      return "yours: " + it.have + " in boxes" + (it.inEquipment ? " · " + it.inEquipment + " set in gear" : "");
    }

    // ---- what is missing ---------------------------------------------------------------------------------

    function checkMissing() {
      var set = Calc.normalize(host.getSet());
      var body = Owned.missingBody(set, host.data.index.source && host.data.index.source.mhfdatSha256, host.maxLevelOf);
      var code = Calc.encode(set);
      if (!body) {
        mine.missing = { code: code, result: null, error: "Pick a weapon, some armour or a cuff first.", loading: false };
        host.render();
        return;
      }
      var id = mine.charId;
      mine.missing = { code: code, result: null, error: "", loading: true };
      host.render();
      Api.request("/api/account/characters/" + id + "/builder/missing", { method: "POST", body: body, auth: true }).then(function (res) {
        if (mine.charId !== id) return;
        mine.missing = { code: code, result: res, error: "", loading: false };
        host.render();
      }, function (error) {
        if (mine.charId !== id) return;
        mine.missing = { code: code, result: null, error: error.message, loading: false };
        host.render();
      });
    }

    function renderMissing(box) {
      box.textContent = "";
      box.hidden = !mine.imp;
      if (!mine.imp) return;
      var head = el("div", "panel-head");
      head.appendChild(el("h2", null, "Missing for this set"));
      head.appendChild(el("span", "panel-note", "for " + mine.imp.name));
      box.appendChild(head);
      var m = mine.missing;
      var stale = m.code && m.code !== Calc.encode(Calc.normalize(host.getSet()));
      var row = el("div", "bui-actions");
      var go = UI.button(m.loading ? "Checking" : m.result ? "Check again" : "What am I missing?", checkMissing);
      go.id = "sb-missing-check";
      go.disabled = m.loading;
      row.appendChild(go);
      box.appendChild(row);
      if (stale && !m.loading) {
        var st = el("p", "note-text sb-stale", "The set changed since this check: check again for the set shown.");
        st.id = "sb-missing-stale";
        box.appendChild(st);
      }
      if (m.error) box.appendChild(alert(m.error));
      var r = m.result;
      if (!r) {
        if (!m.error && !m.loading) box.appendChild(UI.note("Every piece's cheapest path from what " + mine.imp.name +
          " has, the decorations, sigils and cuffs, and the materials and zenny it all takes, against your boxes."));
        return;
      }
      if (r.online) box.appendChild(alert("You are in game: changes since your last save are not counted yet."));
      box.appendChild(piecesView(r.pieces || []));
      if ((r.items || []).length) box.appendChild(itemsView(r.items));
      box.appendChild(materialsView(r.materials || []));
      box.appendChild(zennyView(r.zenny));
      if ((r.notes || []).length) {
        var ul = el("ul", "sb-missing-notes");
        ul.id = "sb-missing-notes";
        r.notes.forEach(function (n) { ul.appendChild(el("li", null, n)); });
        box.appendChild(ul);
      }
    }

    var STATUS = { owned: "You have it", "level-up": "Level up", upgrade: "Upgrade", craft: "Craft", unavailable: "Not craftable" };

    function matsNode(mats) {
      var span = el("span", "sb-mats");
      if (mats === null || mats === undefined) { span.textContent = "materials not in the data"; return span; }
      if (!mats.length) { span.textContent = "no materials"; return span; }
      mats.forEach(function (mt, i) {
        if (i) span.appendChild(document.createTextNode(", "));
        span.appendChild(itemLink(mt.id, mt.name));
        span.appendChild(document.createTextNode(" x" + mt.qty));
      });
      return span;
    }

    function stepNode(s) {
      var li = el("li");
      var what = s.action === "create" ? "Create " + (s.name || "it")
        : s.action === "upgrade" ? "Upgrade " + (s.fromName || "#" + s.from) + " to " + (s.name || "#" + s.id)
        : "Level " + s.fromLevel + " to " + s.toLevel;
      li.appendChild(document.createTextNode(what + ": "));
      li.appendChild(matsNode(s.mats));
      if (s.zenny !== null && s.zenny !== undefined) li.appendChild(document.createTextNode(" · " + num(s.zenny) + " zenny"));
      return li;
    }

    function piecesView(pieces) {
      var sec = el("div", "sb-missing-part");
      sec.appendChild(UI.subhead("Pieces"));
      var rows = pieces.map(function (p) {
        var name = el("span");
        name.appendChild(link("/equipment.html?slot=" + p.slot + "&id=" + p.id, p.name || "#" + p.id));
        if (p.level && p.slot !== "melee" && p.slot !== "ranged") name.appendChild(document.createTextNode(" Lv " + p.level));
        var status = STATUS[p.status] || p.status;
        if (p.status === "level-up" && p.owned) status += " from Lv " + p.owned.level;
        if (p.status === "upgrade" && p.from) status += " from " + (p.from.name || "#" + p.from.id) + (p.from.level ? " Lv " + p.from.level : "");
        if (p.obtainable === false) status += " (not obtainable)";
        var path = el("div");
        if (p.steps && p.steps.length) {
          var ol = el("ol", "sb-steps");
          p.steps.forEach(function (s) { ol.appendChild(stepNode(s)); });
          path.appendChild(ol);
        } else if (p.status === "unavailable") {
          path.textContent = p.sources ? "Where from: " + p.sources : "No recipe and no known source.";
        } else {
          path.textContent = "Nothing to do.";
        }
        return [{ node: SLOT_NAMES[p.slot] || p.slot, label: "Slot" }, { node: name, label: "Piece" },
                { node: status, label: "Status", cls: "sb-status-" + p.status }, { node: path, label: "Cheapest path" }];
      });
      var t = UI.table(["Slot", "Piece", "Status", "Cheapest path"], rows, "No pieces in this set.", "sb-missing-pieces");
      sec.appendChild(t);
      return sec;
    }

    function itemsView(items) {
      var sec = el("div", "sb-missing-part");
      sec.appendChild(UI.subhead("Decorations, sigils and cuffs"));
      var rows = items.map(function (it) {
        var name = itemLink(it.id, it.name);
        var how = el("span");
        if (it.missing > 0 && it.recipe) {
          how.appendChild(document.createTextNode("Make " + it.missing + ": "));
          how.appendChild(matsNode(it.recipe.mats));
          if (it.recipe.price) how.appendChild(document.createTextNode(" · " + num(it.recipe.price) + " " + (it.recipe.currency || "") + " each"));
        } else if (it.missing > 0) {
          how.textContent = it.sources ? "Where from: " + it.sources : "No recipe and no known source.";
        } else {
          how.textContent = "You have enough.";
        }
        return [{ node: name, label: KIND_NAMES[it.kind] || it.kind },
                { node: String(it.need), label: "Need", cls: "num" },
                { node: String(it.inPlace), label: "In place", cls: "num" },
                { node: String(it.fromBoxes), label: "From boxes", cls: "num" },
                { node: String(it.inOtherEquipment), label: "In other gear", cls: "num" },
                { node: String(it.missing), label: "Missing", cls: "num" + (it.missing ? " sb-bad" : "") },
                { node: how, label: "How to get" }];
      });
      sec.appendChild(UI.table(["Item", "Need", "In place", "From boxes", "In other gear", "Missing", "How to get"], rows, "", "sb-missing-items"));
      sec.appendChild(UI.note("In place: already set in the piece you would use. In other gear: set in other equipment, " +
        "counted as in use, not as free."));
      return sec;
    }

    function materialsView(materials) {
      var sec = el("div", "sb-missing-part");
      sec.appendChild(UI.subhead("Materials"));
      var rows = materials.map(function (mt) {
        var name = el("span");
        name.appendChild(itemLink(mt.id, mt.name));
        if (mt.obtainable === false) name.appendChild(el("span", "badge sb-badge-bad", "not obtainable"));
        return [{ node: name, label: "Material" }, { node: num(mt.need), label: "Need", cls: "num" },
                { node: num(mt.have), label: "Have", cls: "num" },
                { node: num(mt.missing), label: "Missing", cls: "num" + (mt.missing ? " sb-bad" : "") },
                { node: mt.sources || "not listed", label: "Where from", cls: "sb-from" }];
      });
      sec.appendChild(UI.table(["Material", "Need", "Have", "Missing", "Where from"], rows, "No materials needed.", "sb-missing-mats"));
      return sec;
    }

    function zennyView(z) {
      var p = el("p", "sb-zenny");
      p.id = "sb-missing-zenny";
      if (!z) return p;
      p.appendChild(el("strong", null, "Zenny: "));
      p.appendChild(document.createTextNode(num(z.need) + " needed, " + num(z.have) + " held, " + num(z.missing) + " missing."));
      if (!z.complete) {
        var inc = el("span", "sb-incomplete", " Not complete: some steps' zenny cost is not in the game data (armour level-ups and " +
          "some create rows), so the real total is higher.");
        p.appendChild(inc);
      }
      return p;
    }

    return {
      start: start, panel: panel, renderMissing: renderMissing, filtering: filtering, ownedLevel: ownedLevel,
      ownsWeapon: ownsWeapon, weaponCount: weaponCount, ownsItem: ownsItem, itemHint: itemHint,
      loaded: function () { return !!mine.inv; },
      version: function () { return mine.version; },
      // the character's import as the API sent it (Find sets passes it to the search engine), null when none
      importData: function () { return mine.imp; }
    };
  }

  window.SetBuilderMine = { create: create };
})();
