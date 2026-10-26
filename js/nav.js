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
