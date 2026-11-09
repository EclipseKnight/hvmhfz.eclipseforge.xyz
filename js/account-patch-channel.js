/* "Client patch" box on the Account tab. GET /api/account/patch-channel gives
   {channel, slot, eligible, slotsAvailable, slots: [{slot, version, notes, published}], characters: [{name,
   clientPatch, clientPatchName, clientPatchSeenAt}], currentPatch}. The box shows to every signed-in account once
   the GET answers (it stays hidden when the call fails or the answer has no slots: an older API):
   - each character's last client patch version, "pre-release" for a build newer than the current patch;
   - the pre-releases that are out, with the notes of what to test;
   - the "Join the playtest" switch above the pre-releases (GET/PUT /api/account/playtest {joined} / {join: bool}; the
     API adds or removes ROLE_PLAYTESTER; leaving also puts the channel back to stable). It is hidden when that
     endpoint is missing (an older API);
   - for eligible accounts (playtester, tester, moderator, admin) the switch: Stable and one button per published slot, saved at
     once with PUT /api/account/patch-channel {channel: "stable" | "pre:<slot>"}, and the Test-land warning next
     to it; the Mezeporta launcher reads the choice at its next login. Others get one line saying who it is for.
   All API text goes in with textContent. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var panel = document.getElementById("patch-channel-panel");
  if (!panel) return;
  var note = document.getElementById("patch-channel-note");
  var alertNode = document.getElementById("patch-channel-alert");
  var charsNode = document.getElementById("patch-chars");
  var slotsNode = document.getElementById("patch-slots");
  var switchNode = document.getElementById("patch-switch");
  var choicesNode = document.getElementById("patch-channel-choices");
  var notEligible = document.getElementById("patch-not-eligible");
  var playtestBox = document.getElementById("playtest-box");
  var playtestToggle = document.getElementById("playtest-toggle");
  var playtestNote = document.getElementById("playtest-note");
  var NOT_ELIGIBLE_OLD = "Pre-releases are for playtesters, moderators and admins.";
  var NOT_ELIGIBLE = notEligible ? notEligible.textContent : NOT_ELIGIBLE_OLD;

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

  // "9 Nov, 22:00 UTC"
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
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
    else b.addEventListener("click", function () { save(channel); });
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
      if (res.data && res.data.channel) mark(res.data.channel);
      say((res.data && res.data.message) || "Saved.");
    }).catch(function () {
      busy(false);
      say("Could not save. Try again in a moment.", true);
    });
  }

  // The playtest switch: null (switch hidden) when the endpoint is missing or fails, else the joined flag.
  function loadPlaytest() {
    return fetch(API + "/api/account/playtest", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (data) {
        return data && typeof data.joined === "boolean" ? data.joined : null;
      }).catch(function () { return null; });
  }

  function loadChannel() {
    return fetch(API + "/api/account/patch-channel", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  function setPlaytest(join) {
    playtestToggle.disabled = true;
    playtestNote.textContent = "Saving.";
    fetch(API + "/api/account/playtest", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify({ join: join })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      playtestToggle.disabled = false;
      if (!res.ok) {
        playtestToggle.checked = !join;
        playtestNote.textContent = "";
        say((res.data && res.data.message) || "Could not save. Try again in a moment.", true);
        return;
      }
      // Eligibility and the channel changed (leaving resets it to Stable): draw the box again, then say what happened.
      say("");
      load(function () { playtestNote.textContent = (res.data && res.data.message) || "Saved."; });
    }).catch(function () {
      playtestToggle.disabled = false;
      playtestToggle.checked = !join;
      playtestNote.textContent = "";
      say("Could not save. Try again in a moment.", true);
    });
  }

  if (playtestToggle) playtestToggle.addEventListener("change", function () { setPlaytest(playtestToggle.checked); });

  function load(done) {
    if (!token()) return;
    Promise.all([loadChannel(), loadPlaytest()]).then(function (both) {
      var data = both[0];
      var joined = both[1];
      // An API from before slots has no "slots": its answer would show a wrong picture, so the box stays hidden.
      if (!data || !Array.isArray(data.slots)) throw new Error("no slots");
      renderCharacters(data);
      renderSlots(data);
      var eligible = data.eligible === true;
      playtestBox.hidden = joined === null;
      if (joined !== null) playtestToggle.checked = joined;
      switchNode.hidden = !eligible;
      notEligible.hidden = eligible;
      notEligible.textContent = joined === null ? NOT_ELIGIBLE_OLD : NOT_ELIGIBLE;
      if (eligible) renderSwitch(data);
      panel.hidden = false;
      if (done) done();
    }).catch(function () { panel.hidden = true; /* older API or not signed in: the box stays hidden */ });
  }

  load();
})();
