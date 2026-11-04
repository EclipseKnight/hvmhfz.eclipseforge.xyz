/* Account page, Backups tab: download a character's backup, import a backup into a character (preview
   first, then confirm), and this account's import history. Files are read and written in the browser by
   js/backup-file.js; the API checks and logs every import (docs/character-backup-web.md).

   Until the API has the account endpoints, GET /api/account/characters/imports answers 404 and the tab says
   backups are coming soon instead of showing errors.

   The transfer wizard (js/account-transfer.js) shows its previews with this tab's renderer and words:
   window.HvImportView. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var Files = window.HvBackupFile;

  var $ = function (id) { return document.getElementById(id); };
  var panel = $("backup-live");
  if (!panel || !Files) return;

  var note = $("backup-note");
  var soon = $("backup-soon");
  var alertBox = $("backup-alert");
  var listBody = $("backup-characters");
  var fileInput = $("import-file");
  var fileNote = $("import-file-note");
  var target = $("import-target");
  var previewButton = $("import-preview-btn");
  var preview = $("import-preview");
  var confirmButton = $("import-confirm");
  var cancelButton = $("import-cancel");
  var done = $("import-done");
  var history = $("import-history");

  var characters = [];
  var chosen = null;   // what the chosen file holds (Files.readImportFile)
  var planned = null;  // {body, characterId} of the preview on screen: Confirm sends exactly this

  /* ---------- words for the player ---------- */

  var PART_LABELS = {
    savedata: "Save: equipment, item box and pouch, zenny, ranks, Road points and equipped Road skills",
    decomyset: "Decoration sets",
    hunternavi: "Hunter Navi",
    otomoairou: "Felynes",
    partner: "Partner",
    platebox: "Plate box",
    platedata: "Plates",
    platemyset: "Plate sets",
    rengokudata: "Hunting Road block",
    savemercenary: "Mercenary",
    skin_hist: "Skin history",
    scenariodata: "Story progress",
    savefavoritequest: "Favourite quests",
    mezfes: "MezFes",
    minidata: "Mini data"
  };

  var SOURCES = {
    "ours-verified": "Our backup of this character, unchanged.",
    "ours-other-character": "Our backup, but of another character.",
    "modified": "Our backup, changed after it was made (or its parts don't match its manifest).",
    "unverified": "Our backup; the server can't check its signature right now.",
    "foreign": "Save files without a manifest: an older backup, another server's files, or edited files.",
    "erupe-export": "A character export from a newer Erupe server."
  };

  /* What a chosen file is (Files.readImportFile's kind). */
  var KINDS = {
    backup: "Our backup zip (with its manifest)",
    files: "Save files without a manifest (another server's zip, or an older backup of ours)",
    export: "A character export from a newer Erupe server",
    bare: "A single save file, not in a zip"
  };

  var POLICIES = {
    restore: "They go back to what they were when the backup was made.",
    clear: "They are cleared: buy them again with the Road points in the save.",
    keep: "They stay as they are (the file has no save)."
  };

  function partLabel(part) { return PART_LABELS[part] || part; }

  function bytes(n) {
    if (n === null || n === undefined) return "none";
    return Number(n).toLocaleString() + (n === 1 ? " byte" : " bytes");
  }

  function grouped(n) { return n === null || n === undefined ? "-" : Number(n).toLocaleString(); }

  /* Play time as the game shows it: "1,307 h 40 min". */
  function playtime(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    return Math.floor(seconds / 3600).toLocaleString() + " h " + Math.floor((seconds % 3600) / 60) + " min";
  }

  /* "7 hours", "7.5 hours", or minutes under an hour. */
  function lessPlay(seconds) {
    if (seconds < 3600) {
      var minutes = Math.max(1, Math.floor(seconds / 60));
      return minutes + (minutes === 1 ? " minute" : " minutes");
    }
    var hours = seconds / 3600;
    var text = hours >= 100 ? String(Math.round(hours)) : hours.toFixed(1).replace(/\.0$/, "");
    return text + (text === "1" ? " hour" : " hours");
  }

  function when(value) {
    if (!value) return "Never";
    var d = new Date(value);
    return isNaN(d.getTime()) ? "-" :
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
  }

  /* A refused request in plain words: the API's reasons (README "Character import") made friendlier. */
  function refusal(status, body) {
    var message = body && typeof body.message === "string" ? body.message : "";
    var problems = body && Array.isArray(body.problems) ? body.problems : [];
    if (status === 401) return { text: "Your sign-in has run out. Sign in again and retry." };
    if (status === 409 && /online/i.test(message)) {
      return { text: "That character is in the game right now. Log out to the title screen or quit the game, then try again." };
    }
    if (status === 409 && /deleted/i.test(message)) {
      return { text: "That character is deleted, so it can't take an import. Choose another character." };
    }
    if (status === 409 && /never played/i.test(message)) {
      return { text: "That character was never played. Log in with it once, then import." };
    }
    if (status === 409 && /already has \d+ characters/i.test(message)) {
      var count = /already has (\d+)/i.exec(message)[1];
      return { text: "Your account already has " + count + " characters, the most the game shows. Import into one of " +
        "them instead, or delete one in the game first." };
    }
    if (status === 400 && /needs the save/i.test(message)) {
      return { text: "This file has no save (savedata), so it can't become a new character. It can only update parts " +
        "of a character you already have." };
    }
    if (status === 400 && problems.length) {
      return { text: "This file can't be imported, so nothing was changed. What failed the checks:", list: problems };
    }
    if (status === 404) return { text: "That character is not on your account." };
    if (status === 413) return { text: "That file is too big to be a character backup." };
    if (status === 503) return { text: "Backups are switched off on the server right now. Try again later." };
    if (message) return { text: message, list: problems };
    return { text: "The server refused it (HTTP " + status + "). Try again in a moment." };
  }

  /* ---------- requests ---------- */

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  /* Resolves {ok, status, body}; a network failure resolves status 0. A 404 without the API's own refusal
     body ({message, problems}) means the endpoint isn't there yet: the whole tab switches to "coming soon". */
  function call(path, options) {
    var o = options || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, cache: "no-store",
      body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          return { ok: r.ok, status: r.status, body: body };
        });
      }, function () { return { ok: false, status: 0, body: null }; })
      .then(function (res) {
        if (!res.ok && notThereYet(res)) { comingSoon(); res.soon = true; }
        return res;
      });
  }

  function notThereYet(res) {
    return (res.status === 404 || res.status === 405) && !(res.body && Array.isArray(res.body.problems));
  }

  /* ---------- small DOM helpers ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function show(box, message) {
    clear(box);
    box.appendChild(el("span", null, message.text));
    if (message.list && message.list.length) {
      var ul = el("ul", "backup-problems");
      message.list.forEach(function (line) { ul.appendChild(el("li", null, line)); });
      box.appendChild(ul);
    }
    box.hidden = false;
  }

  function sayAlert(message) { if (message) show(alertBox, message); else alertBox.hidden = true; }

  function comingSoon() {
    soon.hidden = false;
    panel.hidden = true;
    note.textContent = "coming soon";
  }

  /* ---------- characters and downloads ---------- */

  function renderCharacters() {
    clear(listBody);
    clear(target);
    target.appendChild(el("option", null, "Choose a character"));
    target.firstChild.value = "";
    if (!characters.length) {
      var tr = el("tr");
      var td = el("td", "empty-cell", "No characters on this account yet.");
      td.colSpan = 6;
      tr.appendChild(td);
      listBody.appendChild(tr);
      return;
    }
    characters.forEach(function (c) {
      var tr = el("tr");
      tr.dataset.character = String(c.id);
      [c.name || "(no name)", String(c.id), grouped(c.hr), grouped(c.gr), when(c.lastLogin)].forEach(function (v, i) {
        tr.appendChild(el("td", i === 1 ? "num muted" : (i === 2 || i === 3 ? "num" : null), v));
      });
      var cell = el("td");
      var button = el("button", "btn btn-small backup-download", "Download backup");
      button.type = "button";
      button.addEventListener("click", function () { download(c, button); });
      cell.appendChild(button);
      tr.appendChild(cell);
      listBody.appendChild(tr);

      var option = el("option", null, (c.name || "(no name)") + " · id " + c.id +
        (c.hr ? " · HR " + c.hr : "") + (c.gr ? " · GR " + c.gr : ""));
      option.value = String(c.id);
      target.appendChild(option);
    });
  }

  function download(character, button) {
    sayAlert(null);
    button.disabled = true;
    button.textContent = "Preparing";
    call("/api/account/characters/" + encodeURIComponent(character.id) + "/backup").then(function (res) {
      if (res.soon) return;
      if (!res.ok) { sayAlert(res.status ? refusal(res.status, res.body) : { text: "Could not reach the server. Try again in a moment." }); return; }
      var zip = Files.makeBackupZip(res.body, new Date());
      var url = URL.createObjectURL(new Blob([zip.bytes], { type: "application/zip" }));
      var link = el("a");
      link.href = url;
      link.download = zip.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      button.dataset.saved = zip.fileName;
    }).catch(function (error) {
      sayAlert({ text: error && error.player ? error.message : "Could not make the backup file." });
    }).then(function () {
      button.disabled = false;
      button.textContent = "Download backup";
    });
  }

  /* ---------- import: file, preview, confirm ---------- */

  function resetPreview() {
    planned = null;
    preview.hidden = true;
    clear(preview.querySelector(".preview-body"));
    $("import-preview-alert").hidden = true;
  }

  function sayFile(text, bad) {
    fileNote.textContent = text;
    fileNote.classList.toggle("bad", !!bad);
  }

  function readChosenFile() {
    resetPreview();
    done.hidden = true;
    chosen = null;
    var file = fileInput.files && fileInput.files[0];
    if (!file) { sayFile("", false); return; }
    sayFile("Reading " + file.name + ".", false);
    file.arrayBuffer().then(function (buffer) {
      return Files.readImportFile(file.name, new Uint8Array(buffer));
    }).then(function (result) {
      if (!fileInput.files || fileInput.files[0] !== file) return; // another file was chosen meanwhile
      chosen = result;
      var text = describeFile(result);
      sayFile(text, false);
    }).catch(function (error) {
      if (!fileInput.files || fileInput.files[0] !== file) return;
      sayFile(error && error.player ? error.message : "That file can't be read.", true);
    });
  }

  /* One line on what a file read by Files.readImportFile holds, for the player. */
  function describeFile(result) {
    var count = result.body.parts ? Object.keys(result.body.parts).length : null;
    var text = KINDS[result.kind] + (count !== null ? ", " + count + (count === 1 ? " part" : " parts") : "");
    var from = result.manifestInfo;
    if (from && from.name) text += ": " + from.name + " (id " + from.characterId + ")" +
      (from.exportedAt ? ", made " + when(from.exportedAt) : "");
    var skipped = result.files.filter(function (f) { return / skipped$/.test(f.status); });
    if (skipped.length) text += ". Skipped: " + skipped.map(function (f) { return f.name + " (" + f.status.replace(/, skipped$/, "") + ")"; }).join(", ");
    return text + ".";
  }

  function requestBody() {
    var body = { characterId: Number(target.value) };
    Object.keys(chosen.body).forEach(function (k) { body[k] = chosen.body[k]; });
    return body;
  }

  function runPreview() {
    resetPreview();
    done.hidden = true;
    if (!chosen) { sayFile("Choose a backup file first.", true); return; }
    if (!target.value) { sayFile("Choose the character to import into.", true); return; }
    var body = requestBody();
    previewButton.disabled = true;
    call("/api/account/characters/import/preview", { method: "POST", body: body }).then(function (res) {
      if (res.soon) return;
      preview.hidden = false;
      if (!res.ok) {
        show($("import-preview-alert"), res.status ? refusal(res.status, res.body) : { text: "Could not reach the server. Try again in a moment." });
        confirmButton.hidden = true;
        return;
      }
      planned = { body: body, characterId: body.characterId };
      renderPlan(res.body);
      confirmButton.hidden = false;
      confirmButton.disabled = false;
    }).then(function () { previewButton.disabled = false; });
  }

  function dl(list, rows) {
    rows.forEach(function (row) {
      list.appendChild(el("dt", null, row[0]));
      list.appendChild(el("dd", null, row[1]));
    });
  }

  /* What must not be missed before Confirm: shown first, in red. An older file rolled a player back once
     because HR, zenny and Road points all looked fine. olderBySeconds is the API's (absent on an old API). */
  function alerts(plan) {
    var out = [];
    var skills = plan.roadSkills || {};
    if (plan.save && plan.save.olderBySeconds > 0) {
      out.push("This file has " + lessPlay(plan.save.olderBySeconds) + " less play than your character now. " +
        "Importing it will lose that progress.");
    }
    if (skills.policy === "clear" && skills.levelsBefore > 0) {
      out.push(plan.characterName + " has " + skills.levelsBefore + " Road skill levels now. They will be cleared; the Road points in the file stay.");
    }
    return out;
  }

  function warnings(plan) {
    var out = [];
    var after = plan.save && plan.save.after;
    if (plan.source === "ours-other-character" && plan.manifest) {
      out.push("This backup is of another character" + (plan.manifest.name ? " (" + plan.manifest.name +
        (plan.manifest.characterId ? ", id " + plan.manifest.characterId : "") + ")" : "") +
        ". " + (plan.newCharacter ? "The new character is a copy of it." : plan.characterName + " becomes a copy of it."));
    }
    if (plan.source === "modified") out.push("The file was changed after the backup was made, so it counts as any other file.");
    if (!plan.newCharacter && after && after.name && plan.characterName && after.name !== plan.characterName) {
      out.push("The save in the file is the hunter " + after.name + ", not " + plan.characterName + ".");
    }
    if (!plan.save) out.push("The file has no save, only the parts listed below change.");
    if (plan.save && plan.save.migrationFlagWasSet === false) {
      out.push("The save had not been through the Road skill update; it is marked done, so the update can't run on it again.");
    }
    return out;
  }

  function renderPlan(plan) {
    renderPlanInto(preview.querySelector(".preview-body"), plan);
  }

  /* The plan of a preview (or of a done import) in box. A plan with newCharacter is an import into a new
     character (POST /api/account/characters/import-new/preview): there is nothing "now". */
  function renderPlanInto(box, plan) {
    clear(box);
    var fresh = plan.newCharacter;
    box.appendChild(el("p", "backup-target", fresh
      ? "A new character: " + plan.characterName + (plan.characterId ? " (id " + plan.characterId + ")" : "") +
        ", slot " + (fresh.charactersBefore + 1) + " of " + fresh.maxCharacters + " on your account"
      : "Into " + plan.characterName + " (id " + plan.characterId + ")"));
    box.appendChild(el("p", "note-text", SOURCES[plan.source] || plan.sourceNote || plan.source));

    var alert = alerts(plan);
    if (alert.length) {
      var a = el("ul", "backup-alert");
      a.setAttribute("role", "alert");
      alert.forEach(function (line) { a.appendChild(el("li", null, line)); });
      box.appendChild(a);
    }

    var warn = warnings(plan);
    if (warn.length) {
      var w = el("ul", "backup-warnings");
      warn.forEach(function (line) { w.appendChild(el("li", null, line)); });
      box.appendChild(w);
    }

    box.appendChild(el("p", "subhead", "What changes"));
    var table = el("table", "data-table backup-parts");
    table.setAttribute("data-nosort", "");
    var head = el("tr");
    ["Part", "Now", "From the file", ""].forEach(function (h) { head.appendChild(el("th", null, h)); });
    var thead = el("thead");
    thead.appendChild(head);
    table.appendChild(thead);
    var tbody = el("tbody");
    (plan.parts || []).forEach(function (p) {
      var tr = el("tr");
      tr.dataset.part = p.part;
      tr.appendChild(el("td", null, partLabel(p.part)));
      tr.appendChild(el("td", "num", bytes(p.oldSize)));
      tr.appendChild(el("td", "num", bytes(p.newSize)));
      tr.appendChild(el("td", "muted", p.action === "same" ? "no change" : p.action === "new" ? "new" : "replaced"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var wrap = el("div", "table-wrap");
    wrap.appendChild(table);
    box.appendChild(wrap);

    if (plan.save && plan.save.after) {
      var before = plan.save.before || {};
      var after = plan.save.after;
      var facts = el("table", "data-table backup-facts");
      facts.setAttribute("data-nosort", "");
      var fh = el("tr");
      ["", "Now", "After"].forEach(function (h) { fh.appendChild(el("th", null, h)); });
      var fhead = el("thead");
      fhead.appendChild(fh);
      facts.appendChild(fhead);
      var fbody = el("tbody");
      [["Hunter", before.name, after.name], ["Zenny", grouped(before.zenny), grouped(after.zenny)],
       ["HR", grouped(before.hr), grouped(after.hr)], ["GR points", grouped(before.grp), grouped(after.grp)],
       ["Road points", grouped(before.roadSp), grouped(after.roadSp)],
       ["Equipped Road skills", grouped(before.equippedRoadSkills), grouped(after.equippedRoadSkills)]]
        .concat(after.playtimeSeconds === undefined ? [] : [   // an API from before 2026-11-04 doesn't send these
          ["Play time", playtime(before.playtimeSeconds), playtime(after.playtimeSeconds)],
          ["Monsters hunted", grouped(before.huntCount), grouped(after.huntCount)]])
        .forEach(function (row) {
          var tr = el("tr");
          tr.appendChild(el("td", "backup-fact", row[0]));
          tr.appendChild(el("td", "num", plan.save.before ? (row[1] === undefined ? "-" : row[1]) : "-"));
          tr.appendChild(el("td", "num", row[2] === undefined ? "-" : row[2]));
          fbody.appendChild(tr);
        });
      facts.appendChild(fbody);
      var fwrap = el("div", "table-wrap");
      fwrap.appendChild(facts);
      box.appendChild(el("p", "subhead", "The save"));
      box.appendChild(fwrap);
    }

    var skills = plan.roadSkills;
    if (skills) {
      var line = el("p", "note-text backup-skills");
      line.dataset.policy = skills.policy;
      line.textContent = fresh
        ? "Road skill levels: none. A new character starts without them: buy them with the Road points in the save."
        : "Road skill levels: " + skills.levelsBefore + " now, " + skills.levelsAfter + " after. " +
          (POLICIES[skills.policy] || skills.policy);
      box.appendChild(line);
    }

    var details = el("dl", "detail-list backup-other");
    var rows = [];
    if (plan.ignored && plan.ignored.length) {
      rows.push(["Not imported", plan.ignored.map(function (i) { return i.part + " (" + i.reason + ")"; }).join("; ")]);
    }
    if (plan.notRestored && plan.notRestored.length) {
      rows.push([fresh ? "Does not come with it" : "Stays as it is", plan.notRestored.join(", ")]);
    }
    dl(details, rows);
    if (rows.length) box.appendChild(details);
  }

  function runImport() {
    if (!planned) return;
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    var sent = planned;
    call("/api/account/characters/import", { method: "POST", body: sent.body }).then(function (res) {
      if (res.soon) return;
      if (!res.ok) {
        show($("import-preview-alert"), res.status ? refusal(res.status, res.body) : { text: "Could not reach the server. Nothing was changed." });
        confirmButton.hidden = true;
        return;
      }
      var plan = res.body || {};
      resetPreview();
      done.textContent = "Imported into " + plan.characterName + " (import #" + plan.importId + "). " +
        "Log in to see it; your character list shows the new ranks after your next save.";
      done.hidden = false;
      fileInput.value = "";
      chosen = null;
      sayFile("", false);
      loadHistory();
    }).then(function () {
      confirmButton.disabled = false;
      cancelButton.disabled = false;
    });
  }

  /* ---------- history ---------- */

  function renderHistory(rows) {
    clear(history);
    if (!rows || !rows.length) {
      var tr = el("tr");
      var td = el("td", "empty-cell", "No imports on this account yet.");
      td.colSpan = 5;
      tr.appendChild(td);
      history.appendChild(tr);
      return;
    }
    rows.forEach(function (row) {
      var tr = el("tr");
      tr.dataset.importId = String(row.id);
      var parts = (row.parts || []).map(function (p) { return typeof p === "string" ? p : p.part; });
      var skills = { restore: "restored", clear: "cleared", keep: "kept" }[row.skillsPolicy] || row.skillsPolicy || "-";
      [when(row.at), (row.characterName || "?") + " (id " + row.characterId + ")",
       (SOURCES[row.source] || row.source || "-").replace(/\.$/, ""),
       parts.length + (parts.length === 1 ? " part" : " parts") + ", Road skill levels " + skills,
       ({ web: "website", "web-new": "website, as a new character" }[row.endpoint] || "Discord") +
         (row.undoneAt ? (row.endpoint === "web-new" ? ", removed by an admin " : ", undone by an admin ") + when(row.undoneAt) : "")]
        .forEach(function (v) { tr.appendChild(el("td", null, v)); });
      history.appendChild(tr);
    });
  }

  function loadHistory() {
    return call("/api/account/characters/imports?limit=20").then(function (res) {
      if (res.soon) return false;
      if (!res.ok) { renderHistory([]); return true; }
      renderHistory(res.body);
      return true;
    });
  }

  /* ---------- shared with the transfer wizard ---------- */

  window.HvImportView = {
    renderPlan: renderPlanInto,
    refusal: refusal,
    describeFile: describeFile,
    reloadHistory: loadHistory
  };

  /* ---------- start ---------- */

  function start() {
    if (!token()) return;
    // the history doubles as the probe: no endpoint yet (404) = coming soon, nothing else is asked for
    loadHistory().then(function (there) {
      if (!there) return null;
      return call("/api/account/characters").then(function (res) {
        if (res.soon) return;
        characters = res.ok && Array.isArray(res.body) ? res.body : [];
        renderCharacters();
        panel.hidden = false;
        note.textContent = characters.length + (characters.length === 1 ? " character" : " characters");
      });
    });
    fileInput.addEventListener("change", readChosenFile);
    target.addEventListener("change", function () { resetPreview(); done.hidden = true; });
    previewButton.addEventListener("click", runPreview);
    confirmButton.addEventListener("click", runImport);
    cancelButton.addEventListener("click", function () { resetPreview(); sayFile("Cancelled: nothing was changed.", false); });
  }

  start();
})();
