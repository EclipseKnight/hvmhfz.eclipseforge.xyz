/* Changelog: each release time is written in UTC in the page (<time class="cl-when" datetime="...Z">), which
   stays as it is without JavaScript. With js/time.js the text becomes the same moment in the visitor's own
   time zone (or UTC, as the footer's Times setting says), with the UTC time on hover. Dates without a time
   (class cl-date) are left alone. */
(function () {
  "use strict";

  function localize(root) {
    if (!window.HvTime) return;
    var times = (root || document).querySelectorAll("time.cl-when:not(.cl-date)");
    Array.prototype.forEach.call(times, function (el) {
      var stamp = el.getAttribute("datetime");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(stamp || "")) return;
      HvTime.set(el, stamp, {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { localize(document); });
  } else {
    localize(document);
  }
})();
