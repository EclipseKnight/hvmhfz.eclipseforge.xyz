/* The Set builder's "Find sets" tab (set-builder.html, docs/armor-set-builder.md "Find sets"): pick the skills you
   want (search by name, filter by category, a chip per skill level), set the filters (weapon class, gender, hunter
   type, rank, only what I own, Zenith pieces, Tower decorations, pieces to keep from the builder), search, and get
   sets that reach them as cards: pieces, the wanted skills met, other skills, defence, free slots; "Load into
   builder" puts a set on the cards, "Compare" lines up to three sets beside the builder's.

   The search itself is the armour search engine (js/armor-search.js, run in the Web Worker
   js/armor-search-worker.js; docs/armor-set-builder.md "Skill search"). Messages:
     page -> worker  {type: "search", query}   then, to stop early, {type: "cancel"}
     worker -> page  {type: "progress", done, total} ... {type: "done", result: {results: [{set, skills,
                     extraSkills, defence, res, freeSlots, score}], stats, truncated}}   ({type: "error", message} too)
   query = {wanted: [{skill, level, tree}], weaponClass, weaponId, gender, hunterType, rankMax, ownedOnly, owned,
            allowZenith, allowTowerDecos, fixed, exclude, maxResults, timeLimitMs}. wanted[].skill is the skill id of
   the level picked, level its points threshold and tree its skill tree. When the worker file is not on the site
   the tab says so and searches nothing.

   Every result is recalculated here with js/armor-calc.js for what the cards show, so the cards always follow the
   game's rules as the builder does. js/set-builder.js creates this with a host object (see create()). */
(function () {
  "use strict";

  var WORKER_URL = "/js/armor-search-worker.js?v=1";
  var MAX_RESULTS = 50;
  var TIME_LIMIT_MS = 10000;
  var MAX_COMPARE = 3;
  var UI = window.BuilderUI;
  var Calc = window.ArmorCalc;
  var SLOT_NAMES = { head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var RES_NAMES = { fire: "Fire", water: "Water", thunder: "Thunder", ice: "Ice", dragon: "Dragon" };
  var RES_ORDER = ["fire", "water", "thunder", "ice", "dragon"];
  var CATEGORIES = [["all", "All"], ["attack", "Attack"], ["defence", "Defence"], ["res", "Resistance"],
                    ["gunner", "Gunner"], ["tech", "Weapon Tech"], ["other", "Other"]];
  // Categories by tree name (the game has none): the first pattern that matches wins; Tech trees by their class.
  var CATEGORY_RULES = [
    ["gunner", /S\.Up|S\.Add|C\.Add|Reload|Recoil|Bullet|Rapid Fire|Sniper|Loading|Precision|Gunnery|Ammo|Gentle Shot|Spacing|Critical Shot|Steady Hand/],
    ["res", /Res\b|Res Up|Paralysis|Sleep|Stun|Poison|Deoderant|Hearing|Wind Pressure|Anti-Theft|Sobriety/],
    ["defence", /Defense|Guard|Protection|Health|Recover|Absolute|Fortification|Def Lock|Vitality|Guts|Evasion|Evade|Survivor|Adaptation|Relief|Mindfulness|Reinforcement|Light Tread|Stamina|Everlasting|Adrenaline|Passive/],
    ["attack", /Attack|Sharpness|Artisan|Expert|Edgemaster|Sword|Issen|Furious|Determination|Crit|Breaking|Drawing|Combo|Rush|Thunder Clad|Dissolver|Tenderizer|Element|Assault|Lavish|Bomb Boost|Fencing|Power|Rage|Ceaseless|Sharpening|Handling|Trained|Skilled|Compensation|Three Worlds|Reflect|Grace|Vampirism|Dark Pulse|Lone Wolf|Shiriagari|Focus|Iron Arm|Encourage|Status|Combat|Obscurity/]
  ];

  function el(tag, cls, text) { return UI.el(tag, cls, text); }

  function signed(v) { return v > 0 ? "+" + v : String(v); }

  /**
   * host: {box, data, mine, getSet(), gender(), loadForSet(set) -> Promise, compute(set), typeOf(cls),
   *        weaponIcon(cls, weapon), pieceIcon(slot, piece), itemIcon(id), treeName(id), thresholds(tree),
   *        deltaNode(before, after), piece(slot, id), loadSet(set, note) -> Promise}
   */
  function create(host) {
    var R = host.data.rules;
    var f = {
      q: "", cat: "all", wanted: [], weaponClass: null, gender: null, hunterType: "any", hr: "", gr: "",
      ownedOnly: false, allowZenith: true, allowTower: true, keep: {},
      engine: null, worker: null, running: false, cancelling: false, progress: null,
      result: null, shown: null, error: "", compare: []
    };
    var trees = null;   // the trees the picker offers: [{tree, name, cat, levels, text}]

    function pickable() {
      if (trees) return trees;
      trees = [];
      R.trees.forEach(function (t) {
        var levels = host.thresholds(t);
        if (!/[A-Za-z]/.test(t.name) || !levels.length) return;
        var cat = t.weapon_class !== null && t.weapon_class !== undefined ? "tech" : "other";
        if (cat !== "tech") {
          for (var i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i][1].test(t.name)) { cat = CATEGORY_RULES[i][0]; break; }
        }
        trees.push({ tree: t.id, name: t.name, cat: cat, levels: levels,
                     text: (t.name + " " + levels.map(function (l) { return R.skillName(l[1]); }).join(" ")).toLowerCase() });
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

    function wholeOrEmpty(v, max) {
      var n = Math.trunc(Number(v));
      return v === "" || !isFinite(n) || n < 1 ? 0 : Math.min(n, max);
    }

    /** The query for the engine (the interface in the header). */
    function query() {
      var set = host.getSet();
      var cls = effClass();
      var hr = wholeOrEmpty(f.hr, 999), gr = wholeOrEmpty(f.gr, 999);
      var fixed = {};
      set.armour.forEach(function (a) { if (f.keep[a[0]] && a[1]) fixed[a[0]] = a[1]; });
      var i = imp();
      return {
        wanted: f.wanted.map(function (w) { return { skill: w.skill, level: w.points, tree: w.tree }; }),
        weaponClass: cls >= 0 ? cls : null,
        weaponId: f.keep.weapon && cls >= 0 && set.weapon[0] === cls ? set.weapon[1] : 0,
        gender: effGender(),
        hunterType: effType(),
        rankMax: hr || gr ? { hr: hr || (gr ? 999 : 0), gr: gr } : null,
        ownedOnly: !!(f.ownedOnly && i),
        owned: i || null,
        allowZenith: f.allowZenith,
        allowTowerDecos: f.allowTower,
        fixed: fixed,
        exclude: [],
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
      f.cancelling = false;
    }

    function search() {
      if (!f.wanted.length || f.running) return;
      f.error = "";
      f.result = null;
      f.shown = null;
      f.compare = [];
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
        w.onmessage = function (e) {
          if (w !== f.worker) return;
          var m = e.data || {};
          if (m.type === "progress") { f.progress = { done: m.done || 0, total: m.total || 0 }; renderProgress(); }
          else if (m.type === "done") finish(m.result, f.cancelling);
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

    function cancel() {
      if (!f.worker) return;
      f.cancelling = true;
      f.worker.postMessage({ type: "cancel" });
      var w = f.worker;
      // an engine that answers a cancel with what it found so far gets a moment to do so
      setTimeout(function () {
        if (f.worker === w) { endWorker(); f.error = "Search stopped."; render(); }
      }, 1500);
      render();
    }

    function fail(message) {
      endWorker();
      f.error = "The search did not finish: " + message + ".";
      render();
    }

    function finish(result, stopped) {
      endWorker();
      f.result = result || { results: [] };
      f.result.stopped = !!stopped;
      var list = (f.result.results || []).slice(0, MAX_RESULTS).filter(function (r) { return r && r.set; });
      var sets = list.map(function (r) { return Calc.normalize(r.set); });
      Promise.all(sets.map(host.loadForSet)).then(function () {
        f.shown = list.map(function (r, i) { return { engine: r, set: sets[i], calc: host.compute(sets[i]) }; });
        render();
      }, function () {
        f.error = "Could not load the pieces of the results. Try again.";
        render();
      });
    }

    // ---- the skill picker (left) ---------------------------------------------------------------------------

    function wantedOf(tree) { return f.wanted.filter(function (w) { return w.tree === tree; })[0] || null; }

    function toggleWanted(t, level) {
      var w = wantedOf(t.tree);
      if (w && w.skill === level[1]) f.wanted = f.wanted.filter(function (x) { return x !== w; });
      else if (w) { w.skill = level[1]; w.points = level[0]; }
      else f.wanted.push({ tree: t.tree, skill: level[1], points: level[0], name: t.name });
      render();
    }

    function pickerPanel() {
      var box = UI.section("Skills you want", "pick a level");
      box.classList.add("sb-find-picker");
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
          var first = box.querySelector(".sb-level-chip");
          if (first) { e.preventDefault(); first.focus(); }
        }
      });
      box.appendChild(search);
      var cats = el("div", "sb-chips sb-cats");
      cats.setAttribute("role", "group");
      cats.setAttribute("aria-label", "Skill categories");
      CATEGORIES.forEach(function (c) {
        cats.appendChild(chip(c[1], f.cat === c[0], "find|cat|" + c[0], function () { f.cat = c[0]; render(); }));
      });
      box.appendChild(cats);
      var list = el("ul", "sb-skill-picks");
      list.id = "sb-find-trees";
      box.appendChild(list);
      return box;
    }

    function renderTrees() {
      var list = document.getElementById("sb-find-trees");
      if (!list) return;
      list.textContent = "";
      var words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      var shown = pickable().filter(function (t) {
        return (f.cat === "all" || t.cat === f.cat) && words.every(function (w) { return t.text.indexOf(w) !== -1; });
      });
      if (!shown.length) { list.appendChild(el("li", "note-text", "No skill matches.")); return; }
      shown.forEach(function (t) {
        var w = wantedOf(t.tree);
        var li = el("li", "sb-skill-pick" + (w ? " is-wanted" : ""));
        li.setAttribute("data-tree", t.tree);
        var name = el("span", "sb-skill-pick-name", t.name);
        li.appendChild(name);
        var levels = el("span", "sb-level-chips");
        levels.setAttribute("role", "group");
        levels.setAttribute("aria-label", t.name + " levels");
        t.levels.forEach(function (l) {
          var b = chip(R.skillName(l[1]) + " " + l[0], !!(w && w.skill === l[1]), "find|want|" + t.tree + "|" + l[1], function () { toggleWanted(t, l); });
          b.classList.add("sb-level-chip");
          b.setAttribute("data-skill", l[1]);
          b.title = (w && w.skill === l[1] ? "Remove " : "Want ") + R.skillName(l[1]) + " (" + l[0] + " points)";
          levels.appendChild(b);
        });
        li.appendChild(levels);
        list.appendChild(li);
      });
    }

    // ---- wanted skills and filters (right, top) -------------------------------------------------------------

    function wantedPanel() {
      var box = UI.section("Search", f.wanted.length ? f.wanted.length + " skill" + (f.wanted.length === 1 ? "" : "s") : "");
      box.id = "sb-find-search";
      var chips = el("div", "sb-wanted");
      chips.id = "sb-find-wanted";
      if (!f.wanted.length) chips.appendChild(el("p", "note-text", "Pick the skills you want from the list: one level per skill."));
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
      box.appendChild(chips);
      box.appendChild(filters());
      var actions = el("div", "bui-actions sb-find-actions");
      var go = el("button", "btn btn-primary", f.running ? "Searching" : "Find sets");
      go.type = "button";
      go.id = "sb-find-go";
      go.setAttribute("data-focus", "find|go");
      go.disabled = !f.wanted.length || f.running;
      go.addEventListener("click", search);
      actions.appendChild(go);
      if (f.running) {
        var stop = el("button", "ghost-btn small", f.cancelling ? "Stopping" : "Cancel");
        stop.type = "button";
        stop.id = "sb-find-cancel";
        stop.setAttribute("data-focus", "find|cancel");
        stop.disabled = f.cancelling;
        stop.addEventListener("click", cancel);
        actions.appendChild(stop);
      }
      if (f.wanted.length && !f.running) {
        var clear = el("button", "ghost-btn small", "Clear skills");
        clear.type = "button";
        clear.setAttribute("data-focus", "find|clear");
        clear.addEventListener("click", function () { f.wanted = []; render(); });
        actions.appendChild(clear);
      }
      var prog = el("div", "sb-progress");
      prog.id = "sb-find-progress";
      prog.setAttribute("role", "status");
      actions.appendChild(prog);
      box.appendChild(actions);
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
        : "Starting the search"));
    }

    function chip(text, pressed, focusKey, onClick) {
      var b = el("button", "chip sb-chip", text);
      b.type = "button";
      b.setAttribute("aria-pressed", pressed ? "true" : "false");
      if (focusKey) b.setAttribute("data-focus", focusKey);
      b.addEventListener("click", onClick);
      return b;
    }

    function group(label, node) {
      var g = el("div", "sb-filter");
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

    function filters() {
      var box = el("div", "sb-filters");
      var cls = effClass();
      var classes = el("div", "sb-chips sb-class-chips");
      classes.setAttribute("role", "group");
      classes.setAttribute("aria-label", "Weapon class");
      classes.appendChild(chip("Any", cls < 0, "find|class|any", function () { f.weaponClass = -1; render(); }));
      host.data.types.forEach(function (t) {
        var b = chip("", cls === t.class, "find|class|" + t.class, function () { f.weaponClass = t.class; render(); });
        var img = el("img", "sb-icon sb-chip-icon");
        img.alt = "";
        img.src = host.weaponIcon(t.class, null);
        b.appendChild(img);
        b.appendChild(el("span", null, t.name));
        classes.appendChild(b);
      });
      box.appendChild(group("Weapon", classes));

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
        l.appendChild(input);
        rank.appendChild(l);
      });
      box.appendChild(group("Rank", rank));

      var opts = el("div", "sb-checks");
      var i = imp();
      opts.appendChild(check("Only what I own", f.ownedOnly && !!i, "find|owned", function (v) { f.ownedOnly = v; }, !i,
                             i ? "Only pieces and decorations " + i.name + " has" : "Load a character in Your character first"));
      opts.appendChild(check("Zenith pieces", f.allowZenith, "find|zenith", function (v) { f.allowZenith = v; }));
      opts.appendChild(check("Tower decorations (Road gems)", f.allowTower, "find|tower", function (v) { f.allowTower = v; }));
      box.appendChild(group("Allow", opts));

      var set = host.getSet();
      var keeps = el("div", "sb-checks");
      var any = false;
      if (set.weapon[0] >= 0 && set.weapon[1] && set.weapon[0] === cls) {
        var wname = weaponName(set.weapon[0], set.weapon[1]);
        keeps.appendChild(check("Weapon: " + wname, !!f.keep.weapon, "find|keep|weapon", function (v) { f.keep.weapon = v; }));
        any = true;
      }
      set.armour.forEach(function (a) {
        if (!a[1]) return;
        var p = host.piece(a[0], a[1]);
        keeps.appendChild(check(SLOT_NAMES[a[0]] + ": " + (p ? p.name : "#" + a[1]), !!f.keep[a[0]], "find|keep|" + a[0],
                                function (v) { f.keep[a[0]] = v; }));
        any = true;
      });
      if (any) box.appendChild(group("Keep from the builder", keeps));
      return box;
    }

    function weaponName(cls, id) {
      var w = host.data.weapons[cls];
      var item = w && w.byId[id];
      return item ? item.name : "#" + id;
    }

    // ---- results (right) -----------------------------------------------------------------------------------

    function freeSlots(c) {
      var free = 0;
      c.pieces.forEach(function (p) { if (p.piece) free += Math.max(0, p.slots.value - p.decos.used); });
      if (c.weaponSlots) free += Math.max(0, c.weaponSlots.capacity - c.weaponSlots.used);
      return free;
    }

    function met(c, w) {
      return c.active.some(function (s) {
        return !s.dropped && s.works && (s.skill === w.skill || (s.from === "points" && s.tree === w.tree && !s.negative && s.total >= w.points));
      });
    }

    function resultsPanel() {
      var box = el("section", "sb-find-results");
      box.id = "sb-find-results";
      box.setAttribute("aria-label", "Sets found");
      if (!f.result) {
        if (!f.running) box.appendChild(el("p", "sb-find-empty", "Sets that reach your skills show here, best first: all wanted skills, then " +
          "defence, free slots and fewer bad skills."));
        return box;
      }
      if (!f.shown) { box.appendChild(el("p", "sb-find-empty", "Loading the pieces of the sets found.")); return box; }
      var head = el("div", "sb-find-head");
      var n = f.shown.length;
      head.appendChild(el("h2", "sb-find-count", n ? n + (n === 1 ? " set found" : " sets found") : "No set found"));
      var stats = f.result.stats || {};
      var notes = [];
      if (f.result.stopped) notes.push("stopped early: these are the sets found so far");
      if (f.result.truncated) notes.push("the search hit its limit, so there may be other sets");
      if (stats.timeMs) notes.push((stats.timeMs / 1000).toFixed(1) + " s");
      if (notes.length) {
        var nt = el("p", "sb-find-note", notes.join(" · "));
        nt.id = "sb-find-truncated";
        head.appendChild(nt);
      }
      box.appendChild(head);
      if (!n) {
        box.appendChild(el("p", "sb-find-empty", "No set reaches all of these skills with these filters. Try fewer skills, lower levels, " +
          "or allow Zenith pieces and Tower decorations."));
        return box;
      }
      if (f.compare.length) box.appendChild(compareTable());
      var grid = el("div", "sb-results");
      f.shown.forEach(function (r, i) { grid.appendChild(resultCard(r, i)); });
      box.appendChild(grid);
      return box;
    }

    function resultCard(r, i) {
      var c = r.calc;
      var card = el("article", "sb-result");
      card.setAttribute("data-index", String(i));
      var head = el("header", "sb-result-head");
      head.appendChild(el("span", "sb-result-rank", "#" + (i + 1)));
      head.appendChild(el("strong", "sb-result-def", "Def " + c.defence.total));
      var free = freeSlots(c);   // the calculator's, as the compare table and the builder count them
      head.appendChild(el("span", "sb-result-free", free + " free slot" + (free === 1 ? "" : "s")));
      var res = el("span", "sb-result-res");
      RES_ORDER.forEach(function (k) {
        var v = c.res[k];
        res.appendChild(el("span", "sb-res is-" + k + (v < 0 ? " is-neg" : ""), RES_NAMES[k].charAt(0) + " " + signed(v)));
      });
      head.appendChild(res);
      card.appendChild(head);

      var ul = el("ul", "sb-result-pieces");
      if (c.weapon) ul.appendChild(pieceLine(host.weaponIcon(r.set.weapon[0], c.weapon), "Weapon", c.weapon.name, "", r.set.weapon[3]));
      else if (r.set.weapon[0] >= 0) { var t = host.typeOf(r.set.weapon[0]); ul.appendChild(pieceLine(host.weaponIcon(r.set.weapon[0], null), "Weapon", "Any " + (t ? t.name : "weapon"), "", [])); }
      c.pieces.forEach(function (p, k) {
        var a = r.set.armour[k];
        if (p.piece) ul.appendChild(pieceLine(host.pieceIcon(a[0], p.piece), SLOT_NAMES[a[0]], p.piece.name, "Lv " + p.level, a[3]));
        else ul.appendChild(pieceLine(host.pieceIcon(a[0], null), SLOT_NAMES[a[0]], "empty", "", []));
      });
      if (r.set.cuffs.length) {
        ul.appendChild(pieceLine(host.itemIcon(r.set.cuffs[0]), "Cuffs", r.set.cuffs.map(function (id) {
          var d = host.data.items[id]; return d ? d.name : "#" + id; }).join(", "), "", []));
      }
      card.appendChild(ul);

      var skills = el("div", "sb-result-skills");
      var wantedTrees = {};
      f.wanted.forEach(function (w) {
        wantedTrees[w.tree] = true;
        var ok = met(c, w);
        skills.appendChild(el("span", "sb-d " + (ok ? "is-up is-met" : "is-down is-unmet"), (ok ? "✓ " : "✗ ") + R.skillName(w.skill)));
      });
      c.active.forEach(function (s) {
        if (s.dropped || (s.tree && wantedTrees[s.tree] && s.from === "points" && !s.negative)) return;
        if (s.negative) skills.appendChild(el("span", "sb-d is-down", s.name));
        else if (s.works) skills.appendChild(el("span", "sb-d is-pts", s.name));
      });
      var dropped = c.active.filter(function (s) { return s.dropped; }).length;
      if (dropped) skills.appendChild(el("span", "sb-d is-down", dropped + " over the limit"));
      card.appendChild(skills);

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

    function pieceLine(src, slot, name, level, decos) {
      var li = el("li");
      var img = el("img", "sb-icon sb-result-icon");
      img.alt = "";
      img.src = src;
      li.appendChild(img);
      li.appendChild(el("span", "sb-result-slot", slot));
      var text = el("span", "sb-result-name", name + (level ? " " + level : ""));
      li.appendChild(text);
      if (decos && decos.length) {
        li.appendChild(el("span", "sb-result-decos", decos.map(function (id) { var d = host.data.items[id]; return d ? d.name : "#" + id; }).join(", ")));
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
      f.wanted.forEach(function (w) {
        row(R.skillName(w.skill), cols.map(function (c) { return met(c.calc, w) ? "✓" : "–"; }), "is-wanted");
      });
      var names = {};
      var order = [];
      cols.forEach(function (c) {
        c.calc.active.forEach(function (s) {
          if (s.dropped || names[s.skill]) return;
          if (f.wanted.some(function (w) { return w.skill === s.skill; })) return;
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

    function render() {
      var box = host.box;
      var focus = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute("data-focus");
      var sel = null;
      try { if (focus && typeof document.activeElement.selectionStart === "number") sel = [document.activeElement.selectionStart, document.activeElement.selectionEnd]; } catch (e) { sel = null; }
      box.textContent = "";
      var left = el("div", "sb-find-left");
      left.appendChild(pickerPanel());
      var right = el("div", "sb-find-right");
      right.appendChild(wantedPanel());
      right.appendChild(resultsPanel());
      box.appendChild(left);
      box.appendChild(right);
      renderTrees();
      renderProgress();
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

    return { render: render, characterChanged: characterChanged, query: query };
  }

  window.SetBuilderFind = { create: create };
})();
