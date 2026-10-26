/* Cloudflare Turnstile, shared by the sign-in page (main.js) and the report page (report.js).
   The page loads Cloudflare's api.js with render=explicit, async, so it may arrive after this
   file runs: mount() waits for it and renders the widget as soon as it is there. */
(function () {
  "use strict";

  var SITEKEY = "0x4AAAAAAFiqTP8B32NFqXS1";
  // Cloudflare's documented test key that always passes. The real key only works on our
  // domain, so local test servers (python3 -m http.server) use this one instead.
  var TEST_SITEKEY = "1x00000000000000000000AA";
  var LOCAL_HOSTS = ["localhost", "127.0.0.1"];

  function sitekey() {
    return LOCAL_HOSTS.indexOf(window.location.hostname) >= 0 ? TEST_SITEKEY : SITEKEY;
  }

  /* Renders a widget into slot and returns {render, token, reset}.
     options: action (shown in Cloudflare analytics), onSolved, onError. */
  function mount(slot, options) {
    options = options || {};
    var widgetId = null;

    function render() {
      if (widgetId !== null || !window.turnstile || !slot) return;
      widgetId = window.turnstile.render(slot, {
        sitekey: sitekey(),
        theme: "light",
        action: options.action,
        callback: function () {
          if (options.onSolved) options.onSolved();
        },
        "expired-callback": function () {
          reset();
        },
        "error-callback": function () {
          if (options.onError) options.onError();
        }
      });
    }

    function reset() {
      if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
    }

    function token() {
      if (window.turnstile && widgetId !== null) return window.turnstile.getResponse(widgetId) || "";
      return "";
    }

    var wait = setInterval(function () {
      if (window.turnstile) {
        clearInterval(wait);
        render();
      }
    }, 250);
    setTimeout(function () { clearInterval(wait); }, 20000);

    return { render: render, token: token, reset: reset };
  }

  window.HvTurnstile = { mount: mount };
})();
