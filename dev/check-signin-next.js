#!/usr/bin/env node
/* Checks js/signin-next.js: which ?next= values the home page follows after sign-in (same-site paths only),
   the note it shows, and the sign-in address the builders and the account page send visitors to.

     node dev/check-signin-next.js

   Exit code 0 = every case as expected, 1 = a difference (listed one per line). */
"use strict";

const path = require("path");
const Next = require(path.join(__dirname, "..", "js", "signin-next.js"));

const failures = [];
const same = (label, got, want) => { if (got !== want) failures.push(label + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want)); };

// Followed as they are.
[
  "/road.html",
  "/quest-editor.html",
  "/quest-editor.html?draft=12",
  "/account.html#quests",
  "/road.html?entry=5#floors",
  "/road-vote.html",
  "/report.html#feature",
  "/monster.html?m=gore-magala",
  "/quests.html?q=a:b"          // a colon in the query is fine
].forEach((value) => {
  same("safe " + JSON.stringify(value), Next.safe(value), value);
});

// Refused: other sites, schemes, tricks browsers turn into another site, and the sign-in page itself.
[
  "", "road.html", "https://evil.example/", "http://evil.example", "//evil.example", "//evil.example/road.html",
  "///evil.example", "/\\evil.example", "\\\\evil.example", "/\\/evil.example", "javascript:alert(1)",
  "/javascript:alert(1)", "/a:b", "data:text/html,<script>alert(1)</script>", " /road.html", "/road.html ",
  "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/ /evil.example", "/\u0000/x", "/röad.html",
  "/∕∕evil.example", "／/evil.example", "/", "/index.html", "/?next=/road.html", "/index.html#login-form",
  "/" + "a".repeat(600), null, undefined, 42, {}, ["/road.html"]
].forEach((value) => {
  same("safe " + JSON.stringify(value), Next.safe(value), "");
});

// target(): the page after sign-in, from the home page's query string.
same("target road", Next.target("?next=%2Froad.html"), "/road.html");
same("target with query", Next.target("?next=" + encodeURIComponent("/quest-editor.html?draft=3")), "/quest-editor.html?draft=3");
same("target none", Next.target(""), "/account.html");
same("target other site", Next.target("?next=https%3A%2F%2Fevil.example"), "/account.html");
same("target protocol-relative", Next.target("?next=%2F%2Fevil.example"), "/account.html");
same("target backslash", Next.target("?next=%2F%5Cevil.example"), "/account.html");
same("target tab", Next.target("?next=%2F%09%2Fevil.example"), "/account.html");
same("target javascript", Next.target("?next=javascript%3Aalert(1)"), "/account.html");
same("target twice (first wins)", Next.target("?next=%2Froad.html&next=%2F%2Fevil.example"), "/road.html");
same("target twice (bad first)", Next.target("?next=%2F%2Fevil.example&next=%2Froad.html"), "/account.html");

// note(): what the form says.
same("note quest", Next.note("?next=%2Fquest-editor.html%3Fdraft%3D3"), "Sign in to use the Quest builder.");
same("note road", Next.note("?next=%2Froad.html"), "Sign in to use the Road builder.");
same("note account", Next.note("?next=%2Faccount.html%23quests"), "Sign in to open your account.");
same("note report", Next.note("?next=%2Freport.html%23feature"), "Sign in to report a problem.");
same("note other page", Next.note("?next=%2Fmonsters.html"), "Sign in to continue.");
same("note none", Next.note(""), "");
same("note hostile", Next.note("?next=%2F%2Fevil.example"), "");

// signinUrl(): where a signed-out visitor is sent.
same("signin road", Next.signinUrl("/road.html?entry=5"), "/?next=%2Froad.html%3Fentry%3D5#login-form");
same("signin account", Next.signinUrl("/account.html#quests"), "/?next=%2Faccount.html%23quests#login-form");
same("signin hostile", Next.signinUrl("//evil.example"), "/#login-form");
// and back again: the home page reads exactly the path it was given
const back = Next.target(new URL("https://x" + Next.signinUrl("/quest-editor.html?draft=7#map")).search);
same("round trip", back, "/quest-editor.html?draft=7#map");

if (failures.length) {
  console.log(failures.join("\n"));
  console.log(failures.length + " difference(s)");
  process.exit(1);
}
console.log("sign-in return OK");
