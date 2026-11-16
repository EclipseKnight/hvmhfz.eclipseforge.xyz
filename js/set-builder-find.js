/* The Set builder's "Find sets" tab (set-builder.html, docs/armor-set-builder.md "Find sets"): every skill as a
   category grid with a chip per level (and a name search), the skills wanted with how much room is left, the
   filters (weapon class, gender, hunter type, rank, only what I own, Zenith pieces, Tower decorations), pieces to
   keep or leave out, search, and the sets found as cards: pieces, a bar per wanted skill, other skills, defence,
   free slots; sortable; "Load into builder" puts a set on the cards, "Compare" lines up to three sets beside the
   builder's. A result's piece can be kept for every search or left out of it from its card.

   The search itself is the armour search engine (js/armor-search.js, run in the Web Worker
   js/armor-search-worker.js; docs/armor-set-builder.md "Skill search"). Messages:
     page -> worker  {type: "search", query}   then, to stop early, {type: "cancel"} (the worker sends nothing more
                     for that search, so the page ends the worker at once)
     worker -> page  {type: "progress", done, total} ... {type: "done", result: {results: [{set, skills,
                     extraSkills, defence, res, freeSlots, score, met, missing}], stats, truncated}}
                     ({type: "error", message} too). stats: ms, impossible [{skill, problem}], relaxed (nothing met
                     every skill: the results each miss one, named in missing), timedOut, notes, error.
   query = {wanted: [{skill, level, tree}], weaponClass, weaponId, gender, hunterType, rankMax, ownedOnly, owned,
            allowZenith, allowTowerDecos, fixed, exclude, maxResults, timeLimitMs}. wanted[].skill is the skill id of
   the level picked, level its points threshold (always 10 or more, so the engine reads it as points) and tree its
   skill tree. When the worker file is not on the site the tab says so and searches nothing.

   Every result is recalculated here with js/armor-calc.js for what the cards show, so the cards always follow the
   game's rules as the builder does. js/set-builder.js creates this with a host object (see create()). */
(function () {
  "use strict";

  var WORKER_URL = "/js/armor-search-worker.js?v=2";
  var MAX_RESULTS = 50;
  var MAX_WANTED = 10;          // what the engine searches at most (js/armor-search.js MAX_WANTED)
  var BASE_LIMIT = 10;          // the game's skill limit before G-rank, Zenith pieces and cuffs add to it
  var TIME_LIMIT_MS = 10000;
  var MAX_COMPARE = 3;
  var PAGE = 12;                // result cards shown before "Show more"
  var UI = window.BuilderUI;
  var Calc = window.ArmorCalc;
  var SLOT_NAMES = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var SLOTS = ["head", "chest", "arms", "waist", "legs"];
  var RES_NAMES = { fire: "Fire", water: "Water", thunder: "Thunder", ice: "Ice", dragon: "Dragon" };
  var RES_ORDER = ["fire", "water", "thunder", "ice", "dragon"];
  var CATEGORIES = [["attack", "Attack"], ["defence", "Defence"], ["res", "Resistance"], ["gunner", "Gunner"],
                    ["tech", "Weapon Tech"], ["other", "Other"]];
  var SORTS = [["best", "Best match"], ["def", "Defence"], ["free", "Free slots"], ["extra", "Extra skills"]];
  // Categories by tree name (the game has none): the first pattern that matches wins; Tech trees by their class.
  var CATEGORY_RULES = [
    ["gunner", /S\.Up|S\.Add|C\.Add|Reload|Recoil|Bullet|Rapid Fire|Sniper|Loading|Precision|Gunnery|Ammo|Gentle Shot|Spacing|Critical Shot|Steady Hand/],
    ["res", /Res\b|Res Up|Paralysis|Sleep|Stun|Poison|Deoderant|Hearing|Wind Pressure|Anti-Theft|Sobriety/],
    ["defence", /Defense|Guard|Protection|Health|Recover|Absolute|Fortification|Def Lock|Vitality|Guts|Evasion|Evade|Survivor|Adaptation|Relief|Mindfulness|Reinforcement|Light Tread|Stamina|Everlasting|Adrenaline|Passive/],
    ["attack", /Attack|Sharpness|Artisan|Expert|Edgemaster|Sword|Issen|Furious|Determination|Crit|Breaking|Drawing|Combo|Rush|Thunder Clad|Dissolver|Tenderizer|Element|Assault|Lavish|Bomb Boost|Fencing|Power|Rage|Ceaseless|Sharpening|Handling|Trained|Skilled|Compensation|Three Worlds|Reflect|Grace|Vampirism|Dark Pulse|Lone Wolf|Shiriagari|Focus|Iron Arm|Encourage|Status|Combat|Obscurity/]
  ];
  // Thresholds this high are the game's special Zenith markers (Reflect+3, Encourage+2), never reached by points.
  var MAX_POINTS = 1000;

  function el(tag, cls, text) { return UI.el(tag, cls, text); }

  function signed(v) { return v > 0 ? "+" + v : String(v); }

  /** Chip labels for a tree's levels: what their names do not share ("Attack Up Large" -> "Large", "Health+20" ->
      "+20"), or the whole names when that would leave nothing or two alike. */
  function shortLabels(names) {
    if (names.length < 2) return names.slice();
    var p = names[0];
    names.forEach(function (n) { while (p && n.indexOf(p) !== 0) p = p.slice(0, -1); });
    var cut = Math.max(p.lastIndexOf(" ") + 1, p.lastIndexOf("+"));
    if (cut <= 0) return names.slice();
    var out = names.map(function (n) { return n.slice(cut).trim(); });
    var seen = {};
    var ok = out.every(function (s) { if (!s || seen[s]) return false; seen[s] = true; return true; });
    return ok ? out : names.slice();
  }

  /**
   * host: {box, data, mine, getSet(), gender(), loadForSet(set) -> Promise, compute(set), typeOf(cls),
   *        weaponIcon(cls, weapon), pieceIcon(slot, piece), itemIcon(id), colourOf(rarity), treeName(id),
   *        thresholds(tree), deltaNode(before, after), piece(slot, id), loadSet(set, note) -> Promise,
   *        showFind()}
   */
  function create(host) {
    var R = host.data.rules;
    var f = {
      q: "", cat: "all", wanted: [], weaponClass: null, gender: null, hunterType: "any", hr: "", gr: "",
      ownedOnly: false, allowZenith: true, allowTower: true,
      fixed: {},          // {slot: piece id} kept in every search; weapon: true keeps the builder's weapon
      exclude: [],        // [{key: "head:123" | "item:5803", name}]
      sort: "best", filtersOpen: null, limit: PAGE,
      engine: null, worker: null, running: false, progress: null, asked: null,
      result: null, shown: null, error: "", stopped: false, compare: []
    };
    var trees = null;   // the trees the picker offers: [{tree, name, cat, cls, levels, labels, text}]

    function pickable() {
      if (trees) return trees;
      trees = [];
      R.trees.forEach(function (t) {
        var levels = host.thresholds(t).filter(function (l) { return l[0] > 0 && l[0] < MAX_POINTS; });
        if (!/[A-Za-z]/.test(t.name) || !levels.length) return;
        var tech = t.weapon_class !== null && t.weapon_class !== undefined;
        var cat = tech ? "tech" : "other";
        if (!tech) {
          for (var i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i][1].test(t.name)) { cat = CATEGORY_RULES[i][0]; break; }
        }
        var names = levels.map(function (l) { return R.skillName(l[1]); });
        trees.push({ tree: t.id, name: t.name, cat: cat, cls: tech ? t.weapon_class : null, levels: levels,
                     labels: shortLabels(names), text: (t.name + " " + names.join(" ")).toLowerCase() });
      });
      trees.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return trees;
    }

    // ---- what the filters mean -------------------------------------------------------------------------

    function builderClass() { return host.getSet().weapon[0]; }
    function effClass() { return f.weaponClass === null ? builderClass() : f.weaponClass; }
    function effGender() { return f.gender === null ? host.gender() : f.gender; }
    function effType() {
      var cls = effClass();
      if (cls >= 0) return R.weaponKind(cls) === "gunner" ? "gunner" : "blade";
      return f.hunterType;
    }
    function imp() { return host.mine && host.mine.importData ? host.mine.importData() : null; }
    function className(cls) { var t = host.typeOf(cls); return t ? t.name : "weapon"; }

    function wholeOrEmpty(v, max) {
      var n = Math.trunc(Number(v));
      return v === "" || !isFinite(n) || n < 1 ? 0 : Math.min(n, max);
    }

    function keptWeapon() {
      var set = host.getSet(), cls = effClass();
      return f.fixed.weapon && cls >= 0 && set.weapon[0] === cls && set.weapon[1] ? set.weapon[1] : 0;
    }

    /** The query for the engine (the interface in the header). */
    function query() {
      var cls = effClass();
      var hr = wholeOrEmpty(f.hr, 999), gr = wholeOrEmpty(f.gr, 999);
      var fixed = {};
      SLOTS.forEach(function (s) { if (f.fixed[s]) fixed[s] = f.fixed[s]; });
      var i = imp();
      return {
        wanted: f.wanted.map(function (w) { return { skill: w.skill, level: w.points, tree: w.tree }; }),
        weaponClass: cls >= 0 ? cls : null,
        weaponId: keptWeapon(),
        gender: effGender(),
        hunterType: effType(),
        rankMax: hr || gr ? { hr: hr || (gr ? 999 : 0), gr: gr } : null,
        ownedOnly: !!(f.ownedOnly && i),
        owned: i || null,
        allowZenith: f.allowZenith,
        allowTowerDecos: f.allowTower,
        fixed: fixed,
        exclude: f.exclude.map(function (x) { return x.key; }),
        maxResults: MAX_RESULTS,
        timeLimitMs: TIME_LIMIT_MS
      };
    }

    // ---- the engine ----------------------------------------------------------------------------------------

    function checkEngine() {
      if (f.engine !== null) return Promise.resolve(f.engine);
      return fetch(WORKER_URL, { method: "HEAD", cache: "no-store" }).then(function (res) {
        f.engine = res.ok;
        return f.engine;
      }, function () { f.engine = false; return false; });
    }

    function endWorker() {
      if (f.worker) f.worker.terminate();
      f.worker = null;
      f.running = false;
    }

    function search() {
      if (!f.wanted.length) return;
      if (f.running) endWorker();
      f.error = "";
      f.result = null;
      f.shown = null;
      f.stopped = false;
      f.compare = [];
      f.limit = PAGE;
      checkEngine().then(function (ok) {
        if (!ok) {
          f.error = "The skill search is not on the site yet, so nothing was searched. Build the set on the Equipment tab for now.";
          render();
          return;
        }
        var w;
        try { w = new Worker(WORKER_URL); } catch (e) { f.error = "Your browser could not start the search: " + e.message; render(); return; }
        f.worker = w;
        f.running = true;
        f.progress = { done: 0, total: 0 };
        f.asked = f.wanted.map(function (x) { return { tree: x.tree, skill: x.skill, points: x.points, name: x.name }; });
        w.onmessage = function (e) {
          if (w !== f.worker) return;
          var m = e.data || {};
          if (m.type === "progress") { f.progress = { done: m.done || 0, total: m.total || 0 }; renderProgress(); }
          else if (m.type === "done") finish(m.result);
          else if (m.type === "error") fail(m.message || "the search stopped");
        };
        w.onerror = function (e) {
          if (e.preventDefault) e.preventDefault();
          if (w === f.worker) fail(e.message || "the search stopped");
        };
        w.postMessage({ type: "search", query: query() });
        render();
      });
    }

    /** Stops the running search. The engine sends nothing more for a cancelled search, so the worker ends now. */
    function cancel() {
      if (!f.worker) return;
      f.worker.postMessage({ type: "cancel" });
      endWorker();
      f.stopped = true;
      render();
    }

    function fail(message) {
      endWorker();
      f.error = "The search did not finish: " + message + ".";
      render();
    }

    function finish(result) {
      endWorker();
      f.result = result || { results: [] };
      var list = (f.result.results || []).slice(0, MAX_RESULTS).filter(function (r) { return r && r.set; });
      var sets = list.map(function (r) { return Calc.normalize(r.set); });
      Promise.all(sets.map(host.loadForSet)).then(function () {
        f.shown = list.map(function (r, i) {
          var c = host.compute(sets[i]);
          return { engine: r, set: sets[i], calc: c, rank: i, free: freeSlots(c), extra: extraCount(c) };
        });
        render();
        if (!wideScreen()) {
          var box = document.getElementById("sb-find-results");
          if (box && box.scrollIntoView) box.scrollIntoView({ block: "start" });
        }
      }, function () {
        f.error = "Could not load the pieces of the results. Try again.";
        render();
      });
    }

    function wideScreen() { return window.matchMedia("(min-width: 1200px)").matches; }

    // ---- wanted skills --------------------------------------------------------------------------------------

    function wantedOf(tree) { return f.wanted.filter(function (w) { return w.tree === tree; })[0] || null; }

    function toggleWanted(t, level) {
      var w = wantedOf(t.tree);
      if (w && w.skill === level[1]) f.wanted = f.wanted.filter(function (x) { return x !== w; });
      else if (w) { w.skill = level[1]; w.points = level[0]; }
      else if (f.wanted.length < MAX_WANTED) f.wanted.push({ tree: t.tree, skill: level[1], points: level[0], name: t.name });
      render();
    }

    /** Quick start from the Equipment tab: want these skills ([skill id]) and search. */
    function quick(skills) {
      f.wanted = [];
      skills.forEach(function (sk) {
        var t = pickable().filter(function (x) { return x.levels.some(function (l) { return l[1] === sk; }); })[0];
        if (!t || wantedOf(t.tree)) return;
        var l = t.levels.filter(function (x) { return x[1] === sk; })[0];
        f.wanted.push({ tree: t.tree, skill: sk, points: l[0], name: t.name });
      });
      render();
      search();
    }

    // ---- the skill grid ---------------------------------------------------------------------------------------

    function pickerPanel() {
      var box = UI.section("All skills", "tap a level to want it");
      box.classList.add("sb-find-picker");
      var bar = el("div", "sb-picker-bar");
      var search = el("input", "sb-search");
      search.type = "search";
      search.placeholder = "Search skills (Attack, Evasion, Guard Up...)";
      search.setAttribute("aria-label", "Search skills");
      search.setAttribute("data-focus", "find|q");
      search.id = "sb-find-q";
      search.value = f.q;
      search.addEventListener("input", function () { f.q = search.value; renderTrees(); });
      search.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          var first = box.querySelector(".sb-level-chip:not([disabled])");
          if (first) { e.preventDefault(); first.focus(); }
        }
      });
      bar.appendChild(search);
      var cats = el("div", "sb-chips sb-cats");
      cats.setAttribute("role", "group");
      cats.setAttribute("aria-label", "Skill categories");
      [["all", "All"]].concat(CATEGORIES).forEach(function (c) {
        cats.appendChild(chip(c[1], f.cat === c[0], "find|cat|" + c[0], function () { f.cat = c[0]; render(); }));
      });
      bar.appendChild(cats);
      box.appendChild(bar);
      var list = el("div", "sb-skill-grid");
      list.id = "sb-find-trees";
      box.appendChild(list);
      return box;
    }

    function renderTrees() {
      var list = document.getElementById("sb-find-trees");
      if (!list) return;
      list.textContent = "";
      var words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      var cls = effClass();
      var full = f.wanted.length >= MAX_WANTED;
      // a search looks in every category; Tech skills of another weapon class are left out
      var shown = pickable().filter(function (t) {
        if (t.cls !== null && cls >= 0 && t.cls !== cls) return false;
        if (words.length) return words.every(function (w) { return t.text.indexOf(w) !== -1; });
        return f.cat === "all" || t.cat === f.cat;
      });
      if (!shown.length) { list.appendChild(el("p", "note-text", "No skill matches.")); return; }
      CATEGORIES.forEach(function (c) {
        var mine = shown.filter(function (t) { return t.cat === c[0]; });
        if (!mine.length) return;
        var group = el("section", "sb-skill-cat");
        group.setAttribute("data-cat", c[0]);
        var h = el("h3", "sb-skill-cat-name", c[1]);
        h.appendChild(el("span", "sb-skill-cat-count", String(mine.length)));
        group.appendChild(h);
        var ul = el("ul", "sb-skill-picks");
        mine.forEach(function (t) { ul.appendChild(treeTile(t, full)); });
        group.appendChild(ul);
        list.appendChild(group);
      });
    }

    function treeTile(t, full) {
      var w = wantedOf(t.tree);
      var li = el("li", "sb-skill-pick" + (w ? " is-wanted" : ""));
      li.setAttribute("data-tree", t.tree);
      var top = el("div", "sb-skill-pick-top");
      top.appendChild(el("span", "sb-skill-pick-name", t.name));
      if (w) top.appendChild(el("span", "sb-skill-pick-now", R.skillName(w.skill)));
      li.appendChild(top);
      var levels = el("span", "sb-level-chips");
      levels.setAttribute("role", "group");
      levels.setAttribute("aria-label", t.name + " levels");
      t.levels.forEach(function (l, k) {
        var on = !!(w && w.skill === l[1]);
        var fullName = R.skillName(l[1]);
        var b = chip("", on, "find|want|" + t.tree + "|" + l[1], function () { toggleWanted(t, l); });
        b.classList.add("sb-level-chip");
        b.setAttribute("data-skill", l[1]);
        b.appendChild(el("span", "sb-level-name", t.labels[k]));
        b.appendChild(el("span", "sb-level-pts", String(l[0])));
        b.setAttribute("aria-label", fullName + ", " + l[0] + " points");
        b.title = (on ? "Remove " : "Want ") + fullName + " (" + l[0] + " points)";
        if (!w && full) { b.disabled = true; b.title = "The search takes up to " + MAX_WANTED + " skills"; }
        levels.appendChild(b);
      });
      li.appendChild(levels);
      return li;
    }

    // ---- wanted skills, room, filters, pieces (top) -----------------------------------------------------

    function searchPanel() {
      var n = f.wanted.length;
      var box = UI.section("Skills you want", n ? n + " of " + MAX_WANTED : "");
      box.id = "sb-find-search";
      box.classList.add("sb-find-search");
      var top = el("div", "sb-find-top");
      var chips = el("div", "sb-wanted");
      chips.id = "sb-find-wanted";
      if (!n) chips.appendChild(el("p", "note-text", "Pick skills from the grid: one level per skill. The search finds the sets that reach all of them."));
      f.wanted.forEach(function (w) {
        var c = el("span", "sb-want");
        c.setAttribute("data-skill", w.skill);
        c.appendChild(el("span", "sb-want-name", R.skillName(w.skill)));
        c.appendChild(el("span", "sb-want-pts", w.name + " " + w.points));
        var x = el("button", "sb-want-x", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Remove " + R.skillName(w.skill));
        x.setAttribute("data-focus", "find|unwant|" + w.tree);
        x.addEventListener("click", function () { f.wanted = f.wanted.filter(function (o) { return o !== w; }); render(); });
        c.appendChild(x);
        chips.appendChild(c);
      });
      top.appendChild(chips);
      top.appendChild(roomMeter());
      var actions = el("div", "bui-actions sb-find-actions");
      var go = el("button", "btn btn-primary", f.running ? "Searching" : "Find sets");
      go.type = "button";
      go.id = "sb-find-go";
      go.setAttribute("data-focus", "find|go");
      go.disabled = !n || f.running;
      go.addEventListener("click", search);
      actions.appendChild(go);
      if (f.running) {
        var stop = el("button", "ghost-btn small", "Cancel");
        stop.type = "button";
        stop.id = "sb-find-cancel";
        stop.setAttribute("data-focus", "find|cancel");
        stop.addEventListener("click", cancel);
        actions.appendChild(stop);
      }
      if (n && !f.running) {
        var clear = el("button", "ghost-btn small", "Clear skills");
        clear.type = "button";
        clear.setAttribute("data-focus", "find|clear");
        clear.addEventListener("click", function () { f.wanted = []; render(); });
        actions.appendChild(clear);
      }
      top.appendChild(actions);
      box.appendChild(top);
      var prog = el("div", "sb-progress");
      prog.id = "sb-find-progress";
      prog.setAttribute("role", "status");
      box.appendChild(prog);
      box.appendChild(filters());
      var pieces = piecesRow();
      if (pieces) box.appendChild(pieces);
      if (f.engine === false && !f.error) {
        box.appendChild(el("p", "note-text sb-engine-note", "The skill search is not on the site yet: you can pick skills and filters, " +
          "but Find sets has nothing to run."));
      }
      if (f.error) {
        var e = el("p", "form-alert", f.error);
        e.id = "sb-find-error";
        e.setAttribute("role", "alert");
        box.appendChild(e);
      }
      return box;
    }

    /** How many of the skill limit's places the wanted skills take, as boxes. */
    function roomMeter() {
      var n = f.wanted.length;
      var box = el("div", "sb-room");
      box.id = "sb-find-room";
      var meter = el("div", "sb-meter");
      meter.setAttribute("aria-hidden", "true");
      for (var i = 0; i < BASE_LIMIT; i++) meter.appendChild(el("span", "sb-meter-box" + (i < n ? " is-used" : "")));
      box.appendChild(meter);
      var left = MAX_WANTED - n;
      box.appendChild(el("span", "sb-room-text", left > 0 ? "Room for " + left + " more" : "Full: " + MAX_WANTED + " skills"));
      box.title = "The game shows " + BASE_LIMIT + " skills before G-rank and Zenith pieces and cuffs add places; " +
        "the search takes up to " + MAX_WANTED + " wanted skills.";
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

    function group(label, node, cls) {
      var g = el("div", "sb-filter" + (cls ? " " + cls : ""));
      g.appendChild(el("span", "sb-filter-label", label));
      g.appendChild(node);
      return g;
    }

    function check(label, checked, focusKey, onChange, disabled, hint) {
      var l = el("label", "bui-check sb-check");
      var c = el("input");
      c.type = "checkbox";
      c.checked = checked;
      c.disabled = !!disabled;
      c.setAttribute("data-focus", focusKey);
      c.addEventListener("change", function () { onChange(c.checked); render(); });
      l.appendChild(c);
      l.appendChild(document.createTextNode(label));
      if (hint) l.title = hint;
      return l;
    }

    /** One line saying what the filters are, for the folded filters. */
    function filtersSummary() {
      var cls = effClass();
      var parts = [cls >= 0 ? className(cls) : "Any weapon"];
      var g = effGender();
      parts.push(g ? (g === "male" ? "Male" : "Female") : "Any gender");
      if (cls < 0 && f.hunterType !== "any") parts.push(f.hunterType === "gunner" ? "Gunner" : "Blademaster");
      var hr = wholeOrEmpty(f.hr, 999), gr = wholeOrEmpty(f.gr, 999);
      if (gr) parts.push("up to GR " + gr);
      else if (hr) parts.push("HR only");
      if (f.ownedOnly && imp()) parts.push("only what I own");
      if (!f.allowZenith) parts.push("no Zenith");
      if (!f.allowTower) parts.push("no Road gems");
      return parts.join(" · ");
    }

    function filters() {
      var details = el("details", "sb-find-filters");
      if (f.filtersOpen === null) f.filtersOpen = wideScreen();
      details.open = f.filtersOpen;
      details.addEventListener("toggle", function () { f.filtersOpen = details.open; });
      var sum = el("summary", "sb-find-filters-sum");
      sum.appendChild(el("span", "sb-filter-label", "Filters"));
      sum.appendChild(el("span", "sb-find-filters-now", filtersSummary()));
      details.appendChild(sum);
      var box = el("div", "sb-filters");
      var cls = effClass();
      var classes = el("div", "sb-chips sb-class-chips");
      classes.setAttribute("role", "group");
      classes.setAttribute("aria-label", "Weapon class");
      classes.appendChild(chip("Any", cls < 0, "find|class|any", function () { f.weaponClass = -1; render(); }));
      host.data.types.forEach(function (t) {
        var b = chip("", cls === t.class, "find|class|" + t.class, function () { f.weaponClass = t.class; render(); });
        b.title = t.name;
        var img = el("img", "sb-icon sb-chip-icon");
        img.alt = "";
        img.src = host.weaponIcon(t.class, null);
        b.appendChild(img);
        b.appendChild(el("span", null, t.name));
        classes.appendChild(b);
      });
      box.appendChild(group("Weapon", classes, "is-wide"));

      var genders = el("div", "sb-chips");
      genders.setAttribute("role", "group");
      genders.setAttribute("aria-label", "Gender");
      [["", "Any"], ["male", "Male"], ["female", "Female"]].forEach(function (g) {
        genders.appendChild(chip(g[1], effGender() === g[0], "find|gender|" + (g[0] || "any"), function () { f.gender = g[0]; render(); }));
      });
      box.appendChild(group("Gender", genders));

      var types = el("div", "sb-chips");
      types.setAttribute("role", "group");
      types.setAttribute("aria-label", "Hunter type");
      [["any", "Any"], ["blade", "Blademaster"], ["gunner", "Gunner"]].forEach(function (t) {
        var b = chip(t[1], effType() === t[0], "find|type|" + t[0], function () { f.hunterType = t[0]; render(); });
        if (cls >= 0) { b.disabled = true; b.title = "Set by the weapon class"; }
        types.appendChild(b);
      });
      box.appendChild(group("Hunter type", types));

      var rank = el("div", "sb-rank");
      [["HR", "hr"], ["GR", "gr"]].forEach(function (r) {
        var l = el("label", "sb-rank-field");
        l.appendChild(el("span", null, "Up to " + r[0]));
        var input = el("input");
        input.type = "number";
        input.min = "1";
        input.max = "999";
        input.placeholder = "any";
        input.value = f[r[1]];
        input.setAttribute("data-focus", "find|" + r[1]);
        input.addEventListener("input", function () { f[r[1]] = input.value; });
        input.addEventListener("change", function () { render(); });
        l.appendChild(input);
        rank.appendChild(l);
      });
      var rg = group("Rank", rank);
      rg.title = "An HR alone means no G-rank or Zenith pieces and no cuffs";
      box.appendChild(rg);

      var opts = el("div", "sb-checks");
      var i = imp();
      opts.appendChild(check("Only what I own", f.ownedOnly && !!i, "find|owned", function (v) { f.ownedOnly = v; }, !i,
                             i ? "Only pieces and decorations " + i.name + " has" : "Load a character in Your character first"));
      opts.appendChild(check("Zenith pieces", f.allowZenith, "find|zenith", function (v) { f.allowZenith = v; }));
      opts.appendChild(check("Tower decorations (Road gems)", f.allowTower, "find|tower", function (v) { f.allowTower = v; }));
      box.appendChild(group("Allow", opts));
      details.appendChild(box);
      return details;
    }

    function weaponName(cls, id) {
      var w = host.data.weapons[cls];
      var item = w && w.byId[id];
      return item ? item.name : "#" + id;
    }

    function pieceName(slot, id) {
      var p = host.piece(slot, id);
      return p ? p.name : "#" + id;
    }

    /** Pieces kept in every search and pieces left out: a chip each, and the builder's pieces as quick keeps. */
    function piecesRow() {
      var set = host.getSet();
      var cls = effClass();
      var row = el("div", "sb-chips sb-find-pieces");
      row.id = "sb-find-pieces";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Pieces kept and left out");
      var any = false;
      function pinned(label, focusKey, title, onRemove, cls2) {
        var c = el("span", "sb-pin " + cls2);
        c.appendChild(el("span", "sb-pin-text", label));
        var x = el("button", "sb-want-x", "×");
        x.type = "button";
        x.title = title;
        x.setAttribute("aria-label", title);
        x.setAttribute("data-focus", focusKey);
        x.addEventListener("click", onRemove);
        c.appendChild(x);
        row.appendChild(c);
        any = true;
      }
      if (set.weapon[0] >= 0 && set.weapon[1] && set.weapon[0] === cls) {
        var wname = weaponName(set.weapon[0], set.weapon[1]);
        if (f.fixed.weapon) pinned("Keep: " + wname, "find|keep|weapon", "Stop keeping " + wname, function () { delete f.fixed.weapon; render(); }, "is-keep");
        else {
          var kw = chip("+ Keep " + wname, false, "find|keep|weapon", function () { f.fixed.weapon = true; render(); });
          kw.title = "Search with the builder's weapon and its slots";
          row.appendChild(kw);
          any = true;
        }
      }
      SLOTS.forEach(function (slot, k) {
        var a = set.armour[k];
        if (f.fixed[slot]) {
          var nm = pieceName(slot, f.fixed[slot]);
          pinned("Keep " + SLOT_NAMES[slot] + ": " + nm, "find|keep|" + slot, "Stop keeping " + nm,
                 function () { delete f.fixed[slot]; render(); }, "is-keep");
        } else if (a[1]) {
          var b = chip("+ Keep " + pieceName(slot, a[1]), false, "find|keep|" + slot, function () { f.fixed[slot] = a[1]; render(); });
          b.title = "Keep the builder's " + SLOT_NAMES[slot].toLowerCase() + " piece in every set";
          row.appendChild(b);
          any = true;
        }
      });
      f.exclude.forEach(function (x) {
        pinned("Not: " + x.name, "find|unexclude|" + x.key, "Allow " + x.name + " again",
               function () { f.exclude = f.exclude.filter(function (o) { return o !== x; }); render(); }, "is-out");
      });
      return any ? group("Pieces", row, "sb-find-pieces-group") : null;
    }

    function keepPiece(slot, id) {
      f.fixed[slot] = id;
      f.exclude = f.exclude.filter(function (x) { return x.key !== slot + ":" + id; });
      search();
    }

    function excludeKey(key, name) {
      if (f.exclude.some(function (x) { return x.key === key; })) return;
      f.exclude.push({ key: key, name: name });
      var m = /^(head|chest|arms|waist|legs):(\d+)$/.exec(key);
      if (m && f.fixed[m[1]] === Number(m[2])) delete f.fixed[m[1]];
      search();
    }

    // ---- results ---------------------------------------------------------------------------------------------

    function freeSlots(c) {
      var free = 0;
      c.pieces.forEach(function (p) { if (p.piece) free += Math.max(0, p.slots.value - p.decos.used); });
      if (c.weaponSlots) free += Math.max(0, c.weaponSlots.capacity - c.weaponSlots.used);
      return free;
    }

    function asked() { return f.asked || f.wanted; }

    function wantedTree(tree) { return asked().some(function (w) { return w.tree === tree; }); }

    function extraCount(c) {
      return c.active.filter(function (s) { return !s.dropped && s.works && !s.negative && !(s.from === "points" && wantedTree(s.tree)); }).length;
    }

    function met(c, w) {
      return c.active.some(function (s) {
        return !s.dropped && s.works && (s.skill === w.skill || (s.from === "points" && s.tree === w.tree && !s.negative && s.total >= w.points));
      });
    }

    function pointsOf(c, tree) {
      var t = c.trees.filter(function (x) { return x.tree === tree; })[0];
      return t ? t.total : 0;
    }

    function sortedShown() {
      var list = f.shown.slice();
      var by = {
        def: function (r) { return r.calc.defence.total; },
        free: function (r) { return r.free; },
        extra: function (r) { return r.extra; }
      }[f.sort];
      if (by) list.sort(function (a, b) { return by(b) - by(a) || a.rank - b.rank; });
      return list;
    }

    function skillNames(ids) { return ids.map(function (id) { return R.skillName(id); }); }

    function orList(names) {
      if (names.length < 2) return names.join("");
      return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
    }

    /** What the search says beyond its sets: a skill that blocks it, nothing found, the caps it hit. */
    function verdict(box) {
      var stats = f.result.stats || {};
      var n = f.shown.length;
      var all = asked();
      if (stats.error) {
        var e = el("p", "form-alert", "The search could not run: " + stats.error + ".");
        e.id = "sb-find-error";
        box.appendChild(e);
        return;
      }
      var blockers = [];      // [{skill, why}]
      (stats.impossible || []).forEach(function (x) {
        var why = x.problem === "works only with another weapon class" ? "it works only with another weapon class"
          : x.problem === "unknown skill" ? "the game data has no such skill" : x.problem;
        blockers.push({ skill: x.skill, why: why });
      });
      if (stats.relaxed && n) {
        var count = {};
        f.shown.forEach(function (r) { (r.engine.missing || []).forEach(function (s) { count[s] = (count[s] || 0) + 1; }); });
        Object.keys(count).map(Number).sort(function (a, b) { return count[b] - count[a]; }).forEach(function (s) {
          blockers.push({ skill: s, why: "" });
        });
      }
      if (blockers.length) {
        var b = el("div", "sb-find-blocked");
        b.id = "sb-find-blocked";
        b.setAttribute("role", "status");
        var names = skillNames(blockers.map(function (x) { return x.skill; }));
        var head = el("p", "sb-find-blocked-head");
        head.appendChild(el("strong", null, "Nothing matches all " + all.length + " skills. "));
        if (blockers.length === 1) {
          head.appendChild(document.createTextNode(names[0] + " blocks it" + (blockers[0].why ? ": " + blockers[0].why + "." : ".")));
        } else {
          head.appendChild(document.createTextNode("Any one of " + orList(names) + " blocks it."));
        }
        b.appendChild(head);
        if (n) b.appendChild(el("p", "sb-find-blocked-sub", blockers.length === 1 && !(stats.impossible || []).length
          ? "The sets below have every other skill you asked for."
          : "Each set below has all but one of your skills; its card says which it misses."));
        var acts = el("div", "sb-chips");
        blockers.forEach(function (x, k) {
          var w = all.filter(function (o) { return o.skill === x.skill; })[0];
          if (!w) return;
          var drop = el("button", "ghost-btn small sb-drop", "Search without " + names[k]);
          drop.type = "button";
          drop.setAttribute("data-focus", "find|drop|" + x.skill);
          drop.addEventListener("click", function () {
            f.wanted = f.wanted.filter(function (o) { return o.tree !== w.tree; });
            search();
          });
          acts.appendChild(drop);
        });
        b.appendChild(acts);
        box.appendChild(b);
      } else if (!n) {
        var none = el("div", "sb-find-blocked");
        none.id = "sb-find-blocked";
        none.setAttribute("role", "status");
        var one = all.length === 1;
        none.appendChild(el("p", "sb-find-blocked-head", one
          ? "Nothing gives " + R.skillName(all[0].skill) + " with these filters."
          : "No set reaches these " + all.length + " skills with these filters, not even with one of them left out."));
        var tips = [];
        if (one) {
          var lower = pickable().filter(function (t) { return t.tree === all[0].tree; })[0];
          if (lower && lower.levels[0][1] !== all[0].skill) tips.push("pick a lower level");
        } else tips.push("pick fewer skills or lower levels");
        if (!f.allowZenith) tips.push("allow Zenith pieces");
        if (wholeOrEmpty(f.hr, 999) && !wholeOrEmpty(f.gr, 999)) tips.push("add a GR (an HR alone leaves out G-rank pieces and cuffs)");
        if (Object.keys(f.fixed).length || f.exclude.length) tips.push("keep or leave out fewer pieces");
        if (f.ownedOnly && imp()) tips.push("untick Only what I own");
        if (tips.length) none.appendChild(el("p", "sb-find-blocked-sub", "Try to " + orList(tips) + "."));
        box.appendChild(none);
      }
      var notes = [];
      if (n >= MAX_RESULTS) notes.push("Showing the best " + MAX_RESULTS + " sets: the search found more. Add a skill or a filter to see others.");
      if (f.result.truncated || stats.timedOut) notes.push("The search stopped at its " + (TIME_LIMIT_MS / 1000) + " s limit before it had tried every set, so better ones may exist.");
      (stats.notes || []).forEach(function (t) { notes.push(t + "."); });
      if (notes.length) {
        var nt = el("p", "sb-find-note sb-find-cap", notes.join(" "));
        nt.id = "sb-find-truncated";
        box.appendChild(nt);
      }
    }

    function resultsPanel() {
      var box = el("section", "sb-find-results");
      box.id = "sb-find-results";
      box.setAttribute("aria-label", "Sets found");
      if (f.stopped && !f.running) {
        var st = el("p", "sb-find-note sb-find-cap", "Search stopped. Search again to see sets.");
        st.id = "sb-find-stopped";
        box.appendChild(st);
      }
      if (!f.result) {
        if (!f.running && !f.stopped) {
          var empty = el("div", "sb-find-empty");
          empty.appendChild(el("p", "sb-find-empty-head", "Pick the skills you want, then Find sets."));
          empty.appendChild(el("p", null, "Sets that reach them show here as cards, best first: every wanted skill, then defence, " +
            "free slots and fewer bad skills. Sort them, compare up to three, keep a piece or leave one out, and load one into the builder."));
          box.appendChild(empty);
        }
        return box;
      }
      if (!f.shown) { box.appendChild(el("p", "sb-find-empty", "Loading the pieces of the sets found.")); return box; }
      var head = el("div", "sb-find-head");
      var n = f.shown.length;
      head.appendChild(el("h2", "sb-find-count", n ? n + (n === 1 ? " set found" : " sets found") : "No set found"));
      var stats = f.result.stats || {};
      if (stats.ms !== undefined) head.appendChild(el("span", "sb-find-time", (stats.ms / 1000).toFixed(1) + " s"));
      if (n > 1) {
        var sorts = el("div", "sb-chips sb-sorts");
        sorts.setAttribute("role", "group");
        sorts.setAttribute("aria-label", "Sort the sets by");
        sorts.appendChild(el("span", "sb-filter-label", "Sort"));
        SORTS.forEach(function (s) {
          sorts.appendChild(chip(s[1], f.sort === s[0], "find|sort|" + s[0], function () { f.sort = s[0]; render(); }));
        });
        head.appendChild(sorts);
      }
      box.appendChild(head);
      verdict(box);
      if (!n) return box;
      if (f.compare.length) box.appendChild(compareTable());
      var grid = el("div", "sb-results");
      var list = sortedShown();
      list.slice(0, f.limit).forEach(function (r) { grid.appendChild(resultCard(r)); });
      box.appendChild(grid);
      if (list.length > f.limit) {
        var more = el("button", "ghost-btn sb-more", "Show " + Math.min(PAGE, list.length - f.limit) + " more (" +
          (list.length - f.limit) + " left)");
        more.type = "button";
        more.id = "sb-find-more";
        more.setAttribute("data-focus", "find|more");
        more.addEventListener("click", function () { f.limit += PAGE; render(); });
        box.appendChild(more);
      }
      return box;
    }

    function resultCard(r) {
      var c = r.calc, i = r.rank;
      var missing = r.engine.missing || [];
      var card = el("article", "sb-result" + (missing.length ? " is-partial" : ""));
      card.setAttribute("data-index", String(i));
      card.setAttribute("data-set", Calc.encode(r.set));
      var head = el("header", "sb-result-head");
      head.appendChild(el("span", "sb-result-rank", "#" + (i + 1)));
      var def = el("strong", "sb-result-def", "Def " + c.defence.total);
      def.setAttribute("data-defence", String(c.defence.total));
      head.appendChild(def);
      head.appendChild(el("span", "sb-result-free", r.free + " free slot" + (r.free === 1 ? "" : "s")));
      if (missing.length) {
        var miss = el("span", "sb-result-miss", "Misses " + skillNames(missing).join(", "));
        head.appendChild(miss);
      } else head.appendChild(el("span", "sb-result-all", "All " + asked().length + " skills"));
      var res = el("span", "sb-result-res");
      RES_ORDER.forEach(function (k) {
        var v = c.res[k];
        var s = el("span", "sb-res is-" + k + (v < 0 ? " is-neg" : ""), RES_NAMES[k].charAt(0) + " " + signed(v));
        s.title = RES_NAMES[k] + " " + signed(v);
        res.appendChild(s);
      });
      head.appendChild(res);
      card.appendChild(head);

      var ul = el("ul", "sb-result-pieces");
      var cls = r.set.weapon[0];
      if (c.weapon) ul.appendChild(pieceLine({ icon: host.weaponIcon(cls, c.weapon), slot: "Weapon", name: c.weapon.name,
                                               rarity: c.weapon.rarity, decos: r.set.weapon[3] }));
      else if (cls >= 0) ul.appendChild(pieceLine({ icon: host.weaponIcon(cls, null), slot: "Weapon", name: "Any " + className(cls),
                                                    tip: "Any weapon of the class: its slots are not used", decos: [] }));
      c.pieces.forEach(function (p, k) {
        var a = r.set.armour[k];
        if (p.piece) {
          ul.appendChild(pieceLine({ icon: host.pieceIcon(a[0], p.piece), slot: SLOT_NAMES[a[0]], name: p.piece.name, level: p.level,
                                     rarity: p.piece.rarity, decos: a[3], slotKey: a[0], id: a[1], kept: f.fixed[a[0]] === a[1] }));
        } else ul.appendChild(pieceLine({ icon: host.pieceIcon(a[0], null), slot: SLOT_NAMES[a[0]], name: "empty", decos: [] }));
      });
      if (r.set.cuffs.length) {
        ul.appendChild(pieceLine({ icon: host.itemIcon(r.set.cuffs[0]), slot: "Cuffs", name: r.set.cuffs.map(function (id) {
          var d = host.data.items[id]; return d ? d.name : "#" + id; }).join(", "), decos: [], cuffs: r.set.cuffs }));
      }
      card.appendChild(ul);

      var bars = el("ul", "sb-result-bars");
      asked().forEach(function (w) {
        var ok = met(c, w);
        var pts = pointsOf(c, w.tree);
        var li = el("li", "sb-rbar " + (ok ? "is-met" : "is-unmet"));
        li.setAttribute("data-skill", w.skill);
        var top = el("div", "sb-rbar-top");
        top.appendChild(el("span", "sb-rbar-name", (ok ? "✓ " : "✗ ") + R.skillName(w.skill)));
        top.appendChild(el("span", "sb-rbar-pts", pts + " / " + w.points));
        li.appendChild(top);
        var bar = el("div", "sb-bar");
        bar.setAttribute("aria-hidden", "true");
        var fill = el("span", "sb-bar-fill");
        fill.style.left = "0";
        fill.style.width = Math.max(0, Math.min(100, pts / w.points * 100)).toFixed(1) + "%";
        bar.appendChild(fill);
        li.appendChild(bar);
        bars.appendChild(li);
      });
      card.appendChild(bars);

      var skills = el("div", "sb-result-skills");
      c.active.forEach(function (s) {
        if (s.dropped || (s.tree && wantedTree(s.tree) && s.from === "points" && !s.negative)) return;
        if (s.negative) skills.appendChild(el("span", "sb-d is-down", s.name));
        else if (s.works) skills.appendChild(el("span", "sb-d is-pts", s.name));
      });
      var dropped = c.active.filter(function (s) { return s.dropped; }).length;
      if (dropped) skills.appendChild(el("span", "sb-d is-down", dropped + " over the limit"));
      if (skills.firstChild) {
        var sk = el("div", "sb-result-extra");
        sk.appendChild(el("span", "sb-filter-label", "Also"));
        sk.appendChild(skills);
        card.appendChild(sk);
      }

      var actions = el("div", "sb-result-actions");
      var load = el("button", "btn btn-primary btn-small sb-result-load", "Load into builder");
      load.type = "button";
      load.setAttribute("data-focus", "find|load|" + i);
      load.addEventListener("click", function () {
        host.loadSet(r.set, "Loaded set #" + (i + 1) + " from Find sets into the builder.");
      });
      actions.appendChild(load);
      var on = f.compare.indexOf(i) !== -1;
      var cmp = el("button", "ghost-btn small sb-result-compare", on ? "Comparing" : "Compare");
      cmp.type = "button";
      cmp.setAttribute("aria-pressed", on ? "true" : "false");
      cmp.setAttribute("data-focus", "find|compare|" + i);
      cmp.disabled = !on && f.compare.length >= MAX_COMPARE;
      if (cmp.disabled) cmp.title = "Compare up to " + MAX_COMPARE + " sets";
      cmp.addEventListener("click", function () {
        if (on) f.compare = f.compare.filter(function (x) { return x !== i; });
        else f.compare.push(i);
        render();
      });
      actions.appendChild(cmp);
      card.appendChild(actions);
      return card;
    }

    function rarityClass(rarity) {
      return rarity ? " rc-" + host.colourOf(rarity) : "";
    }

    /** A piece of a result card: icon, slot, name in its rarity colour, level, decorations, and for armour the
        quick actions "keep it in every search" and "leave it out". */
    function pieceLine(o) {
      var li = el("li", o.kept ? "is-kept" : null);
      var img = el("img", "sb-icon sb-result-icon");
      img.alt = "";
      img.src = o.icon;
      li.appendChild(img);
      li.appendChild(el("span", "sb-result-slot", o.slot));
      var what = el("span", "sb-result-what");
      what.appendChild(el("span", "sb-result-name" + rarityClass(o.rarity), o.name));
      if (o.level) what.appendChild(el("span", "sb-result-lv", " Lv " + o.level));
      what.title = o.tip || o.name + (o.level ? " Lv " + o.level : "");
      li.appendChild(what);
      if (o.slotKey) {
        var acts = el("span", "sb-piece-acts");
        if (!o.kept) {
          var keep = el("button", "sb-piece-act", "Keep");
          keep.type = "button";
          keep.title = "Keep " + o.name + " in every set and search again";
          keep.setAttribute("aria-label", keep.title);
          keep.setAttribute("data-focus", "find|pin|" + o.slotKey + "|" + o.id);
          keep.addEventListener("click", function () { keepPiece(o.slotKey, o.id); });
          acts.appendChild(keep);
        } else acts.appendChild(el("span", "sb-piece-kept", "Kept"));
        var out = el("button", "sb-piece-act is-out", "×");
        out.type = "button";
        out.title = "Leave " + o.name + " out and search again";
        out.setAttribute("aria-label", out.title);
        out.setAttribute("data-focus", "find|out|" + o.slotKey + "|" + o.id);
        out.addEventListener("click", function () { excludeKey(o.slotKey + ":" + o.id, o.name); });
        acts.appendChild(out);
        li.appendChild(acts);
      }
      var items = o.decos || [];
      if (items.length) {
        var decos = el("span", "sb-result-decos");
        items.forEach(function (id) {
          var d = host.data.items[id];
          var nm = d ? d.name : "#" + id;
          var b = el("button", "sb-deco", nm);
          b.type = "button";
          b.title = "Leave " + nm + " out and search again";
          b.setAttribute("aria-label", b.title);
          b.addEventListener("click", function () { excludeKey("item:" + id, nm); });
          decos.appendChild(b);
        });
        li.appendChild(decos);
      }
      return li;
    }

    /** The builder's set and the sets picked to compare, side by side: stats, wanted skills, other skills. */
    function compareTable() {
      var cols = [{ name: "Your builder set", calc: host.compute(host.getSet()) }].concat(f.compare.map(function (i) {
        return { name: "#" + (i + 1), calc: f.shown[i].calc };
      }));
      var wrap = el("div", "sb-table-wrap sb-compare-wrap");
      var table = el("table", "data-table sb-compare");
      table.id = "sb-compare";
      table.setAttribute("data-nosort", "");
      var thead = el("thead");
      var tr = el("tr");
      tr.appendChild(el("th", null, ""));
      cols.forEach(function (c) { tr.appendChild(el("th", "num", c.name)); });
      thead.appendChild(tr);
      table.appendChild(thead);
      var tbody = el("tbody");
      function row(label, cells, cls) {
        var r = el("tr", cls || null);
        r.appendChild(el("th", null, label));
        cells.forEach(function (v) { r.appendChild(el("td", "num", v)); });
        tbody.appendChild(r);
      }
      row("Defence", cols.map(function (c) { return String(c.calc.defence.total); }));
      RES_ORDER.forEach(function (k) { row(RES_NAMES[k], cols.map(function (c) { return signed(c.calc.res[k]); })); });
      row("Free slots", cols.map(function (c) { return String(freeSlots(c.calc)); }));
      asked().forEach(function (w) {
        row(R.skillName(w.skill), cols.map(function (c) { return met(c.calc, w) ? "✓" : "–"; }), "is-wanted");
      });
      var names = {};
      var order = [];
      cols.forEach(function (c) {
        c.calc.active.forEach(function (s) {
          if (s.dropped || names[s.skill]) return;
          if (asked().some(function (w) { return w.skill === s.skill; })) return;
          names[s.skill] = s.name;
          order.push(s.skill);
        });
      });
      order.forEach(function (sk) {
        row(names[sk], cols.map(function (c) {
          var s = c.calc.active.filter(function (x) { return x.skill === sk && !x.dropped; })[0];
          return s ? (s.works ? "✓" : "no effect") : "–";
        }));
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    // ---- render ----------------------------------------------------------------------------------------------

    function renderProgress() {
      var box = document.getElementById("sb-find-progress");
      if (!box) return;
      box.textContent = "";
      if (!f.running) return;
      var p = el("progress");
      if (f.progress && f.progress.total) { p.max = f.progress.total; p.value = Math.min(f.progress.done, f.progress.total); }
      box.appendChild(p);
      box.appendChild(el("span", "sb-progress-text", f.progress && f.progress.total
        ? "Checked " + f.progress.done.toLocaleString("en-US") + " of " + f.progress.total.toLocaleString("en-US")
        : "Loading the game data and starting the search"));
    }

    function render() {
      var box = host.box;
      var focus = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-focus");
      var sel = null;
      try { if (focus && typeof document.activeElement.selectionStart === "number") sel = [document.activeElement.selectionStart, document.activeElement.selectionEnd]; } catch (e) { sel = null; }
      // the skill grid keeps its scroll across a re-render
      var oldGrid = document.getElementById("sb-find-trees");
      var scroll = oldGrid ? oldGrid.scrollTop : 0;
      box.textContent = "";
      box.appendChild(searchPanel());
      box.appendChild(pickerPanel());
      box.appendChild(resultsPanel());
      renderTrees();
      renderProgress();
      var grid = document.getElementById("sb-find-trees");
      if (grid && scroll) grid.scrollTop = scroll;
      if (focus) {
        var again = box.querySelector('[data-focus="' + focus + '"]');
        if (again && !again.disabled) {
          again.focus({ preventScroll: true });
          if (sel && again.setSelectionRange) try { again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not text */ }
        }
      }
      if (f.engine === null) checkEngine().then(function () { if (f.engine === false) render(); });
    }

    /** A character was loaded: its rank fills the rank filter when that is empty. */
    function characterChanged() {
      var i = imp();
      if (!i) return;
      if (f.hr === "" && f.gr === "") {
        if (i.gr) f.gr = String(i.gr);
        else if (i.hr) f.hr = String(i.hr);
      }
    }

    return { render: render, characterChanged: characterChanged, query: query, quick: quick };
  }

  window.SetBuilderFind = { create: create, shortLabels: shortLabels };
})();
