/* Account page, Characters tab: the character view. One character at a time (the picker, a "View" link in
   the list above, or an admin's character id), in seven sections:

   Overview       ranks, playtime, money, stamps, guild, coins, house, the hunter card link
   Equipment      what is worn: six slots, armour levels, decorations and sigils
   Loadouts       the in-game equipment My Sets
   Item box       the 6,000-slot box as in game (pages of 100) or as a list, with search
   Pouch          the 40 pouch slots
   Warehouse      the account's shared warehouse
   Equipment box  every piece in the box, with slot chips and search

   Equipment, Loadouts, the Equipment box and most of the Overview come from
   GET /api/account/characters/{id}/details (API README "Character details"; the account's own characters,
   admins any); the item box, pouch, warehouse, stamps and house from GET /api/account/characters/{id}/storage
   (own characters only). Both load when the Characters tab is first shown, and each part of the view says
   so when its answer is missing (an API without /details: "coming soon"; another account's character:
   no item lists). Every item and piece has its icon (js/game-icons.js).

   Old links to the former Storage (#storage) and Details (#details) tabs land here (js/account.js).
   The helpers at the top also run under node (dev/check-account-details.js). */
(function (root) {
  "use strict";

  var SLOT_LABELS = { weapon: "Weapon", head: "Head", chest: "Chest", arms: "Arms", waist: "Waist", legs: "Legs" };
  var KIND_LABELS = { melee: "Melee weapon", ranged: "Ranged weapon", armour: "Armour" };
  var SECTIONS = ["overview", "equipment", "loadouts", "itembox", "pouch", "warehouse", "equipbox"];
  var STORAGE_SECTIONS = ["itembox", "pouch", "warehouse"];
  var DETAILS_SECTIONS = ["equipment", "loadouts", "equipbox"];

  function number(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString("en-GB");
  }

  // Stored HR as the game shows it: "HR100 (HR4)" (js/hr.js); the plain number when hr.js is missing.
  function hrText(value) {
    return typeof window !== "undefined" && window.HvHr && window.HvHr.label(value) || number(value);
  }

  /* A piece's name, or what it is and its id when the name tables don't know it. */
  function pieceName(piece) {
    if (!piece) return "Empty";
    if (piece.name) return piece.name;
    var what = piece.kind === "armour" ? (SLOT_LABELS[piece.slot] || "Armour") + " piece" : KIND_LABELS[piece.kind] || "Equipment";
    return what + " #" + piece.id;
  }

  /* What a piece is: its weapon class when known (look: HvGameIcons.equipmentLook), else melee/ranged,
     or its armour slot. */
  function pieceType(piece, look) {
    if (!piece) return "";
    if (piece.kind === "armour") return SLOT_LABELS[piece.slot] || "Armour";
    return (look && look.weaponClass) || KIND_LABELS[piece.kind] || "";
  }

  /* The line under a piece's name: its type, rarity, armour level and id. Weapon levels are not decoded. */
  function pieceMeta(piece, look) {
    if (!piece) return "";
    var parts = [pieceType(piece, look)];
    if (look && look.rarity !== null && look.rarity !== undefined) parts.push("Rare " + (look.rarity + 1));
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

  /* The equipment box for its filter chips: all, weapons, then each armour slot. */
  function boxFilter(pieces, filter) {
    return (pieces || []).filter(function (piece) {
      if (!filter || filter === "all") return true;
      return piece.slot === filter;
    });
  }

  /* A piece as lower-case text for the search: name, type, id and decorations. */
  function searchText(piece, look) {
    return [pieceName(piece), pieceType(piece, look), piece.id, (piece.decorations || []).map(itemName).join(" ")]
      .join(" ").toLowerCase();
  }

  /* Items (box, pouch, warehouse) matching a search: by name, or by id when the search is a number. */
  function itemMatches(items, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return items || [];
    var asId = /^\d+$/.test(q) ? Number(q) : null;
    return (items || []).filter(function (item) {
      return (asId !== null && item.id === asId) || itemName(item).toLowerCase().indexOf(q) !== -1;
    });
  }

  /* The section an address opens: #storage (the old Storage tab) the item box, anything else the overview. */
  function sectionForHash(hash) {
    return String(hash || "").replace(/^#/, "") === "storage" ? "itembox" : "overview";
  }

  var Helpers = { SECTIONS: SECTIONS, pieceName: pieceName, pieceType: pieceType, pieceMeta: pieceMeta,
    itemName: itemName, playtime: playtime, hunterCardUrl: hunterCardUrl, boxFilter: boxFilter,
    searchText: searchText, itemMatches: itemMatches, sectionForHash: sectionForHash, number: number };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Helpers;
    return;
  }
  root.HvCharDetails = Helpers;

  /* ---------- the view ---------- */

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var Icons = root.HvGameIcons;
  var $ = function (id) { return document.getElementById(id); };
  var panel = $("details-live");
  if (!panel) return;

  var select = $("details-character");
  var note = $("details-note");
  var alertBox = $("details-alert");
  var sectionsBar = $("details-sections");
  var body = $("details-body");
  var adminInput = $("details-admin-id");
  var adminForm = $("details-admin-form");
  var cardLink = $("details-card-link");

  /* The item box: 6,000 slots, 60 pages of 100 (measured from live saves on 2026-10-27). The grid shows at
     least 10 pages, more when an item sits further on. */
  var BOX_SIZE = 100;
  var BOX_MIN_PAGES = 10;
  var BOX_MAX_PAGES = 60;
  var POUCH_SIZE = 40;

  var state = {
    characters: [], section: sectionForHash(window.location.hash), loading: 0, ready: false, requested: null,
    id: null, own: false, details: null, detailsStatus: null, storage: null, storageStatus: null, icons: null,
    boxFilter: "all", boxQuery: "", queries: { itembox: "", pouch: "", warehouse: "" },
    // a phone gets the list: 10 slots across are too small to read there
    boxView: window.matchMedia && window.matchMedia("(max-width: 560px)").matches ? "list" : "grid",
    boxPage: 0, boxSelected: null
  };

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

  // The last login as a <time> in the viewer's zone (the old local text without js/time.js).
  function lastLoginValue(value) {
    if (window.HvTime && !isNaN(new Date(value).getTime())) return HvTime.node(value);
    return new Date(value).toLocaleString();
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

  function sectionPanel(title, noteText) {
    var section = el("section", "panel");
    var head = el("div", "panel-head");
    head.appendChild(el("h2", null, title));
    if (noteText) head.appendChild(el("span", "panel-note", noteText));
    section.appendChild(head);
    return section;
  }

  function look(piece) {
    return Icons.equipmentLook(state.icons, piece);
  }

  /* An item as icon + name, for decorations, sigils and cuffs. */
  function itemNode(item) {
    var span = el("span", "detail-item");
    span.appendChild(Icons.itemIcon(item, "gi-small"));
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

  /* One piece as a card: icon, slot, name, type/rarity/level/id, decorations. */
  function pieceCard(slot, piece, decorations, extra) {
    var card = el("article", "detail-piece" + (piece ? "" : " is-empty"));
    var head = el("div", "detail-piece-head");
    head.appendChild(piece ? Icons.equipmentIcon(state.icons, piece, "gi-piece") : el("span", "gi gi-empty")); // an empty frame
    var text = el("div", "detail-piece-text");
    text.appendChild(el("span", "detail-slot", SLOT_LABELS[slot] || slot));
    text.appendChild(el("h4", "detail-name", pieceName(piece)));
    head.appendChild(text);
    card.appendChild(head);
    var meta = pieceMeta(piece, piece ? look(piece) : null);
    if (extra) meta = meta ? meta + " · " + extra : extra;
    if (meta) card.appendChild(el("p", "detail-meta", meta));
    card.appendChild(decorationList(decorations, piece ? "No decorations" : ""));
    return card;
  }

  /* A note in place of a section whose answer is missing. */
  function missing(into, title, text) {
    var section = sectionPanel(title);
    section.appendChild(el("p", "note-text char-missing", text));
    into.appendChild(section);
  }

  function detailsMissingText() {
    if (state.detailsStatus === 404) return "Equipment, My Sets and the equipment box on the website are coming soon.";
    return "Could not read this character's equipment. Try again in a moment.";
  }

  function storageMissingText() {
    if (!state.own) return "The item box, pouch and warehouse lists are shown for your own characters only.";
    return "Could not read this character's item box. Try again in a moment.";
  }

  /* ---------- Overview ---------- */

  function renderOverview(into) {
    var d = state.details;
    var st = state.storage;
    var s = (d && d.stats) || {};
    var listed = state.characters.filter(function (c) { return String(c.id) === String(state.id); })[0] || {};
    var pick = function (a, b) { return a !== undefined && a !== null ? a : b; };
    var grid = el("div", "stat-grid");
    var cards = [["HR", hrText(pick(s.hr, listed.hr))], ["GR", number(pick(s.gr, listed.gr))],
      ["Weapon", s.weaponType || listed.weaponType || "-"]];
    if (d) cards.push(["Playtime", playtime(s.playtimeSeconds)]);
    cards.push(["Zenny", number(pick(s.zenny, st && st.zenny))], ["G zenny", number(pick(s.gzenny, st && st.gzenny))],
      ["CP", number(pick(s.cp, st && st.cp))]);
    if (d) cards.push(["Monsters hunted", number(s.huntsLifetime)]);
    cards.forEach(function (pair) {
      var card = el("div", "stat-card");
      card.appendChild(el("span", "stat-label", pair[0]));
      card.appendChild(el("span", "stat-value", pair[1]));
      grid.appendChild(card);
    });
    into.appendChild(grid);

    var section = sectionPanel("Character");
    var dl = el("dl", "detail-list");
    var guild = s.guild ? s.guild.name + " (" + s.guild.rank + ")" : listed.guildName ? listed.guildName + (listed.guildRank ? " (" + listed.guildRank + ")" : "") : "No guild";
    var coins = s.coins || {};
    var lastLogin = pick(s.lastLogin, listed.lastLogin);
    var rows = [["Name", (d && d.name) || (st && st.name) || listed.name || "-"],
      ["Sex", pick(s.female, listed.female) ? "Female" : "Male"],
      ["Last login", lastLogin ? lastLoginValue(lastLogin) : "-"],
      ["Guild", guild],
      ["GCP", number(pick(s.gcp, listed.gcp))],
      ["Road points", number(pick(s.kouryouPoints, listed.kouryouPoints))]];
    if (st && st.stamps) rows.push(["Stamps", "HL " + number(st.stamps.hlTotal) + " / EX " + number(st.stamps.exTotal)]);
    if (d) {
      rows.push(["Premium gacha coins (account)", number(coins.gachaPremium)],
        ["Trial gacha coins (account)", number(coins.gachaTrial)],
        ["Frontier points (account)", number(coins.frontierPoints)]);
    }
    rows.forEach(function (pair) {
      dl.appendChild(el("dt", null, pair[0]));
      var dd = el("dd");
      if (pair[1] && pair[1].nodeType) dd.appendChild(pair[1]); else dd.textContent = pair[1];
      dl.appendChild(dd);
    });
    section.appendChild(dl);
    if (!d) section.appendChild(el("p", "note-text", detailsMissingText()));
    var more = el("p", "note-text");
    more.appendChild(document.createTextNode("Hunting Road, Sky Corridor and hunt records are on the "));
    var a = el("a", null, "hunter card");
    a.href = hunterCardUrl(state.id);
    more.appendChild(a);
    more.appendChild(document.createTextNode(" and the Hunts tab."));
    section.appendChild(more);
    into.appendChild(section);

    if (st) {
      var house = st.house;
      var houseSection = sectionPanel("House");
      var hl = el("dl", "detail-list");
      (house
        ? [["House state", house.state === null || house.state === undefined ? "not set" : String(house.state)],
           ["Gallery record", house.galleryBytes ? house.galleryBytes + " bytes stored" : "none"],
           ["Bookshelf", house.bookshelfBytes ? house.bookshelfBytes + " bytes stored" : "none"],
           ["Tore record", house.toreBytes ? house.toreBytes + " bytes stored" : "none"],
           ["Garden", house.gardenBytes ? house.gardenBytes + " bytes stored" : "none"]]
        : [["House", "no house data"]]).forEach(function (pair) {
        hl.appendChild(el("dt", null, pair[0]));
        hl.appendChild(el("dd", null, pair[1]));
      });
      houseSection.appendChild(hl);
      into.appendChild(houseSection);
    }
  }

  /* ---------- Equipment and Loadouts ---------- */

  function renderEquipment(into) {
    var data = state.details;
    var section = sectionPanel("Equipment worn", data.stats && data.stats.weaponType ? data.stats.weaponType : "");
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

  function renderLoadouts(into) {
    var data = state.details;
    var sets = (data.loadouts && data.loadouts.sets) || [];
    var section = sectionPanel("My Sets", sets.length + (sets.length === 1 ? " set" : " sets"));
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
      if (weapon) {
        var w = el("span", "detail-set-weapon");
        if (weapon.piece) w.appendChild(Icons.equipmentIcon(state.icons, weapon.piece, "gi-small"));
        w.appendChild(el("span", null, pieceName(weapon.piece)));
        summary.appendChild(w);
      }
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

  /* ---------- Equipment box ---------- */

  function renderEquipRows(tbody, pieces) {
    clear(tbody);
    var shown = boxFilter(pieces, state.boxFilter).filter(function (piece) {
      return !state.boxQuery || searchText(piece, look(piece)).indexOf(state.boxQuery) !== -1;
    });
    if (!shown.length) {
      var row = el("tr");
      var cell = el("td", "empty-cell", "Nothing here.");
      cell.colSpan = 7;
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    shown.forEach(function (piece) {
      var l = look(piece);
      var row = el("tr");
      var iconCell = el("td", "char-icon-cell");
      iconCell.appendChild(Icons.equipmentIcon(state.icons, piece));
      row.appendChild(iconCell);
      row.appendChild(el("td", "num", number(piece.boxIndex + 1)));
      row.appendChild(el("td", null, pieceType(piece, l)));
      row.appendChild(el("td", "cell-name", pieceName(piece)));
      row.appendChild(el("td", null, Icons.rarityLabel(l.rarity) || "-"));
      row.appendChild(el("td", null, piece.level ? "Lv " + piece.level : "-"));
      var decos = el("td", "char-decos-cell");
      if ((piece.decorations || []).length) {
        piece.decorations.forEach(function (item) { decos.appendChild(itemNode(item)); });
      } else {
        decos.textContent = "-";
      }
      row.appendChild(decos);
      tbody.appendChild(row);
    });
    return shown.length;
  }

  function renderEquipBox(into) {
    var boxes = state.details.boxes || {};
    var eq = boxes.equipmentBox || { used: 0, capacity: 0, pieces: [] };
    var section = sectionPanel("Equipment box", number(eq.used) + " / " + number(eq.capacity));

    var chips = el("div", "chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Show");
    var tbody = el("tbody");
    var resultNote = el("span", "toolbar-note");
    function refreshRows() { resultNote.textContent = renderEquipRows(tbody, eq.pieces) + " shown"; }
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
          refreshRows();
        });
        chips.appendChild(button);
      });
    section.appendChild(chips);

    var toolbar = el("div", "toolbar");
    toolbar.appendChild(searchField("details-box-search", "Name, type, id or decoration", state.boxQuery, function (value) {
      state.boxQuery = value;
      refreshRows();
    }));
    toolbar.appendChild(resultNote);
    section.appendChild(toolbar);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table detail-box-table");
    var thead = el("thead");
    var hr = el("tr");
    ["", "Slot", "Type", "Name", "Rarity", "Level", "Decorations"].forEach(function (text) { hr.appendChild(el("th", null, text)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    refreshRows();
    into.appendChild(section);
  }

  /* ---------- Item box, pouch, warehouse ---------- */

  function searchField(id, placeholder, value, onInput) {
    var label = el("label", "search");
    label.appendChild(el("span", "search-label", "Search"));
    var input = el("input");
    input.type = "search";
    input.id = id;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.value = value;
    input.addEventListener("input", function () { onInput(input.value.trim().toLowerCase()); });
    label.appendChild(input);
    return label;
  }

  /* Items as rows: icon, name, count, where. */
  function itemRows(list, items, where) {
    clear(list);
    if (!items.length) {
      list.appendChild(el("li", "char-item-empty", "Nothing here."));
      return;
    }
    items.forEach(function (item) {
      var li = el("li", "char-item");
      li.appendChild(Icons.itemIcon(item));
      var text = el("span", "char-item-text");
      text.appendChild(el("span", "char-item-name", itemName(item)));
      var whereText = where(item);
      if (whereText) text.appendChild(el("span", "char-item-where", whereText));
      li.appendChild(text);
      li.appendChild(el("span", "char-item-qty", "x" + number(item.quantity)));
      list.appendChild(li);
    });
  }

  function stackNote(items) {
    var quantity = items.reduce(function (sum, item) { return sum + (Number(item.quantity) || 0); }, 0);
    return number(items.length) + (items.length === 1 ? " stack" : " stacks") + " · " + number(quantity) + " items";
  }

  /* Pouch and warehouse: a searchable list. */
  function renderItemList(into, key, title, items, where) {
    var section = sectionPanel(title, stackNote(items));
    var list = el("ul", "char-items");
    var resultNote = el("span", "toolbar-note");
    function refreshList() {
      var shown = itemMatches(items, state.queries[key]);
      itemRows(list, shown, where);
      resultNote.textContent = state.queries[key] ? shown.length + " matching" : "";
    }
    var toolbar = el("div", "toolbar");
    toolbar.appendChild(searchField("char-search-" + key, "Item name or id", state.queries[key], function (value) {
      state.queries[key] = value;
      refreshList();
    }));
    toolbar.appendChild(resultNote);
    section.appendChild(toolbar);
    section.appendChild(list);
    refreshList();
    into.appendChild(section);
  }

  function renderPouch(into) {
    renderItemList(into, "pouch", "Pouch", state.storage.pouch || [], function (item) {
      return item.slot !== null && item.slot !== undefined ? "slot " + (item.slot + 1) + " of " + POUCH_SIZE : "";
    });
  }

  function renderWarehouse(into) {
    renderItemList(into, "warehouse", "Warehouse", state.storage.warehouse || [], function () { return ""; });
    var last = into.lastChild;
    last.appendChild(el("p", "note-text", "The warehouse is shared by every character on your account."));
  }

  function boxPages(items) {
    var lastSlot = items.reduce(function (max, item) {
      return item.slot !== null && item.slot !== undefined && item.slot > max ? item.slot : max;
    }, -1);
    return Math.min(BOX_MAX_PAGES, Math.max(BOX_MIN_PAGES, Math.floor(lastSlot / BOX_SIZE) + 1));
  }

  /* The item box: as in game (a page of 100 slots, a preview of the picked slot) or as a list. */
  function renderItemBox(into) {
    var items = state.storage.itemBox || [];
    var bySlot = {};
    items.forEach(function (item) { if (item.slot !== null && item.slot !== undefined) bySlot[item.slot] = item; });
    var pages = boxPages(items);
    var section = sectionPanel("Item box", stackNote(items));

    var toolbar = el("div", "toolbar");
    var resultNote = el("span", "toolbar-note");
    toolbar.appendChild(searchField("char-search-itembox", "Item name or id", state.queries.itembox, function (value) {
      state.queries.itembox = value;
      var matches = itemMatches(items, value);
      if (value && matches.length && matches[0].slot !== null && matches[0].slot !== undefined) {
        state.boxPage = Math.floor(matches[0].slot / BOX_SIZE);
      }
      draw();
    }));
    var views = el("div", "chips char-view-switch");
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "Show the item box as");
    [["grid", "Grid"], ["list", "List"]].forEach(function (pair) {
      var button = el("button", "chip", pair[1]);
      button.type = "button";
      button.dataset.view = pair[0];
      button.addEventListener("click", function () {
        state.boxView = pair[0];
        draw();
      });
      views.appendChild(button);
    });
    toolbar.appendChild(views);
    toolbar.appendChild(resultNote);
    section.appendChild(toolbar);
    var holder = el("div");
    section.appendChild(holder);
    into.appendChild(section);

    function preview(box, item) {
      clear(box);
      if (!item) {
        box.appendChild(el("p", "preview-name", "No item selected"));
        box.appendChild(el("p", "preview-meta", "Pick a slot to see what is in it"));
        return;
      }
      var icon = el("div", "preview-icon");
      icon.appendChild(Icons.itemIcon(item, "gi-large"));
      box.appendChild(icon);
      box.appendChild(el("p", "preview-name", itemName(item)));
      box.appendChild(el("p", "preview-meta", "x" + number(item.quantity) + " · id " + item.id +
        " · page " + (Math.floor(item.slot / BOX_SIZE) + 1) + ", slot " + ((item.slot % BOX_SIZE) + 1)));
    }

    function drawGrid(matches) {
      var query = state.queries.itembox;
      var matched = {};
      matches.forEach(function (item) { matched[item.slot] = true; });
      var mbox = el("div", "mbox");
      var tabs = el("div", "mbox-tabs");
      tabs.setAttribute("role", "group");
      tabs.setAttribute("aria-label", "Item box pages");
      for (var page = 0; page < pages; page++) {
        var button = el("button", "mbox-tab", String(page + 1));
        button.type = "button";
        button.setAttribute("aria-pressed", page === state.boxPage ? "true" : "false");
        var count = 0;
        for (var s = page * BOX_SIZE; s < (page + 1) * BOX_SIZE; s++) if (bySlot[s] && (!query || matched[s])) count++;
        if (count) {
          button.appendChild(el("span", "tab-dot"));
          button.title = count + (count === 1 ? " item" : " items");
        }
        button.addEventListener("click", (function (target) {
          return function () { state.boxPage = target; draw(); };
        })(page));
        tabs.appendChild(button);
      }
      mbox.appendChild(tabs);
      var main = el("div", "mbox-main");
      var grid = el("div", "mbox-grid");
      grid.setAttribute("aria-label", "Item box page " + (state.boxPage + 1));
      var side = el("aside", "mbox-side");
      var box = el("div", "preview");
      box.setAttribute("aria-live", "polite");
      side.appendChild(box);
      for (var i = 0; i < BOX_SIZE; i++) {
        var slot = state.boxPage * BOX_SIZE + i;
        var item = bySlot[slot];
        var cell = el(item ? "button" : "div", "slot" + (item ? " filled" : ""));
        if (item) {
          cell.type = "button";
          cell.title = itemName(item) + " x" + item.quantity;
          cell.setAttribute("aria-label", itemName(item) + ", " + item.quantity);
          if (query) cell.classList.add(matched[slot] ? "match" : "dim");
          if (state.boxSelected === slot) cell.classList.add("sel");
          cell.appendChild(Icons.itemIcon(item, "item-img"));
          cell.appendChild(el("span", "qty", number(item.quantity)));
          cell.addEventListener("click", (function (entry) {
            return function () { state.boxSelected = entry.slot; draw(); };
          })(item));
        }
        grid.appendChild(cell);
      }
      preview(box, bySlot[state.boxSelected]);
      main.appendChild(grid);
      main.appendChild(side);
      mbox.appendChild(main);
      return mbox;
    }

    function draw() {
      var matches = itemMatches(items, state.queries.itembox);
      Array.prototype.forEach.call(views.children, function (chip) {
        chip.setAttribute("aria-pressed", chip.dataset.view === state.boxView ? "true" : "false");
      });
      resultNote.textContent = state.queries.itembox ? matches.length + " matching" : "";
      clear(holder);
      if (state.boxView === "list") {
        var list = el("ul", "char-items");
        itemRows(list, matches, function (item) {
          return item.slot !== null && item.slot !== undefined
            ? "page " + (Math.floor(item.slot / BOX_SIZE) + 1) + ", slot " + ((item.slot % BOX_SIZE) + 1) : "";
        });
        holder.appendChild(list);
      } else {
        holder.appendChild(drawGrid(matches));
      }
    }
    draw();
  }

  /* ---------- the sections ---------- */

  function setCounts() {
    var st = state.storage;
    var eq = state.details && state.details.boxes && state.details.boxes.equipmentBox;
    var counts = {
      itembox: st ? (st.itemBox || []).length : null,
      pouch: st ? (st.pouch || []).length : null,
      warehouse: st ? (st.warehouse || []).length : null,
      equipbox: eq ? eq.used : null
    };
    Array.prototype.forEach.call(sectionsBar.querySelectorAll("[data-count]"), function (span) {
      var value = counts[span.getAttribute("data-count")];
      span.textContent = value === null || value === undefined ? "" : number(value);
    });
  }

  function render() {
    clear(body);
    if (!state.id || (!state.details && !state.storage)) return;
    var section = state.section;
    Array.prototype.forEach.call(sectionsBar.querySelectorAll(".chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.dataset.section === section ? "true" : "false");
    });
    if (DETAILS_SECTIONS.indexOf(section) !== -1 && !state.details) {
      missing(body, { equipment: "Equipment worn", loadouts: "My Sets", equipbox: "Equipment box" }[section], detailsMissingText());
    } else if (STORAGE_SECTIONS.indexOf(section) !== -1 && !state.storage) {
      missing(body, { itembox: "Item box", pouch: "Pouch", warehouse: "Warehouse" }[section], storageMissingText());
    } else if (section === "equipment") renderEquipment(body);
    else if (section === "loadouts") renderLoadouts(body);
    else if (section === "equipbox") renderEquipBox(body);
    else if (section === "itembox") renderItemBox(body);
    else if (section === "pouch") renderPouch(body);
    else if (section === "warehouse") renderWarehouse(body);
    else renderOverview(body);
  }

  function settle(promise) {
    return promise.then(function (value) { return { ok: true, value: value }; },
      function (error) { return { ok: false, status: error.status || 0 }; });
  }

  function load(id) {
    if (!id) return;
    var ticket = ++state.loading;
    var own = state.characters.some(function (c) { return String(c.id) === String(id); });
    showAlert("");
    note.textContent = "loading";
    clear(body);
    sectionsBar.hidden = true;
    state.id = String(id);
    state.own = own;
    state.details = state.storage = null;
    state.detailsStatus = state.storageStatus = null;
    state.boxPage = 0;
    state.boxSelected = null;
    state.queries = { itembox: "", pouch: "", warehouse: "" };
    state.boxQuery = "";
    cardLink.hidden = false;
    cardLink.href = hunterCardUrl(id);
    var path = "/api/account/characters/" + encodeURIComponent(id);
    Promise.all([
      settle(request(path + "/details")),
      // /storage answers for the account's own characters only (an admin's look at another one skips it)
      own ? settle(request(path + "/storage")) : Promise.resolve({ ok: false, status: 404 }),
      Icons.load()
    ]).then(function (results) {
      if (ticket !== state.loading) return;
      var details = results[0];
      var storage = results[1];
      state.icons = results[2];
      state.details = details.ok ? details.value : null;
      state.detailsStatus = details.ok ? 200 : details.status;
      state.storage = storage.ok ? storage.value : null;
      state.storageStatus = storage.ok ? 200 : storage.status;
      note.textContent = "";
      if (details.status === 401 || storage.status === 401) {
        showAlert("Your sign-in ran out. Sign in again to see this character.");
        return;
      }
      if (!own && !details.ok) {
        showAlert(details.status === 404 ? "No character with id " + id + ", or not one you can see."
          : "Could not read that character. Try again in a moment.");
        return;
      }
      if (!details.ok && !storage.ok) {
        // an API without /details (404) still has /storage; both failing is a real failure
        showAlert("Could not read that character. Try again in a moment.");
        return;
      }
      var name = (state.details && state.details.name) || (state.storage && state.storage.name) || "";
      note.textContent = name + (state.details && !state.details.ownCharacter ? " (another account: admin view)" : "");
      sectionsBar.hidden = false;
      setCounts();
      render();
    });
  }

  /* Open a character: pick it in the picker, load it. */
  function open(id) {
    state.requested = String(id);
    if (!state.ready) return; // start() opens it once the character list is in
    if (state.characters.some(function (c) { return String(c.id) === String(id); })) select.value = String(id);
    load(id);
  }

  /* Nothing loads until the Characters tab is shown: most visits to the account page never open it. */
  function shown() {
    var tabPanel = $("panel-characters");
    return tabPanel && !tabPanel.hidden;
  }

  function openWhenShown() {
    if (!state.ready || state.id || !state.characters.length) return;
    if (shown()) open(state.requested || state.characters[0].id);
  }
  root.HvCharDetails.open = open;

  function wire() {
    Array.prototype.forEach.call(sectionsBar.querySelectorAll(".chip"), function (chip) {
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
    // "View" in the character list: <a href="#characters" data-details-id="10">
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("[data-details-id]") : null;
      if (!link) return;
      open(link.getAttribute("data-details-id"));
      setTimeout(function () { panel.scrollIntoView({ block: "start" }); }, 0);
    });
    window.addEventListener("hashchange", function () {
      var hash = window.location.hash.replace("#", "");
      if (hash === "storage" || hash === "details") {
        state.section = sectionForHash(hash);
        if (state.id) render();
      }
      setTimeout(openWhenShown, 0);
    });
    var tabLink = $("tab-characters");
    if (tabLink) tabLink.addEventListener("click", function () { setTimeout(openWhenShown, 0); });
    // a tab opened by keyboard, the "Jump to" select or Back/Forward (js/subtabs.js)
    document.addEventListener("hv:subtab", function () { setTimeout(openWhenShown, 0); });
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
          var option = el("option", null, (c.name || "Unnamed") + " (" + (c.hr ? hrText(c.hr) : "HR 0") + ")");
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
