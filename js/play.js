/* Play page (play.html): three checklists that remember their ticks, copy buttons for the server
   settings, the slots for the one-click installer and our full download, the "More help" sections
   (<details>) that open when a link or the address points at them, and the client patch versions
   (#patches, from data/patch-versions.json).

   Ticks are kept in this browser only, in localStorage under hvmhfz.play as {"<step id>": true}
   (listed in privacy.html). Without JavaScript the page still shows every step and download; the
   copy buttons and the "clear the ticks" buttons stay hidden. */
(function () {
  "use strict";

  var KEY = "hvmhfz.play";

  // The slots for what is not published yet. A slot shows only when its flag is true AND its URL is
  // set. To turn one on: publish the file, put its address here and set the flag to true.
  // Slot names are the data-slot values in play.html.
  var SLOTS = {
    "installer":       { enabled: true, url: "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases/download/installer/HunsterverseSetup.exe" },  // Windows one-click installer
    "installer-linux": { enabled: true, url: "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases/download/installer/install-hunsterverse.sh" },  // Linux installer script
    "full":            { enabled: true, url: "https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases/tag/client-full" }   // our own full, patched client download
  };

  function readTicks() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (e) { return {}; } // storage blocked or a bad value: start empty
  }

  function writeTicks(ticks) {
    try {
      if (Object.keys(ticks).length) localStorage.setItem(KEY, JSON.stringify(ticks));
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked: the ticks last for this page only */ }
  }

  // Marks the steps of one card from the saved ticks and writes "3 of 10 done".
  function paint(card, ticks) {
    var steps = card.querySelectorAll("[data-step]");
    var done = 0;
    steps.forEach(function (li) {
      var on = ticks[li.getAttribute("data-step")] === true;
      li.querySelector('input[type="checkbox"]').checked = on;
      li.classList.toggle("is-done", on);
      if (on) done += 1;
    });
    var label = card.querySelector("[data-progress]");
    if (label) label.textContent = done + " of " + steps.length + " done";
  }

  function copyText(text, button) {
    var original = button.textContent;
    function done(ok) {
      button.textContent = ok ? "Copied" : "Select and copy it by hand";
      setTimeout(function () { button.textContent = original; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    done(ok);
  }

  // The help sections are <details>: a link or an address that points at one (or at something inside
  // one) opens it. Every #part of this page is the id of an element, so the address is read from
  // location.href rather than location.hash: dev/check-links.py then keeps checking the #anchors that
  // point at this page, as it does for a page without hash routing.
  function openFromAddress() {
    var id = location.href.split("#")[1];
    if (!id) return;
    try { id = decodeURIComponent(id); } catch (e) { return; }
    var el = document.getElementById(id);
    for (var d = el && el.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
  }

  // Client patch versions (#patches), from data/patch-versions.json (newest first; exactly one has
  // "current": true). The current one goes in the box at the top, the others in the table; the patch
  // size in the steps ([data-patch-size]) follows the current one. Without the file the note stays.
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function patchSize(bytes) { return (bytes / 1e6).toFixed(1) + " MB"; }

  // "2026-11-08T19:20Z" -> "8 Nov 2026, 19:20"; a date alone -> "11 Jul 2023"
  function patchDate(when) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2})Z)?$/.exec(when || "");
    if (!m) return when || "";
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] + (m[4] ? ", " + m[4] : "");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(href, text) {
    var a = el("a", null, text);
    a.href = href;
    return a;
  }

  function copyButton(text, label) {
    var button = el("button", "ghost-btn small", label);
    button.type = "button";
    button.setAttribute("data-copy-sha", text);
    button.addEventListener("click", function () { copyText(text, button); });
    return button;
  }

  function okUrl(url) { return typeof url === "string" && /^https:\/\//.test(url); }

  // what changed, the known problem (if any) and the changelog link
  function patchChanges(p) {
    var box = el("div", "play-patch-changes");
    box.appendChild(el("span", null, p.changes + " "));
    if (p.note) box.appendChild(el("span", "play-patch-note", p.note + " "));
    if (typeof p.changelog === "string" && p.changelog.indexOf("/changelog.html#") === 0) box.appendChild(link(p.changelog, "Changelog"));
    return box;
  }

  function renderPatches(data, section, status) {
    var patches = data && Array.isArray(data.patches) ? data.patches : [];
    var now = patches.filter(function (p) { return p.current === true; })[0];
    if (!now) return false;
    var nowUrl = okUrl(data.current) ? data.current : now.download;

    document.querySelectorAll("[data-patch-size]").forEach(function (span) { span.textContent = patchSize(now.size); });

    var box = section.querySelector("[data-patch-current]");
    box.textContent = "";
    var head = el("p", "play-patch-now");
    head.appendChild(el("span", "play-patch-label", "Current patch"));
    head.appendChild(el("strong", "play-patch-version", "v" + now.version));
    head.appendChild(el("span", "play-patch-meta", patchDate(now.published) + " UTC · " + patchSize(now.size)));
    box.appendChild(head);
    box.appendChild(patchChanges(now));
    var sha = el("p", "play-patch-sha");
    sha.appendChild(el("span", null, "SHA-256 "));
    sha.appendChild(el("code", null, now.sha256));
    sha.appendChild(copyButton(now.sha256, "Copy"));
    box.appendChild(sha);
    var get = link(nowUrl, "Download Frontier_Patch.zip v" + now.version);
    get.className = "btn btn-secondary btn-small";
    box.appendChild(get);
    box.hidden = false;

    var rows = section.querySelector("[data-patch-rows]");
    rows.textContent = "";
    var older = patches.filter(function (p) { return p !== now; });
    older.forEach(function (p) {
      var tr = el("tr");
      tr.setAttribute("data-version", p.version);
      var cells = [
        ["Version", el("strong", null, "v" + p.version)],
        ["Released (UTC)", el("time", null, patchDate(p.published))],
        ["What changed", patchChanges(p)],
        ["Size", el("span", null, patchSize(p.size))],
        ["SHA-256", (function () {
          var span = el("span", "play-patch-hash");
          var code = el("code", null, String(p.sha256).slice(0, 8));
          code.title = p.sha256;
          span.appendChild(code);
          span.appendChild(copyButton(p.sha256, "Copy"));
          return span;
        })()],
        ["Download", okUrl(p.download) ? link(p.download, "Frontier_Patch.zip") : el("span", null, "Not kept")]
      ];
      cells.forEach(function (c) {
        var td = el("td");
        td.setAttribute("data-label", c[0]);
        if (c[0] === "Size") td.className = "num";
        if (c[0] === "Released (UTC)") c[1].setAttribute("datetime", p.published);
        td.appendChild(c[1]);
        tr.appendChild(td);
      });
      rows.appendChild(tr);
    });
    section.querySelectorAll("[data-patch-older]").forEach(function (n) { n.hidden = older.length === 0; });
    status.hidden = true;
    return true;
  }

  function loadPatches() {
    var section = document.getElementById("patches");
    if (!section || !window.fetch) return;
    var status = section.querySelector("[data-patch-status]");
    fetch("/data/patch-versions.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { if (!renderPatches(data, section, status)) throw new Error("no current patch"); })
      .catch(function () {
        status.textContent = "The version list could not be loaded. Every version is on ";
        status.appendChild(link("https://github.com/EclipseKnight/hvmhfz.eclipseforge.xyz/releases", "GitHub releases"));
        status.appendChild(document.createTextNode("."));
      });
  }

  function init() {
    loadPatches();
    openFromAddress();
    // a link inside the page or an address changed in this tab (only its #part) is a history step
    window.addEventListener("popstate", openFromAddress);
    document.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest('a[href^="#"]');
      if (link) setTimeout(openFromAddress, 0); // after the browser has moved the address
    });
    var ticks = readTicks();
    var cards = document.querySelectorAll("[data-card]");

    cards.forEach(function (card) {
      paint(card, ticks);
      card.querySelectorAll("[data-step] input[type=\"checkbox\"]").forEach(function (box) {
        box.addEventListener("change", function () {
          var id = box.closest("[data-step]").getAttribute("data-step");
          if (box.checked) ticks[id] = true; else delete ticks[id];
          writeTicks(ticks);
          paint(card, ticks);
        });
      });
      var reset = card.querySelector("[data-reset]");
      if (reset) {
        reset.hidden = false;
        reset.addEventListener("click", function () {
          card.querySelectorAll("[data-step]").forEach(function (li) { delete ticks[li.getAttribute("data-step")]; });
          writeTicks(ticks);
          paint(card, ticks);
        });
      }
    });

    document.querySelectorAll("[data-copy]").forEach(function (button) {
      button.hidden = false;
      button.addEventListener("click", function () { copyText(button.getAttribute("data-copy"), button); });
    });

    document.querySelectorAll("[data-slot]").forEach(function (slot) {
      var config = SLOTS[slot.getAttribute("data-slot")];
      if (!config || config.enabled !== true || !/^https:\/\//.test(config.url)) return;
      slot.querySelector("[data-slot-link]").href = config.url;
      slot.hidden = false;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
