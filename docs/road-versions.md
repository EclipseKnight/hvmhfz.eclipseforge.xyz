# Road versions, per-host selection and split boards

Design note for custom Roads (owner, 2026-10-29). Nothing here is built yet; this records the shape so the
work can be split between the API, the site and Erupe without re-deciding it.

## Why

Roads rotate every two weeks and are now custom. Players want to:

- pick which Road a room runs on, including old ones, so groups can revisit a Road and test their own;
- keep competing on a Road after it retires, without touching the records set while it was live.

## Road identity

A Road is its **sha256**, already the key in `road_cycle` and in `road_saved_bests`. Make it an immutable
version row rather than a rotation:

```
road_version(
  sha256 text primary key,
  name text,                 -- "Custom Road 12", "Original Road"
  author text,               -- account or 'server'
  kind text,                 -- 'official' | 'custom'
  blob bytea,                -- the deployed road file
  created_at timestamptz,
  first_live_at timestamptz, -- when it was first deployed
  retired_at timestamptz     -- null while live; set when the rotation changes
)
```

`road_cycle` keeps pointing at the sha and becomes the rotation log: one row per deploy, with
`deployed_at` and `retired_at`, so the archive page is "select from road_cycle order by deployed_at desc".

## Selecting a Road

- `kind = 'official'` roads are pickable by any host; `kind = 'custom'` roads are pickable by their author
  and by anyone the author allows.
- The room records `road_sha` when it is created. Every member's Rengoku load is answered with that blob,
  not with the current rotation.
- A Road change applies at room creation. Changing it mid-session means returning to town, because the
  client asks for Rengoku data at town and land entry.
- Ranked play stays on `kind = 'official'` roads only. A custom road logs the hunt and shows a personal
  best but does not enter a public board. That is what keeps a crafted easy road from farming points.


## Edits, and why the hash is the version

A Road is content addressed, so editing one never changes a row, it produces a **new sha and therefore a
new version**. That is the intended behaviour and it answers most of the awkward cases for free:

- **A room already playing the old Road** keeps its pin. The blob it loaded is the one it validates
  against, so an edit mid-session cannot desync the party.
- **The old boards stay intact.** A new sha has its own original and revisit boards, so an edit cannot
  overwrite or inherit a record. Custom Roads do not rank anyway, and this is the second reason why.
- **Re-uploading an unchanged file** produces the same sha, so it dedupes onto the existing row instead of
  filling the archive with identical versions.
- **Test tokens are pinned to a sha**, so editing while a test is running does not shift the ground under
  the testers.

Two pieces make the UI sane around that:

1. **A road family.** `road_family(id, name, owner)` groups versions of the same Road; `road_version.family_id`
   and `parent_sha` point into it. The archive shows one row per family with its versions nested, instead of
   a flat list where "Custom Road 12" appears five times with different hashes.
2. **An account preference that follows the family, not the sha.** Store `road_pref_family`, resolved to the
   newest version at room creation. When someone edits, their next room uses the new version; a room already
   open keeps the old one. Storing a raw sha would pin people to a version they have moved past, which reads
   as a bug even though it is technically consistent.

The builder therefore never "saves over" a Road. It shows "this will create version 3", keeps the previous
one playable, and the Test button always targets the version currently in the editor. If someone wants to
withdraw a version, mark it `retired_at` and hide it from the picker; nothing is deleted, because quest rows
reference the sha.

## Boards: original and revisit

Each Road therefore has **two boards per mode (open, solo)**:

- **Original**: runs recorded while the Road was live, `attempted_at <= retired_at`. Frozen when the
  rotation moves on; always displayed.
- **Revisit**: runs recorded after `retired_at`. Accumulates for as long as the Road can be picked.

Both come from the same score rows; the split is derived, not stored twice:

```sql
-- original
where road_sha = $1 and attempted_at <= v.retired_at
-- revisit
where road_sha = $1 and attempted_at >  v.retired_at
```

`retired_at` must be written at rotation time, in the same transaction that marks the new cycle, or the
split cannot be computed later. Backfill for roads retired before this exists uses the deploy time of the
next rotation as their `retired_at`, which is exact enough for a fortnightly cadence.

A player has one best per board. A revisit run never overwrites an original best; the two live side by
side, which is the point.

## Display

- Archive: every Road with name, author, dates, kind, and two counts (original entries, revisit entries).
- Road page: tabs **Original** and **Revisit**, each with open and solo; the card and hunter page show
  placings from the tab the player is looking at.
- The site's Road vote page stays about the next rotation; picking a Road to play lives with the room,
  not the vote.

## What to check in Erupe first

1. Is the Rengoku blob served per request on the session, or cached once per connection? If per request,
   a room pin is enough. If cached, the pin has to be applied at the same point the town entry loads it.
2. Does the client re-read Rengoku data at room entry, or only at town and land entry? The answer decides
   whether a host can change the Road without everyone returning to town.

Those two answers set the size of the Erupe change, and both are quick to read from `handlers_*` and the
`LOAD_RENGOKU_DATA` call site.
