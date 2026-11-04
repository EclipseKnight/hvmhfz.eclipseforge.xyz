/* Character backup files for the account page's Backups tab (js/account-backup.js).

   - makeBackupZip: the API's backup answer ({manifest, signature, parts}) as the same zip the Discord bot's
     /backup sends: one <part>.bin per part (the bytes as the API stores them), manifest.json (the manifest
     text byte for byte: the signature covers exactly it), manifest.sig, and character.json (the parts in a
     newer Erupe server's export shape, {"Character": {id, name, column: base64}}, for other servers).
   - readImportFile: a chosen file as the API's import body: our zip (bins plus manifest and signature), an
     older or another server's zip of .bin files, or a newer Erupe server's export JSON (on its own, or in a
     zip without bins). Same rules as the bot's CharacterSaveZip; the API checks the bytes of every part.

   Zips are written without compression (save parts are mostly compressed already) and read with the
   browser's own DecompressionStream for deflated entries. Also runs under node (dev/check-backup-file.js). */
(function (root) {
  "use strict";

  /* The characters columns an import writes, in the order a file name is matched against them (the first
     name it contains wins). The old bot wrote skinhist. Same list as the API's SavePart. */
  var PARTS = ["savedata", "decomyset", "hunternavi", "otomoairou", "partner", "platebox", "platedata",
    "platemyset", "rengokudata", "savemercenary", "skin_hist", "scenariodata", "savefavoritequest", "mezfes",
    "minidata"];
  var ALIASES = { skinhist: "skin_hist" };
  var MANIFEST = "manifest.json";
  var SIGNATURE = "manifest.sig";
  var EXPORT = "character.json";
  var MAX_BIN_BYTES = 1024 * 1024;      // largest part (the API's largest, platedata, is about 432 KB)
  var MAX_JSON_BYTES = 4 * 1024 * 1024; // an export carries every part in base64
  var MAX_FILES = 20;                   // a backup has at most 15 parts and 3 other files
  /* Every save Erupe stores starts with this (nullcomp's header, "cmp 20110113" padded to 16 bytes). */
  var NULLCOMP = [0x63, 0x6d, 0x70, 0x20, 0x32, 0x30, 0x31, 0x31, 0x30, 0x31, 0x31, 0x33, 0x20, 0x20, 0x20, 0x00];

  function fail(message) {
    var error = new Error(message);
    error.player = true; // a sentence for the player, shown as is
    return error;
  }

  /* ---------- bytes, base64, text ---------- */

  function base64ToBytes(text) {
    var bin = atob(String(text || ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 0x8000) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)));
    }
    return btoa(chunks.join(""));
  }

  function utf8(text) { return new TextEncoder().encode(text); }
  function fromUtf8(bytes) { return new TextDecoder("utf-8").decode(bytes); }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------- writing ---------- */

  /* A zip of {name, data: Uint8Array} entries, stored (method 0), UTF-8 names, dated `when` (UTC). */
  function zip(entries, when) {
    var d = when || new Date();
    var time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
    var date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    var locals = [];
    var centrals = [];
    var offset = 0;
    entries.forEach(function (entry) {
      var name = utf8(entry.name);
      var data = entry.data;
      var crc = crc32(data);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      var central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, name.length, true);
      central.setUint32(42, offset, true);
      locals.push(new Uint8Array(local.buffer), name, data);
      centrals.push(new Uint8Array(central.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var centralSize = centrals.reduce(function (n, part) { return n + part.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    var all = locals.concat(centrals, [new Uint8Array(end.buffer)]);
    var out = new Uint8Array(offset + centralSize + 22);
    var at = 0;
    all.forEach(function (part) { out.set(part, at); at += part.length; });
    return out;
  }

  /* Hunter names can hold characters file systems refuse (or Japanese ones some unzip tools mangle). */
  function safeName(name) {
    var safe = String(name || "").replace(/[^A-Za-z0-9_-]/g, "");
    return safe || "character";
  }

  function fileTime(d) {
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" + two(d.getUTCDate()) + "_" +
      two(d.getUTCHours()) + "-" + two(d.getUTCMinutes()) + "-" + two(d.getUTCSeconds());
  }

  /* The bot's /backup zip from the API's answer: {fileName, bytes, parts}. */
  function makeBackupZip(backup, now) {
    var when = now || new Date();
    if (!backup || typeof backup.manifest !== "string" || !backup.manifest || !backup.parts) {
      throw fail("The server's backup came back incomplete. Try again in a moment.");
    }
    var manifest;
    try { manifest = JSON.parse(backup.manifest); } catch (e) { manifest = {}; }
    var id = manifest.characterId || 0;
    var name = manifest.name || "";
    var exportRow = { id: id, name: name };
    var entries = [];
    Object.keys(backup.parts).forEach(function (part) {
      var data = backup.parts[part];
      if (PARTS.indexOf(part) === -1 || !data) return; // only the parts an import reads back
      entries.push({ name: part + ".bin", data: base64ToBytes(data) });
      exportRow[part] = data;
    });
    if (!entries.length) throw fail("This character has no save data to back up yet.");
    var count = entries.length;
    entries.push({ name: MANIFEST, data: utf8(backup.manifest) });
    if (backup.signature) entries.push({ name: SIGNATURE, data: utf8(backup.signature) });
    entries.push({ name: EXPORT, data: utf8(JSON.stringify({ Character: exportRow }, null, 2)) });
    return {
      fileName: safeName(name) + "_" + id + "_" + fileTime(when) + ".zip",
      bytes: zip(entries, when),
      parts: count
    };
  }

  /* ---------- reading ---------- */

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(fail("This browser can't open compressed zips. Try a current Chrome, Firefox or Safari."));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
  }

  /* The entries of a zip from its central directory: [{name, read() -> Promise<Uint8Array>, size}]. */
  function unzip(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = -1;
    for (var i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw fail("That file is not a zip we can read.");
    var count = view.getUint16(end + 10, true);
    var at = view.getUint32(end + 16, true);
    var entries = [];
    for (var n = 0; n < count; n++) {
      if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw fail("That zip is damaged.");
      var flags = view.getUint16(at + 8, true);
      var method = view.getUint16(at + 10, true);
      var packed = view.getUint32(at + 20, true);
      var size = view.getUint32(at + 24, true);
      var nameLength = view.getUint16(at + 28, true);
      var extra = view.getUint16(at + 30, true);
      var comment = view.getUint16(at + 32, true);
      var local = view.getUint32(at + 42, true);
      var rawName = bytes.subarray(at + 46, at + 46 + nameLength);
      var name = flags & 0x0800 ? fromUtf8(rawName) : String.fromCharCode.apply(null, rawName);
      entries.push(entry(bytes, view, name, method, flags, packed, size, local));
      at += 46 + nameLength + extra + comment;
    }
    return entries;
  }

  function entry(bytes, view, name, method, flags, packed, size, local) {
    return {
      name: name,
      size: size,
      directory: /\/$/.test(name),
      read: function () {
        if (flags & 1) return Promise.reject(fail("That zip is password protected."));
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
          return Promise.reject(fail("That zip is damaged."));
        }
        var start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        var data = bytes.subarray(start, start + packed);
        if (method === 0) return Promise.resolve(data);
        if (method === 8) return inflateRaw(data);
        return Promise.reject(fail("That zip uses a compression we can't open; zip it again with the usual settings."));
      }
    };
  }

  function baseName(name) {
    var parts = name.split(/[\/\\]/);
    return parts[parts.length - 1];
  }

  /* The import column a file name stands for, or null. */
  function partFor(fileName) {
    var lower = fileName.toLowerCase();
    for (var i = 0; i < PARTS.length; i++) {
      if (lower.indexOf(PARTS[i]) !== -1) return PARTS[i];
    }
    for (var alias in ALIASES) {
      if (lower.indexOf(alias) !== -1) return ALIASES[alias];
    }
    return null;
  }

  function parseExport(text) {
    var json;
    try { json = JSON.parse(text); } catch (e) { throw fail("That JSON file can't be read."); }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw fail("That JSON file is not a character export.");
    }
    return json;
  }

  function startsWith(bytes, prefix) {
    if (bytes.length < prefix.length) return false;
    for (var i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  /* A single save file, not in a zip (savedata.bin, or a launcher's savedata download): the part its name says,
     else savedata when it starts with nullcomp's header. Null when it is neither. */
  function bareFile(name, bytes) {
    if (startsWith(bytes, [0x50, 0x4b])) return null;   // "PK": a zip
    var part = partFor(baseName(name));
    if (!part && startsWith(bytes, NULLCOMP)) part = "savedata";
    if (!part) return null;
    if (!bytes.length) throw fail("That file is empty.");
    if (bytes.length > MAX_BIN_BYTES) throw fail("That file is over 1 MB: it is not a save file.");
    var parts = {};
    parts[part] = bytesToBase64(bytes);
    return { kind: "bare", body: { parts: parts }, manifestInfo: null,
      files: [{ name: baseName(name), status: part }] };
  }

  /* What a chosen file holds, as the import body (without characterId):
     {kind: "backup" | "files" | "export" | "bare", body: {parts, manifest, signature} or {erupeExport},
      files: [{name, status}], manifestInfo: the manifest as JSON (or null)}. "backup": our zip with its manifest;
     "files": a zip of save files without one (another server's, or an older backup); "export": a newer Erupe
     server's character export JSON (alone or in a zip); "bare": one save file on its own. */
  function readImportFile(name, bytes) {
    var lower = String(name || "").toLowerCase();
    if (/\.json$/.test(lower) || (bytes.length && bytes[0] === 0x7b)) {
      if (bytes.length > MAX_JSON_BYTES) return Promise.reject(fail("That JSON file is over 4 MB."));
      var json;
      try { json = parseExport(fromUtf8(bytes)); } catch (e) { return Promise.reject(e); }
      return Promise.resolve({ kind: "export", body: { erupeExport: json }, manifestInfo: null,
        files: [{ name: baseName(name), status: "character export" }] });
    }
    var bare;
    try { bare = bareFile(name, bytes); } catch (e) { return Promise.reject(e); }
    if (bare) return Promise.resolve(bare);
    var entries;
    try { entries = unzip(bytes); } catch (e) { return Promise.reject(e); }
    var parts = {};
    var files = [];
    var manifest = null;
    var signature = null;
    var exportText = null;
    var chain = Promise.resolve();
    entries.forEach(function (e) {
      var file = baseName(e.name);
      // folders, and the metadata files macOS adds when it zips a folder
      if (e.directory || !file || /^__MACOSX\//.test(e.name) || /^\._/.test(file)) return;
      chain = chain.then(function () {
        if (files.length >= MAX_FILES) throw fail("That zip has more than " + MAX_FILES + " files: it is not a character backup.");
        var lowerFile = file.toLowerCase();
        var isJson = lowerFile === MANIFEST || lowerFile === EXPORT || /\.json$/.test(lowerFile);
        var limit = isJson ? MAX_JSON_BYTES : MAX_BIN_BYTES;
        if (e.size > limit) throw fail(file + " is over " + (isJson ? "4 MB" : "1 MB") + ": it is not a save file.");
        return e.read().then(function (data) {
          if (data.length > limit) throw fail(file + " is over " + (isJson ? "4 MB" : "1 MB") + ": it is not a save file.");
          files.push({ name: file, status: classify(lowerFile, file, data) });
        });
      });
    });

    function classify(lowerFile, file, data) {
      if (lowerFile === MANIFEST) { manifest = fromUtf8(data); return "manifest"; }
      if (lowerFile === SIGNATURE) { signature = fromUtf8(data).trim(); return "signature"; }
      if (lowerFile === EXPORT || /\.json$/.test(lowerFile)) {
        if (exportText === null) exportText = fromUtf8(data);
        return "copy for other servers";
      }
      var part = partFor(file);
      if (!part) return "not a save file, skipped";
      // old backups wrote an empty file for every part the character did not have
      if (!data.length) return "empty, skipped";
      if (parts[part]) return "second " + part + " file, skipped";
      parts[part] = bytesToBase64(data);
      return part;
    }

    return chain.then(function () {
      var manifestInfo = null;
      if (manifest !== null) {
        try { manifestInfo = JSON.parse(manifest); } catch (e) { manifestInfo = null; }
      }
      if (Object.keys(parts).length) {
        var body = { parts: parts };
        if (manifest !== null) body.manifest = manifest;
        if (signature) body.signature = signature;
        return { kind: manifest !== null ? "backup" : "files", body: body, files: files, manifestInfo: manifestInfo };
      }
      if (exportText !== null) {
        return { kind: "export", body: { erupeExport: parseExport(exportText) }, files: files, manifestInfo: null };
      }
      throw fail("That zip holds no save files we know (savedata.bin and the like).");
    });
  }

  var api = {
    PARTS: PARTS,
    makeBackupZip: makeBackupZip,
    readImportFile: readImportFile,
    partFor: partFor,
    safeName: safeName,
    crc32: crc32,
    zip: zip,
    base64ToBytes: base64ToBytes,
    bytesToBase64: bytesToBase64
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvBackupFile = api;
})(typeof window !== "undefined" ? window : this);
