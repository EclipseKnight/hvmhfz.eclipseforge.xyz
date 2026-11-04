#!/usr/bin/env node
/* Checks js/link-command.js: the account page shows "/link code:<code>", built from the API's token (never
   the old "!f link <token>" text), also when the answer only has the old `command`.

     node dev/check-link-command.js

   Exit code 0 = every case as expected, 1 = a difference (listed one per line). */
"use strict";

const path = require("path");
const Link = require(path.join(__dirname, "..", "js", "link-command.js"));

const failures = [];
const same = (label, got, want) => { if (got !== want) failures.push(label + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); };

same("token and old command", Link.command({ linked: false, token: "AbC123", command: "!f link AbC123" }), "/link code:AbC123");
same("token only", Link.command({ linked: false, token: "AbC123" }), "/link code:AbC123");
same("old command only", Link.command({ linked: false, command: "!f link AbC123" }), "/link code:AbC123");
same("token wins over command", Link.command({ token: "NEW", command: "!f link OLD" }), "/link code:NEW");
same("code", Link.code({ token: "AbC123", command: "!f link AbC123" }), "AbC123");
same("no code", Link.command({ linked: false }), "/link code:...");
same("empty token", Link.command({ token: "", command: "" }), "/link code:...");
same("token with a space is not used", Link.command({ token: "a b" }), "/link code:...");
same("null", Link.command(null), "/link code:...");
["token", "command"].forEach((k) => {
  const out = Link.command({ [k]: "!f link X" });
  if (out.indexOf("!f") !== -1) failures.push("the old !f text leaked into " + JSON.stringify(out));
});

if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
console.log("link command OK");
