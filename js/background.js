/* Page background, loaded by every page: one Frontier picture from assets/backgrounds/, picked at
   random on each page load, shown darkened and blurred behind everything (see "page background"
   in styles.css). With prefers-reduced-motion the first picture is always used and nothing fades.
   An empty list, or a picture that fails to load, leaves the plain leather background.
   To add a picture: put it in assets/backgrounds/ (sizes in its README.md) and add its name here. */
(function () {
  "use strict";

  var IMAGES = [];

  if (!IMAGES.length) return;
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var name = still ? IMAGES[0] : IMAGES[Math.floor(Math.random() * IMAGES.length)];
  var url = "/assets/backgrounds/" + name;

  var picture = new Image();
  picture.onload = function () {
    var root = document.documentElement;
    root.style.setProperty("--site-bg", 'url("' + url + '")');
    root.classList.add("has-site-bg");
  };
  picture.src = url;
})();
