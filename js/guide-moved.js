/* guide-windows.html and guide-linux.html: the old setup guides moved into the Play page. Sends an old
   address, with its #anchor, to the matching Play card or "More help" section (ids in play.html).
   Without JavaScript the page's meta refresh sends the reader to the card. */
(function () {
  "use strict";

  var CARD = { "/guide-windows.html": "windows", "/guide-linux.html": "linux" };
  // old guide anchor -> id on play.html; any other anchor opens the card
  var MAP = {
    "/guide-windows.html": {
      patch: "windows-patch", trouble: "windows-trouble", layout: "windows-trouble",
      launcher: "windows-launcher", server: "windows-server", english: "language", discord: "discord"
    },
    "/guide-linux.html": {
      packages: "linux-packages", other: "linux-packages", patch: "linux-patch", prefix: "linux-prefix",
      settings: "linux-prefix", wrapper: "linux-wrapper", trouble: "linux-trouble", launcher: "linux-launcher",
      server: "linux-server", english: "language", discord: "discord"
    }
  };

  var path = location.pathname;
  if (!Object.prototype.hasOwnProperty.call(CARD, path)) return;
  var id = "";
  try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* a bad escape: open the card */ }
  var map = MAP[path];
  var target = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : CARD[path];
  location.replace("/play.html#" + target);
})();
