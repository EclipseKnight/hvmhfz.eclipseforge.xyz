/* "Client patch" box on the Client patch tab (loads when the tab first opens, js/subtabs.js). GET /api/account/patch-channel gives
   {channel, slot, eligible, confirmationRequired, slotsAvailable, slots: [{slot, version, notes, published}],
   characters: [{name, clientPatch, clientPatchName, clientPatchSeenAt}], currentPatch}. The box shows to every
   signed-in account once the GET answers (it stays hidden when the call fails or the answer has no slots: an older API):
   - each character's last client patch version, "pre-release" for a build newer than the current patch;
   - the pre-releases that are out, with the notes of what to test;
   - the one patch choice: Stable and one button per published slot, saved at once with
     PUT /api/account/patch-channel {channel: "stable" | "pre:<slot>"}, and the Test-land warning next to it; the
     Mezeporta launcher reads the choice at its next login. Hidden when no pre-release is out and the account is on Stable;
   - the first pre-release choice of a player who is not staff and not a playtester yet (confirmationRequired) first shows
     the explanation with "I understand" and then sends the same PUT with confirm: true, which gives the Playtester role
     and sets the channel in one call (the role drops at once when the account is on Stable again).
     A 409 {confirmationRequired} answer shows the same explanation.
   - the box refreshes by itself, without reloading the page: the GET is repeated every 20 seconds while the page is
     visible (and when the tab becomes visible or gets focus again; nothing runs while it is hidden). When the channel
     changed without a click here (the game server put the account back on Stable because the test client tried a
     normal land) a notice says so; every channel change, ours or the server's, fires "hvmhfz:patch-channel" on
     document ({detail: {channel}}) so the Game options card reloads its enabled state.
   All API text goes in with textContent. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var panel = document.getElementById("patch-channel-panel");
  if (!panel) return;
  var note = document.getElementById("patch-channel-note");
  var offNode = document.getElementById("patch-channel-off");
  var alertNode = document.getElementById("patch-channel-alert");
  var charsNode = document.getElementById("patch-chars");
  var slotsNode = document.getElementById("patch-slots");
  var switchNode = document.getElementById("patch-switch");
  var choicesNode = document.getElementById("patch-channel-choices");
  var confirmNode = document.getElementById("patch-confirm");
  var confirmOk = document.getElementById("patch-confirm-ok");
  var confirmCancel = document.getElementById("patch-confirm-cancel");
  var switchedNode = document.getElementById("patch-switched-notice");
  var POLL_MS = 20000;
  // The channel the box last showed or saved ("stable" or "pre:<slot>"); null before the first answer.
  var known = null;
  var saving = false;
  var timer = null;
  // True while the account has not confirmed the pre-release explanation yet; pending: the slot waiting for "I understand".
  var needsConfirm = false;
  var pending = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function buttons() { return Array.prototype.slice.call(choicesNode.querySelectorAll("[data-channel]")); }

  function say(text, bad) {
    note.textContent = bad ? "" : (text || "");
    alertNode.textContent = bad ? text : "";
    alertNode.hidden = !bad;
  }

  function mark(channel) {
    buttons().forEach(function (b) {
      var on = b.getAttribute("data-channel") === channel;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function busy(on) {
    buttons().forEach(function (b) { b.disabled = on || b.hasAttribute("data-gone"); });
  }

  // "v1.21-pre2" -> 12102, "v1.20" -> 120; null when it is not a version name.
  function nameValue(name) {
    var m = /^v?(\d+)\.(\d+)(?:-pre(\d+))?$/.exec(String(name || ""));
    if (!m) return null;
    var base = Number(m[1]) * 100 + Number(m[2]);
    return m[3] === undefined ? base : base * 100 + Number(m[3]);
  }

  // "9 Nov, 22:00 CET" (viewer zone; "9 Nov, 22:00 UTC" without js/time.js)
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    if (typeof window !== "undefined" && window.HvTime) return HvTime.text(d, { year: false });
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "UTC" }) + " UTC";
  }

  function plainName(value) {
    if (value === 0) return "v1.18 or older";
    if (value >= 10000) return "v" + Math.floor(value / 10000) + "." + (Math.floor(value / 100) % 100) + "-pre" + (value % 100);
    return "v" + Math.floor(value / 100) + "." + (value % 100);
  }

  function renderCharacters(data) {
    clear(charsNode);
    var list = data.characters || [];
    if (!list.length) {
      charsNode.appendChild(el("li", "", "No characters yet."));
      return;
    }
    var current = nameValue(data.currentPatch);
    list.forEach(function (c) {
      var text;
      if (c.clientPatch === null || c.clientPatch === undefined) {
        text = c.name + ": not seen yet";
      } else {
        var bits = [c.clientPatchName || plainName(c.clientPatch)];
        if (c.clientPatch >= 10000 || (current !== null && c.clientPatch > current)) bits.push("pre-release");
        var seen = c.clientPatchSeenAt ? when(c.clientPatchSeenAt) : "";
        if (seen) bits.push(seen);
        text = c.name + ": " + bits.join(", ");
      }
      charsNode.appendChild(el("li", "", text));
    });
  }

  function renderSlots(data) {
    clear(slotsNode);
    if (data.slotsAvailable === false) {
      slotsNode.appendChild(el("p", "note-text", "Could not load the pre-releases."));
      return;
    }
    var slots = data.slots || [];
    if (!slots.length) {
      slotsNode.appendChild(el("p", "note-text", "No pre-release is out right now."));
      return;
    }
    slots.forEach(function (s) {
      var box = el("div", "patch-slot-out");
      box.appendChild(el("p", "note-text", "Pre-release available: " + (s.version ? s.version + " (" + s.slot + ")" : s.slot)));
      if (s.notes && s.notes.length) {
        box.appendChild(el("p", "note-text", "What you are testing:"));
        var list = el("ul", "patch-notes");
        s.notes.forEach(function (n) { list.appendChild(el("li", "", n)); });
        box.appendChild(list);
      }
      slotsNode.appendChild(box);
    });
  }

  function choice(channel, label, gone) {
    var b = el("button", "ghost-btn small", label);
    b.type = "button";
    b.setAttribute("data-channel", channel);
    b.setAttribute("aria-pressed", "false");
    if (gone) { b.setAttribute("data-gone", "1"); b.disabled = true; }
    else b.addEventListener("click", function () { request(channel); });
    choicesNode.appendChild(b);
  }

  function renderSwitch(data) {
    clear(choicesNode);
    choice("stable", "Stable");
    var published = {};
    (data.slots || []).forEach(function (s) {
      published[s.slot] = true;
      choice("pre:" + s.slot, s.version ? s.slot + " (" + s.version + ")" : s.slot);
    });
    // On a slot that is not out: the launcher gives stable, and the box says so.
    if (data.slot && !published[data.slot]) choice("pre:" + data.slot, data.slot + " (not out: you get stable)", true);
    mark(data.slot ? "pre:" + data.slot : "stable");
    needsConfirm = data.confirmationRequired === true || (data.confirmationRequired === undefined && data.eligible === false);
    hideConfirm();
  }

  function showConfirm(channel) {
    pending = channel;
    confirmNode.hidden = false;
    say("");
    confirmOk.focus();
  }

  function hideConfirm() {
    pending = null;
    confirmNode.hidden = true;
  }

  // A click on a choice: the first pre-release of a player who has not confirmed asks first.
  function request(channel) {
    if (channel !== "stable" && needsConfirm) showConfirm(channel);
    else { hideConfirm(); save(channel, false); }
  }

  confirmOk.addEventListener("click", function () { var c = pending; hideConfirm(); if (c) save(c, true); });
  confirmCancel.addEventListener("click", function () { hideConfirm(); say(""); });

  function channelOf(data) { return data.slot ? "pre:" + data.slot : "stable"; }

  // Remembers the channel and tells the Game options card when it changed.
  function changed(channel) {
    var first = known === null;
    if (known === channel) return;
    known = channel;
    if (first) return; // the card loads its own first answer
    try { document.dispatchEvent(new CustomEvent("hvmhfz:patch-channel", { detail: { channel: channel } })); } catch (e) { /* old browser */ }
  }

  function save(channel, confirmed) {
    saving = true;
    busy(true);
    say("Saving.");
    fetch(API + "/api/account/patch-channel", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(confirmed ? { channel: channel, confirm: true } : { channel: channel })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    }).then(function (res) {
      saving = false;
      busy(false);
      if (res.status === 409 && res.data && res.data.confirmationRequired) {
        needsConfirm = true;
        showConfirm(channel);
        return;
      }
      if (!res.ok) {
        say((res.data && res.data.message) || "Could not save. Try again in a moment.", true);
        return;
      }
      if (confirmed) needsConfirm = false;
      if (res.data && res.data.channel) mark(res.data.channel);
      if (res.data && res.data.eligible === false) needsConfirm = true;
      switchedNode.hidden = true;
      say((res.data && res.data.message) || "Saved.");
      if (res.data && res.data.channel) changed(res.data.channel);
    }).catch(function () {
      saving = false;
      busy(false);
      say("Could not save. Try again in a moment.", true);
    });
  }

  function loadChannel() {
    return fetch(API + "/api/account/patch-channel", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  var SWITCHED = "Your account was switched back to Stable (you joined a normal land on a pre-release patch).";

  function show(data) {
    renderCharacters(data);
    renderSlots(data);
    // The choice is for everyone; with no pre-release out (and none chosen) there is nothing to choose.
    switchNode.hidden = !(data.slots.length || data.slot);
    if (!switchNode.hidden) renderSwitch(data);
    panel.hidden = false;
    if (offNode) offNode.hidden = true;
  }

  // refresh: a repeat of the GET (poll, focus, visible again): it leaves a confirmation or a save in progress alone and
  // keeps the box as it is when the call fails.
  function load(refresh) {
    if (!token()) return;
    loadChannel().then(function (data) {
      // An API from before slots has no "slots": its answer would show a wrong picture, so the box stays hidden.
      if (!data || !Array.isArray(data.slots)) throw new Error("no slots");
      var channel = channelOf(data);
      if (refresh && (saving || pending)) return;
      var before = known;
      show(data);
      if (before !== null && before !== channel) {
        if (before !== "stable" && channel === "stable") {
          switchedNode.textContent = SWITCHED;
          switchedNode.hidden = false;
        } else {
          switchedNode.hidden = true;
        }
      }
      changed(channel);
    }).catch(function () {
      if (refresh) return;
      panel.hidden = true; /* older API or not signed in: the box stays hidden, the tab says so */
      if (offNode) offNode.hidden = false;
    });
  }

  function stop() {
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  function start() {
    stop();
    if (!token() || document.hidden) return;
    timer = setInterval(function () { load(true); }, POLL_MS);
  }

  function wake() {
    if (document.hidden) { stop(); return; }
    load(true);
    start();
  }

  // Nothing runs until the Client patch tab first opens (js/subtabs.js); then the box polls as before.
  var opened = false;
  document.addEventListener("visibilitychange", function () { if (opened) wake(); });
  window.addEventListener("focus", function () { if (opened && !document.hidden) wake(); });

  function begin() {
    opened = true;
    load(false);
    start();
  }
  if (window.HvSubtabs) window.HvSubtabs.whenOpen(panel, begin);
  else begin();
})();
