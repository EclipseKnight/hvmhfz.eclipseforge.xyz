/* A stand-in for js/armor-search-worker.js (the armour search engine, docs/armor-set-builder.md "Skill search") that
   the Set builder checks serve in its place, so they test the Find sets tab against the worker's messages without
   depending on the engine's answers:
     {type: "search", query} -> {type: "progress", done, total} x3 -> {type: "done", result}
     {type: "cancel"}        -> nothing more for that search (as the real worker)
   The result holds two fixed sets made of real pieces (Rathalos Helm/Mail/Greaves; the second with an Attack G in
   the helm) for the query's weapon class, and echoes the query in result.stats.query so a check can read what the
   page sent; met and missing are left to the page's calculator (met: true, missing: []). A query whose first wanted
   skill is 0 answers {type: "error"}; one with 4 or more wanted skills is slow (a second a step), so a check can
   cancel it. Only the fast checks (dev/check-set-builder*.js) use it; dev/check-set-builder.js also runs the real
   worker. */
"use strict";

var timer = null;

function sets(query) {
  var cls = query.weaponClass === null || query.weaponClass === undefined ? 7 : query.weaponClass;
  var weapon = cls === 7 ? [7, 31, [], []] : [cls, 0, [], []];
  var base = [["head", 29, 7, []], ["chest", 32, 7, []], ["arms", 0, 1, []], ["waist", 0, 1, []], ["legs", 33, 7, []]];
  var withDeco = JSON.parse(JSON.stringify(base));
  withDeco[0][3] = [5100];
  return [
    { set: { v: 1, data: "", weapon: weapon, armour: withDeco, cuffs: [] }, skills: [], extraSkills: [], defence: 0, res: {}, freeSlots: 5, score: 2,
      met: true, missing: [] },
    { set: { v: 1, data: "", weapon: weapon, armour: base, cuffs: [] }, skills: [], extraSkills: [], defence: 0, res: {}, freeSlots: 6, score: 1,
      met: true, missing: [] }
  ];
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.type === "cancel") {
    clearTimeout(timer);
    return;
  }
  if (m.type !== "search") return;
  var query = m.query || {};
  if (query.wanted && query.wanted[0] && query.wanted[0].skill === 0) {
    self.postMessage({ type: "error", message: "no such skill" });
    return;
  }
  var step = 0;
  function tick() {
    step++;
    self.postMessage({ type: "progress", done: step * 100, total: 300 });
    if (step < 3) { timer = setTimeout(tick, (query.wanted || []).length >= 4 ? 1000 : 30); return; }
    self.postMessage({ type: "done", result: { results: sets(query), stats: { query: query, ms: 90 }, truncated: false } });
  }
  timer = setTimeout(tick, 10);
};
