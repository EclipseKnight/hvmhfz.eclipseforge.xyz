/* "Copy link" on the pages people link to one thing of: a monster, quest, item, weapon type or changelog day.
   It copies the address of that thing's share page (/s/..., written by dev/make-share-pages.py), not this
   page's own address: Discord and X read a page without running its scripts, so /monster.html?m=akantor
   previews as "Monster", while /s/monster/akantor.html previews as Akantor with its picture and opens this
   page. With no share page (an item without sources, a page opened without an id) it copies this page's
   own address. The button sits at the end of the breadcrumbs; its few styles are inline so the shared
   stylesheet (and every page's ?v=) does not change for it. */
(function () {
  "use strict";

  var page = location.pathname.replace(/^.*\//, "");
  var params = new URLSearchParams(location.search);

  // A monster link may name its old slug (oldSlug, formerSlugs); share pages exist for the current ones.
  function monsterSlug(slug) {
    return fetch("/data/monsters/index.json").then(function (r) { return r.json(); }).then(function (list) {
      var hit = (list || []).filter(function (m) {
        return m.slug === slug || m.oldSlug === slug || (m.formerSlugs || []).indexOf(slug) !== -1;
      })[0];
      return hit ? hit.slug : null;
    });
  }

  // The share page for what this page shows now ({file, query}), or null.
  function target() {
    var digits = function (v) { return /^\d+$/.test(v || "") ? v : null; };
    if (page === "monster.html" && /^[a-z0-9-]+$/.test(params.get("m") || "")) {
      return monsterSlug(params.get("m")).then(function (slug) {
        return slug ? { file: "/s/monster/" + slug + ".html", query: "" } : null;
      });
    }
    if (page === "quest.html" && digits(params.get("id"))) return Promise.resolve({ file: "/s/quest/" + params.get("id") + ".html", query: "" });
    if (page === "item.html" && digits(params.get("id"))) return Promise.resolve({ file: "/s/item/" + params.get("id") + ".html", query: "" });
    if (page === "weapons.html") {
      // read now, not at load: the weapon page changes its address as weapons are opened
      var now = new URLSearchParams(location.search);
      var type = /^[a-z-]+$/.test(now.get("type") || "") ? now.get("type") : "great-sword";
      var w = digits(now.get("w"));
      return Promise.resolve({ file: "/s/weapon/" + type + ".html", query: w ? "?w=" + w : "" });
    }
    var day = /^#d-(\d{4}-\d\d-\d\d)(-[a-z0-9-]+)?$/.exec(location.hash);
    if (page === "changelog.html" && day) return Promise.resolve({ file: "/s/changelog/" + day[1] + ".html", query: location.hash });
    return Promise.resolve(null);
  }

  // The share page's full address if it exists on the site, else this page's own address.
  function shareUrl() {
    var own = location.href;
    return target().then(function (t) {
      if (!t) return own;
      return fetch(t.file, { method: "HEAD" }).then(function (r) {
        return r.ok ? location.origin + t.file + t.query : own;
      });
    }).catch(function () { return own; });
  }

  function copy(text, button) {
    var done = function () {
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = "Copy link"; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this link:", text); });
    } else {
      window.prompt("Copy this link:", text);
    }
  }

  function start() {
    var crumbs = document.querySelector("nav.breadcrumbs");
    if (!crumbs || crumbs.querySelector(".share-copy")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn small share-copy";
    button.textContent = "Copy link";
    button.title = "Copies a link that shows this page's own title and picture when pasted in Discord or X";
    button.style.marginLeft = "auto";
    button.addEventListener("click", function () {
      shareUrl().then(function (url) { copy(url, button); });
    });
    crumbs.style.display = "flex";
    crumbs.style.flexWrap = "wrap";
    crumbs.style.alignItems = "center";
    crumbs.style.gap = "8px";
    crumbs.appendChild(button);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.HvShare = { url: shareUrl };
})();
