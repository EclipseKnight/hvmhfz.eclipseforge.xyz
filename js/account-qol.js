/* "Game options" card on the Account tab: one switch per display-only client feature from
   GET /api/account/qol (the list comes from the API, nothing is hard-coded here). A toggle saves at once with
   PUT /api/account/qol {id: true|false}. The game reads the choice at the next login.
   When the answer has "keys", a Keys part lets the player pick the keys the mods use (retire key and what to do on a
   cart or death, skip-wait key, five remote talk keys); "Save keys" sends PUT /api/account/qol/keys.
   When the feature list has "iframeViewer" and the answer has "viewer", a Viewer options part shows four checkboxes
   (iframe bar, iframe count, hitstop bar, hit indicator), a position and a size; "Save viewer options" sends all six
   keys with PUT /api/account/qol/viewer.
   Under the "damageNumbers" switch (when the answer has "damageNumbers"): "Other players' hits", "Size", "Multi-hit
   numbers" (Spread / Combine) and "Show move id"; under the "damageMeter" switch (when the answer has "damageMeter"):
   "Corner", "Size", "Show monster health", "Health as effective HP", "Show status build-up", "DPS graph" and "Time to
   kill estimate". Each change saves at once with only that key: PUT /api/account/qol/damage-numbers or /damage-meter.
   Greyed out with the switch.
   When the answer has "sharpness" ("Show sharpness hits left": no flags bit, the option alone turns it on), it gets its
   own switch line right under the Damage numbers line, with the API's name, description and lock; a toggle sends
   PUT /api/account/qol/sharpness {hitsLeft: true|false}.
   A feature the API marks "preReleaseOnly" (its minPatch is above the current stable patch; it moves up by itself when
   a stable release reaches it) is listed in its own section, "Being tested: pre-release only", with the slot name and
   a note that it works only on a pre-release patch on the Test land; the Keys and Viewer options parts go into that
   section when every feature they belong to is pre-release only. A feature with a "lockedMessage" (the account is on
   Stable, or on a slot without it) is greyed out: its switch, key pickers or viewer options are disabled and the
   message ("Switch to the pre-release (<slot>) to try these") is shown. The card reloads when the Client patch box
   fires "hvmhfz:patch-channel" (the channel changed, by the player or by the game server). */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var list = document.getElementById("qol-list");
  var note = document.getElementById("qol-note");
  var alertNode = document.getElementById("qol-alert");
  var keysBox = document.getElementById("qol-keys");
  var viewerBox = document.getElementById("qol-viewer");
  var preBox = document.getElementById("qol-pre");
  var preNote = document.getElementById("qol-pre-note");
  var preList = document.getElementById("qol-pre-list");
  if (!list) return;
  var byId = {};   // the features of the last answer, by id
  var lastData = null;   // the last answer, for the options under the damage switches

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function say(text, bad) {
    note.textContent = text || "";
    alertNode.hidden = !bad;
    alertNode.textContent = bad ? text : "";
    if (bad) note.textContent = "";
  }

  var VIEWER_EVENT_RULE = "Turned off by itself in Speedrun Cup and VS Bracket quests. A cup time or VS result made while a viewer was showing does not count.";

  function lockOf(id) { return byId[id] && byId[id].lockedMessage ? byId[id].lockedMessage : ""; }

  function featureRow(f) {
    var row = el("div", "qol-item");
    var label = el("label", "qol-label");
    var box = el("input");
    box.type = "checkbox";
    box.setAttribute("role", "switch");
    box.id = "qol-" + f.id;
    box.checked = !!f.enabled;
    label.htmlFor = box.id;
    label.appendChild(box);
    label.appendChild(el("span", "qol-name", f.name));
    row.appendChild(label);
    row.appendChild(el("p", "note-text qol-desc", f.description));
    if (f.minPatch) row.appendChild(el("p", "note-text qol-patch", "Needs client patch v" + f.minPatch + " or newer"));
    if (f.revealsHiddenInfo) row.appendChild(el("p", "note-text qol-hidden", "Shows information the game normally hides"));
    if (f.id === "iframeViewer" || f.id === "damageNumbers") row.appendChild(el("p", "note-text qol-event", VIEWER_EVENT_RULE));
    if (f.lockedMessage) {
      box.disabled = true;
      row.classList.add("is-locked");
      row.appendChild(el("p", "note-text qol-locked", f.lockedMessage));
    }
    var sub = SUB_OPTIONS[f.id];
    if (sub && lastData && lastData[sub.key] && typeof lastData[sub.key] === "object") row.appendChild(subOptions(f, sub, lastData[sub.key]));
    box.addEventListener("change", function () { save(f, box); });
    return row;
  }

  /* ---- Options under the damage numbers and damage meter switches ---- */
  var OVERLAY_SIZES = [["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]];
  var SUB_OPTIONS = {
    damageNumbers: { key: "damageNumbers", path: "damage-numbers", prefix: "qol-dn-", name: "Damage numbers", fields: [
      { id: "othersHits", type: "check", label: "Other players' hits", hint: "Also shows the other hunters' hits, in grey." },
      { id: "size", type: "select", label: "Size", options: OVERLAY_SIZES, fallback: "normal" },
      { id: "multiHit", type: "select", label: "Multi-hit numbers", options: [["spread", "Spread"], ["combine", "Combine"]], fallback: "spread", hint: "Spread shows every hit as its own number; Combine adds up rapid hits on one spot." },
      { id: "showMoveId", type: "check", label: "Show move id", hint: "Shows which move hit (its attack record id, weapon and style) next to each of your damage numbers, and writes every hit to hvmods.log in the game folder so you can send us the list. For testing move names." }
    ] },
    damageMeter: { key: "damageMeter", path: "damage-meter", prefix: "qol-dm-", name: "Damage meter", fields: [
      { id: "corner", type: "select", label: "Corner", options: [["topRight", "Top right"], ["topLeft", "Top left"], ["bottomRight", "Bottom right"], ["bottomLeft", "Bottom left"]], fallback: "topRight" },
      { id: "size", type: "select", label: "Size", options: OVERLAY_SIZES, fallback: "normal" },
      { id: "showHealth", type: "check", label: "Show monster health", hint: "Shows a health bar with the number for each monster. Off in Speedrun Cup and VS quests." },
      { id: "effectiveHp", type: "check", label: "Health as effective HP", hint: "Shows the health bar's numbers divided by the monster's defence rate: how much raw damage is left. Needs \"Show monster health\"." },
      { id: "statusBuildUp", type: "check", label: "Show status build-up", hint: "Shows sleep, paralysis, stun, poison and blast on each monster: build-up now / needed, or ACTIVE. Only statuses with build-up show." },
      { id: "dpsGraph", type: "check", label: "DPS graph", hint: "Shows the team's and your damage per second over the last 2 minutes, under the meter." },
      { id: "timeToKill", type: "check", label: "Time to kill estimate", hint: "Shows each monster's remaining health over its health loss rate since its first hit: \"kill in ~m:ss\"." }
    ] }
  };

  function subOptions(f, sub, values) {
    var box = el("div", "qol-sub");
    box.id = sub.prefix + "options";
    var lock = !!f.lockedMessage;
    sub.fields.forEach(function (o) {
      var id = sub.prefix + o.id;
      var input;
      if (o.type === "check") {
        var label = el("label", "qol-label");
        input = el("input");
        input.type = "checkbox";
        input.id = id;
        input.checked = values[o.id] === true;
        label.htmlFor = id;
        label.appendChild(input);
        label.appendChild(el("span", "qol-name", o.label));
        box.appendChild(label);
      } else {
        input = viewerSelect(box, id, o.label, o.options, pick(o.options, values[o.id], o.fallback));
      }
      if (o.hint) box.appendChild(el("p", "note-text", o.hint));
      input.disabled = lock;
      input.addEventListener("change", function () {
        var body = {};
        body[o.id] = o.type === "check" ? input.checked : input.value;
        saveSub(sub, input, body);
      });
    });
    return box;
  }

  function saveSub(sub, input, body) {
    input.disabled = true;
    say("Saving.");
    fetch(API + "/api/account/qol/" + sub.path, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var err = new Error("HTTP " + r.status);
          err.serverMessage = data && (data.message || data.error);
          throw err;
        }
        return data;
      });
    }).then(function (data) {
      render(data);
      say(sub.name + " options saved. They take effect from your next login to the game.");
    }).catch(function (e) {
      if (lastData) render(lastData);
      say(e.serverMessage ? "Could not save the " + sub.name.toLowerCase() + " options: " + e.serverMessage : "Could not save the " + sub.name.toLowerCase() + " options. Try again in a moment.", true);
    });
  }

  function render(data) {
    lastData = data;
    list.innerHTML = "";
    preList.innerHTML = "";
    byId = {};
    var features = data.features || [];
    var slots = [];
    var numbersRow = null;
    features.forEach(function (f) {
      byId[f.id] = f;
      var row = featureRow(f);
      if (f.id === "damageNumbers") numbersRow = row;
      if (f.preReleaseOnly) {
        preList.appendChild(row);
        if (f.preReleaseSlot && slots.indexOf(f.preReleaseSlot) < 0) slots.push(f.preReleaseSlot);
      } else {
        list.appendChild(row);
      }
    });
    // "Show sharpness hits left": its own line, right under Damage numbers (or at the end of its section).
    var sh = data.sharpness;
    if (sh && typeof sh === "object") {
      var shRow = featureRow({ id: "sharpnessHitsLeft", name: sh.name || "Show sharpness hits left", description: sh.description || "",
        minPatch: sh.minPatch, revealsHiddenInfo: sh.revealsHiddenInfo, enabled: sh.hitsLeft === true, lockedMessage: sh.lockedMessage,
        path: "/sharpness", bodyKey: "hitsLeft" });
      if (numbersRow && !!byId.damageNumbers.preReleaseOnly === !!sh.preReleaseOnly) numbersRow.parentNode.insertBefore(shRow, numbersRow.nextSibling);
      else (sh.preReleaseOnly ? preList : list).appendChild(shRow);
      if (sh.preReleaseOnly && sh.preReleaseSlot && slots.indexOf(sh.preReleaseSlot) < 0) slots.push(sh.preReleaseSlot);
    }
    if (!features.length) list.appendChild(el("p", "note-text", "No options are available yet."));
    preNote.textContent = (slots.length ? (slots.length > 1 ? "Slots: " : "Slot: ") + slots.join(", ") + ". " : "")
      + "These work only on a pre-release patch on the Test land.";
    place();
  }

  // The Keys and Viewer options parts sit in the pre-release section when every feature they belong to is pre-release only.
  function inPre(ids) {
    var any = false;
    for (var i = 0; i < ids.length; i++) {
      if (!byId[ids[i]]) continue;
      if (!byId[ids[i]].preReleaseOnly) return false;
      any = true;
    }
    return any;
  }

  function place() {
    var anchor = preBox;
    [[keysBox, ["quickRetire", "skipCompleteWait", "quickTalk"]], [viewerBox, ["iframeViewer"]]].forEach(function (p) {
      if (inPre(p[1])) preBox.appendChild(p[0]);
      else if (p[0].parentNode === preBox) anchor.parentNode.insertBefore(p[0], anchor);
    });
    // After a move back the two parts must keep their order: keys, then viewer.
    if (keysBox.parentNode === viewerBox.parentNode && keysBox.compareDocumentPosition(viewerBox) & 2) {
      keysBox.parentNode.insertBefore(keysBox, viewerBox);
    }
    preBox.hidden = !(preList.firstChild || (keysBox.parentNode === preBox && !keysBox.hidden)
      || (viewerBox.parentNode === preBox && !viewerBox.hidden));
  }

  /* ---- Keys ---- */
  var NAMED = { Insert: 1, Delete: 1, Home: 1, End: 1, PageUp: 1, PageDown: 1 };
  var keyState = null;   // { retire, mode, carts, skip, talk: [5] }, each key {key, ctrl, shift, alt} or null
  var capturing = null;  // the picker waiting for a key: { btn, set }

  function nameFromCode(code) {
    var m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
    if ((m = /^Numpad([0-9])$/.exec(code))) return "Num" + m[1];
    if (/^F([1-9]|1[0-2])$/.test(code)) return code;
    if (NAMED[code] === 1) return code;
    return "";
  }

  function validName(name) {
    return /^(F([1-9]|1[0-2])|[A-Z]|[0-9]|Num[0-9])$/.test(name) || NAMED[name] === 1;
  }

  function needsModifier(name) {
    return /^([A-Z]|[0-9]|Num[0-9])$/.test(name);
  }

  function fmt(k) {
    if (!k) return "";
    return (k.ctrl ? "Ctrl+" : "") + (k.shift ? "Shift+" : "") + (k.alt ? "Alt+" : "") + k.key;
  }

  function parse(text) {
    if (!text) return null;
    var parts = String(text).split("+");
    var k = { key: parts.pop(), ctrl: false, shift: false, alt: false };
    if (!validName(k.key)) return null;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "Ctrl") k.ctrl = true;
      else if (parts[i] === "Shift") k.shift = true;
      else if (parts[i] === "Alt") k.alt = true;
      else return null;
    }
    return k;
  }

  function cartsValue(v) {
    v = parseInt(v, 10);
    return v >= 1 && v <= 3 ? v : 1;
  }

  function stopCapture() {
    if (!capturing) return;
    capturing.btn.classList.remove("capturing");
    capturing.btn.textContent = fmt(capturing.get()) || "None";
    capturing = null;
  }

  function onCaptureKey(e) {
    if (!capturing) return;
    var code = e.code || "";
    if (/^(Control|Shift|Alt)(Left|Right)$/.test(code) || e.key === "Control" || e.key === "Shift" || e.key === "Alt") return;
    e.preventDefault();
    e.stopPropagation();
    if (code === "Escape" || e.key === "Escape") { stopCapture(); return; }
    var name = nameFromCode(code);
    if (!name) {
      capturing.btn.textContent = "Press a key…";
      say("That key cannot be used. Use F1-F12, a letter, a digit, a number pad digit, Insert, Delete, Home, End, Page Up or Page Down.", true);
      return;
    }
    var target = capturing;
    target.set({ key: name, ctrl: !!e.ctrlKey, shift: !!e.shiftKey, alt: !!e.altKey });
    stopCapture();
    say("");
  }
  document.addEventListener("keydown", onCaptureKey, true);

  function picker(parent, label, get, set, hint, locked) {
    var row = el("div", "qol-key-row");
    var id = "qol-key-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    row.appendChild(el("span", "qol-key-name", label));
    var btn = el("button", "btn btn-secondary btn-small qol-key-btn", fmt(get()) || "None");
    btn.type = "button";
    btn.id = id;
    var clear = el("button", "btn btn-secondary btn-small qol-key-clear", "Clear");
    clear.type = "button";
    clear.id = id + "-clear";
    btn.addEventListener("click", function () {
      var was = capturing;
      stopCapture();
      if (was && was.btn === btn) return;
      capturing = { btn: btn, get: get, set: function (k) { set(k); btn.textContent = fmt(k) || "None"; } };
      btn.classList.add("capturing");
      btn.textContent = "Press a key…";
      say("");
    });
    btn.addEventListener("blur", function () { if (capturing && capturing.btn === btn) stopCapture(); });
    clear.addEventListener("click", function () {
      stopCapture();
      set(null);
      btn.textContent = "None";
      say("");
    });
    if (locked) { btn.disabled = true; clear.disabled = true; }
    row.appendChild(btn);
    row.appendChild(clear);
    parent.appendChild(row);
    if (hint) parent.appendChild(el("p", "note-text", hint));
  }

  function renderKeys(k) {
    capturing = null;
    keysBox.innerHTML = "";
    if (!k) { keysBox.hidden = true; return; }
    var talk = [];
    for (var i = 0; i < 5; i++) talk.push(parse((k.talkKeys || [])[i]));
    keyState = {
      retire: parse(k.retireKey),
      mode: k.retireOnDeath === "cart" || k.retireOnDeath === "health" ? k.retireOnDeath : "off",
      carts: cartsValue(k.retireCarts),
      skip: parse(k.skipWaitKey),
      talk: talk
    };
    keysBox.hidden = false;
    keysBox.appendChild(el("h3", "", "Keys"));

    var lock1 = lockOf("quickRetire"), lock2 = lockOf("skipCompleteWait"), lock3 = lockOf("quickTalk");
    var g1 = el("div", "qol-keys-group");
    picker(g1, "Retire key", function () { return keyState.retire; }, function (v) { keyState.retire = v; }, "", lock1);
    var modeRow = el("div", "field");
    var modeLabel = el("label", "", "Retire on death");
    modeLabel.htmlFor = "qol-retire-mode";
    var mode = el("select");
    mode.id = "qol-retire-mode";
    [["off", "Off"], ["cart", "When I cart"], ["health", "When my health reaches 0"]].forEach(function (o) {
      var opt = el("option", "", o[1]);
      opt.value = o[0];
      mode.appendChild(opt);
    });
    mode.value = keyState.mode;
    mode.disabled = !!lock1;
    modeRow.appendChild(modeLabel);
    modeRow.appendChild(mode);
    g1.appendChild(modeRow);
    var cartsRow = el("div", "field");
    var cartsLabel = el("label", "", "Retire after N carts");
    cartsLabel.htmlFor = "qol-retire-carts";
    var carts = el("select");
    carts.id = "qol-retire-carts";
    for (var n = 1; n <= 3; n++) {
      var co = el("option", "", String(n));
      co.value = String(n);
      carts.appendChild(co);
    }
    carts.value = String(keyState.carts);
    carts.disabled = !!lock1;
    cartsRow.appendChild(cartsLabel);
    cartsRow.appendChild(carts);
    cartsRow.hidden = keyState.mode !== "cart";
    g1.appendChild(cartsRow);
    mode.addEventListener("change", function () {
      keyState.mode = mode.value;
      cartsRow.hidden = mode.value !== "cart";
    });
    carts.addEventListener("change", function () { keyState.carts = cartsValue(carts.value); });
    if (lock1) g1.appendChild(el("p", "note-text qol-locked", lock1));
    keysBox.appendChild(g1);

    var g2 = el("div", "qol-keys-group");
    picker(g2, "Skip-wait key", function () { return keyState.skip; }, function (v) { keyState.skip = v; }, "No key: always skip", lock2);
    if (lock2) g2.appendChild(el("p", "note-text qol-locked", lock2));
    keysBox.appendChild(g2);

    var g3 = el("div", "qol-keys-group");
    for (var t = 0; t < 5; t++) {
      (function (idx) {
        picker(g3, "Remote talk key " + (idx + 1), function () { return keyState.talk[idx]; }, function (v) { keyState.talk[idx] = v; }, "", lock3);
      })(t);
    }
    g3.appendChild(el("p", "note-text", "In the game, target the NPC or object and press Shift + the key to remember it (saved on that PC)"));
    if (lock3) g3.appendChild(el("p", "note-text qol-locked", lock3));
    keysBox.appendChild(g3);

    var actions = el("div", "qol-keys-actions");
    var saveBtn = el("button", "btn btn-primary btn-small", "Save keys");
    saveBtn.type = "button";
    saveBtn.id = "qol-keys-save";
    saveBtn.addEventListener("click", function () { saveKeys(saveBtn); });
    saveBtn.disabled = !!(lock1 && lock2 && lock3);
    actions.appendChild(saveBtn);
    keysBox.appendChild(actions);
  }

  /* ---- Viewer options ---- */
  var VIEWER_BOXES = [["iframeBar", "Iframe bar"], ["iframeCount", "Iframe count"], ["hitstopBar", "Hitstop bar"], ["hitIndicator", "Hit indicator"]];
  var VIEWER_POSITIONS = [["top", "Top"], ["center", "Centre"], ["bottom", "Bottom"], ["left", "Left"]];
  var VIEWER_SIZES = [["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["huge", "Huge"]];

  function pick(list, value, fallback) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === value) return value;
    return fallback;
  }

  function viewerSelect(parent, id, label, options, value) {
    var row = el("div", "field");
    var l = el("label", "", label);
    l.htmlFor = id;
    var sel = el("select");
    sel.id = id;
    options.forEach(function (o) {
      var opt = el("option", "", o[1]);
      opt.value = o[0];
      sel.appendChild(opt);
    });
    sel.value = value;
    row.appendChild(l);
    row.appendChild(sel);
    parent.appendChild(row);
    return sel;
  }

  function renderViewer(data) {
    viewerBox.innerHTML = "";
    var has = (data.features || []).some(function (f) { return f.id === "iframeViewer"; });
    var v = data.viewer;
    if (!has || !v || typeof v !== "object") { viewerBox.hidden = true; return; }
    viewerBox.hidden = false;
    var viewerLock = lockOf("iframeViewer");
    viewerBox.appendChild(el("h3", "", "Viewer options"));
    viewerBox.appendChild(el("p", "note-text", "What the iframe viewer draws, where and how big. They apply while the Iframe viewer switch is on."));
    var boxes = {};
    var checks = el("div", "qol-viewer-checks");
    VIEWER_BOXES.forEach(function (b) {
      var label = el("label", "qol-label");
      var box = el("input");
      box.type = "checkbox";
      box.id = "qol-viewer-" + b[0];
      box.checked = v[b[0]] !== false;
      box.disabled = !!viewerLock;
      label.htmlFor = box.id;
      label.appendChild(box);
      label.appendChild(el("span", "qol-name", b[1]));
      checks.appendChild(label);
      boxes[b[0]] = box;
    });
    viewerBox.appendChild(checks);
    var position = viewerSelect(viewerBox, "qol-viewer-position", "Position", VIEWER_POSITIONS, pick(VIEWER_POSITIONS, v.position, "top"));
    var size = viewerSelect(viewerBox, "qol-viewer-size", "Size", VIEWER_SIZES, pick(VIEWER_SIZES, v.size, "normal"));
    var actions = el("div", "qol-keys-actions");
    var saveBtn = el("button", "btn btn-primary btn-small", "Save viewer options");
    saveBtn.type = "button";
    saveBtn.id = "qol-viewer-save";
    saveBtn.addEventListener("click", function () {
      var body = {};
      VIEWER_BOXES.forEach(function (b) { body[b[0]] = boxes[b[0]].checked; });
      body.position = position.value;
      body.size = size.value;
      saveViewer(saveBtn, body);
    });
    position.disabled = !!viewerLock;
    size.disabled = !!viewerLock;
    saveBtn.disabled = !!viewerLock;
    actions.appendChild(saveBtn);
    if (viewerLock) viewerBox.appendChild(el("p", "note-text qol-locked", viewerLock));
    viewerBox.appendChild(actions);
  }

  function saveViewer(btn, body) {
    btn.disabled = true;
    say("Saving.");
    fetch(API + "/api/account/qol/viewer", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var err = new Error("HTTP " + r.status);
          err.serverMessage = data && (data.message || data.error);
          throw err;
        }
        return data;
      });
    }).then(function (data) {
      render(data);
      renderKeys(data.keys);
      renderViewer(data);
      place();
      say("Viewer options saved. They take effect from your next login to the game.");
    }).catch(function (e) {
      btn.disabled = false;
      say(e.serverMessage ? "Could not save the viewer options: " + e.serverMessage : "Could not save the viewer options. Try again in a moment.", true);
    });
  }

  // The same checks as the API (rules 2-4); returns a message, or "" when all is well.
  function keyProblem() {
    var all = [["Retire key", keyState.retire], ["Skip-wait key", keyState.skip]];
    for (var i = 0; i < 5; i++) all.push(["Remote talk key " + (i + 1), keyState.talk[i]]);
    var j, k;
    for (j = 0; j < all.length; j++) {
      k = all[j][1];
      if (k && needsModifier(k.key) && !k.ctrl && !k.alt) return all[j][0] + " (" + fmt(k) + "): letters and digits need Ctrl or Alt, they type text in the chat.";
    }
    for (j = 2; j < all.length; j++) {
      k = all[j][1];
      if (k && k.shift) return all[j][0] + " (" + fmt(k) + "): remote talk keys cannot use Shift, Shift + the key is how the game remembers a target.";
    }
    for (j = 0; j < all.length; j++) {
      for (var m = j + 1; m < all.length; m++) {
        if (all[j][1] && all[m][1] && fmt(all[j][1]) === fmt(all[m][1])) return all[j][0] + " and " + all[m][0] + " use the same key (" + fmt(all[j][1]) + "). Every key must be different.";
      }
    }
    for (j = 2; j < all.length; j++) {
      k = all[j][1];
      if (!k) continue;
      var withShift = fmt({ key: k.key, ctrl: k.ctrl, shift: true, alt: k.alt });
      for (var o = 0; o < all.length; o++) {
        if (o !== j && all[o][1] && fmt(all[o][1]) === withShift) return all[j][0] + " (" + fmt(k) + "): Shift + it is the same as " + all[o][0] + ", which would clash with remembering a target.";
      }
    }
    return "";
  }

  function saveKeys(btn) {
    stopCapture();
    var problem = keyProblem();
    if (problem) { say(problem, true); return; }
    var body = {
      retireKey: fmt(keyState.retire) || null,
      retireOnDeath: keyState.mode,
      retireCarts: keyState.mode === "cart" ? keyState.carts : 1,
      skipWaitKey: fmt(keyState.skip) || null,
      talkKeys: keyState.talk.map(function (k) { return fmt(k) || null; })
    };
    btn.disabled = true;
    say("Saving.");
    fetch(API + "/api/account/qol/keys", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var err = new Error("HTTP " + r.status);
          err.serverMessage = data && (data.message || data.error);
          throw err;
        }
        return data;
      });
    }).then(function (data) {
      render(data);
      renderKeys(data.keys);
      renderViewer(data);
      place();
      say("Keys saved. They take effect from your next login to the game.");
    }).catch(function (e) {
      btn.disabled = false;
      say(e.serverMessage ? "Could not save the keys: " + e.serverMessage : "Could not save the keys. Try again in a moment.", true);
    });
  }

  // feature.path / feature.bodyKey: a line that is not a flags bit (sharpness: PUT /api/account/qol/sharpness {hitsLeft}).
  function save(feature, box) {
    var body = {};
    body[feature.bodyKey || feature.id] = box.checked;
    box.disabled = true;
    say("Saving.");
    fetch(API + "/api/account/qol" + (feature.path || ""), {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var err = new Error("HTTP " + r.status);
          err.serverMessage = data && (data.message || data.error);
          throw err;
        }
        return data;
      });
    }).then(function (data) {
      render(data);
      say("Saved. " + feature.name + " is " + (box.checked ? "on" : "off") + " from your next login to the game.");
    }).catch(function (e) {
      box.checked = !box.checked;
      box.disabled = false;
      say(e.serverMessage || "Could not save. Try again in a moment.", true);
    });
  }

  // refresh: a reload after the channel changed; the card stays as it is when the call fails.
  function load(refresh) {
    if (!token()) {
      say("Sign in to change your game options.");
      list.innerHTML = ""; preList.innerHTML = ""; preBox.hidden = true; keysBox.hidden = true; viewerBox.hidden = true;
      return;
    }
    fetch(API + "/api/account/qol", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (data) {
        render(data);
        renderKeys(data.keys);
        renderViewer(data);
        place();
      })
      .catch(function () {
        if (refresh) return;
        list.innerHTML = "";
        preList.innerHTML = "";
        preBox.hidden = true;
        keysBox.hidden = true;
        viewerBox.hidden = true;
        say("Your game options could not be loaded right now.", true);
      });
  }

  document.addEventListener("hvmhfz:patch-channel", function () { load(true); });

  load(false);
})();
