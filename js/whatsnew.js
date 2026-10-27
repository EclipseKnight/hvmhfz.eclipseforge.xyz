/* Home page "What's new": shows the newest entry of the changelog (the first h3 under "Released
   updates" in changelog.html), so the home page never needs editing when an update goes live. If
   the changelog can't be read, the static link in the panel stays. */
(function () {
  "use strict";

  var body = document.getElementById("news-body");
  if (!body || !window.fetch || !window.DOMParser) return;
  var MAX_ITEMS = 4;

  fetch("/changelog.html", { cache: "no-cache" })
    .then(function (response) { return response.ok ? response.text() : Promise.reject(); })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var released = doc.getElementById("live");
      var node = released && released.nextElementSibling;
      while (node && node.tagName !== "H3" && node.tagName !== "H2") node = node.nextElementSibling;
      if (!node || node.tagName !== "H3") return;
      var title = node.textContent;
      var list = node.nextElementSibling;
      while (list && list.tagName !== "UL" && list.tagName !== "H3" && list.tagName !== "H2") list = list.nextElementSibling;

      while (body.firstChild) body.removeChild(body.firstChild);
      var heading = document.createElement("h3");
      heading.className = "news-title";
      heading.textContent = title;
      body.appendChild(heading);
      if (list && list.tagName === "UL") {
        var items = Array.prototype.slice.call(list.children, 0, MAX_ITEMS);
        var ul = document.createElement("ul");
        ul.className = "news-list";
        // Our own page from the same site: its markup (bold, code, links) is copied as is.
        items.forEach(function (item) { ul.appendChild(document.importNode(item, true)); });
        body.appendChild(ul);
        if (list.children.length > MAX_ITEMS) {
          var more = document.createElement("p");
          more.className = "note-text";
          var link = document.createElement("a");
          link.href = "/changelog.html#live";
          link.textContent = "and " + (list.children.length - MAX_ITEMS) + " more in the changelog";
          more.appendChild(link);
          body.appendChild(more);
        }
      }
    })
    .catch(function () { /* the static link stays */ });
})();
