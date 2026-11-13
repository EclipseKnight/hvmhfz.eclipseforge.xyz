/* Material lists of a weapon or armour piece, for /equipment.html (js/equipment.js) and the Weapons page's
   detail (js/weapons.js). Data from dev/make-use-data.py:
   data/equipment/<slot>/names.json  {"names": [[name, rarity, parent id] or 0 by id]}
   data/equipment/<slot>/<id // 1024>.json  {"items": {id: [name, icon]}, "eq": {id: {"make": [[kind ("c" made,
   "u" upgraded, "t" transmog unlock), from id, [[item, qty]], zenny, note]], "tower": [[stat, levels, mats]]}}}
   window.HvMaterials.load(slot, id) -> Promise of {names, entry (or null), items};
   window.HvMaterials.list(data, slot, id) -> a <div> with one block per way to make it, each material linked to
   /item.html?id=, the piece it is upgraded from linked to /equipment.html. */
(function () {
  "use strict";

  var CHUNK = 1024;
  var cache = {};

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function json(path) {
    if (!cache[path]) {
      cache[path] = fetch(path).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
    }
    return cache[path];
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }

  function load(slot, id) {
    var base = "/data/equipment/" + slot + "/";
    return Promise.all([json(base + "names.json"), json(base + Math.floor(id / CHUNK) + ".json").catch(function () { return null; })])
      .then(function (res) {
        var chunk = res[1] || { items: {}, eq: {} };
        return { names: res[0].names || [], entry: chunk.eq[id] || null, items: chunk.items || {} };
      });
  }

  function name(data, id) {
    var e = data.names[id];
    return e ? e[0] : "Piece " + id;
  }

  function pieceLink(data, slot, id) {
    var a = el("a", null, name(data, id));
    a.href = "/equipment.html?slot=" + slot + "&id=" + id;
    return a;
  }

  function itemLink(data, id, qty) {
    var row = data.items[id] || ["Item " + id, ""];
    var a = el("a", "src-mat");
    a.href = "/item.html?id=" + id;
    if (row[1]) {
      var img = el("img");
      img.src = "/assets/icons/1x/" + row[1] + ".png";
      img.alt = "";
      img.loading = "lazy";
      a.appendChild(img);
    }
    a.appendChild(el("span", null, row[0] + " x" + num(qty)));
    return a;
  }

  function mats(data, list) {
    var ul = el("ul", "mat-list");
    if (!list.length) ul.appendChild(el("li", "note-text", "No materials, only zenny."));
    list.forEach(function (m) { ul.appendChild(el("li")).appendChild(itemLink(data, m[0], m[1])); });
    return ul;
  }

  /* One block per way to make it: made from scratch, upgraded from a piece, transmog unlock. */
  function list(data, slot, id) {
    var box = el("div", "mat-ways");
    var make = (data.entry && data.entry.make) || [];
    if (!make.length) box.appendChild(el("p", "note-text", "No smithy recipe makes this piece (it comes from elsewhere, or is a starting piece)."));
    make.forEach(function (m) {
      var way = el("div", "mat-way");
      var head = el("p", "mat-way-head");
      if (m[0] === "u") {
        head.appendChild(document.createTextNode("Upgrade from "));
        head.appendChild(pieceLink(data, slot, m[1]));
      } else {
        head.appendChild(document.createTextNode(m[0] === "t" ? "Transmog unlock (its look only)" : "Make it at the smithy"));
      }
      var facts = [];
      if (m[3] !== null && m[3] !== undefined) facts.push(num(m[3]) + " zenny");
      if (m[4]) facts.push(m[4]);
      if (facts.length) head.appendChild(el("span", "where-facts", " · " + facts.join(" · ")));
      way.appendChild(head);
      way.appendChild(mats(data, m[2]));
      box.appendChild(way);
    });
    return box;
  }

  window.HvMaterials = { load: load, list: list, mats: mats, name: name, pieceLink: pieceLink };
})();
