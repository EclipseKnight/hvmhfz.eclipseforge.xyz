#!/usr/bin/env node
/* Checks js/backup-file.js (the Backups tab's zip writer and import file reader) on made-up files:

   - a backup zip made from an API answer reads back as the same parts, with the manifest text byte for byte
     and the signature; Python's zipfile opens it with good CRCs and the bot's file names; character.json is
     {"Character": {id, name, parts}};
   - deflated zips made by Python: the old bot's names (<time>_savedata.bin, skinhist, empty parts), folders,
     macOS junk, a second savedata; a zip holding only character.json; a bare export JSON;
   - a bare save file (savedata.bin, or any file starting with nullcomp's header), outside a zip;
   - refusals in plain words: not a zip, no save files, too many files, a part over 1 MB.

     node dev/check-backup-file.js

   Exit code 0 = every case as expected, 1 = a difference. Needs python3 (for zipfile). */
"use strict";

const { execFileSync } = require("child_process");
const F = require("../js/backup-file.js");

const failures = [];
const check = (label, ok, detail) => { if (!ok) failures.push(label + (detail ? ": " + detail : "")); };
const b64 = (text) => Buffer.from(text, "binary").toString("base64");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* A zip made by Python's zipfile (deflated), from {name: base64 data}. */
function pyZip(files) {
  const script = "import base64,io,json,sys,zipfile\n" +
    "files=json.load(sys.stdin)\nout=io.BytesIO()\n" +
    "with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n" +
    "    for name,data in files:\n" +
    "        z.writestr(name, base64.b64decode(data)) if not name.endswith('/') else z.writestr(zipfile.ZipInfo(name), b'')\n" +
    "sys.stdout.write(base64.b64encode(out.getvalue()).decode())\n";
  const out = execFileSync("python3", ["-I", "-c", script], { input: JSON.stringify(files) });
  return new Uint8Array(Buffer.from(out.toString(), "base64"));
}

/* What Python's zipfile sees in our zip: names and CRC check. */
function pyRead(bytes) {
  const script = "import base64,io,json,sys,zipfile\n" +
    "z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read())))\n" +
    "print(json.dumps({'bad': z.testzip(), 'names': z.namelist(), 'manifest': z.read('manifest.json').decode()}))\n";
  return JSON.parse(execFileSync("python3", ["-I", "-c", script], { input: Buffer.from(bytes).toString("base64") }).toString());
}

async function rejects(label, promise, pattern) {
  try {
    await promise;
    check(label, false, "accepted");
  } catch (e) {
    check(label, e.player === true && pattern.test(e.message), e.message);
  }
}

(async () => {
  // ---- our backup: write, then read back
  const manifest = JSON.stringify({ format: "hvmhfz-backup/1", server: "hunsterverse", clientMode: "ZZ", characterId: 10,
    accountId: 2, name: "Hûnter Ω", exportedAt: "2026-11-03T20:00:00Z", parts: [], tower: null });
  const parts = { savedata: b64("SAVE\x00\x01\xff"), rengokudata: b64("R".repeat(95)), skin_hist: b64("S".repeat(3200)),
    gacha_items: b64("never") };
  const made = F.makeBackupZip({ manifest, signature: "9f2c", parts }, new Date(Date.UTC(2026, 10, 3, 20, 1, 2)));
  check("backup: file name", made.fileName === "Hnter_10_2026-11-03_20-01-02.zip", made.fileName);
  check("backup: part count (only import columns)", made.parts === 3, String(made.parts));
  const py = pyRead(made.bytes);
  check("backup: python CRCs", py.bad === null, py.bad);
  check("backup: names", eq(py.names, ["savedata.bin", "rengokudata.bin", "skin_hist.bin", "manifest.json", "manifest.sig", "character.json"]),
    py.names.join(","));
  check("backup: python manifest byte for byte", py.manifest === manifest);
  const back = await F.readImportFile(made.fileName, made.bytes);
  check("backup: kind", back.kind === "backup", back.kind);
  check("backup: parts back", eq(back.body.parts, { savedata: parts.savedata, rengokudata: parts.rengokudata, skin_hist: parts.skin_hist }),
    JSON.stringify(Object.keys(back.body.parts)));
  check("backup: manifest back", back.body.manifest === manifest);
  check("backup: signature back", back.body.signature === "9f2c");
  check("backup: manifest info", back.manifestInfo && back.manifestInfo.characterId === 10);
  check("backup: no export sent", back.body.erupeExport === undefined);
  const zipped = await F.readImportFile("x.zip", pyZip([["character.json", b64(JSON.stringify({ Character: { id: 10 } }))]]));
  check("export in zip: kind", zipped.kind === "export" && zipped.body.erupeExport.Character.id === 10, JSON.stringify(zipped.body));

  // character.json of our zip
  const cj = (await F.readImportFile("x.zip", F.zip([{ name: "character.json",
    data: new TextEncoder().encode(JSON.stringify({ Character: { id: 10, name: "Hunter", savedata: parts.savedata } })) }])));
  check("our character.json alone: export", cj.kind === "export" && cj.body.erupeExport.Character.savedata === parts.savedata);

  // ---- old bot zip, deflated, with junk
  const old = pyZip([
    ["Hunter_2026/", ""],
    ["Hunter_2026/2026-10-23_12-00-00_savedata.bin", b64("old save")],
    ["Hunter_2026/2026-10-23_12-00-00_platebox.bin", ""],
    ["Hunter_2026/2026-10-23_12-00-00_skinhist.bin", b64("skin")],
    ["__MACOSX/Hunter_2026/._savedata.bin", b64("junk")],
    ["Hunter_2026/b_savedata.bin", b64("second")],
    ["Hunter_2026/readme.txt", b64("hi")]
  ]);
  const o = await F.readImportFile("old.zip", old);
  check("old zip: kind", o.kind === "files", o.kind);
  check("old zip: parts", eq(o.body.parts, { savedata: b64("old save"), skin_hist: b64("skin") }), JSON.stringify(o.body.parts));
  check("old zip: no manifest", o.body.manifest === undefined && o.body.signature === undefined);
  check("old zip: statuses", eq(o.files.map((f) => f.status),
    ["savedata", "empty, skipped", "skin_hist", "second savedata file, skipped", "not a save file, skipped"]),
    JSON.stringify(o.files));

  // ---- bare export JSON
  const json = new TextEncoder().encode(JSON.stringify({ Character: { savedata: b64("x"), gacha_items: b64("y") } }));
  const e = await F.readImportFile("export.json", json);
  check("export json: kind", e.kind === "export" && e.body.erupeExport.Character.savedata === b64("x"));
  await rejects("export json: not an object", F.readImportFile("a.json", new TextEncoder().encode("[1]")), /not a character export/);
  await rejects("export json: broken", F.readImportFile("a.json", new TextEncoder().encode("{oops")), /can't be read/);

  // ---- a bare save file (no zip): by its name, or savedata when it starts with nullcomp's header
  const cmp = Buffer.concat([Buffer.from("cmp 20110113   \x00", "binary"), Buffer.from([1, 2, 0, 5])]);
  const bare = await F.readImportFile("savedata.bin", new Uint8Array(cmp));
  check("bare savedata: kind and part", bare.kind === "bare" && eq(Object.keys(bare.body.parts), ["savedata"]) &&
    bare.body.parts.savedata === cmp.toString("base64"), JSON.stringify(bare));
  const unnamed = await F.readImportFile("download", new Uint8Array(cmp));
  check("bare: nullcomp without a name is savedata", unnamed.kind === "bare" && unnamed.body.parts.savedata !== undefined);
  const plates = await F.readImportFile("2026_platedata.bin", new Uint8Array(cmp));
  check("bare: the name decides the part", eq(Object.keys(plates.body.parts), ["platedata"]), JSON.stringify(plates.body));
  await rejects("bare: empty", F.readImportFile("savedata.bin", new Uint8Array(0)), /empty/);
  await rejects("bare: over 1 MB", F.readImportFile("savedata.bin", new Uint8Array(1024 * 1024 + 1)), /over 1 MB/);
  await rejects("bare: a picture is not a save", F.readImportFile("photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])), /not a zip/);

  // ---- refusals
  await rejects("not a zip", F.readImportFile("save.zip", new Uint8Array([1, 2, 3, 4])), /not a zip/);
  await rejects("no save files", F.readImportFile("x.zip", pyZip([["notes.txt", b64("hello")]])), /no save files/);
  const many = [];
  for (let i = 0; i < 21; i++) many.push(["f" + i + ".txt", b64("x")]);
  await rejects("too many files", F.readImportFile("x.zip", pyZip(many)), /more than 20 files/);
  await rejects("part over 1 MB", F.readImportFile("x.zip", pyZip([["savedata.bin", Buffer.alloc(1024 * 1024 + 1).toString("base64")]])), /over 1 MB/);
  try {
    F.makeBackupZip({ manifest: "{}", signature: "", parts: {} });
    check("empty backup refused", false, "made a zip");
  } catch (err) {
    check("empty backup refused", err.player === true && /no save data/.test(err.message), err.message);
  }

  // ---- names
  check("partFor skinhist", F.partFor("2026_SKINHIST.bin") === "skin_hist");
  check("partFor savedata first", F.partFor("savedata_platedata.bin") === "savedata");
  check("safeName", F.safeName("ハンター") === "character" && F.safeName("Al-ex_1!") === "Al-ex_1");
  check("crc32", F.crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);

  if (failures.length) {
    console.log(failures.join("\n"));
    console.log(failures.length + " difference(s)");
    process.exit(1);
  }
  console.log("backup files OK");
})().catch((err) => { console.error(err); process.exit(1); });
