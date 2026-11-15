/* The form for a community set's details: title, notes, hunter rank band, stage, the character and "Show my hunter
   name". One form for posting from the Set builder and for editing on the Community sets page, so both ask the same
   things in the same words. It does not know the set or the API: the caller gets the typed values in
   `submit(values)` (a promise; a rejection's message is shown in the form as it is) and builds the request.

     SetPostForm.create({options, characters, values, submitLabel, submit, onCancel}) -> {el}

   options: the answer of GET /api/public/armor-sets/options (bands, stages, maxTitle, maxNotes).
   characters: [{id, name, hr, gr}] of the account. values: {title, notes, band, stage, showAuthor, charId}
   (all optional). Text goes in with .value, never as HTML. */
(function (root) {
  "use strict";

  var counter = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /** The band key that fits a character's rank (a GR rank wins over HR), or "" when the character has no rank. */
  function bandFor(character) {
    if (!character) return "";
    var hr = Number(character.hr), gr = Number(character.gr);
    if (gr >= 100) return "gr100";
    if (gr >= 50) return "gr50";
    if (gr >= 1) return "gr1";
    if (!(hr >= 1)) return "";
    if (hr < 30) return "hr1";
    if (hr < 50) return "hr2";
    if (hr < 99) return "hr3";
    if (hr < 299) return "hr4";
    if (hr < 998) return "hr5";
    return "hr6";
  }

  function field(label, control, id, hint) {
    var f = el("div", "field");
    var l = el("label", null, label);
    l.setAttribute("for", id);
    f.appendChild(l);
    f.appendChild(control);
    if (hint) f.appendChild(el("p", "note-text", hint));
    return f;
  }

  function select(id, list, value) {
    var s = el("select");
    s.id = id;
    list.forEach(function (o) {
      var opt = el("option", null, o.label);
      opt.value = o.value;
      s.appendChild(opt);
    });
    s.value = value;
    if (s.value !== String(value) && list.length) s.value = list[0].value;
    return s;
  }

  function create(opts) {
    var options = opts.options;
    var characters = opts.characters || [];
    var v = opts.values || {};
    counter += 1;
    var p = "spf" + counter;

    var form = el("form", "spf-form");
    form.noValidate = true;

    var title = el("input");
    title.type = "text";
    title.id = p + "-title";
    title.maxLength = options.maxTitle;
    title.value = v.title || "";
    title.autocomplete = "off";
    form.appendChild(field("Title (up to " + options.maxTitle + " characters)", title, title.id));

    var notes = el("textarea");
    notes.id = p + "-notes";
    notes.rows = 4;
    notes.maxLength = options.maxNotes;
    notes.value = v.notes || "";
    form.appendChild(field("Notes (up to " + options.maxNotes + " characters, shown as plain text)", notes, notes.id,
      "What the set is for, how to play it, which decorations to swap."));

    var grid = el("div", "spf-grid");
    var chosen = characters.filter(function (c) { return String(c.id) === String(v.charId); })[0] || characters[0] || null;
    var band = select(p + "-band", options.bands.map(function (b) { return { value: b.key, label: b.label }; }),
      v.band || bandFor(chosen) || options.bands[0].key);
    grid.appendChild(field("Hunter rank band", band, band.id, "Who the set is meant for."));
    var stage = select(p + "-stage", options.stages.map(function (s) { return { value: s.key, label: s.label }; }), v.stage || "");
    grid.appendChild(field("Stage", stage, stage.id));
    form.appendChild(grid);

    var character = select(p + "-char", characters.map(function (c) { return { value: String(c.id), label: c.name }; }),
      chosen ? String(chosen.id) : "");
    character.disabled = !characters.length;
    var charField = field("Character", character, character.id, characters.length
      ? "Staff see which character posted the set. Other hunters see its name only if you tick the box below."
      : "You have no character yet: make one in the game first, then come back.");
    form.appendChild(charField);

    var showLabel = el("label", "cal-check spf-check");
    var show = el("input");
    show.type = "checkbox";
    show.id = p + "-show";
    show.checked = !!v.showAuthor;
    showLabel.appendChild(show);
    showLabel.appendChild(document.createTextNode(" Show my hunter name"));
    form.appendChild(showLabel);
    form.appendChild(el("p", "note-text", "Off by default: the set then appears without an author. A character's items are never shown."));

    var alert = el("p", "form-alert");
    alert.setAttribute("role", "alert");
    alert.hidden = true;
    form.appendChild(alert);

    var actions = el("div", "bui-actions spf-actions");
    var send = el("button", "btn btn-primary btn-small", opts.submitLabel || "Save");
    send.type = "submit";
    actions.appendChild(send);
    if (opts.onCancel) {
      var cancel = el("button", "ghost-btn small", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", opts.onCancel);
      actions.appendChild(cancel);
    }
    form.appendChild(actions);

    function say(text) {
      alert.textContent = text || "";
      alert.hidden = !text;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = {
        title: title.value.trim(), notes: notes.value.trim(), band: band.value, stage: stage.value,
        showAuthor: show.checked, charId: character.value ? Number(character.value) : null
      };
      if (!values.title) { say("Give the set a title."); title.focus(); return; }
      if (values.showAuthor && values.charId === null) { say("Pick the character whose name is shown."); return; }
      say("");
      send.disabled = true;
      Promise.resolve().then(function () { return opts.submit(values); }).then(function () {
        send.disabled = false;
      }, function (error) {
        send.disabled = false;
        say(error && error.message ? error.message : "Could not save the set.");
      });
    });

    return { el: form, say: say };
  }

  var api = { create: create, bandFor: bandFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SetPostForm = api;
})(typeof window !== "undefined" ? window : this);
