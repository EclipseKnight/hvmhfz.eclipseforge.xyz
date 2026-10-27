/* Bug report and feature request forms. Each form posts JSON to POST /api/feedback on the
   REST API, which checks Turnstile and rate limits, then creates a task on the Kanboard board.
   With attachments the same JSON goes as the "report" part of a multipart upload, next to the
   files. When the API can't be reached, the player gets their report as text to post on Discord.
   A signed-in player's report carries their sign-in token, and the API signs the task with that
   account and its linked Discord. Nobody types their own name, so nobody can sign as someone else. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var DISCORD = "https://discord.gg/YuE42eh";
  var TIMEOUT_MS = 15000;
  // Uploading and storing up to 6 MB on the board takes longer than a plain report.
  var UPLOAD_TIMEOUT_MS = 60000;
  // Same limits as the API (README, "Feedback endpoint"). The API also checks the content.
  var MAX_FILES = 3;
  var MAX_FILE_BYTES = 2 * 1024 * 1024;
  var FILE_TYPES = /\.(png|jpe?g|gif|txt|log)$/i;
  var LABELS = {
    title: "Title", platform: "Platform", description: "Details", steps: "Steps to reproduce",
    expected: "Expected", reason: "Why it helps"
  };

  // For local testing only: on localhost, ?api=http://localhost:8099 points the forms at a mock
  // (dev/mock-feedback.py). Never honoured on the real site, so a link can't redirect reports.
  function apiBase() {
    var local = ["localhost", "127.0.0.1"].indexOf(window.location.hostname) >= 0;
    var override = new URLSearchParams(window.location.search).get("api");
    return local && override ? override.replace(/\/+$/, "") : API;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* The sign-in token from the home page, while it is still valid (the account page uses the same
     key), and the account name in it. Shown to the player only; the API reads the token itself. */
  var TOKEN_KEY = "hvmhfz.token";
  function signIn() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!claims.exp || claims.exp * 1000 < Date.now() + 30000) return null;
      return { token: value, username: claims.sub || "" };
    } catch (error) {
      return null;
    }
  }

  /* "Signed in as X: this report is signed with your account and your linked Discord." */
  function showSigner(session) {
    var notes = document.querySelectorAll("[data-signer]");
    function fill(build) {
      Array.prototype.forEach.call(notes, function (note) {
        while (note.firstChild) note.removeChild(note.firstChild);
        build(note);
      });
    }
    if (!session) {
      fill(function (note) {
        note.appendChild(document.createTextNode("You are not signed in, so this report won't say who sent it. "));
        var link = el("a", null, "Sign in");
        link.href = "/";
        note.appendChild(link);
        note.appendChild(document.createTextNode(" first to sign it with your account and your linked Discord, so we can follow up."));
      });
      return;
    }
    function signed(discordText) {
      fill(function (note) {
        note.appendChild(document.createTextNode("Signed in as "));
        note.appendChild(el("b", null, session.username));
        note.appendChild(document.createTextNode(": this report is signed with your account" + discordText));
      });
    }
    signed(".");
    fetch(apiBase() + "/api/account", { headers: { Authorization: "Bearer " + session.token }, cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (account) {
        if (!account) return;
        if (account.discordLinked) {
          signed(" and your linked Discord.");
        } else {
          fill(function (note) {
            note.appendChild(document.createTextNode("Signed in as "));
            note.appendChild(el("b", null, session.username));
            note.appendChild(document.createTextNode(": this report is signed with your account. Your Discord isn't linked yet; "));
            var link = el("a", null, "link it");
            link.href = "/account.html#account";
            note.appendChild(link);
            note.appendChild(document.createTextNode(" so we can message you about it."));
          });
        }
      })
      .catch(function () { /* the account line above stays */ });
  }

  function discordLink(text) {
    var link = el("a", null, text);
    link.href = DISCORD;
    return link;
  }

  /* The JSON body the API expects; see README.md, "Feedback endpoint". Only named fields are
     sent: Turnstile adds its own hidden input to the form, and its token goes in turnstileToken. */
  var FIELDS = ["title", "platform", "description", "steps", "expected", "reason", "website"];

  function readForm(form) {
    var body = { type: form.getAttribute("data-type") };
    FIELDS.forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (field) body[name] = field.value.trim();
    });
    return body;
  }

  function chosenFiles(form) {
    var input = form.elements.namedItem("files");
    return input && input.files ? Array.prototype.slice.call(input.files) : [];
  }

  /* Returns what is wrong with the chosen files, or null. Checked before the spam check is used up. */
  function checkFiles(files) {
    if (files.length > MAX_FILES) return "Attach at most " + MAX_FILES + " files.";
    for (var i = 0; i < files.length; i++) {
      if (!FILE_TYPES.test(files[i].name)) return files[i].name + ": only PNG, JPEG or GIF images and .txt or .log files can be attached.";
      if (files[i].size === 0) return files[i].name + " is empty.";
      if (files[i].size > MAX_FILE_BYTES) return files[i].name + " is larger than 2 MB. Crop or shrink it, or attach part of the log.";
    }
    return null;
  }

  /* The report as plain text, for pasting into Discord when the API is down. */
  function asText(body) {
    var lines = [(body.type === "bug" ? "Bug: " : "Feature request: ") + body.title];
    ["platform", "description", "steps", "expected", "reason"].forEach(function (key) {
      if (body[key]) lines.push("", LABELS[key] + ":", body[key]);
    });
    return lines.join("\n");
  }

  function showStatus(form, kind, nodes) {
    var status = form.querySelector(".report-status");
    status.className = "report-status " + kind;
    while (status.firstChild) status.removeChild(status.firstChild);
    nodes.forEach(function (node) { status.appendChild(node); });
    status.hidden = false;
    status.scrollIntoView({ block: "nearest" });
  }

  function showSuccess(form, taskId, attachmentsFailed) {
    var text = taskId ? "Thanks, reported as task #" + taskId + "." : "Thanks, reported.";
    var nodes = [el("p", null, text)];
    if (attachmentsFailed > 0) {
      // The task exists; only some files are missing from it, so don't ask for the whole report again.
      var missing = el("p", "report-hint", attachmentsFailed + (attachmentsFailed === 1 ? " attachment" : " attachments")
        + " could not be saved. ");
      missing.appendChild(discordLink("Post them in #mhfrontier on Discord"));
      missing.appendChild(document.createTextNode(taskId ? " with the task number." : "."));
      nodes.push(missing);
    }
    showStatus(form, "good", nodes);
  }

  // A problem the player can fix (input, spam check, rate limit). The form keeps its contents.
  function showError(form, message) {
    var hint = el("p", "report-hint", "Still stuck? ");
    hint.appendChild(discordLink("Post in #mhfrontier on Discord"));
    hint.appendChild(document.createTextNode(" instead."));
    showStatus(form, "error", [el("p", null, message), hint]);
  }

  // The service is down or not deployed: hand the report over for Discord.
  function showFallback(form, body, files) {
    var intro = el("p", null, "The report service isn't reachable right now. Copy your report and post it in #mhfrontier on ");
    intro.appendChild(discordLink("Discord"));
    intro.appendChild(document.createTextNode(files.length ? ", with your attachments." : "."));
    var text = el("textarea", "report-copy");
    text.readOnly = true;
    text.rows = 6;
    text.value = asText(body);
    text.setAttribute("aria-label", "Your report as text");
    var copy = el("button", "ghost-btn small", "Copy report");
    copy.type = "button";
    copy.addEventListener("click", function () {
      text.select();
      var done = function () { copy.textContent = "Copied"; };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text.value).then(done, function () { document.execCommand("copy"); done(); });
      } else {
        document.execCommand("copy");
        done();
      }
    });
    showStatus(form, "fallback", [intro, text, copy]);
  }

  function errorMessage(status) {
    if (status === 400) return "Some fields or attachments were not accepted. Check that the required fields are filled in and not too long, and that attachments are PNG, JPEG or GIF images or plain text logs.";
    if (status === 413) return "The attachments are too large: at most 3 files of 2 MB each.";
    if (status === 403) return "The spam check failed. Complete it again, then send.";
    if (status === 429) return "Too many reports from your connection. Wait a few minutes and try again.";
    return null;
  }

  function send(body, files) {
    var controller = new AbortController();
    var request = { method: "POST", signal: controller.signal, headers: {} };
    var session = signIn();
    if (session) request.headers.Authorization = "Bearer " + session.token;
    if (files.length) {
      // No Content-Type header here: the browser sets it with the multipart boundary.
      var data = new FormData();
      data.append("report", new Blob([JSON.stringify(body)], { type: "application/json" }));
      files.forEach(function (file) { data.append("files", file, file.name); });
      request.body = data;
    } else {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(body);
    }
    var timer = setTimeout(function () { controller.abort(); }, files.length ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);
    return fetch(apiBase() + "/api/feedback", request).finally(function () { clearTimeout(timer); });
  }

  function setUp(form) {
    var fields = form.querySelector(".report-fields");
    var button = form.querySelector(".report-send");
    var buttonText = button.textContent;
    var widget = window.HvTurnstile.mount(form.querySelector(".turnstile-slot"), {
      action: "feedback",
      onError: function () {
        showError(form, "The spam check failed to load. Reload the page and try again.");
      }
    });
    fields.disabled = false;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var body = readForm(form);
      var files = chosenFiles(form);
      var fileProblem = checkFiles(files);
      if (fileProblem) {
        showError(form, fileProblem);
        return;
      }
      body.turnstileToken = widget.token();
      if (!body.turnstileToken) {
        widget.render();
        showError(form, "Complete the spam check, then press send.");
        return;
      }

      button.disabled = true;
      button.textContent = "Sending...";
      send(body, files).then(function (response) {
        if (response.ok) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            showSuccess(form, data.taskId, data.attachmentsFailed);
            form.reset();
          });
        }
        var message = errorMessage(response.status);
        if (message) showError(form, message);
        else showFallback(form, body, files);
      }).catch(function () {
        showFallback(form, body, files);
      }).finally(function () {
        button.disabled = false;
        button.textContent = buttonText;
        widget.reset();
      });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".report-form"), setUp);
  showSigner(signIn());
})();
