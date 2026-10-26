/* Bug report and feature request forms. Each form posts JSON to POST /api/feedback on the
   REST API, which checks Turnstile and rate limits, then creates a task on the Kanboard board.
   When the API can't be reached, the player gets their report as text to post on Discord. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var DISCORD = "https://discord.gg/YuE42eh";
  var TIMEOUT_MS = 15000;
  var LABELS = {
    title: "Title", platform: "Platform", description: "Details", steps: "Steps to reproduce",
    expected: "Expected", reason: "Why it helps", contact: "Discord name"
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

  function discordLink(text) {
    var link = el("a", null, text);
    link.href = DISCORD;
    return link;
  }

  /* The JSON body the API expects; see README.md, "Feedback endpoint". Only named fields are
     sent: Turnstile adds its own hidden input to the form, and its token goes in turnstileToken. */
  var FIELDS = ["title", "platform", "description", "steps", "expected", "reason", "contact", "website"];

  function readForm(form) {
    var body = { type: form.getAttribute("data-type") };
    FIELDS.forEach(function (name) {
      var field = form.elements.namedItem(name);
      if (field) body[name] = field.value.trim();
    });
    return body;
  }

  /* The report as plain text, for pasting into Discord when the API is down. */
  function asText(body) {
    var lines = [(body.type === "bug" ? "Bug: " : "Feature request: ") + body.title];
    ["platform", "description", "steps", "expected", "reason", "contact"].forEach(function (key) {
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

  function showSuccess(form, taskId) {
    var text = taskId ? "Thanks, reported as task #" + taskId + "." : "Thanks, reported.";
    showStatus(form, "good", [el("p", null, text)]);
  }

  // A problem the player can fix (input, spam check, rate limit). The form keeps its contents.
  function showError(form, message) {
    var hint = el("p", "report-hint", "Still stuck? ");
    hint.appendChild(discordLink("Post in #mhfrontier on Discord"));
    hint.appendChild(document.createTextNode(" instead."));
    showStatus(form, "error", [el("p", null, message), hint]);
  }

  // The service is down or not deployed: hand the report over for Discord.
  function showFallback(form, body) {
    var intro = el("p", null, "The report service isn't reachable right now. Copy your report and post it in #mhfrontier on ");
    intro.appendChild(discordLink("Discord"));
    intro.appendChild(document.createTextNode("."));
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
    if (status === 400) return "Some fields were not accepted. Check that the required ones are filled in and not too long.";
    if (status === 403) return "The spam check failed. Complete it again, then send.";
    if (status === 429) return "Too many reports from your connection. Wait a few minutes and try again.";
    return null;
  }

  function send(body) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(apiBase() + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    }).finally(function () { clearTimeout(timer); });
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
      body.turnstileToken = widget.token();
      if (!body.turnstileToken) {
        widget.render();
        showError(form, "Complete the spam check, then press send.");
        return;
      }

      button.disabled = true;
      button.textContent = "Sending...";
      send(body).then(function (response) {
        if (response.ok) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            showSuccess(form, data.taskId);
            form.reset();
          });
        }
        var message = errorMessage(response.status);
        if (message) showError(form, message);
        else showFallback(form, body);
      }).catch(function () {
        showFallback(form, body);
      }).finally(function () {
        button.disabled = false;
        button.textContent = buttonText;
        widget.reset();
      });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".report-form"), setUp);
})();
