/* Changelog: after each release time in UTC (<time class="cl-when" datetime="...Z">), add the same moment in
   the visitor's own time zone. Without JavaScript the UTC text stays as it is. Dates without a time
   (class cl-date) are left alone. */
(function () {
  "use strict";

  function localize(root) {
    if (!window.Intl || !Intl.DateTimeFormat) return;
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat(undefined, {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short"
      });
    } catch (e) { return; }
    var zone = fmt.resolvedOptions().timeZone;
    if (zone === "UTC" || zone === "Etc/UTC") return; // the UTC text already is local time
    var times = (root || document).querySelectorAll("time.cl-when:not(.cl-date)");
    Array.prototype.forEach.call(times, function (el) {
      var stamp = el.getAttribute("datetime");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(stamp || "")) return;
      if (el.nextSibling && el.nextSibling.className === "cl-local") return;
      var when = new Date(stamp);
      if (isNaN(when.getTime())) return;
      var span = document.createElement("span");
      span.className = "cl-local";
      span.textContent = "(" + fmt.format(when) + " your time)";
      el.parentNode.insertBefore(span, el.nextSibling);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { localize(document); });
  } else {
    localize(document);
  }
})();
