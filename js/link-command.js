/* The Discord link command the account page shows. The bot has the slash command /link (option "code"); the
   API's answer still carries the older text "!f link <token>" in `command`, so the command is built here from
   its `token` (or, for an API that sends only `command`, from the token inside it). Also runs under node
   (dev/check-link-command.js). */
(function (root) {
  "use strict";

  /* The activation code of the API's /api/account/discord answer, or "". */
  function code(discord) {
    if (!discord) return "";
    if (typeof discord.token === "string" && /^\S+$/.test(discord.token)) return discord.token;
    var m = typeof discord.command === "string" && /^\s*(?:!f\s+)?link\s+(\S+)\s*$/i.exec(discord.command);
    return m ? m[1] : "";
  }

  /* "/link code:<code>", or "/link code:..." when the answer has no code. */
  function command(discord) {
    return "/link code:" + (code(discord) || "...");
  }

  var api = { code: code, command: command };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HvLinkCommand = api;
})(typeof window !== "undefined" ? window : this);
