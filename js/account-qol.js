/* "Game options" card on the Account tab: one switch per display-only client feature from
   GET /api/account/qol (the list comes from the API, nothing is hard-coded here). A toggle saves at once with
   PUT /api/account/qol {id: true|false}. The game reads the choice at the next login.
   When the answer has "keys", a Keys part lets the player pick the keys the mods use (retire key and what to do on a
   cart or death, skip-wait key, five remote talk keys); "Save keys" sends PUT /api/account/qol/keys.
   When the feature list has "iframeViewer" and the answer has "viewer", a Viewer options part shows four checkboxes
   (iframe bar, iframe count, hitstop bar, hit indicator), a position and a size; "Save viewer options" sends all six
   keys with PUT /api/account/qol/viewer. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  var list = document.getElementById("qol-list");
  var note = document.getElementById("qol-note");
  var alertNode = document.getElementById("qol-alert");
  var keysBox = document.getElementById("qol-keys");
  var viewerBox = document.getElementById("qol-viewer");
  if (!list) return;

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

  function render(data) {
    list.innerHTML = "";
    (data.features || []).forEach(function (f) {
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
      if (f.id === "iframeViewer") row.appendChild(el("p", "note-text qol-event", VIEWER_EVENT_RULE));
      box.addEventListener("change", function () { save(f, box); });
      list.appendChild(row);
    });
    if (!(data.features || []).length) list.appendChild(el("p", "note-text", "No options are available yet."));
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

  function picker(parent, label, get, set, hint) {
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

    var g1 = el("div", "qol-keys-group");
    picker(g1, "Retire key", function () { return keyState.retire; }, function (v) { keyState.retire = v; });
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
    cartsRow.appendChild(cartsLabel);
    cartsRow.appendChild(carts);
    cartsRow.hidden = keyState.mode !== "cart";
    g1.appendChild(cartsRow);
    mode.addEventListener("change", function () {
      keyState.mode = mode.value;
      cartsRow.hidden = mode.value !== "cart";
    });
    carts.addEventListener("change", function () { keyState.carts = cartsValue(carts.value); });
    keysBox.appendChild(g1);

    var g2 = el("div", "qol-keys-group");
    picker(g2, "Skip-wait key", function () { return keyState.skip; }, function (v) { keyState.skip = v; }, "No key: always skip");
    keysBox.appendChild(g2);

    var g3 = el("div", "qol-keys-group");
    for (var t = 0; t < 5; t++) {
      (function (idx) {
        picker(g3, "Remote talk key " + (idx + 1), function () { return keyState.talk[idx]; }, function (v) { keyState.talk[idx] = v; });
      })(t);
    }
    g3.appendChild(el("p", "note-text", "In the game, target the NPC or object and press Shift + the key to remember it (saved on that PC)"));
    keysBox.appendChild(g3);

    var actions = el("div", "qol-keys-actions");
    var saveBtn = el("button", "btn btn-primary btn-small", "Save keys");
    saveBtn.type = "button";
    saveBtn.id = "qol-keys-save";
    saveBtn.addEventListener("click", function () { saveKeys(saveBtn); });
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
    actions.appendChild(saveBtn);
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
      say("Keys saved. They take effect from your next login to the game.");
    }).catch(function (e) {
      btn.disabled = false;
      say(e.serverMessage ? "Could not save the keys: " + e.serverMessage : "Could not save the keys. Try again in a moment.", true);
    });
  }

  function save(feature, box) {
    var body = {};
    body[feature.id] = box.checked;
    box.disabled = true;
    say("Saving.");
    fetch(API + "/api/account/qol", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      render(data);
      say("Saved. " + feature.name + " is " + (box.checked ? "on" : "off") + " from your next login to the game.");
    }).catch(function () {
      box.checked = !box.checked;
      box.disabled = false;
      say("Could not save. Try again in a moment.", true);
    });
  }

  function load() {
    if (!token()) { say("Sign in to change your game options."); list.innerHTML = ""; keysBox.hidden = true; viewerBox.hidden = true; return; }
    fetch(API + "/api/account/qol", { headers: { Authorization: "Bearer " + token() }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (data) {
        render(data);
        renderKeys(data.keys);
        renderViewer(data);
      })
      .catch(function () {
        list.innerHTML = "";
        keysBox.hidden = true;
        viewerBox.hidden = true;
        say("Your game options could not be loaded right now.", true);
      });
  }

  load();
})();
