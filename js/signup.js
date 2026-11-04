/* Website sign-up on the home page's sign-in box (index.html #signup).

   /#signup shows the sign-up form instead of the sign-in form; #login-form (or any other address) shows the sign-in
   form again. The form sends POST /api/auth/signup with the Turnstile token; the API makes the game account, signs
   the player in and answers like sign-in, so the page saves the token and goes on as after a sign-in (?next= or the
   account page, which shows the Discord link code). A refusal from the API is one sentence: it is shown as it is.

   problems() holds the same rules as the API's SignupRules, so most mistakes are caught before sending. It also
   runs under node (dev/check-signup.js). */
(function () {
  "use strict";

  var NAME_MIN = 3, NAME_MAX = 20, PASSWORD_MIN = 6, PASSWORD_MAX = 72;
  var NAME = /^[A-Za-z0-9_.-]+$/;
  var PASSWORD = /^[\x20-\x7E]+$/;

  /* What is wrong with the form, as sentences to show (empty when it can be sent). */
  function problems(username, password, password2) {
    var list = [];
    if (!username) {
      list.push("Choose a username.");
    } else if (username.length < NAME_MIN || username.length > NAME_MAX) {
      list.push("Your username must be " + NAME_MIN + " to " + NAME_MAX + " characters long.");
    } else if (!NAME.test(username)) {
      list.push("Your username can only use English letters (A-Z, a-z), digits (0-9) and _ . - (no spaces).");
    }
    if (!password) {
      list.push("Choose a password.");
    } else if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      list.push("Your password must be " + PASSWORD_MIN + " to " + PASSWORD_MAX + " characters long.");
    } else if (!PASSWORD.test(password)) {
      list.push("Your password can only use English letters, digits, spaces and the symbols on an English keyboard.");
    } else if (password !== password2) {
      list.push("The two passwords are not the same.");
    }
    return list;
  }

  /* What to show for an answer without a message of its own. */
  function statusText(status) {
    if (status === 403) return "The verification failed. Complete it again, then press Create account.";
    if (status === 429) return "Too many sign-up attempts from your connection. Try again later.";
    if (status >= 500) return "The sign-up service had an error. Try again in a moment.";
    return "The account could not be made (error " + status + ").";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { problems: problems, statusText: statusText };
    return;
  }
  window.HvSignup = { problems: problems };

  var API = "https://api.hvmhfz.eclipseforge.xyz/api/auth/signup";
  var TOKEN_KEY = "hvmhfz.token";
  var box = document.getElementById("signup");
  var login = document.getElementById("login-form");
  if (!box || !login) return;
  var title = document.getElementById("signin-title");
  var loginSub = document.getElementById("login-sub");
  var warning = document.getElementById("signup-warning");
  var button = document.getElementById("signup-submit");
  var widget = null;

  function warn(lines) {
    warning.textContent = "";
    lines.forEach(function (line, i) {
      if (i) warning.appendChild(document.createElement("br"));
      warning.appendChild(document.createTextNode(line));
    });
    warning.hidden = lines.length === 0;
  }

  // One form at a time, chosen by the address: /#signup is the sign-up.
  function show() {
    var signup = window.location.hash === "#signup";
    box.hidden = !signup;
    login.hidden = signup;
    if (loginSub) loginSub.hidden = signup;
    if (title) title.textContent = signup ? "Create an account" : "Sign in";
    if (signup && !widget) {
      // The widget is rendered when the form is first shown, not into a hidden box.
      widget = window.HvTurnstile.mount(document.getElementById("signup-turnstile-slot"), {
        action: "signup",
        onError: function () { warn(["Verification failed to load. Reload the page and try again."]); }
      });
    }
  }
  window.addEventListener("hashchange", show);
  show();

  async function send() {
    var username = document.getElementById("signup-username").value;
    var password = document.getElementById("signup-password").value;
    var password2 = document.getElementById("signup-password2").value;
    var list = problems(username, password, password2);
    if (list.length) {
      warn(list);
      return;
    }
    var token = widget ? widget.token() : "";
    if (!token) {
      warn(["Complete the verification challenge, then press Create account again."]);
      if (widget) widget.render();
      return;
    }

    warn([]);
    button.disabled = true;
    try {
      var response;
      try {
        response = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username, password: password, token: token })
        });
      } catch (error) {
        warn(["The sign-up service did not respond. Try again in a moment."]);
        return;
      }
      var body = null;
      try { body = await response.json(); } catch (error) { body = null; }
      if (!response.ok) {
        warn([body && body.message ? body.message : statusText(response.status)]);
        return;
      }
      if (!body || !body.accessToken) {
        warn(["Your account was made, but signing in failed. Sign in with your new username and password."]);
        return;
      }
      try { localStorage.setItem(TOKEN_KEY, body.accessToken); } catch (error) { /* private mode */ }
      window.location.replace(window.HvNext.target(window.location.search));
    } finally {
      button.disabled = false;
      if (widget) widget.reset();
    }
  }

  button.addEventListener("click", send);
  document.getElementById("signup-password2").addEventListener("keydown", function (event) {
    if (event.key === "Enter") send();
  });
})();
