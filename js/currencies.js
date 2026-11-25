/* Currencies: /currencies.html, every currency and point type a player can hold on Hunsterverse, what it buys and
   every way to earn it here (data/currencies.json, edited by hand: see its "_about"). One panel per currency, with
   an anchor (#<id>) that item pages and the search link to; a box filters them by name (?q= stays in the address).
   The data's "basis" notes (where each fact was checked) are for maintainers and are not shown. */
(function () {
  "use strict";

  var view = document.getElementById("cur-view");
  var input = document.getElementById("cur-q");
  var count = document.getElementById("cur-count");

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function link(pair) {
    var a = el("a", null, pair[0]);
    a.href = pair[1];
    return a;
  }

  /* "Label: a, b and c" as one paragraph of links. */
  function links(label, pairs) {
    var p = el("p", "cur-line");
    p.appendChild(el("strong", null, label + ": "));
    pairs.forEach(function (pair, i) {
      if (i) p.appendChild(document.createTextNode(i === pairs.length - 1 ? " and " : ", "));
      p.appendChild(link(pair));
    });
    return p;
  }

  function line(label, text) {
    var p = el("p", "cur-line");
    p.appendChild(el("strong", null, label + ": "));
    p.appendChild(document.createTextNode(text));
    return p;
  }

  function way(w) {
    var li = el("li");
    li.appendChild(el("strong", null, w.how));
    if (w.amount) li.appendChild(document.createTextNode(": " + w.amount));
    if (w.limit) li.appendChild(document.createTextNode(" Limit: " + w.limit));
    if (w.link) {
      li.appendChild(document.createTextNode(" "));
      li.appendChild(link(w.link));
    }
    return li;
  }

  function panel(c, groupName) {
    var sec = el("section", "panel cur-panel");
    sec.id = c.id;
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, c.name));
    head.appendChild(el("span", "panel-head-note", groupName));
    sec.appendChild(head);
    if (c.also && c.also.length) sec.appendChild(line("Also called", c.also.join(", ")));
    sec.appendChild(el("p", "cur-what", c.what));
    if (c.spend && c.spend.length) sec.appendChild(links(c.spend_label || "Spent at", c.spend));
    if (c.cap) sec.appendChild(line("Most you can hold", c.cap));
    sec.appendChild(el("h3", null, "How to get it here"));
    var ul = el("ul", "cur-ways");
    (c.ways || []).forEach(function (w) { ul.appendChild(way(w)); });
    sec.appendChild(ul);
    if (c.note) sec.appendChild(el("p", "note-text", c.note));
    if (c.not_here && c.not_here.length) {
      sec.appendChild(el("h3", null, "Not available on this server"));
      var nh = el("ul", "cur-ways");
      c.not_here.forEach(function (n) { nh.appendChild(el("li", null, n.what)); });
      sec.appendChild(nh);
    }
    return sec;
  }

  function render(data) {
    view.textContent = "";
    var groups = {};
    (data.groups || []).forEach(function (g) { groups[g[0]] = g[1]; });
    var list = data.currencies || [];

    var toc = el("nav", "panel cur-toc");
    toc.setAttribute("aria-label", "Currencies on this page");
    toc.setAttribute("data-page-nav", "");
    toc.setAttribute("data-page-nav-label", "Currencies on this page");
    var panels = [];
    (data.groups || []).forEach(function (g) {
      var mine = list.filter(function (c) { return c.group === g[0]; });
      if (!mine.length) return;
      var p = el("p", "cur-line");
      p.appendChild(el("strong", null, g[1] + ": "));
      mine.forEach(function (c, i) {
        if (i) p.appendChild(document.createTextNode(" · "));
        p.appendChild(link([c.name, "#" + c.id]));
      });
      toc.appendChild(p);
    });
    view.appendChild(toc);

    (data.groups || []).forEach(function (g) {
      list.filter(function (c) { return c.group === g[0]; }).forEach(function (c) {
        var sec = panel(c, g[1]);
        sec.dataset.hay = [c.name].concat(c.also || [], [g[1], c.what]).join(" ").toLowerCase();
        panels.push(sec);
        view.appendChild(sec);
      });
    });

    if (data.not_currencies && data.not_currencies.length) {
      var nc = el("section", "panel cur-panel");
      nc.id = "not-currencies";
      var head = el("div", "panel-head");
      head.appendChild(el("h2", null, "Not currencies"));
      nc.appendChild(head);
      data.not_currencies.forEach(function (n) {
        var p = el("p", "note-text");
        p.appendChild(el("strong", null, n.name + ": "));
        p.appendChild(document.createTextNode(n.text + " "));
        if (n.link) p.appendChild(link(n.link));
        nc.appendChild(p);
      });
      view.appendChild(nc);
    }
    if (data.checked) {
      view.appendChild(el("p", "note-text", "Checked against the server's code and settings on " + data.checked +
        ". Shop and prize lists change on their own pages, linked above."));
    }
    // the list's links stay on screen under the site bar once it has scrolled away (js/page-nav.js)
    if (window.HvPageNav) window.HvPageNav.add(toc);

    function filter() {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      panels.forEach(function (sec) {
        var ok = !q || q.split(/\s+/).every(function (w) { return sec.dataset.hay.indexOf(w) !== -1; });
        sec.hidden = !ok;
        if (ok) shown++;
      });
      toc.hidden = !!q;
      count.textContent = (q ? shown + " of " : "") + panels.length + " currencies";
      var params = new URLSearchParams(location.search);
      if (q) params.set("q", input.value.trim()); else params.delete("q");
      var text = params.toString();
      history.replaceState(null, "", location.pathname + (text ? "?" + text : "") + location.hash);
    }
    input.value = new URLSearchParams(location.search).get("q") || "";
    input.addEventListener("input", filter);
    filter();
    // The panels are drawn after load, so the browser could not scroll to #<id> by itself.
    if (location.hash.length > 1) {
      var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  }

  function load() {
    fetch("/data/currencies.json").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(render).catch(function () {
      view.textContent = "";
      view.appendChild(el("p", "empty-state", "The list of currencies could not be loaded."));
      var b = el("button", "ghost-btn small", "Try again");
      b.type = "button";
      b.addEventListener("click", load);
      view.appendChild(b);
    });
  }
  load();
})();
