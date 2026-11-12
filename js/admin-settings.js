/* Admin: live settings (Settings tab). The game server's settings that change often (MezFes, Raviente, Sky
   Corridor, Campaigns, Rasta bar, Rates, Daily, Boosts, Guild, Caps, Shop and gacha, Misc, Login notices) come
   from the API's /api/admin/settings, which reads Erupe's server_settings table; the game server reads the same
   table every minute and reports what it runs. The forms are built from the section spec the API sends (labels,
   limits, help, when a change takes effect): nothing about the sections is hard-coded here. A field on "config
   default" is left out of the saved value, so the game server uses its config.json value. Save always shows the
   changes first (the API's check), and the history keeps every change with a Revert. The Patch gate section also
   shows who it would refuse right now (the API's /api/admin/settings/patch_gate/impact), for the stored values and
   again for the form's values as they are edited. Its Latest version can follow the latest release (the API's
   /api/admin/settings/patch_gate/auto: a switch, with the field read-only while it is on; hvmhfz_ops
   release-patch.sh sets it at each release). All times here are UTC. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";

  /* ---------- pure helpers (tested under node by dev/check-admin-settings.js) ---------- */

  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** "Fri 20 Nov 2026 12:00 UTC"; "-" for nothing. */
  function utc(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    if (isNaN(t)) return "-";
    if (typeof window !== "undefined" && window.HvTime) return HvTime.text(t, { weekday: true }) || "-";
    var d = new Date(t);
    return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MO[d.getUTCMonth()] + " " + d.getUTCFullYear() + " "
      + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " UTC";
  }

  /** A setting's value as people read it. */
  function show(v) {
    if (v === undefined || v === null) return "?";
    if (v === true) return "on";
    if (v === false) return "off";
    if (Array.isArray(v)) {
      if (v.length && Array.isArray(v[0])) return v.map(function (p) { return "[" + p.join(", ") + "]"; }).join(" ");
      return v.length + (v.length === 1 ? " text" : " texts");
    }
    if (typeof v === "string") return v === "" ? '""' : '"' + (v.length > 40 ? v.slice(0, 39) + "…" : v) + '"';
    return String(v);
  }

  /**
   * The value to save from the form's fields: {key: {useDefault, raw}} where raw is what the input holds (a
   * boolean, a string from a number or text box, a list of texts, a list of [a, b] strings). Keys on "config
   * default" are left out. Returns {value, errors}: errors are the fields whose input is not a number.
   */
  function formValue(section, inputs) {
    var value = {}, errors = [];
    section.fields.forEach(function (f) {
      var input = inputs[f.key];
      if (!input || input.useDefault) return;
      var raw = input.raw;
      switch (f.type) {
        case "bool":
          value[f.key] = !!raw;
          break;
        case "int":
        case "number": {
          var s = String(raw === undefined || raw === null ? "" : raw).trim();
          var n = Number(s);
          if (s === "" || !isFinite(n)) errors.push(f.label + ": enter a number.");
          else value[f.key] = n;
          break;
        }
        case "string":
          value[f.key] = raw === undefined || raw === null ? "" : String(raw);
          break;
        case "strings":
          value[f.key] = (raw || []).map(function (x) { return String(x); });
          break;
        case "int_pairs": {
          var rows = [];
          (raw || []).forEach(function (row, i) {
            var a = Number(String(row[0]).trim()), b = Number(String(row[1]).trim());
            if (String(row[0]).trim() === "" || String(row[1]).trim() === "" || !isFinite(a) || !isFinite(b)) {
              errors.push(f.label + ": row " + (i + 1) + " needs two numbers.");
            } else rows.push([a, b]);
          });
          value[f.key] = rows;
          break;
        }
      }
    });
    return { value: value, errors: errors };
  }

  /** The form's starting state from a section: stored keys are set, the others on "config default". */
  function formInputs(view) {
    var stored = view.stored ? view.stored.value || {} : {};
    var defaults = view.defaults || {};
    var effective = view.effective || {};
    var out = {};
    view.spec.fields.forEach(function (f) {
      var has = Object.prototype.hasOwnProperty.call(stored, f.key);
      var v = has ? stored[f.key] : (f.key in defaults ? defaults[f.key] : effective[f.key]);
      out[f.key] = { useDefault: !has, raw: v === undefined ? null : v };
    });
    return out;
  }

  /** A section's state as a sentence. */
  function stateText(state) {
    if (!state) return "";
    var stale = state.stale ? " The game server has not read the table for over 5 minutes." : "";
    switch (state.state) {
      case "applied": return "Applied by the game server (" + (state.process || "?") + ", " + utc(state.appliedAt) + ")." + stale;
      case "waiting": return "Saved; waiting for the game server (it reads every minute)." + stale;
      case "refused": return "Refused by the game server: " + (state.refusal || "no reason given") + ". It keeps the last good value." + stale;
      case "default": return "Nothing stored: the game server uses its config.json values." + stale;
      case "no-game-server": return "No report from the game server yet: the table is new, or config LiveSettings.Enabled is off.";
    }
    return state.state;
  }

  /** The short badge of a state, for the section list. */
  function stateBadge(state) {
    return { applied: "applied", waiting: "waiting", refused: "refused", "default": "config", "no-game-server": "no report" }[state && state.state] || "";
  }

  /** The API's change list as table rows: [label, before, after]. A config.json value says so. */
  function diffRows(changes) {
    return (changes || []).map(function (c) {
      return [c.label + " (" + c.key + ")", show(c.before) + (c.beforeDefault ? " (config default)" : ""),
        show(c.after) + (c.afterDefault ? " (config default)" : "")];
    });
  }

  /** What a history row changed: "Solo tickets: 5 → 9", one per key that differs (missing: config default). */
  function historyChanges(spec, before, after) {
    var out = [];
    var b = before || {}, a = after || {};
    spec.fields.forEach(function (f) {
      var hb = Object.prototype.hasOwnProperty.call(b, f.key), ha = Object.prototype.hasOwnProperty.call(a, f.key);
      if (!hb && !ha) return;
      if (hb && ha && JSON.stringify(b[f.key]) === JSON.stringify(a[f.key])) return;
      out.push(f.label + ": " + (hb ? show(b[f.key]) : "config default") + " → " + (ha ? show(a[f.key]) : "config default"));
    });
    if (after === null) out.push("row deleted: every value back to config.json");
    return out;
  }

  /** The limits of a field as a hint ("0 to 100", "one of off, weekly, daily"). */
  function limits(f) {
    if (f.type === "int" || f.type === "number") {
      return (f.min !== null && f.min !== undefined ? f.min : "any") + " to " + (f.max !== null && f.max !== undefined ? f.max : "any")
        + (f.type === "int" ? ", whole number" : "");
    }
    if (f.type === "string" && f.enumValues && f.enumValues.length) return "one of " + f.enumValues.join(", ");
    if (f.type === "string" && f.maxLength) return "at most " + f.maxLength + " characters";
    if (f.type === "strings") return "up to " + f.maxItems + ", each at most " + f.maxLength + " characters";
    if (f.type === "int_pairs" && f.pair && f.pair.length === 2) {
      return f.minItems + " to " + f.maxItems + " rows; " + f.pair[0].label + " " + f.pair[0].min + "-" + f.pair[0].max
        + ", " + f.pair[1].label + " " + f.pair[1].min + "-" + f.pair[1].max;
    }
    return "";
  }

  /** One group of the patch gate's count as a sentence: "Online now: 2 of 4 characters would be refused (...)." */
  function impactCount(label, c) {
    var more = [];
    if (c.exempt) more.push(c.exempt + " exempt: staff or listed");
    if (c.noVersion) more.push(c.noVersion + " sent no version (v1.18 or older)");
    if (c.notRecorded) more.push(c.notRecorded + " not recorded yet, judged at their next login");
    return label + ": " + c.refused + " of " + c.characters + " character" + (c.characters === 1 ? "" : "s")
      + " would be refused" + (more.length ? " (" + more.join("; ") + ")" : "") + ".";
  }

  /** The patch gate's impact (API) as sentences: what plays, then online and recent counts. */
  function impactLines(impact) {
    if (!impact) return [];
    var out = [impact.describe];
    if (!impact.tracking) {
      out.push("The game server does not record client patches yet (Erupe's 2026-11-client-patch.sql and config "
        + "PatchVersion.Enabled): nobody can be counted.");
      return out;
    }
    out.push(impactCount("Online now", impact.online));
    out.push(impactCount("Seen in the last " + impact.recentDays + " days", impact.recent));
    return out;
  }

  /**
   * The patch gate's "follow the latest release" switch (API patch_gate/auto: {tableReady, enabled, latest, current,
   * inSync}) as a sentence. Nothing for no answer (an API without the switch).
   */
  function autoLine(auto) {
    if (!auto) return "";
    if (!auto.tableReady) {
      return "Latest version is typed by hand. The switch to follow the latest release needs the patch_gate_auto table "
        + "(API docs/schema/2026-11-patch-gate-auto.sql).";
    }
    if (auto.enabled) {
      if (!auto.latest) return "Current: follows the latest release (no release recorded yet: type it once by hand with the switch off).";
      return "Current: follows the latest release (v" + auto.latest + ")."
        + (auto.inSync ? "" : " The stored Current is " + (auto.current ? "v" + auto.current : "empty") + ", not v" + auto.latest + " yet.");
    }
    return "Current is typed by hand." + (auto.latest ? " The latest release recorded is v" + auto.latest + "." : "");
  }

  /** The impact's versions as table rows: [version, online, recent, what the gate does]. */
  function impactRows(impact) {
    return ((impact && impact.versions) || []).map(function (v) {
      return [v.name, String(v.online), String(v.recent),
        v.clientPatch === null || v.clientPatch === undefined ? "judged at next login" : v.refused ? "refused (unless exempt)" : "plays"];
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { utc: utc, show: show, formValue: formValue, formInputs: formInputs, stateText: stateText,
      stateBadge: stateBadge, diffRows: diffRows, historyChanges: historyChanges, limits: limits,
      impactLines: impactLines, impactRows: impactRows, autoLine: autoLine };
  }
  if (typeof document === "undefined") return;

  /* ---------- the page ---------- */

  var started = false;
  var state = { overview: null, auto: null, current: null, inputs: null, reviewed: null, confirmRevert: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /** A table cell holding a time: a <time> in the viewer's zone, UTC on hover. */
  function tcell(iso) {
    var td = el("td", null, "");
    if (typeof window !== "undefined" && window.HvTime && utc(iso) !== "-") td.appendChild(HvTime.node(iso, { weekday: true }));
    else td.textContent = utc(iso);
    return td;
  }

  function $(id) { return document.getElementById(id); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (e) {
      return "";
    }
  }

  // Like admin-events.js's: a refusal throws with the API's message and the whole answer (problems).
  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("Sign in again: your session has ended.");
        if (r.status === 403) throw new Error(o.method && o.method !== "GET" ? "Only admin accounts can change settings." : "Only admins and moderators can see the settings.");
        return r.json().catch(function () { return null; }).then(function (data) {
          if (!r.ok) {
            var error = new Error((data && data.message) || "HTTP " + r.status);
            error.data = data;
            throw error;
          }
          return data;
        });
      });
  }

  function say(id, text) {
    var box = $(id);
    box.textContent = text || "";
    box.hidden = !text;
  }

  function fail(error) { say("set-ok", ""); say("set-alert", error.message); }

  function load(keep) {
    // The gate's follow-the-release switch; an API without it (404) or a failure leaves the field as it was.
    var auto = request("/api/admin/settings/patch_gate/auto").catch(function () { return null; });
    return Promise.all([request("/api/admin/settings"), auto]).then(function (both) {
      var data = both[0];
      state.auto = both[1];
      state.overview = data;
      say("set-alert", "");
      renderStatus();
      renderSectionList();
      renderRestartOnly();
      var name = keep || (state.current && state.current.spec.name) || (data.sections[0] && data.sections[0].spec.name);
      if (name) selectSection(name);
    }).catch(fail);
  }

  function renderStatus() {
    var o = state.overview, box = $("set-status");
    clear(box);
    $("set-note").textContent = o.tableReady ? "" : "table missing";
    if (!o.tableReady) {
      box.appendChild(el("p", "form-alert", "The server_settings table is not in the database yet (Erupe's 2026-11-server-settings.sql). Nothing can be saved until it is."));
    }
    if (!o.processes.length) {
      box.appendChild(el("p", "note-text", "Game server: no report yet. It reports within a minute once config LiveSettings.Enabled is on."));
      return;
    }
    o.processes.forEach(function (p) {
      var errs = p.errors ? Object.keys(p.errors) : [];
      box.appendChild(el("p", "note-text" + (p.stale ? " set-stale" : ""), "Game server " + p.process + ": runs version " + p.version
        + ", last change applied " + utc(p.appliedAt) + ", read the table " + utc(p.readAt)
        + (p.stale ? " (over 5 minutes ago: is it running?)" : "")
        + (errs.length ? "; refused: " + errs.join(", ") : "") + "."));
    });
  }

  function renderSectionList() {
    var nav = $("set-sections");
    clear(nav);
    state.overview.sections.forEach(function (s) {
      var b = el("button", "ghost-btn small set-tab", s.spec.title);
      b.type = "button";
      b.setAttribute("data-section", s.spec.name);
      var badge = stateBadge(s.state);
      if (badge) b.appendChild(el("span", "set-badge set-" + s.state.state, badge));
      b.addEventListener("click", function () { selectSection(s.spec.name); });
      nav.appendChild(b);
    });
  }

  function renderRestartOnly() {
    var list = $("set-restart");
    clear(list);
    var ro = state.overview.restartOnly;
    if (!ro) {
      list.appendChild(el("li", null, "Shown once the game server reports."));
      return;
    }
    Object.keys(ro).sort().forEach(function (k) {
      var v = ro[k];
      list.appendChild(el("li", null, k + ": " + (v === true ? "on" : v === false ? "off" : String(v))));
    });
  }

  function selectSection(name) {
    var view = state.overview.sections.filter(function (s) { return s.spec.name === name; })[0];
    if (!view) return;
    state.current = view;
    state.inputs = formInputs(view);
    state.reviewed = null;
    state.confirmRevert = null;
    Array.prototype.forEach.call(document.querySelectorAll(".set-tab"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-section") === name ? "true" : "false");
    });
    renderForm();
    loadHistory();
  }

  /* --- the form --- */

  function renderForm() {
    var view = state.current, box = $("set-form");
    clear(box);
    say("set-problems", "");
    $("set-review").hidden = true;
    box.appendChild(el("h3", "subhead", view.spec.title));
    box.appendChild(el("p", "note-text", view.spec.help));
    box.appendChild(el("p", "note-text set-effect", "Takes effect: " + view.spec.effect + "."));
    box.appendChild(el("p", "note-text set-state set-" + (view.state ? view.state.state : ""), stateText(view.state)));
    if (view.stored) {
      box.appendChild(el("p", "note-text", "Stored version " + view.stored.version + ", by " + view.stored.updatedBy + ", " + utc(view.stored.updatedAt)
        + (view.stored.note ? " (" + view.stored.note + ")" : "") + "."));
    }
    var grid = el("div", "set-fields");
    view.spec.fields.forEach(function (f) { grid.appendChild(fieldRow(view, f)); });
    if (view.spec.name === "patch_gate" && state.auto) box.appendChild(autoBox());
    box.appendChild(grid);
    if (view.spec.name === "patch_gate") {
      box.appendChild(impactBox());
      refreshImpact(false);
    }
    $("set-note-text").value = "";
    applyReadOnly();
  }

  // Without "settings act" (window.hvStaff, js/admin.js) the tab only shows: no inputs, no review or save, no Revert.
  function readOnly() { return !!(window.hvStaff && !window.hvStaff.can("settings", "act")); }

  function applyReadOnly() {
    var ro = readOnly();
    Array.prototype.forEach.call($("set-form-wrap").querySelectorAll(".field.admin-wide, .admin-actions"), function (n) { n.hidden = ro; });
    if (!ro) return;
    Array.prototype.forEach.call($("set-form").querySelectorAll("input, select, textarea, button"), function (n) { n.disabled = true; });
  }

  /* --- the patch gate's Latest version: follows the latest release, or by hand --- */

  function autoBox() {
    var a = state.auto, wrap = el("div", "set-auto");
    wrap.id = "set-auto";
    var line = el("p", "note-text set-auto-text", autoLine(a));
    line.id = "set-auto-text";
    wrap.appendChild(line);
    if (a.tableReady) {
      var label = el("label", "cal-check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.id = "set-auto-on";
      cb.checked = a.enabled;
      cb.addEventListener("change", function () { setAuto(cb.checked); });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" Latest version follows the latest release"));
      wrap.appendChild(label);
      if (a.enabled && a.latest && !a.inSync) {
        var now = el("button", "ghost-btn small", "Set Current to v" + a.latest + " now");
        now.type = "button";
        now.id = "set-auto-now";
        now.addEventListener("click", function () { setAuto(true); });
        wrap.appendChild(now);
      }
    }
    return wrap;
  }

  // On sets Current to the latest release at once (the API saves it, with a history row); off only turns the switch off.
  function setAuto(on) {
    request("/api/admin/settings/patch_gate/auto", { method: "PUT", body: JSON.stringify({ enabled: on }) })
      .then(function (result) {
        say("set-ok", on
          ? "Latest version follows the latest release" + (result.changes && result.changes.length
            ? ": Current is now v" + result.auto.latest + ". The game server applies it within a minute." : ".")
          : "Latest version is typed by hand again.");
        return load("patch_gate");
      })
      .catch(function (e) { fail(e); renderForm(); });
  }

  /* --- the patch gate's count of who it would refuse --- */

  var impactTimer = null, impactSeq = 0;

  function impactBox() {
    var wrap = el("div", "set-impact");
    wrap.id = "set-impact";
    wrap.appendChild(el("h4", "subhead", "Who this would refuse right now"));
    var text = el("div", "set-impact-text");
    text.id = "set-impact-text";
    text.appendChild(el("p", "note-text", "Counting…"));
    wrap.appendChild(text);
    var tw = el("div", "table-wrap");
    var table = el("table", "data-table admin-table");
    var head = el("thead");
    var hr = el("tr");
    ["Client patch", "Online", "Last 7 days", "With these values"].forEach(function (h) { hr.appendChild(el("th", null, h)); });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el("tbody");
    body.id = "set-impact-rows";
    table.appendChild(body);
    tw.appendChild(table);
    wrap.appendChild(tw);
    return wrap;
  }

  // fromForm: count the form's values (admins; POST); else the stored ones. A moderator's form count falls back to
  // the stored values. Only the newest answer is shown.
  function refreshImpact(fromForm) {
    var view = state.current;
    if (!view || view.spec.name !== "patch_gate" || !$("set-impact")) return;
    var seq = ++impactSeq;
    var req = fromForm
      ? request("/api/admin/settings/patch_gate/impact", { method: "POST", body: JSON.stringify({ value: formValue(view.spec, state.inputs).value }) })
      : request("/api/admin/settings/patch_gate/impact");
    req.then(function (impact) {
      if (seq === impactSeq) renderImpact(impact, fromForm ? "With the values in the form (not saved yet)." : "With the stored values.");
    }).catch(function (error) {
      if (seq !== impactSeq) return;
      if (fromForm && /Only admin/.test(error.message)) {
        refreshImpact(false);
        return;
      }
      var text = $("set-impact-text");
      clear(text);
      text.appendChild(el("p", "form-alert", "Could not count: " + error.message));
    });
  }

  function scheduleImpact() {
    if (!state.current || state.current.spec.name !== "patch_gate") return;
    clearTimeout(impactTimer);
    impactTimer = setTimeout(function () { refreshImpact(true); }, 400);
  }

  function renderImpact(impact, which) {
    var text = $("set-impact-text"), body = $("set-impact-rows");
    if (!text || !body) return;
    clear(text);
    text.appendChild(el("p", "note-text set-effect", which));
    impactLines(impact).forEach(function (line) { text.appendChild(el("p", "note-text", line)); });
    (impact.problems || []).forEach(function (p) { text.appendChild(el("p", "form-alert", p)); });
    clear(body);
    var rows = impactRows(impact);
    if (!rows.length) {
      var tr = el("tr");
      var td = el("td", "empty-cell", "No character online or seen in the last " + (impact.recentDays || 7) + " days.");
      td.colSpan = 4;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    rows.forEach(function (r) {
      var tr = el("tr");
      r.forEach(function (c) { tr.appendChild(el("td", null, c)); });
      body.appendChild(tr);
    });
  }

  function fieldRow(view, f) {
    var input = state.inputs[f.key];
    var row = el("div", "field set-field");
    row.setAttribute("data-key", f.key);
    var id = "set-f-" + f.key;
    var label = el("label", null, f.label);
    label.setAttribute("for", id);
    var hint = limits(f);
    if (hint) label.appendChild(el("span", "field-optional", " " + hint));
    row.appendChild(label);

    var control = el("div", "set-control");
    var follows = view.spec.name === "patch_gate" && f.key === "current" && state.auto && state.auto.enabled;
    var editor = editorFor(f, input, id);
    control.appendChild(editor);
    if (follows) {
      // The release sets it (and the API refuses another value): show it, do not offer it. Left on "config default"
      // it is simply not sent; stored, it is sent as it is.
      var box = editor.querySelector("input");
      if (box) box.disabled = true;
      row.appendChild(control);
      row.appendChild(el("p", "note-text set-help", autoLine(state.auto) + " " + f.help));
      return row;
    }
    var defaults = view.defaults || {};
    var useDefault = el("label", "cal-check set-default");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = input.useDefault;
    cb.addEventListener("change", function () {
      input.useDefault = cb.checked;
      if (cb.checked && f.key in defaults) input.raw = defaults[f.key];
      state.reviewed = null;
      $("set-review").hidden = true;
      var fresh = editorFor(f, input, id);
      control.replaceChild(fresh, control.firstChild);
      scheduleImpact();
    });
    useDefault.appendChild(cb);
    useDefault.appendChild(document.createTextNode(" config default" + (f.key in defaults ? " (" + show(defaults[f.key]) + ")" : "")));
    control.appendChild(useDefault);
    row.appendChild(control);

    var eff = view.effective || {};
    var running = f.key in eff ? "Game server runs: " + show(eff[f.key]) + ". " : "";
    row.appendChild(el("p", "note-text set-help", running + f.help));
    return row;
  }

  function changed() {
    state.reviewed = null;
    $("set-review").hidden = true;
    scheduleImpact();
  }

  function editorFor(f, input, id) {
    var disabled = input.useDefault;
    var wrap = el("div", "set-editor");
    if (f.type === "bool") {
      var l = el("label", "cal-check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = !!input.raw;
      cb.disabled = disabled;
      cb.addEventListener("change", function () { input.raw = cb.checked; changed(); });
      l.appendChild(cb);
      l.appendChild(document.createTextNode(" on"));
      wrap.appendChild(l);
    } else if (f.type === "int" || f.type === "number") {
      var n = el("input");
      n.type = "number";
      n.id = id;
      if (f.min !== null && f.min !== undefined) n.min = f.min;
      if (f.max !== null && f.max !== undefined) n.max = f.max;
      n.step = f.type === "int" ? "1" : "any";
      n.value = input.raw === null || input.raw === undefined ? "" : input.raw;
      n.disabled = disabled;
      n.addEventListener("input", function () { input.raw = n.value; changed(); });
      wrap.appendChild(n);
    } else if (f.type === "string" && f.enumValues && f.enumValues.length) {
      var sel = el("select");
      sel.id = id;
      f.enumValues.forEach(function (v) { var o = el("option", null, v); o.value = v; sel.appendChild(o); });
      sel.value = input.raw || f.enumValues[0];
      if (input.raw === null || input.raw === undefined || input.raw === "") input.raw = sel.value;
      sel.disabled = disabled;
      sel.addEventListener("change", function () { input.raw = sel.value; changed(); });
      wrap.appendChild(sel);
    } else if (f.type === "string") {
      var t = el("input");
      t.type = "text";
      t.id = id;
      if (f.maxLength) t.maxLength = f.maxLength;
      t.value = input.raw || "";
      t.disabled = disabled;
      t.addEventListener("input", function () { input.raw = t.value; changed(); });
      wrap.appendChild(t);
    } else if (f.type === "strings") {
      listEditor(wrap, f, input, id, disabled, function (item, i, list) {
        var ta = el("textarea");
        ta.rows = 4;
        if (f.maxLength) ta.maxLength = f.maxLength;
        ta.value = item;
        ta.disabled = disabled;
        if (i === 0) ta.id = id;
        ta.setAttribute("aria-label", f.label + " " + (i + 1));
        ta.addEventListener("input", function () { list[i] = ta.value; changed(); });
        return ta;
      }, function () { return ""; });
    } else if (f.type === "int_pairs") {
      listEditor(wrap, f, input, id, disabled, function (item, i, list) {
        var pair = el("div", "set-pair");
        [0, 1].forEach(function (j) {
          var p = f.pair[j];
          var n = el("input");
          n.type = "number";
          n.min = p.min;
          n.max = p.max;
          n.step = "1";
          n.value = item[j];
          n.disabled = disabled;
          n.setAttribute("aria-label", p.label + ", row " + (i + 1));
          if (i === 0 && j === 0) n.id = id;
          n.addEventListener("input", function () { list[i][j] = n.value; changed(); });
          pair.appendChild(el("span", "set-pair-label", p.label));
          pair.appendChild(n);
        });
        return pair;
      }, function () { return ["", ""]; });
    }
    return wrap;
  }

  // A list of editors with add and remove; the list is copied so "config default" keeps the stored value intact.
  function listEditor(wrap, f, input, id, disabled, make, blank) {
    var list = (input.raw || []).map(function (x) { return Array.isArray(x) ? x.slice() : x; });
    input.raw = list;
    var items = el("div", "set-list");
    function draw() {
      clear(items);
      list.forEach(function (item, i) {
        var row = el("div", "set-list-row");
        row.appendChild(make(item, i, list));
        var rm = el("button", "ghost-btn small", "Remove");
        rm.type = "button";
        rm.disabled = disabled;
        rm.addEventListener("click", function () { list.splice(i, 1); changed(); draw(); });
        row.appendChild(rm);
        items.appendChild(row);
      });
    }
    draw();
    wrap.appendChild(items);
    var add = el("button", "ghost-btn small", "Add");
    add.type = "button";
    add.disabled = disabled || (f.maxItems > 0 && list.length >= f.maxItems);
    add.addEventListener("click", function () {
      if (f.maxItems > 0 && list.length >= f.maxItems) return;
      list.push(blank());
      changed();
      draw();
    });
    wrap.appendChild(add);
  }

  /* --- review and save --- */

  function review(event) {
    if (event) event.preventDefault();
    say("set-ok", "");
    var built = formValue(state.current.spec, state.inputs);
    if (built.errors.length) {
      showProblems(built.errors);
      return;
    }
    request("/api/admin/settings/" + state.current.spec.name + "/check", { method: "POST", body: JSON.stringify({ value: built.value }) })
      .then(function (result) {
        if (result.problems.length) {
          showProblems(result.problems);
          return;
        }
        showProblems([]);
        state.reviewed = built.value;
        renderReview(result.changes);
      })
      .catch(fail);
  }

  function showProblems(list) {
    var box = $("set-problems");
    clear(box);
    list.forEach(function (p) { box.appendChild(el("li", null, p)); });
    box.hidden = !list.length;
  }

  function renderReview(changes) {
    var box = $("set-review"), body = $("set-diff");
    clear(body);
    var rows = diffRows(changes);
    if (!rows.length) {
      var tr = el("tr");
      var td = el("td", "empty-cell", "No change.");
      td.colSpan = 3;
      tr.appendChild(td);
      body.appendChild(tr);
    }
    rows.forEach(function (r) {
      var tr = el("tr");
      r.forEach(function (c) { tr.appendChild(el("td", null, c)); });
      body.appendChild(tr);
    });
    $("set-save").disabled = !rows.length;
    box.hidden = false;
  }

  function save() {
    if (!state.reviewed) return;
    var view = state.current;
    var body = { value: state.reviewed, expectedVersion: view.stored ? view.stored.version : 0,
      note: $("set-note-text").value || null };
    request("/api/admin/settings/" + view.spec.name, { method: "PUT", body: JSON.stringify(body) })
      .then(function (result) {
        say("set-ok", view.spec.title + " saved (version " + result.section.stored.version + "). The game server applies it within a minute; the state below says when.");
        return load(view.spec.name);
      })
      .catch(function (e) {
        if (e.data && e.data.problems && e.data.problems.length > 1) showProblems(e.data.problems);
        fail(e);
      });
  }

  /* --- history --- */

  function loadHistory() {
    var view = state.current;
    return request("/api/admin/settings/" + view.spec.name + "/history?limit=50").then(function (rows) {
      if (state.current !== view) return;
      var body = $("set-history");
      clear(body);
      if (!rows.length) {
        var tr = el("tr");
        var td = el("td", "empty-cell", "No change yet.");
        td.colSpan = 5;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      rows.forEach(function (h, i) {
        var tr = el("tr");
        tr.appendChild(el("td", null, "#" + h.id + " v" + h.version));
        tr.appendChild(tcell(h.updatedAt));
        tr.appendChild(el("td", null, h.updatedBy + (h.note ? " (" + h.note + ")" : "")));
        var what = el("td");
        var lines = historyChanges(view.spec, h.before, h.after);
        (lines.length ? lines : ["no change"]).forEach(function (l) { what.appendChild(el("div", null, l)); });
        tr.appendChild(what);
        var act = el("td");
        if (h.after !== null && !readOnly()) {
          var b = el("button", "ghost-btn small", "Revert");
          b.type = "button";
          b.title = h.before === null ? "Back to config.json for every key (this change created the section)" : "Put back the value before this change";
          b.addEventListener("click", function () { revert(h, b); });
          act.appendChild(b);
        }
        tr.appendChild(act);
        body.appendChild(tr);
      });
    }).catch(fail);
  }

  // Two clicks, like the Events tab's delete: the first asks, the second does it.
  function revert(h, button) {
    if (state.confirmRevert !== h.id) {
      state.confirmRevert = h.id;
      button.textContent = "Click again to revert #" + h.id;
      return;
    }
    state.confirmRevert = null;
    var view = state.current;
    request("/api/admin/settings/" + view.spec.name + "/revert/" + h.id, { method: "POST",
      body: JSON.stringify({ expectedVersion: view.stored ? view.stored.version : 0 }) })
      .then(function (result) {
        say("set-ok", "Reverted change #" + h.id + " (now version " + result.section.stored.version + ").");
        return load(view.spec.name);
      })
      .catch(fail);
  }

  function wire() {
    $("set-form-wrap").addEventListener("submit", review);
    $("set-save").addEventListener("click", save);
    $("set-cancel").addEventListener("click", function () { selectSection(state.current.spec.name); });
    $("set-refresh").addEventListener("click", function () { load(); });
  }

  window.startAdminSettings = function () {
    if (!started) {
      started = true;
      wire();
    }
    load();
  };
})();
