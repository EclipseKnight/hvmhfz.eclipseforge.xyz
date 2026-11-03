/* Sign-in return: a page that needs the sign-in sends a signed-out visitor to /?next=<path>#login-form, and
   after sign-in js/main.js sends them back to <path>. Only paths on this site are accepted: they start with
   "/", not "//", have no backslash, no scheme, no space or control character, and are not the sign-in page
   itself; anything else falls back to the account page. Also runs under node (dev/check-signin-next.js). */
(function (root) {
  "use strict";

  var SITE = "https://hvmhfz.eclipseforge.xyz";
  var FALLBACK = "/account.html";

  /* What the home page says above the form, by the page that sent the visitor. */
  var NOTES = {
    "/road.html": "Sign in to use the Road builder.",
    "/quest-editor.html": "Sign in to use the Quest builder.",
    "/account.html": "Sign in to open your account.",
    "/road-vote.html": "Sign in to vote for the next Hunting Road."
  };

  /* The path when it is a same-site path, else "". */
  function safe(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 512) return "";
    if (value.charAt(0) !== "/" || value.charAt(1) === "/") return "";
    // printable ASCII only: browsers drop tabs and newlines from URLs ("/\t/evil" becomes "//evil")
    if (!/^[\x21-\x7e]+$/.test(value)) return "";
    if (value.indexOf("\\") >= 0) return "";
    var path = value.split(/[?#]/)[0];
    if (path.indexOf(":") >= 0) return "";
    if (path === "/" || path === "/index.html") return ""; // the sign-in page itself
    try {
      if (new URL(value, SITE).origin !== SITE) return "";
    } catch (error) {
      return "";
    }
    return value;
  }

  /* Where to go after sign-in, from the home page's query string (e.g. location.search). */
  function target(search) {
    var next = "";
    try { next = new URLSearchParams(search || "").get("next") || ""; } catch (error) { next = ""; }
    return safe(next) || FALLBACK;
  }

  /* The note for the sign-in form, or "" when there is no valid next. */
  function note(search) {
    var next = "";
    try { next = safe(new URLSearchParams(search || "").get("next") || ""); } catch (error) { next = ""; }
    if (!next) return "";
    return NOTES[next.split(/[?#]/)[0]] || "Sign in to continue.";
  }

  /* The sign-in address that returns to path. */
  function signinUrl(path) {
    var next = safe(path);
    return next ? "/?next=" + encodeURIComponent(next) + "#login-form" : "/#login-form";
  }

  /* Browser only: leave this page for the sign-in form, coming back here afterwards. */
  function toSignin() {
    var here = root.location.pathname + root.location.search + root.location.hash;
    root.location.replace(signinUrl(here));
  }

  var api = { safe: safe, target: target, note: note, signinUrl: signinUrl, toSignin: toSignin };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvNext = api;
})(typeof window !== "undefined" ? window : this);
