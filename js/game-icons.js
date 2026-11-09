/* Icons for items and equipment, drawn the way the game draws them.

   Items: the API (and data/item-icons.json) names each item's picture, e.g. "Drink6", a file in
   /assets/items/ (the 96 px art, shown at half size or less so the pixels stay sharp).

   Equipment: in the game an equipment icon is the sprite of its type (the weapon class, or the armour
   slot) tinted with its rarity colour. The sprites are /assets/weapons/<class>.png (the game's own) and
   /assets/equipment/<slot>.svg (drawn for the site in the same grey-and-outline style); the class and
   rarity of each id come from data/equipment-icons.json (dev/make-equipment-icons.py). The tint is a
   layer over the sprite, cut to its shape (CSS mask) and multiplied, so the outline stays dark
   (css/styles.css, "game icons").

   Anything unknown (no picture, an id the data doesn't have, a picture that fails to load) gets the
   one neutral placeholder the builders use, /assets/builder/no-icon.svg.

   The lookups at the top also run under node (dev/check-account-details.js). */
(function (root) {
  "use strict";

  var FALLBACK = "/assets/builder/no-icon.svg";
  var DATA_URL = "/data/equipment-icons.json";

  /* Rarity colours by the game's stored rarity, 0-11 (RARE 1-12 in game). Close to the in-game name
     colours; not measured from the client, adjust here if a colour looks wrong. */
  var RARITY_COLOURS = ["#ffffff", "#b8a6e8", "#f0e060", "#f4a0c0", "#86d074", "#6c9cf0",
    "#f06a5a", "#7ad6f0", "#f0a040", "#b878e8", "#a8e070", "#e8c060"];

  /* The weapon class names the API uses (WeaponTypes), by sprite name. */
  var WEAPON_LABELS = {
    "great-sword": "Great Sword", "long-sword": "Long Sword", "sword-and-shield": "Sword and Shield",
    "dual-blades": "Dual Blades", "hammer": "Hammer", "hunting-horn": "Hunting Horn", "lance": "Lance",
    "gunlance": "Gunlance", "tonfa": "Tonfa", "switch-axe": "Switch Axe F", "magnet-spike": "Magnet Spike",
    "light-bowgun": "Light Bowgun", "heavy-bowgun": "Heavy Bowgun", "bow": "Bow"
  };
  var ARMOUR_SLOTS = ["head", "chest", "arms", "waist", "legs"];

  function itemIconUrl(key) {
    return key ? "/assets/items/" + encodeURIComponent(key) + ".webp" : FALLBACK;
  }

  /* What icon a piece of equipment gets: { sprite, rarity (0-11 or null), colour (or null), weaponClass
     (its name, weapons only, or null) }. data is data/equipment-icons.json, or null when it could not be
     loaded: armour still gets its slot's sprite (the slot is in the piece), untinted. */
  function equipmentLook(data, piece) {
    var look = { sprite: FALLBACK, rarity: null, colour: null, weaponClass: null };
    if (!piece) return look;
    var id = Number(piece.id);
    var known = data && isFinite(id) && id >= 0;
    var rarity = "-";
    if (piece.kind === "melee" || piece.kind === "ranged") {
      var table = known ? data[piece.kind] || "" : "";
      var cls = table.charAt(id * 2) || "-";
      rarity = table.charAt(id * 2 + 1) || "-";
      var slug = cls === "-" ? null : (data.classes || [])[parseInt(cls, 36)];
      if (!slug) return look; // a weapon of unknown class: the placeholder
      look.sprite = "/assets/weapons/" + slug + ".png";
      look.weaponClass = WEAPON_LABELS[slug] || null;
    } else if (ARMOUR_SLOTS.indexOf(piece.slot) !== -1) {
      look.sprite = "/assets/equipment/" + piece.slot + ".svg";
      rarity = known ? (data[piece.slot] || "").charAt(id) || "-" : "-";
    } else {
      return look;
    }
    if (rarity !== "-") {
      look.rarity = parseInt(rarity, 36);
      look.colour = RARITY_COLOURS[look.rarity] || null;
    }
    return look;
  }

  /* "Rare 7" for the stored rarity 6. */
  function rarityLabel(rarity) {
    return rarity === null || rarity === undefined ? "" : "Rare " + (rarity + 1);
  }

  var Lookups = { FALLBACK: FALLBACK, RARITY_COLOURS: RARITY_COLOURS, itemIconUrl: itemIconUrl,
    equipmentLook: equipmentLook, rarityLabel: rarityLabel };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Lookups;
    return;
  }

  /* ---------- in the page ---------- */

  var loading = null;

  /* data/equipment-icons.json, fetched once; null when it can't be read (pieces then show untinted). */
  function load() {
    if (!loading) {
      loading = fetch(DATA_URL).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).catch(function () { return null; });
    }
    return loading;
  }

  function picture(src, className) {
    var img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    if (className) img.className = className;
    img.onerror = function () {
      img.onerror = null;
      if (img.src.indexOf(FALLBACK) === -1) img.src = FALLBACK;
      var box = img.parentNode;
      if (box && box.classList) box.classList.add("gi-unknown");
    };
    return img;
  }

  /* An item's icon: <span class="gi gi-item"><img></span>. item: { icon } or the icon's name. */
  function itemIcon(item, extraClass) {
    var key = item && typeof item === "object" ? item.icon : item;
    var span = document.createElement("span");
    span.className = "gi gi-item" + (key ? "" : " gi-unknown") + (extraClass ? " " + extraClass : "");
    span.setAttribute("aria-hidden", "true");
    span.appendChild(picture(itemIconUrl(key)));
    return span;
  }

  /* A piece's icon: the type sprite with the rarity tint over it. The title says the rarity. */
  function equipmentIcon(data, piece, extraClass) {
    var look = equipmentLook(data, piece);
    var span = document.createElement("span");
    span.className = "gi gi-equip" + (look.sprite === FALLBACK ? " gi-unknown" : "") + (extraClass ? " " + extraClass : "");
    span.setAttribute("aria-hidden", "true");
    span.appendChild(picture(look.sprite));
    if (look.colour && look.sprite !== FALLBACK) {
      var tint = document.createElement("span");
      tint.className = "gi-tint";
      tint.style.backgroundColor = look.colour;
      var mask = "url(\"" + look.sprite + "\")";
      tint.style.setProperty("-webkit-mask-image", mask);
      tint.style.setProperty("mask-image", mask);
      span.appendChild(tint);
      span.dataset.rarity = String(look.rarity + 1);
    }
    return span;
  }

  root.HvGameIcons = { load: load, itemIcon: itemIcon, equipmentIcon: equipmentIcon, equipmentLook: equipmentLook,
    itemIconUrl: itemIconUrl, rarityLabel: rarityLabel, FALLBACK: FALLBACK };
})(typeof window !== "undefined" ? window : this);
