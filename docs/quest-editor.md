> Superseded for the port itself by `docs/quest-editor-web.md` (owner, 2026-10-29): the editor is a full
> web port, the codec lives in the API and the browser never builds bytes.

# Quest editor: drafts, test deploy and sandboxing

Parked for after the Road work (owner, 2026-10-29). Same shape as the Road system on purpose: drafts are
mutable, versions are immutable, a test token pins a version to a room, and nothing untested reaches the
live quest list.

## What exists already

- Quest files are `<questId><variant>.bin`, and the client asks the server for one by name (`GET_FILE`), so
  the server already decides which bytes a client receives. That is the same choke point the Road system
  uses for rengoku data.
- `docs/quest-files.md` documents the header, body, reward groups, spawn records and text table, which is
  what an editor has to write back.
- The site already has the quest catalog, so "browse and open a quest" is solved.

## Two entry points, both worth having

1. **Upload from a desktop editor.** Pax's editor (Tauri, opens a decompressed quest file, saves `.bin`)
   produces the file; the site takes it, validates it, stores it as a version, and offers a test token.
   This is the fast path, because the editing UI already exists and quest authoring is a desktop job with
   file IO.
2. **Edit on the site later.** Only worth building once the format is well enough understood to round-trip
   every field we care about. The catalog and the detail pages already carry most of the read side, so a
   form based editor for a subset (name, category, objective, area, monsters, rewards, time limit) is
   realistic; a full editor is not.

Neither path needs to touch the client, and neither should try to.

## Data model

```
quest_draft(id, owner_account, name, data jsonb, revision, published_version_id, updated_at)
quest_blob(sha256 primary key, bytes bytea, size int)
quest_version(id, family_id, sha256, name, author, kind (test|event|official), created_at, retired_at)
```

The same rules as Roads: autosave writes the draft, Publish or Test computes the sha, identical files
dedupe to one blob, and two authors with the same file get two versions so attribution and history stay
honest.

## Test deployment

- Each account gets a **test token**: a short id that maps to a quest version plus an expiry (hours, not
  weeks).
- The room pin (already needed for Roads) carries the token, so a room's members receive the test quest
  file when the client asks for that id.
- Test quests are **sandboxed**: no rewards granted to the live save, no kill log contribution, no board
  entries, no Road points. Otherwise a test quest is a duplication exploit.
- The quest id used for testing is a reserved block, so a test can never be requested through the normal
  quest counter.
- Expiry is automatic; the room falls back to the live rotation of quests when the token lapses.

## Validation, and what cannot be validated

Structural checks are cheap and should be mandatory: file size and header offsets, title slot bytes, valid
monster and area ids, reward groups that parse, text table inside the file. The catalog already parses all
of this, so the same code can validate on upload.

What cannot be validated server side is whether the quest is playable. Pax's own README says it plainly:
some monster and map combinations crash the client, and hardcoded assumptions bite. So the test phase is
the validation, and the UI should say so instead of pretending a green check means safe.

## Treat uploaded files as untrusted

A quest binary is content the player's client will parse. That means: cap the size, reject anything that
fails the structural parse, never rewrite a file in place outside its title slot, serve test files only to
rooms holding a valid token, and never expose another account's test file through the public API. Also keep
Capcom's own quest files out of the public catalog, since redistributing them is not ours to do.

## Licensing note

Pax's editor's repository has to be checked for a licence before any of its code is reused or vendored. The
file format knowledge is already in our own RE docs, so the plan does not depend on copying anything, but
it is worth being explicit before someone lifts a parser.
