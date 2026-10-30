# Quest editor: full web port

Owner decision (2026-10-29): the editor lives entirely on the site, not as a desktop app with an upload
button. Pax's editor is the reference for behaviour, our RE notes are the reference for the format, and the
other session can cross-check the two. This supersedes the "upload a .bin" first step in
`docs/quest-editor.md`.

## The decision that matters: bytes are made on the server

The browser must never assemble a quest binary. Split it:

- **Server (Java, in the API)**: `QuestCodec.parse(byte[]) -> QuestModel` and
  `QuestCodec.serialize(QuestModel) -> byte[]`. One implementation, unit tested, used by upload, by the
  editor's save, by validation and by the test-token service.
- **Browser**: a form and table editor over the JSON `QuestModel`. It posts a model, gets back a model plus
  validation errors, and never sees a byte array unless it downloads the finished file.

Why: Shift-JIS encoding, NUL padding, slot sizes and offset tables are exactly what a browser gets subtly
wrong, and a wrong byte is a client crash rather than a validation message. One serializer also means the
code that validates an upload is the code that produces the deployed file.

## The regression test that makes this safe

Round-trip **every quest file in `bin/quests` and `bin/events`**: parse, serialize, compare byte for byte.
The title rewrite already proved exact slot maths on 52,807 files, so a correct codec should reproduce all
55,323 files exactly. Every file that differs names the field the codec got wrong. Run it in CI and after
every codec change; it is the difference between "the editor probably works" and "it round-trips the live
quest set".

Fixtures for the hard cases: a file whose title and objective share one string, one with multiple
objectives, one with the `d` and `n` variants, one with a large reward table.

## Feature order, each shippable on its own

1. **Metadata and text**: category, title, objective, client, description, fail conditions, time limit,
   zenny and reward money, map and area. The catalog already displays these, so the preview is free.
2. **Monsters and spawns**: large and small spawn records with count, area, size class and level.
3. **Rewards**: groups with weights, item ids and counts, plus start items.
4. **Flags and objectives**: objective modes, required flags, sub-targets.
5. **Script opcodes**: last, since parts of the RE notes are only medium confidence.

Each step moves the codec, the round-trip test and the editor form together. A step is done when the
round-trip still passes and the editor can change that section without touching another.

## Editor UX

- Open from the quest catalog or the account page: "Create a quest" starts a new one. Live quests are not
  opened, copied or edited from this page at all.
- Panels follow the feature order above and the site's existing layout language.
- A preview panel shows how the quest will read in the catalog and on the quest page.
- "Save draft", "Test" and "Publish to events" are three distinct actions; drafts never touch live files.
- Validation runs on every save and shows slot usage for the title and text fields, because overlong text is
  the most common authoring mistake.

## Cross-checking with the RE project

The RE docs (`quest-files.md`, `channel-login.md`, `data/quest_cycle_steps.tsv`) describe header offsets,
body fields, reward groups, spawn records and the script. For each editor section the codec docs should
carry a short table: field, offset, width, the line in the RE notes, and the fixture that covers it. That is
what lets the other session verify a field against the disassembly without re-deriving the layout, and it
turns disagreements into a diff instead of a silent bug.

## Test deployment

Unchanged, and it depends on the room pin built for Roads: a token per account, a reserved quest id block,
token-gated serving, no rewards and no board entries, automatic expiry.

## Safety

Edited or uploaded quests are client-facing content. Cap sizes, parse strictly, refuse to serialize a model
that fails validation, and only serve a test file to rooms holding a valid token. The quest set itself is ours, written for
this server, so publishing, downloading and editing those files is ours to allow; the token rule is about
unfinished work and privacy, not ownership.

## Shipped (30 Oct 2026)

The first three steps of the feature order are live: text and metadata, monsters and spawns, rewards. Flags,
objectives and script opcodes are not editable yet; the model carries them and they round-trip untouched.

### Second pass, same day: the builder makes new quests only

Copying a live quest was removed. A quest file is client-facing content that the catalog and the quest pages
describe, and an editor that hands out a copy of any of them invites drift between a quest and the page that
documents it. The builder now starts from a blank quest the API owns:

- `src/main/resources/quest/blank.bin` in the API jar, parsed once by `QuestBlank`. It is built from the small
  Event quest `40135d0.bin` (`QuestBlank.build`, regenerated by `QuestBlankTemplateTest` when `QUEST_DIR` is
  set): all eight text slots empty, no reward groups, no spawns, no start items, time limit 50 minutes, zenny
  and reward money 0, four players, body quest id 0 (the server assigns the real id at submit).
- The file ends in a reserved region `QuestTables` owns: 1 024 bytes for the reward table, 1 024 for small
  spawns, 2 048 for large spawns. `QuestTables.pack` lays the model's lists out inside it and rewrites the
  three header pointers, so the browser adds rows and never computes an offset. A table too big for its span
  is refused with the size it needed.
- The eight strings sit in a block with fixed room per slot (title 192, objective 320, main objective 320,
  client 160, fail 160, description 768, sub-quest A 96, sub-quest B 96), so ordinary text is written where
  it is instead of being appended on every save.
- `QuestModelWriter.prepare` also clears the byte spans of the three tables out of `raw`, because a table
  that grew now covers bytes that were padding. On an untouched model that removes nothing, which the
  editor-path test over the sample directory asserts.

| Endpoint | Does |
|---|---|
| `GET /api/account/quests/model` | the blank quest as the `QuestCodec` model: 8 empty text slots with their room, header, body, empty reward and spawn tables, plus `raw`. Any `questId` parameter is a 403 with a message saying live quests are not opened here |
| `POST /api/account/quest-drafts` `{}` or `{blank:true}` | stores a draft of the blank model, returns `{id, revision, blank:true}`. A body with `questId` is a 403 |
| `GET /api/account/quest-drafts` | the account's new-quest drafts, newest first, each with `title`, `revision` and `updatedAt` (`source_quest_id = 0` only) |
| `GET /api/account/quest-drafts/{id}` | `{id, sourceQuestId, variant, revision, model}`; another account's id is a 404, a draft seeded from a live quest is a 403 |
| `PUT /api/account/quest-drafts/{id}` `{model}` | validates by packing and writing it with the codec (400 with the codec's message), stores it, bumps `revision` |
| `GET /api/account/quest-drafts/{id}/file` | the `.bin` as `application/octet-stream`, attachment `new-quest.bin` |
| `POST /api/account/quest-drafts/{id}/submit` | reward-stripped copy via `QuestFile`, a `quest_submission` row with status `testing`, the sandbox quest published by `QuestSubmissionController`'s own method; `{submissionId, sandboxQuestId}` |

`quest_draft(id, account_id, source_quest_id, variant, model jsonb, revision, created_at, updated_at)`,
DDL in the API repo at `src/main/resources/db/quest-draft.sql`. `source_quest_id` is 0 for every draft the
builder makes; rows from the copy era keep their quest id and are refused by every draft route.

**How a string is written.** `QuestModelWriter.prepare` encodes each slot's text to Shift-JIS. A slot whose
text still reads as its original bytes is left byte-for-byte alone, which is why an untouched model
serializes identically to the live file. A shorter string is written in place and padded with NULs; one that
does not fit its room is appended at the end of the file and the slot repointed, so nothing is cut. The
result is refused past the client's 32 KB quest buffer, and text Shift-JIS cannot hold is refused with the
character named.

**Page.** `quest-editor.html` with `js/quest-editor.js`: a Draft panel (save, download, submit, the account's
drafts as links to `?draft=<id>`) then Text, Metadata, Monsters and spawns (Add monster, Remove), and Rewards
(Add reward group, Add entry, Remove). Fields are bound straight onto the model, so what is posted is the
model the server sent. The time limit is edited in minutes (the body field counts 1 800 ticks a minute).
"Create a quest" on `quests.html` and on the account page's Custom quests tab opens it; the quest page no
longer carries an edit action, and `?id=` shows the server's refusal instead of a form.

**Still open.** The `quest_submission` queue, MAX_ACTIVE and the sandbox id block are unchanged; a draft is
never a submission until Submit. Nothing here deletes drafts (the API caps an account at 50), and the private
API docs have no entry for these routes yet.
