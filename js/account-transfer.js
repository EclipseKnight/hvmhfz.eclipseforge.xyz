/* Account page, Transfer tab: the transfer wizard. A player bringing a character from another server (or one
   of our backups) goes through six steps on one page, with no throwaway character and no first login:

     1. the game account the character goes to: the signed-in one (signed out, account.html sends the visitor
        to /?next=/account.html#transfer, where they sign in or create an account and come back here);
     2. the file: our backup zip, another server's zip, a newer Erupe server's export JSON or a bare savedata
        file, read in the browser by js/backup-file.js;
     3. what is in it: POST /api/account/characters/import-new/preview (nothing is written);
     4. where it goes: a new character (the default) or a character already on the account;
     5. confirm: for a character already on the account, its own preview first (with the "less play" warning);
        Confirm sends exactly the previewed body;
     6. done: "Now install and play", to /play.html.

   Previews are drawn by the Backups tab's renderer (window.HvImportView, js/account-backup.js). Until the API
   has the import-new endpoints (404 without the API's refusal body), the tab says the wizard is coming soon.
   Design: /root/mhfz/docs/onboarding-audit.md section 3 item 5; the API: hvmhfz_rest_api README
   "Character import". */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var Files = window.HvBackupFile;
  var View = window.HvImportView;

  var $ = function (id) { return document.getElementById(id); };
  var root = $("transfer-steps");
  if (!root || !Files || !View) return;

  var note = $("transfer-note");
  var soon = $("transfer-soon");
  var fileInput = $("wz-file-input");
  var fileNote = $("wz-file-note");
  var previewBox = $("wz-preview-body");
  var previewAlert = $("wz-preview-alert");
  var newOption = $("wz-target-new");
  var oldOption = $("wz-target-old");
  var newLabel = $("wz-target-new-label");
  var characterSelect = $("wz-character");
  var confirmBody = $("wz-confirm-body");
  var confirmAlert = $("wz-confirm-alert");
  var confirmButton = $("wz-confirm-btn");
  var restartButton = $("wz-restart");
  var doneText = $("wz-done-text");

  var STEPS = ["account", "file", "preview", "target", "confirm", "done"];
  var chosen = null;     // what the chosen file holds (Files.readImportFile)
  var newPlan = null;    // the import-new preview of the chosen file, or null when it can't be a new character
  var planned = null;    // {path, body} of the preview in step 5: Confirm sends exactly this
  var characters = [];
  var serial = 0;        // a later file or choice makes the answers of earlier requests stale

  /* ---------- requests ---------- */

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  /* The account name from the saved sign-in (the JWT's subject), for step 1. */
  function accountName() {
    try {
      var payload = token().split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      var claims = JSON.parse(decodeURIComponent(escape(atob(payload))));
      return typeof claims.sub === "string" ? claims.sub : "";
    } catch (e) {
      return "";
    }
  }

  /* Resolves {ok, status, body}; a network failure resolves status 0. A 404 or 405 without the API's refusal
     body ({message, problems}) means the endpoint isn't deployed yet: the tab switches to "coming soon". */
  function call(path, body) {
    var headers = { Authorization: "Bearer " + token() };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: body ? "POST" : "GET", headers: headers, cache: "no-store",
      body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (b) {
          return { ok: r.ok, status: r.status, body: b };
        });
      }, function () { return { ok: false, status: 0, body: null }; })
      .then(function (res) {
        if (!res.ok && (res.status === 404 || res.status === 405) && !(res.body && Array.isArray(res.body.problems))) {
          comingSoon();
          res.soon = true;
        }
        return res;
      });
  }

  function refused(res) {
    return res.status ? View.refusal(res.status, res.body) : { text: "Could not reach the server. Nothing was changed. Try again in a moment." };
  }

  /* ---------- DOM ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function show(box, message) {
    clear(box);
    if (!message) { box.hidden = true; return; }
    box.appendChild(el("span", null, message.text));
    if (message.list && message.list.length) {
      var ul = el("ul", "backup-problems");
      message.list.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      box.appendChild(ul);
    }
    box.hidden = false;
  }

  /* Steps up to `upTo` are open; the ones before it are marked done. */
  function openSteps(upTo) {
    var last = STEPS.indexOf(upTo);
    STEPS.forEach(function (name, i) {
      var step = $("wz-" + name);
      step.hidden = i > last;
      step.dataset.state = i < last ? "done" : (i === last ? "current" : "todo");
    });
  }

  function comingSoon() {
    soon.hidden = false;
    root.hidden = true;
    note.textContent = "coming soon";
  }

  function sayFile(text, bad) {
    fileNote.textContent = text;
    fileNote.classList.toggle("bad", !!bad);
  }

  /* ---------- step 2: the file ---------- */

  function readFile() {
    var mine = ++serial;
    chosen = null;
    newPlan = null;
    planned = null;
    openSteps("file");
    var file = fileInput.files && fileInput.files[0];
    if (!file) { sayFile("", false); return; }
    sayFile("Reading " + file.name + ".", false);
    file.arrayBuffer().then(function (buffer) {
      return Files.readImportFile(file.name, new Uint8Array(buffer));
    }).then(function (result) {
      if (mine !== serial) return;
      chosen = result;
      sayFile(View.describeFile(result), false);
      previewFile(mine);
    }).catch(function (error) {
      if (mine !== serial) return;
      sayFile((error && error.player ? error.message : "That file can't be read.") +
        " Use the zip or JSON file exactly as the other server gave it to you.", true);
    });
  }

  /* ---------- step 3: what is in it (as a new character) ---------- */

  function previewFile(mine) {
    clear(previewBox);
    show(previewAlert, null);
    call("/api/account/characters/import-new/preview", chosen.body).then(function (res) {
      if (mine !== serial || res.soon) return;
      openSteps("target");
      if (res.ok) {
        newPlan = res.body;
        View.renderPlan(previewBox, newPlan);
      } else {
        newPlan = null;
        show(previewAlert, refused(res));
        // A file whose parts fail the checks fails them on any character: stop here.
        if (res.status === 400 && !/needs the save/i.test((res.body && res.body.message) || "")) {
          openSteps("preview");
          return;
        }
        if (res.status === 0 || res.status === 401) { openSteps("preview"); return; }
      }
      renderTargets();
    });
  }

  /* ---------- step 4: where it goes ---------- */

  function renderTargets() {
    var free = !!newPlan;
    newOption.disabled = !free;
    newLabel.textContent = free
      ? "A new character, " + newPlan.characterName + " (slot " + (newPlan.newCharacter.charactersBefore + 1) + " of " +
        newPlan.newCharacter.maxCharacters + "). Recommended: nothing you have now changes."
      : "A new character: not possible with this file or account (see above).";
    clear(characterSelect);
    var first = el("option", null, characters.length ? "Choose a character" : "No characters on this account yet");
    first.value = "";
    characterSelect.appendChild(first);
    characters.forEach(function (c) {
      var option = el("option", null, (c.name || "(no name)") + " · id " + c.id + (c.hr ? " · " + (window.HvHr && HvHr.label(c.hr) || "HR " + c.hr) : "") +
        (c.gr ? " · GR " + c.gr : ""));
      option.value = String(c.id);
      characterSelect.appendChild(option);
    });
    oldOption.disabled = !characters.length;
    newOption.checked = free;
    oldOption.checked = !free && characters.length > 0;
    characterSelect.disabled = !characters.length;   // picking a character ticks its option
    chooseTarget();
  }

  function chooseTarget() {
    var mine = ++serial;
    planned = null;
    clear(confirmBody);
    show(confirmAlert, null);
    confirmButton.hidden = true;
    if (newOption.checked && newPlan) {
      openSteps("confirm");
      planned = { path: "/api/account/characters/import-new", body: chosen.body };
      confirmBody.appendChild(el("p", "backup-target", "Make " + newPlan.characterName + " a new character on your account."));
      confirmBody.appendChild(el("p", "note-text", "Your other characters stay as they are. The new one starts without " +
        "Road skill levels, guild, warehouse or mail: those stay on the server it came from."));
      confirmButton.textContent = "Make the character";
      confirmButton.hidden = false;
      return;
    }
    if (!oldOption.checked || !characterSelect.value) {
      openSteps("target");
      return;
    }
    // A character already on the account: its own preview, with what it has now and the "less play" warning.
    var body = { characterId: Number(characterSelect.value) };
    Object.keys(chosen.body).forEach(function (k) { body[k] = chosen.body[k]; });
    openSteps("confirm");
    confirmBody.appendChild(el("p", "note-text", "Checking what changes."));
    call("/api/account/characters/import/preview", body).then(function (res) {
      if (mine !== serial || res.soon) return;
      clear(confirmBody);
      if (!res.ok) { show(confirmAlert, refused(res)); return; }
      planned = { path: "/api/account/characters/import", body: body };
      View.renderPlan(confirmBody, res.body);
      confirmBody.insertBefore(el("p", "note-text", "This replaces the save of a character you have now. Log out of " +
        "the game first."), confirmBody.firstChild);
      confirmButton.textContent = "Confirm import";
      confirmButton.hidden = false;
    });
  }

  /* ---------- step 5: confirm, step 6: done ---------- */

  function confirm() {
    if (!planned) return;
    var sent = planned;
    confirmButton.disabled = true;
    restartButton.disabled = true;
    call(sent.path, sent.body).then(function (res) {
      if (res.soon) return;
      if (!res.ok) {
        show(confirmAlert, refused(res));
        confirmButton.hidden = true;
        return;
      }
      var plan = res.body || {};
      planned = null;
      openSteps("done");
      confirmButton.hidden = true;
      doneText.textContent = (plan.newCharacter
        ? plan.characterName + " is on your account now as a new character (id " + plan.characterId + ")."
        : "Imported into " + plan.characterName + " (id " + plan.characterId + ").") +
        " Import #" + plan.importId + " is in the Backups tab's list.";
      $("wz-done-who").textContent = accountName() || "your account";
      $("wz-done-hunter").textContent = plan.characterName || "your hunter";
      if (View.reloadHistory) View.reloadHistory();
      loadCharacters();
    }).then(function () {
      confirmButton.disabled = false;
      restartButton.disabled = false;
    });
  }

  function restart() {
    serial++;
    fileInput.value = "";
    chosen = null;
    newPlan = null;
    planned = null;
    sayFile("", false);
    clear(previewBox);
    clear(confirmBody);
    show(previewAlert, null);
    show(confirmAlert, null);
    openSteps("file");
  }

  function loadCharacters() {
    return call("/api/account/characters").then(function (res) {
      characters = res.ok && Array.isArray(res.body) ? res.body : [];
    });
  }

  /* ---------- start ---------- */

  function start() {
    if (!token()) return;   // account.js sends a signed-out visitor to the sign-in, which comes back here
    var name = accountName();
    $("wz-username").textContent = name || "your account";
    openSteps("file");
    note.textContent = "6 steps";
    loadCharacters();
    fileInput.addEventListener("change", readFile);
    newOption.addEventListener("change", chooseTarget);
    oldOption.addEventListener("change", chooseTarget);
    characterSelect.addEventListener("change", function () {
      oldOption.checked = true;
      chooseTarget();
    });
    confirmButton.addEventListener("click", confirm);
    restartButton.addEventListener("click", restart);
    $("wz-again").addEventListener("click", restart);
    // Another account: sign out here, then the sign-in (or sign-up) page brings the player back to this tab.
    $("wz-switch").addEventListener("click", function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode: nothing saved anyway */ }
      window.location.assign(window.HvNext ? window.HvNext.signinUrl("/account.html#transfer") : "/#login-form");
    });
  }

  start();
})();
