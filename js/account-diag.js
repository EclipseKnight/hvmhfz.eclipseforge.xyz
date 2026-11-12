/* "Diagnostics" box on the Diagnostics tab of the account page. The player picks (or drags in) the game's hvdiag.txt, any
   hvcrash-<time>.txt files and hvmods.log (client patch v1.21 and newer write them in the game folder) and uploads them as they
   are, one after another, **as soon as they are picked or dropped** (a player once picked files and never pressed
   Upload): for each file POST /api/account/diagnostics?name=<file name>&note=<text>&area=<area>, body = the file
   (text/plain), signed in. The API takes one file per request, so the loop is here. The "What went wrong?" note
   (optional, 1000 characters) and the Area select are read when the upload starts and go with every file of that
   batch; the Upload button shows only for files left queued (a stop, or not signed in), as "N files ready: Upload",
   and leaving the page with files waiting or uploading asks first. It answers
   {id, fileName, kind: "diag"|"crash"|"log", outcome, findings: [{kind, text}], facts: [[label, value]], note, area}
   (the last two as kept; shown back under the file's answer) and keeps the
   file for staff; 400/413/429 come with {message}. Up to 10 files per pick or drop, text or log files only (.txt,
   .log or text/plain): a .txt up to 256 KB, a .log up to 2 MB (the API keeps the newest 256 KB of a long log); other
   files are listed as errors here without a request. Each file shows its
   status (queued, uploading, answer, error) and its own answer. A 401, 404, 429 or a lost connection stops the
   run and leaves the files not yet sent queued. All API text goes in with textContent. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var MAX_BYTES = 256 * 1024;
  var MAX_LOG_BYTES = 2 * 1024 * 1024;
  var MAX_FILES = 10;
  var MAX_NOTE = 1000;
  // The note goes in the URL; the API server refuses request lines over 8 KB, so the encoded note is kept under this
  // (a note of Japanese text is 9 bytes a character once encoded).
  var MAX_NOTE_ENCODED = 6000;
  var AREAS = { "crash": "Crash", "mods": "Mods/overlays", "quest": "Quest", "sky-road": "Sky Corridor/Road",
    "controls": "Controls", "other": "Other" };

  var panel = document.getElementById("diag-panel");
  if (!panel) return;
  var input = document.getElementById("diag-file");
  var drop = document.getElementById("diag-drop");
  var button = document.getElementById("diag-upload");
  var clearButton = document.getElementById("diag-clear");
  var noteField = document.getElementById("diag-note");
  var noteCount = document.getElementById("diag-note-count");
  var areaField = document.getElementById("diag-area");
  var alertNode = document.getElementById("diag-alert");
  var list = document.getElementById("diag-list");

  // items: [{file, status: "queued"|"uploading"|"done"|"error", message, answer, node}]
  var items = [];
  var busy = false;
  // The note and area of the upload that is running (read when it starts).
  var batch = { note: "", area: "" };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function say(text) {
    alertNode.textContent = text || "";
    alertNode.hidden = !text;
  }

  function queued() {
    return items.filter(function (it) { return it.status === "queued"; });
  }

  // The note as it goes out: trimmed, at most MAX_NOTE characters and MAX_NOTE_ENCODED once percent-encoded.
  // Returns {text, cut}: cut is true when the encoded limit made it shorter than the box.
  function noteText() {
    var cps = Array.from((noteField ? noteField.value : "").trim());
    var cut = false;
    if (cps.join("").length > MAX_NOTE) { cps = Array.from(cps.join("").slice(0, MAX_NOTE)); cut = true; }
    while (cps.length && encodeURIComponent(cps.join("")).length > MAX_NOTE_ENCODED) { cps.length = Math.max(0, cps.length - 10); cut = true; }
    return { text: cps.join("").trim(), cut: cut };
  }

  function refreshCount() {
    if (noteField) noteCount.textContent = noteField.value.length + " / " + MAX_NOTE;
  }

  function refreshControls() {
    var waiting = queued().length;
    // The Upload button is the way on only when files are left queued (an upload stopped, or not signed in).
    button.hidden = !busy && !waiting;
    button.disabled = busy || !waiting;
    button.textContent = busy ? "Uploading…" : waiting + (waiting === 1 ? " file" : " files") + " ready: Upload";
    clearButton.hidden = !items.length;
    clearButton.disabled = busy;
    list.hidden = !items.length;
  }

  var LABEL = { queued: "Queued", uploading: "Uploading…", done: "Answer", error: "Error" };

  function render(it) {
    var li = it.node;
    clear(li);
    li.className = "diag-file diag-" + it.status;
    var head = el("div", "diag-file-head");
    head.appendChild(el("span", "diag-file-name", it.file.name));
    head.appendChild(el("span", "diag-file-status", LABEL[it.status]));
    li.appendChild(head);
    if (it.status === "error") li.appendChild(el("p", "diag-file-msg", it.message));
    if (it.status === "done") {
      var a = it.answer;
      li.appendChild(el("p", "diag-outcome", a.outcome || ""));
      if (a.note || a.area) {
        li.appendChild(el("p", "diag-note-echo", "Your note" + (a.area ? " (" + (AREAS[a.area] || a.area) + ")" : "") +
          (a.note ? ": " + a.note : ": none")));
      }
      if ((a.findings || []).length) {
        var ul = el("ul", "diag-findings");
        a.findings.forEach(function (f) { ul.appendChild(el("li", null, f.text)); });
        li.appendChild(ul);
      }
      if ((a.facts || []).length) {
        li.appendChild(el("p", "subhead", "From the report"));
        var dl = el("dl", "detail-list diag-facts");
        a.facts.forEach(function (pair) {
          dl.appendChild(el("dt", null, pair[0]));
          dl.appendChild(el("dd", null, pair[1]));
        });
        li.appendChild(dl);
      }
    }
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function setStatus(it, status, message) {
    it.status = status;
    it.message = message || "";
    render(it);
    refreshControls();
  }

  function isLog(file) {
    return /\.log$/i.test(file.name);
  }

  // The browser gives a .log file no type, so the name decides: .txt and .log are taken, and text/plain.
  function isText(file) {
    return /\.(txt|log)$/i.test(file.name) || file.type === "text/plain";
  }

  function same(a, b) {
    return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  }

  // Add the picked or dropped files to the list: at most MAX_FILES per pick or drop.
  function add(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    if (busy) { say("Wait until the upload is finished, then add more files."); return; }
    // A finished list starts fresh with the next pick.
    if (!queued().length) { items = []; clear(list); }
    var notes = [];
    if (files.length > MAX_FILES) {
      notes.push("Only " + MAX_FILES + " files at a time: the first " + MAX_FILES + " were added, " +
        (files.length - MAX_FILES) + " left out. Upload these, then add the rest.");
      files = files.slice(0, MAX_FILES);
    }
    var room = MAX_FILES - queued().length;
    var skipped = 0;
    var dupes = 0;
    files.forEach(function (file) {
      if (items.some(function (it) { return same(it.file, file); })) { dupes++; return; }
      var it = { file: file, status: "queued", message: "", answer: null, node: el("li") };
      if (!isText(file)) {
        it.status = "error";
        it.message = "Not a text or log file: upload hvdiag.txt, an hvcrash file or hvmods.log from the game folder.";
      } else if (isLog(file) ? file.size > MAX_LOG_BYTES : file.size > MAX_BYTES) {
        it.status = "error";
        it.message = isLog(file)
          ? "Too large (over 2 MB): upload the newest part of the log."
          : "Too large (over 256 KB): upload hvdiag.txt, an hvcrash file or hvmods.log from the game folder.";
      } else if (room <= 0) {
        skipped++;
        return;
      } else {
        room--;
      }
      items.push(it);
      render(it);
      list.appendChild(it.node);
    });
    if (skipped) notes.push(skipped + " file" + (skipped === 1 ? "" : "s") + " left out: at most " + MAX_FILES + " files wait to be uploaded.");
    if (dupes) notes.push(dupes + " file" + (dupes === 1 ? " was" : "s were") + " already in the list.");
    say(notes.join(" "));
    refreshControls();
    start();   // no button to press: whatever is queued goes now
  }

  function upload(it) {
    setStatus(it, "uploading");
    var query = "?name=" + encodeURIComponent(it.file.name) + (batch.note ? "&note=" + encodeURIComponent(batch.note) : "") +
      (batch.area ? "&area=" + encodeURIComponent(batch.area) : "");
    return fetch(API + "/api/account/diagnostics" + query, {
      method: "POST",
      headers: { "Authorization": "Bearer " + token(), "Content-Type": "text/plain" },
      body: it.file
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      if (res.status === 200) { it.answer = res.body; setStatus(it, "done"); return true; }
      if (res.status === 401) { setStatus(it, "queued"); say("Your session has ended: sign in again to upload. The files not sent are still listed (press Upload after signing in)."); return false; }
      if (res.status === 404) { setStatus(it, "queued"); say("Diagnostics uploads are not available yet. Send the files on Discord instead."); return false; }
      if (res.status === 429) { setStatus(it, "queued"); say(res.body.message || "Too many uploads: wait a little, then press Upload again."); return false; }
      setStatus(it, "error", res.body.message || "The upload failed (" + res.status + "). Try again later.");
      return true;
    }).catch(function () {
      setStatus(it, "queued");
      say("Could not reach the server. Try again later: the files not sent are still listed.");
      return false;
    });
  }

  function run() {
    var next = queued()[0];
    if (!next) { busy = false; refreshControls(); return; }
    upload(next).then(function (goOn) {
      if (goOn) run();
      else { busy = false; refreshControls(); }
    });
  }

  input.addEventListener("change", function () {
    add(input.files);
    input.value = "";   // the same file can be picked again later
  });

  // Starts uploading what is queued, with the note and area in the boxes right now (also when the note is empty).
  function start() {
    if (busy || !queued().length) return;
    if (!token()) { say("Sign in again to upload. Your files stay listed: press Upload after signing in."); return; }
    var n = noteText();
    batch = { note: n.text, area: areaField ? areaField.value : "" };
    if (!AREAS[batch.area]) batch.area = "";
    if (n.cut) say((alertNode.textContent ? alertNode.textContent + " " : "") + "Your note was shortened to fit the upload.");
    busy = true;
    refreshControls();
    run();
  }

  button.addEventListener("click", function () { say(""); start(); });

  if (noteField) {
    noteField.addEventListener("input", refreshCount);
    refreshCount();
  }

  // Files waiting or on their way are lost when the page closes: ask first.
  window.addEventListener("beforeunload", function (e) {
    if (!busy && !queued().length) return;
    e.preventDefault();
    e.returnValue = "";
  });

  clearButton.addEventListener("click", function () {
    if (busy) return;
    items = [];
    clear(list);
    say("");
    refreshControls();
  });

  // Drag and drop from the file manager onto the box; the file button above stays as the click and keyboard way.
  var depth = 0;
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return !!t && Array.prototype.indexOf.call(t, "Files") !== -1;
  }
  drop.addEventListener("dragenter", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragover", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  drop.addEventListener("dragleave", function () {
    depth = Math.max(0, depth - 1);
    if (!depth) drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove("is-over");
    add(e.dataTransfer.files);
  });
  // A file dropped beside the box would make the browser open it and leave the page: ignore it.
  ["dragover", "drop"].forEach(function (name) {
    window.addEventListener(name, function (e) { if (hasFiles(e)) e.preventDefault(); });
  });
})();
