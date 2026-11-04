/* What each event is and how it works: the text behind the Events page's cards (js/events.js). One entry per
   event key; edit the text here when a rule, a reward or a date changes. Game terms, no internal ids.

   Entry fields (all optional except what):
     what   1-2 sentences: what the event is
     steps  how to take part, in order (the NPC, counter or menu, and what to do)
     gets   what you get (rewards, with the numbers of our setup)
     when   the schedule (the card itself shows the live dates)
     tips   short tips and "new, not much played yet" notes
     links  [text, href] pairs: guide section, Tournaments, changelog

   Keys: diva, mezfes, campaigns, speedrun_cup, vs_bracket, festival, raviente, caravan_rankings, sky_corridor,
   road_vote, event_quests. Times are UTC; the game's own resets are on Japan time (JST = UTC+9). */
(function () {
  "use strict";

  var CHANGELOG = ["Changelog, 4 Nov events", "/changelog.html#d-2026-11-04-events"];
  var GUIDE = "/guide-frontier-events.html";

  var INFO = {
    diva: {
      what: "A 3-week event where you and your guild hunt Diva quests for points. Points turn into reward songs, items and Diva coins. New on our server and not much played yet.",
      steps: [
        "In town, open the Diva Defense menu and pick one Prayer Gem a day in week 1 (Storm, Power, Unity or Song Guard). A day you miss is filled in, so you can start late.",
        "Hunt. Check View Bonus Tasks each day: every gem gets 3 Diva quests that give 200% points. Each clear adds event points for you and your guild.",
        "Week 2 is guild week: your guild's progress fills its map, and you can listen to a reward song you earned (it lasts 1 hour).",
        "Week 3: open View/Claim Rewards and take your personal, guild and ranking rewards, then spend Diva coins in the coin shop."
      ],
      gets: [
        "Personal rewards by event points, all reached at 14,000 points: a Ranze L Tkt from 1 point, 30,000 Cheques, GCP, Legendary Rasta Tkts, Neko Jewels, Pawstamps and Diva coins.",
        "8 reward songs, from 300 to 14,000 points.",
        "Guild rewards by guild progress (1 step per 100 guild points, full at 100): Guild Tickets, food, Cat Eye Ore and Gem, and 50,000 GCP at the top.",
        "Ranking rewards (Mega Dash Juice, Demondrug, Mega Demondrug, Might Pill, Armorskin): every guild with points gets at least one.",
        "Diva coins buy items in the coin shop: 12 items at 1 to 3 coins each."
      ],
      when: "A 3-week cycle that repeats by itself, from Mon 2 Nov: week 1 (personal points) until 9 Nov, week 2 (guild week) until 16 Nov, week 3 (rewards and coin shop) after that. The next cycle starts 23 Nov. Weeks turn over at 03:00 UTC (12:00 JST).",
      tips: [
        "You claim up to 32 rewards at a time: claim again if you have more.",
        "The guild map is a simple row of 10 cells, one per 10 steps of progress.",
        "Not tested in game yet: what a reward song does, the GCP skills and the Diva GCP shop."
      ],
      links: [["Guide: Diva Defense", GUIDE + "#diva-basics"], CHANGELOG]
    },

    mezfes: {
      what: "The Mezeporta Festival: a minigame area with tickets and a prize exchange. On our server it is open every day (it used to be weekends only).",
      steps: [
        "Choose the MezFes world in the world list.",
        "Walk into the festival area and play the minigames (Tokotoko Partnya) with your tickets.",
        "Trade what you win at the festival's prize exchange."
      ],
      gets: [
        "5 solo tickets and 1 group ticket each week.",
        "The minigame prizes and exchange items of the festival, as in the original game."
      ],
      when: "Every day. Tickets refill each Monday at 00:00 JST (Sunday 15:00 UTC).",
      tips: [
        "If you are online at the Monday refill, log in again to get the new week's tickets.",
        "New and not tested in the game yet: tell us on Discord if something misbehaves."
      ],
      links: [["Worlds", "/worlds.html"], CHANGELOG]
    },

    campaigns: {
      what: "Starter and weekly item packs from the Event Campaigns screen in town. Free, nothing to hunt for.",
      steps: [
        "In town, open the Event Campaigns screen.",
        "Choose a pack. The screen shows its items.",
        "Receive it. The items go into your item box."
      ],
      gets: [
        "New & Returning Hunter Pack, once per character: Mega Potion x10, Max Potion x3, Ancient Potion x2, Mega Nutrients x5, Mega Demondrug x5, Mega Armorskin x5, Energy Drink x5, Lifepowder x5, Goushu Ticket x3, Guild Point Tkt x3, Sigil Mat Ticket x2, Tower Medal x3.",
        "Weekly Supply Drop, every Monday: Mega Potion x5, Max Potion x1, Energy Drink x3, Mega Demondrug x2, Mega Armorskin x2, Lifepowder x2, Goushu Ticket x1, Guild Point Tkt x1, Tower Medal x1."
      ],
      when: "Always open. The Weekly Supply Drop can be received again every Monday from 00:00 JST (Sunday 15:00 UTC).",
      tips: [
        "Leave room in your item box: the pack takes 12 slots, the weekly drop 9.",
        "Each character can receive the pack once, so a new character gets its own.",
        "New and not tested in the game yet."
      ],
      links: [CHANGELOG]
    },

    speedrun_cup: {
      what: "A weekly timed-clear contest on one event quest. There is nothing to sign up for: clear the quest, and your fastest time counts. New, not much played yet.",
      steps: [
        "Open the event quest list at the quest counter in town. The week's two Cup quests are in it: one solo and one for a group of four.",
        "Clear one as fast as you can. You can try again; your fastest clear counts.",
        "Look at the standings on the in-game ranking screen or on the Tournaments page: solo by weapon type, group in one list.",
        "After the tally, your prize is in the gift box."
      ],
      gets: [
        "Everyone with a time: Speedrun Cup prize with White Half-Tkt x3, Cuff Base White x2 and a Competition Ticket x1.",
        "Top 10: 2 more Competition Tickets. First place: a Champion Tkt."
      ],
      when: "Every week. The first cup opens Thu 5 Nov at 15:00 UTC (Fri 6 Nov, 00:00 JST). Clears count for 6 days, until Wednesday 15:00 UTC; the tally takes about an hour, then the results stay up until the next cup. The quest changes each week: Espinas, then Breeding Hypnocatrice, and so on.",
      tips: [
        "One clear of either quest is enough for the prize.",
        "Your solo time goes in the list of the weapon type you saved with before the quest.",
        "No weapon rules: bring your best gear."
      ],
      links: [["Standings", "/tournaments.html#cup"], ["Quest catalog", "/quests.html"], CHANGELOG]
    },

    vs_bracket: {
      what: "A knockout bracket you play whenever you like. You and your opponent each clear the round's quest alone during the round, and the faster clear goes on. New, not much played yet.",
      steps: [
        "During sign-up, type !vs join in chat, or apply on the VS Tournament screen. !vs leave takes you out again. Up to 32 hunters.",
        "After the draw (in sign-up order), type !vs to see your match: the quest, your opponent and the time left. !vs bracket shows the whole bracket.",
        "Your round's quest is in your event quest list. Clear it alone, any time during the round.",
        "The faster clear goes on to the next round. After the last round, prizes are in the gift box."
      ],
      gets: [
        "Everyone with at least one clear: White Half-Tkt x3 and Competition Ticket x1.",
        "Quarter-finals or better: Cuff Base White x2. Semi-finals or better: 2 more Competition Tickets.",
        "The two finalists get a Champion Tkt, and the champion a second one."
      ],
      when: "A bracket every 14 days. Sign-up opens Thu 5 Nov at 15:00 UTC (Fri 6 Nov, 00:00 JST) and closes Sunday 8 Nov at 15:00 UTC, when the draw is made. Each round then lasts 2 days. With fewer than two hunters there is no bracket that time.",
      tips: [
        "If neither of you clears, the one who signed up first goes on. If only one of you clears, that hunter goes on. A hunter with no clear gets no prize, even after a walkover.",
        "A round's quest can be the same as the week's Cup quest: one clear then counts for both."
      ],
      links: [["Bracket", "/tournaments.html#bracket"], CHANGELOG]
    },

    festival: {
      what: "The Hunter Festival: two teams, Red and Blue, compete by collecting Souls, and your Souls buy festival prizes. Guilds take part together.",
      steps: [
        "Sign-up week: the guild leader, or a vice-leader, signs the guild up. It is given Red or Blue at random. Hunters vote on the trials.",
        "Soul week: hunt, and hand your Souls in to the Festival Manager near the blacksmith. You carry 500 Souls at most, so hand in often, or turn on the automatic hand-in in Options, then Other.",
        "After the judging (2.5 hours) the winner is shown.",
        "Prize weeks: use your Souls on the prize table (below on this page), and pick up the once-only final reward."
      ],
      gets: [
        "Prizes in tiers by Souls: see the Festa prizes table on this page.",
        "A final reward, once per festival."
      ],
      when: "A festival is about 8 weeks: 14 days of sign-up and trial vote, 21 days of Souls, 2.5 hours of judging, then 21 days of prizes. Festivals now follow each other back to back: the next one starts on 17 Nov at 15:00 UTC, and each later one at the first midnight JST after the last one's prizes end.",
      tips: [
        "Soul Gems (20, 40 or 80 Souls) and a Diva Song add extra Souls to a quest.",
        "From 17 Nov the festival uses a curated list of easier prizes.",
        "The festival points exchange has no entries here; Secret Quests and Winners' Quests were not checked."
      ],
      links: [["Guide: Hunter Festival", GUIDE + "#festival-basics"], ["Festa prizes", "#festa-prizes"], CHANGELOG]
    },

    raviente: {
      what: "A server-wide hunt of the giant snake Raviente (the Great Slaying), in groups of four: up to 8 hunters at HR2 or HR5, up to 32 at G Rank. It is open all the time.",
      steps: [
        "Talk to Kieru in the Caravan area and choose Join / Start / Quit Raviente.",
        "Wait for enough hunters (usually 4 at HR2 and HR5, 24 at G Rank). The organiser can start as soon as the minimum has joined.",
        "When it starts, the quest board shows 9 hunting quests and a carving quest. Hunt, break parts and support the others to earn Contribution Points.",
        "Afterwards, pick up your rewards from Kieru (Claim Rewards)."
      ],
      gets: [
        "Contribution Points, which raise your Caravan Gem.",
        "Raviente materials for Raviente weapons and armour, and the decorations from them."
      ],
      when: "Always open, with no set time. Ask in Discord to gather a group.",
      tips: [
        "Stay until the phase vote. If you leave before it and the event resets, you can lose the reward (a known problem).",
        "Do not try the big G Rank hunts without a good Caravan Gem and gear."
      ],
      links: [["Guide: Raviente", GUIDE + "#raviente-about"], ["Guide: joining one", GUIDE + "#raviente-posting"], ["Discord", "https://discord.gg/YuE42eh"]]
    },

    caravan_rankings: {
      what: "Weekly rankings of caravan merit points, for hunters and for guilds. They are always on. There are no gifts for them.",
      steps: [
        "Clear caravan quests: each one earns merit points, counted for this week.",
        "Open the caravan screens in the Caravan area to see the personal and the guild boards."
      ],
      gets: [
        "Your place on the boards. There are no weekly gifts."
      ],
      when: "Always on. Each week's points count for that week.",
      tips: [
        "The boards show this week only; they start again from zero each week."
      ],
      links: [["Guide: Caravan", GUIDE + "#caravan-area"]]
    },

    sky_corridor: {
      what: "The Sky Corridor (the Tower): climb its floors, clear Duremudira quests and push the town's progress in each district. Open since 3 Nov.",
      steps: [
        "From about Hunter Rank 31 a town event introduces the Tower. Take a tower quest at the tower counter.",
        "Clear it. Each cleared tower quest counts as a tower clear in its district, plus the floors you climbed; killing Duremudira counts once per party toward the town's Duremudira goal.",
        "Check the town's progress, the boards, your guild's missions and the present box on the Sky Corridor page.",
        "Pick up the present box rewards from the present box in town."
      ],
      gets: [
        "Treasure chests, Tower Medals and the materials for Tower weapons and armour.",
        "Present box rewards, once per hunter, at milestones of floors or tower clears.",
        "Guild missions in pages of three goals, at half the original goals."
      ],
      when: "Always open. The floors rotate each week.",
      tips: [
        "Clears of hunters without a guild count since the client patch of 4 Nov: download the patch again, or let the launcher fetch it.",
        "The game shows districts 1 and 2 in town; 3 and 4 are counted but not shown."
      ],
      links: [["Sky Corridor", "/sky-corridor.html"], ["Guide: Tower Medals", "/guide-frontier-hunters-road.html#tower-medals"], ["Changelog, 3 Nov", "/changelog.html#d-2026-11-03-sky-corridor"]]
    },

    road_vote: {
      what: "Players design the next Hunting Road. Submit a Road, vote for your favourites, and the winner goes live for everyone.",
      steps: [
        "Sign in to the website with your Hunsterverse account.",
        "While entries are open, build a Road in the Road builder and submit it.",
        "While the vote is open, vote for your favourite on the Rotation and vote page.",
        "When the vote closes, the winner replaces the live Road. Choose it at the Hunting Road in game."
      ],
      gets: [
        "A new Road for everyone every rotation, and credit on the vote page for the winning design.",
        "Every Road the server has run stays playable and keeps its own board."
      ],
      when: "A new rotation every two weeks: about a week of entries, then about a week of voting. The vote page shows the exact dates.",
      tips: [
        "You need a Hunsterverse account to submit and vote.",
        "Past winners and the Road data are on the site."
      ],
      links: [["Rotation and vote", "/road-vote.html"], ["Road builder", "/road.html"], ["Past winners", "/road-history.html"], ["Guide: Roads in game", "/guide-roads.html"]]
    },

    event_quests: {
      what: "The event quest list at the quest counter: seasonal events, Raviente, Diva Defense and the Cup and bracket quests. All 390 loaded quests are always listed; the pool is further down this page.",
      steps: [
        "Open the event quest list at the quest counter in town.",
        "Pick a quest and take it, alone or with a party.",
        "To read about a quest first, find it in the pool on this page and open its page."
      ],
      gets: [
        "Each quest's own rewards, as its page shows them: monster materials and the items of its event.",
        "Clearing a Cup or bracket quest also counts for that tournament's prizes."
      ],
      when: "Always listed: the pool does not rotate yet. The Cup and bracket quests appear only while they are on.",
      tips: [
        "Filter the pool by quest number or type."
      ],
      links: [["Event quest pool", "#event-quests"], ["Quest catalog", "/quests.html"]]
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = INFO;
  else window.HvEventInfo = INFO;
})();
