/* Hunting Road rewards on the account page: the pure part (labels and the claim body). account.js
   draws the cards with it.

   GET /api/road/rewards answers one row per Road and board: {cycleId, number, board, place, tier,
   entryName, floor, points, claimable, claimed, reason}. board is "design" (the place in the vote,
   with the entry's name) or "score" (the place on the floor clear board, with floor and points).
   Answers from before the API had boards have one row per Road with no board, place or tier; those
   rows show as before, and their claim is sent without a board (the API takes that as design).

   Also runs under node: dev/check-road-rewards.js tests it. */
(function (root) {
  "use strict";

  var BOARDS = { design: "design vote", score: "floor clear board" };

  function has(value) {
    return value !== null && value !== undefined && value !== "";
  }

  /** The card's heading: the rotation and its board. */
  function title(reward) {
    var board = BOARDS[reward.board];
    if (!board) return "Rotation " + reward.number + (reward.entryName ? ": " + reward.entryName : "");
    return "Rotation " + reward.number + ", " + board;
  }

  /** The place line: place, tier, then the entry (design) or floor and points (score). "" for none. */
  function details(reward) {
    var parts = [];
    if (has(reward.place)) parts.push("Place " + reward.place);
    if (has(reward.tier)) parts.push(reward.tier);
    if (reward.board === "design" && has(reward.entryName)) parts.push("entry " + reward.entryName);
    if (reward.board === "score") {
      if (has(reward.floor)) parts.push("floor " + reward.floor);
      if (has(reward.points)) parts.push(Number(reward.points).toLocaleString("en-US") + " points");
    }
    return parts.join(" · ");
  }

  /** The body of POST /api/road/rewards/claim for this row; board only when the row has one. */
  function claimBody(reward, characterId) {
    var body = { cycleId: reward.cycleId, characterId: Number(characterId) };
    if (has(reward.board)) body.board = reward.board;
    return body;
  }

  var api = { title: title, details: details, claimBody: claimBody };
  root.RoadRewards = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
