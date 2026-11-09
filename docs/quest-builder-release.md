# Quest builder chunks 1-5: release plan and in-game tests

The quest builder gap work (`docs/quest-builder-gap.md`, tasks 1-5) ships as **one release**: the website, the API, one
database migration, one data folder on the API host, and one Erupe change that goes out with the next Erupe restart.
Nothing here is live yet (written 2026-11-09). Every step on a live server needs the owner's go for that step (project
rule 1: deploys, restarts, config edits and database writes).

## What ships

| Part | Branch, head | What it adds |
|---|---|---|
| Website | `questbuilder-gap` (chunks 1-4 at `c958851`, chunk 5 on top) | the builder's listing, monster tuning, rules and restrictions, forced equipment, rewards and text extras; the account, admin, builder and quest list pages' reward wording |
| API | `qb-chunk1` (chunks 1-4 at `d8d5efc`, chunk 5 on top) | the model fields and their checks, the draft's listing, the `event_quests` row written from it, the admin's counter and mark at approval, the testing copy without Reward 1/2/3, a blank without its source quest's list items |
| Database (`hvmhfz-db`, `erupe`) | API `src/main/resources/db/quest-listing.sql` | three nullable columns: `quest_draft.listing`, `quest_submission.quest_type`, `quest_submission.mark` |
| API host data | `/var/lib/hvmhfz-api/quest-maps/` | the per-map quest templates rebuilt, now with `position-extents.tsv` (the position bounds, chunk 2) |
| Erupe | `erupe-approved-rewards` at `85d282f` (live `f7615b5` plus one commit) | an approved custom quest is served from `data`, with its rewards and Reward 1/2/3; a testing one still from `data_stripped` |

Docs: website `docs/quest-editor-web.md` (one paragraph per chunk), API README "Custom quest listing", "Monster
tuning", "Flags and restrictions", "Forced equipment", "Reward extras".

## Deploy order

| # | Step | Where | Why here |
|---|---|---|---|
| 1 | Run `quest-listing.sql` | `hvmhfz-db`, database `erupe` | the new API reads the columns and answers 500 on every draft and submission route without them; additive, Erupe reads none of them, safe twice |
| 2 | Replace the quest-maps folder, with `position-extents.tsv` | `hvmhfz-api` | the API reads the folder once at startup; without the extents file the position bounds are narrower than the plan's |
| 3 | New API jar, restart `hvmhfz-api` | `hvmhfz-api` | before the site: the new builder sends the listing and the new model fields |
| 4 | Push the website | GitHub Pages | after the API; an old page against the new API still works (it sends none of the new fields) |
| 5 | Erupe `85d282f` | `hunsterverse`, at the next Erupe restart | independent of 1-4. Until it runs, an approved custom quest is served as its testing copy (no item rewards, no list items): the safe side |
| 6 | Changelog entry | website | when 1-4 are live; a second line when 5 is |

### 0. Prepare (dev VM)

1. API: merge `qb-chunk1` into the API's `main` the usual way, then `flock /srv/devbot/.heavy-build.lock mvn -B package`
   (all tests, Testcontainers). Keep the jar's sha256 for the release notes.
2. Quest-maps folder, from the local decoded quests (the same source as the folder on the host now: 164 files, 68
   maps):

   ```bash
   QUEST_DIR=/root/work/api-quest-codec/quests flock /srv/devbot/.heavy-build.lock mvn -B test -Dtest=QuestMapsTest
   ```

   It writes `target/quest-maps/` (the `.bin` templates and `position-extents.tsv`) and checks that every map's file
   reads back, fits 32 KB and that every large-monster position in the directory lies inside its map's bounds. To
   widen the bounds with the live sample too, run it again with `QUEST_DIR=/root/work/re-mhfz/quests-live` and compare
   (API README "The per-map template folder").
3. Website: fetch, rebase `questbuilder-gap` onto `origin/main` (the owner's other session pushes there), then run
   `python3 dev/check-site.py`, `python3 dev/check-links.py`, `QUEST_CODEC=<API worktree>/src/main/java/xyz/eclipseforge/hvmhfz/hvmhfz_rest_api/quest/QuestCodec.java node dev/check-quest-fields.js`
   and the builder checks (`dev/check-quest-listing.js`, `-monsters`, `-rules`, `-equipment`, `-rewards`, `-zenith`,
   `-maps`, `-expiry`; README). `dev/check-quest-maps.js` reports 5 problems at 375 px that are older than this work
   (the site header's menu button).
4. Erupe: build `85d282f` for the server as the previous releases were (`docs/servers/hunsterverse.md` in the project
   home: `/root/backups/erupe/erupe-<sha>-linux-arm64`), `go vet ./...` and `go test ./...` (2 known upstream
   failures).

### 1. Migration (`hvmhfz-db`)

Copy `quest-listing.sql` to the database host and run it on `erupe` as its header says. Check: `\d quest_draft` shows
`listing jsonb`, `\d quest_submission` shows `quest_type` and `mark`. Undo, after rolling the API back:
`quest-listing-undo.sql`.

### 2. Quest-maps folder (`hvmhfz-api`)

Move `/var/lib/hvmhfz-api/quest-maps` aside (for example `quest-maps.<date>.bak`), copy the new `target/quest-maps/` in
its place with the same owner and mode, and check `position-extents.tsv` is there. The old API ignores the extents
file, so this step is safe before the jar.

### 3. API (`hvmhfz-api`)

Copy the old jar to a dated `.bak` beside it, put the new jar in `~/frontier/`, restart `hvmhfz-api`. Check the log:
"Quest map templates: N maps" and no skipped file; `GET /api/account/quests/maps` (signed in) answers `spots` and
`bounds`; `GET /api/account/quests/model` has `body.previewItems` `[0, 0, 0]` and `body.rewardFlag` 0. Rollback: the
`.bak` jar and a restart (the migration and the folder can stay).

### 4. Website

Push the rebased branch to `origin/main` (or merge it there). GitHub Pages serves it within minutes; the builder loads
`js/quest-editor.js?v=17`.

### 5. Erupe (next restart)

With the owner's go for the next restart, swap in the `85d282f` binary as the runbook in
`docs/servers/hunsterverse.md` does (named rollback copy beside `config.json`). No config change. From then on an
approved custom quest pays the author's item rewards and lists Reward 1/2/3.

**Before that restart**, check the approved custom quests: their full files start paying out. On 2026-11-09 there were
none (read-only query: 2 submissions, both in testing). The two testing quests were stripped before chunk 5, so their
testing copies still list Reward 1/2/3 items until they are resubmitted; an admin approving one should look at its
rewards and list items first (the admin note says approval pays them).

## In-game tests

Make each quest in the builder, submit it for testing and play it with the patched client. Approve the rewards test
quest (step 5 must be live for its second half). Tick each line; the first column says which chunk and what to look at.

| Chunk, what | Set in the builder | Expected in game |
|---|---|---|
| 1, listing counter | counter G Event (28), then Series (24) on a second quest | the quest is at that counter, not under HR Event |
| 1, mark | Recommended, then New | the mark shows on the quest's row |
| 1, players | Solo (1) and 2 hunters | the quest list's cap and the room refuse more hunters |
| 1, time of day and season | Night, cold season | the quest runs at night in the cold season; the list shows it |
| 1, stars and targets required | 8 stars; "All three targets" with sub-targets A and B | 8 stars in the list; the quest clears only when all three are done, and pays the sub-target money with the main reward |
| 2, size and spread | size 150%, spread 4 | the monster is visibly larger; sizes vary between runs |
| 2, difficulty | a G rank level in a G rank quest | the monster's strength matches that level (compare with a real quest at the same level) |
| 2, exact position | a typed position for a large monster, and "Use the usual spot" for another | the first appears where typed, the second where real quests put it; nobody falls through the map |
| 3, Hardcore | HR 100 and up class, Hardcore on (note 109) | the quest is Hardcore (Hardcore label, Hardcore monster data) |
| 3, conquest | Low conquest, then High conquest flag | the conquest behaviour of a real conquest quest |
| 3, restrictions | "No items", and one weapon-only restriction | the game enforces them (or not: note which, the untested ones are marked in the builder) |
| 3, death count | G rank: 3 faints; High rank: 2,000 zenny per faint | G fails at the 3rd faint; High rank takes 2,000 from the reward money per faint and fails at 0 |
| 3, rank limits | lowest rank to join 100, highest 200 | a hunter outside the range cannot join or post |
| 4, forced equipment set | a Capcom arena set (blademaster), one with a gunner weapon, a slot forced empty, decorations | each hunter wears the set when the quest starts, decorations included; the empty slot is empty; back to their own gear after |
| 5, rewards in testing | main reward money 9,000, sub-target A 1,200, a main reward group, Reward 1/2/3 from it, Fixed rewards | testing copy: the quest list shows **no** Reward 1/2/3; a clear pays the money (main and sub-target) but **no items** |
| 5, rewards approved | the same quest, approved (after step 5) | the quest list shows the three Reward items; a clear pays the money and the author's items, the fixed ones as the flag says |
| 5, text | "Write the target lines" and "Write the clear and fail lines" | the quest card shows the lines as written |
| all, older drafts | open a draft saved before the release, save, submit | it opens, saves and plays as before; Reward 1/2/3 empty |

Record the results in the website's `docs/quest-editor-web.md` (the "not tested in game" notes per chunk) and the
changelog.
