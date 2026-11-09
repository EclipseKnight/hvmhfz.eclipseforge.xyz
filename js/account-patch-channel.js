/* "Pre-release client patch" box on the Account tab. GET /api/account/patch-channel gives {channel, eligible};
   the box shows only when eligible is true (tester, moderator or admin) and stays hidden when it is false or the
   call fails (an older API answers 404). A click on Stable or Pre-release saves at once with
   PUT /api/account/patch-channel {channel}; the Mezeporta launcher reads the choice at its next login. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var panel = document.getElementById("patch-channel-panel");
  var note = document.getElementById("patch-channel-note");
  var alertNode = document.getElementById("patch-channel-alert");
  if (!panel) return;
  var buttons = Array.prototype.slice.call(panel.querySelectorAll("[data-channel]"));

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function say(text, bad) {
    note.textContent = bad ? "" : (text || "");
    alertNode.textContent = bad ? text : "";
    alertNode.hidden = !bad;
  }

  function mark(channel) {
    buttons.forEach(function (b) {
      var on = b.getAttribute("data-channel") === channel;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function busy(on) {
    buttons.forEach(function (b) { b.disabled = on; });
  }

  function save(channel) {
    busy(true);
    say("Saving.");
    fetch(API + "/api/account/patch-channel", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channel })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      busy(false);
      if (!res.ok) {
        say((res.data && res.data.message) || "Could not save. Try again in a moment.", true);
        return;
      }
      if (res.data && (res.data.channel === "stable" || res.data.channel === "pre")) mark(res.data.channel);
      say((res.data && res.data.message) || "Saved.");
    }).catch(function () {
      busy(false);
      say("Could not save. Try again in a moment.", true);
    });
  }

  function load() {
    if (!token()) return;
    fetch(API + "/api/account/patch-channel", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (data) {
        if (!data || data.eligible !== true) return;
        mark(data.channel === "pre" ? "pre" : "stable");
        panel.hidden = false;
      }).catch(function () { /* older API or not signed in: the box stays hidden */ });
  }

  buttons.forEach(function (b) {
    b.addEventListener("click", function () { save(b.getAttribute("data-channel")); });
  });
  load();
})();
