/* Icons for items and equipment: the game's own icons, drawn the way the client draws them.

   In the game every icon is a grey 64x64 sprite multiplied by a colour. The sprites and the colours were
   taken from the client (hvmhfz_re tools/icons/game_icons.py, docs/game-icons.md there) and drawn into
   one PNG per icon and colour: /assets/icons/2x/<key>.png (64 px, the game's pixels) and
   /assets/icons/1x/<key>.png (32 px). An <img> lists both in srcset with the size it is shown at, so the
   browser takes the 1x file for a small icon on a normal screen and the 2x one otherwise.

   Items: data/item-icons.json gives each item id its key, item-<sprite>-<colour>[-<badges>] (the shape,
   the item's colour from the client's item colour table, the small marks the game draws over some items).

   Equipment: the key is <type>-<colour>: the armour slot or the weapon class, then the index in the
   client's equipment colour table (EQUIP_COLOURS). The colour comes from a rank: an armour piece's rank is
   its rarity; a weapon's is its rarity or, for some series, a fixed rank or one from its level
   (weaponRank). data/equipment-icons.json gives per id the weapon class, the rarity and the weapon's rule.

   Anything unknown (no data, an id the data doesn't have, a file that fails to load) gets the one neutral
   placeholder the builders use, /assets/builder/no-icon.svg.

   The lookups at the top also run under node (dev/check-account-details.js). */
(function (root) {
  "use strict";

  var FALLBACK = "/assets/builder/no-icon.svg";
  var ICONS = "/assets/icons/";
  var DATA_URL = "/data/equipment-icons.json";
  var ITEMS_URL = "/data/item-icons.json";

  /* The client's equipment colours (mhfo-hd.dll 0x118817d0) and which one each rank takes (0x1188164c):
     RARE 1-3 share the first. */
  var EQUIP_COLOURS = ["#efefe9", "#73cb8d", "#ed93a4", "#96b5fd", "#ff985d", "#fffd2e", "#c8ff6a", "#68ecec",
    "#cba6fa", "#ff435d"];
  var RANK_COLOUR = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  /* The weapon class names the API uses (WeaponTypes), by sprite name. */
  var WEAPON_LABELS = {
    "great-sword": "Great Sword", "long-sword": "Long Sword", "sword-and-shield": "Sword and Shield",
    "dual-blades": "Dual Blades", "hammer": "Hammer", "hunting-horn": "Hunting Horn", "lance": "Lance",
    "gunlance": "Gunlance", "tonfa": "Tonfa", "switch-axe": "Switch Axe F", "magnet-spike": "Magnet Spike",
    "light-bowgun": "Light Bowgun", "heavy-bowgun": "Heavy Bowgun", "bow": "Bow"
  };
  var ARMOUR_SLOTS = ["head", "chest", "arms", "waist", "legs"];

  /* The 1x and 2x files of an icon key. */
  function iconUrl(key, size) {
    return key ? ICONS + (size === 2 ? "2x/" : "1x/") + encodeURIComponent(key) + ".png" : FALLBACK;
  }

  /* A weapon class's icon in the first colour, for lists of weapon types (slug as in WEAPON_LABELS). */
  function weaponClassKey(slug) {
    return slug + "-0";
  }

  /* An item's key from data/item-icons.json (items), by its id, or null. item: { id } or { itemId } (a gift;
     only a gift of type 7, an item, is one) or the id itself. */
  function itemKey(items, item) {
    var id = item;
    if (item && typeof item === "object") {
      if (item.itemType !== undefined && item.itemType !== null && Number(item.itemType) !== 7) return null;
      id = item.id !== undefined && item.id !== null ? item.id : item.itemId;
    }
    if (!items || id === null || id === undefined || id === "") return null;
    return items[String(id)] || null;
  }

  /* The colour rank of a weapon, as the client picks it (mhfo-hd.dll 0x10a9cac0). rule is the weapon's letter
     in data/equipment-icons.json (meleeTint, rangedTint); level is the weapon's level byte, the API's
     upgrade[1] for bowguns, upgrade[0] for the rest.
       "-" its rarity          "h" 6, "i" 8, "b" 11 (series with a colour of their own)
       "a", "c", "e" by its level 1-100 (three threshold sets), else its rarity
       "t" by its level 1-50 (the table at 0x1187f868), else its rarity */
  var LEVEL_STEPS = {
    a: [[85, 11], [75, 10], [65, 9], [55, 8], [45, 7], [35, 6], [25, 5], [15, 4], [5, 3], [0, 2]],
    c: [[75, 11], [65, 10], [55, 9], [45, 8], [35, 7], [25, 6], [15, 5], [5, 4], [0, 3]],
    e: [[99, 11], [90, 10], [75, 9], [60, 8], [45, 7], [30, 6], [15, 5], [0, 4]]
  };
  function weaponRank(rule, rarity, level) {
    if (rule === "h") return 6;
    if (rule === "i") return 8;
    if (rule === "b") return 11;
    var lv = Number(level) || 0;
    if (LEVEL_STEPS[rule] && lv >= 1 && lv <= 100) {
      var steps = LEVEL_STEPS[rule];
      for (var i = 0; i < steps.length; i++) if (lv > steps[i][0]) return steps[i][1];
    }
    if (rule === "t" && lv >= 1 && lv <= 50) {
      return 2 + (lv <= 9 ? 0 : lv <= 20 ? 1 : lv <= 29 ? 2 : lv <= 39 ? 3 : lv <= 49 ? 4 : 5);
    }
    return rarity;
  }

  /* What icon a piece of equipment gets: { key, sprite (the 1x file), rarity (0-11 or null), colour (hex, or
     null when the rank is unknown), weaponClass (its name, weapons only, or null) }. data is
     data/equipment-icons.json, or null when it could not be loaded: armour still gets its slot's sprite (the
     slot is in the piece), in the first colour. */
  function equipmentLook(data, piece) {
    var look = { key: null, sprite: FALLBACK, rarity: null, colour: null, weaponClass: null };
    if (!piece) return look;
    var id = Number(piece.id);
    var known = data && isFinite(id) && id >= 0;
    var rarity = "-", slug = null, rank = null;
    if (piece.kind === "melee" || piece.kind === "ranged") {
      var table = known ? data[piece.kind] || "" : "";
      var cls = table.charAt(id * 2) || "-";
      rarity = table.charAt(id * 2 + 1) || "-";
      slug = cls === "-" ? null : (data.classes || [])[parseInt(cls, 36)];
      if (!slug) return look; // a weapon of unknown class: the placeholder
      look.weaponClass = WEAPON_LABELS[slug] || null;
      if (rarity !== "-") {
        var rule = (data[piece.kind + "Tint"] || "").charAt(id) || "-";
        var upgrade = piece.upgrade || [];
        var level = slug === "heavy-bowgun" || slug === "light-bowgun" ? upgrade[1] : upgrade[0];
        rank = weaponRank(rule, parseInt(rarity, 36), level);
      }
    } else if (ARMOUR_SLOTS.indexOf(piece.slot) !== -1) {
      slug = piece.slot;
      rarity = known ? (data[piece.slot] || "").charAt(id) || "-" : "-";
      if (rarity !== "-") rank = parseInt(rarity, 36);
    } else {
      return look;
    }
    if (rarity !== "-") look.rarity = parseInt(rarity, 36);
    var colour = rank === null ? 0 : RANK_COLOUR[rank];
    if (colour === undefined) colour = 0;
    if (rank !== null) look.colour = EQUIP_COLOURS[colour];
    look.key = slug + "-" + colour;
    look.sprite = iconUrl(look.key);
    return look;
  }

  /* "Rare 7" for the stored rarity 6. */
  function rarityLabel(rarity) {
    return rarity === null || rarity === undefined ? "" : "Rare " + (rarity + 1);
  }

  var Lookups = { FALLBACK: FALLBACK, EQUIP_COLOURS: EQUIP_COLOURS, RANK_COLOUR: RANK_COLOUR, iconUrl: iconUrl,
    itemKey: itemKey, weaponClassKey: weaponClassKey, weaponRank: weaponRank, equipmentLook: equipmentLook,
    rarityLabel: rarityLabel };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Lookups;
    return;
  }

  /* ---------- in the page ---------- */

  var loading = null;
  var loadingItems = null;
  var items = null;

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).catch(function () { return null; });
  }

  /* data/item-icons.json, fetched once (items show the placeholder until it is in). */
  function loadItems() {
    if (!loadingItems) loadingItems = fetchJson(ITEMS_URL).then(function (map) { items = map; return map; });
    return loadingItems;
  }

  /* data/equipment-icons.json, fetched once, after the item keys; null when it can't be read (pieces then
     show their slot's sprite or the placeholder). */
  function load() {
    if (!loading) {
      loading = Promise.all([fetchJson(DATA_URL), loadItems()]).then(function (results) { return results[0]; });
    }
    return loading;
  }

  /* An <img> of an icon key, or the placeholder for none. px: the CSS size it is shown at (default 32). */
  function setPicture(img, key, px) {
    img.src = iconUrl(key);
    if (key) {
      img.srcset = iconUrl(key) + " 32w, " + iconUrl(key, 2) + " 64w";
      img.sizes = (px || 32) + "px";
    } else {
      img.removeAttribute("srcset");
    }
  }

  /* The size an icon is shown at, by the class its caller gives it (css/styles.css, "game icons"). */
  var SHOWN_AT = { "gi-small": 20, "gi-piece": 40, "gi-large": 48, "item-img": 56, "prize-icon": 28 };

  function shownAt(extraClass) {
    return SHOWN_AT[extraClass] || 32;
  }

  function picture(key, className, px) {
    var img = document.createElement("img");
    setPicture(img, key, px);
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    if (className) img.className = className;
    img.onerror = function () {
      img.onerror = null;
      img.removeAttribute("srcset");
      if (img.src.indexOf(FALLBACK) === -1) img.src = FALLBACK;
      var box = img.parentNode;
      if (box && box.classList) box.classList.add("gi-unknown");
    };
    return img;
  }

  /* An item's icon: <span class="gi gi-item"><img></span>. item: { id }, a gift { itemType, itemId } or an id.
     Before data/item-icons.json is in, the placeholder shows and the picture follows. */
  function itemIcon(item, extraClass) {
    var span = document.createElement("span");
    span.className = "gi gi-item" + (extraClass ? " " + extraClass : "");
    span.setAttribute("aria-hidden", "true");
    var key = itemKey(items, item);
    var img = picture(key, null, shownAt(extraClass));
    span.appendChild(img);
    if (!key) span.classList.add("gi-unknown");
    if (!items) {
      loadItems().then(function () {
        var later = itemKey(items, item);
        if (!later) return;
        setPicture(img, later, shownAt(extraClass));
        span.classList.remove("gi-unknown");
      });
    }
    return span;
  }

  /* A piece's icon in its colour. The title says the rarity. */
  function equipmentIcon(data, piece, extraClass) {
    var look = equipmentLook(data, piece);
    var span = document.createElement("span");
    span.className = "gi gi-equip" + (look.key ? "" : " gi-unknown") + (extraClass ? " " + extraClass : "");
    span.setAttribute("aria-hidden", "true");
    span.appendChild(picture(look.key, null, shownAt(extraClass)));
    if (look.rarity !== null) span.dataset.rarity = String(look.rarity + 1);
    return span;
  }

  root.HvGameIcons = { load: load, loadItems: loadItems, itemIcon: itemIcon, equipmentIcon: equipmentIcon,
    equipmentLook: equipmentLook, iconUrl: iconUrl, setPicture: setPicture, itemKey: itemKey,
    weaponClassKey: weaponClassKey, rarityLabel: rarityLabel, FALLBACK: FALLBACK };
})(typeof window !== "undefined" ? window : this);
