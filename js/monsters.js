/* Monster field guide: index page. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var state = { q: "", category: "", size: "", sort: "name" };
  var all = [];
  var kills = {};      // server wide, by normalized server name
  var mine = null;     // the signed-in player's hunts over all characters, by normalized server name

  /* The field guide's names come from the Ferias data; the server's kill log uses Erupe's names.
     Where they differ, this maps the guide's slug to the server's name. */
  var SERVER_NAME = {
    mira: "Fatalis", miraval: "Crimson Fatalis", miraru: "White Fatalis",
    kushasabi: "Rusted Kushala Daora",
    aquraj: "Aqra Jebia", aqura: "Aqra Vashimu",
    hipu: "Hypnocatrice", hipusiro: "White Hypnoc",
    vol: "Lavasioth", volaka: "Red Lavasioth",
    espcya: "Burning Espinas", espsiro: "Pearl Espinas",
    olgk: "Kamu Orugaron", olgn: "Nono Orugaron",
    goglf_r: "Gougarf", goglf_l: "Gougarf",   // Lolo and Ray are hunted together as Gougarf
    elze: "Eruzerion", lavieG: "Berserk Raviente",
    dolem1: "Block1 Duremudira", dolem2: "Block2 Duremudira", dolem: "Musou Duremudira",
    bogaK: "Musou Bogabadorumu", zeruK: "Musou Zerureusu", nalgaK: "Blinking Nargacuga", joeK: "Savage Deviljho"
  };
  /* The four Musou entries are all called "Musou" in the guide's data. */
  var DISPLAY_NAME = {
    bogaK: "Musou Bogabadorumu", zeruK: "Musou Zerureusu", nalgaK: "Musou Nargacuga", joeK: "Musou Deviljho"
  };

  /* Small monsters (the guide's "Other" group, apart from King Shakalaka) are not in the server's kill
     log, so they get no hunt count. */
  function isSmall(monster) {
    return monster.category === "Other" && monster.slug !== "cyacyaKing";
  }

  function serverKey(monster) {
    return norm(SERVER_NAME[monster.slug] || monster.name);
  }

  function signedIn() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (error) {
      return "";
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function norm(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function num(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  function iconFor(monster) {
    if (monster.icon) {
      var img = el("img");
      img.src = "/assets/monsters/icons/" + monster.icon;
      img.alt = "";
      img.loading = "lazy";
      img.width = 96;
      img.height = 96;
      return img;
    }
    var fallback = el("span", "monster-initial", (monster.name || "?").charAt(0).toUpperCase());
    return fallback;
  }

  function card(monster) {
    var tile = el("article", "tile monster-tile");

    var link = el("a", "monster-link");
    link.href = "/monster.html?m=" + encodeURIComponent(monster.slug);

    var art = el("div", "monster-art");
    art.appendChild(iconFor(monster));
    link.appendChild(art);

    var body = el("div", "monster-body");
    body.appendChild(el("h2", "monster-name", monster.name));
    body.appendChild(el("p", "tile-meta", isSmall(monster) ? "Small monster" : monster.category));
    if (monster.variants && monster.variants.length) {
      var chips = el("div", "chip-list");
      monster.variants.forEach(function (label) { chips.appendChild(el("span", "chip", label)); });
      body.appendChild(chips);
    }
    link.appendChild(body);

    tile.appendChild(link);
    if (isSmall(monster)) return tile;

    var key = serverKey(monster);
    var stat = el("div", "tile-stat");
    function line(value, label, extra) {
      var row = el("span", "tile-stat-line" + (extra ? " " + extra : ""));
      row.appendChild(el("span", "tile-stat-value", num(value || 0)));
      row.appendChild(el("span", "tile-stat-label", label));
      stat.appendChild(row);
    }
    line(kills[key], "on the server");
    if (mine) line(mine[key], "by you", "tile-stat-mine");
    tile.appendChild(stat);
    return tile;
  }

  function render() {
    var box = document.getElementById("monsters");
    clear(box);
    var q = state.q.trim().toLowerCase();
    var rows = all.filter(function (m) {
      if (state.category && m.category !== state.category) return false;
      if (state.size === "large" && isSmall(m)) return false;
      if (state.size === "small" && !isSmall(m)) return false;
      if (!q) return true;
      return (m.name + " " + m.category).toLowerCase().indexOf(q) !== -1;
    });
    rows.sort(function (a, b) {
      if (state.sort === "kills" || (state.sort === "mine" && mine)) {
        var counts = state.sort === "mine" ? mine : kills;
        var ka = isSmall(a) ? -1 : counts[serverKey(a)] || 0;
        var kb = isSmall(b) ? -1 : counts[serverKey(b)] || 0;
        if (ka !== kb) return kb - ka;
      }
      return a.name.localeCompare(b.name);
    });
    rows.forEach(function (m) { box.appendChild(card(m)); });
    document.getElementById("monster-results").textContent = rows.length + (rows.length === 1 ? " monster" : " monsters");
    if (!rows.length) box.appendChild(el("p", "empty-state", "No monster matches that search."));
  }

  function fillCategories() {
    var select = document.getElementById("monster-category");
    var cats = {};
    all.forEach(function (m) { cats[m.category] = true; });
    Object.keys(cats).sort().forEach(function (c) {
      var option = el("option", null, c);
      option.value = c;
      select.appendChild(option);
    });
  }

  function load() {
    fetch("/data/monsters/index.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        data.forEach(function (m) { if (DISPLAY_NAME[m.slug]) m.name = DISPLAY_NAME[m.slug]; });
        all = data;
        document.getElementById("monster-total").textContent = data.length;
        fillCategories();
        render();
      })
      .catch(function () {
        document.getElementById("monsters").appendChild(el("p", "empty-state", "Could not load the monster database."));
      });

    fetch(API + "/api/public/monsters?limit=300")
      .then(function (r) { return r.json(); })
      .then(function (list) {
        list.forEach(function (m) { kills[norm(m.name)] = m.kills; });
        render();
      })
      .catch(function () { /* counts are optional */ });

    loadMine();
  }

  /* Signed in: add up the kill logs of all the player's characters (the same per-character call the
     account page's hunt log uses). Optional: any failure just leaves the "by you" counts out. */
  function loadMine() {
    var value = signedIn();
    if (!value) return;
    function get(path) {
      return fetch(API + path, { headers: { Authorization: "Bearer " + value }, cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }
    get("/api/account/characters")
      .then(function (characters) {
        return Promise.all((characters || []).map(function (c) {
          return get("/api/account/characters/" + encodeURIComponent(c.id) + "/hunts");
        }));
      })
      .then(function (hunts) {
        var totals = {};
        hunts.forEach(function (h) {
          (h.monsters || []).forEach(function (m) {
            var key = norm(m.name);
            totals[key] = (totals[key] || 0) + Number(m.kills || 0);
          });
        });
        mine = totals;
        document.getElementById("monster-sort-mine").hidden = false;
        render();
      })
      .catch(function () { /* optional */ });
  }

  document.getElementById("monster-search").addEventListener("input", function (event) {
    state.q = event.target.value;
    render();
  });
  document.getElementById("monster-category").addEventListener("change", function (event) {
    state.category = event.target.value;
    render();
  });
  document.getElementById("monster-size").addEventListener("change", function (event) {
    state.size = event.target.value;
    render();
  });
  document.getElementById("monster-sort").addEventListener("change", function (event) {
    state.sort = event.target.value;
    render();
  });

  load();
})();
