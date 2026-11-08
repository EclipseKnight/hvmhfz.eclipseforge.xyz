/* Admin: client patch versions on the Users tab. From client patch v1.19 the game sends its patch version at every
   login and Erupe stores it per character (characters.client_patch: major * 100 + minor, 119 = v1.19; 0 = v1.18 or
   older, which send nothing; null = not logged in since the recording started). GET /api/admin/users carries it per
   character (clientPatch) and a count per value over every account (patches). The current version comes from this
   site's data/patch-versions.json (the entry with "current": true), the same file play.html shows.
   Summary buckets: current (the current version or newer), older (a version below it), unknown (0 or null). */
(function () {
  "use strict";

  // 119 -> "v1.19"; 0 -> "v1.18 or older"; null -> "not seen".
  function patchName(value) {
    if (value === null || value === undefined) return "not seen";
    if (value === 0) return "v1.18 or older";
    return "v" + Math.floor(value / 100) + "." + (value % 100);
  }

  // "1.19" or "v1.19" -> 119; null when it is not MAJOR.MINOR.
  function versionValue(text) {
    var m = /^v?(\d+)\.(\d+)$/.exec(String(text || "").trim());
    if (!m || Number(m[2]) > 99) return null;
    return Number(m[1]) * 100 + Number(m[2]);
  }

  // The current version's value from data/patch-versions.json; null when none is marked current.
  function currentValue(versions) {
    var list = (versions && versions.patches) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].current) return versionValue(list[i].version);
    }
    return null;
  }

  // Which bucket a character's value goes in.
  function bucket(value, current) {
    if (value === null || value === undefined || value === 0) return "unknown";
    if (current === null || current === undefined) return "known";
    return value >= current ? "current" : "older";
  }

  // The API's patches list summed per bucket: {current, older, unknown, known, recent, total}.
  function summarize(patches, current) {
    var out = { current: 0, older: 0, unknown: 0, known: 0, recent: 0, total: 0, notSeen: 0 };
    (patches || []).forEach(function (p) {
      var b = bucket(p.clientPatch, current);
      out[b] += p.characters;
      out.total += p.characters;
      out.recent += p.seenLast7Days || 0;
      if (p.clientPatch === null || p.clientPatch === undefined) out.notSeen += p.characters;
    });
    return out;
  }

  // The line above the users table. `current` null: the site's version file could not be read.
  function summaryText(data, current) {
    if (!data || !data.patchTracking) return "Client patch: not recorded yet (the game server's schema is not applied).";
    var s = summarize(data.patches, current);
    var unknown = num(s.unknown) + " unknown (" + num(s.unknown - s.notSeen) + " on v1.18 or older, "
      + num(s.notSeen) + " not seen since recording started)";
    if (current === null || current === undefined) {
      return "Client patch, played characters: " + num(s.known) + " with a version · " + unknown + ".";
    }
    return "Client patch, played characters: " + num(s.current) + " current (" + patchName(current) + ") · "
      + num(s.older) + " older · " + unknown + ".";
  }

  // Tooltip of the summary: one line per version.
  function breakdown(data) {
    return ((data && data.patches) || []).map(function (p) {
      return patchName(p.clientPatch) + ": " + num(p.characters) + " (" + num(p.seenLast7Days || 0) + " in the last 7 days)";
    }).join("\n");
  }

  // The short label on a character chip; "" when the API has no tracking.
  function chipLabel(character, tracking) {
    if (!tracking || character.clientPatch === null || character.clientPatch === undefined) return "";
    return character.clientPatch === 0 ? "patch ≤v1.18" : "patch " + patchName(character.clientPatch);
  }

  function num(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  var api = { patchName: patchName, versionValue: versionValue, currentValue: currentValue, bucket: bucket,
    summarize: summarize, summaryText: summaryText, breakdown: breakdown, chipLabel: chipLabel };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window === "undefined") return;

  // The site's version file, read once; null when it cannot be read.
  var currentPromise = null;
  api.loadCurrent = function () {
    if (!currentPromise) {
      currentPromise = fetch("/data/patch-versions.json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(currentValue)
        .catch(function () { return null; });
    }
    return currentPromise;
  };
  window.AdminPatches = api;
})();
