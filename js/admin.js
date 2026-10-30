/* Admin panel: gifts (Erupe "distributions") and the Hunting Road rotation (end of the file). Lists every gift and creates new ones through the API's
   /api/admin/distributions, which only admin accounts may use (the API checks the role on every
   request; this page only hides itself from others). A new gift is in the game's gift list at once,
   so the form shows a summary and asks again before it creates anything. */
(function () {
  "use strict";

  var API = "https://api.hvmhfz.eclipseforge.xyz";
  var TOKEN_KEY = "hvmhfz.token";
  var options = null;      // gift lists and item types, from the API
  var chosen = [];         // characters picked for the gift: {id, name}

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function $(id) { return document.getElementById(id); }

  function token() {
    try {
      var value = localStorage.getItem(TOKEN_KEY) || "";
      var claims = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > Date.now() + 30000 ? value : "";
    } catch (error) {
      return "";
    }
  }

  function request(path, opts) {
    var o = opts || {};
    var headers = { Authorization: "Bearer " + token() };
    if (o.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: o.method || "GET", headers: headers, body: o.body, cache: "no-store" })
      .then(function (response) {
        if (response.status === 401) throw new Error("signin");
        if (response.status === 403) throw new Error("forbidden");
        if (response.status === 204) return null;
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok) {
            var error = new Error((data && data.message) || "HTTP " + response.status);
            error.server = true;
            throw error;
          }
          return data;
        });
      });
  }

  function alertBox(text) {
    var box = $("admin-alert");
    box.textContent = text || "";
    box.hidden = !text;
  }

  // The catalog lists items by their 4-digit hex id as the game data writes it (low byte first);
  // a gift wants the number. "BF39" -> 0x39BF = 14783.
  function itemNumber(hex) {
    return (parseInt(hex.slice(2, 4), 16) << 8) | parseInt(hex.slice(0, 2), 16);
  }

  function num(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  /* ---------- the list ---------- */

  function who(gift) {
    if (gift.characterId === null || gift.characterId === undefined) return "Everyone";
    return (gift.characterName || "Character") + " (#" + gift.characterId + ")";
  }

  function itemsText(gift) {
    return gift.items.map(function (item) {
      var name = item.itemName || item.itemTypeName + (item.itemId ? " " + item.itemId : "");
      return name + " x" + num(item.quantity);
    }).join(", ") || "none";
  }

  function ends(gift) {
    if (!gift.deadline) return gift.ended ? "Ended" : "No end";
    var date = new Date(gift.deadline).toLocaleString();
    return (gift.ended ? "Ended " : "") + date;
  }

  function renderList(gifts) {
    var body = $("gift-rows");
    clear(body);
    $("gift-count").textContent = gifts.length + (gifts.length === 1 ? " gift" : " gifts");
    if (!gifts.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No gifts yet.");
      cell.colSpan = 8;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    gifts.forEach(function (gift) {
      var row = el("tr", gift.ended ? "is-ended" : null);
      row.appendChild(el("td", "rank", String(gift.id)));
      var name = el("td", "cell-name");
      name.appendChild(el("span", null, gift.eventName));
      if (gift.description) name.appendChild(el("span", "admin-desc", gift.description));
      row.appendChild(name);
      row.appendChild(el("td", null, gift.typeName));
      row.appendChild(el("td", null, who(gift)));
      row.appendChild(el("td", "admin-items-cell", itemsText(gift)));
      var claims = el("td", "num", num(gift.accepted));
      claims.title = num(gift.claimants) + " characters, up to " + gift.timesAcceptable + " each";
      row.appendChild(claims);
      row.appendChild(el("td", null, ends(gift)));
      var action = el("td");
      if (!gift.ended) {
        var end = el("button", "ghost-btn small", "End now");
        end.type = "button";
        end.addEventListener("click", function () { askEnd(gift, end); });
        action.appendChild(end);
      }
      row.appendChild(action);
      body.appendChild(row);
    });
  }

  // Ending takes two clicks on the same button: the first asks, the second ends it.
  function askEnd(gift, button) {
    if (button.getAttribute("data-armed") !== "1") {
      button.setAttribute("data-armed", "1");
      button.textContent = "Click again to end #" + gift.id;
      setTimeout(function () {
        button.removeAttribute("data-armed");
        button.textContent = "End now";
      }, 5000);
      return;
    }
    button.disabled = true;
    request("/api/admin/distributions/" + gift.id + "/end", { method: "POST" })
      .then(loadList)
      .catch(showError);
  }

  function loadList() {
    return request("/api/admin/distributions").then(renderList);
  }

  /* ---------- the form ---------- */

  function fillSelect(select, map, chosen) {
    clear(select);
    Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).forEach(function (key) {
      var option = el("option", null, map[key] + " (" + key + ")");
      option.value = String(key);
      if (key === chosen) option.selected = true;
      select.appendChild(option);
    });
  }

  function needsId(type) {
    return options.itemTypesWithId.indexOf(Number(type)) >= 0;
  }

  function addItemRow(preset) {
    var p = preset || { itemType: 7, quantity: 1 };
    var row = el("div", "admin-item");
    var typeField = el("div", "field");
    typeField.appendChild(el("label", null, "Type"));
    var type = el("select", "item-type");
    fillSelect(type, options.itemTypes, p.itemType);
    typeField.appendChild(type);

    var idField = el("div", "field item-id-field");
    var idLabel = el("label", null, "Item");
    idField.appendChild(idLabel);
    var idInput = el("input", "item-id");
    idInput.type = "search";
    idInput.autocomplete = "off";
    idInput.placeholder = "Search an item, or type its number";
    idField.appendChild(idInput);
    var idNote = el("p", "note-text item-id-note");
    idField.appendChild(idNote);
    var suggest = el("ul", "admin-suggest");
    suggest.hidden = true;
    idField.appendChild(suggest);

    var qtyField = el("div", "field");
    qtyField.appendChild(el("label", null, "Quantity"));
    var qty = el("input", "item-qty");
    qty.type = "number";
    qty.min = "1";
    qty.max = "999999";
    qty.value = String(p.quantity || 1);
    qtyField.appendChild(qty);

    var remove = el("button", "ghost-btn small admin-remove", "Remove");
    remove.type = "button";
    remove.addEventListener("click", function () { row.parentNode.removeChild(row); });

    row.appendChild(typeField);
    row.appendChild(idField);
    row.appendChild(qtyField);
    row.appendChild(remove);
    $("gift-items").appendChild(row);

    function refresh() {
      var t = Number(type.value);
      idField.hidden = !needsId(t);
      idInput.placeholder = t === 7 ? "Search an item, or type its number" : "Its number";
      idLabel.textContent = t === 7 ? "Item" : t === 15 ? "Outfit (1-31)" : "Number";
      if (!needsId(t)) idInput.value = "";
    }
    type.addEventListener("change", function () { idInput.removeAttribute("data-id"); idNote.textContent = ""; refresh(); });
    refresh();

    // Item search for type 7, from the public catalog.
    var timer = null;
    idInput.addEventListener("input", function () {
      idInput.removeAttribute("data-id");
      idNote.textContent = "";
      clearTimeout(timer);
      var q = idInput.value.trim();
      if (Number(type.value) !== 7 || q.length < 2 || /^\d+$/.test(q)) { suggest.hidden = true; return; }
      timer = setTimeout(function () {
        fetch(API + "/api/public/catalog/items?q=" + encodeURIComponent(q) + "&page=0&size=8")
          .then(function (r) { return r.json(); })
          .then(function (page) {
            clear(suggest);
            (page.items || []).forEach(function (item) {
              var li = el("li");
              var pick = el("button", null, item.name + " (" + itemNumber(item.id) + ")");
              pick.type = "button";
              pick.addEventListener("click", function () {
                idInput.value = item.name;
                idInput.setAttribute("data-id", String(itemNumber(item.id)));
                idNote.textContent = "Item " + itemNumber(item.id);
                suggest.hidden = true;
              });
              li.appendChild(pick);
              suggest.appendChild(li);
            });
            suggest.hidden = !suggest.firstChild;
          })
          .catch(function () { suggest.hidden = true; });
      }, 250);
    });
  }

  function itemOf(row) {
    var type = Number(row.querySelector(".item-type").value);
    var idInput = row.querySelector(".item-id");
    var raw = idInput.getAttribute("data-id") || idInput.value.trim();
    var item = { itemType: type, quantity: Number(row.querySelector(".item-qty").value) };
    if (needsId(type)) item.itemId = /^\d+$/.test(raw) ? Number(raw) : null;
    return item;
  }

  function optionalNumber(id) {
    var value = $(id).value.trim();
    return value === "" ? null : Number(value);
  }

  function readForm() {
    var deadline = $("gift-deadline").value;
    return {
      type: Number($("gift-list").value),
      eventName: $("gift-name").value.trim(),
      description: $("gift-description").value.trim(),
      deadline: deadline ? new Date(deadline).toISOString() : null,
      timesAcceptable: Number($("gift-times").value),
      // An API before multiple characters (maxCharacters missing) gets characterId only, never a
      // list it would ignore (which would turn the gift into one for everyone).
      characterId: $("gift-who").value === "chosen" && chosen.length ? chosen[0].id : null,
      characterIds: $("gift-who").value === "chosen" && maxCharacters() > 1 ? chosen.map(function (c) { return c.id; }) : undefined,
      minHr: optionalNumber("gift-minhr"), maxHr: optionalNumber("gift-maxhr"),
      minSr: optionalNumber("gift-minsr"), maxSr: optionalNumber("gift-maxsr"),
      minGr: optionalNumber("gift-mingr"), maxGr: optionalNumber("gift-maxgr"),
      items: Array.prototype.map.call(document.querySelectorAll("#gift-items .admin-item"), itemOf)
    };
  }

  // Problems the page can see before asking the server (the server checks all of them again).
  function problem(gift) {
    if (!gift.eventName) return "Give the gift a name.";
    if ($("gift-who").value === "chosen" && !chosen.length) return "Add at least one character from the search list.";
    if (!gift.items.length) return "Add at least one item.";
    for (var i = 0; i < gift.items.length; i++) {
      var item = gift.items[i];
      if (!(item.quantity >= 1)) return "Item " + (i + 1) + ": quantity must be at least 1.";
      if (needsId(item.itemType) && !item.itemId) return "Item " + (i + 1) + ": pick the item or type its number.";
    }
    return null;
  }

  function summary(gift) {
    var whom = $("gift-who").value !== "chosen" ? "every character"
      : chosen.length === 1 ? "only " + chosen[0].name + " (#" + chosen[0].id + ")"
      : chosen.length + " characters (" + chosen.map(function (c) { return c.name; }).join(", ") + "), one copy each";
    var items = gift.items.map(function (item) {
      return options.itemTypes[item.itemType] + (item.itemId ? " " + item.itemId : "") + " x" + item.quantity;
    }).join(", ");
    return "Create \"" + gift.eventName + "\" in the " + options.lists[gift.type] + " list for " + whom +
      ", claimable " + gift.timesAcceptable + (gift.timesAcceptable === 1 ? " time" : " times") + " each, " +
      (gift.deadline ? "until " + new Date(gift.deadline).toLocaleString() : "with no end") + ". Items: " + items +
      ". It shows in the game at once.";
  }

  var pending = null;

  function maxCharacters() {
    return options && options.maxCharacters ? options.maxCharacters : 1;
  }

  function addCharacter(character) {
    if (chosen.some(function (c) { return c.id === character.id; })) return;
    if (chosen.length >= maxCharacters()) {
      alertBox(maxCharacters() === 1 ? "This API takes one character per gift." : "At most " + maxCharacters() + " characters at once.");
      return;
    }
    alertBox("");
    chosen.push(character);
    renderChosen();
  }

  function renderChosen() {
    var box = $("gift-characters");
    clear(box);
    chosen.forEach(function (c, index) {
      var chip = el("li", "admin-chip");
      chip.appendChild(el("span", null, c.name + " #" + c.id));
      var remove = el("button", null, "\u00d7");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + c.name);
      remove.addEventListener("click", function () { chosen.splice(index, 1); renderChosen(); });
      chip.appendChild(remove);
      box.appendChild(chip);
    });
    $("gift-character-note").textContent = chosen.length
      ? chosen.length + (chosen.length === 1 ? " character" : " characters") + " chosen; each gets their own copy of the gift."
      : "Search, then pick from the list. Each chosen character gets their own copy of the gift.";
  }

  function wireForm() {
    fillSelect($("gift-list"), options.lists, 1);
    addItemRow();
    $("gift-add-item").addEventListener("click", function () { addItemRow(); });
    $("gift-who").addEventListener("change", function () {
      $("gift-character-field").hidden = $("gift-who").value !== "chosen";
    });

    // Character search, from the public hunter list. Each pick is added to the chosen list.
    var timer = null;
    $("gift-character").addEventListener("input", function () {
      clearTimeout(timer);
      var q = $("gift-character").value.trim();
      var list = $("gift-character-list");
      if (q.length < 2) { list.hidden = true; return; }
      timer = setTimeout(function () {
        fetch(API + "/api/public/hunters?q=" + encodeURIComponent(q) + "&sort=name&page=0&size=8")
          .then(function (r) { return r.json(); })
          .then(function (page) {
            clear(list);
            (page.items || []).forEach(function (h) {
              var li = el("li");
              var pick = el("button", null, h.name + " · HR " + h.hr + " GR " + h.gr + " · #" + h.id);
              pick.type = "button";
              pick.addEventListener("click", function () {
                addCharacter({ id: h.id, name: h.name });
                $("gift-character").value = "";
                list.hidden = true;
                $("gift-character").focus();
              });
              li.appendChild(pick);
              list.appendChild(li);
            });
            list.hidden = !list.firstChild;
          })
          .catch(function () { list.hidden = true; });
      }, 250);
    });

    $("gift-form").addEventListener("submit", function (event) {
      event.preventDefault();
      alertBox("");
      var gift = readForm();
      var wrong = problem(gift);
      if (wrong) { alertBox(wrong); return; }
      pending = gift;
      $("gift-summary").textContent = summary(gift);
      $("gift-confirm").hidden = false;
      $("gift-review-row").hidden = true;
      $("gift-create").focus();
    });
    $("gift-back").addEventListener("click", function () {
      pending = null;
      $("gift-confirm").hidden = true;
      $("gift-review-row").hidden = false;
    });
    $("gift-create").addEventListener("click", function () {
      if (!pending) return;
      var button = $("gift-create");
      button.disabled = true;
      request("/api/admin/distributions", { method: "POST", body: JSON.stringify(pending) })
        .then(function (created) {
          alertBox("");
          var ids = created.ids && created.ids.length ? created.ids : [created.id];
          $("gift-summary").textContent = (ids.length === 1 ? "Created gift #" + ids[0] : "Created " + ids.length + " gifts, #" + ids[0] + " to #" + ids[ids.length - 1]) +
            ". " + (ids.length === 1 ? "It is" : "They are") + " in the game's gift list now.";
          $("gift-create").hidden = true;
          $("gift-back").textContent = "New gift";
          pending = null;
          return loadList();
        })
        .catch(showError)
        .finally(function () { button.disabled = false; });
    });
    $("gift-back").addEventListener("click", function () {
      $("gift-create").hidden = false;
      $("gift-back").textContent = "Back to editing";
    });
  }

  function showError(error) {
    if (error.message === "signin") alertBox("Your sign-in has expired. Sign in again on the home page.");
    else if (error.message === "forbidden") alertBox("This account is not an admin.");
    else alertBox(error.server ? error.message : "The API did not answer. Try again in a moment.");
  }


  /* ---------- Hunting Road ---------- */

  var roadOpen = {};   // cycle id -> true while its block is open

  function roadAlert(text, ok) {
    var bad = $("road-alert");
    var good = $("road-ok");
    bad.textContent = ok ? "" : text || "";
    bad.hidden = ok || !text;
    good.textContent = ok ? text : "";
    good.hidden = !ok;
  }

  function roadFail(error) {
    if (error.message === "signin") roadAlert("Your sign-in has expired. Sign in again on the home page.");
    else if (error.message === "forbidden") roadAlert("This account is not an admin.");
    else roadAlert(error.server ? error.message : "The API did not answer. Try again in a moment.");
  }

  function when(value) {
    if (!value) return "-";
    var date = new Date(value);
    return isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
  }

  // <input type="datetime-local"> works in local time without a zone; the API wants an ISO instant.
  function toInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + "T" + two(d.getHours()) + ":" + two(d.getMinutes());
  }

  function fromInput(id) {
    var value = $(id).value;
    return value ? new Date(value).toISOString() : undefined;
  }

  // A button that needs a second click within 5 seconds, like "End now" for gifts.
  function twoClicks(button, label, ask, action) {
    button.addEventListener("click", function () {
      if (button.getAttribute("data-armed") !== "1") {
        button.setAttribute("data-armed", "1");
        button.textContent = ask;
        setTimeout(function () {
          button.removeAttribute("data-armed");
          button.textContent = label;
        }, 5000);
        return;
      }
      button.disabled = true;
      action();
    });
  }

  function roadAction(path, body, done) {
    roadAlert("");
    return request(path, { method: "POST", body: JSON.stringify(body || {}) })
      .then(function () { roadAlert(done, true); return loadRoad(); })
      .catch(function (error) { roadFail(error); return loadRoad().catch(function () {}); });
  }

  function lower(value) { return String(value || "").toLowerCase(); }

  function entryActions(entry, reason) {
    var cell = el("td");
    var status = lower(entry.status);
    function add(label, path, done) {
      var button = el("button", "ghost-btn small", label);
      button.type = "button";
      button.addEventListener("click", function () {
        button.disabled = true;
        roadAction("/api/admin/road/entries/" + entry.id + "/" + path, { reason: reason.value.trim() }, done);
      });
      cell.appendChild(button);
      cell.appendChild(document.createTextNode(" "));
    }
    if (status === "hidden") add("Unhide", "unhide", "Entry #" + entry.id + " is visible again.");
    else if (status !== "disqualified") add("Hide", "hide", "Entry #" + entry.id + " is hidden.");
    if (status !== "disqualified") add("Disqualify", "disqualify", "Entry #" + entry.id + " is disqualified.");
    return cell;
  }

  function winnerOf(cycle) {
    var id = cycle.winnerId !== undefined ? cycle.winnerId : cycle.winnerEntryId;
    return id === undefined ? null : id;
  }

  function renderCycle(cycle) {
    var details = el("details", "road-cycle");
    details.open = !!roadOpen[cycle.id];
    details.addEventListener("toggle", function () { roadOpen[cycle.id] = details.open; });
    var summary = el("summary", null, "Rotation " + cycle.number + " (#" + cycle.id + ")");
    summary.appendChild(el("span", "muted", cycle.state + " · " + (cycle.entries || []).length + " entries"));
    details.appendChild(summary);
    var body = el("div", "road-cycle-body");
    details.appendChild(body);

    var dates = el("div", "road-cycle-dates");
    [["Submissions open", "submitOpens"], ["Submissions close", "submitCloses"], ["Voting closes", "voteCloses"]].forEach(function (pair) {
      var field = el("div", "field");
      var label = el("label", null, pair[0]);
      var input = el("input");
      input.type = "datetime-local";
      input.id = "road-date-" + cycle.id + "-" + pair[1];
      label.htmlFor = input.id;
      input.value = toInput(cycle[pair[1]]);
      field.appendChild(label);
      field.appendChild(input);
      dates.appendChild(field);
    });
    body.appendChild(dates);
    body.appendChild(el("p", "note-text", "Goes live: " + when(cycle.liveFrom || cycle.voteCloses) +
      (cycle.deployedAt ? " · deployed " + when(cycle.deployedAt) : "") +
      (winnerOf(cycle) !== null ? " · winner: entry #" + winnerOf(cycle) : "")));

    var actions = el("div", "admin-actions");
    var save = el("button", "ghost-btn small", "Save dates");
    save.type = "button";
    save.addEventListener("click", function () {
      save.disabled = true;
      roadAlert("");
      var payload = {
        submitOpens: fromInput("road-date-" + cycle.id + "-submitOpens"),
        submitCloses: fromInput("road-date-" + cycle.id + "-submitCloses"),
        voteCloses: fromInput("road-date-" + cycle.id + "-voteCloses")
      };
      request("/api/admin/road/cycles/" + cycle.id, { method: "PUT", body: JSON.stringify(payload) })
        .then(function () { roadAlert("Dates of rotation " + cycle.number + " saved.", true); return loadRoad(); })
        .catch(function (error) { roadFail(error); save.disabled = false; });
    });
    actions.appendChild(save);
    var state = lower(cycle.state);
    if (state === "submitting" || state === "voting") {
      var close = el("button", "ghost-btn small", "Close the vote now");
      close.type = "button";
      twoClicks(close, "Close the vote now", "Click again: close and pick the winner", function () {
        roadAction("/api/admin/road/cycles/" + cycle.id + "/close", {}, "Rotation " + cycle.number + " is closed.");
      });
      actions.appendChild(close);
    }
    if (state === "closed") {
      var approve = el("button", "btn btn-primary btn-small", "Approve the winner");
      approve.type = "button";
      twoClicks(approve, "Approve the winner", "Click again to approve", function () {
        roadAction("/api/admin/road/cycles/" + cycle.id + "/approve", {}, "The winner of rotation " + cycle.number + " is approved.");
      });
      actions.appendChild(approve);
    }
    body.appendChild(actions);

    var reasonField = el("div", "field");
    var reasonLabel = el("label", null, "Reason (for hide, unhide and disqualify)");
    var reason = el("input");
    reason.type = "text";
    reason.maxLength = 200;
    reason.id = "road-reason-" + cycle.id;
    reasonLabel.htmlFor = reason.id;
    reasonField.appendChild(reasonLabel);
    reasonField.appendChild(reason);
    body.appendChild(reasonField);

    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table admin-table");
    var head = el("thead");
    var headRow = el("tr");
    ["#", "Road", "Credit", "Status", "Votes", ""].forEach(function (text, i) {
      headRow.appendChild(el("th", i === 4 ? "num" : null, text));
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var rows = el("tbody");
    var entries = cycle.entries || [];
    if (!entries.length) {
      var emptyRow = el("tr");
      var cell = el("td", "empty-cell", "No entries.");
      cell.colSpan = 6;
      emptyRow.appendChild(cell);
      rows.appendChild(emptyRow);
    }
    entries.forEach(function (entry) {
      var row = el("tr", winnerOf(cycle) === entry.id ? "is-winner" : null);
      row.appendChild(el("td", "rank", String(entry.id)));
      var name = el("td", "cell-name");
      name.appendChild(el("span", null, entry.name));
      if (entry.description) name.appendChild(el("span", "admin-desc", entry.description));
      if (entry.reason) name.appendChild(el("span", "admin-desc", "Reason: " + entry.reason));
      var view = el("a", null, "View edits");
      view.href = "/road.html?entry=" + encodeURIComponent(entry.id);
      view.className = "admin-desc";
      name.appendChild(view);
      row.appendChild(name);
      row.appendChild(el("td", null, entry.characterName || "-"));
      row.appendChild(el("td", null, entry.status || "-"));
      row.appendChild(el("td", "num", num(entry.votes)));
      var actionsCell = entryActions(entry, reason);
      if (winnerOf(cycle) !== entry.id && lower(entry.status) !== "disqualified" && state !== "live") {
        var make = el("button", "ghost-btn small", "Make winner");
        make.type = "button";
        twoClicks(make, "Make winner", "Click again: override the winner", function () {
          roadAction("/api/admin/road/cycles/" + cycle.id + "/winner", { entryId: entry.id },
            "Entry #" + entry.id + " is the winner of rotation " + cycle.number + ". It needs approval.");
        });
        actionsCell.appendChild(make);
      }
      row.appendChild(actionsCell);
      rows.appendChild(row);
    });
    table.appendChild(rows);
    wrap.appendChild(table);
    body.appendChild(wrap);
    return details;
  }

  function renderRoad(data) {
    var cycles = Array.isArray(data.cycles) ? data.cycles : [];
    cycles.sort(function (a, b) { return b.number - a.number; });
    if (roadOpen.first === undefined && cycles.length) { roadOpen[cycles[0].id] = true; roadOpen.first = true; }
    $("road-note").textContent = cycles.length + (cycles.length === 1 ? " rotation" : " rotations") + (data.paused ? " · paused" : "");
    var pause = $("road-pause");
    pause.textContent = data.paused ? "Resume rotations" : "Pause rotations";
    pause.disabled = data.paused === null;
    pause.title = data.paused ? "New rotations and the deploy are paused" : "";
    pause.onclick = function () {
      pause.disabled = true;
      roadAction("/api/admin/road/pause", { paused: !data.paused }, data.paused ? "Rotations resumed." : "Rotations paused.");
    };
    var box = $("road-cycles");
    clear(box);
    if (!cycles.length) box.appendChild(el("p", "note-text", "No rotation yet. Create the first one above."));
    cycles.forEach(function (cycle) { box.appendChild(renderCycle(cycle)); });
  }

  function loadRoad() {
    return Promise.all([
      request("/api/admin/road/cycles"),
      request("/api/road/cycle").catch(function () { return null; })
    ]).then(function (results) {
      var list = results[0];
      var data = Array.isArray(list) ? { cycles: list } : (list || { cycles: [] });
      if (data.paused === undefined) data.paused = results[1] && results[1].paused !== undefined ? !!results[1].paused : null;
      renderRoad(data);
    });
  }

  function wireRoad() {
    $("road-create").addEventListener("submit", function (event) {
      event.preventDefault();
      roadAlert("");
      var opens = fromInput("road-start");
      if (!opens) { roadAlert("Choose when submissions open."); return; }
      var payload = { submitOpens: opens };
      var closes = fromInput("road-submit-closes");
      var votes = fromInput("road-vote-closes");
      if (closes) payload.submitCloses = closes;
      if (votes) payload.voteCloses = votes;
      var button = $("road-create-button");
      button.disabled = true;
      request("/api/admin/road/cycles", { method: "POST", body: JSON.stringify(payload) })
        .then(function () { roadAlert("The rotation is created.", true); return loadRoad(); })
        .catch(roadFail)
        .then(function () { button.disabled = false; });
    });
  }

  function startRoad() {
    $("road-panel").hidden = false;
    wireRoad();
    loadRoad().catch(roadFail);
  }

  /* ---------- tabs ---------- */

  var TAB_PANELS = { gifts: "panel-gifts", road: "panel-road", quests: "panel-quests", users: "panel-users", server: "panel-server", audit: "panel-audit" };
  var roadStarted = false;
  var usersWired = false;
  var serverWired = false;
  var auditWired = false;
  var audit = { entries: [], runs: [], query: "", action: "", account: "" };
  var ops = { service: "erupe", errors: false };
  var currentName = "";

  function activateTab(name) {
    if (!TAB_PANELS[name]) name = "gifts";
    Object.keys(TAB_PANELS).forEach(function (key) {
      var panel = $(TAB_PANELS[key]);
      if (panel) panel.hidden = key !== name;
      var tab = $("tab-" + key);
      if (tab) tab.setAttribute("aria-selected", key === name ? "true" : "false");
    });
    if (name === "road" && !roadStarted) {
      roadStarted = true;
      startRoad();
    }
    if (name === "quests") {
      if (window.startQuestSubmissions) window.startQuestSubmissions();
    }
    if (name === "users") {
      if (!usersWired) {
        usersWired = true;
        wireUsers();
      }
      loadUsers().catch(usersFail);
    }
    if (name === "audit") {
      if (!auditWired) {
        auditWired = true;
        wireAudit();
      }
      loadAuditPage().catch(auditFail);
    }
    if (name === "server") {
      if (!serverWired) {
        serverWired = true;
        wireServer();
      }
      loadServers().catch(serverFail);
      loadAudit().catch(serverFail);
    }
  }

  function wireTabs() {
    document.querySelector(".tabs").addEventListener("click", function (event) {
      var tab = event.target.closest(".tab");
      if (!tab) return;
      event.preventDefault();
      window.location.hash = tab.getAttribute("href").slice(1);
    });
    window.addEventListener("hashchange", function () {
      activateTab(window.location.hash.replace("#", ""));
    });
  }

  /* ---------- users ---------- */

  var users = { page: 0, size: 25, query: "" };

  function usersAlert(text) {
    var box = $("users-alert");
    box.textContent = text || "";
    box.hidden = !text;
  }

  function usersFail(error) {
    if (error.message === "signin") usersAlert("Your sign-in has expired. Sign in again on the home page.");
    else if (error.message === "forbidden") usersAlert("This account is not an admin.");
    else usersAlert(error.message || "The user list could not be loaded.");
  }

  function stamp(value) {
    if (!value) return "never";
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function roleBadge(role) {
    var extra = role === "ROLE_ADMIN" ? " role-admin" : role === "ROLE_MODERATOR" ? " role-mod" : role === "ROLE_TESTER" ? " role-tester" : "";
    return el("span", "role-badge" + extra, role.replace("ROLE_", ""));
  }

  function roleButton(user, role, label) {
    var has = user.roles.indexOf(role) !== -1;
    var button = el("button", "ghost-btn small" + (has ? " is-on" : ""), (has ? "Remove " : "Make ") + label);
    button.type = "button";
    if (has && role === "ROLE_ADMIN" && currentName && user.username === currentName) {
      button.disabled = true;
      button.title = "You can't remove your own admin role.";
    }
    button.addEventListener("click", function () {
      button.disabled = true;
      request("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ username: user.username, role: role, grant: !has })
      }).then(function (data) {
        usersAlert((data && data.message) || "Saved.");
        return loadUsers();
      }).catch(function (error) {
        button.disabled = false;
        usersFail(error);
      });
    });
    return button;
  }

  function chatToggle(user, field) {
    var on = !!user[field];
    var button = el("button", "ghost-btn small" + (on ? " is-on" : ""), field);
    button.type = "button";
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.title = field + " is " + (on ? "on" : "off") + " for " + user.username;
    button.addEventListener("click", function () {
      button.disabled = true;
      var body = {};
      body[field] = !on;
      request("/api/admin/users/" + user.id + "/flags", { method: "POST", body: JSON.stringify(body) })
        .then(function (data) {
          usersAlert((data && data.message) || "Saved.");
          return loadUsers();
        }).catch(function (error) {
          button.disabled = false;
          usersFail(error);
        });
    });
    return button;
  }

  function renderUsers(data) {
    var body = $("user-rows");
    clear(body);
    $("users-summary").textContent = num(data.summary.accounts) + " accounts · " + data.summary.admins + " admins · "
      + data.summary.moderators + " moderators · " + num(data.summary.linked) + " Discord links";
    $("count-users").textContent = "(" + num(data.summary.accounts) + ")";
    $("users-page").textContent = num(data.total) + (data.total === 1 ? " match" : " matches")
      + " · page " + (data.page + 1) + " of " + Math.max(1, Math.ceil(data.total / data.size));
    $("users-prev").disabled = data.page <= 0;
    $("users-next").disabled = (data.page + 1) * data.size >= data.total;
    if (!data.users.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No account matches that search.");
      cell.colSpan = 9;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    data.users.forEach(function (user) {
      var row = el("tr");
      row.appendChild(el("td", "rank", String(user.id)));
      var name = el("td", "cell-name");
      name.appendChild(el("span", null, user.username));
      if (currentName && user.username === currentName) name.appendChild(el("span", "admin-desc", "you"));
      row.appendChild(name);
      var roles = el("td", "role-cell");
      if (!user.roles.length) roles.appendChild(el("span", "role-badge", "none"));
      else user.roles.forEach(function (role) { roles.appendChild(roleBadge(role)); });
      row.appendChild(roles);
      row.appendChild(el("td", "num", num(user.characters)));
      row.appendChild(el("td", null, stamp(user.lastLogin)));
      row.appendChild(el("td", null, user.discordLinked ? "Linked" : "-"));
      var chat = el("td", "admin-flags");
      chat.appendChild(chatToggle(user, "op"));
      chat.appendChild(chatToggle(user, "timer"));
      row.appendChild(chat);
      var adminCell = el("td");
      adminCell.appendChild(roleButton(user, "ROLE_ADMIN", "admin"));
      row.appendChild(adminCell);
      var modCell = el("td");
      modCell.appendChild(roleButton(user, "ROLE_MODERATOR", "moderator"));
      row.appendChild(modCell);
      var testerCell = el("td");
      var testerBtn = roleButton(user, "ROLE_TESTER", "tester");
      testerBtn.title = "Custom quest and road tester: can load and try custom content before it is published.";
      testerCell.appendChild(testerBtn);
      row.appendChild(testerCell);
      body.appendChild(row);
    });
  }

  function loadUsers() {
    return request("/api/admin/users?query=" + encodeURIComponent(users.query) + "&page=" + users.page + "&size=" + users.size)
      .then(function (data) { renderUsers(data); });
  }

  function wireUsers() {
    $("users-prev").addEventListener("click", function () {
      if (users.page > 0) {
        users.page -= 1;
        loadUsers().catch(usersFail);
      }
    });
    $("users-next").addEventListener("click", function () {
      users.page += 1;
      loadUsers().catch(usersFail);
    });
    var timer = null;
    $("user-search").addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        users.query = $("user-search").value.trim();
        users.page = 0;
        loadUsers().catch(usersFail);
      }, 250);
    });
  }

  /* ---------- servers ---------- */

  function serverAlert(text, ok) {
    var alert = $("server-alert");
    var good = $("server-ok");
    alert.textContent = ok ? "" : (text || "");
    alert.hidden = ok || !text;
    good.textContent = ok ? (text || "") : "";
    good.hidden = !ok;
  }

  function serverFail(error) {
    if (error.message === "signin") serverAlert("Your sign-in has expired. Sign in again on the home page.");
    else if (error.message === "forbidden") serverAlert("Only admins and moderators can use the server tools.");
    else serverAlert(error.message || "The server tools could not be reached.");
  }

  function since(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC"
    }) + " UTC";
  }

  // "active (running)" from systemd -> "Running"; anything else stays as systemd wrote it.
  function stateText(service) {
    if (!service.available) return "not set up";
    var state = String(service.state || "unknown");
    if (state.indexOf("active") === 0) return "Running";
    return state.charAt(0).toUpperCase() + state.slice(1);
  }

  function serviceCard(service) {
    var card = el("div", "ops-card");
    var head = el("div", "ops-card-head");
    head.appendChild(el("span", "ops-name", service.label));
    var state = el("span", "ops-state" + (service.available && service.state.indexOf("active") === 0 ? " is-up" : " is-down"),
      stateText(service));
    head.appendChild(state);
    card.appendChild(head);
    var facts = [];
    if (service.since) facts.push("up since " + since(service.since));
    if (service.restarts !== null && service.restarts !== undefined) facts.push(service.restarts + " restarts");
    if (service.players !== null && service.players !== undefined) facts.push(service.players + " players");
    if (facts.length) card.appendChild(el("p", "note-text", facts.join(" · ")));
    (service.notes || []).slice(0, 3).forEach(function (note) {
      card.appendChild(el("p", "note-text", note));
    });
    var actions = el("div", "ops-card-actions");
    ["logs", "errors"].forEach(function (kind) {
      var button = el("button", "ghost-btn small", kind === "logs" ? "Logs" : "Errors");
      button.type = "button";
      button.addEventListener("click", function () {
        ops.service = service.service;
        ops.errors = kind === "errors";
        loadLog().catch(serverFail);
      });
      actions.appendChild(button);
    });
    var restart = el("button", "ghost-btn small ops-restart", "Restart");
    restart.type = "button";
    restart.disabled = !service.available;
    restart.addEventListener("click", function () {
      if (restart.getAttribute("data-armed") !== "1") {
        restart.setAttribute("data-armed", "1");
        restart.textContent = "Click again to restart " + service.label;
        setTimeout(function () {
          restart.removeAttribute("data-armed");
          restart.textContent = "Restart";
        }, 5000);
        return;
      }
      restart.disabled = true;
      serverAlert("");
      request("/api/admin/ops/services/" + service.service + "/restart", { method: "POST" })
        .then(function (data) {
          serverAlert(((data && data.message) || "restart=ok") + " (they come back by themselves).", true);
          return loadServers();
        })
        .catch(function (error) {
          restart.disabled = false;
          serverAlert(error.message || "The restart failed.");
        });
    });
    actions.appendChild(restart);
    card.appendChild(actions);
    return card;
  }

  function renderServers(list) {
    var body = $("server-services");
    clear(body);
    var up = list.filter(function (s) { return s.available && s.state.indexOf("active") === 0; }).length;
    $("server-note").textContent = up + " of " + list.length + " running";
    list.forEach(function (service) { body.appendChild(serviceCard(service)); });
  }

  function loadServers() {
    return request("/api/admin/ops/services").then(renderServers);
  }

  function renderLog(data) {
    var box = $("ops-log");
    box.textContent = (data.lines && data.lines.length) ? data.lines.join("\n") : "(nothing)";
    $("ops-log-title").textContent = (data.service || ops.service) + (ops.errors ? " errors" : " log") + ", newest last";
  }

  function loadLog() {
    $("ops-log").textContent = "Loading";
    var path = "/api/admin/ops/services/" + ops.service + "/logs?lines=200"
      + (ops.errors ? "&errors=true" : "");
    return request(path).then(renderLog).catch(function (error) {
      $("ops-log").textContent = ["Could not load the log: " + (error.message || error)].join("");
      throw error;
    });
  }

  function renderAudit(list) {
    var body = $("ops-audit");
    clear(body);
    if (!list.length) {
      var empty = el("tr");
      var cell = el("td", "empty-cell", "No actions recorded yet.");
      cell.colSpan = 5;
      empty.appendChild(cell);
      body.appendChild(empty);
      return;
    }
    list.forEach(function (entry) {
      var row = el("tr");
      row.appendChild(el("td", null, since(entry.at)));
      row.appendChild(el("td", null, entry.account || "-"));
      row.appendChild(el("td", null, entry.action || "-"));
      row.appendChild(el("td", null, entry.target || "-"));
      row.appendChild(el("td", null, entry.result || "-"));
      body.appendChild(row);
    });
  }

  function loadAudit() {
    return request("/api/admin/ops/audit?max=20").then(renderAudit);
  }


  /* ---------- audit log ---------- */

  function auditFail(error) {
    var box = $("audit-alert");
    box.textContent = error && error.message === "forbidden"
      ? "Only admins can read the audit log."
      : "Could not load the audit log: " + ((error && error.message) || error);
    box.hidden = false;
  }

  function auditMatches(entry) {
    if (audit.action && entry.action !== audit.action) return false;
    if (audit.account && entry.account !== audit.account) return false;
    if (!audit.query) return true;
    var haystack = [entry.account, entry.action, entry.target, entry.result].join(" ").toLowerCase();
    return haystack.indexOf(audit.query) !== -1;
  }

  function fillFilter(select, values, current, allLabel) {
    clear(select);
    var all = el("option", null, allLabel);
    all.value = "";
    select.appendChild(all);
    values.forEach(function (value) {
      var option = el("option", null, value);
      option.value = value;
      select.appendChild(option);
    });
    select.value = values.indexOf(current) === -1 ? "" : current;
  }

  function auditTable(entries) {
    var wrap = el("div", "table-wrap");
    var table = el("table", "data-table admin-table");
    var head = el("thead");
    var hr = el("tr");
    ["When", "Account", "What", "Target", "Outcome"].forEach(function (label) { hr.appendChild(el("th", null, label)); });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el("tbody");
    entries.forEach(function (entry) {
      var row = el("tr");
      var when = el("td", null, entry.at ? new Date(entry.at).toLocaleString() : "-");
      when.setAttribute("data-sort", entry.at || "");
      row.appendChild(when);
      row.appendChild(el("td", null, entry.account || "-"));
      row.appendChild(el("td", null, entry.action || "-"));
      row.appendChild(el("td", null, entry.target || "-"));
      row.appendChild(el("td", null, entry.result || "-"));
      body.appendChild(row);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function renderAuditPage() {
    var box = $("audit-runs");
    clear(box);
    var loaded = audit.runs.map(function (run) {
      return { run: run, entries: (run.entries || []).filter(auditMatches) };
    }).filter(function (item) { return item.entries.length > 0; });
    var total = audit.runs.reduce(function (n, run) { return n + (run.actions || 0); }, 0);
    var shown = loaded.reduce(function (n, item) { return n + item.entries.length; }, 0);
    $("audit-note").textContent = shown + " of " + total + " actions in " + audit.runs.length + " runs";
    if (!loaded.length) {
      box.appendChild(el("p", "empty-cell", total ? "Nothing matches those filters." : "No actions recorded yet."));
      return;
    }
    loaded.forEach(function (item, index) {
      var details = el("details", "audit-run");
      if (index === 0) details.open = true;
      var summary = el("summary");
      var at = item.run.startedAt ? new Date(item.run.startedAt) : null;
      summary.appendChild(el("span", "audit-run-time", at && !isNaN(at) ? at.toLocaleString() : "Unknown run"));
      summary.appendChild(el("span", "audit-run-count",
        item.entries.length + (item.entries.length === 1 ? " action" : " actions") +
        (item.entries.length !== item.run.actions ? " of " + item.run.actions : "")));
      details.appendChild(summary);
      details.appendChild(auditTable(item.entries));
      box.appendChild(details);
    });
    if (window.enhanceSortableTables) window.enhanceSortableTables($("audit-panel"));
  }

  function loadAuditPage() {
    $("audit-alert").hidden = true;
    return request("/api/admin/ops/audit/runs?runs=10&entries=200").then(function (list) {
      audit.runs = list || [];
      audit.entries = [];
      var actions = {};
      var accounts = {};
      audit.runs.forEach(function (run) {
        (run.entries || []).forEach(function (entry) {
          audit.entries.push(entry);
          if (entry.action) actions[entry.action] = true;
          if (entry.account) accounts[entry.account] = true;
        });
      });
      fillFilter($("audit-action"), Object.keys(actions).sort(), audit.action, "All actions");
      fillFilter($("audit-account"), Object.keys(accounts).sort(), audit.account, "All accounts");
      renderAuditPage();
    }).catch(function (error) { auditFail(error); throw error; });
  }

  function auditCsv() {
    var rows = [["when", "account", "action", "target", "outcome"]];
    audit.entries.filter(auditMatches).forEach(function (entry) {
      rows.push([entry.at || "", entry.account || "", entry.action || "", entry.target || "", entry.result || ""]);
    });
    var text = rows.map(function (row) {
      return row.map(function (value) {
        var s = String(value);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\n");
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text + "\n"], { type: "text/csv" }));
    link.download = "hvmhfz-audit-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function wireAudit() {
    var timer = null;
    $("audit-search").addEventListener("input", function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        audit.query = $("audit-search").value.trim().toLowerCase();
        renderAuditPage();
      }, 120);
    });
    $("audit-action").addEventListener("change", function () {
      audit.action = $("audit-action").value;
      renderAuditPage();
    });
    $("audit-account").addEventListener("change", function () {
      audit.account = $("audit-account").value;
      renderAuditPage();
    });
    $("audit-refresh").addEventListener("click", function () { loadAuditPage().catch(auditFail); });
    $("audit-export").addEventListener("click", auditCsv);
  }

  function wireServer() {
    $("ops-refresh").addEventListener("click", function () { loadLog().catch(serverFail); });
    $("ops-errors").addEventListener("click", function () {
      ops.errors = !ops.errors;
      loadLog().catch(serverFail);
    });
  }

  function start() {
    if (!token()) {
      alertBox("Sign in on the home page with an admin account first.");
      return;
    }
    wireTabs();
    activateTab(window.location.hash.replace("#", "") || "gifts");
    request("/api/users/self")
      .then(function (self) { currentName = (self && self.username) || ""; })
      .catch(function () { /* the list still works; only the "you" mark is missing */ });
    request("/api/admin/distributions/options")
      .then(function (data) {
        options = data;
        $("new-gift").hidden = false;
        $("gift-list-panel").hidden = false;
        wireForm();
        return loadList();
      })
      .catch(showError);
  }

  start();
})();
