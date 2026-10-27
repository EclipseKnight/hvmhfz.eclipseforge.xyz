/* Site navigation, loaded by every page. On narrow screens (see the 980px rule in styles.css)
   the links fold behind the Menu button so the sticky bar keeps one fixed height. Without
   JavaScript the button stays hidden and the links simply wrap under the logo. */
(function () {
  "use strict";

  var header = document.querySelector(".site-nav");
  var button = header && header.querySelector(".nav-toggle");
  var menu = header && header.querySelector("nav");
  if (!button || !menu) return;

  function setOpen(open) {
    header.classList.toggle("open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
  }

  header.classList.add("collapsible");
  button.hidden = false;
  button.addEventListener("click", function () {
    setOpen(!header.classList.contains("open"));
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && header.classList.contains("open")) {
      setOpen(false);
      button.focus();
    }
  });
  // A tap outside the bar closes the menu, as people expect from a dropdown.
  document.addEventListener("click", function (event) {
    if (header.classList.contains("open") && !header.contains(event.target)) setOpen(false);
  });
})();

/* The nav menus (Database, Community, Server, Guides). Hover opens them on a wide screen (CSS);
   this adds click and keyboard: the button toggles its menu, Escape or a click elsewhere closes it,
   and opening one closes the others. In the folded Menu the groups are always open (CSS). */
(function () {
  "use strict";

  var groups = Array.prototype.slice.call(document.querySelectorAll(".site-nav .nav-group"));
  if (!groups.length) return;

  function setOpen(group, open) {
    group.classList.toggle("open", open);
    group.querySelector(".nav-group-toggle").setAttribute("aria-expanded", open ? "true" : "false");
  }

  groups.forEach(function (group) {
    var toggle = group.querySelector(".nav-group-toggle");
    toggle.addEventListener("click", function (event) {
      var open = !group.classList.contains("open");
      groups.forEach(function (other) { setOpen(other, false); });
      setOpen(group, open);
      if (open) {
        var first = group.querySelector(".nav-menu a");
        if (first && event.detail === 0) first.focus(); // opened with the keyboard: move into the menu
      }
    });
    group.addEventListener("focusout", function (event) {
      if (!group.contains(event.relatedTarget)) setOpen(group, false);
    });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    groups.forEach(function (group) {
      if (group.classList.contains("open")) {
        setOpen(group, false);
        group.querySelector(".nav-group-toggle").focus();
      }
    });
  });
  document.addEventListener("click", function (event) {
    groups.forEach(function (group) { if (!group.contains(event.target)) setOpen(group, false); });
  });
})();
