/* Pages that moved to a new address (catalog.html is now items.html): sends an old link on to the new page with
   its query and #anchor, so a shared /catalog.html?slot=melee&q=0100 still opens the same list. The page's meta
   refresh does the same, without the query, for a browser without JavaScript. */
(function () {
  "use strict";

  var MOVED = { "/catalog": "/items.html" };
  var to = MOVED[location.pathname.replace(/\.html$/, "")];
  if (to) location.replace(to + location.search + location.hash);
})();
