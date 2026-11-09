/* Shared controls of the two builders, the Road builder (road.html) and the Quest builder
   (quest-editor.html), so both look and behave the same: one picker (a dropdown that draws an icon on every
   option, with a search box when the list is long, usable by mouse, touch and keyboard), number inputs that
   say what they accept, fields with a label and a help note, section panels and add/remove buttons.

   Icons: a monster's picture comes from data/monster-icons.json (id -> path), an item's from
   data/item-icons.json (id -> icon key, the game's icon /assets/icons/1x/<key>.png, 2x/ in srcset; see
   js/game-icons.js). Anything without a picture gets the one
   neutral placeholder, never a broken image. The icon lookups also run under node, where
   dev/check-builder-icons.js uses them to check that every offered monster and item has a file. */
(function (root) {
  "use strict";

  var PLACEHOLDER = "/assets/builder/no-icon.svg";
  var SEARCH_FROM = 12;   // a list longer than this gets a search box
  var SHOW_AT_MOST = 200; // rows drawn at once; typing narrows a longer list

  var tables = { monsters: null, items: null };

  function setTables(next) {
    if (next.monsters) tables.monsters = next.monsters;
    if (next.items) tables.items = next.items;
  }

  /** The picture of a monster, or "" when it has none. */
  function monsterIcon(id) {
    return (tables.monsters && tables.monsters[String(id)]) || "";
  }

  /** The picture of an item, or "" when it has none. */
  function itemIcon(id) {
    var name = tables.items && tables.items[String(id)];
    return name ? "/assets/icons/1x/" + name + ".png" : "";
  }

  /** What a picker draws for an option: a picture, the placeholder, or nothing for "None" (id 0). */
  function iconFor(kind, id) {
    if (!kind || !Number(id)) return "";
    var src = kind === "monster" ? monsterIcon(id) : kind === "item" ? itemIcon(id) : "";
    return src || PLACEHOLDER;
  }

  // ---- bytes labels: where a field sits in the file, from data/quest-fields.json -----------------

  /** The type as the label shows it: "u8", "s8 (signed)", "bitfield", "Shift-JIS text". */
  function typeName(f) {
    var t = String(f.type || "");
    if (/^string/.test(t)) return "Shift-JIS text";
    var m = /^(u8|s8|u16|s16|u32|s32|f32)/.exec(t);
    if (m) return m[1] + (m[1].charAt(0) === "s" ? " (signed)" : "");
    return t;
  }

  function bytesWord(n) { return n + (n === 1 ? " byte" : " bytes"); }

  function hex(n) {
    var s = n.toString(16);
    return "0x" + (s.length < 2 ? "0" + s : s);
  }

  /** "body +0x0a", the place of element `index` of an array field ("body +0xbb"), or "text slot 3". */
  function placeOf(f, index) {
    if (f.struct === "text") {
      var slot = /^texts\[(\d+)\]/.exec(f.key || "");
      return "text slot " + (slot ? slot[1] : "?");
    }
    var at = parseInt(f.offset, 16);
    if (f.count && index !== undefined && index !== null) at += index * (f.size / f.count);
    return f.struct + " +" + hex(at);
  }

  /** "u8, 1 byte", "u8 × 5, 5 bytes" for a whole array, "Shift-JIS text, room 192 bytes" for a text slot. */
  function sizeOf(f, index) {
    if (f.struct === "text") return typeName(f) + ", NUL-terminated";
    var one = f.count ? f.size / f.count : f.size;
    if (f.count && (index === undefined || index === null)) return typeName(f) + " × " + f.count + ", " + bytesWord(f.size);
    return typeName(f) + ", " + bytesWord(one);
  }

  /**
   * The bytes label of a control: ref is { fields: [quest-fields.json entries], index } (index = the element
   * of an array field). One field: "body +0x0a · u8, 1 byte". Two of the same type: "body +0x0a and header
   * +0x5c · u8, 1 byte each"; of different types: "body +0x24 · u16, 2 bytes; mapRecord +0x00 · u32, 4 bytes".
   */
  function bytesText(ref) {
    var list = ref && ref.fields ? ref.fields : [];
    if (!list.length) return "";
    var sizes = list.map(function (f) { return sizeOf(f, ref.index); });
    var places = list.map(function (f) { return placeOf(f, ref.index); });
    var same = sizes.every(function (s) { return s === sizes[0]; });
    if (same) return places.join(" and ") + " · " + sizes[0] + (list.length > 1 ? " each" : "");
    return places.map(function (p, i) { return p + " · " + sizes[i]; }).join("; ");
  }

  /** True when the field's meaning or its value names rest on one source or a guess (quest-fields.json). */
  function unsure(ref) {
    var f = ref && ref.fields && ref.fields[0];
    if (!f) return false;
    return f.confidence !== "confirmed" || (!!f.valuesConfidence && f.valuesConfidence !== "confirmed");
  }

  var shared = {
    PLACEHOLDER: PLACEHOLDER, setTables: setTables, monsterIcon: monsterIcon, itemIcon: itemIcon, iconFor: iconFor,
    bytesText: bytesText, unsure: unsure
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = shared;
    return;
  }

  var doc = root.document;

  /** Loads the icon tables a page needs ("monsters", "items"); a table that fails to load leaves placeholders. */
  function loadIcons(kinds) {
    var files = { monsters: "/data/monster-icons.json", items: "/data/item-icons.json" };
    return Promise.all(kinds.map(function (kind) {
      if (tables[kind]) return null;
      return fetch(files[kind]).then(function (res) { return res.ok ? res.json() : {}; })
        .catch(function () { return {}; })
        .then(function (table) { var next = {}; next[kind] = table || {}; setTables(next); });
    }));
  }

  // ---- small DOM helpers -----------------------------------------------------------------------

  var counter = 0;
  function uid(prefix) { counter += 1; return prefix + "-" + counter; }

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function note(text, cls) {
    return el("p", "note-text" + (cls ? " " + cls : ""), text);
  }

  function iconNode(src) {
    if (!src) return el("span", "bui-icon is-blank");
    var img = el("img", "bui-icon");
    img.alt = "";
    img.loading = "lazy";
    img.src = src;
    if (src.indexOf("/assets/icons/1x/") === 0) { // the game's icons: the 2x file when 28 px needs it
      img.srcset = src + " 32w, " + src.replace("/1x/", "/2x/") + " 64w";
      img.sizes = "28px";
    }
    img.addEventListener("error", function () {
      img.removeAttribute("srcset");
      if (img.src.indexOf(PLACEHOLDER) === -1) img.src = PLACEHOLDER;
    });
    return img;
  }

  /** A section panel: heading, an optional short note beside it and an optional intro paragraph. */
  function section(title, panelNote, intro) {
    var box = el("section", "panel bui-section");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (panelNote) head.appendChild(el("span", "panel-note", panelNote));
    box.appendChild(head);
    if (intro) box.appendChild(note(intro));
    return box;
  }

  /** A sub-heading inside a section. */
  function subhead(text) {
    return el("h3", "subhead", text);
  }

  function refTitle(ref) {
    return ref.fields.map(function (f) { return f.key + ": " + f.label + (f.notes ? ". " + f.notes : ""); }).join("\n");
  }

  /** The small muted bytes label of a control ("body +0x0a · u8, 1 byte"), or null without a ref. */
  function bytesNode(ref) {
    var text = bytesText(ref);
    if (!text) return null;
    var span = el("span", "bui-bytes", text);
    span.title = refTitle(ref);
    span.setAttribute("data-fields", ref.fields.map(function (f) { return f.key; }).join(" "));
    if (ref.index !== undefined && ref.index !== null) span.setAttribute("data-index", String(ref.index));
    return span;
  }

  /** The muted "(unconfirmed)" mark for a field whose name rests on one source or a guess, or null. */
  function unsureNode(ref, why) {
    if (!why && !unsure(ref)) return null;
    var span = el("span", "bui-unsure", "(unconfirmed)");
    span.title = why || "The name rests on one source or a guess (docs/quest-fields.md).";
    return span;
  }

  /**
   * A labelled field: label, the bytes label, the control, then a help note. A picker is labelled through
   * aria-labelledby. opts: wide; ref ({fields, index}, see bytesText) adds the bytes label and, for a field
   * whose name is not confirmed, "(unconfirmed)"; unsure (text) forces that mark with its reason.
   */
  function field(labelText, control, hint, opts) {
    var o = opts || {};
    var wrap = el("div", "field" + (o.wide ? " bui-wide" : ""));
    var label = el("label", null, labelText);
    var node = control && control.el ? control.el : control;
    if (control && control.labelWith) {
      label.id = uid("bui-label");
      control.labelWith(label.id);
    } else if (node && node.id) {
      label.htmlFor = node.id;
    }
    var mark = unsureNode(o.ref, o.unsure);
    if (mark) { label.appendChild(doc.createTextNode(" ")); label.appendChild(mark); }
    wrap.appendChild(label);
    var bytes = bytesNode(o.ref);
    if (bytes) wrap.appendChild(bytes);
    wrap.appendChild(node);
    if (hint) wrap.appendChild(note(hint));
    return wrap;
  }

  /** A row button. kind "add" draws a plus, "remove" a cross; label is the visible text. */
  function button(label, onClick, kind, ariaLabel) {
    var b = el("button", "ghost-btn small bui-btn" + (kind ? " bui-" + kind : ""), label);
    b.type = "button";
    if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
    b.addEventListener("click", onClick);
    return b;
  }

  /**
   * A number input that only passes values it accepts to onChange, and marks anything else with the reason.
   * opts: value, min, max, step ("any" for decimals; whole numbers otherwise), onChange, id, label (aria).
   */
  function numberInput(opts) {
    var input = el("input", "bui-number");
    input.type = "number";
    input.inputMode = opts.step === "any" ? "decimal" : "numeric";
    if (opts.id) input.id = opts.id;
    if (opts.label) input.setAttribute("aria-label", opts.label);
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    input.step = opts.step || "1";
    input.value = String(opts.value === undefined || opts.value === null ? 0 : opts.value);
    var whole = opts.step !== "any";

    function reason(n) {
      if (input.value === "" || !isFinite(n)) return "Enter a number.";
      if (whole && Math.floor(n) !== n) return "Enter a whole number.";
      if (opts.min !== undefined && n < opts.min) return "The lowest value is " + opts.min + ".";
      if (opts.max !== undefined && n > opts.max) return "The highest value is " + opts.max + ".";
      return "";
    }

    input.addEventListener("input", function () {
      var n = Number(input.value);
      var why = reason(n);
      input.classList.toggle("is-invalid", !!why);
      input.setAttribute("aria-invalid", why ? "true" : "false");
      input.title = why;
      if (!why && opts.onChange) opts.onChange(n);
    });
    input.setValue = function (v) {
      if (doc.activeElement === input) return;
      input.value = String(v);
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      input.title = "";
    };
    return input;
  }

  /** numberInput inside a labelled field, with an optional unit after the input ("minutes"). */
  function numberField(labelText, opts, hint) {
    if (!opts.id) opts.id = uid("bui-num");
    var input = numberInput(opts);
    var control = input;
    if (opts.unit) {
      control = el("span", "bui-unit-wrap");
      control.appendChild(input);
      control.appendChild(el("span", "bui-unit", opts.unit));
      control.id = "";
    }
    var wrap = field(labelText, control, hint, opts);
    wrap.querySelector("label").htmlFor = opts.id;
    wrap.input = input;
    return wrap;
  }

  // ---- the picker ------------------------------------------------------------------------------

  var pop = null;      // the one popup, shared by every picker on the page
  var openPicker = null;

  function keyOf(opt) {
    if (opt._k === undefined) opt._k = String(opt.label).toLowerCase();
    return opt._k;
  }

  function indexOf(options) {
    if (!options._index) {
      options._index = {};
      options.forEach(function (opt) { options._index[String(opt.value)] = opt; });
    }
    return options._index;
  }

  function matches(opt, words, raw) {
    if (raw && String(opt.value) === raw) return true;
    var key = keyOf(opt);
    for (var i = 0; i < words.length; i++) if (key.indexOf(words[i]) === -1) return false;
    return true;
  }

  function buildPop() {
    pop = el("div", "bui-pop");
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.search = el("input", "bui-search");
    pop.search.type = "search";
    pop.search.setAttribute("autocomplete", "off");
    pop.search.setAttribute("aria-autocomplete", "list");
    pop.list = el("ul", "bui-list");
    pop.list.setAttribute("role", "listbox");
    pop.list.id = uid("bui-list");
    pop.list.tabIndex = -1;
    pop.search.setAttribute("aria-controls", pop.list.id);
    pop.more = note("", "bui-more");
    pop.appendChild(pop.search);
    pop.appendChild(pop.list);
    pop.appendChild(pop.more);
    doc.body.appendChild(pop);

    pop.search.addEventListener("input", function () { if (openPicker) fill(openPicker, pop.search.value); });
    pop.search.addEventListener("keydown", onKey);
    pop.list.addEventListener("keydown", onKey);
    doc.addEventListener("mousedown", outside, true);
    doc.addEventListener("touchstart", outside, true);
    root.addEventListener("resize", function () { if (openPicker) place(openPicker); });
    root.addEventListener("scroll", function (event) {
      if (openPicker && !pop.contains(event.target)) place(openPicker);
    }, true);
  }

  function outside(event) {
    if (!openPicker) return;
    if (pop.contains(event.target) || openPicker.button.contains(event.target)) return;
    close(false);
  }

  function place(p) {
    var rect = p.button.getBoundingClientRect();
    var vw = doc.documentElement.clientWidth;
    var vh = root.innerHeight;
    var width = Math.min(Math.max(rect.width, 280), vw - 16);
    var left = Math.min(Math.max(8, rect.left), vw - width - 8);
    pop.style.width = width + "px";
    pop.style.left = left + "px";
    var below = vh - rect.bottom - 8;
    var above = rect.top - 8;
    var height = Math.min(360, Math.max(below, above));
    pop.style.maxHeight = height + "px";
    if (below >= Math.min(260, above) || below >= above) {
      pop.style.top = (rect.bottom + 4) + "px";
      pop.style.bottom = "";
    } else {
      pop.style.top = "";
      pop.style.bottom = (vh - rect.top + 4) + "px";
    }
  }

  function rows() { return pop.list.querySelectorAll(".bui-option"); }

  function setActive(p, index) {
    var all = rows();
    if (!all.length) return;
    index = Math.max(0, Math.min(all.length - 1, index));
    if (p.active >= 0 && all[p.active]) all[p.active].classList.remove("is-active");
    p.active = index;
    var row = all[index];
    row.classList.add("is-active");
    var owner = pop.search.hidden ? pop.list : pop.search;
    owner.setAttribute("aria-activedescendant", row.id);
    row.scrollIntoView({ block: "nearest" });
  }

  function fill(p, term) {
    var raw = String(term || "").trim().toLowerCase();
    var words = raw.split(/\s+/).filter(Boolean);
    var list = pop.list;
    list.textContent = "";
    var shown = 0;
    var found = 0;
    var group = null;
    var current = String(p.value);
    var selectedIndex = -1;
    p.options.forEach(function (opt) {
      if (words.length && !matches(opt, words, raw)) return;
      found += 1;
      if (shown >= SHOW_AT_MOST) return;
      if (opt.group && opt.group !== group) {
        group = opt.group;
        var head = el("li", "bui-group", group);
        head.setAttribute("role", "presentation");
        list.appendChild(head);
      }
      var row = el("li", "bui-option");
      row.id = uid("bui-opt");
      row.setAttribute("role", "option");
      row.appendChild(iconNode(p.icon(opt.value)));
      var text = el("span", "bui-name", opt.label);
      row.appendChild(text);
      if (opt.hint) row.appendChild(el("span", "bui-hint", opt.hint));
      if (p.showIds) row.appendChild(el("span", "bui-id", "#" + p.idOf(opt.value)));
      var on = String(opt.value) === current;
      row.setAttribute("aria-selected", on ? "true" : "false");
      if (on) { row.classList.add("is-on"); selectedIndex = shown; }
      if (opt.disabled) {
        // Shown so the user sees it exists, but it cannot be chosen (its hint says why).
        row.classList.add("is-disabled");
        row.setAttribute("aria-disabled", "true");
      } else {
        row.addEventListener("click", function () { choose(p, opt.value); });
      }
      list.appendChild(row);
      shown += 1;
    });
    if (!found) list.appendChild(el("li", "bui-empty", "Nothing matches “" + term.trim() + "”."));
    pop.more.hidden = found <= shown;
    pop.more.textContent = found > shown
      ? "Showing " + shown + " of " + found.toLocaleString() + ". Type more of the name to narrow the list."
      : "";
    p.active = -1;
    if (shown) setActive(p, words.length ? 0 : Math.max(0, selectedIndex));
  }

  function onKey(event) {
    var p = openPicker;
    if (!p) return;
    var all = rows();
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); setActive(p, p.active + 1); break;
      case "ArrowUp": event.preventDefault(); setActive(p, p.active - 1); break;
      case "PageDown": event.preventDefault(); setActive(p, p.active + 8); break;
      case "PageUp": event.preventDefault(); setActive(p, p.active - 8); break;
      case "Home": if (pop.search.hidden) { event.preventDefault(); setActive(p, 0); } break;
      case "End": if (pop.search.hidden) { event.preventDefault(); setActive(p, all.length - 1); } break;
      case "Enter":
        event.preventDefault();
        if (all[p.active]) all[p.active].click();
        break;
      case "Escape": event.preventDefault(); close(true); break;
      case "Tab": close(false); break;
      default:
        // In a short list without a search box, a letter jumps to the next option starting with it.
        if (pop.search.hidden && event.key.length === 1 && /\S/.test(event.key)) {
          var letter = event.key.toLowerCase();
          for (var step = 1; step <= all.length; step++) {
            var i = (p.active + step) % all.length;
            if (all[i].textContent.toLowerCase().indexOf(letter) === 0) { setActive(p, i); break; }
          }
        }
    }
  }

  function open(p) {
    if (!pop) buildPop();
    if (openPicker && openPicker !== p) close(false);
    openPicker = p;
    var searchable = p.options.length > SEARCH_FROM;
    pop.search.hidden = !searchable;
    pop.search.value = "";
    pop.search.placeholder = p.searchHint;
    pop.search.setAttribute("aria-label", "Search " + p.name());
    pop.list.setAttribute("aria-label", p.name());
    pop.hidden = false;
    p.button.setAttribute("aria-expanded", "true");
    fill(p, "");
    place(p);
    (searchable ? pop.search : pop.list).focus({ preventScroll: true });
  }

  function close(refocus) {
    if (!openPicker) return;
    var p = openPicker;
    openPicker = null;
    pop.hidden = true;
    p.button.setAttribute("aria-expanded", "false");
    if (refocus) p.button.focus();
  }

  function choose(p, value) {
    close(true);
    if (String(value) === String(p.value)) return;
    p.setValue(value);
    if (p.onChange) p.onChange(Number(value));
  }

  /**
   * A dropdown with icons. opts:
   *   options   [{value, label, group?, hint?, disabled?}] (shared arrays are fine; they are never changed);
   *             a disabled option is listed, muted, but cannot be chosen
   *   value     the current value (one the list lacks is shown with unknownLabel)
   *   onChange  called with the new value (a number)
   *   kind      "monster" or "item" to draw their icons; anything else draws none
   *   label     the accessible name when no field label is attached
   *   compact   smaller, for table cells
   *   showIds   adds the id as a small muted "#id" on each option
   *   iconOf(value)  the id whose icon a value shows (default the value; the Road builder's Zenith options
   *             are negative ids with the monster's own icon)
   *   idOf(value)    the id "#id" and the title show (default the value)
   *   unknownLabel(value)  the text for a value the list does not hold
   *   disabled
   */
  function picker(opts) {
    var p = {
      options: opts.options || [],
      value: opts.value,
      onChange: opts.onChange,
      showIds: !!opts.showIds,
      searchHint: opts.searchHint || "Type a name",
      active: -1
    };
    p.icon = function (v) { return iconFor(opts.kind, opts.iconOf ? opts.iconOf(v) : v); };
    p.idOf = function (v) { return opts.idOf ? opts.idOf(v) : v; };
    var wrap = el("span", "bui-picker" + (opts.compact ? " is-compact" : ""));
    var btn = el("button", "bui-picker-btn");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    var labelId = uid("bui-value");
    var iconSlot = el("span", "bui-icon-slot");
    var text = el("span", "bui-value");
    text.id = labelId;
    btn.appendChild(iconSlot);
    btn.appendChild(text);
    btn.appendChild(el("span", "bui-caret"));
    wrap.appendChild(btn);
    p.button = btn;
    var labelledBy = null;
    if (opts.label) btn.setAttribute("aria-label", opts.label);

    p.name = function () {
      if (opts.label) return opts.label;
      var lab = labelledBy && doc.getElementById(labelledBy);
      return lab ? lab.textContent : "options";
    };

    function labelFor(v) {
      var found = indexOf(p.options)[String(v)];
      if (found) return found.label;
      return opts.unknownLabel ? opts.unknownLabel(v) : "Unknown (id " + v + ")";
    }

    p.setValue = function (v) {
      p.value = v;
      var shownLabel = labelFor(v);
      text.textContent = shownLabel;
      iconSlot.textContent = "";
      iconSlot.appendChild(iconNode(p.icon(v)));
      btn.title = p.problem || (p.showIds && Number(v) ? shownLabel + " (id " + p.idOf(v) + ")" : shownLabel);
    };

    btn.addEventListener("click", function () {
      if (openPicker === p) close(true); else open(p);
    });
    btn.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(p); }
    });

    var api = {
      el: wrap,
      button: btn,
      get value() { return p.value; },
      setValue: function (v) { if (String(v) !== String(p.value)) p.setValue(v); },
      setOptions: function (options) { p.options = options; p.setValue(p.value); },
      setDisabled: function (off) { btn.disabled = !!off; },
      /** Marks the choice as a problem (text says why, in plain words), or clears it with "". */
      setProblem: function (why) {
        p.problem = why || "";
        wrap.classList.toggle("is-invalid", !!why);
        if (why) btn.setAttribute("aria-invalid", "true"); else btn.removeAttribute("aria-invalid");
        p.setValue(p.value);
      },
      labelWith: function (id) {
        labelledBy = id;
        btn.removeAttribute("aria-label");
        btn.setAttribute("aria-labelledby", id + " " + labelId);
      }
    };
    if (opts.disabled) btn.disabled = true;
    p.setValue(p.value);
    return api;
  }

  /**
   * A table with headers and rows of cells (each a node, or {label, cls, node, ref}); an empty table says so in
   * one row. A cell's ref (see bytesText) puts the bytes label on the cell (shown above it on a phone) and,
   * from the first row, under the column's header.
   */
  function table(headers, rows, emptyText, cls) {
    var wrap = el("div", "table-wrap bui-table-wrap");
    var t = el("table", "data-table bui-table" + (cls ? " " + cls : ""));
    // An editable table must not be re-ordered by the site's table sorter: a sorted row would sit next to
    // the wrong label while its inputs stayed bound to the record they were built from.
    t.setAttribute("data-nosort", "");
    var head = el("thead");
    var tr = el("tr");
    headers.forEach(function (h, i) {
      var th = el("th", h && h.cls, h && h.label !== undefined ? h.label : h);
      var first = rows.length ? rows[0][i] : null;
      var ref = (h && h.ref) || (first && first.ref);
      var mark = ref && unsureNode(ref);
      if (mark) { th.appendChild(doc.createTextNode(" ")); th.appendChild(mark); }
      var bytes = ref && bytesNode(ref);
      if (bytes) th.appendChild(bytes);
      tr.appendChild(th);
    });
    head.appendChild(tr);
    t.appendChild(head);
    var body = el("tbody");
    if (!rows.length && emptyText) {
      var empty = el("tr");
      var td = el("td", "empty-cell", emptyText);
      td.colSpan = headers.length;
      empty.appendChild(td);
      body.appendChild(empty);
    }
    rows.forEach(function (cells) {
      var row = el("tr");
      cells.forEach(function (cell) {
        var td = el("td", cell && cell.cls);
        if (cell && cell.label) td.setAttribute("data-label", cell.label + (cell.ref && unsure(cell.ref) ? " (unconfirmed)" : ""));
        if (cell && cell.ref && bytesText(cell.ref)) {
          td.setAttribute("data-bytes", bytesText(cell.ref));
          td.setAttribute("data-fields", cell.ref.fields.map(function (f) { return f.key; }).join(" "));
        }
        var node = cell && cell.node !== undefined ? cell.node : cell;
        if (node && node.el) node = node.el;
        if (node instanceof root.Node) td.appendChild(node); else if (node !== null && node !== undefined) td.textContent = String(node);
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }

  shared.loadIcons = loadIcons;
  shared.el = el;
  shared.note = note;
  shared.section = section;
  shared.subhead = subhead;
  shared.field = field;
  shared.button = button;
  shared.numberInput = numberInput;
  shared.numberField = numberField;
  shared.picker = picker;
  shared.table = table;
  root.BuilderUI = shared;
})(typeof window !== "undefined" ? window : this);
