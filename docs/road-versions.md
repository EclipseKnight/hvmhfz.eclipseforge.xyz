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


## Identical designs: content key versus identity key

Two people can genuinely build the same Road, and a pure sha would collapse them into one row, which
would silently attribute one person's work to the other and merge their boards. Separate the two ideas:

```
road_blob(sha256 primary key, bytes bytea, size int, created_at timestamptz)

road_version(
  id bigserial primary key,
  family_id bigint references road_family(id),
  sha256 text references road_blob(sha256),
  name text, author text, kind text,
  created_at timestamptz, first_live_at timestamptz, retired_at timestamptz,
  unique (family_id, sha256)          -- one version per family per content
)
```

- The **sha is the content**: identical files share one `road_blob` row, so 7 KB is stored once no matter
  how many people submit it.
- The **version id is the identity**: two authors with the same design get two versions, each with its own
  name, dates and boards, and rooms pin the version id rather than the raw sha.
- Boards key on `version_id`, not sha. That is what lets two identical Roads keep separate records instead
  of inheriting each other's clears. Quest rows store both: the version id for the board, the sha for
  verification against the blob that was actually served.

On upload the API hashes the blob, looks it up, and if it already exists tells the author: "this is
byte-identical to Road X by Y", offering Publish anyway (their own version) or Cancel. Publishing anyway
is legitimate, since the same design can be reached independently.

The one thing that must not be content addressed is the picker: it lists versions by family and author, so a
player sees "Nightfall by Ael" and "Nightfall by Kai" as two Roads even though the bytes match.


## The workspace: drafts that survive a closed browser

The builder needs somewhere to keep unfinished work, and it must not be the version table. Drafts are
mutable, versions are immutable.

```
road_draft(
  id bigserial primary key,
  family_id bigint references road_family(id) on delete set null,
  owner_account bigint not null,
  name text not null,
  data jsonb not null,            -- the builder's own document; the blob is derived on publish
  revision int not null default 1,
  published_version_id bigint references road_version(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

Behaviour:

- **Autosave** the draft every few seconds while editing, debounced, with a "saved at 14:02" line. This
  writes one row, repeatedly overwritten, never a version.
- **localStorage** keeps a copy too, so a dropped connection does not lose the last minute. On load the
  server copy wins unless the local one is newer, and the page says which it used.
- **Draft to version only on Publish or Test.** That is the moment a sha is computed and a
  `road_blob`/`road_version` row appears.
- **A workspace page** under Account lists every draft with name, last edited, revision, and whether it has
  ever been published or tested, with Open, Duplicate, Rename and Delete. That is the "come back and
  continue" surface, and it is per account, so it follows the person across machines.
- **Two tabs editing the same draft**: the revision number catches it. The second save sends its base
  revision, the server rejects a stale one, and the page offers keep mine or reload theirs rather than
  silently overwriting.
- **Limits**: 20 drafts per account and the same 7 KB each. If someone wants more, they archive a draft by
  publishing it as a private custom Road, which is cheap now that blobs dedupe.

Drafts are never shown in the Road picker. Only published versions are, which keeps experiments out of
everybody else's list.

## What to check in Erupe first

1. Is the Rengoku blob served per request on the session, or cached once per connection? If per request,
   a room pin is enough. If cached, the pin has to be applied at the same point the town entry loads it.
2. Does the client re-read Rengoku data at room entry, or only at town and land entry? The answer decides
   whether a host can change the Road without everyone returning to town.

Those two answers set the size of the Erupe change, and both are quick to read from `handlers_*` and the
`LOAD_RENGOKU_DATA` call site.
