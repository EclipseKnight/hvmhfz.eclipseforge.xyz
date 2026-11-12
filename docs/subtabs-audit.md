# Page-length audit for the sub-tabs proposal

## Method

Every top-level `*.html` page of a pristine copy of the site (`git archive HEAD` into `/tmp/subtabs-base`, so the other session's edits are not in it) was loaded in headless Chromium (Playwright) at 375x812 and 1280x800. Skipped: `404.html` and the `s/` share pages. A small Node server serves the copy. Network access was blocked: the API (`api.hvmhfz.eclipseforge.xyz`) is a stub, `challenges.cloudflare.com` and every other third-party host are aborted, so nothing leaves the machine. After "load", network idle and 600 ms the script reads the document height (scrollHeight) and splits the content under `main` into blocks. It looks at the direct children of `main`; if there are fewer than 3 it goes into the tallest child, and if a container has 3 or more `h2` children it cuts the page at each `h2` (guides). A block's height is the distance from its top to the next block's top (so margins count). Lists with more than 20 blocks merge consecutive blocks under 120 px. Screens = height / viewport height (812 px at 375, 800 px at 1280).

`account.html` and `admin.html` were opened signed in (a fake JWT in `hvmhfz.token`) with fake answers for /api/account, characters (3), guild (1 guild, 8 members), discord, hunts, gifts, Road rewards, custom quests, the game options list (`/api/account/qol`, a pre-release slot so every switch, the Keys and Viewer parts show), Client patch (`/api/account/patch-channel`, 2 slots, 3 characters), and for admin the permissions, users, flags, patch slots and gift options. Each tab was loaded on its own through its `#hash` and measured by its `#panel-<tab>`. `weapons.html` (it has two tabs) was measured the same way. All other pages got 404 from the API, so pages that fill from the API (hunters, guilds, leaderboards, tournaments, road vote and history, worlds charts, the admin tabs that had no stub: Events, Settings, Notices, Content, Balance, Road, Quests, Server, Audit) show their empty or "could not load" state. **Their heights are floors; real data makes them longer.** Pages fed by the site's own JSON in `/data` (monsters, items, weapons, quests) are real. `item.html` and `monster.html` were opened with `?id=7` and `?m=rathalos`. `road.html`, `quest-editor.html` and `report.html` need a session (signed out they go to the home page), so they were measured signed in.

Script: `/srv/devbot/.bot-logs/subtabs/audit.js`. Raw numbers: `/srv/devbot/.bot-logs/subtabs/audit.json`. Screenshots: `/srv/devbot/.bot-logs/subtabs/audit/<page>[-<tab>]-<width>.jpg` (JPEG, full page; pages taller than 6 screens are cut to the first 6 screens). In the section lists below the header and footer chrome (breadcrumbs, kicker, lead line, pager, credit) is left out, so the sections do not add up to the full height.

## Built so far: the Account page (branch `subtabs`)

The shared component is `js/subtabs.js` (README, "Sub-tabs"). The account page's long "Account" tab is split into
Game options, Client patch, Diagnostics and Account (details and session), so the page has 11 tabs; Keys, Viewer
options and the pre-release options in Game options are folds (the pre-release fold opens by itself for an account on
a pre-release patch). Measured again with the same script and stubs (`audit-after.js`, screenshots in
`/srv/devbot/.bot-logs/subtabs/after-audit/`):

| Tab | Before @375 | After @375 | Before @1280 | After @1280 |
|---|---|---|---|---|
| Account (old: Road, Game options, Client patch, Diagnostics, Account, Session) | 10.6 | 1.8 | 8.4 | 1.5 |
| Game options (new) | - | 2.4 | - | 1.9 |
| Client patch (new) | - | 2.3 | - | 1.8 |
| Diagnostics (new) | - | 2.4 | - | 1.6 |
| Longest other tab (Characters, unchanged) | 3.6 | 3.6 | 2.6 | 2.6 |

## All pages, longest first at 375 px

For `account`, `admin` and `weapons` the numbers are for the longest tab (named in brackets).

| Page | Screens @375 | Screens @1280 | Sections |
|---|---|---|---|
| guide-frontier-armour.html | 187.1 | 70.2 | 14 |
| guide-frontier-events.html | 108.8 | 64.1 | 17 |
| guide-frontier-basics.html | 82.7 | 52.8 | 20 |
| guide-frontier-house.html | 79.8 | 50.6 | 15 |
| guide-frontier-hunsterverse.html | 63.7 | 26.3 | 26 |
| guide-frontier-g-rank.html | 57.7 | 34.9 | 19 |
| guide-frontier-weapons.html | 54.7 | 33.2 | 17 |
| guide-frontier-g-rank-start.html | 53.2 | 33.4 | 19 |
| road-data.html | 47.4 | 19.5 | 5 |
| guide-frontier-hunter-rank.html | 47.1 | 27.7 | 19 |
| guide-frontier-items.html | 41.6 | 26.2 | 13 |
| guide-frontier-hunters-road.html | 40.4 | 24.3 | 16 |
| monsters.html | 39.2 | 12.3 | 3 |
| guide-frontier-zenith.html | 32.5 | 17.4 | 13 |
| guide-frontier-guild.html | 26.7 | 16.6 | 14 |
| weapons.html (tab database) | 25.7 | 16.5 | 4 |
| guide-frontier-menus.html | 23.8 | 18.3 | 17 |
| guide-frontier-quests-food.html | 23.3 | 15.9 | 16 |
| guide-linux.html (redirects to play.html#linux) | 21.0 | 10.7 | 8 |
| guide-windows.html (redirects to play.html#windows) | 21.0 | 10.7 | 8 |
| play.html | 21.0 | 10.7 | 8 |
| guide-frontier-monsters.html | 18.8 | 9.7 | 9 |
| guide-frontier-tools.html | 16.3 | 17.7 | 14 |
| guide-frontier-transcend.html | 14.0 | 9.9 | 11 |
| changelog.html | 13.1 | 8.4 | 4 |
| privacy.html | 12.4 | 6.5 | 9 |
| account.html (tab account) | 10.6 | 8.4 | 6 |
| guide-frontier-item-box.html | 8.6 | 6.3 | 12 |
| guide-frontier-activities.html (redirects to guide-frontier.html#activities) | 7.1 | 4.9 | 12 |
| guide-frontier-equipment.html (redirects to guide-frontier.html#gear) | 7.1 | 4.9 | 12 |
| guide-frontier-reference.html (redirects to guide-frontier.html#reference) | 7.1 | 4.9 | 12 |
| guide-frontier.html | 7.1 | 4.9 | 12 |
| api.html | 6.9 | 5.2 | 9 |
| guide-roads.html | 6.5 | 4.7 | 9 |
| quests.html | 6.5 | 4.8 | 3 |
| index.html | 6.0 | 3.3 | 4 |
| bot-terms.html | 5.5 | 3.7 | 8 |
| admin.html (tab events) | 4.9 | 3.1 | 19 |
| events.html | 4.6 | 2.5 | 3 |
| worlds.html | 4.0 | 3.3 | 8 |
| monster.html | 3.9 | 3.0 | 3 |
| item.html | 3.7 | 3.1 | 5 |
| catalog.html (redirects to items.html) | 3.5 | 3.8 | 3 |
| items.html | 3.5 | 3.8 | 3 |
| report.html | 3.5 | 3.1 | 5 |
| database.html | 2.5 | 1.7 | 5 |
| sky-corridor.html | 2.5 | 1.5 | 4 |
| road-history.html | 2.0 | 1.5 | 5 |
| set-builder.html | 2.0 | 1.7 | 3 |
| leaderboards.html | 1.9 | 1.5 | 4 |
| road-vote.html | 1.9 | 1.4 | 4 |
| road.html | 1.9 | 1.4 | 5 |
| tournaments.html | 1.8 | 1.4 | 4 |
| guilds.html | 1.5 | 1.1 | 6 |
| hunters.html | 1.5 | 1.1 | 5 |
| quest-editor.html | 1.5 | 1.3 | 4 |
| balance.html | 1.3 | 1.0 | 3 |
| quest.html | 1.2 | 1.0 | 3 |

## Pages over about 4 screens at 375 px, longest first

Heights are px at 375 / px at 1280.

**Guide pages (all `guide-frontier-*.html`).** Each guide has a collapsed "On this page" list (`details.hb-toc`) at the top, not a side contents. They are 8 to 187 screens at 375 and have 9 to 20 `h2` sections, many linked by `#anchor` from other pages and from search. Tabs are a poor fit: they would hide anchored text, break reading in order and Ctrl+F, and a guide has too many sections for a tab bar. Proposal for all guides: a sticky "On this page" bar under the site header (shows the current section, tap to open the same list), plus `<details>` (closed, opened by `#anchor`) for the one or two giant reference sections. Where the sections fall into 2 to 5 clear topics (events, house) tabs can work as an extra; those are noted below.

### guide-frontier-armour.html - 187.1 screens at 375, 70.2 at 1280

Sections: Armour, Decorations and Skills 96/77; Making armour 3,069/1,697; Armour types 9,392/5,329; Transmog 921/605; Armour and icon colours 3,601/2,170; Decorations 5,842/2,990; Building sets 806/512; Skills 3,683/2,036; Skill reference 100,430/33,033; Zenith skills 22,660/6,752.

**Proposal:** Sticky "On this page". The Skill reference section is 100,430 px at 375 (124 screens, 54% of the page) and Zenith skills adds 22,660 px. Make "Skill reference" (`#skill-reference`) and "Zenith skills" two sub-tabs of a "Skills" group, or fold each into `<details>` closed by default and opened by its anchor. Keep Making armour, Armour types, Transmog, Colours, Decorations and Building sets as the always-open main flow.

### guide-frontier-events.html - 108.8 screens at 375, 64.1 at 1280

Sections: Regular Events 63/77; Event roster 2,418/1,358; Hunter Festival 10,196/6,114; Diva Defense 8,788/5,519; Prayer Weapons and Guild Interception 13,554/8,825; Caravan 1,324/790; Caravan Gems 5,648/3,467; Caravan skills 12,480/4,552; Pioneering System 3,684/2,111; Raviente 8,638/5,394; Berserk Raviente (G Rank) 12,280/7,151; Raviente weapons and armour 4,845/3,026; Extreme Raviente 3,073/1,948.

**Proposal:** Sticky "On this page". Tabs fit best here because events are separate topics: Events overview (`#event-roster`, Hunter Festival), Diva Defense, Prayer weapons, Caravan (Caravan, Gems, skills, Pioneering), Raviente (Raviente, Berserk, weapons, Extreme). Above the tabs: title, lead and the Event roster table. Five tabs would bring the longest view from 109 to about 30 screens at 375.

### guide-frontier-basics.html - 82.7 screens at 375, 52.8 at 1280

Sections: Basics and Getting Started 63/77; Welcome to Frontier 1,112/669; Where to go next in this guide 1,170/652; Getting started: install, account and character 2,421/1,411; First login and settings 2,008/2,424; The town and Hunter Rank 1 1,673/1,017; Hunter Rank 2 4,224/2,688; Hunter Rank 3 and 4 4,304/2,815; Hunter Rank 5: where the game starts 11,300/6,693; Hunter Rank 6 and 7: the road to G Rank 3,156/1,985; The newbie server and subscriptions 1,235/700; Controls, menus and chat 2,483/1,551; Daily routine 3,030/1,831; Subscriptions, courses and paid items 9,580/5,653; Japanese-server tips 2,706/1,661; The ZZ update: Magnet Spike, Zenith Sigils, GR999 and more 15,306/9,500.

**Proposal:** Sticky "On this page". Fold: Japanese-server tips, Subscriptions and courses, and the ZZ update section (15,306 px) in `<details>`, closed. Always visible: Welcome, Where to go next, Getting started, First login. The Hunter Rank 2 to 7 sections could become one tab "Hunter Rank steps"; the rest stays in the page.

### guide-frontier-house.html - 79.8 screens at 375, 50.6 at 1280

Sections: House and AI Companions 63/77; House 1,172/700; Gook Farm 7,165/4,350; Pugi Farm (My Tore) 10,362/6,290; Airou Plaza 5,558/3,191; SR Challenge Room 500/382; AI Companions 755/483; Halks 2,502/1,433; Felyne Partnyaas 11,383/7,127; Fostas and Rastas 2,325/1,577; Partners 21,626/13,938.

**Proposal:** Sticky "On this page". Two tabs: "House" (House, Gook Farm, Pugi Farm, Airou Plaza, SR Challenge Room) and "Companions" (AI Companions, Halks, Felyne Partnyaas, Fostas and Rastas, Partners). Partners (21,626 px) folds in `<details>`. Above the tabs: title, lead.

### guide-frontier-hunsterverse.html - 63.7 screens at 375, 26.3 at 1280

Sections: 2 small blocks 117/198; The short version 1,567/735; Course (subscription) perks 1,218/708; Every section, compared 238/191; ul.hv-counts 146/45; Basics and Getting Started 6,767/2,070; English Guild and Guild Hall 2,111/900; House and AI Companions 2,205/848; Menus and Town NPCs 2,978/1,133; Items and Materials 1,486/709; Equipment and Item Boxes 1,098/542; Weapons and Sigils 2,167/866; Armour, Decorations and Skills 2,295/803; Transcend 1,118/497; Monsters 1,076/431; Tools and References 1,798/803; Hunter Rank and Style Rank 3,479/1,466; Starting G Rank 2,923/1,248; G Rank 4,162/1,588; Zenith (GR200+) 1,559/709; Quests, Food Buffs and Bentos 2,444/966; Regular Events 4,241/1,594; Hunter's Road 3,241/1,202; p 141/92.

**Proposal:** This is the overview of all guides, with one summary section per guide (Basics 6,767 px, G Rank 4,162, Regular Events 4,241 and so on). Sticky "On this page" is enough; fold each guide summary in `<details>` closed by default (the heading stays visible as the summary), and keep "The short version" and "Course (subscription) differences" always open. No tabs.

### guide-frontier-g-rank.html - 57.7 screens at 375, 34.9 at 1280

Sections: G Rank 63/77; Tips for early G Rank 2,348/1,466; G Rank quests 2,696/1,886; G Rank weapons 1,320/981; Making and using Sigils 2,294/1,346; G Rank armour 2,853/1,991; G Rank Pugi cuffs 1,334/736; G Rank decorations 5,285/2,838; Exotic equipment and G Finesse weapons 3,623/2,245; Special equipment and the Shiusu set 2,811/1,479; Conquests 3,641/2,022; The Diva 2,602/1,503; Proper G Rank sets and max rank benefits 1,938/1,070; Hiden decorations 12,062/6,896; Berserk Raviente 637/416.

**Proposal:** Sticky "On this page". Fold Hiden decorations (12,062 px) and G Rank decorations (5,285 px) in `<details>`. Optional tabs: "Quests and conquests", "Gear" (weapons, sigils, armour, cuffs, decorations, exotic and special equipment), "Extras" (Diva, sets, Berserk Raviente). Always visible: Tips for early G Rank.

### guide-frontier-weapons.html - 54.7 screens at 375, 33.2 at 1280

Sections: Weapons and Sigils 63/77; Weapon types 1,302/1,108; Making weapons 966/577; Weapon families 4,511/2,654; Gou weapon boosts 1,306/900; Elements and properties 1,566/1,276; Melee weapons 1,480/1,005; Bowguns 2,367/1,465; Bows 1,817/1,481; Active Feature 1,705/1,148; Weapon styles and motion values 590/455; Hunting Horn songs 5,469/3,453; Sigils 19,942/9,994.

**Proposal:** Sticky "On this page". Sigils is 19,942 px (36% of the page) and Hunting Horn songs 5,469 px: fold both in `<details>`, closed. Keep Weapon types, Making weapons and Weapon families open.

### guide-frontier-g-rank-start.html - 53.2 screens at 375, 33.4 at 1280

Sections: Starting G Rank 63/77; First steps in G Rank 1,404/781; Hunter Navigation tasks 19,066/12,207; Easy equipment 3,430/1,874; G Class decorations 1,662/1,013; Newbie server quests 2,590/1,385; Attack Ceiling and SR skills 1,168/753; Pugi cuffs and whetstones 3,370/2,134; Hardcore and Supremacy reminders 917/551; Gou equipment in G Rank 1,790/1,085; GZeny 753/483; Gunner sets 631/410; Guild Pugis 1,184/731; AI companions 2,418/1,483; Your first proper set 1,367/853.

**Proposal:** Sticky "On this page". "Hunter Navigation tasks" is 19,066 px (44%): fold in `<details>` or make it its own tab. The other 15 sections are short (600 to 3,400 px) and stay in the page.

### road-data.html - 47.4 screens at 375, 19.5 at 1280

Sections: Hunting Road data 392/249; How to read it 505/284; Zenith Road (base Road, number 0) 20,337/7,911; Original Road (base Road, number -1) 16,651/6,714.

**Proposal:** Two sub-tabs: "Zenith Road" (`#zenith`, 20,337 px at 375) and "Original Road" (`#original`, 16,651 px), each with Open Road and Solo Road. Above the tabs: title and "How to read it" (897 px). Alternatively one tab per Road and Open/Solo as a switch. This halves the page.

### guide-frontier-hunter-rank.html - 47.1 screens at 375, 27.7 at 1280

Sections: Hunter Rank and Style Rank 96/77; Starting out (HR1 to HR4) 2,504/1,386; Key quests and Urgents 1,095/682; HR2, HR3 and HR4 1,636/1,114; HR5: where the game starts 2,209/1,244; HR5 quest tiers 2,235/1,214; Gou weapons and armour 1,507/863; Exotic gear and Supremacy quests 3,154/2,236; Things to do every day 1,054/635; Style Rank 1,403/846; Hardcore monsters, carves and souls 3,459/2,195; Style Rank skills 2,296/1,527; The Book of Secrets stats and Attack Ceiling 4,517/2,686; My Missions 2,555/1,522; Hiden 7,112/2,999.

**Proposal:** Sticky "On this page". Fold Hiden (7,112 px), The Book of Secrets style (4,517 px) and My Missions in `<details>`. Optional tabs: "Hunter Rank" (HR1 to HR5 sections) and "Style Rank" (Style Rank, skills, Hardcore, Book of Secrets).

### guide-frontier-items.html - 41.6 screens at 375, 26.2 at 1280

Sections: Items and Materials 63/77; Finding where a material comes from 2,584/2,024; Ferias 1,229/1,293; Box space, presets and sorting 521/410; Basic items 1,242/709; Armour spheres 1,273/699; Combinations 18,410/10,864; Special items 4,917/2,738; Medal charms 2,181/1,174.

**Proposal:** Sticky "On this page". Combinations is 18,410 px (44%): fold in `<details>`, or make a tab "Combinations". Special items (4,917 px) can fold too. Keep the rest open.

### guide-frontier-hunters-road.html - 40.4 screens at 375, 24.3 at 1280

Sections: Hunter's Road 63/77; How the Road works 1,971/1,111; Stores and points 1,838/1,377; Surviving a long run 3,860/2,425; Tower Medals 2,416/1,782; White Fatalis 943/574; Hunter's Road skills 8,650/3,793; Tower weapons 3,326/1,849; Tower armour 2,839/1,551; Duremudira 2,561/1,788; Road as a Hiden alternative 1,796/1,385; Raviente materials 1,101/789.

**Proposal:** Sticky "On this page". Fold Hunter's Road skills (8,650 px) in `<details>`. Optional tabs: "How it works" (How the Road works, Stores and points, Surviving a long run), "Rewards and gear" (Medals, Tower weapons, Tower armour, Raviente materials).

### monsters.html - 39.2 screens at 375, 12.3 at 1280

Sections: Monsters 214/176; Abiorugu 31,042/9,261.

**Proposal:** A list of all monsters drawn by `js/monsters.js` (the list is 31,042 px at 375, 9,261 px at 1280). Sub-tabs do not fit a list. Better: a smaller card on mobile (2 per row), or a "Show 30 more" button, and the existing filters (search, category, size, sort) stay above the list. If tabs are wanted: by category (the select that exists already), not as an extra tab bar.

### guide-frontier-zenith.html - 32.5 screens at 375, 17.4 at 1280

Sections: Zenith (GR200+) 63/77; What Zenith is 1,339/826; Zenith monsters 3,861/2,530; Zenith materials 5,451/2,869; Blights and status 4,371/1,717; Zenith skills 1,286/851; Zenith armour 1,478/981; Zenith cuffs 500/354; Zenith weapons 6,595/2,783.

**Proposal:** Sticky "On this page". Fold Zenith weapons (6,595 px), Zenith materials (5,451 px) and Blights and status (4,371 px) in `<details>`; keep What Zenith is, Zenith monsters and skills open.

### guide-frontier-guild.html - 26.7 screens at 375, 16.6 at 1280

Sections: English Guild and Guild Hall 96/77; Guild chat first 579/382; Joining a guild 1,815/1,282; Guild requirements and meeting place 853/512; The Guild Hall 1,694/1,059; Guild Pugis 1,235/1,037; Guild Legendary Rasta 698/579; Guild Special Cooking 9,623/5,134; Felyne Treasure Hunters 2,585/1,621; Felyne Adventure Boat 1,083/636.

**Proposal:** Sticky "On this page". Guild Special Cooking is 9,623 px (36%): fold in `<details>`. Keep the rest open.

### weapons.html - 25.7 screens at 375, 16.5 at 1280

**Proposal:** Already has two tabs (Database, Usage). The Database tab is 25.7 screens at 375 and holds four blocks: Weapon list (7,836 px), Great Sword moves (6,348), Damage calculator (4,377) and How the damage is worked out (1,271). Add sub-tabs inside Database: "List" (always the default), "Great Sword moves" (`#moves`), "Damage calculator" (`#calc`); the explanation goes under the calculator. Usage stays as it is (1.9 screens).

#### weapons.html per tab

| Tab | Screens @375 | Screens @1280 | Px @375 | Sections at 375 / 1280 (px) |
|---|---|---|---|---|
| database | 25.7 | 16.5 | 20,906 | Weapon list 7,836/5,280; Great Sword moves 6,348/4,139; Damage calculator 4,377/2,443; How the damage is worked out 1,271/546 |
| usage | 1.9 | 1.3 | 1,554 | Weapon usage 64/62; p.wp-help 277/94; p#wu-msg.form-alert 142/92 |

### guide-frontier-menus.html - 23.8 screens at 375, 18.3 at 1280

Sections: Menus and Town NPCs 63/77; Launcher and game settings 689/421; Start menu 1,102/611; Hunter Status menus 2,045/1,185; Community menus 781/410; Options menus 1,223/2,689; Control bindings 566/916; Chat 1,554/985; Town Square NPCs 3,453/2,160; Blacksmith NPCs 1,641/1,039; Caravan Area NPCs 1,467/1,040; House facility NPCs 2,292/1,511; Guild Card 1,060/660.

**Proposal:** Sticky "On this page". Optional two tabs: "Menus" (Launcher, Start, Status, Community, Options, Control bindings, Chat) and "Town NPCs" (Town Square, Blacksmith, Caravan Area, House facility, Guild Card). Town Square NPCs (3,453 px) can fold.

### guide-frontier-quests-food.html - 23.3 screens at 375, 15.9 at 1280

Sections: Quests, Food Buffs and Bentos 96/77; Bentos (party buffs) 4,486/2,986; Server types 950/930; Quest givers 972/671; Quest menus 2,679/1,541; Ranking points 1,348/831; The quest card 1,065/658; Quest areas and objectives 1,525/1,115; Searching for quests 791/483; Advertising quests 1,912/1,405; Quest rewards 492/374; Caravan, Guild and Diva quests 1,192/740.

**Proposal:** Sticky "On this page". Fold Bentos (party buffs, 4,486 px) in `<details>`. Optional tabs: "Quests" and "Food buffs". No change needed beyond the sticky bar.

### play.html - 21.0 screens at 375, 10.7 at 1280

Sections: Play on Hunsterverse 188/150; nav.route-tiles.play-paths 256/104; New on Windows 3,915/2,375; Linux / Steam Deck 3,125/1,987; Bringing a character from another server 2,195/1,134; More help for every path 237/208; Client patch versions 6,574/2,188.

**Proposal:** Cards for Windows, Linux, character transfer and client patch versions in one page (also reached from guide-windows and guide-linux through redirects with `#windows` and `#linux`). Sub-tabs: "Windows" (`#windows`, 3,915 px), "Linux / Steam Deck" (`#linux`, 3,125), "Bring a character" (2,195), "Patch versions" (6,574). Above the tabs: title and the route tiles (`nav.route-tiles`, 256 px), which can already act as the tab buttons. The "More help for every path" block (237 px) stays below the tabs. The redirect anchors and `js/guide-moved.js` must open the right tab.

### guide-frontier-monsters.html - 18.8 screens at 375, 9.7 at 1280

Sections: Monsters 63/77; Large monsters 4,419/1,784; Small monsters 1,237/572; Frontier status effects 2,281/868; Unique monster mechanics 5,904/3,537.

**Proposal:** Sticky "On this page". Unique monster mechanics (5,904 px) and Large monsters (4,419 px) are the long ones; fold Unique monster mechanics in `<details>`. No tabs.

### guide-frontier-tools.html - 16.3 screens at 375, 17.7 at 1280

Sections: Tools and References 63/77; MHSX2G armour set builder 1,156/1,180; Sigil Hunter 1,088/580; English Ferias and Loxxol script 1,482/1,308; OCR tools 552/382; The guide author's other pages 590/483; Area maps 2,081/5,925; Armour quick reference 2,573/1,603; Weapon quick reference 1,464/1,144; Skill mechanics 785/517.

**Proposal:** Sticky "On this page" (only 3 of 9 sections are over 1,500 px). No tabs. Note 1280 is taller than 375 here (17.7 against 16.3 screens) because of wide embedded tool content, so check the page on desktop first.

### guide-frontier-transcend.html - 14.0 screens at 375, 9.9 at 1280

Sections: Transcend 63/77; What Transcend is 605/410; Offensive buffs 1,676/1,238; Defensive buffs 3,602/2,859; Upgrading 1,546/793; Using Transcend in a quest 933/568; Elemental Bursts 1,551/1,066.

**Proposal:** Sticky "On this page". Defensive buffs (3,602 px) can fold. No tabs.

### changelog.html - 13.1 screens at 375, 8.4 at 1280

Sections: intro) nav.breadcrumbs 1,287/952; Coming next (not live yet) 243/174; Released updates 7,878/4,695; Known issues 652/407.

**Proposal:** Released updates is 7,878 px at 375. `js/changelog-folds.js` already folds old entries; check that only the latest 3 entries are open. Sub-tabs: "Released" (default), "Coming next" and "Known issues" (small, 243 and 652 px), which could instead stay above as a short always-visible box. Intro (1,287 px at 375: the month table of contents) folds into `<details>`.

### privacy.html - 12.4 screens at 375, 6.5 at 1280

Sections: intro) nav.breadcrumbs 623/460; Who we are 327/230; What we keep and why 2,386/1,064; Cookies and browser storage 1,297/652; Prontier Discord bot 3,186/1,159; Other services on the site 596/353; What other players can see 454/258; Your rights 475/359; Changes to this page 177/182.

**Proposal:** Sub-tabs would hide legal text; prefer a sticky "On this page" or a table of contents at the top (the intro is already 623 px). Fold "Prontier Discord bot" (3,186 px) and "What we keep and why" (2,386 px) in `<details>` only if the text is repeated in a short summary line. Otherwise no change.

### account.html - 10.6 screens at 375, 8.4 at 1280

**Proposal:** Now has 8 tabs: Overview, Characters, Hunts, Guild, Custom quests, Backups, Transfer, Account. Only the Account tab is long (10.6 screens at 375, 8.4 at 1280). It holds Road you play (430 px at 375), Game options (4,777), Client patch (937), Diagnostics (1,026), Account (370) and Session (178). Game options alone is 5.9 screens. Proposal: sub-tabs inside the Account tab: "Game" (Road you play, Game options with Keys and Viewer options), "Patch and files" (Client patch, Diagnostics), "Login" (Account, Session). Inside Game options, fold the "Being tested: pre-release only" part, Keys and Viewer options each in `<details>`. Keep above the tabs: the page header and the 8 main tabs. Per-tab heights are in the account table below.

#### account.html per tab

| Tab | Screens @375 | Screens @1280 | Px @375 | Sections at 375 / 1280 (px) |
|---|---|---|---|---|
| overview | 3.4 | 2.8 | 2,773 | div.stat-grid 279/108; Discord 197/155; Hunting Road rewards 617/527; Gifts 448/387; Recent activity 320/329 |
| characters | 3.6 | 2.6 | 2,928 | Characters 387/370; Character 480/363; Character 1,151/613 |
| hunts | 2.5 | 2.2 | 2,056 | Hunt log 128/62; div.toolbar 91/83; div#hunts-stats.stat-grid 143/108; div.table-wrap 294/326; p.subhead 23/23; ul#hunts-recent.activity-list 244/252; Quest log 223/218 |
| guild | 2.5 | 1.9 | 2,010 | Guild 64/62; div.toolbar 109/86; Test Guild 928/661 |
| quests | 2.6 | 1.9 | 2,108 | Custom quests 110; p.note-text 246; p.note-text 177; div.field 86; div.field 84; button#quest-submit.btn.btn-primary 54; p.scroll-hint 21; div.table-wrap.is-scrollable 190; Quest drafts 231 |
| backups | 3.1 | 2.2 | 2,505 | Backups 64; p.scroll-hint 21; div.table-wrap.is-scrollable 228; p.subhead 23; p.note-text 107; div.field 86; div.field 81; button#import-preview-btn.btn.btn-primary 66; p.subhead 23; p.scroll-hint 21; div.table-wrap.is-scrollable 115; What is in your backup 761 |
| transfer | 2.2 | 1.5 | 1,824 | Bring a character to Hunsterverse 105/62; p.note-text 107/37; 1. Your game account 702/431 |
| account | 10.6 | 8.4 | 8,629 | Road you play 430/340; Game options 4,777/3,949; Client patch 937/705; Diagnostics 1,026/560; Account 370/280; Session 178/162 |

### guide-frontier-item-box.html - 8.6 screens at 375, 6.3 at 1280

Sections: Equipment and Item Boxes 63/77; Using the box 1,281/765; Equipping gear 665/410; Getting more box space 971/629; Item presets 716/531; Sorting your equipment box 637/751; Gear presets 700/557; Caravan gem skills 574/405.

**Proposal:** Sticky "On this page"; the page is 8.6 screens at 375 and its sections are all under 1,300 px. No tabs.

### guide-frontier.html - 7.1 screens at 375, 4.9 at 1280

Sections: Frontier guide 63/77; div.box.tip 229/128; aside#hv-overview.box.hv-note 509/258; Getting started 737/405; Gear and items 835/688; Monsters and references 408/378; Progression 702/405; Things to do 557/405; Our own guides and tools 595/350.

**Proposal:** This is the guide hub (the redirect targets guide-frontier.html#gear, `#activities` and `#reference` land here). Six groups of links. Already compact (7.1 screens at 375, mostly link lists of 400 to 840 px). At 375 fold each group in `<details>` with the first one open, or use the groups as tabs: Getting started, Gear and items, Monsters and references, Progression, Things to do, Our own guides. Keep title, lead and the "hv-overview" box (509 px) above.

### api.html - 6.9 screens at 375, 5.2 at 1280

Sections: API 85/99; p.meta 114/70; div.toc 228/167; Signing in 1,797/1,122; Public endpoints 1,885/1,637; Errors, limits and caching 473/280; p#api-gate.api-gate 225/177.

**Proposal:** Fits in about 7 screens at 375. Sub-tabs: "Signing in" (1,797 px), "Public endpoints" (1,885), "Errors and limits" (473). Keep the contents block (`div.toc`) and the API gate note (225 px) above the tabs. Low priority; the page is a reference that people search with Ctrl+F, which tabs break.

### guide-roads.html - 6.5 screens at 375, 4.7 at 1280

Sections: intro) nav.breadcrumbs 691/483; 1. What a Road is 354/230; 2. Set your default Road on the site 375/230; 3. Choose a Road in the quest party 831/704; 4. What the rest of the party sees 425/281; 5. Joining a quest party later 451/309; 6. Join a party from Discord 734/415; 7. Going back to the live Road 258/242; 8. Limits worth knowing 626/407.

**Proposal:** Eight numbered steps (260 to 830 px each). A numbered list reads in order: no tabs. A sticky "On this page" is enough.

### quests.html - 6.5 screens at 375, 4.8 at 1280

Sections: Quest catalog 384/304; section.panel 4,286/3,107.

**Proposal:** One 4,286 px panel at 375 (the quest list, from the site's JSON). A list page: no sub-tabs. Filters stay above.

### index.html - 6.0 screens at 375, 3.3 at 1280

Sections: Hunt the Frontier again 486/143; Find your way 2,438/528; Sign in 640/1,176; What's new 739/383.

**Proposal:** Home page: 6.0 screens at 375 (Hunt the Frontier hero 486, Find your way 2,438, Sign in 640, What's new 739). "Find your way" has five groups (New here, Play, Community, Tools, Account); fold the last three in `<details>` or use the five as a horizontal scroll row. Sub-tabs are not wanted on a landing page.

### bot-terms.html - 5.5 screens at 375, 3.7 at 1280

Sections: intro) nav.breadcrumbs 595/452; Who runs it 459/258; What the bot does 1,188/668; Acceptable use 469/269; No warranty 311/213; Changes, stopping and termination 359/213; Not affiliated with Capcom or Discord 253/157; Changes to these terms 230/210.

**Proposal:** Legal text in 8 short sections (210 to 1,190 px). No tabs; a sticky "On this page" is enough.

### admin.html - 4.9 screens at 375, 3.1 at 1280

**Proposal:** 14 tabs (Gifts, Events, Settings, Notices, Content, Balance, Hunting Road, Custom quests, Users, Flags, Diagnostics, Server, Audit, Permissions). Over 4 screens at 375 only Events (4.9) and Permissions (4.0). The sections for the Events tab are 19 small blocks: Event calendar, Gaps, In the next 7 days, Runs, Add a run. Sub-tabs inside Events: "Calendar" (calendar, gaps, next 7 days), "Runs" (Runs, Add a run). Permissions: the grant table is 2,064 px; no split, a role filter (Helper, Moderator, Admin) as sub-tabs would cut it to a third. The 14 tab buttons themselves already need two rows or a sideways scroll at 375; consider group buttons (Content: Gifts, Events, Notices, Content, Balance, Road, Quests; People: Users, Flags, Permissions; System: Settings, Diagnostics, Server, Audit). Caveat: many admin panels were measured with no data, so lists are short.

#### admin.html per tab

| Tab | Screens @375 | Screens @1280 | Px @375 | Sections at 375 / 1280 (px) |
|---|---|---|---|---|
| gifts | 2.9 | 2.1 | 2,379 | New gift 84/62; div.admin-grid 599/355; details.admin-limits 51/51; Items 23/23; div#gift-items.admin-items 320/112; button#gift-add-item.ghost-btn.small 56/47; div#gift-review-row.admin-actions 85/92; Gifts 169/165 |
| events | 4.9 | 3.1 | 3,943 | Event calendar 64; p#cal-alert.form-alert 62; p.note-text 246; p.cal-legend 20; div.cal-wrap 28; p#cal-at.note-text.cal-at 37; p#cal-keys.note-text.muted 268; p#cal-drag-status.visually-hidden 13; Gaps in the next 12 weeks 39; In the next 7 days 23; Runs 49; p.scroll-hint 21; div.table-wrap.is-scrollable 96; Add a run 23; form#cal-form.admin-form 965; Extend the main event loop 23; form#cal-gen.admin-form 497; Extend the side event loop 23; form#cal-gen-side.admin-form 454 |
| settings | 2.3 | 1.8 | 1,877 | Live settings 64; p#set-alert.form-alert 62; p.note-text 223; Sections 65; form#set-form-wrap.admin-form 200; History of this section 23; p.scroll-hint 21; div.table-wrap.is-scrollable 96; Restart only (config.json) 23; p.note-text 109 |
| notices | 3.2 | 2.6 | 2,605 | Notices 83; p#not-alert.form-alert 62; p.note-text 165; Send now 23; form#not-send-form.admin-form 261; Scheduled notices 23; form#not-sched-form.admin-form 321; p.note-text 107; div.table-wrap 96; Sent and past 23; p.scroll-hint 21; div.table-wrap.is-scrollable 96; Login notices 27; p.note-text 153; form#not-login-form.admin-form 151 |
| content | 2.0 | 1.6 | 1,618 | Event content 64; p#content-alert.form-alert 62; p.note-text 223; div#content-groups.chips 24; Content 63; div.table-wrap 96; Add a row 23; form#content-form.admin-form 71 |
| balance | 1.4 | 1.1 | 1,133 | Balance 141/147 |
| road | 2.0 | 1.5 | 1,625 | Hunting Road 64/62; p#road-alert.form-alert 72/72; New rotation 23/23; form#road-create.admin-form 399/219; Rotations 23/23; div#road-cycles 52/60 |
| quests | 1.8 | 1.3 | 1,484 | Custom quests 84; p.note-text 246; div#quests-filter.chips 56; p.scroll-hint 21; div.table-wrap.is-scrollable 85 |
| users | 3.4 | 2.5 | 2,769 | Users 99/62; p#users-patches.admin-desc 56/35; div.admin-search 113/61; p.scroll-hint 21/21; div.table-wrap.is-scrollable 420/398; div.admin-pager 88/31; p.note-text 547/183; Pre-release slots 433/429 |
| flags | 3.7 | 2.2 | 2,974 | Flags 64/62; p.note-text 200/60; p#fl-counts.note-text 37/37; div.fl-filters 222/93; div.fl-scanrow 52/43; div#fl-bulkbar.fl-bulkbar 167/79; Queue 23/23; div#fl-list 1,177/557; details#fl-rules.fl-rules 40/48 |
| diagnostics | 1.9 | 1.4 | 1,558 | Diagnostics reports 99; div.admin-search 109; p.scroll-hint 21; div.table-wrap.is-scrollable 82; div.admin-pager 40; p.note-text 215 |
| server | 2.0 | 1.5 | 1,600 | Servers 64; p#server-alert.form-alert 62; div#server-services.ops-services 36; p.note-text 200; Log 49; pre#ops-log.ops-log 69; Recent actions 23; p.scroll-hint 21; div.table-wrap.is-scrollable 85 |
| audit | 1.9 | 1.4 | 1,569 | Audit log 64/62; p#audit-alert.form-alert 62/62; div.admin-search.audit-filters 161/61; div#audit-runs.audit-runs 98/102; p.note-text 192/83 |
| permissions | 4.0 | 3.9 | 3,283 | Permissions 84; p.scroll-hint 21; div.table-wrap.perm-wrap 2,064; p.note-text 122 |

### events.html - 4.6 screens at 375, 2.5 at 1280

Sections: Events 162/150; Running now 3,014/1,406.

**Proposal:** Running now is 3,014 px at 375 (the event list). A list page: no tabs. Fold older and empty groups.

## Pages under 4 screens at 375 px

No change for any of these. Heights for API-fed pages are floors (see Method).

- guide-linux.html: redirect page (redirects to play.html#linux). No change.
- guide-windows.html: redirect page (redirects to play.html#windows). No change.
- guide-frontier-activities.html: redirect page (redirects to guide-frontier.html#activities). No change.
- guide-frontier-equipment.html: redirect page (redirects to guide-frontier.html#gear). No change.
- guide-frontier-reference.html: redirect page (redirects to guide-frontier.html#reference). No change.
- worlds.html (4.0 screens at 375, 3.3 at 1280): no change.
- monster.html (3.9 screens at 375, 3.0 at 1280): no change.
- item.html (3.7 screens at 375, 3.1 at 1280): no change.
- catalog.html: redirect page (redirects to items.html). No change.
- items.html (3.5 screens at 375, 3.8 at 1280): no change.
- report.html (3.5 screens at 375, 3.1 at 1280): no change.
- database.html (2.5 screens at 375, 1.7 at 1280): no change.
- sky-corridor.html (2.5 screens at 375, 1.5 at 1280): no change.
- road-history.html (2.0 screens at 375, 1.5 at 1280): no change.
- set-builder.html (2.0 screens at 375, 1.7 at 1280): no change.
- leaderboards.html (1.9 screens at 375, 1.5 at 1280): no change.
- road-vote.html (1.9 screens at 375, 1.4 at 1280): no change.
- road.html (1.9 screens at 375, 1.4 at 1280): no change.
- tournaments.html (1.8 screens at 375, 1.4 at 1280): no change.
- guilds.html (1.5 screens at 375, 1.1 at 1280): no change.
- hunters.html (1.5 screens at 375, 1.1 at 1280): no change.
- quest-editor.html (1.5 screens at 375, 1.3 at 1280): no change.
- balance.html (1.3 screens at 375, 1.0 at 1280): no change.
- quest.html (1.2 screens at 375, 1.0 at 1280): no change.

Notes: worlds.html is exactly 4.0 screens with empty charts, so it may grow with real data; its blocks (Who's online 471 px, Players over time 851, Quest log 616) already read as separate cards. admin.html Balance is 1.4 screens only because its grid has no data; the real one is a wide table and a long grid.

