/* Hunter rank the way the game shows it. The server stores an HR number (1-999); the client shows a rank
   from it: 1-29 HR 1, 30-49 HR 2, 50-98 HR 3, 99-298 HR 4, 299-997 HR 5, 998 HR 6, 999 HR 7.
     HvHr.rank(hr)   -> the game's rank 1-7, or 0 for a missing, zero or invalid HR
     HvHr.label(hr)  -> "HR100 (HR4)" (stored number first, the game's rank in brackets), or "" when there is none
   Pages sort by the stored number; this is only for showing it. Under node (dev/check-hr.js) it is module.exports. */
(function (root) {
  "use strict";

  // [lowest stored HR, rank], highest first.
  var STEPS = [[999, 7], [998, 6], [299, 5], [99, 4], [50, 3], [30, 2], [1, 1]];

  function rank(hr) {
    var n = Number(hr);
    if (hr === null || hr === undefined || hr === "" || !isFinite(n)) return 0;
    n = Math.floor(n);
    for (var i = 0; i < STEPS.length; i++) {
      if (n >= STEPS[i][0]) return STEPS[i][1];
    }
    return 0;
  }

  function label(hr) {
    var r = rank(hr);
    return r ? "HR" + Math.floor(Number(hr)) + " (HR" + r + ")" : "";
  }

  var api = { rank: rank, label: label };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvHr = api;
})(typeof window !== "undefined" ? window : this);
