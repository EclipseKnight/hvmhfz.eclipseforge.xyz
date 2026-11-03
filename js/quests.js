/* Quest catalog: every quest file on the server, searchable and filterable. */
(function () {
  "use strict";

  var PAGE = 40;
  var state = { all: [], shown: [], page: 0, q: "", rank: "", type: "", area: "", monster: "", links: null };

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
      var nameLink = el("a", null, quest.name);
      nameLink.href = "/quest.html?id=" + quest.id;
      nameCell.appendChild(nameLink);
      nameCell.appendChild(el("span", "cell-sub muted", "#" + quest.id + (quest.nameJp !== quest.name ? " · " + quest.nameJp : "")));
      tr.appendChild(nameCell);

      tr.appendChild(el("td", null, quest.category));
      tr.appendChild(el("td", null, quest.area || "-"));
      tr.appendChild(el("td", "quest-objective", quest.objective || quest.objectiveJp || "-"));

      var monCell = el("td", "monster-icons");
      if (!quest.monsters.length) monCell.appendChild(el("span", "muted", "-"));
      quest.monsters.forEach(function (name) {
        // Every name is the field guide's (dev/make-quest-monsters.py); one without a page is plain text.
        var hit = state.links.find(name);
        var link = el(hit ? "a" : "span", "monster-chip");
        if (hit) link.href = state.links.href(hit);
        link.title = hit ? name : name + " (no field guide page yet)";
        if (hit && hit.icon) {
          var img = el("img");
          img.src = "/assets/monsters/icons/" + hit.icon;
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
    MonsterLinks.load().then(function (links) {
      state.links = links;
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

      // ?q= opens the catalog searching (the quest page's category link), ?monster= filtered to one
      // monster (a monster page's quest link).
      var params = new URLSearchParams(window.location.search);
      state.q = (params.get("q") || "").trim();
      document.getElementById("quest-search").value = state.q;
      var monster = params.get("monster") || "";
      if (monsters[monster]) {
        state.monster = monster;
        document.getElementById("quest-monster").value = monster;
      } else if (monster) {
        state.q = monster; // no quest lists it: the search says so instead of showing every quest
        document.getElementById("quest-search").value = monster;
      }
      wire();
      apply();
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
