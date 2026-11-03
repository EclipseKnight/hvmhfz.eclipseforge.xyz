/* Monster links: the field guide page (/monster.html?m=<slug>) for a monster however a page knows it:
   by the server's monster id (the API's kill counts and hunt logs send {id, name}), by the server's
   name ("Lavasioth", "Pearl Espinas"), or by the guide's own name (the quest catalog uses those).

   The table is data/monsters/index.json: each entry has its slug, name, `ids` (the game's monster ids,
   as data/monster-ids.json) and `serverNames` (the server's names where they differ from the guide's).
   A monster the guide has no page for gets the field guide searching for its name instead.

   Browser: cell.appendChild(MonsterLinks.anchor({id: 75, name: "Lavasioth"})), or
            MonsterLinks.load().then(function (links) { a.href = links.href("Volganos"); })
   Node (dev/check-catalog-monsters.js): require("./js/monster-links.js").build(indexJson) */
(function (root) {
  "use strict";

  function norm(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function build(list) {
    var byId = {}, byName = {};
    (list || []).forEach(function (m) {
      (m.ids || []).forEach(function (id) { if (!byId[id]) byId[id] = m; });
      [m.name].concat(m.serverNames || []).forEach(function (name) {
        if (!byName[norm(name)]) byName[norm(name)] = m;
      });
    });

    /* The guide entry for a monster: find(75), find("Lavasioth"), find({id: 75, name: "Lavasioth"}). */
    function find(monster) {
      if (monster === null || monster === undefined) return null;
      if (typeof monster === "number") return byId[monster] || null;
      if (typeof monster === "string") return byName[norm(monster)] || null;
      var id = monster.id !== undefined ? monster.id : monster.monsterId;
      return (id !== undefined && id !== null && byId[id]) || byName[norm(monster.name || monster.monster)] || null;
    }

    function href(monster) {
      var hit = find(monster);
      if (hit) return "/monster.html?m=" + encodeURIComponent(hit.slug);
      var name = typeof monster === "string" ? monster : monster && (monster.name || monster.monster);
      return "/monsters.html" + (name ? "?q=" + encodeURIComponent(name) : "");
    }

    /* An <a> to the monster's page with `text` (default: the name the caller has), for table cells. */
    function link(monster, text) {
      var a = document.createElement("a");
      a.href = href(monster);
      a.textContent = text !== undefined ? text
        : typeof monster === "string" ? monster : (monster && (monster.name || monster.monster)) || "Unknown";
      return a;
    }

    return { find: find, href: href, link: link, list: list || [] };
  }

  var loading = null;
  function load() {
    if (!loading) {
      loading = fetch("/data/monsters/index.json")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .catch(function () { return []; })
        .then(build);
    }
    return loading;
  }

  /* An <a> for a table cell, made at once: it points at the guide's search for the name until the index
     has loaded, then at the monster's page. anchor({id: 75, name: "Lavasioth"}) */
  function anchor(monster, text) {
    var a = document.createElement("a");
    var name = typeof monster === "string" ? monster : (monster && (monster.name || monster.monster)) || "Unknown";
    a.textContent = text !== undefined ? text : name;
    a.href = "/monsters.html?q=" + encodeURIComponent(name);
    load().then(function (links) { a.href = links.href(monster); });
    return a;
  }

  var api = { build: build, load: load, anchor: anchor, norm: norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MonsterLinks = api;
})(this);
