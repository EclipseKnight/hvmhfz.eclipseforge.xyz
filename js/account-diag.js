/* "Diagnostics" box on the Account tab. The player picks the game's hvdiag.txt or an hvcrash-<time>.txt (client
   patch v1.21 and newer write them in the game folder) and uploads it as it is:
   POST /api/account/diagnostics?name=<file name>, body = the file (text/plain), signed in. The API answers
   {id, fileName, kind: "diag"|"crash", outcome, findings: [{kind, text}], facts: [[label, value]]} and keeps the file
   for staff; 400/413/429 come with {message}. Files over 256 KB are refused here first. All API text goes in with
   textContent. */
(function () {
  "use strict";
  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var MAX_BYTES = 256 * 1024;

  var panel = document.getElementById("diag-panel");
  if (!panel) return;
  var input = document.getElementById("diag-file");
  var button = document.getElementById("diag-upload");
  var alertNode = document.getElementById("diag-alert");
  var answer = document.getElementById("diag-answer");
  var outcome = document.getElementById("diag-outcome");
  var findings = document.getElementById("diag-findings");
  var facts = document.getElementById("diag-facts");

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

  function fail(text) {
    alertNode.textContent = text;
    alertNode.hidden = false;
    answer.hidden = true;
  }

  function show(a) {
    alertNode.hidden = true;
    outcome.textContent = a.outcome || "";
    clear(findings);
    (a.findings || []).forEach(function (f) {
      findings.appendChild(el("li", null, f.text));
    });
    findings.hidden = !findings.firstChild;
    clear(facts);
    (a.facts || []).forEach(function (pair) {
      facts.appendChild(el("dt", null, pair[0]));
      facts.appendChild(el("dd", null, pair[1]));
    });
    answer.hidden = false;
  }

  input.addEventListener("change", function () {
    button.disabled = !(input.files && input.files.length);
    alertNode.hidden = true;
  });

  button.addEventListener("click", function () {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      fail("That file is too large (over 256 KB): upload hvdiag.txt or an hvcrash file from the game folder.");
      return;
    }
    if (!token()) {
      fail("Sign in again to upload.");
      return;
    }
    button.disabled = true;
    button.textContent = "Uploading…";
    fetch(API + "/api/account/diagnostics?name=" + encodeURIComponent(file.name), {
      method: "POST",
      headers: { "Authorization": "Bearer " + token(), "Content-Type": "text/plain" },
      body: file
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; });
    }).then(function (res) {
      if (res.status === 200) show(res.body);
      else if (res.status === 401) fail("Your session has ended: sign in again to upload.");
      else if (res.status === 404) fail("Diagnostics uploads are not available yet. Send the file on Discord instead.");
      else fail(res.body.message || "The upload failed (" + res.status + "). Try again later.");
    }).catch(function () {
      fail("Could not reach the server. Try again later.");
    }).then(function () {
      button.textContent = "Upload";
      button.disabled = !(input.files && input.files.length);
    });
  });
})();
