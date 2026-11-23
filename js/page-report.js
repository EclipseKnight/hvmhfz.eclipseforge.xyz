/* "Report a problem" on the data pages (item, equipment, quest, monster, weapon, skill, source, currency, Sky
   Corridor, Set builder). One line adds it to a page:
       <script src="/js/page-report.js?v=1" defer></script>
   It puts a "Report a problem" button at the end of the breadcrumbs (beside "Copy link", js/share.js) and opens a
   form in a dialog: what is wrong (got it somewhere the page does not list, wrong info, other), where (free text, plus
   an optional quest from data/search/quests.json and monster from data/monsters/index.json), a description and up to
   3 screenshots. The page (kind, id, name, address) is worked out here from the address and the page's heading, read
   when the form opens (detail pages fill their name after loading). A page this script does not know is sent as kind
   "page" with its address. Its styles are in /css/page-report.css, which it loads itself.

   Signed-in players only, like the bug reports (report.html): signed out, the form says so and links the sign-in,
   which comes back to this page. The report goes to POST /api/account/page-reports (API README "Page reports") as
   JSON, or with pictures as multipart (the JSON in a "report" part, the pictures as "files" parts). A picture over
   2 MB or 4096 pixels (a phone photo) is shrunk here first to a JPEG of at most 2560 pixels; the API checks and
   re-encodes every picture again (metadata dropped). Staff read the reports in the admin page's Page reports tab. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var VERSION = "1";
  var MAX_FILES = 3;
  var MAX_FILE_BYTES = 2 * 1024 * 1024;
  var MAX_SIDE = 4096;
  var SHRINK_SIDE = 2560;
  var MAX_DESCRIPTION = 2000;
  var MAX_LOCATION = 300;
  var TIMEOUT_MS = 20000;
  var UPLOAD_TIMEOUT_MS = 60000;

  // For local testing only: on localhost, ?api=http://localhost:8099 points the form at a mock. Never honoured on
  // the real site, so a link can't send reports elsewhere.
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

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* The sign-in token from the home page while it is still valid, and the account name in it. */
  function session() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!claims.exp || claims.exp * 1000 < Date.now() + 30000) return null;
      return { token: value, username: claims.sub || "" };
    } catch (error) {
      return null;
    }
  }

  /* ---------- what this page shows ---------- */

  var KINDS = {
    "item.html": "item", "equipment.html": "equipment", "quest.html": "quest", "monster.html": "monster",
    "weapons.html": "weapon", "skill.html": "skill", "source.html": "source", "currencies.html": "currency",
    "sky-corridor.html": "sky", "set-builder.html": "armor"
  };
  var KIND_LABELS = {
    item: "Item", equipment: "Equipment", quest: "Quest", monster: "Monster", weapon: "Weapon", skill: "Skill",
    source: "Source", currency: "Currency", sky: "Sky Corridor", armor: "Set builder", page: "Page"
  };

  function cleanId(value) {
    var v = (value || "").trim();
    return /^[A-Za-z0-9._:-]{1,64}$/.test(v) ? v : "";
  }

  // Read now, not at load: pages change their address (the weapon page as weapons are opened).
  function pageInfo() {
    var file = location.pathname.replace(/^.*\//, "") || "index.html";
    var q = new URLSearchParams(location.search);
    var kind = KINDS[file] || "page";
    var id = "";
    if (kind === "item" || kind === "quest" || kind === "skill" || kind === "source") id = cleanId(q.get("id"));
    else if (kind === "monster") id = cleanId(q.get("m"));
    else if (kind === "equipment") id = cleanId(q.get("slot") && q.get("id") ? q.get("slot") + ":" + q.get("id") : "");
    else if (kind === "weapon") id = cleanId((q.get("type") || "") + (q.get("w") ? ":" + q.get("w") : ""));
    else if (kind === "currency") id = cleanId(location.hash.slice(1));
    // Detail pages set their title to "<name> · Hunsterverse" once loaded (js/item.js, quest.js, monster.js...).
    var name = (document.title || "").replace(/\s+·\s+Hunsterverse\s*$/, "").replace(/\s+/g, " ").trim();
    if (!name) {
      var h1 = document.querySelector("main h1");
      name = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "";
    }
    var url = location.pathname + location.search + location.hash;
    if (url.length > 500) url = url.slice(0, 500);
    return { kind: kind, id: id, name: name.slice(0, 200), url: url };
  }

  function missingLabel(kind) {
    if (kind === "item") return "I got this item somewhere the page doesn't list";
    if (kind === "equipment") return "I got or made this somewhere the page doesn't list";
    if (kind === "quest") return "Something from this quest is missing (a reward, a monster…)";
    if (kind === "monster") return "Something from this monster is missing (a drop, a quest…)";
    return "Something is missing from this page";
  }

  /* ---------- quests and monsters (loaded when the form first opens) ---------- */

  var quests = null; // [[id, name], ...]
  var monsters = null; // [{slug, name}, ...]

  function loadPickers(monsterSelect) {
    if (!quests) {
      quests = [];
      fetch("/data/search/quests.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        quests = ((d && d.quests) || []).map(function (row) { return [row[0], String(row[1] || "")]; });
      }).catch(function () { /* the quest box still takes a number */ });
    }
    var fill = function () {
      if (monsterSelect.options.length > 1) return;
      monsters.forEach(function (m) {
        var o = el("option", null, m.name);
        o.value = m.slug;
        monsterSelect.appendChild(o);
      });
    };
    if (monsters) { fill(); return; }
    fetch("/data/monsters/index.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      monsters = (list || []).filter(function (m) { return m && /^[a-z0-9-]+$/.test(m.slug || ""); })
        .map(function (m) { return { slug: m.slug, name: m.name || m.slug }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
      fill();
    }).catch(function () { monsters = null; });
  }

  function findQuests(text) {
    var t = text.trim().toLowerCase();
    if (!quests || t.length < 2) return [];
    var hits = [];
    for (var i = 0; i < quests.length && hits.length < 8; i++) {
      var q = quests[i];
      if (String(q[0]) === t || q[1].toLowerCase().indexOf(t) !== -1) hits.push(q);
    }
    return hits;
  }

  /* ---------- pictures ---------- */

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  // A picture the API takes as it is, or a smaller JPEG of it (phone photos are often 3-6 MB).
  function preparePicture(file) {
    if (!/^image\/(png|jpeg|gif)$/.test(file.type) && !/\.(png|jpe?g|gif)$/i.test(file.name || "")) {
      return Promise.reject(new Error("Pictures must be PNG, JPEG or GIF images."));
    }
    return loadImage(file).then(function (loaded) {
      var w = loaded.img.naturalWidth, h = loaded.img.naturalHeight;
      if (file.size <= MAX_FILE_BYTES && w <= MAX_SIDE && h <= MAX_SIDE) {
        return { blob: file, name: file.name || "screenshot.png", preview: loaded.url };
      }
      var scale = Math.min(1, SHRINK_SIDE / Math.max(w, h));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(loaded.img, 0, 0, canvas.width, canvas.height);
      return new Promise(function (resolve, reject) {
        var tryQuality = function (quality) {
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error("This picture could not be read.")); return; }
            if (blob.size > MAX_FILE_BYTES && quality > 0.5) { tryQuality(quality - 0.15); return; }
            if (blob.size > MAX_FILE_BYTES) { reject(new Error("This picture is too large, even made smaller.")); return; }
            resolve({ blob: blob, name: "screenshot.jpg", preview: loaded.url });
          }, "image/jpeg", quality);
        };
        tryQuality(0.85);
      });
    }, function () {
      throw new Error("This picture could not be read.");
    });
  }

  /* ---------- the form ---------- */

  var dialog = null;
  var state = { pictures: [], questId: null, sending: false };

  function addStyles() {
    if (document.querySelector("link[data-page-report]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/page-report.css?v=" + VERSION;
    link.setAttribute("data-page-report", "");
    document.head.appendChild(link);
  }

  function field(labelText, control, optional) {
    var box = el("div", "field");
    var label = el("label", null, labelText);
    label.htmlFor = control.id;
    if (optional) {
      label.appendChild(document.createTextNode(" "));
      label.appendChild(el("span", "field-optional", optional));
    }
    box.appendChild(label);
    box.appendChild(control);
    return box;
  }

  function signInHref() {
    return "/?next=" + encodeURIComponent(location.pathname + location.search) + "#login-form";
  }

  function build() {
    dialog = el("dialog", "pr-dialog");
    dialog.id = "page-report";
    dialog.setAttribute("aria-labelledby", "pr-title");
    var form = el("form", "pr-form");
    form.method = "dialog";
    form.noValidate = true;

    var head = el("div", "pr-head");
    head.appendChild(el("h2", null, "Report a problem"));
    head.firstChild.id = "pr-title";
    var close = el("button", "pr-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", function () { dialog.close(); });
    head.appendChild(close);
    form.appendChild(head);
    form.appendChild(el("p", "pr-page"));

    var signin = el("div", "pr-signin");
    signin.appendChild(el("p", null, "Reports come from signed-in accounts only, so staff can follow up and tell reports from spam. Sign in and you come back to this page."));
    var a = el("a", "btn btn-primary", "Sign in to report");
    a.className = "btn btn-primary pr-signin-link";
    signin.appendChild(a);
    form.appendChild(signin);

    var fields = el("fieldset", "pr-fields");
    var problem = el("fieldset", "pr-problem");
    problem.appendChild(el("legend", null, "What's wrong?"));
    [["missing-source", ""], ["wrong-info", "Something on this page is wrong"], ["other", "Other"]].forEach(function (p, i) {
      var label = el("label", "pr-choice");
      var input = el("input");
      input.type = "radio";
      input.name = "problem";
      input.value = p[0];
      if (i === 0) input.checked = true;
      label.appendChild(input);
      label.appendChild(el("span", null, p[1]));
      problem.appendChild(label);
    });
    fields.appendChild(problem);

    var where = el("input");
    where.type = "text";
    where.id = "pr-location";
    where.maxLength = MAX_LOCATION;
    where.placeholder = "e.g. a quest's reward, a carve, the Road shop, a gacha";
    fields.appendChild(field("Where?", where, "optional"));

    var row = el("div", "pr-row");
    var quest = el("input");
    quest.type = "text";
    quest.id = "pr-quest";
    quest.autocomplete = "off";
    quest.placeholder = "Quest name or number";
    var questBox = field("Quest", quest, "optional");
    var hits = el("ul", "pr-hits");
    hits.id = "pr-quest-hits";
    hits.hidden = true;
    questBox.appendChild(hits);
    var picked = el("p", "pr-picked");
    picked.hidden = true;
    questBox.appendChild(picked);
    row.appendChild(questBox);
    var monster = el("select");
    monster.id = "pr-monster";
    var none = el("option", null, "None");
    none.value = "";
    monster.appendChild(none);
    row.appendChild(field("Monster", monster, "optional"));
    fields.appendChild(row);

    var description = el("textarea");
    description.id = "pr-description";
    description.rows = 4;
    description.maxLength = MAX_DESCRIPTION;
    description.required = true;
    description.placeholder = "What did you get, or what is wrong, and what should the page say?";
    var descBox = field("Description", description);
    var count = el("p", "pr-count", "0 / " + MAX_DESCRIPTION);
    descBox.appendChild(count);
    fields.appendChild(descBox);

    var files = el("input");
    files.type = "file";
    files.id = "pr-files";
    files.multiple = true;
    files.accept = "image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif";
    var filesBox = field("Screenshots", files, "up to 3; a picture of it in game helps staff confirm it");
    var thumbs = el("ul", "pr-thumbs");
    filesBox.appendChild(thumbs);
    fields.appendChild(filesBox);

    fields.appendChild(el("p", "pr-signer"));
    var actions = el("div", "pr-actions");
    var send = el("button", "btn btn-primary pr-send", "Send report");
    send.type = "submit";
    var cancel = el("button", "ghost-btn pr-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", function () { dialog.close(); });
    actions.appendChild(send);
    actions.appendChild(cancel);
    fields.appendChild(actions);
    form.appendChild(fields);

    var status = el("p", "pr-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    form.appendChild(status);
    var done = el("div", "pr-done");
    done.hidden = true;
    form.appendChild(done);

    dialog.appendChild(form);
    document.body.appendChild(dialog);

    // Tapping the backdrop closes the form (a click on the dialog itself, outside the form).
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });

    description.addEventListener("input", function () {
      count.textContent = description.value.length + " / " + MAX_DESCRIPTION;
    });

    var pickQuest = function (q) {
      state.questId = q ? q[0] : null;
      hits.hidden = true;
      clear(hits);
      picked.hidden = !q;
      clear(picked);
      if (q) {
        picked.appendChild(document.createTextNode("Quest #" + q[0] + (q[1] ? " · " + q[1] : "") + " "));
        var x = el("button", "ghost-btn small", "Remove");
        x.type = "button";
        x.addEventListener("click", function () { pickQuest(null); quest.value = ""; quest.focus(); });
        picked.appendChild(x);
        quest.value = "";
        quest.hidden = true;
      } else {
        quest.hidden = false;
      }
    };
    quest.addEventListener("input", function () {
      clear(hits);
      var t = quest.value.trim();
      var found = findQuests(t);
      if (/^\d{1,6}$/.test(t) && !found.some(function (q) { return String(q[0]) === t; })) found.unshift([Number(t), ""]);
      found.forEach(function (q) {
        var li = el("li");
        var b = el("button", "pr-hit", (q[1] ? q[1] + " " : "Quest ") + "#" + q[0]);
        b.type = "button";
        b.addEventListener("click", function () { pickQuest(q); });
        li.appendChild(b);
        hits.appendChild(li);
      });
      hits.hidden = !found.length;
    });

    files.addEventListener("change", function () {
      var chosen = Array.prototype.slice.call(files.files || []);
      files.value = "";
      if (state.pictures.length + chosen.length > MAX_FILES) {
        say("At most " + MAX_FILES + " pictures.", true);
        chosen = chosen.slice(0, Math.max(0, MAX_FILES - state.pictures.length));
      } else {
        say("");
      }
      chosen.reduce(function (p, file) {
        return p.then(function () {
          return preparePicture(file).then(function (pic) {
            state.pictures.push(pic);
            drawThumbs();
          }, function (error) { say(error.message, true); });
        });
      }, Promise.resolve());
    });

    function drawThumbs() {
      clear(thumbs);
      state.pictures.forEach(function (pic, i) {
        var li = el("li");
        var img = el("img");
        img.src = pic.preview;
        img.alt = "Screenshot " + (i + 1);
        li.appendChild(img);
        var x = el("button", "ghost-btn small", "Remove");
        x.type = "button";
        x.setAttribute("aria-label", "Remove screenshot " + (i + 1));
        x.addEventListener("click", function () {
          URL.revokeObjectURL(pic.preview);
          state.pictures.splice(i, 1);
          drawThumbs();
        });
        li.appendChild(x);
        thumbs.appendChild(li);
      });
      files.disabled = state.pictures.length >= MAX_FILES;
    }
    dialog._drawThumbs = drawThumbs;
    dialog._pickQuest = pickQuest;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit(form);
    });
  }

  function say(text, bad) {
    var status = dialog.querySelector(".pr-status");
    status.textContent = text || "";
    status.hidden = !text;
    status.classList.toggle("is-bad", !!bad);
  }

  function open() {
    addStyles();
    if (!dialog) build();
    var info = pageInfo();
    dialog._info = info;
    var me = session();
    var form = dialog.querySelector(".pr-form");
    form.querySelector(".pr-page").textContent = (KIND_LABELS[info.kind] || "Page") + ": " + (info.name || info.url);
    form.querySelector(".pr-choice span").textContent = missingLabel(info.kind);
    form.querySelector(".pr-signin").hidden = !!me;
    form.querySelector(".pr-signin-link").href = signInHref();
    form.querySelector(".pr-fields").hidden = !me;
    form.querySelector(".pr-done").hidden = true;
    say("");
    if (me) {
      form.querySelector(".pr-signer").textContent = "Sent as " + me.username + ". Staff see your account name, never your email.";
      loadPickers(form.querySelector("#pr-monster"));
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    var first = me ? form.querySelector("input[name=problem]:checked") : form.querySelector(".pr-signin-link");
    if (first) first.focus();
  }

  function reset(form) {
    form.reset();
    state.pictures.forEach(function (p) { URL.revokeObjectURL(p.preview); });
    state.pictures = [];
    dialog._drawThumbs();
    dialog._pickQuest(null);
    form.querySelector(".pr-count").textContent = "0 / " + MAX_DESCRIPTION;
  }

  function submit(form) {
    if (state.sending) return;
    var me = session();
    if (!me) { open(); return; }
    var info = dialog._info || pageInfo();
    var description = form.querySelector("#pr-description");
    if (!description.value.trim()) {
      say("Say what is wrong in the description.", true);
      description.focus();
      return;
    }
    var report = {
      kind: info.kind, pageId: info.id, pageName: info.name, pageUrl: info.url,
      problem: (form.querySelector("input[name=problem]:checked") || {}).value || "other",
      location: form.querySelector("#pr-location").value.trim(),
      questId: state.questId,
      monster: form.querySelector("#pr-monster").value || null,
      description: description.value.trim()
    };
    var body;
    var headers = { Authorization: "Bearer " + me.token };
    if (state.pictures.length) {
      body = new FormData();
      body.append("report", new Blob([JSON.stringify(report)], { type: "application/json" }));
      state.pictures.forEach(function (p) { body.append("files", p.blob, p.name); });
    } else {
      body = JSON.stringify(report);
      headers["Content-Type"] = "application/json";
    }
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); },
      state.pictures.length ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);
    state.sending = true;
    var send = form.querySelector(".pr-send");
    send.disabled = true;
    say("Sending…");
    fetch(apiBase() + "/api/account/page-reports", { method: "POST", headers: headers, body: body,
                                                      signal: controller ? controller.signal : undefined })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (data) {
          if (r.status === 201) {
            reset(form);
            form.querySelector(".pr-fields").hidden = true;
            say("");
            var done = form.querySelector(".pr-done");
            clear(done);
            done.appendChild(el("p", "pr-ok", "Thank you: report #" + (data && data.id) + " is with the staff. They check it in game and fix the page."));
            var again = el("button", "ghost-btn", "Close");
            again.type = "button";
            again.addEventListener("click", function () { dialog.close(); });
            done.appendChild(again);
            done.hidden = false;
            again.focus();
            return;
          }
          if (r.status === 401) {
            form.querySelector(".pr-signin").hidden = false;
            form.querySelector(".pr-fields").hidden = true;
            say("Your sign-in has run out. Sign in again; what you typed is lost, sorry.", true);
            return;
          }
          var message = (data && data.message) || "";
          if (r.status === 413) message = "The pictures are too large (2 MB each).";
          if (r.status === 429) message = message || "Too many reports. Try again later.";
          say(message || "The report could not be sent (HTTP " + r.status + "). Try again later, or post it in #mhfrontier on Discord.", true);
        });
      })
      .catch(function () {
        say("The report could not be sent: no answer from the server. Try again later, or post it in #mhfrontier on Discord.", true);
      })
      .then(function () {
        clearTimeout(timer);
        state.sending = false;
        send.disabled = false;
      });
  }

  /* ---------- the button ---------- */

  function start() {
    var crumbs = document.querySelector("nav.breadcrumbs");
    var host = crumbs || document.querySelector("main .page-head");
    if (!host || document.querySelector(".pr-open")) return;
    var button = el("button", "ghost-btn small pr-open", "Report a problem");
    button.type = "button";
    button.title = "Tell staff something on this page is missing or wrong, with a screenshot";
    button.addEventListener("click", open);
    if (crumbs) {
      // The same row as js/share.js's "Copy link": both at the end of the breadcrumbs.
      crumbs.style.display = "flex";
      crumbs.style.flexWrap = "wrap";
      crumbs.style.alignItems = "center";
      crumbs.style.gap = "8px";
      var share = crumbs.querySelector(".share-copy");
      if (share) share.style.marginLeft = "0";
      button.style.marginLeft = "auto";
      if (share) crumbs.insertBefore(button, share);
      else crumbs.appendChild(button);
    } else {
      host.appendChild(button);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.HvPageReport = { open: open, info: pageInfo };
})();
