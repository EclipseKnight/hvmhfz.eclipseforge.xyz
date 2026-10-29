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

- Open from the quest catalog: every quest gets an "Edit a copy" action, which is the safe default. Editing
  a live quest in place is a separate admin-only action with a diff.
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
that fails validation, keep Capcom's own files out of the public catalog, and only serve test files to rooms
holding a valid token.
