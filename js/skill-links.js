/* The "Skills" line of the item and equipment pages: the skill points a decoration, Road gem or armour piece
   gives, a piece's automatic skills, and a Tower sigil's effect, each linked to its page on /skill.html.
   Data: data/skills/index.json (names), data/skills/items/<id // 1024>.json and
   data/skills/pieces/<slot>/<id // 1024>.json (dev/make-skill-data.py).
   window.HvSkillLinks.item(id) and .piece(slot, id) return a <p> at once (hidden) and fill it when the data
   comes in; a thing that gives no skill keeps it hidden. */
(function () {
  "use strict";

  var CHUNK = 1024;
  var cache = {};

  function getJson(path) {
    if (!cache[path]) {
      cache[path] = fetch(path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    return cache[path];
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function signed(n) { return (n > 0 ? "+" : "") + n; }

  function names(index) {
    var trees = {}, skills = {};
    (index.trees || []).forEach(function (t) {
      trees[t[0]] = t[1];
      t[3].forEach(function (l) { skills[l[1]] = [l[2], t[0]]; });
    });
    return { trees: trees, skills: skills };
  }

  function link(text, href) {
    var a = el("a", null, text);
    a.href = href;
    return a;
  }

  function list(p, label, parts) {
    if (!parts.length) return;
    if (p.childNodes.length) p.appendChild(document.createTextNode(" · "));
    p.appendChild(el("strong", null, label + ": "));
    parts.forEach(function (node, i) {
      if (i) p.appendChild(document.createTextNode(", "));
      p.appendChild(node);
    });
    p.hidden = false;
  }

  function pointsLinks(lines, n) {
    return (lines || []).map(function (l) {
      return link((n.trees[l[0]] || "Skill " + l[0]) + " " + signed(l[1]), "/skill.html?id=" + l[0]);
    });
  }

  function line() {
    var p = el("p", "page-sub skill-line");
    p.hidden = true;
    return p;
  }

  function item(id) {
    var p = line();
    Promise.all([getJson("/data/skills/index.json"), getJson("/data/skills/items/" + Math.floor(id / CHUNK) + ".json")])
      .then(function (res) {
        var index = res[0], data = res[1];
        if (!index || !data) return;
        var n = names(index);
        list(p, "Skills", pointsLinks(data.d && data.d[id], n));
        var s = data.s && data.s[id];
        if (s !== undefined && index.sigils[s]) {
          list(p, "Tower sigil", [link(index.sigils[s][4] || index.sigils[s][1], "/skill.html?sigil=" + id)]);
        }
      });
    return p;
  }

  function piece(slot, id) {
    var p = line();
    Promise.all([getJson("/data/skills/index.json"),
                 getJson("/data/skills/pieces/" + slot + "/" + Math.floor(id / CHUNK) + ".json")])
      .then(function (res) {
        var index = res[0], data = res[1];
        if (!index || !data) return;
        var n = names(index);
        list(p, "Skills", pointsLinks(data.p && data.p[id], n));
        list(p, "Automatic skill", ((data.a && data.a[id]) || []).map(function (s) {
          var k = n.skills[s] || ["Skill " + s, null];
          return k[1] === null ? el("span", null, k[0]) : link(k[0], "/skill.html?id=" + k[1]);
        }));
      });
    return p;
  }

  window.HvSkillLinks = { item: item, piece: piece };
})();
