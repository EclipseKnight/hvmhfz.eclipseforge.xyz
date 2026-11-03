/* Home page "What's new": shows the newest day of the changelog (the first section.cl-day under "Released
   updates" in changelog.html: its title, then its first changes across its topics), so the home page never
   needs editing when an update goes live. If the changelog can't be read, the static link in the panel stays. */
(function () {
  "use strict";

  var body = document.getElementById("news-body");
  if (!body || !window.fetch || !window.DOMParser) return;
  var MAX_ITEMS = 4;

  fetch("/changelog.html", { cache: "no-cache" })
    .then(function (response) { return response.ok ? response.text() : Promise.reject(); })
    .then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var day = doc.querySelector("section.cl-day");
      var dayTitle = day && day.querySelector(".cl-day-title");
      if (!dayTitle) return;
      var title = dayTitle.textContent;
      // Top-level changes of every topic of that day, in page order.
      var all = Array.prototype.slice.call(day.querySelectorAll(".cl-topic > ul > li:not(.cl-howto)"));

      while (body.firstChild) body.removeChild(body.firstChild);
      var heading = document.createElement("h3");
      heading.className = "news-title";
      heading.textContent = title;
      body.appendChild(heading);
      if (all.length) {
        var items = all.slice(0, MAX_ITEMS);
        var ul = document.createElement("ul");
        ul.className = "news-list";
        // Our own page from the same site: its markup (bold, code, links) is copied as is.
        items.forEach(function (item) { ul.appendChild(document.importNode(item, true)); });
        body.appendChild(ul);
        if (all.length > MAX_ITEMS) {
          var more = document.createElement("p");
          more.className = "note-text";
          var link = document.createElement("a");
          link.href = "/changelog.html#" + day.id;
          link.textContent = "and " + (all.length - MAX_ITEMS) + " more in the changelog";
          more.appendChild(link);
          body.appendChild(more);
        }
      }
    })
    .catch(function () { /* the static link stays */ });
})();
