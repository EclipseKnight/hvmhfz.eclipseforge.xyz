/* Admin panel: gifts (Erupe "distributions"). Lists every gift and creates new ones through the API's
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

  function start() {
    if (!token()) {
      alertBox("Sign in on the home page with an admin account first.");
      return;
    }
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
