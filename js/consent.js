/* Cookie banner, loaded by every page. The site itself only stores what it needs to work (the
   sign-in, and this choice): see privacy.html. Anything optional added later (statistics, embeds
   that track) must wait for "Accept": write it as
     <script type="text/plain" data-consent-src="https://..."></script>
   (or with the code inside, without data-consent-src) and this file runs it once the visitor accepts.
   The choice is kept in localStorage under hvmhfz.consent for a year, then asked again.
   A button with data-consent-reset (privacy.html) clears the choice and shows the banner again. */
(function () {
  "use strict";

  var KEY = "hvmhfz.consent";
  var MAX_AGE = 365 * 24 * 60 * 60 * 1000;

  function read() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && (saved.choice === "accepted" || saved.choice === "declined")
          && Date.now() - Date.parse(saved.at) < MAX_AGE) return saved.choice;
    } catch (e) { /* storage blocked or bad value: ask again */ }
    return null;
  }

  function save(choice) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice: choice, at: new Date().toISOString() }));
    } catch (e) { /* storage blocked: the choice lasts for this page only */ }
  }

  function runOptional() {
    var held = document.querySelectorAll('script[type="text/plain"][data-consent-src], script[type="text/plain"][data-consent]');
    Array.prototype.forEach.call(held, function (old) {
      var script = document.createElement("script");
      if (old.hasAttribute("data-consent-src")) script.src = old.getAttribute("data-consent-src");
      else script.text = old.text;
      old.parentNode.replaceChild(script, old);
    });
  }

  var banner = null;
  var current = read();

  function choose(choice) {
    var before = current;
    current = choice;
    save(choice);
    if (banner) banner.hidden = true;
    if (choice === "accepted") runOptional();
    // Optional scripts that already ran can't be unloaded: start the page again without them.
    else if (before === "accepted") location.reload();
  }

  function show() {
    if (!banner) {
      banner = document.createElement("section");
      banner.className = "consent";
      banner.setAttribute("aria-label", "Cookie choice");
      banner.innerHTML =
        '<p>This site keeps only what it needs to work: your sign-in, and this choice, in your browser. ' +
        'No ads, no tracking. <a href="/privacy.html">Privacy policy</a></p>' +
        '<div class="consent-actions">' +
        '<button type="button" class="ghost-btn" data-choice="accepted">Accept</button>' +
        '<button type="button" class="ghost-btn" data-choice="declined">Decline</button>' +
        "</div>";
      banner.addEventListener("click", function (event) {
        var choice = event.target.getAttribute && event.target.getAttribute("data-choice");
        if (choice) choose(choice);
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
  }

  if (current === "accepted") runOptional();
  else if (!current) show();

  Array.prototype.forEach.call(document.querySelectorAll("[data-consent-reset]"), function (button) {
    button.addEventListener("click", function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* nothing saved */ }
      show();
      var first = banner.querySelector("button");
      if (first) first.focus();
    });
  });
})();
