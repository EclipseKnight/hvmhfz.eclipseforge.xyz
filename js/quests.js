/* Quest catalog: every quest file on the server, searchable and filterable. */
(function () {
  "use strict";

  var PAGE = 40;
  var state = { all: [], shown: [], page: 0, q: "", rank: "", type: "", area: "", monster: "", icons: {} };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function get(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /** Rank tokens that appear in quest categories, longest first so "G★7 Event" wins over "G". */
  var RANKS = [
    [/G★\d+/i, null], [/Supremacy\s*★?\s*\d*/i, "Supremacy"], [/Zenith/i, "Zenith"],
    [/Hardcore|剛種/i, "Hardcore"], [/G Rank|Ｇ級/i, "G Rank"], [/HR\s*\d+/i, null],
    [/★\s*\d+/, null], [/Master Rank/i, "Master Rank"], [/High Rank/i, "High Rank"], [/Low Rank/i, "Low Rank"]
  ];

  function rankOf(category) {
    for (var i = 0; i < RANKS.length; i++) {
      var m = category.match(RANKS[i][0]);
      if (m) return (RANKS[i][1] || m[0]).replace(/\s+/g, " ").trim().replace(/Ｇ/g, "G");
    }
    return "Unranked";
  }

  /** The quest type: the category with rank tokens and the word "Quest" taken out. */
  function typeOf(category) {
    var text = category;
    for (var i = 0; i < RANKS.length; i++) text = text.replace(RANKS[i][0], " ");
    text = text.replace(/Quest|Event|クエスト/gi, " ").replace(/\s+/g, " ").trim();
    return text || "Other";
  }

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  /** The monster index names a few elders oddly ("Black" for Fatalis, slug "mira"); map those here. */
  var SYNONYMS = {
    "Fatalis": "Black", "Crimson Fatalis": "Crimson", "White Fatalis": "White",
    "Berserk Laviente": "Berserk lavieG", "Laviente": "Berserk lavieG"
  };

  function iconFor(name) {
    var hit = state.icons[name] || state.icons[SYNONYMS[name]];
    if (hit) return hit;
    var key = slug(name);
    var names = Object.keys(state.icons);
    for (var i = 0; i < names.length; i++) {
      if (slug(names[i]) === key) return state.icons[names[i]];
    }
    for (var i = 0; i < names.length; i++) {
      if (names[i].toLowerCase().indexOf(name.toLowerCase()) === 0) return state.icons[names[i]];
    }
    return null;
  }

  function fill(select, values, label) {
    values.forEach(function (v) {
      var opt = el("option", null, v);
      opt.value = v;
      select.appendChild(opt);
    });
    select.options[0].textContent = label;
  }

  function apply() {
    var q = state.q.toLowerCase();
    state.shown = state.all.filter(function (quest) {
      if (state.rank && quest.rank !== state.rank) return false;
      if (state.type && quest.type !== state.type) return false;
      if (state.area && quest.area !== state.area) return false;
      if (state.monster && quest.monsters.indexOf(state.monster) === -1) return false;
      if (!q) return true;
      return (quest.name + " " + quest.nameJp + " " + quest.category + " " + (quest.objective || "") +
        " " + quest.monsters.join(" ") + " " + quest.id).toLowerCase().indexOf(q) >= 0;
    });
    state.page = 0;
    render();
  }

  function render() {
    var body = document.getElementById("quest-body");
    while (body.firstChild) body.removeChild(body.firstChild);
    var start = state.page * PAGE;
    var rows = state.shown.slice(start, start + PAGE);
    if (!rows.length) {
      var row = el("tr");
      var cell = el("td", "empty-cell", "No quests match those filters.");
      cell.colSpan = 6;
      row.appendChild(cell);
      body.appendChild(row);
    }
    rows.forEach(function (quest) {
      var tr = el("tr");

      var nameCell = el("td", "cell-name");
      nameCell.appendChild(el("span", null, quest.name));
      nameCell.appendChild(el("span", "cell-sub muted", "#" + quest.id + (quest.nameJp !== quest.name ? " · " + quest.nameJp : "")));
      tr.appendChild(nameCell);

      tr.appendChild(el("td", null, quest.category));
      tr.appendChild(el("td", null, quest.area || "-"));
      tr.appendChild(el("td", "quest-objective", quest.objective || quest.objectiveJp || "-"));

      var monCell = el("td", "monster-icons");
      if (!quest.monsters.length) monCell.appendChild(el("span", "muted", "-"));
      quest.monsters.forEach(function (name) {
        var icon = iconFor(name);
        var link = el("a", "monster-chip");
        link.href = "/monster.html?m=" + encodeURIComponent((icon && icon.slug) || slug(name));
        link.title = name;
        if (icon && icon.icon) {
          var img = el("img");
          img.src = "/assets/monsters/icons/" + icon.icon;
          img.alt = name;
          img.loading = "lazy";
          link.appendChild(img);
        } else {
          link.appendChild(el("span", null, name));
        }
        monCell.appendChild(link);
      });
      tr.appendChild(monCell);

      tr.appendChild(el("td", "num", String(quest.variants.length)));
      body.appendChild(tr);
    });

    var pages = Math.max(1, Math.ceil(state.shown.length / PAGE));
    document.getElementById("quest-page").textContent = "Page " + (state.page + 1) + " of " + pages +
      " · " + state.shown.length.toLocaleString() + " quests";
    document.getElementById("quest-prev").disabled = state.page === 0;
    document.getElementById("quest-next").disabled = state.page >= pages - 1;
  }

  function fail(message) {
    var alert = document.getElementById("quest-alert");
    alert.textContent = message;
    alert.hidden = false;
    var body = document.getElementById("quest-body");
    while (body.firstChild) body.removeChild(body.firstChild);
    var row = el("tr");
    var cell = el("td", "empty-cell", "The quest catalog could not load. Reload the page to try again.");
    cell.colSpan = 6;
    row.appendChild(cell);
    body.appendChild(row);
  }

  function start() {
    get("/data/monsters/index.json").then(function (list) {
      list.forEach(function (m) { state.icons[m.name] = m; });
      return get("/data/quests.json");
    }).then(function (data) {
      state.all = data.quests.map(function (q) {
        q.rank = rankOf(q.category);
        q.type = typeOf(q.category);
        return q;
      });
      document.getElementById("quest-count").textContent = state.all.length.toLocaleString() + " quests";

      var ranks = {}, types = {}, areas = {}, monsters = {};
      state.all.forEach(function (q) {
        ranks[q.rank] = 1;
        types[q.type] = 1;
        if (q.area) areas[q.area] = 1;
        q.monsters.forEach(function (m) { monsters[m] = 1; });
      });
      fill(document.getElementById("quest-rank"), Object.keys(ranks).sort(), "Any rank");
      fill(document.getElementById("quest-type"), Object.keys(types).sort(), "Any type");
      fill(document.getElementById("quest-area"), Object.keys(areas).sort(), "Any area");
      fill(document.getElementById("quest-monster"), Object.keys(monsters).sort(), "Any monster");

      state.shown = state.all;
      render();
      wire();
    }).catch(function (error) {
      fail("The quest catalog could not load (" + error.message + ").");
    });
  }

  function wire() {
    var timer = null;
    document.getElementById("quest-search").addEventListener("input", function (event) {
      clearTimeout(timer);
      var value = event.target.value;
      timer = setTimeout(function () { state.q = value.trim(); apply(); }, 150);
    });
    ["rank", "type", "area", "monster"].forEach(function (field) {
      document.getElementById("quest-" + field).addEventListener("change", function (event) {
        state[field] = event.target.value;
        apply();
      });
    });
    document.getElementById("quest-prev").addEventListener("click", function () {
      if (state.page > 0) { state.page--; render(); }
    });
    document.getElementById("quest-next").addEventListener("click", function () {
      if ((state.page + 1) * PAGE < state.shown.length) { state.page++; render(); }
    });
  }

  if (document.getElementById("quest-body")) start();
})();
