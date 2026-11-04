/* Play page (play.html): three checklists that remember their ticks, copy buttons for the server
   settings, and the slots for the one-click installer and our full download.

   Ticks are kept in this browser only, in localStorage under hvmhfz.play as {"<step id>": true}
   (listed in privacy.html). Without JavaScript the page still shows every step and download; the
   copy buttons and the "clear the ticks" buttons stay hidden. */
(function () {
  "use strict";

  var KEY = "hvmhfz.play";

  // The slots for what is not published yet. A slot shows only when its flag is true AND its URL is
  // set. To turn one on: publish the file, put its address here and set the flag to true.
  // Slot names are the data-slot values in play.html.
  var SLOTS = {
    "installer":       { enabled: true, url: "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases/download/installer/HunsterverseSetup.exe" },  // Windows one-click installer
    "installer-linux": { enabled: true, url: "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases/download/installer/install-hunsterverse.sh" },  // Linux installer script
    "full":            { enabled: false, url: "" }   // our own full, patched client download
  };

  function readTicks() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (e) { return {}; } // storage blocked or a bad value: start empty
  }

  function writeTicks(ticks) {
    try {
      if (Object.keys(ticks).length) localStorage.setItem(KEY, JSON.stringify(ticks));
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked: the ticks last for this page only */ }
  }

  // Marks the steps of one card from the saved ticks and writes "3 of 10 done".
  function paint(card, ticks) {
    var steps = card.querySelectorAll("[data-step]");
    var done = 0;
    steps.forEach(function (li) {
      var on = ticks[li.getAttribute("data-step")] === true;
      li.querySelector('input[type="checkbox"]').checked = on;
      li.classList.toggle("is-done", on);
      if (on) done += 1;
    });
    var label = card.querySelector("[data-progress]");
    if (label) label.textContent = done + " of " + steps.length + " done";
  }

  function copyText(text, button) {
    var original = button.textContent;
    function done(ok) {
      button.textContent = ok ? "Copied" : "Select and copy it by hand";
      setTimeout(function () { button.textContent = original; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    done(ok);
  }

  function init() {
    var ticks = readTicks();
    var cards = document.querySelectorAll("[data-card]");

    cards.forEach(function (card) {
      paint(card, ticks);
      card.querySelectorAll("[data-step] input[type=\"checkbox\"]").forEach(function (box) {
        box.addEventListener("change", function () {
          var id = box.closest("[data-step]").getAttribute("data-step");
          if (box.checked) ticks[id] = true; else delete ticks[id];
          writeTicks(ticks);
          paint(card, ticks);
        });
      });
      var reset = card.querySelector("[data-reset]");
      if (reset) {
        reset.hidden = false;
        reset.addEventListener("click", function () {
          card.querySelectorAll("[data-step]").forEach(function (li) { delete ticks[li.getAttribute("data-step")]; });
          writeTicks(ticks);
          paint(card, ticks);
        });
      }
    });

    document.querySelectorAll("[data-copy]").forEach(function (button) {
      button.hidden = false;
      button.addEventListener("click", function () { copyText(button.getAttribute("data-copy"), button); });
    });

    document.querySelectorAll("[data-slot]").forEach(function (slot) {
      var config = SLOTS[slot.getAttribute("data-slot")];
      if (!config || config.enabled !== true || !/^https:\/\//.test(config.url)) return;
      slot.querySelector("[data-slot-link]").href = config.url;
      slot.hidden = false;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
