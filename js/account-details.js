/* Account page, Details tab: everything the API decodes about one character, from
   GET /api/account/characters/{id}/details (API README "Character details"), in four sections:
   Equipment (what is worn), Loadouts (the in-game equipment My Sets), Boxes (the equipment box, and
   the item box, pouch and warehouse counts) and Stats (ranks, money, playtime, guild, hunts, coins).

   The account's own characters are in the picker; the Characters tab's "Details" links open one here.
   An admin also gets a box to open any character by id (the API allows admins any character).
   Until the API has the endpoint (404 for one of the account's own characters) the tab says details are
   coming soon. The helpers at the top also run under node (dev/check-account-details.js). */
(function (root) {
  "use strict";

  var SLOT_LABELS = { weapon: "Weapon", head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var KIND_LABELS = { melee: "Melee weapon", ranged: "Ranged weapon", armour: "Armour" };
  var SECTIONS = ["equipment", "loadouts", "boxes", "stats"];

  function number(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString("en-GB");
  }

  /* A piece's name, or what it is and its id when the name tables don't know it. */
  function pieceName(piece) {
    if (!piece) return "Empty";
    if (piece.name) return piece.name;
    var what = piece.kind === "armour" ? (SLOT_LABELS[piece.slot] || "Armour") + " piece" : KIND_LABELS[piece.kind] || "Equipment";
    return what + " #" + piece.id;
  }

  /* The line under a piece's name: its kind and, for armour, its level. Weapon levels are not decoded. */
  function pieceMeta(piece) {
    if (!piece) return "";
    var parts = [piece.kind === "armour" ? SLOT_LABELS[piece.slot] || "Armour" : KIND_LABELS[piece.kind] || ""];
    if (piece.level) parts.push("Lv " + piece.level);
    parts.push("id " + piece.id);
    return parts.filter(Boolean).join(" · ");
  }

  function itemName(item) {
    return item ? item.name || "Item #" + item.id : "";
  }

  /* Seconds played as "1,307 h 40 min". */
  function playtime(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var hours = Math.floor(s / 3600);
    var minutes = Math.floor((s % 3600) / 60);
    return number(hours) + " h " + minutes + " min";
  }

  function hunterCardUrl(id) {
    return "/hunters.html?id=" + encodeURIComponent(id);
  }

  /* The equipment box grouped for its filter chips: all, weapons, then each armour slot. */
  function boxFilter(pieces, filter) {
    return (pieces || []).filter(function (piece) {
      if (!filter || filter === "all") return true;
      if (filter === "weapon") return piece.slot === "weapon";
      return piece.slot === filter;
    });
  }

  /* One line per decoration or sigil, as "name (id)" text for search. */
  function searchText(piece) {
    return [pieceName(piece), piece.id, (piece.decorations || []).map(itemName).join(" ")].join(" ").toLowerCase();
  }

  var Helpers = { pieceName: pieceName, pieceMeta: pieceMeta, itemName: itemName, playtime: playtime,
    hunterCardUrl: hunterCardUrl, boxFilter: boxFilter, searchText: searchText, number: number };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Helpers;
    return;
  }
  root.HvCharDetails = Helpers;

  /* ---------- the tab ---------- */

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("details-live");
  if (!panel) return;

  var select = $("details-character");
  var note = $("details-note");
  var alertBox = $("details-alert");
  var soon = $("details-soon");
  var body = $("details-body");
  var adminInput = $("details-admin-id");
  var adminForm = $("details-admin-form");
  var cardLink = $("details-card-link");

  var state = { characters: [], section: "equipment", data: null, boxFilter: "all", boxQuery: "", loading: 0,
    ready: false, requested: null };

  function request(path) {
    var token = window.localStorage.getItem(TOKEN_KEY);
    return fetch(API + path, { headers: { Authorization: "Bearer " + token } }).then(function (response) {
      if (!response.ok) {
        var error = new Error("HTTP " + response.status);
        error.status = response.status;
        throw error;
      }
      return response.json();
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function showAlert(text) {
    alertBox.textContent = text;
    alertBox.hidden = !text;
  }

  function itemNode(item) {
    var span = el("span", "detail-item");
    if (item.icon) {
      var img = el("img", "detail-item-icon");
      img.src = "/assets/items/" + item.icon + ".webp";
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () { img.remove(); };
      span.appendChild(img);
    }
    span.appendChild(el("span", null, itemName(item)));
    return span;
  }

  function decorationList(items, emptyText) {
    var list = el("ul", "detail-decos");
    if (!items || !items.length) {
      list.appendChild(el("li", "detail-empty", emptyText || "No decorations"));
      return list;
    }
    items.forEach(function (item) {
      var li = el("li");
      li.appendChild(itemNode(item));
      list.appendChild(li);
    });
    return list;
  }

  /* One piece as a card: slot, name, kind/level/id, decorations. */
  function pieceCard(slot, piece, decorations, extra) {
    var card = el("article", "detail-piece" + (piece ? "" : " is-empty"));
    card.appendChild(el("span", "detail-slot", SLOT_LABELS[slot] || slot));
    card.appendChild(el("h4", "detail-name", pieceName(piece)));
    var meta = pieceMeta(piece);
    if (extra) meta = meta ? meta + " · " + extra : extra;
    if (meta) card.appendChild(el("p", "detail-meta", meta));
    card.appendChild(decorationList(decorations, piece ? "No decorations" : ""));
    return card;
  }

  /* ---------- sections ---------- */

  function renderEquipment(data, into) {
    var section = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Equipment worn"));
    head.appendChild(el("span", "panel-note", data.stats && data.stats.weaponType ? data.stats.weaponType : ""));
    section.appendChild(head);
    if (!data.hasSave) {
      section.appendChild(el("p", "note-text", "This character has no save yet: log in with it once."));
      into.appendChild(section);
      return;
    }
    var grid = el("div", "detail-grid");
    var bySlot = {};
    (data.equipment || []).forEach(function (piece) { bySlot[piece.slot] = piece; });
    ["weapon", "head", "chest", "arms", "waist", "legs"].forEach(function (slot) {
      var piece = bySlot[slot] || null;
      grid.appendChild(pieceCard(slot, piece, piece ? piece.decorations : []));
    });
    section.appendChild(grid);
    section.appendChild(el("p", "note-text",
      "Decorations include sigils. Weapon level, sharpness and skills are not read from the save yet."));
    into.appendChild(section);
  }

  function renderLoadouts(data, into) {
    var section = el("section", "panel");
    var head = el("div", "panel-head");
    var sets = (data.loadouts && data.loadouts.sets) || [];
    head.appendChild(el("h2", null, "My Sets"));
    head.appendChild(el("span", "panel-note", sets.length + (sets.length === 1 ? " set" : " sets")));
    section.appendChild(head);
    if (data.loadouts && data.loadouts.notDecoded) {
      section.appendChild(el("p", "note-text", "These sets were saved by an older game client (" +
        data.loadouts.notDecoded + "), which the site can't read yet."));
    } else if (!sets.length) {
      section.appendChild(el("p", "note-text", "No equipment My Sets saved. Save one in game from the equipment box."));
    }
    sets.forEach(function (set) {
      var details = el("details", "detail-set");
      var summary = el("summary");
      summary.appendChild(el("span", "detail-set-number", "Set " + set.number));
      summary.appendChild(el("span", "detail-set-name", set.name));
      var weapon = (set.slots || []).filter(function (slot) { return slot.slot === "weapon"; })[0];
      if (weapon) summary.appendChild(el("span", "detail-set-weapon", pieceName(weapon.piece)));
      details.appendChild(summary);
      var grid = el("div", "detail-grid");
      (set.slots || []).forEach(function (slot) {
        var extra = slot.boxIndex !== null && slot.boxIndex !== undefined ? "box slot " + (slot.boxIndex + 1) : "";
        var card = pieceCard(slot.slot, slot.piece, slot.decorations, extra);
        if (!slot.piece && slot.boxIndex !== null && slot.boxIndex !== undefined) {
          card.querySelector(".detail-name").textContent = "No longer in the box";
        }
        grid.appendChild(card);
      });
      details.appendChild(grid);
      if (set.cuffs && set.cuffs.length) {
        var cuffs = el("div", "detail-cuffs");
        cuffs.appendChild(el("span", "detail-slot", "Cuffs"));
        cuffs.appendChild(decorationList(set.cuffs));
        details.appendChild(cuffs);
      }
      section.appendChild(details);
    });
    into.appendChild(section);
  }

  function renderBoxRows(tbody, pieces) {
    clear(tbody);
    var shown = boxFilter(pieces, state.boxFilter).filter(function (piece) {
      return !state.boxQuery || searchText(piece).indexOf(state.boxQuery) !== -1;
    });
    if (!shown.length) {
      var row = el("tr");
      var cell = el("td", "empty-cell", "Nothing here.");
      cell.colSpan = 5;
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    shown.forEach(function (piece) {
      var row = el("tr");
      row.appendChild(el("td", null, number(piece.boxIndex + 1)));
      row.appendChild(el("td", null, piece.kind === "armour" ? SLOT_LABELS[piece.slot] : KIND_LABELS[piece.kind]));
      var name = el("td", "cell-name");
      name.appendChild(el("span", null, pieceName(piece)));
      row.appendChild(name);
      row.appendChild(el("td", null, piece.level ? "Lv " + piece.level : "-"));
      var decos = el("td");
      decos.textContent = (piece.decorations || []).map(itemName).join(", ") || "-";
      row.appendChild(decos);
      tbody.appendChild(row);
    });
    return shown.length;
  }

  function renderBoxes(data, into) {
    var boxes = data.boxes || {};
    var counts = el("div", "stat-grid");
    [["Item box", boxes.itemBox], ["Pouch", boxes.pouch], ["Warehouse (account)", boxes.warehouse]].forEach(function (pair) {
      var card = el("div", "stat-card");
      card.appendChild(el("span", "stat-label", pair[0]));
      var c = pair[1] || { stacks: 0, quantity: 0 };
      card.appendChild(el("span", "stat-value", number(c.stacks) + " stacks"));
      card.appendChild(el("span", "stat-sub", number(c.quantity) + " items"));
      counts.appendChild(card);
    });
    into.appendChild(counts);

    var eq = boxes.equipmentBox || { used: 0, capacity: 0, pieces: [] };
    var section = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Equipment box"));
    head.appendChild(el("span", "panel-note", number(eq.used) + " / " + number(eq.capacity)));
    section.appendChild(head);
    section.appendChild(el("p", "note-text", "Every item stack is on the Storage tab."));

    var chips = el("div", "chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Show");
    var tbody = el("tbody");
    var resultNote = el("span", "toolbar-note");
    function refresh() { resultNote.textContent = renderBoxRows(tbody, eq.pieces) + " shown"; }
    [["all", "All"], ["weapon", "Weapons"], ["head", "Head"], ["chest", "Chest"], ["arms", "Arms"], ["waist", "Waist"], ["legs", "Legs"]]
      .forEach(function (pair) {
        var button = el("button", "chip", pair[1]);
        button.type = "button";
        button.dataset.filter = pair[0];
        button.setAttribute("aria-pressed", state.boxFilter === pair[0] ? "true" : "false");
        button.addEventListener("click", function () {
          state.boxFilter = pair[0];
          Array.prototype.forEach.call(chips.children, function (chip) {
            chip.setAttribute("aria-pressed", chip === button ? "true" : "false");
          });
          refresh();
        });
        chips.appendChild(button);
      });
    section.appendChild(chips);

    var toolbar = el("div", "toolbar");
    var label = el("label", "search");
    label.appendChild(el("span", "search-label", "Search"));
    var input = el("input");
    input.type = "search";
    input.id = "details-box-search";
    input.placeholder = "Name, id or decoration";
    input.autocomplete = "off";
    input.value = state.boxQuery;
    input.addEventListener("input", function () {
      state.boxQuery = input.value.trim().toLowerCase();
      refresh();
    });
    label.appendChild(input);
    toolbar.appendChild(label);
    toolbar.appendChild(resultNote);
    section.appendChild(toolbar);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table detail-box-table");
    var thead = el("thead");
    var hr = el("tr");
    ["Slot", "Type", "Name", "Level", "Decorations"].forEach(function (text) { hr.appendChild(el("th", null, text)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    refresh();
    into.appendChild(section);
  }

  function renderStats(data, into) {
    var s = data.stats || {};
    var grid = el("div", "stat-grid");
    [["HR", number(s.hr)], ["GR", number(s.gr)], ["Weapon", s.weaponType || "-"], ["Playtime", playtime(s.playtimeSeconds)],
     ["Zenny", number(s.zenny)], ["G zenny", number(s.gzenny)], ["CP", number(s.cp)], ["Monsters hunted", number(s.huntsLifetime)]]
      .forEach(function (pair) {
        var card = el("div", "stat-card");
        card.appendChild(el("span", "stat-label", pair[0]));
        card.appendChild(el("span", "stat-value", pair[1]));
        grid.appendChild(card);
      });
    into.appendChild(grid);

    var section = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, "Character"));
    section.appendChild(head);
    var dl = el("dl", "detail-list");
    var guild = s.guild ? s.guild.name + " (" + s.guild.rank + ")" : "No guild";
    var coins = s.coins || {};
    [["Name", data.name],
     ["Sex", s.female ? "Female" : "Male"],
     ["Last login", s.lastLogin ? new Date(s.lastLogin).toLocaleString() : "-"],
     ["Guild", guild],
     ["GCP", number(s.gcp)],
     ["Road points", number(s.kouryouPoints)],
     ["Premium gacha coins (account)", number(coins.gachaPremium)],
     ["Trial gacha coins (account)", number(coins.gachaTrial)],
     ["Frontier points (account)", number(coins.frontierPoints)]].forEach(function (pair) {
      dl.appendChild(el("dt", null, pair[0]));
      dl.appendChild(el("dd", null, pair[1]));
    });
    section.appendChild(dl);
    var more = el("p", "note-text");
    more.appendChild(document.createTextNode("Hunting Road, Sky Corridor and hunt records are on the "));
    var a = el("a", null, "hunter card");
    a.href = hunterCardUrl(data.characterId);
    more.appendChild(a);
    more.appendChild(document.createTextNode(" and the Hunts tab."));
    section.appendChild(more);
    into.appendChild(section);
  }

  function render() {
    clear(body);
    var data = state.data;
    if (!data) return;
    var section = state.section;
    Array.prototype.forEach.call(document.querySelectorAll("#details-sections .chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.dataset.section === section ? "true" : "false");
    });
    if (section === "loadouts") renderLoadouts(data, body);
    else if (section === "boxes") renderBoxes(data, body);
    else if (section === "stats") renderStats(data, body);
    else renderEquipment(data, body);
  }

  function load(id) {
    if (!id) return;
    var ticket = ++state.loading;
    showAlert("");
    soon.hidden = true;
    note.textContent = "loading";
    clear(body);
    state.data = null;
    var known = state.characters.filter(function (c) { return String(c.id) === String(id); })[0];
    cardLink.hidden = false;
    cardLink.href = hunterCardUrl(id);
    request("/api/account/characters/" + encodeURIComponent(id) + "/details").then(function (data) {
      if (ticket !== state.loading) return;
      state.data = data;
      note.textContent = data.name + (data.ownCharacter ? "" : " (another account: admin view)");
      document.getElementById("details-sections").hidden = false;
      render();
    }).catch(function (error) {
      if (ticket !== state.loading) return;
      note.textContent = "";
      document.getElementById("details-sections").hidden = true;
      if (error.status === 404 && known) {
        soon.hidden = false; // own character but no endpoint: an API without it
      } else if (error.status === 404) {
        showAlert("No character with id " + id + ", or not one you can see.");
      } else if (error.status === 401) {
        showAlert("Your sign-in ran out. Sign in again to see character details.");
      } else {
        showAlert("Could not read that character's details. Try again in a moment.");
      }
    });
  }

  /* Open a character's details: pick it, show the tab (account.js shows #details), load. */
  function open(id) {
    state.requested = String(id);
    if (!state.ready) return; // start() opens it once the character list is in
    if (state.characters.some(function (c) { return String(c.id) === String(id); })) select.value = String(id);
    load(id);
  }

  /* The tab loads nothing until it is shown: most visits to the account page never open it. */
  function shown() {
    var tabPanel = $("panel-details");
    return window.location.hash === "#details" || (tabPanel && !tabPanel.hidden);
  }

  function openWhenShown() {
    if (!state.ready || state.data || state.loading || !state.characters.length) return;
    if (shown()) open(state.requested || state.characters[0].id);
  }
  root.HvCharDetails.open = open;

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("#details-sections .chip"), function (chip) {
      chip.addEventListener("click", function () {
        state.section = chip.dataset.section;
        render();
      });
    });
    select.addEventListener("change", function () { load(select.value); });
    if (adminForm) {
      adminForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var id = String(adminInput.value || "").trim();
        if (/^\d+$/.test(id)) open(id);
        else showAlert("A character id is a number.");
      });
    }
    // "Details" links in the Characters tab: <a href="#details" data-details-id="10">
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("[data-details-id]") : null;
      if (!link) return;
      open(link.getAttribute("data-details-id"));
    });
    window.addEventListener("hashchange", function () { setTimeout(openWhenShown, 0); });
    var tabLink = $("tab-details");
    if (tabLink) tabLink.addEventListener("click", function () { setTimeout(openWhenShown, 0); });
  }

  function start() {
    if (!window.localStorage.getItem(TOKEN_KEY)) return;
    wire();
    Promise.all([request("/api/account/characters"), request("/api/account").catch(function () { return null; })])
      .then(function (results) {
        state.characters = results[0] || [];
        var account = results[1];
        clear(select);
        state.characters.forEach(function (c) {
          var option = el("option", null, (c.name || "Unnamed") + " (HR " + number(c.hr) + ")");
          option.value = c.id;
          select.appendChild(option);
        });
        if (account && (account.roles || []).indexOf("ROLE_ADMIN") !== -1 && adminForm) adminForm.hidden = false;
        state.ready = true;
        if (!state.characters.length) {
          note.textContent = "no characters";
          return;
        }
        if (state.requested) open(state.requested);
        else openWhenShown();
      })
      .catch(function () {
        note.textContent = "";
        showAlert("Could not load your characters.");
      });
  }

  start();
})(typeof window !== "undefined" ? window : this);
