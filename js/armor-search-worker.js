/* The skill search (js/armor-search.js) in a Web Worker, so a long search never freezes the Set builder.

   Messages in:   {type: "search", query}   starts a search (a running one is dropped)
                  {type: "cancel"}          drops the running search; nothing more is sent for it
   Messages out:  {type: "progress", done, total}   now and then while it runs
                  {type: "done", result}            {results, stats, truncated}; when the search could not run
                                                    (data did not load, bad query) results is empty and
                                                    stats.error says why

   The data (data/armor/*.json, data/weapons/index.json and the query's weapon class) is loaded once, from paths
   next to this file's folder, and kept for later searches. The search runs in short steps (STEP_MS) with a
   pause between them, so a "cancel" or a new "search" is heard at once.

   docs/armor-set-builder.md "Skill search". */
/* global importScripts, ArmorSearch */
// the page's ?v= on this file versions the scripts it loads too, so a new search engine is never mixed with an old one
var SCRIPT_V = self.location.search;
importScripts("armor-rules.js" + SCRIPT_V, "armor-calc.js" + SCRIPT_V, "armor-owned.js" + SCRIPT_V,
              "armor-rank.js" + SCRIPT_V, "armor-search.js" + SCRIPT_V);

(function () {
  "use strict";

  var STEP_MS = 40;
  var run = 0;          // the current search's number; an older one stops at its next step

  function getJson(rel) {
    return fetch(new URL("../" + rel, self.location.href).href).then(function (res) {
      if (!res.ok) throw new Error(rel + ": " + res.status);
      return res.json();
    });
  }

  function done(my, result) {
    if (my === run) self.postMessage({ type: "done", result: result });
  }

  function pump(my, job) {
    if (my !== run) return;
    var finished;
    try {
      finished = job.step(STEP_MS);
    } catch (err) {
      done(my, ArmorSearch.failed(err));
      return;
    }
    if (finished) done(my, job.result());
    else setTimeout(function () { pump(my, job); }, 0);
  }

  self.onmessage = function (event) {
    var msg = event.data || {};
    if (msg.type === "cancel") { run++; return; }
    if (msg.type !== "search") return;
    var my = ++run;
    ArmorSearch.loadData(getJson, msg.query).then(function () {
      if (my !== run) return;
      var job = ArmorSearch.start(msg.query, function (p) {
        if (my === run) self.postMessage({ type: "progress", done: p.done, total: p.total });
      });
      pump(my, job);
    }).catch(function (err) { done(my, ArmorSearch.failed(err)); });
  };
})();
