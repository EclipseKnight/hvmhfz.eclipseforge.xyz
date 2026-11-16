/* The rank the smithy needs for an armour piece or weapon, and whether a hunter's rank reaches it: hvmhfz_re part 200
   (its docs/armor-builder.md "Rank needed to craft", "Site filter"). Used by the Set builder's lists
   (js/set-builder.js), Find sets (js/set-builder-find.js) and the skill search (js/armor-search.js, node and Web Worker).

   A piece's or weapon's `craft` (data/armor/<slot>.json, data/armor/weapon-craft.json; dev/make-armor-data.py):
   0 = the smithy never offers it (event, transmog-only and unused pieces), else [rank "hr" | "gr", value, band 1-7,
   how] plus [GSR weapon class, GSR level] behind a GSR gate. `how`: r = listed from that rank (earlier once one of its
   flagged materials was obtained), m = listed once a flagged material was obtained (the menu's rank), o = always
   listed, g = GSR gate, u = no create row: the rank of the piece it is upgraded from.

   A hunter: {band, gr, gsr}. band = the HR band 1-7 (index.json rank.bands: HR1, HR2-30, HR31-50, HR51-99, HR100-299,
   HR300-998, HR999; G Rank = band 7), 0 = any (no rank filter); gr = GR (0 = no G Rank yet); gsr = the G Supremacy
   Rank to compare with a GSR gate (null = not given: GSR pieces stay in, with a warning). The rule (hvmhfz_re "Site
   filter"): a piece fits when rank is "hr" and band <= the hunter's band, or rank is "gr" and value <= the hunter's
   GR; and, behind a GSR gate, the GSR level <= the hunter's GSR (and some G Rank: a hunter with an HR band and no GR
   has no GSR). The game's GSR is per weapon class; this filter takes one number for every class.

   Upgrades read no rank in the client, so a G-rank or Zenith piece upgraded from an HR line carries that line's HR
   band in the data (6,016 obtainable G-rank pieces, e.g. Barioth GX Helm at HR band 5). Their materials drop only in
   G rank, so pieceCraft() gives them GR 1 (the client's G-rank piece flag, or rarity 8 and up: no HR armour is
   rarer than 7) and Zenith pieces GR 200 (the Zenith menu's own need; Zenith monsters open at GR 200). Decorations
   and cuffs have no smithy rank in the data: itemFits() keeps an HR hunter (a band, no GR) off cuffs, Zenith
   decorations and the G-rank ones (named "... G", "... GF", "... GX1" to "GX5"). */
(function (root) {
  "use strict";

  var G_BAND = 7;
  var ZENITH_GR = 200;
  var G_RARITY = 8, ZENITH_RARITY = 12;
  var G_ITEM = /\sG(F|X)?\d*$/;   // "Hermit G", "W.Monoblos BM GF", "Abi BM GX3"
  var HOW = {
    r: "listed from this rank, earlier once you have had one of its materials",
    m: "listed once you have had one of its materials",
    o: "always listed",
    g: "needs your GSR in that weapon class",
    u: "upgraded from a piece of this rank",
    G: "a G-rank upgrade of an HR piece: its materials drop only in G rank",
    Z: "a Zenith upgrade of an HR piece: its materials drop only from Zenith monsters"
  };

  function int(v) { var n = Math.trunc(Number(v)); return isFinite(n) && n > 0 ? n : 0; }

  /** The HR band (1-7) of a shown HR, from the bands' caps; 0 for no HR. */
  function bandOfHr(hr, bands) {
    hr = int(hr);
    if (!hr) return 0;
    for (var i = 0; i < bands.length; i++) if (hr <= bands[i][0]) return i + 1;
    return bands.length;
  }

  /** {band, gr, gsr} from a query's or the page's rank ({band} or the older {hr}, gr, gsr); null = no filter at all. */
  function hunter(r, bands) {
    if (!r) return null;
    var gr = Math.min(int(r.gr), 999);
    var band = Math.min(int(r.band), G_BAND) || (r.hr ? bandOfHr(r.hr, bands || []) : 0);
    if (gr) band = G_BAND;
    var gsr = r.gsr === null || r.gsr === undefined || r.gsr === "" || !isFinite(Number(r.gsr)) ? null : Math.min(int(r.gsr), 999);
    if (!band && gsr === null) return null;
    return { band: band, gr: gr, gsr: gsr };
  }

  /** The craft rank the site uses for an armour piece: the data's, except a G-rank or Zenith piece the data puts at
      an HR band (an upgrade of an HR piece): GR 1, or GR 200 for a Zenith piece; a GSR gate stays. */
  function pieceCraft(craft, rarity, limitKind) {
    if (!craft || craft[0] !== "hr") return craft;
    var zenith = (limitKind & 2) || rarity >= ZENITH_RARITY;
    if (!zenith && !(limitKind & 1) && !(rarity >= G_RARITY)) return craft;
    var out = ["gr", zenith ? ZENITH_GR : 1, G_BAND, zenith ? "Z" : "G"];
    if (craft.length > 5) out.push(craft[4], craft[5]);
    return out;
  }

  /** A G-rank decoration (by its name: no smithy rank in the data), a Zenith decoration or a cuff. */
  function gItem(it) { return !!it && (it.kind === "c" || !!it.zenith || G_ITEM.test(it.name || "")); }

  /** Whether a hunter reaches a decoration, Road gem or cuff ({kind, name, zenith}): only an HR hunter (a band, no
      GR) is limited, to what is not a G-rank item. */
  function itemFits(it, h) { return !(h && h.band && !h.gr && gItem(it)); }

  function gsrOf(craft) { return craft && craft.length > 5 ? { cls: craft[4], level: craft[5] } : null; }

  /** Whether a hunter (hunter() above, or null) reaches a craft rank. */
  function fits(craft, h) {
    if (!h) return true;
    if (h.band) {
      if (!craft) return false;
      if (craft[0] === "hr" ? craft[2] > h.band : craft[1] > h.gr) return false;
    }
    var g = gsrOf(craft);
    if (g && h.band && !h.gr) return false;   // a GSR needs G Rank
    return !(g && h.gsr !== null && g.level > h.gsr);
  }

  /** "HR band 5", "GR 100", "GSR 300 Long Sword", "HR band 3 · GSR 1 Bow"; "" when the smithy never offers it. */
  function text(craft, classes) {
    if (!craft) return "";
    var g = gsrOf(craft);
    var rank = craft[0] === "gr" ? "GR " + craft[1] : "HR band " + craft[2];
    if (!g) return rank;
    var gsr = "GSR " + g.level + " " + ((classes && classes[g.cls]) || "class " + g.cls);
    return craft[0] === "hr" && craft[2] === 1 ? gsr : rank + " · " + gsr;
  }

  /** A longer line for a tooltip: the band's HRs, how the smithy lists it. */
  function title(craft, bands, classes) {
    if (!craft) return "The smithy never offers it (event, transmog-only or unused)";
    var band = craft[0] === "hr" && bands && bands[craft[2] - 1] ? " (" + bands[craft[2] - 1][1] + ")" : "";
    var out = text(craft, classes) + band + ": " + (HOW[craft[3]] || "");
    var g = gsrOf(craft);
    if (g && craft[3] !== "g") out += "; " + HOW.g;
    return out;
  }

  /** Sort key: HR bands first, then GR, then the GSR level; never offered last. */
  function order(craft) {
    if (!craft) return 1e7;
    var g = gsrOf(craft);
    return (craft[0] === "gr" ? 1000 + craft[1] : craft[2]) * 1000 + (g ? g.level : 0);
  }

  /** Labels of the band chips: the bands' labels, the last one "HR999 / G Rank". */
  function bandLabel(band, bands) {
    if (!band) return "Any";
    var b = bands && bands[band - 1];
    return band === G_BAND ? (b ? b[1] + " / G Rank" : "G Rank") : b ? b[1] : "HR band " + band;
  }

  var api = { G_BAND: G_BAND, ZENITH_GR: ZENITH_GR, bandOfHr: bandOfHr, hunter: hunter, fits: fits, gsrOf: gsrOf,
              pieceCraft: pieceCraft, gItem: gItem, itemFits: itemFits, text: text, title: title, order: order,
              bandLabel: bandLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ArmorRank = api;
})(typeof self !== "undefined" ? self : this);
